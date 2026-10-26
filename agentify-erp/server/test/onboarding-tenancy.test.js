import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Onboarding checklists across two workspaces: each workspace has its own database, and a session from one is useless
// on the other.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-onbten-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1' });

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
const signup = (slug, email, extra = {}) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', ...extra });
async function login(host, identifier) {
  const l = await call(host, 'POST', '/api/auth/login', { identifier, password: 'Tenant@12345' });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  return { c: l.cookie, get: (u) => call(host, 'GET', u, null, { cookie: l.cookie }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: l.cookie }) };
}

test('onboarding data and sessions stay inside their workspace; each uses its own timezone and weekend', async () => {
  assert.equal((await signup('onba', 'owner@onba.test', { region: 'AE', timezone: 'Asia/Dubai', currency: 'AED' })).status, 201);
  assert.equal((await signup('onbb', 'owner@onbb.test', { region: 'US', timezone: 'America/Los_Angeles', currency: 'USD' })).status, 201);
  const a = await login('onba.erp.test', 'owner@onba.test');
  const b = await login('onbb.erp.test', 'owner@onbb.test');
  const emp = await a.post('/api/hrm/employees', { name: 'Layla Hassan', hire_date: '2027-02-01' });
  assert.equal(emp.status, 201, JSON.stringify(emp.data));
  const tpls = (await a.get('/api/hrm/onboarding/templates')).data;
  const s = await a.post('/api/hrm/onboarding', { employee_id: emp.data.id, template_id: tpls[0].id, idempotency_key: 'a-1' });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  // workspace B sees nothing of A, by list or by id, and A's cookie does not work on B
  assert.equal((await b.get('/api/hrm/onboarding?filter=all')).data.rows.length, 0);
  assert.equal((await b.get(`/api/hrm/onboarding/${s.data.id}`)).status, 404);
  assert.equal((await call('onbb.erp.test', 'GET', `/api/hrm/onboarding/${s.data.id}`, null, { cookie: a.c })).status, 401);
  // the same idempotency key in another workspace is a different request
  const empB = await b.post('/api/hrm/employees', { name: 'Jordan Lee', hire_date: '2027-02-01' });
  const tb = (await b.get('/api/hrm/onboarding/templates')).data;
  assert.equal((await b.post('/api/hrm/onboarding', { employee_id: empB.data.id, template_id: tb[0].id, idempotency_key: 'a-1' })).status, 201);
  const ca = (await a.get('/api/hrm/onboarding/calendar')).data, cb = (await b.get('/api/hrm/onboarding/calendar')).data;
  assert.equal(ca.timezone, 'Asia/Dubai');
  assert.equal(cb.timezone, 'America/Los_Angeles', 'a second US timezone, not one per country');
  assert.deepEqual(cb.weekend, [0, 6]);
});
