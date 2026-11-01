// One email, one account: logins, invitations, employees, vendors, developers, portal logins and workspace sign-up all refuse a second use of
// an email (any letter case, with spaces), while a role change keeps working.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-uemail-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', BILLING_PROVIDER: 'manual' });
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY', 'PLATFORM_ADMIN_EMAIL', 'PLATFORM_ADMIN_PASSWORD']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { duplicateEmailReport } = await import('../src/services/uniqueEmail.js');
const { DatabaseSync } = await import('node:sqlite');
const db = await import('../src/db.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); db.closeDbs(); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
async function workspace(slug) {
  const r = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Co`, admin_name: 'Owner', admin_email: `owner@${slug}.test`, admin_password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const host = `${slug}.erp.test`;
  const c = (await call(host, 'POST', '/api/auth/login', { identifier: `owner@${slug}.test`, password: PW })).cookie;
  const f = (m) => (u, b) => call(host, m, u, b, { cookie: c });
  return { host, get: f('GET'), post: f('POST'), put: f('PUT') };
}
const EXISTS = /This email already exists/;
const refused = (r) => { assert.ok(r.status === 400 || r.status === 409, `${r.status} ${JSON.stringify(r.data)}`); assert.match(r.data.error, EXISTS); assert.equal(r.data.code, 'email_exists'); };

const PW = 'Tenant@12345';


test('staff logins: a second login with the same email is refused, in any case, on create and on edit; a role change is fine', async () => {
  const w = await workspace('uemail1');
  const [r1, r2] = (await w.get('/api/settings/roles')).data.filter((x) => x.name !== 'Super Admin');
  const mk = (email, role = r1) => w.post('/api/settings/users', { name: 'Sara Khan', email, password: 'Password@123', role_id: role.id });
  assert.equal((await mk('sara@uemail1.test')).status, 201);
  refused(await mk('sara@uemail1.test', r2)); // same email, other role
  refused(await mk('  SARA@Uemail1.TEST ', r2)); // other case + spaces
  refused(await mk('owner@uemail1.test')); // the workspace owner's email
  const b = await mk('omar@uemail1.test');
  assert.equal(b.status, 201);
  refused(await w.put(`/api/settings/users/${b.data.id}`, { email: 'SARA@uemail1.test' })); // edit into someone else's email
  assert.equal((await w.put(`/api/settings/users/${b.data.id}`, { email: 'Omar@Uemail1.test', name: 'Omar Ali' })).status, 200); // own email, other case
  assert.equal((await w.put(`/api/settings/users/${b.data.id}`, { role_id: r2.id })).status, 200); // the role may change
  // the database itself refuses a case-different duplicate too
  const file = path.join(dir, 'tenants', 'uemail1', 'erp.db');
  const raw = new DatabaseSync(file);
  assert.throws(() => raw.prepare('INSERT INTO users(name,email,password_hash,role_id,created_at) VALUES(?,?,?,?,?)').run('X', 'SARA@UEMAIL1.TEST', 'x', r1.id, 'now'), /UNIQUE/);
  raw.close();
});

test('invitations: inviting an email that already has an account is refused', async () => {
  const w = await workspace('uemail2');
  const role = (await w.get('/api/settings/roles')).data.find((x) => x.name !== 'Super Admin');
  refused(await w.post('/api/settings/invites', { email: 'OWNER@uemail2.test', name: 'Dup', role_id: role.id }));
});

test('employees, vendors, developers: no repeated email, and an email another account uses cannot become a second login', async () => {
  const w = await workspace('uemail3');
  const role = (await w.get('/api/settings/roles')).data.find((x) => x.name !== 'Super Admin');
  const emp = (email, name = 'Hira Noor') => w.post('/api/hrm/employees', { name, email, hire_date: '2027-02-01' });
  const e1 = await emp('hira@uemail3.test');
  assert.equal(e1.status, 201, JSON.stringify(e1.data));
  refused(await emp(' HIRA@uemail3.test ', 'Another Hira'));
  // an employee may share the email of their own staff login: it is the same person
  const u = await w.post('/api/settings/users', { name: 'Hira Noor', email: 'hira@uemail3.test', password: 'Password@123', role_id: role.id });
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const link = await w.put(`/api/hrm/employees/${e1.data.id}`, { email: 'hira@uemail3.test', user_id: u.data.id });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  const e2 = await emp('zain@uemail3.test', 'Zain Ali');
  assert.equal(e2.status, 201, JSON.stringify(e2.data));
  refused(await w.put(`/api/hrm/employees/${e2.data.id}`, { email: 'Hira@uemail3.test' }));

  // vendors
  const vend = (email, name = 'Bricks Ltd') => w.post('/api/accounting/vendors', { name, email });
  const v1 = await vend('bricks@uemail3.test');
  assert.equal(v1.status, 201, JSON.stringify(v1.data));
  refused(await vend('BRICKS@uemail3.test', 'Bricks Two'));
  refused(await vend('hira@uemail3.test', 'Hira Supplies')); // a staff member's email cannot also be a vendor
  const pa = await w.post(`/api/accounting/vendors/${v1.data.id}/portal-access`, {});
  assert.equal(pa.status, 200, JSON.stringify(pa.data));
  refused(await emp('bricks@uemail3.test', 'Vendor Person')); // an employee cannot take a vendor login's email

  // developers: a staff login takes the address first, so the developer cannot get a second login with it
  const d1 = await w.post('/api/developers', { name: 'Skyline', email: 'dev@uemail3.test' });
  assert.equal(d1.status, 201, JSON.stringify(d1.data));
  refused(await w.post('/api/developers', { name: 'Skyline 2', email: 'DEV@uemail3.test' }));
  assert.equal((await w.post('/api/settings/users', { name: 'Dev Person', email: 'dev@uemail3.test', password: 'Password@123', role_id: role.id })).status, 201);
  refused(await w.post(`/api/developers/${d1.data.id}/portal-login`, {}));
  const d2 = await w.post('/api/developers', { name: 'Other', email: 'other@uemail3.test' });
  refused(await w.put(`/api/developers/${d2.data.id}`, { email: 'dev@uemail3.test' }));
});

test('duplicate report lists repeated emails and changes nothing', async () => {
  const w = await workspace('uemail4');
  const tenant = (await import('../src/platform.js')).getTenant;
  const { withTenant, listTenants } = await import('../src/platform.js');
  const t = listTenants().find((x) => x.slug === 'uemail4');
  assert.ok(tenant && t);
  // two vendors with the same email can only exist from before this rule: write them straight to the database
  const raw = new DatabaseSync(path.join(dir, 'tenants', 'uemail4', 'erp.db'));
  for (const n of ['A', 'B']) raw.prepare("INSERT INTO vendors(name,email,created_at) VALUES(?,?,'now')").run(n, n === 'A' ? 'same@x.test' : ' SAME@x.test');
  raw.close();
  const rep = withTenant(t, () => duplicateEmailReport());
  assert.deepEqual(rep.map((r) => [r.kind, r.email, r.count]), [['vendor', 'same@x.test', 2]]);
  assert.equal((await w.get('/api/accounting/vendors')).data.total, 2);
});

test('sign-up: a workspace owner email that is a console account is refused', async () => {
  const p = await import('../src/platform.js');
  p.platformDb().prepare("INSERT INTO platform_admins(email,name,password_hash,role,activated_at) VALUES('staff@erp.test','Staff','x','platform_owner',datetime('now'))").run();
  const r = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'uemail5', company_name: 'U5', admin_name: 'Owner', admin_email: 'STAFF@erp.test', admin_password: PW });
  refused(r);
});
