import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { InstallmentTable, SaleLedgerSummary } from '../components/SaleBits.jsx';
import { Journey, PayCalendar } from '../components/Journey.jsx';
import { Card, Empty, KV, LedgerSummary, Loading, ProgressBar, StatusBadge, Tabs } from '../components/ui.jsx';
import { download, fileUrl } from '../api.js';
import LedgerViewer from '../components/LedgerViewer.jsx';
import { printPdf } from '../printPdf.js';
import { NotificationBell, NotificationCentre } from '../components/Notifications.jsx';
export function PortalNotifications() { return <div className="stack"><h2 style={{ fontSize: 20, margin: 0 }}>Notifications</h2><NotificationCentre /></div>; }
import { DuesCard, MyPaymentReports, OnlinePayBanner, PayNowModal } from '../components/PayNow.jsx';
import { ScheduleView } from '../components/Schedule.jsx';
import { DocFooter, DocHeader } from '../components/DocBrand.jsx';
import { useAuth, useFetch } from '../context.jsx';
import { useBrand } from '../brand.js';
import { date, money } from '../format.js';

export function PortalLayout() {
  const { user, logout } = useAuth();
  const brand = useBrand();
  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <header className="portal-top">
        <div className="brand" style={{ padding: 0 }}><div className="brand-mark"><Icon name="home" size={18} stroke={2.2} /></div><div className="brand-name">{brand.name}<small>Customer portal</small></div></div>
        <nav className="row" style={{ gap: 16, marginLeft: 20 }}>
          <NavLink to="/portal" end className={({ isActive }) => (isActive ? 'active' : '')}>My properties</NavLink>
          <NavLink to="/portal/development" className={({ isActive }) => (isActive ? 'active' : '')}>Development</NavLink>
          <NavLink to="/portal/construction" className={({ isActive }) => (isActive ? 'active' : '')}>Construction</NavLink>
          <NavLink to="/portal/payments" className={({ isActive }) => (isActive ? 'active' : '')}>Payments</NavLink>
          <NavLink to="/portal/documents" className={({ isActive }) => (isActive ? 'active' : '')}>Documents</NavLink>
          <NavLink to="/portal/offers" className={({ isActive }) => (isActive ? 'active' : '')}>Offers</NavLink>
        </nav>
        <div className="grow" /><NotificationBell allHref="/portal/notifications" /><span style={{ color: '#cfd8ea' }} className="nowrap">{user.name}</span>
        <button className="btn sm" onClick={logout}>Sign out</button>
      </header>
      <div className="portal-body"><Suspense fallback={<Loading />}><Outlet /></Suspense></div>
    </div>
  );
}

export function PortalDashboard() {
  const { data: d, error } = useFetch('/api/portal/dashboard');
  if (error) return <div className="alert err">{error}</div>;
  if (!d) return <Loading />;
  const t = d.totals;
  return (
    <div className="stack">
      <div><h2 style={{ fontSize: 20 }}>Welcome, {d.customer.full_name}</h2><div className="muted">{d.customer.customer_code ? <>Customer ID <b className="mono">{d.customer.customer_code}</b> · </> : null}Here is a summary of your purchases and payments.</div></div>
      {d.totals.overdue > 0 && <div className="alert err">You have <b>{money(t.overdue)}</b> overdue. Please contact us or pay at your earliest convenience.</div>}
      <div className="grid g4">
        <div className="card stat"><span className="label">Total purchase value</span><span className="value">{money(t.purchase_value)}</span></div>
        <div className="card stat"><span className="label">Amount paid</span><span className="value pos">{money(t.paid)}</span></div>
        <div className="card stat"><span className="label">Outstanding balance</span><span className="value warn">{money(t.outstanding)}</span></div>
        <div className="card stat"><span className="label">Next installment</span>{d.next_installment ? <><span className="value">{money(d.next_installment.amount)}</span><span className="sub-v">due {date(d.next_installment.due_date)} · {d.next_installment.property}</span><Link to="/portal/payments?pay=1" className="btn sm primary" style={{ marginTop: 6, alignSelf: 'flex-start' }}>Pay now</Link></> : <span className="value pos">Nothing due</span>}</div>
      </div>
      {d.bundles?.length > 0 && d.bundles.map((b) => (
        <Card key={b.id} title="Combined payment plan" actions={<span className="pill blue">{b.sales.map((x) => (x.kind === 'construction' ? 'House construction' : 'Plot')).join(' + ')}</span>}>
          <div className="grid g4">
            <div className="sum-box"><div className="l">Monthly installment</div><div className="v">{money(b.monthly_total)}</div></div>
            <div className="sum-box"><div className="l">Total value</div><div className="v">{money(b.net_price)}</div></div>
            <div className="sum-box"><div className="l">Paid</div><div className="v pos">{money(b.paid_amount)}</div></div>
            <div className="sum-box"><div className="l">Outstanding</div><div className="v warn">{money(b.outstanding)}</div></div>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>Each payment is split between the plot and the construction. Open either one below to see its own ledger and the combined schedule.</div>
        </Card>
      ))}
      <h3>My properties & contracts</h3>
      {!d.properties.length ? <Empty>You have no purchased properties yet.</Empty> : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {d.properties.map((p) => (
            <Link key={p.sale_id} to={`/portal/property/${p.sale_id}`} className="card prop-card" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="img">{p.cover ? <img src={fileUrl(p.cover)} alt={p.title} /> : <Icon name="building" size={34} />}</div>
              <div style={{ padding: 14 }}>
                <div className="row between"><div className="bold" style={{ fontSize: 14 }}>{p.title}</div>{p.kind === 'construction' && <span className="pill purple">Construction</span>}</div><div className="muted">{p.project} {p.plot_no ? `· Plot ${p.plot_no}` : ''}{p.block ? ` · Block ${p.block}` : ''}</div>
                <div style={{ margin: '10px 0 4px' }}><ProgressBar value={Math.round((p.paid / p.net_price) * 100)} tone="green" /></div>
                <div className="row between"><span className="muted">Paid {money(p.paid)}</span><b>{money(p.outstanding)} left</b></div>
                {p.schedule && <div style={{ marginTop: 8 }}><div className="row between" style={{ fontSize: 12 }}><span className="muted">Build progress {p.schedule.actual_pct}% (planned {p.schedule.planned_pct}%)</span><span className={p.schedule.health === 'on_track' ? 'pos' : p.schedule.health === 'at_risk' ? 'warn' : 'neg'}>{p.schedule.health === 'on_track' ? 'On track' : p.schedule.projected_delay_days > 0 ? `Delayed +${p.schedule.projected_delay_days}d` : 'At risk'}</span></div><ProgressBar value={p.schedule.actual_pct} /></div>}
              </div>
            </Link>
          ))}
        </div>
      )}
      {d.development.length > 0 && <><h3>Development status</h3><div className="grid g2">{d.development.map((p) => <Card key={p.id}><div className="row between"><b>{p.name}</b><span className="pill blue">{p.dev_status}</span></div><div className="row" style={{ marginTop: 10 }}><div className="grow"><ProgressBar value={p.progress || 0} /></div><b>{p.progress || 0}%</b></div><Link to="/portal/development">View updates →</Link></Card>)}</div></>}
      <h3>Recent payments</h3>
      <Card flush>{!d.recent_payments.length ? <Empty>No payments yet.</Empty> : <table className="t"><tbody>{d.recent_payments.map((r) => <tr key={r.receipt_no}><td>{date(r.date)}</td><td>{r.receipt_no}</td><td>{r.payment_type}</td><td>{r.method}</td><td className="num mono">{money(r.amount)}</td></tr>)}</tbody></table>}</Card>
    </div>
  );
}

export function PortalProperty() {
  const { id } = useParams();
  const { data: d, error } = useFetch(`/api/portal/properties/${id}`);
  const [tab, setTab] = useState('plan');
  const [zoom, setZoom] = useState(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!d) return <Loading />;
  const s = d.sale, p = d.property;
  const b = d.bundle;
  const view = { ...s, sale_price: s.sale_price, installments_paid: s.installments_paid, installments_remaining: s.installments_remaining };
  return (
    <div className="stack">
      <Link to="/portal" className="muted">← My properties</Link>
      <div><h2 style={{ fontSize: 20 }}>{p.title} {s.kind === 'construction' && <span className="pill purple">Construction contract</span>}</h2><div className="muted">{d.project?.name} {p.plot_no ? `· Plot ${p.plot_no}` : ''}{p.block ? ` · Block ${p.block}` : ''}{p.area_size ? ` · ${p.area_size} ${p.unit}` : ''} · {s.sale_no}</div></div>
      {b && <Card title="Combined payment plan"><div className="grid g4"><div className="sum-box"><div className="l">Monthly installment</div><div className="v">{money(b.monthly_total)}</div></div><div className="sum-box"><div className="l">Combined value</div><div className="v">{money(b.net_price)}</div></div><div className="sum-box"><div className="l">Paid</div><div className="v pos">{money(b.paid_amount)}</div></div><div className="sum-box"><div className="l">Outstanding</div><div className="v warn">{money(b.outstanding)}</div></div></div><table className="t" style={{ marginTop: 10 }}><thead><tr><th>For</th><th className="num">Monthly share</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead><tbody>{b.sales.map((x) => <tr key={x.id}><td>{x.kind === 'construction' ? 'House construction' : 'Plot'} — {x.title}</td><td className="num mono">{money(x.installment_amount)}</td><td className="num mono">{money(x.paid_amount)}</td><td className="num mono">{money(x.outstanding)}</td></tr>)}</tbody></table></Card>}
      {d.images.length > 0 && <div className="gallery">{d.images.map((m) => <img key={m.id} src={fileUrl(m.path)} alt={m.caption || p.title} onClick={() => setZoom(m)} />)}</div>}
      {d.installments.length > 0 && <Card title="Your journey"><Journey sale={s} rows={d.installments} property={p} schedule={d.schedule?.summary || d.schedule} /></Card>}
      <Card><SaleLedgerSummary s={view} /></Card>
      <Card flush>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'plan', label: 'Payment plan' }, { key: 'calendar', label: 'Calendar' }, ...(b ? [{ key: 'combined', label: 'Combined schedule' }] : []), { key: 'receipts', label: 'Receipts', count: d.receipts.length }, { key: 'ledger', label: b ? 'Ledger (this item)' : 'Ledger' }, ...(b ? [{ key: 'bledger', label: 'Combined ledger' }] : []), ...(d.schedule ? [{ key: 'schedule', label: 'Build schedule' }] : []), { key: 'docs', label: 'Documents', count: d.documents.length }, { key: 'info', label: 'Details' }]} />
        {tab === 'plan' && <InstallmentTable rows={d.installments} portal />}
        {tab === 'calendar' && <div className="card-b"><PayCalendar rows={d.installments} /></div>}
        {tab === 'combined' && b && <div className="table-wrap"><table className="t"><thead><tr><th>Due date</th>{b.sales.map((x) => <th key={x.id} className="num">{x.kind === 'construction' ? 'Construction' : 'Plot'}</th>)}<th className="num">Total due</th><th className="num">Paid</th><th>Status</th></tr></thead>
          <tbody>{b.schedule.map((m) => <tr key={m.due_date}><td>{date(m.due_date)}</td>{b.sales.map((x) => { const amt = m.parts.filter((p) => p.sale_id === x.id).reduce((a, p) => a + p.amount, 0); return <td key={x.id} className="num mono">{amt ? money(amt) : ''}</td>; })}<td className="num mono bold">{money(m.amount)}</td><td className="num mono">{money(m.paid)}</td><td><StatusBadge status={m.status} /></td></tr>)}</tbody></table></div>}
        {tab === 'bledger' && d.bundle_ledger && <div className="card-b"><LedgerViewer saleId={s.id} combined /></div>}
        {tab === 'schedule' && d.schedule && <div className="card-b"><ScheduleView schedule={d.schedule} /></div>}
        {tab === 'receipts' && <div className="card-b">{!d.receipts.length ? <Empty>No receipts yet.</Empty> : <table className="t"><thead><tr><th>Receipt</th><th>Date</th><th>Type</th><th>Method</th><th className="num">Amount</th></tr></thead><tbody>{d.receipts.map((r) => <tr key={r.id}><td>{r.receipt_no}</td><td>{date(r.date)}</td><td>{r.payment_type}</td><td>{r.method}</td><td className="num mono">{money(r.amount)}{r.parts > 1 && <div className="cell-sub">part of a combined payment</div>}</td></tr>)}</tbody></table>}</div>}
        {tab === 'ledger' && <div className="card-b"><LedgerViewer saleId={s.id} /></div>}
        {tab === 'docs' && <div className="card-b">{!d.documents.length ? <Empty>No documents shared yet.</Empty> : d.documents.map((x) => <div key={x.id} className="row between" style={{ padding: '6px 0' }}><span>{x.name} <span className="tag">{x.category}</span></span><a className="btn sm" href={`/api/portal/documents/${x.id}/file`} target="_blank" rel="noreferrer">Open</a></div>)}</div>}
        {tab === 'info' && <div className="card-b"><KV items={[['Property', p.title], ['Type', p.property_type], ['Project', d.project?.name], ['Plot', p.plot_no], ['Block', p.block], ['Area', `${p.area_size} ${p.unit}`], ['City', p.city], ['Location', p.location], ['Purchase price', money(s.net_price)], ['Sale date', date(s.sale_date)]]} /></div>}
      </Card>
      {zoom && <div className="lightbox" onClick={() => setZoom(null)}><img src={fileUrl(zoom.path)} alt={zoom.caption || ''} /></div>}
    </div>
  );
}

export function PortalDevelopment() {
  const { data, error } = useFetch('/api/portal/development');
  const [zoom, setZoom] = useState(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <h2 style={{ fontSize: 20 }}>Development progress</h2>
      {!data.length && <Empty>No development projects linked to your purchases yet.</Empty>}
      {data.map((p) => (
        <Card key={p.id} title={p.name} actions={<span className="pill blue">{p.dev_status}</span>}>
          <div className="row" style={{ marginBottom: 14 }}><b>Overall</b><div className="grow"><ProgressBar value={p.progress} /></div><b>{p.progress}%</b></div>
          {p.contracts.map((c) => (
            <div key={c.sale_id} style={{ marginBottom: 18 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Your build: {c.title}</div>
              <ScheduleView schedule={c.schedule} />
            </div>
          ))}
          {p.schedule && <div style={{ marginBottom: 18 }}><div className="section-title" style={{ marginTop: 0 }}>Project schedule</div><ScheduleView schedule={p.schedule} /></div>}
          {!p.schedule && p.items.map((i) => <div className="dev-row" key={i.name}><span>{i.progress >= 100 ? '✓ ' : ''}{i.name}</span><ProgressBar value={i.progress} tone={i.progress >= 100 ? 'green' : ''} /><b>{i.progress >= 100 ? '✓' : `${i.progress}%`}</b></div>)}
          <div className="section-title">Latest updates</div>
          {!p.updates.length ? <Empty>No updates published yet.</Empty> : p.updates.map((u) => (
            <div key={u.id} style={{ borderTop: '1px solid var(--border)', padding: '12px 0' }}>
              <div className="row between"><b>{u.title}</b><span className="muted">{date(u.update_date)}{u.progress != null ? ` · ${u.progress}%` : ''}</span></div>
              {u.description && <p style={{ margin: '4px 0 8px' }}>{u.description}</p>}
              <div className="gallery">{u.media.filter((m) => m.kind === 'image').map((m) => <img key={m.id} src={fileUrl(m.path)} alt={m.caption || u.title} onClick={() => setZoom(m)} />)}</div>
              {u.media.filter((m) => m.kind === 'video').map((m) => <video key={m.id} src={fileUrl(m.path)} controls style={{ maxWidth: '100%', maxHeight: 320, marginTop: 8, borderRadius: 8 }} />)}
              {u.media.filter((m) => m.kind === 'report').map((m) => <div key={m.id}><a href={fileUrl(m.path)} target="_blank" rel="noreferrer">📄 {m.caption}</a></div>)}
              {u.videos.map((v) => <div key={v}><a href={v} target="_blank" rel="noreferrer">▶ Watch video</a></div>)}
            </div>
          ))}
        </Card>
      ))}
      {zoom && <div className="lightbox" onClick={() => setZoom(null)}><img src={fileUrl(zoom.path)} alt="" /></div>}
    </div>
  );
}

export function PortalPayments() {
  const { data } = useFetch('/api/portal/payments');
  const [sp, setSp] = useSearchParams();
  const [paying, setPaying] = useState(sp.get('pay') === '1' ? [] : null); // null = closed, array = preselected installment ids
  const [bump, setBump] = useState(0);
  const brand = useFetch('/api/portal/branding');
  const [open, setOpen] = useState(null);
  const rc = useFetch(open ? `/api/portal/receipts/${open}` : null);
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="row between wrap"><h2 style={{ fontSize: 20, margin: 0 }}>Payments</h2><button className="btn primary" onClick={() => setPaying([])}>Pay now</button></div>
      <OnlinePayBanner onPaid={() => setBump((n) => n + 1)} />
      <DuesCard refreshKey={bump} onPay={(ids) => setPaying(ids)} />
      <MyPaymentReports refreshKey={bump} onViewReceipt={(id) => { setOpen(id); setTimeout(() => document.querySelector('.print-doc')?.scrollIntoView({ behavior: 'smooth' }), 300); }} />
      <HowToPay />
      {paying && <PayNowModal presetIds={paying.length ? paying : undefined} onClose={() => { setPaying(null); if (sp.get('pay')) setSp({}, { replace: true }); }} onDone={() => setBump((n) => n + 1)} />}
      <h2 style={{ fontSize: 20 }}>Payment history</h2>
      <Card title="My ledger"><LedgerViewer selectable /></Card>
      <Card flush>{!data.length ? <Empty>No payments recorded yet.</Empty> : <table className="t"><thead><tr><th>Date</th><th>Receipt</th><th>Property</th><th>Type</th><th>Method</th><th className="num">Amount</th><th /></tr></thead>
        <tbody>{data.map((r) => <tr key={r.id}><td>{date(r.date)}</td><td>{r.receipt_no}</td><td>{r.property}</td><td>{r.payment_type}</td><td>{r.method}</td><td className="num mono">{money(r.amount)}</td><td className="right"><button className="btn sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'View receipt'}</button></td></tr>)}</tbody></table>}</Card>
      {open && rc.data && (
        <div className="print-doc"><DocHeader kind="receipt" brand={brand.data || {}} title={(brand.data?.receipt_title) || 'RECEIPT'} number={rc.data.receipt_no} />
          <KV items={[['Date', date(rc.data.date)], ['Received from', rc.data.record?.customer_code ? `${rc.data.customer} (${rc.data.record.customer_code})` : rc.data.customer], ['CNIC no.', rc.data.record?.cnic], ['Contact no.', rc.data.record?.phone], ['Registration no.', rc.data.record?.registration_no], ['File #', rc.data.record?.file_no], ['File status', rc.data.record?.file_status], ['Type', rc.data.record?.property_type], ['Plot size', rc.data.record?.plot_size], ['Booking date', rc.data.record?.booking_date ? date(rc.data.record.booking_date) : null], ['Address', rc.data.record?.address], ['Property / contract', rc.data.property], ['Project', rc.data.project], ['Payment type', rc.data.payment_type], ['Method', rc.data.method], ['Reference', rc.data.reference_no || rc.data.txn_id], ['Amount', <b>{money(rc.data.amount)}</b>]]} />
          {rc.data.parts?.length > 1 && <table className="t" style={{ marginTop: 10 }}><thead><tr><th>Applied to</th><th className="num">Share</th></tr></thead><tbody>{rc.data.parts.map((x) => <tr key={x.sale_no}><td>{x.kind === 'construction' ? 'House construction' : 'Plot'} — {x.title}</td><td className="num mono">{money(x.amount)}</td></tr>)}</tbody></table>}
          <DocFooter kind="receipt" brand={brand.data || {}} />
          <div className="no-print row" style={{ marginTop: 14, gap: 8 }}><button className="btn primary" onClick={() => download(`/api/portal/receipts/${open}/pdf`, {}, `receipt-${rc.data.receipt_no}.pdf`).catch(() => {})}>Download PDF</button><button className="btn" onClick={() => printPdf(`/api/portal/receipts/${open}/pdf`).catch(() => {})}>Print</button></div></div>
      )}
    </div>
  );
}

const DOC_GROUPS = [['Contracts & agreements', ['Contract', 'Agreement', 'Allotment Letter']], ['Architectural & construction drawings', ['Architectural Drawing', 'Construction Drawing', 'Site Plan', 'Map']], ['Payment proofs', ['Payment Proof']]];
export function PortalDocuments() {
  const { data } = useFetch('/api/portal/documents');
  const [q, setQ] = useState('');
  if (!data) return <Loading />;
  const rows = data.filter((d) => !q || `${d.name} ${d.category} ${d.related || ''}`.toLowerCase().includes(q.toLowerCase()));
  const used = new Set();
  const groups = DOC_GROUPS.map(([title, cats]) => { const g = rows.filter((d) => cats.includes(d.category)); g.forEach((d) => used.add(d.id)); return [title, g]; });
  groups.push(['Other documents', rows.filter((d) => !used.has(d.id))]);
  const icon = (d) => ((d.mime || '').startsWith('image') ? 'image' : 'file');
  return (
    <div className="stack">
      <div className="row between wrap"><h2 style={{ fontSize: 20, margin: 0 }}>My documents</h2><input className="input" style={{ maxWidth: 260 }} placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!data.length ? <Card><Empty>No documents have been shared with you yet. Your contracts and plot / construction drawings appear here as soon as we upload them.</Empty></Card>
        : groups.filter(([, g]) => g.length).map(([title, g]) => (
          <Card key={title} title={`${title} (${g.length})`} flush>
            <table className="t"><tbody>{g.map((d) => (
              <tr key={d.id}><td><Icon name={icon(d)} size={14} /> <b>{d.name}</b>{d.related && <div className="cell-sub">{d.related}</div>}</td><td><span className="tag">{d.category || 'Document'}</span></td><td className="muted">{date(d.created_at)}</td>
                <td className="right nowrap"><a className="btn sm" href={`/api/portal/documents/${d.id}/file`} target="_blank" rel="noreferrer">View</a>{' '}<a className="btn sm" href={`/api/portal/documents/${d.id}/file`} download={d.name}>Download</a></td></tr>))}</tbody></table>
          </Card>))}
      {data.length > 0 && !rows.length && <Card><Empty>No documents match “{q}”.</Empty></Card>}
    </div>
  );
}

/** Bank / wallet details set in Settings → Payment methods. */
function HowToPay() {
  const { data } = useFetch('/api/portal/pay-to');
  if (!data?.length) return null;
  return (
    <Card title="How to pay">
      <div className="grid g2">{data.map((m) => (
        <div key={m.name} className="card" style={{ padding: 12, background: 'var(--surface-2)' }}>
          <b>{m.name}</b>
          <KV items={[['Bank', m.bank_name], ['Account title', m.account_title], ['Account number', m.account_number], ['IBAN', m.iban], ['Branch', m.branch], ['Wallet number', m.wallet_number]].filter(([, v]) => v)} />
          {m.instructions && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{m.instructions}</div>}
        </div>))}</div>
    </Card>
  );
}

export function PortalOffers() {
  const { data } = useFetch('/api/portal/promos');
  if (!data) return <Loading />;
  const priceText = (n) => (n >= 1e7 ? `PKR ${+(n / 1e7).toFixed(2)} Crore` : n >= 1e5 ? `PKR ${+(n / 1e5).toFixed(2)} Lakh` : `PKR ${n.toLocaleString('en-PK')}`);
  return (
    <div className="stack">
      <h2 style={{ fontSize: 20, margin: 0 }}>Offers & new listings</h2>
      <div className="muted">Current promotions and properties available for sale — tell a friend, or ask us about adding another plot or a house to your portfolio.</div>
      {data.promos.length > 0 && <div className="grid g2">{data.promos.map((p) => (
        <Card key={p.id} flush>
          {p.image && <img src={fileUrl(p.image)} alt={p.title} style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />}
          <div style={{ padding: 14 }}>
            <div className="row between"><b style={{ fontSize: 16 }}>{p.title}</b>{p.price_label && <span className="pill green"><i />{p.price_label}</span>}</div>
            <p style={{ margin: '8px 0' }}>{p.description}</p>
            <div className="muted" style={{ fontSize: 12 }}>{p.project_name || p.property_title ? `${p.project_name || ''}${p.property_title ? ` · ${p.property_title}` : ''}` : ''}{p.valid_until ? ` · valid until ${date(p.valid_until)}` : ''}</div>
          </div>
        </Card>))}</div>}
      <h3 style={{ margin: '8px 0 0' }}>Available for sale</h3>
      {!data.listings.length ? <Card><Empty>No listings right now — check back soon.</Empty></Card> : (
        <div className="grid g3">{data.listings.map((l) => (
          <Card key={l.id} flush>
            {l.cover ? <img src={fileUrl(l.cover)} alt={l.title} style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} /> : <div style={{ height: 150, background: 'linear-gradient(135deg,#e2e8f0,#cbd5e1)' }} />}
            <div style={{ padding: 12 }}>
              <div className="row between"><b>{l.title}</b>{l.featured ? <span className="pill blue"><i />Featured</span> : null}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{[l.project_name, l.city || l.location, l.area_size && `${l.area_size} ${l.unit}`].filter(Boolean).join(' · ')}</div>
              <div style={{ marginTop: 6 }}><b style={{ color: 'var(--primary)' }}>{priceText(l.net_price)}</b>{l.installment_available ? <span className="tag" style={{ marginLeft: 6 }}>Installments</span> : null}</div>
            </div>
          </Card>))}</div>
      )}
    </div>
  );
}

/** Construction progress for the client's own projects: completion, milestones, change orders and site reports. */
export function PortalConstruction() {
  const { data, error } = useFetch('/api/portal/construction');
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  if (!data.length) return <Empty title="No construction projects" hint="When we build for you, progress appears here." />;
  return (
    <div className="stack">
      {data.map((p) => (
        <Card key={p.id} title={p.name}>
          <div className="muted">{[p.location, p.expected_completion && `expected completion ${p.expected_completion}`].filter(Boolean).join(' · ')}</div>
          {p.percent_complete != null && <div style={{ margin: '10px 0' }}><ProgressBar value={p.percent_complete} tone="green" /><div className="muted">{p.percent_complete}% of the work measured as complete</div></div>}
          {!!p.milestones.length && <><h4>Milestones</h4><ul>{p.milestones.map((m) => <li key={m.id}>{m.achieved_at ? '✅' : '⬜'} {m.name}{m.due_date ? ` (due ${m.due_date})` : ''}</li>)}</ul></>}
          {!!p.change_orders.length && <><h4>Changes to the work</h4><ul>{p.change_orders.map((c) => <li key={c.co_no}><b>{c.title}</b> · {c.status === 'approved' ? 'approved' : 'awaiting decision'}{c.days_impact ? ` · ${c.days_impact > 0 ? '+' : ''}${c.days_impact} days` : ''}{c.description ? <div className="muted">{c.description}</div> : null}</li>)}</ul></>}
          {!!p.reports.length && <><h4>Site updates</h4>{p.reports.map((r) => <div key={r.id} style={{ marginBottom: 8 }}><b>{r.date}</b>{r.weather ? <span className="muted"> · {r.weather}</span> : null}<div style={{ whiteSpace: 'pre-wrap' }}>{r.work_done}</div></div>)}</>}
        </Card>
      ))}
    </div>
  );
}
