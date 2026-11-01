import { all, get, run, tx, getSetting } from '../db.js';
import { hasPerm } from '../rbac.js';
import { audit, notify, notifyPerm } from '../audit.js';
import { addDays, bad, forbidden, jparse, now, today } from '../util.js';

export const EMPLOYMENT_TYPES = ['Intern', 'Employee', 'Part time', 'Full time', 'Probation', 'Permanent', 'Contract based'];
export const ATTENDANCE_STATUS = ['present', 'late', 'half_day', 'absent', 'leave'];

const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const lastDay = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** The employee record behind a login (linked by user_id; falls back to a matching e-mail once). */
const normName = (n) => String(n || '').toLowerCase().replace(/[^a-z]/g, '');
/** Two names agree when one contains the other ("Kiran" / "Kiran Shah"); an empty name never agrees. */
const sameName = (a, b) => { const x = normName(a), y = normName(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
/**
 * The employee record that belongs to a login — only ever the one explicitly linked to it. A record that merely shares
 * the login's email is adopted only when the names agree as well (an owner or admin whose email was typed onto
 * someone else's record must never inherit that person's details). A previously mis-adopted link is undone here.
 */
export function employeeOf(user) {
  let e = get('SELECT * FROM employees WHERE user_id=?', user.id);
  if (e && user.email && String(e.email || '').toLowerCase() === String(user.email).toLowerCase() && !sameName(e.name, user.name)) {
    run('UPDATE employees SET user_id=NULL WHERE id=? AND user_id=?', e.id, user.id);
    e = null;
  }
  if (!e && user.email) {
    const c = get('SELECT * FROM employees WHERE user_id IS NULL AND lower(email)=lower(?)', user.email);
    if (c && sameName(c.name, user.name)) { e = c; run('UPDATE employees SET user_id=? WHERE id=?', user.id, e.id); }
  }
  return e || null;
}
export const managerUserId = (employee) => (employee?.manager_id ? get('SELECT user_id FROM employees WHERE id=?', employee.manager_id)?.user_id ?? null : null);

/**
 * Attendance for one month. Working days = every day except Sundays and holidays, up to today.
 * Percentage = days attended ÷ working days (approved leave days are excused, half days count 0.5).
 */
export function attendanceSummary(employeeId, month = today().slice(0, 7)) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Month must be YYYY-MM');
  const start = `${month}-01`, t = today();
  const end = lastDay(month) < t ? lastDay(month) : t;
  const holidays = new Map(all('SELECT date,name FROM holidays WHERE substr(date,1,7)=?', month).map((h) => [h.date, h.name]));
  const rec = new Map(all('SELECT * FROM attendance WHERE employee_id=? AND substr(date,1,7)=?', employeeId, month).map((a) => [a.date, a]));
  const days = [];
  const s = { working_days: 0, present: 0, late: 0, half_day: 0, absent: 0, leave: 0, unmarked: 0, late_minutes: 0 };
  for (let d = start; d <= lastDay(month); d = addDays(d, 1)) {
    const a = rec.get(d), off = dow(d) === 0, hol = holidays.get(d);
    const future = d > t;
    days.push({ date: d, status: a?.status || (off ? 'off' : hol ? 'holiday' : future ? 'upcoming' : 'unmarked'), check_in: a?.check_in || null, check_out: a?.check_out || null, late_minutes: a?.late_minutes || 0, holiday: hol || null });
    if (d > end || off || hol) continue;
    s.working_days++;
    if (!a) s.unmarked++;
    else if (a.status === 'present') s.present++;
    else if (a.status === 'late') { s.present++; s.late++; s.late_minutes += a.late_minutes; }
    else if (a.status === 'half_day') s.half_day++;
    else if (a.status === 'absent') s.absent++;
    else if (a.status === 'leave') s.leave++;
  }
  const attended = s.present + s.half_day * 0.5;
  const base = s.working_days - s.leave;
  return { month, ...s, attended, percentage: base > 0 ? Math.round((attended / base) * 100) : null, days };
}

/** Working days between two dates, skipping Sundays and holidays. */
export function leaveDays(from, to) {
  const hol = new Set(all('SELECT date FROM holidays').map((h) => h.date));
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (dow(d) !== 0 && !hol.has(d)) days++;
  return days;
}

export function leaveBalances(employeeId) {
  const types = all("SELECT value, meta FROM lookups WHERE type='leave_type' AND active=1");
  const year = today().slice(0, 4);
  return types.map((t) => {
    const quota = Number(jparse(t.meta, {}).quota ?? 0);
    const used = get("SELECT COALESCE(SUM(days),0) d FROM leaves WHERE employee_id=? AND type=? AND status='approved' AND substr(from_date,1,4)=?", employeeId, t.value, year).d;
    const pending = get("SELECT COALESCE(SUM(days),0) d FROM leaves WHERE employee_id=? AND type=? AND status='pending' AND substr(from_date,1,4)=?", employeeId, t.value, year).d;
    return { type: t.value, quota, used, pending, balance: quota - used };
  });
}

/** Create a pending leave request (HR on someone's behalf, or the employee for themselves). */
export function createLeave(employeeId, body, req) {
  const emp = get('SELECT * FROM employees WHERE id=?', employeeId);
  if (!emp) throw bad('Employee not found');
  const { type, from_date, to_date, reason } = body;
  if (!type || !from_date || !to_date) throw bad('Leave type and dates are required');
  if (to_date < from_date) throw bad('End date is before start date');
  const days = leaveDays(from_date, to_date);
  if (days === 0) throw bad('The selected range contains no working days');
  const bal = leaveBalances(employeeId).find((b) => b.type === type);
  if (bal && bal.quota && days > bal.balance - bal.pending) throw bad(`Insufficient ${type} leave balance (${Math.max(0, bal.balance - bal.pending)} day(s) available)`);
  if (get("SELECT 1 FROM leaves WHERE employee_id=? AND status IN ('pending','approved') AND from_date<=? AND to_date>=?", employeeId, to_date, from_date)) throw bad('Overlaps an existing leave request');
  const id = Number(run('INSERT INTO leaves(employee_id,type,from_date,to_date,days,reason,status,created_at) VALUES(?,?,?,?,?,?,?,?)', employeeId, type, from_date, to_date, days, reason ?? null, 'pending', now()).lastInsertRowid);
  const boss = managerUserId(emp);
  const msg = `${emp.name}: ${days} day(s) ${type} (${from_date} → ${to_date})`;
  notifyPerm('hrm', 'approve', 'leave', 'Leave requested', msg, '/hrm/leave');
  if (boss) notify(boss, 'leave', 'Leave request from your team', msg, '/hrm/leave');
  audit(req, 'Leave requested', 'leave', id, `${days} days ${type}`);
  return { id, days };
}

/** May this user decide leave for this employee? HR (hrm:approve), Super Admin, or the employee's reporting manager. */
export function canDecideLeave(user, employee) {
  if (hasPerm(user, 'hrm', 'approve')) return true;
  return !!employee?.manager_id && managerUserId(employee) === user.id;
}

/** approve | reject | revoke (undo an approval) | cancel (the employee withdraws a request). */
export function decideLeave(leave, action, note, req, { asEmployee = false } = {}) {
  const emp = get('SELECT * FROM employees WHERE id=?', leave.employee_id);
  if (asEmployee) {
    if (action !== 'cancel') throw forbidden('You can only withdraw your own request');
    if (leave.status !== 'pending') throw bad('Only pending requests can be withdrawn');
  } else if (!canDecideLeave(req.user, emp)) throw forbidden('You are not allowed to decide this leave');
  const next = { approve: ['pending', 'approved'], reject: ['pending', 'rejected'], revoke: ['approved', 'revoked'], cancel: ['pending', 'cancelled'] }[action];
  if (!next) throw bad('Unknown action');
  if (leave.status !== next[0]) throw bad(`Only ${next[0]} requests can be ${action === 'revoke' ? 'revoked' : action + (action.endsWith('e') ? 'd' : 'ed')}`);
  tx(() => {
    run('UPDATE leaves SET status=?, approved_by=?, decision_note=?, decided_at=? WHERE id=?', next[1], req.user.id, note || null, now(), leave.id);
    if (next[1] === 'approved') {
      for (let d = leave.from_date; d <= leave.to_date; d = addDays(d, 1)) {
        if (dow(d) !== 0) run("INSERT INTO attendance(employee_id,date,status) VALUES(?,?,'leave') ON CONFLICT(employee_id,date) DO UPDATE SET status='leave'", leave.employee_id, d);
      }
    }
    if (next[1] === 'revoked') run("DELETE FROM attendance WHERE employee_id=? AND date>=? AND date<=? AND status='leave'", leave.employee_id, leave.from_date, leave.to_date);
  });
  if (emp?.user_id && !asEmployee) notify(emp.user_id, 'leave', `Leave ${next[1]}`, `${leave.from_date} → ${leave.to_date}${note ? ` — ${note}` : ''}`, '/my/leave');
  audit(req, `Leave ${next[1]}`, 'leave', leave.id, note || `${emp?.name || ''} ${leave.from_date}→${leave.to_date}`);
  return next[1];
}

/** Commission still owed to an agent (approved by management, not yet paid out). */
export const commissionDue = (userId) => get("SELECT COALESCE(SUM(amount-paid_amount),0) v FROM commissions WHERE agent_id=? AND status IN ('approved','partially_paid')", userId).v;

export const workHours = () => ({ start: getSetting('work_start', '09:00'), end: getSetting('work_end', '18:00') });
