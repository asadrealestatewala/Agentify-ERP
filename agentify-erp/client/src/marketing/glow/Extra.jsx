// Two sections of the home page that sit outside the hero and the tour:
//  - Beyond: the ERP behind the CRM (what the product has beyond leads and follow-ups);
//  - Stories: customer testimonials, shown only when real, permitted ones have been entered in the console (Marketing content).
import { useState } from 'react';
import { Link } from 'react-router-dom';
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
