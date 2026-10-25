// Employee onboarding checklists: HR overview, templates and working calendar (HR → Onboarding), one checklist
// (HR, the manager, the employee and other assignees each see what the server allows), and My Space → My onboarding.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { BackLink, Card, Check, Empty, Field, Loading, Modal, PageHead, ProgressBar, Select, StatusBadge, Tabs, TextInput } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useLookups, useToast } from '../context.jsx';
import { date, dateTimeUtc, titleCase } from '../format.js';
import { t } from '../i18n.js';

const CAT_LABEL = { profile: 'Profile setup', documents: 'Documents', policies: 'Policies', accounts: 'Account setup', equipment: 'Equipment', training: 'Training', manager_review: 'Manager review', other: 'Other' };
const CRIT_LABEL = { manual: 'Mark as done', note: 'Note of what was done', document: 'Employee document', asset: 'Assigned asset', profile: 'Profile fields filled in', acknowledgement: 'Employee acknowledgement' };
const WHO_LABEL = { employee: 'Employee', manager: 'Manager', hr: 'HR', user: 'Specific person' };
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const statusLabel = (s) => t(`onboarding.status.${s}`, titleCase(s));
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ------------------------------------------------------------------ one checklist
function ItemAction({ item, action, evidence, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ note: '', reason: '', evidence_ref: '', ack: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const docs = (evidence?.documents || []).filter((d) => !item.criteria_ref || String(d.category || '').toLowerCase() === item.criteria_ref.toLowerCase());
  const assets = (evidence?.assets || []).filter((a) => !item.criteria_ref || String(a.category || '').toLowerCase() === item.criteria_ref.toLowerCase());
  const needsReason = action === 'waive' || action === 'reopen';
  const blocked = (needsReason && !f.reason.trim()) || (action === 'complete' && ((item.criteria === 'note' && !f.note.trim()) || (['document', 'asset'].includes(item.criteria) && !f.evidence_ref) || (item.criteria === 'acknowledgement' && !f.ack)));
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/hrm/onboarding/items/${item.id}/action`, { action, note: f.note || undefined, reason: f.reason || undefined, evidence_ref: f.evidence_ref || undefined });
      toast(action === 'complete' ? t('onboarding.toast_done', 'Item completed') : action === 'waive' ? t('onboarding.toast_waived', 'Item waived') : t('onboarding.toast_reopened', 'Item reopened'), 'ok');
      onDone();
    } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  const title = { complete: t('onboarding.complete', 'Complete item'), waive: t('onboarding.waive', 'Waive item'), reopen: t('onboarding.reopen', 'Reopen item') }[action];
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className={`btn ${action === 'waive' ? 'danger' : 'primary'}`} disabled={busy || blocked} onClick={submit}>{title}</button></>}>
      <div className="stack">
        <div><b>{item.title}</b>{item.description && <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{item.description}</div>}</div>
        {action === 'complete' && item.criteria === 'document' && (docs.length
          ? <Field label={`Document${item.criteria_ref ? ` (${item.criteria_ref})` : ''}`} required><Select value={f.evidence_ref} onChange={set('evidence_ref')} options={docs.map((d) => ({ value: String(d.id), label: `${d.name}${d.category ? ` · ${d.category}` : ''}` }))} placeholder="Choose an uploaded document…" /></Field>
          : <div className="alert warn">No matching document yet. Upload it under the employee’s Documents first{item.criteria_ref ? ` (category “${item.criteria_ref}”)` : ''}; the checklist links to it and never makes a copy.</div>)}
        {action === 'complete' && item.criteria === 'asset' && (assets.length
          ? <Field label="Asset" required><Select value={f.evidence_ref} onChange={set('evidence_ref')} options={assets.map((a) => ({ value: String(a.id), label: `${a.asset_no} · ${a.name}` }))} placeholder="Choose an assigned asset…" /></Field>
          : <div className="alert warn">No asset is assigned to this employee yet. Assign one from the Asset Library first.</div>)}
        {action === 'complete' && item.criteria === 'profile' && <div className="alert info">The server checks that these profile fields are filled in: {(item.criteria_ref || 'phone, address, emergency contact').replace(/_/g, ' ')}.</div>}
        {action === 'complete' && item.criteria === 'acknowledgement' && <Check checked={f.ack} onChange={set('ack')}>{t('onboarding.ack', 'I have read and understood this and agree to follow it.')}</Check>}
        {action === 'complete' && <Field label={item.criteria === 'note' ? 'What was done' : 'Note (optional)'} required={item.criteria === 'note'}><textarea className="input" rows={3} value={f.note} onChange={(e) => set('note')(e.target.value)} /></Field>}
        {item.category === 'accounts' && action === 'complete' && <div className="muted">Completing this item records what was set up. It does not change anyone’s role or permissions; do that under Settings → Users.</div>}
        {needsReason && <Field label={t('onboarding.reason', 'Reason')} required><textarea className="input" rows={3} value={f.reason} onChange={(e) => set('reason')(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

function evidenceText(i) {
  if (i.status === 'waived') return `Waived: ${i.waive_reason || ''}`;
  if (i.status !== 'completed') return i.reopen_reason ? `Reopened: ${i.reopen_reason}` : null;
  const what = i.evidence_type === 'document' ? `Document: ${i.evidence_document || '#' + i.evidence_ref}` : i.evidence_type === 'asset' ? `Asset: ${i.evidence_asset_no || ''} ${i.evidence_asset || ''}` : i.evidence_type === 'profile' ? 'Profile fields checked' : null;
  return [what, i.evidence_note].filter(Boolean).join(' · ');
}

export function Checklist({ data, reload }) {
  const toast = useToast();
  const [act, setAct] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const groups = useMemo(() => Object.keys(CAT_LABEL).map((c) => [c, data.items.filter((i) => i.category === c)]).filter(([, g]) => g.length), [data.items]);
  const start = async (i) => { try { await api.post(`/api/hrm/onboarding/items/${i.id}/action`, { action: 'start' }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const p = data.progress;
  return (
    <div className="stack">
      <Card>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div><b style={{ fontSize: 16 }}>{data.employee.name}</b><div className="muted">{[data.employee.emp_code, data.employee.designation, data.employee.department].filter(Boolean).join(' · ')}</div>
            <div className="cell-sub">{t('onboarding.joining', 'Joining date')}: {date(data.onboarding.joining_date)} · {data.onboarding.template_name}</div></div>
          <StatusBadge status={data.onboarding.status} label={statusLabel(data.onboarding.status)} />
        </div>
        <div style={{ marginTop: 12 }}><ProgressBar value={p.percent} tone={p.overdue ? 'amber' : ''} />
          <div className="cell-sub" style={{ marginTop: 4 }}>{p.required_done} / {p.required} {t('onboarding.required_done', 'required items done')} ({p.percent}%){p.overdue ? ` · ${p.overdue} ${t('onboarding.overdue', 'overdue')}` : ''}</div></div>
        {!data.employee.has_login && <div className="alert warn" style={{ marginTop: 10 }}>This employee has no ERP login linked yet, so their own items are unassigned until HR links one.</div>}
        {data.onboarding.status === 'cancelled' && <div className="alert err" style={{ marginTop: 10 }}>Cancelled: {data.onboarding.cancel_reason}</div>}
      </Card>
      {groups.map(([cat, items]) => (
        <Card key={cat} title={t(`onboarding.cat.${cat}`, CAT_LABEL[cat])} flush>
          {items.map((i) => (
            <div key={i.id} className="row wrap" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', gap: 10, alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{i.title} {!i.required && <span className="muted" style={{ fontWeight: 400 }}>({t('onboarding.optional', 'optional')})</span>}</div>
                <div className="cell-sub">{WHO_LABEL[i.assignee_type]}{i.assignee_name ? `: ${i.assignee_name}` : ' (unassigned)'} · {CRIT_LABEL[i.criteria]}{i.due_date ? ` · ${t('onboarding.due', 'due')} ${date(i.due_date)}` : ''}</div>
                {evidenceText(i) && <div className="cell-sub" style={{ marginTop: 2 }}>{evidenceText(i)}</div>}
                {i.completed_at && <div className="cell-sub">{t('onboarding.completed_by', 'Completed by')} {i.completed_by_name || '—'} · {dateTimeUtc(i.completed_at)}</div>}
                {i.waived_at && <div className="cell-sub">{t('onboarding.waived_by', 'Waived by')} {i.waived_by_name || '—'} · {dateTimeUtc(i.waived_at)}</div>}
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {i.overdue && <StatusBadge status="overdue" label={t('onboarding.overdue', 'overdue')} />}
                <StatusBadge status={i.status} label={statusLabel(i.status)} tone={i.status === 'waived' ? 'grey' : i.status === 'in_progress' ? 'blue' : undefined} />
                {i.can.work && i.status === 'pending' && i.criteria !== 'acknowledgement' && <button className="btn sm" onClick={() => start(i)}>{t('onboarding.start_item', 'Start')}</button>}
                {i.can.work && <button className="btn sm primary" onClick={() => setAct({ item: i, action: 'complete' })}>{i.criteria === 'acknowledgement' ? t('onboarding.acknowledge', 'Acknowledge') : t('onboarding.mark_done', 'Complete')}</button>}
                {i.can.waive && <button className="btn sm" onClick={() => setAct({ item: i, action: 'waive' })}>{t('onboarding.waive_short', 'Waive')}</button>}
                {i.can.reopen && <button className="btn sm" onClick={() => setAct({ item: i, action: 'reopen' })}>{t('onboarding.reopen_short', 'Reopen')}</button>}
              </div>
            </div>))}
        </Card>))}
      {!!data.events?.length && <Card title={t('onboarding.history', 'History')} actions={<button className="btn sm" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide' : `Show (${data.events.length})`}</button>}>
        {showLog && <table className="t"><tbody>{data.events.map((e) => <tr key={e.id}><td className="nowrap">{dateTimeUtc(e.created_at)}</td><td>{e.user_name}</td><td>{titleCase(e.action)}: {e.item_title}</td><td>{e.reason}</td></tr>)}</tbody></table>}
      </Card>}
      <div className="cell-sub">{t('onboarding.tz_note', 'Due dates are calendar days in the workspace timezone; times are shown in that timezone.')}</div>
      {act && <ItemAction {...act} evidence={data.evidence} onClose={() => setAct(null)} onDone={() => { setAct(null); reload(); }} />}
    </div>
  );
}

export function OnboardingDetail() {
  const { id } = useParams();
  const toast = useToast();
  const nav = useNavigate();
  const { can } = useAuth();
  const { data, error, reload } = useFetch(`/api/hrm/onboarding/${id}`, undefined, [id]);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const doCancel = async () => { try { await api.post(`/api/hrm/onboarding/${id}/cancel`, { reason }); toast('Onboarding cancelled', 'ok'); setCancel(false); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div>
      <BackLink to={can('hrm') ? '/hrm/onboarding' : '/my/onboarding'}>{t('onboarding.title', 'Onboarding')}</BackLink>
      <PageHead title={`${t('onboarding.title', 'Onboarding')}: ${data.employee.name}`}>
        {can('hrm') && <button className="btn" onClick={() => nav(`/hrm/employees/${data.employee.id}`)}><Icon name="user" size={14} />Employee profile</button>}
        {data.can.cancel && <button className="btn danger" onClick={() => setCancel(true)}>Cancel onboarding</button>}
      </PageHead>
      <Checklist data={data} reload={reload} />
      {cancel && <Modal title="Cancel onboarding" onClose={() => setCancel(false)} footer={<><button className="btn" onClick={() => setCancel(false)}>Keep it</button><button className="btn danger" disabled={!reason.trim()} onClick={doCancel}>Cancel onboarding</button></>}>
        <p className="muted">Open checklist tasks are removed from people’s task lists. The record and its history are kept.</p>
        <Field label="Reason" required><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>}
    </div>
  );
}

// ------------------------------------------------------------------ HR: list, start, templates, calendar
function StartModal({ onClose, onDone }) {
  const toast = useToast();
  const emps = useFetch('/api/hrm/employees', { limit: 500 });
  const tpls = useFetch('/api/hrm/onboarding/templates');
  const [f, setF] = useState({ employee_id: '', template_id: '', joining_date: '' });
  const [key] = useState(newKey); // one key per opened form: a double click or a retried request starts one onboarding
  const [busy, setBusy] = useState(false);
  const rows = (emps.data?.rows || []).filter((e) => e.status !== 'inactive');
  const pickEmp = (v) => { const e = rows.find((x) => String(x.id) === String(v)); setF((x) => ({ ...x, employee_id: v, joining_date: x.joining_date || e?.hire_date || '' })); };
  const submit = async () => {
    setBusy(true);
    try { const r = await api.post('/api/hrm/onboarding', { ...f, idempotency_key: key }); toast('Onboarding started', 'ok'); onDone(r.id); } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('onboarding.start', 'Start onboarding')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="btn primary" disabled={busy || !f.employee_id || !f.template_id || !f.joining_date} onClick={submit}>{t('onboarding.start', 'Start onboarding')}</button></>}>
      <div className="stack">
        <Field label="Employee" required><Select value={f.employee_id} onChange={pickEmp} options={rows.map((e) => ({ value: String(e.id), label: `${e.name} (${e.emp_code})` }))} placeholder="Select an employee…" /></Field>
        <Field label="Template" required><Select value={f.template_id} onChange={(v) => setF((x) => ({ ...x, template_id: v }))} options={(tpls.data || []).filter((x) => x.active).map((x) => ({ value: String(x.id), label: `${x.name} (${x.items} items)` }))} /></Field>
        <Field label={t('onboarding.joining', 'Joining date')} required hint="Due dates count working days from this date using the working calendar."><input className="input" type="date" value={f.joining_date} onChange={(e) => setF((x) => ({ ...x, joining_date: e.target.value }))} /></Field>
        <div className="muted">The template’s items are copied into this onboarding, so later template edits do not change it. Nobody’s permissions change.</div>
      </div>
    </Modal>
  );
}

const blankItem = () => ({ title: '', category: 'other', required: true, assignee_type: 'hr', assignee_user_id: '', due_offset_days: 0, criteria: 'manual', criteria_ref: '' });
function TemplateEditor({ id, onClose, onSaved }) {
  const toast = useToast();
  const { users } = useLookups();
  const existing = useFetch(id ? `/api/hrm/onboarding/templates/${id}` : null);
  const [f, setF] = useState(id ? null : { name: '', description: '', active: true, items: [blankItem()] });
  if (id && !f && existing.data) setF({ ...existing.data, active: !!existing.data.active, items: existing.data.items.map((i) => ({ ...i, required: !!i.required, assignee_user_id: i.assignee_user_id || '', criteria_ref: i.criteria_ref || '' })) });
  if (!f) return <Modal title="Template" onClose={onClose}><Loading /></Modal>;
  const setItem = (n, k, v) => setF((x) => ({ ...x, items: x.items.map((it, i) => (i === n ? { ...it, [k]: v } : it)) }));
  const move = (n, d) => setF((x) => { const items = [...x.items]; const [it] = items.splice(n, 1); items.splice(Math.max(0, Math.min(items.length, n + d)), 0, it); return { ...x, items }; });
  const save = async () => {
    try {
      const body = { ...f, items: f.items.map((i) => ({ ...i, due_offset_days: Number(i.due_offset_days) || 0, assignee_user_id: i.assignee_user_id || null })) };
      if (id) await api.put(`/api/hrm/onboarding/templates/${id}`, body); else await api.post('/api/hrm/onboarding/templates', body);
      toast('Template saved', 'ok'); onSaved();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal size="lg" title={id ? 'Edit template' : 'New template'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button className="btn primary" onClick={save}>{t('common.save', 'Save')}</button></>}>
      <div className="stack">
        <div className="grid g2"><Field label="Template name" required><TextInput value={f.name} onChange={(v) => setF((x) => ({ ...x, name: v }))} /></Field>
          <Field label="Status"><Check checked={f.active} onChange={(v) => setF((x) => ({ ...x, active: v }))}>Active (can be used for new onboarding)</Check></Field></div>
        <Field label="Description"><TextInput value={f.description || ''} onChange={(v) => setF((x) => ({ ...x, description: v }))} /></Field>
        <div className="muted">Due offsets are working days from the joining date (negative = before day one). Document requirements are yours to set: name the document category your policy needs.</div>
        {f.items.map((it, n) => (
          <div key={n} className="card" style={{ padding: 10 }}>
            <div className="grid g2">
              <Field label={`Item ${n + 1}`} required><TextInput value={it.title} onChange={(v) => setItem(n, 'title', v)} /></Field>
              <Field label="Section"><Select allowEmpty={false} value={it.category} onChange={(v) => setItem(n, 'category', v)} options={Object.entries(CAT_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Responsible"><Select allowEmpty={false} value={it.assignee_type} onChange={(v) => setItem(n, 'assignee_type', v)} options={Object.entries(WHO_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
              {['hr', 'user'].includes(it.assignee_type) && <Field label={it.assignee_type === 'hr' ? 'HR person (blank = whoever starts it)' : 'Person'}><Select value={String(it.assignee_user_id || '')} onChange={(v) => setItem(n, 'assignee_user_id', v)} options={users.map((u) => ({ value: String(u.id), label: `${u.name} — ${u.role}` }))} /></Field>}
              <Field label="Done when"><Select allowEmpty={false} value={it.criteria} onChange={(v) => setItem(n, 'criteria', v)} options={Object.entries(CRIT_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
              {['document', 'asset', 'profile'].includes(it.criteria) && <Field label={it.criteria === 'profile' ? 'Profile fields (comma separated)' : 'Category (optional)'} hint={it.criteria === 'profile' ? 'phone, email, address, emergency_contact, dob, photo' : undefined}><TextInput value={it.criteria_ref} onChange={(v) => setItem(n, 'criteria_ref', v)} /></Field>}
              <Field label="Due (working days from joining)"><input className="input" type="number" value={it.due_offset_days} onChange={(e) => setItem(n, 'due_offset_days', e.target.value)} /></Field>
              <Field label="Required"><Check checked={it.required} onChange={(v) => setItem(n, 'required', v)}>Counts towards completion</Check></Field>
            </div>
            <Field label="Instructions"><TextInput value={it.description || ''} onChange={(v) => setItem(n, 'description', v)} /></Field>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" disabled={n === 0} onClick={() => move(n, -1)} aria-label="Move up">↑</button>
              <button className="btn sm" disabled={n === f.items.length - 1} onClick={() => move(n, 1)} aria-label="Move down">↓</button>
              <button className="btn sm danger" onClick={() => setF((x) => ({ ...x, items: x.items.filter((_, i) => i !== n) }))}>Remove</button>
            </div>
          </div>))}
        <button className="btn" onClick={() => setF((x) => ({ ...x, items: [...x.items, blankItem()] }))}><Icon name="plus" size={14} />Add item</button>
      </div>
    </Modal>
  );
}

function Templates() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch('/api/hrm/onboarding/templates');
  const [edit, setEdit] = useState(null);
  const remove = async (x) => { if (!window.confirm(x.used ? 'This template has been used, so it will be switched off (running onboardings keep their copy).' : `Delete “${x.name}”?`)) return; try { await api.del(`/api/hrm/onboarding/templates/${x.id}`); reload(); } catch (e) { toast(e.message, 'err'); } };
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      {can('hrm', 'edit') && <div><button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" size={14} />New template</button></div>}
      {data.length ? <table className="t"><thead><tr><th>Template</th><th className="num">Items</th><th className="num">Used</th><th>Status</th><th /></tr></thead>
        <tbody>{data.map((x) => <tr key={x.id}><td><b>{x.name}</b><div className="cell-sub">{x.description}</div></td><td className="num">{x.items}</td><td className="num">{x.used}</td><td><StatusBadge status={x.active ? 'active' : 'inactive'} /></td>
          <td className="nowrap">{can('hrm', 'edit') && <><button className="btn sm" onClick={() => setEdit(x.id)}>Edit</button> <button className="btn sm danger" onClick={() => remove(x)}>Remove</button></>}</td></tr>)}</tbody></table> : <Empty>No templates yet.</Empty>}
      {edit && <TemplateEditor id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function WorkCalendar() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch('/api/hrm/onboarding/calendar');
  const [f, setF] = useState(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const v = f || data;
  const toggle = (d) => setF({ ...v, weekend: v.weekend.includes(d) ? v.weekend.filter((x) => x !== d) : [...v.weekend, d] });
  const save = async () => { try { await api.put('/api/hrm/onboarding/calendar', { weekend: v.weekend, work_start: v.work_start, work_end: v.work_end }); toast('Working calendar saved', 'ok'); setF(null); reload(); } catch (e) { toast(e.message, 'err'); } };
  const edit = can('hrm', 'approve');
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <div className="muted">Onboarding due dates skip weekend days and the holidays listed under HR → Holidays. Reminders go out on working days once the working day has started. Timezone: <b>{data.timezone}</b> (set by the workspace).</div>
      <Field label="Weekend days" hint={data.source === 'region' ? 'Currently the region default. Saving makes it this workspace’s own setting.' : undefined}>
        <div className="row wrap" style={{ gap: 10 }}>{DAYS.map(([d, l]) => <Check key={d} checked={v.weekend.includes(d)} onChange={() => edit && toggle(d)}>{l}</Check>)}</div></Field>
      <div className="grid g2"><Field label="Working day starts"><input className="input" type="time" disabled={!edit} value={v.work_start} onChange={(e) => setF({ ...v, work_start: e.target.value })} /></Field>
        <Field label="Working day ends"><input className="input" type="time" disabled={!edit} value={v.work_end} onChange={(e) => setF({ ...v, work_end: e.target.value })} /></Field></div>
      {edit && <div><button className="btn primary" disabled={!f} onClick={save}>{t('common.save', 'Save')}</button></div>}
    </div>
  );
}

export function OnboardingHome() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [tab, setTab] = useState('list');
  const [filter, setFilter] = useState('open');
  const [starting, setStarting] = useState(false);
  const { data, error, reload } = useFetch('/api/hrm/onboarding', { filter }, [filter]);
  const rows = data?.rows || [];
  return (
    <div>
      <PageHead title={t('onboarding.title', 'Onboarding')} sub={t('onboarding.sub', 'Checklists for new employees: documents, policies, accounts, equipment, training and manager review')}>
        {can('hrm', 'edit') && <button className="btn primary" onClick={() => setStarting(true)}><Icon name="plus" size={14} />{t('onboarding.start', 'Start onboarding')}</button>}
      </PageHead>
      <Card flush><Tabs value={tab} onChange={setTab} tabs={[{ key: 'list', label: t('onboarding.title', 'Onboarding') }, { key: 'templates', label: t('onboarding.templates', 'Templates') }, { key: 'calendar', label: t('onboarding.calendar', 'Working calendar') }]} />
        <div className="card-b">
          {tab === 'list' && <div className="stack">
            <div style={{ width: 200 }}><Select allowEmpty={false} value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'all', label: 'All' }]} /></div>
            {error ? <div className="alert err">{error}</div> : !data ? <Loading /> : !rows.length ? <Empty>{filter === 'open' ? 'No onboarding in progress.' : 'Nothing here.'}</Empty> : (
              <table className="t"><thead><tr><th>Employee</th><th>{t('onboarding.joining', 'Joining date')}</th><th>Progress</th><th>Next due</th><th>Status</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/hrm/onboarding/${r.id}`)}>
                  <td><Link to={`/hrm/onboarding/${r.id}`} className="cell-main">{r.employee_name}</Link><div className="cell-sub">{[r.emp_code, r.department, r.template_name].filter(Boolean).join(' · ')}</div></td>
                  <td>{date(r.joining_date)}</td>
                  <td style={{ minWidth: 140 }}><ProgressBar value={r.percent} tone={r.overdue ? 'amber' : ''} /><div className="cell-sub">{r.req_done}/{r.req_total}{r.overdue ? ` · ${r.overdue} overdue` : ''}</div></td>
                  <td>{r.next_due ? date(r.next_due) : '—'}</td>
                  <td><StatusBadge status={r.status} label={statusLabel(r.status)} /></td></tr>)}</tbody></table>)}
          </div>}
          {tab === 'templates' && <Templates />}
          {tab === 'calendar' && <WorkCalendar />}
        </div></Card>
      {starting && <StartModal onClose={() => setStarting(false)} onDone={(id) => { setStarting(false); reload(); nav(`/hrm/onboarding/${id}`); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ My Space
export function MyOnboarding() {
  const { data, error, reload } = useFetch('/api/hrm/onboarding/me');
  const team = useFetch('/api/hrm/onboarding', { scope: 'team', filter: 'open' });
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const teamRows = team.data?.rows || [];
  return (
    <div className="stack">
      <PageHead title={t('onboarding.my', 'My onboarding')} />
      {data.own ? <Checklist data={data.own} reload={reload} /> : <Card><Empty>{t('onboarding.none', 'You have no onboarding checklist.')}</Empty></Card>}
      {!!data.assigned.length && <Card title={t('onboarding.assigned', 'Onboarding items assigned to me')} flush>
        {data.assigned.map((i) => <Link key={i.id} to={`/hrm/onboarding/${i.onboarding_id}`} className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', gap: 10 }}>
          <div className="grow"><b>{i.title}</b><div className="cell-sub">{i.employee_name}{i.due_date ? ` · ${t('onboarding.due', 'due')} ${date(i.due_date)}` : ''}</div></div>
          {i.overdue && <StatusBadge status="overdue" label={t('onboarding.overdue', 'overdue')} />}<StatusBadge status={i.status} label={statusLabel(i.status)} /></Link>)}
      </Card>}
      {!!teamRows.length && <Card title={t('onboarding.team', 'My team’s onboarding')} flush>
        {teamRows.map((r) => <Link key={r.id} to={`/hrm/onboarding/${r.id}`} className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', gap: 10 }}>
          <div className="grow"><b>{r.employee_name}</b><div className="cell-sub">{date(r.joining_date)} · {r.req_done}/{r.req_total}{r.overdue ? ` · ${r.overdue} overdue` : ''}</div></div>
          <StatusBadge status={r.status} label={statusLabel(r.status)} /></Link>)}
      </Card>}
    </div>
  );
}
