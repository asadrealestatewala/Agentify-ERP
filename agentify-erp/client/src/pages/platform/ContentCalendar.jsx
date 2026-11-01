// Content calendar: Agentify's own marketing posts. Planned, scheduled and posted items, the posting limits and the next
// time a post can go out. A Social Media Manager works only on this page. Nothing here posts to a network by itself:
// the manager publishes on the channel and records it ("Mark as posted"), or approves a scheduled post for auto-posting to a
// connected Facebook / Instagram / LinkedIn / TikTok account (off until a Super Admin switches it on).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, ErrorBox, Field, Loading, Modal, Select, Tabs, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';

const TONE = { draft: 'grey', scheduled: 'blue', posted: 'green', canceled: 'grey' };
const when = (p) => (p.status === 'posted' ? p.posted_at : p.scheduled_at);
const fmt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const toIso = (v) => (v ? new Date(v).toISOString() : null);

function PostForm({ data, post, startAt, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({ title: post?.title || '', body: post?.body || '', channel: post?.channel || 'facebook', media_url: post?.media_url || '', link: post?.link || '', notes: post?.notes || '', at: toInput(post?.scheduled_at || startAt) });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const save = async (schedule) => {
    setBusy(true); setErr('');
    try {
      const body = { title: f.title, body: f.body, channel: f.channel, media_url: f.media_url, link: f.link, notes: f.notes };
      let saved = post ? await api.put(`${A}/content/posts/${post.id}`, body) : await api.post(`${A}/content/posts`, body);
      if (schedule) {
        if (!f.at) throw new Error('Choose a date and time to schedule');
        saved = await api.post(`${A}/content/posts/${saved.id}/schedule`, { scheduled_at: toIso(f.at) });
      }
      toast(schedule ? 'Scheduled' : 'Saved as draft'); onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const nextFor = data.next_slot[f.channel];
  return (
    <Modal title={post ? 'Edit post' : 'New post'} onClose={onCancel} footer={<>
      <button className="btn" onClick={onCancel}>Cancel</button>
      <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
      <button className="btn primary" disabled={busy} onClick={() => save(true)}>{post?.status === 'scheduled' ? 'Reschedule' : 'Schedule'}</button>
    </>}>
      <ErrorBox error={err} />
      <Field label="Title" hint="For the team. Not posted."><TextInput value={f.title} onChange={set('title')} maxLength={140} /></Field>
      <Field label="Channel"><Select allowEmpty={false} value={f.channel} onChange={set('channel')} options={Object.entries(data.channels).map(([v, label]) => ({ value: v, label }))} /></Field>
      <Field label="Post text"><textarea className="textarea" rows={5} value={f.body} onChange={(e) => set('body')(e.target.value)} maxLength={3000} /></Field>
      <Field label="Image or video address (optional)"><TextInput value={f.media_url} onChange={set('media_url')} placeholder="https://" /></Field>
      <Field label="Link in the post (optional)"><TextInput value={f.link} onChange={set('link')} placeholder="https://" /></Field>
      <Field label="Schedule for" hint={nextFor ? `Next free time on this channel: ${fmt(nextFor)}` : 'No free time in the next 14 days with the current limits'}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" type="datetime-local" aria-label="Schedule for" value={f.at} onChange={(e) => set('at')(e.target.value)} />
          {nextFor && <button type="button" className="btn sm" onClick={() => set('at')(toInput(nextFor))}>Use next free time</button>}
        </div>
      </Field>
      <Field label="Notes (optional)"><textarea className="textarea" rows={2} value={f.notes} onChange={(e) => set('notes')(e.target.value)} maxLength={1000} /></Field>
    </Modal>
  );
}

function AiDraftForm({ data, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({ channel: 'facebook', topic: '', tone: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => { setBusy(true); setErr(''); try { await api.post(`${A}/content/ai-draft`, f); toast('Draft added. Review it before scheduling.'); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Modal title="Draft a post with AI" onClose={onCancel} footer={<><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Writing…' : 'Write draft'}</button></>}>
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>The AI writes only from your brief and never invents numbers, customers or claims. Always read and edit the draft before it goes out. {data.ai.drafts_left_today} AI drafts left today.</p>
      <Field label="Channel"><Select allowEmpty={false} value={f.channel} onChange={(v) => setF({ ...f, channel: v })} options={Object.entries(data.channels).map(([v, label]) => ({ value: v, label }))} /></Field>
      <Field label="What should the post say?" hint="Give the real facts: the feature, the audience, the call to action"><textarea className="textarea" rows={4} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} maxLength={1500} /></Field>
      <Field label="Tone (optional)"><TextInput value={f.tone} onChange={(v) => setF({ ...f, tone: v })} placeholder="Friendly, professional…" /></Field>
    </Modal>
  );
}

function PostedForm({ post, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({ post_url: '', at: toInput(new Date().toISOString()) });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { const out = await api.post(`${A}/content/posts/${post.id}/posted`, { post_url: f.post_url, posted_at: toIso(f.at) }); toast(out.warnings?.length ? `Recorded. Note: ${out.warnings.join('. ')}` : 'Recorded as posted'); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Mark as posted" onClose={onCancel} footer={<><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy} onClick={go}>Record as posted</button></>}>
      <ErrorBox error={err} />
      <p className="muted">Use this after you published “{post.title}” on the channel. It counts toward today's limits.</p>
      <Field label="Address of the live post (optional)"><TextInput value={f.post_url} onChange={(v) => setF({ ...f, post_url: v })} placeholder="https://" /></Field>
      <Field label="Posted at"><input className="input" type="datetime-local" aria-label="Posted at" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
    </Modal>
  );
}

function LimitsCard({ data, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ ...data.limits }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => { setBusy(true); setErr(''); try { await api.put(`${A}/content/limits`, f); toast('Limits saved'); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const num = (k) => (v) => setF({ ...f, [k]: v === '' ? '' : Number(v) });
  return (
    <Card title="Posting limits">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>These starting values are placeholders. Set them to what each network and your team can handle; scheduling is refused when a limit would be broken.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12 }}>
        <Field label="Posts per day (all channels)"><input className="input" type="number" min={1} value={f.per_day} onChange={(e) => num('per_day')(e.target.value)} /></Field>
        <Field label="Posts per channel per day"><input className="input" type="number" min={1} value={f.per_channel_per_day} onChange={(e) => num('per_channel_per_day')(e.target.value)} /></Field>
        <Field label="Minutes between posts on a channel"><input className="input" type="number" min={0} value={f.min_gap_minutes} onChange={(e) => num('min_gap_minutes')(e.target.value)} /></Field>
        <Field label="Posting hours start"><input className="input" type="time" value={f.window_start} onChange={(e) => setF({ ...f, window_start: e.target.value })} /></Field>
        <Field label="Posting hours end"><input className="input" type="time" value={f.window_end} onChange={(e) => setF({ ...f, window_end: e.target.value })} /></Field>
        <Field label="Time zone for the limits" hint="For example UTC or Europe/London"><TextInput value={f.timezone} onChange={(v) => setF({ ...f, timezone: v })} /></Field>
      </div>
      <button className="btn primary" disabled={busy} onClick={save}>Save limits</button>
    </Card>
  );
}

function Month({ posts, month, setMonth, onDay, onOpen }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // week starts on Monday
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => (i < lead || i >= lead + days ? null : new Date(month.getFullYear(), month.getMonth(), i - lead + 1)));
  const byDay = useMemo(() => { const m = {}; for (const p of posts) { if (p.status === 'canceled' || !when(p)) continue; (m[dayKey(new Date(when(p)))] ||= []).push(p); } return m; }, [posts]);
  const today = dayKey(new Date());
  return (
    <Card title={month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} actions={<div className="row" style={{ gap: 6 }}>
      <button className="btn sm" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
      <button className="btn sm" onClick={() => setMonth(new Date())}>Today</button>
      <button className="btn sm" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>}>
      <div className="cc-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cc-dow">{d}</div>)}
        {cells.map((d, i) => d ? (
          <div key={i} className={`cc-day${dayKey(d) === today ? ' today' : ''}`}>
            <button className="cc-num" onClick={() => onDay(d)} aria-label={`Add a post on ${d.toDateString()}`}>{d.getDate()}</button>
            {(byDay[dayKey(d)] || []).map((p) => <button key={p.id} className={`cc-chip ${p.status}`} onClick={() => onOpen(p)} title={`${p.title} · ${p.status}`}>{p.title}</button>)}
          </div>) : <div key={i} className="cc-day empty" />)}
      </div>
    </Card>
  );
}

function PostList({ rows, empty, onEdit, onPosted, act, auto, approve }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return rows.map((p) => {
    const late = p.status === 'scheduled' && new Date(p.scheduled_at) < new Date();
    return (
      <div key={p.id} className="cc-row">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{p.title} <span className={`pill ${TONE[p.status]}`}>{p.status}</span>{late && <> <span className="pill red">Overdue</span></>}{p.source === 'ai' && <> <span className="pill purple">AI draft</span></>}{p.auto_post ? <> <span className="pill green" title={`Approved by ${p.auto_by || 'a person'}`}>Auto-post approved</span></> : null}{p.posted_by === 'auto-post' ? <> <span className="pill grey">Posted automatically</span></> : null}</div>
          <div className="cell-sub">{p.channel_label}{when(p) ? ` · ${fmt(when(p))}` : ' · no date yet'}{p.post_url ? <> · <a href={p.post_url} target="_blank" rel="noreferrer">View post</a></> : null}</div>
          {p.auto_error && p.status !== 'posted' && <div className="cell-sub" style={{ color: 'var(--danger, #b42318)' }}>Auto-post stopped: {p.auto_error}</div>}
          {p.body && <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{p.body.length > 220 ? `${p.body.slice(0, 220)}…` : p.body}</p>}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {p.status !== 'posted' && p.status !== 'canceled' && <><button className="btn sm" onClick={() => onEdit(p)}>Edit</button><button className="btn sm primary" onClick={() => onPosted(p)}>Mark as posted</button></>}
          {p.status === 'scheduled' && auto?.channels.includes(p.channel) && (p.auto_post
            ? <button className="btn sm" onClick={() => act(`${p.id}/auto-post`, 'Auto-post withdrawn', 'post', { enabled: false })}>Withdraw auto-post</button>
            : <button className="btn sm" onClick={() => approve(p)}>Approve auto-post</button>)}
          {p.status === 'scheduled' && <button className="btn sm" onClick={() => act(`${p.id}/unschedule`, 'Moved back to drafts')}>Unschedule</button>}
          {(p.status === 'draft' || p.status === 'scheduled') && <button className="btn sm" onClick={() => act(`${p.id}/cancel`, 'Canceled')}>Cancel</button>}
          {(p.status === 'draft' || p.status === 'canceled') && <button className="btn sm" onClick={() => { if (window.confirm(`Delete “${p.title}”?`)) act(p.id, 'Deleted', 'del'); }}>Delete</button>}
        </div>
      </div>
    );
  });
}

const APPS = { meta: 'Facebook and Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok' };
const PROVIDER_LABEL = { facebook: 'Facebook Page', instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok' };
function AutopostCard({ data, reload }) {
  const toast = useToast();
  const ap = data.autopost; const admin = data.can_edit_limits;
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search); const r = q.get('autopost');
    if (!r) return;
    toast(r === 'connected' ? 'Account connected' : r === 'cancelled' ? 'Connection cancelled' : `Could not connect${q.get('why') ? `: ${q.get('why')}` : ''}`, r === 'connected' ? undefined : 'err');
    window.history.replaceState({}, '', window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (fn, ok) => { setBusy(true); setErr(''); try { await fn(); if (ok) toast(ok); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const connect = (app) => go(async () => { const { url } = await api.get(`${A}/content/autopost/connect/${app}`); window.location.href = url; });
  return (
    <Card title="Auto-posting">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>Connected accounts can publish approved posts by themselves. Nothing is ever posted unless a person approves that exact post (Approve auto-post on a scheduled post) and the switch below is on. Editing an approved post or changing its time withdraws the approval. A failed post stops and shows the channel's message; it is never retried. Posts that say DO NOT POST or ON HOLD can never be approved. Channels without an account here (X, YouTube, WhatsApp, TikTok without a connection) stay manual.</p>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span className={`pill ${ap.enabled ? 'green' : 'grey'}`}>{ap.enabled ? 'Auto-posting is ON' : 'Auto-posting is OFF'}</span>
        <span className="cell-sub">{ap.waiting} approved post{ap.waiting === 1 ? '' : 's'} waiting</span>
        {admin && <button className="btn sm" disabled={busy} onClick={() => { if (!ap.enabled && !window.confirm('Switch auto-posting on? Approved posts will go out by themselves at their scheduled time.')) return; go(() => api.put(`${A}/content/autopost/enabled`, { enabled: !ap.enabled }), ap.enabled ? 'Auto-posting switched off' : 'Auto-posting switched on'); }}>{ap.enabled ? 'Switch off' : 'Switch on'}</button>}
      </div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Connected accounts</div>
      {ap.accounts.length ? ap.accounts.map((a) => (
        <div key={a.id} className="cc-row">
          <div style={{ flex: 1, minWidth: 0 }}>{a.name} <span className="pill grey">{PROVIDER_LABEL[a.provider] || a.provider}</span>{ap.use[a.provider] === a.id ? <> <span className="pill green">Used for {data.channels[a.provider]}</span></> : null}
            <div className="cell-sub">Connected by {a.connected_by || 'unknown'} · {fmt(a.connected_at)}</div></div>
          {admin && <div className="row" style={{ gap: 6 }}>
            {ap.use[a.provider] !== a.id && <button className="btn sm" disabled={busy} onClick={() => go(() => api.put(`${A}/content/autopost/use/${a.provider}`, { account_id: a.id }), 'Account chosen')}>Use this one</button>}
            <button className="btn sm" disabled={busy} onClick={() => { if (window.confirm(`Disconnect ${a.name}? Posts approved for it are withdrawn.`)) go(() => api.del(`${A}/content/autopost/accounts/${a.id}`), 'Disconnected'); }}>Disconnect</button>
          </div>}
        </div>)) : <p className="muted" style={{ margin: '0 0 8px' }}>No account connected yet.</p>}
      {admin ? <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {Object.entries(APPS).map(([app, label]) => <button key={app} className="btn sm" disabled={busy || !ap.apps[app]} title={ap.apps[app] ? '' : `Add the ${label} app keys under Integrations first`} onClick={() => connect(app)}>Connect {label}</button>)}
      </div> : <p className="cell-sub">A Super Admin connects accounts and switches auto-posting on.</p>}
      <p className="cell-sub" style={{ marginBottom: 0 }}>Facebook and Instagram, LinkedIn and TikTok each review the app before it may post for a real account; until they approve it a post fails with their message. TikTok posts go out as private drafts for now. LinkedIn video is not supported yet.</p>
    </Card>
  );
}

export default function ContentCalendarPage() {
  const toast = useToast();
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  const [month, setMonth] = useState(() => new Date());
  const [ai, setAi] = useState(false); const [tab, setTab] = useState('notposted'); const [form, setForm] = useState(null); const [posted, setPosted] = useState(null);
  const load = useCallback(() => api.get(`${A}/content`).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const act = async (path, ok, verb = 'post', body = {}) => { try { await (verb === 'del' ? api.del(`${A}/content/posts/${path}`) : api.post(`${A}/content/posts/${path}`, body)); toast(ok); load(); } catch (e) { setErr(e.message); } };
  const approve = async (p) => {
    const chan = data.channels[p.channel] || p.channel;
    if (!window.confirm(`Approve “${p.title}” to be posted automatically to ${chan} at ${fmt(p.scheduled_at)}?\n\nIt goes out by itself at that time, only while auto-posting is switched on. Editing the post or changing its time withdraws this approval.`)) return;
    try { const out = await api.post(`${A}/content/posts/${p.id}/auto-post`, {}); toast(out.warnings?.length ? `Approved. Note: ${out.warnings.join('. ')}` : data.autopost.enabled ? 'Approved. It will go out at the scheduled time.' : 'Approved, but auto-posting is switched off, so nothing is posted yet.'); load(); } catch (e) { setErr(e.message); }
  };
  if (err && !data) return <ErrorBox error={err} />;
  if (!data) return <Loading />;
  const posts = data.posts.map((p) => ({ ...p, channel_label: data.channels[p.channel] || p.channel }));
  const notPosted = posts.filter((p) => p.status === 'draft' || p.status === 'scheduled').sort((a, b) => String(a.scheduled_at || '9').localeCompare(String(b.scheduled_at || '9')));
  const done = posts.filter((p) => p.status === 'posted');
  const earliest = Object.entries(data.next_slot).filter(([, v]) => v).sort((a, b) => a[1].localeCompare(b[1]))[0];
  const c = data.counts;
  const edit = (p) => setForm({ post: posts.find((x) => x.id === p.id) });
  return (
    <>
      <PageTitle title="Content calendar" sub="Plan, schedule and record Agentify's own social posts, with the posting limits and the next time a post can go out." >
        {data.ai?.connected && <button className="btn" disabled={!data.ai.drafts_left_today} onClick={() => setAi(true)}>Draft with AI</button>}
        <button className="btn" onClick={async () => { try { const r = await api.post(`${A}/content/promo-drafts`); toast(r.added.length ? `Added ${r.added.length} promo video drafts` : 'Promo video drafts are already there'); load(); } catch (e) { toast(e.message, 'err'); } }}>Add promo video drafts</button>
        <button className="btn primary" onClick={() => setForm({ post: null })}>New post</button>
      </PageTitle>
      <ErrorBox error={err} />
      <div className="cc-stats">
        <Card><div className="cc-k">Next post can go out</div><div className="cc-v">{earliest ? fmt(earliest[1]) : 'No free time'}</div><div className="cell-sub">{earliest ? `on ${data.channels[earliest[0]]}, earliest of any channel` : 'in the next 14 days with these limits'}</div></Card>
        <Card><div className="cc-k">Today's limit</div><div className="cc-v">{data.today.used} of {data.limits.per_day} used</div><div className="cell-sub">{data.today.left} left today · {data.limits.window_start}–{data.limits.window_end} ({data.limits.timezone})</div></Card>
        <Card><div className="cc-k">Not yet posted</div><div className="cc-v">{c.not_posted}</div><div className="cell-sub">{c.scheduled} scheduled{c.overdue ? ` · ${c.overdue} overdue` : ''}</div></Card>
        <Card><div className="cc-k">Posted</div><div className="cc-v">{c.posted}</div><div className="cell-sub">{c.posted_this_month} this month</div></Card>
      </div>
      <Month posts={posts} month={month} setMonth={setMonth} onDay={(d) => { const t = new Date(d); t.setHours(10, 0, 0, 0); setForm({ post: null, startAt: t.toISOString() }); }} onOpen={edit} />
      <Card title="Posts">
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'notposted', label: 'Not yet posted', count: notPosted.length }, { key: 'posted', label: 'Posted', count: done.length }]} />
        <div style={{ marginTop: 10 }}>
          {tab === 'notposted' ? <PostList rows={notPosted} empty="Nothing waiting. Add a post to start the calendar." onEdit={edit} onPosted={setPosted} act={act} auto={data.autopost} approve={approve} /> : <PostList rows={done} empty="Nothing has been recorded as posted yet." onEdit={edit} onPosted={setPosted} act={act} />}
        </div>
      </Card>
      <AutopostCard data={data} reload={load} />
      {data.can_edit_limits ? <LimitsCard data={data} reload={load} /> : <Card title="Posting limits"><p className="muted" style={{ margin: 0 }}>{data.limits.per_day} posts a day in total, {data.limits.per_channel_per_day} per channel, {data.limits.min_gap_minutes} minutes apart on a channel, between {data.limits.window_start} and {data.limits.window_end} ({data.limits.timezone}). A Super Admin can change these.</p></Card>}
      {form && <PostForm data={data} post={form.post} startAt={form.startAt} onCancel={() => setForm(null)} onDone={() => { setForm(null); load(); }} />}
      {ai && <AiDraftForm data={data} onCancel={() => setAi(false)} onDone={() => { setAi(false); load(); }} />}
      {posted && <PostedForm post={posted} onCancel={() => setPosted(null)} onDone={() => { setPosted(null); load(); }} />}
    </>
  );
}
