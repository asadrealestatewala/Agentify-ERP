import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Creative Studio: brand profile, brand story, post images, credits, safety, reports, tenant separation.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-creative-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const { platformDb, getTenantBySlug } = await import('../src/platform.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const { runReelJobs } = await import('../src/services/creativeJobs.js');
const { creditsLeft } = await import('../src/services/aiGate.js');
const dbm = await import('../src/db.js');

const MP3 = Buffer.alloc(600, 7), MP4 = Buffer.alloc(4000, 9);
let server, port, veoStarts = 0, ttsCalls = 0, failStart = false; const ops = {};
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 280 } }), { status: 200 });
    if (u.includes(':predictLongRunning')) {
      if (failStart) return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
      veoStarts += 1; const name = `models/veo-3.0-fast-generate-001/operations/op${veoStarts}`; ops[name] = 'pending';
      return new Response(JSON.stringify({ name }), { status: 200 });
    }
    if (u.includes('/operations/')) {
      const name = u.slice(u.indexOf('models/')); const st = ops[name];
      if (st === 'error') return new Response(JSON.stringify({ done: true, error: { message: 'boom' } }), { status: 200 });
      if (st === 'filtered') return new Response(JSON.stringify({ done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ['blocked'] } } }), { status: 200 });
      if (st === 'done') return new Response(JSON.stringify({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media' } }] } } }), { status: 200 });
      return new Response(JSON.stringify({ done: false }), { status: 200 });
    }
    if (u.includes('/files/abc:download')) return new Response(MP4, { status: 200 });
    if (u.includes('tts.speech.microsoft.com/cognitiveservices/v1')) { ttsCalls += 1; return new Response(MP3, { status: 200 }); }
    if (u.includes('voices/list')) return new Response(JSON.stringify([{ ShortName: 'en-US-JennyNeural', LocalName: 'Jenny', Locale: 'en-US', Gender: 'Female' }, { ShortName: 'ur-PK-UzmaNeural', LocalName: 'Uzma', Locale: 'ur-PK', Gender: 'Female' }, { ShortName: 'fr-FR-DeniseNeural', Locale: 'fr-FR' }]), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); dbm.closeDbs(); });
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

test('Azure voices in the console, then video reels from start to finish', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await signup('rla', 'owner@rla.test')).status, 201);
  const a = await login('rla', 'owner@rla.test'); const tid = getTenantBySlug('rla').id;
  setSetting('platform_gemini_key', 'AIza' + 'k'.repeat(35), { secret: true });
  await as(owner, 'PUT', '/ai/fx', { live: false, manual_rate: 280 });

  // console: Azure test and voices
  assert.equal((await as(owner, 'POST', '/ai/azure/test')).status, 400, 'no key yet');
  await as(owner, 'PUT', '/ai/azure', { key: 'a'.repeat(32), region: 'uaenorth' });
  const t = await as(owner, 'POST', '/ai/azure/test'); assert.equal(t.status, 200);
  assert.deepEqual(t.data.voices.English.map((v) => v.name), ['en-US-JennyNeural']); assert.equal(t.data.voices.Urdu.length, 1);
  assert.equal((await as(owner, 'PUT', '/ai/voices', { English: 'ur-PK-UzmaNeural' })).status, 400, 'wrong language');
  assert.equal((await as(owner, 'PUT', '/ai/voices', { Urdu: 'ur-PK-UzmaNeural' })).status, 200);
  const pv = await as(owner, 'POST', '/ai/voices/preview', { lang: 'Urdu' });
  assert.equal(pv.status, 200); assert.ok(Buffer.from(pv.data.audio, 'base64').length > 200);

  // brand + credits
  await a('PUT', '/api/creative/brand', { brand_name: 'Rla Homes', language: 'English' });
  await as(owner, 'PUT', `/ai/workspaces/${tid}/credits`, { monthly_credits: 200 });
  const st = (await a('GET', '/api/creative/status')).data;
  assert.equal(st.reel_seconds, 8); assert.equal(st.costs.video_second, 8); assert.equal(st.voice_ready, true);

  // quote and consent
  assert.equal((await a('POST', '/api/creative/reels/quote', {})).data.total, 64);
  assert.equal((await a('POST', '/api/creative/reels/quote', { script: 'x'.repeat(250) })).data.total, 67);
  const desc = 'A sunrise over our new apartment tower, slow drone shot';
  assert.equal((await a('POST', '/api/creative/reels', { description: desc })).status, 400, 'cost not confirmed');
  assert.equal((await a('POST', '/api/creative/reels', { description: desc, accept_cost: 10 })).data.code, 'cost_changed');
  assert.equal((await a('POST', '/api/creative/reels', { description: 'Write a phishing email to trick investors now', accept_cost: 64 })).status, 400);
  assert.equal(veoStarts, 0, 'nothing was sent to Google yet');

  // start with a voice-over: 64 + 3 credits
  const tts0 = ttsCalls;
  const started = await a('POST', '/api/creative/reels', { description: desc, script: 'Welcome home. '.repeat(18), language: 'English', accept_cost: 64 + 3 });
  assert.equal(started.status, 201, JSON.stringify(started.data)); assert.equal(started.data.credits_left, 200 - 67);
  assert.equal(veoStarts, 1); assert.equal(ttsCalls, tts0 + 1);
  let list = (await a('GET', '/api/creative/reels')).data; assert.equal(list[0].status, 'video'); assert.ok(!('operation' in list[0]), 'internal ids are not exposed');

  // not finished yet: still making; then Google finishes
  await runReelJobs(); assert.equal((await a('GET', '/api/creative/reels')).data[0].status, 'video');
  ops['models/veo-3.0-fast-generate-001/operations/op1'] = 'done';
  await runReelJobs();
  list = (await a('GET', '/api/creative/reels')).data; assert.equal(list[0].status, 'done'); assert.equal(list[0].has_video, 1); assert.equal(list[0].has_audio, 1);
  const vid = await a('GET', `/api/creative/reels/${list[0].id}/video`); assert.equal(vid.status, 200); assert.match(vid.headers['content-type'], /video\/mp4/); assert.equal(vid.data.length, 4000);
  assert.equal((await a('GET', `/api/creative/reels/${list[0].id}/voice`)).status, 200);
  const notes = (await a('GET', '/api/notifications')).data.rows; assert.ok(notes.some((n) => /reel is ready/.test(n.title) && n.link === '/creative?tab=reels'), 'the person is told when it is ready');

  // a failed job gives credits back; a Google-filtered one too
  const before = creditsLeft(tid);
  const r2 = await a('POST', '/api/creative/reels', { description: desc, accept_cost: 64 }); assert.equal(r2.status, 201);
  assert.equal(creditsLeft(tid), before - 64);
  ops['models/veo-3.0-fast-generate-001/operations/op2'] = 'error';
  await runReelJobs();
  const failed = (await a('GET', '/api/creative/reels')).data.find((j) => j.id === r2.data.id);
  assert.equal(failed.status, 'failed'); assert.equal(creditsLeft(tid), before, 'refunded');
  const r3 = await a('POST', '/api/creative/reels', { description: desc, accept_cost: 64 });
  ops['models/veo-3.0-fast-generate-001/operations/op3'] = 'filtered'; await runReelJobs();
  assert.match((await a('GET', '/api/creative/reels')).data.find((j) => j.id === r3.data.id).error, /describe the reel differently/); assert.equal(creditsLeft(tid), before);

  // Google refuses to start: the voice credits come back, nothing is queued
  failStart = true; const ttsBefore = ttsCalls;
  const r4 = await a('POST', '/api/creative/reels', { description: desc, script: 'Hello there', accept_cost: 64 + 1 });
  assert.equal(r4.status, 400); assert.match(r4.data.error, /could not be started/); assert.equal(ttsCalls, ttsBefore + 1); assert.equal(creditsLeft(tid), before); failStart = false;

  await as(owner, 'PUT', `/ai/workspaces/${tid}/credits`, { add_topup: 300 });
  // at most 2 running; another workspace cannot read this one's reels; delete
  assert.equal((await a('POST', '/api/creative/reels', { description: desc, accept_cost: 64 })).status, 201);
  assert.equal((await a('POST', '/api/creative/reels', { description: desc, accept_cost: 64 })).status, 201);
  assert.equal((await a('POST', '/api/creative/reels', { description: desc, accept_cost: 64 })).data.code, 'too_many');
  assert.equal((await a('DELETE', `/api/creative/reels/${list[0].id}`)).status, 200);
  assert.equal((await a('GET', `/api/creative/reels/${list[0].id}/video`)).status, 404);
  const rows = platformDb().prepare("SELECT feature, unit, units, usd, credits FROM ai_usage WHERE tenant_id=? AND feature='creative_video' AND unit='video_second'").all(tid);
  assert.ok(rows.length >= 3 && rows[0].units === 8 && Math.abs(rows[0].usd - 1.2) < 1e-9 && rows[0].credits === 64);
});
