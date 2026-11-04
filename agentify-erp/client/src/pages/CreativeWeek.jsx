// Creative Studio: "Plan my week" as its own page. Pick the week, how many posts and the language, then see the week's slots.
// Posts are written as drafts in the content calendar; nothing is published until someone approves them in Posts.
import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const mondayOf = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return iso(x); };
const short = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayName = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const label = (p) => String(p).replace(/^./, (c) => c.toUpperCase());
const rtl = (t) => /[؀-ۿ]/.test(t || '');

const css = `.wk-pill{display:inline-flex;padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:none;color:inherit;cursor:pointer;font-size:13px}.wk-pill.on{background:var(--primary);border-color:var(--primary);color:#fff}
.wk-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}.wk-day{border:1px solid var(--border);border-radius:12px;padding:8px;min-height:120px;min-width:0}
.wk-day h5{margin:0 0 6px;font-size:13px}.wk-slot{display:block;width:100%;text-align:start;border:1px solid var(--border);border-radius:8px;padding:6px 8px;margin-bottom:6px;background:none;color:inherit;cursor:pointer;font-size:12.5px}
.wk-slot b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wk-slot.waiting{border-color:#d97706}.wk-slot.approved,.wk-slot.posted{border-color:var(--primary)}
@media(max-width:900px){.wk-days{grid-template-columns:1fr}.wk-day{min-height:0}}`;

const state = (p) => (p.stage === 'posted' ? 'posted' : ['approved', 'scheduled'].includes(p.stage) ? 'approved' : 'waiting');
const STATE_LABEL = { waiting: 'Waiting for approval', approved: 'Approved', posted: 'Posted' };

export default function CreativeWeek({ onGoReview }) {
  const toast = useToast(); const { can } = useAuth();
  const [week, setWeek] = useState(() => addDays(mondayOf(new Date()), 7));
  const [f, setF] = useState({ count: 3, language: 'English' });
  const [posts, setPosts] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/api/content/posts?from=${week}&to=${addDays(week, 6)}`).then((r) => { setPosts(r); setErr(''); }).catch((e) => setErr(e.message)), [week]);
  useEffect(() => { setPosts(null); load(); }, [load]);
  const run = async () => {
    setBusy(true);
    try { const r = await api.post('/api/creative/week-plan', { week_start: week, count: f.count, language: f.language }); toast(`${r.posts.length} posts added. Review and approve them in Posts.`); await load(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const thisWeek = mondayOf(new Date());
  return (
    <div>
      <style>{css}</style>
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <strong>Plan my week</strong>
        <p className="muted" style={{ margin: '4px 0 12px', fontSize: 13 }}>Writes a week of posts from your brand profile, website facts and real listings. They appear below as drafts. Nothing is published until you approve it. Costs 1 credit.</p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[[thisWeek, 'This week'], [addDays(thisWeek, 7), 'Next week']].map(([v, l]) => <button key={l} type="button" className={`wk-pill${week === v ? ' on' : ''}`} aria-pressed={week === v} onClick={() => setWeek(v)}>{l}</button>)}
          {[3, 5].map((n) => <button key={n} type="button" className={`wk-pill${f.count === n ? ' on' : ''}`} aria-pressed={f.count === n} onClick={() => setF({ ...f, count: n })}>{n} posts</button>)}
          {['English', 'Roman Urdu', 'Urdu'].map((l) => <button key={l} type="button" className={`wk-pill${f.language === l ? ' on' : ''}`} aria-pressed={f.language === l} onClick={() => setF({ ...f, language: l })}>{l}</button>)}
        </div>
        {can('content', 'create') ? <button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Writing your week…' : 'Create the plan'}</button> : <span className="muted">You need permission to create posts.</span>}
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 8, justifyContent: 'space-between' }}>
        <span className="row" style={{ gap: 4 }}><button className="btn sm" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>‹</button><b>{short(week)} – {short(addDays(week, 6))}</b><button className="btn sm" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>›</button></span>
        <button className="btn sm" onClick={onGoReview}>Open Posts</button>
      </div>
      {err && !posts ? <ErrorBox error={err} /> : !posts ? <Loading rows={3} /> : !posts.length ? <Empty title="No posts planned for this week" hint="Choose how many posts and a language, then press Create the plan." /> : (
        <div className="wk-days">
          {days.map((d) => (
            <div key={d} className="wk-day">
              <h5>{dayName(d)} {short(d)}</h5>
              {posts.filter((p) => p.post_date === d).map((p) => <button key={p.id} className={`wk-slot ${state(p)}`} onClick={onGoReview} title={STATE_LABEL[state(p)]}><b dir={rtl(p.title) ? 'rtl' : 'ltr'}>{p.title}</b><span className="muted">{(p.platforms || []).map(label).join(', ') || 'No platform'} · {STATE_LABEL[state(p)]}</span></button>)}
            </div>))}
        </div>)}
    </div>
  );
}
