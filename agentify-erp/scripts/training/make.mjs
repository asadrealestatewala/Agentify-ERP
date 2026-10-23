/**
 * Makes the Agentify ERP training videos (animated, 1080p MP4, with a voice-over and the Agentify logo).
 *   node scripts/training/make.mjs                 every video in videos.mjs
 *   node scripts/training/make.mjs sales-agent     only the named ones
 *   node scripts/training/make.mjs --list
 * Needs the app running on http://localhost:4000 with the demo workspaces (scripts/seed-showcase.mjs fills them), Google Chrome, and
 * puppeteer-core installed in a scratch folder (it is not a project dependency). The voice is the Windows built-in speech engine.
 * Steps: sign in to the demo workspace as each person and take real screenshots -> speak the narration -> draw the animation and encode it
 * in Chrome (renderer.js, WebCodecs H.264 + AAC) -> write server/assets/training/<key>.mp4 and manifest.json.
 * Every workspace then gets the videos in its training library the first time it is opened.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { renderInPage } from './renderer.mjs';
import { VIDEOS } from './videos.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
const out = path.join(root, 'server', 'assets', 'training');
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentify-train-'));
const args = process.argv.slice(2);
if (args.includes('--list')) { for (const v of VIDEOS) console.log(v.key.padEnd(22), v.title); process.exit(0); }
const wanted = args.filter((a) => !a.startsWith('--')), todo = VIDEOS.filter((v) => !wanted.length || wanted.includes(v.key));
if (!todo.length) { console.log('No such video'); process.exit(1); }

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WS = process.env.TRAIN_WS || 'shotre-us', BASE = `http://${WS}.localhost:4000`, PASSWORD = 'Realty@2026x';
const PEOPLE = { admin: `sana@${WS}.test`, agent: `sara@${WS}.test` };
const VOICE = process.env.TRAIN_VOICE || 'Microsoft Zira Desktop';
const HOST = 'agentifyerp.co';

// ---------------------------------------------------------------- voice-over (Windows speech engine), one WAV per piece of narration
const spoken = (t) => t.replace(/\bERP\b/g, 'E R P').replace(/\bCRM\b/g, 'C R M').replace(/\bPDF\b/g, 'P D F').replace(/\bHR\b/g, 'H R');
const ps1 = path.join(tmp, 'tts.ps1');
fs.writeFileSync(ps1, `param($textFile,$wav,$voice)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($voice); $s.Rate = -1
$s.SetOutputToWaveFile($wav)
$s.Speak([IO.File]::ReadAllText($textFile))
$s.Dispose()
`);
function speak(key, texts) {
  return texts.map((t, i) => {
    const txt = path.join(tmp, `${key}-${i}.txt`), wav = path.join(tmp, `${key}-${i}.wav`);
    fs.writeFileSync(txt, spoken(t));
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, txt, wav, VOICE]);
    return wav;
  });
}
const wavSeconds = (file) => { const b = fs.readFileSync(file); let p = 12, rate = 0; while (p < b.length - 8) { const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4); if (id === 'fmt ') rate = b.readUInt32LE(p + 16); if (id === 'data') return n / rate; p += 8 + n; } return 0; };
// the renderer reads the same text as sentences for the captions
const sentences = (t) => {
  const outp = [];
  for (const sent of (t.match(/[^.!?]+[.!?]*/g) || [t]).map((x) => x.trim()).filter(Boolean)) {
    let rest = sent;
    while (rest.length > 88) { let cut = rest.lastIndexOf(', ', 88); if (cut < 30) cut = rest.lastIndexOf(' ', 88); outp.push(rest.slice(0, cut + (rest[cut] === ',' ? 1 : 0)).trim()); rest = rest.slice(cut + 1).trim(); }
    if (rest) outp.push(rest);
  }
  return outp;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--enable-features=WebCodecs'] });

// ---------------------------------------------------------------- the Agentify logo on a transparent background: a teal rounded house mark and the name
async function makeLogo() {
  const page = await browser.newPage();
  const url = await page.evaluate(() => {
    const W = 760, H = 170, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 150, 150); gr.addColorStop(0, '#2dd4bf'); gr.addColorStop(1, '#0e7c6b');
    g.fillStyle = gr; g.beginPath(); g.roundRect(10, 10, 150, 150, 36); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 11; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(42, 84); g.lineTo(85, 46); g.lineTo(128, 84); g.stroke(); // roof
    g.beginPath(); g.moveTo(54, 80); g.lineTo(54, 126); g.lineTo(116, 126); g.lineTo(116, 80); g.stroke(); // walls
    g.beginPath(); g.moveTo(76, 126); g.lineTo(76, 100); g.lineTo(94, 100); g.lineTo(94, 126); g.stroke(); // door
    g.fillStyle = '#fff'; g.font = '800 92px "Segoe UI","Helvetica Neue",Arial,sans-serif'; g.textBaseline = 'middle'; g.fillText('Agentify', 190, 70); const nameW = g.measureText('Agentify').width;
    g.fillStyle = '#7fe3d2'; g.font = '700 60px "Segoe UI","Helvetica Neue",Arial,sans-serif'; g.fillText('ERP', 190 + nameW + 22, 70);
    return c.toDataURL('image/png');
  });
  await page.close();
  return url;
}
const logo = await makeLogo();

// ---------------------------------------------------------------- screenshots of the real screens, one signed-in browser per person
const sessions = new Map();
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' };
async function sessionFor(who) {
  if (sessions.has(who)) return sessions.get(who);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1.5 });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  const r = await page.evaluate(async (id, pw, h) => (await fetch('/api/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ identifier: id, password: pw }) })).status, PEOPLE[who], PASSWORD, H);
  if (r !== 200) throw new Error(`Could not sign in as ${PEOPLE[who]} (${r}). Is the demo workspace ${WS} there?`);
  sessions.set(who, page); return page;
}
const tidy = (page) => page.evaluate(() => {
  document.querySelectorAll('.alert, .toast, .toasts, .install-bar, .onboard').forEach((e) => e.remove());
  for (const e of document.querySelectorAll('div,section,header')) { const t = (e.textContent || '').trim(); if (t.startsWith('Demo data is loaded') && t.length < 220) e.remove(); }
  document.querySelectorAll('[class*="trial"], [class*="banner"]').forEach((e) => { if (/free trial|confirm your email|Demo data/i.test(e.textContent || '') && (e.textContent || '').length < 300) e.remove(); });
  document.activeElement?.blur?.();
});
async function shot(sc) {
  const s = sc.shot, page = await sessionFor(s.as);
  await page.goto(BASE + s.path, { waitUntil: 'networkidle2' }); await new Promise((r) => setTimeout(r, 1500));
  if (s.act) { try { await s.act(page); } catch (e) { console.log('  (could not do the step: ' + String(e.message).split('\n')[0] + ')'); } await new Promise((r) => setTimeout(r, 1000)); }
  await tidy(page);
  let focus = null;
  for (const sel of [s.focus, '.page-head', 'section.card', 'table'].filter(Boolean)) {
    focus = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); if (b.width < 40 || b.height < 20) return null; return { x: Math.max(0, b.x / innerWidth), y: Math.max(0, b.y / innerHeight), w: Math.min(1, b.width / innerWidth), h: Math.min(1, b.height / innerHeight) }; }, sel);
    if (focus) break;
  }
  if (!focus) console.log('  (nothing to point at on ' + s.path + ')');
  const buf = await page.screenshot({ type: 'jpeg', quality: 88 });
  return { img: 'data:image/jpeg;base64,' + Buffer.from(buf).toString('base64'), focus };
}

// ---------------------------------------------------------------- make each video
const manifestFile = path.join(out, 'manifest.json');
const readManifest = () => { try { return JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { return []; } };
for (const v of todo) {
  console.log(`\n== ${v.key}: ${v.title}`);
  const texts = [v.intro, ...v.scenes.map((s) => s.say), v.outro];
  const wavs = speak(v.key, texts), secs = wavs.map(wavSeconds);
  const total = secs.reduce((a, b) => a + b, 0) + 0.55 + 0.65 * v.scenes.length + 0.9;
  console.log(`  narration ${secs.reduce((a, b) => a + b, 0).toFixed(1)} s, video about ${total.toFixed(1)} s`);
  const b64 = (f) => fs.readFileSync(f).toString('base64');
  const segments = [{ kind: 'intro', wav: b64(wavs[0]), sentences: sentences(v.intro) }];
  for (const [i, s] of v.scenes.entries()) { const sh = await shot(s); segments.push({ kind: 'scene', wav: b64(wavs[i + 1]), phase: s.phase, title: s.title, bullets: s.bullets, sentences: sentences(s.say), img: sh.img, focus: sh.focus, call: s.call, url: s.shot.path }); }
  segments.push({ kind: 'outro', wav: b64(wavs[wavs.length - 1]), sentences: sentences(v.outro) });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().startsWith('https://promo.local/') ? r.respond({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }) : r.continue()));
  await page.goto('https://promo.local/'); // a secure page, so that the video encoder is available
  await page.addScriptTag({ path: path.join(here, 'vendor', 'mp4-muxer.js') });
  const partFile = path.join(tmp, `${v.key}.part`); fs.rmSync(partFile, { force: true });
  await page.exposeFunction('__saveChunk', (b) => { fs.appendFileSync(partFile, Buffer.from(b, 'base64')); });
  const res = await page.evaluate(renderInPage, { title: v.title, kicker: v.kicker, tagline: v.tagline, logo, host: HOST, recap: v.recap || v.scenes.map((s) => s.phase), segments });
  await page.close();
  fs.rmSync(path.join(out, `${v.key}.mp4`), { force: true });
  fs.copyFileSync(partFile, path.join(out, `${v.key}.mp4`));
  const entry = { key: v.key, title: v.title, description: v.description, category: v.category, seconds: Math.round(res.seconds), roles: v.roles, order: v.order };
  const manifest = [...readManifest().filter((m) => m.key !== v.key), entry].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`  wrote ${v.key}.mp4  ${(fs.statSync(path.join(out, `${v.key}.mp4`)).size / 1048576).toFixed(1)} MB, ${res.seconds.toFixed(1)} s`);
}
await browser.close();
process.exit(0);
