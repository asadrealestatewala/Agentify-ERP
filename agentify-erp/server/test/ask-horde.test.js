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
const { platformDb } = await import('../src/platform.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const { resetRateLimit } = await import('../src/services/askAi.js');
const dbm = await import('../src/db.js');

let server, port, calls = [], hordeText = '1. Open Creative Studio.\n2. Choose Video reels.', geminiFails = false, hordeJobs = [];
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 280 } }), { status: 200 });
    if (u.includes('aihorde.net/api/v2/generate/text/async')) { hordeJobs.push({ body: JSON.parse(opts.body), key: opts.headers.apikey }); return new Response(JSON.stringify({ id: 'job-1' }), { status: 202 }); }
    if (u.includes('aihorde.net/api/v2/generate/text/status')) return new Response(JSON.stringify({ done: true, generations: [{ text: hordeText, model: 'koboldcpp/test' }] }), { status: 200 });
    if (u.includes('aihorde.net/api/v2/find_user')) return new Response(JSON.stringify({ username: 'agentify#1', kudos: 120 }), { status: 200 });
    if (u.includes(':generateContent') && geminiFails) return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 });
    if (u.includes(':generateContent')) { calls.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ found: true, answer: 'gemini answer' }) }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 80 } }), { status: 200 }); }
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

process.env.HORDE_POLL_MS = '5';
const { scrubForHorde } = await import('../src/services/hordeGateway.js');

test('scrubForHorde masks emails, phones, keys, links with queries and names', () => {
  const r = scrubForHorde('Mail sara.khan@example.com or call +92 300 1234567, id 4210112345678, key AIzaSyA1234567890abcdefghijklmn, see https://x.test/p?token=abc. Ask Sara Khan', ['Sara Khan']);
  assert.ok(!/example\.com|1234567|4210112345678|AIza|token=|Sara/.test(r.text), r.text);
  assert.ok(r.removed >= 6);
  assert.equal(scrubForHorde('How do I add a lead?').text, 'How do I add a lead?');
});

test('Ask can use Stable Horde: key kept private, privacy guard, order and fallback', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await signup('horde', 'owner@horde.test')).status, 201);
  const a = await login('horde', 'owner@horde.test');
  const ask = (question, history) => a('POST', '/api/assistant/ask', { question, history });
  const q = 'reel voiceover credits limit';

  // console: save, test, never echoed back
  const key = 'HordeSecretKey_abcdef1234567890';
  assert.equal((await as(owner, 'PUT', '/ai/horde', { key: 'bad key!' })).status, 400);
  const saved = await as(owner, 'PUT', '/ai/horde', { key, provider_order: 'horde', models: 'koboldcpp/test' });
  assert.equal(saved.status, 200); assert.equal(saved.data.key_added, true);
  assert.ok(!JSON.stringify((await as(owner, 'GET', '/ai/overview')).data).includes(key), 'key never returned');
  assert.equal((await as(owner, 'POST', '/ai/horde/test')).data.username, 'agentify#1');
  assert.equal((await as(owner, 'PUT', '/ai/horde', { provider_order: 'nonsense' })).status, 400);

  // no Gemini key at all: Horde answers; question is scrubbed; reference is help text only
  const r1 = await ask(`${q} for sara@client.com 03001234567`);
  assert.equal(r1.data.intent, 'ai', JSON.stringify(r1.data)); assert.match(r1.data.answer, /Creative Studio/);
  assert.equal(hordeJobs[0].key, key); assert.equal(hordeJobs[0].body.models[0], 'koboldcpp/test'); assert.equal(hordeJobs[0].body.trusted_workers, true);
  assert.ok(!/sara@client|03001234567/.test(hordeJobs[0].body.prompt), 'personal data stripped');
  assert.match(hordeJobs[0].body.prompt, /REFERENCE MATERIAL/); assert.match(hordeJobs[0].body.prompt, /same language as the QUESTION/);
  const row = platformDb().prepare("SELECT * FROM ai_usage WHERE provider='stablehorde' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.feature, 'ask_assistant'); assert.equal(row.usd, 0); assert.ok(row.tenant_id > 0 && row.ok === 1);

  // NOT_FOUND from the model is reported as not found
  hordeText = 'NOT_FOUND';
  const nf = await ask(`${q} again`); assert.equal(nf.data.intent, 'unknown'); assert.match(nf.data.answer, /could not find/);
  hordeText = '1. Open Creative Studio.';

  // Gemini first, Horde as backup when Gemini fails
  setSetting('platform_gemini_key', 'AIza' + 'k'.repeat(35), { secret: true });
  await as(owner, 'PUT', '/ai/fx', { live: false, manual_rate: 280 });
  await as(owner, 'PUT', '/ai/horde', { provider_order: 'gemini,horde' });
  resetRateLimit(); const before = hordeJobs.length;
  assert.match((await ask(q)).data.answer, /gemini answer/); assert.equal(hordeJobs.length, before, 'Gemini answered, Horde unused');
  geminiFails = true;
  const fb = await ask(`${q} please`); assert.equal(fb.data.intent, 'ai'); assert.match(fb.data.answer, /Creative Studio/); assert.equal(hordeJobs.length, before + 1);
  geminiFails = false;

  // the kill switch stops every engine
  await as(owner, 'PUT', '/ai/controls', { kill_switch: true });
  const n = hordeJobs.length; const off = await ask(`${q} now`); assert.match(off.data.answer, /switched off/); assert.equal(hordeJobs.length, n);
  await as(owner, 'PUT', '/ai/controls', { kill_switch: false });

  // removing the key
  assert.equal((await as(owner, 'DELETE', '/ai/horde/key')).data.key_added, false);
});
