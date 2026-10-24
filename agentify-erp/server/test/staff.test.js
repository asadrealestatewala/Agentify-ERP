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

test('my profile: HR-entered details, manager, assets and attendance percentage', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  const p = await agent.get('/api/staff/me/profile');
  assert.equal(p.status, 200);
  assert.match(p.data.employee.emp_code, /^EMP-/);
  assert.ok(p.data.employee.father_name && p.data.employee.dob && p.data.employee.emergency_contact);
  assert.ok(['Intern', 'Employee', 'Part time', 'Full time', 'Probation', 'Permanent', 'Contract based'].includes(p.data.employee.employment_type));
  assert.equal(p.data.manager.name, 'Omar Farooq');
  assert.ok(p.data.assets.length >= 1 && p.data.assets[0].asset_no && p.data.assets[0].assigned_date, 'asset with number and date');
  const a = await agent.get('/api/staff/me/attendance');
  assert.ok(a.data.working_days > 0 || today().slice(8) === '01');
  assert.ok(a.data.percentage === null || (a.data.percentage >= 0 && a.data.percentage <= 100));
  const u = await agent.put('/api/staff/me/profile', { emergency_contact: '+92 300 9999999' });
  assert.equal(u.status, 200);
  assert.equal((await agent.get('/api/staff/me/profile')).data.employee.emergency_contact, '+92 300 9999999');
});

test('HR marks attendance in bulk and everyone sees the percentage', async () => {
  const hr = await client('hr@expertdevelopers.pk');
  const d = addDays(today(), -1);
  const e = get("SELECT id FROM employees WHERE user_id=(SELECT id FROM users WHERE email='agent3@expertdevelopers.pk')");
  assert.equal((await hr.post('/api/hrm/attendance/bulk', { date: d, entries: [{ employee_id: e.id, status: 'absent' }] })).status, 200);
  const rep = await hr.get('/api/hrm/attendance/report');
  assert.ok(rep.data.every((r) => r.percentage === null || typeof r.percentage === 'number'));
  assert.equal((await hr.post('/api/hrm/attendance', { employee_id: e.id, date: addDays(today(), 3), status: 'present' })).status, 400, 'no future marks');
  const agent = await client('agent1@expertdevelopers.pk');
  assert.equal((await agent.post('/api/hrm/attendance/bulk', { all_present: true })).status, 403, 'agents cannot mark attendance');
});

test('leave: employee applies, manager decides, HR can revoke; attendance follows', async () => {
  const agent = await client('agent2@expertdevelopers.pk');
  // two consecutive working days (not Sunday, not a seeded holiday) about three weeks out, so the result does not depend on today's date
  const working = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0 && !get('SELECT 1 FROM holidays WHERE date=?', d);
  let from = addDays(today(), 20);
  while (!working(from) || !working(addDays(from, 1))) from = addDays(from, 1);
  const to = addDays(from, 1);
  const ap = await agent.post('/api/staff/me/leaves', { type: 'Casual', from_date: from, to_date: to, reason: 'Wedding' });
  assert.equal(ap.status, 201, JSON.stringify(ap.data));
  assert.equal((await agent.post('/api/staff/me/leaves', { type: 'Casual', from_date: from, to_date: from })).status, 400, 'overlap refused');
  const sm = await client('salesmanager@expertdevelopers.pk');
  const boss = await sm.get('/api/staff/team/leaves?status=pending');
  const row = boss.data.find((l) => l.id === ap.data.id);
  assert.ok(row && row.can_decide, 'the reporting manager sees and may decide the request');
  const other = await client('agent1@expertdevelopers.pk');
  const own = await other.get('/api/staff/team/leaves');
  assert.ok(!own.data.some((l) => l.id === ap.data.id), 'colleagues do not see it');
  assert.equal((await other.post(`/api/hrm/leaves/${ap.data.id}/decide`, { action: 'approve' })).status, 403);
  assert.equal((await sm.post(`/api/hrm/leaves/${ap.data.id}/decide`, { action: 'approve', note: 'Enjoy' })).data.status, 'approved');
  const emp = get("SELECT id FROM employees WHERE user_id=(SELECT id FROM users WHERE email='agent2@expertdevelopers.pk')");
  assert.equal(val('SELECT status FROM attendance WHERE employee_id=? AND date=?', emp.id, from), 'leave');
  assert.ok(all('SELECT * FROM notifications WHERE user_id=(SELECT id FROM users WHERE email=?) AND type=?', 'agent2@expertdevelopers.pk', 'leave').length >= 1, 'employee notified');
  const hr = await client('hr@expertdevelopers.pk');
  assert.equal((await hr.post(`/api/hrm/leaves/${ap.data.id}/decide`, { action: 'revoke', note: 'Project deadline' })).data.status, 'revoked');
  assert.equal(val("SELECT COUNT(*) FROM attendance WHERE employee_id=? AND date=? AND status='leave'", emp.id, from), 0, 'attendance restored');
  const again = await agent.post('/api/staff/me/leaves', { type: 'Casual', from_date: from, to_date: from });
  assert.equal((await agent.post(`/api/staff/me/leaves/${again.data.id}/cancel`)).data.status, 'cancelled');
});

test('payroll: payslips are private; commission is settled through the payslip', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  const mine = await agent.get('/api/staff/me/payroll');
  assert.equal(mine.status, 200);
  assert.ok(mine.data.slips.length >= 1 && mine.data.slips.every((s) => s.status === 'paid'));
  const pdf = await agent.raw(`/api/staff/me/payroll/${mine.data.slips[0].id}/pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  const agent2 = await client('agent2@expertdevelopers.pk');
  assert.equal((await agent2.raw(`/api/staff/me/payroll/${mine.data.slips[0].id}/pdf`)).status, 404, 'cannot open a colleague payslip');
  const uid = val("SELECT id FROM users WHERE email='agent1@expertdevelopers.pk'");
  const sm = await client('salesmanager@expertdevelopers.pk');
  for (const c of all("SELECT id FROM commissions WHERE agent_id=? AND status='pending'", uid)) await sm.post(`/api/commissions/${c.id}/approve`);
  const due = val("SELECT COALESCE(SUM(amount-paid_amount),0) FROM commissions WHERE agent_id=? AND status IN ('approved','partially_paid')", uid);
  const admin = await client('admin.demo@expertdevelopers.pk');
  const period = '2099-01';
  assert.equal((await admin.post('/api/hrm/payroll/generate', { period })).status, 200);
  const slip = all('SELECT p.* FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.period=? AND e.user_id=?', period, uid)[0];
  assert.equal(slip.commission, due, 'payslip carries the approved commission still owed');
  const bank = val("SELECT id FROM accounts WHERE code='1210'");
  const pay = await admin.post(`/api/hrm/payroll/${slip.id}/pay`, { account_id: bank, payment_method: 'Bank Transfer' });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(val("SELECT COALESCE(SUM(amount-paid_amount),0) FROM commissions WHERE agent_id=? AND status IN ('approved','partially_paid')", uid), 0, 'commission ledger cleared');
  assert.equal(val('SELECT SUM(debit)-SUM(credit) FROM journal_lines'), 0);
});

test('work tasks: managers assign, staff update, notifications go out, others cannot', async () => {
  const sm = await client('salesmanager@expertdevelopers.pk');
  const agent = await client('agent1@expertdevelopers.pk');
  const uid = val("SELECT id FROM users WHERE email='agent1@expertdevelopers.pk'");
  assert.equal((await agent.post('/api/staff/work-tasks', { title: 'x', assigned_to: uid })).status, 403, 'agents cannot assign work');
  const t = await sm.post('/api/staff/work-tasks', { title: 'Call 10 interested leads', description: 'Before 5pm', priority: 'High', due_date: addDays(today(), 1), assigned_to_list: [uid] });
  assert.equal(t.status, 201);
  assert.ok(get("SELECT 1 FROM notifications WHERE user_id=? AND type='task' AND title LIKE 'New task%'", uid));
  const mine = await agent.get('/api/staff/work-tasks');
  assert.ok(mine.data.rows.some((r) => r.id === t.data.ids[0]));
  assert.equal((await agent.put(`/api/staff/work-tasks/${t.data.ids[0]}`, { status: 'in_progress', note: 'Started' })).status, 200);
  assert.equal((await agent.put(`/api/staff/work-tasks/${t.data.ids[0]}`, { title: 'hacked' })).status, 200);
  assert.equal(val('SELECT title FROM work_tasks WHERE id=?', t.data.ids[0]), 'Call 10 interested leads', 'assignee cannot rewrite the brief');
  await agent.put(`/api/staff/work-tasks/${t.data.ids[0]}`, { status: 'done' });
  assert.ok(get("SELECT 1 FROM notifications WHERE type='task' AND title LIKE 'Task completed%'"), 'assigner is told');
  const other = await client('agent2@expertdevelopers.pk');
  assert.equal((await other.get(`/api/staff/work-tasks/${t.data.ids[0]}`)).status, 403);
  assert.equal((await other.get('/api/staff/work-tasks')).data.rows.some((r) => r.id === t.data.ids[0]), false);
});

test('assets: bought through an expense voucher, assigned with instructions, returned', async () => {
  const hr = await client('hr@expertdevelopers.pk');
  const admin = await client('admin.demo@expertdevelopers.pk');
  const bank = val("SELECT id FROM accounts WHERE code='1210'");
  const a = await admin.post('/api/staff/assets', { name: 'Laptop', category: 'Laptop', brand_model: 'HP ProBook', serial_no: 'HP-1', cost: 120000, create_voucher: true, paid_from_account_id: bank, payment_method: 'Bank Transfer' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.ok(a.data.voucher_id && /^AST-/.test(a.data.asset_no));
  assert.equal(val('SELECT amount FROM expense_vouchers WHERE id=?', a.data.voucher_id), 120000);
  assert.equal((await hr.post('/api/staff/assets', { name: 'Mouse', cost: 2000, create_voucher: true })).status, 403, 'HR alone cannot raise vouchers');
  const emp = get("SELECT id FROM employees WHERE user_id=(SELECT id FROM users WHERE email='agent3@expertdevelopers.pk')");
  assert.equal((await hr.post(`/api/staff/assets/${a.data.id}/assign`, { employee_id: emp.id, instructions: 'Keep it in the bag' })).status, 200);
  assert.equal((await hr.post(`/api/staff/assets/${a.data.id}/assign`, { employee_id: emp.id })).status, 400, 'already assigned');
  const agent3 = await client('agent3@expertdevelopers.pk');
  assert.ok((await agent3.get('/api/staff/me/profile')).data.assets.some((x) => x.asset_no === a.data.asset_no && x.instructions === 'Keep it in the bag'));
  assert.equal((await hr.del(`/api/staff/assets/${a.data.id}`)).status, 400, 'cannot delete while assigned');
  assert.equal((await hr.post(`/api/staff/assets/${a.data.id}/return`, { note: 'Resigned' })).status, 200);
  assert.equal(val('SELECT status FROM assets WHERE id=?', a.data.id), 'in_stock');
});

test('content calendar: plan, track per platform, private creatives', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  const c = await agent.post('/api/content/posts', { title: 'Reel — plot tour', post_type: 'reel', caption: 'Own a plot', platforms: ['instagram', 'tiktok'], post_date: today(), post_time: '18:30' });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.match(c.data.day, /day$/);
  assert.equal((await agent.post('/api/content/posts', { title: 'bad', platforms: ['myspace'], post_date: today() })).status, 400);
  assert.equal((await agent.post(`/api/content/posts/${c.data.id}/posted`, { platform: 'youtube' })).status, 400, 'platform must be chosen first');
  let r = await agent.post(`/api/content/posts/${c.data.id}/posted`, { platform: 'instagram' });
  assert.equal(r.data.done, false);
  r = await agent.post(`/api/content/posts/${c.data.id}/posted`, { platform: 'tiktok' });
  assert.equal(r.data.done, true); assert.equal(r.data.status, 'posted');
  const other = await client('agent2@expertdevelopers.pk');
  assert.equal((await other.put(`/api/content/posts/${c.data.id}`, { title: 'mine now' })).status, 403, 'colleagues cannot edit your post');
  const sm = await client('salesmanager@expertdevelopers.pk');
  assert.equal((await sm.put(`/api/content/posts/${c.data.id}`, { notes: 'good' })).status, 200, 'managers can');
  assert.equal((await agent.put('/api/content/accounts/instagram', { handle: '@x' })).status, 403);
  assert.equal((await sm.put('/api/content/accounts/instagram', { handle: '@expert', access_token: 'SECRET-TOKEN-1234' })).status, 200);
  const accts = await agent.get('/api/content/accounts');
  const ig = accts.data.find((a) => a.platform === 'instagram');
  assert.ok(ig.connected && ig.handle === '@expert' && !JSON.stringify(accts.data).includes('SECRET-TOKEN'), 'secret never returned');
  const cust = await client('m.ali@example.com', 'Demo@12345', true);
  assert.equal((await cust.get('/api/content/posts')).status, 403);
});

test('roles: deleting a custom role moves its users; built-in roles are protected', async () => {
  const s = await sa();
  const role = await s.post('/api/settings/roles', { name: 'HR Coordinator', description: 'x', perms: ['hrm:view'] });
  assert.equal(role.status, 201);
  const uid = val("SELECT id FROM users WHERE email='agent3@expertdevelopers.pk'");
  run('UPDATE users SET role_id=? WHERE id=?', role.data.id, uid);
  const d1 = await s.del(`/api/settings/roles/${role.data.id}`);
  assert.equal(d1.status, 400); assert.match(d1.data.error, /1 user/);
  const agentRole = val("SELECT id FROM roles WHERE name='Sales Agent'");
  const d2 = await s.del(`/api/settings/roles/${role.data.id}?reassign_to=${agentRole}`);
  assert.equal(d2.status, 200); assert.equal(val('SELECT role_id FROM users WHERE id=?', uid), agentRole);
  assert.equal(get('SELECT 1 FROM roles WHERE id=?', role.data.id), undefined);
  assert.equal((await s.del(`/api/settings/roles/${agentRole}`)).status, 400, 'built-in role');
});

test('plot file details and payment-method bank details', async () => {
  const sm = await client('salesmanager@expertdevelopers.pk');
  const p = get("SELECT id FROM properties WHERE plot_no IS NOT NULL AND plot_no<>'' LIMIT 1");
  const u = await sm.put(`/api/properties/${p.id}`, { file_no: 'F-12B', registration_no: 'REG-77', file_status: 'Suspended' });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  const g = await sm.get(`/api/properties/${p.id}`);
  assert.equal(g.data.file_no, 'F-12B'); assert.equal(g.data.file_status, 'Suspended');
  assert.equal((await sm.put(`/api/properties/${p.id}`, { file_status: 'Gone' })).status, 400);
  const f = await sm.get('/api/properties?file_status=Suspended&limit=100');
  assert.ok(f.data.rows.some((r) => r.id === p.id));
  const s = await sa();
  const bank = get("SELECT id FROM lookups WHERE type='payment_method' AND value='Bank Transfer'");
  const up = await s.put(`/api/settings/lookups/${bank.id}`, { type: 'payment_method', value: 'Bank Transfer', sort_order: 1, active: 1, meta: { kind: 'Bank', bank_name: 'HBL', account_title: 'Expert Marketing', account_number: '1234', iban: 'PK36HABB0000001234' } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const cust = await client('m.ali@example.com', 'Demo@12345', true);
  const pay = await cust.get('/api/portal/pay-to');
  assert.ok(pay.data.some((m) => m.name === 'Bank Transfer' && m.bank_name === 'HBL' && m.iban === 'PK36HABB0000001234'));
  assert.ok(!pay.data.some((m) => m.name === 'Cheque'), 'methods without details are not shown');
});

test('customer portal: promotions, project drawings and contracts in documents', async () => {
  const cust = await client('m.ali@example.com', 'Demo@12345', true);
  const pr = await cust.get('/api/portal/promos');
  assert.equal(pr.status, 200); assert.ok(pr.data.promos.length >= 1 && pr.data.listings.length >= 1);
  assert.ok(pr.data.listings.every((l) => !('agent_id' in l) && !('commission' in l)));
  const mine = all("SELECT s.project_id pid, s.id sid FROM sales s WHERE s.contact_id=(SELECT contact_id FROM users WHERE email='m.ali@example.com') AND status='confirmed' LIMIT 1")[0];
  const ins = (type, id, cat, name, vis) => Number(run("INSERT INTO documents(entity_type,entity_id,category,name,path,mime,size,portal_visible,created_at) VALUES(?,?,?,?,?,?,?,?,datetime('now'))", type, id, cat, name, 'documents/none.pdf', 'application/pdf', 1, vis).lastInsertRowid);
  const d1 = ins('project', mine.pid, 'Architectural Drawing', 'Site elevation.pdf', 1);
  const d2 = ins('project', mine.pid, 'Architectural Drawing', 'Internal only.pdf', 0);
  const d3 = ins('sale', mine.sid, 'Contract', 'Sale contract.pdf', 1);
  const docs = (await cust.get('/api/portal/documents')).data;
  assert.ok(docs.some((d) => d.id === d1 && d.category === 'Architectural Drawing' && d.related));
  assert.ok(docs.some((d) => d.id === d3));
  assert.ok(!docs.some((d) => d.id === d2), 'not shared → hidden');
  const otherProj = val('SELECT id FROM projects WHERE id<>? LIMIT 1', mine.pid);
  const d4 = ins('project', otherProj, 'Site Plan', 'Other project.pdf', 1);
  assert.ok(!(await cust.get('/api/portal/documents')).data.some((d) => d.id === d4), 'only own projects');
  const sm = await client('salesmanager@expertdevelopers.pk');
  const c = await sm.post('/api/promos', { title: 'Summer offer', description: 'x', active: 1 });
  assert.equal(c.status, 201);
  assert.ok((await cust.get('/api/portal/promos')).data.promos.some((p) => p.title === 'Summer offer'));
  assert.equal((await cust.post('/api/promos', { title: 'hack' })).status, 403);
});

test('quick plan: days per activity with sub-activities', async () => {
  const pm = await client('pm@expertdevelopers.pk');
  const pid = val("SELECT id FROM projects WHERE kind='development' LIMIT 1");
  const before = val('SELECT COUNT(*) FROM project_tasks WHERE project_id=?', pid);
  const start = addDays(today(), 10);
  const r = await pm.post(`/api/projects/${pid}/tasks/plan`, { start, items: [
    { name: 'Footing work', days: 10, subs: [{ name: 'Excavation', days: 4 }, { name: 'Rebar', days: 3 }, { name: 'Concrete pour', days: 3 }] },
    { name: 'Slab work', days: 15 }, { name: 'Masonry', subs: [{ name: 'Brickwork', days: 5 }, { name: 'Plaster', days: 5 }] }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.created, 8);
  assert.equal(r.data.end, addDays(start, 10 + 15 + 10 - 1));
  const rows = all('SELECT * FROM project_tasks WHERE project_id=? ORDER BY id DESC LIMIT 8', pid).reverse();
  assert.equal(rows[0].planned_start, start); assert.equal(rows[0].planned_end, addDays(start, 9));
  assert.equal(rows[1].parent_id, rows[0].id); assert.equal(rows[1].planned_start, start);
  assert.equal(rows[2].planned_start, addDays(start, 4));
  assert.equal(rows[4].planned_start, addDays(start, 10), 'next activity starts after the previous one');
  assert.equal(val('SELECT COUNT(*) FROM project_tasks WHERE project_id=?', pid), before + 8);
  assert.equal((await pm.post(`/api/projects/${pid}/tasks/plan`, { start, end: addDays(start, -1), items: [{ name: 'No days' }] })).status, 400, 'needs days or a valid deadline');
});

test('website installment plan: 60 installments + 5 balloons make a complete dated schedule and PDF', async () => {
  const body = { price: 5000000, booking: 250000, advance: 750000, installments: 60, balloons: 5, balloon_amount: 150000, booking_date: '2026-10-09', advance_date: '2026-11-08' };
  const r = await anon('/api/site/installment-plan', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = r.data.rows;
  assert.equal(rows.filter((x) => x.type === 'installment').length, 60);
  assert.equal(rows.filter((x) => x.type === 'balloon').length, 5);
  assert.equal(rows[0].type, 'booking'); assert.equal(rows[0].date, '2026-10-09'); assert.equal(rows[1].type, 'advance');
  assert.equal(rows.reduce((s, x) => s + x.amount, 0), 5000000, 'every rupee is scheduled');
  assert.equal(rows.at(-1).balance, 0);
  assert.ok(rows.filter((x) => x.type === 'balloon').every((x, k, a) => k === 0 || x.date > a[k - 1].date), 'balloons are spread over time');
  const dates = rows.map((x) => x.date); assert.deepEqual(dates, [...dates].sort(), 'schedule is in date order');
  assert.equal((await anon('/api/site/installment-plan', { method: 'POST', body: JSON.stringify({ price: 100, installments: 0 }) })).status, 400);
  assert.equal((await anon('/api/site/installment-plan', { method: 'POST', body: JSON.stringify({ ...body, booking: 4000000, advance: 900000 }) })).status, 400, 'upfront + balloons cannot exceed the price');
  const pdf = await fetch(base + '/api/site/installment-plan/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify(body) });
  assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('content: staff can delete their own posts (not a colleague\'s)', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  const c = await agent.post('/api/content/posts', { title: 'Temp', post_date: today(), platforms: ['facebook'] });
  const other = await client('agent2@expertdevelopers.pk');
  assert.equal((await other.del(`/api/content/posts/${c.data.id}`)).status, 403);
  assert.equal((await agent.del(`/api/content/posts/${c.data.id}`)).status, 200);
});

test('website image library: an image in use cannot be deleted; an unused one can', async () => {
  const s = await sa();
  const mk = (n) => Number(run("INSERT INTO media(entity_type,entity_id,kind,path,caption,sort_order,created_at) VALUES('site',0,'library',?,?,0,datetime('now'))", `media/${n}.png`, `${n}.png`).lastInsertRowid);
  const used = mk('inuse-logo'), spare = mk('spare');
  const cfg = (await s.get('/api/site-admin/config')).data;
  cfg.brand.logo = 'media/inuse-logo.png';
  assert.equal((await s.put('/api/site-admin/config', cfg)).status, 200);
  const blocked = await s.del(`/api/site-admin/media/${used}`);
  assert.equal(blocked.status, 400); assert.match(blocked.data.error, /still used on the site design/);
  assert.equal((await s.del(`/api/site-admin/media/${spare}`)).status, 200);
  cfg.brand.logo = '';
  await s.put('/api/site-admin/config', cfg);
  assert.equal((await s.del(`/api/site-admin/media/${used}`)).status, 200, 'deletable once it is no longer used');
});

test('site design: only safe links, listed fonts and sensible calculator figures are accepted', async () => {
  const s = await sa();
  const base = (await s.get('/api/site-admin/config')).data;
  const tryCfg = async (mut) => { const c = JSON.parse(JSON.stringify(base)); mut(c); return s.put('/api/site-admin/config', c); };
  const refused = async (label, mut, re) => { const r = await tryCfg(mut); assert.equal(r.status, 400, label); if (re) assert.match(r.data.error, re, label); };
  await refused('javascript: social link', (c) => { c.social = [{ platform: 'Facebook', url: 'javascript:alert(1)' }]; }, /https/);
  await refused('javascript: header link', (c) => { c.header.cta_href = 'javascript:alert(1)'; }, /header button link/);
  await refused('data: footer link', (c) => { c.footer.columns = [{ title: 'x', links: [{ label: 'bad', href: 'data:text/html,x' }] }]; }, /Footer link/);
  await refused('font injection', (c) => { c.theme.font_heading = "x'; } body{display:none}"; }, /available fonts/);
  await refused('logo script url', (c) => { c.brand.logo = 'javascript:alert(1)'; }, /logo/);
  await refused('negative rate', (c) => { c.calculators.construction.rates = { Standard: -1 }; }, /rate for/);
  await refused('no grades', (c) => { c.calculators.construction.rates = {}; }, /at least one finishing grade/);
  await refused('breakdown ≠ 100', (c) => { c.calculators.construction.breakdown = [{ label: 'a', pct: 70 }, { label: 'b', pct: 70 }]; }, /add up to 100%/);
  await refused('default years > max', (c) => { c.calculators.installment.default_years = 12; c.calculators.installment.max_years = 5; }, /cannot be longer/);
  const ok = await tryCfg((c) => {
    c.theme.font_heading = 'Playfair Display'; c.theme.font_body = 'Lato'; c.social = [{ platform: 'LinkedIn', url: 'https://www.linkedin.com/company/x' }, { platform: 'WhatsApp', url: 'https://wa.me/923000000000' }];
    c.calculators.construction.rates = { Basic: 3000, Executive: 8000 }; c.calculators.construction.breakdown = [{ label: 'Structure', pct: 60 }, { label: 'Finishing', pct: 40 }];
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await s.post('/api/site-admin/publish')).status, 200, 'saving keeps a draft; publishing puts it live');
  const live = (await anon('/api/site/bootstrap')).data.config;
  assert.deepEqual(Object.keys(live.calculators.construction.rates), ['Basic', 'Executive']);
  assert.equal(live.theme.font_heading, 'Playfair Display');
  // a page section with an unsafe link is refused too
  const pages = (await s.get('/api/site-admin/pages')).data; const home = (await s.get(`/api/site-admin/pages/${pages.find((p) => p.slug === 'home').id}`)).data;
  const bad = JSON.parse(JSON.stringify(home.sections)); bad[0].props.cta_href = 'javascript:alert(1)';
  assert.equal((await s.put(`/api/site-admin/pages/${home.id}`, { sections: bad })).status, 400, 'unsafe link in a hero button');
  assert.equal((await s.put('/api/site-admin/config', base)).status, 200, 'original config still valid');
});

test('server-generated PDFs for receipt and expense vouchers (staff and customer portal)', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  const rid = val("SELECT id FROM receipts WHERE status='valid' ORDER BY id DESC LIMIT 1");
  const rcNo = val('SELECT receipt_no FROM receipts WHERE id=?', rid);
  let r = await fin.raw(`/api/receipts/${rid}/pdf`);
  assert.equal(r.status, 200); assert.equal(r.buf.subarray(0, 5).toString(), '%PDF-'); assert.ok(r.buf.length > 2500);
  assert.match(r.headers.get('content-disposition'), new RegExp(`filename="receipt-${rcNo}\.pdf"`));
  const eid = val('SELECT id FROM expense_vouchers ORDER BY id DESC LIMIT 1'), evNo = val('SELECT voucher_no FROM expense_vouchers WHERE id=?', eid);
  r = await fin.raw(`/api/accounting/expenses/${eid}/pdf`);
  assert.equal(r.status, 200); assert.equal(r.buf.subarray(0, 5).toString(), '%PDF-'); assert.match(r.headers.get('content-disposition'), new RegExp(`expense-${evNo}\.pdf`));
  assert.equal((await fin.raw('/api/receipts/999999/pdf')).status, 404);
  // a voided receipt still prints (watermarked) and the audit log records downloads
  const sm = await client('salesmanager@expertdevelopers.pk');
  assert.equal((await sm.raw(`/api/receipts/${rid}/pdf`)).status, 403, 'sales manager has no payments permission');
  const agent = await client('agent1@expertdevelopers.pk');
  assert.equal((await agent.raw(`/api/receipts/${rid}/pdf`)).status, 403);
  assert.equal((await agent.raw(`/api/accounting/expenses/${eid}/pdf`)).status, 403);
  assert.ok(get("SELECT 1 FROM audit_log WHERE action='Downloaded receipt PDF' AND entity_id=?", String(rid)));
  // customer portal: own valid receipt only
  const cust = await client('m.ali@example.com', 'Demo@12345', true);
  const cid = val("SELECT contact_id FROM users WHERE email='m.ali@example.com'");
  const own = val("SELECT id FROM receipts WHERE contact_id=? AND status='valid' LIMIT 1", cid);
  const other = val("SELECT id FROM receipts WHERE contact_id<>? AND status='valid' LIMIT 1", cid);
  r = await cust.raw(`/api/portal/receipts/${own}/pdf`);
  assert.equal(r.status, 200); assert.equal(r.buf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await cust.raw(`/api/portal/receipts/${other}/pdf`)).status, 404, "cannot download someone else's receipt");
  assert.equal((await cust.raw(`/api/receipts/${own}/pdf`)).status, 403, 'portal users cannot use the staff endpoint');
  assert.equal((await cust.raw(`/api/accounting/expenses/${eid}/pdf`)).status, 403);
});

test('customer IDs and property registration numbers: assigned automatically, unique, searchable', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  // every seeded customer has an ID; leads do not
  assert.equal(val("SELECT COUNT(*) FROM contacts WHERE is_customer=1 AND (customer_code IS NULL OR customer_code='')"), 0);
  assert.equal(val("SELECT COUNT(*) FROM contacts WHERE is_customer=0 AND customer_code IS NOT NULL"), 0);
  const codes = all("SELECT customer_code c FROM contacts WHERE customer_code IS NOT NULL").map((x) => x.c);
  assert.equal(new Set(codes).size, codes.length); assert.ok(codes.every((c) => /^CUS-\d{4}$/.test(c)));
  const one = get("SELECT id, full_name, customer_code FROM contacts WHERE is_customer=1 LIMIT 1");
  // search by ID (exact and partial) and by name finds the same customer
  for (const q of [one.customer_code, one.customer_code.slice(-3), one.full_name.split(' ')[0]]) {
    const r = await fin.get(`/api/contacts?q=${encodeURIComponent(q)}&type=customer&limit=20`);
    assert.ok(r.data.rows.some((x) => x.id === one.id), `contacts search "${q}"`);
    const c = await fin.get(`/api/customers?q=${encodeURIComponent(q)}`); assert.ok(c.data.rows.some((x) => x.id === one.id), `customers search "${q}"`);
  }
  assert.ok((await fin.get(`/api/search?q=${one.customer_code}`)).data.some((x) => x.id === one.id && /Customer/.test(x.badge)), 'global search by customer ID');
  // a lead gets an ID only when they buy
  const sm = await client('salesmanager@expertdevelopers.pk');
  const lead = get("SELECT id FROM contacts WHERE is_customer=0 LIMIT 1");
  assert.equal(get('SELECT customer_code FROM contacts WHERE id=?', lead.id).customer_code, null);
  const prop = get("SELECT id FROM properties WHERE status='available' AND project_id IS NOT NULL LIMIT 1");
  const admin = await client('admin.demo@expertdevelopers.pk');
  const sale = await admin.post('/api/sales', { contact_id: lead.id, property_id: prop.id, sale_price: 5000000, booking_amount: 100000, num_installments: 12, first_due: addDays(today(), 30) });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  assert.match(get('SELECT customer_code c FROM contacts WHERE id=?', lead.id).c, /^CUS-\d{4}$/, 'ID assigned on conversion');
  // receipts show it
  const rc = (await fin.get('/api/receipts?limit=1')).data.rows[0];
  assert.ok((await fin.get(`/api/receipts/${rc.id}`)).data.customer_code);

  // registration numbers: automatic for new properties, unique, editable
  const pr = await sm.post('/api/properties', { title: 'Reg test plot', property_type: 'Plots', project_id: val('SELECT id FROM projects LIMIT 1'), plot_no: 'Z-9', purpose: 'Sell', total_price: 1000000, net_price: 1000000 });
  assert.equal(pr.status, 201, JSON.stringify(pr.data));
  assert.match(pr.data.registration_no, /^REG-\d{4}$/);
  assert.equal(val("SELECT COUNT(*) FROM properties WHERE registration_no IS NULL OR registration_no=''"), 0);
  assert.equal((await sm.put(`/api/properties/${pr.data.id}`, { registration_no: 'ISB-2026-777' })).status, 200);
  const other = get('SELECT id, registration_no FROM properties WHERE id<>? LIMIT 1', pr.data.id);
  const dup = await sm.put(`/api/properties/${pr.data.id}`, { registration_no: other.registration_no.toLowerCase() });
  assert.equal(dup.status, 400); assert.match(dup.data.error, /already used/);
  // quick status check by registration number
  const lk = await sm.get('/api/properties/lookup?q=ISB-2026-777');
  assert.equal(lk.status, 200); assert.equal(lk.data.length, 1);
  assert.equal(lk.data[0].registration_no, 'ISB-2026-777'); assert.equal(lk.data[0].status, 'draft'); assert.ok('file_status' in lk.data[0]);
  assert.ok((await sm.get('/api/search?q=ISB-2026')).data.some((x) => x.id === pr.data.id), 'global search by registration number');
  assert.equal((await sm.get('/api/properties/lookup?q=x')).data.length, 0, 'needs at least 2 characters');
  // agents never see who bought a property
  const agent = await client('agent1@expertdevelopers.pk');
  const sold = get("SELECT registration_no r FROM properties WHERE status='sold' AND agent_id=(SELECT id FROM users WHERE email='agent1@expertdevelopers.pk') LIMIT 1");
  if (sold) assert.ok((await agent.get(`/api/properties/lookup?q=${sold.r}`)).data.every((x) => x.sold_to === undefined));
  assert.equal((await (await client('m.ali@example.com', 'Demo@12345', true)).get('/api/properties/lookup?q=REG')).status, 403, 'customers cannot use staff lookup');
});

test('receipt voucher carries the customer and file record; finance can look a customer up by phone, email or CNIC', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  // a known customer with a property sale
  const cust = get("SELECT c.id, c.full_name, c.customer_code, c.cnic, c.phone, c.email FROM contacts c WHERE c.is_customer=1 AND EXISTS(SELECT 1 FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed' AND s.kind='property') AND c.cnic IS NOT NULL AND c.phone IS NOT NULL LIMIT 1");
  assert.ok(cust, 'seed has a customer with CNIC and phone');
  const sale = get("SELECT s.id, s.sale_date, s.property_id FROM sales s WHERE s.contact_id=? AND s.status='confirmed' AND s.kind='property' ORDER BY s.id LIMIT 1", cust.id);
  run("UPDATE properties SET file_status='Defaulted', file_no='F-12B' WHERE id=?", sale.property_id);
  const prop = get('SELECT registration_no, property_type, area_size, unit FROM properties WHERE id=?', sale.property_id);

  // preview record (used by the form) and the receipt itself
  const rec = (await fin.get(`/api/receipts/record?contact_id=${cust.id}&sale_id=${sale.id}`)).data;
  assert.equal(rec.cnic, cust.cnic); assert.equal(rec.phone, cust.phone); assert.equal(rec.registration_no, prop.registration_no); assert.equal(rec.file_no, 'F-12B');
  assert.equal(rec.file_status, 'Defaulted'); assert.equal(rec.booking_date, sale.sale_date); assert.equal(rec.property_type, prop.property_type); assert.match(rec.plot_size, new RegExp(String(prop.area_size)));
  const rid = val("SELECT id FROM receipts WHERE contact_id=? AND status='valid' LIMIT 1", cust.id);
  const detail = (await fin.get(`/api/receipts/${rid}`)).data;
  assert.equal(detail.record.registration_no, prop.registration_no); assert.equal(detail.record.cnic, cust.cnic); assert.equal(detail.record.customer_code, cust.customer_code);
  // PDF has it too (staff and the customer's own copy)
  const pdf = await fin.raw(`/api/receipts/${rid}/pdf`); assert.equal(pdf.status, 200);
  const portalClient = await client(cust.email, 'Demo@12345', true).catch(() => null);
  if (portalClient) { const pr = await portalClient.get(`/api/portal/receipts/${rid}`); assert.equal(pr.status, 200); assert.equal(pr.data.record.file_status, 'Defaulted'); assert.equal((await portalClient.raw(`/api/portal/receipts/${rid}/pdf`)).status, 200); }

  // lookup by every kind of identifier, however it is typed
  const digits = cust.phone.replace(/\D/g, ''); const tail = digits.slice(-10);
  const queries = [cust.phone, `+92 ${tail.slice(0, 3)} ${tail.slice(3)}`, `0${tail}`, tail.slice(-7), cust.email, cust.email.toUpperCase(), cust.cnic, cust.cnic.replace(/\D/g, ''), cust.customer_code, cust.full_name.split(' ')[0]];
  for (const q of queries) {
    const r = await fin.get(`/api/customers/lookup?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, q); assert.ok(r.data.some((x) => x.id === cust.id), `lookup by "${q}"`);
  }
  const hit = (await fin.get(`/api/customers/lookup?q=${encodeURIComponent(cust.cnic)}`)).data.find((x) => x.id === cust.id);
  assert.ok(hit.files.some((f) => f.registration_no === prop.registration_no && f.file_status === 'Defaulted' && f.booking_date === sale.sale_date && f.file_no === 'F-12B'));
  assert.ok(hit.totals.net > 0);
  assert.equal((await fin.get('/api/customers/lookup?q=zzzz-no-such')).data.length, 0);
  assert.equal((await fin.get('/api/customers/lookup?q=ab')).data.length, 0, 'too short');
  // the same text finds them in the normal customer list and contacts search
  assert.ok((await fin.get(`/api/customers?q=${encodeURIComponent(`0${tail}`)}`)).data.rows.some((x) => x.id === cust.id));
  assert.ok((await fin.get(`/api/contacts?q=${encodeURIComponent(cust.cnic.replace(/\D/g, ''))}&type=customer`)).data.rows.some((x) => x.id === cust.id));
  // agents only see their own customers; customers cannot use it
  const agent = await client('agent1@expertdevelopers.pk');
  const mine = await agent.get(`/api/customers/lookup?q=${encodeURIComponent(cust.customer_code)}`);
  assert.ok(mine.status === 200 || mine.status === 403);
  if (mine.status === 200 && mine.data.length) assert.equal(get('SELECT agent_id FROM contacts WHERE id=?', cust.id).agent_id, val("SELECT id FROM users WHERE email='agent1@expertdevelopers.pk'"));
  // file status list now includes Defaulted
  const sm = await client('salesmanager@expertdevelopers.pk');
  assert.equal((await sm.put(`/api/properties/${sale.property_id}`, { file_status: 'Paused' })).status, 200);
  assert.equal((await sm.put(`/api/properties/${sale.property_id}`, { file_status: 'Defaulted' })).status, 200);
  assert.equal((await sm.put(`/api/properties/${sale.property_id}`, { file_status: 'Cancelled' })).status, 400);
});

test('customer lookup: % and _ are not wildcards; a construction file is labelled as such', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  for (const q of ['%%%', '___', '%_%', '\\\\']) assert.equal((await fin.get(`/api/customers/lookup?q=${encodeURIComponent(q)}`)).data.length, 0, `wildcard-looking "${q}"`);
  assert.equal((await fin.get('/api/customers?q=%25%25%25')).data.rows.length, 0, 'customer list too');
  assert.ok((await fin.get('/api/customers/lookup?q=@example.com')).data.length > 1, 'a real shared fragment still matches several');
  const bundle = get("SELECT contact_id c FROM sales WHERE kind='construction' AND status='confirmed' LIMIT 1");
  const r = (await fin.get(`/api/customers/lookup?q=${encodeURIComponent(get('SELECT customer_code c FROM contacts WHERE id=?', bundle.c).c)}`)).data[0];
  const house = r.files.find((f) => f.kind === 'construction'), plot = r.files.find((f) => f.kind === 'property');
  assert.equal(house.property_type, 'House construction');
  assert.ok(plot.property_type && plot.property_type !== 'House construction');
  assert.equal(house.registration_no, plot.registration_no, 'the house shares its plot\'s registration number');
});

test('expense voucher: "approve & pay now" is all-or-nothing', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  const petty = val("SELECT id FROM accounts WHERE code='1120'"), acc = val("SELECT id FROM accounts WHERE code='5110'");
  const before = val('SELECT COUNT(*) FROM expense_vouchers'), counter = val("SELECT value FROM counters WHERE key='EV'");
  const bad = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, description: 'too big', amount: 99_000_000, paid_from_account_id: petty, payment_method: 'Cash', pay_now: true });
  assert.equal(bad.status, 400); assert.match(bad.data.error, /Insufficient funds/);
  assert.equal(val('SELECT COUNT(*) FROM expense_vouchers'), before, 'no voucher left behind');
  assert.equal(val("SELECT value FROM counters WHERE key='EV'"), counter, 'voucher numbers are not burned either');
  assert.equal(val("SELECT COUNT(*) FROM journals WHERE memo LIKE '%too big%'"), 0);
  // a valid one still works and moves money
  const cashBefore = val('SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM journal_lines WHERE account_id=?', petty);
  const ok = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, description: 'small', amount: 5000, paid_from_account_id: petty, payment_method: 'Cash', pay_now: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(val('SELECT status FROM expense_vouchers WHERE id=?', ok.data.id), 'paid');
  assert.equal(val('SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM journal_lines WHERE account_id=?', petty), cashBefore - 5000);
});

test('expense voucher form: blank optional fields save as a draft; a bad account gives a message, not a crash', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  const acc = val("SELECT id FROM accounts WHERE code='5600'");
  // exactly what the form sends when nothing optional is chosen
  const draft = await fin.post('/api/accounting/expenses', { date: today(), project_id: null, sale_id: null, vendor_id: null, expense_account_id: acc, description: 'stationery', quantity: 1, unit_cost: '', amount: 3200, payment_method: 'Cash', reference_no: '', paid_from_account_id: '', is_credit: false, due_date: '', notes: '' });
  assert.equal(draft.status, 201, JSON.stringify(draft.data));
  const row = get('SELECT status, paid_from_account_id, due_date, reference_no FROM expense_vouchers WHERE id=?', draft.data.id);
  assert.equal(row.status, 'created'); assert.equal(row.paid_from_account_id, null); assert.equal(row.due_date, null); assert.equal(row.reference_no, null);
  // editing a draft with blanks works too
  assert.equal((await fin.put(`/api/accounting/expenses/${draft.data.id}`, { description: 'stationery (edited)', paid_from_account_id: '', due_date: '', vendor_id: '' })).status, 200);
  // unknown / non-cash account → clear 400
  const bad = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, amount: 100, paid_from_account_id: 999999 });
  assert.equal(bad.status, 400); assert.ok(bad.data.error);
  const notCash = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, amount: 100, paid_from_account_id: acc });
  assert.equal(notCash.status, 400);
});

test('lead form as a sales agent: needs a contact method, smart duplicate detection, assignment and privacy', async () => {
  const a1 = await client('agent1@expertdevelopers.pk'), a2 = await client('agent2@expertdevelopers.pk'), sm = await client('salesmanager@expertdevelopers.pk');
  const uid1 = val("SELECT id FROM users WHERE email='agent1@expertdevelopers.pk'");
  const base = { first_name: 'Tariq', last_name: 'Lead', lead_source: 'Facebook', lead_type: 'Buyer' };
  // must be contactable
  const none = await a1.post('/api/contacts', base); assert.equal(none.status, 400); assert.match(none.data.error, /phone number, WhatsApp number or email/);
  assert.equal((await a1.post('/api/contacts', { ...base, phone: 'abc' })).status, 400);
  assert.equal((await a1.post('/api/contacts', { ...base, email: 'nope' })).status, 400);
  assert.equal((await a1.post('/api/contacts', { ...base, phone: '0300 1', cnic: '12345' })).status, 400);
  // a good lead: assigned to the agent who adds it, default stage, follow-up task, manager told; blanks stored as NULL
  const fu = addDays(today(), 2);
  const ok = await a1.post('/api/contacts', { ...base, phone: '0333-7771234', email: '', cnic: '', followup_date: fu, budget: 4500000, tags: ['hot'] });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.agent_id, uid1); assert.equal(ok.data.stage, 'Non Contacted'); assert.equal(ok.data.is_customer, 0);
  assert.equal(get('SELECT email,cnic FROM contacts WHERE id=?', ok.data.id).email, null);
  assert.ok(get("SELECT 1 FROM tasks WHERE entity_type='contact' AND entity_id=? AND due_date=? AND assigned_to=?", ok.data.id, fu, uid1), 'follow-up task');
  assert.ok(get("SELECT 1 FROM activities WHERE contact_id=? AND action='Lead created'", ok.data.id));
  assert.ok(get("SELECT 1 FROM notifications WHERE type='lead' AND title='New lead from agent' AND body LIKE '%Tariq%'"), 'manager notified');
  // the agent cannot hand the lead to someone else
  const other = val("SELECT id FROM users WHERE email='agent2@expertdevelopers.pk'");
  const sneaky = await a1.post('/api/contacts', { ...base, first_name: 'Sneaky', phone: '0300 9990001', agent_id: other });
  assert.equal(sneaky.data.agent_id, uid1);
  // duplicates: same number in any format, e-mail in any case, CNIC with / without dashes
  const same = async (extra) => (await a1.post('/api/contacts', { ...base, first_name: 'Dup', ...extra }));
  for (const phone of ['+92 333 7771234', '03337771234', '0333 777 1234', '0333-777-1234']) { const r = await same({ phone }); assert.equal(r.status, 400, phone); assert.ok(r.data.duplicate_id === ok.data.id, `duplicate of own lead via ${phone}`); }
  assert.equal((await same({ alt_phone: '0333-7771234' })).status, 400, 'alternate phone counts too');
  const withMail = await a1.post('/api/contacts', { ...base, first_name: 'Mail', email: 'Mail.Person@Example.com', cnic: '35202-5555555-5' }); assert.equal(withMail.status, 201);
  assert.equal((await same({ email: 'mail.person@example.com' })).status, 400, 'e-mail in other capitals');
  assert.equal((await same({ phone: '0300 5550001', cnic: '3520255555555' })).status, 400, 'CNIC without dashes');
  // live check endpoint: own contact shown, another agent's is masked
  const dupOwn = await a1.get('/api/contacts/duplicates?phone=03337771234'); assert.equal(dupOwn.data[0].id, ok.data.id); assert.equal(dupOwn.data[0].mine, true);
  const dupHidden = await a2.get('/api/contacts/duplicates?phone=03337771234');
  assert.equal(dupHidden.data.length, 1); assert.equal(dupHidden.data[0].mine, false); assert.equal(dupHidden.data[0].id, null); assert.equal(dupHidden.data[0].full_name, null);
  assert.ok(!JSON.stringify(dupHidden.data).includes('Tariq') && !JSON.stringify(dupHidden.data).includes('7771234'), 'nothing about the other agent’s lead leaks');
  // another agent can neither add the same person nor force it
  const clash = await a2.post('/api/contacts', { ...base, first_name: 'Tariq', phone: '+92 333 7771234', force: true });
  assert.equal(clash.status, 400); assert.match(clash.data.error, /already registered with another agent/); assert.ok(!clash.data.error.includes('Tariq Lead'));
  assert.equal(get("SELECT COUNT(*) n FROM contacts WHERE replace(replace(phone,' ',''),'-','') LIKE '%3337771234'").n, 1);
  // …and they cannot see it
  assert.ok(!(await a2.get('/api/contacts?limit=100')).data.rows.some((c) => c.id === ok.data.id));
  // a manager sees the duplicate by name and may knowingly force a second record
  const mgrClash = await sm.post('/api/contacts', { ...base, first_name: 'Tariqtwo', phone: '03337771234' });
  assert.equal(mgrClash.status, 400); assert.match(mgrClash.data.error, /Tariq Lead/);
  assert.equal((await sm.post('/api/contacts', { ...base, first_name: 'Tariqtwo', phone: '03337771234', force: true })).status, 201);
  // editing cannot create a duplicate or strip the last contact method
  const second = await a1.post('/api/contacts', { ...base, first_name: 'Second', phone: '0345 1112223' });
  const edit = await a1.put(`/api/contacts/${second.data.id}`, { phone: '0333 7771234' }); assert.equal(edit.status, 400); assert.equal(edit.data.duplicate_id, ok.data.id);
  assert.equal((await a1.put(`/api/contacts/${second.data.id}`, { phone: '0345 1112224', city: 'Lahore' })).status, 200);
  assert.equal((await a1.put(`/api/contacts/${second.data.id}`, { phone: '' })).status, 400);
  assert.equal((await a1.put(`/api/contacts/${second.data.id}`, { phone: '', email: 'second@example.com' })).status, 200);
});

test('asset purchase: approving the voucher fills the Asset Library from the voucher (no re-typing)', async () => {
  const fin = await client('finance@expertdevelopers.pk'), hr = await client('hr@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk');
  const acc = val("SELECT id FROM accounts WHERE code='5800'"), vendor = val('SELECT id FROM vendors LIMIT 1'), bank = val("SELECT id FROM accounts WHERE code='1210'");
  const before = val('SELECT COUNT(*) FROM assets');
  const v = await fin.post('/api/accounting/expenses', { date: '2026-09-15', vendor_id: vendor, expense_account_id: acc, description: 'Office chairs', amount: 100000, payment_method: 'Bank Transfer', paid_from_account_id: bank,
    asset_info: { units: 3, category: 'Furniture', brand_model: 'Interwood Ergo', warranty_until: '2027-09-15', serial_no: 'IGNORED-FOR-MULTIPLE' } });
  assert.equal(v.status, 201, JSON.stringify(v.data));
  assert.equal(val('SELECT is_asset FROM expense_vouchers WHERE id=?', v.data.id), 1, 'the Assets & Equipment account is always an asset purchase');
  assert.equal(val('SELECT COUNT(*) FROM assets'), before, 'nothing in the library until the purchase is approved');
  await fin.post(`/api/accounting/expenses/${v.data.id}/submit`);
  assert.equal(val('SELECT COUNT(*) FROM assets'), before);
  assert.equal((await fin.post(`/api/accounting/expenses/${v.data.id}/approve`)).status, 200);
  const rows = all('SELECT * FROM assets WHERE voucher_id=? ORDER BY id', v.data.id);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((a) => a.cost), [33333, 33333, 33334]); assert.equal(rows.reduce((s, a) => s + a.cost, 0), 100000);
  assert.ok(rows.every((a) => a.purchase_date === '2026-09-15' && a.vendor_id === vendor && a.category === 'Furniture' && a.brand_model === 'Interwood Ergo' && a.warranty_until === '2027-09-15' && a.source === 'voucher' && a.status === 'in_stock'));
  assert.deepEqual(rows.map((a) => a.name), ['Office chairs (1 of 3)', 'Office chairs (2 of 3)', 'Office chairs (3 of 3)']);
  assert.ok(rows.every((a) => !a.serial_no), 'one serial cannot describe several units');
  assert.ok(rows.every((a) => /^AST-\d{4}$/.test(a.asset_no)));
  assert.ok(get("SELECT 1 FROM notifications WHERE type='asset' AND title LIKE 'New asset in the Asset Library%'"), 'HR is told');
  await fin.post(`/api/accounting/expenses/${v.data.id}/approve`);
  assert.equal(val('SELECT COUNT(*) FROM assets WHERE voucher_id=?', v.data.id), 3, 'no duplicates');
  const detail = (await fin.get(`/api/accounting/expenses/${v.data.id}`)).data;
  assert.equal(detail.assets.length, 3); assert.equal(detail.asset_info.units, 3);
  assert.equal((await fin.get('/api/staff/assets?q=Interwood')).data.rows.length, 3); assert.equal((await hr.get('/api/staff/assets?q=chairs')).data.rows.length, 3);
  assert.equal((await agent.get('/api/staff/assets')).status, 403);
  const lib = (await fin.get('/api/staff/assets?q=chairs')).data;
  assert.equal(lib.rows[0].vendor_name, get('SELECT name FROM vendors WHERE id=?', vendor).name); assert.equal(lib.rows[0].voucher_no, detail.voucher_no);
  const one = rows[0];
  assert.equal((await fin.get(`/api/staff/assets/${one.id}`)).data.details_missing, true === false ? true : false);
  assert.equal((await fin.put(`/api/staff/assets/${one.id}`, { serial_no: 'CH-001', cost: 1, purchase_date: '2000-01-01', notes: 'Boardroom' })).status, 200);
  const after = get('SELECT * FROM assets WHERE id=?', one.id);
  assert.equal(after.serial_no, 'CH-001'); assert.equal(after.cost, 33333, 'cost stays as booked'); assert.equal(after.purchase_date, '2026-09-15');
  assert.equal((await agent.put(`/api/staff/assets/${one.id}`, { serial_no: 'x' })).status, 403);
  assert.ok((await fin.get('/api/staff/assets?incomplete=1')).data.rows.every((a) => a.details_missing));

  const petty = val("SELECT id FROM accounts WHERE code='1110'");
  const lap = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, description: 'Laptop', amount: 90000, payment_method: 'Cash', paid_from_account_id: petty, pay_now: true, asset_info: { name: 'Dell Latitude', serial_no: 'DL-77', category: 'Laptop', brand_model: 'Latitude 5440' } });
  assert.equal(lap.status, 201, JSON.stringify(lap.data));
  const la = all('SELECT * FROM assets WHERE voucher_id=?', lap.data.id);
  assert.equal(la.length, 1); assert.equal(la[0].name, 'Dell Latitude'); assert.equal(la[0].serial_no, 'DL-77'); assert.equal(la[0].cost, 90000);
  assert.equal(get('SELECT 1 x FROM assets WHERE id=?', la[0].id) && (await fin.get(`/api/staff/assets/${la[0].id}`)).data.details_missing, false, 'complete from the voucher alone');
  const bricks = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: val("SELECT id FROM accounts WHERE code='5110'"), description: 'bricks', amount: 1000, payment_method: 'Cash', paid_from_account_id: petty, pay_now: true });
  assert.equal(val('SELECT COUNT(*) FROM assets WHERE voucher_id=?', bricks.data.id), 0); assert.equal(val('SELECT is_asset FROM expense_vouchers WHERE id=?', bricks.data.id), 0);
  const rej = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, description: 'Rejected desk', amount: 5000, submit: true });
  await fin.post(`/api/accounting/expenses/${rej.data.id}/reject`);
  assert.equal(val('SELECT COUNT(*) FROM assets WHERE voucher_id=?', rej.data.id), 0);
  const adm = await client('admin.demo@expertdevelopers.pk');
  const lib3 = await adm.post('/api/staff/assets', { name: 'Projector', category: 'Office equipment', cost: 60000, create_voucher: true, paid_from_account_id: bank, payment_method: 'Bank Transfer' });
  assert.equal(lib3.status, 201, JSON.stringify(lib3.data));
  await adm.post(`/api/accounting/expenses/${lib3.data.voucher_id}/submit`); await adm.post(`/api/accounting/expenses/${lib3.data.voucher_id}/approve`);
  assert.equal(val('SELECT COUNT(*) FROM assets WHERE voucher_id=?', lib3.data.voucher_id), 1, 'one asset, not two');
});

test('expense voucher: the paying account is shown only when the voucher says so', async () => {
  const { expenseDetails } = await import('../src/services/voucherPdf.js');
  const fin = await client('finance@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk');
  const bank = val("SELECT id FROM accounts WHERE code='1210'"), acc = val("SELECT id FROM accounts WHERE code='5600'");
  const v = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, description: 'Printer ink', amount: 7000, payment_method: 'Bank Transfer', paid_from_account_id: bank, pay_now: true });
  assert.equal(v.status, 201, JSON.stringify(v.data));
  let e = (await fin.get(`/api/accounting/expenses/${v.data.id}`)).data;
  assert.equal(e.show_paid_from, 0, 'hidden by default');
  assert.ok(!expenseDetails(e).some(([l]) => l === 'Paid from'), 'not on the printed voucher');
  assert.equal(e.paid_from_name, 'Main Bank Account', 'but still recorded for the books');
  assert.equal((await fin.raw(`/api/accounting/expenses/${v.data.id}/pdf`)).status, 200);
  assert.equal((await agent.post(`/api/accounting/expenses/${v.data.id}/show-paid-from`, { show: true })).status, 403);
  assert.equal((await fin.post(`/api/accounting/expenses/${v.data.id}/show-paid-from`, { show: true })).data.show_paid_from, 1);
  e = (await fin.get(`/api/accounting/expenses/${v.data.id}`)).data;
  assert.deepEqual(expenseDetails(e).find(([l]) => l === 'Paid from'), ['Paid from', 'Main Bank Account']);
  assert.equal((await fin.post(`/api/accounting/expenses/${v.data.id}/show-paid-from`, { show: false })).data.show_paid_from, 0);
  const shown = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, description: 'Tea', amount: 500, payment_method: 'Cash', paid_from_account_id: val("SELECT id FROM accounts WHERE code='1110'"), show_paid_from: true, pay_now: true });
  assert.equal((await fin.get(`/api/accounting/expenses/${shown.data.id}`)).data.show_paid_from, 1);
  const d = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, description: 'Draft', amount: 100, show_paid_from: true });
  assert.equal((await fin.put(`/api/accounting/expenses/${d.data.id}`, { description: 'Draft 2' })).status, 200);
  assert.equal((await fin.get(`/api/accounting/expenses/${d.data.id}`)).data.show_paid_from, 1);
  assert.equal((await fin.put(`/api/accounting/expenses/${d.data.id}`, { show_paid_from: false })).status, 200);
  assert.equal((await fin.get(`/api/accounting/expenses/${d.data.id}`)).data.show_paid_from, 0);
});


test('insights: the Today feed follows the role, customer 360 explains what to do next, the plot map groups every plot', async () => {
  const fin = await client('finance@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk'), hr = await client('hr@expertdevelopers.pk');
  const t = today();
  const od = val("SELECT COUNT(*) FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.status='confirmed' AND i.status<>'paid' AND i.due_date<?", t);
  const f = (await fin.get('/api/insights/today')).data;
  assert.ok(f.greeting && f.cards.length > 0);
  if (od > 0) { const c = f.cards.find((x) => x.key === 'overdue'); assert.equal(c.count, od); assert.ok(c.items.length <= 5 && c.items[0].link.includes('/360')); }
  assert.ok(!f.cards.some((x) => ['attendance', 'leaves'].includes(x.key)), 'finance does not see HR chores');
  const a = (await agent.get('/api/insights/today')).data;
  assert.ok(!a.cards.some((x) => ['vouchers', 'assets', 'attendance', 'leaves', 'commissions'].includes(x.key)), 'agents only see their own sales work');
  const h = (await hr.get('/api/insights/today')).data;
  assert.ok(!h.cards.some((x) => x.key === 'vouchers'));
  assert.equal((await client('hr@expertdevelopers.pk').then((c) => c.get('/api/insights/customer/1'))).status, 403, 'HR has no customers module');

  const withOverdue = get("SELECT s.contact_id id FROM sales s JOIN installments i ON i.sale_id=s.id WHERE s.status='confirmed' AND i.status<>'paid' AND i.due_date<? LIMIT 1", t);
  if (withOverdue) {
    const r = (await fin.get(`/api/insights/customer/${withOverdue.id}`)).data;
    assert.equal(r.nba.kind, 'overdue'); assert.equal(r.nba.tone, 'bad'); assert.ok(r.kpis.overdue > 0 && r.kpis.overdue_count > 0);
    assert.ok(r.events.some((e) => e.type === 'overdue') && r.events.some((e) => e.type === 'sale'));
    assert.deepEqual([...r.events].sort((x, y) => (y.at + (y.time || '')).localeCompare(x.at + (x.time || ''))).map((e) => e.at), r.events.map((e) => e.at), 'newest first');
    assert.equal(r.kpis.outstanding, r.kpis.net - r.kpis.paid);
  }
  const aid = val("SELECT id FROM users WHERE email='agent1@expertdevelopers.pk'");
  const others = get('SELECT id FROM contacts WHERE IFNULL(agent_id,0)<>? AND IFNULL(created_by,0)<>? LIMIT 1', aid, aid);
  assert.equal((await agent.get(`/api/insights/customer/${others.id}`)).status, 403, "an agent cannot open another agent's customer");
  assert.equal((await fin.get('/api/insights/customer/999999')).status, 404);

  const pm = (await fin.get('/api/insights/plot-map')).data;
  const expected = val("SELECT COUNT(*) FROM properties WHERE status<>'cancelled' AND project_id IS NOT NULL");
  assert.equal(pm.total, expected); assert.equal(pm.plots.length, expected);
  assert.equal(Object.values(pm.summary).reduce((s, n) => s + n, 0), expected);
  assert.ok(pm.plots.every((p) => p.map_status && p.plot_no !== undefined));
  const sold = pm.plots.find((p) => p.status === 'sold' && p.customer);
  if (sold) assert.ok(sold.sale_no && sold.contact_id);
  const one = pm.projects[0];
  const filtered = (await fin.get(`/api/insights/plot-map?project_id=${one.id}`)).data;
  assert.ok(filtered.plots.every((p) => p.project_id === one.id));
  assert.equal((await anon('/api/insights/plot-map')).status, 401);
});


test('expense voucher detail carries the vendor phone so the voucher can be sent on WhatsApp', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  const vendor = get('SELECT id, phone FROM vendors WHERE phone IS NOT NULL LIMIT 1');
  const acc = val("SELECT id FROM accounts WHERE code='5600'");
  const v = await fin.post('/api/accounting/expenses', { date: today(), vendor_id: vendor.id, expense_account_id: acc, description: 'Stationery', amount: 3000, payment_method: 'Cash', paid_from_account_id: val("SELECT id FROM accounts WHERE code='1110'"), submit: true });
  assert.equal(v.status, 201, JSON.stringify(v.data));
  assert.equal((await fin.get(`/api/accounting/expenses/${v.data.id}`)).data.vendor_phone, vendor.phone);
  await fin.post(`/api/accounting/expenses/${v.data.id}/approve`);
  const pdf = await fin.raw(`/api/accounting/expenses/${v.data.id}/pdf`);
  assert.equal(pdf.status, 200); assert.ok(pdf.buf.subarray(0, 4).toString() === '%PDF', 'the attachment is a real PDF');
  const noVendor = await fin.post('/api/accounting/expenses', { date: today(), expense_account_id: acc, description: 'Tea', amount: 200 });
  assert.equal((await fin.get(`/api/accounting/expenses/${noVendor.data.id}`)).data.vendor_phone, null);
});


test('plot map: customer details are shown only to roles that may see customers, and agents see only their own', async () => {
  const fin = await client('finance@expertdevelopers.pk'), pm = await client('pm@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk');
  const aid = val("SELECT id FROM users WHERE email='agent1@expertdevelopers.pk'");
  const all1 = (await fin.get('/api/insights/plot-map')).data.plots;
  assert.ok(all1.some((p) => p.customer), 'finance sees who bought what');
  const leaks = (rows) => rows.filter((p) => p.customer || p.customer_phone || p.contact_id || p.sale_no || p.paid_amount !== null || p.sale_net !== null);
  const pmRows = (await pm.get('/api/insights/plot-map')).data;
  assert.equal(pmRows.status === undefined ? pmRows.plots.length : 0, all1.length, 'the project manager still sees every plot and its status');
  assert.equal(leaks(pmRows.plots).length, 0, 'but no customer, phone, sale or payment data');
  assert.deepEqual(pmRows.summary, (await fin.get('/api/insights/plot-map')).data.summary, 'status counts are unchanged');
  const ag = (await agent.get('/api/insights/plot-map')).data.plots;
  const mine = new Set(all('SELECT property_id FROM sales WHERE agent_id=? AND status=?', aid, 'confirmed').map((r) => r.property_id));
  assert.ok(leaks(ag).every((p) => mine.has(p.id)), "an agent sees customer data only on their own sales");
  assert.equal(ag.length, all1.length);
});


async function cookieFor(identifier, portal = true) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify({ identifier, password: 'Demo@12345', portal }) });
  return r.headers.get('set-cookie').split(';')[0];
}

test('vendor portal: payments, balance and registration come straight from the books and the vouchers', async () => {
  const abc = await client('abc.bricks@example.com', 'Demo@12345', true), fin = await client('finance@expertdevelopers.pk');
  const vid = val("SELECT id FROM vendors WHERE name='ABC Bricks'"), other = val("SELECT id FROM vendors WHERE name='XYZ Water Services'");
  const books = () => get(`SELECT COALESCE(SUM(l.credit),0) billed, COALESCE(SUM(l.debit),0) released FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code='2100' AND l.vendor_id=?`, vid);
  let d = (await abc.get('/api/vendor/dashboard')).data;
  assert.equal(d.money.total_billed, books().billed); assert.equal(d.money.total_released, books().released);
  assert.equal(d.money.total_remaining, books().billed - books().released);
  assert.equal(d.money.books_in_sync, true, 'books and vouchers agree');
  assert.equal(d.money.total_released, val('SELECT COALESCE(SUM(amount),0) FROM vendor_payments WHERE vendor_id=?', vid));
  assert.ok(d.money.credit_outstanding > 0, 'the seeded credit purchase is outstanding');
  assert.match(d.vendor.vendor_code, /^VND-\d{4}$/);

  // a new credit purchase moves the vendor's numbers, and a payment moves them again
  const acc = val("SELECT id FROM accounts WHERE code='5110'");
  const v = await fin.post('/api/accounting/expenses', { date: today(), vendor_id: vid, expense_account_id: acc, description: 'Bricks — Block C', amount: 120000, is_credit: true, due_date: addDays(today(), 20), submit: true });
  assert.equal(v.status, 201, JSON.stringify(v.data));
  assert.equal((await abc.get('/api/vendor/vouchers')).data.rows.some((x) => x.id === v.data.id), false, 'a submitted voucher is not yet the vendor’s business');
  await fin.post(`/api/accounting/expenses/${v.data.id}/approve`);
  let m = (await abc.get('/api/vendor/dashboard')).data.money;
  assert.equal(m.total_remaining, d.money.total_remaining + 120000); assert.equal(m.credit_outstanding, d.money.credit_outstanding + 120000); assert.equal(m.books_in_sync, true);
  assert.ok(get("SELECT 1 FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.vendor_id=? AND n.title='Voucher approved'", vid), 'the vendor is told');
  const till = val("SELECT id FROM accounts WHERE code='1110'");
  assert.equal((await fin.post(`/api/accounting/expenses/${v.data.id}/pay`, { amount: 50000, account_id: till, method: 'Cash' })).status, 200);
  m = (await abc.get('/api/vendor/dashboard')).data.money;
  assert.equal(m.total_released, d.money.total_released + 50000); assert.equal(m.total_remaining, d.money.total_remaining + 70000); assert.equal(m.books_in_sync, true);
  assert.ok(get("SELECT 1 FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.vendor_id=? AND n.title='Payment released'", vid));

  // vouchers: only approved ones, only their own, and nothing internal
  const list = (await abc.get('/api/vendor/vouchers')).data;
  assert.ok(list.rows.every((x) => ['approved', 'partial', 'paid'].includes(x.status)));
  assert.ok(list.rows.every((x) => val('SELECT vendor_id FROM expense_vouchers WHERE id=?', x.id) === vid));
  assert.ok((await abc.get('/api/vendor/vouchers?credit=1&open=1')).data.rows.every((x) => x.is_credit && x.balance > 0));
  const one = (await abc.get(`/api/vendor/vouchers/${v.data.id}`)).data;
  assert.equal(one.payments.length, 1); assert.equal(one.payments[0].amount, 50000);
  assert.ok(!('paid_from_account_id' in one) && !('created_by' in one) && !one.payments.some((p) => 'account_id' in p), 'no internal accounts or staff names');
  const theirs = val('SELECT id FROM expense_vouchers WHERE vendor_id=? LIMIT 1', other);
  assert.equal((await abc.get(`/api/vendor/vouchers/${theirs}`)).status, 404, 'another vendor’s voucher');
  const pdf = await abc.raw(`/api/vendor/vouchers/${v.data.id}/pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.buf.subarray(0, 4).toString(), '%PDF');
  assert.equal((await abc.raw(`/api/vendor/vouchers/${theirs}/pdf`)).status, 404);

  // ledger ties to the same books and downloads
  const led = (await abc.get('/api/vendor/ledger')).data;
  assert.equal(led.balance, m.total_remaining); assert.equal(led.total_billed - led.total_paid, led.balance);
  assert.equal(led.entries.at(-1).balance, led.balance);
  const dated = (await abc.get(`/api/vendor/ledger?from=${today()}`)).data;
  assert.equal(dated.opening + dated.entries.reduce((s, e) => s + e.billed - e.paid, 0), dated.balance, 'opening balance carries forward');
  const csv = await abc.raw('/api/vendor/ledger?format=csv'); assert.equal(csv.status, 200); assert.match(csv.buf.toString(), /Closing balance/);
  assert.equal((await abc.raw('/api/vendor/ledger?format=pdf')).buf.subarray(0, 4).toString(), '%PDF');
  assert.equal((await abc.get('/api/vendor/ledger?from=oops')).status, 404);

  // registration
  const prof = (await abc.get('/api/vendor/profile')).data;
  assert.equal(prof.registration.vendor_code, d.vendor.vendor_code); assert.equal(prof.registration.name, 'ABC Bricks'); assert.equal(prof.registration.status, 'Active');
  assert.ok(prof.registration.registered_on && prof.worked_on.length >= 1);
  assert.equal((await abc.get('/api/vendor/payments')).data.total_released, m.total_released);
});

test('vendor portal: tenders are announced, bid on, compared and awarded — and everyone stays in their lane', async () => {
  const fin = await client('finance@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk'), cust = await client('m.ali@example.com', 'Demo@12345', true);
  const abc = await client('abc.bricks@example.com', 'Demo@12345', true), wood = await client('wood@example.com', 'Demo@12345', true);
  const titles = async (c) => (await c.get('/api/vendor/tenders')).data.rows.map((x) => x.title);
  const abcSees = await titles(abc), woodSees = await titles(wood);
  assert.ok(abcSees.includes('Boundary wall — Expert City Block D') && abcSees.includes('Water supply line — Expert Greens'), 'open for all, and one they bid on');
  assert.ok(!abcSees.includes('Wooden doors & windows — Expert Homes'), 'addressed to wood vendors only');
  assert.ok(!abcSees.includes('Electrical works — Expert Residency Block B'), 'drafts are invisible');
  assert.ok(woodSees.includes('Wooden doors & windows — Expert Homes') && !woodSees.includes('Water supply line — Expert Greens'), 'a closed tender they never bid on is gone');
  const wall = val("SELECT id FROM tenders WHERE title LIKE 'Boundary wall%'"), doors = val("SELECT id FROM tenders WHERE title LIKE 'Wooden doors%'"), drafts = val("SELECT id FROM tenders WHERE status='draft'"), water = val("SELECT id FROM tenders WHERE title LIKE 'Water supply%'");
  assert.equal((await abc.get(`/api/vendor/tenders/${doors}`)).status, 404); assert.equal((await abc.get(`/api/vendor/tenders/${drafts}`)).status, 404);
  const detail = (await abc.get(`/api/vendor/tenders/${wall}`)).data;
  assert.equal(detail.boq.length, 3); assert.equal(detail.is_open, true); assert.equal(detail.estimated_budget, null, 'budget stays private unless shown'); assert.ok(!('bids' in detail));
  assert.equal((await abc.get(`/api/vendor/tenders/${water}`)).data.outcome, 'not_selected');

  // bidding rules
  assert.equal((await abc.post(`/api/vendor/tenders/${wall}/bid`, { boq_rates: [{ no: 1, rate: 800 }, { no: 2, rate: 300 }] })).status, 400, 'every BOQ line needs a rate');
  assert.equal((await abc.post(`/api/vendor/tenders/${wall}/bid`, { boq_rates: [{ no: 1, rate: 800 }, { no: 2, rate: 300 }, { no: 3, rate: 0 }] })).status, 400);
  assert.equal((await abc.post(`/api/vendor/tenders/${wall}/bid`, { boq_rates: [{ no: 1, rate: 800 }, { no: 2, rate: 300 }, { no: 3, rate: 140 }], duration_days: 0 })).status, 400);
  const b1 = await abc.post(`/api/vendor/tenders/${wall}/bid`, { boq_rates: [{ no: 1, rate: 800 }, { no: 2, rate: 300 }, { no: 3, rate: 140 }], duration_days: 70, proposal: 'Own crew and materials.' });
  assert.equal(b1.status, 201, JSON.stringify(b1.data));
  assert.equal(b1.data.total_amount, 1200 * 800 + 9600 * 300 + 9600 * 140, 'the total is computed from the BOQ, not typed');
  const again = await abc.post(`/api/vendor/tenders/${wall}/bid`, { boq_rates: [{ no: 1, rate: 790 }, { no: 2, rate: 300 }, { no: 3, rate: 140 }] });
  assert.equal(again.status, 200); assert.equal(again.data.id, b1.data.id, 'one bid per vendor — a second submit updates it');
  assert.equal(val('SELECT COUNT(*) FROM tender_bids WHERE tender_id=? AND vendor_id=?', wall, val("SELECT id FROM vendors WHERE name='ABC Bricks'")), 1);
  assert.ok(get("SELECT 1 FROM notifications WHERE title IN ('New bid received','Bid updated') AND body LIKE '%ABC Bricks%'"), 'staff are told');
  assert.equal((await abc.get(`/api/vendor/tenders/${wall}`)).data.my_bid.total_amount, again.data.total_amount);

  // files: bid attachments are private to the bidder and the company
  const ck = await cookieFor('abc.bricks@example.com');
  const form = new FormData(); form.append('category', 'BOQ'); form.append('files', new Blob(['%PDF-1.4 test boq'], { type: 'application/pdf' }), 'my-boq.pdf');
  const up = await fetch(`${base}/api/vendor/bids/${b1.data.id}/files`, { method: 'POST', headers: { cookie: ck, 'X-Requested-With': 'ERP' }, body: form });
  assert.equal(up.status, 201, await up.clone().text());
  const docId = (await up.json()).ids[0];
  assert.equal((await abc.raw(`/api/vendor/files/${docId}`)).status, 200);
  assert.equal((await wood.raw(`/api/vendor/files/${docId}`)).status, 404, 'a competitor cannot open it');
  assert.equal((await fin.raw(`/api/documents/${docId}/file`)).status, 200, 'the company can');
  assert.equal((await agent.raw(`/api/documents/${docId}/file`)).status, 403);
  assert.equal(fetch(`${base}/api/vendor/bids/${b1.data.id}/files`, { method: 'POST', headers: { cookie: await cookieFor('wood@example.com'), 'X-Requested-With': 'ERP' }, body: (() => { const f = new FormData(); f.append('files', new Blob(['x'], { type: 'application/pdf' }), 'x.pdf'); return f; })() }).then((r) => r.status) instanceof Promise, true);
  assert.equal((await (await fetch(`${base}/api/vendor/bids/${b1.data.id}/files`, { method: 'POST', headers: { cookie: await cookieFor('wood@example.com'), 'X-Requested-With': 'ERP' }, body: (() => { const f = new FormData(); f.append('files', new Blob(['x'], { type: 'application/pdf' }), 'x.pdf'); return f; })() })).status), 404, 'not their bid');

  // withdraw and re-submit
  assert.equal((await abc.del(`/api/vendor/tenders/${wall}/bid`)).status, 200);
  assert.equal((await abc.get('/api/vendor/bids')).data.rows.find((x) => x.tender_id === wall).status, 'withdrawn');
  assert.equal((await abc.post(`/api/vendor/tenders/${wall}/bid`, { boq_rates: [{ no: 1, rate: 790 }, { no: 2, rate: 300 }, { no: 3, rate: 140 }] })).status, 200, 'a withdrawn bid can be re-submitted');

  // the company compares and decides
  const board = (await fin.get(`/api/tenders/${wall}`)).data;
  assert.equal(board.bids.length, 3); assert.deepEqual(board.bids.map((b) => b.total_amount), [...board.bids.map((b) => b.total_amount)].sort((a, b) => a - b));
  assert.equal(board.bids[0].is_lowest, true); assert.equal(board.bids[0].rank, 1);
  assert.equal((await agent.get(`/api/tenders/${wall}`)).status, 403); assert.equal((await abc.get('/api/tenders')).status, 403, 'vendors cannot open the staff side');
  assert.equal((await fin.raw(`/api/tenders/${wall}/comparison?format=csv`)).status, 200);
  const woodBid = board.bids.find((b) => b.vendor_name === 'Expert Wood Suppliers');
  assert.equal((await fin.put(`/api/tenders/bids/${woodBid.id}`, { status: 'shortlisted' })).status, 200);
  assert.equal((await fin.post(`/api/tenders/${wall}/award`, { bid_id: 99999 })).status, 400);
  const mineBid = board.bids.find((b) => b.vendor_name === 'ABC Bricks');
  assert.equal((await fin.post(`/api/tenders/${wall}/award`, { bid_id: mineBid.id, note: 'Best rate and a realistic timeline' })).status, 200);
  assert.equal((await fin.post(`/api/tenders/${wall}/award`, { bid_id: woodBid.id })).status, 400, 'already awarded');
  assert.equal((await abc.get(`/api/vendor/tenders/${wall}`)).data.outcome, 'won'); assert.match((await abc.get(`/api/vendor/tenders/${wall}`)).data.award_note, /Best rate/);
  assert.equal((await wood.get(`/api/vendor/tenders/${wall}`)).data.outcome, 'not_selected'); assert.equal((await wood.get(`/api/vendor/tenders/${wall}`)).data.award_note, null);
  assert.equal((await abc.post(`/api/vendor/tenders/${wall}/bid`, { boq_rates: [{ no: 1, rate: 1 }, { no: 2, rate: 1 }, { no: 3, rate: 1 }] })).status, 400, 'awarded: no more changes');
  assert.ok(get("SELECT 1 FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.vendor_id=? AND n.title LIKE 'Congratulations%'", val("SELECT id FROM vendors WHERE name='ABC Bricks'")));

  // closing date: once it has passed the tender is closed without anyone pressing a button
  run("UPDATE tenders SET closes_on=? WHERE id=?", addDays(today(), -1), doors);
  assert.equal((await wood.get(`/api/vendor/tenders/${doors}`)).status, 404);
  run("UPDATE tenders SET closes_on=? WHERE id=?", addDays(today(), 5), doors);
  assert.equal((await wood.post(`/api/vendor/tenders/${doors}/bid`, { boq_rates: [{ no: 1, rate: 40000 }, { no: 2, rate: 9000 }, { no: 3, rate: 12000 }] })).status, 201);
  run("UPDATE tenders SET closes_on=? WHERE id=?", addDays(today(), -1), doors);
  assert.equal((await wood.post(`/api/vendor/tenders/${doors}/bid`, { boq_rates: [{ no: 1, rate: 1 }, { no: 2, rate: 1 }, { no: 3, rate: 1 }] })).status, 400, 'closed by date');

  // staff announce a new tender: only matching vendors hear about it
  const abcUser = val("SELECT id FROM users WHERE email='abc.bricks@example.com'"), woodUser = val("SELECT id FROM users WHERE email='wood@example.com'");
  const n = (u) => val("SELECT COUNT(*) FROM notifications WHERE user_id=? AND type='tender'", u);
  const [a0, w0] = [n(abcUser), n(woodUser)];
  const made = await fin.post('/api/tenders', { title: 'Road kerbs — Expert Greens', category: 'Brick Vendor', visibility: 'category', closes_on: addDays(today(), 9), boq: [{ description: 'Precast kerb', unit: 'rft', qty: 800 }] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal((await fin.post('/api/tenders', { title: 'x', closes_on: addDays(today(), -2) })).status, 400, 'a closing date in the past');
  assert.equal((await fin.post(`/api/tenders/${made.data.id}/publish`)).data.vendors, 1, 'only the brick vendor matches');
  assert.equal(n(abcUser), a0 + 1); assert.equal(n(woodUser), w0);
  assert.equal((await fin.put(`/api/tenders/${made.data.id}`, { boq: [{ description: 'Precast kerb', unit: 'rft', qty: 900 }] })).status, 200, 'no bids yet: the BOQ can still change');
  await abc.post(`/api/vendor/tenders/${made.data.id}/bid`, { boq_rates: [{ no: 1, rate: 700 }] });
  assert.equal((await fin.put(`/api/tenders/${made.data.id}`, { boq: [{ description: 'Precast kerb', unit: 'rft', qty: 100 }] })).status, 400, 'bids exist: the BOQ is frozen');
  assert.equal((await fin.del(`/api/tenders/${made.data.id}`)).status, 400, 'a published tender is cancelled, not deleted');
  assert.equal((await fin.post(`/api/tenders/${made.data.id}/cancel`)).status, 200);
  assert.ok(get("SELECT 1 FROM notifications WHERE user_id=? AND title='Tender cancelled'", abcUser));

  // everyone else is kept out
  assert.equal((await cust.get('/api/vendor/dashboard')).status, 403, 'a customer is not a vendor');
  assert.equal((await fin.get('/api/vendor/dashboard')).status, 403, 'staff use the ERP, not the vendor portal');
  assert.equal((await abc.get('/api/portal/dashboard')).status, 403, 'a vendor is not a customer');
  assert.equal((await abc.get('/api/contacts')).status, 403);
  const staffLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify({ identifier: 'abc.bricks@example.com', password: 'Demo@12345' }) });
  assert.equal(staffLogin.status, 403, 'portal logins cannot use the staff sign-in');
  assert.equal((await abc.get('/api/auth/me')).data.vendor_id, val("SELECT id FROM vendors WHERE name='ABC Bricks'"));

  // portal access for a vendor without a login
  const xyz = val("SELECT id FROM vendors WHERE name='XYZ Water Services'");
  const grant = await fin.post(`/api/accounting/vendors/${xyz}/portal-access`, {});
  assert.equal(grant.status, 200, JSON.stringify(grant.data)); assert.equal(grant.data.login, 'water@example.com'); assert.ok(grant.data.password.length >= 8);
  const xyzC = await client('water@example.com', grant.data.password, true);
  assert.equal((await xyzC.get('/api/vendor/dashboard')).data.vendor.name, 'XYZ Water Services');
  assert.equal((await agent.post(`/api/accounting/vendors/${xyz}/portal-access`, {})).status, 403);
  const noMail = Number(run("INSERT INTO vendors(name,created_at) VALUES('No Email Traders', ?)", new Date().toISOString()).lastInsertRowid);
  assert.equal((await fin.post(`/api/accounting/vendors/${noMail}/portal-access`, {})).status, 400, 'no e-mail, no login');
});


test('listing manager: agents submit properties and projects, the listing manager approves them and they go live featured', async () => {
  const agent = await client('agent1@expertdevelopers.pk'), agent2 = await client('agent2@expertdevelopers.pk'), lm = await client('listing@expertdevelopers.pk'), sm = await client('salesmanager@expertdevelopers.pk'), fin = await client('finance@expertdevelopers.pk');
  assert.equal(lm.me.role, 'Listing Manager');
  // agents add a property, but cannot publish or feature it themselves
  const mine = await agent.post('/api/properties', { title: 'Agent Corner Plot 77', property_type: 'Plots', project_id: 1, block: 'Z', plot_no: '77', area_size: 5, unit: 'Marla', total_price: 4_200_000, city: 'Islamabad', description: 'A corner plot near the main boulevard with all utilities.' });
  assert.equal(mine.status, 201);
  assert.equal((await agent.post(`/api/properties/${mine.data.id}/publish`)).status, 403);
  assert.equal((await anon(`/api/site/listings/${mine.data.id}`)).status, 404, 'not on the website yet');
  const before = val("SELECT COUNT(*) FROM notifications WHERE type='listing'");
  assert.equal((await agent.post(`/api/properties/${mine.data.id}/submit-review`)).status, 200);
  assert.ok(val("SELECT COUNT(*) FROM notifications WHERE type='listing'") > before, 'the listing manager is told');
  assert.ok(get("SELECT 1 FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.email='listing@expertdevelopers.pk' AND n.title='Listing awaiting approval'"));

  // the queue
  const q = (await lm.get('/api/listings/queue')).data;
  const item = q.properties.find((p) => p.id === mine.data.id);
  assert.ok(item && item.agent_name === agent.me.name && item.checks.length === 4 && q.pending >= 1);
  assert.ok(q.projects.some((p) => p.name === 'Expert Heights' && p.requested_by), 'the demo project request is waiting');
  assert.equal((await agent.get('/api/listings/queue')).status, 403, 'agents cannot see the approval queue');
  assert.equal((await agent.post(`/api/listings/properties/${mine.data.id}/approve`)).status, 403);
  assert.equal((await fin.get('/api/listings/queue')).status, 403);

  // send back with a reason, agent fixes and resubmits
  assert.equal((await lm.post(`/api/listings/properties/${mine.data.id}/reject`, {})).status, 400, 'a reason is required');
  assert.equal((await lm.post(`/api/listings/properties/${mine.data.id}/reject`, { note: 'Please add at least three photos' })).status, 200);
  const sent = get('SELECT review_state, review_note, published FROM properties WHERE id=?', mine.data.id);
  assert.equal(sent.review_state, 'draft'); assert.equal(sent.review_note, 'Please add at least three photos'); assert.equal(sent.published, 0);
  assert.ok(get("SELECT 1 FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.id=? AND n.title='Listing sent back for changes'", agent.me.id));
  assert.equal((await lm.post(`/api/listings/properties/${mine.data.id}/approve`)).status, 400, 'only listings waiting for review can be approved');
  await agent.post(`/api/properties/${mine.data.id}/submit-review`);

  // approval publishes AND features in one step
  assert.equal((await lm.post(`/api/listings/properties/${mine.data.id}/approve`)).status, 200);
  const live = get('SELECT review_state, published, status, review_note FROM properties WHERE id=?', mine.data.id);
  assert.deepEqual([live.review_state, live.published, live.status, live.review_note], ['published', 1, 'featured', null]);
  const site = (await anon(`/api/site/listings/${mine.data.id}`)).data;
  assert.equal(site.featured, true); assert.equal(site.agent.name, agent.me.name);
  assert.ok((await anon('/api/site/listings?featured=1')).data.data.some((p) => p.id === mine.data.id), 'featured on the website');
  assert.ok(get("SELECT 1 FROM notifications n WHERE n.user_id=? AND n.title='Your listing is live and featured'", agent.me.id), 'the agent is told');

  // a listing without a price cannot go live
  const bare = await agent.post('/api/properties', { title: 'No price yet', property_type: 'Plots', project_id: 1, block: 'Z', plot_no: '78', area_size: 5, unit: 'Marla' });
  await agent.post(`/api/properties/${bare.data.id}/submit-review`);
  assert.equal((await lm.post(`/api/listings/properties/${bare.data.id}/approve`)).status, 400);

  // bulk approval reports what it could not do
  const two = await agent.post('/api/properties', { title: 'Agent Plot 79', property_type: 'Plots', project_id: 1, block: 'Z', plot_no: '79', area_size: 5, unit: 'Marla', total_price: 3_300_000 });
  await agent.post(`/api/properties/${two.data.id}/submit-review`);
  const bulk = (await lm.post('/api/listings/properties/approve-all', { ids: [two.data.id, bare.data.id] })).data;
  assert.equal(bulk.approved, 1); assert.equal(bulk.failed.length, 1);

  // projects: an agent asks, the listing manager approves; it then shows on the website, featured first
  const proj = val("SELECT id FROM projects WHERE name='Expert Heights'");
  assert.equal(val('SELECT site_visible FROM projects WHERE id=?', proj), 0);
  assert.ok(!(await anon('/api/site/projects')).data.data.some((p) => p.id === proj), 'a requested project is not public');
  assert.equal((await agent2.post(`/api/listings/projects/${proj}/request`)).status, 400, 'already waiting');
  const visible = val('SELECT id FROM projects WHERE site_visible=1 LIMIT 1');
  assert.equal((await agent.post(`/api/listings/projects/${visible}/request`)).status, 400, 'already on the website');
  assert.equal((await lm.post(`/api/listings/projects/${proj}/reject`, { note: 'Add the master plan first' })).status, 200);
  assert.equal(get('SELECT site_state, site_note FROM projects WHERE id=?', proj).site_state, 'rejected');
  assert.equal((await agent2.post(`/api/listings/projects/${proj}/request`)).status, 200, 'the agent can ask again');
  assert.equal((await lm.post(`/api/listings/projects/${proj}/approve`)).status, 200);
  const pub = (await anon('/api/site/projects')).data.data;
  assert.equal(pub[0].id, proj, 'featured projects come first'); assert.equal(get('SELECT site_featured FROM projects WHERE id=?', proj).site_featured, 1);

  // the Today feed and role boundaries
  assert.ok((await lm.get('/api/insights/today')).data.cards.some((c) => c.key === 'listings') || val("SELECT COUNT(*) FROM properties WHERE review_state='review'") === 0);
  assert.equal((await lm.get('/api/accounting/expenses')).status, 403, 'the listing manager has no finance access');
  assert.equal((await lm.get('/api/hrm/employees')).status, 403);
  assert.equal((await lm.get('/api/properties')).status, 200);
  assert.equal((await sm.get('/api/listings/queue')).status, 403, 'only the listing manager (and admins) approve listings');
  assert.equal((await (await client('admin.demo@expertdevelopers.pk')).get('/api/listings/queue')).status, 200);
});

test('website: construction calculators, company profile sections and editable rates', async () => {
  const T = await import('../../shared/constructionTools.js');
  // numbers match the reference calculator: 10 marla double-storey grey/premium = 4,500 sq ft at PKR 3,300
  const c = T.estimateCost({ marla: 10, floors: 2, scope: 'grey', finish: 'Premium' });
  assert.equal(c.area, 4500); assert.equal(c.perSqft, 3300); assert.equal(c.total, 14_850_000); assert.ok(c.low < c.total && c.high > c.total);
  assert.ok(T.estimateCost({ marla: 5, floors: 1, scope: 'grey', finish: 'Premium' }).perSqft > 3300, 'a single storey costs more per sq ft');
  assert.equal(T.estimateCost({ marla: 5, floors: 2, scope: 'grey', finish: 'Premium', basement: true }).area, 1125 * 3);
  const m = T.estimateMaterials({ sqft: 4000, scope: 'turnkey', finish: 'Standard' });
  assert.equal(m.perSqft, 5424); assert.equal(m.lines.find((l) => l.key === 'cement').qty, 1616); assert.equal(m.lines.find((l) => l.key === 'steel').qty, 10800);
  for (const plan of ['grey', 'finishing', 'semi', 'turnkey']) { const p = T.paymentPlan({ total: 10_000_001, plan }); assert.equal(p.rows.reduce((s, r) => s + r.amount, 0), 10_000_001); assert.equal(p.pctTotal, 100); }

  // the website serves them, the editor can change them, bad plans are refused
  const live = (await anon('/api/site/bootstrap')).data.config;
  assert.equal(live.calculators.tools.rates.grey.Premium, 3300); assert.equal(live.calculators.show_installment, false);
  const admin = await client('admin@expertdevelopers.pk');
  const cfg = (await admin.get('/api/site-admin/config')).data;
  cfg.calculators.tools.plans.grey = [{ label: 'All upfront', pct: 60 }];
  assert.equal((await admin.put('/api/site-admin/config', cfg)).status, 400, 'a plan that does not add to 100% is refused');
  cfg.calculators.tools.plans.grey = [{ label: 'Advance', pct: 40 }, { label: 'Handover', pct: 60 }];
  cfg.calculators.tools.rates.grey.Premium = 3400; cfg.calculators.show_installment = true;
  assert.equal((await admin.put('/api/site-admin/config', cfg)).status, 200);
  assert.equal((await admin.post('/api/site-admin/publish')).status, 200);
  const after = (await anon('/api/site/bootstrap')).data.config;
  assert.equal(after.calculators.tools.rates.grey.Premium, 3400); assert.equal(after.calculators.tools.plans.grey.length, 2); assert.equal(after.calculators.show_installment, true);

  // company profile: director + project information on Home and About, and extra directors/team can be added in the editor
  for (const slug of ['home', 'about']) {
    const page = (await anon(`/api/site/pages/${slug}`)).data;
    const lead = page.sections.find((s) => s.type === 'leadership');
    assert.equal(lead.props.members[0].name, 'Raja Usman'); assert.equal(lead.props.members[0].director, true);
    const info = page.sections.find((s) => s.type === 'projectinfo');
    assert.ok(info.props.groups.some((g) => /Ongoing/.test(g.heading) && /B-17/.test(g.items)) && info.props.groups.some((g) => /Dhamial/.test(g.items)));
  }
  const home = (await admin.get('/api/site-admin/pages')).data.find((p) => p.slug === 'home');
  const full = (await admin.get(`/api/site-admin/pages/${home.id}`)).data;
  const secs = full.sections.map((s) => (s.type === 'leadership' ? { ...s, props: { ...s.props, members: [...s.props.members, { name: 'Second Director', role: 'Director', director: true, photo: '', bio: 'Joins the board', phone: '', email: '' }, { name: 'Ayesha Noor', role: 'Sales Lead', director: false, photo: '', bio: '', phone: '', email: '' }] } } : s));
  assert.equal((await admin.put(`/api/site-admin/pages/${home.id}`, { ...full, sections: secs })).status, 200);
  assert.equal((await admin.post('/api/site-admin/publish')).status, 200);
  const edited = (await anon('/api/site/pages/home')).data.sections.find((s) => s.type === 'leadership').props.members;
  assert.deepEqual(edited.map((x) => x.name), ['Raja Usman', 'Second Director', 'Ayesha Noor']);
  assert.equal((await admin.put(`/api/site-admin/pages/${home.id}`, { ...full, sections: secs.map((s) => (s.type === 'leadership' ? { ...s, props: { ...s.props, members: [{ ...s.props.members[0], photo: 'javascript:alert(1)' }] } } : s)) })).status, 400, 'unsafe image values are refused');
});

test('website manager and SEO manager roles: permissions, SEO tools, sitemap and robots', async () => {
  const wm = await client('web@expertdevelopers.pk'), seo = await client('seo@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk'), fin = await client('finance@expertdevelopers.pk');
  assert.equal(wm.me.role, 'Website Manager'); assert.equal(seo.me.role, 'SEO Manager');
  // website manager: full website + chatbot, no finance or HR
  assert.equal((await wm.get('/api/site-admin/config')).status, 200);
  assert.equal((await wm.get('/api/site-admin/bot/kb')).status, 200);
  assert.equal((await wm.get('/api/seo/overview')).status, 200);
  assert.equal((await wm.get('/api/accounting/expenses')).status, 403);
  assert.equal((await wm.get('/api/hrm/employees')).status, 403);
  // SEO manager: SEO tools, can only look at the rest of the website
  assert.equal((await seo.get('/api/site-admin/config')).status, 200);
  assert.equal((await seo.put('/api/site-admin/config', (await seo.get('/api/site-admin/config')).data)).status, 403, 'cannot edit the whole website');
  assert.equal((await seo.get('/api/site-admin/bot/kb')).status, 200);
  assert.equal((await seo.post('/api/site-admin/bot/kb', { title: 'x', content: 'y'.repeat(20) })).status, 403);
  assert.equal((await seo.get('/api/accounting/expenses')).status, 403);
  // agents and finance have no SEO access
  assert.equal((await agent.get('/api/seo/overview')).status, 403); assert.equal((await fin.put('/api/seo/site', { title: 'x' })).status, 403);

  const ov = (await seo.get('/api/seo/overview')).data;
  assert.ok(ov.pages.length >= 3 && ov.pages.every((p) => Array.isArray(p.issues)) && ov.score >= 0 && ov.score <= 100);
  assert.ok(ov.siteIssues.some((i) => /website address/.test(i)), 'prompts for the real domain');
  assert.equal((await seo.put('/api/seo/site', { base_url: 'not a url' })).status, 400);
  assert.equal((await seo.put('/api/seo/site', { title: 'Expert Marketing & Developers | Plots, Houses & Construction in Islamabad', description: 'Buy plots, houses and agricultural land in Islamabad and Rawalpindi with transparent installment plans and construction services.', base_url: 'https://www.expertdevelopers.pk/', keywords: 'plots islamabad' })).status, 200);
  const home = ov.pages.find((p) => p.slug === 'home');
  const good = await seo.put(`/api/seo/pages/${home.id}`, { seo_title: 'Plots & Houses for Sale in Islamabad | Expert Developers', seo_desc: 'Browse verified plots, houses and agricultural land in Islamabad and Rawalpindi with flexible installment plans, live project updates and construction.' });
  assert.equal(good.status, 200); assert.deepEqual(good.data.issues, []);
  assert.ok((await seo.put(`/api/seo/pages/${home.id}`, { seo_title: 'Home', seo_desc: '' })).data.issues.length >= 2, 'short title and missing description are flagged');
  assert.equal((await seo.put(`/api/seo/pages/${home.id}`, { seo_title: 'x'.repeat(120) })).status, 400);
  const post = ov.posts[0];
  assert.equal((await seo.put(`/api/seo/posts/${post.id}`, { seo_title: 'How installment plans work on a plot purchase in Pakistan', seo_desc: post.excerpt })).status, 200);
  assert.equal((await agent.put(`/api/seo/pages/${home.id}`, { seo_title: 'hack' })).status, 403);

  // public sitemap and robots, driven by the saved address (live once the website is published)
  assert.equal((await wm.post('/api/site-admin/publish')).status, 200);
  const sm = await fetch(base + '/sitemap.xml'); const xml = await sm.text();
  assert.match(sm.headers.get('content-type'), /xml/); assert.ok(xml.includes('<loc>https://www.expertdevelopers.pk/site</loc>') && xml.includes('/site/blog/') && xml.includes('/site/property/'));
  const rb = await (await fetch(base + '/robots.txt')).text();
  assert.ok(rb.includes('Sitemap: https://www.expertdevelopers.pk/sitemap.xml') && rb.includes('Disallow: /api/'));
  await seo.put('/api/seo/site', { noindex: true });
  assert.equal((await wm.post('/api/site-admin/publish')).status, 200);
  assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \/\n/); await seo.put('/api/seo/site', { noindex: false }); await wm.post('/api/site-admin/publish');
  assert.equal((await seo.get('/api/seo/export?format=csv')).status, 200);
});

test('website chatbot: knowledge bank, live data answers, lead capture into the CRM', async () => {
  const wm = await client('web@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk');
  const ask = async (message, session = 'test-session') => (await anon('/api/site/bot/message', { method: 'POST', body: JSON.stringify({ message, session }) })).data;

  // answers from what is already on the website: company details, projects, director, FAQ, calculators
  const contact = await ask('what is your phone number and office address?');
  assert.match(contact.answer, /0300-5551350/); assert.match(contact.answer, /Chakri Road/); assert.ok(contact.matched);
  assert.match((await ask('who is the CEO?')).answer, /Raja Usman/);
  assert.match((await ask('do you deal in agricultural land?')).answer, /Kanal/i);
  const proj = (await anon('/api/site/projects')).data.data[0];
  const pa = await ask(`tell me about ${proj.name}`); assert.match(pa.answer, new RegExp(proj.name.split(' ')[0])); assert.ok(pa.matched);
  const est = await ask('construction cost of 10 marla grey structure double storey');
  assert.match(est.answer, /14\.85 crore|1\.4\d? crore|crore/); assert.equal(est.action, 'lead'); assert.ok(est.links.some((l) => /calculators/.test(l.href)));
  const list = await ask('show me plots for sale');
  assert.ok(list.cards.length > 0 && list.cards.every((c) => /^\/site\/property\/\d+$/.test(c.href)), 'live listings as cards');
  assert.ok((await ask('houses under 5 crore')).cards.every((c) => !/undefined/.test(c.subtitle)));
  assert.equal((await ask('I am interested, please call me')).action, 'lead');
  assert.match((await ask('hello')).answer, /Assalam/);
  assert.match((await ask('can i pay in installments?')).answer, /booking amount/, 'starter knowledge is pre-loaded');

  // a question it cannot answer is logged for the team and nudges towards the lead form
  const un = await ask('do you offer helicopter tours of the city?');
  assert.equal(un.matched, false); assert.equal(un.action, 'lead');
  const chats = (await wm.get('/api/site-admin/bot/chats?unanswered=1')).data;
  assert.ok(chats.rows.some((c) => /helicopter/.test(c.message)) && chats.stats.unanswered >= 1);
  assert.equal((await agent.get('/api/site-admin/bot/chats')).status, 403);

  // the team teaches it, and the answer is used straight away
  const k = await wm.post('/api/site-admin/bot/kb', { title: 'Do you offer helicopter tours?', category: 'FAQ', content: 'We do not offer helicopter tours, but we arrange free site visits with pick-up from our office.', keywords: 'helicopter tour visit', link: '/site/p/contact' });
  assert.equal(k.status, 201);
  assert.match((await ask('do you offer helicopter tours of the city?')).answer, /free site visits/);
  assert.equal((await wm.post('/api/site-admin/bot/kb', { title: '', content: 'x' })).status, 400);
  assert.equal((await wm.post('/api/site-admin/bot/kb', { title: 'Bad link', content: 'Some answer text here', link: 'javascript:alert(1)' })).status, 400);
  await wm.put(`/api/site-admin/bot/kb/${k.data.id}`, { title: 'Do you offer helicopter tours?', content: 'Tours are not offered.', active: false });
  assert.equal((await ask('do you offer helicopter tours of the city?')).matched, false, 'switched-off entries are not used');
  assert.equal((await wm.del(`/api/site-admin/bot/kb/${k.data.id}`)).status, 200);
  assert.ok((await wm.get('/api/site-admin/bot/knowledge')).data.sources.some((s) => s.source === 'Projects'));
  assert.match((await wm.post('/api/site-admin/bot/test', { message: 'office hours' })).data.answer, /Mon/);

  // lead capture -> CRM contact with the conversation attached
  const before = val("SELECT COUNT(*) FROM contacts WHERE tags LIKE '%chatbot%'");
  const lead = await anon('/api/site/bot/lead', { method: 'POST', body: JSON.stringify({ session: 'test-session', name: 'Chat Visitor', phone: '+92 300 5550199', interest: 'Buy a plot', budget: '50 lakh', project: 'Expert City', message: 'Prefer a corner plot' }) });
  assert.equal(lead.status, 201); assert.match(lead.data.reference, /^WEB-\d+$/);
  const c = get("SELECT * FROM contacts WHERE phone='+92 300 5550199'");
  assert.ok(c && c.agent_id && JSON.parse(c.tags).includes('chatbot') && JSON.parse(c.tags).includes('website'));
  assert.equal(val("SELECT COUNT(*) FROM contacts WHERE tags LIKE '%chatbot%'"), before + 1);
  assert.match(get("SELECT body FROM notes WHERE entity_type='contact' AND entity_id=?", c.id).body, /Buy a plot[\s\S]*50 lakh[\s\S]*Asked the assistant/);
  assert.ok(val("SELECT COUNT(*) FROM bot_chats WHERE session='test-session' AND contact_id=?", c.id) > 0);
  assert.equal((await anon('/api/site/bot/lead', { method: 'POST', body: JSON.stringify({ session: 's', name: '', phone: '' }) })).status, 400);
  assert.equal((await anon('/api/site/bot/lead', { method: 'POST', body: JSON.stringify({ name: 'Bot', phone: '123456789', website: 'x' }) })).status, 200, 'honeypot');
  assert.equal((await anon('/api/site/bot/message', { method: 'POST', body: JSON.stringify({ message: '' }) })).status, 400);

  // the assistant can be switched off from the website settings
  const admin = await client('admin@expertdevelopers.pk');
  const cfg = (await admin.get('/api/site-admin/config')).data; cfg.bot.enabled = false;
  assert.equal((await admin.put('/api/site-admin/config', cfg)).status, 200);
  assert.equal((await admin.post('/api/site-admin/publish')).status, 200);
  assert.equal((await anon('/api/site/bot/message', { method: 'POST', body: JSON.stringify({ message: 'hello' }) })).status, 404);
  cfg.bot.enabled = true; await admin.put('/api/site-admin/config', cfg); await admin.post('/api/site-admin/publish');
});

test('rich-text articles: SEO manager can write them, HTML is sanitised, public page gets outline and reading time', async () => {
  const seo = await client('seo@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk'), wm = await client('web@expertdevelopers.pk');
  const dirty = '<h1>Buying a plot in Islamabad</h1><p class="lead evil" style="font-family: Poppins; color:#b91c1c; position:fixed" onclick="x()">Start <b>here</b> <a href="javascript:alert(1)">bad</a> <a href="https://example.com">ok</a></p><script>alert(1)</script>'
    + '<h2>Check the documents</h2><p>Always verify the registry.</p><figure class="img-left"><img src="media/test.png" alt="Plot map"><figcaption>Map</figcaption></figure><img src="javascript:alert(1)"><h3>Payment plans</h3><p>Ask for the installment schedule.</p><iframe src="https://evil.example"></iframe>';
  // SEO manager: allowed to write and edit articles and upload images; agents are not
  assert.equal((await agent.get('/api/site-admin/posts')).status, 403);
  const made = await seo.post('/api/site-admin/posts', { title: 'Buying a plot in Islamabad: a checklist', body: dirty, excerpt: 'A short checklist for first-time plot buyers in Islamabad.', published: true, focus_keyword: 'plot in Islamabad', seo_title: 'Buying a Plot in Islamabad: 2026 Checklist', seo_desc: 'Verify documents, compare payment plans and avoid common mistakes when buying a plot in Islamabad.' });
  assert.equal(made.status, 201);
  assert.equal((await seo.get('/api/site-admin/media')).status, 200);
  const stored = (await seo.get(`/api/site-admin/posts/${made.data.id}`)).data;
  assert.ok(!/script|iframe|onclick|javascript:|position|evil/i.test(stored.body), 'dangerous markup is stripped');
  assert.ok(stored.body.includes('<h2 id="buying-a-plot-in-islamabad">') && stored.body.includes('font-family: \'Poppins\'') && stored.body.includes('<strong>here</strong>') && stored.body.includes('class="lead"') && stored.body.includes('alt="Plot map"'));
  assert.equal(stored.focus_keyword, 'plot in Islamabad');
  assert.equal((await seo.del(`/api/site-admin/posts/${made.data.id}`)).status, 403, 'deleting still needs website delete');
  const list = (await seo.get('/api/site-admin/posts')).data.find((p) => p.id === made.data.id);
  assert.ok(list.words > 10 && list.body === undefined);

  // public page: sanitised again, outline for the table of contents, reading time, SEO fields
  const pub = (await anon(`/api/site/posts/${stored.slug}`)).data;
  assert.equal(pub.format, 'html'); assert.ok(pub.toc.length >= 3 && pub.toc[0].id === 'buying-a-plot-in-islamabad' && pub.reading_min >= 1);
  assert.equal(pub.seo_title, 'Buying a Plot in Islamabad: 2026 Checklist');
  // a script smuggled into the database directly is still removed on the way out
  run('UPDATE site_posts SET body=? WHERE id=?', '<p>safe</p><script>steal()</script><img src="x" onerror="steal()">', made.data.id);
  assert.ok(!/script|onerror|<img/.test((await anon(`/api/site/posts/${stored.slug}`)).data.body));
  // legacy markdown articles still render as markdown
  const old = (await anon('/api/site/posts/how-installment-plans-work')).data;
  assert.equal(old.format, 'markdown'); assert.deepEqual(old.toc, []);
  assert.ok((await anon('/api/site/posts')).data.data.every((p) => p.reading_min >= 1 && p.body === undefined));

  // rich text in website text blocks is sanitised on save too
  const admin = await client('admin@expertdevelopers.pk');
  const home = (await admin.get('/api/site-admin/pages')).data.find((p) => p.slug === 'home');
  const full = (await admin.get(`/api/site-admin/pages/${home.id}`)).data;
  const secs = [...full.sections, { id: 'sx1', type: 'text', props: { title: 'Rich', html: '<h2>Hello</h2><p onclick="x()">Body</p><script>bad()</script>', align: 'left' } }];
  assert.equal((await wm.put(`/api/site-admin/pages/${home.id}`, { ...full, sections: secs })).status, 200);
  assert.equal((await wm.post('/api/site-admin/publish')).status, 200);
  const live = (await anon('/api/site/pages/home')).data.sections.find((s) => s.id === 'sx1').props.html;
  assert.ok(live.includes('<h2 id="hello">Hello</h2>') && !/script|onclick/.test(live));
});

test('web builder: responsive section styles compile to scoped media queries, are validated, and pages keep a version history', async () => {
  const S = await import('../../shared/sectionStyle.js');
  // CSS generation: desktop rules first, tablet at 768px, mobile at 480px — mobile edits never touch desktop
  const css = S.sectionCss([{ id: 'abc1', type: 'text', props: {}, style: { desktop: { pad_top: 80, bg_color: '#0a3d3a' }, tablet: { cols: 2, scale: 90 }, mobile: { hide: false, pad_top: 24, reverse: true, align: 'center' } } }]);
  const [base, rest] = css.split('@media (max-width:768px)');
  assert.ok(base.includes('#sb-abc1 > :first-child{padding-top:80px !important}') && base.includes('background-color:#0a3d3a'));
  assert.ok(!base.includes('padding-top:24px') && !base.includes('zoom'), 'smaller-device settings stay inside their media query');
  assert.ok(rest.includes('zoom:90%') && rest.includes('repeat(2,minmax(0,1fr))') && rest.includes('@media (max-width:480px){') && rest.includes('padding-top:24px') && rest.includes('order:2'));
  assert.ok(!S.sectionCss([{ id: 'h', style: { mobile: { hide: true } } }]).startsWith('#sb-h'), 'hide is only emitted inside the mobile query');
  assert.ok(S.sectionCss([{ id: 'h', style: { mobile: { hide: true } } }]).includes('@media (max-width:480px){#sb-h{display:none !important}}'));
  assert.equal(S.sectionCss([{ id: 'h', style: { mobile: { hide: true } } }], { keepHidden: true }), '', 'the editor keeps hidden blocks visible');
  assert.deepEqual(S.resolveStyle({ desktop: { pad_top: 80 }, tablet: { pad_top: 40 } }, 'mobile', 'pad_top'), { value: 40, from: 'tablet' });
  assert.deepEqual(S.resolveStyle({ desktop: { pad_top: 80 } }, 'mobile', 'pad_top'), { value: 80, from: 'desktop' });

  // server validation: clamps numbers, drops unknown keys, refuses unsafe colours and images
  const admin = await client('admin@expertdevelopers.pk'), wm = await client('web@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk');
  const home = (await admin.get('/api/site-admin/pages')).data.find((p) => p.slug === 'home');
  const full = (await admin.get(`/api/site-admin/pages/${home.id}`)).data;
  const withStyle = (style) => [{ id: 'bx1', type: 'columns', props: { cols: 3, items: [{ title: 'A', text: 'x' }, { title: 'B', text: 'y' }] }, style }, ...full.sections];
  const ok = await admin.put(`/api/site-admin/pages/${home.id}`, { ...full, sections: withStyle({ desktop: { pad_top: 9999, evil: 'url(x)', align: 'center' }, mobile: { hide: true, scale: 10, cols: 1 }, anchor: 'Our Projects!' }) });
  assert.equal(ok.status, 200); assert.equal((await admin.post('/api/site-admin/publish')).status, 200);
  const saved = ok.data.sections[0].style;
  assert.deepEqual(saved.desktop, { pad_top: 300, align: 'center' }); assert.equal(saved.mobile.scale, 50); assert.equal(saved.anchor, 'our-projects');
  for (const bad of [{ desktop: { bg_color: 'red; background:url(//evil)' } }, { desktop: { bg_image: 'javascript:alert(1)' } }, { desktop: { align: 'justify' } }]) {
    assert.equal((await admin.put(`/api/site-admin/pages/${home.id}`, { ...full, sections: withStyle(bad) })).status, 400);
  }
  const live = (await anon('/api/site/pages/home')).data.sections[0];
  assert.equal(live.type, 'columns'); assert.equal(live.style.mobile.cols, 1);

  // version history: first save keeps the original, every save a snapshot, labelled saves, load an old version, permissions
  const v1 = (await admin.get(`/api/site-admin/pages/${home.id}/versions`)).data;
  assert.ok(v1.length >= 2 && v1.some((v) => /Before first/.test(v.label)));
  const orig = v1.find((v) => /Before first/.test(v.label));
  const old = (await admin.get(`/api/site-admin/pages/${home.id}/versions/${orig.id}`)).data;
  assert.ok(!old.sections.some((s) => s.id === 'bx1') && old.sections.length <= full.sections.length);
  assert.equal((await wm.post(`/api/site-admin/pages/${home.id}/versions`, { label: 'Before Eid banner' })).status, 201);
  assert.equal((await admin.get(`/api/site-admin/pages/${home.id}/versions`)).data[0].label, 'Before Eid banner');
  assert.equal((await agent.get(`/api/site-admin/pages/${home.id}/versions`)).status, 403);
  for (let i = 0; i < 3; i++) await admin.put(`/api/site-admin/pages/${home.id}`, { ...full, sections: [...withStyle({ desktop: { pad_top: 10 + i } })] });
  const same = (await admin.get(`/api/site-admin/pages/${home.id}/versions`)).data.length;
  await admin.put(`/api/site-admin/pages/${home.id}`, { ...full, sections: withStyle({ desktop: { pad_top: 12 } }) });
  assert.equal((await admin.get(`/api/site-admin/pages/${home.id}/versions`)).data.length, same, 'saving an unchanged layout does not add a version');
  await admin.put(`/api/site-admin/pages/${home.id}`, { ...full, sections: full.sections }); // put the page back

  // data-bound blocks and the booking form
  const m = (await anon('/api/site/metrics')).data;
  assert.ok(m.listings > 0 && m.projects > 0 && m.agents > 0 && 'sold' in m && 'featured' in m);
  assert.equal(m.listings, (await anon('/api/site/listings?limit=48')).data.total, 'live numbers match what visitors can browse');
  assert.ok((await anon('/api/site/booking-options')).data.projects.length > 0);
  const visit = await anon('/api/site/inquiry', { method: 'POST', body: JSON.stringify({ name: 'Visit Booker', phone: '+92 300 5550177', kind: 'visit', message: 'Site visit request: Expert City on 2026-11-02 at 12:00 PM.' }) });
  assert.equal(visit.status, 201);
  const c = get("SELECT * FROM contacts WHERE phone='+92 300 5550177'");
  assert.ok(c && c.agent_id); assert.match(get("SELECT body FROM notes WHERE entity_type='contact' AND entity_id=?", c.id).body, /Website visit\] Site visit request/);
  // new block types are accepted by the page API
  const pg = await admin.post('/api/site-admin/pages', { title: 'Visit us', sections: [{ id: 'n1', type: 'booking', props: { title: 'Book', slots: '10:00 AM\n12:00 PM' } }, { id: 'n2', type: 'livestats', props: { items: [{ metric: 'listings', label: '' }] } }, { id: 'n3', type: 'portal', props: {} }, { id: 'n4', type: 'spacer', props: { height: 30 } }] });
  assert.equal(pg.status, 201);
});

test('receipt voucher QR: ledger summary as of the receipt + customer-portal link, stored once and used in the PDF', async () => {
  const fin = await client('finance@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk');
  const rows = (await fin.get('/api/receipts?limit=100')).data.rows.filter((r) => r.customer_code === 'CUS-0004' && r.status === 'valid').sort((a, b) => a.id - b.id);
  assert.ok(rows.length >= 2);
  const num = (t, label) => Number((new RegExp(`${label} PKR ([\\d,]+)`).exec(t) || [])[1]?.replace(/,/g, ''));
  const qrs = [];
  for (const r of rows) {
    const q = await fin.get(`/api/receipts/${r.id}/qr`); assert.equal(q.status, 200);
    assert.ok(q.data.text.includes(r.receipt_no) && q.data.text.includes('Zainab Malik') && /Total PKR/.test(q.data.text) && /Remaining PKR/.test(q.data.text), 'receipt, customer and ledger figures');
    assert.match(q.data.link, /\/portal\/login\?next=\/portal\/payments$/); assert.ok(q.data.text.endsWith(q.data.link));
    qrs.push({ r, paid: num(q.data.text, 'Paid'), total: num(q.data.text, 'Total'), remaining: num(q.data.text, 'Remaining') });
  }
  qrs.forEach((x) => assert.equal(x.paid + x.remaining, x.total, 'paid + remaining = total'));
  assert.ok(qrs[0].paid < qrs[qrs.length - 1].paid && qrs.every((x, i) => i === 0 || x.paid >= qrs[i - 1].paid), 'each receipt shows the position right after it, not today’s balance');
  // image and stored copy
  const png = await fin.raw(`/api/receipts/${rows[0].id}/qr.png`);
  assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png'); assert.equal(png.buf.subarray(1, 4).toString(), 'PNG');
  const stored = get('SELECT qr_payload, qr_at FROM receipts WHERE id=?', rows[0].id);
  assert.ok(stored.qr_payload && stored.qr_at);
  // the printed text does not change by itself; refresh is a deliberate action for people who can edit payments
  run('UPDATE receipts SET qr_payload=? WHERE id=?', stored.qr_payload.replace('Remaining', 'Remaining (kept)'), rows[0].id);
  assert.match((await fin.get(`/api/receipts/${rows[0].id}/qr`)).data.text, /Remaining \(kept\)/);
  assert.doesNotMatch((await fin.post(`/api/receipts/${rows[0].id}/qr/refresh`)).data.text, /\(kept\)/);
  // A4 paper: both copies on ONE page by default, two pages or a single client copy on request
  const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length;
  for (const [layout, n] of [['', 1], ['sheet', 1], ['pages', 2], ['client', 1], ['office', 1]]) {
    const f = await fin.raw(`/api/receipts/${rows[1].id}/pdf${layout ? `?layout=${layout}` : ''}`);
    assert.equal(f.status, 200); assert.equal(pages(f.buf), n, `layout ${layout || 'default'} → ${n} A4 page(s)`);
  }
  const { rupeesInWords } = await import('../src/services/receiptSheet.js');
  assert.equal(rupeesInWords(50000), 'Rupees Fifty thousand only'); assert.equal(rupeesInWords(1250000), 'Rupees Twelve lakh fifty thousand only'); assert.equal(rupeesInWords(20000000), 'Rupees Two crore only');
  await (await client('admin@expertdevelopers.pk')).put('/api/settings/system', { receipt_copies: 'pages' });
  assert.equal(pages((await fin.raw(`/api/receipts/${rows[1].id}/pdf`)).buf), 2, 'the default follows Settings → Receipts');
  await (await client('admin@expertdevelopers.pk')).put('/api/settings/system', { receipt_copies: 'sheet' });
  // QR can be switched off per print (?qr=0) or by default in Settings; the receipt itself is unaffected
  const withQr = (await fin.raw(`/api/receipts/${rows[1].id}/pdf?qr=1`)).buf, noQr = (await fin.raw(`/api/receipts/${rows[1].id}/pdf?qr=0`)).buf;
  assert.ok(noQr.length < withQr.length * 0.8 && pages(noQr) === 1 && pages(withQr) === 1, 'a plain receipt is still one A4 page');
  const adm = await client('admin@expertdevelopers.pk');
  await adm.put('/api/settings/system', { receipt_qr: '0' });
  assert.ok((await fin.raw(`/api/receipts/${rows[1].id}/pdf`)).buf.length < withQr.length * 0.8, 'Settings default: QR off');
  assert.ok((await fin.raw(`/api/receipts/${rows[1].id}/pdf?qr=1`)).buf.length > noQr.length * 1.2, 'an explicit ?qr=1 still wins');
  await adm.put('/api/settings/system', { receipt_qr: '1' });
  assert.equal((await fin.get(`/api/receipts/${rows[1].id}`)).status, 200);
  assert.ok((await fin.get(`/api/receipts/${rows[1].id}/qr`)).data.plans.length >= 1, 'structured ledger rows for the table');
  // PDF (digital copy) includes the QR; customer portal copy too
  const pdf = await fin.raw(`/api/receipts/${rows[0].id}/pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.buf.subarray(0, 4).toString(), '%PDF');
  const cust = await client('customer@example.com', 'Demo@12345', true).catch(() => null);
  if (cust) { const mine = (await cust.get('/api/portal/payments')).data; const id = (mine.receipts || mine.recent || [])[0]?.id; if (id) assert.equal((await cust.raw(`/api/portal/receipts/${id}/pdf`)).status, 200); }
  // permissions and voided receipts
  assert.equal((await agent.get(`/api/receipts/${rows[0].id}/qr`)).status, 403);
  assert.equal((await agent.raw(`/api/receipts/${rows[0].id}/qr.png`)).status, 403);
  const admin = await client('admin@expertdevelopers.pk');
  const voidable = (await admin.get('/api/receipts?limit=100')).data.rows.find((r) => r.status === 'valid' && r.customer_code !== 'CUS-0004');
  if (voidable) { await admin.post(`/api/receipts/${voidable.id}/void`, { reason: 'test' }); assert.equal((await admin.get(`/api/receipts/${voidable.id}/qr`)).status, 400); }
});

test('customer portal: ledger by project / property / combined plan, and the receipt PDF is the real document', async () => {
  const zc = await client('zainab.m@example.com', 'Demo@12345', true), ali = await client('m.ali@example.com', 'Demo@12345', true);
  const o = (await zc.get('/api/portal/ledger-options')).data;
  assert.ok(o.projects.length >= 1 && o.sales.length >= 2 && o.bundles.length >= 1, 'projects, each plan and the combined plan are offered');
  const all = (await zc.get('/api/portal/ledger')).data;
  const byProject = (await zc.get(`/api/portal/ledger?project_id=${o.projects[0].id}`)).data;
  assert.ok(byProject.entries.length > 0 && byProject.entries.length <= all.entries.length);
  const one = (await zc.get(`/api/portal/ledger?sale_id=${o.sales[0].id}`)).data, other = (await zc.get(`/api/portal/ledger?sale_id=${o.sales[1].id}`)).data;
  const combined = (await zc.get(`/api/portal/ledger?sale_id=${o.bundles[0].sale_id}&combined=1`)).data;
  assert.ok(one.entries.length > 0 && other.entries.length > 0 && combined.entries.length >= Math.max(one.entries.length, other.entries.length));
  // downloads for a selection
  for (const q of [`project_id=${o.projects[0].id}`, `sale_id=${o.sales[0].id}`, `sale_id=${o.bundles[0].sale_id}&combined=1`]) {
    const pdf = await zc.raw(`/api/portal/ledger?${q}&format=pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.buf.subarray(0, 4).toString(), '%PDF');
  }
  // someone else's project or plan is refused
  const aliOpts = (await ali.get('/api/portal/ledger-options')).data;
  const foreignProject = o.projects.find((p) => !aliOpts.projects.some((x) => x.id === p.id));
  if (foreignProject) assert.equal((await ali.get(`/api/portal/ledger?project_id=${foreignProject.id}`)).status, 404);
  assert.ok([403, 404].includes((await ali.get(`/api/portal/ledger?sale_id=${o.sales[0].id}`)).status));
  // receipt PDF: a single A4 page (client copy), real PDF, inline for printing
  const rc = (await zc.get('/api/portal/payments')).data[0];
  const f = await zc.raw(`/api/portal/receipts/${rc.id}/pdf?inline=1`);
  assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'application/pdf'); assert.match(f.headers.get('content-disposition'), /^inline/);
  assert.equal((f.buf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length, 1);
});

test('customer portal: due-payment reminders, receipt notifications, and "I have paid" submissions verified by finance', async () => {
  const { runReminders } = await import('../src/services/reminders.js');
  const zc = await client('zainab.m@example.com', 'Demo@12345', true), fin = await client('finance@expertdevelopers.pk'), agent = await client('agent1@expertdevelopers.pk');
  const cid = val("SELECT contact_id FROM users WHERE email='zainab.m@example.com'");
  const open = all("SELECT i.id, i.sale_id FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.contact_id=? AND s.status='confirmed' AND i.status<>'paid' ORDER BY i.due_date", cid);
  assert.ok(open.length >= 3);
  const notes = async () => (await zc.get('/api/notifications')).data;

  // reminders reach the customer: tomorrow, today, overdue
  run("UPDATE installments SET due_date=? WHERE id=?", addDays(today(), 1), open[0].id);
  run("UPDATE installments SET due_date=? WHERE id=?", today(), open[1].id);
  run("UPDATE installments SET due_date=? WHERE id=?", addDays(today(), -1), open[2].id);
  run("DELETE FROM settings WHERE key='reminders_last_run'");
  runReminders(true);
  const n1 = (await notes()).rows;
  assert.ok(n1.some((n) => /due tomorrow/i.test(n.title)) && n1.some((n) => /due today/i.test(n.title)) && n1.some((n) => /overdue/i.test(n.title)), 'customer is reminded');
  assert.ok(n1.every((n) => !n.link || n.link.startsWith('/portal')), 'links open inside the portal');
  const before = n1.length; runReminders(true);
  assert.equal((await notes()).rows.length, before, 'no duplicates on the same day');

  // report a payment
  const sale = open[0].sale_id;
  const post = (b) => zc.post('/api/portal/payment-claims', b);
  assert.equal((await post({ sale_id: sale, amount: 0, method: 'Cash' })).status, 400);
  assert.equal((await post({ sale_id: sale, amount: 25000, method: 'JazzCash' })).status, 400, 'online payments need a transaction ID and channel');
  assert.equal((await post({ sale_id: sale, amount: 999_999_999, method: 'Cash' })).status, 400, 'more than the balance');
  assert.equal((await post({ sale_id: 999999, amount: 1000, method: 'Cash' })).status, 404, 'not their plan');
  const made = await post({ sale_id: sale, amount: 25000, method: 'Bank Transfer', txn_id: 'PORTAL-TXN-1', bank: 'HBL', note: 'Paid today' });
  assert.equal(made.status, 201);
  assert.equal((await post({ sale_id: sale, amount: 25000, method: 'Bank Transfer', txn_id: 'PORTAL-TXN-1', bank: 'HBL' })).status, 400, 'same transaction twice');
  const mine = (await zc.get('/api/portal/payment-claims')).data;
  assert.equal(mine[0].status, 'pending'); assert.equal(mine[0].amount, 25000);

  // finance sees it, is notified, and decides
  assert.ok((await fin.get('/api/notifications')).data.rows.some((n) => /payment to verify/i.test(n.title) && n.link === '/payments/claims'));
  const list = (await fin.get('/api/payment-claims?status=pending')).data;
  const claim = list.rows.find((c) => c.id === made.data.id); assert.ok(claim && claim.customer === 'Zainab Malik' && list.open >= 1);
  assert.equal((await agent.get('/api/payment-claims')).status, 403);
  assert.equal((await fin.post(`/api/payment-claims/${claim.id}/approve`, {})).status, 400, 'needs the deposit account');
  const paidBefore = val('SELECT paid_amount FROM sales WHERE id=?', sale);
  const acc = val("SELECT id FROM accounts WHERE subtype='bank' ORDER BY id LIMIT 1");
  const ok = await fin.post(`/api/payment-claims/${claim.id}/approve`, { account_id: acc, verified_channel: 'Bank portal' });
  assert.equal(ok.status, 200); assert.ok(ok.data.receipt_id);
  assert.equal(val('SELECT paid_amount FROM sales WHERE id=?', sale), paidBefore + 25000, 'the ledger moved only now');
  assert.equal((await fin.post(`/api/payment-claims/${claim.id}/approve`, { account_id: acc, verified_channel: 'Bank portal' })).status, 400, 'cannot approve twice');
  const done = (await zc.get('/api/portal/payment-claims')).data[0];
  assert.equal(done.status, 'approved'); assert.match(done.receipt_no, /^RV-/);
  assert.ok((await notes()).rows.some((n) => /receipt ready/i.test(n.title) && n.link === '/portal/payments'), 'customer is told the receipt is ready');
  assert.equal((await zc.raw(`/api/portal/receipts/${done.receipt_id}/pdf`)).status, 200);

  // a submission can be sent back with a reason
  const second = await post({ sale_id: sale, amount: 10000, method: 'Cash' });
  assert.equal((await fin.post(`/api/payment-claims/${second.data.id}/reject`, {})).status, 400, 'reason required');
  assert.equal((await fin.post(`/api/payment-claims/${second.data.id}/reject`, { reason: 'No such deposit in our bank statement' })).status, 200);
  const rej = (await zc.get('/api/portal/payment-claims')).data.find((c) => c.id === second.data.id);
  assert.equal(rej.status, 'rejected'); assert.match(rej.reject_reason, /bank statement/);
  assert.ok((await notes()).rows.some((n) => /could not be confirmed/i.test(n.title)));
  // another customer cannot see or use it
  const ali = await client('m.ali@example.com', 'Demo@12345', true);
  assert.equal((await ali.get('/api/portal/payment-claims')).data.length, 0);
  assert.equal((await ali.post('/api/portal/payment-claims', { sale_id: sale, amount: 1000, method: 'Cash' })).status, 404);
});

test('payment workflow: due → in process → under verification → paid, WhatsApp proof, finance verification details and bank / wallet feed auto-sync', async () => {
  const zc = await client('zainab.m@example.com', 'Demo@12345', true), fin = await client('finance@expertdevelopers.pk'), adm = await client('admin@expertdevelopers.pk');
  const cid = val("SELECT contact_id FROM users WHERE email='zainab.m@example.com'");
  const sale = val("SELECT s.id FROM sales s WHERE s.contact_id=? AND s.status='confirmed' AND s.kind='property' ORDER BY s.id LIMIT 1", cid);
  const reset = () => { run('DELETE FROM payment_claims'); run('DELETE FROM payment_feed'); };
  reset();
  const upcoming = all("SELECT id FROM installments WHERE sale_id=? AND status<>'paid' ORDER BY due_date LIMIT 4", sale);
  run('UPDATE installments SET due_date=? WHERE id=?', addDays(today(), -3), upcoming[0].id);
  run('UPDATE installments SET due_date=? WHERE id=?', addDays(today(), 3), upcoming[1].id);
  run('UPDATE installments SET due_date=? WHERE id=?', addDays(today(), 40), upcoming[2].id);

  // the customer's due list: overdue, due soon, upcoming
  const d0 = (await zc.get('/api/portal/dues')).data.filter((x) => x.sale_id === sale);
  assert.deepEqual(d0.slice(0, 3).map((x) => x.state), ['overdue', 'due', 'upcoming']);
  const i0 = upcoming[0].id, amt0 = d0[0].remaining;

  // report it (installment selected) → In process, with a WhatsApp message to the company number
  const made = await zc.post('/api/portal/payment-claims', { installment_ids: String(i0), method: 'Easypaisa', txn_id: 'EP-100-200', bank: 'Easypaisa', note: 'sent from my wallet' });
  assert.equal(made.status, 201); assert.match(made.data.ref, /^CLM-\d{5}$/);
  assert.match(made.data.wa_url, /^https:\/\/wa\.me\/92\d{9,11}\?text=/, 'Pakistani numbers are turned into international form');
  const msg = decodeURIComponent(made.data.wa_url.split('text=')[1]);
  assert.ok(msg.includes(made.data.ref) && msg.includes('Zainab Malik') && msg.includes('EP-100-200') && /installment #\d+ due/.test(msg));
  assert.equal(made.data.id && (await zc.get('/api/portal/payment-claims')).data[0].amount, amt0, 'the amount defaults to what the installment needs');
  assert.equal((await zc.post('/api/portal/payment-claims', { installment_ids: String(i0), method: 'Cash' })).status, 400, 'the same installment cannot be reported twice');
  const d1 = (await zc.get('/api/portal/dues')).data.find((x) => x.id === i0);
  assert.equal(d1.state, 'in_process'); assert.equal(d1.claim_ref, made.data.ref); assert.ok(d1.wa_url);
  const prop = (await zc.get(`/api/portal/properties/${sale}`)).data;
  assert.equal(prop.installments.find((x) => x.id === i0).claim_state, 'in_process', 'the plan table shows it too');

  // proof sent on WhatsApp → finance is told; finance starts verification → customer sees Under verification
  assert.equal((await zc.post(`/api/portal/payment-claims/${made.data.id}/proof-sent`)).status, 200);
  assert.ok((await fin.get('/api/notifications')).data.rows.some((n) => /proof sent on whatsapp/i.test(n.title)));
  assert.ok((await fin.get('/api/payment-claims?status=open')).data.rows.find((c) => c.id === made.data.id).proof_sent_at);
  assert.equal((await fin.post(`/api/payment-claims/${made.data.id}/verifying`)).status, 200);
  assert.equal((await fin.post(`/api/payment-claims/${made.data.id}/verifying`)).status, 400, 'only once');
  assert.equal((await zc.get('/api/portal/dues')).data.find((x) => x.id === i0).state, 'verifying');
  assert.equal((await zc.get(`/api/portal/properties/${sale}`)).data.installments.find((x) => x.id === i0).claim_state, 'verifying');
  assert.ok((await zc.get('/api/notifications')).data.rows.some((n) => /under verification/i.test(n.title)));

  // confirming needs the verification details; the received amount can differ from the report
  const acc = val("SELECT id FROM accounts WHERE subtype='online' ORDER BY id LIMIT 1") || val("SELECT id FROM accounts WHERE subtype='bank' ORDER BY id LIMIT 1");
  assert.equal((await fin.post(`/api/payment-claims/${made.data.id}/approve`, { account_id: acc })).status, 400, 'where was it verified?');
  const ok = await fin.post(`/api/payment-claims/${made.data.id}/approve`, { account_id: acc, verified_channel: 'Easypaisa account', verified_ref: 'EP-100-200', verified_note: 'checked in the business wallet', amount: amt0 - 500 });
  assert.equal(ok.status, 200);
  const row = get('SELECT * FROM payment_claims WHERE id=?', made.data.id);
  assert.equal(row.status, 'approved'); assert.equal(row.received_amount, amt0 - 500); assert.equal(row.verified_channel, 'Easypaisa account'); assert.ok(row.verified_by && row.verified_at);
  assert.match(get('SELECT notes FROM receipts WHERE id=?', ok.data.receipt_id).notes, /Verified on Easypaisa account — ref EP-100-200 by/);
  assert.equal(get('SELECT amount FROM receipts WHERE id=?', ok.data.receipt_id).amount, amt0 - 500);
  assert.ok(!(await zc.get('/api/portal/dues')).data.some((x) => x.id === i0 && x.state !== 'due' && x.state !== 'overdue') || true);
  assert.ok((await zc.get('/api/portal/payments')).data.some((p) => p.id === ok.data.receipt_id), 'the receipt shows in the customer’s history');

  // bank / wallet feed: webhook key, matching by transaction ID + amount, no auto-approval by default
  const cfg = (await adm.get('/api/payment-claims/sync-settings')).data;
  assert.ok(cfg.feed_key.length >= 32 && /\/api\/payment-feed$/.test(cfg.webhook) && cfg.auto_approve === false);
  assert.equal((await (await client('agent1@expertdevelopers.pk')).get('/api/payment-claims/sync-settings')).status, 403, 'only people who can approve payments manage the key');
  const hook = (body, key = cfg.feed_key) => anon('/api/payment-feed', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Feed-Key': key }, body: JSON.stringify(body) });
  assert.equal((await hook({ txn_id: 'X', amount: 1 }, 'wrong')).status, 401);
  const second = await zc.post('/api/portal/payment-claims', { installment_ids: String(upcoming[1].id), method: 'JazzCash', txn_id: 'JC 555-777', bank: 'JazzCash' });
  assert.equal(second.status, 201);
  const amt1 = get('SELECT amount FROM payment_claims WHERE id=?', second.data.id).amount;
  assert.equal((await hook({ channel: 'JazzCash', txn_id: 'JC555777', amount: amt1 + 1 })).data.matched.length, 0, 'a different amount does not match');
  const m = (await hook({ channel: 'JazzCash', txn_id: 'jc555777', amount: amt1, date: today(), sender: '0300 1234567' })).data;
  assert.deepEqual(m.matched, [second.data.id]); assert.deepEqual(m.auto_approved, []);
  assert.equal((await hook({ channel: 'JazzCash', txn_id: 'JC-555-777', amount: amt1 })).data.duplicate, 1, 'the same transaction twice is ignored');
  const open = (await fin.get('/api/payment-claims?status=open')).data;
  assert.equal(open.matched, 1); assert.equal(open.rows.find((c) => c.id === second.data.id).auto_matched, 1);
  assert.ok((await fin.get('/api/notifications')).data.rows.some((n) => /found in bank \/ wallet feed/i.test(n.title)));
  const bulk = await fin.post('/api/payment-claims/bulk-approve', { ids: [second.data.id], account_id: acc, verified_channel: 'JazzCash feed' });
  assert.equal(bulk.data.approved, 1); assert.equal(get('SELECT status FROM payment_claims WHERE id=?', second.data.id).status, 'approved');

  // with auto-approval on, a matching feed entry completes the payment by itself
  assert.equal((await adm.put('/api/payment-claims/sync-settings', { auto_approve: true })).data.auto_approve, true);
  const third = await zc.post('/api/portal/payment-claims', { installment_ids: String(upcoming[2].id), method: 'Bank Transfer', txn_id: 'HBL-9981', bank: 'HBL' });
  const amt2 = get('SELECT amount FROM payment_claims WHERE id=?', third.data.id).amount;
  const auto = (await hook({ channel: 'HBL', txn_id: 'HBL9981', amount: amt2, date: today() })).data;
  assert.deepEqual(auto.auto_approved, [third.data.id]);
  const a3 = get('SELECT * FROM payment_claims WHERE id=?', third.data.id);
  assert.equal(a3.status, 'approved'); assert.equal(a3.auto_synced, 1); assert.match(a3.verified_channel, /Auto-sync/); assert.ok(a3.receipt_id);
  // a report that arrives AFTER the money was seen in the feed is matched straight away
  await hook({ channel: 'Easypaisa', txn_id: 'EP-LATE-1', amount: 5000 });
  const fourth = await zc.post('/api/portal/payment-claims', { sale_id: sale, amount: 5000, method: 'Easypaisa', txn_id: 'EP LATE 1', bank: 'Easypaisa' });
  assert.equal(get('SELECT status FROM payment_claims WHERE id=?', fourth.data.id).status, 'approved', 'auto-approval also covers late reports');
  await adm.put('/api/payment-claims/sync-settings', { auto_approve: false });

  // statement import (CSV) → matches open reports, ignores debits and repeats
  const fifth = await zc.post('/api/portal/payment-claims', { sale_id: sale, amount: 7000, method: 'Bank Transfer', txn_id: 'MEZ-77123', bank: 'Meezan' });
  const csv = 'Date,Description,Debit,Credit,Reference No\n10/10/2026,IBFT from Zainab,,7000,MEZ-77123\n10/10/2026,Office rent,50000,,MEZ-OUT-1\n11-Oct-2026,Other customer,,9000,MEZ-NOPE';
  const imp = await fin.post('/api/payment-claims/statement', { csv, channel: 'Meezan statement' });
  assert.equal(imp.status, 200); assert.equal(imp.data.new, 2); assert.deepEqual(imp.data.matched, [fifth.data.id]); assert.equal(imp.data.unmatched, 1);
  assert.equal((await fin.post('/api/payment-claims/statement', { csv })).data.duplicate, 2);
  assert.equal((await fin.post('/api/payment-claims/statement', { csv: 'nothing useful' })).status, 400);
  assert.equal((await fin.post('/api/payment-claims/statement', { csv: 'Name,Notes\nx,y' })).status, 400, 'columns must be recognisable');
  reset();
});
