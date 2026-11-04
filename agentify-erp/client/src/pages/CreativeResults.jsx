// Creative Studio: Results. What happened to the workspace's posts and credits, from its own calendar and AI ledger.
// Reach and likes are not shown because the platforms' analytics are not connected; the page says so plainly.
import { useEffect, useState } from 'react';
import { Card, Empty, ErrorBox, Loading } from '../components/ui.jsx';
import { api } from '../api.js';

const STAGES = [['draft', 'Drafts'], ['pending_approval', 'Waiting approval'], ['approved', 'Approved'], ['scheduled', 'Scheduled'], ['posted', 'Posted'], ['failed', 'Failed']];
const label = (p) => String(p).replace(/^./, (c) => c.toUpperCase());
const short = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const tile = { border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: '10px 14px', minWidth: 110, background: 'var(--card, #fff)' };

export default function CreativeResults({ onGoReview }) {
  const [days, setDays] = useState(30); const [r, setR] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { setR(null); api.get(`/api/creative/results?days=${days}`).then((x) => { setR(x); setErr(''); }).catch((e) => setErr(e.message)); }, [days]);
  if (err && !r) return <ErrorBox error={err} />;
  if (!r) return <Loading rows={3} />;
  const platforms = Object.entries(r.by_platform);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card title="Your posts">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {[7, 30, 90].map((d) => <button key={d} className={`btn${days === d ? ' primary' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>Last {d} days</button>)}
        </div>
        {r.total === 0
          ? <Empty title="No posts in this period yet" hint="Use Plan my week in Review posts to fill your calendar, then approve the posts." action={onGoReview && <button className="btn primary" onClick={onGoReview}>Go to Review posts</button>} />
          : <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{STAGES.map(([k, l]) => <div key={k} style={tile}><div className="muted" style={{ fontSize: 12 }}>{l}</div><div style={{ fontSize: 24, fontWeight: 700, color: k === 'failed' && r.stages[k] ? '#dc2626' : undefined }}>{r.stages[k]}</div></div>)}
            {r.sent_back > 0 && <div style={tile}><div className="muted" style={{ fontSize: 12 }}>Sent back</div><div style={{ fontSize: 24, fontWeight: 700 }}>{r.sent_back}</div></div>}</div>}
        {platforms.length > 0 && <p style={{ marginBottom: 0 }}>Published by channel: {platforms.map(([p, n]) => <span key={p} className="pill green" style={{ marginInlineEnd: 6 }}>{label(p)} {n}</span>)}</p>}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Reach and likes are not shown yet because your social accounts' own statistics are not connected. Open the post on the platform to see them.</p>
      </Card>
      {r.failed.length > 0 && <Card title="Needs attention">{r.failed.map((p) => <div key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border, #e2e8f0)' }}><b>{p.title}</b> <span className="muted">{short(p.post_date)}</span><div className="muted" style={{ fontSize: 13 }}>{p.reason}</div></div>)}{onGoReview && <button className="btn" style={{ marginTop: 8 }} onClick={onGoReview}>Open Review posts</button>}</Card>}
      {r.posted.length > 0 && <Card title="Recently posted">{r.posted.map((p) => <div key={p.id} className="row" style={{ gap: 8, justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border, #e2e8f0)', flexWrap: 'wrap' }}>
        <span><b>{p.title}</b> <span className="muted">{short(p.post_date)}</span></span>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{p.platforms.map(label).join(', ')}{p.links.map((u, i) => /^https?:\/\//.test(u) && <a key={u} href={u} target="_blank" rel="noopener noreferrer">View{p.links.length > 1 ? ` ${i + 1}` : ''}</a>)}</span></div>)}</Card>}
      <Card title="Credits and creations this month">
        {r.credits_by_feature.length === 0 ? <p className="muted" style={{ margin: 0 }}>No credits used yet this month.</p>
          : <table className="t"><thead><tr><th>What</th><th style={{ textAlign: 'end' }}>Uses</th><th style={{ textAlign: 'end' }}>Credits</th></tr></thead><tbody>{r.credits_by_feature.map((c) => <tr key={c.feature}><td>{c.label}</td><td style={{ textAlign: 'end' }}>{c.uses}</td><td style={{ textAlign: 'end' }}>{c.credits}</td></tr>)}</tbody></table>}
        <p className="muted" style={{ marginBottom: 0 }}>Made this month: {r.made_this_month.images} images, {r.made_this_month.stories} stories, {r.made_this_month.reels} reels.</p>
      </Card>
    </div>
  );
}
