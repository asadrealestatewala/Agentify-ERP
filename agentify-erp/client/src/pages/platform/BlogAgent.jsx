// Blog agent: AI-written blog drafts that a person approves before they appear on /blog. Settings (daily cap, topic focus, keys),
// a "Run now" button and the review queue with checks, sources, edit, approve and reject.
import { useCallback, useEffect, useState } from 'react';
import { FoldCard } from './Fold.jsx';
import { Card, ErrorBox, Field, Loading, Modal, Tabs, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';

const fmt = (iso) => (iso ? new Date(`${iso.replace(' ', 'T')}Z`).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

function Settings({ data, reload }) {
  const toast = useToast(); const s = data.settings;
  const [f, setF] = useState({ cap: s.cap, focus: s.focus, engine: s.engine, tavily_key: '', unsplash_key: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (extra = {}) => {
    setBusy(true); setErr('');
    try {
      const body = { cap: Number(f.cap), focus: f.focus, engine: f.engine, ...extra };
      if (f.tavily_key) body.tavily_key = f.tavily_key;
      if (f.unsplash_key) body.unsplash_key = f.unsplash_key;
      await api.put(`${A}/blog-agent/settings`, body); toast('Saved'); setF({ ...f, tavily_key: '', unsplash_key: '' }); reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <FoldCard id="BlogAgent-Settings" title="Settings" summary="Blog agent schedule, keys and limits" defaultOpen >
      <ErrorBox error={err} />
      <label className="check"><input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Write new drafts automatically every day (up to the limit below)</label>
      <div className="grid-2" style={{ marginTop: 10 }}>
        <Field label={`Articles per day (1 to ${data.hard_max})`}><TextInput type="number" min="1" max={data.hard_max} value={f.cap} onChange={(v) => setF({ ...f, cap: v })} /></Field>
        <Field label="Writing engine" hint={`Gemini ${s.engines.gemini ? 'is connected' : 'is not connected'}; Groq ${s.engines.groq ? 'is connected' : 'is not connected'}. If the chosen engine fails, the other one is used when connected. Connect them under Console > AI.`}>
          <select className="input" value={f.engine} onChange={(e) => setF({ ...f, engine: e.target.value })}><option value="gemini">Gemini (Google)</option><option value="groq">Groq (fast, free tier is rate limited)</option></select>
        </Field>
        <Field label="Topic focus" hint="What the blog should be about. Be specific."><TextInput value={f.focus} onChange={(v) => setF({ ...f, focus: v })} /></Field>
      </div>
      {data.can_edit_keys && (
        <div className="grid-2">
          <Field label={`Tavily API key (web research) ${s.tavily.set ? `· saved ${s.tavily.hint}` : '· not set'}`} hint="From app.tavily.com. Stored encrypted on the server; never shown again."><TextInput type="password" autoComplete="off" placeholder={s.tavily.set ? 'Paste a new key to replace' : 'tvly-…'} value={f.tavily_key} onChange={(v) => setF({ ...f, tavily_key: v })} /></Field>
          <Field label={`Unsplash access key (optional photos) ${s.unsplash.set ? `· saved ${s.unsplash.hint}` : '· not set'}`} hint="Without it, articles use the blog's default share picture."><TextInput type="password" autoComplete="off" value={f.unsplash_key} onChange={(v) => setF({ ...f, unsplash_key: v })} /></Field>
        </div>
      )}
      {data.can_edit_keys && <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={s.auto_publish} onChange={(e) => save({ auto_publish: e.target.checked })} /> Publish automatically when every quality check passes (leave off to approve each article yourself)</label>}
      <div style={{ marginTop: 10 }}><button className="btn primary" disabled={busy} onClick={() => save()}>Save settings</button></div>
    </FoldCard>
  );
}

function Review({ id, onClose, reload }) {
  const toast = useToast(); const [d, setD] = useState(null); const [f, setF] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`${A}/blog-agent/posts/${id}`).then((x) => { setD(x); setF({ title: x.title, description: x.description, text: x.text }); }).catch((e) => setErr(e.message)); }, [id]);
  const run = async (fn, msg) => { setBusy(true); setErr(''); try { await fn(); toast(msg); reload(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const save = () => api.put(`${A}/blog-agent/posts/${id}`, f);
  if (!d) return <Modal title="Article" onClose={onClose}><ErrorBox error={err} />{!err && <Loading rows={4} />}</Modal>;
  return (
    <Modal title="Review article" size="lg" onClose={onClose} footer={<>
      <button className="btn warn" onClick={onClose}>Close</button>
      {d.status !== 'rejected' && d.status !== 'published' && <button className="btn" disabled={busy} onClick={() => run(async () => { await save(); await api.post(`${A}/blog-agent/posts/${id}/reject`); }, 'Rejected')}>Reject</button>}
      <button className="btn" disabled={busy} onClick={() => run(save, 'Saved')}>Save changes</button>
      {d.status === 'published'
        ? <button className="btn" disabled={busy} onClick={() => run(() => api.post(`${A}/blog-agent/posts/${id}/unpublish`), 'Unpublished')}>Unpublish</button>
        : <button className="btn primary" disabled={busy} onClick={() => run(async () => { await save(); await api.post(`${A}/blog-agent/posts/${id}/publish`); }, 'Published to the blog')}>Approve and publish</button>}
    </>}>
      <ErrorBox error={err} />
      {d.checks.length > 0 && <div className="alert err">Checks to look at: {d.checks.join('; ')}</div>}
      <Field label="Title"><TextInput value={f.title} onChange={(v) => setF({ ...f, title: v })} /></Field>
      <Field label="Search description"><TextInput value={f.description} onChange={(v) => setF({ ...f, description: v })} /></Field>
      <Field label="Article" hint="A line starting with # is a heading, * is a bullet, anything else is a paragraph."><textarea className="input" rows={16} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
      <p className="muted" style={{ margin: '6px 0' }}>Read the facts before you approve: the AI is told not to invent figures, but you are the final check.</p>
      {d.sources.length > 0 && <details><summary>Sources the writer read ({d.sources.length})</summary><ul>{d.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a></li>)}</ul></details>}
      {d.status === 'published' && <p><a href={`/blog/${d.slug}`} target="_blank" rel="noreferrer noopener">Open on the site</a></p>}
    </Modal>
  );
}

export default function BlogAgentPage() {
  const toast = useToast(); const [data, setData] = useState(null); const [err, setErr] = useState(''); const [tab, setTab] = useState('draft'); const [open, setOpen] = useState(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`${A}/blog-agent`).then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <>{<ErrorBox error={err} />}{!err && <Loading />}</>;
  const rows = data.posts.filter((p) => p.status === tab);
  const count = (s) => data.posts.filter((p) => p.status === s).length;
  const runNow = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`${A}/blog-agent/run`); setData(r); toast(r.skipped || `Wrote ${r.made.length} draft${r.made.length === 1 ? '' : 's'}${r.errors.length ? `, ${r.errors.length} failed` : ''}`); if (r.errors.length) setErr(r.errors.join(' | ')); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageTitle title="Blog agent" sub="AI-written blog drafts, researched on the web. Nothing goes on your blog until you approve it.">
        <button className="btn primary" disabled={busy || !data.settings.tavily.set} onClick={runNow}>{busy ? 'Writing… this takes a few minutes' : 'Write drafts now'}</button>
      </PageTitle>
      <ErrorBox error={err} />
      <Card><b>{data.made_today} of {data.settings.cap}</b> drafts made today. {data.settings.enabled ? 'The agent tops this up automatically every hour until the limit is reached.' : 'Automatic writing is off; use Write drafts now.'}{!data.settings.tavily.set && ' Add a Tavily API key below to start.'}</Card>
      <FoldCard id="BlogAgent-Articles" title="Articles" summary="Drafts and published articles" defaultOpen >
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'draft', label: 'To review', count: count('draft') }, { key: 'published', label: 'Published', count: count('published') }, { key: 'rejected', label: 'Rejected', count: count('rejected') }]} />
        <div style={{ marginTop: 10 }}>
          {rows.length === 0 ? <p className="muted">Nothing here yet.</p> : rows.map((p) => (
            <div key={p.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{p.title}</div><div className="cell-sub">{p.tag} · {p.read_min} min read · {fmt(p.created_at)}{p.checks.length ? ` · ${p.checks.length} check${p.checks.length === 1 ? '' : 's'} failed` : ' · checks passed'}</div></div>
              <button className="btn" onClick={() => setOpen(p.id)}>{tab === 'draft' ? 'Review' : 'Open'}</button>
            </div>
          ))}
        </div>
      </FoldCard>
      <Settings data={data} reload={load} />
      {open && <Review id={open} onClose={() => setOpen(null)} reload={load} />}
    </>
  );
}
