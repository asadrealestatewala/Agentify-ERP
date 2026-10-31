import { Suspense } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import Appearance from '../components/Appearance.jsx';
import Icon from '../components/Icon.jsx';
import { NotificationBell } from '../components/Notifications.jsx';
import { BackLink, Card, Empty, KV, Loading, PageHead, Stat, StatusBadge } from '../components/ui.jsx';
import { useAuth, useFetch } from '../context.jsx';
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
        <nav className="row" style={{ gap: 16, marginLeft: 20 }} aria-label="Developer portal">{link('/developer', 'Overview', true)}{link('/developer/files', 'Files')}</nav>
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
