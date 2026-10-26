import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-onbchk-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { get, run, val } = await import('../src/db.js');
const { addDays, today } = await import('../src/util.js');
const { addWorkingDays, calendarChecker, inWorkingHours } = await import('../src/services/workCalendar.js');
const { runOnboardingReminders, progressOf } = await import('../src/services/onboarding.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, password = 'Demo@12345') {
  const jar = {};
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const l = await call('POST', '/api/auth/login', { identifier, password });
  assert.equal(l.status, 200, `login failed for ${identifier}`);
  return { get: (u) => call('GET', u), post: (u, b, h) => call('POST', u, b || {}, h), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}
const empOf = (email) => get('SELECT * FROM employees WHERE user_id=(SELECT id FROM users WHERE email=?)', email);
const userId = (email) => val('SELECT id FROM users WHERE email=?', email);
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

let hr, agent2, manager, agent1, tpl, onb;

test('templates: HR gets a neutral starter template, other staff cannot manage templates', async () => {
  hr = await client('hr@expertdevelopers.pk');
  agent2 = await client('agent2@expertdevelopers.pk');
  manager = await client('salesmanager@expertdevelopers.pk');
  agent1 = await client('agent1@expertdevelopers.pk');
  const list = await hr.get('/api/hrm/onboarding/templates');
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 1);
  const t = (await hr.get(`/api/hrm/onboarding/templates/${list.data[0].id}`)).data;
  const cats = new Set(t.items.map((i) => i.category));
  for (const c of ['profile', 'documents', 'policies', 'accounts', 'equipment', 'training', 'manager_review']) assert.ok(cats.has(c), `starter covers ${c}`);
  assert.equal(/CNIC|Emirates|SSN|SIN\b|National Insurance/i.test(JSON.stringify(t.items)), false, 'no country-specific identifier is required by default');
  assert.equal((await agent1.get('/api/hrm/onboarding/templates')).status, 403);
  assert.equal((await agent1.post('/api/hrm/onboarding/templates', { name: 'X', items: [{ title: 'a' }] })).status, 403);
  assert.equal((await hr.post('/api/hrm/onboarding/templates', { name: 'Bad', items: [{ title: 'Ack', criteria: 'acknowledgement', assignee_type: 'hr' }] })).status, 400, 'only the employee can acknowledge');
  // a small template used by the rest of the tests
  const made = await hr.post('/api/hrm/onboarding/templates', { name: 'Sales starter', items: [
    { category: 'profile', title: 'Fill profile', assignee_type: 'employee', criteria: 'profile', criteria_ref: 'phone,address', due_offset_days: 0 },
    { category: 'documents', title: 'Signed contract', assignee_type: 'hr', criteria: 'document', criteria_ref: 'Contract', due_offset_days: 1 },
    { category: 'policies', title: 'Handbook', assignee_type: 'employee', criteria: 'acknowledgement', due_offset_days: 2 },
    { category: 'training', title: 'Watch induction', assignee_type: 'employee', criteria: 'manual', due_offset_days: 3 },
    { category: 'manager_review', title: 'Week one check-in', assignee_type: 'manager', criteria: 'note', due_offset_days: 5 },
    { category: 'equipment', title: 'Laptop', assignee_type: 'hr', criteria: 'asset', required: false, due_offset_days: -1 },
  ] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  tpl = made.data;
});

test('working calendar: configurable weekend and holidays drive due dates (no fixed Saturday/Sunday)', async () => {
  assert.equal((await agent1.put('/api/hrm/onboarding/calendar', { weekend: [5, 6] })).status, 403);
  assert.equal((await hr.put('/api/hrm/onboarding/calendar', { weekend: [0, 1, 2, 3, 4, 5] })).status, 400, 'at least two working days');
  const c = await hr.put('/api/hrm/onboarding/calendar', { weekend: [5, 6] });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.deepEqual(c.data.weekend, [5, 6]);
  // a Friday: offset 0 rolls forward to Sunday, the first working day of a Friday/Saturday weekend
  let fri = '2027-01-01'; while (dow(fri) !== 5) fri = addDays(fri, 1);
  assert.equal(addWorkingDays(fri, 0), addDays(fri, 2));
  assert.equal(addWorkingDays(fri, -1), addDays(fri, -1), 'Thursday is a working day here');
  run('INSERT OR IGNORE INTO holidays(date,name) VALUES(?,?)', addDays(fri, 2), 'Test holiday');
  assert.equal(addWorkingDays(fri, 0), addDays(fri, 3), 'holidays are skipped too');
  assert.equal(calendarChecker()(addDays(fri, 1)), false);
  run('DELETE FROM holidays WHERE name=?', 'Test holiday');
  // reminders wait for working hours on a working day (workspace wall clock)
  const thu = addDays(fri, -1);
  assert.equal(inWorkingHours(`${thu} 10:00:00`), true);
  assert.equal(inWorkingHours(`${thu} 07:30:00`), false, 'before the working day starts');
  assert.equal(inWorkingHours(`${fri} 10:00:00`), false, 'weekend');
  await hr.put('/api/hrm/onboarding/calendar', { weekend: [0] }); // back to the Pakistan default used by the demo data
});

test('start onboarding: retries with the same key do not duplicate the onboarding, tasks or notices', async () => {
  const e = empOf('agent2@expertdevelopers.pk');
  const joining = '2027-03-01';
  const body = { employee_id: e.id, template_id: tpl.id, joining_date: joining };
  assert.equal((await agent1.post('/api/hrm/onboarding', body)).status, 403, 'agents cannot start onboarding');
  const first = await hr.post('/api/hrm/onboarding', body, { 'Idempotency-Key': 'start-agent2-1' });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const tasks = val('SELECT COUNT(*) FROM work_tasks WHERE onboarding_item_id IN (SELECT id FROM onboarding_items WHERE onboarding_id=?)', first.data.id);
  const notes = val("SELECT COUNT(*) FROM notifications WHERE type='onboarding'");
  const again = await hr.post('/api/hrm/onboarding', body, { 'Idempotency-Key': 'start-agent2-1' });
  assert.equal(again.status, 200);
  assert.equal(again.data.id, first.data.id);
  assert.equal(again.data.replayed, true);
  const other = await hr.post('/api/hrm/onboarding', body, { 'Idempotency-Key': 'start-agent2-2' });
  assert.equal(other.status, 400, 'one open onboarding per employee');
  assert.equal(other.data.onboarding_id, first.data.id);
  assert.equal(val('SELECT COUNT(*) FROM work_tasks WHERE onboarding_item_id IN (SELECT id FROM onboarding_items WHERE onboarding_id=?)', first.data.id), tasks);
  assert.equal(val("SELECT COUNT(*) FROM notifications WHERE type='onboarding'"), notes);
  assert.ok(tasks >= 5, 'each assigned item becomes a work task for its assignee');
  onb = (await hr.get(`/api/hrm/onboarding/${first.data.id}`)).data;
  assert.equal(onb.items.length, 6);
  const profile = onb.items.find((i) => i.title === 'Fill profile');
  assert.equal(profile.assignee_user_id, userId('agent2@expertdevelopers.pk'));
  assert.equal(onb.items.find((i) => i.title === 'Week one check-in').assignee_user_id, userId('salesmanager@expertdevelopers.pk'));
  assert.equal(profile.due_date, addWorkingDays(joining, 0));
  assert.equal(onb.items.find((i) => i.title === 'Laptop').due_date, addWorkingDays(joining, -1), 'negative offsets prepare before day one');
  assert.equal(onb.progress.percent, 0);
});

test('snapshot: editing the template later does not change a running onboarding', async () => {
  const t = (await hr.get(`/api/hrm/onboarding/templates/${tpl.id}`)).data;
  const items = t.items.map((i) => ({ ...i, title: `${i.title} (v2)` }));
  items.push({ title: 'Brand new step', assignee_type: 'hr' });
  assert.equal((await hr.put(`/api/hrm/onboarding/templates/${tpl.id}`, { name: 'Sales starter v2', items })).status, 200);
  const now = (await hr.get(`/api/hrm/onboarding/${onb.onboarding.id}`)).data;
  assert.equal(now.items.length, 6);
  assert.ok(now.items.every((i) => !i.title.includes('(v2)')));
  assert.equal(now.onboarding.template_name, 'Sales starter');
});

test('scopes: employee self-view, manager sees direct reports, unrelated staff see nothing', async () => {
  const id = onb.onboarding.id;
  assert.equal((await agent1.get(`/api/hrm/onboarding/${id}`)).status, 404, 'no peeking at a colleague');
  assert.equal((await agent1.get('/api/hrm/onboarding')).data.rows.length, 0);
  const mine = await agent2.get('/api/hrm/onboarding/me');
  assert.equal(mine.status, 200);
  assert.equal(mine.data.own.onboarding.id, id);
  const team = await manager.get('/api/hrm/onboarding?scope=team');
  assert.ok(team.data.rows.some((r) => r.id === id), 'manager sees their report');
  const all = await hr.get('/api/hrm/onboarding');
  assert.equal(all.data.scope, 'all');
  assert.ok(all.data.rows.some((r) => r.id === id));
});

test('items: evidence rules, assignee permissions, waive and reopen need authority and a reason', async () => {
  const item = (title) => onb.items.find((i) => i.title === title);
  const act = (c, title, body) => c.post(`/api/hrm/onboarding/items/${item(title).id}/action`, body);
  const e = empOf('agent2@expertdevelopers.pk');

  // profile: blocked until the fields are actually filled in
  run('UPDATE employees SET address=NULL WHERE id=?', e.id);
  const p1 = await act(agent2, 'Fill profile', { action: 'complete' });
  assert.equal(p1.status, 400);
  assert.deepEqual(p1.data.missing, ['address']);
  run("UPDATE employees SET address='House 1, Street 2', phone=COALESCE(phone,'+92 300 0000000') WHERE id=?", e.id);
  const p2 = await act(agent2, 'Fill profile', { action: 'complete' });
  assert.equal(p2.status, 200, JSON.stringify(p2.data));
  assert.equal(p2.data.item.status, 'completed');
  assert.ok(p2.data.item.completed_at.endsWith('Z'), 'event time stored in UTC');
  assert.equal((await act(agent2, 'Fill profile', { action: 'complete' })).data.unchanged, true, 'a retried completion changes nothing');

  // the employee cannot do HR's item; the manager cannot acknowledge for the employee
  assert.equal((await act(agent2, 'Signed contract', { action: 'complete' })).status, 403);
  assert.equal((await act(manager, 'Handbook', { action: 'complete' })).status, 403);
  assert.equal((await act(agent2, 'Handbook', { action: 'complete' })).status, 200);

  // document evidence must be this employee's own upload in the right category (no copies are made)
  const other = empOf('agent1@expertdevelopers.pk');
  const foreign = Number(run("INSERT INTO documents(entity_type,entity_id,category,name,path,created_at) VALUES('employee',?,'Contract','x.pdf','documents/x.pdf',?)", other.id, today()).lastInsertRowid);
  const wrongCat = Number(run("INSERT INTO documents(entity_type,entity_id,category,name,path,created_at) VALUES('employee',?,'Photo','p.jpg','documents/p.jpg',?)", e.id, today()).lastInsertRowid);
  const mineDoc = Number(run("INSERT INTO documents(entity_type,entity_id,category,name,path,created_at) VALUES('employee',?,'Contract','c.pdf','documents/c.pdf',?)", e.id, today()).lastInsertRowid);
  const docsBefore = val('SELECT COUNT(*) FROM documents');
  assert.equal((await act(hr, 'Signed contract', { action: 'complete', evidence_ref: foreign })).status, 400);
  assert.equal((await act(hr, 'Signed contract', { action: 'complete', evidence_ref: wrongCat })).status, 400);
  const d = await act(hr, 'Signed contract', { action: 'complete', evidence_ref: mineDoc });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.equal(d.data.item.evidence_ref, String(mineDoc));
  assert.equal(val('SELECT COUNT(*) FROM documents'), docsBefore, 'evidence is a reference, not a duplicate');

  // manager review needs a note; the manager may do it, an agent may not
  assert.equal((await act(agent1, 'Week one check-in', { action: 'complete', note: 'x' })).status, 404);
  assert.equal((await act(manager, 'Week one check-in', { action: 'complete' })).status, 400);
  assert.equal((await act(manager, 'Week one check-in', { action: 'complete', note: 'Settling in well' })).status, 200);

  // waive: HR approvers only, with a reason; reopen: reason recorded and the state goes back
  assert.equal((await act(manager, 'Watch induction', { action: 'waive', reason: 'Done elsewhere' })).status, 403);
  assert.equal((await act(hr, 'Watch induction', { action: 'waive' })).status, 400);
  const w = await act(hr, 'Watch induction', { action: 'waive', reason: 'Completed at previous branch' });
  assert.equal(w.status, 200);
  assert.equal(w.data.item.waive_reason, 'Completed at previous branch');
  assert.equal(w.data.onboarding.status, 'completed', 'all required items are completed or waived; the optional laptop does not block');
  assert.equal(val("SELECT COUNT(*) FROM notifications WHERE title='Onboarding complete'") >= 1, true);
  assert.equal((await act(agent2, 'Fill profile', { action: 'reopen', reason: 'x' })).status, 403, 'employees cannot reopen');
  assert.equal((await act(hr, 'Fill profile', { action: 'reopen' })).status, 400, 'reason required');
  const ro = await act(hr, 'Fill profile', { action: 'reopen', reason: 'Address was wrong' });
  assert.equal(ro.status, 200);
  assert.equal(ro.data.item.status, 'pending');
  assert.equal(ro.data.item.completed_at, null);
  assert.equal(ro.data.onboarding.status, 'in_progress');
  assert.equal(get('SELECT status FROM work_tasks WHERE id=?', ro.data.item.work_task_id).status, 'todo', 'the linked task reopens too');
  const events = (await hr.get(`/api/hrm/onboarding/${onb.onboarding.id}`)).data.events;
  assert.ok(events.some((x) => x.action === 'reopen' && x.reason === 'Address was wrong' && x.user_name));
  assert.ok(events.some((x) => x.action === 'waive' && x.reason));
});

test('progress is calculated from the actual item states', async () => {
  const d = (await hr.get(`/api/hrm/onboarding/${onb.onboarding.id}`)).data;
  const req = d.items.filter((i) => i.required);
  const done = req.filter((i) => ['completed', 'waived'].includes(i.status)).length;
  assert.equal(d.progress.required, req.length);
  assert.equal(d.progress.required_done, done);
  assert.equal(d.progress.percent, Math.round((done / req.length) * 100));
  assert.deepEqual(progressOf([{ required: 1, status: 'waived' }, { required: 1, status: 'in_progress' }, { required: 0, status: 'pending' }]).percent, 50);
});

test('My Tasks stays in step: a manual item completes from its task, evidence items refuse', async () => {
  const e = empOf('agent3@expertdevelopers.pk');
  const s = await hr.post('/api/hrm/onboarding', { employee_id: e.id, template_id: tpl.id, joining_date: today(), idempotency_key: 'agent3' });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const agent3 = await client('agent3@expertdevelopers.pk');
  const items = (await agent3.get('/api/hrm/onboarding/me')).data.own.items;
  const manual = items.find((i) => i.criteria === 'manual');
  const profile = items.find((i) => i.criteria === 'profile');
  const r1 = await agent3.put(`/api/staff/work-tasks/${manual.work_task_id}`, { status: 'done' });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(get('SELECT status FROM onboarding_items WHERE id=?', manual.id).status, 'completed');
  run('UPDATE employees SET emergency_contact=NULL WHERE id=?', e.id);
  assert.equal((await agent3.put(`/api/staff/work-tasks/${profile.work_task_id}`, { status: 'done' })).status, 400, 'evidence items complete only from the checklist');
  assert.equal((await hr.del(`/api/staff/work-tasks/${profile.work_task_id}`)).status, 400, 'checklist tasks are not deleted from My Tasks');
  // cancelling removes the open tasks but keeps the record
  assert.equal((await hr.post(`/api/hrm/onboarding/${s.data.id}/cancel`, {})).status, 400, 'reason required');
  assert.equal((await hr.post(`/api/hrm/onboarding/${s.data.id}/cancel`, { reason: 'Offer withdrawn' })).status, 200);
  assert.equal(val("SELECT COUNT(*) FROM work_tasks WHERE status<>'done' AND onboarding_item_id IN (SELECT id FROM onboarding_items WHERE onboarding_id=?)", s.data.id), 0);
  assert.equal((await agent3.post(`/api/hrm/onboarding/items/${profile.id}/action`, { action: 'start' })).status, 400, 'cancelled onboarding is read-only');
});

test('overdue reminders: once per onboarding per day, only inside working hours, never duplicated', async () => {
  run("UPDATE onboarding_items SET due_date=? WHERE onboarding_id=? AND status NOT IN ('completed','waived')", addDays(today(), -1), onb.onboarding.id);
  run('UPDATE onboardings SET last_overdue_notice=NULL WHERE id=?', onb.onboarding.id);
  const count = () => val("SELECT COUNT(*) FROM notifications WHERE title='Onboarding overdue'");
  const before = count();
  const r1 = runOnboardingReminders({ force: true });
  assert.equal(r1.sent, 1);
  const after1 = count();
  assert.ok(after1 > before, 'HR and the manager are told');
  run('UPDATE onboardings SET last_overdue_notice=NULL WHERE id=?', onb.onboarding.id); // even if the marker is lost…
  runOnboardingReminders({ force: true });
  assert.equal(count(), after1, '…the dedupe key stops a second copy the same day');
  const list = await hr.get('/api/hrm/onboarding?filter=overdue');
  assert.ok(list.data.rows.some((r) => r.id === onb.onboarding.id && r.overdue > 0));
});
