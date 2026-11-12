import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { StatusBadge } from './ui.jsx';
import { api } from '../api.js';
import { date, money, getRegion } from '../format.js';

const FILE_TONE = { Active: 'green', Inactive: 'grey', Paused: 'amber', Defaulted: 'red', Suspended: 'red' };

/** Finance-desk lookup: a customer asks about their record — find them by phone, e-mail, CNIC, customer ID or name. */
export default function CustomerRecordLookup() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 3) { setRows(null); return undefined; }
    setBusy(true);
    const t = setTimeout(() => api.get('/api/customers/lookup', { q: q.trim() }).then(setRows).catch(() => setRows([])).finally(() => setBusy(false)), 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="pcheck" style={{ marginBottom: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <b style={{ whiteSpace: 'nowrap' }}><Icon name="search" size={14} /> Find a customer record</b>
        <input className="input" style={{ maxWidth: 440, flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Registered mobile number, email, ${getRegion().isPK ? 'CNIC, ' : ''}customer ID or name…`} aria-label="Customer record lookup" />
        {q && <button className="btn sm ghost" onClick={() => setQ('')}>Clear</button>}
      </div>
      {busy && !rows && <div className="muted" style={{ marginTop: 8 }}>Searching…</div>}
      {rows && !rows.length && <div className="muted" style={{ marginTop: 10 }}>No customer is registered with “{q}”. Try the number the way it was registered, or part of it.</div>}
      {rows?.map((c) => (
        <div key={c.id} style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div className="row wrap" style={{ gap: 14 }}>
            <div className="grow" style={{ minWidth: 240 }}>
              <Link to={`/contacts/${c.id}`}><b>{c.full_name}</b></Link> <span className="tag mono">{c.customer_code}</span>
              <div className="muted" style={{ fontSize: 12.5 }}>{getRegion().isPK ? `CNIC ${c.cnic || '—'} · ` : ''}{c.phone || 'no phone'} · {c.email || 'no email'}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{[c.address, c.city].filter(Boolean).join(', ')}{c.customer_since ? ` · customer since ${date(c.customer_since)}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="muted" style={{ fontSize: 11 }}>Outstanding</div><b className="mono" style={{ color: c.totals.outstanding ? 'var(--amber, #b45309)' : undefined }}>{money(c.totals.outstanding)}</b>
              <div className="cell-sub">of {money(c.totals.net)} · paid {money(c.totals.paid)}{c.totals.overdue ? ` · ${money(c.totals.overdue)} overdue` : ''}</div>
            </div>
            <div className="row" style={{ gap: 6 }}><Link className="btn sm" to={`/customers/${c.id}/statement`}>Statement</Link><Link className="btn sm primary" to={`/receipts/new?contact=${c.id}`}>New receipt</Link></div>
          </div>
          {c.files.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Registration no.</th><th>File #</th><th>Property</th><th>Type</th><th>Plot size</th><th>Booking date</th><th>File status</th><th className="num">Outstanding</th><th /></tr></thead>
              <tbody>{c.files.map((f) => (
                <tr key={f.sale_id}><td className="mono">{f.registration_no || '—'}</td><td className="mono">{f.file_no || '—'}</td><td>{f.title}<div className="cell-sub">{f.sale_no}{f.address ? ` · ${f.address}` : ''}</div></td><td>{f.property_type || (f.kind === 'construction' ? 'Construction' : '—')}</td><td>{f.plot_size || '—'}</td><td>{f.booking_date ? date(f.booking_date) : '—'}</td>
                  <td>{f.file_status ? <StatusBadge status={f.file_status} tone={FILE_TONE[f.file_status]} /> : <span className="muted">—</span>}</td><td className="num mono">{money(f.outstanding)}</td><td className="right"><Link className="btn sm ghost" to={`/sales/${f.sale_id}`}>Ledger</Link></td></tr>))}</tbody></table></div>
          )}
        </div>
      ))}
    </div>
  );
}
