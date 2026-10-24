import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Timeline from '../components/Timeline.jsx';
import { DocumentsPanel } from '../components/Uploaders.jsx';
import { Avatar, BackLink, Card, ConfirmDialog, Empty, Field, KV, LedgerSummary, Loading, Menu, Modal, ProgressBar, Select, StagePill, StatusBadge, TagInput, Tabs } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useLookups, useToast, useUndoDelete } from '../context.jsx';
import { ago, date, dateTime, money, todayPK } from '../format.js';
import ContactForm from './ContactForm.jsx';
import RegionFields from '../components/RegionFields.jsx';
import PrivacyTools from '../components/PrivacyTools.jsx';
import MortgageCard from '../components/MortgageCard.jsx';
import { getRegion } from '../format.js';
import { leadMessage, useCompanyName, waLink } from '../components/WhatsApp.jsx';

const TOOLS = [
  ['activity', 'history', 'Activity'], ['notes', 'note', 'Notes'], ['tasks', 'task', 'Tasks'], ['documents', 'file', 'Documents'], ['payments', 'dollar', 'Payments'],
  ['properties', 'building', 'Properties'], ['communication', 'chat', 'Communication'], ['appointments', 'calendar', 'Appointments'], ['timeline', 'clock', 'Timeline'],
];

function Accordion({ title, children, open: o = false }) {
  const [open, setOpen] = useState(o);
  return (
    <div className="acc">
      <div className="acc-h" onClick={() => setOpen(!open)} role="button" aria-expanded={open}><span>{title}</span><Icon name="chevD" size={14} style={{ transform: open ? 'rotate(180deg)' : 'none' }} /></div>
      {open && <div className="acc-b">{children}</div>}
    </div>
  );
}

function Composer({ contact, onDone }) {
  const toast = useToast();
  const [mode, setMode] = useState('note');
  const [text, setText] = useState('');
  const [due, setDue] = useState(todayPK());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (mode === 'task') await api.post('/api/tasks', { entity_type: 'contact', entity_id: contact.id, title: text, due_date: due, assigned_to: contact.agent_id || undefined });
      else await api.post('/api/notes', { entity_type: 'contact', entity_id: contact.id, body: mode === 'note' ? text : `[${mode}] ${text}` });
      setText(''); onDone(); toast(mode === 'task' ? 'Task created' : 'Saved', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="composer">
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        {[['note', 'Note'], ['task', 'Follow-up task'], ['call', 'Call log'], ['meeting', 'Meeting']].map(([k, l]) => <button key={k} className={`btn sm ${mode === k ? 'primary' : 'ghost'}`} onClick={() => setMode(k)}>{l}</button>)}
      </div>
      <textarea className="textarea" style={{ border: 0, borderRadius: 0, boxShadow: 'none' }} placeholder={mode === 'task' ? 'What needs to be done?' : mode === 'note' ? 'Write a note…' : `Summarise the ${mode}…`} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row between" style={{ padding: '6px 10px', borderTop: '1px solid var(--border)' }}>
        {mode === 'task' ? <div className="row"><span className="muted">Due</span><input type="date" className="input" style={{ width: 150, height: 28 }} value={due} onChange={(e) => setDue(e.target.value)} /></div> : <span className="faint">Visible to your team only</span>}
        <button className="btn primary sm" disabled={busy || !text.trim()} onClick={submit}>{mode === 'task' ? 'Create task' : 'Save'}</button>
      </div>
    </div>
  );
}

function TasksPanel({ tasks, contact, onChange }) {
  const toast = useToast();
  const t0 = todayPK();
  return (
    <div className="stack">
      {!tasks.length ? <Empty>No tasks. Add a follow-up from the composer.</Empty> : (
        <table className="t"><tbody>
          {tasks.map((t) => (
            <tr key={t.id} style={{ opacity: t.status === 'done' ? 0.55 : 1 }}>
              <td style={{ width: 30 }}><input type="checkbox" checked={t.status === 'done'} aria-label="Complete" onChange={async (e) => { try { await api.put(`/api/tasks/${t.id}`, { status: e.target.checked ? 'done' : 'open' }); onChange(); } catch (er) { toast(er.message, 'err'); } }} /></td>
              <td style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}<div className="cell-sub">{t.assignee || 'Unassigned'}</div></td>
              <td className={t.status === 'open' && t.due_date && t.due_date < t0 ? 'neg' : ''}>{date(t.due_date)}</td>
              <td className="right"><button className="btn sm ghost danger" onClick={async () => { await api.del(`/api/tasks/${t.id}`); onChange(); }}>Delete</button></td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}

function PaymentsPanel({ ws }) {
  const { can } = useAuth();
  const c = ws.contact;
  if (!ws.sales.length && !ws.receipts?.length) return <Empty>No purchases yet. <Link to={`/sales/new?contact=${c.id}`}>Create a sale</Link> to start a payment plan.</Empty>;
  return (
    <div className="stack">
      <LedgerSummary items={[{ label: 'Total purchase value', value: ws.totals.purchase_value }, { label: 'Paid', value: ws.totals.paid, tone: 'pos' }, { label: 'Outstanding', value: ws.totals.outstanding, tone: ws.totals.outstanding ? 'warn' : '' }, { label: 'Overdue', value: ws.totals.overdue, tone: ws.totals.overdue ? 'neg' : '' }]} />
      {can('payments', 'create') && ws.sales.some((s) => s.status === 'confirmed' && s.outstanding > 0) && <div><Link className="btn primary sm" to={`/receipts/new?contact=${c.id}`}><Icon name="plus" size={13} />Record payment</Link></div>}
      {ws.sales.filter((s) => s.status === 'confirmed').map((s) => (
        <Card key={s.id} title={<span>{s.property_title} <span className="muted">· {s.sale_no}</span></span>} actions={<Link className="btn sm" to={`/sales/${s.id}`}>Open ledger</Link>}>
          <div className="row between wrap"><span className="muted">Next due:</span>{s.next_due ? <b>{date(s.next_due.due_date)} · {money(s.next_due.amount)}</b> : <span className="pos">Fully paid</span>}<span>{s.installments_paid}/{s.num_installments} installments paid</span></div>
          <div style={{ margin: '8px 0' }}><ProgressBar value={Math.round((s.paid_amount / s.net_price) * 100)} tone="green" /></div>
        </Card>
      ))}
      {ws.receipts && (
        <Card title="Receipt vouchers" flush>
          <table className="t"><thead><tr><th>Receipt</th><th>Date</th><th>Sale</th><th>Type</th><th>Method</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>{ws.receipts.map((r) => (
              <tr key={r.id}><td><Link to={`/receipts/${r.id}`}>{r.receipt_no}</Link></td><td>{date(r.date)}</td><td>{r.sale_no || '—'}</td><td>{r.payment_type}</td><td>{r.method}</td>
                <td className="num mono">{r.payment_type === 'Refund' ? '-' : ''}{money(r.amount)}</td><td><StatusBadge status={r.status} /></td></tr>))}</tbody></table>
        </Card>
      )}
    </div>
  );
}

function PropertiesPanel({ ws, reload }) {
  const { can } = useAuth();
  const toast = useToast();
  const c = ws.contact;
  const [reserving, setReserving] = useState(false);
  const [pid, setPid] = useState('');
  const avail = useFetch(reserving ? '/api/properties' : null, { limit: 200, status: 'available' });
  return (
    <div className="stack">
      <div className="row wrap">
        {can('crm', 'edit') && !c.is_customer && <button className="btn sm" onClick={() => setReserving(true)}>Reserve a property</button>}
        {can('sales', 'create') && <Link className="btn primary sm" to={`/sales/new?contact=${c.id}${c.property_id ? `&property=${c.property_id}` : ''}`}>Create sale</Link>}
      </div>
      {ws.interests[0] && (
        <Card title="Interested property"><div className="row between"><div><Link to={`/properties/${ws.interests[0].id}`} className="bold">{ws.interests[0].title}</Link><div className="muted">{money(ws.interests[0].net_price)}</div></div><StatusBadge status={ws.interests[0].status} /></div></Card>
      )}
      {ws.sales.length ? ws.sales.map((s) => (
        <Card key={s.id} title={s.kind === 'construction' ? 'Construction contract' : 'Purchased property'} actions={<span className="row">{s.bundle_id && <span className="tag">combined plan</span>}<StatusBadge status={s.status} /></span>}>
          <div className="grid g2">
            <KV items={[['Property', <Link to={`/properties/${s.property_id}`}>{s.property_title}</Link>], ['Project', s.project_name], ['Plot / Block', `${s.plot_no || '—'} / ${s.block || '—'}`], ['Sale date', date(s.sale_date)], ['Sales agent', s.agent_name]]} />
            <KV items={[['Sale price', money(s.sale_price)], ['Discount', money(s.discount)], ['Net value', money(s.net_price)], ['Paid', money(s.paid_amount)], ['Balance', money(s.outstanding)]]} />
          </div>
        </Card>
      )) : <Empty>No purchased properties.</Empty>}
      {reserving && (
        <Modal title="Reserve property" size="sm" onClose={() => setReserving(false)} footer={<><button className="btn" onClick={() => setReserving(false)}>Cancel</button><button className="btn primary" disabled={!pid} onClick={async () => { try { await api.post(`/api/contacts/${c.id}/reserve-property`, { property_id: Number(pid) }); toast('Property reserved', 'ok'); setReserving(false); reload(); } catch (e) { toast(e.message, 'err'); } }}>Reserve</button></>}>
          <Field label="Available property"><Select value={pid} onChange={setPid} options={(avail.data?.rows || []).map((p) => ({ value: p.id, label: `${p.title} — ${money(p.net_price)}` }))} /></Field>
        </Modal>
      )}
    </div>
  );
}

function CommunicationPanel({ c, reload }) {
  const co = useCompanyName();
  const toast = useToast();
  const log = async (kind, body) => { try { await api.post('/api/notes', { entity_type: 'contact', entity_id: c.id, body: `[${kind}] ${body}` }); toast(`${kind} logged`, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const wa = (c.whatsapp || c.phone || '').replace(/[^\d]/g, '');
  return (
    <div className="stack">
      <div className="alert info">Calls, SMS, e-mail and WhatsApp open in your own apps. Use the quick-log buttons to record that the touchpoint happened — it appears in the timeline. Automated SMS/e-mail/WhatsApp sending is an optional integration layer (Settings → Notifications).</div>
      <div className="grid g2">
        <Card title="Phone"><div className="row wrap">{c.phone ? <><a className="btn sm" href={`tel:${c.phone}`}><Icon name="phone" size={13} />Call {c.phone}</a><button className="btn sm" onClick={() => log('Call', `Called ${c.phone}`)}>Log call</button></> : <span className="muted">No phone number.</span>}</div></Card>
        <Card title="WhatsApp / SMS"><div className="row wrap">{wa ? <><a className="btn sm" target="_blank" rel="noreferrer" href={waLink(c.whatsapp || c.phone, leadMessage(c, co))}><Icon name="chat" size={13} />WhatsApp</a><a className="btn sm" href={`sms:${c.phone}`}>SMS</a><button className="btn sm" onClick={() => log('WhatsApp', 'Message sent via WhatsApp')}>Log message</button></> : <span className="muted">No number.</span>}</div></Card>
        <Card title="E-mail"><div className="row wrap">{c.email ? <><a className="btn sm" href={`mailto:${c.email}`}><Icon name="mail" size={13} />Write to {c.email}</a><button className="btn sm" onClick={() => log('Email', `Email sent to ${c.email}`)}>Log e-mail</button></> : <span className="muted">No e-mail address.</span>}</div></Card>
        <Card title="Meeting"><button className="btn sm" onClick={() => log('Meeting', 'Met the client')}>Log meeting</button></Card>
      </div>
    </div>
  );
}

/** Where website enquiries came from (page, campaign) and what the visitor agreed to, as the website sent it. */
function WebsiteSource({ items }) {
  if (!items?.length) return null;
  return (
    <div className="card" style={{ padding: 12 }}>
      <strong>Website enquiries</strong>
      {items.slice(0, 5).map((a) => {
        const utm = Object.values(a.utm || {}).filter(Boolean).join(' / ');
        return (
          <div key={a.id} className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {a.created_at} · {a.form || 'Website form'}{a.test ? ' (test)' : ''}{a.page_url ? ` · ${a.page_url}` : ''}{utm ? ` · ${utm}` : ''}
            {a.consent ? ` · Privacy ${a.consent.privacy === true ? 'accepted' : a.consent.privacy === false ? 'declined' : 'not stated'}${a.consent.marketing === true ? ', marketing accepted' : ''}` : ' · No consent recorded'}
          </div>
        );
      })}
    </div>
  );
}

export default function ContactWorkspace() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can, user } = useAuth();
  const { stages, agents } = useLookups();
  const co = useCompanyName();
  const { data: ws, loading, error, reload } = useFetch(`/api/contacts/${id}/workspace`);
  const [tab, setTab] = useState('activity');
  const [editing, setEditing] = useState(false);
  const undo = useUndoDelete('contacts');
  const [deleting, setDeleting] = useState(false);
  const [tagEdit, setTagEdit] = useState(null);
  const [portal, setPortal] = useState(null);
  if (error) return <div><BackLink to="/contacts">Contacts</BackLink><div className="alert err">{error}</div></div>;
  if (!ws) return <Loading />;
  const c = ws.contact;
  const patch = async (body) => { try { await api.put(`/api/contacts/${c.id}`, body); reload(); } catch (e) { toast(e.message, 'err'); } };
  const comms = ws.activities.filter((a) => !/^(Lead stage|Sales agent|Contact assigned)/.test(a.action));
  const tabs = [
    { key: 'activity', label: 'Activity' }, { key: 'notes', label: 'Notes', count: ws.notes.length }, { key: 'tasks', label: 'Tasks', count: ws.tasks.filter((t) => t.status === 'open').length },
    { key: 'documents', label: 'Documents', count: ws.documents.length }, { key: 'payments', label: 'Payments' }, { key: 'properties', label: 'Properties', count: ws.sales.length },
    { key: 'projects', label: 'Projects', count: ws.projects.length }, { key: 'communication', label: 'Communication' }, { key: 'appointments', label: 'Appointments', count: ws.appointments.length }, { key: 'timeline', label: 'Timeline' },
  ];

  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <BackLink to={c.is_customer ? '/customers' : '/contacts'}>{c.is_customer ? 'Customers' : 'Contacts'}</BackLink>
        <div className="row">
          {can('payments', 'create') && ws.sales.some((s) => s.outstanding > 0 && s.status === 'confirmed') && <Link to={`/receipts/new?contact=${c.id}`} className="btn sm">Record payment</Link>}
          {can('sales', 'create') && <Link to={`/sales/new?contact=${c.id}`} className="btn sm">Create sale</Link>}
          {can('sales', 'create') && c.is_customer && <Link to={`/sales/new?type=construction&contact=${c.id}`} className="btn sm">Construction contract</Link>}
          <Menu trigger={<button className="btn sm"><Icon name="more" size={15} /></button>}>
            {can('crm', 'edit') && <button onClick={() => setEditing(true)}>Edit contact</button>}
            {can('customers', 'edit') && c.is_customer && <button onClick={async () => { try { const r = await api.post(`/api/customers/${c.id}/portal-access`, {}); setPortal(r); } catch (e) { setPortal({ error: e.message }); } }}>Customer portal access…</button>}
            {can('customers', 'view') && c.is_customer && !user.own_scope && <Link to={`/customers/${c.id}/statement`}>Account statement</Link>}
            {can('crm', 'delete') && <button className="danger" onClick={() => setDeleting(true)}>Delete contact</button>}
          </Menu>
        </div>
      </div>

      <div className="ws">
        {/* ---------------- Left: profile ---------------- */}
        <aside className="ws-left stack">
          <Card>
            <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
              <Avatar name={c.full_name} size="lg" />
              <div className="grow">
                <h2 style={{ fontSize: 17 }}>{c.full_name}</h2>
                <div className="muted">{[c.company, c.city].filter(Boolean).join(' · ') || ' '}</div>
                <div className="row wrap" style={{ marginTop: 6 }}>{c.is_customer ? <span className="pill green">Customer</span> : <span className="pill grey">Lead</span>}{c.customer_code && <span className="tag mono" title="Customer ID">{c.customer_code}</span>}{c.is_demo ? <span className="demo-chip">DEMO</span> : null}</div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              {c.phone && <a className="icon-btn" href={`tel:${c.phone}`} title="Call" aria-label="Call"><Icon name="phone" size={15} /></a>}
              {c.email && <a className="icon-btn" href={`mailto:${c.email}`} title="Email" aria-label="Email"><Icon name="mail" size={15} /></a>}
              {(c.whatsapp || c.phone) && <a className="icon-btn" target="_blank" rel="noreferrer" href={waLink(c.whatsapp || c.phone, leadMessage(c, co))} title="WhatsApp" aria-label="WhatsApp"><Icon name="chat" size={15} /></a>}
            </div>
            <div className="stack" style={{ marginTop: 14, gap: 10 }}>
              <Field label="Lead stage"><Select allowEmpty={false} value={c.stage_id} onChange={(v) => patch({ stage_id: Number(v) })} options={stages.map((s) => ({ value: s.id, label: s.value }))} disabled={!can('crm', 'edit')} /></Field>
              {!user.own_scope && <Field label="Owner (sales agent)"><Select value={c.agent_id} onChange={(v) => patch({ agent_id: v ? Number(v) : null })} options={agents.map((a) => ({ value: a.id, label: a.name }))} placeholder="Unassigned" disabled={!can('crm', 'edit')} /></Field>}
              <Field label="Next follow-up"><input type="date" className="input" value={c.followup_date || ''} disabled={!can('crm', 'edit')} onChange={(e) => patch({ followup_date: e.target.value })} /></Field>
              <Field label="Tags">
                {tagEdit ? (<div className="stack" style={{ gap: 6 }}><TagInput value={tagEdit} onChange={setTagEdit} /><div className="row"><button className="btn sm primary" onClick={async () => { await patch({ tags: tagEdit }); setTagEdit(null); }}>Save</button><button className="btn sm" onClick={() => setTagEdit(null)}>Cancel</button></div></div>)
                  : (<div className="row wrap">{c.tags.map((x) => <span className="tag" key={x}>{x}</span>)}{can('crm', 'edit') && <button className="btn sm ghost" onClick={() => setTagEdit(c.tags)}>{c.tags.length ? 'Edit' : '+ Add tag'}</button>}</div>)}
              </Field>
            </div>
          </Card>
          <RegionFields entity="contact" id={c.id} />
          <MortgageCard contactId={c.id} />
          <PrivacyTools contactId={c.id} />
          <Accordion title="Contact" open>
            <KV items={[['Phone', c.phone], ['Alt phone', c.alt_phone], ['WhatsApp', c.whatsapp], ['Email', c.email], ...(getRegion().config.region === 'PK' ? [['CNIC', c.cnic]] : []), ['Father/husband', c.father_name], ['DOB', c.dob && date(c.dob)], ['Gender', c.gender]]} />
          </Accordion>
          <Accordion title="General info">
            <KV items={[['Source', c.lead_source], ['Type', c.lead_type], ['Priority', c.priority], ['Sales agent', c.agent_name], ['Sales manager', c.manager_name], ['Created', dateTime(c.created_at)], ['Last activity', ago(c.last_activity_at)]]} />
            <KV items={[['Country', c.country], ['Province', c.province], ['City', c.city], ['Area', c.area], ['Address', c.address]]} />
          </Accordion>
          <Accordion title="Property & booking">
            <KV items={[['Project', c.project_name], ['Property', c.property_id ? <Link to={`/properties/${c.property_id}`}>{c.property_title}</Link> : null], ['Budget', c.budget ? money(c.budget) : null], ['Preferred location', c.pref_location], ['Property type', c.property_type]]} />
          </Accordion>
          {Object.keys(c.custom || {}).length > 0 && <Accordion title="Additional info"><KV items={Object.entries(c.custom).map(([k, v]) => [k.replace(/_/g, ' '), String(v)])} /></Accordion>}
          {can('crm', 'edit') && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Edit all fields</button>}
        </aside>

        {/* ---------------- Center ---------------- */}
        <section className="stack" style={{ minWidth: 0 }}>
          {ws.totals?.outstanding > 0 && ws.totals.overdue > 0 && <div className="alert err">This customer has <b>{money(ws.totals.overdue)}</b> overdue.</div>}
          <Card flush>
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            <div className="card-b">
              {tab === 'activity' && (<div className="stack">{can('crm', 'edit') && <Composer contact={c} onDone={reload} />}<WebsiteSource items={ws.attribution} /><Timeline items={ws.activities.slice(0, 40)} /></div>)}
              {tab === 'notes' && (<div className="stack">{can('crm', 'edit') && <Composer contact={c} onDone={reload} />}
                {ws.notes.length ? ws.notes.map((n) => <div key={n.id} className="card" style={{ padding: 12 }}><div className="row between"><span className="muted">{n.user_name || 'Website'} · {dateTime(n.created_at)}</span>
                  {can('crm', 'edit') && <button className="btn sm ghost danger" onClick={async () => { await api.del(`/api/notes/${n.id}`); reload(); }}>Delete</button>}</div><div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{n.body}</div></div>) : <Empty>No notes yet.</Empty>}</div>)}
              {tab === 'tasks' && <TasksPanel tasks={ws.tasks} contact={c} onChange={reload} />}
              {tab === 'documents' && <DocumentsPanel entityType="contact" entityId={c.id} canEdit={can('crm', 'edit')} portalToggle={c.is_customer && can('customers', 'edit')} />}
              {tab === 'payments' && <PaymentsPanel ws={ws} />}
              {tab === 'properties' && <PropertiesPanel ws={ws} reload={reload} />}
              {tab === 'projects' && (ws.projects.length ? <div className="stack">{ws.projects.map((p) => {
                const dev = ws.development.find((d) => d.project_id === p.id);
                return <Card key={p.id} title={<Link to={`/projects/${p.id}`}>{p.name}</Link>} actions={<StatusBadge status={p.dev_status || 'planning'} tone="blue" label={p.dev_status} />}><div className="row"><span className="muted">Development progress</span><div className="grow"><ProgressBar value={dev?.progress || 0} /></div><b>{dev?.progress || 0}%</b></div></Card>; })}</div> : <Empty>Not linked to any project yet. Projects appear once a property is purchased.</Empty>)}
              {tab === 'communication' && <CommunicationPanel c={c} reload={reload} />}
              {tab === 'appointments' && (<div className="stack"><div className="muted">Tasks that include “visit”, “meeting” or “appointment” appear here. Create one from the Tasks tab.</div>
                {ws.appointments.length ? ws.appointments.map((a) => <div key={a.id} className="card row between" style={{ padding: 12 }}><b>{a.title}</b><span>{date(a.due_date)}</span></div>) : <Empty>No upcoming appointments.</Empty>}</div>)}
              {tab === 'timeline' && (
                <table className="t"><thead><tr><th>Date</th><th>Time</th><th>User</th><th>Action</th><th>Previous</th><th>New</th></tr></thead>
                  <tbody>{ws.activities.map((a) => <tr key={a.id}><td className="nowrap">{date(a.created_at)}</td><td className="nowrap">{(dateTime(a.created_at).split(' ').slice(1).join(' '))}</td><td>{a.user_name}</td><td><b>{a.action}</b>{a.field && <div className="cell-sub">{a.field}</div>}{a.detail && <div className="cell-sub">{a.detail}</div>}</td><td>{a.prev_value || '—'}</td><td>{a.new_value || '—'}</td></tr>)}</tbody></table>
              )}
            </div>
          </Card>
          {tab !== 'projects' && ws.development.length > 0 && c.is_customer && (
            <Card title="Development progress">{ws.development.map((d) => <div key={d.project_id} className="row" style={{ marginBottom: 6 }}><span style={{ width: 160 }}>{d.project_name}</span><div className="grow"><ProgressBar value={d.progress || 0} /></div><b>{d.progress || 0}%</b></div>)}</Card>
          )}
        </section>

        {/* ---------------- Right: action toolbar ---------------- */}
        <nav className="ws-tools" aria-label="Workspace tools">
          {TOOLS.map(([k, icon, label]) => <button key={k} className={`ws-tool ${tab === k ? 'active' : ''}`} title={label} aria-label={label} onClick={() => setTab(k)}><Icon name={icon} size={16} /></button>)}
        </nav>
      </div>

      {editing && <ContactForm initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {deleting && <ConfirmDialog danger title="Delete contact" message={`Delete ${c.full_name}? Timeline, notes and tasks are removed too.`} confirmLabel="Delete" onCancel={() => setDeleting(false)}
        onConfirm={async () => { setDeleting(false); undo.remove(c.id, `${c.full_name} deleted`, () => api.del(`/api/contacts/${c.id}`)); nav('/contacts'); }} />}
      {portal && (
        <Modal title="Customer portal access" size="sm" onClose={() => setPortal(null)} footer={<button className="btn primary" onClick={() => setPortal(null)}>Done</button>}>
          {portal.error ? <div className="alert err">{portal.error}</div> : portal.password
            ? <div className="stack"><div className="alert ok">Portal login created. Share these credentials with the customer securely — the password is shown only once.</div><KV items={[['Login', portal.login], ['Password', <code>{portal.password}</code>]]} /></div>
            : <div className="alert info">This customer already has portal access (login: {portal.login}). Use Settings → or reset the password from the Customers → Customer Portal page.</div>}
        </Modal>
      )}
    </div>
  );
}
