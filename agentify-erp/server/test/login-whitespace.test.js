import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-loginws-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_DEMO = '0';
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { createTenant, withTenant } = await import('../src/platform.js');
const { get, run } = await import('../src/db.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const post = (host, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path: '/api/auth/login', method: 'POST', headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', 'Content-Length': Buffer.byteLength(data) } }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
  req.on('error', reject); req.write(data); req.end();
});

test('an owner email typed with stray spaces at sign-up can still sign in', async () => {
  const t = createTenant({ slug: 'umair', name: 'Umair Testing', adminName: 'Umair', adminEmail: '  Umair@Example.com  ', adminPassword: 'Secret@12345' });
  const owner = withTenant(t, () => get('SELECT email FROM users ORDER BY id LIMIT 1'));
  assert.equal(owner.email, 'umair@example.com');
  for (const id of ['umair@example.com', ' Umair@Example.com ']) {
    const r = await post('umair.erp.test', { identifier: id, password: 'Secret@12345' });
    assert.equal(r.status, 200, id);
  }
});

test('accounts already saved with spaces around the email still sign in', async () => {
  const t = createTenant({ slug: 'old', name: 'Old Co', adminName: 'Old', adminEmail: 'old@example.com', adminPassword: 'Secret@12345' });
  withTenant(t, () => run("UPDATE users SET email=' old@example.com ' WHERE id=(SELECT MIN(id) FROM users)"));
  const r = await post('old.erp.test', { identifier: 'old@example.com', password: 'Secret@12345' });
  assert.equal(r.status, 200);
});
