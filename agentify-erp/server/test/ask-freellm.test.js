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
let server, port, flCalls = [], flMode = 'ok', geminiMode = 'ok', gemCalls = 0;
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 280 } }), { status: 200 });
    if (u.includes('localhost:3001/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'a' }] }), { status: 200 });
    if (u.includes('localhost:3001/v1/chat/completions')) {
      flCalls.push(JSON.parse(opts.body));
      if (flMode === 'down') throw new Error('connect ECONNREFUSED');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Open Settings > Company and press Save. (free)' } }], usage: { prompt_tokens: 5, completion_tokens: 7 } }), { status: 200, headers: { 'x-routed-via': 'groq/llama-free' } });
    }
    if (u.includes(':generateContent')) { gemCalls++; if (geminiMode === 'fail') return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ found: true, answer: 'Booking money is refundable within 14 days (gemini).' }) }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } }), { status: 200 }); }
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


const FLKEY = 'freellmapi-' + 'a1B2c3D4e5'.repeat(3);
const NOTE = 'Refund policy: booking money is refundable within 14 days of payment.';
const Q = 'what is your refund policy for booking money';
const GKEY2 = 'AIza' + 'x'.repeat(35);

test('FreeLLMAPI: workspace data switches, fallback rules, metering and friendly failures', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await signup('fla', 'owner@fla.test')).status, 201);
  assert.equal((await signup('flb', 'owner@flb.test')).status, 201);
  const a = await login('fla', 'owner@fla.test'), b = await login('flb', 'owner@flb.test');
  for (const t of [a, b]) await t('PUT', '/api/settings/system', { ask_business_notes: NOTE });
  const ids = Object.fromEntries(platformDb().prepare("SELECT slug,id FROM tenants WHERE slug IN ('fla','flb')").all().map((r) => [r.slug, r.id]));
  // Gemini is the only normal engine here, so a Gemini failure leaves FreeLLMAPI as the fallback
  setSetting('platform_gemini_key', GKEY2, { secret: true }); setSetting('ask_gemini_enabled', '1');
  const ask = (t, question = Q) => { resetRateLimit(); return t('POST', '/api/assistant/ask', { question }); };

  // the key is stored in the console and never returned
  assert.equal((await as(owner, 'PUT', '/ai/freellm', { key: 'bad key' })).status, 400);
  const saved = (await as(owner, 'PUT', '/ai/freellm', { key: FLKEY, enabled: true })).data;
  assert.equal(saved.key_added, true); assert.equal(saved.key_from, 'console'); assert.ok(!JSON.stringify(saved).includes(FLKEY));
  assert.equal((await as(owner, 'POST', '/ai/freellm/test')).data.models, 1);

  // Gemini works: it answers, FreeLLMAPI is not called for a question that holds workspace data
  geminiMode = 'ok'; flCalls = [];
  let r = (await ask(a)).data; assert.equal(r.engine, 'gemini', JSON.stringify(r)); assert.equal(flCalls.length, 0);

  // switch OFF: Gemini fails, FreeLLMAPI is only a fallback and sees NO workspace data
  geminiMode = 'fail'; flCalls = [];
  r = (await ask(a)).data; assert.equal(r.engine, 'freellmapi', JSON.stringify(r));
  assert.ok(flCalls.length >= 1);
  assert.ok(!JSON.stringify(flCalls).includes('refundable within 14 days'), 'workspace notes must not leave while the switch is off');

  // turning ON needs the confirm tick; the audit log records who and when
  assert.equal((await as(owner, 'PUT', `/ai/freellm/workspaces/${ids.fla}`, { on: true })).status, 400);
  const on = (await as(owner, 'PUT', `/ai/freellm/workspaces/${ids.fla}`, { on: true, confirm: true })).data;
  assert.equal(on.on, true); assert.match(on.by, /agentify\.test/i);
  assert.ok(platformDb().prepare("SELECT 1 FROM platform_audit WHERE action='freellm-tenant-data-on'").get());
  flCalls = []; r = (await ask(a)).data; assert.equal(r.engine, 'freellmapi');
  assert.ok(JSON.stringify(flCalls).includes('refundable within 14 days'), 'A has agreed: its own data may go');
  // B is unaffected, and A's text is never in B's request
  flCalls = []; r = (await ask(b)).data; assert.equal(r.engine, 'freellmapi');
  assert.ok(!JSON.stringify(flCalls).includes('refundable within 14 days'));
  assert.equal((await as(owner, 'GET', `/ai/freellm/workspaces/${ids.flb}`)).data.on, false);
  // the workspace admin can see that it is on
  assert.equal((await a('GET', '/api/assistant/extra-ai')).data.on, true);
  assert.equal((await b('GET', '/api/assistant/extra-ai')).data.on, false);

  // master switch overrides everything
  await as(owner, 'PUT', '/ai/freellm', { tenant_data_master_off: true });
  flCalls = []; await ask(a);
  assert.ok(!JSON.stringify(flCalls).includes('refundable within 14 days'));
  assert.equal((await a('GET', '/api/assistant/extra-ai')).data.on, false);
  await as(owner, 'PUT', '/ai/freellm', { tenant_data_master_off: false });

  // the gateway itself refuses data for a workspace that has not agreed
  const { freellmChat } = await import('../src/services/freellmGateway.js');
  await assert.rejects(freellmChat({ messages: [{ role: 'user', content: 'x' }], tenantId: ids.flb, tenantData: true }), /not allowed to leave/);

  // chat switched off: never called
  await as(owner, 'PUT', '/ai/freellm', { features: { chat: false } });
  geminiMode = 'fail'; flCalls = []; r = (await ask(a)).data; assert.equal(flCalls.length, 0); assert.notEqual(r.engine, 'freellmapi');
  await as(owner, 'PUT', '/ai/freellm', { features: { chat: true } });

  // FreeLLMAPI down: a friendly answer, no raw error, no crash
  flMode = 'down'; geminiMode = 'fail';
  const down = await ask(a); assert.equal(down.status, 200);
  assert.ok(!/ECONNREFUSED/.test(JSON.stringify(down.data)), JSON.stringify(down.data));
  flMode = 'ok';

  // metering: each call is a row with the model that answered and zero cost
  const rows = platformDb().prepare("SELECT model, usd, pkr FROM ai_usage WHERE provider='freellmapi' AND ok=1").all();
  assert.ok(rows.length >= 2); assert.ok(rows.every((x) => x.model === 'groq/llama-free' && x.usd === 0 && (x.pkr == null || x.pkr === 0)));

  // master FreeLLMAPI off: not called at all
  await as(owner, 'PUT', '/ai/freellm', { enabled: false });
  flCalls = []; await ask(a); assert.equal(flCalls.length, 0);
});
