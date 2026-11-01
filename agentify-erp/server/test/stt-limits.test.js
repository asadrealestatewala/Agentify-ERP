import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Speech-to-text (call and meeting transcripts) is metered and limited like other workspace AI.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-stt-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const { transcribe } = await import('../src/integrations/ai.js');
const { saveIntegration } = await import('../src/integrations/store.js');
const { getTenantBySlug, withTenant } = await import('../src/platform.js');
const dbm = await import('../src/db.js');

let server, port, whisperCalls = 0;
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('api.openai.com/v1/audio/transcriptions')) { whisperCalls += 1; return new Response('hello world', { status: 200 }); }
    throw new Error(`unexpected fetch ${u}`);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}).then(async () => { owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie; assert.equal((await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'stt', company_name: 'Stt Realty', admin_name: 'Owner', admin_email: 'owner@stt.test', admin_password: 'Tenant@12345', region: 'PK' })).status, 201); }));
after(async () => { globalThis.fetch = realFetch; server.close(); dbm.closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const A = '/api/platform/admin';
let owner;
const as = (method, url, body) => call('erp.test', method, `${A}${url}`, body, { cookie: owner });

test('transcripts are counted, can be switched off, and have their own daily limit', async () => {
  const t = getTenantBySlug('stt');
  withTenant(t, () => saveIntegration('ai_openai', { api_key: `sk-${'k'.repeat(30)}`, model: 'm' }, { publicInfo: {}, status: 'connected', userId: null }));
  const run = () => withTenant(t, () => transcribe(Buffer.from('abc'), 'a.mp3'));
  assert.equal(await run(), 'hello world');
  let c = (await as('GET', '/ai/controls')).data;
  assert.equal(c.features.find((f) => f.key === 'speech_to_text').calls, 1, 'metered as one call');

  await as('PUT', '/ai/controls', { features: { speech_to_text: false } });
  const before = whisperCalls;
  await assert.rejects(run, /switched off at the moment/); assert.equal(whisperCalls, before, 'blocked before the provider is called');
  await as('PUT', '/ai/controls', { features: { speech_to_text: true } });

  assert.equal((await as('PUT', '/ai/workspaces/' + t.id, { stt_daily_limit: 2 })).data.stt_daily_limit, 2);
  assert.equal(await run(), 'hello world');
  await assert.rejects(run, /used its 2 transcripts/);
  assert.equal((await as('PUT', '/ai/controls', { default_stt_daily_limit: 'abc' })).status, 400);
  await as('PUT', '/ai/workspaces/' + t.id, { stt_daily_limit: '' });
  assert.equal(await run(), 'hello world', 'cleared limit allows transcripts again');
});
