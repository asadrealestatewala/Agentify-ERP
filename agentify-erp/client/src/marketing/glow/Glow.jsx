// Glow-dark, interactive home page (preview at /preview). Built with the "interactive product landing page" and
// "glow-dark interactive UI" design skills: rotating hero headline, cursor-reactive dot field, floating icons, a live
// product tour, an interactive dashboard, a product film, a phone with install button, plans from the plan settings.
// Every number and name in a mockup is sample data and says so. Real copy about features is limited to what the product does.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCountry } from '../countryCtx.js';
import { track } from '../analytics.js';
import { BRANDS } from '../brandIcons.js';
import Tour, { PhoneCRM } from './Tour.jsx';
import { Ico, CountUp, DotField, reducedMotion, spot, useInstall, useReveal, useTheme } from './parts.jsx';
import { sampleMoney } from './sample.js';
import './previews.css';
import './glow.css';

const NAV = [['#features', 'Features'], ['#tour', 'Live demo', true], ['#dashboard', 'Dashboard'], ['#mobile', 'Mobile app'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']];
const PHRASES = ['captures every enquiry.', 'chases every follow-up.', 'moves every deal forward.', 'keeps your team accountable.'];
const shot = (kind, code) => `/marketing/m-${kind}-${String(code).toLowerCase()}.webp`;

// ---------------------------------------------------------------- navigation
function Nav({ info, theme, toggleTheme }) {
  const { country, countries, setCountry } = useCountry();
  const inst = useInstall();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const btn = useRef(null);
  useEffect(() => { const h = () => setScrolled(window.scrollY > 8); h(); window.addEventListener('scroll', h, { passive: true }); return () => window.removeEventListener('scroll', h); }, []);
  useEffect(() => { if (!open) return undefined; const k = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [open]);
  const brand = info.content.brand || 'Agentify ERP';
  const getApp = async () => { if (inst.canPrompt) { await inst.install(); return; } setOpen(false); document.getElementById('mobile')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' }); };
  const installBtn = inst.installed ? null : <button type="button" className="gx-btn ghost sm" onClick={getApp}><Ico n="download" size={16} /> Download app</button>;
  return (
    <header className={`gx-nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="gx-nav-in">
        <Link to="/" className="gx-logo" aria-label={`${brand} home`}><span className="gx-mark"><Ico n="home" size={18} stroke={2.2} /></span><span className="gx-word">{brand}</span></Link>
        <nav className="gx-links" aria-label="Main">{NAV.map(([h, l, isNew]) => <a key={h} href={h}>{l}{isNew && <b className="gx-new">NEW</b>}</a>)}</nav>
        <div className="gx-nav-r">
          <button type="button" className="gx-icon-btn gx-theme-top" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}><Ico n={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button>
          <label className="gx-sel gx-hide-m"><span className="gx-sr">Country</span>
            <select value={country.code} onChange={(e) => setCountry(e.target.value)} aria-label="Country">{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          <span className="gx-hide-s">{installBtn}</span>
          <Link to="/login" className="gx-link-quiet gx-hide-s">Sign in</Link>
          <Link to="/signup" className="gx-btn cream sm" onClick={() => track('cta_start_trial', { where: 'nav' })}>Start free <Ico n="arrow" size={15} /></Link>
          <button ref={btn} type="button" className="gx-icon-btn gx-menu" aria-expanded={open} aria-controls="gx-drawer" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}><Ico n={open ? 'close' : 'menu'} size={20} /></button>
        </div>
      </div>
      {open && (
        <div id="gx-drawer" className="gx-drawer">
          {NAV.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)}>{l}</a>)}
          <Link to="/login">Sign in</Link>
          <button type="button" onClick={toggleTheme}>{theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}</button>
          <label className="gx-sel drawer"><span className="gx-sr">Country</span><select value={country.code} onChange={(e) => setCountry(e.target.value)} aria-label="Country">{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          {installBtn}
        </div>)}
    </header>
  );
}

// ---------------------------------------------------------------- hero
const FLOATERS = [
  { n: 'phone', x: '4%', y: '14%', d: 26, c: 'var(--c1)' }, { n: 'calendar', x: '92%', y: '6%', d: 34, c: 'var(--c2)' },
  { n: 'chat', x: '0%', y: '58%', d: 18, c: 'var(--c3)' }, { n: 'chart', x: '97%', y: '48%', d: 30, c: 'var(--c4)' },
  { n: 'building', x: '12%', y: '92%', d: 22, c: 'var(--c2)' }, { n: 'check', x: '84%', y: '90%', d: 16, c: 'var(--c1)' },
];
function Floaters() {
  return <>{FLOATERS.map((f, i) => <span key={f.n} className="gx-float" style={{ left: f.x, top: f.y, '--d': f.d, '--c': f.c, '--i': i }} aria-hidden="true"><span><Ico n={f.n} size={22} /></span></span>)}</>;
}
function Hero({ info, onFilm }) {
  const { country } = useCountry();
  const [i, setI] = useState(0);
  const stage = useRef(null);
  useEffect(() => { if (reducedMotion()) return undefined; const t = setInterval(() => setI((x) => (x + 1) % PHRASES.length), 2800); return () => clearInterval(t); }, []);
  const parallax = (e) => { if (reducedMotion()) return; const b = e.currentTarget.getBoundingClientRect(); stage.current?.style.setProperty('--px', ((e.clientX - b.left) / b.width - 0.5).toFixed(3)); stage.current?.style.setProperty('--py', ((e.clientY - b.top) / b.height - 0.5).toFixed(3)); };
  const days = info.trial_days;
  return (
    <section className="gx-hero" onPointerMove={parallax} aria-labelledby="gx-h1">
      <DotField /><div className="gx-hero-glow" aria-hidden="true" />
      <div className="gx-wrap gx-hero-in">
        <a className="gx-chip" href="#tour"><b className="gx-new">NEW</b> Video meetings, call recording and AI Studio are live <Ico n="arrow" size={14} /></a>
        <h1 id="gx-h1">The real estate CRM that <span className="gx-rot" aria-live="polite"><span key={i} className="gx-grad">{PHRASES[i]}</span></span></h1>
        <p className="gx-sub">Manage enquiries, client relationships, property interests and deals from one workspace, so your team knows who to contact, what happens next and where every opportunity stands.</p>
        <div className="gx-cta">
          <Link to="/signup" className="gx-btn cream" onClick={() => track('cta_start_trial', { where: 'hero' })}>Start free for {days} days <Ico n="arrow" size={17} /></Link>
          <a href="#tour" className="gx-btn ring" onClick={() => track('tour_tab', { where: 'hero' })}><Ico n="bolt" size={16} /> Explore the live demo <b className="gx-gold">NEW</b></a>
          <button type="button" className="gx-btn ghost" onClick={onFilm}><Ico n="play" size={14} /> Watch the {FILM.length * 3.6 | 0}-second tour</button>
        </div>
        <ul className="gx-ticks"><li>No card needed to start</li><li>Phone, tablet and desktop</li><li>Your data stays yours: read-only, never deleted</li></ul>
        <div className="gx-stage" ref={stage}>
          <Floaters />
          <div className="gx-laptop">
            <div className="gx-lap-top"><i /><i /><i /><span>sample data</span></div>
            <div className="gx-lap-screen"><img src={shot('re-dash', country.code)} width="2200" height="1480" alt={`The Agentify dashboard, from a ${country.name} demo workspace with sample data`} fetchPriority="high" onError={(e) => { e.currentTarget.style.display = 'none'; }} /><span className="gx-scan" aria-hidden="true" /></div>
          </div>
          <div className="gx-hero-phone"><PhoneCRM currency={country.currency} compact /></div>
          <div className="gx-pop p1" aria-hidden="true"><b>New enquiry</b><small>Website · 9 min ago · sample</small></div>
          <div className="gx-pop p2" aria-hidden="true"><b>✓ Assigned to Sara Malik</b><small>The listing’s agent · sample</small></div>
          <div className="gx-pop p3" aria-hidden="true"><b>Follow-up today, 4:00 pm</b><small>Call back · sample</small></div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- marquees
const SEGMENTS = [['building', 'Real estate brokerages', 'Leads, listings, deals and commissions'], ['home', 'Property developers', 'Plots, units and instalment plans'], ['users', 'Sales teams', 'Own leads, goals and rewards'], ['key', 'Letting and sales agents', 'Enquiries, viewings and offers'], ['file', 'Accounts teams', 'Receipts, vouchers and statements'], ['pin', 'Construction contractors', 'BOQs, budgets and progress'], ['star', 'Buyers and tenants', 'Their own portal for payments and documents']];
function Segments() {
  const cards = SEGMENTS.map(([n, t, s]) => <li key={t}><span className="gx-tile"><Ico n={n} size={22} /></span><span><b>{t}</b><small>{s}</small></span></li>);
  return (
    <section className="gx-seg" aria-label="Who it is built for">
      <p className="gx-eyebrow center"><i>00</i> Built for every kind of property business</p>
      <div className="gx-marq" tabIndex={0} aria-label="Who Agentify is built for. Hover or focus to pause."><ul className="gx-track">{cards}</ul><ul className="gx-track" aria-hidden="true">{cards}</ul></div>
    </section>
  );
}
const WORDS = ['Leads', 'Follow-ups', 'Pipeline', 'Properties', 'Instalments', 'Receipts', 'Commissions', 'Reports'];
function Kinetic() {
  const row = <ul className="gx-kin-t">{WORDS.map((w) => <li key={w}>{w}<em>★</em></li>)}</ul>;
  return (
    <div className="gx-kin" aria-hidden="true">
      <div className="gx-kin-a"><div className="gx-kin-run">{row}{row}</div></div>
      <div className="gx-kin-b"><div className="gx-kin-run">{row}{row}</div></div>
    </div>
  );
}

// ---------------------------------------------------------------- features (spotlight cards)
const FEATURES = [
  ['bolt', 'Lead capture and sources', 'Website form, manual entry and spreadsheet import, with the source kept on every lead.'],
  ['users', 'Assignment and ownership', 'Website enquiries go to the listing’s agent or the next agent in turn; agents can be limited to their own leads.'],
  ['file', 'Client profiles and history', 'Contact details, preferences, notes and a timeline of every call, message and change.'],
  ['chart', 'Pipeline by stage', 'Your own stages, drag and drop, and totals per stage.'],
  ['calendar', 'Follow-ups and tasks', 'Due dates, in-app reminders and push notifications on the installed app.'],
  ['building', 'Leads linked to properties', 'Each enquiry keeps the listing it came from; agents can link another one.'],
  ['star', 'Goals and team view', 'Daily and monthly goals, rewards and per-agent figures.'],
  ['key', 'Customer portal', 'Buyers see their property, payment schedule, receipts and documents.'],
  ['video', 'Calls and video meetings', 'Call next, recordings and transcripts, and meeting links by email, text or WhatsApp link.'],
];
function Features() {
  return (
    <section className="gx-sec" id="features" aria-labelledby="gx-feat-h">
      <div className="gx-wrap">
        <p className="gx-eyebrow gx-rv"><i>02</i> What is inside</p>
        <h2 id="gx-feat-h" className="gx-h2 gx-rv">Everything the CRM does <span className="gx-grad">for a brokerage</span></h2>
        <ul className="gx-fgrid">{FEATURES.map(([n, t, d], k) => <li key={t} className="gx-card gx-rv" style={{ '--s': `${k * 50}ms` }} onPointerMove={spot}><span className="gx-tile"><Ico n={n} size={22} /></span><h3>{t}</h3><p>{d}</p></li>)}</ul>
        <p className="gx-more gx-rv">And the ERP behind it: property and project inventory, sales and payment plans, receipts, commissions, accounting and construction. <Link to="/real-estate">See real estate in detail</Link> · <Link to="/construction">Construction</Link></p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- interactive dashboard (sample)
const PERIODS = {
  '7d': { label: '7 days', leads: 38, follow: 91, views: 14, pipe: 1480000, coll: 212000, series: [3, 5, 4, 6, 8, 7, 9], src: [['Website', 46], ['Portal', 27], ['Referral', 17], ['Walk-in', 10]] },
  '30d': { label: '30 days', leads: 164, follow: 388, views: 61, pipe: 5210000, coll: 884000, series: [12, 16, 14, 19, 22, 18, 25, 28, 24, 30, 33, 36], src: [['Website', 41], ['Portal', 31], ['Referral', 19], ['Walk-in', 9]] },
  '90d': { label: 'This quarter', leads: 497, follow: 1120, views: 188, pipe: 14900000, coll: 2610000, series: [30, 36, 33, 41, 47, 44, 52, 58, 55, 63, 70, 74], src: [['Website', 38], ['Portal', 34], ['Referral', 20], ['Walk-in', 8]] },
};
function areaPath(series, w = 600, h = 190, pad = 14) {
  const max = Math.max(...series) * 1.15;
  const pts = series.map((v, i) => [pad + (i / (series.length - 1)) * (w - pad * 2), h - pad - (v / max) * (h - pad * 2)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`, last: pts[pts.length - 1] };
}
function Dashboard() {
  const { country } = useCountry();
  const nav = useNavigate();
  const [p, setP] = useState('30d');
  const d = PERIODS[p];
  const a = useMemo(() => areaPath(d.series), [d]);
  const cur = country.currency;
  const go = (hash) => { nav({ pathname: '/', hash }); setTimeout(() => document.getElementById('tour')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' }), 60); };
  const kpis = [['New leads', d.leads, (v) => Math.round(v).toLocaleString('en'), 'users'], ['Follow-ups done', d.follow, (v) => Math.round(v).toLocaleString('en'), 'check'], ['Viewings booked', d.views, (v) => Math.round(v).toLocaleString('en'), 'calendar'], ['Pipeline value', d.pipe, (v) => sampleMoney(v, cur), 'chart'], ['Collected', d.coll, (v) => sampleMoney(v, cur), 'file']];
  return (
    <section className="gx-sec" id="dashboard" aria-labelledby="gx-dash-h">
      <div className="gx-wrap">
        <p className="gx-eyebrow gx-rv"><i>03</i> Know where you stand</p>
        <h2 id="gx-dash-h" className="gx-h2 gx-rv">Revenue and follow-ups <span className="gx-grad">at a glance</span></h2>
        <p className="gx-lead gx-rv">A manager’s view of the week: leads in, follow-ups done, viewings booked and what the pipeline is worth. Switch the period and open the screen behind each number.</p>
        <div className="gx-dash gx-rv">
          <Floaters />
          <div className="gx-window">
            <div className="gx-win-bar"><i /><i /><i /><span className="gx-win-hint">Sample data</span></div>
            <div className="gx-dash-b">
              <div className="gx-dash-h">
                <b>Overview</b>
                <div className="gx-chips" role="group" aria-label="Period">{Object.entries(PERIODS).map(([k, v]) => <button key={k} type="button" aria-pressed={p === k} className={p === k ? 'on' : ''} onClick={() => { setP(k); track('tour_tab', { where: `period_${k}` }); }}>{v.label}</button>)}</div>
              </div>
              <ul className="gx-kpis">{kpis.map(([l, v, f, n]) => <li key={l}><span className="gx-kpi-i"><Ico n={n} size={16} /></span><small>{l}</small><b><CountUp to={v} format={f} /></b></li>)}</ul>
              <div className="gx-dash-g">
                <div className="gx-chart" key={p}>
                  <header><b>Leads per period</b><small>sample</small></header>
                  <svg viewBox="0 0 600 190" role="img" aria-label={`Area chart of leads, ${d.label}, sample data`}>
                    <defs><linearGradient id="gx-a" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#34D399" stopOpacity=".45" /><stop offset="1" stopColor="#34D399" stopOpacity="0" /></linearGradient><linearGradient id="gx-l" x1="0" x2="1"><stop offset="0" stopColor="#F5B04A" /><stop offset=".5" stopColor="#34D399" /><stop offset="1" stopColor="#38BDF8" /></linearGradient></defs>
                    {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="600" y1={190 * g} y2={190 * g} className="gx-grid" />)}
                    <path d={a.area} fill="url(#gx-a)" className="gx-area" /><path d={a.line} fill="none" stroke="url(#gx-l)" strokeWidth="3" strokeLinecap="round" pathLength="1" className="gx-line" />
                    <circle cx={a.last[0]} cy={a.last[1]} r="5" className="gx-dot-end" />
                  </svg>
                </div>
                <div className="gx-src">
                  <header><b>Where leads come from</b><small>sample</small></header>
                  <ul>{d.src.map(([n, v]) => <li key={n}><span>{n}</span><span className="gx-bar"><i style={{ '--w': `${v}%` }} /></span><em>{v}%</em></li>)}</ul>
                </div>
              </div>
              <div className="gx-dash-act"><button type="button" className="gx-btn cream sm" onClick={() => go('#pipeline')}>Open the pipeline <Ico n="arrow" size={14} /></button><button type="button" className="gx-btn ghost sm" onClick={() => go('#tour')}>See the lead inbox</button></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- how it works
const STEPS = [['bolt', 'Capture', 'Enquiries from your website, calls and walk-ins land in one list, with their source.'], ['users', 'Assign and follow up', 'Each lead gets an owner and a next follow-up, with reminders in the app.'], ['calendar', 'Show and negotiate', 'Link the property, book the viewing, and move the lead through your stages.'], ['file', 'Close and collect', 'Reserve the property, start the sale and track the payment schedule and receipts.']];
function How() {
  return (
    <section className="gx-sec" id="how" aria-labelledby="gx-how-h">
      <div className="gx-wrap">
        <p className="gx-eyebrow gx-rv"><i>04</i> How it works</p>
        <h2 id="gx-how-h" className="gx-h2 gx-rv">From first enquiry to <span className="gx-grad">signed sale</span></h2>
        <ol className="gx-steps">{STEPS.map(([n, t, d], k) => <li key={t} className="gx-rv" style={{ '--s': `${k * 120}ms` }}><span className="gx-glowtile"><Ico n={n} size={26} /></span><small>STEP 0{k + 1}</small><h3>{t}</h3><p>{d}</p></li>)}</ol>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- mobile
function Mobile() {
  const { country } = useCountry();
  const inst = useInstall();
  const [msg, setMsg] = useState('');
  const onInstall = async () => { if (!inst.canPrompt) { setMsg(inst.ios ? 'Follow the Share steps above to add it to your home screen.' : 'Use the browser menu › Install app. Some browsers only offer it after a few seconds on the page.'); return; } const ok = await inst.install(); setMsg(ok ? 'Installed. Open it from your home screen.' : ''); };
  return (
    <section className="gx-sec gx-mobile" id="mobile" aria-labelledby="gx-mob-h">
      <div className="gx-wrap gx-mob-g">
        <div className="gx-mob-stage gx-rv">
          <span className="gx-float big" style={{ left: '2%', top: '10%', '--d': 22, '--c': 'var(--c2)', '--i': 1 }} aria-hidden="true"><span><Ico n="chat" size={22} /></span></span>
          <span className="gx-float big" style={{ left: '88%', top: '70%', '--d': 28, '--c': 'var(--c1)', '--i': 3 }} aria-hidden="true"><span><Ico n="calendar" size={22} /></span></span>
          <PhoneCRM currency={country.currency} />
          <div className="gx-pop m1" aria-hidden="true"><b>Follow-ups due today: 3</b><small>sample</small></div>
          <div className="gx-pop m2" aria-hidden="true"><b>✓ Viewing booked, Thursday</b><small>sample</small></div>
        </div>
        <div className="gx-rv">
          <p className="gx-eyebrow"><i>05</i> The CRM in your pocket</p>
          <h2 id="gx-mob-h" className="gx-h2">Between viewings, <span className="gx-grad">it is all in your hand</span></h2>
          <p className="gx-lead">Check new leads, open a client, see what they are looking for and complete the follow-up. Try the phone: tap a lead, tick the follow-up, switch to Tasks.</p>
          <ul className="gx-ticks col"><li>Installs on Android and iPhone from the browser</li><li>Bottom tabs for leads, tasks and alerts</li><li>Push reminders for your daily goals once installed</li></ul>
          <div className="gx-install">
            {inst.installed ? <p>The app is installed on this device.</p> : <button type="button" className="gx-btn cream" onClick={onInstall}><Ico n="download" size={17} /> Download the app</button>}
            {!inst.installed && !inst.canPrompt && (inst.ios
              ? <p><b>On iPhone:</b> open this page in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. Apple does not allow a one-click install.</p>
              : <p>Your browser has not offered the one-click install yet. In Chrome or Edge use the browser menu › <b>Install app</b>, or open your workspace and press <b>Download app</b> there.</p>)}
            {msg && <p role="status">{msg}</p>}
            <small>Native versions for Google Play and the App Store are not published yet.</small>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- pricing (from the plan settings)
const fmt = (a, c) => new Intl.NumberFormat('en', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(a);
const lim = (v, one, many) => (v == null ? `Unlimited ${many}` : `Up to ${Number(v).toLocaleString('en')} ${v === 1 ? one : many}`);
const PLAN_C = ['var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c1)'];
function Pricing({ info }) {
  const { country } = useCountry();
  const [int, setInt] = useState('month');
  const plans = (info.plans || []).filter((p) => p.product === 'real_estate');
  const cur = plans.some((p) => p.price?.[country.currency]) ? country.currency : 'USD';
  if (!plans.length) return null;
  return (
    <section className="gx-sec" id="pricing" aria-labelledby="gx-pr-h">
      <div className="gx-wrap">
        <p className="gx-eyebrow gx-rv"><i>06</i> Pricing</p>
        <h2 id="gx-pr-h" className="gx-h2 gx-rv">Plans for <span className="gx-grad">real estate teams</span></h2>
        <p className="gx-lead gx-rv">Every eligible new workspace starts with a {info.trial_days}-day free trial, no card needed. Prices in {cur}{cur !== country.currency ? ` (${country.name} prices are not set yet)` : ''}.</p>
        <div className="gx-toggle gx-rv" role="group" aria-label="Billing period">{[['month', 'Monthly'], ['year', 'Yearly']].map(([k, l]) => <button key={k} type="button" aria-pressed={int === k} className={int === k ? 'on' : ''} onClick={() => setInt(k)}>{l}</button>)}</div>
        <ul className="gx-plans">{plans.map((p, k) => {
          const price = p.price?.[cur]?.[int];
          return (
            <li key={p.id} className={`gx-plan gx-rv ${p.highlight ? 'hot' : ''}`} style={{ '--pc': PLAN_C[k % 4], '--s': `${k * 90}ms` }} onPointerMove={spot}>
              {p.highlight && <span className="gx-pop-tag">Recommended</span>}
              <span className="gx-plan-i"><Ico n={['star', 'bolt', 'building', 'key'][k % 4]} size={18} /></span>
              <h3>{p.name}</h3>
              <p className="gx-price"><span key={`${p.id}${int}`}>{price != null ? fmt(price, cur) : 'Contact us'}</span>{price != null && <small> / {int === 'month' ? 'month' : 'year'}</small>}</p>
              {p.setup_fee?.[cur] ? <p className="gx-fine">+ {fmt(p.setup_fee[cur], cur)} one-time setup</p> : null}
              <ul className="gx-ticks col sm"><li>{lim(p.seats, 'team member', 'team members')}</li><li>{lim(p.properties, 'property', 'properties')}</li><li>{p.storage_mb == null ? 'Unlimited file storage' : `${Math.round((p.storage_mb / 1024) * 10) / 10} GB file storage`}</li>{p.api_access && <li>Website and partner API</li>}{(p.features || []).map((f) => <li key={f}>{f}</li>)}</ul>
              <Link to={`/signup?product=real_estate&plan=${p.id}`} className={`gx-btn ${p.highlight ? 'cream' : 'ring'}`} onClick={() => track('cta_start_trial', { where: `plan_${p.id}` })}>{p.trial_eligible ? 'Start free trial' : 'Get started'}</Link>
            </li>);
        })}</ul>
        <p className="gx-more gx-rv"><Link to="/pricing">Full comparison, add-ons and construction plans</Link></p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- FAQ
const FAQS = [
  ['How do website enquiries reach the CRM?', 'An enquiry from your website becomes a lead with its source. If it came from a listing, it goes to that listing’s agent; otherwise to the next agent in turn. Existing contacts are matched by phone or e-mail, so you do not get duplicates.'],
  ['Can agents see only their own leads?', 'Yes. Each role has its own permissions, and a role can be limited to the leads assigned to that person. Managers can see the whole team.'],
  ['Can we bring our existing contacts?', 'Yes. Import contacts from a spreadsheet, or add them by hand.'],
  ['Can we change the pipeline stages?', 'Yes. Stage names, colours and lead sources are settings in your workspace.'],
  ['Is there a mobile app?', 'The CRM installs on Android and iPhone from the browser, with bottom tabs and push reminders. Native versions in Google Play and the App Store are not published yet.'],
  ['Does it send WhatsApp messages?', 'It opens a ready message in your own WhatsApp; it does not send WhatsApp messages automatically. Calls and text messages go through your own Twilio account once you connect it.'],
  ['Is our data separate from other companies?', 'Yes. Every company has its own database, with role-based access, two-factor sign-in and an audit trail.'],
  ['What happens when the trial ends?', 'If you do not choose a plan, the workspace becomes read-only: you can still sign in and export everything. Nothing is deleted.'],
];
function FAQ({ extra }) {
  const [open, setOpen] = useState(0);
  const key = (q) => q.toLowerCase().replace(/[^a-z]/g, '');
  const all = [...FAQS, ...extra.filter(([q]) => !FAQS.some(([x]) => key(x) === key(q)))];
  return (
    <section className="gx-sec" id="faq" aria-labelledby="gx-faq-h">
      <div className="gx-wrap narrow">
        <p className="gx-eyebrow gx-rv"><i>07</i> Questions</p>
        <h2 id="gx-faq-h" className="gx-h2 gx-rv">Answers <span className="gx-grad">before you ask</span></h2>
        <div className="gx-faq">{all.map(([q, a], k) => (
          <div key={q} className={`gx-qa gx-rv ${open === k ? 'open' : ''}`}>
            <h3><button type="button" aria-expanded={open === k} aria-controls={`gx-a${k}`} id={`gx-q${k}`} onClick={() => setOpen(open === k ? -1 : k)}>{q}<span aria-hidden="true">+</span></button></h3>
            <div className="gx-a" id={`gx-a${k}`} role="region" aria-labelledby={`gx-q${k}`}><div><p>{a}</p></div></div>
          </div>))}</div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- final call to action
function Final({ info }) {
  const c = info.content;
  const wa = String(c.contact_phone || '').replace(/\D/g, '');
  const stars = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ x: (i * 53) % 100, y: (i * 37) % 70, d: (i % 7) * 0.4, s: 1 + (i % 3) }) ), []);
  return (
    <section className="gx-sec" aria-labelledby="gx-fin-h">
      <div className="gx-wrap">
        <div className="gx-final gx-rv">
          <div className="gx-final-l">
            <p className="gx-eyebrow"><i>08</i> Start today</p>
            <h2 id="gx-fin-h" className="gx-h2">Put every lead and follow-up in <em className="gx-grad">one place</em>.</h2>
            <p className="gx-lead">Free for {info.trial_days} days, no card needed. If you stop, your data becomes read-only and is never deleted.</p>
            <div className="gx-cta">
              <Link to="/signup" className="gx-btn cream" onClick={() => track('cta_start_trial', { where: 'final' })}>Start free <Ico n="arrow" size={17} /></Link>
              <Link to="/contact" className="gx-btn ring" onClick={() => track('cta_book_demo', { where: 'final' })}>Book a demo</Link>
              {wa.length >= 7 && <a className="gx-btn ghost" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"><Ico n="whatsapp" size={17} /> WhatsApp us</a>}
              {c.contact_email && <a className="gx-btn ghost" href={`mailto:${c.contact_email}`}><Ico n="mail" size={17} /> Email</a>}
            </div>
          </div>
          <div className="gx-sky" aria-hidden="true">
            {stars.map((s, i) => <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />)}
            <svg viewBox="0 0 300 200" className="gx-const"><polyline points="30,150 80,90 140,110 190,50 260,80" /><g>{[[30, 150], [80, 90], [140, 110], [190, 50], [260, 80]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.5" />)}</g></svg>
            <span className="gx-tag" style={{ left: '8%', top: '62%' }}>LEAD</span><span className="gx-tag" style={{ left: '24%', top: '30%' }}>ASSIGN</span><span className="gx-tag" style={{ left: '44%', top: '48%' }}>FOLLOW UP</span><span className="gx-tag" style={{ left: '62%', top: '14%' }}>OFFER</span><span className="gx-tag" style={{ left: '82%', top: '34%' }}>SALE</span>
            <span className="gx-sun" />
            <div className="gx-pop f1"><b>✓ Follow-up done</b><small>sample</small></div><div className="gx-pop f2"><b>New enquiry</b><small>sample</small></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer({ info }) {
  const c = info.content;
  const { country, countries, setCountry } = useCountry();
  const inst = useInstall();
  const social = Object.entries(c.social || {}).filter(([, v]) => v);
  return (
    <footer className="gx-foot">
      <div className="gx-wrap">
        <div className="gx-foot-big" aria-hidden="true">{(c.brand || "Agentify ERP").replace(/ ERP$/, "")}</div>
        <div className="gx-foot-g">
          <div><p>{c.brand}: real estate CRM with the ERP behind it.</p>{(c.contact_email || c.contact_phone || c.address) && <p className="gx-fine">{[c.contact_email, c.contact_phone, c.address].filter(Boolean).join(' · ')}</p>}{!!social.length && <p>{social.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer noopener" className="gx-cap">{k}</a>)}</p>}</div>
          <div><h4>Product</h4><a href="#features">Features</a><a href="#tour">Live demo</a><a href="#pricing">Pricing</a><Link to="/real-estate">Real estate</Link><Link to="/construction">Construction</Link></div>
          <div><h4>Company</h4><Link to="/contact">Book a demo</Link><Link to="/signup">Start free</Link><Link to="/login">Sign in</Link>{!inst.installed && <button type="button" className="gx-linkbtn" onClick={() => (inst.canPrompt ? inst.install() : document.getElementById('mobile')?.scrollIntoView({ behavior: 'smooth' }))}>Download the app</button>}</div>
          <div><h4>Legal</h4>{(c.legal || []).map((d) => <Link key={d.slug} to={`/legal/${d.slug}`}>{d.title}</Link>)}
            <label className="gx-sel foot"><span className="gx-sr">Country</span><select value={country.code} onChange={(e) => setCountry(e.target.value)} aria-label="Country">{countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></label></div>
        </div>
        <p className="gx-fine center">© {new Date().getFullYear()} {c.brand}. Logos of other products belong to their owners and show compatibility only.</p>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------- the product film (an in-page sequence of real screens)
const FILM = [['re-pipeline', 'Every enquiry in one pipeline'], ['re-dialer', 'Call next, with the script beside you'], ['re-dash', 'The day at a glance'], ['re-sale', 'A sale with its payment plan'], ['con-project', 'And the build, on budget']];
function Film({ onClose }) {
  const { country } = useCountry();
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion());
  const close = useRef(null);
  useEffect(() => { close.current?.focus(); const k = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; }; }, [onClose]);
  useEffect(() => { if (!playing) return undefined; const t = setTimeout(() => setI((x) => (x + 1) % FILM.length), 3600); return () => clearTimeout(t); }, [i, playing]);
  return (
    <div className="gx-modal" role="dialog" aria-modal="true" aria-label="Product tour film" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gx-film">
        <button ref={close} type="button" className="gx-icon-btn gx-film-x" onClick={onClose} aria-label="Close the film"><Ico n="close" size={20} /></button>
        <div className="gx-lap-screen film">{FILM.map(([k, cap], n) => <img key={k} className={n === i ? 'on' : ''} src={shot(k, country.code)} width="2200" height="1480" alt={n === i ? `${cap}. Demo workspace, sample data.` : ''} aria-hidden={n !== i} />)}<span className="gx-scan" aria-hidden="true" /></div>
        <div className="gx-film-bar"><button type="button" className="gx-btn ghost sm" onClick={() => setPlaying(!playing)} aria-pressed={!playing}>{playing ? 'Pause' : 'Play'}</button>
          <p aria-live="polite">{FILM[i][1]}</p>
          <ol className="gx-film-dots">{FILM.map(([k], n) => <li key={k}><button type="button" className={n === i ? 'on' : ''} aria-label={`Scene ${n + 1}`} aria-current={n === i} onClick={() => { setI(n); setPlaying(false); }} /></li>)}</ol></div>
        <div className="gx-film-p" aria-hidden="true"><i key={`${i}${playing}`} className={playing ? 'run' : ''} /></div>
      </div>
    </div>
  );
}

export default function Glow({ info }) {
  const root = useRef(null);
  const [theme, toggleTheme] = useTheme();
  const [film, setFilm] = useState(false);
  const { country } = useCountry();
  useReveal(root);
  useEffect(() => { document.title = 'Agentify ERP: real estate CRM with the ERP behind it (preview)'; }, []);
  const extra = [...(info.content.faqs || []), ...((country.copy || {}).faqs || [])];
  return (
    <div className="lp glow" data-theme={theme} ref={root}>
      <a href="#main" className="gx-skip">Skip to content</a>
      <Nav info={info} theme={theme} toggleTheme={toggleTheme} />
      <main id="main">
        <Hero info={info} onFilm={() => setFilm(true)} />
        <Segments />
        <Kinetic />
        <Features />
        <Tour />
        <Dashboard />
        <How />
        <Mobile />
        <Pricing info={info} />
        <FAQ extra={extra} />
        <Final info={info} />
      </main>
      <Footer info={info} />
      {film && <Film onClose={() => setFilm(false)} />}
    </div>
  );
}
