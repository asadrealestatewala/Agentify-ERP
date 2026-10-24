// AI providers (ChatGPT / Claude), data questions with tools, promo scripts and videos, call recording, transcripts and statistics.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-ai-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_DEMO = '0';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.LOGIN_LIMIT = '1000';
process.env.SIGNUP_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { setRegionStatus } = await import('../src/regions/admin.js');
const { twilioSignature } = await import('../src/integrations/twilio.js');
let server, port;
const realFetch = globalThis.fetch;
const seen = [];
const SID = `AC${'b'.repeat(32)}`;
const TOKEN = 't'.repeat(32);
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
let anthropicRound = 0;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    const body = typeof opts.body === 'string' ? opts.body : null;
    seen.push({ url: u, method: opts.method || 'GET', body, headers: opts.headers });
    if (u === 'https://api.anthropic.com/v1/models') return opts.headers['x-api-key'].endsWith('good-key-000000000000') ? J({ data: [{ id: 'm' }] }) : J({ error: { message: 'invalid x-api-key' } }, 401);
    if (u === 'https://api.openai.com/v1/models') return J({ data: [{ id: 'gpt-4o' }] });
    if (u === 'https://api.anthropic.com/v1/messages') {
      const req = JSON.parse(body);
      if (req.system.startsWith('You write short promotional')) return J({ content: [{ type: 'text', text: JSON.stringify({ title: 'Maple Street Home', scenes: [{ caption: 'Welcome to 12 Maple Street', seconds: 3, photo: 0 }, { caption: 'Three bedrooms, $425,000', seconds: 99, photo: 7 }], voiceover: 'Come and see it.', call_to_action: 'Book a viewing', hashtags: ['#home'] }) }] });
      anthropicRound += 1;
      if (anthropicRound === 1) return J({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'sales_summary', input: { by_agent: false } }] });
      const lastUser = req.messages.at(-1).content[0];
      return J({ stop_reason: 'end_turn', content: [{ type: 'text', text: `You made sales: ${lastUser.content}` }] });
    }
    if (u === 'https://api.openai.com/v1/audio/transcriptions') return new Response('Hello, this is the call transcript.', { status: 200 });
    if (u.includes('api.twilio.com') && u.endsWith(`/Accounts/${SID}.json`)) return J({ status: 'active', friendly_name: 'AI Realty' });
    if (u.includes('IncomingPhoneNumbers')) return J({ incoming_phone_numbers: [{ sid: 'PN1', capabilities: { voice: true, sms: true } }] });
    if (u.endsWith('/Calls.json')) return J({ sid: 'CA9', status: 'queued' }, 201);
    if (u.startsWith('https://api.twilio.com/2010-04-01/Accounts/') && u.includes('/Recordings/')) return new Response(Buffer.from('ID3-fake-mp3-audio-bytes'), { status: 200 });
    return J({ error: { message: 'unmocked ' + u } }, 404);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}, form = false, raw = null) => new Promise((resolve, reject) => {
  const data = raw || (body ? (form ? new URLSearchParams(body).toString() : JSON.stringify(body)) : null);
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': raw ? 'video/webm' : form ? 'application/x-www-form-urlencoded' : 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const buf = Buffer.concat(chunks); let d; try { d = JSON.parse(buf.toString()); } catch { d = buf.toString(); } resolve({ status: res.statusCode, data: d, buf, type: res.headers['content-type'], cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const HOST = 'ai.erp.test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('AI provider keys, data questions with tools, promo scripts and saved videos', async () => {
  setRegionStatus(platformDb(), 'US', 'active', 'tester');
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'ai', company_name: 'AI Realty', admin_name: 'Owner', admin_email: 'owner@ai.test', admin_password: 'Tenant@12345', region: 'US', sub_region: 'Texas' });
  assert.equal(su.status, 201, JSON.stringify(su.data));
  const l = await call(HOST, 'POST', '/api/auth/login', { identifier: 'owner@ai.test', password: 'Tenant@12345' });
  const c = l.cookie;
  const get = (u) => call(HOST, 'GET', u, null, { cookie: c });
  const post = (u, b) => call(HOST, 'POST', u, b || {}, { cookie: c });
  const put = (u, b) => call(HOST, 'PUT', u, b || {}, { cookie: c });

  assert.equal((await post('/api/integrations/ai/ask', { question: 'How are sales?' })).status, 400, 'no provider yet');
  assert.equal((await put('/api/integrations/ai/anthropic', { api_key: 'not-a-key' })).status, 400);
  assert.equal((await put('/api/integrations/ai/anthropic', { api_key: 'sk-ant-wrong-key-00000000000000' })).status, 400, 'the provider rejects it');
  const ok = await put('/api/integrations/ai/anthropic', { api_key: 'sk-ant-api03-good-key-000000000000' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const st = (await get('/api/integrations/ai')).data;
  assert.equal(st.providers.find((p) => p.id === 'anthropic').status.status, 'connected'); assert.equal(st.active, 'anthropic');
  assert.equal(JSON.stringify(st).includes('good-key-000000000000'), false, 'the key is never sent back');

  // a data question: Claude asks for sales_summary, the tool runs here, the result goes back to Claude
  assert.equal((await post('/api/contacts', { full_name: 'Buyer One', phone: '+1 512 555 0101' })).status, 201);
  const ans = await post('/api/integrations/ai/ask', { question: 'How many sales did we make this month?' });
  assert.equal(ans.status, 200, JSON.stringify(ans.data));
  assert.deepEqual(ans.data.tools_used, ['sales_summary']);
  assert.match(ans.data.answer, /"sales":0/);
  const first = JSON.parse(seen.find((x) => x.url === 'https://api.anthropic.com/v1/messages').body);
  assert.match(first.system, /USD/); assert.equal(first.tools.some((t) => t.name === 'ask_the_crm_assistant'), false, 'no customer names unless the owner allows it');
  assert.equal(seen.find((x) => x.url === 'https://api.anthropic.com/v1/messages').headers['x-api-key'], 'sk-ant-api03-good-key-000000000000');

  // promo script: clean scenes only
  const prop = await post('/api/properties', { title: '12 Maple Street', property_type: 'Single-family home', city: 'Austin', total_price: 42500000, features: { bedrooms: 3 } });
  const ps = await post('/api/integrations/ai/promo-script', { property_id: prop.data.id, style: 'friendly' });
  assert.equal(ps.status, 200, JSON.stringify(ps.data));
  assert.equal(ps.data.scenes.length, 2); assert.ok(ps.data.scenes.every((x) => x.seconds >= 2 && x.seconds <= 6), 'durations are clamped'); assert.equal(ps.data.photos, 0);

  // the rendered video is kept in the workspace and served from the public media folder
  const vid = await call(HOST, 'POST', `/api/integrations/ai/promo-videos?property_id=${prop.data.id}&title=Maple`, null, { cookie: c }, false, Buffer.alloc(4096, 7));
  assert.equal(vid.status, 201, JSON.stringify(vid.data));
  const served = await call(HOST, 'GET', vid.data.url);
  assert.equal(served.status, 200); assert.equal(served.buf.length, 4096);
  assert.equal((await get('/api/integrations/ai/promo-videos')).data.length, 1);

  // disconnecting removes the key
  assert.equal((await call(HOST, 'DELETE', '/api/integrations/ai/anthropic', null, { cookie: c })).status, 200);
  assert.equal((await get('/api/integrations/ai')).data.active, null);
});

test('call recording: notice, signed hook, download, transcript with OpenAI, audio playback and statistics', async () => {
  const l = await call(HOST, 'POST', '/api/auth/login', { identifier: 'owner@ai.test', password: 'Tenant@12345' });
  const c = l.cookie;
  const get = (u) => call(HOST, 'GET', u, null, { cookie: c });
  const post = (u, b) => call(HOST, 'POST', u, b || {}, { cookie: c });
  const put = (u, b) => call(HOST, 'PUT', u, b || {}, { cookie: c });

  assert.equal((await put('/api/integrations/twilio', { account_sid: SID, auth_token: TOKEN, phone_number: '+14155550100' })).status, 200);
  assert.equal((await put('/api/integrations/ai/openai', { api_key: 'sk-proj-abcdefghijklmnopqrstuvwxyz' })).status, 200);
  const set = (await get('/api/integrations/calls-settings')).data;
  assert.equal(set.record, false, 'recording is off until the owner turns it on'); assert.equal(set.ai_transcripts, true);
  assert.equal((await put('/api/integrations/calls-settings', { record: true, announcement: '   ' })).status, 200, 'a blank notice falls back to the default');
  assert.match((await get('/api/integrations/calls-settings')).data.announcement, /may be recorded/);

  const contacts = (await get('/api/contacts')).data; const cid = (Array.isArray(contacts) ? contacts : contacts.items || contacts.rows)[0].id;
  const started = await post('/api/integrations/calls', { contact_id: cid, agent_number: '+14155550199' });
  assert.equal(started.status, 201, JSON.stringify(started.data)); const callId = started.data.id;

  const bridge = `/api/hooks/twilio/bridge?call=${callId}`;
  const bp = { CallSid: 'CA9' };
  const twiml = await call(HOST, 'POST', bridge, bp, { 'X-Twilio-Signature': twilioSignature(TOKEN, `http://${HOST}${bridge}`, bp) }, true);
  assert.match(twiml.data, /<Say>This call may be recorded for quality and training\.<\/Say>/); assert.match(twiml.data, /record="record-from-answer-dual"/); assert.match(twiml.data, /recordingStatusCallback="http:\/\/ai\.erp\.test\/api\/hooks\/twilio\/recording\?call=/);

  const rp = `/api/hooks/twilio/recording?call=${callId}`;
  const params = { RecordingStatus: 'completed', RecordingSid: 'RE1', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/' + SID + '/Recordings/RE1', RecordingDuration: '61' };
  assert.equal((await call(HOST, 'POST', rp, params, {}, true)).status, 403, 'unsigned');
  assert.equal((await call(HOST, 'POST', rp, params, { 'X-Twilio-Signature': twilioSignature(TOKEN, `http://${HOST}${rp}`, params) }, true)).status, 204);
  for (let i = 0; i < 30; i += 1) { const list = (await get('/api/integrations/recordings/calls')).data; if (list[0]?.transcript_status === 'done') break; await wait(100); }
  const list = (await get('/api/integrations/recordings/calls')).data;
  assert.equal(list.length, 1); assert.equal(list[0].has_audio, 1); assert.equal(list[0].transcript_status, 'done'); assert.match(list[0].excerpt, /call transcript/);
  const cf = async (qs) => (await get(`/api/integrations/recordings/calls?${qs}`)).data;
  assert.equal((await cf('q=transcript')).length, 1, 'keyword in what was said');
  assert.equal((await cf('q=mortgage')).length, 0);
  assert.equal((await cf('transcript=ready')).length, 1); assert.equal((await cf('transcript=none')).length, 0);
  assert.equal((await cf('min_minutes=1')).length, 1, '61 seconds');
  assert.equal((await cf('min_minutes=2')).length, 0);
  const cday = list[0].created_at.slice(0, 10);
  assert.equal((await cf(`from=${cday}&to=${cday}`)).length, 1); assert.equal((await cf('from=2999-01-01')).length, 0);
  assert.equal((await cf('customer=zzzz')).length, 0);
  const detail = (await get(`/api/integrations/recordings/calls/${list[0].id}`)).data;
  assert.equal(detail.transcript, 'Hello, this is the call transcript.'); assert.equal(detail.path, undefined, 'server paths are not exposed');
  const audio = await call(HOST, 'GET', `/api/integrations/recordings/calls/${list[0].id}/audio`, null, { cookie: c });
  assert.equal(audio.status, 200); assert.match(audio.type, /audio\/mpeg/); assert.equal(audio.buf.toString(), 'ID3-fake-mp3-audio-bytes');
  assert.equal((await call(HOST, 'GET', `/api/integrations/recordings/calls/${list[0].id}/audio`)).status, 401, 'sign-in needed');

  // statistics for the board
  const stp = { CallStatus: 'completed', CallDuration: '61' };
  const sp = `/api/hooks/twilio/status?call=${callId}`;
  await call(HOST, 'POST', sp, stp, { 'X-Twilio-Signature': twilioSignature(TOKEN, `http://${HOST}${sp}`, stp) }, true);
  const stats = (await get('/api/integrations/dialer/stats?range=7d')).data;
  assert.equal(stats.calls, 1); assert.equal(stats.connected, 1); assert.equal(stats.avg_duration, 61); assert.equal(stats.recordings, 1); assert.equal(stats.connect_rate, 100);

  // scripts: the starter script is created, filled with the lead's and agent's names
  const scripts = (await get('/api/integrations/scripts')).data;
  assert.ok(scripts.length >= 1);
  const rendered = (await get(`/api/integrations/scripts/${scripts[0].id}/render?contact_id=${cid}`)).data;
  assert.match(rendered.text, /Hello Buyer One, this is .* from AI Realty/);
  assert.equal((await post('/api/integrations/scripts', { name: 'Follow-up', body: 'Hi {{contact.name}}, following up.' })).status, 201);
});

test('Gemini connects with a real test, answers with data tools and transcribes', async () => {
  const { connectAi, runWithTools, transcribe, canTranscribe } = await import('../src/integrations/ai.js');
  const { run } = await import('../src/db.js');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (String(url).includes('/models?')) return ok({ models: [{ name: 'models/gemini-2.5-flash' }] });
    const n = calls.filter((c) => c.url.includes(':generateContent')).length;
    if (calls.at(-1).body?.contents?.[0]?.parts?.[1]?.inline_data) return ok({ candidates: [{ content: { parts: [{ text: 'Speaker 1: hello' }] } }] });
    if (n === 1) return ok({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'ping', args: { x: 1 } } }] } }] });
    return ok({ candidates: [{ content: { role: 'model', parts: [{ text: 'pong answer' }] } }] });
  };
  try {
    await assert.rejects(connectAi('gemini', { api_key: 'nope' }, 1), /AIza/);
    await connectAi('gemini', { api_key: 'AQ.' + 'a'.repeat(35) }, 1);
    assert.equal(canTranscribe(), true);
    const out = await runWithTools('gemini', { system: 's', question: 'q', tools: [{ name: 'ping', description: 'd', parameters: { type: 'object', additionalProperties: false, properties: {} }, run: async () => ({ ok: true }) }] });
    assert.equal(out.answer, 'pong answer');
    assert.deepEqual(out.tools_used, ['ping']);
    const sent = calls.find((c) => c.body?.tools);
    assert.equal(sent.headers['x-goog-api-key'].startsWith('AQ.'), true);
    assert.equal(JSON.stringify(sent.body.tools).includes('additionalProperties'), false);
    assert.equal(await transcribe(Buffer.from('abc'), 'a.mp3'), 'Speaker 1: hello');
  } finally { globalThis.fetch = realFetch; }
});

test('any OpenAI-compatible model connects with a real test request and answers', async () => {
  const { connectAi, runWithTools, completeJson } = await import('../src/integrations/ai.js');
  const seenCalls = [];
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    seenCalls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(connectAi('custom', { api_key: 'k'.repeat(20), base_url: 'http://example.com/v1', model: 'm' }, 1), /https/);
    await assert.rejects(connectAi('custom', { api_key: 'k'.repeat(20), base_url: 'https://10.0.0.5/v1', model: 'm' }, 1), /Internal/);
    await assert.rejects(connectAi('custom', { api_key: 'k'.repeat(20), base_url: 'https://8.8.8.8/v1' }, 1), /model/);
    await connectAi('custom', { api_key: 'k'.repeat(20), base_url: 'https://8.8.8.8/v1/', model: 'llama-x' }, 1);
    assert.equal(seenCalls[0].url, 'https://8.8.8.8/v1/chat/completions');
    const out = await runWithTools('custom', { system: 's', question: 'q' });
    assert.equal(out.answer, '{"ok":true}');
    assert.deepEqual(await completeJson('custom', { system: 's', prompt: 'p' }), { ok: true });
    assert.equal(seenCalls.at(-1).body.response_format, undefined);
  } finally { globalThis.fetch = realFetch2; }
});
