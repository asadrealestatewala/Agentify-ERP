// Revenue & subscriptions: MRR/ARR per currency, invoiced vs collected, refunds, net, recognised revenue, movement and
// what needs attention next. Every figure comes from /api/platform/admin/finance (billing records only).
import { useCallback, useEffect, useState } from 'react';
import { FoldCard } from './Fold.jsx';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Empty, ErrorBox, Field, Loading, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { A, PageTitle, useCan } from './AdminShell.jsx';

const n0 = (v) => Number(v || 0).toLocaleString();
const money = (m) => (m && Object.keys(m).length ? Object.entries(m).map(([c, v]) => `${c} ${n0(v)}`).join(' · ') : '0');
const RANGES = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['prev_month', 'Previous month'], ['quarter', 'This quarter'], ['year', 'This year'], ['custom', 'Custom range']];
const STATUSES = [['', 'Any status'], ['trialing', 'Trialing'], ['active', 'Active'], ['past_due', 'Past due'], ['canceled', 'Cancelled'], ['expired', 'Expired'], ['pending', 'Pending payment']];
const MONEY_ROWS = [
  ['mrr', 'MRR'], ['arr', 'ARR (run-rate)'], ['mrr_at_risk', 'MRR at risk (past due)'], ['invoiced', 'Invoiced'], ['collected', 'Collected (gross)'], ['setup_fees', '…of which setup fees'],
  ['refunds', 'Refunds'], ['net_collections', 'Net collections'], ['recognised_revenue', 'Recognised revenue'], ['outstanding', 'Outstanding'],
];

export function FinancePage() {
  const nav = useNavigate();
  const can = useCan();
  const [q, setQ] = useState({ range: '30d', from: '', to: '', product: '', plan: '', status: '', currency: '', tenant: '' });
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [plans, setPlans] = useState([]);
  const qs = Object.entries(q).filter(([k, v]) => v && (k !== 'from' && k !== 'to' ? true : q.range === 'custom')).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const ready = q.range !== 'custom' || (q.from && q.to);
  const load = useCallback(() => { if (!ready) return; setErr(''); api.get(`${A}/finance?${qs}`).then(setD).catch((e) => setErr(e.message)); }, [qs, ready]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get(`${A}/plans`).then((x) => setPlans(x.plans)).catch(() => {}); }, []);
  const set = (k) => (e) => setQ({ ...q, [k]: e.target ? e.target.value : e });
  const currencies = d ? [...new Set(Object.values(d.money).flatMap((m) => Object.keys(m)))] : [];
  const chart = d ? currencies.map((c) => ({ currency: c, Collected: d.money.collected[c] || 0, Refunds: d.money.refunds[c] || 0, Net: d.money.net_collections[c] || 0, Recognised: d.money.recognised_revenue[c] || 0 })) : [];
  return (
    <>
      <PageTitle title="Revenue & subscriptions" sub="Billing-based figures, kept separate per currency. Hover a metric name for its definition.">
        {can('workspaces.export') && <a className="btn sm" href={`${A}/finance/export?${qs}&format=csv`}>Export CSV</a>}
        {can('workspaces.export') && <a className="btn sm" href={`${A}/finance/export?${qs}&format=xlsx`}>Export Excel</a>}
      </PageTitle>
      <Card>
        <div className="pa-grid3" style={{ marginBottom: 0 }}>
          <Field label="Period"><select className="input" value={q.range} onChange={set('range')}>{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {q.range === 'custom' && <><Field label="From"><TextInput type="date" value={q.from} onChange={set('from')} /></Field><Field label="To"><TextInput type="date" value={q.to} onChange={set('to')} /></Field></>}
          <Field label="Product"><select className="input" value={q.product} onChange={set('product')}><option value="">Both products</option><option value="real_estate">Real Estate Brokerage</option><option value="construction">Construction Management</option><option value="bundle">Bundles</option></select></Field>
          <Field label="Plan"><select className="input" value={q.plan} onChange={set('plan')}><option value="">Any plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}</select></Field>
          <Field label="Subscription status"><select className="input" value={q.status} onChange={set('status')}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Currency"><select className="input" value={q.currency} onChange={set('currency')}><option value="">Every currency</option><option value="PKR">PKR</option><option value="USD">USD</option></select></Field>
          <Field label="Workspace" hint="Address or id"><TextInput value={q.tenant} onChange={set('tenant')} placeholder="e.g. acme" /></Field>
        </div>
      </Card>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <>
          <div className="pa-kpis">
            {[['MRR', d.money.mrr, d.definitions.mrr], ['ARR (run-rate)', d.money.arr, d.definitions.arr], ['Net collections', d.money.net_collections, d.definitions.net_collections], ['Outstanding', d.money.outstanding, d.definitions.outstanding]].map(([l, m, def]) => (
              <div className="pa-kpi" key={l} title={def}><div className="l">{l}</div><div className="v" style={{ fontSize: Object.keys(m).length > 1 ? 18 : undefined }}>{money(m)}</div><div className="c">{d.workspaces} workspace(s) in filter</div></div>
            ))}
            <div className="pa-kpi"><div className="l">Active · Trialing · Past due</div><div className="v">{d.counts.active} · {d.counts.trialing} · {d.counts.past_due}</div><div className="c">{d.counts.expired} expired, {d.counts.canceled} cancelled, {d.counts.pending} pending</div></div>
            <div className="pa-kpi"><div className="l">Trial conversion</div><div className="v">{d.movement.trial_conversion_rate == null ? '—' : `${d.movement.trial_conversion_rate}%`}</div><div className="c">{d.movement.trial_converted} of {d.movement.trial_cohort} trials that ended in the period</div></div>
            <div className="pa-kpi"><div className="l">New · Renewals · Churned</div><div className="v">{d.movement.new_subscriptions} · {d.movement.renewals} · {d.movement.churned}</div><div className="c">{d.movement.upgrades} upgrades, {d.movement.downgrades} downgrades</div></div>
            <div className="pa-kpi"><div className="l">Failed payments</div><div className="v">{d.failed_payments}</div><div className="c">Provider failures and rejected bank/wallet payments</div></div>
          </div>
          <FoldCard id="Finance-Money by currency" title="Money by currency" summary="Collected, refunded and net per currency"  flush>
            <div className="table-wrap"><table className="t"><thead><tr><th>Metric</th>{currencies.map((c) => <th key={c} className="right">{c}</th>)}</tr></thead><tbody>
              {MONEY_ROWS.map(([k, l]) => <tr key={k}><td title={d.definitions[k] || ''}><b>{l}</b><div className="muted" style={{ fontSize: 12 }}>{d.definitions[k] || ''}</div></td>{currencies.map((c) => <td key={c} className="right mono">{n0(d.money[k]?.[c] || 0)}</td>)}</tr>)}
            </tbody></table></div>
            {!currencies.length && <Empty title="No revenue in this filter yet" />}
          </FoldCard>
          {!!chart.length && <Card title="Collected, refunds, net and recognised"><ResponsiveContainer width="100%" height={240}><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="currency" /><YAxis tickFormatter={n0} width={80} /><Tooltip formatter={(v) => n0(v)} /><Legend />
            <Bar dataKey="Collected" fill="#14b8a6" /><Bar dataKey="Refunds" fill="#f43f5e" /><Bar dataKey="Net" fill="#3b82f6" /><Bar dataKey="Recognised" fill="#8b5cf6" /></BarChart></ResponsiveContainer></Card>}
          <div className="pa-grid2">
            <FoldCard id="Finance-Subscribers by product" title="Subscribers by product" summary="Paying workspaces per product"  flush>
              <div className="table-wrap"><table className="t"><thead><tr><th>Product</th><th>Workspaces</th><th>Paying</th><th>On trial</th><th>MRR</th></tr></thead><tbody>
                {d.by_product.map((p) => <tr key={p.product}><td>{p.label}</td><td>{p.workspaces}</td><td>{p.paying}</td><td>{p.trialing}</td><td className="nowrap">{money(p.mrr)}</td></tr>)}
              </tbody></table></div>
            </FoldCard>
            <FoldCard id="Finance-Subscribers by plan" title="Subscribers by plan" summary="Paying workspaces per plan"  flush>
              {!d.by_plan.length ? <Empty title="No paying subscribers in this filter" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Plan</th><th>Subscribers</th><th>MRR</th></tr></thead><tbody>
                {d.by_plan.map((p) => <tr key={p.plan}><td>{p.name}<div className="muted mono">{p.plan}</div></td><td>{p.subscribers}</td><td className="nowrap">{money(p.mrr)}</td></tr>)}
              </tbody></table></div>}
            </FoldCard>
          </div>
          <div className="pa-grid3">
            <FoldCard id="Finance-Upcoming renewals (30 days)" title="Upcoming renewals (30 days)" summary="Renewals due soon"  flush>{!d.upcoming_renewals.length ? <Empty title="None" /> : <div className="table-wrap"><table className="t"><tbody>{d.upcoming_renewals.map((t) => <tr key={t.id} className="pa-link" onClick={() => nav(`/platform/workspaces/${t.id}`)}><td>{t.name}<div className="muted">{t.plan} · {t.provider || 'manual'}</div></td><td className="nowrap">{t.date}</td></tr>)}</tbody></table></div>}</FoldCard>
            <FoldCard id="Finance-Trials ending (7 days)" title="Trials ending (7 days)" summary="Trials about to end"  flush>{!d.expiring_trials.length ? <Empty title="None" /> : <div className="table-wrap"><table className="t"><tbody>{d.expiring_trials.map((t) => <tr key={t.id} className="pa-link" onClick={() => nav(`/platform/workspaces/${t.id}`)}><td>{t.name}<div className="muted">{t.product === 'construction' ? 'Construction' : 'Real estate'}</div></td><td className="nowrap">{new Date(t.ends_at).toLocaleString()}</td></tr>)}</tbody></table></div>}</FoldCard>
            <FoldCard id="Finance-Overdue payments" title="Overdue payments" summary="Payments past their due date"  flush>{!d.overdue.length ? <Empty title="None" /> : <div className="table-wrap"><table className="t"><tbody>{d.overdue.map((t) => <tr key={t.id} className="pa-link" onClick={() => nav(`/platform/workspaces/${t.id}`)}><td>{t.name}<div className="muted">{t.value ? `${t.value.currency} ${n0(t.value.amount)}/mo` : ''}</div></td><td className="nowrap">grace to {t.grace_until || '—'}</td></tr>)}</tbody></table></div>}</FoldCard>
          </div>
        </>
      )}
    </>
  );
}
