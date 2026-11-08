import { useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, PageHead, Select } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast, useUndoDelete } from '../context.jsx';
import { date, todayPK } from '../format.js';
import ReportButton from '../components/ReportButton.jsx';
import ConnectedAccounts from '../components/ConnectedAccounts.jsx';

export const PLATFORM = {
  youtube: { label: 'YouTube', short: 'YT', color: '#ff0000', url: 'https://www.youtube.com/upload' },
  facebook: { label: 'Facebook', short: 'f', color: '#1877f2', url: 'https://business.facebook.com/latest/composer' },
  instagram: { label: 'Instagram', short: 'IG', color: '#d62976', url: 'https://www.instagram.com/' },
  tiktok: { label: 'TikTok', short: 'TT', color: '#111827', url: 'https://www.tiktok.com/upload' },
  snapchat: { label: 'Snapchat', short: 'SC', color: '#e6c800', url: 'https://web.snapchat.com/' },
  linkedin: { label: 'LinkedIn', short: 'in', color: '#0a66c2', url: 'https://www.linkedin.com/feed/' },
  x: { label: 'X (Twitter)', short: 'X', color: '#000000', url: 'https://x.com/compose/post' },
  pinterest: { label: 'Pinterest', short: 'P', color: '#e60023', url: 'https://www.pinterest.com/pin-creation-tool/' },
  whatsapp: { label: 'WhatsApp status', short: 'WA', color: '#25d366', url: 'https://web.whatsapp.com/' },
};
const TYPES = [['story', 'Story'], ['reel', 'Reel'], ['static', 'Static post'], ['carousel', 'Carousel'], ['video', 'Video'], ['live', 'Live']];
const STATUS = [['idea', 'Idea'], ['planned', 'Planned'], ['ready', 'Ready to post'], ['posted', 'Posted']];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (d) => (d ? DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()] : '');
const iso = (d) => d.toISOString().slice(0, 10);
const addD = (s, n) => iso(new Date(Date.parse(s) + n * 86400000));

export function PlatformDot({ id, done, onClick, size, title }) {
  const p = PLATFORM[id];
  const style = { background: p.color, ...(size ? { width: size, height: size } : null), ...(id === 'snapchat' ? { color: '#111' } : null) };
  const label = title || (done ? `${p.label} — posted` : p.label);
  return onClick ? <button type="button" className={`plat plat-btn ${done ? 'done' : ''}`} style={style} title={label} aria-label={label} onClick={onClick}>{done ? '✓' : p.short}</button>
    : <span className={`plat ${done ? 'done' : ''}`} style={style} title={label}>{done ? '✓' : p.short}</span>;
}

function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

/**
 * "Post" = hand the creative + caption to the platform. On a phone this opens the share sheet (pick Instagram, TikTok…
 * which are already logged in on the phone); on a computer the creative is downloaded, the caption copied and the platform opened.
 */
async function handOff(post, platform) {
  const caption = post.caption || '';
  try { await navigator.clipboard?.writeText(caption); } catch { /* clipboard may be blocked */ }
  let file = null;
  if (post.has_creative) {
    const r = await fetch(`/api/content/posts/${post.id}/creative`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Could not load the creative');
    const blob = await r.blob();
    file = new File([blob], post.creative_name || `creative-${post.id}`, { type: blob.type });
  }
  if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: caption, title: post.title }); return 'shared'; }
  if (!file && navigator.share) { await navigator.share({ text: caption, title: post.title }); return 'shared'; }
  if (file) saveBlob(file, file.name);
  window.open(PLATFORM[platform].url, '_blank', 'noopener');
  return 'opened';
}

function PostActions({ post, onChanged, compact }) {
  const toast = useToast();
  const [ask, setAsk] = useState(null);
  const go = async (pl) => {
    if (post.posted[pl]) { try { await api.post(`/api/content/posts/${post.id}/posted`, { platform: pl, posted: false }); onChanged(); } catch (e) { toast(e.message, 'err'); } return; }
    try {
      const how = await handOff(post, pl);
      toast(how === 'shared' ? 'Choose the app in the share sheet' : `Creative downloaded and caption copied — paste it into ${PLATFORM[pl].label}`, 'ok');
      setAsk(pl);
    } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); }
  };
  if (!post.platforms.length) return <span className="muted" style={{ fontSize: 12 }}>No platform chosen</span>;
  return (
    <>
      <span className="row" style={{ gap: 5, flexWrap: 'wrap' }}>{post.platforms.map((pl) => <PlatformDot key={pl} id={pl} done={!!post.posted[pl]} size={compact ? 22 : 28} onClick={() => go(pl)} title={post.posted[pl] ? `${PLATFORM[pl].label} — posted (click to undo)` : `Post to ${PLATFORM[pl].label}`} />)}</span>
      {ask && <ConfirmDialog title={`Posted to ${PLATFORM[ask].label}?`} message="Once you have published it there, mark it as posted so your team can see it’s done." confirmLabel="Yes, mark as posted"
        onCancel={() => setAsk(null)} onConfirm={async () => { try { await api.post(`/api/content/posts/${post.id}/posted`, { platform: ask, posted: true }); setAsk(null); onChanged(); } catch (e) { toast(e.message, 'err'); } }} />}
    </>
  );
}

function CreativeCell({ post, onChanged, canEdit }) {
  const toast = useToast();
  const ref = useRef(null);
  const up = async (file) => {
    if (!file) return;
    try { const fd = new FormData(); fd.append('creative', file); await api.upload(`/api/content/posts/${post.id}/creative`, fd); toast('Creative uploaded', 'ok'); onChanged(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="row" style={{ gap: 6 }}>
      {post.has_creative ? (
        <a href={`/api/content/posts/${post.id}/creative?download=1`} title={`Download ${post.creative_name}`} style={{ display: 'block', width: 44, height: 44, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--border)', background: '#0f172a', position: 'relative' }}>
          {post.creative_kind === 'image' ? <img src={`/api/content/posts/${post.id}/creative`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#fff', display: 'grid', placeItems: 'center', height: '100%' }}>▶</span>}
        </a>) : null}
      {canEdit && <><button type="button" className="btn sm" onClick={() => ref.current?.click()}><Icon name="upload" size={13} />{post.has_creative ? 'Replace' : 'Add'}</button><input ref={ref} type="file" hidden accept="image/*,video/*" onChange={(e) => up(e.target.files?.[0])} /></>}
    </div>
  );
}

// ------------------------------------------------------------------ approval stages (workspaces with posting switched on)
export const STAGE = {
  draft: ['Draft', '#64748b'], pending_approval: ['Waiting approval', '#d97706'], approved: ['Approved', '#2563eb'],
  scheduled: ['Scheduled', 'var(--primary)'], posted: ['Posted', '#16a34a'], failed: ['Failed', '#dc2626'],
};
export function StagePill({ stage }) {
  const [label, color] = STAGE[stage] || STAGE.draft;
  return <span className="pill" style={{ background: 'transparent', border: `1px solid ${color}`, color }}>{label}</span>;
}
/** Submit / Approve / Send back / Retry for one post, with who approved it. Shown only where posting is switched on. */
function Approval({ post, posting, canApprove, onChanged }) {
  const toast = useToast(); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  if (!posting?.enabled || !post?.id) return null;
  const go = async (what, body) => { setBusy(true); try { await api.post(`/api/content/posts/${post.id}/${what}`, body || {}); onChanged(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const st = post.stage || 'draft';
  return (
    <Field label="Approval and posting">
      <div className="stack" style={{ gap: 8 }} data-tour="content-approval">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <StagePill stage={st} />
          {post.approver && ['approved', 'scheduled', 'posted'].includes(st) && <span className="muted" style={{ fontSize: 12 }}>Approved by {post.approver}{post.approved_at ? ` on ${post.approved_at.slice(0, 16).replace('T', ' ')}` : ''}</span>}
        </div>
        {post.reject_note && st === 'draft' && <div className="alert info" style={{ margin: 0 }}>Sent back: {post.reject_note}</div>}
        {post.blocked_reason && st === 'scheduled' && <div className="alert info" style={{ margin: 0 }}>{post.blocked_reason}</div>}
        {st === 'failed' && <div className="alert error" style={{ margin: 0 }}>{post.fail_reason || 'This post could not be published.'}</div>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {['draft'].includes(st) && <button className="btn sm primary" disabled={busy} onClick={() => go('submit')}>Send for approval</button>}
          {st === 'draft' && canApprove && <button className="btn sm" disabled={busy} onClick={() => go('approve')}>Approve now</button>}
          {st === 'pending_approval' && canApprove && <><button className="btn sm primary" disabled={busy} onClick={() => go('approve')}>Approve</button><input className="input" style={{ maxWidth: 220 }} placeholder="Reason for sending back (optional)" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn sm" disabled={busy} onClick={() => go('reject', { note })}>Send back</button></>}
          {st === 'pending_approval' && !canApprove && <span className="muted" style={{ fontSize: 12 }}>Waiting for someone with approval rights.</span>}
          {['approved', 'scheduled'].includes(st) && canApprove && <button className="btn sm" disabled={busy} onClick={() => go('reject', { note: '' })}>Take back to draft</button>}
          {st === 'failed' && <button className="btn sm primary" disabled={busy} onClick={() => go('retry')}>Retry</button>}
        </div>
        {st === 'approved' && <div className="muted" style={{ fontSize: 12 }}>Approved. Choose at least one connected account and a posting time to schedule it.</div>}
      </div>
    </Field>
  );
}

// ------------------------------------------------------------------ editor
function PostEditor({ initial, users, canManage, posting, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ post_type: 'static', status: 'planned', platforms: [], ...initial });
  const [post, setPost] = useState(initial.id ? initial : null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const { remove: removePost } = useUndoDelete('content');
  const fileRef = useRef(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (pl) => set('platforms', f.platforms.includes(pl) ? f.platforms.filter((x) => x !== pl) : [...f.platforms, pl]);
  const save = async (stay) => {
    if (!f.title?.trim()) return toast('Give the post a title', 'err');
    if (!f.post_date) return toast('Choose the posting date', 'err');
    setBusy(true);
    try {
      const body = { title: f.title, post_type: f.post_type, caption: f.caption || '', platforms: f.platforms, post_date: f.post_date, post_time: f.post_time || '', status: f.status, assigned_to: f.assigned_to || null, notes: f.notes || '', ...(posting?.enabled ? { account_ids: f.account_ids || [] } : {}) };
      const saved = post?.id ? await api.put(`/api/content/posts/${post.id}`, body) : await api.post('/api/content/posts', body);
      setPost(saved); setF((x) => ({ ...x, ...saved }));
      toast('Saved', 'ok'); onSaved(!stay);
      return saved;
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const upload = async (file) => {
    if (!file) return;
    let p = post;
    if (!p?.id) p = await save(true);
    if (!p?.id) return;
    try { const fd = new FormData(); fd.append('creative', file); const r = await api.upload(`/api/content/posts/${p.id}/creative`, fd); setPost(r); setF((x) => ({ ...x, ...r })); onSaved(false); toast('Creative uploaded', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  const refresh = async () => { if (!post?.id) return; const r = await api.get('/api/content/posts', { from: post.post_date, to: post.post_date }); const me = r.find((x) => x.id === post.id); if (me) { setPost(me); setF((x) => ({ ...x, ...me })); } onSaved(false); };
  return (
    <Modal title={post?.id ? 'Edit post' : 'Plan a post'} size="lg" onClose={onClose}
      footer={<>{post?.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setDel(true)}>Delete</button>}<button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save post'}</button></>}>
      <div className="stack">
        <Field label="Title" required><input className="input" autoFocus value={f.title || ''} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Expert City — plots now open" /></Field>
        <Field label="Post type"><div className="row wrap" style={{ gap: 6 }}>{TYPES.map(([k, l]) => <button key={k} type="button" className={`btn sm ${f.post_type === k ? 'primary' : ''}`} onClick={() => set('post_type', k)}>{l}</button>)}</div></Field>
        <Field label={`Caption (${(f.caption || '').length} characters)`}><textarea className="textarea" rows={4} value={f.caption || ''} onChange={(e) => set('caption', e.target.value)} placeholder="Write the caption with #hashtags and @mentions" /></Field>
        <Field label="Platforms — tap to select"><div className="row wrap" style={{ gap: 8 }}>{Object.entries(PLATFORM).map(([k, p]) => (
          <button key={k} type="button" onClick={() => toggle(k)} className="row" style={{ gap: 6, padding: '4px 10px 4px 4px', borderRadius: 20, cursor: 'pointer', border: `2px solid ${f.platforms.includes(k) ? p.color : 'var(--border)'}`, background: f.platforms.includes(k) ? p.color + '14' : '#fff' }}><PlatformDot id={k} size={22} /><span style={{ fontSize: 12.5 }}>{p.label}</span></button>))}</div></Field>
        <div className="form-grid">
          <Field label="Posting date" required><input type="date" className="input" value={f.post_date || ''} onChange={(e) => set('post_date', e.target.value)} /></Field>
          <Field label="Posting time"><input type="time" className="input" value={f.post_time || ''} onChange={(e) => set('post_time', e.target.value)} /></Field>
          <Field label="Day"><input className="input" readOnly value={dayName(f.post_date)} /></Field>
          {!posting?.enabled && <Field label="Status"><Select allowEmpty={false} value={f.status} onChange={(v) => set('status', v)} options={STATUS.map(([v, l]) => ({ value: v, label: l }))} /></Field>}
          <Field label="Assigned to"><Select value={f.assigned_to || ''} onChange={(v) => set('assigned_to', v ? Number(v) : null)} placeholder="Me" options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
          <Field label="Notes"><input className="input" value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        {posting?.enabled && (
          <Field label="Post to these connected accounts" hint={posting.accounts.length ? 'The post goes out by itself at the date and time above, after it is approved.' : 'No account is connected yet. Open Connected accounts on the calendar page to connect Facebook or Instagram.'}>
            <div className="row wrap" style={{ gap: 8 }} data-tour="content-accounts">{posting.accounts.map((a) => {
              const on = (f.account_ids || []).includes(a.account_id);
              return <button key={a.account_id} type="button" aria-pressed={on} className={`btn sm ${on ? 'primary' : ''}`} onClick={() => set('account_ids', on ? f.account_ids.filter((x) => x !== a.account_id) : [...(f.account_ids || []), a.account_id])}>{PLATFORM[a.platform]?.label || a.platform}: {a.username ? `@${a.username}` : a.name}</button>;
            })}</div>
          </Field>)}
        <Field label="Creative (image or video)">
          {post?.has_creative ? (
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 160, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#0f172a' }}>
                {post.creative_kind === 'image' ? <img src={`/api/content/posts/${post.id}/creative?t=${post.updated_at}`} alt="" style={{ width: '100%', display: 'block' }} /> : <video src={`/api/content/posts/${post.id}/creative`} controls style={{ width: '100%' }} />}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <div className="muted" style={{ fontSize: 13 }}>{post.creative_name}</div>
                <a className="btn sm" href={`/api/content/posts/${post.id}/creative?download=1`}><Icon name="download" size={13} />Download</a>
                <button className="btn sm" onClick={() => fileRef.current?.click()}>Replace</button>
                <button className="btn sm ghost danger" onClick={async () => { await api.del(`/api/content/posts/${post.id}/creative`); refresh(); }}>Remove</button>
              </div>
            </div>
          ) : <div className="drop" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}><Icon name="upload" size={18} /><div>Drop the creative here or click to choose</div><div style={{ fontSize: 12 }}>JPG, PNG, WebP, MP4, MOV — up to 200 MB</div></div>}
          <input ref={fileRef} type="file" hidden accept="image/*,video/*" onChange={(e) => upload(e.target.files?.[0])} />
        </Field>
        {post?.id && post.source === 'ai' && <div className="row" style={{ gap: 8, alignItems: 'center' }}><span className="muted" style={{ fontSize: 12 }}>Written by AI.</span><ReportButton feature="content_draft" prompt={post.title} output={String(post.body || '').slice(0, 1500)} /></div>}
        <Approval post={post} posting={posting} canApprove={canManage} onChanged={refresh} />
        {post?.id && !(posting?.enabled && (post.account_ids || []).length) && (
          <Field label="Publish">
            <div className="stack" style={{ gap: 6 }}>
              <PostActions post={post} onChanged={refresh} />
              <div className="muted" style={{ fontSize: 12 }}>Tap a platform icon: on your phone the share sheet opens with the creative and caption ready; on a computer the creative downloads, the caption is copied and the platform opens. Then confirm to tick it off. Tap a ticked icon to undo.</div>
            </div>
          </Field>)}
      </div>
      {del && <ConfirmDialog danger title="Delete post" message={`Delete “${post.title}”?`} confirmLabel="Delete" onCancel={() => setDel(false)} onConfirm={async () => { setDel(false); removePost(post.id, `“${post.title}” deleted`, () => api.del(`/api/content/posts/${post.id}`), { onDone: () => onSaved(true) }); onSaved(true); }} />}
    </Modal>
  );
}

// ------------------------------------------------------------------ platforms / API credentials
function AccountsModal({ onClose }) {
  const toast = useToast();
  const { data, reload } = useFetch('/api/content/accounts');
  const [edit, setEdit] = useState(null);
  const [f, setF] = useState({});
  const open = (a) => { setEdit(a); setF({ handle: a.handle || '', profile_url: a.profile_url || '', client_id: a.client_id || '', client_secret: '', access_token: '' }); };
  const save = async () => {
    try {
      const body = { handle: f.handle, profile_url: f.profile_url, client_id: f.client_id, client_secret: f.client_secret || '__keep__', access_token: f.access_token || '__keep__' };
      await api.put(`/api/content/accounts/${edit.platform}`, body); toast('Saved', 'ok'); setEdit(null); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Social accounts & API keys" size="lg" onClose={onClose}>
      <div className="stack">
        <div className="alert info">Staff post through each platform’s own app/website, so the logins stay on the phone or computer. API keys are optional — they are stored write-only (never shown again) for integrations. Fully automatic publishing needs each platform’s developer app to be created and approved by you (Meta, Google, TikTok, LinkedIn…); the app can then use these keys.</div>
        {!data ? <Loading /> : data.map((a) => (
          <div key={a.platform} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', gap: 10 }}>
            <PlatformDot id={a.platform} size={30} />
            <div className="grow"><b>{PLATFORM[a.platform].label}</b><div className="cell-sub">{a.handle || 'No handle set'}{a.connected ? ' · API token saved' : ''}</div></div>
            <button className="btn sm" onClick={() => open(a)}>{a.handle || a.connected ? 'Edit' : 'Set up'}</button>
          </div>))}
      </div>
      {edit && (
        <Modal title={`${PLATFORM[edit.platform].label} account`} size="sm" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          <div className="stack">
            <Field label="Handle / page name"><input className="input" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} placeholder="@expertdevelopers" /></Field>
            <Field label="Profile link"><input className="input" value={f.profile_url} onChange={(e) => setF({ ...f, profile_url: e.target.value })} placeholder="https://…" /></Field>
            <Field label="API client ID / app ID"><input className="input" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })} /></Field>
            <Field label={`API client secret${edit.client_secret_set ? ' (saved — leave blank to keep)' : ''}`}><input className="input" type="password" autoComplete="new-password" value={f.client_secret} onChange={(e) => setF({ ...f, client_secret: e.target.value })} /></Field>
            <Field label={`Access token${edit.connected ? ` (saved ${edit.access_token_hint} — leave blank to keep)` : ''}`}><input className="input" type="password" autoComplete="new-password" value={f.access_token} onChange={(e) => setF({ ...f, access_token: e.target.value })} /></Field>
          </div>
        </Modal>)}
    </Modal>
  );
}

// ------------------------------------------------------------------ page
export default function Content() {
  const { can, user } = useAuth();
  const toast = useToast();
  const [view, setView] = useState('calendar');
  const [cursor, setCursor] = useState(todayPK().slice(0, 7));
  const [filters, setFilters] = useState({ platform: '', post_type: '', status: '', stage: '', assigned_to: '', q: '' });
  const [edit, setEdit] = useState(null);
  const [accounts, setAccounts] = useState(false);
  const meta = useFetch('/api/content/meta');
  const posting = meta.data?.posting; const staged = !!posting?.enabled;
  const [weekStart, setWeekStart] = useState(() => { const t = todayPK(); return addD(t, -new Date(`${t}T00:00:00Z`).getUTCDay()); });
  const [connect, setConnect] = useState(() => { try { return new URLSearchParams(window.location.search).get('connected') === '1'; } catch { return false; } });
  const [dragId, setDragId] = useState(null);
  const first = `${cursor}-01`;
  const gridStart = addD(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
  const lastOfMonth = iso(new Date(Date.UTC(Number(cursor.slice(0, 4)), Number(cursor.slice(5)), 0)));
  const gridEnd = addD(lastOfMonth, 6 - new Date(`${lastOfMonth}T00:00:00Z`).getUTCDay());
  const params = { from: view === 'week' ? weekStart : view === 'calendar' ? gridStart : first, to: view === 'week' ? addD(weekStart, 6) : view === 'calendar' ? gridEnd : lastOfMonth, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
  const { data, reload, setData } = useFetch('/api/content/posts', params, [view, weekStart]);
  const users = meta.data?.users || [];
  const posts = data || [];
  const { hidden: hiddenPosts } = useUndoDelete('content');
  const byDay = useMemo(() => { const m = {}; posts.filter((p) => !hiddenPosts.has(p.id)).forEach((p) => { (m[p.post_date] ||= []).push(p); }); return m; }, [posts]);
  const shift = (n) => { const d = new Date(`${cursor}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setCursor(iso(d).slice(0, 7)); };
  const monthLabel = new Date(`${cursor}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const patch = async (p, body) => {
    try { const r = await api.put(`/api/content/posts/${p.id}`, body); setData((data || []).map((x) => (x.id === p.id ? r : x))); } catch (e) { toast(e.message, 'err'); reload(); }
  };
  const stats = { total: posts.length, posted: posts.filter((p) => p.status === 'posted').length, ready: staged ? posts.filter((p) => p.stage === 'pending_approval').length : posts.filter((p) => p.status === 'ready').length, today: (byDay[todayPK()] || []).length };
  const canEditPost = (p) => can('content', 'approve') || p.created_by === user.id || p.assigned_to === user.id;
  const newPost = (d) => setEdit({ post_date: d || todayPK(), post_time: '18:00' });
  return (
    <div>
      <PageHead title="Content calendar" sub="Plan daily social-media content — type, caption, platforms, date and time, with the creative attached and ready to post">
        {posting?.listed && <button className="btn" onClick={() => setConnect(true)} data-tour="content-connect">Connected accounts</button>}
        {can('content', 'approve') && <button className="btn" onClick={() => setAccounts(true)}>Platforms & API keys</button>}
        {can('content', 'create') && <button className="btn primary" onClick={() => newPost()}><Icon name="plus" size={14} />New post</button>}
      </PageHead>
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Card className="stat"><div className="label">This month</div><div className="value">{stats.total}</div><div className="sub-v">posts planned</div></Card>
        <Card className="stat"><div className="label">Posted</div><div className="value" style={{ color: '#16a34a' }}>{stats.posted}</div><div className="cnt-bar" style={{ marginTop: 6 }}><i style={{ width: `${stats.total ? (stats.posted / stats.total) * 100 : 0}%`, background: '#16a34a' }} /></div></Card>
        <Card className="stat"><div className="label">{staged ? 'Waiting approval' : 'Ready to post'}</div><div className="value">{stats.ready}</div></Card>
        <Card className="stat"><div className="label">Today</div><div className="value">{stats.today}</div></Card>
      </div>
      <Card flush>
        <div className="row between wrap" style={{ padding: 10, gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => (view === 'week' ? setWeekStart(addD(weekStart, -7)) : shift(-1))} aria-label={view === 'week' ? 'Previous week' : 'Previous month'}><Icon name="chevL" size={14} /></button>
            <b style={{ minWidth: 130, textAlign: 'center' }}>{view === 'week' ? `${date(weekStart)} – ${date(addD(weekStart, 6))}` : monthLabel}</b>
            <button className="btn sm" onClick={() => (view === 'week' ? setWeekStart(addD(weekStart, 7)) : shift(1))} aria-label={view === 'week' ? 'Next week' : 'Next month'}><Icon name="chevR" size={14} /></button>
            <button className="btn sm" onClick={() => { setCursor(todayPK().slice(0, 7)); const t = todayPK(); setWeekStart(addD(t, -new Date(`${t}T00:00:00Z`).getUTCDay())); }}>Today</button>
          </div>
          <div className="seg-btns">{[['calendar', 'Month'], ['week', 'Week'], ['sheet', 'Sheet']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} style={view === k ? { background: 'var(--primary)' } : undefined} onClick={() => setView(k)}>{l}</button>)}</div>
        </div>
        <div className="row wrap" style={{ padding: '0 10px 10px', gap: 8 }}>
          <input className="input" style={{ maxWidth: 200 }} placeholder="Search…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && reload()} onBlur={reload} />
          <div style={{ width: 140 }}><Select value={filters.platform} onChange={(v) => { setFilters({ ...filters, platform: v }); setTimeout(reload, 0); }} placeholder="All platforms" options={Object.entries(PLATFORM).map(([v, p]) => ({ value: v, label: p.label }))} /></div>
          <div style={{ width: 130 }}><Select value={filters.post_type} onChange={(v) => { setFilters({ ...filters, post_type: v }); setTimeout(reload, 0); }} placeholder="All types" options={TYPES.map(([v, l]) => ({ value: v, label: l }))} /></div>
          {staged
            ? <div style={{ width: 170 }}><Select value={filters.stage} onChange={(v) => { setFilters({ ...filters, stage: v }); setTimeout(reload, 0); }} placeholder="All stages" options={Object.entries(STAGE).map(([v, [l]]) => ({ value: v, label: l }))} /></div>
            : <div style={{ width: 140 }}><Select value={filters.status} onChange={(v) => { setFilters({ ...filters, status: v }); setTimeout(reload, 0); }} placeholder="All statuses" options={STATUS.map(([v, l]) => ({ value: v, label: l }))} /></div>}
          <div style={{ width: 150 }}><Select value={filters.assigned_to} onChange={(v) => { setFilters({ ...filters, assigned_to: v }); setTimeout(reload, 0); }} placeholder="Everyone" options={users.map((u) => ({ value: u.id, label: u.name }))} /></div>
        </div>
        {!data ? <Loading /> : view === 'calendar' || view === 'week' ? (
          <div style={{ padding: '0 10px 10px' }}>
            <div className="cal-grid" data-tour="content-calendar">
              {DAYS.map((d) => <div key={d} className="dow">{d.slice(0, 3)}</div>)}
              {(view === 'week' ? Array.from({ length: 7 }, (_, i) => addD(weekStart, i)) : Array.from({ length: Math.round((Date.parse(gridEnd) - Date.parse(gridStart)) / 86400000) + 1 }, (_, i) => addD(gridStart, i))).map((d) => (
                <div key={d} className={`cal-cell ${view !== 'week' && d.slice(0, 7) !== cursor ? 'other' : ''} ${d === todayPK() ? 'today' : ''}`} style={view === 'week' ? { minHeight: 220 } : undefined}
                  onClick={() => can('content', 'create') && newPost(d)}
                  onDragOver={(e) => { if (dragId) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); const p = posts.find((x) => x.id === dragId); setDragId(null); if (p && p.post_date !== d) patch(p, { post_date: d }); }}>
                  <div className="dn"><span>{Number(d.slice(8))}</span>{(byDay[d] || []).length > 0 && <span className="tag">{byDay[d].length}</span>}</div>
                  {(byDay[d] || []).slice(0, view === 'week' ? 50 : 3).map((p) => (
                    <div key={p.id} className={`cal-chip ${p.post_type} ${p.status === 'posted' ? 'posted' : ''}`} onClick={(e) => { e.stopPropagation(); setEdit(p); }}
                      draggable={canEditPost(p) && p.stage !== 'posted'} onDragStart={(e) => { setDragId(p.id); e.dataTransfer.setData('text/plain', String(p.id)); }} onDragEnd={() => setDragId(null)}
                      style={staged ? { borderInlineStart: `3px solid ${(STAGE[p.stage] || STAGE.draft)[1]}` } : undefined}
                      title={`${p.title}${p.post_time ? ` · ${p.post_time}` : ''}${staged ? ` · ${(STAGE[p.stage] || STAGE.draft)[0]}` : ''}`}>
                      <span className="row" style={{ gap: 2, flexShrink: 0 }}>{p.platforms.slice(0, 3).map((pl) => <i key={pl} style={{ width: 7, height: 7, borderRadius: '50%', background: PLATFORM[pl].color, display: 'inline-block' }} />)}</span><span className="t">{p.post_time ? `${p.post_time} ` : ''}{p.title}</span>
                    </div>))}
                  {view !== 'week' && (byDay[d] || []).length > 3 && <div className="muted" style={{ fontSize: 11 }}>+{byDay[d].length - 3} more</div>}
                </div>))}
            </div>
          </div>
        ) : !posts.length ? <Empty>No posts this month. Click “New post” to plan one.</Empty> : (
          <div className="table-wrap" style={{ maxHeight: '70vh' }}>
            <table className="sheet">
              <thead><tr><th>Date</th><th>Day</th><th>Time</th><th>Type</th><th style={{ minWidth: 160 }}>Title</th><th style={{ minWidth: 240 }}>Caption</th><th>Platforms</th><th>Creative</th><th>Status</th><th>Owner</th><th /></tr></thead>
              <tbody>{posts.filter((p) => !hiddenPosts.has(p.id)).map((p) => {
                const ed = canEditPost(p);
                return (
                  <tr key={p.id}>
                    <td style={{ minWidth: 130 }}><input type="date" defaultValue={p.post_date} disabled={!ed} onBlur={(e) => e.target.value && e.target.value !== p.post_date && patch(p, { post_date: e.target.value })} /></td>
                    <td className="muted nowrap">{p.day.slice(0, 3)}</td>
                    <td style={{ minWidth: 92 }}><input type="time" defaultValue={p.post_time || ''} disabled={!ed} onBlur={(e) => e.target.value !== (p.post_time || '') && patch(p, { post_time: e.target.value })} /></td>
                    <td style={{ minWidth: 104 }}><select value={p.post_type} disabled={!ed} onChange={(e) => patch(p, { post_type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td><input defaultValue={p.title} disabled={!ed} onBlur={(e) => e.target.value.trim() && e.target.value !== p.title && patch(p, { title: e.target.value })} /></td>
                    <td><textarea rows={2} defaultValue={p.caption || ''} disabled={!ed} onBlur={(e) => e.target.value !== (p.caption || '') && patch(p, { caption: e.target.value })} placeholder="Caption…" /></td>
                    <td><div className="row" style={{ gap: 4, flexWrap: 'wrap', maxWidth: 150 }}>
                      {Object.keys(PLATFORM).map((pl) => (p.platforms.includes(pl) ? <PlatformDot key={pl} id={pl} size={22} done={!!p.posted[pl]} onClick={ed ? () => patch(p, { platforms: p.platforms.filter((x) => x !== pl) }) : undefined} title={`${PLATFORM[pl].label} — click to remove`} /> : null))}
                      {ed && <select style={{ width: 26, padding: 0, minHeight: 22, fontSize: 14 }} value="" aria-label="Add platform" onChange={(e) => e.target.value && patch(p, { platforms: [...p.platforms, e.target.value] })}><option value="">＋</option>{Object.entries(PLATFORM).filter(([k]) => !p.platforms.includes(k)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>}</div></td>
                    <td><CreativeCell post={p} canEdit={ed} onChanged={reload} /></td>
                    <td style={{ minWidth: 118 }}>{staged ? <StagePill stage={p.stage} /> : <select value={p.status} disabled={!ed} onChange={(e) => patch(p, { status: e.target.value })}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</td>
                    <td className="nowrap muted" style={{ fontSize: 12 }}>{p.assignee || '—'}</td>
                    <td className="right nowrap"><PostActions post={p} onChanged={reload} compact /> <button className="btn sm ghost" onClick={() => setEdit(p)} aria-label="Open">⋯</button></td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <PostEditor key={edit.id || 'new'} initial={edit} users={users} posting={posting} canManage={can('content', 'approve')} onClose={() => setEdit(null)} onSaved={(close) => { reload(); if (close) setEdit(null); }} />}
      {accounts && <AccountsModal onClose={() => setAccounts(false)} />}
      {connect && <ConnectedAccounts posting={posting} canManage={can('content', 'approve')} onClose={() => setConnect(false)} onChanged={meta.reload} />}
    </div>
  );
}
