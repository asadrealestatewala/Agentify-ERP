import { Router } from 'express';
import { all, get, run, tx, nextNo } from '../db.js';
import { can, hasPerm, requireStaff } from '../rbac.js';
import { audit, notify } from '../audit.js';
import { asyncH, bad, forbidden, notFound, int, now, today, jparse, moneyText, curCode } from '../util.js';
import { acct } from '../services/accounting.js';
import { createVoucher } from '../services/expenses.js';
import { sendPdf } from '../services/pdf.js';
import { uploader } from './helpers.js';
import { syncFromTask } from '../services/onboarding.js';
import { attendanceSummary, createLeave, decideLeave, employeeOf, leaveBalances, managerUserId, canDecideLeave, commissionDue } from '../services/hr.js';

/**
 * Employee self-service ("My space") and team work: every staff login can see its own profile, attendance, leave,
 * payroll, tasks and assets here — scoped by req.user, never by an id from the client.
 */
const r = Router();
r.use(requireStaff);

const me = (req) => {
  const e = employeeOf(req.user);
  if (!e) throw bad('No employee record is linked to your login yet — ask HR to link it (HRM → Employees → Edit → Login).');
  return e;
};
const money = (n) => `${moneyText(Number(n || 0))}`;

// ---------------------------------------------------------------- profile
r.get('/me/profile', asyncH((req, res) => {
  const e = employeeOf(req.user);
  const boss = e?.manager_id ? get('SELECT name, designation FROM employees WHERE id=?', e.manager_id) : null;
  res.json({
    user: { id: req.user.id, name: req.user.name, email: req.user.email, phone: req.user.phone, role: req.user.role },
    employee: e && { id: e.id, emp_code: e.emp_code, name: e.name, photo: e.photo, email: e.email || req.user.email, phone: e.phone || req.user.phone, emergency_contact: e.emergency_contact,
      dob: e.dob, gender: e.gender, hire_date: e.hire_date, father_name: e.father_name, employment_type: e.employment_type, status: e.status, department: e.department,
      designation: e.designation, branch: e.branch, address: e.address },
    manager: boss,
    assets: e ? all('SELECT id,asset_no,name,category,brand_model,serial_no,assigned_date,instructions FROM assets WHERE employee_id=? ORDER BY assigned_date DESC', e.id) : [],
    badges: { open_tasks: get("SELECT COUNT(*) n FROM work_tasks WHERE assigned_to=? AND status<>'done'", req.user.id).n, pending_leaves: e ? get("SELECT COUNT(*) n FROM leaves WHERE employee_id=? AND status='pending'", e.id).n : 0 },
  });
}));
const photoUp = uploader('media', 'image', 8);
/** Employees may keep their contact details and photo up to date; everything else is HR's. */
const saveProfile = asyncH((req, res) => {
  const e = me(req);
  const b = req.body;
  run('UPDATE employees SET phone=COALESCE(?,phone), emergency_contact=COALESCE(?,emergency_contact), address=COALESCE(?,address), photo=COALESCE(?,photo) WHERE id=?',
    b.phone ?? null, b.emergency_contact ?? null, b.address ?? null, req.file ? `media/${req.file.filename}` : null, e.id);
  if (b.phone) run('UPDATE users SET phone=? WHERE id=?', b.phone, req.user.id);
  audit(req, 'Profile updated', 'employee', e.id, e.name);
  res.json({ ok: true });
});
r.put('/me/profile', photoUp.single('photo'), saveProfile);
r.post('/me/profile', photoUp.single('photo'), saveProfile);

// ---------------------------------------------------------------- attendance
r.get('/me/attendance', asyncH((req, res) => res.json(attendanceSummary(me(req).id, req.query.month || undefined))));

// ---------------------------------------------------------------- leave
r.get('/me/leaves', asyncH((req, res) => {
  const e = me(req);
  res.json({ balances: leaveBalances(e.id), rows: all(`SELECT l.*, a.name decided_by FROM leaves l LEFT JOIN users a ON a.id=l.approved_by WHERE l.employee_id=? ORDER BY l.id DESC LIMIT 100`, e.id),
    approver: e.manager_id ? get('SELECT name FROM employees WHERE id=?', e.manager_id)?.name : 'HR' });
}));
r.post('/me/leaves', asyncH((req, res) => res.status(201).json(createLeave(me(req).id, req.body, req))));
r.post('/me/leaves/:id(\\d+)/cancel', asyncH((req, res) => {
  const e = me(req);
  const l = get('SELECT * FROM leaves WHERE id=? AND employee_id=?', req.params.id, e.id);
  if (!l) throw notFound();
  res.json({ status: decideLeave(l, 'cancel', req.body.note, req, { asEmployee: true }) });
}));

/** Leave requests the signed-in user may decide: all of them for HR, otherwise the direct reports'. */
r.get('/team/leaves', asyncH((req, res) => {
  const hr = hasPerm(req.user, 'hrm', 'approve') || hasPerm(req.user, 'hrm', 'view');
  const mine = employeeOf(req.user);
  const where = [], params = [];
  if (!hr) { if (!mine) return res.json([]); where.push('e.manager_id=?'); params.push(mine.id); }
  if (req.query.status) { where.push('l.status=?'); params.push(req.query.status); }
  res.json(all(`SELECT l.*, e.name employee_name, e.emp_code, e.manager_id, a.name decided_by FROM leaves l JOIN employees e ON e.id=l.employee_id LEFT JOIN users a ON a.id=l.approved_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (l.status='pending') DESC, l.id DESC LIMIT 300`, ...params)
    .map((l) => ({ ...l, can_decide: canDecideLeave(req.user, { manager_id: l.manager_id }) })));
}));

// ---------------------------------------------------------------- payroll & commission (own only)
r.get('/me/payroll', asyncH((req, res) => {
  const e = me(req);
  const slips = all("SELECT * FROM payroll WHERE employee_id=? AND status='paid' ORDER BY period DESC LIMIT 36", e.id);
  const commissions = all(`SELECT c.commission_no, c.amount, c.paid_amount, c.status, c.created_at, COALESCE(s.title,p.title) property, s.sale_no
    FROM commissions c JOIN sales s ON s.id=c.sale_id LEFT JOIN properties p ON p.id=c.property_id WHERE c.agent_id=? AND c.status<>'cancelled' ORDER BY c.id DESC LIMIT 100`, req.user.id);
  const year = today().slice(0, 4);
  res.json({
    salary: { monthly: e.salary, bonus: e.bonus || 0, designation: e.designation, employment_type: e.employment_type },
    slips, commissions,
    totals: { paid_ytd: slips.filter((x) => x.period.startsWith(year)).reduce((a, x) => a + x.net, 0), commission_due: commissionDue(req.user.id),
      commission_earned: commissions.reduce((a, c) => a + c.amount, 0), commission_paid: commissions.reduce((a, c) => a + c.paid_amount, 0) },
    next: get("SELECT period, status FROM payroll WHERE employee_id=? AND status<>'paid' ORDER BY period DESC LIMIT 1", e.id) || null,
  });
}));
r.get('/me/payroll/:id(\\d+)/pdf', asyncH((req, res) => {
  const e = me(req);
  const p = get("SELECT * FROM payroll WHERE id=? AND employee_id=? AND status='paid'", req.params.id, e.id);
  if (!p) throw notFound('Payslip not found');
  const rows = [
    { item: 'Basic salary', type: 'Earning', amount: p.basic }, { item: 'Allowances', type: 'Earning', amount: p.allowances }, { item: 'Bonus', type: 'Earning', amount: p.bonus },
    { item: 'Commission', type: 'Earning', amount: p.commission }, { item: 'Deductions', type: 'Deduction', amount: -p.deductions }, { item: 'Advances recovered', type: 'Deduction', amount: -p.advances },
    { item: 'Loan instalment', type: 'Deduction', amount: -p.loans },
  ].filter((x) => x.amount !== 0 || x.item === 'Basic salary');
  sendPdf(res, `payslip-${p.period}`, { title: 'PAYSLIP', subtitle: `${e.name} (${e.emp_code}) · ${e.designation || ''}\nPeriod ${p.period}${p.payment_date ? ` · paid ${p.payment_date}` : ''}`,
    summary: [['Net pay', money(p.net)], ['Payment method', p.payment_method || '—']], columns: [{ key: 'item', label: 'Item' }, { key: 'type', label: 'Type' }, { key: 'amount', label: `Amount (${curCode()})`, type: 'money' }], rows,
    totals: { item: 'Net pay', amount: p.net } });
}));

// ---------------------------------------------------------------- work tasks
const isSenior = (req) => req.user.isSuper || ['hrm:create', 'crm:approve', 'accounting:approve', 'projects:create'].some((p) => req.user.perms.has(p))
  || !!get('SELECT 1 FROM employees WHERE manager_id=(SELECT id FROM employees WHERE user_id=?)', req.user.id);
const TASK_SELECT = `SELECT t.*, u.name assignee, b.name assigner, (t.status<>'done' AND t.due_date IS NOT NULL AND t.due_date<date('now','+5 hours')) overdue
  FROM work_tasks t LEFT JOIN users u ON u.id=t.assigned_to LEFT JOIN users b ON b.id=t.assigned_by`;
const STATUS = ['todo', 'in_progress', 'blocked', 'done'];

r.get('/work-tasks', asyncH((req, res) => {
  const where = [], params = [];
  const scope = req.query.scope || 'mine';
  if (scope === 'mine' || !isSenior(req)) { where.push('t.assigned_to=?'); params.push(req.user.id); }
  else if (scope === 'assigned_by_me') { where.push('t.assigned_by=?'); params.push(req.user.id); }
  if (req.query.status === 'open') where.push("t.status<>'done'"); else if (req.query.status) { where.push('t.status=?'); params.push(req.query.status); }
  if (req.query.assigned_to && isSenior(req)) { where.push('t.assigned_to=?'); params.push(req.query.assigned_to); }
  res.json({ senior: isSenior(req), rows: all(`${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (t.status='done'), t.due_date IS NULL, t.due_date, t.id DESC LIMIT 500`, ...params) });
}));
r.get('/work-tasks/assignees', asyncH((req, res) => {
  if (!isSenior(req)) throw forbidden('Only managers can assign work');
  res.json(all(`SELECT u.id, u.name, r.name role, e.designation, e.department FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.user_id=u.id WHERE u.active=1 AND r.portal=0 ORDER BY u.name`));
}));
r.get('/work-tasks/:id(\\d+)', asyncH((req, res) => {
  const t = get(`${TASK_SELECT} WHERE t.id=?`, req.params.id);
  if (!t) throw notFound();
  if (t.assigned_to !== req.user.id && !isSenior(req)) throw forbidden();
  res.json({ ...t, updates: all('SELECT w.*, u.name user_name FROM work_task_updates w LEFT JOIN users u ON u.id=w.user_id WHERE task_id=? ORDER BY w.id DESC', t.id) });
}));
r.post('/work-tasks', asyncH((req, res) => {
  if (!isSenior(req)) throw forbidden('Only managers can assign work');
  const { title, description, priority = 'Medium', due_date } = req.body;
  const to = [].concat(req.body.assigned_to_list || req.body.assigned_to).map(Number).filter(Boolean);
  if (!title?.trim()) throw bad('Task title is required');
  if (!to.length) throw bad('Choose who the task is for');
  if (!['Low', 'Medium', 'High', 'Urgent'].includes(priority)) throw bad('Invalid priority');
  const ids = [];
  tx(() => {
    for (const uid of to) {
      if (!get('SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1 AND r.portal=0', uid)) throw bad('Assignee not found');
      ids.push(Number(run('INSERT INTO work_tasks(title,description,priority,due_date,status,assigned_to,assigned_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
        title.trim(), description ?? null, priority, due_date || null, 'todo', uid, req.user.id, now()).lastInsertRowid));
      if (uid !== req.user.id) notify(uid, 'task', `New task from ${req.user.name}`, `${title.trim()}${due_date ? ` — due ${due_date}` : ''}`, '/my/tasks');
    }
  });
  audit(req, 'Assigned task', 'work_task', ids[0], `${title} → ${to.length} person(s)`);
  res.status(201).json({ ids });
}));
r.put('/work-tasks/:id(\\d+)', asyncH((req, res) => {
  const t = get('SELECT * FROM work_tasks WHERE id=?', req.params.id);
  if (!t) throw notFound();
  const owner = t.assigned_to === req.user.id, boss = isSenior(req) && (t.assigned_by === req.user.id || req.user.isSuper || hasPerm(req.user, 'hrm', 'edit'));
  if (!owner && !boss) throw forbidden();
  const b = req.body;
  tx(() => {
    if (boss) {
      if (b.priority && !['Low', 'Medium', 'High', 'Urgent'].includes(b.priority)) throw bad('Invalid priority');
      run('UPDATE work_tasks SET title=COALESCE(?,title), description=COALESCE(?,description), priority=COALESCE(?,priority), due_date=COALESCE(?,due_date) WHERE id=?', b.title ?? null, b.description ?? null, b.priority ?? null, b.due_date ?? null, t.id);
    }
    if (b.status && b.status !== t.status) {
      if (!STATUS.includes(b.status)) throw bad('Invalid status');
      if (t.onboarding_item_id) syncFromTask(t, b.status, req); // onboarding items keep their own evidence rules
      run('UPDATE work_tasks SET status=?, started_at=COALESCE(started_at, ?), completed_at=? WHERE id=?', b.status, b.status === 'in_progress' ? now() : null, b.status === 'done' ? now() : null, t.id);
      if (t.assigned_by && t.assigned_by !== req.user.id) notify(t.assigned_by, 'task', `Task ${b.status === 'done' ? 'completed' : 'updated'}: ${t.title}`, `${req.user.name} → ${b.status.replace('_', ' ')}${b.note ? ` — ${b.note}` : ''}`, '/my/tasks?scope=assigned_by_me');
    }
    if (b.note || (b.status && b.status !== t.status)) run('INSERT INTO work_task_updates(task_id,user_id,status,note,created_at) VALUES(?,?,?,?,?)', t.id, req.user.id, b.status || t.status, b.note ?? null, now());
  });
  res.json({ ok: true });
}));
r.delete('/work-tasks/:id(\\d+)', asyncH((req, res) => {
  const t = get('SELECT * FROM work_tasks WHERE id=?', req.params.id);
  if (!t) throw notFound();
  if (!(isSenior(req) && (t.assigned_by === req.user.id || req.user.isSuper))) throw forbidden();
  if (t.onboarding_item_id && t.status !== 'done') throw bad('This task belongs to an onboarding checklist. Waive or cancel it from HR → Onboarding instead.');
  run('DELETE FROM work_tasks WHERE id=?', t.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- company assets (HR) — linked to expense vouchers
/** The library is shared by HR (who assign assets) and Finance (who buy them): either may view and complete details. */
const libraryAccess = (action) => (req, _res, next) => (hasPerm(req.user, 'hrm', action) || hasPerm(req.user, 'accounting', action) ? next() : next(forbidden(`You do not have permission to ${action} the asset library`)));
const ASSET_SELECT = `SELECT a.*, e.name employee_name, e.emp_code, v.voucher_no, v.status voucher_status, vn.name vendor_name, pr.name project_name FROM assets a LEFT JOIN employees e ON e.id=a.employee_id
  LEFT JOIN expense_vouchers v ON v.id=a.voucher_id LEFT JOIN vendors vn ON vn.id=a.vendor_id LEFT JOIN projects pr ON pr.id=a.project_id`;
/** An asset still needs the buyer's attention until it has a category and a make/model or serial number. */
const incomplete = (a) => !a.category || (!a.brand_model && !a.serial_no);
r.get('/assets', libraryAccess('view'), asyncH((req, res) => {
  const where = ['1=1'], params = [];
  if (req.query.q) { where.push('(a.name LIKE ? OR a.asset_no LIKE ? OR a.serial_no LIKE ? OR e.name LIKE ? OR a.brand_model LIKE ? OR vn.name LIKE ? OR v.voucher_no LIKE ?)'); params.push(...Array(7).fill(`%${req.query.q}%`)); }
  for (const k of ['status', 'category', 'employee_id']) if (req.query[k]) { where.push(`a.${k}=?`); params.push(req.query[k]); }
  let rows = all(`${ASSET_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 500`, ...params).map((a) => ({ ...a, details_missing: incomplete(a) }));
  const missing = rows.filter((x) => x.details_missing).length;
  if (req.query.incomplete === '1') rows = rows.filter((x) => x.details_missing);
  res.json({ rows, summary: { incomplete: missing, count: rows.length, value: rows.reduce((s, x) => s + x.cost, 0), assigned: rows.filter((x) => x.status === 'assigned').length, in_stock: rows.filter((x) => x.status === 'in_stock').length } });
}));
r.get('/assets/:id(\\d+)', libraryAccess('view'), asyncH((req, res) => {
  const a = get(`${ASSET_SELECT} WHERE a.id=?`, req.params.id);
  if (!a) throw notFound();
  res.json({ ...a, details_missing: incomplete(a), history: all('SELECT h.*, e.name employee_name FROM asset_history h LEFT JOIN employees e ON e.id=h.employee_id WHERE asset_id=? ORDER BY h.id DESC', a.id) });
}));
const ACOLS = ['name', 'category', 'brand_model', 'serial_no', 'purchase_date', 'cost', 'instructions', 'notes', 'warranty_until'];
// cost, purchase date and vendor of a purchase come from its expense voucher and are not typed again
const FROM_VOUCHER = ['cost', 'purchase_date'];
r.post('/assets', can('hrm', 'create'), asyncH((req, res) => {
  const b = req.body;
  if (!b.name?.trim()) throw bad('Asset name is required');
  const cost = int(b.cost);
  if (cost < 0) throw bad('Cost cannot be negative');
  const out = tx(() => {
    let voucherId = b.voucher_id ? Number(b.voucher_id) : null;
    if (voucherId && !get('SELECT 1 FROM expense_vouchers WHERE id=?', voucherId)) throw bad('Expense voucher not found');
    const assetNo = nextNo('AST', 'AST', 4);
    if (b.create_voucher) {
      if (!hasPerm(req.user, 'accounting', 'create')) throw forbidden('Creating the purchase voucher needs accounting permission');
      if (cost <= 0) throw bad('Enter the purchase cost to create its expense voucher');
      voucherId = createVoucher({ expense_account_id: acct('5800'), amount: cost, description: `Asset purchase: ${b.name.trim()} (${assetNo})`, vendor_id: b.vendor_id || null,
        payment_method: b.payment_method || null, paid_from_account_id: b.paid_from_account_id || null, date: b.purchase_date || today() }, req);
    }
    const id = Number(run(`INSERT INTO assets(asset_no,name,category,brand_model,serial_no,purchase_date,cost,voucher_id,vendor_id,warranty_until,source,status,instructions,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      assetNo, b.name.trim(), b.category ?? null, b.brand_model ?? null, b.serial_no ?? null, b.purchase_date || today(), cost, voucherId, b.vendor_id || null, b.warranty_until || null, 'library', 'in_stock', b.instructions ?? null, b.notes ?? null, req.user.id, now()).lastInsertRowid);
    run('INSERT INTO asset_history(asset_id,action,date,note,user_id) VALUES(?,?,?,?,?)', id, 'added', b.purchase_date || today(), voucherId ? 'Linked to expense voucher' : null, req.user.id);
    audit(req, 'Asset added', 'asset', id, `${assetNo} ${b.name}`);
    return { id, asset_no: assetNo, voucher_id: voucherId };
  });
  res.status(201).json(out);
}));
r.put('/assets/:id(\\d+)', libraryAccess('edit'), asyncH((req, res) => {
  const a = get('SELECT * FROM assets WHERE id=?', req.params.id);
  if (!a) throw notFound();
  if (req.body.warranty_until && !/^\d{4}-\d{2}-\d{2}$/.test(req.body.warranty_until)) throw bad('Warranty date must be YYYY-MM-DD');
  if (req.body.name !== undefined && !String(req.body.name).trim()) throw bad('Asset name is required');
  for (const k of ACOLS) if (req.body[k] === '') req.body[k] = null;
  const keys = ACOLS.filter((k) => req.body[k] !== undefined && !(a.voucher_id && FROM_VOUCHER.includes(k)));
  if (req.body.status && ['in_stock', 'repair', 'retired'].includes(req.body.status) && a.status !== 'assigned') keys.push('status');
  if (req.body.voucher_id !== undefined) keys.push('voucher_id');
  if (keys.length) run(`UPDATE assets SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => (k === 'cost' ? int(req.body[k]) : req.body[k])), a.id);
  res.json({ ok: true });
}));
r.post('/assets/:id(\\d+)/assign', can('hrm', 'edit'), asyncH((req, res) => {
  const a = get('SELECT * FROM assets WHERE id=?', req.params.id);
  if (!a) throw notFound();
  const e = get('SELECT * FROM employees WHERE id=?', req.body.employee_id);
  if (!e) throw bad('Choose an employee');
  if (a.status === 'assigned') throw bad('Return the asset from its current holder first');
  if (['retired', 'repair'].includes(a.status)) throw bad(`A ${a.status} asset cannot be assigned`);
  const date = req.body.date || today();
  tx(() => {
    run("UPDATE assets SET status='assigned', employee_id=?, assigned_date=?, instructions=COALESCE(?,instructions) WHERE id=?", e.id, date, req.body.instructions ?? null, a.id);
    run('INSERT INTO asset_history(asset_id,employee_id,action,date,note,user_id) VALUES(?,?,?,?,?,?)', a.id, e.id, 'assigned', date, req.body.instructions ?? null, req.user.id);
  });
  if (e.user_id) notify(e.user_id, 'asset', 'Company asset assigned to you', `${a.name} (${a.asset_no})${req.body.instructions ? ` — ${req.body.instructions}` : ''}`, '/my/profile');
  audit(req, 'Asset assigned', 'asset', a.id, `${a.asset_no} → ${e.name}`);
  res.json({ ok: true });
}));
r.post('/assets/:id(\\d+)/return', can('hrm', 'edit'), asyncH((req, res) => {
  const a = get('SELECT * FROM assets WHERE id=?', req.params.id);
  if (!a) throw notFound();
  if (a.status !== 'assigned') throw bad('This asset is not assigned');
  const date = req.body.date || today();
  tx(() => {
    run("UPDATE assets SET status=?, employee_id=NULL, assigned_date=NULL WHERE id=?", req.body.condition === 'repair' ? 'repair' : 'in_stock', a.id);
    run('INSERT INTO asset_history(asset_id,employee_id,action,date,note,user_id) VALUES(?,?,?,?,?,?)', a.id, a.employee_id, 'returned', date, req.body.note ?? null, req.user.id);
  });
  audit(req, 'Asset returned', 'asset', a.id, a.asset_no);
  res.json({ ok: true });
}));
r.delete('/assets/:id(\\d+)', can('hrm', 'delete'), asyncH((req, res) => {
  const a = get('SELECT * FROM assets WHERE id=?', req.params.id);
  if (!a) throw notFound();
  if (a.status === 'assigned') throw bad('Return the asset before deleting it');
  if (get("SELECT 1 FROM asset_history WHERE asset_id=? AND action='assigned'", a.id)) throw bad('This asset has an assignment history — mark it Retired instead');
  run('DELETE FROM assets WHERE id=?', a.id);
  res.json({ ok: true });
}));

export default r;
