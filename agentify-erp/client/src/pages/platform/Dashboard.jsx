// Executive overview, system health, alerts and platform setup pages. All figures come from /api/platform/admin.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Empty, ErrorBox, Loading } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { A, PageTitle } from './AdminShell.jsx';
import { fmtWhen } from './dates.js';

const COLORS = ['#14b8a6', '#3b82f6', '#f59e0b', '#8b5cf6', '#f43f5e', '#64748b', '#22c55e', '#ec4899'];
const STATUS_COLORS = { active: '#14b8a6', suspended: '#f59e0b', cancelled: '#94a3b8' };
const axis = { fontSize: 11, fill: 'var(--muted)' };
const n0 = (v) => Number(v || 0).toLocaleString();
const RANGE_LABELS = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['prev_month', 'Previous month'], ['quarter', 'This quarter'], ['year', 'This year'], ['custom', 'Custom range']];
const shortX = (x) => (String(x).length === 7 ? new Date(`${x}-01T00:00:00Z`).toLocaleDateString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : new Date(`${x}T00:00:00Z`).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }));

function useData(url) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { setErr(''); return api.get(url).then(setD).catch((e) => setErr(e.message)); }, [url]);
  useEffect(() => { setD(null); load(); }, [load]);
  return { d, err, load };
}

function Kpi({ label, k, currency, onClick }) {
  if (!k) return null;
  if (k.hidden) return <div className="pa-kpi"><div className="l">{label}</div><div className="v">—</div><div className="c">Not included in your role</div></div>;
  const fmt = (v) => (v == null ? '—' : k.percent_unit ? `${v}%` : k.money ? `${currency} ${n0(v)}` : n0(v));
  let delta = null;
  if (k.change != null) {
    const good = k.inverse ? k.change < 0 : k.change > 0;
    const cls = k.change === 0 ? 'flat' : good ? 'up' : 'down';
    const arrow = k.change === 0 ? '→' : k.change > 0 ? '↑' : '↓';
    const txt = k.percent_unit ? `${k.change > 0 ? '+' : ''}${Math.round(k.change * 10) / 10} pts` : k.percent != null ? `${k.percent > 0 ? '+' : ''}${k.percent}%` : `${k.change > 0 ? '+' : ''}${k.money ? n0(k.change) : k.change}`;
    delta = <><span className={`pa-delta ${cls}`} aria-label={`${arrow} ${txt}`}>{arrow} {txt}</span><span>vs {fmt(k.previous)} before</span></>;
  }
  const extra = k.by_currency && Object.keys(k.by_currency).length > 1 ? Object.entries(k.by_currency).filter(([c]) => c !== currency).map(([c, v]) => `${c} ${n0(v)}`).join(' · ') : null;
  return (
    <button className="pa-kpi" onClick={onClick} title="Open the matching records">
      <div className="l">{label}</div>
      <div className="v">{fmt(k.value)}</div>
      <div className="c">{delta || <span>{k.note || (k.value == null ? 'No history for this period yet' : 'No earlier data to compare')}</span>}</div>
      {extra && <div className="c" style={{ marginTop: 4 }}>Also {extra}</div>}
      {k.past_due_now != null && <div className="c" style={{ marginTop: 4 }}>{k.past_due_now} workspace(s) past due now</div>}
      {k.detail?.cohort != null && <div className="c" style={{ marginTop: 4 }}>{k.detail.converted} of {k.detail.cohort} trials that ended</div>}
      {k.detail?.paying_at_start != null && <div className="c" style={{ marginTop: 4 }}>{k.detail.cancelled} cancelled of {k.detail.paying_at_start} paying at start</div>}
    </button>
  );
}

export function HealthBadge({ state }) { return <span className={`pa-state ${state}`}>{state === 'unknown' ? 'Not checked' : state.charAt(0).toUpperCase() + state.slice(1)}</span>; }

export function Dashboard() {
  const nav = useNavigate();
  const [q, setQ] = useState({ range: '30d', from: '', to: '' });
  const url = `${A}/dashboard?range=${q.range}${q.range === 'custom' ? `&from=${q.from}&to=${q.to}` : ''}`;
  const ready = q.range !== 'custom' || (q.from && q.to);
  const { d, err } = useData(ready ? url : `${A}/dashboard?range=30d`);
  const k = d?.kpis;
  const c = d?.charts;
  const cur = k?.currency || 'PKR';
  const cards = k && [
    ['Total workspaces', 'total_workspaces'], ['Active workspaces', 'active_workspaces'], ['Paying workspaces', 'paying_workspaces'], ['Free trials', 'trial_workspaces'],
    ['Suspended', 'suspended_workspaces'], ['Expiring subscriptions', 'expiring'], ['Monthly recurring revenue', 'mrr'], ['Annual recurring revenue', 'arr'],
    ['Payments received', 'payments_received'], ['Refunds', 'refunds'], ['Net received', 'net_received'], ['Failed / rejected payments', 'failed_payments'], ['Trial → paid conversion', 'trial_conversion'], ['Churn rate', 'churn_rate'],
  ];
  return (
    <>
      <PageTitle title="Overview" sub={d ? `${d.range.from} to ${d.range.to} (${d.range.timezone}) · compared with ${d.range.prev_from} to ${d.range.prev_to}` : 'Platform performance at a glance'}>
        <select className="input" style={{ width: 170 }} value={q.range} onChange={(e) => setQ({ ...q, range: e.target.value })} aria-label="Date range">{RANGE_LABELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {q.range === 'custom' && <><input type="date" className="input" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} aria-label="From" /><input type="date" className="input" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} aria-label="To" /></>}
      </PageTitle>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading rows={8} />) : (
        <>
          {k.snapshot_note && <p className="pa-note">{k.snapshot_note}</p>}
          <div className="pa-kpis">{cards.map(([label, key]) => <Kpi key={key} label={label} k={k[key]} currency={cur} onClick={() => nav(k[key].link)} />)}</div>
          <div className="pa-grid2">
            <Card title={`Revenue collected (${c.bucket === 'day' ? 'daily' : 'monthly'})`}>
              {!c.currencies.length ? <Empty title="No payments in this period" /> : (
                <div style={{ height: 250 }}><ResponsiveContainer><LineChart data={c.revenue} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} /><XAxis dataKey="x" tick={axis} tickFormatter={shortX} axisLine={false} tickLine={false} minTickGap={16} /><YAxis tick={axis} axisLine={false} tickLine={false} width={60} tickFormatter={n0} />
                  <Tooltip labelFormatter={shortX} formatter={(v, name) => [`${name} ${n0(v)}`, 'Collected']} />{c.currencies.length > 1 && <Legend />}
                  {c.currencies.map((cc, i) => <Line key={cc} type="monotone" dataKey={cc} stroke={COLORS[i]} strokeWidth={2} dot={false} />)}
                </LineChart></ResponsiveContainer></div>)}
            </Card>
            <Card title="New workspace registrations">
              <div style={{ height: 250 }}><ResponsiveContainer><BarChart data={c.registrations} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} /><XAxis dataKey="x" tick={axis} tickFormatter={shortX} axisLine={false} tickLine={false} minTickGap={16} /><YAxis tick={axis} allowDecimals={false} axisLine={false} tickLine={false} width={30} />
                <Tooltip labelFormatter={shortX} /><Bar dataKey="workspaces" name="New workspaces" fill="#14b8a6" radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart></ResponsiveContainer></div>
            </Card>
          </div>
          <div className="pa-grid3">
            <Card title="Workspace status">
              <Donut data={c.status} colors={(x) => STATUS_COLORS[x.name]} label={(x) => x.name.charAt(0).toUpperCase() + x.name.slice(1)} />
            </Card>
            <Card title="Active workspaces by plan"><Donut data={c.plans} /></Card>
            <Card title="Trial conversion funnel (signed up in period)">
              {!c.funnel[0].value ? <Empty title="No sign-ups in this period" /> : c.funnel.map((f) => (
                <div className="pa-funnel-row" key={f.stage}><span>{f.stage}</span><div className="pa-funnel-bar" role="img" aria-label={`${f.stage}: ${f.value}`}><div style={{ width: `${(f.value / c.funnel[0].value) * 100}%` }} /></div><b className="right">{f.value}</b></div>
              ))}
            </Card>
          </div>
          <div className="pa-grid2">
            <Card title="Payment outcomes">
              <div style={{ height: 230 }}><ResponsiveContainer><BarChart data={c.payments} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} /><XAxis dataKey="x" tick={axis} tickFormatter={shortX} axisLine={false} tickLine={false} minTickGap={16} /><YAxis tick={axis} allowDecimals={false} axisLine={false} tickLine={false} width={30} />
                <Tooltip labelFormatter={shortX} /><Legend /><Bar dataKey="succeeded" name="Paid" stackId="a" fill="#14b8a6" maxBarSize={28} /><Bar dataKey="failed" name="Failed / rejected" stackId="a" fill="#f43f5e" maxBarSize={28} radius={[6, 6, 0, 0]} />
              </BarChart></ResponsiveContainer></div>
            </Card>
            <Card title="Expiry timeline (next 8 weeks)">
              <div style={{ height: 230 }}><ResponsiveContainer><BarChart data={c.expiry_timeline} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} /><XAxis dataKey="x" tick={axis} tickFormatter={(x) => `wk of ${shortX(x)}`} axisLine={false} tickLine={false} /><YAxis tick={axis} allowDecimals={false} axisLine={false} tickLine={false} width={30} />
                <Tooltip labelFormatter={(x) => `Week starting ${shortX(x)}`} /><Legend /><Bar dataKey="trials" name="Trials ending" stackId="a" fill="#f59e0b" maxBarSize={28} /><Bar dataKey="subscriptions" name="Paid periods ending" stackId="a" fill="#3b82f6" maxBarSize={28} radius={[6, 6, 0, 0]} />
              </BarChart></ResponsiveContainer></div>
            </Card>
          </div>
          <div className="pa-grid2">
            <Card title="Top workspaces by revenue (period, net of refunds)" flush>
              {!c.top_workspaces.length ? <Empty title="No payments in this period" /> : <div className="table-wrap"><table className="t"><tbody>
                {c.top_workspaces.map((t) => <tr key={`${t.id}-${t.currency}`} style={{ cursor: 'pointer' }} onClick={() => nav(`/platform/workspaces/${t.id}`)}><td><b>{t.name}</b><div className="muted">{t.slug}</div></td><td className="muted">{t.n} payment(s)</td><td className="right mono">{t.currency} {n0(t.total)}</td></tr>)}
              </tbody></table></div>}
            </Card>
            <Card title="Recent transactions" flush actions={<button className="btn sm" onClick={() => nav('/platform/payments')}>Payments</button>}>
              {!c.recent_transactions.length ? <Empty title="No transactions yet" /> : <div className="table-wrap"><table className="t"><tbody>
                {c.recent_transactions.map((t) => <tr key={`${t.kind}-${t.id}`} style={{ cursor: 'pointer' }} onClick={() => nav(`/platform/workspaces/${t.tenant_id}`)}><td className="nowrap muted">{String(t.created_at).slice(0, 10)}</td><td><b>{t.tenant}</b><div className="muted mono">{t.reference}</div></td><td>{t.kind === 'invoice' ? 'Invoice' : t.kind === 'refund' ? 'Refund' : `Transfer · ${t.method}`}</td><td className="mono right nowrap">{t.kind === 'refund' ? '−' : ''}{t.currency} {n0(t.amount)}</td><td><span className={`pill ${t.status === 'paid' || t.status === 'approved' ? 'green' : t.status === 'pending' || t.status === 'refunded' ? 'amber' : 'red'}`}><i />{t.status}</span></td></tr>)}
              </tbody></table></div>}
            </Card>
          </div>
          <div className="pa-grid2">
            <Card title="System health" actions={<HealthBadge state={d.health.overall} />} flush>
              <div className="table-wrap"><table className="t"><tbody>
                {d.health.checks.map((h) => <tr key={h.id} style={{ cursor: h.link ? 'pointer' : undefined }} onClick={() => h.link && nav(h.link)}><td><b>{h.label}</b><div className="muted">{h.detail}</div></td><td className="right"><HealthBadge state={h.state} /></td></tr>)}
              </tbody></table></div>
            </Card>
            <Card title="Recent administrative activity" flush actions={<button className="btn sm" onClick={() => nav('/platform/audit')}>Audit log</button>}>
              {!c.recent_activity.length ? <Empty title="No console activity yet" /> : <div className="table-wrap"><table className="t"><tbody>
                {c.recent_activity.map((a) => <tr key={a.id}><td className="nowrap muted">{fmtWhen(a.created_at)}</td><td>{a.admin}</td><td>{a.action}</td></tr>)}
              </tbody></table></div>}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function Donut({ data, colors, label = (x) => x.name }) {
  const total = data.reduce((s, x) => s + x.value, 0);
  if (!total) return <Empty title="No data" />;
  return (
    <div style={{ height: 220 }}><ResponsiveContainer><PieChart>
      <Pie data={data.filter((x) => x.value)} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2}>
        {data.filter((x) => x.value).map((x, i) => <Cell key={x.name} fill={colors ? colors(x) : COLORS[i % COLORS.length]} />)}
      </Pie>
      <Tooltip formatter={(v, n) => [v, n]} /><Legend formatter={(v) => { const x = data.find((y) => y.name === v); return `${label(x)} (${x.value})`; }} />
    </PieChart></ResponsiveContainer></div>
  );
}

export function HealthPage() {
  const nav = useNavigate();
  const { d, err, load } = useData(`${A}/health`);
  return (
    <>
      <PageTitle title="System health" sub="Only verified results are shown as healthy. Items nothing has checked are marked “Not checked”."><button className="btn sm" onClick={load}>Check again</button></PageTitle>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <Card title={<span>Overall <HealthBadge state={d.overall} /></span>} actions={<span className="muted">Checked {new Date(d.checked_at).toLocaleTimeString()}{d.unknown ? ` · ${d.unknown} not checked` : ''}</span>} flush>
          <div className="table-wrap"><table className="t"><thead><tr><th>Component</th><th>Status</th><th>Detail</th><th /></tr></thead><tbody>
            {d.checks.map((h) => <tr key={h.id}><td><b>{h.label}</b></td><td><HealthBadge state={h.state} /></td><td>{h.detail}</td><td className="right">{h.link && <button className="btn sm" onClick={() => nav(h.link)}>Open</button>}</td></tr>)}
          </tbody></table></div>
        </Card>
      )}
    </>
  );
}

export function NotificationsPage() {
  const nav = useNavigate();
  const [all, setAll] = useState(false);
  const { d, err, load } = useData(`${A}/notifications${all ? '?all=1' : ''}`);
  const mark = async (ids) => { await api.post(`${A}/notifications/read`, { ids }); load(); window.dispatchEvent(new Event('pa:notifications')); };
  return (
    <>
      <PageTitle title="Alerts" sub="Raised automatically every hour and whenever the console is opened. An alert closes by itself when its cause is fixed.">
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show resolved</label>
        <button className="btn sm" onClick={() => mark('all')}>Mark all read</button>
      </PageTitle>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <Card flush>
          {!d.items.length ? <Empty title="Nothing needs your attention" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Alert</th><th>Raised</th><th>Status</th><th /></tr></thead><tbody>
            {d.items.map((n) => (
              <tr key={n.id} style={{ fontWeight: n.read || n.resolved ? 400 : 600 }}>
                <td><span className={`pa-sev ${n.severity}`} />{n.title}<div className="muted" style={{ fontWeight: 400 }}>{n.body}</div></td>
                <td className="nowrap muted">{fmtWhen(n.created_at)} UTC</td>
                <td>{n.resolved ? <span className="pill grey"><i />Resolved</span> : n.read ? <span className="pill blue"><i />Read</span> : <span className="pill amber"><i />New</span>}</td>
                <td className="right nowrap">{!n.read && !n.resolved && <button className="btn sm ghost" onClick={() => mark([n.id])}>Mark read</button>} {n.link && <button className="btn sm" onClick={() => { if (!n.read) mark([n.id]); nav(n.link); }}>Open</button>}</td>
              </tr>
            ))}
          </tbody></table></div>}
        </Card>
      )}
    </>
  );
}

export function SetupPage() {
  const nav = useNavigate();
  const { d, err } = useData(`${A}/setup`);
  const where = { security: '/platform/security', admins: '/platform/admins', stripe: '/platform/billing/stripe', accounts: '/platform/billing/accounts', backups: '/platform/backups' };
  return (
    <>
      <PageTitle title="Platform setup" sub="Credentials and configuration to have in place before taking paying customers. Server settings are environment variables in run-agentify-erp.bat or your hosting panel." />
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <Card title={`${d.filter((s) => s.ok).length} of ${d.length} done`} flush>
          <div className="table-wrap"><table className="t"><tbody>
            {d.map((s) => <tr key={s.id}><td style={{ width: 120 }}><span className={`pa-state ${s.ok ? 'healthy' : 'degraded'}`}>{s.ok ? 'Done' : 'To do'}</span></td><td><b>{s.label}</b><div className="muted">{s.detail}</div></td>
              <td className="right">{where[s.where] ? <button className="btn sm" onClick={() => nav(where[s.where])}>Open</button> : <span className="muted">Server setting</span>}</td></tr>)}
          </tbody></table></div>
        </Card>
      )}
    </>
  );
}
