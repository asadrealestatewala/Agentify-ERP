import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Reported (flagged) AI answers: a workspace member reports, the console reviews.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-flag-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
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
}).then(async () => { owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie; assert.equal((await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'flg', company_name: 'Flg Realty', admin_name: 'Owner', admin_email: 'owner@flg.test', admin_password: 'Tenant@12345', region: 'PK' })).status, 201); }));
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


const login = async () => { const l = await call('flg.erp.test', 'POST', '/api/auth/login', { identifier: 'owner@flg.test', password: 'Tenant@12345' }); assert.equal(l.status, 200); return (m, u, b) => call('flg.erp.test', m, u, b, { cookie: l.cookie }); };

test('a member reports an AI suggestion and the console reviews it', async () => {
  const me = await login();
  assert.equal((await me('POST', '/api/ai-flags', { feature: 'property_writer', output: 'x', reason: 'bogus' })).status, 400, 'reason must be one of the list');
  assert.equal((await me('POST', '/api/ai-flags', { feature: 'property_writer', output: '  ', reason: 'wrong' })).status, 400, 'needs text');
  assert.equal((await call('flg.erp.test', 'POST', '/api/ai-flags', { feature: 'property_writer', output: 'x', reason: 'wrong' })).status, 401, 'sign-in required');
  assert.equal((await me('POST', '/api/ai-flags', { feature: 'property_writer', output: 'Sea view villa with a private airport.', reason: 'wrong', note: 'There is no airport' })).status, 201);
  let q = (await as('GET', '/ai/flags')).data;
  assert.equal(q.open, 1); assert.equal(q.rows[0].slug, 'flg'); assert.equal(q.rows[0].feature_label, 'Property writer'); assert.match(q.rows[0].output, /airport/);
  const id = q.rows[0].id;
  assert.equal((await as('PUT', '/ai/flags/' + id, { status: 'nonsense' })).status, 400);
  assert.equal((await as('PUT', '/ai/flags/' + id, { status: 'reviewed', resolution: 'Prompt tightened' })).data.status, 'reviewed');
  q = (await as('GET', '/ai/flags?status=open')).data;
  assert.equal(q.open, 0); assert.equal(q.rows.length, 0, 'open filter hides reviewed');
  assert.equal((await as('GET', '/ai/flags?status=reviewed')).data.rows.length, 1);
  assert.equal((await as('PUT', '/ai/flags/' + id, { status: 'open' })).data.status, 'open');
});
