import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-feat-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { all, get, val, run } = await import('../src/db.js');
const { today, addDays } = await import('../src/util.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, password = 'Demo@12345', portal = false) {
  const jar = {};
  const call = async (method, url, body, raw) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    if (raw) return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const l = await call('POST', '/api/auth/login', { identifier, password, portal });
  assert.equal(l.status, 200, `login failed for ${identifier}`);
  return { get: (u) => call('GET', u), raw: (u, m = 'GET', b) => call(m, u, b, true), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), me: l.data };
}
const sa = () => client('admin@expertdevelopers.pk');
const anon = async (u, opt = {}) => { const r = await fetch(base + u, { headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, ...opt }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d }; };


test('add user from an employee: search, auto-fill, link, and two-way sync', async () => {
  const a = await sa();
  const e = await a.post('/api/hrm/employees', { name: 'Zainab Khan', email: 'zainab.k@example.com', phone: '0300-1112223', department: 'Sales', designation: 'Executive' });
  assert.equal(e.status, 201);
  const found = await a.get('/api/settings/employees-available?q=zain');
  assert.ok(found.data.some((x) => x.id === e.data.id), 'searchable by name keyword');
  const byPhone = await a.get('/api/settings/employees-available?q=1112223');
  assert.ok(byPhone.data.some((x) => x.id === e.data.id));
  const role = get("SELECT id FROM roles WHERE portal=0 AND name<>'Super Admin' LIMIT 1");
  const u = await a.post('/api/settings/users', { employee_id: e.data.id, role_id: role.id, password: 'Strong@12345' });
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const user = get('SELECT * FROM users WHERE id=?', u.data.id);
  assert.equal(user.name, 'Zainab Khan'); assert.equal(user.email, 'zainab.k@example.com'); assert.equal(user.phone, '0300-1112223');
  assert.equal(get('SELECT user_id FROM employees WHERE id=?', e.data.id).user_id, user.id);
  assert.ok(!(await a.get('/api/settings/employees-available?q=zain')).data.some((x) => x.id === e.data.id), 'linked employees leave the picker');
  const again = await a.post('/api/settings/users', { employee_id: e.data.id, role_id: role.id, password: 'Strong@12345', email: 'other@example.com' });
  assert.equal(again.status, 400);
  // user -> employee
  assert.equal((await a.put(`/api/settings/users/${user.id}`, { name: 'Zainab K. Khan', phone: '0300-9998887' })).status, 200);
  assert.equal(get('SELECT name,phone FROM employees WHERE id=?', e.data.id).name, 'Zainab K. Khan');
  assert.equal(get('SELECT phone FROM employees WHERE id=?', e.data.id).phone, '0300-9998887');
  // employee -> user
  assert.equal((await a.put(`/api/hrm/employees/${e.data.id}`, { name: 'Zainab Khan', email: 'zainab.new@example.com' })).status, 200);
  const after = get('SELECT name,email FROM users WHERE id=?', user.id);
  assert.equal(after.name, 'Zainab Khan'); assert.equal(after.email, 'zainab.new@example.com');
});

test('terminate employee: disables login, keeps history, hides from active lists, audited', async () => {
  const a = await sa();
  const e = await a.post('/api/hrm/employees', { name: 'Hamza Terminate', email: 'hamza.t@example.com', department: 'Sales' });
  const role = get("SELECT id FROM roles WHERE portal=0 AND name<>'Super Admin' LIMIT 1");
  const u = await a.post('/api/settings/users', { employee_id: e.data.id, role_id: role.id, password: 'Strong@12345' });
  assert.equal(u.status, 201);
  const staff = await client('hamza.t@example.com', 'Strong@12345');
  run('INSERT INTO payroll(employee_id,period,basic,net,status,created_at) VALUES(?,?,?,?,?,?)', e.data.id, '2026-10', 1000, 1000, 'paid', '2026-10-31');
  for (const action of ['approve', 'activate']) assert.equal((await a.post(`/api/hrm/employees/${e.data.id}/workflow`, { action })).status, 200);

  assert.equal((await a.post(`/api/hrm/employees/${e.data.id}/terminate`, { date: '2026-11-04' })).status, 400, 'reason required');
  assert.equal((await a.post(`/api/hrm/employees/${e.data.id}/terminate`, { date: 'nope', reason: 'x' })).status, 400, 'valid date required');
  const t = await a.post(`/api/hrm/employees/${e.data.id}/terminate`, { date: '2026-11-04', reason: 'Resigned' });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal(t.data.login_disabled, true);

  const row = get('SELECT * FROM employees WHERE id=?', e.data.id);
  assert.equal(row.status, 'terminated'); assert.equal(row.terminated_date, '2026-11-04'); assert.equal(row.termination_reason, 'Resigned');
  assert.equal(get('SELECT active FROM users WHERE id=?', u.data.id).active, 0);
  assert.equal((await staff.get('/api/auth/me')).status, 401, 'existing session is signed out');
  const relog = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify({ identifier: 'hamza.t@example.com', password: 'Strong@12345' }) });
  assert.notEqual(relog.status, 200, 'cannot sign in again');
  assert.equal(get('SELECT COUNT(*) n FROM payroll WHERE employee_id=?', e.data.id).n, 1, 'payroll history kept');

  const ids = (r) => r.data.rows.map((x) => x.id);
  assert.ok(!ids(await a.get('/api/hrm/employees?limit=1000')).includes(e.data.id), 'hidden from default list');
  assert.ok(ids(await a.get('/api/hrm/employees?status=terminated&limit=1000')).includes(e.data.id), 'shown when filtered');
  assert.ok(ids(await a.get('/api/hrm/employees?include_terminated=1&limit=1000')).includes(e.data.id));
  assert.equal((await a.get(`/api/hrm/employees/${e.data.id}/profile`)).data.employee.status, 'terminated');
  assert.equal((await a.post('/api/hrm/payroll/generate', { period: '2026-12' })).status === 200 && get("SELECT COUNT(*) n FROM payroll WHERE employee_id=? AND period='2026-12'", e.data.id).n, 0, 'no new payroll');
  assert.equal((await a.post(`/api/hrm/employees/${e.data.id}/workflow`, { action: 'reactivate' })).status, 400);
  assert.equal((await a.post(`/api/hrm/employees/${e.data.id}/terminate`, { reason: 'again' })).status, 400, 'already terminated');
  assert.ok(get("SELECT 1 FROM audit_log WHERE action='Employee terminated' AND entity_id=?", String(e.data.id)), 'audit entry written');
});

test('terminate: cannot terminate yourself', async () => {
  const a = await sa();
  const me = get('SELECT id,name FROM users WHERE email=?', 'admin@expertdevelopers.pk');
  const id = run('INSERT INTO employees(name,user_id,status,created_at) VALUES(?,?,?,?)', me.name, me.id, 'active', '2026-11-04').lastInsertRowid;
  const e = { data: { id } };
  const t = await a.post(`/api/hrm/employees/${e.data.id}/terminate`, { reason: 'test' });
  assert.equal(t.status, 400);
  assert.equal(get('SELECT active FROM users WHERE id=?', me.id).active, 1);
});
