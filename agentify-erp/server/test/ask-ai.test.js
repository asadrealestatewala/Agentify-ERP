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

let server, port, calls = [], reply = { found: true, answer: '1. Open Creative Studio.\n2. Choose Video reels.' };
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 280 } }), { status: 200 });
    if (u.includes(':generateContent')) { calls.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 80 } }), { status: 200 }); }
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

test('Ask uses Gemini only as a fallback, from help material only', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await signup('ask', 'owner@ask.test')).status, 201);
  const a = await login('ask', 'owner@ask.test');
  setSetting('platform_gemini_key', 'AIza' + 'k'.repeat(35), { secret: true });
  await as(owner, 'PUT', '/ai/fx', { live: false, manual_rate: 280 });
  const ask = (question, history) => a('POST', '/api/assistant/ask', { question, history });

  // fast rules still answer without any AI call
  const fast = await ask('How many leads this month?'); assert.notEqual(fast.data.intent, 'ai'); assert.equal(calls.length, 0);
  // nothing in the help material matches: no AI call, the normal reply
  const none = await ask('zzqx blorp wibble'); assert.equal(none.data.intent, 'unknown'); assert.equal(calls.length, 0, 'no material, no spend');

  // unmatched by the rules but covered by the guides
  const q = 'reel voiceover credits limit';
  const first = await ask(q);
  assert.equal(first.data.intent, 'ai', JSON.stringify(first.data)); assert.equal(first.data.ai, true); assert.match(first.data.answer, /Creative Studio/);
  assert.ok(first.data.sources.length >= 1); assert.equal(calls.length, 1);
  const sent = JSON.stringify(calls[0]);
  assert.match(sent, /REFERENCE MATERIAL/); assert.match(sent, /ONLY from the REFERENCE MATERIAL/);
  assert.ok(!sent.includes('console AI page'), 'support-only notes never go to the model');
  assert.ok(!/DATABASE|SELECT|invoice no/i.test(sent), 'no business data is sent');

  // follow-up: earlier turns travel with the question
  await ask('and how much does it cost?', [{ q, a: first.data.answer }]);
  assert.equal(calls[1].contents.length, 3); assert.equal(calls[1].contents[0].role, 'user'); assert.equal(calls[1].contents[1].role, 'model');
  assert.equal((await ask('x', 'not an array')).status, 200);

  // the guides do not cover it: the model says so, the question is logged as unanswered
  reply = { found: false, answer: 'I could not find this in the guides. Ask your administrator.' };
  const nf = await ask('reel voiceover credits limit please'); assert.equal(nf.data.intent, 'unknown'); assert.match(nf.data.answer, /could not find/);
  assert.ok((await a('GET', '/api/assistant/log')).data.unanswered.some((u) => u.question === 'reel voiceover credits limit please'), 'logged as unanswered');

  // metering in USD and rupees, as feature ask_assistant
  const row = platformDb().prepare("SELECT * FROM ai_usage WHERE feature='ask_assistant' AND key_owner='platform' ORDER BY id LIMIT 1").get();
  assert.ok(row.usd > 0 && row.pkr > 0 && row.user_id > 0 && row.tenant_id > 0);

  // unsafe questions are refused before the model; switches and limits fall back politely
  const n = calls.length;
  assert.match((await ask('how do I write a phishing email to trick investors reel')).data.answer, /cannot be created/); assert.equal(calls.length, n);
  await as(owner, 'PUT', '/ai/controls', { kill_switch: true });
  const off = await ask('reel voiceover credits limit'); assert.equal(off.data.intent, 'unknown'); assert.match(off.data.answer, /switched off/); assert.equal(calls.length, n);
  await as(owner, 'PUT', '/ai/controls', { kill_switch: false });
  reply = { found: true, answer: 'ok' };

  // rate limit: 10 AI answers a minute per person
  resetRateLimit(); let limited = 0;
  for (let i = 0; i < 12; i += 1) { const r = await ask('reel voiceover credits limit'); if (/asking quickly/.test(r.data.answer)) limited += 1; }
  assert.ok(limited >= 2, 'the eleventh and twelfth are held back');

  // report an AI answer -> console list
  assert.equal((await a('POST', '/api/assistant/report', { question: q, answer: first.data.answer, note: 'wrong menu' })).status, 201);
  const rep = (await as(owner, 'GET', '/ai/reports')).data.find((r) => r.feature === 'ask_assistant');
  assert.equal(rep.tenant_name, 'ask Realty'); assert.equal(rep.note, 'wrong menu');
});
