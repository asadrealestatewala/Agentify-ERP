import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FormModal } from '../components/ResourcePage.jsx';
import Icon from '../components/Icon.jsx';
import { Card, Empty, Loading, Modal, PageHead, Select, Stat, StatusBadge, Tabs } from '../components/ui.jsx';
import { LeaveActionModal } from './MySpace.jsx';
import { api, download } from '../api.js';
import { useAuth, useFetch, useLookups, useToast } from '../context.jsx';
import { date, money, todayPK, getRegion } from '../format.js';

const STATUSES = [['present', 'P', 'Present'], ['late', 'L', 'Late'], ['half_day', 'HD', 'Half day'], ['absent', 'A', 'Absent'], ['leave', 'Lv', 'On leave']];

// ================================================================== Attendance — HR marks the day
export function AttendanceBoard() {
  const { can } = useAuth();
  const toast = useToast();
  const [day, setDay] = useState(todayPK());
  const { data, reload } = useFetch('/api/hrm/attendance', { date: day }, [day]);
  const report = useFetch('/api/hrm/attendance/report', { month: day.slice(0, 7) }, [day.slice(0, 7)]);
  const [time, setTime] = useState(null);
  const [busy, setBusy] = useState('');
  const canMark = can('hrm', 'create');
  const refresh = () => { reload(); report.reload(); };
  const mark = async (r, status) => {
    setBusy(String(r.employee_id));
    try {
      const body = { employee_id: r.employee_id, date: day, status };
      if (status === 'present') { body.check_in = r.check_in || '09:00'; body.check_out = r.check_out || ''; }
      if (status === 'late') { body.check_in = r.check_in && r.check_in > '09:00' ? r.check_in : '09:30'; }
      await api.post('/api/hrm/attendance', body); refresh();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const nowPK = () => new Date().toLocaleTimeString('en-GB', { timeZone: getRegion().config.timezone, hour: '2-digit', minute: '2-digit' });
  /** Manual clock in / clock out: late and early minutes and the status are worked out from the working hours. */
  const saveTimes = async (r, patch, el) => {
    const undo = () => { if (el) el.value = patch.check_in !== undefined ? (r.check_in || '') : (r.check_out || ''); };
    const check_in = patch.check_in !== undefined ? patch.check_in : r.check_in || '';
    const check_out = patch.check_out !== undefined ? patch.check_out : r.check_out || '';
    if (check_in && check_out && check_out < check_in) { undo(); return toast('Clock-out cannot be before clock-in', 'err'); }
    const keep = ['half_day', 'leave'].includes(r.status) && r.id;
    const body = { employee_id: r.employee_id, date: day, check_in, check_out };
    if (keep) body.status = r.status;
    else if (!check_in && check_out) body.status = 'present';
    else if (!check_in && !check_out) body.status = r.id ? r.status : 'absent';
    setBusy(String(r.employee_id));
    try { const res = await api.post('/api/hrm/attendance', body); toast(res.late ? `Saved — ${res.late} min late` : 'Saved', 'ok'); refresh(); } catch (e) { undo(); toast(e.message, 'err'); refresh(); } finally { setBusy(''); }
  };
  const allPresent = async () => {
    try { const r = await api.post('/api/hrm/attendance/bulk', { date: day, all_present: true }); toast(r.marked ? `${r.marked} employee(s) marked present` : 'Everyone is already marked', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); }
  };
  const rows = data?.rows || [];
  const marked = rows.filter((r) => r.id).length;
  const count = (s) => rows.filter((r) => r.id && r.status === s).length;
  const isSunday = new Date(`${day}T00:00:00Z`).getUTCDay() === 0;
  const dl = (format) => download('/api/hrm/attendance/report', { month: day.slice(0, 7), format }, `attendance-${day.slice(0, 7)}.${format}`).catch((e) => toast(e.message, 'err'));
  return (
    <div>
      <PageHead title="Attendance" sub={data?.holiday ? `Holiday: ${data.holiday.name}` : isSunday ? 'Weekly off' : 'Mark each employee’s attendance for the day — employees see their own percentage'}>
        <input type="date" className="input" style={{ width: 160 }} value={day} max={todayPK()} onChange={(e) => setDay(e.target.value || todayPK())} />
        {canMark && <button className="btn primary" onClick={allPresent}><Icon name="check" size={14} />Mark everyone present</button>}
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat label="Marked today" value={`${marked} / ${rows.length}`} tone={marked === rows.length ? 'green' : 'amber'} /><Stat label="Present" value={count('present') + count('late')} tone="green" sub={count('late') ? `${count('late')} late` : undefined} />
        <Stat label="Absent" value={count('absent')} tone={count('absent') ? 'red' : ''} /><Stat label="On leave / half day" value={count('leave') + count('half_day')} />
      </div>
      <Card flush>
        {!data ? <Loading /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Employee</th><th>Department</th><th>Mark attendance</th><th>Clock in</th><th>Clock out</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.employee_id}><td><Link to={`/hrm/employees/${r.employee_id}`} className="cell-main">{r.employee_name}</Link><div className="cell-sub">{r.emp_code}</div></td><td>{r.department}</td>
                <td>{canMark ? <div className="seg-btns" role="group" aria-label={`Attendance for ${r.employee_name}`}>{STATUSES.map(([k, s, l]) => <button key={k} title={l} disabled={busy === String(r.employee_id)} className={r.id && r.status === k ? `on ${k}` : ''} onClick={() => mark(r, k)}>{s}</button>)}</div> : <StatusBadge status={r.id ? r.status : 'unmarked'} />}
                  {!r.id && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>not marked</span>}</td>
                <td style={{ minWidth: 150 }}>{canMark ? (
                  <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <input key={`i${r.employee_id}${r.check_in}`} type="time" className="input" style={{ height: 30, width: 104 }} aria-label={`Clock in for ${r.employee_name}`} defaultValue={r.check_in || ''} disabled={busy === String(r.employee_id)} onBlur={(e) => e.target.value !== (r.check_in || '') && saveTimes(r, { check_in: e.target.value }, e.target)} />
                    <button className="btn sm" title="Clock in now" disabled={busy === String(r.employee_id)} onClick={() => saveTimes(r, { check_in: nowPK() })}>Now</button>
                  </div>) : (r.check_in || '—')}{r.late_minutes ? <div className="cell-sub">{r.late_minutes} min late</div> : null}</td>
                <td style={{ minWidth: 150 }}>{canMark ? (
                  <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <input key={`o${r.employee_id}${r.check_out}`} type="time" className="input" style={{ height: 30, width: 104 }} aria-label={`Clock out for ${r.employee_name}`} defaultValue={r.check_out || ''} disabled={busy === String(r.employee_id)} onBlur={(e) => e.target.value !== (r.check_out || '') && saveTimes(r, { check_out: e.target.value }, e.target)} />
                    <button className="btn sm" title="Clock out now" disabled={busy === String(r.employee_id)} onClick={() => saveTimes(r, { check_out: nowPK() })}>Now</button>
                  </div>) : (r.check_out || '—')}</td>
                <td className="right">{canMark && <button className="btn sm ghost" onClick={() => setTime({ employee_id: r.employee_id, name: r.employee_name, date: day, check_in: r.check_in || '09:00', check_out: r.check_out || '', status: r.id ? r.status : '' })}>Times</button>}</td></tr>))}</tbody></table></div>
        )}
      </Card>
      <div style={{ height: 14 }} />
      <Card title={`Monthly attendance — ${day.slice(0, 7)}`} actions={<><button className="btn sm" onClick={() => dl('xlsx')}>Excel</button><button className="btn sm" onClick={() => dl('pdf')}>PDF</button></>} flush>
        {!report.data ? <Loading /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Employee</th><th className="num">Working days</th><th className="num">Present</th><th className="num">Late</th><th className="num">Half</th><th className="num">Absent</th><th className="num">Leave</th><th className="num">Not marked</th><th style={{ minWidth: 150 }}>Attendance</th></tr></thead>
            <tbody>{report.data.map((r) => (
              <tr key={r.id}><td><Link to={`/hrm/employees/${r.id}`}>{r.name}</Link></td><td className="num">{r.working_days}</td><td className="num">{r.present}</td><td className="num">{r.late}</td><td className="num">{r.half_day}</td><td className="num">{r.absent}</td><td className="num">{r.on_leave}</td><td className="num">{r.unmarked || '—'}</td>
                <td>{r.percentage == null ? '—' : <div className="row" style={{ gap: 8 }}><div className="cnt-bar grow"><i style={{ width: `${r.percentage}%`, background: r.percentage >= 90 ? '#16a34a' : r.percentage >= 75 ? '#d97706' : '#dc2626' }} /></div><b style={{ width: 38, textAlign: 'right' }}>{r.percentage}%</b></div>}</td></tr>))}</tbody></table></div>
        )}
      </Card>
      {time && <FormModal title={`Check-in / out — ${time.name}`} size="sm" initial={time} fields={[{ name: 'check_in', label: 'Check-in', type: 'time' }, { name: 'check_out', label: 'Check-out', type: 'time' }, { name: 'status', label: 'Status (blank = automatic)', type: 'select', options: STATUSES.map(([v, , l]) => ({ value: v, label: l })) }]}
        onClose={() => setTime(null)} onSave={async (f) => { const r = await api.post('/api/hrm/attendance', f); toast(r.late ? `Marked — ${r.late} min late` : 'Saved', 'ok'); setTime(null); refresh(); }} />}
    </div>
  );
}

// ================================================================== Leave — approvals for HR / managers
export function LeaveBoard() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const { data, reload } = useFetch('/api/staff/team/leaves', { status: status === 'all' ? '' : status }, [status]);
  const emps = useFetch('/api/hrm/employees', { limit: 500 });
  const hol = useFetch('/api/hrm/holidays', { limit: 100 });
  const [adding, setAdding] = useState(false);
  const [addHol, setAddHol] = useState(false);
  const [act, setAct] = useState(null);
  const canHr = can('hrm', 'view');
  return (
    <div>
      <PageHead title="Leave" sub="Employees apply from their own portal — HR or the reporting manager approves, rejects or revokes here">
        {can('hrm', 'create') && <button className="btn" onClick={() => setAdding({ type: 'Annual' })}><Icon name="plus" size={14} />Enter on behalf of an employee</button>}
      </PageHead>
      <Card flush>
        <div style={{ padding: '4px 8px' }}><Tabs value={status} onChange={setStatus} tabs={[{ key: 'pending', label: 'Pending' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }, { key: 'revoked', label: 'Revoked' }, { key: 'all', label: 'All' }]} /></div>
        {!data ? <Loading /> : !data.length ? <Empty>No {status === 'all' ? '' : status} leave requests.</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((l) => (
              <tr key={l.id}><td><b>{l.employee_name}</b><div className="cell-sub">{l.emp_code}</div></td><td>{l.type}</td><td className="nowrap">{date(l.from_date)} → {date(l.to_date)}</td><td>{l.days}</td><td>{l.reason}</td>
                <td><StatusBadge status={l.status} />{l.decided_by && <div className="cell-sub">by {l.decided_by}{l.decision_note ? ` — “${l.decision_note}”` : ''}</div>}</td>
                <td className="right nowrap">
                  {l.can_decide && l.status === 'pending' && <><button className="btn sm danger" onClick={() => setAct({ l, a: 'reject' })}>Reject</button>{' '}<button className="btn sm primary" onClick={() => setAct({ l, a: 'approve' })}>Approve</button></>}
                  {l.can_decide && l.status === 'approved' && <button className="btn sm" onClick={() => setAct({ l, a: 'revoke' })}>Revoke</button>}
                </td></tr>))}</tbody></table></div>
        )}
      </Card>
      {canHr && <>
        <div style={{ height: 14 }} />
        <Card title="Holiday calendar" actions={can('hrm', 'create') && <button className="btn sm" onClick={() => setAddHol({})}>Add holiday</button>} flush>
          {hol.data && <table className="t"><tbody>{hol.data.rows.map((h) => <tr key={h.id}><td>{date(h.date)}</td><td>{h.name}</td><td className="right">{can('hrm', 'delete') && <button className="btn sm ghost danger" onClick={async () => { await api.del(`/api/hrm/holidays/${h.id}`); hol.reload(); }}>Remove</button>}</td></tr>)}</tbody></table>}
        </Card></>}
      {act && <LeaveActionModal leave={act.l} action={act.a} onClose={() => setAct(null)} onDone={() => { setAct(null); reload(); }} />}
      {adding && <FormModal title="Leave request" size="sm" initial={adding} submitLabel="Submit request"
        fields={[{ name: 'employee_id', label: 'Employee', type: 'select', number: true, required: true, options: (emps.data?.rows || []).map((e) => ({ value: e.id, label: e.name })) }, { name: 'type', label: 'Type', type: 'select', lookup: 'leave_type', allowEmpty: false },
          { name: 'from_date', label: 'From', type: 'date', required: true }, { name: 'to_date', label: 'To', type: 'date', required: true }, { name: 'reason', label: 'Reason', type: 'textarea' }]}
        onClose={() => setAdding(false)} onSave={async (f) => { const r = await api.post('/api/hrm/leaves', f); toast(`${r.days} working day(s) requested`, 'ok'); setAdding(false); reload(); }} />}
      {addHol && <FormModal title="Add holiday" size="sm" initial={addHol} fields={[{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'name', label: 'Holiday', required: true }]} onClose={() => setAddHol(false)} onSave={async (f) => { await api.post('/api/hrm/holidays', f); setAddHol(false); hol.reload(); }} />}
    </div>
  );
}

// ================================================================== Assets & inventory
const ASSET_STATUS = { in_stock: ['In stock', 'green'], assigned: ['Assigned', 'blue'], repair: ['In repair', 'amber'], retired: ['Retired', 'grey'] };
export function Assets() {
  const { can } = useAuth();
  const toast = useToast();
  const { treasury } = useLookups();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const { data, reload } = useFetch('/api/staff/assets', { q, status, incomplete: incomplete ? 1 : undefined }, [q, status, incomplete]);
  const emps = useFetch(can('hrm', 'view') ? '/api/hrm/employees' : null, { limit: 500, status: 'active' });
  const vouchers = useFetch(can('accounting', 'view') ? '/api/accounting/expenses' : null, { limit: 100 });
  const [edit, setEdit] = useState(null);
  const canEditLib = can('hrm', 'edit') || can('accounting', 'edit');
  const [add, setAdd] = useState(null);
  const [assign, setAssign] = useState(null);
  const [ret, setRet] = useState(null);
  const [detail, setDetail] = useState(null);
  const empOpts = (emps.data?.rows || []).map((e) => ({ value: e.id, label: `${e.name} (${e.emp_code})` }));
  const s = data?.summary;
  const openDetail = async (a) => setDetail(await api.get(`/api/staff/assets/${a.id}`));
  return (
    <div>
      <PageHead title="Assets & inventory" sub="The Asset Library. Anything bought through an expense voucher lands here automatically once approved — cost, date and vendor come from the voucher, so only the missing details need adding.">
        {can('hrm', 'create') && <button className="btn primary" onClick={() => setAdd({ funding: 'new', purchase_date: todayPK() })}><Icon name="plus" size={14} />Add asset</button>}
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat label="Assets" value={s?.count ?? '—'} /><Stat label="Total value" value={s ? money(s.value) : '—'} /><Stat label="Assigned" value={s?.assigned ?? '—'} tone="blue" /><Stat label="In stock" value={s?.in_stock ?? '—'} tone="green" />
        {(s?.incomplete > 0 || incomplete) && <button className="linklike" style={{ gridColumn: '1 / -1', textAlign: 'left' }} onClick={() => setIncomplete(!incomplete)}>{incomplete ? (data?.rows.length ? '✓ Showing only assets with details missing — show all' : '✓ All assets have their details — show all') : `${s?.incomplete} asset(s) are missing details (category, make/model or serial no.) — show them`}</button>}
      </div>
      <Card flush>
        <div className="row wrap" style={{ padding: 10, gap: 8 }}>
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search asset, number, serial, employee…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ width: 160 }}><Select value={status} onChange={setStatus} placeholder="All statuses" options={Object.entries(ASSET_STATUS).map(([v, [l]]) => ({ value: v, label: l }))} /></div>
        </div>
        {!data ? <Loading /> : !data.rows.length ? <Empty>No assets yet.</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Asset no.</th><th>Asset</th><th>Category</th><th>Held by</th><th>Assigned on</th><th className="num">Cost</th><th>Voucher</th><th>Status</th><th /></tr></thead>
            <tbody>{data.rows.map((a) => (
              <tr key={a.id}><td className="mono"><button className="linklike" onClick={() => openDetail(a)}>{a.asset_no}</button></td><td><b>{a.name}</b><div className="cell-sub">{[a.brand_model, a.serial_no, a.vendor_name && `from ${a.vendor_name}`].filter(Boolean).join(' · ')}</div>{a.details_missing && <span className="pill amber">Details missing</span>}</td><td>{a.category}</td>
                <td>{a.employee_name ? <Link to={`/hrm/employees/${a.employee_id}`}>{a.employee_name}</Link> : '—'}</td><td>{date(a.assigned_date)}</td><td className="num mono">{money(a.cost)}</td>
                <td>{a.voucher_no ? (can('accounting', 'view') ? <Link to={`/expenses/${a.voucher_id}`} className="mono">{a.voucher_no}</Link> : <span className="mono">{a.voucher_no}</span>) : <span className="muted">—</span>}</td><td><StatusBadge status={a.status} label={ASSET_STATUS[a.status]?.[0]} tone={ASSET_STATUS[a.status]?.[1]} /></td>
                <td className="right nowrap">{canEditLib && <button className="btn sm" onClick={() => setEdit({ ...a })}>Details</button>} {can('hrm', 'edit') && (a.status === 'assigned' ? <button className="btn sm" onClick={() => setRet(a)}>Return</button> : ['in_stock'].includes(a.status) && <button className="btn sm primary" onClick={() => setAssign({ asset: a, date: todayPK(), instructions: a.instructions || '' })}>Assign</button>)}</td></tr>))}</tbody></table></div>
        )}
      </Card>
      {add && (
        <FormModal title="Add asset" initial={add} submitLabel="Add asset"
          fields={[{ name: 'name', label: 'Asset name', required: true, placeholder: 'e.g. Laptop' }, { name: 'category', label: 'Category', type: 'select', lookup: 'asset_category' }, { name: 'brand_model', label: 'Brand / model' }, { name: 'serial_no', label: 'Serial / IMEI' },
            { name: 'purchase_date', label: 'Purchase date', type: 'date' }, { name: 'cost', label: 'Cost', type: 'money' }, { name: 'instructions', label: 'Default instructions for the holder', type: 'textarea', full: true },
            { name: 'funding', label: 'How was it paid for?', type: 'select', allowEmpty: false, full: true, options: [{ value: 'new', label: 'Create an expense voucher for this purchase' }, { value: 'link', label: 'Link an existing expense voucher' }, { value: 'none', label: 'Not tracked in accounts (gift / existing stock)' }] },
            { name: 'paid_from_account_id', label: 'Paid from', type: 'select', number: true, showIf: (f) => f.funding === 'new', options: treasury.map((a) => ({ value: a.id, label: a.name })), hint: 'The voucher goes to the approval queue — funds move when Finance approves and pays it.' },
            { name: 'payment_method', label: 'Payment method', type: 'select', lookup: 'payment_method', showIf: (f) => f.funding === 'new' },
            { name: 'voucher_id', label: 'Expense voucher', type: 'select', number: true, showIf: (f) => f.funding === 'link', full: true, options: (vouchers.data?.rows || []).map((v) => ({ value: v.id, label: `${v.voucher_no} — ${v.description || ''} (${money(v.amount)})` })) }]}
          onClose={() => setAdd(null)}
          onSave={async (f) => {
            const body = { ...f, create_voucher: f.funding === 'new' && Number(f.cost) > 0, voucher_id: f.funding === 'link' ? f.voucher_id : undefined };
            const r = await api.post('/api/staff/assets', body);
            toast(`${r.asset_no} added${r.voucher_id && f.funding === 'new' ? ' — expense voucher created' : ''}`, 'ok'); setAdd(null); reload();
          }} />
      )}
      {assign && <FormModal title={`Assign ${assign.asset.name} (${assign.asset.asset_no})`} size="sm" initial={assign} submitLabel="Assign"
        fields={[{ name: 'employee_id', label: 'Employee', type: 'select', number: true, required: true, options: empOpts }, { name: 'date', label: 'Assigned on', type: 'date' }, { name: 'instructions', label: 'Instructions for the employee', type: 'textarea', hint: 'Shown in their My profile and sent as a notification.' }]}
        onClose={() => setAssign(null)} onSave={async (f) => { await api.post(`/api/staff/assets/${assign.asset.id}/assign`, { employee_id: f.employee_id, date: f.date, instructions: f.instructions }); toast('Assigned — the employee has been notified', 'ok'); setAssign(null); reload(); }} />}
      {ret && <FormModal title={`Return ${ret.name} from ${ret.employee_name}`} size="sm" initial={{ date: todayPK(), condition: 'good' }} submitLabel="Mark returned"
        fields={[{ name: 'date', label: 'Returned on', type: 'date' }, { name: 'condition', label: 'Condition', type: 'select', allowEmpty: false, options: [{ value: 'good', label: 'Good — back to stock' }, { value: 'repair', label: 'Needs repair' }] }, { name: 'note', label: 'Note', type: 'textarea' }]}
        onClose={() => setRet(null)} onSave={async (f) => { await api.post(`/api/staff/assets/${ret.id}/return`, f); setRet(null); reload(); toast('Returned', 'ok'); }} />}
      {edit && (
        <FormModal title={`${edit.asset_no} — asset details`} initial={edit} submitLabel="Save details"
          fields={[{ name: 'name', label: 'Asset name', required: true }, { name: 'category', label: 'Category', type: 'select', lookup: 'asset_category' }, { name: 'brand_model', label: 'Brand / model' }, { name: 'serial_no', label: 'Serial / IMEI' },
            { name: 'warranty_until', label: 'Warranty until', type: 'date' }, ...(edit.voucher_id ? [] : [{ name: 'purchase_date', label: 'Purchase date', type: 'date' }, { name: 'cost', label: 'Cost', type: 'money' }]),
            { name: 'instructions', label: 'Default instructions for the holder', type: 'textarea', full: true }, { name: 'notes', label: 'Notes', type: 'textarea', full: true }]}
          extra={edit.voucher_id ? <div className="alert info">Cost ({money(edit.cost)}), purchase date and vendor come from expense voucher <b>{edit.voucher_no}</b> and are not entered again.</div> : null}
          onClose={() => setEdit(null)} onSave={async (f) => { await api.put(`/api/staff/assets/${edit.id}`, f); toast('Asset details saved', 'ok'); setEdit(null); reload(); }} />
      )}
      {detail && (
        <Modal title={`${detail.asset_no} — ${detail.name}`} onClose={() => setDetail(null)}>
          <div className="stack">
            <div className="muted">{[detail.category, detail.brand_model, detail.serial_no && `S/N ${detail.serial_no}`].filter(Boolean).join(' · ')}</div>
            <div>Cost {money(detail.cost)} · purchased {date(detail.purchase_date)}{detail.vendor_name && <> from {detail.vendor_name}</>}{detail.warranty_until && <> · warranty until {date(detail.warranty_until)}</>}{detail.voucher_no && <> · {can('accounting', 'view') ? <Link to={`/expenses/${detail.voucher_id}`} className="mono">{detail.voucher_no}</Link> : <span className="mono">{detail.voucher_no}</span>} ({detail.voucher_status})</>}</div>
            {detail.instructions && <div className="alert info"><b>Instructions:</b> {detail.instructions}</div>}
            <b>History</b>
            {detail.history.map((h) => <div key={h.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}><b style={{ textTransform: 'capitalize' }}>{h.action}</b> {h.employee_name && `· ${h.employee_name}`} <span className="muted">· {date(h.date)}</span>{h.note && <div className="muted">{h.note}</div>}</div>)}
          </div>
        </Modal>
      )}
    </div>
  );
}
