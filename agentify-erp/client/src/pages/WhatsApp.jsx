// WhatsApp inbox: one conversation per customer number, linked to the CRM contact, with replies sent one-to-one through the
// workspace's own Botlinkd connection. Replies are possible for 24 hours after the customer's last message (WhatsApp rule),
// and there is no bulk sending anywhere on this page.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, Empty, Field, Loading, Modal, PageHead, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { dateTimeUtc } from '../format.js';

const who = (t) => t.contact_name || t.display_name || `+${t.wa_id}`;
const hoursLeft = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 360000) / 10);

function ThreadList({ items, sel, onSelect, filter, setFilter, q, setQ, status, setStatus }) {
  return (
    <div className="wa-list">
      <div className="wa-tools">
        <input className="input" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {[['', 'All'], ['unread', 'Unread'], ['unassigned', 'Unassigned']].map(([k, l]) => <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
          <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Open or closed"><option value="open">Open</option><option value="closed">Closed</option></select>
        </div>
      </div>
      {!items ? <Loading rows={4} /> : !items.length ? <Empty title="No conversations" hint="Customers who write to your WhatsApp number appear here." /> : items.map((t) => (
        <button key={t.id} className={`wa-item ${sel === t.id ? 'on' : ''}`} onClick={() => onSelect(t.id)}>
          <span className="wa-av" aria-hidden="true">{who(t).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '#'}</span>
          <span className="wa-meta">
            <span className="wa-top"><b>{who(t)}</b><span className="muted wa-time">{t.last_message_at ? dateTimeUtc(t.last_message_at) : ''}</span></span>
            <span className="wa-prev muted">{t.last_preview || '—'}</span>
            <span className="wa-tags">{t.assigned_name ? <span className="muted">{t.assigned_name}</span> : <span className="wa-un">Unassigned</span>}{t.opted_out && <StatusBadge tone="red" label="Opted out" />}</span>
          </span>
          {t.unread > 0 && <span className="wa-badge" aria-label={`${t.unread} unread`}>{t.unread}</span>}
        </button>
      ))}
    </div>
  );
}

function Thread({ id, people, onBack, onChanged }) {
  const toast = useToast();
  const { can } = useAuth();
  const edit = can('crm', 'edit');
  const { data, error, reload } = useFetch(`/api/whatsapp/threads/${id}`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState(null);
  const [link, setLink] = useState(null);
  const end = useRef(null);
  useEffect(() => { api.post(`/api/whatsapp/threads/${id}/read`).then(onChanged).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = setInterval(reload, 10000); return () => clearInterval(h); }, [reload]);
  const count = data?.messages?.length || 0;
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [count, id]);
  if (error) return <Card><div className="alert err">{error}</div></Card>;
  if (!data) return <Loading rows={4} />;
  const { thread: t, messages } = data;
  const act = async (fn, ok) => { try { await fn(); if (ok) toast(ok, 'ok'); reload(); onChanged(); } catch (e) { toast(e.message, 'err'); } };
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await api.post(`/api/whatsapp/threads/${id}/messages`, { body: text }); setText(''); } catch (e) { toast(e.message, 'err'); }
    setBusy(false); reload(); onChanged();
  };
  const optOut = (on) => {
    const reason = on ? '' : window.prompt('Why is messaging this number allowed again? (for example: the customer asked us to message them)');
    if (!on && !reason) return;
    act(() => api.post(`/api/whatsapp/threads/${id}/opt-out`, { opt_out: on, reason }), on ? 'Marked as do not message' : 'Messaging allowed again');
  };
  return (
    <div className="wa-chat">
      <div className="wa-head">
        <button className="btn sm wa-back" onClick={onBack} aria-label="Back to conversations">Back</button>
        <div className="wa-who"><b>{who(t)}</b><span className="muted">+{t.wa_id}</span></div>
        <div className="row wa-actions">
          {t.contact_id ? <Link className="btn sm" to={`/contacts/${t.contact_id}`}>Open contact</Link> : edit && <>
            <button className="btn sm" onClick={() => setLead({ name: '' })}>Create lead</button>
            <button className="btn sm" onClick={() => setLink({ q: '', results: null })}>Link contact</button></>}
          {edit && <select className="input" style={{ width: 'auto' }} value={t.assigned_to || ''} onChange={(e) => act(() => api.put(`/api/whatsapp/threads/${id}`, { assigned_to: e.target.value ? Number(e.target.value) : null }), 'Assigned')} aria-label="Assigned to"><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          {edit && <button className="btn sm" onClick={() => act(() => api.put(`/api/whatsapp/threads/${id}`, { status: t.status === 'open' ? 'closed' : 'open' }))}>{t.status === 'open' ? 'Close' : 'Reopen'}</button>}
          {edit && <button className="btn sm danger" onClick={() => optOut(!t.opted_out)}>{t.opted_out ? 'Allow messaging' : 'Do not message'}</button>}
        </div>
      </div>
      <div className="wa-msgs" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`wa-msg ${m.direction === 'out' ? 'out' : 'in'} ${m.status === 'failed' ? 'failed' : ''}`}>
            <div className="wa-body">{m.body}</div>
            <div className="wa-foot muted">{m.direction === 'out' && m.user_name ? `${m.user_name} · ` : ''}{dateTimeUtc(m.created_at)}{m.status === 'failed' ? ' · not sent' : ''}</div>
          </div>))}
        <div ref={end} />
      </div>
      {t.opted_out && <div className="alert warn">This customer asked not to be messaged on WhatsApp. Sending is blocked.</div>}
      {!t.opted_out && !t.can_reply && <div className="alert info">The 24-hour reply window is closed. You can reply again when the customer writes to you. WhatsApp does not allow free messages after that.</div>}
      {edit && <div className="wa-compose">
        <textarea className="input" rows={2} maxLength={1000} placeholder={t.can_reply ? 'Write a reply' : 'Replies are not possible right now'} disabled={!t.can_reply || busy} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} aria-label="Reply" />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>{t.can_reply ? `You can reply for ${hoursLeft(t.window_closes_at)} more hours. Ctrl+Enter sends.` : ''}</span>
          <button className="btn primary" disabled={!t.can_reply || busy || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Send reply'}</button>
        </div>
      </div>}
      {lead && <Modal title="Create a lead from this chat" onClose={() => setLead(null)} footer={<><button className="btn" onClick={() => setLead(null)}>Cancel</button><button className="btn primary" disabled={!lead.name.trim()} onClick={() => act(async () => { await api.post(`/api/whatsapp/threads/${id}/create-lead`, { name: lead.name }); setLead(null); }, 'Lead created')}>Create lead</button></>}>
        <Field label="Name (letters only)"><input className="input" autoFocus value={lead.name} onChange={(e) => setLead({ name: e.target.value })} /></Field>
        <p className="muted">The number +{t.wa_id} is saved as the phone and WhatsApp number, the lead is routed by your lead rules, and the customer's first message is saved on it.</p>
      </Modal>}
      {link && <LinkContact id={id} onClose={() => setLink(null)} onDone={() => { setLink(null); reload(); onChanged(); }} />}
    </div>
  );
}

function LinkContact({ id, onClose, onDone }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRows(null); return undefined; }
    const h = setTimeout(() => api.get('/api/contacts', { q, limit: 8 }).then((r) => setRows(r.rows || r.items || r)).catch(() => setRows([])), 250);
    return () => clearTimeout(h);
  }, [q]);
  const pick = async (cid) => { try { await api.put(`/api/whatsapp/threads/${id}`, { contact_id: cid }); toast('Linked', 'ok'); onDone(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title="Link to an existing contact" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <input className="input" autoFocus placeholder="Search by name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" />
      {Array.isArray(rows) && (rows.length ? rows.map((c) => <button key={c.id} className="wa-pick" onClick={() => pick(c.id)}><b>{c.full_name}</b> <span className="muted">{c.phone || c.email || ''}</span></button>) : <p className="muted">No contact found.</p>)}
    </Modal>
  );
}

export default function WhatsApp() {
  const [sp, setSp] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const sel = Number(sp.get('thread')) || null;
  const conn = useFetch('/api/whatsapp/connection');
  const people = useFetch('/api/whatsapp/people');
  const [items, setItems] = useState(null);
  const load = useCallback(() => api.get('/api/whatsapp/threads', { filter, status, q }).then(setItems).catch(() => setItems([])), [filter, status, q]);
  useEffect(() => { const h = setTimeout(load, q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);
  useEffect(() => { const h = setInterval(load, 10000); return () => clearInterval(h); }, [load]);
  if (conn.loading || !conn.data) return <Loading />;
  const c = conn.data;
  if (!c.access.enabled || !c.configured) {
    return (
      <div>
        <PageHead title="WhatsApp" sub="Read and answer your customers' WhatsApp chats next to their CRM record." />
        <Card><Empty title={c.access.enabled ? 'WhatsApp is not connected yet' : 'WhatsApp is not available'} hint={c.access.enabled ? 'Add your Botlinkd keys and webhook address in Settings > WhatsApp.' : c.access.message} to={c.access.enabled ? { href: '/settings/whatsapp', label: 'Set up WhatsApp' } : undefined} /></Card>
      </div>
    );
  }
  const open = (id) => setSp(id ? { thread: String(id) } : {});
  return (
    <div className={`wa-page ${sel ? 'has-sel' : ''}`}>
      <PageHead title="WhatsApp" sub="Replies are one-to-one and possible for 24 hours after the customer's last message. Nobody is messaged in bulk from here." />
      {c.state === 'error' && <div className="alert err" style={{ marginBottom: 10 }}>The last send failed: {c.last_error || 'check your Botlinkd keys'}. <Link to="/settings/whatsapp">Open WhatsApp settings</Link></div>}
      <div className="wa-grid">
        <ThreadList items={items} sel={sel} onSelect={open} filter={filter} setFilter={setFilter} q={q} setQ={setQ} status={status} setStatus={setStatus} />
        <div className="wa-pane">{sel ? <Thread key={sel} id={sel} people={people.data || []} onBack={() => open(null)} onChanged={load} /> : <Card><Empty title="Choose a conversation" hint="Pick a customer on the left to read and reply." /></Card>}</div>
      </div>
    </div>
  );
}
