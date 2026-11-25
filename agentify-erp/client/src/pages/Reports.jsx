import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Card, DateRangeFilter, Empty, Loading, PageHead, Select } from '../components/ui.jsx';
import { download } from '../api.js';
import { useAuth, useFetch, useLookups, useToast } from '../context.jsx';
import { date, money } from '../format.js';

const GROUPS = ['Sales', 'CRM', 'Property', 'Project', 'Financial', 'Vendor', 'Employee'];

export default function Reports() {
  const { group = 'Sales' } = useParams();
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const { can } = useAuth();
  const { projects, agents, list, accounts } = useLookups();
  const catalog = useFetch('/api/reports');
  const inGroup = (catalog.data || []).filter((r) => r.group === group);
  const key = sp.get('r') || inGroup[0]?.key;
  const [range, setRange] = useState(() => (sp.get('range') ? { range: sp.get('range'), ...(sp.get('from') ? { from: sp.get('from'), to: sp.get('to') } : {}) } : { range: 'this_year' }));
  const [flt, setFlt] = useState({});
  const { data, loading, error } = useFetch(key ? `/api/reports/${key}` : null, { ...range, ...flt });

  useEffect(() => { setFlt({}); }, [key]);
  const params = { ...range, ...flt };
  const exportAs = async (format) => { try { await download(`/api/reports/${key}`, { ...params, format }, `${key}.${format}`); } catch (e) { toast(e.message, 'err'); } };
  const fmt = (c, v) => (c.type === 'money' ? <span className="mono">{money(v)}</span> : /date|_at$/.test(c.key) && typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v) ? date(v) : v ?? '—');

  return (
    <div>
      <PageHead title={`${group} reports`} sub={data?.range ? `${date(data.range.from)} → ${date(data.range.to)}` : ''} />
      <div className="top-tabs">
        {GROUPS.filter((g) => (catalog.data || []).some((r) => r.group === g)).map((g) => <Link key={g} to={`/reports/${g}`} className={`chip ${g === group ? 'active' : ''}`}>{g}</Link>)}
      </div>
      {!catalog.data ? <Loading /> : !inGroup.length ? <Empty>You don't have access to any {group} reports.</Empty> : (
        <div className="grid" style={{ gridTemplateColumns: '220px minmax(0,1fr)', alignItems: 'start' }}>
          <Card flush><div style={{ padding: 6 }}>{inGroup.map((r) => <Link key={r.key} to={`/reports/${group}?r=${r.key}`} className={`role-item ${r.key === key ? 'active' : ''}`} style={{ color: 'var(--text)', background: r.key === key ? 'var(--primary-l)' : undefined }}>{r.title}</Link>)}</div></Card>
          <div className="stack">
            <Card>
              <div className="row wrap">
                <DateRangeFilter value={range} onChange={setRange} />
                {['Sales', 'Financial', 'Property', 'Project'].includes(group) && <div style={{ width: 170 }}><Select value={flt.project_id || ''} onChange={(v) => setFlt({ ...flt, project_id: v })} placeholder="All projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></div>}
                {['Sales', 'CRM'].includes(group) && can('crm', 'approve') && <div style={{ width: 170 }}><Select value={flt.agent_id || ''} onChange={(v) => setFlt({ ...flt, agent_id: v })} placeholder="All agents" options={agents.map((p) => ({ value: p.id, label: p.name }))} /></div>}
                {key === 'payment-collection' && <div style={{ width: 150 }}><Select value={flt.method || ''} onChange={(v) => setFlt({ ...flt, method: v })} placeholder="All methods" options={list('payment_method')} /></div>}
                {key === 'general-ledger' && <div style={{ width: 240 }}><Select value={flt.account_id || ''} onChange={(v) => setFlt({ ...flt, account_id: v })} placeholder="Select account…" options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></div>}
                <div className="grow" />
                {can(inGroup[0] && (group === 'Financial' ? 'accounting' : group === 'Employee' ? 'hrm' : group === 'Vendor' ? 'vendors' : 'reports'), 'export') && <><button className="btn primary" onClick={() => exportAs('pdf')}><Icon name="download" size={14} />PDF</button><button className="btn" onClick={() => exportAs('xlsx')}>Excel</button><button className="btn" onClick={() => exportAs('csv')}>CSV</button></>}
                <button className="btn" onClick={() => window.print()}><Icon name="print" size={14} />Print</button>
              </div>
            </Card>
            {error && <div className="alert err">{error}</div>}
            {data?.summary && <div className="sum-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>{data.summary.map((x) => <div key={x.label} className="sum-box"><div className="l">{x.label}</div><div className="v mono">{money(x.value)}</div>{x.n != null && <small className="muted">{x.n} {x.n === 1 ? 'entry' : 'entries'}</small>}</div>)}</div>}
            <Card title={data?.title || ' '} flush>
              {!data ? <Loading /> : data.note ? <Empty>{data.note}</Empty> : !data.rows.length ? <Empty>No data for this selection.</Empty> : (
                <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}><table className="t"><thead><tr>{data.columns.map((c) => <th key={c.key} className={c.type === 'money' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                  <tbody>{data.rows.map((r, i) => <tr key={i}>{data.columns.map((c) => <td key={c.key} className={c.type === 'money' ? 'num' : ''}>{fmt(c, r[c.key])}</td>)}</tr>)}</tbody>
                  {Object.keys(data.totals).length > 0 && key !== 'trial-balance' && <tfoot><tr>{data.columns.map((c, i) => <td key={c.key} className={c.type === 'money' ? 'num mono' : ''}>{i === 0 ? 'Total' : c.type === 'money' ? money(data.totals[c.key]) : ''}</td>)}</tr></tfoot>}
                  {key === 'trial-balance' && <tfoot><tr><td colSpan={3}>Total (debits must equal credits)</td><td className="num mono">{money(data.totals.debit)}</td><td className="num mono">{money(data.totals.credit)}</td></tr></tfoot>}
                </table></div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
