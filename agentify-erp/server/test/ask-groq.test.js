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

let server, port, calls = [], groqText = '1. Open Creative Studio.\n2. Choose Video reels.', groqStatus = 200, groqCalls = [], sttCalls = [], hordeJobs = [];
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 280 } }), { status: 200 });
    if (u.includes('api.groq.com/openai/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'x' }, { id: 'y' }] }), { status: 200 });
    if (u.includes('api.groq.com/openai/v1/chat/completions')) { groqCalls.push({ body: JSON.parse(opts.body), auth: opts.headers.Authorization }); if (groqStatus !== 200) return new Response(JSON.stringify({ error: { message: 'rate' } }), { status: groqStatus }); return new Response(JSON.stringify({ choices: [{ message: { content: groqText } }], usage: { prompt_tokens: 400, completion_tokens: 60 } }), { status: 200 }); }
    if (u.includes('api.groq.com/openai/v1/audio/transcriptions')) { sttCalls.push(opts.body); return new Response(JSON.stringify({ text: 'how do I make a reel' }), { status: 200 }); }
    if (u.includes('aihorde.net/api/v2/generate/text/async')) { hordeJobs.push({ body: JSON.parse(opts.body) }); return new Response(JSON.stringify({ id: 'job-1' }), { status: 202 }); }
    if (u.includes('aihorde.net/api/v2/generate/text/status')) return new Response(JSON.stringify({ done: true, generations: [{ text: '1. Open Creative Studio (horde).', model: 'm' }] }), { status: 200 });
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
const GKEY = 'gsk_' + 'a1B2c3D4e5'.repeat(4);
const PNG = 'data:image/png;base64,' + Buffer.from('x'.repeat(300)).toString('base64');

test('Groq: key, order, privacy, 429 fallback, pictures, voice and activity', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await signup('groq', 'owner@groq.test')).status, 201);
  const a = await login('groq', 'owner@groq.test');
  const ask = (question, extra = {}) => a('POST', '/api/assistant/ask', { question, ...extra });
  const q = 'reel voiceover credits limit';

  assert.deepEqual((await a('GET', '/api/assistant/capabilities')).data, { stt: false, image: false });
  assert.match((await ask(q)).data.answer, /not switched on/);

  assert.equal((await as(owner, 'PUT', '/ai/groq', { key: 'nope' })).status, 400);
  const saved = await as(owner, 'PUT', '/ai/groq', { key: GKEY });
  assert.equal(saved.status, 200); assert.equal(saved.data.key_added, true); assert.equal(saved.data.enabled, true);
  const ov = (await as(owner, 'GET', '/ai/overview')).data;
  assert.ok(!JSON.stringify(ov).includes(GKEY), 'key never returned'); assert.deepEqual(ov.technical.ask_order, ['groq', 'horde', 'gemini']);
  assert.equal(ov.technical.ask_activity.last, null);
  assert.equal((await as(owner, 'POST', '/ai/groq/test')).data.models, 2);
  assert.equal((await as(owner, 'PUT', '/ai/groq', { chat_model: 'bad model!' })).status, 400);

  const r1 = await ask(`${q} for sara@client.com 03001234567`);
  assert.equal(r1.data.intent, 'ai', JSON.stringify(r1.data)); assert.match(r1.data.answer, /Creative Studio/); assert.equal(r1.data.engine, 'groq');
  const sent = JSON.stringify(groqCalls[0].body);
  assert.equal(groqCalls[0].auth, `Bearer ${GKEY}`); assert.equal(groqCalls[0].body.model, 'llama-3.3-70b-versatile');
  assert.ok(!/sara@client|03001234567/.test(sent), 'personal data stripped'); assert.match(sent, /REFERENCE MATERIAL/);
  const row = platformDb().prepare("SELECT * FROM ai_usage WHERE provider='groq' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.feature, 'ask_assistant'); assert.equal(row.input_tokens, 400); assert.ok(row.tenant_id > 0);
  const act = (await as(owner, 'GET', '/ai/overview')).data.technical.ask_activity;
  assert.equal(act.last.provider, 'groq'); assert.ok(act.by_engine.some((e) => e.provider === 'groq' && e.ok >= 1));

  resetRateLimit(); groqStatus = 429;
  const busy = await ask(`${q} one`); assert.equal(busy.data.engine, 'guide'); assert.match(busy.data.answer, /Steps from our help guide/); assert.ok(busy.data.notes.some((n) => /Groq failed/.test(n)));
  assert.equal((await as(owner, 'PUT', '/ai/horde', { key: 'HordeSecretKey_abcdef1234567890' })).status, 200);
  const fb = await ask(`${q} two`); assert.match(fb.data.answer, /horde/); assert.equal(fb.data.engine, 'horde'); assert.equal(hordeJobs.length, 1);
  groqStatus = 200;

  assert.equal((await as(owner, 'PUT', '/ai/groq', { provider_order: ['horde', 'groq', 'gemini'] })).status, 200);
  const g0 = groqCalls.length; const first = await ask(`${q} three`); assert.match(first.data.answer, /horde/); assert.equal(groqCalls.length, g0);
  assert.equal((await as(owner, 'PUT', '/ai/groq', { provider_order: ['groq', 'groq'] })).status, 400);
  await as(owner, 'PUT', '/ai/groq', { provider_order: 'groq,horde,gemini' });

  resetRateLimit();
  const pic = await ask('what does this error mean', { image: PNG });
  assert.equal(pic.data.intent, 'ai', JSON.stringify(pic.data));
  const last = groqCalls[groqCalls.length - 1].body;
  assert.equal(last.model, 'meta-llama/llama-4-scout-17b-16e-instruct'); assert.equal(last.messages[last.messages.length - 1].content[1].type, 'image_url');
  assert.equal((await ask('x', { image: 'data:text/html;base64,AAAA' })).status, 400);

  assert.deepEqual((await a('GET', '/api/assistant/capabilities')).data, { stt: true, image: true });
  const audio = Buffer.from('a'.repeat(500)).toString('base64');
  const t = await a('POST', '/api/assistant/transcribe', { audio, mime: 'audio/webm;codecs=opus', lang: 'ur' });
  assert.equal(t.status, 200); assert.equal(t.data.text, 'how do I make a reel'); assert.equal(sttCalls.length, 1);
  assert.equal((await a('POST', '/api/assistant/transcribe', { audio: 'AAAA' })).status, 400);
  assert.ok(platformDb().prepare("SELECT 1 FROM ai_usage WHERE purpose='ask_voice' AND provider='groq'").get());

  await as(owner, 'PUT', '/ai/groq', { enabled: false });
  assert.deepEqual((await a('GET', '/api/assistant/capabilities')).data, { stt: false, image: false });
  assert.equal((await a('POST', '/api/assistant/transcribe', { audio })).status, 400);
  resetRateLimit(); const n = groqCalls.length; await ask(`${q} four`); assert.equal(groqCalls.length, n);
  assert.match((await ask('what is this', { image: PNG })).data.answer, /need Groq/);
  assert.equal((await as(owner, 'DELETE', '/ai/groq/key')).data.key_added, false);
});

test('Ask understands Roman Urdu: finds the right screen, answers in that language, records why an engine failed', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  const a = await login('groq', 'owner@groq.test');
  assert.equal((await as(owner, 'PUT', '/ai/groq', { key: GKEY, enabled: true, provider_order: ['groq', 'horde', 'gemini'] })).status, 200);
  resetRateLimit();
  const question = 'me kese appointment add kar sakta hu';
  groqText = '1. Open CRM > Appointments and press New.'; // English although the question was Roman Urdu: one stricter retry
  const n = groqCalls.length;
  const r = await a('POST', '/api/assistant/ask', { question });
  assert.equal(r.data.engine, 'groq', JSON.stringify(r.data));
  assert.equal(groqCalls.length, n + 2);
  const sent = groqCalls[n].body.messages.at(-1).content;
  assert.match(sent, /Appointments/); assert.match(sent, /REPLY LANGUAGE: write the whole answer in Roman Urdu/); assert.doesNotMatch(sent, /Add Property/);
  assert.match(groqCalls[n + 1].body.messages.at(-1).content, /Do NOT answer in English/);
  assert.ok(!(r.data.sources || []).some((s) => /Add Property/.test(s)), JSON.stringify(r.data.sources));
  // an answer already in Roman Urdu is accepted at once
  groqText = 'CRM > Appointments kholen aur New dabayen, phir mulaqat ki tafseel bhar kar save karen.';
  const m = groqCalls.length; resetRateLimit();
  assert.match((await a('POST', '/api/assistant/ask', { question })).data.answer, /mulaqat/); assert.equal(groqCalls.length, m + 1);
  // a failing engine leaves its reason for the console
  groqStatus = 429; resetRateLimit();
  await a('POST', '/api/assistant/ask', { question });
  groqStatus = 200;
  const ov = (await as(owner, 'GET', '/ai/overview')).data;
  assert.match(ov.technical.ask_activity.last_errors.groq.message, /busy|rate/i);
  resetRateLimit(); await a('POST', '/api/assistant/ask', { question });
  assert.equal((await as(owner, 'GET', '/ai/overview')).data.technical.ask_activity.last_errors.groq, null);
});

test('Ask never shows a model\'s reasoning: it tries the next engine, then answers from the guide', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  const a = await login('groq', 'owner@groq.test');
  await as(owner, 'PUT', '/ai/groq', { key: GKEY, enabled: true, provider_order: ['groq', 'horde', 'gemini'] });
  const question = 'me kese appointment add kar sakta hu';
  groqText = "We need answer user's question in Roman Urdu. Need use only reference material. But material doesn't say add."; // reasoning leak
  resetRateLimit(); const h0 = hordeJobs.length;
  const r = (await a('POST', '/api/assistant/ask', { question })).data;
  assert.ok(!/We need answer/.test(r.answer), r.answer);
  assert.equal(r.engine, 'horde'); assert.ok(r.notes.some((n) => /Groq gave an unusable reply/.test(n)), JSON.stringify(r.notes));
  assert.equal(hordeJobs.length, h0 + 2); // the second job is the stricter language retry (the mock answers in English)
  groqText = 'Open CRM > Appointments and press New.';
  await as(owner, 'PUT', '/ai/groq', { enabled: false }); resetRateLimit();
  const noGroq = (await a('POST', '/api/assistant/ask', { question })).data;
  assert.ok(noGroq.notes.some((n) => /Groq was skipped: it is switched off/.test(n)), JSON.stringify(noGroq.notes));
});

test('console "Which model does what" lists each purpose with engine, model, state and last use', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  await as(owner, 'PUT', '/ai/groq', { key: GKEY, enabled: true, provider_order: ['groq', 'horde', 'gemini'] });
  const map = (await as(owner, 'GET', '/ai/overview')).data.technical.model_map;
  const by = Object.fromEntries(map.map((r) => [r.key, r]));
  assert.equal(by.ask_chat.engine, 'Groq → Stable Horde'); assert.equal(by.ask_chat.model, 'llama-3.3-70b-versatile'); assert.equal(by.ask_chat.on, true);
  assert.equal(by.ask_image.model, 'meta-llama/llama-4-scout-17b-16e-instruct'); assert.equal(by.ask_voice.engine, 'Groq');
  assert.ok(by.ask_chat.last && by.ask_chat.last.engine, 'last use comes from the ledger');
  assert.equal(by.ask_listen.on, true); assert.ok(by.creative_post && by.video_voice_ur && by.zernio);
  await as(owner, 'PUT', '/ai/groq', { enabled: false });
  const off = Object.fromEntries((await as(owner, 'GET', '/ai/overview')).data.technical.model_map.map((r) => [r.key, r]));
  assert.equal(off.ask_chat.engine, 'Stable Horde'); assert.equal(off.ask_image.on, false); assert.equal(off.ask_voice.engine, 'Browser microphone');
});

test('console can test each engine alone: no fallback, shows answer, model, time and the error', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  await as(owner, 'PUT', '/ai/groq', { key: GKEY, enabled: true, provider_order: ['horde', 'groq', 'gemini'] });
  const gBefore = groqCalls.length, hBefore = hordeJobs.length;
  groqText = '1. Open CRM > Appointments and press New.'; groqStatus = 200;
  const g = (await as(owner, 'POST', '/ai/ask-engine/test', { engine: 'groq' })).data;
  assert.equal(g.ok, true); assert.match(g.answer, /Appointments/); assert.equal(g.model, 'llama-3.3-70b-versatile'); assert.ok(g.ms >= 0);
  assert.equal(groqCalls.length, gBefore + 1); assert.equal(hordeJobs.length, hBefore, 'Horde is not asked when testing Groq');
  groqStatus = 429;
  const bad = (await as(owner, 'POST', '/ai/ask-engine/test', { engine: 'groq' })).data;
  assert.equal(bad.ok, false); assert.match(bad.error, /busy|rate/i); assert.equal(hordeJobs.length, hBefore, 'no fallback to Horde');
  groqStatus = 200; groqText = "We need answer user's question. Need use only reference material.";
  const leak = (await as(owner, 'POST', '/ai/ask-engine/test', { engine: 'groq' })).data;
  assert.equal(leak.ok, false); assert.match(leak.error, /reasoning/);
  groqText = '1. Open CRM > Appointments.';
  const none = (await as(owner, 'POST', '/ai/ask-engine/test', { engine: 'gemini' })).data;
  assert.equal(none.ok, false); assert.match(none.error, /No Gemini key/);
  assert.equal((await as(owner, 'POST', '/ai/ask-engine/test', { engine: 'bogus' })).status, 400);
  await as(owner, 'PUT', '/ai/groq', { provider_order: ['groq', 'horde', 'gemini'] });
});

test('console engine switches: an engine that is off is never called, even as a backup; "use only" keeps one on', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  const a = await login('groq', 'owner@groq.test');
  const ask = (question) => a('POST', '/api/assistant/ask', { question });
  await as(owner, 'PUT', '/ai/groq', { key: GKEY, provider_order: ['groq', 'horde', 'gemini'] });
  const r = await as(owner, 'PUT', '/ai/ask-engines', { only: 'groq' });
  assert.equal(r.status, 200);
  let t = (await as(owner, 'GET', '/ai/overview')).data.technical;
  assert.equal(t.groq.enabled, true); assert.equal(t.stablehorde.enabled, false); assert.equal(t.stablehorde.gemini_enabled, false);
  // Groq busy: Horde must NOT be used as a backup while switched off
  groqStatus = 429; resetRateLimit(); const h0 = hordeJobs.length;
  await ask('How do I add a lead to the pipeline now?');
  assert.equal(hordeJobs.length, h0, 'Horde is off so it is never called');
  const tested = (await as(owner, 'POST', '/ai/ask-engine/test', { engine: 'horde' })).data;
  assert.equal(tested.ok, false); assert.equal(hordeJobs.length, h0);
  // switch Horde back on alone: it works again
  groqStatus = 200;
  assert.equal((await as(owner, 'PUT', '/ai/ask-engines', { horde: true })).status, 200);
  t = (await as(owner, 'GET', '/ai/overview')).data.technical;
  assert.equal(t.stablehorde.enabled, true); assert.equal(t.groq.enabled, true);
  assert.equal((await as(owner, 'PUT', '/ai/ask-engines', { only: 'bogus' })).status, 400);
  await as(owner, 'PUT', '/ai/ask-engines', { groq: true, horde: true, gemini: false });
});
