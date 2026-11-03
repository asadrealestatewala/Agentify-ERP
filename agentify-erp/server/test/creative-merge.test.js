import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

// Creative Studio reels: 16/24 second joins, the voice inside the video (ffmpeg), the two voice paths, refunds, and the no-ffmpeg fallback.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-creative-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const { platformDb, getTenantBySlug } = await import('../src/platform.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const { runReelJobs } = await import('../src/services/creativeJobs.js');
const { checkFfmpeg, probeSeconds } = await import('../src/services/ffmpeg.js');
const { creditsLeft } = await import('../src/services/aiGate.js');
const dbm = await import('../src/db.js');


// real media made by ffmpeg itself: an 8 s vertical clip with its own sound, and two voice files (5 s and 20 s)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-media-'));
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a], { stdio: 'pipe' });
let haveFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' }); } catch { haveFfmpeg = false; }
if (haveFfmpeg) {
  ff('-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=24:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(tmp, 'clip.mp4'));
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=5', '-c:a', 'libmp3lame', path.join(tmp, 'v5.mp3'));
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=20', '-c:a', 'libmp3lame', path.join(tmp, 'v20.mp3'));
}
const CLIP = haveFfmpeg ? fs.readFileSync(path.join(tmp, 'clip.mp4')) : Buffer.alloc(4000, 9);
let voiceFile = 'v5.mp3';
let server, port, veoStarts = 0, ttsCalls = 0; const prompts = []; const ops = {};
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 280 } }), { status: 200 });
    if (u.includes(':predictLongRunning')) {
      prompts.push(JSON.parse(opts.body).instances[0].prompt);
      veoStarts += 1; const name = `models/veo-3.0-fast-generate-001/operations/op${veoStarts}`; ops[name] = 'pending';
      return new Response(JSON.stringify({ name }), { status: 200 });
    }
    if (u.includes('/operations/')) {
      const name = u.slice(u.indexOf('models/')); const st = ops[name];
      if (st === 'error') return new Response(JSON.stringify({ done: true, error: { message: 'boom' } }), { status: 200 });
      if (st === 'done') return new Response(JSON.stringify({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media' } }] } } }), { status: 200 });
      return new Response(JSON.stringify({ done: false }), { status: 200 });
    }
    if (u.includes('/files/abc:download')) return new Response(CLIP, { status: 200 });
    if (u.includes('tts.speech.microsoft.com/cognitiveservices/v1')) { ttsCalls += 1; return new Response(fs.readFileSync(path.join(tmp, voiceFile)), { status: 200 }); }
    throw new Error(`unexpected fetch ${u}`);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); dbm.closeDbs(); fs.rmSync(tmp, { recursive: true, force: true }); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c));
    res.on('end', () => { const buf = Buffer.concat(ch); let d; try { d = JSON.parse(buf.toString()); } catch { d = buf; } resolve({ status: res.statusCode, data: d, headers: res.headers, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const A = '/api/platform/admin';
const as = (cookie, method, url, body) => call('erp.test', method, `${A}${url}`, body, { cookie });
const signup = (slug, email) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', region: 'PK' });
const login = async (slug, id) => { const host = `${slug}.erp.test`; const l = await call(host, 'POST', '/api/auth/login', { identifier: id, password: 'Tenant@12345' }); assert.equal(l.status, 200); return (m, u, b) => call(host, m, u, b, { cookie: l.cookie }); };


const finishAll = async () => { for (const k of Object.keys(ops)) if (ops[k] === 'pending') ops[k] = 'done'; await runReelJobs(); };
const probeStreams = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
const DESC = 'A sunrise over our new apartment tower, slow drone shot';

test('reels: voice inside the video, 16 and 24 seconds, Veo-speaks path, refunds, and no-ffmpeg fallback', { skip: !haveFfmpeg && 'ffmpeg is not installed here' }, async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await signup('mrg', 'owner@mrg.test')).status, 201);
  const a = await login('mrg', 'owner@mrg.test'); const tid = getTenantBySlug('mrg').id;
  setSetting('platform_gemini_key', 'AIza' + 'k'.repeat(35), { secret: true });
  await as(owner, 'PUT', '/ai/fx', { live: false, manual_rate: 280 });
  await as(owner, 'PUT', '/ai/azure', { key: 'a'.repeat(32), region: 'uaenorth' });
  await a('PUT', '/api/creative/brand', { brand_name: 'Mrg Homes', language: 'English' });
  await as(owner, 'PUT', `/ai/workspaces/${tid}/credits`, { monthly_credits: 2000 });

  // before the startup check there is no ffmpeg: 8 seconds only
  assert.equal((await a('GET', '/api/creative/status')).data.reels.lengths.length, 1);
  assert.equal((await a('POST', '/api/creative/reels', { description: DESC, seconds: 16, accept_cost: 128 })).data.code, 'ffmpeg_missing');
  assert.equal((await checkFfmpeg()).available, true);
  const st = (await a('GET', '/api/creative/status')).data.reels;
  assert.deepEqual(st.lengths, [8, 16, 24]); assert.equal(st.ffmpeg.available, true);

  // quotes scale with length; Veo-speaks has no per-character voice price
  assert.equal((await a('POST', '/api/creative/reels/quote', { seconds: 24 })).data.total, 192);
  const q = (await a('POST', '/api/creative/reels/quote', { seconds: 16, script: 'x'.repeat(250) })).data; assert.equal(q.total, 128 + 3); assert.equal(q.max_chars, 1200);
  assert.equal((await a('POST', '/api/creative/reels/quote', { seconds: 16, script: 'x'.repeat(250), voice_path: 'speech' })).data.total, 128);
  assert.equal((await a('POST', '/api/creative/reels', { description: DESC, seconds: 12, accept_cost: 96 })).status, 400, 'only 8, 16 or 24');
  assert.equal((await a('POST', '/api/creative/reels', { description: DESC, seconds: 8, script: 'x'.repeat(700), accept_cost: 70 })).status, 400, 'script too long for 8 s');

  // Path B, 24 seconds: three clips plus an exact script, one finished file with the voice inside
  const c0 = creditsLeft(tid);
  const r1 = await a('POST', '/api/creative/reels', { description: DESC, seconds: 24, script: 'Welcome home. '.repeat(18), language: 'English', accept_cost: 192 + 3, scenes: ['Exterior at dawn', 'Living room', 'Balcony view'] });
  assert.equal(r1.status, 201, JSON.stringify(r1.data)); assert.equal(veoStarts, 3); assert.equal(creditsLeft(tid), c0 - 195);
  assert.match(prompts[1], /part 2 of 3/); assert.match(prompts[1], /Living room/); assert.match(prompts[0], /no spoken dialogue/);
  await finishAll();
  const j1 = (await a('GET', '/api/creative/reels')).data.find((j) => j.id === r1.data.id);
  assert.equal(j1.status, 'done'); assert.equal(j1.has_audio, 0, 'the voice is inside the video, not a second file');
  const vid = await a('GET', `/api/creative/reels/${j1.id}/video`); assert.equal(vid.status, 200);
  const f1 = path.join(tmp, 'out1.mp4'); fs.writeFileSync(f1, vid.data);
  const p1 = probeStreams(f1); assert.deepEqual(p1.streams.map((s) => s.codec_type).sort(), ['audio', 'video']); assert.ok(Math.abs(Number(p1.format.duration) - 24) < 1, `duration ${p1.format.duration}`);

  // Path A, 16 seconds: no Azure call, the quoted line is in the prompts, Veo's own sound is kept
  const tts0 = ttsCalls, pv = prompts.length;
  const r2 = await a('POST', '/api/creative/reels', { description: DESC, seconds: 16, voice_path: 'speech', script: 'Welcome home. Book your visit today.', language: 'English', accept_cost: 128 });
  assert.equal(r2.status, 201, JSON.stringify(r2.data)); assert.equal(ttsCalls, tts0, 'Veo speaks, Azure is not used');
  assert.match(prompts[pv], /exactly: "Welcome home\."/); assert.match(prompts[pv + 1], /exactly: "Book your visit today\."/);
  await finishAll();
  const j2 = (await a('GET', '/api/creative/reels')).data.find((j) => j.id === r2.data.id); assert.equal(j2.status, 'done');
  const f2 = path.join(tmp, 'out2.mp4'); fs.writeFileSync(f2, (await a('GET', `/api/creative/reels/${j2.id}/video`)).data);
  const p2 = probeStreams(f2); assert.ok(p2.streams.some((s) => s.codec_type === 'audio')); assert.ok(Math.abs(Number(p2.format.duration) - 16) < 1);

  // a voice that is longer than the reel is refused before any video is paid for
  voiceFile = 'v20.mp3'; const startsBefore = veoStarts, c1 = creditsLeft(tid);
  const long = await a('POST', '/api/creative/reels', { description: DESC, seconds: 8, script: 'Welcome home. '.repeat(10), accept_cost: 64 + 2 });
  assert.equal(long.status, 400); assert.equal(long.data.code, 'voice_too_long'); assert.equal(veoStarts, startsBefore); assert.equal(creditsLeft(tid), c1, 'voice credits returned');
  voiceFile = 'v5.mp3';

  // hearing the voice first charges the voice credits once; starting the same reel then reuses it
  const c3 = creditsLeft(tid), tts1 = ttsCalls, SCRIPT = 'Welcome home. '.repeat(3);
  const hear = await a('POST', '/api/creative/reels/voice-preview', { script: SCRIPT, language: 'English', seconds: 8 });
  assert.equal(hear.status, 200, JSON.stringify(hear.data)); assert.equal(hear.data.fits, true); assert.ok(Math.abs(hear.data.voice_seconds - 5) < 0.4); assert.equal(hear.data.credits, 1);
  assert.equal(creditsLeft(tid), c3 - 1); assert.equal(ttsCalls, tts1 + 1);
  assert.equal((await a('POST', '/api/creative/reels/voice-preview', { script: SCRIPT, language: 'English', seconds: 8 })).data.credits, 0, 'hearing it again is free');
  const rh = await a('POST', '/api/creative/reels', { description: DESC, script: SCRIPT, accept_cost: 64 + 1 }); assert.equal(rh.status, 201, JSON.stringify(rh.data));
  assert.equal(ttsCalls, tts1 + 1, 'no second voice call'); assert.equal(creditsLeft(tid), c3 - 65, 'the voice is charged once in total');
  await finishAll();

  // one of three clips fails: the whole reel is refunded
  const c2 = creditsLeft(tid);
  const r3 = await a('POST', '/api/creative/reels', { description: DESC, seconds: 24, accept_cost: 192 }); assert.equal(r3.status, 201);
  assert.equal(creditsLeft(tid), c2 - 192);
  const names = Object.keys(ops).filter((k) => ops[k] === 'pending'); ops[names[0]] = 'done'; ops[names[1]] = 'error'; ops[names[2]] = 'done';
  await runReelJobs();
  const j3 = (await a('GET', '/api/creative/reels')).data.find((j) => j.id === r3.data.id); assert.equal(j3.status, 'failed'); assert.equal(creditsLeft(tid), c2, 'refunded in full');

  // the 8 s voice reel with ffmpeg is also one file
  const r4 = await a('POST', '/api/creative/reels', { description: DESC, script: 'Welcome home.', accept_cost: 64 + 1 }); assert.equal(r4.status, 201);
  await finishAll();
  assert.equal((await a('GET', '/api/creative/reels')).data.find((j) => j.id === r4.data.id).has_audio, 0);

  // ffmpeg disappears (a server without it): 8 s still works with the voice as a separate file, longer reels are switched off
  process.env.ERP_FFMPEG = '/nonexistent/ffmpeg'; assert.equal((await checkFfmpeg()).available, false);
  assert.equal((await a('POST', '/api/creative/reels', { description: DESC, seconds: 24, accept_cost: 192 })).data.code, 'ffmpeg_missing');
  const r5 = await a('POST', '/api/creative/reels', { description: DESC, script: 'Welcome home.', accept_cost: 64 + 1 }); assert.equal(r5.status, 201);
  await finishAll();
  const j5 = (await a('GET', '/api/creative/reels')).data.find((j) => j.id === r5.data.id);
  assert.equal(j5.status, 'done'); assert.equal(j5.has_audio, 1); assert.match(j5.note, /separate file/);
  delete process.env.ERP_FFMPEG; await checkFfmpeg();
});

test('ffmpeg helper: probe, join and voice mixing', { skip: !haveFfmpeg && 'ffmpeg is not installed here' }, async () => {
  await checkFfmpeg();
  const { buildReel } = await import('../src/services/ffmpeg.js');
  const s = await probeSeconds(fs.readFileSync(path.join(tmp, 'v5.mp3')), '.mp3'); assert.ok(Math.abs(s - 5) < 0.3);
  const out = await buildReel({ clips: [CLIP, CLIP], voice: fs.readFileSync(path.join(tmp, 'v5.mp3')) });
  assert.ok(Math.abs((await probeSeconds(out, '.mp4')) - 16) < 1);
  await assert.rejects(() => buildReel({ clips: [CLIP, CLIP, CLIP, CLIP] }), /Unexpected number/);
});

test('Punjabi voice lab: console only, costs confirmed, tenants never see Punjabi', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  setSetting('platform_gemini_key', 'AIza' + 'k'.repeat(35), { secret: true });
  const v = await as(owner, 'GET', '/ai/lab/voices');
  if (v.status === 200) assert.equal(v.data.language, 'Punjabi');
  assert.equal((await as(owner, 'POST', '/ai/lab/clip', { text: 'Sat sri akal', accept: false })).data.code, 'cost_not_accepted');
  assert.equal((await as(owner, 'POST', '/ai/lab/voice', { text: 'Sat sri akal', voice: 'en-US-JennyNeural' })).status, 400, 'must be a Punjabi voice');
  if (!getTenantBySlug('mrg')) assert.equal((await signup('mrg', 'owner@mrg.test')).status, 201); // the reels test that creates it is skipped where ffmpeg is missing (CI)
  const a = await login('mrg', 'owner@mrg.test');
  assert.deepEqual((await a('GET', '/api/creative/status')).data.languages, ['English', 'Roman Urdu', 'Urdu']);
});

test('Brand setup wizard fields save, are cleaned, and survive an older client save', async () => {
  if (!getTenantBySlug('mrg')) assert.equal((await signup('mrg', 'owner@mrg.test')).status, 201);
  const a = await login('mrg', 'owner@mrg.test');
  const put = await a('PUT', '/api/creative/brand', { brand_name: 'Wizard Co', audience: 'Young families', city: 'Lahore', platforms: ['Instagram', 'Bogus'], languages: ['Roman Urdu', 'Klingon'], posts_per_week: 5, tone_tags: ['Warm', 'Bold', 'Calm', 'Playful', 'Friendly'] });
  assert.equal(put.status, 200);
  assert.deepEqual(put.data.platforms, ['Instagram']);
  assert.deepEqual(put.data.languages, ['Roman Urdu']);
  assert.equal(put.data.tone_tags.length, 4);
  assert.equal(put.data.posts_per_week, 5);
  const old = await a('PUT', '/api/creative/brand', { brand_name: 'Wizard Co', tone: 'Calm' });
  assert.equal(old.data.city, 'Lahore');
  assert.deepEqual(old.data.platforms, ['Instagram']);
});
