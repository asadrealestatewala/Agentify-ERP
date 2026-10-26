import { useMemo, useState } from 'react';
import ActivationChecklist from '../components/ActivationChecklist.jsx';
import { Link, useNavigate } from 'react-router-dom';
import { BarsChart, DonutChart, LinesChart } from '../components/Charts.jsx';
import Icon from '../components/Icon.jsx';
import Onboarding from '../components/Onboarding.jsx';
import TrainingForYou from '../components/TrainingForYou.jsx';
import TodayCards, { NeedsAttention, useToday } from '../components/TodayFeed.jsx';
import { Card, DateRangeFilter, Loading, ProgressBar, Stat, StatusBadge } from '../components/ui.jsx';
import { useAuth, useFetch } from '../context.jsx';
import { date, money, moneyShort, getRegion } from '../format.js';
import { Ring } from './Goals.jsx';

const STATUS_COLORS = { available: '#14b8a6', featured: '#38bdf8', reserved: '#f59e0b', sold: '#8b5cf6', draft: '#94a3b8', on_hold: '#d97706', cancelled: '#fb7185' };
const TAB_KEY = 'dash-tab';

function Hero({ user, d, range, setRange, today }) {
  const f = d?.finance, crm = d?.crm, ag = d?.agent, pr = d?.properties;
  const stats = [];
  if (ag) stats.push(['My leads', ag.total_leads, `${ag.active_leads} active`, '/contacts'], ['Follow-ups due', ag.followups, 'call these first', '/tasks'], ['Sales', ag.sales_count, money(ag.sales_value), '/sales']);
  else {
    if (f) stats.push(['Collected', moneyShort(f.collected), 'this period', '/receipts'], ['Overdue', f.overdue_installments.n, money(f.overdue_installments.v), '/payments/installments?status=overdue']);
    if (crm) stats.push(['New leads', crm.new_leads, `${crm.total_leads} in total`, '/leads'], ['Follow-ups', crm.followups, `${crm.followups_today} today`, '/tasks'], ['Closed sales', crm.closed, 'this period', '/sales']);
    if (f) stats.push(['Cash & bank', moneyShort(f.cash_and_bank), 'available now', '/accounting/treasury']);
    if (pr) stats.push([getRegion().config.region === 'PK' ? 'Plots available' : 'Listings available', pr.available, `${pr.reserved} reserved`, '/projects/map'], ['Sold', pr.sold, `of ${pr.total}`, '/properties/sold']);
    if (d?.hrm) {
      const unmarked = today?.cards.find((c) => c.key === 'attendance')?.count ?? 0;
      stats.push(['Team', d.hrm.headcount, 'active employees', '/hrm/employees'], ['Leave requests', d.hrm.pending_leaves, d.hrm.pending_leaves ? 'waiting for a decision' : 'none waiting', '/hrm/leave'], ['Attendance', unmarked ? unmarked : '✓', unmarked ? 'not marked today' : 'all marked today', '/hrm/attendance']);
    }
  }
  const hot = today?.cards.filter((c) => c.hot).length || 0;
  const long = new Date(Date.now() + 5 * 3600000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return (
    <div className="hero">
      <div className="hero-top">
        <div>
          <div className="kicker">{long} · {user.role}</div>
          <h2>{today?.greeting || 'Welcome'}, {user.name.split(' ')[0]}</h2>
          <p>{!today ? ' ' : today.attention ? `${today.attention} thing${today.attention === 1 ? '' : 's'} need your attention today${hot ? ` — ${hot} urgent` : ''}.` : 'You are all caught up. Nothing is waiting for you today.'}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      </div>
      <div className="hero-stats">
        {stats.slice(0, 3).map(([label, value, sub, to]) => (
          <Link key={label} to={to} className="hero-stat"><small>{label}</small><b>{value}</b><span>{sub}</span></Link>
        ))}
      </div>
    </div>
  );
}

function QuickActions() {
  const { can } = useAuth();
  const nav = useNavigate();
  const products = useFetch('/api/billing/status').data?.products;
  const re = !products || products.includes('real_estate'), con = !!products?.includes('construction');
  const items = [
    ['New lead', 'plus', 'blue', '/contacts?new=1', can('crm', 'create')], ['Receive payment', 'receipt', 'green', '/receipts/new', can('payments', 'create')],
    ['New voucher', 'wallet', 'teal', '/expenses/new', can('accounting', 'create')], [getRegion().config.region === 'PK' ? 'Book a plot' : 'New sale', 'badge', 'violet', '/sales/new', re && can('sales', 'create')], ['Construction projects', 'hardhat', 'violet', '/construction', con && can('construction', 'view')],
    ['Site report', 'file', 'blue', '/construction', con && can('construction', 'create')],
    ['Mark attendance', 'clock', 'orange', '/hrm/attendance', can('hrm', 'create')], ['Leave requests', 'calendar', 'violet', '/hrm/leave', can('hrm', 'edit')],
    ['Plot map', 'grid', 'orange', '/projects/map', re && getRegion().config.region === 'PK' && can('properties', 'view')], ['Asset library', 'layers', 'slate', '/assets', can('hrm', 'view') || can('accounting', 'view')], ['My tasks', 'check', 'rose', '/my/tasks', true],
  ].filter((x) => x[4]);
  return (
    <div className="quick" aria-label="Quick actions">
      {items.map(([l, ic, tone, to]) => <button key={l} onClick={() => nav(to)}><span className={`ic-tile sm ic-${tone}`}><Icon name={ic} size={14} /></span>{l}</button>)}
      <button onClick={() => window.dispatchEvent(new Event('erp:assistant'))}><span className="ic-tile sm ic-slate"><Icon name="chat" size={14} /></span>Ask the assistant</button>
    </div>
  );
}

/** Collected vs spent, merged by month — the reference's twin-bar chart. */
function CashChart({ d }) {
  const data = useMemo(() => {
    const m = new Map();
    for (const r of d.charts?.revenue_by_month || []) m.set(r.month, { month: r.month, collected: r.value, spent: 0 });
    for (const r of d.charts?.expenses_by_month || []) m.set(r.month, { ...(m.get(r.month) || { month: r.month, collected: 0 }), spent: r.value });
    return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  }, [d]);
  const inn = data.reduce((s, r) => s + r.collected, 0), out = data.reduce((s, r) => s + r.spent, 0);
  return (
    <Card>
      <div className="chart-head"><h3 style={{ fontSize: 15 }}>Collected and spent</h3><span className="badge">{moneyShort(inn)} in · {moneyShort(out)} out</span></div>
      <BarsChart data={data} series={[{ key: 'collected', label: 'Collected', color: '#14b8a6' }, { key: 'spent', label: 'Spent', color: '#fb7185' }]} height={230} />
    </Card>
  );
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const [range, setRange] = useState({ range: 'this_month' });
  const { data: d, loading, error } = useFetch('/api/dashboard', range);
  const today = useToday().data;
  const goals = useFetch(user.own_scope ? '/api/goals/overview' : null);
  const f = d?.finance, crm = d?.crm, pr = d?.properties, ag = d?.agent;
  const year = useFetch(d?.charts?.revenue_by_month || d?.charts?.expenses_by_month || d?.charts?.sales_by_month ? '/api/dashboard' : null, { range: 'this_year' }); // the twin-bar chart always shows the recent months
  const tabs = d ? [
    ['overview', 'Overview', 'dashboard', 'teal', true], ['leads', 'Leads & sales', 'users', 'blue', !!(crm || ag)], ['finance', 'Finance', 'wallet', 'green', !!f],
    ['inventory', 'Inventory', 'building', 'violet', !!pr && !ag], ['people', 'People', 'briefcase', 'orange', !!d.hrm],
  ].filter((t) => t[4]) : [];
  const [tab, setTabState] = useState(() => { try { return sessionStorage.getItem(TAB_KEY) || 'overview'; } catch { return 'overview'; } });
  const setTab = (t) => { setTabState(t); try { sessionStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  const active = tabs.some((t) => t[0] === tab) ? tab : 'overview';

  return (
    <div>
      {error && <div className="alert err">{error}</div>}
      {!d ? <Loading /> : (
        <div style={{ opacity: loading ? 0.7 : 1, transition: 'opacity .15s' }}>
          <Hero user={user} d={d} range={range} setRange={setRange} today={today} />
          <QuickActions />
          <Onboarding />
          {can('settings', 'edit') && !user.own_scope && <ActivationChecklist />}
          <TrainingForYou />
          <div className="dtabs" role="tablist" aria-label="Dashboard sections">
            {tabs.map(([k, l, ic, tone]) => <button key={k} role="tab" aria-selected={active === k} className={`dtab ${active === k ? 'on' : ''}`} onClick={() => setTab(k)}><span className={`ic-tile ic-${tone}`}><Icon name={ic} size={13} /></span>{l}</button>)}
          </div>

          {active === 'overview' && (
            <div className="dpane">
              <div className="dash-split">
                {d.charts?.revenue_by_month || d.charts?.expenses_by_month ? <CashChart d={year.data || d} /> : (
                  ag && goals.data?.me ? (
                    <Link to="/goals" className="card" style={{ display: 'flex', gap: 18, padding: 18, alignItems: 'center', color: 'inherit', textDecoration: 'none', flexWrap: 'wrap' }}>
                      <Ring pct={goals.data.me.daily.overall_pct} size={96} stroke={10} label="today" />
                      <div className="grow" style={{ minWidth: 200 }}>
                        <div className="bold" style={{ fontSize: 15 }}>{goals.data.me.message}</div>
                        <div className="muted" style={{ marginTop: 4 }}>{goals.data.me.opportunities.interested} interested · {goals.data.me.opportunities.follow_up} in follow-up · 🔥 {goals.data.me.streak.days}-day streak · {goals.data.me.points.month} pts</div>
                      </div>
                    </Link>
                  ) : d.hrm && !crm && !f ? (
                    <Card title="Your team">
                      <div className="grid g2">
                        {[['Active employees', d.hrm.headcount, '/hrm/employees'], ['Leave requests pending', d.hrm.pending_leaves, '/hrm/leave'], ['Attendance', 'Mark or review', '/hrm/attendance'], ['Asset library', 'Who holds what', '/assets']].map(([l, v, to]) => (
                          <Link key={l} to={to} className="sum-box" style={{ color: 'inherit', textDecoration: 'none' }}><div className="l">{l}</div><div className="v">{v}</div></Link>
                        ))}
                      </div>
                    </Card>
                  ) : (year.data || d).charts?.sales_by_month ? <Card title="Sales by month"><BarsChart data={(year.data || d).charts.sales_by_month} series={[{ key: 'value', label: 'Sales value' }]} height={230} /></Card>
                    : crm ? <Card title="Leads by stage"><DonutChart data={crm.by_stage.map((x) => ({ name: x.stage, value: x.n, color: x.color }))} isMoney={false} height={230} /></Card>
                    : <Card title="This period"><div className="muted">Pick a section above to dig into the numbers.</div></Card>
                )}
                <Card title="Needs attention" actions={today?.attention ? <span className="pill red">{today.attention}</span> : null}><NeedsAttention data={today} /></Card>
              </div>
              <TodayCards data={today} />
              {ag && goals.data?.me && d.charts?.revenue_by_month && (
                <Link to="/goals" className="card" style={{ display: 'flex', gap: 18, padding: 18, alignItems: 'center', color: 'inherit', textDecoration: 'none', margin: '14px 0', flexWrap: 'wrap' }}>
                  <Ring pct={goals.data.me.daily.overall_pct} size={80} stroke={9} label="today" />
                  <div className="grow"><div className="bold" style={{ fontSize: 15 }}>{goals.data.me.message}</div><div className="muted">🔥 {goals.data.me.streak.days}-day streak · {goals.data.me.points.month} pts</div></div>
                </Link>
              )}
            </div>
          )}

          {active === 'leads' && (
            <div className="dpane">
              {ag && (
                <>
                  <div className="card" style={{ padding: 18, marginBottom: 14 }}>
                    <div className="row wrap between">
                      <div className="row"><span className={`tier ${ag.tier}`}>{ag.tier.toUpperCase()}</span>
                        <span className="muted">{ag.lifetime_sales} lifetime sale(s){ag.next ? ` — ${ag.next.remaining} more to reach ${ag.next.name}` : ' — top tier reached'}</span></div>
                      <span className="muted">Conversion {ag.conversion_rate}%</span>
                    </div>
                    {ag.next && <div style={{ marginTop: 10 }}><ProgressBar value={Math.round(((ag.lifetime_sales) / ag.next.min) * 100)} /></div>}
                  </div>
                  <div className="grid g4">
                    <Stat label="My leads" value={ag.total_leads} sub={`${ag.active_leads} active`} to="/contacts" icon="users" />
                    <Stat label="Follow-ups due" value={ag.followups} to="/tasks" tone={ag.followups ? 'warn' : ''} icon="clock" />
                    <Stat label="Sales (period)" value={ag.sales_count} sub={money(ag.sales_value)} to="/sales" icon="badge" />
                    <Stat label="Commission pending" value={money(ag.commission_pending)} sub={`${money(ag.commission_paid)} paid`} to="/commissions" icon="wallet" />
                  </div>
                </>
              )}
              {crm && !ag && (
                <div className="grid g4">
                  <Stat label="Total leads" value={crm.total_leads} to="/contacts" icon="users" />
                  <Stat label="New leads" value={crm.new_leads} sub="in selected period" to="/contacts" icon="plus" />
                  <Stat label="Contacted" value={crm.contacted} to="/pipeline" icon="phone" />
                  <Stat label="Follow-ups due" value={crm.followups} sub={`${crm.followups_today} today`} to="/tasks" tone={crm.followups ? 'warn' : ''} icon="clock" />
                  <Stat label="Interested" value={crm.interested} to="/pipeline" tone="pos" icon="star" />
                  <Stat label="Closed sales" value={crm.closed} sub="in selected period" to="/sales" icon="badge" />
                  <Stat label="Total customers" value={crm.total_customers} to="/customers" icon="users" />
                  {d.sales && <Stat label="Sales value" value={money(d.sales.value)} sub={`${d.sales.count} sale(s)`} to="/sales" icon="dollar" />}
                </div>
              )}
              <div className="section-title">Performance</div>
              <div className="grid g2">
                {crm && <Card title="Leads by stage"><DonutChart data={crm.by_stage.map((s) => ({ name: s.stage, value: s.n, color: s.color }))} isMoney={false} /></Card>}
                {d.charts?.sales_by_month && <Card title="Sales by month"><BarsChart data={d.charts.sales_by_month} series={[{ key: 'value', label: 'Sales value' }]} /></Card>}
                {d.charts?.agent_performance && <Card title="Sales agent performance"><BarsChart isMonth={false} layout="vertical" data={d.charts.agent_performance} x="name" series={[{ key: 'value', label: 'Sales value' }]} /></Card>}
                {d.charts?.commission_performance && <Card title="Commission performance"><BarsChart isMonth={false} data={d.charts.commission_performance} x="name" series={[{ key: 'earned', label: 'Earned' }, { key: 'paid', label: 'Paid', color: '#34d399' }]} /></Card>}
              </div>
              {ag && d.tasks?.length > 0 && (
                <div style={{ marginTop: 14 }}><Card title="My open tasks" flush>
                  <table className="t"><tbody>{d.tasks.map((t) => <tr key={t.id}><td>{t.title}</td><td>{t.contact_name && <Link to={`/contacts/${t.entity_id}`}>{t.contact_name}</Link>}</td><td className="right">{date(t.due_date)}</td></tr>)}</tbody></table>
                </Card></div>
              )}
            </div>
          )}

          {active === 'finance' && f && (
            <div className="dpane">
              <div className="grid g4">
                <Stat label="Total project value" value={moneyShort(f.project_value)} sub={money(f.project_value)} icon="building" />
                <Stat label="Amount collected" value={money(f.collected)} sub="in selected period" tone="pos" to="/receipts" icon="wallet" />
                <Stat label="Amount receivable" value={money(f.receivable)} sub="all open sales" to="/payments/receivables" icon="dollar" />
                <Stat label="Total expenses" value={money(f.expenses)} sub="in selected period" tone="neg" to="/expenses" icon="receipt" />
                <Stat label="Net revenue" value={money(f.net_revenue)} sub="collected − expenses" tone={f.net_revenue >= 0 ? 'pos' : 'neg'} icon="chart" />
                <Stat label="Pending installments" value={f.pending_installments.n} sub={money(f.pending_installments.v)} to="/payments/installments" icon="calendar" />
                <Stat label="Overdue" value={f.overdue_installments.n} sub={money(f.overdue_installments.v)} tone={f.overdue_installments.n ? 'neg' : ''} to="/payments/installments?status=overdue" icon="clock" />
                <Stat label="Upcoming (30 days)" value={f.upcoming_installments.n} sub={money(f.upcoming_installments.v)} to="/payments/installments?status=upcoming" icon="calendar" />
                <Stat label="Commission payable" value={money(f.commission_payable)} sub={`${money(f.commission_pending_approval)} awaiting approval`} to="/commissions" icon="badge" />
                <Stat label="Vendor payables" value={money(f.vendor_payables)} to="/vendors/credit-book" icon="wallet" />
                <Stat label="Cash & bank" value={money(f.cash_and_bank)} to="/accounting/treasury" icon="bank" />
              </div>
              <div className="section-title">Performance</div>
              <div className="grid g2">
                {d.charts?.revenue_by_month && <Card title="Revenue (collections) by month"><LinesChart data={d.charts.revenue_by_month} series={[{ key: 'value', label: 'Collected', color: '#14b8a6' }]} /></Card>}
                {d.charts?.expenses_by_month && <Card title="Expenses by month"><BarsChart data={d.charts.expenses_by_month} series={[{ key: 'value', label: 'Expenses', color: '#fb7185' }]} /></Card>}
                {d.charts?.collection_vs_receivable && <Card title="Collection vs receivables (by due month)"><BarsChart data={d.charts.collection_vs_receivable} stacked series={[{ key: 'collected', label: 'Collected', color: '#14b8a6' }, { key: 'receivable', label: 'Receivable', color: '#f59e0b' }]} /></Card>}
                {d.charts?.project_revenue && <Card title="Project-wise revenue"><BarsChart isMonth={false} data={d.charts.project_revenue} x="name" series={[{ key: 'revenue', label: 'Sales' }, { key: 'collected', label: 'Collected', color: '#34d399' }]} /></Card>}
                {d.charts?.project_expenses && <Card title="Project-wise expenses"><BarsChart isMonth={false} data={d.charts.project_expenses} x="name" series={[{ key: 'expenses', label: 'Expenses', color: '#fb7185' }]} /></Card>}
                {d.charts?.payment_methods && <Card title="Payment method breakdown"><DonutChart data={d.charts.payment_methods.map((m) => ({ name: m.method, value: m.value }))} /></Card>}
              </div>
              {d.upcoming?.length > 0 && (
                <div style={{ marginTop: 14 }}><Card title="Installments due in the next 14 days" flush>
                  <table className="t"><thead><tr><th>Due</th><th>Customer</th><th>Type</th><th className="num">Amount</th><th /></tr></thead>
                    <tbody>{d.upcoming.map((u) => (
                      <tr key={u.id}><td>{date(u.due_date)}</td><td><Link to={`/customers/${u.contact_id}/360`}>{u.customer}</Link></td><td><StatusBadge status={u.kind} tone="blue" /></td><td className="num mono">{money(u.amount)}</td>
                        <td className="right"><Link to={`/sales/${u.sale_id}`} className="btn sm">Ledger</Link></td></tr>))}</tbody></table>
                </Card></div>
              )}
            </div>
          )}

          {active === 'inventory' && pr && (
            <div className="dpane">
              <div className="grid g4">
                <Stat label="Total properties" value={pr.total} to="/properties" icon="building" />
                <Stat label="Available" value={pr.available} to="/properties?status=available" tone="pos" icon="check" />
                <Stat label="Reserved" value={pr.reserved} to="/properties/reserved" tone="warn" icon="clock" />
                <Stat label="Sold" value={pr.sold} to="/properties/sold" icon="badge" />
              </div>
              <div className="grid g2" style={{ marginTop: 14 }}>
                <Card title="Property inventory"><DonutChart isMoney={false} data={pr.distribution.map((x) => ({ name: x.status.replace('_', ' '), value: x.n, color: STATUS_COLORS[x.status] }))} /></Card>
                <Card title="See it on the map"><div className="stack"><div className="muted">Every plot as a colour-coded tile by block — click one for its customer, balance and quick actions.</div><Link className="btn primary" to="/projects/map" style={{ alignSelf: 'flex-start' }}><Icon name="grid" size={14} />Open plot map</Link></div></Card>
              </div>
            </div>
          )}

          {active === 'people' && d.hrm && (
            <div className="dpane">
              <div className="grid g4">
                <Stat label="Active employees" value={d.hrm.headcount} to="/hrm/employees" icon="users" />
                <Stat label="Leave requests pending" value={d.hrm.pending_leaves} to="/hrm/leave" tone={d.hrm.pending_leaves ? 'warn' : ''} icon="calendar" />
                <Stat label="Attendance" value="Today" sub="Mark or review" to="/hrm/attendance" icon="clock" />
                <Stat label="Asset library" value="Open" sub="Equipment & who holds it" to="/assets" icon="layers" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
