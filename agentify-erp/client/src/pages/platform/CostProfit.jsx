// Cost & profit: revenue per workspace and plan against the costs the owner entered and AI recorded with Agentify's key.
// Nothing is guessed: a figure that cannot be computed (no cost entered, no exchange rate) shows "—" and the reason is listed.
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, Select } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, useCan } from './AdminShell.jsx';

const RANGES = [['month', 'This month'], ['prev_month', 'Previous month'], ['30d', 'Last 30 days'], ['quarter', 'This quarter'], ['year', 'This year']];
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

function Config({ d, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ currency: d.currency, overhead_month: d.config.overhead_month ?? '', plan_month: { ...d.config.plan_month } });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => { setBusy(true); setErr(''); try { await api.put(`${A}/profit/config`, f); toast('Cost figures saved'); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Card title="Cost figures (your own numbers)">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>Nothing is pre-filled. Enter what one active workspace on each plan costs you per month (hosting share, email, support) and your fixed platform costs. AI cost comes from the AI usage page; for it to count, its money label must equal the currency here.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
        <Field label="Profit currency" hint="Revenue in other currencies is converted with the rates under Regions"><input className="input" value={f.currency} maxLength={6} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Platform overhead per month" hint="Servers, domains, tools"><input className="input" type="number" min={0} step="any" value={f.overhead_month} onChange={(e) => setF({ ...f, overhead_month: e.target.value })} /></Field>
        {d.plan_options.map((p) => <Field key={p.id} label={`${p.name}: cost per workspace per month`}><input className="input" type="number" min={0} step="any" value={f.plan_month[p.id] ?? ''} onChange={(e) => setF({ ...f, plan_month: { ...f.plan_month, [p.id]: e.target.value } })} /></Field>)}
      </div>
      <button className="btn primary" disabled={busy} onClick={save}>Save cost figures</button>
    </Card>
  );
}

export default function CostProfitPage() {
  const can = useCan();
  const [range, setRange] = useState('month'); const [d, setD] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(() => api.get(`${A}/profit?range=${range}`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message)), [range]);
  useEffect(() => { setD(null); load(); }, [load]);
  if (err && !d) return <ErrorBox error={err} />;
  if (!d) return <Loading />;
  const cur = d.currency;
  const m = (v) => (v == null ? '—' : `${cur} ${Math.abs(v) < 100 ? v.toFixed(2) : Math.round(v).toLocaleString()}`);
  const T = d.totals;
  return (
    <>
      <PageTitle title="Cost & profit" sub="Revenue against costs per workspace and plan. Only figures you entered or that were recorded are used.">
        <Select allowEmpty={false} value={range} onChange={setRange} options={RANGES.map(([value, label]) => ({ value, label }))} />
      </PageTitle>
      <p className="muted" style={{ marginTop: 0 }}>{d.range.from} to {d.range.to} ({d.range.months} months). {d.method}</p>
      {d.missing.length > 0 && <div className="alert warn" role="status"><b>Incomplete figures</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{d.missing.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      <div className="cc-stats">
        <Card><div className="cc-k">Revenue</div><div className="cc-v">{m(T.revenue)}</div><div className="cell-sub">recognised, in {cur}</div></Card>
        <Card><div className="cc-k">Costs</div><div className="cc-v">{m(T.ai_cost + T.direct_cost + (T.ai_unallocated || 0) + T.overhead)}</div><div className="cell-sub">direct {m(T.direct_cost)} · AI {m(T.ai_cost + (T.ai_unallocated || 0))} · overhead {m(T.overhead)}</div></Card>
        <Card><div className="cc-k">Net profit{T.complete ? '' : ' (partial)'}</div><div className="cc-v">{m(T.net_profit)}</div><div className="cell-sub">{T.complete ? 'all figures present' : 'some costs or rates are missing'}</div></Card>
        <Card><div className="cc-k">Agentify's own AI use</div><div className="cc-v">{m(T.ai_unallocated)}</div><div className="cell-sub">{T.ai_unallocated_tokens.toLocaleString()} tokens, not tied to a workspace</div></Card>
      </div>
      <Card title="By plan"><div className="table-wrap"><table className="table"><thead><tr><th>Plan</th><th className="num">Workspaces</th><th className="num">Revenue</th><th className="num">AI cost</th><th className="num">Direct cost</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
        <tbody>{d.plans.map((p) => <tr key={p.plan}><td>{p.plan_name}</td><td className="num">{p.workspaces}</td><td className="num">{m(p.revenue_converted)}{Object.keys(p.unconverted).length ? <span className="muted"> + unconverted {Object.entries(p.unconverted).map(([c, n]) => `${c} ${n}`).join(', ')}</span> : null}</td><td className="num">{p.unknown ? '—' : m(p.ai_cost)}</td><td className="num">{p.unknown ? '—' : m(p.direct_cost)}</td><td className="num">{m(p.profit)}</td><td className="num">{pct(p.margin)}</td></tr>)}
          {!d.plans.length && <tr><td colSpan={7} className="muted">No revenue or active workspaces in this period.</td></tr>}</tbody></table></div></Card>
      <Card title="By workspace"><div className="table-wrap"><table className="table"><thead><tr><th>Workspace</th><th>Plan</th><th className="num">Revenue</th><th className="num">AI cost</th><th className="num">Direct cost</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
        <tbody>{d.workspaces.map((w) => <tr key={w.id}><td>{w.name} <span className="muted">{w.slug}</span></td><td>{w.plan}</td>
          <td className="num">{Object.entries(w.revenue).map(([c, n]) => `${c} ${n.toLocaleString()}`).join(', ') || '—'}</td><td className="num">{m(w.ai_cost)}</td><td className="num">{m(w.direct_cost)}</td><td className="num">{m(w.profit)}</td><td className="num">{pct(w.margin)}</td></tr>)}
          {!d.workspaces.length && <tr><td colSpan={7} className="muted">Nothing to show for this period.</td></tr>}</tbody></table></div></Card>
      {can('billing.configure') ? <Config key={JSON.stringify(d.config)} d={d} reload={load} /> : <Card title="Cost figures"><p className="muted" style={{ margin: 0 }}>Your role cannot change cost figures.</p></Card>}
    </>
  );
}
