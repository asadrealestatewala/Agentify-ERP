// Two sections of the home page that sit outside the hero and the tour:
//  - Beyond: the ERP behind the CRM (what the product has beyond leads and follow-ups);
//  - Stories: customer testimonials, shown only when real, permitted ones have been entered in the console (Marketing content).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Flag from '../../components/Flag.jsx';
import { useCountry } from '../countryCtx.js';
import { Ico, spot } from './parts.jsx';

const ERP = [
  ['building', 'Property and project inventory', 'Listings, plots and units with price, size and status, and the leads interested in each.'],
  ['chart', 'Sales and payment plans', 'Bookings, instalment schedules and balloon payments tracked for every customer.'],
  ['file', 'Receipts, commissions and statements', 'Receipts as money comes in, agent commissions, and statements a customer can see in their portal.'],
  ['star', 'Accounting and reports', 'Vouchers, ledgers and financial reports from the same records the sales team works in.'],
  ['key', 'Construction and projects', 'Bills of quantities, project costs and progress for developers and builders.'],
];

export function Beyond() {
  return (
    <section className="gx-sec" id="erp" aria-labelledby="gx-erp-h">
      <span id="properties" className="h-anchor" aria-hidden="true" />
      <div className="gx-wrap">
        <p className="gx-eyebrow gx-rv"><i>+</i> Beyond the CRM</p>
        <h2 id="gx-erp-h" className="gx-h2 gx-rv">The ERP behind it, <span className="gx-grad">when you are ready</span></h2>
        <p className="gx-lead gx-rv">Start with leads and follow-ups. The same workspace also runs the rest of a property business, so a won deal does not have to be typed in twice.</p>
        <ul className="gx-fgrid">{ERP.map(([n, t, d], k) => <li key={t} className="gx-card gx-rv" style={{ '--s': `${k * 50}ms` }} onPointerMove={spot}><span className="gx-tile"><Ico n={n} size={22} /></span><h3>{t}</h3><p>{d}</p></li>)}</ul>
        <p className="gx-more gx-rv"><Link to="/real-estate">Real estate in detail</Link> · <Link to="/construction">Construction</Link></p>
      </div>
    </section>
  );
}

/** Real, permitted testimonials only. With none entered the section is not rendered at all. */
export function Stories({ list }) {
  const [i, setI] = useState(0);
  if (!list || !list.length) return null;
  const n = list.length;
  const t = list[((i % n) + n) % n];
  const step = (d) => setI((x) => (x + d + n) % n);
  return (
    <section className="gx-sec" id="stories" aria-roledescription="carousel" aria-labelledby="gx-st-h">
      <div className="gx-wrap">
        <p className="gx-eyebrow gx-rv"><i>★</i> Customer stories</p>
        <h2 id="gx-st-h" className="gx-h2 gx-rv">What teams say <span className="gx-grad">after using it</span></h2>
        <figure className="gx-quote gx-rv" aria-live="polite">
          <blockquote><p>“{t.quote}”</p></blockquote>
          <figcaption>
            <span className="gx-av" aria-hidden="true">{String(t.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
            <span><b>{t.name}</b><small>{[t.role, t.company, t.country].filter(Boolean).join(' · ')}</small></span>
          </figcaption>
        </figure>
        {n > 1 && (
          <div className="gx-q-nav">
            <button type="button" className="gx-icon-btn" onClick={() => step(-1)} aria-label="Previous story"><Ico n="arrow" size={18} className="flip" /></button>
            <span aria-hidden="true">{(i % n) + 1} / {n}</span>
            <button type="button" className="gx-icon-btn" onClick={() => step(1)} aria-label="Next story"><Ico n="arrow" size={18} /></button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Country menu with drawn flags (Windows does not render flag emoji, and a native select cannot show images). One source of truth for the market. */
export function CountryMenu({ variant = 'bar' }) {
  const { country, countries, setCountry } = useCountry();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const btn = useRef(null);
  const list = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    list.current?.querySelector('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  if (countries.length < 2) return null;
  const items = () => [...(list.current?.querySelectorAll('[role="option"]') || [])];
  const move = (to) => { const els = items(); if (!els.length) return; els[(to + els.length) % els.length].focus(); };
  const onListKey = (e) => {
    const els = items(); const i = els.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(els.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  const choose = (code) => { setCountry(code); setOpen(false); btn.current?.focus(); };
  return (
    <div className={`gx-cm ${variant}`} ref={root}>
      <button ref={btn} type="button" className="gx-cm-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`Country: ${country.name}. Change country`}
        onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        <Flag code={country.code} height={15} /><span className="gx-cm-name">{country.name}</span><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul ref={list} className="gx-cm-list" role="listbox" aria-label="Country" onKeyDown={onListKey}>
          {countries.map((c) => (
            <li key={c.code} role="presentation">
              <button type="button" role="option" aria-selected={c.code === country.code} tabIndex={-1} onClick={() => choose(c.code)}>
                <Flag code={c.code} height={15} /><span>{c.name}</span>{!c.open && <small>soon</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
