import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FormModal } from '../components/ResourcePage.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Card, ConfirmDialog, Empty, Field, KV, Loading, Modal, PageHead, Select, Stat, StatusBadge, Tabs } from '../components/ui.jsx';
import { api, download, fileUrl } from '../api.js';
import { useFetch, useToast, useUndoDelete } from '../context.jsx';
import { date, dateTime, money, todayPK, titleCase } from '../format.js';

/** Percentage ring (attendance). */
export function PctRing({ value, size = 120, label }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = (size - 14) / 2, c = 2 * Math.PI * r;
  const tone = value == null ? '#94a3b8' : v >= 90 ? '#16a34a' : v >= 75 ? '#d97706' : '#dc2626';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value ?? 0} percent`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e9f0" strokeWidth="11" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="11" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * v) / 100} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .5s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div><div style={{ fontSize: size / 4.2, fontWeight: 700, lineHeight: 1 }}>{value == null ? '—' : `${v}%`}</div>{label && <div className="muted" style={{ fontSize: 11 }}>{label}</div>}</div>
      </div>
    </div>
  );
}

const NoEmployee = ({ error }) => (
  <Card><Empty>{error || 'No employee record is linked to your login yet.'}<div className="muted" style={{ marginTop: 6 }}>Ask HR to link it: HRM → Employees → Edit → “Login (user account)”.</div></Empty></Card>
);

const EMP_TONE = { Intern: 'purple', Employee: 'blue', 'Part time': 'amber', 'Full time': 'green', Probation: 'amber', Permanent: 'green', 'Contract based': 'blue' };
export const EmpTypePill = ({ type }) => (type ? <span className={`pill ${EMP_TONE[type] || 'grey'}`}><i />{type}</span> : <span className="muted">—</span>);

// ================================================================== My profile
export function MyProfile() {
  const toast = useToast();
  const { data, error, reload } = useFetch('/api/staff/me/profile');
  const [edit, setEdit] = useState(false);
  const fileRef = useRef(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const e = data.employee;
  const upload = async (file) => {
    if (!file) return;
    try { const fd = new FormData(); fd.append('photo', file); await api.upload('/api/staff/me/profile', fd); toast('Photo updated', 'ok'); reload(); } catch (er) { toast(er.message, 'err'); }
  };
  if (!e) return (<div><PageHead title="My profile" /><NoEmployee /><Card title="Account"><KV items={[['Name', data.user.name], ['Email', data.user.email], ['Role', data.user.role]]} /></Card></div>);
  return (
    <div>
      <PageHead title="My profile" sub="Your details are maintained by HR. You can update your contact numbers and photo.">
        <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={14} />Update contact details</button>
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)', alignItems: 'start' }} data-stack="md">
        <Card>
          <div className="center" style={{ padding: '8px 0' }}>
            <div style={{ position: 'relative', width: 132, height: 132, margin: '0 auto 12px' }}>
              {e.photo ? <img src={fileUrl(e.photo)} alt={e.name} style={{ width: 132, height: 132, borderRadius: '50%', objectFit: 'cover', border: '4px solid var(--primary-l)' }} />
                : <span className="avatar" style={{ width: 132, height: 132, fontSize: 44, display: 'grid', placeItems: 'center', borderRadius: '50%' }}>{e.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>}
              <button className="icon-btn" aria-label="Change photo" onClick={() => fileRef.current?.click()} style={{ position: 'absolute', right: 2, bottom: 2, background: 'var(--primary)', color: '#fff', width: 34, height: 34 }}><Icon name="image" size={16} /></button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(ev) => upload(ev.target.files?.[0])} />
            </div>
            {e.photo && <button className="btn sm" style={{ marginBottom: 8 }} onClick={async () => { try { await api.del('/api/staff/me/profile/photo'); toast('Photo removed', 'ok'); reload(); } catch (er) { toast(er.message, 'err'); } }}><Icon name="trash" size={13} />Remove photo</button>}
            <h2 style={{ margin: '4px 0' }}>{e.name}</h2>
            <div className="muted">{e.designation}{e.department ? ` · ${e.department}` : ''}</div>
            <div style={{ marginTop: 10 }}><EmpTypePill type={e.employment_type} /></div>
            <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Employee ID <b className="mono">{e.emp_code}</b></div>
            {data.manager && <div className="muted" style={{ fontSize: 13 }}>Reports to <b>{data.manager.name}</b></div>}
          </div>
        </Card>
        <div className="stack">
          <Card title="Personal & employment details">
            <div className="grid g2">
              <KV items={[['Full name', e.name], ['Email', e.email], ['Phone', e.phone], ['Emergency contact', e.emergency_contact], ['Date of birth', date(e.dob)], ['Gender', e.gender], ['Father’s name', e.father_name]]} />
              <KV items={[['Employee ID', e.emp_code], ['Joining date', date(e.hire_date)], ['Employment status', <EmpTypePill key="t" type={e.employment_type} />], ['Department', e.department], ['Designation', e.designation], ['Branch', e.branch], ['Account status', <StatusBadge key="s" status={e.status} />]]} />
            </div>
          </Card>
          <Card title={`Company assets (${data.assets.length})`}>
            {!data.assets.length ? <Empty>No company assets are assigned to you.</Empty> : (
              <div className="stack">{data.assets.map((a) => (
                <div key={a.id} className="card" style={{ padding: 12, background: 'var(--surface-2)' }}>
                  <div className="row between wrap"><div><b>{a.name}</b>{a.brand_model && <span className="muted"> · {a.brand_model}</span>}</div><span className="tag mono">{a.asset_no}</span></div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{a.category && `${a.category} · `}Assigned on {date(a.assigned_date)}{a.serial_no && ` · Serial ${a.serial_no}`}</div>
                  {a.instructions && <div className="alert info" style={{ marginTop: 8, marginBottom: 0 }}><b>Instructions:</b> {a.instructions}</div>}
                </div>))}</div>
            )}
          </Card>
        </div>
      </div>
      {edit && <FormModal title="Update contact details" size="sm" initial={{ phone: e.phone, emergency_contact: e.emergency_contact, address: e.address }}
        fields={[{ name: 'phone', label: 'Phone' }, { name: 'emergency_contact', label: 'Emergency contact number' }, { name: 'address', label: 'Address', type: 'textarea' }]}
        onClose={() => setEdit(false)} onSave={async (f) => { await api.put('/api/staff/me/profile', f); setEdit(false); reload(); toast('Saved', 'ok'); }} />}
    </div>
  );
}

// ================================================================== My attendance
const DAY_TONE = { present: '#16a34a', late: '#d97706', half_day: '#0ea5e9', absent: '#dc2626', leave: '#6366f1', holiday: '#8b5cf6', off: '#cbd5e1', unmarked: '#f59e0b', upcoming: '#e2e8f0' };
const DAY_LABEL = { present: 'Present', late: 'Late', half_day: 'Half day', absent: 'Absent', leave: 'On leave', holiday: 'Holiday', off: 'Weekly off', unmarked: 'Not marked yet', upcoming: '' };
export function AttendanceCalendar({ summary }) {
  const first = new Date(`${summary.month}-01T00:00:00Z`).getUTCDay();
  const cells = [...Array(first).fill(null), ...summary.days];
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="muted center" style={{ fontSize: 11 }}>{d}</div>)}
        {cells.map((d, i) => d ? (
          <div key={d.date} title={`${date(d.date)} — ${DAY_LABEL[d.status] || d.status}${d.holiday ? ` (${d.holiday})` : ''}${d.check_in ? `\nIn ${d.check_in}${d.check_out ? ` · Out ${d.check_out}` : ''}` : ''}`}
            style={{ borderRadius: 8, padding: '6px 4px', minHeight: 48, textAlign: 'center', border: '1px solid var(--border)', background: d.status === 'upcoming' || d.status === 'off' ? '#fafbfc' : DAY_TONE[d.status] + '18' }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{Number(d.date.slice(8))}</div>
            <div style={{ width: 8, height: 8, borderRadius: '50%', margin: '4px auto 2px', background: DAY_TONE[d.status] }} />
            <div style={{ fontSize: 9.5, color: '#64748b', lineHeight: 1.1 }}>{d.status === 'upcoming' ? '' : (DAY_LABEL[d.status] || '').replace('Not marked yet', 'Unmarked')}</div>
          </div>) : <div key={`e${i}`} />)}
      </div>
    </div>
  );
}
export function MyAttendance() {
  const [month, setMonth] = useState(todayPK().slice(0, 7));
  const { data, error } = useFetch('/api/staff/me/attendance', { month }, [month]);
  const pctTone = data?.percentage == null ? '' : data.percentage >= 90 ? 'green' : data.percentage >= 75 ? 'amber' : 'red';
  return (
    <div>
      <PageHead title="My attendance" sub="Marked by HR each working day. Sundays and holidays are not counted."><input type="month" className="input" style={{ width: 160 }} value={month} max={todayPK().slice(0, 7)} onChange={(e) => setMonth(e.target.value || todayPK().slice(0, 7))} /></PageHead>
      {error ? <NoEmployee error={error} /> : !data ? <Loading /> : (
        <div className="stack">
          <Card>
            <div className="row wrap" style={{ gap: 24, alignItems: 'center' }}>
              <PctRing value={data.percentage} label="attendance" />
              <div className="grow" style={{ minWidth: 220 }}>
                <h2 style={{ margin: 0 }}>{data.percentage == null ? 'No working days yet' : `${data.percentage}% attendance`}{pctTone && <span className={`pill ${pctTone}`} style={{ marginLeft: 8, verticalAlign: 'middle' }}><i />{data.percentage >= 90 ? 'Excellent' : data.percentage >= 75 ? 'Needs attention' : 'Low'}</span>}</h2>
                <div className="muted" style={{ marginTop: 4 }}>{data.attended} of {data.working_days - data.leave} working days attended{data.leave ? ` (${data.leave} approved leave day(s) excused)` : ''}.</div>
                {data.unmarked > 0 && <div className="alert warn" style={{ marginTop: 10, marginBottom: 0 }}>{data.unmarked} working day(s) are not marked yet — HR marks attendance daily.</div>}
              </div>
            </div>
          </Card>
          <div className="grid g4">
            <Stat label="Present" value={data.present} tone="green" /><Stat label="Late arrivals" value={data.late} sub={data.late_minutes ? `${data.late_minutes} min in total` : undefined} tone={data.late ? 'amber' : ''} />
            <Stat label="Absent" value={data.absent} tone={data.absent ? 'red' : ''} /><Stat label="On leave" value={data.leave} />
          </div>
          <Card title="Daily record"><AttendanceCalendar summary={data} /></Card>
        </div>
      )}
    </div>
  );
}

// ================================================================== My leave (+ team approvals for managers)
export function LeaveActionModal({ leave, action, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const label = { approve: 'Approve', reject: 'Reject', revoke: 'Revoke approval' }[action];
  const run = async () => {
    setBusy(true);
    try { await api.post(`/api/hrm/leaves/${leave.id}/decide`, { action, note }); toast(`Leave ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revoked'}`, 'ok'); onDone(); } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={`${label} — ${leave.employee_name}`} size="sm" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${action === 'approve' ? 'primary' : 'danger'}`} disabled={busy} onClick={run}>{busy ? '…' : label}</button></>}>
      <div className="stack">
        <div className="muted">{leave.type} · {date(leave.from_date)} → {date(leave.to_date)} · {leave.days} working day(s){leave.reason ? ` · “${leave.reason}”` : ''}</div>
        {action === 'revoke' && <div className="alert warn">The leave days are removed from the attendance sheet and the employee is told.</div>}
        <Field label={action === 'approve' ? 'Comment (optional)' : 'Reason / comment'}><textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to the employee" /></Field>
      </div>
    </Modal>
  );
}
export function TeamLeaveTable({ rows, reload }) {
  const [act, setAct] = useState(null);
  return (
    <>
      <div className="table-wrap"><table className="t"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map((l) => (
          <tr key={l.id}><td><b>{l.employee_name}</b><div className="cell-sub">{l.emp_code}</div></td><td>{l.type}</td><td className="nowrap">{date(l.from_date)} → {date(l.to_date)}</td><td>{l.days}</td><td>{l.reason}</td>
            <td><StatusBadge status={l.status} />{l.decided_by && <div className="cell-sub">by {l.decided_by}{l.decision_note ? ` — ${l.decision_note}` : ''}</div>}</td>
            <td className="right nowrap">
              {l.can_decide && l.status === 'pending' && <><button className="btn sm danger" onClick={() => setAct({ l, a: 'reject' })}>Reject</button>{' '}<button className="btn sm primary" onClick={() => setAct({ l, a: 'approve' })}>Approve</button></>}
              {l.can_decide && l.status === 'approved' && <button className="btn sm" onClick={() => setAct({ l, a: 'revoke' })}>Revoke</button>}
            </td></tr>))}</tbody></table></div>
      {act && <LeaveActionModal leave={act.l} action={act.a} onClose={() => setAct(null)} onDone={() => { setAct(null); reload(); }} />}
    </>
  );
}
export function MyLeave() {
  const toast = useToast();
  const { data, error, reload } = useFetch('/api/staff/me/leaves');
  const team = useFetch('/api/staff/team/leaves');
  const [apply, setApply] = useState(false);
  const [withdraw, setWithdraw] = useState(null);
  const { hidden: hiddenLeaves, remove: removeLeave } = useUndoDelete('leaves');
  const types = useMemo(() => (data?.balances || []).map((b) => ({ value: b.type, label: b.quota ? `${b.type} (${Math.max(0, b.balance - b.pending)} available)` : b.type })), [data]);
  const pending = (team.data || []).filter((l) => l.status === 'pending' && l.can_decide);
  return (
    <div>
      <PageHead title="My leave" sub={data ? `Your requests go to ${data.approver || 'HR'} for approval` : 'Apply for leave and track approvals'}><button className="btn primary" disabled={!data} onClick={() => setApply({ type: types[0]?.value })}><Icon name="plus" size={14} />Apply for leave</button></PageHead>
      {error ? <NoEmployee error={error} /> : !data ? <Loading /> : (
        <div className="stack">
          <div className="grid g4">{data.balances.map((b) => <Stat key={b.type} label={`${b.type} leave`} value={b.quota ? `${b.balance - b.pending} left` : `${b.used} used`} sub={b.quota ? `${b.used} used${b.pending ? ` · ${b.pending} pending` : ''} of ${b.quota}` : undefined} />)}</div>
          <Card title="My requests" flush>
            {!data.rows.length ? <Empty>You haven’t applied for leave yet.</Empty> : (
              <div className="table-wrap"><table className="t"><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
                <tbody>{data.rows.filter((l) => !hiddenLeaves.has(l.id)).map((l) => <tr key={l.id}><td>{l.type}</td><td className="nowrap">{date(l.from_date)} → {date(l.to_date)}</td><td>{l.days}</td><td>{l.reason}</td>
                  <td><StatusBadge status={l.status} />{l.decision_note && <div className="cell-sub">“{l.decision_note}”{l.decided_by ? ` — ${l.decided_by}` : ''}</div>}</td>
                  <td className="right">{l.status === 'pending' && <button className="btn sm ghost danger" onClick={() => setWithdraw(l)}>Withdraw</button>}</td></tr>)}</tbody></table></div>
            )}
          </Card>
          {team.data?.length > 0 && <Card title={`Team leave requests${pending.length ? ` — ${pending.length} waiting for you` : ''}`} flush><TeamLeaveTable rows={team.data} reload={() => { team.reload(); }} /></Card>}
        </div>
      )}
      {apply && <FormModal title="Apply for leave" size="sm" submitLabel="Submit request" initial={apply}
        fields={[{ name: 'type', label: 'Leave type', type: 'select', options: types, allowEmpty: false, required: true }, { name: 'from_date', label: 'From', type: 'date', required: true }, { name: 'to_date', label: 'To', type: 'date', required: true },
          { name: 'reason', label: 'Reason', type: 'textarea', hint: 'Sundays and public holidays are not counted.' }]}
        onClose={() => setApply(false)} onSave={async (f) => { const r = await api.post('/api/staff/me/leaves', { ...f, to_date: f.to_date || f.from_date }); toast(`Request sent — ${r.days} working day(s)`, 'ok'); setApply(false); reload(); }} />}
      {withdraw && <ConfirmDialog title="Withdraw request" message={`Withdraw your ${withdraw.type} leave request (${date(withdraw.from_date)} → ${date(withdraw.to_date)})?`} confirmLabel="Withdraw" danger onCancel={() => setWithdraw(null)}
        onConfirm={async () => { const l = withdraw; setWithdraw(null); removeLeave(l.id, 'Leave request withdrawn', () => api.post(`/api/staff/me/leaves/${l.id}/cancel`), { onDone: reload }); }} />}
    </div>
  );
}

// ================================================================== My payroll
export function MyPayroll() {
  const toast = useToast();
  const { data, error } = useFetch('/api/staff/me/payroll');
  if (error) return <div><PageHead title="My payroll" /><NoEmployee error={error} /></div>;
  if (!data) return <Loading />;
  const t = data.totals;
  const dl = async (s) => { try { await download(`/api/staff/me/payroll/${s.id}/pdf`, {}, `payslip-${s.period}.pdf`); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div>
      <PageHead title="My payroll" sub="Your salary, payslips and commission — visible only to you" />
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat label="Monthly salary" value={money(data.salary.monthly)} sub={data.salary.designation} icon="wallet" /><Stat label="Paid this year" value={money(t.paid_ytd)} tone="green" />
        <Stat label="Commission earned" value={money(t.commission_earned)} sub={`${money(t.commission_paid)} paid`} /><Stat label="Commission to be paid" value={money(t.commission_due)} tone={t.commission_due ? 'amber' : ''} sub="Approved, goes out with your next salary" />
      </div>
      {data.next && <div className="alert info">Your {data.next.period} payroll is being prepared. It appears here once it has been paid.</div>}
      <div className="stack">
        <Card title="Payslips" flush>
          {!data.slips.length ? <Empty>No payslips yet.</Empty> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Period</th><th className="num">Basic</th><th className="num">Allowances</th><th className="num">Bonus</th><th className="num">Commission</th><th className="num">Deductions</th><th className="num">Net pay</th><th>Paid on</th><th /></tr></thead>
              <tbody>{data.slips.map((s) => <tr key={s.id}><td><b>{s.period}</b></td><td className="num mono">{money(s.basic)}</td><td className="num mono">{money(s.allowances)}</td><td className="num mono">{money(s.bonus)}</td><td className="num mono">{money(s.commission)}</td>
                <td className="num mono">{money(s.deductions + s.advances + s.loans)}</td><td className="num mono"><b>{money(s.net)}</b></td><td>{date(s.payment_date)}</td><td className="right"><button className="btn sm" onClick={() => dl(s)}>PDF</button></td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Card title="My commissions" flush>
          {!data.commissions.length ? <Empty>No commission yet.</Empty> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>No.</th><th>Sale</th><th className="num">Amount</th><th className="num">Paid</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>{data.commissions.map((c) => <tr key={c.commission_no}><td className="mono">{c.commission_no}</td><td>{c.property}<div className="cell-sub">{c.sale_no}</div></td><td className="num mono">{money(c.amount)}</td><td className="num mono">{money(c.paid_amount)}</td><td><StatusBadge status={c.status} /></td><td>{date(c.created_at)}</td></tr>)}</tbody></table></div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ================================================================== My tasks (+ assigning for managers)
const PRI = { Urgent: 'red', High: 'amber', Medium: 'blue', Low: 'grey' };
const TSTAT = [['todo', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];
function TaskModal({ id, senior, onClose, onChanged }) {
  const toast = useToast();
  const { data, reload } = useFetch(`/api/staff/work-tasks/${id}`);
  const [note, setNote] = useState('');
  if (!data) return <Modal title="Task" onClose={onClose}><Loading /></Modal>;
  const set = async (status) => { try { await api.put(`/api/staff/work-tasks/${id}`, { status, note: note || undefined }); setNote(''); toast('Updated', 'ok'); reload(); onChanged(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title={data.title} onClose={onClose}>
      <div className="stack">
        <div className="row wrap" style={{ gap: 8 }}><span className={`pill ${PRI[data.priority]}`}><i />{data.priority}</span><StatusBadge status={data.status} label={titleCase(data.status)} />{data.due_date && <span className={`tag ${data.overdue ? 'danger' : ''}`}>Due {date(data.due_date)}{data.overdue ? ' · overdue' : ''}</span>}</div>
        <div className="muted" style={{ fontSize: 13 }}>Assigned to <b>{data.assignee}</b> by <b>{data.assigner || '—'}</b> on {date(data.created_at)}</div>
        {data.description && <div style={{ whiteSpace: 'pre-wrap' }}>{data.description}</div>}
        <Field label="Update status"><div className="row wrap">{TSTAT.map(([k, l]) => <button key={k} className={`btn sm ${data.status === k ? 'primary' : ''}`} onClick={() => set(k)}>{l}</button>)}</div></Field>
        <Field label="Add a note for your manager"><div className="row"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Progress, blockers, questions…" /><button className="btn" disabled={!note.trim()} onClick={() => set(data.status)}>Post</button></div></Field>
        {data.updates?.length > 0 && <div><b style={{ fontSize: 13 }}>History</b>{data.updates.map((u) => <div key={u.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}><b>{u.user_name}</b> <span className="muted">· {titleCase(u.status)} · {dateTime(u.created_at)}</span>{u.note && <div>{u.note}</div>}</div>)}</div>}
        {senior && <button className="btn sm ghost danger" style={{ width: 'fit-content' }} onClick={async () => { if (!window.confirm('Delete this task?')) return; try { await api.del(`/api/staff/work-tasks/${id}`); onChanged(); onClose(); } catch (e) { toast(e.message, 'err'); } }}>Delete task</button>}
      </div>
    </Modal>
  );
}
function AssignModal({ onClose, onDone }) {
  const toast = useToast();
  const { data: people } = useFetch('/api/staff/work-tasks/assignees');
  const [f, setF] = useState({ title: '', description: '', priority: 'Medium', due_date: '', pick: [] });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const list = (people || []).filter((p) => !q || `${p.name} ${p.role} ${p.department || ''}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => setF((x) => ({ ...x, pick: x.pick.includes(id) ? x.pick.filter((i) => i !== id) : [...x.pick, id] }));
  const save = async () => {
    setBusy(true);
    try { const r = await api.post('/api/staff/work-tasks', { title: f.title, description: f.description, priority: f.priority, due_date: f.due_date || undefined, assigned_to_list: f.pick }); toast(`Assigned to ${r.ids.length} person(s) — they have been notified`, 'ok'); onDone(); } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title="Assign a task" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.title.trim() || !f.pick.length} onClick={save}>{busy ? 'Assigning…' : `Assign to ${f.pick.length || ''} ${f.pick.length === 1 ? 'person' : 'people'}`}</button></>}>
      <div className="stack">
        <Field label="Task" required><input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Call every interested lead today" /></Field>
        <Field label="Details"><textarea className="textarea" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="form-grid"><Field label="Priority"><Select allowEmpty={false} value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={['Low', 'Medium', 'High', 'Urgent']} /></Field><Field label="Due date"><input type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field></div>
        <Field label={`Assign to (${f.pick.length} selected)`}>
          <input className="input" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {!people ? <Loading /> : list.map((p) => <label key={p.id} className="row" style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}><input type="checkbox" checked={f.pick.includes(p.id)} onChange={() => toggle(p.id)} /><Avatar name={p.name} size="sm" /><span className="grow"><b>{p.name}</b><div className="cell-sub">{p.designation || p.role}{p.department ? ` · ${p.department}` : ''}</div></span></label>)}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
export function MyTasks() {
  const [sp, setSp] = useSearchParams();
  const scope = sp.get('scope') || 'mine';
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useFetch('/api/staff/work-tasks', { scope, status: status === 'all' ? '' : status }, [scope, status]);
  const [open, setOpen] = useState(null);
  const [assign, setAssign] = useState(false);
  const rows = data?.rows || [];
  const today = todayPK();
  const groups = [['Overdue', rows.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today)], ['Due today', rows.filter((t) => t.status !== 'done' && t.due_date === today)],
    ['Upcoming', rows.filter((t) => t.status !== 'done' && (!t.due_date || t.due_date > today))], ['Completed', rows.filter((t) => t.status === 'done')]].filter(([, g]) => g.length);
  return (
    <div>
      <PageHead title="Tasks" sub={scope === 'mine' ? 'Work assigned to you by your managers' : scope === 'assigned_by_me' ? 'Tasks you have assigned' : 'All team tasks'}>
        {data?.senior && <button className="btn primary" onClick={() => setAssign(true)}><Icon name="plus" size={14} />Assign task</button>}
      </PageHead>
      <Card flush>
        <div className="row between wrap" style={{ padding: '8px 12px', gap: 8 }}>
          {data?.senior ? <Tabs value={scope} onChange={(k) => setSp(k === 'mine' ? {} : { scope: k })} tabs={[{ key: 'mine', label: 'Assigned to me' }, { key: 'assigned_by_me', label: 'Assigned by me' }, { key: 'all', label: 'Whole team' }]} /> : <span />}
          <div style={{ width: 160 }}><Select allowEmpty={false} value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open tasks' }, { value: 'all', label: 'All tasks' }, { value: 'done', label: 'Completed' }]} /></div>
        </div>
        {error ? <div className="alert err" style={{ margin: 12 }}>{error}</div> : !data ? <Loading /> : !rows.length ? <Empty>{status === 'open' ? 'Nothing open — you’re all caught up. 🎉' : 'No tasks.'}</Empty> : (
          <div>{groups.map(([label, g]) => (
            <div key={label}><div style={{ padding: '8px 14px', background: 'var(--surface-2)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', color: label === 'Overdue' ? 'var(--danger, #dc2626)' : 'var(--muted)' }}>{label} · {g.length}</div>
              {g.map((t) => (
                <div key={t.id} className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', gap: 10 }} onClick={() => setOpen(t.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(t.id)}>
                  <span className={`pill ${PRI[t.priority]}`}><i />{t.priority}</span>
                  <div className="grow" style={{ minWidth: 0 }}><div style={{ fontWeight: 600, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</div>
                    <div className="cell-sub">{scope === 'mine' ? `From ${t.assigner || '—'}` : `To ${t.assignee}`}{t.due_date ? ` · due ${date(t.due_date)}` : ''}</div></div>
                  <StatusBadge status={t.status} label={titleCase(t.status)} />
                </div>))}
            </div>))}</div>
        )}
      </Card>
      {open && <TaskModal id={open} senior={data?.senior} onClose={() => setOpen(null)} onChanged={reload} />}
      {assign && <AssignModal onClose={() => setAssign(false)} onDone={() => { setAssign(false); reload(); }} />}
    </div>
  );
}
