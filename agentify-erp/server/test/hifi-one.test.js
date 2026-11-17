import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-hifi-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_PK_ACCOUNTS', 'ERP_PLATFORM_ADMIN_TOKEN']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { createTenant, platformDb } = await import('../src/platform.js');
const { hifiStatus } = await import('../src/services/hifiOne.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}, raw) => new Promise((resolve, reject) => {
  const data = raw ?? (body ? JSON.stringify(body) : null);
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, text: t, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
let cookie;
const adm = (method, url, body, extra = {}) => call(P, method, `/api/platform/admin${url}`, body, { cookie, ...extra });

const read = (key, host = P, q = '') => call(host, 'GET', `/api/hifi-one/summary${q}`, null, key ? { Authorization: `Bearer ${key}` } : {});

test('Hifi One status words map from billing states', () => {
  assert.equal(hifiStatus('trialing'), 'TRIAL'); assert.equal(hifiStatus('pending'), 'TRIAL');
  assert.equal(hifiStatus('active'), 'LIVE'); assert.equal(hifiStatus('past_due'), 'OVERDUE');
  assert.equal(hifiStatus('suspended'), 'SUSPENDED'); assert.equal(hifiStatus('expired'), 'SUSPENDED'); assert.equal(hifiStatus('canceled'), 'CANCELLED');
});

test('Hifi One key: made in the console, shown once, hash only; summary needs it and shares counts only', async () => {
  createTenant({ slug: 'acme', name: 'Acme Homes', adminName: 'Owner', adminEmail: 'o@acme.test', adminPassword: 'Secret@123' });
  const ok = await call(P, 'POST', '/api/platform/admin/login', { email: 'admin@agentify.test', password: 'Console@12345' });
  cookie = ok.cookie;
  assert.equal((await call(P, 'POST', '/api/platform/admin/hifi-one/key', {})).status, 401, 'console sign-in required');
  assert.equal((await read(null)).status, 401, 'no key, no summary');
  assert.equal((await read('agt_hifi_whatever')).status, 401, 'nothing works before a key is made');
  assert.equal((await adm('GET', '/hifi-one')).data.set, false);

  const made = (await adm('POST', '/hifi-one/key', {})).data;
  assert.match(made.key, /^agt_hifi_/);
  assert.equal(made.hint, made.key.slice(-4));
  const stored = platformDb().prepare("SELECT value FROM platform_settings WHERE key='hifi_one_key'").get().value;
  assert.ok(!stored.includes(made.key), 'only the hash is stored');
  const state = (await adm('GET', '/hifi-one')).data;
  assert.equal(state.set, true); assert.equal(state.key, undefined, 'the key is never shown again');

  assert.equal((await read(made.key, 'acme.erp.test')).status, 404, 'platform domain only');
  assert.equal((await read(`${made.key}x`)).status, 401);
  const r = await read(made.key);
  assert.equal(r.status, 200, r.text);
  const w = r.data.workspaces.find((x) => x.id === 'acme');
  assert.ok(w, 'workspace listed');
  assert.equal(w.name, 'Acme Homes'); assert.equal(w.status, 'TRIAL'); assert.equal(w.activeUsers, 1);
  assert.deepEqual(Object.keys(w).sort(), ['activeUsers', 'id', 'lastActivityAt', 'name', 'paidUntil', 'plan', 'status']);
  assert.equal(r.data.next, null);
  assert.ok(!r.data.workspaces.some((x) => x.id === 'legacy' || x.id === undefined));
  assert.ok((await adm('GET', '/hifi-one')).data.last_read_at, 'last read time recorded');

  const again = (await adm('POST', '/hifi-one/key', {})).data;
  assert.equal((await read(made.key)).status, 401, 'a new key stops the old one');
  assert.equal((await read(again.key)).status, 200);
  assert.equal((await adm('DELETE', '/hifi-one/key')).data.set, false);
  assert.equal((await read(again.key)).status, 401, 'removed key stops working');
  const actions = platformDb().prepare("SELECT action FROM platform_audit WHERE action LIKE 'hifi-one-%'").all().map((a) => a.action);
  assert.deepEqual(actions, ['hifi-one-key-made', 'hifi-one-key-made', 'hifi-one-key-removed']);
});
