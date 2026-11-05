import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DataTable, { ExportMenu, SearchBar, useTable, ViewsBar } from '../components/DataTable.jsx';
import { WA, WhatsAppButton, useCompanyName, useSharePdf } from '../components/WhatsApp.jsx';
import Icon from '../components/Icon.jsx';
import { DocumentsPanel } from '../components/Uploaders.jsx';
import { DocFooter, DocHeader } from '../components/DocBrand.jsx';
import { BackLink, Card, ConfirmDialog, CurrencyInput, DateRangeFilter, Field, KV, Loading, Modal, PageHead, Select, StatusBadge } from '../components/ui.jsx';
import { api, download } from '../api.js';
import { printPdf } from '../printPdf.js';
import CustomerPicker from '../components/CustomerPicker.jsx';
import { ReceiptPreview } from '../components/VoucherPreview.jsx';
import { useAuth, useFetch, useLookups, useMeta, useToast } from '../context.jsx';
import { date, money, todayPK } from '../format.js';

export const PAY_TYPES = ['Booking Payment', 'Advance Payment', 'Installment', 'Balloon Payment', 'Down Payment', 'Partial Payment', 'Full Payment', 'Refund', 'Adjustment', 'Other'];
export const ONLINE = ['Bank Transfer', 'Online Transfer', 'JazzCash', 'Easypaisa'];
export const emptyPayment = { payment_type: 'Installment', method: 'Cash', date: todayPK(), amount: '', account_id: '', reference_no: '', cheque_no: '', bank: '', txn_id: '', sender: '', notes: '' };

/** Method-specific payment fields shared by the receipt voucher and the sale booking collection. */
export function PaymentFields({ p, set, treasury, hideAmount }) {
  const { list } = useLookups();
  const online = ONLINE.includes(p.method);
  const defaultAcc = (m) => treasury.find((a) => (m === 'Cash' ? a.subtype === 'cash' : m === 'Cheque' || m === 'Bank Transfer' ? a.subtype === 'bank' : ['JazzCash', 'Easypaisa', 'Online Transfer'].includes(m) ? a.subtype === 'online' : true))?.id;
  useEffect(() => { if (!p.account_id) { const d = defaultAcc(p.method); if (d) set('account_id', d); } /* eslint-disable-next-line */ }, [treasury.length]);
  return (
    <div className="form-grid">
      <Field label="Payment method" required><Select allowEmpty={false} value={p.method} onChange={(v) => { set('method', v); const d = defaultAcc(v); if (d) set('account_id', d); }} options={list('payment_method').length ? list('payment_method') : ['Cash', 'Bank Transfer', 'Online Transfer', 'JazzCash', 'Easypaisa', 'Cheque', 'Other']} /></Field>
      <Field label="Deposit to (cash / bank / till)" required><Select allowEmpty={false} value={p.account_id} onChange={(v) => set('account_id', Number(v))} options={[{ value: '', label: 'Select account…' }, ...treasury.map((a) => ({ value: a.id, label: `${a.name}` }))]} /></Field>
      {online && <><Field label="Transaction ID" required><input className="input" value={p.txn_id} onChange={(e) => set('txn_id', e.target.value)} /></Field>
        <Field label="Bank / channel" required><input className="input" value={p.bank} onChange={(e) => set('bank', e.target.value)} placeholder={p.method === 'JazzCash' || p.method === 'Easypaisa' ? p.method : 'e.g. HBL'} /></Field>
        <Field label="Reference ID"><input className="input" value={p.reference_no} onChange={(e) => set('reference_no', e.target.value)} /></Field>
        <Field label="Sender (name / account)"><input className="input" value={p.sender} onChange={(e) => set('sender', e.target.value)} /></Field></>}
      {p.method === 'Cheque' && <><Field label="Cheque number" required><input className="input" value={p.cheque_no} onChange={(e) => set('cheque_no', e.target.value)} /></Field>
        <Field label="Bank" required><input className="input" value={p.bank} onChange={(e) => set('bank', e.target.value)} /></Field></>}
      {!online && p.method !== 'Cheque' && <Field label="Reference number"><input className="input" value={p.reference_no} onChange={(e) => set('reference_no', e.target.value)} /></Field>}
    </div>
  );
}

export function ReceiptForm() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { treasury, users } = useLookups();
  const [contactId, setContactId] = useState(Number(sp.get('contact')) || '');
  const [saleId, setSaleId] = useState(Number(sp.get('sale')) || '');
  const [customer, setCustomer] = useState(null);
  const [record, setRecord] = useState(null);
  const [sales, setSales] = useState([]);
  const [sale, setSale] = useState(null);
  const [p, setP] = useState({ ...emptyPayment, received_by: user.id });
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [combined, setCombined] = useState(true); // pay a bundled plan (plot + construction) in one voucher
  const [shares, setShares] = useState({});
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!contactId) { setRecord(null); return; }
    api.get('/api/receipts/record', { contact_id: contactId, sale_id: saleId || undefined }).then(setRecord).catch(() => setRecord(null));
  }, [contactId, saleId]);
  useEffect(() => {
    if (!contactId) { setSales([]); return; }
    api.get('/api/sales', { contact_id: contactId, status: 'confirmed', limit: 100 }).then((r) => { setSales(r.rows); if (!saleId && r.rows.length === 1) setSaleId(r.rows[0].id); }).catch(() => {});
    // eslint-disable-next-line
  }, [contactId]);
  useEffect(() => { if (!saleId) { setSale(null); return; } api.get(`/api/sales/${saleId}`).then((r) => { setSale(r.sale); const nd = r.sale.next_due || r.sale.installments.find((i) => i.status !== 'paid'); if (nd && !p.amount) setP((x) => ({ ...x, amount: nd.amount - (nd.paid || 0) < 0 ? nd.amount : (nd.balance ?? nd.amount - (nd.paid || 0)) })); }).catch(() => {}); /* eslint-disable-next-line */ }, [saleId]);

  const isRefund = p.payment_type === 'Refund';
  useEffect(() => {
    if (sale?.bundle && combined && !isRefund) {
      const nextRow = sale.bundle.schedule.find((m) => m.status !== 'paid');
      const total = nextRow ? nextRow.amount - nextRow.paid : sale.bundle.monthly_total;
      const weights = sale.bundle.sales.map((x) => Math.max(1, x.installment_amount || x.outstanding));
      const sum = weights.reduce((a, b) => a + b, 0) || 1; const out = {}; let used = 0;
      sale.bundle.sales.forEach((x, i, arr) => { const v = i === arr.length - 1 ? total - used : Math.round((total * weights[i]) / sum); out[x.id] = v; used += v; });
      setShares(out);
    }
    // eslint-disable-next-line
  }, [sale?.id, combined, sale?.bundle?.paid_amount]);
  const bundle = sale?.bundle && !isRefund && combined ? sale.bundle : null;
  const partsList = bundle ? bundle.sales : [];
  // default split: proportional to each sale's monthly installment (e.g. 25k + 25k of a 50k payment)
  const defaultSplit = (total) => {
    const weights = partsList.map((x) => Math.max(1, x.installment_amount || x.outstanding));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const out = {}; let used = 0;
    partsList.forEach((x, i) => { const v = i === partsList.length - 1 ? total - used : Math.round((total * weights[i]) / sum); out[x.id] = v; used += v; });
    return out;
  };
  const splitSum = partsList.reduce((a, x) => a + (Number(shares[x.id]) || 0), 0);
  const amount = bundle ? splitSum : Number(p.amount) || 0;
  const outstanding = sale ? (bundle ? bundle.outstanding : sale.net_price - sale.paid_amount) : 0;
  // for a combined plan each sale is checked against its own balance (the server does the same)
  const excess = !isRefund && sale ? (bundle ? partsList.reduce((t, x) => t + Math.max(0, (Number(shares[x.id]) || 0) - x.outstanding), 0) : Math.max(0, amount - outstanding)) : 0;

  // client-side preview of which installments this payment settles (server decides authoritatively)
  const preview = useMemo(() => {
    if (!sale || isRefund || amount <= 0 || bundle) return [];
    const pref = { 'Booking Payment': ['booking', 'advance'], 'Down Payment': ['booking', 'advance'], 'Advance Payment': ['advance', 'booking'], Installment: ['installment'], 'Balloon Payment': ['balloon'] }[p.payment_type] || [];
    const open = sale.installments.filter((i) => i.paid < i.amount).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.seq - b.seq);
    const ordered = [...open.filter((i) => pref.includes(i.kind)), ...open.filter((i) => !pref.includes(i.kind))];
    let left = Math.min(amount, outstanding); const out = [];
    for (const i of ordered) { if (left <= 0) break; const take = Math.min(left, i.amount - i.paid); out.push({ ...i, take }); left -= take; }
    return out;
  }, [sale, amount, p.payment_type, isRefund, outstanding, bundle]);

  const submit = async () => {
    if (!contactId) return toast('Select a customer', 'err');
    setBusy(true);
    try {
      const body = { ...p, contact_id: contactId, amount, overpayment: over || excess > 0 ? over : undefined };
      if (bundle) body.splits = partsList.map((x) => ({ sale_id: x.id, amount: Number(shares[x.id]) || 0 })).filter((x) => x.amount > 0); else body.sale_id = saleId || undefined;
      const r = await api.post('/api/receipts', body); toast(`Receipt ${r.receipt_no} created`, 'ok'); nav(`/receipts/${r.id}`);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <BackLink to="/receipts">Receipt vouchers</BackLink>
      <PageHead title="New receipt voucher" sub="Posts to the customer ledger, property ledger, installments, project income, cash/bank and the general ledger." />
      <div className="form-split">
        <div className="stack">
          <Card title="Customer & property">
            <div className="form-grid">
              <Field label="Customer" required className="full" hint="Start typing a name, customer ID (CUS-0001), phone or CNIC"><CustomerPicker customersOnly value={contactId} onResolved={setCustomer} onChange={(id, c) => { setContactId(id || ''); setCustomer(c); setSaleId(''); setSale(null); setP((x) => ({ ...x, amount: '' })); }} /></Field>
              <Field label="Property / sale" className="full"><Select allowEmpty={false} value={saleId} onChange={(v) => { setSaleId(v ? Number(v) : ''); setP((x) => ({ ...x, amount: '' })); }} options={[{ value: '', label: 'No sale (customer advance)' }, ...sales.map((s) => ({ value: s.id, label: `${s.kind === 'construction' ? '🏗 ' : ''}${s.property_title} · ${s.sale_no} — balance ${money(s.outstanding)}${s.bundle_id ? ' (combined plan)' : ''}` }))]} /></Field>
            </div>
            {sale?.bundle && !isRefund && (
              <div className="alert info" style={{ marginTop: 10 }}>
                <label className="check"><input type="checkbox" checked={combined} onChange={(e) => setCombined(e.target.checked)} /><b>Combined plan — {sale.bundle.sales.map((x) => (x.kind === 'construction' ? 'construction' : 'plot')).join(' + ')} paid together</b></label>
                <div className="muted" style={{ marginTop: 4 }}>One voucher, one payment. The amount is split between the sales automatically; adjust the shares if needed.</div>
              </div>
            )}
            {sale && <div className="row wrap" style={{ marginTop: 10, gap: 18 }}><span>Net <b>{money(sale.net_price)}</b></span><span>Paid <b className="pos">{money(sale.paid_amount)}</b></span><span>Outstanding <b className="warn">{money(outstanding)}</b></span>{sale.overdue_amount > 0 && <span className="neg">Overdue <b>{money(sale.overdue_amount)}</b></span>}</div>}
          </Card>
          <Card title="Payment">
            <div className="form-grid" style={{ marginBottom: 12 }}>
              <Field label="Payment type" required><Select allowEmpty={false} value={p.payment_type} onChange={(v) => set('payment_type', v)} options={PAY_TYPES} /></Field>
              <Field label="Date" required><input className="input" type="date" value={p.date} max={todayPK()} onChange={(e) => set('date', e.target.value)} /></Field>
              {bundle ? (
                <div className="full stack" style={{ gap: 8 }}>
                  <label className="muted" style={{ fontSize: 12, fontWeight: 500 }}>Payment split <span className="req" style={{ color: '#dc2626' }}>*</span></label>
                  {partsList.map((x) => (
                    <div key={x.id} className="row"><div className="grow"><b>{x.kind === 'construction' ? 'Construction' : 'Plot'}</b> <span className="muted">{x.title} · balance {money(x.outstanding)}</span></div>
                      <div style={{ width: 200 }}><CurrencyInput value={shares[x.id] ?? ''} onChange={(v) => setShares({ ...shares, [x.id]: v })} />{(Number(shares[x.id]) || 0) > x.outstanding && <div className="neg" style={{ fontSize: 11.5, marginTop: 2 }}>{money((Number(shares[x.id]) || 0) - x.outstanding)} more than this balance</div>}</div></div>
                  ))}
                  <div className="row between"><span className="muted">Total received</span><b className="mono">{money(splitSum)}</b></div>
                </div>
              ) : <Field label="Amount" required className="full"><CurrencyInput value={p.amount} onChange={(v) => set('amount', v)} /></Field>}
            </div>
            <PaymentFields p={p} set={set} treasury={treasury} />
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="Received by"><Select allowEmpty={false} value={p.received_by} onChange={(v) => set('received_by', Number(v))} options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
              <Field label="Notes" className="full"><textarea className="textarea" value={p.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            </div>
            {excess > 0 && <div className="alert warn" style={{ marginTop: 12 }}>This is {money(excess)} more than the outstanding balance. <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} />Accept the excess as an overpayment / customer advance</label></div>}
            {isRefund && <div className="alert info" style={{ marginTop: 12 }}>A refund pays money out of the selected account and reopens the most recent paid installments.</div>}
          </Card>
        </div>
        <div className="stack side">
          <ReceiptPreview p={p} customer={customer} record={record} sale={sale} bundleParts={partsList} shares={shares} amount={amount} allocations={preview} account={treasury.find((a) => a.id === p.account_id)}
            receiver={users.find((u) => u.id === p.received_by)} isRefund={isRefund} advance={excess > 0 && over ? excess : 0} />
          <Card title="What this payment will settle">
            {!preview.length ? <div className="muted">{sale ? 'Enter an amount to see the allocation.' : 'Select a sale to see installment allocation.'}</div> : (
              <table className="t"><tbody>{preview.map((i) => <tr key={i.id}><td>#{i.seq} {i.kind}</td><td>{date(i.due_date)}</td><td className="num mono">{money(i.take)}{i.take < i.amount - i.paid ? <div className="cell-sub">partial</div> : ''}</td></tr>)}</tbody></table>
            )}
            {excess > 0 && over && <div className="muted" style={{ marginTop: 8 }}>+ {money(excess)} to customer advances</div>}
          </Card>
          <Card title="Accounting entry">
            <div className="muted">Dr {treasury.find((a) => a.id === p.account_id)?.name || 'Cash / Bank'}<br />Cr Customer Receivable{bundle ? ` — ${partsList.length} sales, each to its own project` : ''} {excess > 0 && over ? `· Cr Customer Advances (${money(excess)})` : ''}</div>
          </Card>
          <div className="row"><Link className="btn" to="/receipts">Cancel</Link><div className="grow" /><button className="btn primary" style={{ height: 40 }} disabled={busy || !amount} onClick={submit}>{busy ? 'Saving…' : isRefund ? 'Issue refund' : 'Create receipt'}</button></div>
        </div>
      </div>
    </div>
  );
}

export function ReceiptList({ preset, title = 'Receipt vouchers' }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const { projects, treasury, list } = useLookups();
  const [range, setRange] = useState({ range: 'all' });
  const t = useTable('/api/receipts', { filters: preset === 'advance' ? { payment_type: 'Advance Payment' } : {}, viewsKey: `receipts-${preset || 'all'}` });
  const [from, to] = [range.from, range.to];
  return (
    <div>
      <PageHead title={title} sub={`${t.total} voucher(s)`}>{can('payments', 'create') && <Link className="btn primary" to="/receipts/new"><Icon name="plus" size={14} />New receipt</Link>}</PageHead>
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search receipt, customer, txn ID…" />
          <div style={{ width: 160 }}><Select value={t.extra.project_id || ''} onChange={(v) => t.setFilter({ project_id: v })} placeholder="All projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></div>
          <div style={{ width: 150 }}><Select value={t.extra.method || ''} onChange={(v) => t.setFilter({ method: v })} placeholder="All methods" options={list('payment_method')} /></div>
          {!preset && <div style={{ width: 160 }}><Select value={t.extra.payment_type || ''} onChange={(v) => t.setFilter({ payment_type: v })} placeholder="All types" options={PAY_TYPES} /></div>}
          <div style={{ width: 130 }}><Select value={t.extra.status || ''} onChange={(v) => t.setFilter({ status: v })} placeholder="Any status" options={['valid', 'void']} /></div>
          <div className="grow" /><ExportMenu url="/api/receipts" params={t.params} name="receipts" module="payments" /></div>
        <ViewsBar t={t} />
        <DataTable {...t.tableProps} onRowClick={(r) => nav(`/receipts/${r.id}`)} tableId="receipts" columns={[
          { key: 'receipt_no', label: 'Receipt', render: (r) => <span className="cell-main">{r.receipt_no}{r.is_demo ? <span className="demo-chip">DEMO</span> : null}</span> }, { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'customer_name', label: 'Customer', render: (r) => <Link to={`/contacts/${r.contact_id}`} onClick={(e) => e.stopPropagation()}>{r.customer_name}</Link> }, { key: 'property_title', label: 'Property' }, { key: 'project_name', label: 'Project' },
          { key: 'payment_type', label: 'Type' }, { key: 'method', label: 'Method' }, { key: 'account_name', label: 'Account', hidden: true },
          { key: 'amount', label: 'Amount', num: true, render: (r) => <span className={r.payment_type === 'Refund' ? 'neg' : ''}>{r.payment_type === 'Refund' ? '-' : ''}{money(r.amount)}</span> }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }]}
          footer={<tr><td colSpan={7}>Net of page filters (valid receipts)</td><td className="num mono" colSpan={2}>{money(t.raw?.net_total)}</td><td /><td /></tr>} />
      </Card>
    </div>
  );
}

/** Ledger summary table + small QR on the voucher (as of this receipt). Created on first view/print/download and kept. */
function ReceiptQr({ id, canRefresh }) {
  const toast = useToast();
  const { data: q, reload } = useFetch(`/api/receipts/${id}/qr`);
  const [busy, setBusy] = useState(false);
  if (!q) return null;
  const refresh = async () => { setBusy(true); try { await api.post(`/api/receipts/${id}/qr/refresh`); toast('QR code rebuilt', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  const n = (v) => Math.round(Number(v || 0)).toLocaleString('en-PK');
  return (
    <div className="qr-box">
      <div className="qr-main">
        <table className="t qr-table">
          <thead><tr><th>Ledger summary — plan</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Remaining</th><th className="num">Installments</th><th className="num">Next due</th></tr></thead>
          <tbody>{(q.plans || []).map((p) => (
            <tr key={p.sale_no}><td>{p.title}<div className="muted" style={{ fontSize: 10.5 }}>{p.sale_no}</div></td><td className="num">{n(p.total)}</td><td className="num">{n(p.paid)}</td><td className="num bold">{n(p.remaining)}</td>
              <td className="num">{p.n ? `${p.nPaid}/${p.n} paid` : '—'}</td><td className="num">{p.next ? <>{date(p.next.date)}<div className="muted" style={{ fontSize: 10.5 }}>{n(p.next.amount)}</div></> : p.remaining === 0 ? 'Fully paid' : '—'}</td></tr>))}</tbody>
        </table>
        <div className="qr-meta">Figures are as of this receipt{q.generated_at ? ` (generated ${String(q.generated_at).replace('T', ' ').slice(0, 16)})` : ''}. Sign in to the customer portal for the live ledger.
          {canRefresh && <span className="no-print"> <button type="button" className="btn sm ghost" disabled={busy} onClick={refresh}>Rebuild QR</button></span>}
          {q.local && <div className="qr-warn no-print">The link uses this computer’s address. Set the website address in Website → SEO Manager so customers’ phones can open it.</div>}</div>
      </div>
      <figure className="qr-fig"><img src={`/api/receipts/${id}/qr.png?v=${encodeURIComponent(q.generated_at || '')}`} alt="QR code: ledger summary and customer portal link" width={84} height={84} /><figcaption>Scan for live ledger</figcaption></figure>
    </div>
  );
}

const COPY_LAYOUTS = [['', 'Default'], ['sheet', 'Both on one A4'], ['pages', 'Two A4 pages'], ['client', 'Client copy'], ['office', 'Office copy']];
export function ReceiptDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { meta } = useMeta();
  const { data: r, error, reload } = useFetch(`/api/receipts/${id}`);
  const [voiding, setVoiding] = useState(false);
  const sharePdf = useSharePdf();
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('rcpt-layout') || ''; } catch { return ''; } });
  const [qrOn, setQrOn] = useState(() => { try { return localStorage.getItem('rcpt-qr') !== '0'; } catch { return true; } });
  const toggleQr = () => { const v = !qrOn; setQrOn(v); try { localStorage.setItem('rcpt-qr', v ? '1' : '0'); } catch { /* private mode */ } };
  const pdfParams = { ...(layout ? { layout } : {}), qr: qrOn ? '1' : '0' };
  const pickLayout = (v) => { setLayout(v); try { localStorage.setItem('rcpt-layout', v); } catch { /* private mode */ } };
  if (error) return <div className="alert err">{error}</div>;
  if (!r) return <Loading />;
  const co = meta?.settings || {};
  return (
    <div>
      <div className="no-print"><BackLink to="/receipts">Receipt vouchers</BackLink>
        <PageHead title={<span>{r.receipt_no} <StatusBadge status={r.status} /></span>} sub={`${date(r.date)} · ${r.payment_type}`}>
          {r.status === 'valid' && r.record?.phone && <button className="btn success" onClick={() => sharePdf({ pdfUrl: `/api/receipts/${r.id}/pdf`, filename: `receipt-${r.receipt_no}.pdf`, phone: r.record.phone, text: WA.receipt({ name: (r.record.customer_name || '').split(' ')[0], amount: r.amount, receipt_no: r.receipt_no, date: r.date }, co.company_name || 'Agentify ERP') })}><Icon name="whatsapp" size={14} />Share on WhatsApp</button>}
          <button className="btn primary" onClick={() => download(`/api/receipts/${r.id}/pdf`, pdfParams, `receipt-${r.receipt_no}.pdf`).catch((e) => toast(e.message, 'err'))}><Icon name="download" size={14} />Download PDF</button>
          <button className="btn" onClick={() => printPdf(`/api/receipts/${r.id}/pdf`, pdfParams).catch((e) => toast(e.message, 'err'))}><Icon name="print" size={14} />Print A4</button>
          {r.status === 'valid' && can('payments', 'approve') && <button className="btn danger" onClick={() => setVoiding(true)}>Void receipt</button>}
        </PageHead>
      <div className="print-opts no-print" role="group" aria-label="Print and download options">
        <span className="po-l">Copies</span>
        <div className="po-seg">{COPY_LAYOUTS.map(([v, l]) => <button type="button" key={v || 'default'} className={layout === v ? 'on' : ''} aria-pressed={layout === v} onClick={() => pickLayout(v)}>{l}</button>)}</div>
        <span className="po-l">QR code</span>
        <div className="po-seg"><button type="button" className={qrOn ? 'on' : ''} aria-pressed={qrOn} onClick={() => !qrOn && toggleQr()}>On</button><button type="button" className={!qrOn ? 'on' : ''} aria-pressed={!qrOn} onClick={() => qrOn && toggleQr()}>Off</button></div>
        <span className="po-note">Applies to Print A4, Download PDF and WhatsApp — the receipt below stays as it is.</span>
      </div>
      </div>
      <div className="print-doc">
        <DocHeader kind="receipt" title={r.payment_type === 'Refund' ? 'REFUND VOUCHER' : (co.receipt_title || 'RECEIPT VOUCHER')} number={r.receipt_no} extra={r.status === 'void' ? <div className="neg bold">VOID</div> : null} />
        <div className="grid g2" style={{ marginBottom: 14 }}>
          <KV items={[['Date', date(r.date)], ['Received from', <Link to={`/contacts/${r.contact_id}`}>{r.customer_name}</Link>], ['Property', r.property_id ? <Link to={`/properties/${r.property_id}`}>{r.property_title}</Link> : '—'], ['Project', r.project_id ? <Link to={`/projects/${r.project_id}`}>{r.project_name}</Link> : '—'], ['Sale / plan', r.sale_id ? <Link to={`/sales/${r.sale_id}`}>{r.sale_no}</Link> : '—'], ['Sales agent', r.agent_name]]} />
          <KV items={[['Payment type', r.payment_type], ['Method', r.method], ['Deposited to', r.account_name], ['Reference', r.reference_no], ['Transaction ID', r.txn_id], ['Cheque no.', r.cheque_no], ['Bank / channel', r.bank], ['Sender', r.sender], ['Received by', r.received_by_name]]} />
        </div>
        {r.record && (
          <><div className="section-title">Customer & file details</div>
            <div className="grid g2" style={{ marginBottom: 14 }}>
              <KV items={[['Customer ID', r.record.customer_code], ['CNIC no.', r.record.cnic], ['Contact no.', r.record.phone], ['Email', r.record.email], ['Booking date', r.record.booking_date ? date(r.record.booking_date) : null]]} />
              <KV items={[['Registration no.', r.record.registration_no], ['File #', r.record.file_no], ['File status', r.record.file_status ? <StatusBadge status={r.record.file_status} tone={{ Active: 'green', Inactive: 'grey', Paused: 'amber', Defaulted: 'red', Suspended: 'red' }[r.record.file_status]} /> : null], ['Type', r.record.property_type], ['Plot size', r.record.plot_size], ['Address', r.record.address]]} />
            </div></>
        )}
        <div className="sum-box" style={{ textAlign: 'center', margin: '12px 0' }}><div className="l">Amount {r.payment_type === 'Refund' ? 'refunded' : 'received'}</div><div className="v" style={{ fontSize: 26 }}>{money(r.amount)}</div>{r.advance_amount > 0 && <div className="muted">includes {money(r.advance_amount)} customer advance</div>}</div>
        {r.parts?.length > 1 && (<><div className="section-title">Split between</div><table className="t"><thead><tr><th>Sale</th><th>For</th><th className="num">Share</th></tr></thead><tbody>{r.parts.map((x) => <tr key={x.sale_id}><td><Link to={`/sales/${x.sale_id}`}>{x.sale_no}</Link> <span className="tag">{x.kind === 'construction' ? 'Construction' : 'Plot'}</span></td><td>{x.title}</td><td className="num mono">{money(x.amount + x.advance)}</td></tr>)}</tbody></table></>)}
        {r.allocations.length > 0 && (<><div className="section-title">Applied to installments</div><table className="t"><thead><tr><th>#</th><th>Type</th><th>Due date</th><th className="num">Applied</th></tr></thead><tbody>{r.allocations.map((a) => <tr key={a.id}><td>{a.seq}</td><td>{a.kind}</td><td>{date(a.due_date)}</td><td className="num mono">{money(a.amount)}</td></tr>)}</tbody></table></>)}
        {r.notes && <p><b>Notes:</b> {r.notes}</p>}
        {r.void_reason && <div className="alert err">Voided: {r.void_reason}</div>}
        {r.status === 'valid' && qrOn && <ReceiptQr id={r.id} canRefresh={can('payments', 'edit')} />}
        <div className="row between" style={{ marginTop: 40 }}><div style={{ borderTop: '1px solid #999', paddingTop: 4, width: 200 }}>Received by</div><div style={{ borderTop: '1px solid #999', paddingTop: 4, width: 200 }}>Customer signature</div></div>
        <DocFooter kind="receipt" />
      </div>
      <div className="no-print" style={{ maxWidth: 820, margin: '14px auto 0' }}>
        <Card title="Linked records"><div className="row wrap">{r.journal && <Link className="btn sm" to={`/accounting/journals?q=${r.journal.journal_no}`}>Journal {r.journal.journal_no}</Link>}<Link className="btn sm" to={`/contacts/${r.contact_id}`}>Customer</Link>{r.sale_id && <Link className="btn sm" to={`/sales/${r.sale_id}`}>Payment plan & ledger</Link>}</div></Card>
        <div style={{ height: 12 }} /><Card title="Attachments"><DocumentsPanel entityType="receipt" entityId={r.id} canEdit={can('payments', 'edit')} categories={['Payment Proof', 'Other']} /></Card>
      </div>
      {voiding && <ConfirmDialog danger reason title="Void receipt" confirmLabel="Void receipt" message="Voiding reverses the journal, reopens the installments and restores the balance. The voucher stays on file." onCancel={() => setVoiding(false)}
        onConfirm={async (reason) => { try { await api.post(`/api/receipts/${r.id}/void`, { reason }); toast('Receipt voided', 'ok'); setVoiding(false); reload(); } catch (e) { toast(e.message, 'err'); setVoiding(false); } }} />}
    </div>
  );
}

// ---- Payments section pages
const onPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 700px)').matches;
const STATUS_CHIPS = [['open', 'Open'], ['all', 'All'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['partial', 'Partially paid'], ['paid', 'Paid']];
/** The API treats an empty status as "no filter"; the page keeps `open` (anything unpaid) as its default. */
const apiStatus = (s) => (s === 'all' ? '' : s);

/** Overdue / due this week / collected this month. Overdue and due-soon are buttons that apply the filter. */
function InstallmentTiles({ kind, projectId, go, status }) {
  const { data } = useFetch('/api/installments', { limit: 1, status: 'all', kind, project_id: projectId || undefined });
  const st = data?.stats;
  if (!st) return null;
  return (
    <div className="inst-tiles">
      <button className={`inst-tile od ${status === 'overdue' ? 'on' : ''}`} onClick={() => go({ status: 'overdue', days: '' })}><span className="label">Overdue</span><b className="neg">{money(st.overdue_amount)}</b><span className="sub">{st.overdue_count} installment(s)</span></button>
      <button className={`inst-tile ${status === 'upcoming' ? 'on' : ''}`} onClick={() => go({ status: 'upcoming', days: '7' })}><span className="label">Due in 7 days</span><b>{money(st.soon_amount)}</b><span className="sub">{st.soon_count} installment(s)</span></button>
      <div className="inst-tile static"><span className="label">Collected this month</span><b className="pos">{money(st.collected_month)}</b><span className="sub">valid receipts</span></div>
    </div>
  );
}

/** One row of chips: status filters, plus the Rows / By customer switch. Sticks to the top while the list scrolls. */
function InstallmentChips({ status, view, go, balloon, onRemind }) {
  return (
    <div className="inst-sticky">
      <div className="top-tabs inst-chips">
        {STATUS_CHIPS.map(([k, l]) => <button key={k} className={`chip ${status === k ? 'active' : ''}`} onClick={() => go({ status: k, days: '' })}>{l}</button>)}
        {!balloon && <><span className="inst-sep" aria-hidden="true" /><button className={`chip ${view === 'rows' ? 'active' : ''}`} onClick={() => go({ view: 'rows' })}>Rows</button>
          <button className={`chip ${view === 'customers' ? 'active' : ''}`} onClick={() => go({ view: 'customers' })}>By customer</button></>}
        {onRemind && <button className="chip inst-remind" onClick={onRemind}><Icon name="whatsapp" size={13} /> Remind overdue</button>}
      </div>
    </div>
  );
}

/** Every customer with something overdue, each with a prefilled WhatsApp message; ticks off who was messaged (browsers allow one chat window per tap). */
function RemindOverdue({ onClose }) {
  const co = useCompanyName();
  const { data } = useFetch('/api/installments/by-customer', { status: 'overdue', limit: 500 });
  const [done, setDone] = useState({});
  const rows = (data?.rows || []).filter((r) => r.phone);
  const noPhone = (data?.rows || []).length - rows.length;
  return (
    <Modal title="Remind overdue customers" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {!data ? <Loading /> : !rows.length ? <div className="empty">No overdue customers with a phone number.</div> : (
        <div className="stack">
          <div className="muted">{rows.length} customer(s). Tap WhatsApp for each; the message is ready to send.</div>
          {rows.map((r) => (
            <div key={r.contact_id} className="row between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, opacity: done[r.contact_id] ? 0.55 : 1 }}>
              <div><b>{r.customer_name}</b><div className="cell-sub">{money(r.overdue_amount)} · {r.overdue_count} overdue</div></div>
              <span onClickCapture={() => setDone((d) => ({ ...d, [r.contact_id]: true }))}><WhatsAppButton phone={r.phone} label={done[r.contact_id] ? ' Sent' : ' Remind'} className="btn sm" title="WhatsApp reminder" text={WA.overdueTotal({ name: (r.customer_name || '').split(' ')[0], amount: r.overdue_amount }, co)} /></span>
            </div>))}
          {noPhone > 0 && <div className="muted">{noPhone} overdue customer(s) have no phone number saved.</div>}
        </div>)}
    </Modal>
  );
}

/** Installments grouped by customer: one row per customer; tapping opens their full Customer 360 (profile, sales, schedule, payments). */
function InstallmentsByCustomer({ status, view, go }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const co = useCompanyName();
  const { projects } = useLookups();
  const [lim, setLim] = useState(50);
  const [remind, setRemind] = useState(false);
  const t = useTable('/api/installments/by-customer', { limit: lim, filters: { status: apiStatus(status) } });
  useEffect(() => { t.setFilter({ status: apiStatus(status) }); /* eslint-disable-next-line */ }, [status]);
  const open = (r) => nav(can('customers', 'view') ? `/customers/${r.contact_id}/360` : `/contacts/${r.contact_id}`);
  return (
    <div>
      <PageHead title="Installments" sub={`${t.total} customer(s) · ${money(t.raw?.balance_total)} balance`} />
      <InstallmentTiles projectId={t.extra.project_id} go={go} status={status} />
      <InstallmentChips status={status} view={view} go={go} onRemind={() => setRemind(true)} />
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search customer, phone, sale…" /><div style={{ width: 170 }}><Select value={t.extra.project_id || ''} onChange={(v) => t.setFilter({ project_id: v })} placeholder="All projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></div></div>
        <div className="inst-list">
          <DataTable {...t.tableProps} hidePager onRowClick={open} rowClass={(r) => (r.overdue_count ? 'inst-od' : '')}
            quickActions={(r) => <>{r.phone && <a className="qa" href={`tel:${r.phone}`} title="Call" aria-label="Call"><Icon name="phone" size={13} /></a>}
              {r.overdue_count > 0 && <WhatsAppButton phone={r.phone} size={13} title="WhatsApp reminder" text={WA.overdueTotal({ name: (r.customer_name || '').split(' ')[0], amount: r.overdue_amount }, co)} />}</>}
            columns={[
              { key: 'customer_name', label: 'Customer', render: (r) => <><b>{r.customer_name}</b>{r.phone && <div className="cell-sub">{r.phone}</div>}</> },
              { key: 'sales_count', label: 'Sales', num: true },
              { key: 'installments_count', label: 'Installments', num: true },
              { key: 'amount', label: 'Total', num: true, render: (r) => money(r.amount) },
              { key: 'paid', label: 'Paid', num: true, render: (r) => money(r.paid) },
              { key: 'balance', label: 'Balance', num: true, render: (r) => money(r.balance) },
              { key: 'overdue_amount', label: 'Overdue', num: true, render: (r) => r.overdue_count ? <span className="neg bold">{money(r.overdue_amount)} ({r.overdue_count})</span> : '—' },
              { key: 'next_due', label: 'Next due', render: (r) => r.next_due ? date(r.next_due) : '—' },
              { key: 'phone', label: 'Phone', hidden: true }]} />
        </div>
        <LoadMore shown={t.rows.length} total={t.total} loading={t.loading} onMore={() => setLim((n) => Math.min(n + 50, 500))} />
      </Card>
      {remind && <RemindOverdue onClose={() => setRemind(false)} />}
    </div>
  );
}

/** "Showing 50 of 212" + a button that fetches 50 more (the server caps one request at 500). */
function LoadMore({ shown, total, loading, onMore }) {
  if (!total) return null;
  return (
    <div className="pager inst-more-bar">
      <span>Showing {shown} of {total}</span>
      {shown < total && shown < 500 && <button className="btn sm" disabled={loading} onClick={onMore}>{loading ? 'Loading…' : 'Load 50 more'}</button>}
      {shown < total && shown >= 500 && <span className="muted">Narrow the filters to see the rest.</span>}
    </div>
  );
}

export function InstallmentsPage({ preset, title }) {
  const [sp, setSp] = useSearchParams();
  const balloon = preset === 'balloon';
  // phones start on the per-customer list (one row per customer, not one card per installment); anyone can switch with the chips
  const view = balloon ? 'rows' : (sp.get('view') || (onPhone() ? 'customers' : 'rows'));
  const status = sp.get('status') || 'open';
  const days = sp.get('days') || '';
  const go = (patch) => { const n = { status, view, days, ...patch }; setSp(Object.fromEntries(Object.entries(n).filter(([, v]) => v)), { replace: true }); };
  if (view === 'customers') return <InstallmentsByCustomer status={status} view={view} go={go} />;
  return <InstallmentsRows preset={preset} title={title} status={status} days={days} view={view} go={go} />;
}

function InstallmentsRows({ preset, title, status, days, view, go }) {
  const nav = useNavigate();
  const kind = preset === 'balloon' ? 'balloon' : undefined;
  const { projects } = useLookups();
  const [lim, setLim] = useState(50);
  const [more, setMore] = useState(new Set());
  const [remind, setRemind] = useState(false);
  const t = useTable('/api/installments', { limit: lim, filters: { kind, status: apiStatus(status), days }, viewsKey: `installments-${kind || 'all'}` });
  const co = useCompanyName();
  const { can } = useAuth();
  useEffect(() => { t.setFilter({ status: apiStatus(status), days }); setLim(50); /* eslint-disable-next-line */ }, [status, days]);
  const toggle = (id) => setMore((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div>
      <PageHead title={title || (preset === 'balloon' ? 'Balloon payments' : 'Installments')} sub={`${t.total} row(s) · ${money(t.raw?.balance_total)} balance`} />
      <InstallmentTiles kind={kind} projectId={t.extra.project_id} go={go} status={status} />
      <InstallmentChips status={status} view={view} go={go} balloon={preset === 'balloon'} onRemind={can('payments', 'view') ? () => setRemind(true) : null} />
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search customer, sale, plot…" /><div style={{ width: 170 }}><Select value={t.extra.project_id || ''} onChange={(v) => t.setFilter({ project_id: v })} placeholder="All projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></div></div>
        <ViewsBar t={t} />
        <div className="inst-list">
          <DataTable {...t.tableProps} hidePager onRowClick={(r) => nav(`/sales/${r.sale_id}`)} rowClass={(r) => `${r.overdue ? 'inst-od' : ''} ${more.has(r.id) ? 'ex' : ''}`}
            quickActions={(r) => r.status === 'paid' ? <button className="btn sm ghost inst-toggle" onClick={() => toggle(r.id)}>{more.has(r.id) ? 'Less' : 'Details'}</button> : <>
              {can('payments', 'create') && <Link className="btn sm primary inst-receive" to={`/receipts/new?contact=${r.contact_id}&sale=${r.sale_id}`}>Receive</Link>}
              <WhatsAppButton phone={r.phone} size={15} title="WhatsApp reminder" text={(r.overdue ? WA.overdue : WA.due)({ name: (r.customer_name || '').split(' ')[0], amount: r.balance, due_date: r.due_date, days: r.days_overdue, sale_no: r.sale_no }, co)} />
              {r.phone && <a className="qa" href={`tel:${r.phone}`} title="Call" aria-label="Call"><Icon name="phone" size={15} /></a>}
              <button className="btn sm ghost inst-toggle" onClick={() => toggle(r.id)}>{more.has(r.id) ? 'Less' : 'Details'}</button></>}
            columns={[
              { key: 'customer_name', label: 'Customer', render: (r) => <Link to={`/contacts/${r.contact_id}`} onClick={(e) => e.stopPropagation()}>{r.customer_name}</Link> },
              { key: 'due_date', label: 'Due', render: (r) => <span className={r.overdue ? 'neg bold' : ''}>{date(r.due_date)}{r.overdue ? ` (${r.days_overdue}d late)` : ''}</span> },
              { key: 'amount', label: 'Amount', num: true, render: (r) => money(r.amount) }, { key: 'balance', label: 'Balance', num: true, render: (r) => money(r.balance) },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.overdue ? 'overdue' : r.status} /> },
              { key: 'property_title', label: 'Property' }, { key: 'project_name', label: 'Project' },
              { key: 'sale_no', label: 'Sale' }, { key: 'kind', label: 'Type', render: (r) => <span style={{ textTransform: 'capitalize' }}>#{r.seq} {r.kind}</span> },
              { key: 'paid', label: 'Paid', num: true, render: (r) => money(r.paid) },
              { key: 'phone', label: 'Phone', hidden: true }]} />
        </div>
        <LoadMore shown={t.rows.length} total={t.total} loading={t.loading} onMore={() => setLim((n) => Math.min(n + 50, 500))} />
      </Card>
      {remind && <RemindOverdue onClose={() => setRemind(false)} />}
    </div>
  );
}

export function Receivables() {
  const nav = useNavigate();
  const { data } = useFetch('/api/receivables');
  const { can } = useAuth();
  if (!data) return <Loading />;
  return (
    <div>
      <PageHead title="Receivables" sub="Customers with an outstanding balance">
      </PageHead>
      <div className="grid g3" style={{ marginBottom: 12 }}>
        <div className="card stat"><span className="label">Total receivable</span><span className="value">{money(data.outstanding_total)}</span></div>
        <div className="card stat"><span className="label">Overdue</span><span className="value neg">{money(data.overdue_total)}</span></div>
        <div className="card stat"><span className="label">Open sales</span><span className="value">{data.total}</span></div>
      </div>
      <Card flush><div className="table-wrap"><table className="t"><thead><tr><th>Customer</th><th>Property</th><th>Project</th><th>Sale</th><th className="num">Net value</th><th className="num">Paid</th><th className="num">Outstanding</th><th className="num">Overdue</th><th>Next due</th><th /></tr></thead>
        <tbody>{data.rows.map((r) => <tr key={r.sale_id} className="click" onClick={() => nav(`/sales/${r.sale_id}`)}><td><Link to={`/contacts/${r.contact_id}`} onClick={(e) => e.stopPropagation()}>{r.customer_name}</Link><div className="cell-sub">{r.phone}</div></td><td>{r.property_title}</td><td>{r.project_name}</td><td>{r.sale_no}</td><td className="num mono">{money(r.net_price)}</td><td className="num mono">{money(r.paid_amount)}</td><td className="num mono">{money(r.outstanding)}</td><td className={`num mono ${r.overdue ? 'neg' : ''}`}>{r.overdue ? money(r.overdue) : '—'}</td><td>{date(r.next_due)}</td>
          <td className="right" onClick={(e) => e.stopPropagation()}>{can('payments', 'create') && <Link className="btn sm" to={`/receipts/new?contact=${r.contact_id}&sale=${r.sale_id}`}>Receive</Link>}</td></tr>)}</tbody></table>
        {!data.rows.length && <div className="empty">No outstanding balances.</div>}</div></Card>
    </div>
  );
}
