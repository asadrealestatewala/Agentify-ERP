import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Field location across workspaces: each workspace has its own database, settings and consent, and a sign-in from one
// workspace can never submit or read locations in another.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-field-tenancy-'));
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
const signup = (slug, email, extra = {}) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', ...extra });
async function login(host, identifier) {
  const l = await call(host, 'POST', '/api/auth/login', { identifier, password: 'Tenant@12345' });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const c = l.cookie;
  return { c, me: l.data, get: (u) => call(host, 'GET', u, null, { cookie: c }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }), put: (u, b) => call(host, 'PUT', u, b, { cookie: c }) };
}
const reading = () => ({ lat: 25.2048, lng: 55.2708, accuracy: 12, captured_at: new Date().toISOString() });

test('settings, consent and locations stay inside their own workspace', async () => {
  assert.equal((await signup('dxbhomes', 'owner@dxb.test', { currency: 'AED', timezone: 'Asia/Dubai' })).status, 201);
  assert.equal((await signup('torontohomes', 'owner@tor.test', { currency: 'CAD', timezone: 'America/Toronto' })).status, 201);
  const a = await login('dxbhomes.erp.test', 'owner@dxb.test');
  const b = await login('torontohomes.erp.test', 'owner@tor.test');

  const s = await a.put('/api/field/settings', { enabled: true });
  assert.equal(s.status, 200);
  assert.equal((await b.get('/api/field/settings')).data.enabled, false, 'enabling in one workspace does not enable another');
  assert.equal((await a.post('/api/field/me/consent', { notice_version: s.data.notice_version })).status, 200);
  assert.equal((await a.post('/api/field/me/location', reading())).status, 200);

  const teamA = await a.get('/api/field/team');
  assert.ok(teamA.data.agents.some((x) => x.user_id === a.me.id && x.location));
  const teamB = await b.get('/api/field/team');
  assert.ok(teamB.data.agents.every((x) => !x.location), 'no locations leak into the other workspace');
  assert.equal((await b.get('/api/field/me')).data.consent.accepted, false);

  // a cookie from workspace A presented on workspace B is not a session there
  const cross = await call('torontohomes.erp.test', 'POST', '/api/field/me/location', reading(), { cookie: a.c });
  assert.equal(cross.status, 401);
  const crossRead = await call('torontohomes.erp.test', 'GET', '/api/field/team', null, { cookie: a.c });
  assert.equal(crossRead.status, 401);
});
