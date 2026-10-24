import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BarsChart } from '../components/Charts.jsx';
import DataTable, { SearchBar, useTable } from '../components/DataTable.jsx';
import Icon from '../components/Icon.jsx';
import ResourcePage, { FormModal } from '../components/ResourcePage.jsx';
import { DocumentsPanel } from '../components/Uploaders.jsx';
import { Avatar, BackLink, Card, Empty, Field, KV, Loading, Modal, PageHead, Select, Stat, StatusBadge, Tabs } from '../components/ui.jsx';
import { api, fileUrl } from '../api.js';
import { EmpTypePill } from './MySpace.jsx';
import { useAuth, useFetch, useLookups, useToast } from '../context.jsx';
import { date, money, todayPK } from '../format.js';

const empFields = (employees, users = []) => [
  { name: 'name', label: 'Employee name', required: true, person: true }, { name: 'father_name', label: 'Father’s name' }, { name: 'cnic', label: 'CNIC' }, { name: 'dob', label: 'Date of birth', type: 'date' }, { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'] },
  { name: 'phone', label: 'Contact number' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'address', label: 'Address', full: true }, { name: 'emergency_contact', label: 'Emergency contact', full: true },
  { name: 'department', label: 'Department', type: 'select', lookup: 'department' }, { name: 'designation', label: 'Designation', type: 'select', lookup: 'designation' }, { name: 'hire_date', label: 'Recruitment date', type: 'date' },
  { name: 'employment_type', label: 'Employment status', type: 'select', lookup: 'employment_type', allowEmpty: false }, { name: 'salary', label: 'Salary (monthly)', type: 'money' }, { name: 'bonus', label: 'Standing bonus', type: 'money' },
  { name: 'commission_note', label: 'Commission arrangement' }, { name: 'manager_id', label: 'Reporting manager', type: 'select', number: true, options: employees.map((e) => ({ value: e.id, label: e.name })) }, { name: 'branch', label: 'Branch' },
  { name: 'user_id', label: 'Login (user account)', type: 'select', number: true, full: true, hint: 'Link the employee to their ERP login so My Profile, attendance, leave and payroll appear in their own portal.', options: users.map((u) => ({ value: u.id, label: `${u.name} — ${u.role}` })) },
];

export function Employees() {
  const nav = useNavigate();
  const { users } = useLookups();
  const emps = useFetch('/api/hrm/employees', { limit: 500 });
  return (
    <ResourcePage title="Employees" sub="Draft → Approved → Active" endpoint="/api/hrm/employees" module="hrm" noun="employee" tableId="employees" fields={empFields(emps.data?.rows || [], users)} defaults={{ employment_type: 'Full time' }}
      filterUI={(t) => <div style={{ width: 150 }}><Select value={t.extra.status || ''} onChange={(v) => t.setFilter({ status: v })} placeholder="All statuses" options={['draft', 'approved', 'active', 'inactive']} /></div>}
      columns={[{ key: 'name', label: 'Employee', render: (r) => <div className="row"><Avatar name={r.name} size="sm" /><div><Link to={`/hrm/employees/${r.id}`} className="cell-main">{r.name}</Link>{r.is_demo ? <span className="demo-chip">DEMO</span> : null}<div className="cell-sub">{r.emp_code}</div></div></div> },
        { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' }, { key: 'hire_date', label: 'Joined', render: (r) => date(r.hire_date) }, { key: 'salary', label: 'Salary', num: true, render: (r) => money(r.salary) }, { key: 'manager_name', label: 'Reports to', hidden: true }, { key: 'phone', label: 'Phone', hidden: true }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }]}
      rowActions={(r) => <Link to={`/hrm/employees/${r.id}`}>Open profile</Link>} canDeleteRow={(r) => r.status === 'draft'} />
  );
}

export function EmployeeProfile() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch(`/api/hrm/employees/${id}/profile`);
  const emps = useFetch('/api/hrm/employees', { limit: 500 });
  const [tab, setTab] = useState('info');
  const [editing, setEditing] = useState(false);
  const { users } = useLookups();
  const photoRef = useRef(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const e = data.employee;
  const wf = async (action, msg) => { try { await api.post(`/api/hrm/employees/${e.id}/workflow`, { action }); toast(msg, 'ok'); reload(); } catch (er) { toast(er.message, 'err'); } };
  return (
    <div>
      <BackLink to="/hrm/employees">Employees</BackLink>
      <PageHead title={e.name} sub={`${e.emp_code} · ${e.designation || ''} · ${e.department || ''}`}>
        <StatusBadge status={e.status} />
        {can('hrm', 'edit') && <button className="btn" onClick={() => photoRef.current?.click()}><Icon name="image" size={14} />{e.photo ? 'Change photo' : 'Upload photo'}</button>}
        <input ref={photoRef} type="file" accept="image/*" hidden onChange={async (ev) => { const file = ev.target.files?.[0]; if (!file) return; try { const fd = new FormData(); fd.append('photo', file); await api.upload(`/api/hrm/employees/${e.id}/photo`, fd); toast('Photo saved', 'ok'); reload(); } catch (er) { toast(er.message, 'err'); } }} />
        {can('hrm', 'edit') && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Edit</button>}
        {can('hrm', 'approve') && e.status === 'draft' && <button className="btn primary" onClick={() => wf('approve', 'Approved')}>Approve</button>}
        {can('hrm', 'approve') && e.status === 'approved' && <button className="btn primary" onClick={() => wf('activate', 'Employee is active')}>Activate</button>}
        {can('hrm', 'approve') && e.status === 'active' && <button className="btn danger" onClick={() => wf('deactivate', 'Deactivated')}>Deactivate</button>}
        {can('hrm', 'approve') && e.status === 'inactive' && <button className="btn" onClick={() => wf('reactivate', 'Reactivated')}>Reactivate</button>}
      </PageHead>
      <Card flush><Tabs value={tab} onChange={setTab} tabs={[{ key: 'info', label: 'Profile' }, { key: 'docs', label: 'Documents', count: data.documents.length }, { key: 'pay', label: 'Salary history' }, { key: 'leave', label: 'Leave' }, { key: 'att', label: 'Attendance' }, { key: 'assets', label: 'Assets', count: data.assets?.length || 0 }]} />
        <div className="card-b">
          {tab === 'info' && <div className="row" style={{ gap: 16, alignItems: 'flex-start', marginBottom: 14 }}>{e.photo ? <img src={fileUrl(e.photo)} alt={e.name} style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover' }} /> : <Avatar name={e.name} />}<div><b style={{ fontSize: 16 }}>{e.name}</b><div className="muted">{e.designation} · {e.department}</div><div style={{ marginTop: 6 }}><EmpTypePill type={e.employment_type} /></div></div></div>}
          {tab === 'info' && <div className="grid g2"><KV items={[['Father’s name', e.father_name], ['CNIC', e.cnic], ['Date of birth', date(e.dob)], ['Gender', e.gender], ['Phone', e.phone], ['Email', e.email], ['Address', e.address], ['Emergency contact', e.emergency_contact], ['Login', e.login_email || <span className="muted">not linked</span>]]} />
            <KV items={[['Department', e.department], ['Designation', e.designation], ['Recruitment date', date(e.hire_date)], ['Employment type', e.employment_type], ['Salary', money(e.salary)], ['Bonus', money(e.bonus)], ['Commission', e.commission_note], ['Branch', e.branch]]} /></div>}
          {tab === 'docs' && <DocumentsPanel entityType="employee" entityId={e.id} canEdit={can('hrm', 'edit')} categories={['CNIC', 'Resume/CV', 'Educational', 'Experience Letter', 'Contract', 'Passport', 'Photo', 'Other']} />}
          {tab === 'pay' && (data.payroll.length ? <table className="t"><thead><tr><th>Period</th><th className="num">Basic</th><th className="num">Allowances</th><th className="num">Bonus</th><th className="num">Commission</th><th className="num">Deductions</th><th className="num">Net</th><th>Status</th></tr></thead><tbody>{data.payroll.map((p) => <tr key={p.id}><td>{p.period}</td><td className="num mono">{money(p.basic)}</td><td className="num mono">{money(p.allowances)}</td><td className="num mono">{money(p.bonus)}</td><td className="num mono">{money(p.commission)}</td><td className="num mono">{money(p.deductions + p.advances + p.loans)}</td><td className="num mono bold">{money(p.net)}</td><td><StatusBadge status={p.status} /></td></tr>)}</tbody></table> : <Empty>No payroll yet.</Empty>)}
          {tab === 'leave' && <div className="stack"><div className="grid g4">{data.balances.map((b) => <Stat key={b.type} label={`${b.type} leave`} value={b.quota ? `${b.balance} left` : `${b.used} used`} sub={b.quota ? `${b.used} of ${b.quota} used` : 'unlimited'} />)}</div>
            {data.leaves.length ? <table className="t"><tbody>{data.leaves.map((l) => <tr key={l.id}><td>{l.type}</td><td>{date(l.from_date)} → {date(l.to_date)}</td><td>{l.days}d</td><td>{l.reason}</td><td><StatusBadge status={l.status} /></td></tr>)}</tbody></table> : <Empty>No leave requests.</Empty>}</div>}
          {tab === 'assets' && (data.assets?.length ? <table className="t"><thead><tr><th>Asset no.</th><th>Asset</th><th>Assigned on</th><th>Instructions</th></tr></thead><tbody>{data.assets.map((a) => <tr key={a.id}><td className="mono">{a.asset_no}</td><td>{a.name}<div className="cell-sub">{a.brand_model}</div></td><td>{date(a.assigned_date)}</td><td>{a.instructions}</td></tr>)}</tbody></table> : <Empty>No assets assigned.</Empty>)}
          {tab === 'att' && data.attendance_summary && <div className="row wrap" style={{ gap: 14, marginBottom: 12 }}><Stat label={`Attendance ${data.attendance_summary.month}`} value={data.attendance_summary.percentage == null ? '—' : `${data.attendance_summary.percentage}%`} sub={`${data.attendance_summary.attended} of ${data.attendance_summary.working_days - data.attendance_summary.leave} working days`} /></div>}
          {tab === 'att' && (data.attendance.length ? <table className="t"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Late (min)</th><th>Early (min)</th><th>Status</th></tr></thead><tbody>{data.attendance.map((a) => <tr key={a.id}><td>{date(a.date)}</td><td>{a.check_in || '—'}</td><td>{a.check_out || '—'}</td><td>{a.late_minutes || ''}</td><td>{a.early_minutes || ''}</td><td><StatusBadge status={a.status} /></td></tr>)}</tbody></table> : <Empty>No attendance records.</Empty>)}
        </div></Card>
      {editing && <FormModal title="Edit employee" fields={empFields(emps.data?.rows || [], users)} initial={e} onClose={() => setEditing(false)} onSave={async (f) => { await api.put(`/api/hrm/employees/${e.id}`, f); setEditing(false); reload(); toast('Saved', 'ok'); }} />}
    </div>
  );
}

export function EmployeeDocuments() {
  const [emp, setEmp] = useState('');
  const emps = useFetch('/api/hrm/employees', { limit: 500 });
  const { can } = useAuth();
  return (
    <div>
      <PageHead title="Employee documents" sub="CNIC, CV, education, experience letters, contracts, passports, photos" />
      <Card><Field label="Employee"><Select value={emp} onChange={setEmp} options={(emps.data?.rows || []).map((e) => ({ value: e.id, label: `${e.name} (${e.emp_code})` }))} placeholder="Select an employee…" /></Field>
        {emp && <div style={{ marginTop: 14 }}><DocumentsPanel key={emp} entityType="employee" entityId={emp} canEdit={can('hrm', 'edit')} categories={['CNIC', 'Resume/CV', 'Educational', 'Experience Letter', 'Contract', 'Passport', 'Photo', 'Other']} /></div>}</Card>
    </div>
  );
}

export function Salary({ bonuses }) {
  const { can } = useAuth();
  const toast = useToast();
  const { treasury } = useLookups();
  const [period, setPeriod] = useState(todayPK().slice(0, 7));
  const { data, reload, loading } = useFetch('/api/hrm/payroll', { period });
  const [edit, setEdit] = useState(null);
  const [pay, setPay] = useState(null);
  const rows = (data || []).filter((r) => !bonuses || r.bonus > 0 || true);
  const total = rows.reduce((s, r) => s + r.net, 0);
  return (
    <div>
      <PageHead title={bonuses ? 'Bonuses' : 'Salary & payroll'} sub="Net = basic + allowances + bonus + commission − deductions − advances − loans">
        <input type="month" className="input" style={{ width: 160 }} value={period} onChange={(e) => setPeriod(e.target.value)} />
        {can('hrm', 'create') && <button className="btn" onClick={async () => { try { const r = await api.post('/api/hrm/payroll/generate', { period }); toast(`${r.created} payroll record(s) generated`, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } }}>Generate payroll</button>}
      </PageHead>
      <Card flush>
        {loading && !data ? <Loading /> : !rows.length ? <Empty>No payroll for {period}. Click “Generate payroll” to create draft salary records for all active employees.</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Employee</th><th className="num">Basic</th><th className="num">Allowances</th><th className="num">Bonus</th><th className="num">Commission</th><th className="num">Deductions</th><th className="num">Advances/Loans</th><th className="num">Net salary</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td><Link to={`/hrm/employees/${r.employee_id}`}>{r.employee_name}</Link><div className="cell-sub">{r.emp_code}</div></td><td className="num mono">{money(r.basic)}</td><td className="num mono">{money(r.allowances)}</td><td className="num mono">{money(r.bonus)}</td><td className="num mono">{money(r.commission)}</td><td className="num mono">{money(r.deductions)}</td><td className="num mono">{money(r.advances + r.loans)}</td><td className="num mono bold">{money(r.net)}</td><td><StatusBadge status={r.status} />{r.payment_date && <div className="cell-sub">{date(r.payment_date)}</div>}</td>
              <td className="right nowrap">{r.status !== 'paid' && can('hrm', 'edit') && <button className="btn sm" onClick={() => setEdit(r)}>Edit</button>}{' '}{r.status !== 'paid' && can('hrm', 'approve') && <button className="btn sm primary" onClick={() => setPay(r)}>Pay</button>}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={7}>Total net payable</td><td className="num mono">{money(total)}</td><td colSpan={2} /></tr></tfoot></table></div>
        )}
      </Card>
      {edit && <FormModal title={`Salary — ${edit.employee_name} (${edit.period})`} size="sm" initial={edit} fields={['basic', 'allowances', 'bonus', 'commission', 'deductions', 'advances', 'loans'].map((k) => ({ name: k, label: k[0].toUpperCase() + k.slice(1), type: 'money' }))}
        onClose={() => setEdit(null)} onSave={async (f) => { await api.put(`/api/hrm/payroll/${edit.id}`, f); setEdit(null); reload(); toast('Saved', 'ok'); }} />}
      {pay && <FormModal title={`Pay ${pay.employee_name} — ${money(pay.net)}`} size="sm" submitLabel="Pay salary" initial={{ payment_date: todayPK(), payment_method: 'Bank Transfer', sync_accounting: true }}
        fields={[{ name: 'payment_date', label: 'Payment date', type: 'date' }, { name: 'payment_method', label: 'Method', type: 'select', lookup: 'payment_method', allowEmpty: false }, { name: 'sync_accounting', label: 'Post to accounting (Dr Salaries / Cr Cash-Bank)', type: 'bool', full: true },
          { name: 'account_id', label: 'Pay from', type: 'select', number: true, showIf: (f) => f.sync_accounting, required: true, options: treasury.map((a) => ({ value: a.id, label: a.name })) }]}
        onClose={() => setPay(null)} onSave={async (f) => { await api.post(`/api/hrm/payroll/${pay.id}/pay`, f); setPay(null); reload(); toast('Salary paid', 'ok'); }} />}
    </div>
  );
}

export function Attendance() {
  const { can } = useAuth();
  const toast = useToast();
  const [day, setDay] = useState(todayPK());
  const { data, reload } = useFetch('/api/hrm/attendance', { date: day });
  const [mark, setMark] = useState(null);
  const report = useFetch('/api/hrm/attendance/report', { month: day.slice(0, 7) });
  return (
    <div>
      <PageHead title="Attendance" sub={data?.holiday ? `Holiday: ${data.holiday.name}` : 'Check-in / check-out, late arrival and early departure'}><input type="date" className="input" style={{ width: 160 }} value={day} onChange={(e) => setDay(e.target.value)} /></PageHead>
      <Card flush>
        {!data ? <Loading /> : (<table className="t"><thead><tr><th>Employee</th><th>Department</th><th>Check-in</th><th>Check-out</th><th>Late</th><th>Early leave</th><th>Status</th><th /></tr></thead>
          <tbody>{data.rows.map((r) => <tr key={r.employee_id}><td><Link to={`/hrm/employees/${r.employee_id}`}>{r.employee_name}</Link></td><td>{r.department}</td><td>{r.check_in || '—'}</td><td>{r.check_out || '—'}</td><td>{r.late_minutes ? `${r.late_minutes} min` : ''}</td><td>{r.early_minutes ? `${r.early_minutes} min` : ''}</td><td><StatusBadge status={r.status} /></td>
            <td className="right">{can('hrm', 'create') && <button className="btn sm" onClick={() => setMark({ employee_id: r.employee_id, name: r.employee_name, date: day, check_in: r.check_in || '09:00', check_out: r.check_out || '' })}>{r.id ? 'Update' : 'Mark'}</button>}</td></tr>)}</tbody></table>)}
      </Card>
      <div style={{ height: 14 }} />
      <Card title={`Monthly summary — ${day.slice(0, 7)}`} flush>
        {report.data && <table className="t"><thead><tr><th>Employee</th><th className="num">Present</th><th className="num">Late</th><th className="num">Absent</th><th className="num">On leave</th><th className="num">Late minutes</th><th className="num">Early minutes</th></tr></thead><tbody>{report.data.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num">{r.present || 0}</td><td className="num">{r.late || 0}</td><td className="num">{r.absent || 0}</td><td className="num">{r.on_leave || 0}</td><td className="num">{r.late_minutes}</td><td className="num">{r.early_minutes}</td></tr>)}</tbody></table>}
      </Card>
      {mark && <FormModal title={`Attendance — ${mark.name}`} size="sm" initial={mark} fields={[{ name: 'check_in', label: 'Check-in', type: 'time' }, { name: 'check_out', label: 'Check-out', type: 'time' }, { name: 'status', label: 'Status override', type: 'select', options: ['present', 'late', 'absent', 'leave'] }]}
        onClose={() => setMark(null)} onSave={async (f) => { const r = await api.post('/api/hrm/attendance', f); toast(r.late ? `Marked — ${r.late} min late` : 'Marked', 'ok'); setMark(null); reload(); report.reload(); }} />}
    </div>
  );
}

export function Leave() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch('/api/hrm/leaves');
  const emps = useFetch('/api/hrm/employees', { limit: 500 });
  const hol = useFetch('/api/hrm/holidays', { limit: 100 });
  const [adding, setAdding] = useState(false);
  const [addHol, setAddHol] = useState(false);
  return (
    <div>
      <PageHead title="Leave" sub="Requests, approvals, balances and the holiday calendar">{can('hrm', 'create') && <button className="btn primary" onClick={() => setAdding({ type: 'Annual' })}><Icon name="plus" size={14} />Leave request</button>}</PageHead>
      <Card flush>
        {!data ? <Loading /> : !data.length ? <Empty>No leave requests.</Empty> : <table className="t"><thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((l) => <tr key={l.id}><td>{l.employee_name}</td><td>{l.type}</td><td>{date(l.from_date)}</td><td>{date(l.to_date)}</td><td>{l.days}</td><td>{l.reason}</td><td><StatusBadge status={l.status} />{l.approver && <div className="cell-sub">by {l.approver}</div>}</td>
            <td className="right nowrap">{l.status === 'pending' && can('hrm', 'approve') && <><button className="btn sm danger" onClick={async () => { await api.post(`/api/hrm/leaves/${l.id}/decide`, { approve: false }); reload(); }}>Reject</button> <button className="btn sm primary" onClick={async () => { await api.post(`/api/hrm/leaves/${l.id}/decide`, { approve: true }); toast('Approved', 'ok'); reload(); }}>Approve</button></>}</td></tr>)}</tbody></table>}
      </Card>
      <div style={{ height: 14 }} />
      <Card title="Holiday calendar" actions={can('hrm', 'create') && <button className="btn sm" onClick={() => setAddHol({})}>Add holiday</button>} flush>
        {hol.data && <table className="t"><tbody>{hol.data.rows.map((h) => <tr key={h.id}><td>{date(h.date)}</td><td>{h.name}</td><td className="right">{can('hrm', 'delete') && <button className="btn sm ghost danger" onClick={async () => { await api.del(`/api/hrm/holidays/${h.id}`); hol.reload(); }}>Remove</button>}</td></tr>)}</tbody></table>}
      </Card>
      {adding && <FormModal title="Leave request" size="sm" initial={adding} submitLabel="Submit request" fields={[{ name: 'employee_id', label: 'Employee', type: 'select', number: true, required: true, options: (emps.data?.rows || []).map((e) => ({ value: e.id, label: e.name })) }, { name: 'type', label: 'Leave type', type: 'select', lookup: 'leave_type', allowEmpty: false },
        { name: 'from_date', label: 'From', type: 'date', required: true }, { name: 'to_date', label: 'To', type: 'date', required: true }, { name: 'reason', label: 'Reason', type: 'textarea' }]}
      onClose={() => setAdding(false)} onSave={async (f) => { const r = await api.post('/api/hrm/leaves', f); toast(`${r.days} working day(s) requested`, 'ok'); setAdding(false); reload(); }} />}
      {addHol && <FormModal title="Add holiday" size="sm" initial={addHol} fields={[{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'name', label: 'Holiday', required: true }]} onClose={() => setAddHol(false)} onSave={async (f) => { await api.post('/api/hrm/holidays', f); setAddHol(false); hol.reload(); }} />}
    </div>
  );
}

export function Recruitment() {
  return <ResourcePage title="Recruitment" sub="Candidates and hiring pipeline" endpoint="/api/hrm/recruitment" module="hrm" noun="candidate" tableId="recruitment"
    fields={[{ name: 'candidate', label: 'Candidate', required: true }, { name: 'position', label: 'Position', required: true }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' }, { name: 'stage', label: 'Stage', type: 'select', options: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'], allowEmpty: false }, { name: 'notes', label: 'Notes', type: 'textarea' }]}
    defaults={{ stage: 'Applied' }} columns={[{ key: 'candidate', label: 'Candidate', render: (r) => <span className="cell-main">{r.candidate}</span> }, { key: 'position', label: 'Position' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'stage', label: 'Stage', render: (r) => <StatusBadge status={r.stage} tone={r.stage === 'Hired' ? 'green' : r.stage === 'Rejected' ? 'red' : 'blue'} /> }]} />;
}

export function HrReports() {
  const { data } = useFetch('/api/hrm/summary');
  if (!data) return <Loading />;
  return (
    <div>
      <PageHead title="HR reports"><Link className="btn" to="/reports/Employee">More employee reports</Link></PageHead>
      <div className="grid g3" style={{ marginBottom: 14 }}><Stat label="Active headcount" value={data.headcount} /><Stat label="Monthly payroll (basic)" value={money(data.monthly_payroll)} /><Stat label="Pending leave requests" value={data.pending_leaves} to="/hrm/leave" /></div>
      <Card title="Headcount and payroll by department"><BarsChart isMonth={false} x="department" data={data.by_department} series={[{ key: 'payroll', label: 'Payroll' }]} /></Card>
    </div>
  );
}
