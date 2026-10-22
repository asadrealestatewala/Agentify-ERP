import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Avatar } from './ui.jsx';
import Assistant from './Assistant.jsx';
import Appearance from './Appearance.jsx';
import CommandPalette from './CommandPalette.jsx';
import OfflineBar from './OfflineBar.jsx';
import { NotificationBell } from './Notifications.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useMeta } from '../context.jsx';
import { useBrand } from '../brand.js';
import { BillingBanner, VerifyBanner } from '../pages/Billing.jsx';
import Announcements from './Announcements.jsx';
import { getRegion } from '../format.js';
import { t } from '../i18n.js';

// [label, path, perm module (view)]
const NAV = [
  { label: 'Dashboard', icon: 'dashboard', to: '/', module: 'dashboard' },
  { label: 'My Space', icon: 'user', always: true, children: [['My Profile', '/my/profile'], ['My Attendance', '/my/attendance'], ['My Leave', '/my/leave'], ['My Payroll', '/my/payroll'], ['My Tasks', '/my/tasks'], ['Security', '/my/security'], ['Install the app', '/my/install-app']] },
  { label: 'Content Calendar', icon: 'calendar', to: '/content', module: 'content' },
  { label: 'CRM', icon: 'users', module: 'crm', children: [
    ['Contacts', '/contacts'], ['Leads', '/leads'], ['Smart Lists', '/smart-lists'], ['Sales Pipeline', '/pipeline'], ['Tasks', '/tasks'], ['Notes', '/notes'],
    ['Appointments', '/appointments'], ['Goals & Rewards', '/goals'], ['Sales Agents', '/agents'], ['Commissions', '/commissions', 'commissions'] ] },
  { label: 'Dialer', icon: 'phone', to: '/dialer', module: 'crm' },
  { label: 'Meetings', icon: 'calendar', to: '/meetings', module: 'crm' },
  { label: 'Recordings', icon: 'file', to: '/recordings', module: 'crm' },
  { label: 'AI Studio', icon: 'star', to: '/ai-studio', module: 'crm' },
  { label: 'Mortgage', icon: 'card', to: '/mortgage', module: 'crm', flag: 'mortgage' },
  { label: 'Documents', icon: 'file', to: '/documents', module: 'crm', flag: 'templates' },
  { label: 'Construction', icon: 'hardhat', module: 'construction', product: 'construction', children: [
    ['Overview & projects', '/construction'], ['Estimates', '/construction/estimates'], ['Purchase orders', '/construction/purchase-orders'], ['Materials & stock', '/construction/materials'], ['Subcontracts', '/construction/subcontracts'] ] },
  { label: 'Properties', icon: 'building', module: 'properties', product: 'real_estate', children: [
    ['Inventory', '/properties'], ['Listing Approvals', '/listings/approvals', 'listings'], ['Add Property', '/properties/new', 'properties:create'], ['Featured Properties', '/properties/featured'], ['Draft Properties', '/properties/draft', 'properties:edit'],
    ['Sold Properties', '/properties/sold'], ['Reserved Properties', '/properties/reserved'], ['Property Types', '/properties/types', 'settings'] ] },
  { label: 'Projects', icon: 'hardhat', module: 'projects', children: [
    ['All Projects', '/projects'], ['Development Projects', '/projects/development'], ['Construction Projects', '/projects/construction'], ['Project Units', '/projects/units'], ['Development Updates', '/projects/updates'], ['Project Financials', '/projects/financials', 'accounting'], ['Plot Map', '/projects/map'] ] },
  { label: 'Customers', icon: 'badge', module: 'customers', children: [
    ['All Customers', '/customers'], ['Active Customers', '/customers/active'], ['Buyers', '/customers/buyers'], ['Installment Customers', '/customers/installment'],
    ['Sales & Bookings', '/sales', 'sales'], ['Construction Contracts', '/sales/construction', 'sales'], ['Customer Portal', '/customers/portal', 'customers:edit'], ['Portal Promotions', '/customers/promos', 'customers:edit'] ] },
  { label: 'Accounting', icon: 'wallet', module: 'accounting', children: [
    ['Dashboard', '/accounting'], ['Chart of Accounts', '/accounting/coa'], ['Receipt Vouchers', '/receipts', 'payments'], ['Expense Vouchers', '/expenses'], ['Asset Library', '/assets'],
    ['Income Statement', '/accounting/income-statement'], ['Balance Sheet', '/accounting/balance-sheet'], ['Account Statement', '/accounting/statement'], ['Cash / Till', '/accounting/treasury'], ['Bank Accounts', '/accounting/banks'], ['Journal / Transactions', '/accounting/journals'] ] },
  { label: 'Payments', icon: 'card', module: 'payments', children: [
    ['Customer Payment Reports', '/payments/claims'], ['Installments', '/payments/installments'], ['Advance Payments', '/payments/advance'], ['Balloon Payments', '/payments/balloon'], ['Receivables', '/payments/receivables'], ['Payment History', '/payments/history'] ] },
  { label: 'Vendors', icon: 'truck', module: 'vendors', children: [
    ['Vendors', '/vendors'], ['Tenders & Bids', '/vendors/tenders'], ['Vendor Ledger', '/vendors/ledger'], ['Purchases', '/vendors/purchases'], ['Credit Book', '/vendors/credit-book'] ] },
  { label: 'HRM', icon: 'briefcase', module: 'hrm', children: [
    ['Employees', '/hrm/employees'], ['Employee Documents', '/hrm/documents'], ['Salary', '/hrm/salary'], ['Bonuses', '/hrm/bonuses'], ['Attendance', '/hrm/attendance'],
    ['Leave', '/hrm/leave'], ['Assets Library', '/assets'], ['Recruitment', '/hrm/recruitment'], ['HR Reports', '/hrm/reports'] ] },
  { label: 'Website', icon: 'globe', module: 'website', children: [
    ['Website Editor', '/website'], ['SEO Manager', '/website/seo', 'seo'], ['Website Assistant', '/website/assistant', 'website'], ['Add Property', '/properties/new', 'properties:create'], ['Featured Properties', '/properties/featured'] ] },
  { label: 'Reports', icon: 'chart', module: 'reports', children: [
    ['Sales Reports', '/reports/Sales'], ['CRM Reports', '/reports/CRM'], ['Property Reports', '/reports/Property'], ['Project Reports', '/reports/Project'],
    ['Financial Reports', '/reports/Financial', 'accounting'], ['Vendor Reports', '/reports/Vendor', 'vendors'], ['Employee Reports', '/reports/Employee', 'hrm'], ['Commission Reports', '/reports/Sales'] ] },
  { label: 'Settings', icon: 'settings', module: 'settings', children: [
    ['Users', '/settings/users'], ['Integrations', '/settings/integrations'], ['Plan & Billing', '/settings/billing'], ['Roles & Permissions', '/settings/roles'], ['Custom Fields', '/settings/custom-fields'], ['Property Settings', '/settings/property'],
    ['Payment Methods', '/settings/payment-methods'], ['Lead Stages', '/settings/lead-stages'], ['Categories & Lists', '/settings/categories'], ['Commission Rules', '/settings/commission-rules'], ['Receipts & Branding', '/settings/branding'], ['Notifications', '/settings/notifications'], ['System Settings', '/settings/system'], ['Audit Log', '/settings/audit'] ] },
];

/** Pages that belong to the Real Estate product only (the server refuses them for other workspaces too). */
const PRODUCT_PATHS = { '/listings/approvals': 'real_estate', '/projects/map': 'real_estate', '/properties/new': 'real_estate', '/properties/featured': 'real_estate' };

function useAllowed() {
  const { can } = useAuth();
  const ok = (spec, fallbackModule) => {
    if (!spec) return can(fallbackModule, 'view');
    const [m, a = 'view'] = spec.split(':');
    return can(m, a);
  };
  return ok;
}

function Sidebar({ collapsed, setCollapsed, mobileOpen, closeMobile }) {
  const { user, logout } = useAuth();
  const brand = useBrand();
  const ok = useAllowed();
  const loc = useLocation();
  const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('nav-open')) || {}; } catch { return {}; } });
  const { meta } = useMeta();
  const ent = useFetch('/api/billing/status').data;
  const products = ent?.products || null; // null while loading: show everything rather than flicker
  const hasProduct = (pr) => !pr || !products || products.includes(pr);
  useEffect(() => {
    const g = NAV.find((n) => n.children?.some((c) => loc.pathname === c[1] || loc.pathname.startsWith(c[1] + '/')));
    if (g && !open[g.label]) setOpen((o) => ({ ...o, [g.label]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
  useEffect(() => { try { localStorage.setItem('nav-open', JSON.stringify(open)); } catch { /* ignore */ } }, [open]);

  const groups = NAV.map((g) => {
    if (!g.always && !ok(null, g.module)) return null;
    if (!hasProduct(g.product)) return null;
    if (g.flag && !getRegion().config.flags?.[g.flag]) return null;
    if (!g.children) return g;
    const kids = (g.always ? g.children : g.children.filter((c) => ok(c[2], g.module))).filter((c) => hasProduct(PRODUCT_PATHS[c[1]]));
    return kids.length ? { ...g, children: kids } : null;
  }).filter(Boolean);
  // upgrade path: the product a workspace does not have yet, for people who manage billing
  const missing = products && ok('settings') ? ['construction', 'real_estate'].filter((pr) => !products.includes(pr)) : [];
  if (missing.length && !ent?.legacy) groups.push({ label: missing[0] === 'construction' ? 'Add Construction' : 'Add Real Estate', icon: 'plus', to: '/settings/billing' });
  // longest-prefix match so /properties/new does not also light up /properties
  const allPaths = groups.flatMap((g) => g.children?.map((c) => c[1]) || []);
  const activePath = allPaths.filter((p) => loc.pathname === p || loc.pathname.startsWith(p + '/')).sort((a, b) => b.length - a.length)[0];

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} onClick={(e) => { if (e.target.closest('a')) closeMobile(); }}>
      <div className="brand">
        <div className="brand-mark"><Icon name="home" size={18} stroke={2.2} /></div>
        <div className="brand-name">{brand.name}<small>ERP</small></div>
      </div>
      <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Icon name={collapsed ? 'chevR' : 'chevL'} size={12} stroke={3} /></button>
      <nav className="nav" aria-label="Main">
        {groups.map((g) => (
          <div className="nav-group" key={g.label}>
            {g.children ? (
              <>
                <button className={`nav-item ${g.children.some((c) => c[1] === activePath) ? 'active' : ''}`} onClick={() => { if (collapsed) setCollapsed(false); setOpen((o) => ({ ...o, [g.label]: !o[g.label] })); }} title={g.label} aria-expanded={!!open[g.label]}>
                  <Icon name={g.icon} /><span className="nav-label">{t('nav.' + g.label.toLowerCase().replace(/[^a-z]+/g, '_'), g.label)}</span><Icon name="chevR" size={13} className={`nav-caret ${open[g.label] ? 'open' : ''}`} />
                </button>
                {open[g.label] && !collapsed && (
                  <div className="sub">{g.children.map((c) => <Link key={c[0] + c[1]} to={c[1]} className={`nav-item ${activePath === c[1] ? 'active' : ''}`}>{c[0]}</Link>)}</div>
                )}
              </>
            ) : (
              <NavLink to={g.to} end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={g.label}><Icon name={g.icon} /><span className="nav-label">{t('nav.' + g.label.toLowerCase().replace(/[^a-z]+/g, '_'), g.label)}</span></NavLink>
            )}
          </div>
        ))}
      </nav>
      <div className="side-foot">
        <Avatar name={user.name} />
        <div className="side-user-meta grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
          <div style={{ fontSize: 11, color: 'var(--navy-text)' }}>{user.role}</div>
        </div>
        <button className="icon-btn" style={{ background: '#22345a', color: '#cbd5e1' }} onClick={logout} title="Sign out" aria-label="Sign out"><Icon name="logout" size={15} /></button>
      </div>
      {meta?.settings?.demo_data === '1' && null}
    </aside>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!q.trim()) { setRes([]); return undefined; }
    const t = setTimeout(async () => { try { setRes(await api.get('/api/search', { q })); setOpen(true); } catch { setRes([]); } }, 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => { document.removeEventListener('mousedown', h); };
  }, []);
  return (
    <div className="search" ref={ref}>
      <Icon name="search" size={15} />
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => res.length && setOpen(true)} placeholder="Search contacts, plots, receipts, vendors…" aria-label="Global search"
        onKeyDown={(e) => { if (e.key === 'Enter' && res[0]) { nav(res[0].link); setOpen(false); setQ(''); } if (e.key === 'Escape') setOpen(false); }} />
      {open && q.trim() && (
        <div className="search-results">
          {!res.length && <div className="empty" style={{ padding: 18 }}>No matches for “{q}”.</div>}
          {res.map((r) => (
            <Link key={r.type + r.id} to={r.link} className="search-item" onClick={() => { setOpen(false); setQ(''); }}>
              <span className="search-type">{r.type}</span>
              <span className="grow" style={{ minWidth: 0 }}><div className="bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div><div className="muted" style={{ fontSize: 11.5 }}>{r.subtitle}</div></span>
              {r.badge && <span className="tag">{r.badge}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Phone-only bottom tabs + PWA install prompt. */
function MobileTabs() {
  const { can } = useAuth();
  const [evt, setEvt] = useState(null);
  useEffect(() => { const h = (e) => { e.preventDefault(); window.__erpInstallEvt = e; setEvt(e); }; window.addEventListener('beforeinstallprompt', h); return () => window.removeEventListener('beforeinstallprompt', h); }, []);
  const tabs = [['Home', '/', 'home', 'dashboard'], ['Goals', '/goals', 'bolt', 'crm'], ['Leads', '/leads', 'users', 'crm'], ['Tasks', '/tasks', 'check', 'crm'], ['Alerts', '/notifications', 'bell']].filter((t) => !t[3] || can(t[3], 'view'));
  return (
    <>
      {evt && <div className="install-bar no-print"><span>Install the app on your phone</span><button className="btn sm primary" onClick={async () => { evt.prompt(); await evt.userChoice.catch(() => {}); setEvt(null); }}>Install</button><button className="btn sm ghost" onClick={() => setEvt(null)} aria-label="Dismiss">×</button></div>}
      <nav className="mtabs no-print" aria-label="Quick navigation">{tabs.map(([l, to, ic]) => <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'on' : '')}><Icon name={ic} size={20} /><span>{l}</span></NavLink>)}</nav>
    </>
  );
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const { meta } = useMeta();
  const { user } = useAuth();
  useEffect(() => { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0'); }, [collapsed]);
  const demo = useMemo(() => meta?.settings?.demo_data === '1', [meta]);
  const ok = useAllowed();
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    const open = () => setPalette(true);
    window.addEventListener('keydown', k); window.addEventListener('erp:palette', open);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('erp:palette', open); };
  }, []);
  return (
    <div className="app">
      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} />
      <div className="main">
        {demo && <div className="demo-ribbon">Demo data is loaded — records marked <b>DEMO</b> were seeded for testing (all demo logins use the password shown on the sign-in screen).</div>}
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <GlobalSearch />
          <button className="btn sm ghost no-print palette-btn" onClick={() => setPalette(true)} title="Command palette (Ctrl+K)" aria-label="Open command palette"><Icon name="command" size={14} /><span className="kbd-hint">Ctrl K</span></button>
          <div className="grow" />
          <Link to="/notifications" className="muted nowrap no-print" style={{ fontSize: 12 }}>{user.role}</Link>
          <Appearance />
          <NotificationBell />
        </header>
        <main className="content" id="content"><VerifyBanner /><BillingBanner /><Announcements /><Outlet /></main>
        <Assistant />
        <MobileTabs />
        <OfflineBar />
        {palette && <CommandPalette nav={NAV} allowed={ok} onClose={() => setPalette(false)} />}
      </div>
    </div>
  );
}
