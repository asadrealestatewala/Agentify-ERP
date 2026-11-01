import { Router } from 'express';
import { assertRecordEmailFree } from '../services/uniqueEmail.js';
import { all, get, run, tx, update, nextNo, getSetting } from '../db.js';
import { can, hasPerm, requireStaff } from '../rbac.js';
import { audit, notify, notifyPerm } from '../audit.js';
import { crud, sendTable, uploader } from './helpers.js';
import { asyncH, bad, notFound, int, now, today, jparse, addDays, moneyText, curCode } from '../util.js';
import { postJournal, assertTreasury, assertFunds } from '../services/accounting.js';
import { payCommission } from '../services/commissions.js';
import { attendanceSummary, createLeave, decideLeave, leaveBalances, commissionDue, ATTENDANCE_STATUS } from '../services/hr.js';

const r = Router();
r.use(requireStaff);

const ECOLS = ['name', 'cnic', 'dob', 'gender', 'phone', 'email', 'address', 'emergency_contact', 'department', 'designation', 'hire_date', 'employment_type',
  'salary', 'commission_note', 'bonus', 'manager_id', 'branch', 'user_id', 'father_name', 'created_at'];
const emp = Router();
crud(emp, {
  table: 'employees', module: 'hrm', cols: ['emp_code', ...ECOLS], search: ['employees.name', 'employees.emp_code', 'employees.phone', 'employees.cnic'],
  filters: ['department', 'status', 'designation'], required: ['name'], label: 'employee', orderBy: 'employees.name',
  select: `SELECT employees.*, m.name manager_name, u.email login_email FROM employees LEFT JOIN employees m ON m.id=employees.manager_id LEFT JOIN users u ON u.id=employees.user_id`,
  before: (d, req, existing) => {
    if (!existing) d.emp_code = nextNo('EMP', 'EMP', 4); else delete d.emp_code;
    delete d.status; // status changes go through the approval workflow (default 'draft')
    if (d.cnic && !/^\d{5}-?\d{7}-?\d$/.test(d.cnic)) throw bad('CNIC must look like 12345-1234567-1');
    if (d.salary !== undefined) { d.salary = int(d.salary); if (d.salary < 0) throw bad('Salary cannot be negative'); }
    if (d.manager_id === '') d.manager_id = null;
    if (d.user_id === '') d.user_id = null;
    if (d.email !== undefined && d.email !== null) { d.email = String(d.email).trim() || null; assertRecordEmailFree('employees', d.email, existing); }
    if (d.user_id && get('SELECT 1 FROM employees WHERE user_id=? AND id<>?', d.user_id, existing?.id ?? 0)) throw bad('That login is already linked to another employee');
  },
  canDelete: (e) => { if (e.status !== 'draft') throw bad('Only draft employees can be deleted — mark inactive instead'); if (get('SELECT 1 FROM payroll WHERE employee_id=?', e.id)) throw bad('Employee has payroll records'); },
});
// crud strips status on update; creation needs it — patch after insert via before hook workaround
r.use('/employees', emp);
const photoUp = uploader('media', 'image', 8);
r.post('/employees/:id(\\d+)/photo', can('hrm', 'edit'), photoUp.single('photo'), asyncH((req, res) => {
  const e = get('SELECT * FROM employees WHERE id=?', req.params.id);
  if (!e) throw notFound();
  if (!req.file) throw bad('Choose a photo');
  run('UPDATE employees SET photo=? WHERE id=?', `media/${req.file.filename}`, e.id);
  audit(req, 'Employee photo updated', 'employee', e.id, e.name);
  res.json({ photo: `media/${req.file.filename}` });
}));
r.post('/employees/:id(\\d+)/workflow', can('hrm', 'approve'), asyncH((req, res) => {
  const e = get('SELECT * FROM employees WHERE id=?', req.params.id);
  if (!e) throw notFound();
  const next = { approve: ['draft', 'approved'], activate: ['approved', 'active'], deactivate: ['active', 'inactive'], reactivate: ['inactive', 'active'] }[req.body.action];
  if (!next) throw bad('Unknown action');
  if (e.status !== next[0]) throw bad(`Employee must be ${next[0]} to ${req.body.action}`);
  run('UPDATE employees SET status=? WHERE id=?', next[1], e.id);
  audit(req, `Employee ${req.body.action}`, 'employee', e.id, e.name);
  res.json({ status: next[1] });
}));
r.get('/employees/:id(\\d+)/profile', can('hrm', 'view'), asyncH((req, res) => {
  const e = get('SELECT * FROM employees WHERE id=?', req.params.id);
  if (!e) throw notFound();
  res.json({ employee: e, documents: all('SELECT * FROM documents WHERE entity_type=? AND entity_id=? ORDER BY id DESC', 'employee', e.id),
    payroll: all('SELECT * FROM payroll WHERE employee_id=? ORDER BY period DESC LIMIT 24', e.id),
    leaves: all('SELECT * FROM leaves WHERE employee_id=? ORDER BY from_date DESC LIMIT 24', e.id),
    attendance: all('SELECT * FROM attendance WHERE employee_id=? ORDER BY date DESC LIMIT 31', e.id), balances: leaveBalances(e.id),
    attendance_summary: attendanceSummary(e.id), assets: all('SELECT * FROM assets WHERE employee_id=? ORDER BY assigned_date DESC', e.id) });
}));

// ---------------- Payroll
const PAY = `SELECT p.*, e.name employee_name, e.emp_code, e.department FROM payroll p JOIN employees e ON e.id=p.employee_id`;
const net = (p) => p.basic + p.allowances + p.bonus + p.commission - p.deductions - p.advances - p.loans;
r.get('/payroll', can('hrm', 'view'), asyncH((req, res) => {
  const where = ['1=1'], params = [];
  if (req.query.period) { where.push('p.period=?'); params.push(req.query.period); }
  if (req.query.employee_id) { where.push('p.employee_id=?'); params.push(req.query.employee_id); }
  if (req.query.status) { where.push('p.status=?'); params.push(req.query.status); }
  res.json(all(`${PAY} WHERE ${where.join(' AND ')} ORDER BY p.period DESC, e.name LIMIT 1000`, ...params));
}));
/** Generate draft payroll for all active employees for a period; commission pulled from paid commissions. */
r.post('/payroll/generate', can('hrm', 'create'), asyncH((req, res) => {
  const period = req.body.period;
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw bad('Period must be YYYY-MM');
  let created = 0;
  tx(() => {
    for (const e of all("SELECT * FROM employees WHERE status='active'")) {
      if (get('SELECT 1 FROM payroll WHERE employee_id=? AND period=?', e.id, period)) continue;
      const p = { basic: e.salary, allowances: 0, bonus: e.bonus || 0, commission: e.user_id ? commissionDue(e.user_id) : 0, deductions: 0, advances: 0, loans: 0 };
      p.net = net(p);
      run(`INSERT INTO payroll(employee_id,period,basic,allowances,bonus,commission,deductions,advances,loans,net,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        e.id, period, p.basic, p.allowances, p.bonus, p.commission, p.deductions, p.advances, p.loans, p.net, 'draft', now());
      created++;
    }
  });
  audit(req, 'Generated payroll', 'payroll', null, `${period}: ${created} records`);
  res.json({ created });
}));
r.put('/payroll/:id(\\d+)', can('hrm', 'edit'), asyncH((req, res) => {
  const p = get('SELECT * FROM payroll WHERE id=?', req.params.id);
  if (!p) throw notFound();
  if (p.status === 'paid') throw bad('Paid payroll is locked');
  const n = { ...p };
  for (const k of ['basic', 'allowances', 'bonus', 'commission', 'deductions', 'advances', 'loans']) if (req.body[k] !== undefined) { n[k] = int(req.body[k]); if (n[k] < 0) throw bad(`${k} cannot be negative`); }
  n.net = net(n);
  if (n.net < 0) throw bad('Net salary cannot be negative');
  run('UPDATE payroll SET basic=?,allowances=?,bonus=?,commission=?,deductions=?,advances=?,loans=?,net=?,notes=COALESCE(?,notes) WHERE id=?', n.basic, n.allowances, n.bonus, n.commission, n.deductions, n.advances, n.loans, n.net, req.body.notes ?? null, p.id);
  res.json({ net: n.net });
}));
/**
 * Pay salary. The commission part of the payslip settles the agent's approved commissions (oldest first) — so the
 * commission ledger, Commission Payable account and payslip stay in sync; the rest is booked to Salaries.
 */
r.post('/payroll/:id(\\d+)/pay', can('hrm', 'approve'), asyncH((req, res) => {
  const p = get(`${PAY} WHERE p.id=?`, req.params.id);
  if (!p) throw notFound();
  if (p.status === 'paid') throw bad('Already paid');
  const date = req.body.payment_date || today();
  tx(() => {
    let jid = null, accId = null;
    if (req.body.sync_accounting !== false) {
      if (!hasPerm(req.user, 'accounting', 'create')) throw bad('Syncing to accounting needs accounting permission');
      accId = assertTreasury(req.body.account_id).id;
      assertFunds(accId, p.net);
      const userId = get('SELECT user_id FROM employees WHERE id=?', p.employee_id)?.user_id;
      let commission = p.commission;
      if (commission > 0) {
        if (!userId) throw bad('This employee has no login linked, so commission cannot be settled — set commission to 0 or link a user');
        if (commission > commissionDue(userId)) throw bad(`Commission on the payslip (${moneyText(commission)}) is more than the approved commission still owed (${moneyText(commissionDue(userId))})`);
        let left = commission;
        for (const c of all("SELECT * FROM commissions WHERE agent_id=? AND status IN ('approved','partially_paid') ORDER BY id", userId)) {
          if (left <= 0) break;
          const take = Math.min(left, c.amount - c.paid_amount);
          payCommission(c.id, { amount: take, account_id: accId, date, method: req.body.payment_method, reference_no: `Payroll ${p.period}` }, req);
          left -= take;
        }
      }
      const salaryPart = p.net - commission;
      if (salaryPart > 0) jid = postJournal({ date, memo: `Salary ${p.period} — ${p.employee_name}`, refType: 'payroll', refId: p.id, userId: req.user.id,
        lines: [{ account: '5300', debit: salaryPart }, { account: accId, credit: salaryPart }] });
    }
    run("UPDATE payroll SET status='paid', payment_date=?, payment_method=?, account_id=?, journal_id=? WHERE id=?", date, req.body.payment_method ?? null, accId, jid, p.id);
    const eu = get('SELECT user_id FROM employees WHERE id=?', p.employee_id)?.user_id;
    if (eu) notify(eu, 'payroll', 'Salary paid', `Your ${p.period} salary of ${moneyText(p.net)} has been paid`, '/my/payroll');
    audit(req, 'Paid salary', 'payroll', p.id, `${p.employee_name} ${p.period} ${curCode()} ${p.net}`);
  });
  res.json({ ok: true });
}));
r.delete('/payroll/:id(\\d+)', can('hrm', 'delete'), asyncH((req, res) => {
  const p = get('SELECT * FROM payroll WHERE id=?', req.params.id);
  if (!p) throw notFound();
  if (p.status === 'paid') throw bad('Paid payroll cannot be deleted');
  run('DELETE FROM payroll WHERE id=?', p.id);
  res.json({ ok: true });
}));

// ---------------- Attendance
r.get('/attendance', can('hrm', 'view'), asyncH((req, res) => {
  const date = req.query.date || today();
  if (req.query.employee_id) {
    return res.json(all('SELECT a.*, e.name employee_name FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.employee_id=? AND a.date>=? AND a.date<=? ORDER BY a.date DESC',
      req.query.employee_id, req.query.from || addDays(date, -31), req.query.to || date));
  }
  const holiday = get('SELECT * FROM holidays WHERE date=?', date);
  const rows = all(`SELECT e.id employee_id, e.name employee_name, e.emp_code, e.department, a.id, a.check_in, a.check_out, a.late_minutes, a.early_minutes, COALESCE(a.status,'absent') status
    FROM employees e LEFT JOIN attendance a ON a.employee_id=e.id AND a.date=? WHERE e.status='active' ORDER BY e.name`, date);
  res.json({ date, holiday, rows });
}));
function parseTime(t) { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function markAttendance({ employee_id, date = today(), check_in, check_out, status }) {
  if (!get('SELECT 1 FROM employees WHERE id=?', employee_id)) throw bad('Employee not found');
  if (status && !ATTENDANCE_STATUS.includes(status)) throw bad(`Status must be one of ${ATTENDANCE_STATUS.join(', ')}`);
  if (date > today()) throw bad('Attendance cannot be marked for a future date');
  const start = parseTime(getSetting('work_start', '09:00')), end = parseTime(getSetting('work_end', '18:00'));
  const ci = parseTime(check_in), co = parseTime(check_out);
  const late = ci != null ? Math.max(0, ci - start) : 0, early = co != null ? Math.max(0, end - co) : 0;
  if (ci != null && co != null && co < ci) throw bad('Check-out cannot be before check-in');
  const st = status || (ci != null ? (late > 0 ? 'late' : 'present') : 'absent');
  run(`INSERT INTO attendance(employee_id,date,check_in,check_out,late_minutes,early_minutes,status) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(employee_id,date) DO UPDATE SET check_in=excluded.check_in, check_out=excluded.check_out, late_minutes=excluded.late_minutes, early_minutes=excluded.early_minutes, status=excluded.status`,
  employee_id, date, check_in || null, check_out || null, late, early, st);
  return { late, early, status: st };
}
r.post('/attendance', can('hrm', 'create'), asyncH((req, res) => {
  const out = markAttendance(req.body);
  audit(req, 'Marked attendance', 'attendance', req.body.employee_id, `${req.body.date || today()} ${out.status}`);
  res.json({ ok: true, ...out });
}));
/** Mark a whole day at once: entries [{employee_id, status}] or all_present:true for everyone not yet marked. */
r.post('/attendance/bulk', can('hrm', 'create'), asyncH((req, res) => {
  const date = req.body.date || today();
  let n = 0;
  tx(() => {
    if (req.body.all_present) {
      for (const e of all("SELECT id FROM employees WHERE status='active' AND id NOT IN (SELECT employee_id FROM attendance WHERE date=?)", date)) {
        markAttendance({ employee_id: e.id, date, check_in: getSetting('work_start', '09:00'), check_out: getSetting('work_end', '18:00'), status: 'present' }); n++;
      }
    }
    for (const en of req.body.entries || []) { markAttendance({ date, ...en }); n++; }
  });
  audit(req, 'Marked attendance (bulk)', 'attendance', null, `${date}: ${n} record(s)`);
  res.json({ marked: n });
}));
r.get('/attendance/report', can('hrm', 'view'), asyncH((req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const rows = all("SELECT id,name,emp_code,department FROM employees WHERE status='active' ORDER BY name").map((e) => {
    const s = attendanceSummary(e.id, month);
    return { id: e.id, name: e.name, emp_code: e.emp_code, department: e.department, working_days: s.working_days, present: s.present, late: s.late, half_day: s.half_day, absent: s.absent,
      on_leave: s.leave, unmarked: s.unmarked, late_minutes: s.late_minutes, early_minutes: 0, percentage: s.percentage };
  });
  if (req.query.format) return sendTable(res, req.query.format, `attendance-${month}`, [['name', 'Employee'], ['emp_code', 'ID'], ['working_days', 'Working days'], ['present', 'Present'], ['late', 'Late'], ['half_day', 'Half days'], ['absent', 'Absent'], ['on_leave', 'On leave'], ['unmarked', 'Not marked'], ['percentage', 'Attendance %']].map(([key, label]) => ({ key, label })), rows, { title: `Attendance — ${month}` });
  res.json(rows);
}));
r.get('/attendance/summary/:id(\\d+)', can('hrm', 'view'), asyncH((req, res) => res.json(attendanceSummary(Number(req.params.id), req.query.month))));

// ---------------- Leave
r.get('/leaves', can('hrm', 'view'), asyncH((req, res) => {
  const where = ['1=1'], params = [];
  if (req.query.status) { where.push('l.status=?'); params.push(req.query.status); }
  if (req.query.employee_id) { where.push('l.employee_id=?'); params.push(req.query.employee_id); }
  res.json(all(`SELECT l.*, e.name employee_name, a.name approver FROM leaves l JOIN employees e ON e.id=l.employee_id LEFT JOIN users a ON a.id=l.approved_by WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT 500`, ...params));
}));
r.get('/leave-balances/:id(\\d+)', can('hrm', 'view'), (req, res) => res.json(leaveBalances(Number(req.params.id))));
r.post('/leaves', can('hrm', 'create'), asyncH((req, res) => {
  const out = createLeave(req.body.employee_id, req.body, req);
  res.status(201).json(out);
}));
/** HR / reporting manager actions: approve, reject, revoke an approval. (`approve:true|false` is still accepted.) */
r.post('/leaves/:id(\\d+)/decide', asyncH((req, res) => {
  const l = get('SELECT * FROM leaves WHERE id=?', req.params.id);
  if (!l) throw notFound();
  const action = req.body.action || (req.body.approve ? 'approve' : 'reject');
  res.json({ status: decideLeave(l, action, req.body.note, req) });
}));

// ---------------- Holidays, recruitment
const hol = Router();
crud(hol, { table: 'holidays', module: 'hrm', cols: ['date', 'name'], required: ['date', 'name'], orderBy: 'holidays.date', label: 'holiday', filters: [] });
r.use('/holidays', hol);
const rec = Router();
crud(rec, { table: 'recruitment', module: 'hrm', cols: ['position', 'candidate', 'phone', 'email', 'stage', 'notes', 'created_at'], search: ['candidate', 'position'], filters: ['stage'],
  required: ['position', 'candidate'], label: 'candidate' });
r.use('/recruitment', rec);

r.get('/summary', can('hrm', 'view'), (req, res) => {
  res.json({
    headcount: get("SELECT COUNT(*) n FROM employees WHERE status='active'").n,
    by_department: all("SELECT COALESCE(department,'—') department, COUNT(*) n, SUM(salary) payroll FROM employees WHERE status='active' GROUP BY department"),
    pending_leaves: get("SELECT COUNT(*) n FROM leaves WHERE status='pending'").n,
    monthly_payroll: get("SELECT COALESCE(SUM(salary),0) v FROM employees WHERE status='active'").v,
  });
});

export default r;
