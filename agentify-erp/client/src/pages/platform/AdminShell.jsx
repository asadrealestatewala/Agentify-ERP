// Layout of the super admin console: collapsible left sidebar (drawer on small screens), top bar with global search,
// notifications and quick actions, and the signed-in admin at the bottom of the sidebar.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { Empty, Menu } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { APP_VERSION } from '../../../../shared/changelog.js';
import './admin.css';

export const A = '/api/platform/admin';
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

/** The signed-in console user (role, permissions), for hiding what their role cannot use. The server checks again. */
export const MeContext = createContext({ permissions: [] });
export const useCan = () => { const me = useContext(MeContext); return (perm) => perm === 'self' || me.permissions?.includes(perm); };
/** Shown instead of a page the user's role does not include. */
export function Allowed({ perm, children }) {
  const can = useCan();
  return can(perm) ? children : <Empty title="You do not have access to this page" hint="Your role does not include it. Ask a Super Admin if you need it." />;
}

/** Navigation: [label, path, permission]. Groups and pages the user cannot use are hidden. */
export const NAV = [
  { key: 'dash', label: 'Dashboard', icon: 'dashboard', items: [['Overview', '/platform', 'dashboard.view'], ['System health', '/platform/health', 'system.view'], ['Alerts', '/platform/notifications', 'dashboard.view'], ["What's new", '/platform/whats-new', 'self']] },
  { key: 'ws', label: 'Workspaces', icon: 'building', items: [['All workspaces', '/platform/workspaces', 'workspaces.view'], ['Active', '/platform/workspaces?status=active', 'workspaces.view'], ['Free trials', '/platform/workspaces?status=trial', 'workspaces.view'], ['Paying', '/platform/workspaces?status=paying', 'workspaces.view'], ['Need attention', '/platform/workspaces?status=attention', 'workspaces.view'], ['Suspended', '/platform/workspaces?status=suspended', 'workspaces.view'], ['Cancelled', '/platform/workspaces?status=cancelled', 'workspaces.view']] },
  { key: 'subs', label: 'Plans & Subscriptions', icon: 'layers', items: [['Plans, add-ons & coupons', '/platform/plans', 'billing.view'], ['Renewals & expiry', '/platform/expiry', 'workspaces.view'], ['Subscription history', '/platform/subscriptions/history', 'billing.view']] },
  { key: 'billing', label: 'Billing & Payments', icon: 'wallet', items: [['Transactions & invoices', '/platform/transactions', 'billing.view'], ['Payment approvals', '/platform/payments', 'billing.view'], ['Stripe configuration', '/platform/billing/stripe', 'billing.configure'], ['Payment gateways', '/platform/billing/gateways', 'billing.configure'], ['Local payment accounts', '/platform/billing/accounts', 'billing.view'], ['Reconciliation', '/platform/reconciliation', 'billing.view']] },
  { key: 'reports', label: 'Reports & Analytics', icon: 'chart', items: [['Revenue & subscriptions', '/platform/finance', 'finance.view'], ['Website analytics', '/platform/analytics', 'analytics.view'], ['Reports & exports', '/platform/reports', 'dashboard.view']] },
  { key: 'growth', label: 'Website builder', icon: 'globe', items: [['Landing page editor', '/platform/website/visual', 'content.manage'], ['Content, partners & legal', '/platform/website', 'content.manage'], ['Free websites', '/platform/free-sites', 'system.view'], ['Customer reviews', '/platform/reviews', 'content.manage'], ['Demo requests', '/platform/demo-requests', 'workspaces.view'], ['Announcements & releases', '/platform/announcements', 'dashboard.view']] },
  { key: 'mailbox', label: 'Mailbox', icon: 'mail', items: [['Inbox', '/platform/mailbox', 'mailbox.manage'], ['Sent log', '/platform/mailbox/sent', 'mailbox.manage'], ['Settings', '/platform/mailbox/settings', 'mailbox.manage']] },
  { key: 'security', label: 'Security & Access', icon: 'shield', items: [['Console users & roles', '/platform/admins', 'admins.manage'], ['Active sessions', '/platform/security/sessions', 'self'], ['Sign-in history', '/platform/security/logins', 'audit.view'], ['Two-factor sign-in', '/platform/security', 'self']] },
  { key: 'system', label: 'System', icon: 'settings', items: [['Platform setup', '/platform/setup', 'system.view'], ['Integrations', '/platform/integrations', 'system.view'], ['Regions', '/platform/regions', 'regions.support'], ['Maintenance & errors', '/platform/maintenance', 'system.view'], ['Backups', '/platform/backups', 'system.view']] },
  { key: 'audit', label: 'Audit', icon: 'history', items: [['Audit log', '/platform/audit', 'audit.view']] },
];

const isActive = (loc, to) => {
  const [p, q] = to.split('?');
  if (q) return loc.pathname === p && loc.search === `?${q}`;
  if (p === '/platform') return loc.pathname === '/platform' || loc.pathname === '/platform/';
  if (p === '/platform/security' || p === '/platform/mailbox' || p === '/platform/website') return loc.pathname === p || loc.pathname === `${p}/`;
  return p === '/platform/workspaces' ? loc.pathname.startsWith(p) && !loc.search.includes('status=') : loc.pathname.startsWith(p);
};

function GlobalSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(() => api.get(`${A}/search?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { const h = (e) => { if (!box.current?.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useEffect(() => { const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); box.current?.querySelector('input')?.focus(); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const go = (link) => { setOpen(false); setQ(''); nav(link); };
  return (
    <div className="pa-search" ref={box}>
      <Icon name="search" size={16} />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search workspaces, owners, invoices, references…  (Ctrl+K)" aria-label="Global search"
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && res?.[0]) go(res[0].link); }} />
      {open && res && (
        <div className="pa-pop" role="listbox">
          {!res.length ? <div className="pa-pop-item muted">No matches for “{q}”</div> : res.map((r, i) => (
            <button key={i} className="pa-pop-item" onClick={() => go(r.link)}><span className="pa-type">{r.type}</span>{r.title}<small>{r.sub}</small></button>
          ))}
        </div>
      )}
    </div>
  );
}

function Bell() {
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const load = useCallback(() => api.get(`${A}/notifications`).then(setD).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 120_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const h = (e) => { if (!box.current?.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useEffect(() => { const h = () => load(); window.addEventListener('pa:notifications', h); return () => window.removeEventListener('pa:notifications', h); }, [load]);
  const openItem = async (n) => { setOpen(false); if (!n.read) { try { await api.post(`${A}/notifications/read`, { ids: [n.id] }); } catch { /* ignore */ } load(); } if (n.link) nav(n.link); };
  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button className="pa-icon-btn" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${d?.unread ? `, ${d.unread} unread` : ''}`}><Icon name="bell" size={17} />{!!d?.unread && <span className="dot">{d.unread > 99 ? '99+' : d.unread}</span>}</button>
      {open && (
        <div className="pa-pop right">
          <div className="pa-pop-item" style={{ display: 'flex', justifyContent: 'space-between', cursor: 'default' }}><b>Alerts</b>
            {!!d?.unread && <button className="btn sm ghost" onClick={async () => { await api.post(`${A}/notifications/read`, { ids: 'all' }); load(); }}>Mark all read</button>}</div>
          {!d?.items?.length ? <div className="pa-pop-item muted">Nothing needs your attention.</div> : d.items.slice(0, 8).map((n) => (
            <button key={n.id} className="pa-pop-item" onClick={() => openItem(n)} style={{ fontWeight: n.read ? 400 : 600 }}><span className={`pa-sev ${n.severity}`} />{n.title}<small>{n.body}</small></button>
          ))}
          <button className="pa-pop-item" style={{ textAlign: 'center', color: 'var(--pa-accent-d)' }} onClick={() => { setOpen(false); nav('/platform/notifications'); }}>View all alerts</button>
        </div>
      )}
    </div>
  );
}

export default function AdminShell({ me, onSignOut, onChangePassword, children }) {
  const loc = useLocation();
  const can = (perm) => perm === 'self' || me.permissions?.includes(perm);
  const nav_ = NAV.map((g) => ({ ...g, items: g.items.filter(([, , perm]) => can(perm)) })).filter((g) => g.items.length);
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(() => store.get('pa-collapsed', false));
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(() => store.get('pa-groups', { dash: true, ws: true }));
  useEffect(() => { store.set('pa-collapsed', collapsed); }, [collapsed]);
  useEffect(() => { store.set('pa-groups', open); }, [open]);
  useEffect(() => { setMobile(false); }, [loc.pathname, loc.search]);
  // the group holding the current page always shows its pages
  useEffect(() => { const g = nav_.find((x) => x.items.some(([, to]) => isActive(loc, to))); if (g && !open[g.key]) setOpen((o) => ({ ...o, [g.key]: true })); }, [loc.pathname, loc.search]); // eslint-disable-line react-hooks/exhaustive-deps
  const initials = (me.name || me.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
  return (
    <div className={`pa ${collapsed ? 'collapsed' : ''} ${mobile ? 'mobile-open' : ''}`}>
      <div className="pa-scrim" onClick={() => setMobile(false)} />
      <aside className="pa-side" aria-label="Super admin navigation">
        <div className="pa-brand"><div className="pa-logo">A</div><div className="pa-brand-text"><b>AGENTIFY</b><small>ERP · Super Admin</small></div></div>
        <nav className="pa-nav">
          {nav_.map((g) => {
            const activeGroup = g.items.some(([, to]) => isActive(loc, to));
            const single = g.items.length === 1;
            if (single || collapsed) {
              const [label, to] = single ? g.items[0] : [g.label, g.items[0][1]];
              return <Link key={g.key} to={to} className={`pa-link ${activeGroup ? 'active' : ''}`} title={collapsed ? g.label : undefined}><Icon name={g.icon} size={18} /><span className="pa-label">{single ? label : g.label}</span></Link>;
            }
            return (
              <div key={g.key}>
                <button className={`pa-group-btn ${open[g.key] ? 'open' : ''} ${activeGroup ? 'active' : ''}`} aria-expanded={!!open[g.key]} onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}>
                  <Icon name={g.icon} size={18} /><span className="pa-label">{g.label}</span><Icon name="chevD" size={14} className="pa-caret" />
                </button>
                {open[g.key] && <div className="pa-sub">{g.items.map(([label, to]) => <Link key={to} to={to} className={`pa-link ${isActive(loc, to) ? 'active' : ''}`} aria-current={isActive(loc, to) ? 'page' : undefined}>{label}</Link>)}</div>}
              </div>
            );
          })}
        </nav>
        <button className="pa-link pa-collapse" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Icon name={collapsed ? 'chevR' : 'chevL'} size={16} /><span className="pa-label">Collapse sidebar</span></button>
        <div className="pa-me">
          <Menu align="left" trigger={<button className="pa-avatar" style={{ border: 0, cursor: 'pointer' }} aria-label="Account menu">{initials}</button>}>
            <button onClick={onChangePassword}>Change password</button>
            <button onClick={() => nav('/platform/security')}>Two-factor sign-in</button>
            <button onClick={() => nav('/platform/security/sessions')}>My sessions</button>
            <button className="danger" onClick={onSignOut}>Sign out</button>
          </Menu>
          <div className="pa-me-text"><b>{me.name || 'Console user'}</b><small>{me.role_label || me.email} · {APP_VERSION}</small></div>
          <button className="pa-link" style={{ width: 'auto', padding: 6 }} onClick={onSignOut} title="Sign out" aria-label="Sign out"><Icon name="logout" size={16} /></button>
        </div>
      </aside>
      <div className="pa-main">
        <header className="pa-top">
          <button className="pa-icon-btn pa-hamburger" onClick={() => setMobile(true)} aria-label="Open navigation"><Icon name="menu" size={18} /></button>
          {can('dashboard.view') ? <GlobalSearch /> : <div style={{ flex: 1 }} />}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Menu trigger={<button className="btn primary sm"><Icon name="plus" size={14} /> <span className="pa-hide-sm">Quick actions</span></button>}>
              {can('workspaces.create') && <button onClick={() => nav('/platform/workspaces?new=1')}>New workspace</button>}
              {can('billing.view') && <button onClick={() => nav('/platform/payments')}>Review payments</button>}
              {can('workspaces.view') && <button onClick={() => nav('/platform/expiry')}>Renewals & expiry</button>}
              {can('system.manage') && <button onClick={() => nav('/platform/backups')}>Back up now</button>}
            </Menu>
            {can('dashboard.view') && <Bell />}
          </div>
        </header>
        <main className="pa-content">
          {me.maintenance && <div className="alert warn" style={{ marginBottom: 12 }} role="status">Maintenance mode is on: every workspace is closed to customers. <Link to="/platform/maintenance">Manage</Link></div>}
          {me.mfa_setup_needed && <div className="alert err" style={{ marginBottom: 12 }} role="alert">Two-factor sign-in is required for console users. Set it up to use the rest of the console. <Link to="/platform/security">Set up now</Link></div>}
          <MeContext.Provider value={me}>{children}</MeContext.Provider>
        </main>
      </div>
    </div>
  );
}

export function PageTitle({ title, sub, children }) {
  useEffect(() => { document.title = `${title} · Agentify Super Admin`; }, [title]);
  return <div className="pa-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{children && <div className="pa-range">{children}</div>}</div>;
}
