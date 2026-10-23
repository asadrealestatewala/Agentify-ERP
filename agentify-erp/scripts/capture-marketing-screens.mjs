// Real screenshots of the running app for the public landing page, taken from the showcase workspaces
// (run scripts/seed-showcase.mjs first so the screens have something on them). Desktop screens are 1100x740 and phone
// screens 390x844, both at 2x, saved as WebP in client/public/marketing/.
//   node scripts/capture-marketing-screens.mjs <out-dir> [country-code]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const OUT = process.argv[2];
const only = process.argv[3];
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' };
const call = (m, u, b) => page.evaluate(async (m, u, b, h) => { const r = await fetch(u, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return { s: r.status, d: JSON.parse(t) }; } catch { return { s: r.status, d: t }; } }, m, u, b, H);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// removes development-only banners and transient toasts so the screen looks like a normal day in the app
const tidy = () => page.evaluate(() => {
  document.querySelectorAll('.alert, .toast, .toasts, .install-bar').forEach((e) => e.remove());
  for (const e of document.querySelectorAll('div,section,header')) { const t = (e.textContent || '').trim(); if (t.startsWith('Demo data is loaded') && t.length < 220) e.remove(); }
  document.querySelectorAll('[class*="trial"], [class*="banner"]').forEach((e) => { if (/free trial|confirm your email|Demo data/i.test(e.textContent || '') && (e.textContent || '').length < 300) e.remove(); });
  document.activeElement?.blur?.();
});
const shot = async (url, file, fn) => {
  await page.goto(url, { waitUntil: 'networkidle2' }); await sleep(1800);
  if (fn) { await page.evaluate(fn); await sleep(900); }
  await tidy(); await sleep(300);
  await page.screenshot({ path: path.join(OUT, file), type: 'webp', quality: 82 });
  console.log('saved', file, Math.round(fs.statSync(path.join(OUT, file)).size / 1024) + ' KB');
};

for (const cc of ['pk', 'us', 'uk', 'ae', 'ca']) {
  if (only && only !== cc) continue;
  const ws = `shotre-${cc}`; const B = `http://${ws}.localhost:4000`;
  await page.setViewport({ width: 1100, height: 740, deviceScaleFactor: 2 });
  await page.goto(`${B}/login`, { waitUntil: 'networkidle2' });
  await call('POST', '/api/auth/login', { identifier: `sana@${ws}.test`, password: 'Realty@2026x' });
  const leads = (await call('GET', '/api/contacts?type=lead&limit=50')).d.rows || [];
  const lead = leads.find((l) => /Amelia/.test(l.full_name)) || leads[0];
  await shot(`${B}/`, `m-re-dash-${cc}.webp`);
  await shot(`${B}/leads`, `m-re-inbox-${cc}.webp`);
  if (lead) await shot(`${B}/contacts/${lead.id}`, `m-re-c360-${cc}.webp`);
  await shot(`${B}/pipeline`, `m-re-pipeline-${cc}.webp`);
  await shot(`${B}/tasks`, `m-re-tasks-${cc}.webp`);
  await shot(`${B}/properties`, `m-re-props-${cc}.webp`);
  await shot(`${B}/agents`, `m-re-team-${cc}.webp`);
  await shot(`${B}/dialer`, `m-re-dialer-${cc}.webp`);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await shot(`${B}/leads`, `m-re-mob-leads-${cc}.webp`);
  if (lead) await shot(`${B}/contacts/${lead.id}`, `m-re-mob-client-${cc}.webp`);
  await shot(`${B}/tasks`, `m-re-mob-tasks-${cc}.webp`);
}
await browser.close();
