import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Avatar } from './ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import ContactForm from '../pages/ContactForm.jsx';
import { getRegion } from '../format.js';

/**
 * Type-ahead customer search against the contacts module, with "Add new customer" in the same window.
 * A customer created here is a normal contact — it shows up in Contacts/Customers immediately, no re-entry.
 * onChange(id, contact)
 */
export default function CustomerPicker({ value, onChange, onResolved, customersOnly = false, placeholder = customersOnly ? `Type a customer name, customer ID, phone${getRegion().isPK ? ' or CNIC' : ' or email'}…` : `Type a name, customer ID, phone${getRegion().isPK ? ' or CNIC' : ' or email'}…`, autoFocus }) {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const [hi, setHi] = useState(0);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const box = useRef(null);

  // load the selected contact once (e.g. when arriving from a contact page with ?contact=)
  useEffect(() => {
    if (value && sel?.id !== value) api.get(`/api/contacts/${value}/workspace`).then((w) => { setSel(w.contact); onResolved?.(w.contact); }).catch(() => {});
    if (!value) setSel(null);
    // eslint-disable-next-line
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    const t = setTimeout(() => api.get('/api/contacts', { q, limit: 8, sort: q ? 'name' : 'created', dir: q ? 'asc' : 'desc', type: customersOnly ? 'customer' : undefined }).then((r) => { setRows(r.rows); setHi(0); }).catch(() => setRows([])).finally(() => setLoading(false)), q ? 180 : 0);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    const h = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const pick = (c) => { setSel(c); setOpen(false); setQ(''); onChange(c.id, c); };
  const keys = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(rows.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && rows[hi]) { e.preventDefault(); pick(rows[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      {sel ? (
        <div className="row" style={{ border: '1px solid var(--border-2)', borderRadius: 7, padding: '6px 10px', background: 'var(--surface)' }}>
          <Avatar name={sel.full_name} size="sm" />
          <div className="grow"><b>{sel.full_name}</b> {sel.customer_code && <span className="tag mono">{sel.customer_code}</span>} {sel.is_customer ? <span className="pill green">Customer</span> : <span className="pill grey">Lead</span>}<div className="muted" style={{ fontSize: 12 }}>{[sel.phone, sel.email, sel.city].filter(Boolean).join(' · ')}</div></div>
          <button type="button" className="btn sm ghost" onClick={() => { setSel(null); onChange('', null); setOpen(true); }}>Change</button>
        </div>
      ) : (
        <div className="row">
          <div className="search" style={{ width: '100%', maxWidth: 'none', flex: 1 }}>
            <Icon name="search" size={15} />
            <input autoFocus={autoFocus} value={q} placeholder={placeholder} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={keys} aria-label="Search customers" role="combobox" aria-expanded={open} />
          </div>
          {can('crm', 'create') && <button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={14} />New customer</button>}
        </div>
      )}
      {open && !sel && (
        <div className="search-results" style={{ top: 40, minWidth: 0 }} role="listbox">
          {loading && !rows.length && <div className="empty" style={{ padding: 14 }}>Searching…</div>}
          {rows.map((c, i) => (
            <div key={c.id} role="option" aria-selected={i === hi} className={`search-item ${i === hi ? 'sel' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
              <Avatar name={c.full_name} size="sm" />
              <span className="grow"><div className="bold">{c.full_name} {c.customer_code && <span className="tag mono">{c.customer_code}</span>}</div><div className="muted" style={{ fontSize: 11.5 }}>{[c.phone, c.email, c.city].filter(Boolean).join(' · ') || 'No contact details'}</div></span>
              {c.is_customer ? <span className="pill green">Customer</span> : <span className="pill grey">Lead</span>}
            </div>
          ))}
          {!loading && !rows.length && <div className="empty" style={{ padding: 14 }}>{q ? <>No customer matches “{q}”.</> : 'No contacts yet.'}</div>}
          {can('crm', 'create') && (
            <div className="search-item" style={{ color: 'var(--primary)', fontWeight: 600 }} onMouseDown={(e) => { e.preventDefault(); setAdding(true); setOpen(false); }}>
              <Icon name="plus" size={14} /> Add {q ? `“${q}”` : 'a new customer'} as a new customer
            </div>
          )}
        </div>
      )}
      {adding && (
        <ContactForm initial={q ? { full_name: q, first_name: q.split(' ')[0], last_name: q.split(' ').slice(1).join(' ') } : undefined}
          onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); toast(`${c.full_name} added to Customers`, 'ok'); pick(c); }} />
      )}
    </div>
  );
}
