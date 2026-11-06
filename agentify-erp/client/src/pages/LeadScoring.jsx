// CRM > Lead scoring (Agency Pro and above): who to call first, and the follow-up reminder queue.
// Scores are worked out from what the CRM already holds each time the page opens; they are a guide, not a promise.
// An agent with own-scope access sees only their own leads (the server filters).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Loading, PageHead, Stat, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useFetch, useToast } from '../context.jsx';

const BAND = { hot: ['active', 'Hot'], warm: ['pending', 'Warm'], cold: ['inactive', 'Cold'] };
const KIND = { overdue: ['inactive', 'Overdue'], due_today: ['pending', 'Due today'], gone_quiet: ['pending', 'Gone quiet'] };
const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);

export default function LeadScoring() {
  const toast = useToast();
  const [tab, setTab] = useState('queue');
  const [band, setBand] = useState('');
  const queue = useFetch('/api/leadflow/followups');
  const scores = useFetch('/api/leadflow/scores', band ? { band } : {});
  const [busy, setBusy] = useState(0);
  const remind = async (id, due) => {
    setBusy(id);
    try { await api.post(`/api/leadflow/followups/${id}/schedule`, { due_date: due, title: 'Follow up' }); toast('Follow-up scheduled'); queue.reload(); scores.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(0); }
  };
  const err = queue.error || scores.error;
  if (err) return <div className="alert err">{err}</div>;
  const q = queue.data, s = scores.data;
  return (
    <div>
      <PageHead title="Lead scoring" sub="Who to call first. Scores come from recent activity, the stage, how complete the lead is and priority.">
        <div className="row" style={{ gap: 6 }}>
          <button className={`btn sm ${tab === 'queue' ? 'primary' : ''}`} onClick={() => setTab('queue')}>Follow-up queue{q ? ` (${q.items.length})` : ''}</button>
          <button className={`btn sm ${tab === 'scores' ? 'primary' : ''}`} onClick={() => setTab('scores')}>Lead scores</button>
        </div>
      </PageHead>
      {tab === 'queue' && (!q ? <Loading /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
            <Stat label="Overdue" value={q.counts.overdue} tone={q.counts.overdue ? 'red' : undefined} />
            <Stat label="Due today" value={q.counts.due_today} />
            <Stat label="Gone quiet" value={q.counts.gone_quiet} sub="warm or hot, nothing scheduled" />
          </div>
          <Card flush>
            {!q.items.length ? <Empty title="Nothing to chase" hint="No follow-ups are due and no warm lead has gone quiet." /> : (
              <div className="table-wrap"><table className="t"><thead><tr><th>Lead</th><th>Why now</th><th className="num">Score</th><th>Owner</th><th /></tr></thead><tbody>
                {q.items.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/contacts/${i.id}`}><b>{i.full_name}</b></Link><div className="muted">{[i.stage, i.phone].filter(Boolean).join(' · ')}</div></td>
                    <td><StatusBadge status={KIND[i.kind][0]} label={KIND[i.kind][1]} /><div className="muted">{i.reason}</div></td>
                    <td className="num"><StatusBadge status={BAND[i.band][0]} label={`${BAND[i.band][1]} ${i.score}`} /></td>
                    <td>{i.agent_name || <span className="muted">Unassigned</span>}</td>
                    <td className="right nowrap">
                      {i.phone && <a className="btn sm" href={`tel:${i.phone}`}>Call</a>}{' '}
                      <button className="btn sm" disabled={busy === i.id} onClick={() => remind(i.id, tomorrow())}>Remind tomorrow</button>
                    </td>
                  </tr>
                ))}
              </tbody></table></div>
            )}
          </Card>
        </div>
      ))}
      {tab === 'scores' && (!s ? <Loading /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
            {['hot', 'warm', 'cold'].map((b) => <button key={b} type="button" className="card" style={{ textAlign: 'left', cursor: 'pointer', border: band === b ? '2px solid var(--primary)' : undefined }} onClick={() => setBand(band === b ? '' : b)}><Stat label={BAND[b][1]} value={s.counts[b]} sub={band === b ? 'Showing only these. Click to clear.' : 'Click to filter'} /></button>)}
          </div>
          <Card flush>
            {!s.leads.length ? <Empty title="No open leads" hint="Open leads appear here with a score." /> : (
              <div className="table-wrap"><table className="t"><thead><tr><th>Lead</th><th className="num">Score</th><th>Because</th><th>Owner</th></tr></thead><tbody>
                {s.leads.map((l) => (
                  <tr key={l.id}>
                    <td><Link to={`/contacts/${l.id}`}><b>{l.full_name}</b></Link><div className="muted">{[l.stage, l.phone].filter(Boolean).join(' · ')}</div></td>
                    <td className="num"><StatusBadge status={BAND[l.band][0]} label={`${BAND[l.band][1]} ${l.score}`} /></td>
                    <td className="muted">{l.reasons.join(' · ') || '—'}</td>
                    <td>{l.agent_name || <span className="muted">Unassigned</span>}</td>
                  </tr>
                ))}
              </tbody></table></div>
            )}
          </Card>
        </div>
      ))}
    </div>
  );
}
