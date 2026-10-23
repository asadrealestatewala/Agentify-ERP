// Super Admin console: Mailbox. Inbox (Resend Inboxes: hello@ and admin@), Sent log (everything the platform e-mailed, with live delivery
// status) and Settings. Platform Owner and Super Admin only; the server checks that on every request and calls Resend, never this page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ConfirmDialog, Empty, ErrorBox, Field, Loading, Modal, StatusBadge, TextInput } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { api, download } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';
import './mailbox.css';

const M = `${A}/mailbox`;
const useDebounced = (v, ms = 350) => { const [x, setX] = useState(v); useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]); return x; };
const parseTs = (ts) => (ts ? new Date(String(ts).includes('T') ? ts : `${String(ts).replace(' ', 'T')}Z`) : null);
const when = (ts) => { const d = parseTs(ts); return d && !Number.isNaN(+d) ? d.toLocaleString() : '—'; };
const short = (ts) => { const d = parseTs(ts); if (!d || Number.isNaN(+d)) return ''; const now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.getFullYear() === now.getFullYear() ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.toLocaleDateString(); };
const nameOf = (addr) => { const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(String(addr || '')); return (m && (m[1].trim() || m[2])) || String(addr || ''); };
const bareOf = (addr) => { const m = /<([^>]+)>/.exec(String(addr || '')); return m ? m[1] : String(addr || ''); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sizeOf = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const FOLDERS = [['inbox', 'Inbox'], ['sent', 'Sent'], ['drafts', 'Drafts'], ['archive', 'Archive'], ['spam', 'Spam'], ['trash', 'Trash']];
const MAX_ATTACH = 20 * 1024 * 1024;

/** A rich-text box for composing: bold, italic, underline, link, lists. The server sanitises whatever it sends. */
function RichText({ initial, onChange, label = 'Message' }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = initial || ''; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cmd = (c, v) => { ref.current?.focus(); document.execCommand(c, false, v); onChange(ref.current.innerHTML); };
  const link = () => { const u = window.prompt('Link address (https://…)'); if (u && /^(https?:\/\/|mailto:)/i.test(u.trim())) cmd('createLink', u.trim()); };
  const B = ({ c, v, t, children, onClick }) => <button type="button" className="mb-tb" title={t} aria-label={t} onMouseDown={(e) => e.preventDefault()} onClick={onClick || (() => cmd(c, v))}>{children}</button>;
  return (
    <div className="mb-rich">
      <div className="mb-toolbar" role="toolbar" aria-label="Formatting">
        <B c="bold" t="Bold"><b>B</b></B><B c="italic" t="Italic"><i>I</i></B><B c="underline" t="Underline"><u>U</u></B>
        <B c="insertUnorderedList" t="Bulleted list">• List</B><B c="insertOrderedList" t="Numbered list">1. List</B>
        <B t="Add link" onClick={link}>Link</B><B c="removeFormat" t="Clear formatting">Clear</B>
      </div>
      <div ref={ref} className="mb-editor" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label} onInput={() => onChange(ref.current.innerHTML)} />
    </div>
  );
}

/** Compose / reply / forward / edit a draft. mode: new | reply | replyall | forward | draft. */
function Composer({ mode, inboxes, ctx, onClose, onDone }) {
  const toast = useToast();
  const senders = inboxes.filter((i) => i.can_send);
  const first = ctx.thread?.inbox_id ? senders.find((i) => i.id === ctx.thread.inbox_id) : null;
  const [from, setFrom] = useState(ctx.draft?.inbox_id || first?.id || senders[0]?.id || '');
  const [to, setTo] = useState((ctx.draft?.to || ctx.to || []).join(', '));
  const [cc, setCc] = useState((ctx.draft?.cc || ctx.cc || []).join(', '));
  const [bcc, setBcc] = useState((ctx.draft?.bcc || []).join(', '));
  const [showCc, setShowCc] = useState(!!(ctx.draft?.cc?.length || ctx.cc?.length || ctx.draft?.bcc?.length));
  const [subject, setSubject] = useState(ctx.draft?.subject ?? ctx.subject ?? '');
  const [html, setHtml] = useState(ctx.draft?.html || ctx.html || '');
  const [files, setFiles] = useState([]);
  const [draftId, setDraftId] = useState(ctx.draft?.id || null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = useRef(false);
  const total = files.reduce((n, f) => n + f.size, 0);
  const isNew = mode === 'new' || mode === 'draft';
  const touch = (fn) => (v) => { dirty.current = true; fn(v); };

  // debounced Resend draft for new messages: saved shortly after the last change
  const snapshot = useDebounced(JSON.stringify([from, to, cc, bcc, subject, html]), 1800);
  useEffect(() => {
    if (!isNew || !dirty.current || !from || busy) return;
    const empty = !to.trim() && !subject.trim() && !html.replace(/<[^>]*>|&nbsp;|\s/g, '');
    if (empty) return;
    let live = true;
    setSaved('Saving…');
    api.post(`${M}/drafts`, { inbox: from, draft_id: draftId, to, cc, bcc, subject, html })
      .then((r) => { if (live) { setDraftId(r.id); setSaved(`Draft saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`); dirty.current = false; } })
      .catch((e) => { if (live) setSaved(`Draft not saved: ${e.message}`); });
    return () => { live = false; };
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (list) => {
    const next = [...files, ...Array.from(list)];
    if (next.reduce((n, f) => n + f.size, 0) > MAX_ATTACH) { toast('Attachments are over 20 MB in total. Remove some or send a download link.', 'err'); return; }
    setFiles(next);
  };
  const send = async () => {
    const empty = !html.replace(/<[^>]*>|&nbsp;|\s/g, '');
    if (!from) return toast('Choose an inbox to send from', 'err');
    if (isNew && !to.trim()) return toast('Add at least one recipient', 'err');
    if (mode === 'forward' && !to.trim()) return toast('Add who to forward to', 'err');
    if (isNew && !subject.trim()) return toast('Add a subject', 'err');
    if (empty && mode !== 'forward') return toast('Write a message first', 'err');
    const fd = new FormData();
    fd.set('inbox', from); fd.set('html', html); fd.set('cc', cc); fd.set('bcc', bcc);
    if (isNew) { fd.set('to', to); fd.set('subject', subject); if (draftId) fd.set('draft_id', draftId); }
    if (mode === 'forward') { fd.set('to', to); fd.set('thread_id', ctx.thread.id); fd.set('email_id', ctx.email.id); }
    if (mode === 'reply' || mode === 'replyall') { fd.set('thread_id', ctx.thread.id); fd.set('email_id', ctx.email.id); if (mode === 'replyall') fd.set('all', 'true'); }
    files.forEach((f) => fd.append('files', f));
    setBusy(true);
    try {
      await api.upload(`${M}/${isNew ? 'send' : mode === 'forward' ? 'forward' : 'reply'}`, fd);
      toast('Message sent'); dirty.current = false; onDone('sent');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const discard = async () => {
    if (draftId && from) { try { await api.del(`${M}/drafts/${from}/${draftId}`); } catch (e) { toast(e.message, 'err'); return; } }
    onDone('discarded');
  };
  const title = { new: 'New message', draft: 'Draft', reply: 'Reply', replyall: 'Reply all', forward: 'Forward' }[mode];
  return (
    <div className="mb-compose" role="dialog" aria-label={title}>
      <div className="mb-compose-h"><b>{title}</b><button className="icon-btn" onClick={() => (dirty.current && isNew ? onClose() : onClose())} aria-label="Minimise and close"><Icon name="x" /></button></div>
      <div className="mb-compose-b">
        <label className="mb-row"><span>From</span>
          <select className="select" value={from} onChange={(e) => touch(setFrom)(e.target.value)} disabled={!isNew && !!first} aria-label="Send from">
            {senders.map((i) => <option key={i.id} value={i.id}>{i.from_name ? `${i.from_name} <${i.email}>` : i.email}</option>)}
          </select></label>
        {isNew || mode === 'forward'
          ? <label className="mb-row"><span>To</span><input className="input" value={to} onChange={(e) => touch(setTo)(e.target.value)} placeholder="name@example.com, another@example.com" inputMode="email" autoComplete="off" aria-label="To" /></label>
          : <div className="mb-row"><span>To</span><div className="muted mb-fixed">{(ctx.to || []).join(', ')}</div></div>}
        {!showCc ? <button type="button" className="btn sm ghost mb-ccbtn" onClick={() => setShowCc(true)}>Cc / Bcc</button> : <>
          <label className="mb-row"><span>Cc</span><input className="input" value={cc} onChange={(e) => touch(setCc)(e.target.value)} inputMode="email" aria-label="Cc" /></label>
          <label className="mb-row"><span>Bcc</span><input className="input" value={bcc} onChange={(e) => touch(setBcc)(e.target.value)} inputMode="email" aria-label="Bcc" /></label></>}
        {(isNew || mode === 'forward') && <label className="mb-row"><span>Subject</span><input className="input" value={subject} onChange={(e) => touch(setSubject)(e.target.value)} aria-label="Subject" disabled={mode === 'forward'} /></label>}
        <RichText initial={html} onChange={touch(setHtml)} />
        {!!files.length && <div className="mb-files">{files.map((f, i) => <span key={i} className="mb-chip">{f.name} <small>{sizeOf(f.size)}</small><button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, k) => k !== i))}>×</button></span>)}<small className="muted">{sizeOf(total)} of 20 MB</small></div>}
      </div>
      <div className="mb-compose-f">
        <button className="btn primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
        <label className="btn" title="Attach files (up to 20 MB in total)"><Icon name="file" size={14} /> Attach<input type="file" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} /></label>
        <span className="muted mb-saved" aria-live="polite">{saved}</span>
        <button className="btn ghost danger mb-discard" onClick={() => (draftId || dirty.current ? setConfirmDiscard(true) : onClose())}>Discard</button>
      </div>
      {confirmDiscard && <ConfirmDialog title="Discard this message?" message={draftId ? 'The saved draft will be deleted.' : 'What you wrote will be lost.'} confirmLabel="Discard" danger onConfirm={discard} onCancel={() => setConfirmDiscard(false)} />}
    </div>
  );
}

function ThreadView({ inboxId, threadId, inboxes, labels, onBack, onChanged, onCompose }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [images, setImages] = useState(false);
  const [menu, setMenu] = useState(false);
  const load = useCallback((img = false) => {
    setErr('');
    return api.get(`${M}/threads/${inboxId}/${threadId}`, { images: img ? 1 : undefined, mark: img ? 0 : undefined }).then((r) => { setD(r); onChanged?.({ read: true }); }).catch((e) => setErr(e.message));
  }, [inboxId, threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setD(null); setImages(false); load(); }, [load]);
  const act = async (body, msg) => { try { await api.patch(`${M}/threads/${inboxId}/${threadId}`, body); toast(msg); onChanged?.({ ...body, gone: !!body.folder }); if (body.read === false) onBack(); } catch (e) { toast(e.message, 'err'); } };
  const toggleLabel = async (l) => {
    const has = d.thread.labels.includes(l.id) || d.thread.labels.includes(l.name);
    try { if (has) await api.del(`${M}/threads/${inboxId}/${threadId}/labels/${l.id}`); else await api.post(`${M}/threads/${inboxId}/${threadId}/labels`, { label_id: l.id }); await load(images); onChanged?.({ refresh: true }); } catch (e) { toast(e.message, 'err'); }
  };
  const last = d?.emails.filter((e) => e.direction !== 'outbound').at(-1) || d?.emails.at(-1);
  const inbox = inboxes.find((i) => i.id === inboxId);
  const quote = (e) => `<br><br><blockquote>On ${esc(when(e.received_at))}, ${esc(e.from)} wrote:<br>${(e.html || '').replace(/<span class="mb-noimg">.*?<\/span>/g, '') || esc(e.text || '').replace(/\n/g, '<br>')}</blockquote>`;
  const open = (mode) => {
    const e = last; if (!e) return;
    const me = (inbox?.email || '').toLowerCase();
    const replyTo = e.direction === 'outbound' ? e.to : (e.reply_to?.length ? e.reply_to : [e.from]);
    onCompose(mode, { thread: { id: threadId, inbox_id: inboxId }, email: e, to: mode === 'forward' ? [] : replyTo, cc: mode === 'replyall' ? [...e.to, ...e.cc].filter((a) => bareOf(a).toLowerCase() !== me && !replyTo.some((r) => bareOf(r).toLowerCase() === bareOf(a).toLowerCase())) : [],
      subject: mode === 'forward' ? (/^fwd?:/i.test(d.thread.subject || '') ? d.thread.subject : `Fwd: ${d.thread.subject || ''}`) : undefined, html: mode === 'forward' ? '' : quote(e) });
  };
  const dl = async (e, a) => { try { await download(`${M}/attachments/${e.id}/${a.id}`, null, a.filename); } catch (x) { toast(x.message, 'err'); } };
  if (err) return <div className="mb-pane-pad"><button className="btn sm mb-back" onClick={onBack}>← Back</button><ErrorBox error={err} /></div>;
  if (!d) return <div className="mb-pane-pad"><button className="btn sm mb-back" onClick={onBack}>← Back</button><Loading rows={4} /></div>;
  const folder = d.thread.folder;
  return (
    <div className="mb-thread">
      <div className="mb-thread-h">
        <button className="btn sm mb-back" onClick={onBack}>← Back</button>
        <h2>{d.thread.subject || '(no subject)'}</h2>
        <div className="mb-actions" role="toolbar" aria-label="Message actions">
          <button className="btn sm primary" onClick={() => open('reply')}>Reply</button>
          <button className="btn sm" onClick={() => open('replyall')}>Reply all</button>
          <button className="btn sm" onClick={() => open('forward')}>Forward</button>
          {folder !== 'archive' && <button className="btn sm" onClick={() => act({ folder: 'archive' }, 'Archived')}>Archive</button>}
          {folder !== 'inbox' && <button className="btn sm" onClick={() => act({ folder: 'inbox' }, 'Moved to Inbox')}>Move to Inbox</button>}
          {folder !== 'spam' && <button className="btn sm" onClick={() => act({ folder: 'spam' }, 'Marked as spam')}>Spam</button>}
          {folder !== 'trash' && <button className="btn sm danger" onClick={() => act({ folder: 'trash' }, 'Moved to Trash')}>Trash</button>}
          <button className="btn sm" onClick={() => act({ read: false }, 'Marked as unread')}>Mark unread</button>
          <span className="mb-menu">
            <button className="btn sm" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu(!menu)}>Labels</button>
            {menu && <div className="mb-pop" role="menu">{labels.length ? labels.map((l) => <button key={l.id} role="menuitemcheckbox" aria-checked={d.thread.labels.includes(l.id) || d.thread.labels.includes(l.name)} onClick={() => toggleLabel(l)}>{(d.thread.labels.includes(l.id) || d.thread.labels.includes(l.name)) ? '✓ ' : ''}{l.name}</button>) : <small className="muted">No labels yet. Create one from the folder list.</small>}</div>}
          </span>
        </div>
        {!!d.thread.labels.length && <div className="mb-labels">{d.thread.labels.map((id) => <span key={id} className="mb-label">{labels.find((l) => l.id === id)?.name || id}</span>)}</div>}
      </div>
      {d.emails.some((e) => e.has_remote_images) && !images && <div className="mb-banner">Remote images are blocked so the sender cannot tell you opened this message. <button className="btn sm" onClick={() => { setImages(true); load(true); }}>Show images</button></div>}
      <div className="mb-emails">
        {d.emails.map((e) => (
          <article key={e.id} className="mb-email">
            <header><div><b>{nameOf(e.from)}</b> <small className="muted">&lt;{bareOf(e.from)}&gt;</small></div><small className="muted">{when(e.received_at)}</small></header>
            <small className="muted mb-to">To: {e.to.join(', ') || '—'}{e.cc.length ? ` · Cc: ${e.cc.join(', ')}` : ''}</small>
            {e.html ? <div className="mb-body" dangerouslySetInnerHTML={{ __html: e.html }} /> : <pre className="mb-body mb-plain">{e.text || '(no content)'}</pre>}
            {!!e.attachments.length && <div className="mb-files">{e.attachments.map((a) => <button key={a.id} className="mb-chip" onClick={() => dl(e, a)}><Icon name="file" size={13} /> {a.filename} <small>{sizeOf(a.size)}</small></button>)}</div>}
          </article>
        ))}
      </div>
    </div>
  );
}

export function MailboxPage() {
  const toast = useToast();
  const [boxes, setBoxes] = useState(null);
  const [err, setErr] = useState('');
  const [inbox, setInbox] = useState('all');
  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [unread, setUnread] = useState(false);
  const [att, setAtt] = useState(false);
  const [label, setLabel] = useState('');
  const [labels, setLabels] = useState([]);
  const [rows, setRows] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [next, setNext] = useState(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sel, setSel] = useState(null);
  const [compose, setCompose] = useState(null);
  const [listErr, setListErr] = useState('');
  const seq = useRef(0);

  const loadBoxes = useCallback((fresh) => api.get(`${M}/inboxes`, { fresh: fresh ? 1 : undefined }).then(setBoxes).catch((e) => setErr(e.message)), []);
  useEffect(() => { loadBoxes(); }, [loadBoxes]);
  useEffect(() => { setLabels([]); setLabel(''); if (inbox !== 'all') api.get(`${M}/inboxes/${inbox}/labels`).then((r) => setLabels(r.labels)).catch(() => {}); }, [inbox]);

  const query = useMemo(() => ({ inbox, folder, q: dq || undefined, read: unread ? 'false' : undefined, attachment: att ? 'true' : undefined, label: label || undefined, limit: 25 }), [inbox, folder, dq, unread, att, label]);
  const load = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) { setRows(null); setNext(null); }
    setListErr('');
    try {
      if (folder === 'drafts') { const r = await api.get(`${M}/drafts`, { inbox }); if (mine === seq.current) { setDrafts(r.drafts); setRows([]); setMore(false); } return; }
      const r = await api.get(`${M}/threads`, query);
      if (mine !== seq.current) return;
      setRows(r.threads); setNext(r.next); setMore(r.has_more);
    } catch (e) { if (mine === seq.current) { setListErr(e.message); setRows((x) => x || []); } }
  }, [query, folder, inbox]);
  useEffect(() => { if (boxes?.configured) load(); }, [load, boxes?.configured]);
  // new mail shows up without a manual refresh while this page is open
  useEffect(() => { if (!boxes?.configured) return undefined; const t = setInterval(() => { if (!document.hidden && !compose) { load(true); loadBoxes(); } }, 60_000); return () => clearInterval(t); }, [load, loadBoxes, boxes?.configured, compose]);

  const loadMore = async () => {
    setLoadingMore(true);
    try { const r = await api.get(`${M}/threads`, { ...query, after: next }); setRows((x) => [...x, ...r.threads.filter((t) => !x.some((y) => y.id === t.id))]); setNext(r.next); setMore(r.has_more); }
    catch (e) { toast(e.message, 'err'); } finally { setLoadingMore(false); }
  };
  const changed = (c) => {
    if (c.gone) { setRows((x) => x.filter((t) => t.id !== sel.id)); setSel(null); loadBoxes(); return; }
    if (c.read) { setRows((x) => x?.map((t) => (t.id === sel?.id && !t.read ? { ...t, read: true } : t))); loadBoxes(); }
    if (c.refresh) load(true);
  };
  const createLabel = async () => {
    if (inbox === 'all') return toast('Choose one inbox first', 'err');
    const name = window.prompt('New label name'); if (!name) return;
    try { await api.post(`${M}/inboxes/${inbox}/labels`, { name }); const r = await api.get(`${M}/inboxes/${inbox}/labels`); setLabels(r.labels); toast('Label created'); } catch (e) { toast(e.message, 'err'); }
  };
  const startCompose = (mode, ctx = {}) => setCompose({ mode, ctx, key: Date.now() });
  const openDraft = async (d) => { try { const full = await api.get(`${M}/drafts/${d.inbox_id}/${d.id}`); startCompose('draft', { draft: full }); } catch (e) { toast(e.message, 'err'); } };
  const done = (what) => { setCompose(null); if (what === 'sent') { toast('Sent. Find it under Sent.'); } load(true); loadBoxes(); };

  if (err) return <><PageTitle title="Mailbox" /><ErrorBox error={err} /></>;
  if (!boxes) return <><PageTitle title="Mailbox" /><Loading /></>;
  if (!boxes.configured) return <><PageTitle title="Mailbox" /><Empty icon="mail" title="Connect Resend first" hint="Save the Resend API key in Integrations, then the company inboxes appear here." action={<Link className="btn primary" to="/platform/integrations">Open Integrations</Link>} /></>;
  const sendable = boxes.inboxes.filter((i) => i.can_send);
  const shownBoxes = boxes.inboxes.filter((i) => i.can_send);
  const totalUnread = shownBoxes.reduce((n, i) => n + (i.unread || 0), 0);
  const openThread = (t) => setSel({ id: t.id, inbox_id: t.inbox_id });

  return (
    <>
      <PageTitle title="Inbox" sub="Read and answer mail sent to the company addresses. Replies leave from the same address.">
        <button className="btn primary" onClick={() => startCompose('new')} disabled={!sendable.length}><Icon name="plus" size={14} /> New message</button>
        <button className="btn" onClick={() => { load(); loadBoxes(true); }} aria-label="Refresh"><Icon name="refresh" size={14} /></button>
      </PageTitle>
      <div className={`mb ${sel ? 'has-thread' : ''}`}>
        <aside className="mb-side" aria-label="Inboxes and folders">
          <div className="mb-sec">Inboxes</div>
          <button className={`mb-item ${inbox === 'all' ? 'on' : ''}`} onClick={() => { setInbox('all'); setSel(null); }}>All inboxes {!!totalUnread && <em>{totalUnread}</em>}</button>
          {shownBoxes.map((i) => <button key={i.id} className={`mb-item ${inbox === i.id ? 'on' : ''}`} onClick={() => { setInbox(i.id); setSel(null); }}>{i.email} {!!i.unread && <em>{i.unread_capped ? '100+' : i.unread}</em>}</button>)}
          <div className="mb-sec">Folders</div>
          {FOLDERS.map(([k, l]) => <button key={k} className={`mb-item ${folder === k ? 'on' : ''}`} onClick={() => { setFolder(k); setSel(null); }}>{l}</button>)}
          <div className="mb-sec">Labels {inbox !== 'all' && <button className="mb-add" onClick={createLabel} aria-label="New label">+</button>}</div>
          {inbox === 'all' ? <small className="muted mb-pad">Pick one inbox to use labels.</small> : labels.length ? labels.map((l) => <button key={l.id} className={`mb-item ${label === l.id ? 'on' : ''}`} onClick={() => setLabel(label === l.id ? '' : l.id)}>{l.name}</button>) : <small className="muted mb-pad">No labels yet.</small>}
        </aside>

        <section className="mb-list" aria-label="Messages">
          <div className="mb-search">
            <div className="mb-sbox"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject, sender or text" aria-label="Search mail" /></div>
            <label className="mb-flt"><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Unread</label>
            <label className="mb-flt"><input type="checkbox" checked={att} onChange={(e) => setAtt(e.target.checked)} /> Attachments</label>
          </div>
          <ErrorBox error={listErr} />
          {rows === null ? <Loading rows={6} /> : folder === 'drafts'
            ? (drafts.length ? drafts.map((d) => <button key={d.id} className="mb-row-t" onClick={() => openDraft(d)}><div className="mb-row-top"><b>{(d.to || []).join(', ') || '(no recipient)'}</b><small>{short(d.updated_at)}</small></div><div className="mb-subj">{d.subject || '(no subject)'}</div><small className="muted">{d.snippet}</small></button>)
              : <Empty icon="mail" title="No drafts" hint="Drafts save automatically while you write a new message." />)
            : rows.length ? <>
              {rows.map((t) => (
                <button key={`${t.inbox_id}-${t.id}`} className={`mb-row-t ${t.read ? '' : 'unread'} ${sel?.id === t.id ? 'on' : ''}`} onClick={() => openThread(t)} aria-current={sel?.id === t.id}>
                  <div className="mb-row-top"><b>{folder === 'sent' ? `To: ${(t.to || []).map(nameOf).join(', ')}` : nameOf(t.from)}</b><small>{short(t.received_at)}</small></div>
                  <div className="mb-subj">{t.subject || '(no subject)'}</div>
                  <div className="mb-meta">{inbox === 'all' && <span className="mb-tag">{t.inbox.split('@')[0]}@</span>}{t.has_attachment && <Icon name="file" size={12} />}{t.email_count > 1 && <span className="mb-tag">{t.email_count}</span>}{t.has_draft && <span className="mb-tag warn">Draft</span>}</div>
                </button>
              ))}
              {more && <button className="btn mb-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
            </> : <Empty icon="mail" title={dq || unread || att || label ? 'No messages match' : `Nothing in ${FOLDERS.find(([k]) => k === folder)[1]}`} hint={dq || unread || att || label ? 'Change the search or clear the filters.' : folder === 'inbox' ? 'New mail to hello@ and admin@ shows up here.' : undefined} />}
        </section>

        <section className="mb-view" aria-label="Message">
          {sel ? <ThreadView key={`${sel.inbox_id}-${sel.id}`} inboxId={sel.inbox_id} threadId={sel.id} inboxes={boxes.inboxes} labels={labels} onBack={() => setSel(null)} onChanged={changed} onCompose={startCompose} />
            : <div className="mb-none"><Icon name="mail" size={28} /><p>Select a message to read it.</p></div>}
        </section>
      </div>
      {compose && <Composer key={compose.key} mode={compose.mode} ctx={compose.ctx} inboxes={boxes.inboxes} onClose={() => { setCompose(null); load(true); }} onDone={done} />}
    </>
  );
}

// ---------------------------------------------------------------- sent log
const TONE = { queued: ['inactive', 'Queued'], sent: ['pending', 'Sent'], delivered: ['active', 'Delivered'], bounced: ['overdue', 'Bounced'], complained: ['overdue', 'Marked as spam'], failed: ['overdue', 'Failed'] };
const TYPE_LABEL = { verification: 'E-mail confirmation', password_reset: 'Password reset', invitation: 'Invitation', welcome: 'Welcome', notification: 'Notification', billing: 'Billing', billing_notice: 'Billing notice', meeting: 'Meeting', demo_request: 'Demo request', workspace_list: 'Workspace list', test: 'Test', other: 'Other' };
const EVENT_LABEL = { 'email.sent': 'Accepted by Resend', 'email.delivered': 'Delivered to the inbox', 'email.delivery_delayed': 'Delivery delayed, Resend will retry', 'email.bounced': 'Bounced', 'email.complained': 'Recipient marked it as spam', 'email.failed': 'Failed to send', 'email.suppressed': 'Not sent: address is suppressed' };

export function SentLogPage() {
  const toast = useToast();
  const [f, setF] = useState({ status: '', type: '', workspace: '', from: '', to: '', q: '' });
  const dq = useDebounced(f.q);
  const [page, setPage] = useState(0);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [row, setRow] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const PER = 50;
  const params = useMemo(() => ({ ...f, q: dq || undefined, limit: PER, offset: page * PER }), [f.status, f.type, f.workspace, f.from, f.to, dq, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback((silent) => { if (!silent) setD(null); setErr(''); return api.get(`${M}/log`, params).then(setD).catch((e) => setErr(e.message)); }, [params]);
  useEffect(() => { load(); }, [load]);
  // delivery status arrives by webhook; keep the table current while it is open
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) load(true); }, 30_000); return () => clearInterval(t); }, [load]);
  const set = (k) => (v) => { setPage(0); setF((x) => ({ ...x, [k]: v })); };
  const open = async (r) => { try { setRow(await api.get(`${M}/log/${r.id}`)); } catch (e) { toast(e.message, 'err'); } };
  const sync = async () => { setSyncing(true); try { const r = await api.post(`${M}/log/sync`, {}); toast(r.added ? `${r.added} earlier e-mail${r.added === 1 ? '' : 's'} added` : 'Already up to date'); load(true); } catch (e) { toast(e.message, 'err'); } finally { setSyncing(false); } };
  return (
    <>
      <PageTitle title="Sent log" sub="Every e-mail the platform sent through Resend, with its delivery status. Codes and links are never stored here: only the subject and type.">
        <button className="btn" onClick={sync} disabled={syncing}><Icon name="refresh" size={14} /> {syncing ? 'Syncing…' : 'Import from Resend'}</button>
      </PageTitle>
      <Card>
        <div className="mb-filters">
          <select className="select" value={f.status} onChange={(e) => set('status')(e.target.value)} aria-label="Status"><option value="">Any status</option>{(d?.statuses || Object.keys(TONE)).map((s) => <option key={s} value={s}>{TONE[s]?.[1] || s}</option>)}</select>
          <select className="select" value={f.type} onChange={(e) => set('type')(e.target.value)} aria-label="Type"><option value="">Any type</option>{(d?.types || []).map((s) => <option key={s} value={s}>{TYPE_LABEL[s] || s}</option>)}</select>
          <select className="select" value={f.workspace} onChange={(e) => set('workspace')(e.target.value)} aria-label="Workspace"><option value="">Any workspace</option>{(d?.workspaces || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <input className="input" type="date" value={f.from} onChange={(e) => set('from')(e.target.value)} aria-label="From date" />
          <input className="input" type="date" value={f.to} onChange={(e) => set('to')(e.target.value)} aria-label="To date" />
          <input className="input" value={f.q} onChange={(e) => set('q')(e.target.value)} placeholder="Recipient or subject" aria-label="Search recipient or subject" />
        </div>
        <ErrorBox error={err} />
        {!d ? (!err && <Loading rows={6} />) : !d.rows.length ? <Empty icon="mail" title="No e-mails match" hint={Object.values(f).some(Boolean) ? 'Clear a filter to see more.' : 'E-mails the platform sends (confirmations, invitations, resets, notices) appear here.'} /> : (
          <div className="table-wrap"><table className="t mb-log"><thead><tr><th>Sent</th><th>To</th><th>Subject</th><th>Type</th><th>Workspace</th><th>Status</th></tr></thead><tbody>
            {d.rows.map((r) => <tr key={r.id} className="clickable" tabIndex={0} onClick={() => open(r)} onKeyDown={(e) => e.key === 'Enter' && open(r)}>
              <td className="nowrap muted">{when(r.created_at)}</td><td>{r.to}</td><td>{r.subject}</td><td>{TYPE_LABEL[r.type] || r.type}</td><td>{r.workspace_name || '—'}</td><td><StatusBadge status={TONE[r.status]?.[0] || 'inactive'} label={TONE[r.status]?.[1] || r.status} /></td></tr>)}
          </tbody></table></div>
        )}
        {d && d.total > PER && <div className="row mb-pager"><button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span className="muted">{page * PER + 1}–{Math.min(d.total, (page + 1) * PER)} of {d.total}</span><button className="btn sm" disabled={(page + 1) * PER >= d.total} onClick={() => setPage(page + 1)}>Next</button></div>}
      </Card>
      {row && (
        <Modal title="E-mail details" onClose={() => setRow(null)} footer={<button className="btn" onClick={() => setRow(null)}>Close</button>}>
          <dl className="mb-dl">
            <dt>Subject</dt><dd>{row.subject || '—'}</dd><dt>To</dt><dd>{row.to}</dd><dt>From</dt><dd>{row.from || '—'}</dd>
            <dt>Type</dt><dd>{TYPE_LABEL[row.type] || row.type}</dd><dt>Workspace</dt><dd>{row.workspace_name || '—'}</dd>
            <dt>Status</dt><dd><StatusBadge status={TONE[row.status]?.[0] || 'inactive'} label={TONE[row.status]?.[1] || row.status} /></dd>
          </dl>
          <h4 style={{ margin: '14px 0 6px' }}>Delivery events</h4>
          {row.events.length ? <ol className="mb-events">{row.events.map((e, i) => <li key={i}><b>{EVENT_LABEL[e.type] || e.type}</b><small className="muted">{when(e.at)}</small></li>)}</ol> : <p className="muted">No delivery events yet. They arrive from Resend by webhook, usually within seconds.</p>}
          {(row.status === 'bounced' || row.status === 'failed') && <p className="muted">The address did not accept the message. Check it for typing mistakes, or ask the person for another address.</p>}
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- settings
export function MailboxSettingsPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [names, setNames] = useState({});
  const [replyTo, setReplyTo] = useState('');
  const load = useCallback(() => api.get(`${M}/settings`).then((r) => { setD(r); setNames(Object.fromEntries(r.inboxes.map((i) => [i.id, i.from_name]))); setReplyTo(r.reply_to); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const saveName = async (i) => { try { await api.put(`${M}/settings/inboxes/${i.id}`, { from_name: names[i.id] }); toast('From name saved'); load(); } catch (e) { toast(e.message, 'err'); } };
  const saveReply = async () => { try { await api.put(`${M}/settings/reply-to`, { reply_to: replyTo }); toast('Reply-To saved'); load(); } catch (e) { toast(e.message, 'err'); } };
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Copy failed. Select the address and copy it.', 'err'); } };
  if (err) return <><PageTitle title="Mailbox settings" /><ErrorBox error={err} /></>;
  if (!d) return <><PageTitle title="Mailbox settings" /><Loading /></>;
  const wh = d.webhook;
  return (
    <>
      <PageTitle title="Mailbox settings" sub="Inboxes, who replies come from, and the webhook that keeps the inbox and the sent log live." />
      {!d.configured && <Empty icon="mail" title="Resend is not connected" hint="Save the API key in Integrations first." action={<Link className="btn primary" to="/platform/integrations">Open Integrations</Link>} />}
      {d.configured && <>
        <Card title="Inboxes and sending identities">
          <p className="muted" style={{ marginTop: 0 }}>You can send from hello@ and admin@. The no-reply address only sends automated mail and has no inbox.</p>
          <div className="table-wrap"><table className="t"><thead><tr><th>Address</th><th>From name</th><th>Sending</th><th /></tr></thead><tbody>
            {d.inboxes.map((i) => <tr key={i.id}><td className="mono">{i.email}</td>
              <td>{i.can_send ? <input className="input" value={names[i.id] ?? ''} maxLength={78} onChange={(e) => setNames({ ...names, [i.id]: e.target.value })} placeholder="e.g. Agentify ERP" aria-label={`From name for ${i.email}`} /> : <span className="muted">—</span>}</td>
              <td>{i.can_send ? <StatusBadge status="active" label="Allowed" /> : <StatusBadge status="inactive" label="Automated only" />}</td>
              <td>{i.can_send && <button className="btn sm" disabled={(names[i.id] ?? '') === i.from_name} onClick={() => saveName(i)}>Save</button>}</td></tr>)}
          </tbody></table></div>
          {!d.inboxes.length && <Empty icon="mail" title="No inboxes found" hint="Create hello@ and admin@ inboxes in Resend." />}
        </Card>
        <Card title="Reply-To for automated e-mails">
          <p className="muted" style={{ marginTop: 0 }}>Confirmations, invitations and notices are sent from {d.sender || 'the no-reply address'}. When someone replies, the reply goes to this address.</p>
          <Field label="Reply-To address" hint={d.reply_to_default ? `Leave blank to use ${d.reply_to_default}` : 'Leave blank for no Reply-To'}><TextInput type="email" value={replyTo} onChange={setReplyTo} placeholder={d.reply_to_default} /></Field>
          <button className="btn primary" onClick={saveReply} disabled={replyTo === d.reply_to}>Save</button>
        </Card>
        <Card title="Webhook" actions={<StatusBadge status={wh.secret_saved ? (wh.last_event_at ? 'active' : 'pending') : 'overdue'} label={wh.secret_saved ? (wh.last_event_at ? 'Receiving events' : 'Waiting for first event') : 'Signing secret missing'} />}>
          <p className="muted" style={{ marginTop: 0 }}>In Resend, add a webhook with this address and select the e-mail events (sent, delivered, bounced, complained, failed, received). Then paste its signing secret into Integrations, Transactional email.</p>
          <div className="mb-copy"><input className="input mono" readOnly value={wh.url} aria-label="Webhook address" onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => copy(wh.url)}>Copy</button></div>
          <p className="muted">{wh.last_event_at ? <>Last event {wh.last_event_type} at {when(wh.last_event_at)}.</> : 'No event received yet.'} {wh.last_mail_at && <>Last received mail {when(wh.last_mail_at)}.</>}</p>
          {!wh.secret_saved && <Link className="btn" to="/platform/integrations">Add the signing secret</Link>}
        </Card>
      </>}
    </>
  );
}
