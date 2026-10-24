import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { DATE_PRESETS, initials, money, titleCase, cur, getRegion } from '../format.js';
import { useBackClose } from '../backNav.js';

export const Spinner = () => <span className="spinner" />;
/** Skeleton placeholder (shimmer) instead of a bare spinner; `rows` lines plus a header block. */
export const Loading = ({ rows = 5 }) => (
  <div className="skel-wrap" aria-busy="true" aria-label="Loading">
    <div className="skel skel-card" style={{ width: '40%', height: 26, marginBottom: 14 }} />
    {Array.from({ length: rows }, (_, i) => <div key={i} className="skel skel-row" style={{ width: `${100 - (i % 3) * 8}%` }} />)}
  </div>
);
/** Friendly empty state: icon, title, hint and an optional call to action. A plain string child still works. */
export const Empty = ({ children, icon = 'file', title, hint, action, to }) => (
  <div className="empty">
    {(title || hint || action || to) ? (
      <>
        <div className="empty-ic"><Icon name={icon} size={24} /></div>
        {title && <div className="empty-title">{title}</div>}
        {(hint || children) && <div className="empty-hint">{hint || children}</div>}
        {to && <Link className="btn primary" to={to.href}>{to.label}</Link>}
        {action && <button className="btn primary" onClick={action.onClick}>{action.label}</button>}
      </>
    ) : (children ?? 'Nothing here yet.')}
  </div>
);
export const ErrorBox = ({ error }) => (error ? <div className="alert err">{error}</div> : null);

export function Avatar({ name, size = '', color }) {
  return <span className={`avatar ${size}`} style={color ? { background: color + '33', color } : undefined}>{initials(name)}</span>;
}

export function Card({ title, actions, children, flush, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="card-h"><h3>{title}</h3><div className="row">{actions}</div></div>}
      <div className={`card-b ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

const TILE = { users: 'blue', clock: 'orange', badge: 'violet', wallet: 'green', building: 'violet', dollar: 'green', bank: 'teal', check: 'violet', phone: 'blue', calendar: 'orange', layers: 'slate', chart: 'teal' };
export function Stat({ label, value, sub, to, tone, icon }) {
  const body = (
    <>
      <div className="stat-top">{icon && <span className={`ic-tile sm ic-${TILE[icon] || 'teal'}`}><Icon name={icon} size={15} /></span>}<span className="label">{label}</span></div>
      <div className={`value ${tone || ''}`}>{value}</div>
      {sub && <div className="sub-v">{sub}</div>}
    </>
  );
  return to ? <Link to={to} className="card stat">{body}</Link> : <div className="card stat">{body}</div>;
}

export function PageHead({ title, sub, crumbs, children }) {
  return (
    <div>
      {crumbs && <div className="crumbs">{crumbs}</div>}
      <div className="page-head">
        <div className="grow"><h1>{title}</h1>{sub && <div className="sub-title">{sub}</div>}</div>
        <div className="row wrap">{children}</div>
      </div>
    </div>
  );
}

const TONES = {
  green: 'green', paid: 'green', approved: 'green', available: 'green', active: 'green', published: 'green', valid: 'green', confirmed: 'green', done: 'green', approve: 'green', completed: 'green',
  pending: 'amber', partial: 'amber', partially_paid: 'amber', reserved: 'amber', review: 'amber', submitted: 'amber', draft: 'grey', created: 'grey', on_hold: 'amber', open: 'blue',
  overdue: 'red', void: 'red', cancelled: 'red', rejected: 'red', sold: 'purple', featured: 'blue', hidden: 'grey', inactive: 'grey', late: 'amber', absent: 'red', present: 'green', leave: 'blue',
};
export function StatusBadge({ status, label, tone }) {
  const t = tone || TONES[String(status).toLowerCase()] || 'grey';
  return <span className={`pill ${t}`}><i />{label || titleCase(status)}</span>;
}
/** Lead-stage pill: colour comes from the configurable stage record, never hard-coded. */
export function StagePill({ name, color }) {
  if (!name) return <span className="muted">—</span>;
  const c = color || '#94a3b8';
  return <span className="pill" style={{ background: c + '1f', color: c }}><i />{name}</span>;
}
export const DemoChip = ({ show }) => (show ? <span className="demo-chip" title="Seeded demo data">DEMO</span> : null);

export function Modal({ title, children, footer, onClose, size = '', closeOnOverlay = false }) {
  useBackClose(onClose);
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  // rendered at the top of <body> so it always covers the whole window (sidebar and top bar included)
  return createPortal(
    <div className="overlay" onMouseDown={(e) => closeOnOverlay && e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>, document.body);
}
export function Drawer({ title, children, footer, onClose, size = '' }) {
  useBackClose(onClose);
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside className={`drawer ${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-b" style={{ flex: 1 }}>{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </aside>
    </div>, document.body);
}

/** Promise-friendly confirmation dialog. */
export function ConfirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger, onConfirm, onCancel, reason }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} size="sm" onClose={onCancel}
      footer={<><button className="btn" onClick={onCancel}>Cancel</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || (reason && !text.trim())} onClick={async () => { setBusy(true); try { await onConfirm(text); } finally { setBusy(false); } }}>{confirmLabel}</button></>}>
      <div className="stack"><div>{message}</div>
        {reason && <Field label="Reason" required><input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} /></Field>}</div>
    </Modal>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="cnt">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, required, hint, error, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}{required && <span className="req"> *</span>}</label>}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="hint" style={{ color: 'var(--red)' }}>{error}</span>}
    </div>
  );
}

export const TextInput = ({ value, onChange, ...p }) => <input className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p} />;

export function Select({ value, onChange, options, placeholder = 'Select…', allowEmpty = true, ...p }) {
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Money input. Whole units (Pakistan) type digits only; regions with cents accept a decimal and report minor units (cents). onChange receives a number (or '' when empty). */
export function CurrencyInput({ value, onChange, prefix = cur(), ...p }) {
  const m = getRegion().money;
  const [draft, setDraft] = useState(null);
  if (m.scale === 0) {
    const display = value === '' || value === null || value === undefined ? '' : Number(value).toLocaleString('en-PK');
    return (
      <div className="input-group">
        <span className="addon">{prefix}</span>
        <input className="input mono" inputMode="numeric" value={display}
          onChange={(e) => { const d = e.target.value.replace(/[^d]/g, ''); onChange(d === '' ? '' : Number(d)); }} {...p} />
      </div>
    );
  }
  const shown = draft ?? (value === '' || value === null || value === undefined ? '' : m.number(value));
  return (
    <div className="input-group">
      <span className="addon">{prefix}</span>
      <input className="input mono" inputMode="decimal" value={shown}
        onChange={(e) => { const txt = e.target.value; setDraft(txt); const minor = m.fromMajor(txt); onChange(minor === null || Number.isNaN(minor) ? '' : minor); }}
        onBlur={() => setDraft(null)} {...p} />
    </div>
  );
}

export function Toggle({ value, onChange, label }) {
  return (
    <div className="row">
      <button type="button" role="switch" aria-checked={!!value} className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)} />
      {label && <span>{label}</span>}
    </div>
  );
}
export const Check = ({ checked, onChange, children }) => (
  <label className="check"><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);

export function ChipSelect({ value, onChange, options, multi }) {
  const on = (v) => (multi ? (value || []).includes(v) : value === v);
  const click = (v) => (multi ? onChange(on(v) ? value.filter((x) => x !== v) : [...(value || []), v]) : onChange(on(v) ? '' : v));
  return <div className="opt-row">{options.map((o) => <button type="button" key={o} className={`opt ${on(o) ? 'on' : ''}`} onClick={() => click(o)}>{o}</button>)}</div>;
}

export function TagInput({ value = [], onChange, placeholder = 'Add tag and press Enter' }) {
  const [t, setT] = useState('');
  const add = () => { const v = t.trim(); if (v && !value.includes(v)) onChange([...value, v]); setT(''); };
  return (
    <div>
      <div className="row wrap" style={{ marginBottom: value.length ? 6 : 0 }}>
        {value.map((x) => <span key={x} className="tag">{x} <button type="button" className="btn ghost sm" style={{ height: 16, padding: 0 }} onClick={() => onChange(value.filter((y) => y !== x))}>×</button></span>)}
      </div>
      <input className="input" value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

export function ProgressBar({ value, tone }) {
  return <div className={`progress ${tone || ''}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} /></div>;
}

/** Date preset + custom range picker used on dashboards, reports and ledgers. */
export function DateRangeFilter({ value, onChange, presets = DATE_PRESETS }) {
  const v = value || { range: 'this_month' };
  return (
    <div className="range-bar">
      <select className="select" style={{ width: 150 }} value={v.range} onChange={(e) => onChange({ ...v, range: e.target.value })} aria-label="Date range">
        {presets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {v.range === 'custom' && (
        <>
          <input type="date" className="input" style={{ width: 140 }} value={v.from || ''} onChange={(e) => onChange({ ...v, from: e.target.value })} aria-label="From" />
          <span className="muted">to</span>
          <input type="date" className="input" style={{ width: 140 }} value={v.to || ''} onChange={(e) => onChange({ ...v, to: e.target.value })} aria-label="To" />
        </>
      )}
    </div>
  );
}

/** Click-outside popover menu (row actions, export menu). */
export function Menu({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <span onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>{trigger}</span>
      {open && <div className="menu" style={align === 'left' ? { left: 0, right: 'auto' } : undefined} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

export const Money = ({ v, tone }) => <span className={`mono nowrap ${tone || ''}`}>{money(v)}</span>;

export function LedgerSummary({ items }) {
  return (
    <div className="ledger-sum">
      {items.filter(Boolean).map((i) => (
        <div className="sum-box" key={i.label}><div className="l">{i.label}</div><div className={`v ${i.tone || ''}`}>{i.money === false ? i.value : money(i.value)}</div></div>
      ))}
    </div>
  );
}

export function KV({ items }) {
  return <dl style={{ margin: 0 }}>{items.filter(Boolean).map(([k, v]) => <div className="kv" key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>;
}

export function BackLink({ to, children }) {
  return <Link to={to} className="muted row" style={{ gap: 4, marginBottom: 6 }}><Icon name="chevL" size={14} />{children}</Link>;
}
