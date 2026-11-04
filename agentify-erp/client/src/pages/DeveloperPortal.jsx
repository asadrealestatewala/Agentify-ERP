import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import Appearance from '../components/Appearance.jsx';
import Icon from '../components/Icon.jsx';
import { NotificationBell } from '../components/Notifications.jsx';
import { BackLink, Card, Empty, Field, KV, Loading, Modal, PageHead, Stat, StatusBadge } from '../components/ui.jsx';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { api, download } from '../api.js';
import { useBrand } from '../brand.js';
import { date, money } from '../format.js';

const STATE = { active: 'Active', completed: 'Fully paid', cancelled: 'Cancelled' };
const stateLabel = (f) => (f.held_by_company ? 'Held by company' : STATE[f.file_state] || f.file_state || '-');
const size = (p) => [p.area_size ? `${p.area_size} ${p.unit || ''}`.trim() : null, p.area_sqft ? `${p.area_sqft} sqft` : null].filter(Boolean).join(' · ');

export function DeveloperLayout() {
  const { user, logout } = useAuth();
  const brand = useBrand();
  const link = (to, label, end) => <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>;
  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <header className="portal-top">
        <div className="brand" style={{ padding: 0 }}><div className="brand-mark"><Icon name="building" size={18} stroke={2.2} /></div><div className="brand-name">{brand.name}<small>Developer portal</small></div></div>
        <nav className="row" style={{ gap: 16, marginLeft: 20 }} aria-label="Developer portal">{link('/developer', 'Overview', true)}{link('/developer/files', 'Files')}{link('/developer/payments', 'Payments')}{link('/developer/rebates', 'Rebates')}</nav>
        <div className="grow" /><Appearance /><NotificationBell /><span style={{ color: '#cfd8ea' }} className="nowrap hide-sm">{user.name}</span>
        <button className="btn sm" onClick={logout} aria-label="Sign out"><span className="hide-sm">Sign out</span><Icon name="logout" size={15} className="show-sm" /></button>
      </header>
      <div className="portal-body"><Suspense fallback={<Loading />}><Outlet /></Suspense></div>
    </div>
  );
}

export function DeveloperDashboard() {
  const { data: d, error } = useFetch('/api/developer/dashboard');
  if (error) return <div className="alert err">{error}</div>;
  if (!d) return <Loading />;
  return (
    <div>
      <PageHead title={`Welcome, ${d.developer.name}`} sub="Files sold on your plots and what customers have paid" />
      <div className="grid g4">
        <Stat label="Files sold" value={d.files} /><Stat label="Contract value" value={money(d.contract_value)} />
        <Stat label="Collected" value={money(d.collected)} tone="pos" /><Stat label="Still to collect" value={money(d.outstanding)} tone="warn" />
      </div>
      <p className="muted" style={{ marginTop: 12 }}>{d.plots_available} plot(s) still available{d.held_by_company ? ` · ${d.held_by_company} file(s) are now held by the company` : ''}. Customer contact details are never shown here.</p>
      <p><Link className="btn primary" to="/developer/files">View files</Link></p>
    </div>
  );
}

export function DeveloperFiles() {
  const { data, error } = useFetch('/api/developer/files');
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  return (
    <div>
      <PageHead title="Files" sub="Plots booked on your agreements" />
      <Card flush>
        {data.length === 0 ? <Empty title="No files yet" hint="Booked plots appear here." /> : (
          <table className="t"><thead><tr><th>Booking</th><th>Plot</th><th>Size</th><th>Customer</th><th className="num">Contract</th><th className="num">Paid</th><th>State</th></tr></thead>
            <tbody>{data.map((f) => (
              <tr key={f.id}><td><Link to={`/developer/files/${f.id}`} className="cell-main">{f.booking_id}</Link><div className="cell-sub">{date(f.booking_date)}</div></td>
                <td>{f.plot.title}<div className="cell-sub">Reg. {f.registration_no || '-'}</div></td><td>{size(f.plot)}</td><td>{f.customer_name}</td>
                <td className="num">{money(f.contract_value)}</td><td className="num">{money(f.paid)}</td><td><StatusBadge status={stateLabel(f)} /></td></tr>))}</tbody></table>)}
      </Card>
    </div>
  );
}

export function DeveloperFile() {
  const { id } = useParams();
  const { data: f, error } = useFetch(`/api/developer/files/${id}`);
  if (error) return <div className="alert err">{error}</div>;
  if (!f) return <Loading />;
  return (
    <div>
      <BackLink to="/developer/files">Files</BackLink>
      <PageHead title={`${f.booking_id} · ${f.plot.title || 'Plot'}`} sub={`Booked ${date(f.booking_date)} · ${stateLabel(f)}`} />
      <div className="grid g2">
        <Card title="Plot"><KV items={[['Registration no.', f.registration_no], ['Plot no.', f.plot.plot_no], ['Block', f.plot.block], ['Type', f.plot.type], ['Size', size(f.plot)], ['Customer', f.customer_name]]} /></Card>
        <Card title="Money"><KV items={[['Contract value', money(f.contract_value)], ['Paid', money(f.paid)], ['Outstanding', money(f.outstanding)]]} /></Card>
      </div>
      {f.plot.photos.length > 0 && <Card title="Photos"><div className="row wrap" style={{ gap: 8 }}>{f.plot.photos.map((p) => <img key={p.path} src={`/uploads/media/${p.path}`} alt={p.caption || 'Plot'} style={{ height: 120, borderRadius: 8 }} />)}</div></Card>}
      <div style={{ height: 12 }} />
      <Card title="Payment schedule" flush>
        <table className="t"><thead><tr><th>#</th><th>Type</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th>Status</th></tr></thead>
          <tbody>{f.schedule.map((s) => <tr key={s.seq}><td>{s.seq}</td><td style={{ textTransform: 'capitalize' }}>{s.kind}</td><td>{date(s.due_date)}</td><td className="num">{money(s.amount)}</td><td className="num">{money(s.paid)}</td><td><StatusBadge status={s.status} /></td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}

const PAY_STATE = { pending: 'Waiting for you', verifying: 'Waiting for you', approved: 'Approved', rejected: 'Declined' };

export function DeveloperPayments() {
  const toast = useToast();
  const [tab, setTab] = useState('open');
  const { data, error, reload } = useFetch('/api/developer/payments', { status: tab });
  const [ask, setAsk] = useState(null); // { p, mode: 'approve' | 'reject' }
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setAsk(null); setText(''); };
  const submit = async () => {
    setBusy(true);
    try {
      if (ask.mode === 'approve') await api.post(`/api/developer/payments/${ask.p.id}/approve`, { note: text });
      else await api.post(`/api/developer/payments/${ask.p.id}/reject`, { reason: text });
      toast(ask.mode === 'approve' ? 'Payment approved' : 'Payment declined'); close(); reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (error) return <div className="alert err">{error}</div>;
  return (
    <div>
      <PageHead title="Payments" sub="Payments customers report on your files. Approve only what you have received.">
        <div className="row" style={{ gap: 6 }}>{[['open', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Declined']].map(([k, l]) => <button key={k} className={`btn sm${tab === k ? ' primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      </PageHead>
      {!data ? <Loading /> : (
        <Card flush>
          {data.length === 0 ? <Empty title={tab === 'open' ? 'Nothing is waiting for you' : 'No payments here'} hint="Customer payments on your files appear here." /> : (
            <table className="t"><thead><tr><th>Reference</th><th>File</th><th>Customer</th><th>Paid via</th><th className="num">Amount</th><th>State</th><th /></tr></thead>
              <tbody>{data.map((p) => (
                <tr key={p.id}><td><span className="cell-main">{p.ref}</span><div className="cell-sub">{date(p.paid_date)}</div></td>
                  <td>{p.booking_id}<div className="cell-sub">{p.plot}</div></td><td>{p.customer_name}</td>
                  <td>{p.method}{p.txn_id ? <div className="cell-sub">{p.txn_id}</div> : null}</td><td className="num">{money(p.amount)}</td>
                  <td><StatusBadge status={PAY_STATE[p.status] || p.status} />{p.reject_reason ? <div className="cell-sub">{p.reject_reason}</div> : null}</td>
                  <td className="nowrap">
                    {p.has_slip && <a className="btn sm" href={`/api/developer/payments/${p.id}/slip`} target="_blank" rel="noreferrer">Slip</a>}{' '}
                    {['pending', 'verifying'].includes(p.status) && <><button className="btn sm primary" onClick={() => setAsk({ p, mode: 'approve' })}>Approve</button>{' '}<button className="btn sm" onClick={() => setAsk({ p, mode: 'reject' })}>Decline</button></>}
                  </td></tr>))}</tbody></table>)}
        </Card>)}
      {ask && (
        <Modal title={ask.mode === 'approve' ? `Approve ${ask.p.ref}` : `Decline ${ask.p.ref}`} onClose={close}
          footer={<><button className="btn" onClick={close}>Cancel</button><button className={`btn ${ask.mode === 'approve' ? 'primary' : 'danger'}`} disabled={busy || (ask.mode === 'reject' && !text.trim())} onClick={submit}>{ask.mode === 'approve' ? 'Approve payment' : 'Decline payment'}</button></>}>
          <p>{ask.p.customer_name} reported {money(ask.p.amount)} for {ask.p.booking_id} ({ask.p.method}).</p>
          {ask.mode === 'approve' && <p className="muted">Approve only if the money is in your account. The customer is told straight away.</p>}
          <Field label={ask.mode === 'approve' ? 'Note (optional)' : 'Reason (the customer will see it)'} required={ask.mode === 'reject'}>
            <textarea className="input" rows={3} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          </Field>
        </Modal>)}
    </div>
  );
}

export function DeveloperRebates() {
  const toast = useToast();
  const [range, setRange] = useState({ from: '', to: '' });
  const params = Object.fromEntries(Object.entries(range).filter(([, v]) => v));
  const { data, error } = useFetch('/api/developer/rebates', params);
  const get = async (key, format) => { try { await download(`/api/developer/reports/${key}`, { ...params, format }, `${key}.${format}`); } catch (e) { toast(e.message, 'error'); } };
  if (error) return <div className="alert err">{error}</div>;
  return (
    <div>
      <PageHead title="Rebates and reports" sub="What you owe the company on each approved payment, and downloads for your records." />
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <label className="row" style={{ gap: 6 }}>From <input type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="row" style={{ gap: 6 }}>To <input type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        <div className="grow" />
        {[['rebate-statement', 'Rebate statement'], ['files', 'Files'], ['payments', 'Payments']].map(([k, l]) => (
          <span key={k} className="row" style={{ gap: 4 }}>{l}: <button className="btn sm" onClick={() => get(k, 'xlsx')}>Excel</button><button className="btn sm" onClick={() => get(k, 'csv')}>CSV</button><button className="btn sm" onClick={() => get(k, 'pdf')}>PDF</button></span>))}
      </div>
      {!data ? <Loading /> : (
        <>
          <div className="grid g3"><Stat label="Payments approved" value={money(data.total_received)} /><Stat label="Rebate due to the company" value={money(data.total_rebate)} tone="warn" /><Stat label="Payments counted" value={data.rows.length} /></div>
          <div style={{ height: 12 }} />
          <Card flush>
            {data.rows.length === 0 ? <Empty title="No approved payments yet" hint="Rebate is worked out on each payment you approve." /> : (
              <table className="t"><thead><tr><th>Date</th><th>File</th><th>Customer</th><th>Method</th><th className="num">Payment</th><th className="num">Rebate due</th></tr></thead>
                <tbody>{data.rows.map((r, i) => <tr key={i}><td>{date(r.date)}</td><td>{r.booking_id}<div className="cell-sub">{r.plot}</div></td><td>{r.customer_name}</td><td>{r.method}</td><td className="num">{money(r.amount)}</td><td className="num">{money(r.rebate)}</td></tr>)}</tbody></table>)}
          </Card>
          <p className="muted" style={{ marginTop: 8 }}>Rebate is shown for your reference. Recording what you have paid to the company is not part of this screen yet.</p>
        </>)}
    </div>
  );
}
