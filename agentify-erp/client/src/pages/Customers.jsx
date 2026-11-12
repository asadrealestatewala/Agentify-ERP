import { useState } from 'react';
import CustomerRecordLookup from '../components/CustomerRecordLookup.jsx';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DataTable, { ExportMenu, SearchBar, useTable, ViewsBar } from '../components/DataTable.jsx';
import { WA, WhatsAppButton, useCompanyName } from '../components/WhatsApp.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, BackLink, Card, ConfirmDialog, Field, KV, Loading, Modal, PageHead, StatusBadge } from '../components/ui.jsx';
import { api, download } from '../api.js';
import { useAuth, useFetch, useMeta, useToast } from '../context.jsx';
import { DocFooter, DocHeader } from '../components/DocBrand.jsx';
import { date, money, getRegion } from '../format.js';

const TITLES = { all: 'All customers', active: 'Active customers', buyers: 'Buyers', installment: 'Installment customers' };

export function CustomerList({ segment = 'all' }) {
  const nav = useNavigate();
  const t = useTable('/api/customers', { filters: { segment: segment === 'all' ? undefined : segment }, viewsKey: `customers-${segment}` });
  const co = useCompanyName();
  return (
    <div>
      <PageHead title={TITLES[segment]} sub={`${t.total} customer(s)`} />
      <CustomerRecordLookup />
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search by name, customer ID, phone…" /><div className="grow" /><ExportMenu url="/api/customers" params={t.params} name="customers" module="customers" /></div>
        <ViewsBar t={t} />
        <DataTable {...t.tableProps} tableId={`customers-${segment}`} onRowClick={(r) => nav(`/customers/${r.id}/360`)}
          quickActions={(r) => <>{r.phone && <a className="qa" href={`tel:${r.phone}`} title="Call" aria-label="Call"><Icon name="phone" size={13} /></a>}<WhatsAppButton phone={r.phone} text={r.overdue ? WA.overdueTotal({ name: r.full_name.split(' ')[0], amount: r.overdue }, co) : WA.hello({ name: r.full_name.split(' ')[0] }, co)} size={13} /></>} columns={[
          { key: 'full_name', label: 'Customer', render: (r) => <div className="row"><Avatar name={r.full_name} size="sm" /><div><div className="cell-main">{r.full_name}</div><div className="cell-sub">{r.customer_code && <span className="mono">{r.customer_code} · </span>}{r.phone}</div></div></div> },
          { key: 'properties', label: 'Properties', num: true }, { key: 'purchase_value', label: 'Purchase value', num: true, render: (r) => money(r.purchase_value) },
          { key: 'paid', label: 'Paid', num: true, render: (r) => <span className="pos">{money(r.paid)}</span> }, { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => money(r.outstanding) },
          { key: 'overdue', label: 'Overdue', num: true, render: (r) => (r.overdue ? <span className="neg bold">{money(r.overdue)}</span> : '—') },
          { key: 'agent_name', label: 'Agent' }, { key: 'customer_since', label: 'Customer since', render: (r) => date(r.customer_since), hidden: true },
          { key: 'has_portal', label: 'Portal', render: (r) => (r.has_portal ? <span className="pill green">Active</span> : <span className="pill grey">None</span>), hidden: true }]} />
      </Card>
    </div>
  );
}

/** Admin view of customer-portal access with reset / create. */
export function CustomerPortalAdmin() {
  const toast = useToast();
  const t = useTable('/api/customers', {});
  const [result, setResult] = useState(null);
  const [reset, setReset] = useState(null);
  const [pw, setPw] = useState('');
  const create = async (c, password) => {
    try { const r = await api.post(`/api/customers/${c.id}/portal-access`, password ? { password } : {}); setResult({ c, ...r }); t.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div>
      <PageHead title="Customer portal" sub="Customers sign in at /portal/login to see their own properties, payments, receipts and development updates." />
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search customers…" /></div>
        <DataTable {...t.tableProps} columns={[
          { key: 'full_name', label: 'Customer', render: (r) => <Link to={`/contacts/${r.id}`}>{r.full_name}</Link> }, { key: 'email', label: 'Login (email)' }, { key: 'phone', label: 'Phone' },
          { key: 'has_portal', label: 'Portal access', render: (r) => (r.has_portal ? <span className="pill green">Active</span> : <span className="pill grey">Not set up</span>) },
          { key: 'act', label: '', render: (r) => (r.has_portal ? <button className="btn sm" onClick={() => { setReset(r); setPw(''); }}>Reset password</button> : <button className="btn sm primary" onClick={() => create(r)}>Create access</button>) }]} />
      </Card>
      {result && <Modal title="Portal access" size="sm" onClose={() => setResult(null)} footer={<button className="btn primary" onClick={() => setResult(null)}>Done</button>}>
        <div className="stack">{result.password ? <div className="alert ok">Login created for {result.c.full_name}. Share securely — the password is shown once.</div> : <div className="alert ok">Done.</div>}<KV items={[['Login', result.login], result.password ? ['Password', <code>{result.password}</code>] : null]} /></div></Modal>}
      {reset && <Modal title={`Reset password — ${reset.full_name}`} size="sm" onClose={() => setReset(null)} footer={<><button className="btn" onClick={() => setReset(null)}>Cancel</button><button className="btn primary" disabled={pw.length < 8} onClick={async () => { await create(reset, pw); setReset(null); toast('Password reset', 'ok'); }}>Set password</button></>}>
        <Field label="New password" hint="Minimum 8 characters"><input className="input" type="text" value={pw} onChange={(e) => setPw(e.target.value)} /></Field></Modal>}
    </div>
  );
}

/** Printable customer account statement. */
export function CustomerStatement() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { meta } = useMeta();
  const toast = useToast();
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, error } = useFetch(`/api/customers/${id}/statement`, { sale_id: sp.get('sale') || undefined });
  const dl = async (format) => { try { await download(`/api/customers/${id}/statement`, { sale_id: sp.get('sale') || undefined, from: range.from || undefined, to: range.to || undefined, format }, `account-statement.${format}`); } catch (e) { toast(e.message, 'err'); } };
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const co = meta?.settings || {};
  return (
    <div>
      <div className="no-print"><BackLink to={`/contacts/${id}`}>Customer</BackLink><PageHead title="Customer statement"><input className="input" type="date" style={{ width: 150 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From date" /><span className="muted">to</span><input className="input" type="date" style={{ width: 150 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To date" />
          <button className="btn primary" onClick={() => dl('pdf')}><Icon name="download" size={14} />Download PDF</button><button className="btn" onClick={() => dl('xlsx')}>Excel</button><button className="btn" onClick={() => window.print()}><Icon name="print" size={14} />Print</button></PageHead></div>
      <div className="print-doc">
        <DocHeader kind="statement" title="ACCOUNT STATEMENT" extra={<div className="muted">Generated {date(data.generated_at)}</div>} />
        <KV items={[['Customer', data.customer.full_name], ['Customer ID', data.customer.customer_code], ['Phone', data.customer.phone], [getRegion().idLabel, data.customer.cnic]]} />
        {data.entries.map(({ sale: s, receipts }) => (
          <div key={s.id} style={{ marginTop: 22 }}>
            <h3 style={{ marginBottom: 6 }}>{s.kind === 'construction' ? '🏗 ' : ''}{s.property_title} <span className="muted">· {s.project_name} · {s.sale_no}</span></h3>
            <div className="grid g3" style={{ marginBottom: 8 }}>
              <div className="sum-box"><div className="l">Sale price</div><div className="v">{money(s.sale_price)}</div></div><div className="sum-box"><div className="l">Discount</div><div className="v">{money(s.discount)}</div></div><div className="sum-box"><div className="l">Net amount</div><div className="v">{money(s.net_price)}</div></div>
            </div>
            <table className="t"><thead><tr><th>Date</th><th>Receipt</th><th>Type</th><th>Method</th><th className="num">Amount</th></tr></thead>
              <tbody>{receipts.map((r) => <tr key={r.id}><td>{date(r.date)}</td><td>{r.receipt_no}</td><td>{r.payment_type}</td><td>{r.method}</td><td className="num mono">{r.payment_type === 'Refund' ? '-' : ''}{money(r.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={4}>Total paid</td><td className="num mono">{money(s.paid_amount)}</td></tr><tr><td colSpan={4}>Balance</td><td className="num mono">{money(s.outstanding)}</td></tr></tfoot></table>
            <div className="muted" style={{ marginTop: 6 }}>{s.installments_paid} of {s.num_installments} installments paid · overdue {money(s.overdue_amount)} · next payment {s.next_due ? `${date(s.next_due.due_date)} (${money(s.next_due.amount)})` : 'none'}</div>
          </div>
        ))}
        <div style={{ marginTop: 22 }}><b>Closing balance across listed sales:</b> <span className="mono">{money(data.ledger.balance)}</span></div>
        <DocFooter kind="statement" />
      </div>
    </div>
  );
}
