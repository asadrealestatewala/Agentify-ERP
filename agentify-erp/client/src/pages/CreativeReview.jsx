// Creative Studio: review queue. Posts from the Content Calendar for one week, a live preview and one-tap Approve / Send back.
// Uses the existing content calendar approval flow (nothing is posted without an approval); keyboard: A approve, R send back, up/down move.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, ErrorBox, Loading } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

const WAITING = ['draft', 'pending_approval', 'failed'];
const APPROVED = ['approved', 'scheduled'];
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const mondayOf = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return iso(x); };
const short = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayName = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const label = (p) => String(p).replace(/^./, (c) => c.toUpperCase());
const rtl = (t) => /[؀-ۿ]/.test(t || '');
const hasStage = (tab, p) => (tab === 'waiting' ? WAITING : tab === 'approved' ? APPROVED : ['posted']).includes(p.stage);

const css = `.rv{display:grid;grid-template-columns:minmax(260px,330px) minmax(260px,1fr) minmax(260px,380px);gap:16px;align-items:start}
.rv-col{min-width:0}.rv-row{display:flex;gap:10px;align-items:center;padding:8px;border-radius:10px;cursor:pointer;border:1px solid transparent;text-align:start;width:100%;background:none;color:inherit}
.rv-row.on{background:var(--primary-l);border-color:var(--primary)}.rv-th{width:44px;height:44px;border-radius:8px;object-fit:cover;background:#0f172a;flex:none}
.rv-pill{display:inline-flex;gap:6px;align-items:center;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:none;color:inherit;cursor:pointer;font-size:13px}.rv-pill.on{background:var(--primary);border-color:var(--primary);color:#fff}
.rv-ph{border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--card,#fff)}.rv-ph img,.rv-ph video{width:100%;display:block;max-height:460px;object-fit:cover}
kbd{border:1px solid var(--border);border-radius:5px;padding:0 6px;font-size:12px}
.rv-empty{grid-template-columns:1fr;max-width:640px}.rv-empty .rv-prev{display:none}.rv-empty .rv-side{display:none}.rv-col{margin-bottom:8px}
.rv-days{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:10px}.rv-day{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;border-radius:10px;border:1px solid var(--border);background:none;color:inherit;cursor:pointer;font-size:12px}.rv-day.on{background:var(--primary);border-color:var(--primary);color:#fff}
.rv-day .dot{width:6px;height:6px;border-radius:50%;background:var(--primary)}.rv-day.on .dot{background:#fff}.rv-day .dot.off{background:transparent}
.rv-lang{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}.rv-cap{display:flex;justify-content:space-between;font-size:12px;margin:4px 0 8px}.rv-cap .over{color:#b91c1c;font-weight:600}
.rv-approve{width:100%;padding:14px 16px;font-size:16px;font-weight:700;justify-content:center}
@media(max-width:1000px){.rv{grid-template-columns:1fr}}`;

function Thumb({ p }) {
  return p.creative_kind === 'image' ? <img className="rv-th" src={`/api/content/posts/${p.id}/creative`} alt="" loading="lazy" /> : <span className="rv-th" style={{ display: 'grid', placeItems: 'center', color: '#fff' }}>{p.creative_kind === 'video' ? '▶' : 'Aa'}</span>;
}

export default function CreativeReview({ onGoReels, brandName }) {
  const toast = useToast(); const { can } = useAuth();
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [posts, setPosts] = useState(null); const [err, setErr] = useState('');
  const [tab, setTab] = useState('waiting'); const [plat, setPlat] = useState('all'); const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState(null); const [ask, setAsk] = useState(null); const [busy, setBusy] = useState(false); const [bulk, setBulk] = useState(null);
  const canApprove = can('content', 'approve'), canEdit = can('content', 'edit');
  const [tr, setTr] = useState(''); const [day, setDay] = useState(null);
  const load = useCallback(() => api.get(`/api/content/posts?from=${week}&to=${addDays(week, 6)}`).then((r) => { setPosts(r); setErr(''); }).catch((e) => setErr(e.message)), [week]);
  useEffect(() => { setPosts(null); setDay(null); load(); }, [load]);

  const counts = useMemo(() => { const c = { waiting: 0, approved: 0, posted: 0 }; (posts || []).forEach((p) => { if (hasStage('waiting', p)) c.waiting++; else if (hasStage('approved', p)) c.approved++; else if (p.stage === 'posted') c.posted++; }); return c; }, [posts]);
  const inTab = useMemo(() => (posts || []).filter((p) => hasStage(tab, p)), [posts, tab]);
  const platforms = useMemo(() => [...new Set(inTab.flatMap((p) => p.platforms || []))], [inTab]);
  const list = useMemo(() => inTab.filter((p) => (plat === 'all' || (p.platforms || []).includes(plat)) && (!day || p.post_date === day)), [inTab, plat, day]);
  const cur = list.find((p) => p.id === sel) || list[0] || null;
  useEffect(() => { setEdit(null); setAsk(null); }, [cur?.id]);

  const switchLang = async (language) => { if (!cur || tr) return; setTr(language); try { const r = await api.post(`/api/creative/posts/${cur.id}/language`, { language }); setEdit(null); toast(r.rewritten ? `Written in ${language}. Check it, then approve.` : `Switched to ${language}`); await load(); } catch (e) { toast(e.message, 'err'); } finally { setTr(''); } };
  const act = useCallback(async (fn, ok) => { setBusy(true); try { await fn(); toast(ok); await load(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } }, [load, toast]);
  const approve = (p) => act(() => api.post(`/api/content/posts/${p.id}/approve`, {}), 'Approved');
  const sendBack = (p, note) => act(() => api.post(`/api/content/posts/${p.id}/reject`, { note }), note ? 'Changes requested' : 'Sent back');
  const move = (n) => { if (!list.length) return; const i = Math.max(0, list.findIndex((p) => p.id === cur?.id)); setSel(list[Math.min(list.length - 1, Math.max(0, i + n))].id); };

  useEffect(() => {
    const key = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey || !cur) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if ((e.key === 'a' || e.key === 'A') && canApprove && hasStage('waiting', cur) && !busy) approve(cur);
      else if ((e.key === 'r' || e.key === 'R') && canApprove && cur.stage !== 'posted' && !busy) sendBack(cur, '');
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  const groups = useMemo(() => { const m = new Map(); list.forEach((p) => { if (!m.has(p.post_date)) m.set(p.post_date, []); m.get(p.post_date).push(p); }); return [...m.entries()]; }, [list]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const approveSeveral = async () => { const ids = Object.keys(bulk || {}).filter((k) => bulk[k]); if (!ids.length) { setBulk(null); return; } setBusy(true); let ok = 0; for (const id of ids) { try { await api.post(`/api/content/posts/${id}/approve`, {}); ok++; } catch { /* reported below */ } } setBusy(false); setBulk(null); toast(`${ok} of ${ids.length} approved`, ok === ids.length ? undefined : 'err'); load(); };

  const LIMITS = { instagram: 2200, linkedin: 3000, facebook: 63206 };
  const limit = Math.min(...((cur?.platforms || []).map((p) => LIMITS[p]).filter(Boolean)), 2200);
  const len = (edit ?? cur?.caption ?? '').length;
  if (err && !posts) return <ErrorBox error={err} />;
  return (
    <div>
      <style>{css}</style>
      <div className={`rv${posts && !list.length ? ' rv-empty' : ''}`}>
        <div className="rv-col">
          <div className="row" style={{ gap: 8, justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="row" style={{ gap: 4 }}><button className="btn sm" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>‹</button><b>{short(week)} – {short(addDays(week, 6))}</b><button className="btn sm" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>›</button></span>
            <button className="btn sm" onClick={() => setWeek(mondayOf(new Date()))}>This week</button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {[['waiting', 'Waiting'], ['approved', 'Approved'], ['posted', 'Posted']].map(([k, l]) => <button key={k} className={`rv-pill${tab === k ? ' on' : ''}`} onClick={() => { setTab(k); setPlat('all'); }}>{l} <b>{counts[k]}</b></button>)}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <button className={`rv-pill${plat === 'all' ? ' on' : ''}`} onClick={() => setPlat('all')}>All {inTab.length}</button>
            {platforms.map((p) => <button key={p} className={`rv-pill${plat === p ? ' on' : ''}`} onClick={() => setPlat(p)}>{label(p)} {inTab.filter((x) => x.platforms.includes(p)).length}</button>)}
          </div>
          {tab === 'waiting' && canApprove && list.length > 1 && (bulk
            ? <div className="row" style={{ gap: 6, marginBottom: 8 }}><button className="btn sm primary" disabled={busy} onClick={approveSeveral}>Approve selected</button><button className="btn sm" onClick={() => setBulk(null)}>Cancel</button></div>
            : <div style={{ textAlign: 'end', marginBottom: 4 }}><button className="btn sm" onClick={() => setBulk({})}>Approve several</button></div>)}
          {!posts ? <Loading rows={3} /> : !list.length ? <div style={{ padding: '36px 12px', textAlign: 'center' }}><Empty title={tab === 'waiting' ? 'Nothing waiting this week' : 'Nothing here yet'} hint="Make a post in Brand story, Post images or Video reels, then choose Send to calendar." /></div> : groups.map(([d, ps]) => (
            <div key={d} style={{ marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 12, margin: '6px 0' }}>{dayName(d)}, {short(d)}</div>
              {ps.map((p) => (
                <div key={p.id} className="row" style={{ gap: 6 }}>
                  {bulk && <input type="checkbox" aria-label={`Select ${p.title}`} checked={!!bulk[p.id]} onChange={(e) => setBulk({ ...bulk, [p.id]: e.target.checked })} />}
                  <button className={`rv-row${cur?.id === p.id ? ' on' : ''}`} onClick={() => setSel(p.id)} aria-current={cur?.id === p.id}>
                    <Thumb p={p} />
                    <span style={{ minWidth: 0 }}><span className="bold" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir={rtl(p.title) ? 'rtl' : 'ltr'}>{p.title}</span>
                      <span className="muted" style={{ fontSize: 12 }}>{(p.platforms || []).map(label).join(', ') || 'No platform'}{p.post_time ? ` · ${p.post_time}` : ''}{p.reject_note ? ' · Sent back' : ''}</span></span>
                  </button>
                </div>))}
            </div>))}
          <div className="rv-days" role="group" aria-label="Filter by day">
            {days.map((d) => { const n = (posts || []).filter((p) => p.post_date === d).length; return <button key={d} type="button" className={`rv-day${day === d ? ' on' : ''}`} aria-pressed={day === d} onClick={() => setDay(day === d ? null : d)} title={`${short(d)}${n ? `: ${n} post${n === 1 ? '' : 's'}` : ''}`}><span>{dayName(d).slice(0, 3)}</span><b>{Number(d.slice(8))}</b><i className={n ? 'dot' : 'dot off'} /></button>; })}
          </div>
        </div>

        <div className="rv-col rv-prev">
          {cur ? (
            <div className="rv-ph">
              <div className="row" style={{ gap: 8, padding: 10 }}><span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{(brandName || 'A')[0].toUpperCase()}</span><span><b>{brandName || 'Your brand'}</b><br /><span className="muted" style={{ fontSize: 12 }}>{cur.stage_label} · {short(cur.post_date)}{cur.post_time ? `, ${cur.post_time}` : ''}</span></span></div>
              {cur.creative_kind === 'image' && <img src={`/api/content/posts/${cur.id}/creative`} alt="Post" />}
              {cur.creative_kind === 'video' && <video src={`/api/content/posts/${cur.id}/creative`} controls playsInline />}
              <div style={{ padding: 12, whiteSpace: 'pre-wrap' }} dir={rtl(cur.caption) ? 'rtl' : 'ltr'}>{cur.caption || <span className="muted">No caption yet.</span>}</div>
              <div className="muted" style={{ textAlign: 'center', fontSize: 12, padding: 8 }}>How it will look on {label((cur.platforms || ['your page'])[0])}</div>
            </div>) : null}
        </div>

        <div className="rv-col rv-side">
          {cur && (<>
            <div className="muted" style={{ fontSize: 13 }}>{(cur.platforms || []).map(label).join(', ')} · {dayName(cur.post_date)} {short(cur.post_date)}{cur.post_time ? `, ${cur.post_time}` : ''}</div>
            <h3 style={{ margin: '6px 0 10px' }} dir={rtl(cur.title) ? 'rtl' : 'ltr'}>{cur.title}</h3>
            {cur.reject_note && <p className="muted" style={{ marginTop: 0 }}>Changes asked for: {cur.reject_note}</p>}
            {cur.fail_reason && <p style={{ color: 'var(--danger,#b91c1c)' }}>{cur.fail_reason}</p>}
            {cur.stage !== 'posted' && (<>
              <div className="rv-lang" role="group" aria-label="Caption language">
                {['English', 'Urdu', 'Roman Urdu'].map((l) => <button key={l} type="button" className={`rv-pill${cur.caption_language === l ? ' on' : ''}`} aria-pressed={cur.caption_language === l} disabled={!canEdit || !!tr} onClick={() => switchLang(l)} title={(cur.versions || []).includes(l) ? 'Already written' : 'Writes this version with AI'}>{tr === l ? 'Writing…' : l}</button>)}
              </div>
              <label className="muted" htmlFor="rv-caption" style={{ fontSize: 13 }}>Your caption</label>
              <textarea id="rv-caption" className="input" rows={6} value={edit ?? cur.caption ?? ''} disabled={!canEdit} onChange={(e) => setEdit(e.target.value)} dir={rtl(edit ?? cur.caption) ? 'rtl' : 'ltr'} />
              <div className="rv-cap"><span className="muted">{edit !== null && edit !== (cur.caption || '') ? 'Unsaved changes' : ''}</span><span className={len > limit ? 'over' : 'muted'}>{len.toLocaleString()} / {limit.toLocaleString()}</span></div>
              {edit !== null && edit !== (cur.caption || '') && <div className="row" style={{ gap: 6, marginBottom: 8 }}><button className="btn sm primary" disabled={busy || len > limit} onClick={() => act(async () => { await api.put(`/api/content/posts/${cur.id}`, { caption: edit }); setEdit(null); }, 'Caption saved')}>Save caption</button><button className="btn sm" onClick={() => setEdit(null)}>Undo</button></div>}
              {hasStage('waiting', cur) && <button className="btn primary rv-approve" disabled={busy || !canApprove || (edit !== null && edit !== (cur.caption || ''))} onClick={() => approve(cur)} title={edit !== null && edit !== (cur.caption || '') ? 'Save your caption first' : undefined}>✓ Approve</button>}
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button className="btn" style={{ flex: 1 }} disabled={busy || !canApprove} onClick={() => sendBack(cur, '')}>Reject</button>
                <button className="btn" style={{ flex: 1 }} disabled={!canApprove} onClick={() => setAsk('')}>Ask for changes</button>
              </div>
              {!canApprove && <p className="muted" style={{ fontSize: 12 }}>Only people with approval rights can approve or reject.</p>}
            </>)}
            {ask !== null && <div style={{ marginTop: 8 }}><textarea className="input" rows={3} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="What should change?" aria-label="What should change" /><div className="row" style={{ gap: 6, marginTop: 6 }}><button className="btn sm primary" disabled={busy || !ask.trim()} onClick={() => sendBack(cur, ask.trim()).then(() => setAsk(null))}>Send back with note</button><button className="btn sm" onClick={() => setAsk(null)}>Cancel</button></div></div>}
            <div className="card" style={{ padding: 10, marginTop: 12 }}><div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><span><b>Reel</b><br /><span className="muted" style={{ fontSize: 12 }}>Make a short video for this brand.</span></span><button className="btn sm" onClick={onGoReels}>Make a reel</button></div></div>
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}><kbd>A</kbd> approve · <kbd>R</kbd> reject · <kbd>↑</kbd><kbd>↓</kbd> previous / next</p>
          </>)}
        </div>
      </div>
    </div>
  );
}
