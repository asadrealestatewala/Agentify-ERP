// Reports & export centre, and the billing reconciliation check.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Empty, ErrorBox, Loading } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';
import { FoldCard, Dot } from './Fold.jsx';
import { HealthBadge } from './Dashboard.jsx';

const COLORS = ['#14b8a6', '#3b82f6', '#f59e0b', '#f43f5e', '#8b5cf6'];
const RANGES = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['prev_month', 'Previous month'], ['quarter', 'This quarter'], ['year', 'This year'], ['custom', 'Custom range']];
const fmt = (v) => (v == null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString() : String(v));

export function ReportsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [views, setViews] = useState([]);
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState('');
  const id = params.get('report') || 'revenue';
  const q = { range: params.get('range') || 'year', from: params.get('from') || '', to: params.get('to') || '' };
  const setQ = (patch) => { const p = new URLSearchParams(params); for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); } setParams(p, { replace: true }); };
  useEffect(() => { api.get(`${A}/reports`).then(setList).catch((e) => setErr(e.message)); api.get(`${A}/reports/views`).then(setViews).catch(() => {}); }, []);
  const qs = `range=${q.range}${q.range === 'custom' ? `&from=${q.from}&to=${q.to}` : ''}`;
  const ready = q.range !== 'custom' || (q.from && q.to);
  const load = useCallback(() => { if (!ready) return; setErr(''); setRep(null); api.get(`${A}/reports/${id}?${qs}`).then(setRep).catch((e) => setErr(e.message)); }, [id, qs, ready]);
  useEffect(() => { load(); }, [load]);
  const saveView = async () => {
    const name = window.prompt('Name for this view');
    if (!name) return;
    try { setViews(await api.post(`${A}/reports/views`, { name, report: id, ...q })); toast('View saved'); } catch (e) { toast(e.message, 'err'); }
  };
  const groups = {};
  for (const r of list?.reports || []) (groups[r.group] ||= []).push(r);
  return (
    <>
      <PageTitle title="Reports & exports" sub="Built from the same records as the dashboard, in the platform timezone. Exports are made on the server and recorded in the audit log.">
        <select className="input" style={{ width: 160 }} value={q.range} onChange={(e) => setQ({ range: e.target.value })} aria-label="Date range">{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {q.range === 'custom' && <><input type="date" className="input" value={q.from} onChange={(e) => setQ({ from: e.target.value })} aria-label="From" /><input type="date" className="input" value={q.to} onChange={(e) => setQ({ to: e.target.value })} aria-label="To" /></>}
      </PageTitle>
      <div className="pa-grid3" style={{ gridTemplateColumns: 'minmax(220px, 1fr) minmax(0, 3fr)' }}>
        <div className="stack">
          <FoldCard id="reports-list" title="Choose a report" summary={rep ? rep.title : 'Pick one'} defaultOpen flush>
            {!list ? <Loading /> : Object.entries(groups).map(([g, rs]) => (
              <div key={g} style={{ padding: '6px 12px 10px' }}>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', margin: '6px 0' }}>{g}</div>
                {rs.map((r) => <button key={r.id} className={`btn sm ${r.id === id ? 'primary' : 'ghost'}`} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }} onClick={() => setQ({ report: r.id })}>{r.title}</button>)}
              </div>
            ))}
          </FoldCard>
          <FoldCard id="saved-views" title="Saved views" summary={views.length ? `${views.length} saved` : 'None yet'} flush actions={<button className="btn sm success" onClick={saveView}>Save current</button>}>
            {!views.length ? <div className="muted" style={{ padding: 12 }}>Save a report and date range you use often.</div> : views.map((v) => (
              <div key={v.name} className="row" style={{ padding: '6px 12px', gap: 6 }}>
                <button className="btn sm ghost" style={{ flex: 1, textAlign: 'left' }} onClick={() => setQ({ report: v.report, range: v.range, from: v.from, to: v.to })}>{v.name}</button>
                <button className="btn sm ghost" aria-label={`Delete ${v.name}`} onClick={async () => setViews(await api.del(`${A}/reports/views/${encodeURIComponent(v.name)}`))}>✕</button>
              </div>
            ))}
          </FoldCard>
        </div>
        <div className="stack">
          <ErrorBox error={err} />
          {!rep ? (!err && <Loading rows={8} />) : (
            <>
            <Card title={rep.title} actions={list?.can_export && <>
              <a className="btn sm success" href={`${A}/reports/${id}/export?format=csv&${qs}`}>Export CSV</a>
              <a className="btn sm info" href={`${A}/reports/${id}/export?format=xlsx&${qs}`}>Export Excel</a>
            </>}>
              <p className="muted" style={{ marginTop: 0 }}>{rep.description} {rep.range.from} to {rep.range.to} ({rep.range.timezone}).{rep.note ? ` ${rep.note}` : ''}</p>
              {rep.summary && <div className="pa-kpis" style={{ gridTemplateColumns: `repeat(${Object.keys(rep.summary).length}, minmax(0, 1fr))` }}>{Object.entries(rep.summary).map(([k, v]) => <div key={k} className="pa-kpi" style={{ cursor: 'default' }}><div className="l">{k}</div><div className="v">{fmt(v)}</div></div>)}</div>}
              {rep.chart && rep.rows.length > 0 && rep.chart.series.length > 0 && (
                <div style={{ height: 240, marginBottom: 12 }}><ResponsiveContainer><BarChart data={rep.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} /><XAxis dataKey={rep.chart.x} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} minTickGap={12} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => Number(v).toLocaleString()} /><Tooltip formatter={(v) => fmt(v)} />{rep.chart.series.length > 1 && <Legend />}
                  {rep.chart.series.map((s, i) => <Bar key={s} dataKey={s} name={rep.columns.find(([k]) => k === s)?.[1] || s} fill={COLORS[i % COLORS.length]} radius={[5, 5, 0, 0]} maxBarSize={28} />)}
                </BarChart></ResponsiveContainer></div>
              )}
            </Card>
            <FoldCard id="report-rows" title="Detailed rows" summary={rep.rows.length ? `${rep.rows.length.toLocaleString()} rows, click to see them` : 'Nothing in this period'} tone={rep.rows.length ? undefined : 'warn'} defaultOpen={rep.rows.length > 0 && rep.rows.length <= 8} flush>
              {!rep.rows.length ? <Empty title="Nothing in this period" /> : (
                <div className="table-wrap"><table className="t"><thead><tr>{rep.columns.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead><tbody>
                  {rep.rows.slice(0, 500).map((row, i) => <tr key={i}>{rep.columns.map(([k]) => <td key={k} className={typeof row[k] === 'number' ? 'mono' : ''}>{fmt(row[k])}</td>)}</tr>)}
                </tbody></table></div>
              )}
              {rep.rows.length > 500 && <p className="muted" style={{ margin: 12 }}>Showing the first 500 of {rep.rows.length} rows. Export to see them all.</p>}
            </FoldCard>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function ReconciliationPage() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { setErr(''); setD(null); api.get(`${A}/reconciliation`).then(setD).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const state = (s) => (s === 'ok' ? 'healthy' : s === 'warning' ? 'degraded' : 'unhealthy');
  return (
    <>
      <PageTitle title="Payment reconciliation" sub="Checks that payments, invoices and subscriptions agree with each other. Anything listed here needs a look before month-end."><button className="btn info" onClick={load}>Run again</button></PageTitle>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <>
          <Card title={<span>Result <HealthBadge state={d.ok ? 'healthy' : 'degraded'} /></span>} actions={<span className="muted">Checked {new Date(d.checked_at).toLocaleTimeString()}</span>}>
            <p style={{ margin: 0 }}>All paid invoices: {d.paid_totals.length ? d.paid_totals.map((t) => `${t.currency} ${Number(t.total).toLocaleString()} (${t.n})`).join(' · ') : 'none yet'}</p>
          </Card>
          {d.checks.map((c) => (
            <FoldCard key={c.id} id={`recon-${c.id}`} title={c.label} summary={<Dot tone={c.state === 'ok' ? 'ok' : c.state === 'warning' ? 'warn' : 'bad'}>{c.state === 'ok' ? 'All good' : `${c.count} to check`}</Dot>} tone={c.state === 'ok' ? 'ok' : c.state === 'warning' ? 'warn' : 'bad'} defaultOpen={c.state !== 'ok'} flush={!!c.rows.length}>
              {!c.rows.length ? <p className="muted" style={{ margin: 0 }}>{c.detail}</p> : (
                <div className="table-wrap"><table className="t"><thead><tr>{Object.keys(c.rows[0]).map((k) => <th key={k}>{k.replace(/_/g, ' ')}</th>)}</tr></thead><tbody>
                  {c.rows.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{fmt(v)}</td>)}</tr>)}
                </tbody></table></div>
              )}
            </FoldCard>
          ))}
        </>
      )}
    </>
  );
}
