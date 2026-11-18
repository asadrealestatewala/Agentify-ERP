import { useState } from 'react';
import { Card, Empty, Field, Loading, Modal, PageHead, Select, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { date } from '../format.js';

const label = (s) => String(s).replace('_', ' ');

/** Support center for the society's customer-support team: requests from the website, the customer portal and staff. */
export default function SocietySupport() {
  const { can } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ status: '', category: '', q: '', mine: '' });
  const { data, reload } = useFetch('/api/society/complaints', f);
  const [open, setOpen] = useState(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [add, setAdd] = useState(null);
  const edit = can('customers', 'edit');
  const show = async (id) => { try { setOpen(await api.get(`/api/society/complaints/${id}`)); setReply(''); setInternal(false); } catch (e) { toast(e.message, 'err'); } };
  const patch = async (b) => { try { await api.put(`/api/society/complaints/${open.id}`, b); await show(open.id); reload(); } catch (e) { toast(e.message, 'err'); } };
  const send = async () => { try { await api.post(`/api/society/complaints/${open.id}/reply`, { body: reply, internal }); await show(open.id); reload(); } catch (e) { toast(e.message, 'err'); } };
  const create = async () => { try { const r = await api.post('/api/society/complaints', add); toast(`Logged ${r.ref}`, 'ok'); setAdd(null); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div>
      <PageHead title="Support center" sub="Requests and complaints from residents and customers: transactions, receipts, ledgers, development, facilities, possession and more. They arrive from the website, the customer portal or are logged by your team.">
        {edit && <button className="btn primary" onClick={() => setAdd({ category: 'Complaint', name: '', email: '', phone: '', whatsapp: '', plot_no: '', subject: '', message: '' })}>Log a request</button>}
      </PageHead>
      {!data ? <Loading /> : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {['', ...['open', 'in_progress', 'resolved', 'closed']].map((s) => <button key={s} className={`btn sm${f.status === s ? ' primary' : ''}`} onClick={() => setF({ ...f, status: s })}>{s ? label(s) : 'All'}{s && data.counts[s] ? ` (${data.counts[s]})` : ''}</button>)}
            <Select value={f.category} onChange={(v) => setF({ ...f, category: v })} placeholder="Any topic" options={data.categories.map((c) => ({ value: c, label: c }))} />
            <button className={`btn sm${f.mine ? ' primary' : ''}`} onClick={() => setF({ ...f, mine: f.mine ? '' : '1' })}>Assigned to me</button>
            <input className="input" style={{ maxWidth: 240 }} placeholder="Search name, plot, reference…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </div>
          <Card flush>
            {!data.rows.length ? <Empty>No requests match. New ones appear here as soon as someone lodges them.</Empty> : (
              <table className="t"><thead><tr><th>Ref</th><th>From</th><th>Plot / file</th><th>Topic</th><th>Subject</th><th>Status</th><th>Assigned</th><th>Received</th></tr></thead>
                <tbody>{data.rows.map((r) => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => show(r.id)}><td className="mono">{r.ref}</td><td>{r.name}<div className="cell-sub">{r.phone || r.whatsapp}</div></td><td>{r.plot_no || '—'}</td><td>{r.category}</td><td>{r.subject}</td><td><StatusBadge status={r.status} label={label(r.status)} /></td><td>{r.assignee || '—'}</td><td>{date(r.created_at)}</td></tr>)}</tbody></table>
            )}
          </Card>
        </>
      )}
      {open && (
        <Modal size="lg" title={`${open.ref}: ${open.subject}`} onClose={() => setOpen(null)}>
          <div className="stack">
            <div className="muted">{open.name} · {open.email} · {[open.phone, open.whatsapp && `WhatsApp ${open.whatsapp}`].filter(Boolean).join(' · ')} · Plot/file: {open.plot_no || '—'} · via {open.source}{open.contact ? ` · customer: ${open.contact.full_name}` : ''}</div>
            {edit && (
              <div className="form-grid">
                <Field label="Status"><Select allowEmpty={false} value={open.status} onChange={(v) => patch({ status: v })} options={data.statuses.map((s) => ({ value: s, label: label(s) }))} /></Field>
                <Field label="Priority"><Select allowEmpty={false} value={open.priority} onChange={(v) => patch({ priority: v })} options={['low', 'normal', 'high'].map((s) => ({ value: s, label: s }))} /></Field>
                <Field label="Assigned to"><Select value={open.assigned_to || ''} onChange={(v) => patch({ assigned_to: v || null })} options={data.team.map((u) => ({ value: u.id, label: u.name }))} /></Field>
              </div>
            )}
            <div className="stack">{open.messages.map((m) => (
              <div key={m.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: m.internal ? '#fff8e6' : m.author_type === 'staff' ? 'var(--surface-2)' : 'transparent' }}>
                <div className="muted" style={{ fontSize: 12 }}>{m.author_name} ({m.internal ? 'internal note' : m.author_type}) · {date(m.created_at)}</div>
                <div style={{ whiteSpace: 'pre-line' }}>{m.body}</div>
              </div>))}</div>
            {edit && (
              <div className="stack">
                <textarea className="textarea" rows={3} placeholder="Write a reply to the customer, or tick “internal note”…" value={reply} onChange={(e) => setReply(e.target.value)} />
                <div className="row between"><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Internal note (customer cannot see)</label><button className="btn primary" disabled={reply.trim().length < 2} onClick={send}>{internal ? 'Add note' : 'Send reply'}</button></div>
              </div>
            )}
          </div>
        </Modal>
      )}
      {add && (
        <Modal title="Log a request" onClose={() => setAdd(null)} footer={<><button className="btn" onClick={() => setAdd(null)}>Cancel</button><button className="btn primary" onClick={create}>Save</button></>}>
          <div className="stack">
            <div className="form-grid">
              <Field label="Name" required><input className="input" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
              <Field label="Email" required><input className="input" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></Field>
              <Field label="Phone"><input className="input" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></Field>
              <Field label="WhatsApp"><input className="input" value={add.whatsapp} onChange={(e) => setAdd({ ...add, whatsapp: e.target.value })} /></Field>
              <Field label="Plot / file number"><input className="input" value={add.plot_no} onChange={(e) => setAdd({ ...add, plot_no: e.target.value })} /></Field>
              <Field label="Topic"><Select allowEmpty={false} value={add.category} onChange={(v) => setAdd({ ...add, category: v })} options={data.categories.map((c) => ({ value: c, label: c }))} /></Field>
            </div>
            <Field label="Subject"><input className="input" value={add.subject} onChange={(e) => setAdd({ ...add, subject: e.target.value })} /></Field>
            <Field label="Details" required><textarea className="textarea" rows={4} value={add.message} onChange={(e) => setAdd({ ...add, message: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
