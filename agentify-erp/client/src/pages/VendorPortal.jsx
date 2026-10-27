import { Suspense, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import Appearance from '../components/Appearance.jsx';
import Icon from '../components/Icon.jsx';
import { NotificationBell } from '../components/Notifications.jsx';
import { FileUploader } from '../components/Uploaders.jsx';
import { Card, CurrencyInput, Empty, Field, KV, Loading, Modal, Stat, StatusBadge, Tabs } from '../components/ui.jsx';
import { api, download } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { useBrand } from '../brand.js';
import { date, money, todayPK } from '../format.js';

const BID_TONE = { submitted: 'blue', shortlisted: 'amber', awarded: 'green', rejected: 'red', withdrawn: 'grey' };
const BidPill = ({ status }) => (status ? <StatusBadge status={status} tone={BID_TONE[status]} /> : <span className="muted">No bid</span>);
const when = (d) => (d < 0 ? 'closed' : d === 0 ? 'closes today' : d === 1 ? 'closes tomorrow' : `closes in ${d} days`);

export function VendorLayout() {
  const { user, logout } = useAuth();
  const brand = useBrand();
  const { data } = useFetch('/api/vendor/tenders');
  const link = (to, label, end) => <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>;
  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <header className="portal-top">
        <div className="brand" style={{ padding: 0 }}><div className="brand-mark"><Icon name="truck" size={18} stroke={2.2} /></div><div className="brand-name">{brand.name}<small>Vendor portal</small></div></div>
        <nav className="row" style={{ gap: 16, marginLeft: 20 }} aria-label="Vendor portal">
          {link('/vendor', 'Overview', true)}{link('/vendor/payments', 'Payments')}{link('/vendor/ledger', 'Ledger')}
          {link('/vendor/tenders', <>Open contracts{data?.open ? <span className="pill green" style={{ marginLeft: 6 }}>{data.open}</span> : null}</>)}{link('/vendor/bids', 'My bids')}{link('/vendor/profile', 'Registration')}
        </nav>
        <div className="grow" /><Appearance /><NotificationBell /><span style={{ color: '#cfd8ea' }} className="nowrap hide-sm">{user.name}</span>
        <button className="btn sm" onClick={logout} aria-label="Sign out"><span className="hide-sm">Sign out</span><Icon name="logout" size={15} className="show-sm" /></button>
      </header>
      <div className="portal-body"><Suspense fallback={<Loading />}><Outlet /></Suspense></div>
      <nav className="mtabs vtabs no-print" aria-label="Vendor portal tabs">
        {[['/vendor', 'Home', 'home', true], ['/vendor/payments', 'Payments', 'wallet'], ['/vendor/ledger', 'Ledger', 'history'], ['/vendor/tenders', 'Contracts', 'file'], ['/vendor/bids', 'Bids', 'badge'], ['/vendor/profile', 'Profile', 'user']].map(([to, l, ic, end]) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'on' : '')}><Icon name={ic} size={19} /><span>{l}</span>{to === '/vendor/tenders' && data?.open ? <b className="tab-dot">{data.open}</b> : null}</NavLink>))}
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ overview
export function VendorDashboard() {
  const { data: d, error } = useFetch('/api/vendor/dashboard');
  if (error) return <div className="alert err">{error}</div>;
  if (!d) return <Loading />;
  const m = d.money;
  return (
    <div className="stack">
      <div className="hero">
        <div className="hero-top"><div><div className="kicker">{d.vendor.vendor_code} · {d.vendor.category || 'Vendor'}</div><h2>Welcome, {d.vendor.name}</h2>
          <p>{m.total_remaining > 0 ? `The company owes you ${money(m.total_remaining)} in total.` : 'Your account is fully settled — nothing is owed.'}</p></div>
          <span className={`pill ${m.books_in_sync ? 'green' : 'amber'}`} style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }}>{m.books_in_sync ? '✓ Synced with company accounts' : 'Reconciling with accounts'}</span></div>
        <div className="hero-stats">
          <Link to="/vendor/payments" className="hero-stat"><small>Payments released</small><b>{money(m.total_released)}</b><span>of {money(m.total_billed)} billed</span></Link>
          <Link to="/vendor/payments?tab=open" className="hero-stat"><small>Remaining to be paid</small><b>{money(m.total_remaining)}</b><span>{m.next_credit_due ? `next: ${money(m.next_credit_due.balance)} · ${date(m.next_credit_due.due_date)}` : 'nothing due'}</span></Link>
          <Link to="/vendor/tenders" className="hero-stat"><small>Open contracts</small><b>{d.tenders.open}</b><span>{d.tenders.not_yet_bid ? `${d.tenders.not_yet_bid} you haven’t bid on` : 'all bid'}</span></Link>
        </div>
      </div>
      {m.credit_overdue > 0 && <div className="alert warn"><b>{money(m.credit_overdue)}</b> of your credit invoices is past its due date. The accounts team can see this and will release payment as soon as possible.</div>}
      <div className="grid g4">
        <Stat label="Total billed" value={money(m.total_billed)} sub={`${m.vouchers} approved voucher(s)`} icon="receipt" />
        <Stat label="Released to you" value={money(m.total_released)} tone="pos" icon="wallet" />
        <Stat label="Remaining" value={money(m.total_remaining)} tone={m.total_remaining ? 'warn' : 'pos'} icon="dollar" />
        <Stat label="On credit (open)" value={money(m.credit_outstanding)} sub={m.credit_vouchers ? `${m.credit_vouchers} credit voucher(s)` : 'no credit purchases open'} icon="calendar" />
      </div>
      <div className="grid g2">
        <Card title="Recent payments released" flush actions={<Link to="/vendor/ledger" className="btn sm">Full ledger</Link>}>
          {!d.recent_payments.length ? <Empty icon="wallet" title="No payments yet" hint="Payments released by the company will appear here." /> : (
            <div className="table-wrap"><table className="t"><tbody>{d.recent_payments.map((p) => <tr key={p.payment_no}><td className="nw">{date(p.date)}</td><td>{p.payment_no}{p.voucher_no ? <div className="cell-sub">{p.voucher_no}</div> : null}</td><td>{p.method}</td><td className="num mono">{money(p.amount)}</td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Card title="My bids" actions={<Link to="/vendor/bids" className="btn sm">All bids</Link>}>
          {!d.bids.length ? <Empty icon="file" title="No bids yet" hint="Open contracts announced by the company appear under Open contracts." to={{ href: '/vendor/tenders', label: 'See open contracts' }} /> : (
            <div className="row wrap">{d.bids.map((b) => <span key={b.status} className="row" style={{ gap: 6 }}><BidPill status={b.status} /><b>{b.n}</b></span>)}</div>
          )}
          {d.tenders.closing_soon > 0 && <div className="alert warn" style={{ marginTop: 12 }}>{d.tenders.closing_soon} open contract(s) close within 3 days.</div>}
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ payments
export function VendorPayments() {
  const toast = useToast();
  const [tab, setTab] = useState(new URLSearchParams(window.location.search).get('tab') === 'open' ? 'credit' : 'all');
  const vouchers = useFetch('/api/vendor/vouchers', tab === 'credit' ? { credit: 1, open: 1 } : undefined, [tab]);
  const pays = useFetch(tab === 'paid' ? '/api/vendor/payments' : null);
  const [sel, setSel] = useState(null);
  const open = async (id) => setSel(await api.get(`/api/vendor/vouchers/${id}`));
  const s = vouchers.data?.summary;
  return (
    <div className="stack">
      <div><h2 style={{ fontSize: 20 }}>Payments</h2><div className="muted">Every figure here is read from the company’s accounting books and the approved expense vouchers.</div></div>
      {s && <div className="grid g4">
        <Stat label="Billed" value={money(s.total_billed)} icon="receipt" /><Stat label="Released" value={money(s.total_released)} tone="pos" icon="wallet" />
        <Stat label="Remaining" value={money(s.total_remaining)} tone={s.total_remaining ? 'warn' : 'pos'} icon="dollar" /><Stat label="Credit overdue" value={money(s.credit_overdue)} tone={s.credit_overdue ? 'neg' : ''} icon="clock" />
      </div>}
      <Card flush>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'all', label: 'All vouchers' }, { key: 'credit', label: 'On credit (open)' }, { key: 'paid', label: 'Payments released' }]} />
        {tab === 'paid' ? (!pays.data ? <Loading /> : !pays.data.rows.length ? <Empty icon="wallet" title="No payments yet" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Payment</th><th>Voucher</th><th>Method</th><th>Reference</th><th className="num">Amount</th></tr></thead>
            <tbody>{pays.data.rows.map((p) => <tr key={p.id}><td className="nw">{date(p.date)}</td><td className="nw">{p.payment_no}</td><td>{p.voucher_no}<div className="cell-sub">{p.description}</div></td><td>{p.method}</td><td>{p.reference_no}</td><td className="num mono">{money(p.amount)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={5}>Total released</td><td className="num mono">{money(pays.data.total_released)}</td></tr></tfoot></table></div>
        )) : (!vouchers.data ? <Loading /> : !vouchers.data.rows.length ? <Empty icon="receipt" title={tab === 'credit' ? 'No open credit' : 'No vouchers yet'} hint={tab === 'credit' ? 'You have no unpaid credit invoices.' : 'Approved purchases from the company appear here.'} /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Voucher</th><th>Date</th><th>For</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Balance</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>{vouchers.data.rows.map((v) => (
              <tr key={v.id} className="click" onClick={() => open(v.id)}><td className="nw cell-main">{v.voucher_no}{v.is_credit ? <span className="pill amber" style={{ marginLeft: 6 }}>Credit</span> : null}</td><td className="nw">{date(v.date)}</td>
                <td>{v.description}<div className="cell-sub">{v.project_name}</div></td><td className="num mono">{money(v.amount)}</td><td className="num mono pos">{money(v.paid_amount)}</td><td className="num mono">{money(v.balance)}</td>
                <td className="nw">{v.is_credit && v.balance > 0 ? <span className={v.overdue ? 'neg bold' : ''}>{date(v.due_date)}{v.overdue ? ' · overdue' : ''}</span> : '—'}</td><td><StatusBadge status={v.status} /></td>
                <td className="right" onClick={(e) => e.stopPropagation()}><button className="btn sm" onClick={() => download(`/api/vendor/vouchers/${v.id}/pdf`, {}, `voucher-${v.voucher_no}.pdf`).catch((e) => toast(e.message, 'err'))}>PDF</button></td></tr>))}</tbody></table></div>
        ))}
      </Card>
      {sel && (
        <Modal title={`${sel.voucher_no} — ${money(sel.amount)}`} size="sm" onClose={() => setSel(null)} footer={<button className="btn primary" onClick={() => download(`/api/vendor/vouchers/${sel.id}/pdf`, {}, `voucher-${sel.voucher_no}.pdf`).catch((e) => toast(e.message, 'err'))}><Icon name="download" size={14} />Download voucher</button>}>
          <div className="stack">
            <KV items={[['Date', date(sel.date)], ['For', sel.description], ['Project', sel.project_name], ['Amount', money(sel.amount)], ['Paid', money(sel.paid_amount)], ['Balance', <b>{money(sel.balance)}</b>], sel.is_credit ? ['Credit — due', date(sel.due_date)] : null, ['Status', sel.status]]} />
            <b>Payments released</b>
            {!sel.payments.length ? <div className="muted">Nothing released against this voucher yet.</div> : sel.payments.map((p) => <div key={p.payment_no} className="row between"><span>{date(p.date)} · {p.payment_no}{p.method ? ` · ${p.method}` : ''}</span><b className="mono">{money(p.amount)}</b></div>)}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ledger
export function VendorLedger() {
  const toast = useToast();
  const [r, setR] = useState({ from: '', to: '' });
  const { data, error } = useFetch('/api/vendor/ledger', { from: r.from || undefined, to: r.to || undefined }, [r.from, r.to]);
  const get = (format) => download('/api/vendor/ledger', { from: r.from || undefined, to: r.to || undefined, format }, `ledger.${format}`).catch((e) => toast(e.message, 'err'));
  return (
    <div className="stack">
      <div className="row between wrap"><div><h2 style={{ fontSize: 20 }}>Account ledger</h2><div className="muted">Everything billed to the company and everything paid to you, with a running balance.</div></div>
        <div className="row wrap"><button className="btn" onClick={() => get('pdf')}><Icon name="download" size={14} />PDF</button><button className="btn" onClick={() => get('xlsx')}>Excel</button><button className="btn" onClick={() => get('csv')}>CSV</button></div></div>
      <Card>
        <div className="row wrap" style={{ gap: 10 }}>
          <Field label="From"><input className="input" type="date" value={r.from} max={r.to || todayPK()} onChange={(e) => setR({ ...r, from: e.target.value })} /></Field>
          <Field label="To"><input className="input" type="date" value={r.to} min={r.from} onChange={(e) => setR({ ...r, to: e.target.value })} /></Field>
          {(r.from || r.to) && <button className="btn ghost" style={{ alignSelf: 'flex-end' }} onClick={() => setR({ from: '', to: '' })}>Clear</button>}
        </div>
      </Card>
      {error ? <div className="alert err">{error}</div> : !data ? <Loading /> : (
        <>
          <div className="grid g4">
            <Stat label="Opening balance" value={money(data.opening)} icon="history" /><Stat label="Billed" value={money(data.total_billed)} icon="receipt" />
            <Stat label="Paid" value={money(data.total_paid)} tone="pos" icon="wallet" /><Stat label="Balance due to you" value={money(data.balance)} tone={data.balance ? 'warn' : 'pos'} icon="dollar" />
          </div>
          <Card flush>
            {!data.entries.length && !data.opening ? <Empty icon="history" title="No entries in this period" /> : (
              <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Voucher / ref</th><th>Description</th><th className="num">Billed</th><th className="num">Paid</th><th className="num">Balance due</th></tr></thead>
                <tbody>
                  {r.from && <tr><td className="nw">{date(r.from)}</td><td /><td><i>Opening balance</i></td><td /><td /><td className="num mono">{money(data.opening)}</td></tr>}
                  {data.entries.map((e, i) => <tr key={i}><td className="nw">{date(e.date)}</td><td className="nw mono">{e.ref}</td><td>{e.description}<div className="cell-sub">{e.project_name}</div></td><td className="num mono">{e.billed ? money(e.billed) : ''}</td><td className="num mono pos">{e.paid ? money(e.paid) : ''}</td><td className="num mono">{money(e.balance)}</td></tr>)}
                </tbody>
                <tfoot><tr><td colSpan={3}>Closing balance (payable to you)</td><td className="num mono">{money(data.total_billed)}</td><td className="num mono">{money(data.total_paid)}</td><td className="num mono">{money(data.balance)}</td></tr></tfoot></table></div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ announcements: open contracts
export function VendorTenders() {
  const nav = useNavigate();
  const [f, setF] = useState('open');
  const { data, error } = useFetch('/api/vendor/tenders');
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const rows = data.rows.filter((x) => (f === 'open' ? x.is_open : f === 'mine' ? x.my_bid_status : !x.is_open));
  return (
    <div className="stack">
      <div><h2 style={{ fontSize: 20 }}>Open contracts</h2><div className="muted">Work the company has announced. Open one to see the scope and BOQ, then submit your rates and proposal.</div></div>
      <div className="top-tabs">{[['open', `Open for bidding (${data.rows.filter((x) => x.is_open).length})`], ['mine', 'I have bid'], ['closed', 'Closed / decided']].map(([k, l]) => <button key={k} className={`chip ${f === k ? 'active' : ''}`} onClick={() => setF(k)}>{l}</button>)}</div>
      {!rows.length ? <Card><Empty icon="file" title={f === 'open' ? 'No open contracts right now' : 'Nothing here'} hint={f === 'open' ? 'You will be notified as soon as the company announces new work.' : undefined} /></Card> : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {rows.map((t) => (
            <button key={t.id} className="card tender-card" onClick={() => nav(`/vendor/tenders/${t.id}`)}>
              <div className="row between"><span className="mono muted">{t.tender_no}</span>{t.is_open ? <span className={`pill ${t.days_left <= 3 ? 'amber' : 'green'}`}>{when(t.days_left)}</span> : <StatusBadge status={t.status} />}</div>
              <h3>{t.title}</h3>
              <div className="muted">{[t.category, t.project_name, t.location].filter(Boolean).join(' · ')}</div>
              <div className="row between" style={{ marginTop: 10 }}>
                <span className="muted">{t.boq_lines ? `${t.boq_lines} BOQ lines` : 'Lump-sum price'} · closes {date(t.closes_on)}{t.estimated_budget ? ` · budget ${money(t.estimated_budget)}` : ''}</span>
                {t.my_bid_status ? <span className="row" style={{ gap: 6 }}><BidPill status={t.my_bid_status} /><b className="mono">{money(t.my_bid_total)}</b></span> : t.is_open ? <span className="btn sm primary">Bid now</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function VendorTenderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data: t, error, reload } = useFetch(`/api/vendor/tenders/${id}`);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState('BOQ');
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const f = useMemo(() => form || (t && {
    rates: Object.fromEntries((t.my_bid?.boq_rates || []).map((x) => [x.no, x.rate])), total: t.my_bid && !t.boq.length ? t.my_bid.total_amount : '',
    duration_days: t.my_bid?.duration_days ?? '', validity_days: t.my_bid?.validity_days ?? 30, proposal: t.my_bid?.proposal || '', payment_terms: t.my_bid?.payment_terms || '', notes: t.my_bid?.notes || '',
  }), [form, t]);
  if (error) return <div className="alert err">{error}</div>;
  if (!t) return <Loading />;
  const set = (k, v) => setForm({ ...f, [k]: v });
  const bid = t.my_bid;
  const editable = t.is_open && (!bid || ['submitted', 'withdrawn'].includes(bid.status));
  const lines = t.boq.map((l) => ({ ...l, rate: Number(f.rates[l.no]) || 0 }));
  const total = t.boq.length ? lines.reduce((s, l) => s + Math.round(l.qty * l.rate), 0) : Number(f.total) || 0;
  const missing = t.boq.length ? lines.filter((l) => !(l.rate > 0)).length : (total > 0 ? 0 : 1);
  const submit = async () => {
    setBusy(true);
    try {
      const body = { duration_days: f.duration_days || null, validity_days: f.validity_days || null, proposal: f.proposal, payment_terms: f.payment_terms, notes: f.notes };
      if (t.boq.length) body.boq_rates = lines.map((l) => ({ no: l.no, rate: l.rate })); else body.total_amount = Number(f.total);
      const r = await api.post(`/api/vendor/tenders/${t.id}/bid`, body);
      toast(bid && bid.status !== 'withdrawn' ? 'Bid updated' : `Bid submitted — ${money(r.total_amount)}`, 'ok'); setForm(null); reload();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const upload = async (files) => {
    const fd = new FormData(); fd.append('category', cat); files.forEach((x) => fd.append('files', x));
    try { await api.upload(`/api/vendor/bids/${bid.id}/files`, fd); toast('File attached to your bid', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const FileRow = ({ x, removable }) => (
    <div className="row between" style={{ padding: '6px 0' }}><span><Icon name="file" size={14} /> <a href={`/api/vendor/files/${x.id}`} target="_blank" rel="noreferrer">{x.name}</a> <span className="tag">{x.category}</span></span>
      {removable && editable && <button className="btn sm ghost danger" onClick={async () => { try { await api.del(`/api/vendor/files/${x.id}`); reload(); } catch (e) { toast(e.message, 'err'); } }}>Remove</button>}</div>
  );
  return (
    <div className="stack">
      <Link to="/vendor/tenders" className="muted">← Open contracts</Link>
      <div><div className="row wrap"><span className="mono muted">{t.tender_no}</span>{t.is_open ? <span className="pill green">{when(Math.round((new Date(`${t.closes_on}T00:00:00Z`) - new Date(`${todayPK()}T00:00:00Z`)) / 86400000))}</span> : <StatusBadge status={t.status} />}</div>
        <h2 style={{ fontSize: 22, marginTop: 4 }}>{t.title}</h2><div className="muted">{[t.category, t.project_name, t.location].filter(Boolean).join(' · ')} · closing {date(t.closes_on)}</div></div>
      {t.outcome === 'won' && <div className="alert ok"><b>Congratulations — this contract was awarded to you.</b>{t.award_note ? ` ${t.award_note}` : ''} The company will contact you with the next steps.</div>}
      {t.outcome === 'not_selected' && <div className="alert info">This contract has been awarded to another vendor. Thank you for bidding.</div>}
      {t.outcome === 'cancelled' && <div className="alert warn">The company cancelled this contract.</div>}
      <div className="grid g2">
        <Card title="About this contract"><div className="stack">
          {t.description && <div style={{ whiteSpace: 'pre-wrap' }}>{t.description}</div>}
          {t.scope && <div><b>Scope of work</b><div style={{ whiteSpace: 'pre-wrap' }}>{t.scope}</div></div>}
          {t.required_docs && <div><b>Please include</b><div style={{ whiteSpace: 'pre-wrap' }}>{t.required_docs}</div></div>}
          {t.estimated_budget ? <div><b>Budget</b> {money(t.estimated_budget)}</div> : null}
        </div></Card>
        <Card title="Company documents">{!t.files.length ? <div className="muted">No drawings or documents attached.</div> : t.files.map((x) => <div key={x.id} className="row between" style={{ padding: '6px 0' }}><span><Icon name="file" size={14} /> {x.name} <span className="tag">{x.category}</span></span><a className="btn sm" href={`/api/vendor/files/${x.id}?download=1`}>Download</a></div>)}</Card>
      </div>

      <Card title={editable ? (bid && bid.status !== 'withdrawn' ? 'Your bid — you can update it until the contract closes' : 'Submit your bid') : 'Your bid'} actions={bid ? <BidPill status={bid.status} /> : null}>
        {!editable && !bid ? <div className="muted">Bidding on this contract is closed.</div> : (
          <div className="stack">
            {t.boq.length > 0 ? (
              <div className="table-wrap"><table className="t bid-boq"><thead><tr><th>#</th><th>Item</th><th className="u">Unit</th><th className="num">Qty</th><th className="num" style={{ minWidth: 150 }}>Your rate (PKR)</th><th className="num">Amount</th></tr></thead>
                <tbody>{lines.map((l) => (
                  <tr key={l.no}><td>{l.no}</td><td>{l.description}</td><td className="u">{l.unit}</td><td className="num mono">{l.qty.toLocaleString('en-PK')}<span className="muted" style={{ fontSize: 11 }}> {l.unit}</span></td>
                    <td className="num">{editable ? <CurrencyInput value={f.rates[l.no] ?? ''} onChange={(v) => set('rates', { ...f.rates, [l.no]: v })} /> : <span className="mono">{money(l.rate)}</span>}</td>
                    <td className="num mono">{l.rate ? money(Math.round(l.qty * l.rate)) : '—'}</td></tr>))}</tbody>
                <tfoot><tr><td colSpan={5}>Total bid</td><td className="num mono">{money(total)}</td></tr></tfoot></table></div>
            ) : (
              <Field label="Your total price (lump sum)" required>{editable ? <CurrencyInput value={f.total} onChange={(v) => set('total', v)} /> : <b className="mono">{money(bid?.total_amount)}</b>}</Field>
            )}
            <div className="form-grid">
              <Field label="Time to complete (days)"><input className="input" type="number" min="1" disabled={!editable} value={f.duration_days} onChange={(e) => set('duration_days', e.target.value)} /></Field>
              <Field label="Bid valid for (days)"><input className="input" type="number" min="1" disabled={!editable} value={f.validity_days} onChange={(e) => set('validity_days', e.target.value)} /></Field>
              <Field label="Your payment terms" className="full"><input className="input" disabled={!editable} value={f.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} placeholder="e.g. 30% advance, balance on measured work" /></Field>
              <Field label="Proposal" className="full" hint="Method statement, experience, crew and equipment — anything that supports your price."><textarea className="textarea" rows={5} disabled={!editable} value={f.proposal} onChange={(e) => set('proposal', e.target.value)} /></Field>
              <Field label="Notes to the company" className="full"><textarea className="textarea" rows={2} disabled={!editable} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            </div>
            {editable && (
              <div className="row wrap">
                <button className="btn primary" disabled={busy || missing > 0} onClick={submit}>{busy ? 'Saving…' : bid && bid.status !== 'withdrawn' ? 'Update bid' : 'Submit bid'}</button>
                {missing > 0 && <span className="muted">{t.boq.length ? `Enter a rate for ${missing} more line(s)` : 'Enter your total price'}</span>}
                {bid && bid.status === 'submitted' && <button className="btn danger" style={{ marginLeft: 'auto' }} onClick={() => setConfirmWithdraw(true)}>Withdraw bid</button>}
              </div>
            )}
          </div>
        )}
      </Card>

      {bid && bid.status !== 'withdrawn' && (
        <Card title="Attachments — rates sheet (BOQ), proposal and supporting documents">
          {editable && <div className="stack" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 8 }}><span className="muted">Type</span><select className="select" style={{ width: 200 }} value={cat} onChange={(e) => setCat(e.target.value)}>{['BOQ', 'Proposal', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></div>
            <FileUploader onFiles={upload} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" hint="PDF, Word, Excel or images — up to 25 MB each" />
          </div>}
          {!bid.files.length ? <div className="muted">Nothing attached yet.</div> : bid.files.map((x) => <FileRow key={x.id} x={x} removable />)}
        </Card>
      )}
      {confirmWithdraw && (
        <Modal title="Withdraw your bid?" size="sm" onClose={() => setConfirmWithdraw(false)} footer={<><button className="btn" onClick={() => setConfirmWithdraw(false)}>Keep my bid</button>
          <button className="btn danger" onClick={async () => { try { await api.del(`/api/vendor/tenders/${t.id}/bid`); toast('Bid withdrawn', 'ok'); setConfirmWithdraw(false); setForm(null); reload(); } catch (e) { toast(e.message, 'err'); } }}>Withdraw</button></>}>
          You can submit a new bid until {date(t.closes_on)}.
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ my bids & registration
export function VendorBids() {
  const { data } = useFetch('/api/vendor/bids');
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <h2 style={{ fontSize: 20 }}>My bids</h2>
      <Card flush>{!data.rows.length ? <Empty icon="file" title="You haven’t bid on anything yet" to={{ href: '/vendor/tenders', label: 'See open contracts' }} /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Contract</th><th>Submitted</th><th className="num">Your price</th><th>Days</th><th>Bid</th><th>Contract</th></tr></thead>
          <tbody>{data.rows.map((b) => <tr key={b.id}><td><Link to={`/vendor/tenders/${b.tender_id}`} className="cell-main">{b.title}</Link><div className="cell-sub">{b.tender_no}</div></td><td className="nw">{date(b.submitted_at)}</td>
            <td className="num mono">{money(b.total_amount)}</td><td>{b.duration_days ?? '—'}</td><td><BidPill status={b.status} /></td><td><StatusBadge status={b.tender_status} /></td></tr>)}</tbody></table></div>
      )}</Card>
    </div>
  );
}

export function VendorProfile() {
  const { data: p, error } = useFetch('/api/vendor/profile');
  const toast = useToast();
  const [pw, setPw] = useState({ current: '', next: '' });
  if (error) return <div className="alert err">{error}</div>;
  if (!p) return <Loading />;
  const r = p.registration;
  return (
    <div className="stack">
      <div><h2 style={{ fontSize: 20 }}>Your registration with the company</h2><div className="muted">If anything here is wrong, please contact the accounts team to correct it.</div></div>
      <div className="grid g2">
        <Card title="Registration"><KV items={[['Vendor ID', <b className="mono">{r.vendor_code}</b>], ['Name', r.name], ['Company', r.company], ['Category', r.category], ['Status', <StatusBadge status={r.status} />], ['Registered on', date(r.registered_on)],
          ['CNIC / NTN', r.cnic_tax], ['Phone', r.phone], ['E-mail', r.email], ['Address', r.address], ['Payment terms', r.payment_terms], ['Bank details', r.bank_details]]} /></Card>
        <div className="stack">
          <Card title="Work with the company"><KV items={[['Projects supplied', p.worked_on.length ? p.worked_on.join(', ') : '—'], ['First approved voucher', p.first_voucher ? date(p.first_voucher) : '—'], ['Contracts won', p.contracts_won.length || '0']]} />
            {p.contracts_won.map((c) => <div key={c.tender_no} className="row between" style={{ padding: '4px 0' }}><span>{c.tender_no} · {c.title}</span><b className="mono">{money(c.total_amount)}</b></div>)}</Card>
          <Card title="Portal login"><div className="stack"><KV items={[['Login e-mail', p.portal.login], ['Last sign-in', p.portal.last_login ? date(p.portal.last_login) : '—']]} />
            <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password (8+ characters)"><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!pw.current || pw.next.length < 8} onClick={async () => { try { await api.post('/api/auth/change-password', pw); toast('Password changed', 'ok'); setPw({ current: '', next: '' }); } catch (e) { toast(e.message, 'err'); } }}>Change password</button></div></Card>
        </div>
      </div>
    </div>
  );
}
