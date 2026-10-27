import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BackLayer from './BackLayer.jsx';
import Icon from './Icon.jsx';
import { Empty } from './ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { useBrand } from '../brand.js';
import { ago } from '../format.js';

/** type → [icon, tile colour, filter group]. Unknown types fall back to a neutral "Updates" bell. */
export const NOTE_META = {
  expense: ['wallet', 'teal', 'Money'], vendor: ['truck', 'orange', 'Money'], installment: ['calendar', 'orange', 'Money'], sale: ['badge', 'violet', 'Sales'], property: ['building', 'blue', 'Updates'],
  tender: ['file', 'violet', 'Updates'], listing: ['building', 'teal', 'Updates'],
  lead: ['users', 'blue', 'Leads'], followup: ['phone', 'orange', 'Leads'], goal: ['bolt', 'rose', 'Leads'],
  overdue: ['dollar', 'red', 'Money'], commission: ['wallet', 'green', 'Money'], payroll: ['wallet', 'teal', 'Money'], payment: ['receipt', 'green', 'Money'],
  task: ['check', 'violet', 'Tasks'], content: ['calendar', 'rose', 'Tasks'], asset: ['layers', 'slate', 'Tasks'],
  leave: ['calendar', 'orange', 'People'], development: ['hardhat', 'blue', 'Updates'], system: ['shield', 'slate', 'Updates'],
};
export const noteMeta = (t) => NOTE_META[t] || ['bell', 'teal', 'Updates'];
export const FILTERS = ['All', 'Unread', 'Money', 'Sales', 'Leads', 'Tasks', 'People', 'Updates'];
const passes = (n, f) => f === 'All' || (f === 'Unread' ? !n.read : noteMeta(n.type)[2] === f);

/** Loads notifications, polls every 30 s, and raises a live toast + bell animation when something new arrives. */
export function useNotifications() {
  const brand = useBrand();
  const toast = useToast();
  const nav = useNavigate();
  const [data, setData] = useState({ rows: [], unread: 0 });
  const [ring, setRing] = useState(false);
  const seen = useRef(null); // highest id already shown to the user
  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/notifications', { limit: 60 });
      setData(d);
      const max = d.rows.reduce((m, n) => Math.max(m, n.id), 0);
      if (seen.current === null) seen.current = max;
      else if (max > seen.current) {
        const fresh = d.rows.filter((n) => n.id > seen.current && !n.read).sort((a, b) => a.id - b.id);
        seen.current = max;
        fresh.slice(-2).forEach((n) => toast.live({ title: n.title, body: n.body, icon: noteMeta(n.type)[0], onClick: () => { api.post('/api/notifications/read', { id: n.id }).then(load); if (n.link) nav(n.link); } }));
        if (fresh.length) { setRing(true); setTimeout(() => setRing(false), 1200); }
      }
    } catch { /* offline or signed out */ }
  }, [toast, nav]);
  useEffect(() => { load(); const t = setInterval(load, 30000); const v = () => document.visibilityState === 'visible' && load(); document.addEventListener('visibilitychange', v); return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); }; }, [load]);
  useEffect(() => { document.title = `${data.unread ? `(${data.unread > 9 ? '9+' : data.unread}) ` : ''}${brand.name} ERP`; }, [data.unread, brand.name]);
  const markRead = async (id) => { await api.post('/api/notifications/read', id ? { id } : {}); load(); };
  return { ...data, ring, reload: load, markRead };
}

export function NotificationItem({ n, onOpen, onRead }) {
  const [icon, tone] = noteMeta(n.type);
  return (
    <div className={`notif-item ${n.read ? '' : 'unread'}`} role="button" tabIndex={0} onClick={() => onOpen(n)} onKeyDown={(e) => e.key === 'Enter' && onOpen(n)}>
      <span className={`ic-tile sm ic-${tone}`}><Icon name={icon} size={15} /></span>
      <div className="nt"><b>{n.title}</b>{n.body && <p>{n.body}</p>}</div>
      <div style={{ textAlign: 'right' }}><div className="when">{ago(n.created_at)}</div>{!n.read && <button className="nx" title="Mark as read" aria-label="Mark as read" onClick={(e) => { e.stopPropagation(); onRead(n.id); }}><Icon name="check" size={14} /></button>}</div>
    </div>
  );
}

function FilterChips({ value, onChange, rows }) {
  return (
    <div className="notif-filters" role="tablist" aria-label="Filter notifications">
      {FILTERS.filter((f) => ['All', 'Unread'].includes(f) || rows.some((n) => noteMeta(n.type)[2] === f)).map((f) => (
        <button key={f} role="tab" aria-selected={value === f} className={value === f ? 'on' : ''} onClick={() => onChange(f)}>{f}{f === 'Unread' && rows.filter((n) => !n.read).length ? ` · ${rows.filter((n) => !n.read).length}` : ''}</button>
      ))}
    </div>
  );
}

/** Bell in the top bar with the dropdown centre. */
export function NotificationBell({ allHref = '/notifications' }) {
  const { rows, unread, ring, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('All');
  const ref = useRef(null);
  const nav = useNavigate();
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const k = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  const shown = rows.filter((n) => passes(n, filter)).slice(0, 30);
  const open1 = async (n) => { if (!n.read) await markRead(n.id); setOpen(false); if (n.link) nav(n.link); };
  return (
    <div style={{ position: 'relative' }} ref={ref} className="no-print">
      <button className={`icon-btn bell ${ring ? 'ring' : ''}`} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="bell" />{unread > 0 && <span className="badge-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && <BackLayer onClose={() => setOpen(false)} />}
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head"><h3>Notifications {unread > 0 && <span className="count">{unread}</span>}</h3>{unread > 0 && <button className="btn sm ghost" onClick={() => markRead()}>Mark all read</button>}</div>
          <FilterChips value={filter} onChange={setFilter} rows={rows} />
          <div className="notif-list">
            {!shown.length ? <Empty icon="bell" title={filter === 'Unread' ? 'All caught up' : 'Nothing here'} hint={filter === 'Unread' ? 'You have read everything. Nice.' : 'New alerts will appear here as they happen.'} /> : shown.map((n) => <NotificationItem key={n.id} n={n} onOpen={open1} onRead={markRead} />)}
          </div>
          <div className="notif-foot"><Link to={allHref} onClick={() => setOpen(false)}>See all notifications</Link></div>
        </div>
      )}
    </div>
  );
}

const dayLabel = (iso) => {
  const d = String(iso).slice(0, 10), t = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10), y = new Date(Date.now() + 5 * 3600000 - 86400000).toISOString().slice(0, 10);
  return d === t ? 'Today' : d === y ? 'Yesterday' : 'Earlier';
};

/** Full-page version, grouped by day. */
export function NotificationCentre() {
  const { rows, unread, markRead } = useNotifications();
  const [filter, setFilter] = useState('All');
  const nav = useNavigate();
  const shown = rows.filter((n) => passes(n, filter));
  const groups = ['Today', 'Yesterday', 'Earlier'].map((g) => [g, shown.filter((n) => dayLabel(n.created_at) === g)]).filter(([, l]) => l.length);
  const open = async (n) => { if (!n.read) await markRead(n.id); if (n.link) nav(n.link); };
  return (
    <div className="card notif-page">
      <div className="notif-head" style={{ paddingTop: 16 }}><h3>{unread ? `${unread} unread` : 'All caught up'}</h3>{unread > 0 && <button className="btn sm" onClick={() => markRead()}>Mark all read</button>}</div>
      <FilterChips value={filter} onChange={setFilter} rows={rows} />
      <div className="notif-list">
        {!groups.length ? <Empty icon="bell" title="Nothing to show" hint="Alerts about leads, money, tasks and your team will land here." /> : groups.map(([g, list]) => (
          <div key={g}><div className="notif-day">{g}</div>{list.map((n) => <NotificationItem key={n.id} n={n} onOpen={open} onRead={markRead} />)}</div>
        ))}
      </div>
    </div>
  );
}
