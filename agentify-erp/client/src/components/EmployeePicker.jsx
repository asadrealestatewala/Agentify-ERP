import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Avatar } from './ui.jsx';
import { api } from '../api.js';

/** Type-ahead search of employees that have no login yet (name, code, phone or email). onChange(id, employee). */
export default function EmployeePicker({ value, onChange, placeholder = 'Type an employee name, code, phone or email…' }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const [hi, setHi] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => api.get('/api/settings/employees-available', { q }).then((r) => { setRows(r); setHi(0); }).catch(() => setRows([])), q ? 180 : 0);
    return () => clearTimeout(t);
  }, [q, open]);
  useEffect(() => {
    const h = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { if (!value) setSel(null); }, [value]);

  const pick = (e) => { setSel(e); setOpen(false); setQ(''); onChange(e.id, e); };
  const keys = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(rows.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && rows[hi]) { e.preventDefault(); pick(rows[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  const line = (e) => [e.designation, e.phone, e.email].filter(Boolean).join(' · ');

  return (
    <div ref={box} style={{ position: 'relative' }}>
      {sel ? (
        <div className="row" style={{ border: '1px solid var(--border-2)', borderRadius: 7, padding: '6px 10px', background: 'var(--surface)' }}>
          <Avatar name={sel.name} size="sm" />
          <div className="grow"><b>{sel.name}</b> <span className="tag mono">{sel.emp_code}</span><div className="muted" style={{ fontSize: 12 }}>{line(sel)}</div></div>
          <button type="button" className="btn sm ghost" onClick={() => { setSel(null); onChange('', null); setOpen(true); }}>Change</button>
        </div>
      ) : (
        <div className="search" style={{ width: '100%', maxWidth: 'none' }}>
          <Icon name="search" size={15} />
          <input value={q} placeholder={placeholder} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={keys} aria-label="Search employees" role="combobox" aria-expanded={open} />
        </div>
      )}
      {open && !sel && (
        <div className="search-results" style={{ top: 40, minWidth: 0 }} role="listbox">
          {rows.map((e, i) => (
            <div key={e.id} role="option" aria-selected={i === hi} className={`search-item ${i === hi ? 'sel' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={(ev) => { ev.preventDefault(); pick(e); }}>
              <Avatar name={e.name} size="sm" />
              <span className="grow"><div className="bold">{e.name} <span className="tag mono">{e.emp_code}</span></div><div className="muted" style={{ fontSize: 11.5 }}>{line(e) || 'No contact details'}</div></span>
            </div>
          ))}
          {!rows.length && <div className="empty" style={{ padding: 14 }}>{q ? <>No employee without a login matches “{q}”.</> : 'Every employee already has a login.'}</div>}
        </div>
      )}
    </div>
  );
}
