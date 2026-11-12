import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BarsChart } from '../components/Charts.jsx';
import DataTable, { ExportMenu, SearchBar, useTable, ViewsBar } from '../components/DataTable.jsx';
import Icon from '../components/Icon.jsx';
import ResourcePage, { FormModal } from '../components/ResourcePage.jsx';
import { DocumentsPanel } from '../components/Uploaders.jsx';
import { BackLink, Card, Check, ConfirmDialog, CurrencyInput, DateRangeFilter, Empty, Field, KV, LedgerSummary, Loading, PageHead, Select, Stat, StatusBadge } from '../components/ui.jsx';
import { api, download } from '../api.js';
import { ExpensePreview } from '../components/VoucherPreview.jsx';
import { useAuth, useFetch, useLookups, useMeta, useToast, useUndoDelete } from '../context.jsx';
import { date, money, todayPK, getRegion } from '../format.js';
import { DocFooter, DocHeader } from '../components/DocBrand.jsx';
import { WA, useSharePdf, waLink, waNumber } from '../components/WhatsApp.jsx';
import { Modal } from '../components/ui.jsx';

const vendorFields = () => [
  { name: 'name', label: 'Vendor name', required: true }, { name: 'company', label: 'Company' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email', type: 'email' },
  { name: 'category', label: 'Vendor category', type: 'select', lookup: 'vendor_category' }, { name: 'cnic_tax', label: `${getRegion().idLabel} / Tax ID` }, { name: 'payment_terms', label: 'Payment terms', placeholder: 'e.g. Net 30' },
  { name: 'address', label: 'Address', full: true }, { name: 'bank_details', label: 'Bank details', type: 'textarea' }, { name: 'notes', label: 'Notes', type: 'textarea' }, { name: 'active', label: 'Active', type: 'bool' },
];

export function VendorList() {
  const { list } = useLookups();
  return (
    <ResourcePage title="Vendors" sub="Suppliers, contractors and service providers" endpoint="/api/accounting/vendors" module="vendors" noun="vendor" tableId="vendors" exportName="vendors"
      fields={vendorFields()} defaults={{ active: 1 }} filterUI={(t) => <div style={{ width: 190 }}><Select value={t.extra.category || ''} onChange={(v) => t.setFilter({ category: v })} placeholder="All categories" options={list('vendor_category')} /></div>}
      columns={[{ key: 'name', label: 'Vendor', render: (r) => <div><Link to={`/vendors/${r.id}`} className="cell-main">{r.name}</Link>{r.is_demo ? <span className="demo-chip">DEMO</span> : null}<div className="cell-sub">{[r.vendor_code, r.company].filter(Boolean).join(' · ')}</div></div> }, { key: 'category', label: 'Category' }, { key: 'phone', label: 'Phone' }, { key: 'payment_terms', label: 'Terms' },
        { key: 'balance', label: 'Payable', num: true, render: (r) => <span className={r.balance > 0 ? 'warn bold' : ''}>{money(r.balance)}</span> }, { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> }]}
      rowActions={(r) => <Link to={`/vendors/${r.id}`}>Open ledger</Link>} canDeleteRow={() => true} />
  );
}

export function VendorDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { treasury } = useLookups();
  const { data, error, reload } = useFetch(`/api/accounting/vendors-ledger/${id}`);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const portal = useFetch(`/api/accounting/vendors/${id}/portal`);
  const [access, setAccess] = useState(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const v = data.vendor;
  const purchases = data.entries.reduce((s, e) => s + e.purchase, 0), paid = data.entries.reduce((s, e) => s + e.payment, 0);
  return (
    <div>
      <BackLink to="/vendors">Vendors</BackLink>
      <PageHead title={v.name} sub={`${v.vendor_code ? v.vendor_code + ' · ' : ''}${v.category || 'Vendor'}${v.phone ? ' · ' + v.phone : ''}`}>
        {can('vendors', 'edit') && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Edit</button>}
        {can('accounting', 'create') && data.balance > 0 && <button className="btn primary" onClick={() => setPaying(true)}>Pay vendor</button>}
        {can('accounting', 'create') && <Link className="btn" to={`/expenses/new?vendor=${v.id}`}>New purchase</Link>}
        <button className="btn" onClick={() => window.print()}><Icon name="print" size={14} />Print</button>
      </PageHead>
      <LedgerSummary items={[{ label: 'Total purchases', value: purchases }, { label: 'Payments made', value: paid, tone: 'pos' }, { label: 'Outstanding', value: data.balance, tone: data.balance ? 'warn' : 'pos' }]} />
      <div style={{ height: 12 }} />
      <Card title="Vendor ledger" flush>
        <table className="t"><thead><tr><th>Date</th><th>Journal</th><th>Description</th><th>Project</th><th className="num">Purchase (credit)</th><th className="num">Payment (debit)</th><th className="num">Balance</th></tr></thead>
          <tbody>{data.entries.map((e, i) => <tr key={i}><td>{date(e.date)}</td><td className="mono">{e.journal_no}</td><td>{e.description}</td><td>{e.project_name}</td><td className="num mono">{e.purchase ? money(e.purchase) : ''}</td><td className="num mono">{e.payment ? money(e.payment) : ''}</td><td className="num mono">{money(e.balance)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4}>Outstanding</td><td className="num mono">{money(purchases)}</td><td className="num mono">{money(paid)}</td><td className="num mono">{money(data.balance)}</td></tr></tfoot></table>
        {!data.entries.length && <Empty>No transactions yet.</Empty>}
      </Card>
      <div style={{ height: 12 }} />
      <div className="grid g2">
        <Card title="Details"><KV items={[['Company', v.company], ['Email', v.email], ['Address', v.address], [`${getRegion().idLabel} / Tax ID`, v.cnic_tax], ['Payment terms', v.payment_terms], ['Bank details', v.bank_details], ['Notes', v.notes]]} /></Card>
        <Card title="Vendor portal">
          <div className="stack">
            {portal.data?.has_portal ? <div className="row between wrap"><span>Login <b>{portal.data.login}</b>{portal.data.last_login ? <span className="muted"> · last sign-in {date(portal.data.last_login)}</span> : <span className="muted"> · never signed in</span>}</span><span className="pill green">Active</span></div>
              : <div className="muted">The vendor can see their payments, balance and ledger, and bid on open contracts, once they have a portal login.</div>}
            {can('vendors', 'edit') && <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={async () => { try { setAccess(await api.post(`/api/accounting/vendors/${v.id}/portal-access`, {})); portal.reload(); } catch (e) { toast(e.message, 'err'); } }}>{portal.data?.has_portal ? 'Reset password' : 'Create portal login'}</button>}
            {!v.email && can('vendors', 'edit') && <div className="alert warn">Add an e-mail address (Edit) — it becomes the vendor’s login.</div>}
          </div>
        </Card>
        <Card title="Documents"><DocumentsPanel entityType="vendor" entityId={v.id} canEdit={can('vendors', 'edit')} categories={['Contract', 'Invoice', 'Tax', 'Other']} /></Card>
      </div>
      {paying && <FormModal title={`Pay ${v.name}`} size="sm" submitLabel="Record payment" initial={{ amount: data.balance, date: todayPK(), method: 'Bank Transfer' }}
        fields={[{ name: 'amount', label: 'Amount', type: 'money', required: true, hint: `Outstanding ${money(data.balance)} — applied to the oldest bills first` }, { name: 'account_id', label: 'Pay from', type: 'select', number: true, required: true, options: treasury.map((a) => ({ value: a.id, label: a.name })) },
          { name: 'method', label: 'Method', type: 'select', lookup: 'payment_method', allowEmpty: false }, { name: 'date', label: 'Date', type: 'date' }, { name: 'reference_no', label: 'Reference' }]}
        onClose={() => setPaying(false)} onSave={async (f) => { await api.post(`/api/accounting/vendors/${v.id}/pay`, f); toast('Payment recorded', 'ok'); setPaying(false); reload(); }} />}
      {access && (
        <Modal title="Vendor portal login" size="sm" onClose={() => setAccess(null)} footer={<><button className="btn" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/vendor/login\nLogin: ${access.login}\nPassword: ${access.password}`); toast('Copied', 'ok'); }}>Copy</button>
          {v.phone && <a className="btn success" target="_blank" rel="noreferrer" href={waLink(v.phone, `Assalam o Alaikum ${v.name}, your vendor portal is ready.\n\nLink: ${window.location.origin}/vendor/login\nLogin: ${access.login}\nPassword: ${access.password}\n\nPlease change the password after signing in.`)}><Icon name="whatsapp" size={14} />Send on WhatsApp</a>}
          <button className="btn primary" onClick={() => setAccess(null)}>Done</button></>}>
          <div className="stack"><div className="alert warn">Shown only once — note it down or send it now.</div>
            <KV items={[['Sign in at', `${window.location.origin}/vendor/login`], ['Login', access.login], ['Password', <b className="mono">{access.password}</b>]]} /></div>
        </Modal>
      )}
      {editing && <FormModal title="Edit vendor" fields={vendorFields()} initial={v} onClose={() => setEditing(false)} onSave={async (f) => { await api.put(`/api/accounting/vendors/${v.id}`, f); setEditing(false); reload(); toast('Saved', 'ok'); }} />}
    </div>
  );
}

export function VendorLedgerPicker() {
  const nav = useNavigate();
  const t = useTable('/api/accounting/vendors', { limit: 100 });
  return (
    <div>
      <PageHead title="Vendor ledger" sub="Choose a vendor to open their ledger" />
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search vendors…" /></div>
        <DataTable {...t.tableProps} onRowClick={(r) => nav(`/vendors/${r.id}`)} columns={[{ key: 'name', label: 'Vendor', render: (r) => <span className="cell-main">{r.name}</span> }, { key: 'category', label: 'Category' }, { key: 'balance', label: 'Outstanding', num: true, render: (r) => money(r.balance) }]} />
      </Card>
    </div>
  );
}

export function CreditBook() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [all, setAll] = useState(false);
  const { data } = useFetch('/api/accounting/credit-book', { all: all ? 1 : undefined });
  if (!data) return <Loading />;
  const buckets = ['Current', '1-30', '31-60', '61-90', '90+'];
  return (
    <div>
      <PageHead title="Credit book" sub="Credit purchases, payments against credit and aging"><Check checked={all} onChange={setAll}>Show settled</Check></PageHead>
      <div className="grid g-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', marginBottom: 12 }}>
        <Stat label="Total outstanding" value={money(data.total_outstanding)} tone="warn" />
        {buckets.map((b) => <Stat key={b} label={b === 'Current' ? 'Not yet due' : `${b} days overdue`} value={money(data.aging[b] || 0)} tone={b !== 'Current' && data.aging[b] ? 'neg' : ''} />)}
      </div>
      <Card flush><div className="table-wrap"><table className="t"><thead><tr><th>Voucher</th><th>Vendor</th><th>Project</th><th>Description</th><th>Bill date</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Outstanding</th><th>Aging</th></tr></thead>
        <tbody>{data.rows.map((r) => <tr key={r.id} className="click" onClick={() => nav(`/expenses/${r.id}`)}><td className="cell-main">{r.voucher_no}</td><td><Link to={`/vendors/${r.vendor_id}`} onClick={(e) => e.stopPropagation()}>{r.vendor_name}</Link></td><td>{r.project_name}</td><td>{r.description}</td><td>{date(r.date)}</td><td>{date(r.due_date)}</td><td className="num mono">{money(r.amount)}</td><td className="num mono">{money(r.paid_amount)}</td><td className="num mono bold">{money(r.outstanding)}</td>
          <td>{r.bucket === 'Settled' ? <StatusBadge status="paid" /> : r.bucket === 'Current' ? <span className="pill green">Current</span> : <span className="pill red">{r.bucket} days</span>}</td></tr>)}</tbody></table>
        {!data.rows.length && <Empty>No open credit purchases.</Empty>}</div></Card>
    </div>
  );
}

// ---------------------------------------------------------------- Expense vouchers
function BreakdownBars({ title, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card title={title}>
      {rows.length ? rows.map((r) => (
        <div key={r.label} style={{ marginBottom: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: 13 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label} <span className="muted">· {r.n}</span></span><b className="mono" style={{ whiteSpace: 'nowrap' }}>{money(r.total)}</b></div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--hover)', marginTop: 4 }}><div style={{ height: '100%', width: `${Math.max(2, (r.total / max) * 100)}%`, borderRadius: 4, background: 'var(--brand, #0e7c6b)' }} /></div>
        </div>
      )) : <Empty>No spend in this view.</Empty>}
    </Card>
  );
}

/** Overview above the voucher list; follows the list's search, project, status and date filters. */
function ExpenseSummary({ t }) {
  const { q, extra } = t;
  const params = { q, project_id: extra.project_id, status: extra.status, range: extra.range, from: extra.from, to: extra.to };
  const { data: s } = useFetch('/api/accounting/expenses/summary', params);
  if (!s) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Stat label="Total spend" value={money(s.total)} sub={`${s.n - s.rejected_n} voucher(s)`} icon="wallet" />
        <Stat label="This month" value={money(s.this_month)} sub={`${s.this_month_n} voucher(s)`} icon="calendar" />
        <Stat label="Approved" value={money(s.approved)} sub={`${money(s.paid)} paid`} tone="green" icon="check" />
        <Stat label="Pending approval" value={money(s.pending)} sub={s.rejected_n ? `${s.pending_n} waiting · ${s.rejected_n} rejected` : `${s.pending_n} waiting`} icon="clock" />
      </div>
      <div className="grid g2">
        <BreakdownBars title="By expense category" rows={s.by_category} />
        <BreakdownBars title="By project" rows={s.by_project} />
      </div>
    </div>
  );
}

export function ExpenseList({ vendorsOnly }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const { projects } = useLookups();
  const [qsp] = useSearchParams();
  const t = useTable('/api/accounting/expenses', { filters: { status: qsp.get('status') || undefined }, viewsKey: 'expenses' });
  return (
    <div>
      <PageHead title={vendorsOnly ? 'Purchases' : 'Expense vouchers'} sub={`${t.total} voucher(s)`}>{can('accounting', 'create') && <Link className="btn primary" to="/expenses/new"><Icon name="plus" size={14} />New voucher</Link>}</PageHead>
      {!vendorsOnly && <div style={{ marginBottom: 12 }}><DateRangeFilter value={{ range: t.extra.range || 'all', from: t.extra.from, to: t.extra.to }} onChange={(v) => t.setFilter({ range: v.range, from: v.from, to: v.to })} /></div>}
      {!vendorsOnly && <ExpenseSummary t={t} />}
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search voucher, vendor, description…" />
          <div style={{ width: 170 }}><Select value={t.extra.project_id || ''} onChange={(v) => t.setFilter({ project_id: v })} placeholder="All projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></div>
          <div style={{ width: 150 }}><Select value={t.extra.status || ''} onChange={(v) => t.setFilter({ status: v })} placeholder="All statuses" options={['created', 'submitted', 'approved', 'partial', 'paid', 'rejected']} /></div>
          <div className="grow" /><ExportMenu url="/api/accounting/expenses" params={t.params} name="expense-vouchers" module="accounting" /></div>
        <ViewsBar t={t} />
        <DataTable {...t.tableProps} hiddenIds={useUndoDelete('expenses').hidden} tableId="expenses"
          quickActions={(r) => r.status === 'rejected' ? null : <button className="qa wa" title="Send on WhatsApp" aria-label={`Send ${r.voucher_no} on WhatsApp`} onClick={() => nav(`/expenses/${r.id}`, { state: { offer: r.status === 'paid' ? 'paid' : ['approved', 'partial'].includes(r.status) ? 'approved' : 'send' } })}><Icon name="whatsapp" size={13} /></button>} onRowClick={(r) => nav(`/expenses/${r.id}`)} columns={[
          { key: 'voucher_no', label: 'Voucher', render: (r) => <span className="cell-main">{r.voucher_no}{r.is_demo ? <span className="demo-chip">DEMO</span> : null}</span> }, { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'project_name', label: 'Project' }, { key: 'vendor_name', label: 'Vendor', render: (r) => r.vendor_name || '—' }, { key: 'expense_account_name', label: 'Expense' }, { key: 'description', label: 'Description' },
          { key: 'amount', label: 'Amount', num: true, render: (r) => money(r.amount) }, { key: 'paid_amount', label: 'Paid', num: true, render: (r) => money(r.paid_amount), hidden: true },
          { key: 'is_credit', label: 'Credit', render: (r) => (r.is_credit ? <span className="pill amber">Credit</span> : '') }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }]} />
      </Card>
    </div>
  );
}

export function ExpenseForm() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can, user } = useAuth();
  const { projects, expenseAccounts, treasury, list } = useLookups();
  const [vendors, setVendors] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [f, setF] = useState({ date: todayPK(), project_id: Number(sp.get('project')) || '', sale_id: Number(sp.get('sale')) || '', vendor_id: Number(sp.get('vendor')) || '', expense_account_id: '', description: '', quantity: 1, unit_cost: '', amount: '', payment_method: 'Cash', reference_no: '', paid_from_account_id: '', is_credit: false, due_date: '', notes: '', show_paid_from: false, is_asset: false, asset: { units: 1, name: '', category: '', brand_model: '', serial_no: '', warranty_until: '' } });
  const [mode, setMode] = useState('pay');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { api.get('/api/accounting/vendors', { limit: 500 }).then((r) => setVendors(r.rows)).catch(() => {}); }, []);
  useEffect(() => { api.get('/api/sales', { kind: 'construction', status: 'confirmed', limit: 300 }).then((r) => setContracts(r.rows)).catch(() => {}); }, []);
  const total = f.amount !== '' ? Number(f.amount) : Math.round((Number(f.quantity) || 0) * (Number(f.unit_cost) || 0));
  const approver = can('accounting', 'approve');
  const account = expenseAccounts.find((x) => x.id === f.expense_account_id);
  const isAsset = !!f.is_asset || account?.code === '5800';
  const setAsset = (k, v) => setF((x) => ({ ...x, asset: { ...x.asset, [k]: v } }));
  const units = Math.max(1, Math.min(500, Math.floor(Number(f.asset.units)) || 1));
  const submit = async (kind, send = false) => {
    setBusy(true);
    try {
      const { asset, ...rest } = f;
      const body = { ...rest, asset_info: isAsset ? asset : undefined, is_asset: isAsset, project_id: f.project_id || null, sale_id: f.sale_id || null, vendor_id: f.vendor_id || null, amount: total, is_credit: kind === 'credit' || f.is_credit };
      if (kind === 'pay') { body.pay_now = true; body.is_credit = false; }
      if (kind === 'credit') { body.is_credit = true; body.submit = true; }
      if (kind === 'draft') body.is_credit = f.is_credit;
      const r = await api.post('/api/accounting/expenses', body);
      toast(kind === 'pay' ? 'Expense approved and paid' : 'Voucher saved', 'ok');
      nav(`/expenses/${r.id}`, { state: send && body.vendor_id ? { offer: kind === 'pay' ? 'paid' : 'send' } : kind === 'pay' && body.vendor_id ? { offer: 'paid' } : undefined });
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <BackLink to="/expenses">Expense vouchers</BackLink>
      <PageHead title="New expense voucher" sub="Approved expenses post to the project's financial position; credit purchases increase the vendor payable." />
      <div className="form-split">
      <div>
      <Card>
        <div className="form-grid">
          <Field label="Date" required><input className="input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Project"><Select value={f.project_id} onChange={(v) => set('project_id', v ? Number(v) : '')} options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="No project (company expense)" /></Field>
          {contracts.length > 0 && <Field label="Construction contract (optional)" hint="Tag the cost to a customer’s house to see the contract’s real margin" className="full"><Select value={f.sale_id} onChange={(v) => { const c = contracts.find((x) => x.id === Number(v)); setF((x) => ({ ...x, sale_id: v ? Number(v) : '', project_id: c ? c.project_id : x.project_id })); }} options={contracts.filter((c) => !f.project_id || c.project_id === Number(f.project_id) || c.id === f.sale_id).map((c) => ({ value: c.id, label: `${c.customer_name} — ${c.property_title} (${c.sale_no})` }))} placeholder="Not tied to a contract" /></Field>}
          <Field label="Vendor"><Select value={f.vendor_id} onChange={(v) => set('vendor_id', v ? Number(v) : '')} options={vendors.map((v) => ({ value: v.id, label: `${v.name}${v.category ? ' · ' + v.category : ''}` }))} placeholder="No vendor" /></Field>
          <Field label="Expense account" required><Select value={f.expense_account_id} onChange={(v) => set('expense_account_id', Number(v))} options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></Field>
          <Field label="Description" className="full"><input className="input" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. 50,000 bricks for Block A" /></Field>
          <Field label="Quantity"><input className="input" type="number" min="0" step="any" value={f.quantity} onChange={(e) => { set('quantity', e.target.value); set('amount', ''); }} /></Field>
          <Field label="Unit cost"><CurrencyInput value={f.unit_cost} onChange={(v) => { set('unit_cost', v); set('amount', ''); }} /></Field>
          <Field label="Total amount" hint="Quantity × unit cost, or enter a fixed amount" className="full"><CurrencyInput value={total || ''} onChange={(v) => set('amount', v)} /></Field>
          <Field label="Payment method"><Select allowEmpty={false} value={f.payment_method} onChange={(v) => set('payment_method', v)} options={list('payment_method')} /></Field>
          <Field label="Paid from"><Select value={f.paid_from_account_id} onChange={(v) => set('paid_from_account_id', v ? Number(v) : '')} options={treasury.map((a) => ({ value: a.id, label: a.name }))} placeholder="Select account…" /></Field>
          <Field label="Printed voucher" className="full" hint="Vendors usually should not see which company account paid them. The account is always recorded in the books; this only controls whether it is printed on the voucher and PDF."><Check checked={f.show_paid_from} onChange={(v) => set('show_paid_from', v)}>Show “Paid from” on the printed voucher</Check></Field>
          <Field label="Reference number"><input className="input" value={f.reference_no} onChange={(e) => set('reference_no', e.target.value)} /></Field>
          <Field label="Due date (credit purchases)"><input className="input" type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>
          <Field label="Notes" className="full"><textarea className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <Field label="Asset purchase" className="full"><Check checked={isAsset} onChange={(v) => set('is_asset', v)}>This voucher buys an asset (saved to the Asset Library when approved)</Check></Field>
          {isAsset && <>
            <div className="full alert info">Cost, purchase date and vendor are taken from this voucher — add only what is known about the item. Anything left blank can be completed later in the Asset Library.</div>
            <Field label="Number of units" hint={units > 1 ? `${units} assets will be created and the cost split between them` : ''}><input className="input" type="number" min="1" max="500" value={f.asset.units} onChange={(e) => setAsset('units', e.target.value)} /></Field>
            <Field label="Asset name" hint="Defaults to the description"><input className="input" value={f.asset.name} onChange={(e) => setAsset('name', e.target.value)} placeholder="e.g. Dell Latitude laptop" /></Field>
            <Field label="Category"><Select value={f.asset.category} onChange={(v) => setAsset('category', v)} options={list('asset_category')} placeholder="Select…" /></Field>
            <Field label="Brand / model"><input className="input" value={f.asset.brand_model} onChange={(e) => setAsset('brand_model', e.target.value)} /></Field>
            <Field label="Serial / IMEI" hint={units > 1 ? 'Serial numbers are added per unit in the library' : ''}><input className="input" disabled={units > 1} value={units > 1 ? '' : f.asset.serial_no} onChange={(e) => setAsset('serial_no', e.target.value)} /></Field>
            <Field label="Warranty until"><input className="input" type="date" value={f.asset.warranty_until} onChange={(e) => setAsset('warranty_until', e.target.value)} /></Field>
          </>}
        </div>
        <div className="muted" style={{ marginTop: 10 }}>Attachments (invoice, bill photo) can be added on the voucher page after saving.</div>
      </Card>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <Link className="btn" to="/expenses">Cancel</Link>
        <button className="btn" disabled={busy || !total} onClick={() => submit('draft')}>Save draft</button>
        {f.vendor_id && <button className="btn success" disabled={busy || !total} onClick={() => submit('draft', true)} title="Save the voucher, then send it to the vendor on WhatsApp"><Icon name="whatsapp" size={14} />Save & send on WhatsApp</button>}
        {f.vendor_id && <button className="btn" disabled={busy || !total} onClick={() => submit('credit')}>Credit purchase (submit)</button>}
        {approver && <button className="btn primary" disabled={busy || !total || !f.paid_from_account_id} onClick={() => submit('pay')} title={!f.paid_from_account_id ? 'Choose the account the money is paid from' : ''}>Approve & pay now</button>}
      </div>
      </div>
      <div className="side">
        <ExpensePreview f={f} total={total} project={projects.find((x) => x.id === f.project_id)} contract={contracts.find((x) => x.id === f.sale_id)} vendor={vendors.find((x) => x.id === f.vendor_id)}
          account={account} paidFrom={treasury.find((x) => x.id === f.paid_from_account_id)} creator={user} assetUnits={isAsset ? units : 0} />
      </div>
      </div>
    </div>
  );
}

export function ExpenseDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { treasury } = useLookups();
  const { meta } = useMeta();
  const co = meta?.settings || {};
  const { data: e, error, reload } = useFetch(`/api/accounting/expenses/${id}`);
  const [paying, setPaying] = useState(false);
  const [togglingPaidFrom, setTogglingPaidFrom] = useState(false);
  const undoX = useUndoDelete('expenses');
  const loc = useLocation();
  const sharePdf = useSharePdf();
  const [wa, setWa] = useState(null); // { kind: 'approved' | 'paid' | null, phone }
  const [waBusy, setWaBusy] = useState(false);
  useEffect(() => { // arriving from "Approve & pay now": offer to send the voucher straight away
    if (loc.state?.offer && e) { setWa({ kind: loc.state.offer === 'send' ? null : loc.state.offer, phone: e.vendor_phone || '' }); nav(loc.pathname, { replace: true, state: null }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e?.id]);
  const [del, setDel] = useState(false);
  const nav = useNavigate();
  if (error) return <div className="alert err">{error}</div>;
  if (!e) return <Loading />;
  const act = async (a, msg) => { try { await api.post(`/api/accounting/expenses/${e.id}/${a}`); toast(msg, 'ok'); reload(); if (a === 'approve' && e.vendor_id) setWa({ kind: 'approved', phone: e.vendor_phone || '' }); } catch (er) { toast(er.message, 'err'); } };
  const companyName = co.company_name || 'Agentify ERP';
  const sendWa = async () => {
    if (!waNumber(wa.phone)) return toast('Enter the vendor’s WhatsApp number (e.g. 0300-1234567)', 'err');
    setWaBusy(true);
    await sharePdf({ pdfUrl: `/api/accounting/expenses/${e.id}/pdf`, filename: `expense-${e.voucher_no}.pdf`, phone: wa.phone,
      text: WA.voucher({ name: e.vendor_name || 'Sir/Madam', amount: wa.kind === 'paid' ? (e.paid_amount || e.amount) : e.amount, voucher_no: e.voucher_no, description: e.description, kind: wa.kind }, companyName) });
    setWaBusy(false); setWa(null);
  };
  const bal = e.amount - e.paid_amount;
  const paidFromName = e.paid_from_name || e.payments?.[0]?.account_name;
  const togglePaidFrom = async (show) => { setTogglingPaidFrom(true); try { await api.post(`/api/accounting/expenses/${e.id}/show-paid-from`, { show }); toast(show ? 'Paid-from account will be printed on the voucher' : 'Paid-from account hidden from the printed voucher', 'ok'); reload(); } catch (er) { toast(er.message, 'err'); } finally { setTogglingPaidFrom(false); } };
  const steps = ['created', 'submitted', 'approved', 'paid'];
  const at = e.status === 'partial' ? 2 : e.status === 'rejected' ? 0 : steps.indexOf(e.status);
  return (
    <div>
      <div className="print-only print-doc">
        <DocHeader kind="expense" title={co.expense_title || 'EXPENSE VOUCHER'} number={e.voucher_no} />
        <div className="grid g2" style={{ marginBottom: 12 }}>
          <KV items={[['Date', date(e.date)], ['Project', e.project_name || '—'], e.sale_id ? ['Contract', `${e.contract_no} — ${e.contract_customer}`] : null, ['Vendor', e.vendor_name || '—'], e.vendor_code ? ['Vendor no.', e.vendor_code] : null, e.vendor_phone ? ['Vendor contact no.', e.vendor_phone] : null, e.vendor_email ? ['Vendor email', e.vendor_email] : null, ['Expense account', `${e.expense_account_code} ${e.expense_account_name}`], ['Description', e.description]].filter(Boolean)} />
          <KV items={[['Quantity × unit cost', `${e.quantity} × ${money(e.unit_cost)}`], ['Payment method', e.payment_method], e.show_paid_from && paidFromName ? ['Paid from', paidFromName] : null, ['Reference', e.reference_no], ['Status', e.status], ['Approved by', e.approved_by_name], ['Created by', e.created_by_name]].filter(Boolean)} />
        </div>
        <div className="sum-box" style={{ textAlign: 'center' }}><div className="l">Total amount</div><div className="v" style={{ fontSize: 24 }}>{money(e.amount)}</div><div className="muted">Paid {money(e.paid_amount)} · Balance {money(bal)}</div></div>
        <div className="row between" style={{ marginTop: 40 }}><div style={{ borderTop: '1px solid #999', paddingTop: 4, width: 190 }}>Prepared by</div><div style={{ borderTop: '1px solid #999', paddingTop: 4, width: 190 }}>Approved by</div><div style={{ borderTop: '1px solid #999', paddingTop: 4, width: 190 }}>Received by</div></div>
        <DocFooter kind="expense" />
      </div>
      <div className="no-print">
      <BackLink to="/expenses">Expense vouchers</BackLink>
      <PageHead title={<span>{e.voucher_no} <StatusBadge status={e.status} /></span>} sub={`${date(e.date)} · ${e.description || ''}`}>
        {e.status === 'created' && can('accounting', 'create') && <button className="btn" onClick={() => act('submit', 'Submitted for approval')}>Submit</button>}
        {e.status === 'submitted' && can('accounting', 'approve') && <><button className="btn danger" onClick={() => act('reject', 'Rejected')}>Reject</button><button className="btn primary" onClick={() => act('approve', 'Approved')}>Approve</button></>}
        {['approved', 'partial'].includes(e.status) && can('accounting', 'approve') && <button className="btn primary" onClick={() => setPaying(true)}>Pay {money(bal)}</button>}
        {e.status === 'rejected' && can('accounting', 'create') && <button className="btn" onClick={() => act('submit', 'Re-submitted')}>Re-submit</button>}
        {['created', 'rejected'].includes(e.status) && can('accounting', 'delete') && <button className="btn danger" onClick={() => setDel(true)}>Delete</button>}
        {e.status !== 'rejected' && <button className="btn success" onClick={() => setWa({ kind: e.status === 'paid' ? 'paid' : ['approved', 'partial'].includes(e.status) ? 'approved' : null, phone: e.vendor_phone || '' })}><Icon name="whatsapp" size={14} />Send on WhatsApp</button>}
        <button className="btn primary" onClick={() => download(`/api/accounting/expenses/${e.id}/pdf`, {}, `expense-${e.voucher_no}.pdf`).catch((er) => toast(er.message, 'err'))}><Icon name="download" size={14} />Download PDF</button>
        <button className="btn" onClick={() => window.print()}><Icon name="print" size={14} />Print</button>
      </PageHead>
      <div className="row" style={{ marginBottom: 14 }}>{steps.map((s, i) => <div key={s} className="row" style={{ flex: 1 }}><span className="pill" style={{ background: i <= at ? 'var(--green-bg)' : 'var(--grey-bg)', color: i <= at ? 'var(--green)' : 'var(--muted)', textTransform: 'capitalize' }}>{i <= at ? '✓ ' : ''}{s}</span>{i < 3 && <div style={{ flex: 1, height: 2, background: i < at ? '#16a34a' : 'var(--border)' }} />}</div>)}</div>
      <div className="grid g2">
        <Card title="Voucher"><KV items={[['Project', e.project_id ? <Link to={`/projects/${e.project_id}`}>{e.project_name}</Link> : '—'], e.sale_id ? ['Contract', <Link to={`/sales/${e.sale_id}`}>{e.contract_no} — {e.contract_customer}</Link>] : null, ['Vendor', e.vendor_id ? <Link to={`/vendors/${e.vendor_id}`}>{e.vendor_name}</Link> : '—'], ['Expense account', `${e.expense_account_code} ${e.expense_account_name}`], ['Quantity × unit', `${e.quantity} × ${money(e.unit_cost)}`], ['Total', <b>{money(e.amount)}</b>], ['Paid', money(e.paid_amount)], ['Balance', money(bal)], e.is_credit ? ['Credit purchase — due', date(e.due_date)] : null]} /></Card>
        <Card title="Workflow"><KV items={[['Created by', e.created_by_name], ['Approved by', e.approved_by_name], ['Payment method', e.payment_method], ['Reference', e.reference_no], ['Journal', e.journal ? <Link to={`/accounting/journals?q=${e.journal.journal_no}`}>{e.journal.journal_no}</Link> : '—'], ['Notes', e.notes]]} /></Card>
      </div>
      <Card title="Printed voucher & PDF">
        <div className="row between wrap" style={{ gap: 12 }}>
          <div><b>Show “Paid from” account</b><div className="muted">{paidFromName ? `Recorded in the books: ${paidFromName}.` : 'No paying account recorded yet.'} Vendors usually should not see this — switch it on only when the voucher should name the bank / cash account.</div></div>
          <Check checked={!!e.show_paid_from} onChange={(v) => can('accounting', 'edit') && !togglingPaidFrom && togglePaidFrom(v)}>{e.show_paid_from ? 'Shown' : 'Hidden'}</Check>
        </div>
      </Card>
      {e.assets?.length > 0 && <><div style={{ height: 12 }} /><Card title="Asset Library records" flush><table className="t"><tbody>{e.assets.map((a) => <tr key={a.id}><td className="mono"><Link to="/assets">{a.asset_no}</Link></td><td>{a.name}</td><td>{[a.category, a.brand_model, a.serial_no].filter(Boolean).join(' · ') || <span className="muted">Details to be added</span>}</td><td className="num mono">{money(a.cost)}</td></tr>)}</tbody></table></Card></>}
      {e.is_asset && !e.assets?.length && <div className="alert info" style={{ marginTop: 12 }}>This is an asset purchase — it will be added to the Asset Library when the voucher is approved.</div>}
      <div style={{ height: 12 }} />
      {e.payments.length > 0 && <Card title="Payments" flush><table className="t"><tbody>{e.payments.map((p) => <tr key={p.id}><td>{p.payment_no}</td><td>{date(p.date)}</td><td>{p.account_name}</td><td>{p.method}</td><td className="num mono">{money(p.amount)}</td></tr>)}</tbody></table></Card>}
      <div style={{ height: 12 }} /><Card title="Attachments"><DocumentsPanel entityType="expense" entityId={e.id} canEdit={can('accounting', 'edit')} categories={['Invoice', 'Payment Proof', 'Other']} /></Card>
      {paying && <FormModal title="Pay voucher" size="sm" initial={{ amount: bal, date: todayPK(), method: e.payment_method || 'Cash', account_id: e.paid_from_account_id || '' }}
        fields={[{ name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'account_id', label: 'Pay from', type: 'select', number: true, required: true, options: treasury.map((a) => ({ value: a.id, label: a.name })) }, { name: 'method', label: 'Method', type: 'select', lookup: 'payment_method', allowEmpty: false }, { name: 'date', label: 'Date', type: 'date' }, { name: 'reference_no', label: 'Reference' }]}
        onClose={() => setPaying(false)} onSave={async (f) => { await api.post(`/api/accounting/expenses/${e.id}/pay`, f); toast('Payment recorded', 'ok'); setPaying(false); reload(); if (e.vendor_id) setWa({ kind: 'paid', phone: e.vendor_phone || '' }); }} />}
      {wa && (
        <Modal title={wa.kind === 'paid' ? 'Payment recorded — tell the vendor?' : wa.kind === 'approved' ? 'Voucher approved — send it to the vendor?' : 'Send voucher on WhatsApp'} size="sm" onClose={() => setWa(null)}
          footer={<><button className="btn" onClick={() => setWa(null)}>Not now</button><button className="btn success" disabled={waBusy} onClick={sendWa}><Icon name="whatsapp" size={14} />{waBusy ? 'Preparing…' : 'Send on WhatsApp'}</button></>}>
          <div className="stack">
            <div>{e.voucher_no} · <b>{money(wa.kind === 'paid' ? (e.paid_amount || e.amount) : e.amount)}</b>{e.vendor_name ? <> to <b>{e.vendor_name}</b></> : null}. The PDF voucher is attached{e.show_paid_from ? ' (it names the paying account)' : ' (the paying account stays private)'}.</div>
            <Field label="Vendor’s WhatsApp number" hint="Opens WhatsApp with the message ready; on a phone the PDF attaches automatically, on a computer it downloads for you to attach."><input className="input" autoFocus value={wa.phone} onChange={(ev) => setWa({ ...wa, phone: ev.target.value })} placeholder="0300-1234567" onKeyDown={(ev) => ev.key === 'Enter' && sendWa()} /></Field>
          </div>
        </Modal>
      )}
      {del && <ConfirmDialog danger title="Delete voucher" message="Delete this draft voucher?" confirmLabel="Delete" onCancel={() => setDel(false)} onConfirm={async () => { setDel(false); undoX.remove(e.id, `${e.voucher_no} deleted`, () => api.del(`/api/accounting/expenses/${e.id}`)); nav('/expenses'); }} />}
      </div>
    </div>
  );
}
