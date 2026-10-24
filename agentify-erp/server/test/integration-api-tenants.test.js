// A website key only works on the workspace that made it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-v1t-'));
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
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

async function workspace(slug) {
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: `owner@${slug}.test`, admin_password: 'Tenant@12345', region: 'US', sub_region: 'Texas' });
  assert.equal(su.status, 201, JSON.stringify(su.data));
  const host = `${slug}.erp.test`;
  const l = await call(host, 'POST', '/api/auth/login', { identifier: `owner@${slug}.test`, password: 'Tenant@12345' });
  return { host, cookie: l.cookie };
}

test('a key made in one workspace is refused in another and leads stay in their own workspace', async () => {
  setRegionStatus(platformDb(), 'US', 'active', 'tester');
  const a = await workspace('alpha');
  const b = await workspace('bravo');
  const made = await call(a.host, 'POST', '/api/website-integrations/connections', { name: 'Alpha site', scopes: ['leads:write', 'listings:read'] }, { cookie: a.cookie });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const key = made.data.key;
  const auth = { Authorization: `Bearer ${key}` };
  assert.equal((await call(a.host, 'GET', '/api/v1/ping', null, auth)).status, 200);
  const other = await call(b.host, 'GET', '/api/v1/ping', null, auth);
  assert.equal(other.status, 401);
  assert.equal(other.data.error.code, 'invalid_key');
  const lead = await call(a.host, 'POST', '/api/v1/leads', { name: 'Sara Khan', phone: '+1 415 555 0142', message: 'Hello' }, { ...auth, 'Idempotency-Key': crypto.randomUUID() });
  assert.equal(lead.status, 201, JSON.stringify(lead.data));
  const inA = await call(a.host, 'GET', '/api/contacts?q=Sara', null, { cookie: a.cookie });
  const inB = await call(b.host, 'GET', '/api/contacts?q=Sara', null, { cookie: b.cookie });
  assert.ok(JSON.stringify(inA.data).includes('Sara Khan'));
  assert.ok(!JSON.stringify(inB.data).includes('Sara Khan'));
});
