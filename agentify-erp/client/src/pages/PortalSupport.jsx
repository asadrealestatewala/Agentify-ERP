import { useState } from 'react';
import { Card, Empty, Field, Loading, Select, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { date } from '../format.js';

/** Customer portal: lodge a request or complaint, follow it and reply. Staff answers appear here and as a notification. */
export default function PortalSupport() {
  const toast = useToast();
  const { data, reload } = useFetch('/api/portal/support');
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const [reply, setReply] = useState('');
  const show = async (id) => { try { setOpen(await api.get(`/api/portal/support/${id}`)); setReply(''); } catch (e) { toast(e.message, 'err'); } };
  if (!data) return <Loading />;
  const start = () => setForm({ category: 'Complaint', subject: '', message: '', sale_id: '', phone: data.me?.phone || '', whatsapp: data.me?.whatsapp || '', email: data.me?.email || '', name: data.me?.name || '' });
  const send = async () => {
    try {
      const r = await api.post('/api/portal/support', { ...form, sale_id: form.sale_id || undefined });
      toast(`Request ${r.ref} sent. We will reply here.`, 'ok'); setForm(null); reload(); show(r.id);
    } catch (e) { toast(e.message, 'err'); }
  };
  const sendReply = async () => {
    try { await api.post(`/api/portal/support/${open.id}/reply`, { body: reply }); show(open.id); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <div className="row between"><h2 style={{ fontSize: 20, margin: 0 }}>Support center</h2><button className="btn primary" onClick={start}>New request</button></div>
      <div className="muted">Ask about transactions, receipts, your ledger, development, facilities or possession, or lodge a complaint. Our support team replies here.</div>
      {form && (
        <Card title="New request">
          <div className="stack">
            <div className="form-grid">
              <Field label="Topic"><Select allowEmpty={false} value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={data.categories.map((c) => ({ value: c, label: c }))} /></Field>
              <Field label="Your plot / file" hint="Optional"><Select value={form.sale_id} onChange={(v) => setForm({ ...form, sale_id: v })} options={data.plots.map((p) => ({ value: p.id, label: `${p.title || 'Property'}${p.plot_no ? ` (${p.plot_no})` : ''}` }))} /></Field>
              <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="WhatsApp"><input className="input" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field>
              <Field label="Email"><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            </div>
            <Field label="Subject"><input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
            <Field label="Your message" required><textarea className="textarea" rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
            <div className="row"><button className="btn primary" onClick={send}>Send request</button><button className="btn" onClick={() => setForm(null)}>Cancel</button></div>
          </div>
        </Card>
      )}
      {open && (
        <Card title={`${open.ref}: ${open.subject}`} actions={<button className="btn sm" onClick={() => setOpen(null)}>Close</button>}>
          <div className="row" style={{ gap: 10, marginBottom: 10 }}><StatusBadge status={open.status} label={open.status.replace('_', ' ')} /><span className="muted">{open.category}{open.plot_no ? ` · ${open.plot_no}` : ''} · {date(open.created_at)}</span></div>
          <div className="stack">{open.messages.map((m, k) => (
            <div key={k} style={{ background: m.author_type === 'staff' ? 'var(--surface-2)' : 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <div className="muted" style={{ fontSize: 12 }}>{m.author_type === 'staff' ? `${m.author_name} (support)` : 'You'} · {date(m.created_at)}</div>
              <div style={{ whiteSpace: 'pre-line' }}>{m.body}</div>
            </div>))}</div>
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
            <textarea className="textarea" rows={2} style={{ flex: 1 }} placeholder="Write a reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
            <button className="btn primary" disabled={reply.trim().length < 2} onClick={sendReply}>Send</button>
          </div>
        </Card>
      )}
      <Card title="My requests" flush>
        {!data.requests.length ? <Empty>No requests yet.</Empty> : (
          <table className="t"><thead><tr><th>Reference</th><th>Topic</th><th>Subject</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{data.requests.map((r) => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => show(r.id)}><td className="mono">{r.ref}</td><td>{r.category}</td><td>{r.subject}</td><td><StatusBadge status={r.status} label={r.status.replace('_', ' ')} /></td><td>{date(r.updated_at)}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  );
}
