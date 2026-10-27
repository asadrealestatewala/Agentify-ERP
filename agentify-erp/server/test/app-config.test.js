import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-appcfg-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';

test('the phone app configuration is public, has safe defaults and changes only from the console', async () => {
  const pub = await call(P, 'GET', '/api/platform/app-config');
  assert.equal(pub.status, 200);
  assert.equal(pub.data.appName, 'Agentify ERP');
  assert.match(pub.data.light.chrome, /^#[0-9a-f]{6}$/i);
  assert.equal(pub.data.update.min, 0, 'nobody is forced to update by default');

  assert.equal((await call(P, 'PUT', '/api/platform/admin/app-config', { insets: 'web' })).status, 401, 'console only');
  const login = await call(P, 'POST', '/api/platform/admin/login', { email: 'admin@agentify.test', password: 'Console@12345' });
  const cookie = login.cookie; assert.ok(cookie);
  const put = (b) => call(P, 'PUT', '/api/platform/admin/app-config', b, { cookie });

  assert.equal((await put({ light: { chrome: 'red' } })).status, 400, 'colours must be hex');
  assert.equal((await put({ update: { url: 'http://x.test/app.apk' } })).status, 400, 'update link must be https');
  assert.equal((await put({ update: { min: 5, latest: 3 } })).status, 400, 'latest cannot be below the minimum');
  assert.equal((await put({ insets: 'sideways' })).status, 400);

  const ok = await put({ appName: 'Agentify', dark: { chrome: '#101820' }, update: { min: 3, latest: 4, message: 'Please update' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const again = await call(P, 'GET', '/api/platform/app-config');
  assert.equal(again.data.appName, 'Agentify');
  assert.equal(again.data.dark.chrome, '#101820');
  assert.equal(again.data.light.background, '#f4f9f7', 'untouched fields keep their value');
  assert.deepEqual([again.data.update.min, again.data.update.latest, again.data.update.message], [3, 4, 'Please update']);
});
