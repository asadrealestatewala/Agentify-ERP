import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { StatusBadge } from './ui.jsx';
import { api } from '../api.js';
import { money } from '../format.js';

const FILE_TONE = { Active: 'green', Inactive: 'grey', Suspended: 'red', Defaulted: 'red', Paused: 'amber' };

/**
 * Type-ahead property search: by title, registration number, file number, plot or code.
 * `statuses` limits what can be chosen (e.g. only properties that can still be sold). onChange(id, property)
 */
export default function PropertyPicker({ value, onChange, statuses, placeholder = 'Type a registration no., file no., plot or title…', autoFocus }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const [hi, setHi] = useState(0);
  const [loading, setLoading] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (value && sel?.id !== value) api.get(`/api/properties/${value}`).then(setSel).catch(() => {});
    if (!value) setSel(null);
    // eslint-disable-next-line
  }, [value]);
  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    const t = setTimeout(() => api.get('/api/properties', { q, limit: 30, sort: 'created', ...(statuses ? { status: statuses.join(',') } : {}) }).then((r) => { setRows(statuses ? r.rows.filter((p) => statuses.includes(p.status)) : r.rows); setHi(0); }).catch(() => setRows([])).finally(() => setLoading(false)), 200);
    return () => clearTimeout(t);
  }, [q, open]); // eslint-disable-line
  useEffect(() => {
    const h = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const pick = (p) => { setSel(p); setOpen(false); setQ(''); onChange(p.id, p); };
  const keys = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(rows.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && rows[hi]) { e.preventDefault(); pick(rows[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  const meta = (p) => [p.registration_no && `Reg ${p.registration_no}`, p.project_name, p.plot_no && `Plot ${p.plot_no}`, p.file_no && `File ${p.file_no}`].filter(Boolean).join(' · ');

  return (
    <div ref={box} style={{ position: 'relative' }}>
      {sel ? (
        <div className="row" style={{ border: '1px solid var(--border-2)', borderRadius: 7, padding: '6px 10px', background: 'var(--surface)' }}>
          <div className="grow"><b>{sel.title}</b> <StatusBadge status={sel.status} /> {sel.file_status && <StatusBadge status={sel.file_status} tone={FILE_TONE[sel.file_status]} label={`File ${sel.file_status}`} />}<div className="muted" style={{ fontSize: 12 }}>{meta(sel)} · {money(sel.net_price)}</div></div>
          <button type="button" className="btn sm ghost" onClick={() => { setSel(null); onChange('', null); setOpen(true); }}>Change</button>
        </div>
      ) : (
        <div className="search" style={{ width: '100%', maxWidth: 'none' }}>
          <Icon name="search" size={15} />
          <input autoFocus={autoFocus} value={q} placeholder={placeholder} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={keys} aria-label="Search properties" role="combobox" aria-expanded={open} />
        </div>
      )}
      {open && !sel && (
        <div className="search-results" style={{ top: 40, minWidth: 0 }} role="listbox">
          {loading && !rows.length && <div className="empty" style={{ padding: 14 }}>Searching…</div>}
          {rows.map((p, i) => (
            <div key={p.id} role="option" aria-selected={i === hi} className={`search-item ${i === hi ? 'sel' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              <span className="grow"><div className="bold">{p.title}</div><div className="muted" style={{ fontSize: 11.5 }}>{meta(p)}</div></span>
              <span style={{ textAlign: 'right' }}><div className="mono" style={{ fontSize: 12 }}>{money(p.net_price)}</div><StatusBadge status={p.status} /></span>
            </div>
          ))}
          {!loading && !rows.length && <div className="empty" style={{ padding: 14 }}>{q ? <>No available property matches “{q}”.</> : 'No properties are open for sale. New properties stay as Draft until they are submitted and approved or published (Properties → open the property → Publish).'}</div>}
        </div>
      )}
    </div>
  );
}
