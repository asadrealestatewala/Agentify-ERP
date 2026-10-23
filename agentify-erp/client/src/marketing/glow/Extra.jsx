// Two sections of the home page that sit outside the hero and the tour:
//  - Beyond: the ERP behind the CRM (what the product has beyond leads and follow-ups);
//  - Stories: customer testimonials, shown only when real, permitted ones have been entered in the console (Marketing content).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Flag from '../../components/Flag.jsx';
import { useCountry } from '../countryCtx.js';
import { Ico, spot } from './parts.jsx';
import { T } from './copy.jsx';
import { api } from '../../api.js';

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
        <p className="gx-eyebrow gx-rv"><i>+</i> <T k="beyond.eyebrow" /></p>
        <h2 id="gx-erp-h" className="gx-h2 gx-rv"><T k="beyond.h2a" />{' '}<span className="gx-grad"><T k="beyond.h2b" /></span></h2>
        <p className="gx-lead gx-rv"><T k="beyond.lead" /></p>
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

/** Partner logos: only companies entered in the console with written permission, shown for the visitor's country. Not rendered when there are none. */
export function Partners({ list }) {
  if (!list || !list.length) return null;
  const items = list.map((p) => {
    const img = <img src={p.logo} alt={p.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
    return <li key={p.name + p.logo.length}>{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={p.name}>{img}</a> : img}</li>;
  });
  // short lists sit still and centred; long ones drift (hover or focus pauses them)
  const drift = list.length > 5;
  return (
    <section className="gx-sec gx-partners" aria-labelledby="gx-pt-h">
      <div className="gx-wrap">
        <h2 id="gx-pt-h" className="gx-pt-h gx-rv"><T k="partners.h" /></h2>
        <div className={`gx-marq gx-logos ${drift ? '' : 'still'}`} tabIndex={drift ? 0 : undefined} aria-label={drift ? 'Partner logos. Hover or focus to pause.' : undefined}>
          <ul className="gx-track">{items}</ul>
          {drift && <ul className="gx-track" aria-hidden="true">{list.map((p) => <li key={p.name + p.logo.length}><img src={p.logo} alt="" loading="lazy" decoding="async" /></li>)}</ul>}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- customer reviews
const initials = (n) => String(n || '?').split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const Stars = ({ n }) => (n ? <span className="gx-stars" role="img" aria-label={`${n} out of 5 stars`}>{'★'.repeat(n)}<i>{'★'.repeat(5 - n)}</i></span> : null);
function ReviewCard({ r, hidden }) {
  return (
    <li className="gx-rev" aria-hidden={hidden || undefined}>
      <Stars n={r.rating} />
      <p>“{r.quote}”</p>
      <div className="gx-rev-by">
        {r.photo ? <img src={r.photo} alt="" width="40" height="40" loading="lazy" decoding="async" /> : <span className="gx-av" aria-hidden="true">{initials(r.name)}</span>}
        <span><b>{r.name}</b><small>{[r.role, r.company].filter(Boolean).join(' · ')}</small></span>
      </div>
    </li>
  );
}

/** A small, square-ish copy of a chosen photo (max 256 px, WebP) so it stays well under the server's size limit. */
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Choose a PNG, JPG or WebP photo'));
    const r = new FileReader();
    r.onerror = () => reject(new Error('The photo could not be read'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That photo could not be opened'));
      img.onload = () => {
        const side = Math.min(img.width, img.height), sx = (img.width - side) / 2, sy = (img.height - side) / 2, size = Math.min(256, side);
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
        let out = c.toDataURL('image/webp', 0.82);
        if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.8);
        resolve(out);
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

function ReviewForm({ onClose }) {
  const { country, countries } = useCountry();
  const first = useRef(null);
  const [f, setF] = useState({ name: '', role: '', company: '', country: country.code, rating: 5, quote: '', email: '', consent: false, website: '' });
  const [photo, setPhoto] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { first.current?.focus(); const k = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; }; }, [onClose]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api.post('/api/platform/reviews', { ...f, photo: photo || undefined }); setDone(true); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="gx-modal" role="dialog" aria-modal="true" aria-labelledby="gx-rf-h" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gx-rf">
        <button type="button" className="gx-icon-btn gx-film-x" onClick={onClose} aria-label="Close"><Ico n="close" size={20} /></button>
        {done ? (
          <div className="gx-rf-done"><h3 id="gx-rf-h">Thank you</h3><p>Your review was received. We read every one before it appears on the website.</p><button type="button" className="gx-btn cream sm" onClick={onClose}>Close</button></div>
        ) : (
          <form onSubmit={submit}>
            <h3 id="gx-rf-h">Share your experience</h3>
            <p className="gx-rf-sub">Tell other teams how Agentify ERP works for you. Reviews are checked before they are published.</p>
            {err && <div className="gx-rf-err" role="alert">{err}</div>}
            <div className="gx-rf-row"><label>Your name<input ref={first} required value={f.name} onChange={set('name')} autoComplete="name" maxLength={80} /></label><label>Company<input value={f.company} onChange={set('company')} autoComplete="organization" maxLength={120} /></label></div>
            <div className="gx-rf-row"><label>Role<input value={f.role} onChange={set('role')} maxLength={80} placeholder="e.g. Sales manager" /></label><label>Country<select value={f.country} onChange={set('country')}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label></div>
            <fieldset className="gx-rf-stars"><legend>Rating</legend>{[1, 2, 3, 4, 5].map((n) => <label key={n} className={n <= f.rating ? 'on' : ''}><input type="radio" name="rating" value={n} checked={f.rating === n} onChange={() => setF((x) => ({ ...x, rating: n }))} /><span aria-hidden="true">★</span><span className="gx-sr">{n} star{n > 1 ? 's' : ''}</span></label>)}</fieldset>
            <label>Your review<textarea required rows={4} minLength={20} maxLength={600} value={f.quote} onChange={set('quote')} placeholder="What did you use it for, and what changed for your team?" /><small>{f.quote.length}/600</small></label>
            <div className="gx-rf-row"><label>Email (never shown)<input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></label>
              <label>Photo (optional)<span className="gx-rf-photo">{photo ? <img src={photo} alt="Your photo" width="40" height="40" /> : null}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => { const file = e.target.files[0]; if (!file) return; try { setPhoto(await shrinkPhoto(file)); } catch (x) { setErr(x.message); } }} /></span></label></div>
            <input className="gx-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={f.website} onChange={set('website')} />
            <label className="gx-rf-consent"><input type="checkbox" checked={f.consent} onChange={set('consent')} /> <span>I agree that my review, name, company and photo may be shown on the Agentify ERP website.</span></label>
            <button className="gx-btn cream" disabled={busy}>{busy ? 'Sending…' : 'Send my review'}</button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Reviews approved in the console, for the visitor's country (or all countries). Always offers the form so real customers can add theirs. */
export function Reviews({ list }) {
  const [open, setOpen] = useState(false);
  const n = (list || []).length;
  const drift = n > 3;
  return (
    <section className="gx-sec gx-reviews" id="reviews" aria-labelledby="gx-rv-h">
      <div className="gx-wrap">
        <p className="gx-eyebrow gx-rv"><i>★</i> <T k="reviews.eyebrow" /></p>
        <h2 id="gx-rv-h" className="gx-h2 gx-rv">{n ? <>What customers <span className="gx-grad">are saying</span></> : <>Using Agentify ERP? <span className="gx-grad">Tell us how it goes</span></>}</h2>
        {!!n && (
          <div className={`gx-marq gx-revs ${drift ? '' : 'still'}`} tabIndex={drift ? 0 : undefined} aria-label={drift ? 'Customer reviews. Hover or focus to pause.' : undefined}>
            <ul className="gx-track">{list.map((r) => <ReviewCard key={r.id} r={r} />)}</ul>
            {drift && <ul className="gx-track" aria-hidden="true">{list.map((r) => <ReviewCard key={r.id} r={r} hidden />)}</ul>}
          </div>
        )}
        <p className="gx-rev-cta"><button type="button" className="gx-btn ring sm" onClick={() => setOpen(true)}>Share your experience</button></p>
      </div>
      {open && <ReviewForm onClose={() => setOpen(false)} />}
    </section>
  );
}
