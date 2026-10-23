// Public website on the main domain: home, the two product pages, pricing, contact/demo, legal documents, sign-up and
// "find my workspace". Texts, plans, prices, trial terms and legal documents come from /api/platform/marketing and are
// edited by platform staff in the console. Nothing here invents customers, counts, testimonials or integrations.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { CountryCtx, useCountry } from './countryCtx.js';
import { Loading } from '../components/ui.jsx';
import Flag from '../components/Flag.jsx';
import { BRANDS } from './brandIcons.js';
import { track, consent, setConsent, browserOptOut, configureGa4, attributionFields, onConsentChange } from './analytics.js';
import { setRegion } from '../format.js';
import { MortgageCalculator, PurchaseCostCalculator, UnitConverter } from '../site/RegionCalculators.jsx';
import '../site/site.css';
import '../pages/landing.css';
import './marketing.css';
import Glow from './glow/Glow.jsx';

const PRODUCT_PATH = { real_estate: '/real-estate', construction: '/construction' };
const METHOD = { raast: 'Raast', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', sadapay: 'SadaPay', nayapay: 'NayaPay', bank: 'Bank transfer' };
const fmt = (amount, cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(amount);
const limitLine = (v, one, many) => (v == null ? `Unlimited ${many}` : `Up to ${Number(v).toLocaleString()} ${v === 1 ? one : many}`);

/** Real screenshots of the application, taken from a demo workspace (see docs). Hidden if an image is missing. */
const SCREENS = {
  real_estate: [['re-dashboard.png', 'Dashboard with collections, receivables and follow-ups'], ['re-sale.png', 'A sale with its installment schedule and receipts']],
  construction: [['con-project.png', 'Construction project: budget vs actual, BOQ and progress'], ['con-boq.png', 'Bill of quantities with measured progress']],
};
function Shot({ file, caption }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <figure className="lshot" style={{ margin: 0 }}><img src={`/marketing/${file}`} alt={caption} loading="lazy" onError={() => setOk(false)} /><figcaption>{caption} (application screenshot)</figcaption></figure>;
}

function useTitle(title, description) {
  useEffect(() => {
    if (!title) return;
    document.title = title;
    let m = document.querySelector('meta[name=description]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    m.content = description || '';
  }, [title, description]);
}

// ---------------------------------------------------------------- country
// One site for every country. The visitor's country decides the currency, the wording and the calculators; it is saved in
// localStorage and a cookie and kept in the URL (?country=uk) so a link keeps it. A first visit only suggests a country
// from the server's approximate IP location (home page only) or, failing that, the browser language and time zone; a choice the visitor makes is remembered and always wins.
export { useCountry };
const PATH_COUNTRY = { us: 'US', uk: 'UK', ae: 'AE', pk: 'PK', ca: 'CA' };
function guessCountry(countries) {
  const langs = (navigator.languages || [navigator.language || '']).map((l) => String(l).toLowerCase());
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const g = tz === 'Asia/Karachi' || langs.some((l) => l.endsWith('-pk')) ? 'PK' : tz === 'Asia/Dubai' || langs.some((l) => l.endsWith('-ae')) ? 'AE' : tz === 'Europe/London' || langs.some((l) => l.endsWith('-gb')) ? 'UK'
    : tz.startsWith('America/') || langs.some((l) => l.endsWith('-us')) ? 'US' : null;
  return countries.find((c) => c.code === g)?.code || countries.find((c) => c.open)?.code || countries[0].code;
}
function CountryProvider({ info, children }) {
  const loc = useLocation();
  const nav = useNavigate();
  const countries = info.countries?.length ? info.countries : [{ code: 'PK', name: 'Pakistan', currency: 'PKR', open: true, config: {}, copy: {}, timezones: ['Asia/Karachi'] }];
  const byCode = (c) => countries.find((x) => x.code === String(c || '').toUpperCase());
  const initial = (() => {
    const q = new URLSearchParams(loc.search).get('country');
    const slug = loc.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    let saved = null; try { saved = localStorage.getItem('agentify_country'); } catch { /* storage blocked */ }
    const pick = byCode(q) || byCode(PATH_COUNTRY[slug]) || byCode(saved);
    return { code: (pick || { code: guessCountry(countries) }).code, manual: !!pick };
  })();
  const [code, setCode] = useState(initial.code);
  // manual = the visitor chose a country (menu, link or an earlier visit); only then is the choice remembered
  const [manual, setManual] = useState(initial.manual);
  // detected = approximate country and city of the visitor from the server (GET /api/platform/geo); null until known or when unavailable
  const [detected, setDetected] = useState(null);
  const home = loc.pathname === '/' || loc.pathname === '/preview';
  useEffect(() => {
    if (!home) return undefined;
    let off = false;
    api.get('/api/platform/geo').then((g) => { if (!off && g?.country && g.supported) setDetected({ country: String(g.country).toUpperCase(), city: g.city || null }); }).catch(() => { /* the page works without it */ });
    return () => { off = true; };
  }, [home]);
  // once, and only while the visitor has not chosen: follow the detected country
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || manual || !detected) return;
    applied.current = true;
    const c = byCode(detected.country);
    if (c && c.open !== false) setCode(c.code);
  }, [detected]); // eslint-disable-line react-hooks/exhaustive-deps
  const country = byCode(code) || countries[0];
  // applied during render so the calculators below read this country's formats on their first paint
  if (country.config?.region) setRegion(country.config);
  useEffect(() => {
    const slug = loc.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (PATH_COUNTRY[slug] && byCode(PATH_COUNTRY[slug])) setCode(PATH_COUNTRY[slug]);
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (manual) {
      try { localStorage.setItem('agentify_country', country.code); } catch { /* ignore */ }
      document.cookie = `agentify_country=${country.code}; path=/; max-age=31536000; samesite=lax`;
    }
    // alternate-language/country links for search engines
    document.head.querySelectorAll('link[data-hreflang]').forEach((n) => n.remove());
    for (const c of countries) {
      const l = document.createElement('link'); l.rel = 'alternate'; l.hreflang = `${String(c.locale || 'en').split('-')[0]}-${c.code === 'UK' ? 'GB' : c.code}`; l.href = `${window.location.origin}/${c.slug}`; l.setAttribute('data-hreflang', '1'); document.head.appendChild(l);
    }
  }, [country.code, manual]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (c) => {
    setManual(true);
    setCode(c);
    const q = new URLSearchParams(loc.search); q.set('country', String(c).toLowerCase() === 'uk' ? 'uk' : String(c).toLowerCase());
    nav({ pathname: PATH_COUNTRY[loc.pathname.replace(/^\/+|\/+$/g, '').toLowerCase()] ? '/' : loc.pathname, search: `?${q}` }, { replace: true });
    track('country_selected', { country: c });
  };
  const resetLocation = () => {
    try { localStorage.removeItem('agentify_country'); } catch { /* ignore */ }
    document.cookie = 'agentify_country=; path=/; max-age=0; samesite=lax';
    setManual(false);
    const c = detected && byCode(detected.country);
    setCode(c && c.open !== false ? c.code : guessCountry(countries));
    const q = new URLSearchParams(loc.search); q.delete('country');
    nav({ pathname: loc.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
    track('country_selected', { country: 'detected' });
  };
  return <CountryCtx.Provider value={{ country, countries, setCountry: choose, manual, detected, resetLocation }}>{children}</CountryCtx.Provider>;
}
function CountrySwitch({ compact }) {
  const { country, countries, setCountry } = useCountry();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!e.target.closest?.('.lcountry')) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (countries.length < 2) return null;
  return (
    <div className="lcountry" style={{ position: 'relative', display: 'inline-block', fontSize: 14 }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Country: ${country.name}. Change`} onClick={() => setOpen(!open)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: 'inherit', padding: '7px 10px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer', color: 'inherit' }}>
        <Flag code={country.code} /><span>{country.name}</span><span aria-hidden style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <ul role="listbox" aria-label="Country" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, margin: 0, padding: 4, listStyle: 'none', background: '#fff', border: '1px solid #d0d5dd', borderRadius: 10, boxShadow: '0 8px 24px rgba(16,24,40,.14)', minWidth: 210 }}>
          {countries.map((c) => (
            <li key={c.code} role="option" aria-selected={c.code === country.code}>
              <button type="button" onClick={() => { setCountry(c.code); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', font: 'inherit', padding: '8px 10px', border: 0, borderRadius: 8, background: c.code === country.code ? '#e6f4f1' : 'transparent', cursor: 'pointer', color: 'inherit' }}>
                <Flag code={c.code} /><span style={{ flex: 1 }}>{c.name}</span>{!c.open && <small style={{ opacity: 0.6 }}>soon</small>}
              </button>
            </li>))}
        </ul>)}
    </div>
  );
}
const SITE_VARS = { '--s-primary': '#0f766e', '--s-accent': '#f59e0b', '--s-dark': '#17202e', '--s-bg': '#ffffff', '--s-soft': '#f4f7f6', '--s-radius': '12px', '--s-font-h': 'inherit', '--s-font-b': 'inherit' };
/** Live calculators for the chosen country, so a visitor can try the numbers before signing up. */
function CalcStrip() {
  const { country } = useCountry();
  const c = country.config || {};
  const copy = country.copy || {};
  const tabs = [
    ...(c.calculators?.mortgage ? [['mortgage', 'Mortgage calculator', MortgageCalculator]] : []),
    ...(c.calculators?.purchase_costs ? [['costs', c.calculators.purchase_costs === 'sdlt' ? 'Stamp Duty' : c.calculators.purchase_costs === 'dld' ? 'Purchase fees' : 'Closing costs', PurchaseCostCalculator]] : []),
    ...(c.calculators?.unit_converter ? [['units', 'Area converter', UnitConverter]] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.[0]);
  useEffect(() => { setTab(tabs[0]?.[0]); }, [country.code]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tabs.length) return null;
  const Active = (tabs.find(([k]) => k === tab) || tabs[0])[2];
  return (
    <section className="alt"><div className="lwrap">
      <div className="lsh"><h2>{copy.calc_title || 'Try the numbers'}</h2><p>{copy.calc_sub}</p></div>
      <div className="site" style={{ ...SITE_VARS, background: 'transparent', minHeight: 0 }} key={country.code}>
        <div className="tabs-pill">{tabs.map(([k, l]) => <button type="button" key={k} className={(tab || tabs[0][0]) === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <Active />
      </div>
    </div></section>
  );
}

function Header({ info }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const brand = info.content.brand;
  const links = [['/real-estate', 'Real Estate'], ['/construction', 'Construction'], ['/pricing', 'Pricing'], ['/contact', 'Book a demo']];
  return (
    <>
      {info.content.announcement_bar && <div className="lbar">{info.content.announcement_bar}</div>}
      <header><div className="lwrap">
        <Link className="llogo" to="/" aria-label={`${brand} home`}><i aria-hidden>⌂</i>{brand}</Link>
        <nav aria-label="Main">
          {links.map(([to, l]) => <NavLink key={to} className="hide-m" to={to}>{l}</NavLink>)}
          <NavLink className="hide-m" to="/login">Sign in</NavLink>
          <span className="hide-m"><CountrySwitch /></span>
          <Link className="lbtn p sm" to="/signup">Start free trial</Link>
          <button className="lmenu" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
        </nav>
      </div></header>
      <div className={`ldrawer ${open ? 'open' : ''}`}>{[...links, ['/login', 'Sign in']].map(([to, l]) => <Link key={to} to={to}>{l}</Link>)}<div style={{ padding: '10px 16px' }}><CountrySwitch /></div></div>
    </>
  );
}

function Footer({ info, onCookies }) {
  const c = info.content;
  const social = Object.entries(c.social || {}).filter(([, v]) => v);
  return (
    <footer><div className="lwrap"><div className="lcols">
      <div><h4>{c.brand}</h4><p style={{ margin: 0 }}>{PRODUCT_LABELS.real_estate} and {PRODUCT_LABELS.construction} on one platform.</p>
        {(c.contact_email || c.contact_phone || c.address) && <p style={{ marginTop: 10 }}>{[c.contact_email && <a key="e" href={`mailto:${c.contact_email}`}>{c.contact_email}</a>, c.contact_phone, c.address].filter(Boolean).map((x, i) => <span key={i} style={{ display: 'block' }}>{x}</span>)}</p>}
        {!!social.length && <p>{social.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer noopener" style={{ marginRight: 12, textTransform: 'capitalize' }}>{k}</a>)}</p>}
      </div>
      <div><h4>Products</h4><Link to="/real-estate">Real Estate Brokerage</Link><Link to="/construction">Construction Management</Link><Link to="/pricing">Pricing</Link></div>
      <div><h4>Company</h4><Link to="/contact">Book a demo</Link><Link to="/signup">Start free trial</Link><Link to="/login">Sign in</Link></div>
      <div><h4>Country</h4><CountrySwitch /></div>
      <div><h4>Legal</h4>{info.content.legal.map((d) => <Link key={d.slug} to={`/legal/${d.slug}`}>{d.title}</Link>)}<button className="llink" onClick={onCookies}>Cookie settings</button></div>
    </div><div style={{ width: '100%', marginTop: 18 }}>© {new Date().getFullYear()} {c.brand}</div></div></footer>
  );
}
const PRODUCT_LABELS = { real_estate: 'Real Estate Brokerage Management', construction: 'Construction Management' };

function ConsentBanner({ show, onClose }) {
  useEffect(() => {
    if (!show) return undefined;
    document.documentElement.dataset.consent = 'open';
    return () => { delete document.documentElement.dataset.consent; };
  }, [show]);
  if (!show) return null;
  const pick = (v) => { setConsent(v); onClose(); };
  return (
    <div className="lconsent" role="dialog" aria-live="polite" aria-label="Cookie choice">
      <p>We would like to use optional analytics to learn which pages help visitors. No advertising, no selling of data. <Link to="/legal/privacy">Privacy policy</Link></p>
      <button className="lbtn sm" onClick={() => pick('denied')}>Decline</button>
      <button className="lbtn p sm" onClick={() => pick('granted')}>Accept analytics</button>
    </div>
  );
}

// ---------------------------------------------------------------- pages
function Home({ info }) {
  const c = info.content;
  const { country } = useCountry();
  const cc = country.copy || {};
  useTitle(c.seo.home.title, c.seo.home.description);
  return (
    <>
      <div className="mhero"><div className="mwrap mhero-g">
        <div className="mhero-t">
          <h1>{cc.hero_title || c.hero_title}</h1>
          <p>{cc.hero_subtitle || c.hero_subtitle}</p>
          <EmailStart trialDays={info.trial_days} where="hero" />
          <ul className="ltrust"><li>No card needed to start</li><li>Your data stays yours, read-only if you stop paying</li><li>Set up in minutes</li></ul>
          <Link className="llink2" to="/contact" onClick={() => track('cta_book_demo', { where: 'hero' })}>Prefer a walkthrough? Book a demo</Link>
        </div>
        <HeroShowcase info={info} />
      </div></div>
      <LogoStrip />
      <Workflow />
      <ProductSplit info={info} />
      <SellSection trialDays={info.trial_days} />
      <Included />
      <LeakCalc trialDays={info.trial_days} />
      <CalcStrip />
      <Voices testimonials={(c.testimonials || []).filter((t) => !t.country || t.country === country.code)} trialDays={info.trial_days} />
      <Faq faqs={[...(c.faqs || []), ...(cc.faqs || [])]} />
      <Band info={info} />
      <StickyCta trialDays={info.trial_days} />
    </>
  );
}

/** Email first: one field, and the sign-up form opens with it filled in. Nothing is stored until the person creates a workspace. */
function EmailStart({ trialDays, where }) {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const go = (e) => { e.preventDefault(); track('cta_start_trial', { where }); nav(`/signup${email ? `?email=${encodeURIComponent(email.trim())}` : ''}`); };
  return (
    <form className="lstart" onSubmit={go}>
      <input type="email" inputMode="email" autoComplete="email" aria-label="Your work email" placeholder="Your work email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="lbtn p lg" type="submit">Start your {trialDays}-day free trial</button>
    </form>
  );
}

// ---------------------------------------------------------------- real product pictures
// Screens of demo workspaces (sample data, one per country, so currency and formats always match the visitor's country).
const shotUrl = (kind, code) => `/marketing/m-${kind}-${String(code).toLowerCase()}.webp`;
function useImageOk(src) {
  const [ok, setOk] = useState(null);
  useEffect(() => { let live = true; setOk(null); const i = new Image(); i.onload = () => live && setOk(true); i.onerror = () => live && setOk(false); i.src = src; return () => { live = false; }; }, [src]);
  return ok;
}
/** A window onto the application: the picture is cropped (never stretched) so its text stays readable. */
function Crop({ src, alt, hero, shift, priority }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (bad) return null;
  return <div className={`mcrop ${hero ? 'hero' : ''}`} style={shift ? { '--mx': shift } : undefined}><img src={src} alt={alt} width="2200" height="1480" loading={priority ? 'eager' : 'lazy'} decoding="async" fetchPriority={priority ? 'high' : undefined} onError={() => setBad(true)} /></div>;
}

function HeroShowcase({ info }) {
  const { country } = useCountry();
  const code = country.code;
  const [which, setWhich] = useState('real_estate');
  const reOk = useImageOk(shotUrl('re-dash', code));
  const coOk = useImageOk(shotUrl('con-project', code));
  // the Construction view is offered only when the product exists and this country has a real screenshot of it
  const canShowCon = !!info.products?.construction && coOk === true;
  const active = which === 'construction' && canShowCon ? 'construction' : 'real_estate';
  const legacy = code === 'PK' ? '/marketing/re-dashboard.png' : `/marketing/re-dashboard-${String(code).toLowerCase()}.png`;
  const src = active === 'construction' ? shotUrl('con-project', code) : reOk === false ? legacy : shotUrl('re-dash', code);
  const label = active === 'construction' ? 'Construction project with budget, committed and actual cost, and progress' : 'Real estate dashboard with collections, new leads and follow-ups';
  return (
    <figure className="mhero-fig">
      {canShowCon && (
        <div className="mseg" role="group" aria-label="Show the product">
          {[['real_estate', 'Real estate'], ['construction', 'Construction']].map(([k, l]) => <button type="button" key={k} className={`${k} ${active === k ? 'on' : ''}`} aria-pressed={active === k} onClick={() => { setWhich(k); track('product_page_view', { product: k }); }}>{l}</button>)}
        </div>)}
      <Crop key={src} src={src} hero priority alt={`${label}, from a ${country.name} demo workspace`} />
      <figcaption>{active === 'construction' ? 'A construction project: budget against cost and progress.' : 'The real estate dashboard.'} Screenshot of a demo workspace with sample data.</figcaption>
    </figure>
  );
}

/** Tools the product really connects with. Shown as compatibility, never as partners or customers. */
function LogoStrip() {
  return (
    <section className="lworks" aria-label="Works with"><div className="mwrap">
      <p className="lworks-t">Connects with the tools your team already uses</p>
      <ul className="lworks-l">{BRANDS.map((b) => <li key={b.id}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d={b.path} fill="currentColor" /></svg><span>{b.name}</span></li>)}</ul>
      <p className="lfine lworks-f">Logos belong to their owners and show compatibility only. They do not mean partnership or endorsement.</p>
    </div></section>
  );
}

// ---------------------------------------------------------------- the working day, in the product's own screens
const FLOW = [
  ['re-pipeline', 'Capture and rank every enquiry', 'Leads from your website, portals and WhatsApp land in one pipeline. Agents see their own leads; managers see everything.', '-27%'],
  ['re-dialer', 'Call the right person first', 'Call next ranks who needs a call and why. The script sits beside you and every call, recording and outcome is logged.', '-27%'],
  ['re-sale', 'Close with a clear payment plan', 'A sale keeps its instalment schedule, receipts and commissions together, with an audit trail.', '-27%'],
  ['con-boq', 'Then build it, on budget', 'Construction projects track the bill of quantities, purchase orders and site progress against the budget.', '-27%'],
];
function Workflow() {
  const { country } = useCountry();
  const [i, setI] = useState(0);
  const step = FLOW[i];
  const onKey = (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setI((i + 1) % FLOW.length); } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setI((i + FLOW.length - 1) % FLOW.length); } };
  return (
    <section className="mflow"><div className="mwrap">
      <h2 className="mh2">From first enquiry to handover, in one system</h2>
      <div className="mflow-g">
        <ol className="mflow-l" role="group" aria-label="Steps" onKeyDown={onKey}>
          {FLOW.map(([, t, d], k) => (
            <li key={t}><button type="button" className={k === i ? 'on' : ''} aria-pressed={k === i} onClick={() => setI(k)}>
              <span className="mflow-n" aria-hidden="true">{k + 1}</span><span><b>{t}</b><small>{d}</small></span>
            </button></li>))}
        </ol>
        <figure className="mflow-fig" aria-live="polite">
          <Crop key={`${step[0]}-${country.code}`} src={shotUrl(step[0], country.code)} shift={step[3]} alt={`${step[1]}: screen from a ${country.name} demo workspace`} />
          <figcaption>Demo workspace with sample data.</figcaption>
        </figure>
      </div>
    </div></section>
  );
}

// ---------------------------------------------------------------- the two products, side by side but not equal
function ProductSplit({ info }) {
  const c = info.content;
  const { country } = useCountry();
  const code = country.code;
  const view = (p) => (
    <article className={`mprod ${p === 'real_estate' ? 're' : 'con'}`} key={p}>
      <h3>{c[p].title}</h3>
      <p className="mprod-sub">{c[p].subtitle}</p>
      <ul className="mlist">{c[p].features.slice(0, 4).map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ul>
      <Link className="mlink" to={PRODUCT_PATH[p]} onClick={() => track('product_page_view', { product: p })}>Explore {p === 'real_estate' ? 'real estate' : 'construction'}</Link>
      <Crop src={shotUrl(p === 'real_estate' ? 're-sale' : 'con-project', code)} shift="-27%" alt={`${p === 'real_estate' ? 'A sale with its payment schedule' : 'A construction project'}, from a ${country.name} demo workspace`} />
    </article>
  );
  return (
    <section className="msplit"><div className="mwrap">
      <h2 className="mh2">Two products, built for how each business works</h2>
      <p className="mlead">Shared sign-in, users, billing, reports and notifications. The product modules stay separate, so each team sees only what it needs.</p>
      <div className="msplit-g">{view('real_estate')}{view('construction')}</div>
    </div></section>
  );
}

// ---------------------------------------------------------------- calling and meeting, merged
function SellSection({ trialDays }) {
  const { country } = useCountry();
  const cc = country.copy || {};
  return (
    <section className="msell"><div className="mwrap msell-g">
      <figure className="msell-fig">
        <Crop src={shotUrl('re-dialer', country.code)} shift="-27%" alt={`The dialer: who to call next and why, with the call script beside it, from a ${country.name} demo workspace`} />
        <figcaption>Demo workspace with sample data.</figcaption>
      </figure>
      <div>
        <h2 className="mh2">Call, meet and follow up without leaving the CRM</h2>
        <p className="mlead">Call next ranks the people who most need a phone call and tells you why. Schedule a video meeting and send each person their own link by email, text message or WhatsApp.</p>
        <ul className="lcheck">
          <li>One press to call; the outcome sets the next follow-up, so nothing slips</li>
          <li>Share your screen, point and draw on it, switch on live captions</li>
          <li>Record calls and meetings; recordings and transcripts stay in your workspace</li>
          <li>Calls made, how many connected and the average call length, per agent</li>
        </ul>
        {cc.calls && <p className="lfine">{cc.calls}</p>}
        <Link className="lbtn p" to="/signup" onClick={() => track('cta_start_trial', { where: 'sell' })}>Try it free for {trialDays} days</Link>
      </div>
    </div></section>
  );
}

// ---------------------------------------------------------------- what else comes with it (plain rows, not cards)
const INCLUDED = [
  ['Your property website', 'Included with every plan, on your own domain, with listings, calculators and enquiry forms.'],
  ['Appointments', 'Viewings and site visits go to your Google Calendar, with reminders.'],
  ['Portals and social', 'Publish to the portals of your country and to Facebook, Instagram, LinkedIn and TikTok.'],
  ['Claude, ChatGPT and Gemini', 'Ask questions about your own numbers and turn a listing into a promotional video script. You bring your own key.'],
  ['Documents and signatures', 'Contracts and letters from templates, kept with the customer or the sale.'],
  ['Security you can explain', 'A separate database per company, role-based access, two-factor sign-in and an audit trail.'],
];
function Included() {
  return (
    <section className="mincl"><div className="mwrap">
      <h2 className="mh2">Included in every plan</h2>
      <dl className="mincl-l">{INCLUDED.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
    </div></section>
  );
}

/** An estimate from the visitor's own numbers. No starting values: nothing is invented, and nothing shows until all four are entered. */
function LeakCalc({ trialDays }) {
  const { country } = useCountry();
  const cur = country.currency || 'USD';
  const [v, setV] = useState({ leads: '', lost: '', close: '', commission: '' });
  const n = (k) => Number(v[k]);
  const ready = ['leads', 'lost', 'close', 'commission'].every((k) => Number.isFinite(n(k)) && n(k) > 0) && n('lost') <= 100 && n('close') <= 100;
  const lostDeals = ready ? ((n('leads') * n('lost')) / 100) * (n('close') / 100) : 0;
  const money = (x) => new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Math.round(x));
  const field = (k, label, ph, suffix) => <label className="lcalc-f"><span>{label}</span><div><input type="number" min="0" inputMode="decimal" placeholder={ph} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />{suffix && <em>{suffix}</em>}</div></label>;
  return (
    <section className="mleak"><div className="mwrap lcalc">
      <div>
        <h2 className="mh2" style={{ color: '#fff' }}>What do slow follow-ups cost you?</h2>
        <p className="mlead" style={{ color: '#c3d3cf' }}>Enter your own numbers. We do not guess them for you.</p>
        <div className="lcalc-g">
          {field('leads', 'New leads a month', 'e.g. 80')}
          {field('lost', 'Leads that never get a proper follow-up', 'e.g. 15', '%')}
          {field('close', 'Leads that normally become a sale', 'e.g. 3', '%')}
          {field('commission', `Average commission per sale (${cur})`, 'Amount')}
        </div>
      </div>
      <div className="lcalc-out" aria-live="polite">
        <span>Your estimate</span>
        {ready ? (
          <><b>{money(lostDeals * n('commission'))}</b>
            <small>in commission slipping away each month, about {lostDeals.toFixed(1)} {lostDeals === 1 ? 'sale' : 'sales'}. An estimate from the numbers you entered.</small>
            <Link className="lbtn p" to="/signup" onClick={() => track('cta_start_trial', { where: 'leak_calc' })}>Start recovering them free for {trialDays} days</Link></>
        ) : <small>Fill in the four fields to see what slow follow-ups may cost you each month.</small>}
      </div>
    </div></section>
  );
}

/** Real, permitted customer quotes entered in the console. Until there are some, say what an early customer gets instead. */
function Voices({ testimonials, trialDays }) {
  if (testimonials.length) {
    const [lead, ...rest] = testimonials;
    return (
      <section className="mvoice"><div className="mwrap">
        <h2 className="mh2">What customers say</h2>
        <figure className="lvoice"><blockquote>“{lead.quote}”</blockquote><figcaption><b>{lead.name}</b>{lead.role ? `, ${lead.role}` : ''}<span>{lead.company}</span></figcaption></figure>
        {!!rest.length && <div className="lgrid" style={{ marginTop: 18 }}>{rest.map((t, i) => <blockquote key={i} className="lcard lquote" style={{ margin: 0 }}>“{t.quote}”<footer>{t.name}{t.role ? `, ${t.role}` : ''} · {t.company}</footer></blockquote>)}</div>}
      </div></section>
    );
  }
  return (
    <section className="mvoice"><div className="mwrap">
      <div className="lfound">
        <div>
          <h2 className="mh2" style={{ fontSize: 'clamp(26px,3vw,36px)' }}>Be one of the first teams on it.</h2>
          <p>We are onboarding our first customers personally. You get the full {trialDays}-day trial, help moving your contacts and listings across, and a direct line to the people who build it.</p>
          <p className="lfine">When you are happy and say we may, we will publish your story here. Only real, approved quotes are ever shown on this page.</p>
        </div>
        <div className="lfound-c"><Link className="lbtn p lg" to="/contact" onClick={() => track('cta_founding_customer', { where: 'voices' })}>Talk to us about onboarding</Link><Link className="lbtn lg" to="/signup" onClick={() => track('cta_start_trial', { where: 'voices' })}>Or start the free trial</Link></div>
      </div>
    </div></section>
  );
}

/** A slim bar that appears after the visitor has scrolled past the first screen (hidden while the cookie choice is open). */
function StickyCta({ trialDays }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const h = () => setShow(window.scrollY > 700); h(); window.addEventListener('scroll', h, { passive: true }); return () => window.removeEventListener('scroll', h); }, []);
  return (
    <div className={`lsticky ${show ? 'on' : ''}`} aria-hidden={!show}>
      <span>Free for {trialDays} days. No card needed.</span>
      <Link className="lbtn p sm" to="/signup" tabIndex={show ? 0 : -1} onClick={() => track('cta_start_trial', { where: 'sticky' })}>Start free trial</Link>
      <Link className="lbtn sm" to="/contact" tabIndex={show ? 0 : -1} onClick={() => track('cta_book_demo', { where: 'sticky' })}>Book a demo</Link>
    </div>
  );
}

// Screenshots come from a demo workspace in each country, so a visitor never sees another country's currency.
const COUNTRY_SCREENS = (code) => ({
  real_estate: [[`re-dashboard-${code}.png`, 'Dashboard with sales, collections and follow-ups'], [`re-sale-${code}.png`, 'A sale with its payment schedule']],
  construction: [],
});
function Screens({ product }) {
  const { country } = useCountry();
  const set = country.code === 'PK' ? SCREENS : COUNTRY_SCREENS(country.code.toLowerCase());
  const list = product ? set[product] : country.code === 'PK' ? [...SCREENS.real_estate.slice(0, 1), ...SCREENS.construction.slice(0, 1)] : set.real_estate.slice(0, 2);
  if (!list.length) return null;
  return <section className={product ? '' : 'alt'}><div className="lwrap"><div className="lsh"><h2>See the application</h2><p>Screens from the working product, with demo data.</p></div><div className="lshots">{list.map(([f, cap]) => <Shot key={f} file={f} caption={cap} />)}</div></div></section>;
}

function Faq({ faqs }) {
  if (!faqs?.length) return null;
  return <section id="faq"><div className="lwrap"><div className="lsh"><h2>Questions</h2></div>{faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></section>;
}
function Band({ info, product }) {
  return (
    <section style={{ paddingTop: 0 }}><div className="lwrap"><div className="lband">
      <h2>Ready to try it with your own data?</h2>
      <p>Free for {info.trial_days} days. No card needed. If you stop, your data becomes read-only and is never deleted.</p>
      <ol className="mstart"><li>Create your workspace</li><li>Invite your team</li><li>Pick a plan when you are ready</li></ol>
      <div className="lcta"><Link className="lbtn lg" to={`/signup${product ? `?product=${product}` : ''}`} onClick={() => track('cta_start_trial', { where: 'band' })}>Create your workspace</Link><Link className="lbtn lg ghost" to="/contact" onClick={() => track('cta_book_demo', { where: 'band' })}>Book a demo</Link></div>
    </div></div></section>
  );
}

function ProductPage({ info, product }) {
  const { country } = useCountry();
  const cur = country.currency;
  const c = info.content[product];
  const seo = info.content.seo[product];
  useTitle(seo.title, seo.description);
  useEffect(() => { track('product_page_view', { product }); }, [product]);
  const plans = info.plans.filter((p) => p.product === product);
  return (
    <>
      <div className="lwrap lhero">
        <span className="ltag2">{product === 'real_estate' ? 'Real Estate Brokerage Management' : 'Construction Management'}</span>
        <h1 style={{ marginTop: 14 }}>{c.title}</h1>
        <p>{c.subtitle}</p>
        <div className="lcta"><Link className="lbtn p" to={`/signup?product=${product}`}>Start free trial</Link><Link className="lbtn" to={`/pricing?product=${product}`}>See pricing</Link><Link className="lbtn" to={`/contact?product=${product}`}>Book a demo</Link></div>
      </div>
      <section className="alt"><div className="lwrap">
        <div className="lsh"><h2>What is included</h2></div>
        <div className="lgrid">{c.features.map(([t, d]) => <div className="lcard" key={t}><h3>{t}</h3><p>{d}</p></div>)}</div>
      </div></section>
      <Screens product={product} />
      {!!c.use_cases?.length && <section className="alt"><div className="lwrap lsplit">
        <div><h2 style={{ fontSize: 30 }}>Who it is for</h2><ul className="lcheck">{c.use_cases.map((u) => <li key={u}>{u}</li>)}</ul></div>
        <div className="lcard"><h3>Shared with every product</h3><ul className="lcheck"><li>Contacts and CRM</li><li>Users, roles and invitations</li><li>Accounting, invoices and receipts</li><li>Documents and notifications</li><li>Reports and exports</li><li>Customer / client portal</li></ul></div>
      </div></section>}
      {!!plans.length && <section><div className="lwrap"><div className="lsh"><h2>Plans</h2><p>Monthly prices. Yearly billing and all details on the pricing page.</p></div>
        <div className="lgrid">{plans.map((p) => <div key={p.id} className={`lcard lplan ${p.highlight ? 'hot' : ''}`}>{p.highlight && <span className="ltag">Recommended</span>}<h3>{p.name}</h3><div className="lprice">{p.price[cur]?.month != null ? fmt(p.price[cur].month, cur) : '—'}<small> / month</small></div><p>{p.description || ''}</p><Link className={`lbtn ${p.highlight ? 'p' : ''}`} to={`/signup?product=${product}`}>Start free trial</Link></div>)}</div>
        <p className="lfine" style={{ textAlign: 'center' }}><Link to={`/pricing?product=${product}`}>Compare plans →</Link></p>
      </div></section>}
      <Band info={info} product={product} />
    </>
  );
}

function Pricing({ info }) {
  const c = info.content;
  useTitle(c.seo.pricing.title, c.seo.pricing.description);
  const loc = useLocation();
  const initial = new URLSearchParams(loc.search).get('product');
  const hasBundle = info.plans.some((p) => p.product === 'bundle');
  const [prod, setProd] = useState(['real_estate', 'construction', 'bundle'].includes(initial) ? initial : 'real_estate');
  const [int, setInt] = useState('month');
  const { country } = useCountry();
  const cur = country.currency;
  const setCur = () => {};
  useEffect(() => { track('pricing_view', { product: prod }); }, [prod]);
  const plans = info.plans.filter((p) => p.product === prod);
  const currencies = [...new Set(info.plans.flatMap((p) => Object.keys(p.price)))].sort((a, b) => (a === 'PKR' ? -1 : b === 'PKR' ? 1 : a.localeCompare(b)));
  const addons = info.addons.filter((a) => a.product === 'any' || a.product === prod || prod === 'bundle');
  const pay = [...(info.cards ? ['Cards'] : []), ...info.local_methods.map((k) => METHOD[k] || k)];
  const saving = (p) => (p.price[cur]?.month && p.price[cur]?.year && p.price[cur].year < p.price[cur].month * 12 ? Math.round((1 - p.price[cur].year / (p.price[cur].month * 12)) * 100) : 0);
  const rows = [
    ['Team members', (p) => (p.seats == null ? 'Unlimited' : p.seats)], ['Projects', (p) => (p.projects == null ? 'Unlimited' : p.projects)],
    ...(prod !== 'construction' ? [['Properties', (p) => (p.properties == null ? 'Unlimited' : Number(p.properties).toLocaleString())]] : []),
    ['File storage', (p) => (p.storage_mb == null ? 'Unlimited' : `${Math.round((p.storage_mb / 1024) * 10) / 10} GB`)], ['Website / partner API', (p) => (p.api_access ? '✓' : '—')],
    ['One-time setup fee', (p) => (p.setup_fee?.[cur] ? fmt(p.setup_fee[cur], cur) : 'None')], ['Free trial', (p) => (p.trial_eligible ? `${info.trial_days} days` : '—')],
  ];
  return (
    <>
      <div className="lwrap lhero" style={{ paddingBottom: 24 }}><h1>Pricing</h1><p>Separate plans for each product. Every eligible new workspace starts with a {info.trial_days}-day free trial{info.one_trial_per_email ? ' (one per owner email)' : ''}. No card needed to start.</p></div>
      <section style={{ paddingTop: 0 }}><div className="lwrap">
        <div className="ltog">
          <div role="tablist" aria-label="Product">{[['real_estate', 'Real Estate'], ['construction', 'Construction'], ...(hasBundle ? [['bundle', 'Both']] : [])].map(([k, l]) => <button key={k} role="tab" aria-selected={prod === k} className={prod === k ? 'on' : ''} onClick={() => setProd(k)}>{l}</button>)}</div>
          <div role="tablist" aria-label="Billing">{['month', 'year'].map((i) => <button key={i} role="tab" aria-selected={int === i} className={int === i ? 'on' : ''} onClick={() => setInt(i)}>{i === 'month' ? 'Monthly' : 'Yearly'}</button>)}</div>
          {false && <div role="tablist" aria-label="Currency">{currencies.map((k) => <button key={k} role="tab" aria-selected={cur === k} className={cur === k ? 'on' : ''} onClick={() => setCur(k)}>{k}</button>)}</div>}
        </div>
        {!plans.length ? <p className="lfine" style={{ textAlign: 'center' }}>Plans for this product are being prepared. <Link to="/contact">Contact us</Link>.</p> : (
          <div className="lgrid">{plans.map((p) => (
            <div key={p.id} className={`lcard lplan ${p.highlight ? 'hot' : ''}`}>
              {p.highlight && <span className="ltag">Recommended</span>}
              <h3>{p.name}</h3>
              <div className="lprice">{p.price[cur]?.[int] != null ? fmt(p.price[cur][int], cur) : '—'}<small> / {int === 'month' ? 'month' : 'year'}</small></div>
              {int === 'year' && saving(p) > 0 && <div className="lmini">Save {saving(p)}% compared with monthly</div>}
              {p.setup_fee?.[cur] ? <div className="lmini">+ {fmt(p.setup_fee[cur], cur)} one-time setup</div> : null}
              {p.description && <p>{p.description}</p>}
              <ul>
                <li>{limitLine(p.seats, 'team member', 'team members')}</li><li>{limitLine(p.projects, 'project', 'projects')}</li>
                {p.product !== 'construction' && <li>{limitLine(p.properties, 'property', 'properties')}</li>}
                {p.api_access && <li>Website / partner API</li>}
                {(p.features || []).map((f) => <li key={f}>{f}</li>)}
              </ul>
              <Link className={`lbtn ${p.highlight ? 'p' : ''}`} to={`/signup?product=${p.product === 'bundle' ? 'real_estate' : p.product}&plan=${p.id}`}>{p.trial_eligible ? 'Start free trial' : 'Get started'}</Link>
            </div>
          ))}</div>
        )}
        {!!plans.length && <div className="lscroll" style={{ marginTop: 30 }}><table className="lcmp"><thead><tr><th>Compare</th>{plans.map((p) => <th key={p.id} className="c">{p.name}</th>)}</tr></thead><tbody>{rows.map(([l, f]) => <tr key={l}><td>{l}</td>{plans.map((p) => <td key={p.id} className="c">{f(p)}</td>)}</tr>)}</tbody></table></div>}
        {!!addons.length && <><h3 style={{ margin: '34px 0 12px', textAlign: 'center' }}>Optional add-ons</h3><div className="lscroll"><table className="lcmp"><thead><tr><th>Add-on</th><th>Adds</th><th className="c">Price</th></tr></thead><tbody>{addons.map((a) => <tr key={a.id}><td><b>{a.name}</b>{a.description ? <div className="lmini">{a.description}</div> : null}</td><td>{Object.entries(a.entitlements).map(([k, v]) => (k === 'api_access' ? 'API access' : `+${v} ${k === 'storage_mb' ? 'MB storage' : k}`)).join(', ')}</td><td className="c">{a.price[cur]?.[int] != null ? `${fmt(a.price[cur][int], cur)} / ${int === 'month' ? 'mo' : 'yr'}` : '—'}</td></tr>)}</tbody></table></div></>}
        <div className="lgrid" style={{ marginTop: 34 }}>
          <div className="lcard"><h3>Trial terms</h3><p>{info.trial_days} days, no card needed. When it ends without a plan, the workspace becomes read-only: you can still sign in and export everything. Nothing is deleted.</p></div>
          <div className="lcard"><h3>Billing</h3><p>Monthly or yearly. Plans renew automatically by card, or by bank/wallet transfer with reminders before each renewal. Cancel any time; access continues to the end of the paid period.</p></div>
          <div className="lcard"><h3>Payment methods</h3><p>{pay.length ? `${pay.join(', ')}.` : 'Contact us to arrange payment.'} Card details are handled by the payment provider and never stored by us.</p></div>
        </div>
        <p className="lfine" style={{ textAlign: 'center' }}>Prices include applicable taxes unless stated otherwise. See the <Link to="/legal/subscription">Subscription Terms</Link> and <Link to="/legal/refunds">Cancellation &amp; Refund Policy</Link>.</p>
      </div></section>
      <Band info={info} product={prod === 'bundle' ? null : prod} />
    </>
  );
}

function Contact({ info }) {
  const c = info.content;
  useTitle(c.seo.contact.title, c.seo.contact.description);
  const loc = useLocation();
  const [f, setF] = useState({ name: '', email: '', phone: '', company: '', product: new URLSearchParams(loc.search).get('product') || '', team_size: '', message: '', website: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { track('demo_form_view'); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const a = attributionFields();
    try { await api.post('/api/platform/demo-request', { ...f, source: a.utm_source || a.referrer || '', landing_page: a.landing_page || '', ...a }); setDone(true); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <section><div className="lwrap">
      <div className="lsh"><h1 style={{ fontSize: 40 }}>Book a demo</h1><p>Tell us about your business and we will show you the parts that matter to you.{c.contact_email ? <> You can also email <a href={`mailto:${c.contact_email}`}>{c.contact_email}</a>.</> : ''}</p></div>
      {done ? <div className="lok" style={{ maxWidth: 560, margin: '0 auto' }}>Thank you. We have your request and will contact you at {f.email}.</div> : (
        <form className="lform" onSubmit={submit} noValidate>
          {err && <div className="lerr" role="alert">{err}</div>}
          <div className="lrow"><label>Your name<input required value={f.name} onChange={set('name')} autoComplete="name" /></label><label>Work email<input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></label></div>
          <div className="lrow"><label>Company<input value={f.company} onChange={set('company')} autoComplete="organization" /></label><label>Phone <span className="lhint">optional</span><input value={f.phone} onChange={set('phone')} autoComplete="tel" /></label></div>
          <div className="lrow"><label>Interested in<select value={f.product} onChange={set('product')}><option value="">Not sure yet</option><option value="real_estate">Real Estate Brokerage</option><option value="construction">Construction Management</option><option value="both">Both</option></select></label>
            <label>Team size<select value={f.team_size} onChange={set('team_size')}><option value="">Choose</option>{['1-5', '6-20', '21-50', '51+'].map((x) => <option key={x}>{x}</option>)}</select></label></div>
          <label>What would you like to see?<textarea rows={4} value={f.message} onChange={set('message')} /></label>
          <label className="lhp" aria-hidden>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
          <button className="lbtn p" disabled={busy}>{busy ? 'Sending…' : 'Request a demo'}</button>
          <p className="lmini" style={{ margin: 0 }}>We use these details only to reply to you. See the <Link to="/legal/privacy">Privacy Policy</Link>.</p>
        </form>
      )}
    </div></section>
  );
}

/** Very small, safe renderer for the legal documents: ## headings, - lists and paragraphs; no HTML is ever injected. */
function Doc({ text }) {
  const blocks = [];
  let list = null;
  for (const line of String(text).split('\n')) {
    if (/^- /.test(line)) { (list ||= []).push(line.slice(2)); continue; }
    if (list) { blocks.push(<ul key={blocks.length}>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>); list = null; }
    if (/^## /.test(line)) blocks.push(<h2 key={blocks.length}>{line.slice(3)}</h2>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{line}</p>);
  }
  if (list) blocks.push(<ul key={blocks.length}>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>);
  return <>{blocks}</>;
}
function Legal({ info, slug }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setD(null); api.get(`/api/platform/legal/${encodeURIComponent(slug)}`).then(setD).catch((e) => setErr(e.message)); }, [slug]);
  useTitle(d ? `${d.title} | ${info.content.brand}` : null, d?.title);
  if (err) return <section><div className="lwrap"><div className="lerr">{err}</div></div></section>;
  if (!d) return <Loading />;
  return (
    <section><div className="lwrap"><article className="ldoc">
      {d.status !== 'published' && <div className="ldraft" role="note">This document is a template that has not been reviewed and published yet. It is shown for transparency and may change.</div>}
      <h1 style={{ fontSize: 32, marginBottom: 6 }}>{d.title}</h1>
      {d.published_at && <p className="lmini">Version {d.version} · published {String(d.published_at).slice(0, 10)}</p>}
      <Doc text={d.body} />
    </article></div></section>
  );
}

/** Does this address open at all (DNS and certificate)? A cross-origin request that fails to connect means no. */
const reachable = (url) => fetch(`${String(url).replace(/\/$/, '')}/health`, { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false);
const WS_KEY = 'agentify_workspace';
const rememberWorkspace = (s) => { try { localStorage.setItem(WS_KEY, s); } catch { /* storage blocked */ } };
const lastWorkspace = () => { try { return localStorage.getItem(WS_KEY) || ''; } catch { return ''; } };
function FindWorkspace({ info }) {
  const last = lastWorkspace();
  const [blocked, setBlocked] = useState('');
  const open = async (s) => {
    const { protocol, port } = window.location;
    const base = `${protocol}//${s}.${info.base_domain}${port ? `:${port}` : ''}`;
    setBlocked('');
    if (!(await reachable(base))) { setBlocked(`${s}.${info.base_domain} cannot be reached right now. Check the spelling of the address. If it is right, the address is still being connected on our side: try again shortly.`); return; }
    rememberWorkspace(s);
    window.location.assign(`${base}/login`);
  };
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  useTitle(`Sign in | ${info.content.brand}`, 'Sign in to your workspace.');
  const go = (e) => {
    e.preventDefault();
    const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!s) return;
    open(s);
  };
  const find = async (e) => { e.preventDefault(); setMsg(''); try { setMsg((await api.post('/api/platform/find-workspace', { email })).message); } catch (x) { setMsg(x.message); } };
  return (
    <section><div className="lwrap">
      <div className="lsh"><h1 style={{ fontSize: 38 }}>Sign in to your workspace</h1><p>Each company has its own address.</p></div>
      {blocked && <div className="lerr" role="alert" style={{ maxWidth: 560, margin: '0 auto 14px' }}>{blocked}</div>}
      {last && <div className="lform" style={{ marginBottom: 18, textAlign: 'center' }}><button type="button" className="lbtn p lg" onClick={() => open(last)}>Continue to {last}.{info.base_domain}</button><div className="lmini">The workspace you used last on this device.</div></div>}
      <form className="lform" onSubmit={go}>
        <label>Workspace address<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="your-company" aria-label="Workspace address" /><span className="lmini">.{info.base_domain}</span></div></label>
        <button className="lbtn p">Continue</button>
      </form>
      <form className="lform" style={{ marginTop: 18 }} onSubmit={find}>
        <label>Forgot your address?<span className="lhint">Enter the owner's email and we will email the workspace address.</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <button className="lbtn">Email me my workspace</button>
        {msg && <div className="lok">{msg}</div>}
      </form>
    </div></section>
  );
}

// ---------------------------------------------------------------- sign-up
const TIMEZONES = [['Asia/Karachi', 'Pakistan (PKT)'], ['Asia/Dubai', 'UAE (GST)'], ['Asia/Riyadh', 'Saudi Arabia (AST)'], ['Asia/Kolkata', 'India (IST)'], ['Asia/Dhaka', 'Bangladesh (BST)'], ['Europe/London', 'United Kingdom'], ['America/New_York', 'US Eastern'], ['UTC', 'UTC']];
const CURRENCIES = ['PKR', 'AED', 'SAR', 'INR', 'BDT', 'GBP', 'USD', 'EUR'];
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

function Signup({ info }) {
  const { country, countries, setCountry } = useCountry();
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  const [product, setProduct] = useState(['real_estate', 'construction'].includes(q.get('product')) ? q.get('product') : '');
  const [f, setF] = useState({ company_name: '', slug: '', admin_name: '', admin_email: q.get('email') || '', admin_password: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Karachi', currency: 'PKR', accept_terms: false });
  const [slugTouched, setSlugTouched] = useState(false);
  const [avail, setAvail] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  // "Continue with Google": the server sends the visitor back here with a signed token holding the name and email Google verified
  const gToken = q.get('google') || '';
  const [gWho, setGWho] = useState(null);
  const GOOGLE_ERR = { cancelled: 'Google sign-in was cancelled.', email_not_verified: 'Google did not confirm that email address, so it cannot be used.', unsupported: 'That sign-in method is not available.' };
  const [gErr, setGErr] = useState(q.get('google_error') ? (GOOGLE_ERR[q.get('google_error')] || 'Google sign-in did not complete. Please try again.') : '');
  useEffect(() => {
    if (!gToken) return;
    api.get('/api/platform/google-identity', { token: gToken }).then((d) => { setGWho(d); setF((s) => ({ ...s, admin_email: d.email, admin_name: s.admin_name || d.name || '' })); }).catch((e) => setGErr(e.message));
  }, [gToken]);
  useTitle(`Start your free trial | ${info.content.brand}`, `Create your ${info.content.brand} workspace with a ${info.trial_days}-day free trial.`);
  useEffect(() => { track('signup_started', { product: product || undefined }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!f.slug) { setAvail(null); return undefined; }
    const t = setTimeout(async () => { try { setAvail(await api.get(`/api/platform/slug-available/${encodeURIComponent(f.slug)}`)); } catch { setAvail(null); } }, 350);
    return () => clearTimeout(t);
  }, [f.slug]);
  const tzs = useMemo(() => (TIMEZONES.some(([v]) => v === f.timezone) ? TIMEZONES : [[f.timezone, f.timezone], ...TIMEZONES]), [f.timezone]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!product) { setErr('Choose a product first'); return; }
    if (!f.accept_terms) { setErr('Please accept the Terms of Service and Privacy Policy'); return; }
    setBusy(true);
    try { setDone(await api.post('/api/platform/signup', { ...f, google_token: gWho ? gToken : undefined, region: country.code, currency: country.currency, timezone: (country.timezones || []).includes(f.timezone) ? f.timezone : (country.timezones || [f.timezone])[0], language: f.language || null, sample_data: !!f.sample_data, product, analytics: attributionFields() })); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  // straight into the new workspace, already signed in (the one-time code lasts two minutes, so do it now)
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);
  // only go there if the workspace address actually opens; otherwise say so instead of showing a browser error page
  const enter = async () => {
    if (!done) return;
    setChecking(true); setUnreachable(false);
    const ok = await reachable(done.login_url);
    setChecking(false);
    if (ok) window.location.replace(done.enter_url || `${done.login_url}/login`);
    else setUnreachable(true);
  };
  useEffect(() => {
    if (!done) return;
    if (done.tenant?.slug) rememberWorkspace(done.tenant.slug);
    if (!done.enter_url) return;
    enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  if (done) {
    const t = done.tenant;
    return (
      <section><div className="lwrap"><div className="lform" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 30 }}>Your workspace is ready</h1>
        <p><b>{t.name}</b> · {PRODUCT_LABELS[t.product]}</p>
        {t.trial_ends_at ? <p>Your free trial runs until <b>{new Date(t.trial_ends_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</b> (your local time).</p>
          : <p>{t.trial_note ? `${t.trial_note}. ` : ''}Choose a plan in Settings › Plan &amp; Billing to start working.</p>}
        <p className="lmini">We emailed {t.owner_email} a link to confirm the address.</p>
        {unreachable && <div className="lerr" role="alert" style={{ textAlign: 'left', margin: '12px 0' }}>Your workspace was created at <b>{done.login_url.replace(/^https?:\/\//, '')}</b>, but that address cannot be reached yet. This is a setup step on our side (the website address for workspaces is still being connected). Your data is safe. Please try the button below again in a little while, or contact us.</div>}
        <button type="button" className="lbtn p" onClick={enter} disabled={checking}>{checking ? 'Checking the address…' : unreachable ? 'Check again' : 'Open your workspace'}</button>
      </div></div></section>
    );
  }
  return (
    <section><div className="lwrap">
      <div className="lsh"><h1 style={{ fontSize: 40 }}>Start your free trial</h1><p>{info.trial_days} days free, no card needed{info.one_trial_per_email ? ', one trial per owner email' : ''}. Your company gets its own private workspace.</p></div>
      <form className="lform" onSubmit={submit} style={{ maxWidth: 640 }}>
        {err && <div className="lerr" role="alert">{err}</div>}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontWeight: 700, marginBottom: 8 }}>1. What do you need?</legend>
          <div className="lchoose">
            <button type="button" className={product === 'real_estate' ? 'on' : ''} aria-pressed={product === 'real_estate'} onClick={() => setProduct('real_estate')}><b>Real Estate Brokerage</b><span>Leads, inventory, sales, installments, commissions, receipts, customer portal.</span></button>
            <button type="button" className={product === 'construction' ? 'on' : ''} aria-pressed={product === 'construction'} onClick={() => setProduct('construction')}><b>Construction Management</b><span>Projects, BOQs, budgets, procurement, materials, labour, progress, client billing.</span></button>
          </div>
        </fieldset>
        <div style={{ fontWeight: 700 }}>2. Your company and account</div>
        {gErr && <div className="lerr" role="alert">{gErr}</div>}
        {info.google_signup && !gWho && (
          <>
            <a className="lbtn" href={`/api/platform/oauth/google/signup?${new URLSearchParams({ product: product || '', country: country.code })}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#fff', color: '#1f2937', border: '1px solid #d0d5dd' }}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.5 5.8c4.4-4.1 7-10.1 7-17.5z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
              Continue with Google
            </a>
            <div className="lmini" style={{ textAlign: 'center' }}>or fill in the form below</div>
          </>
        )}
        {gWho && <div className="lok" role="status" style={{ background: '#e6f5ea', color: '#166534', padding: '10px 14px', borderRadius: 10 }}>Signed in with Google as <b>{gWho.email}</b>. No password needed: you will sign in with Google.</div>}
        <label>Company name<input required value={f.company_name} onChange={(e) => { const v = e.target.value; setF((s) => ({ ...s, company_name: v, slug: slugTouched ? s.slug : slugify(v) })); }} autoComplete="organization" /></label>
        <label>Workspace address<span className="lhint">{avail ? (avail.available ? `Available: ${f.slug}.${info.base_domain}` : avail.reason) : 'Letters, digits and hyphens'}</span>
          <input required value={f.slug} onChange={(e) => { setSlugTouched(true); setF((s) => ({ ...s, slug: slugify(e.target.value) })); }} placeholder="your-company" aria-invalid={avail && !avail.available} /></label>
        <div className="lrow"><label>Your name<input required value={f.admin_name} onChange={set('admin_name')} autoComplete="name" /></label><label>Work email<input type="email" required value={f.admin_email} onChange={set('admin_email')} autoComplete="email" readOnly={!!gWho} /></label></div>
        {!gWho && <label>Password<span className="lhint">At least 8 characters</span><input type="password" minLength={8} required value={f.admin_password} onChange={set('admin_password')} autoComplete="new-password" /></label>}
        <div style={{ fontWeight: 700 }}>3. Your country</div>
        <div className="lrow">
          <label>Country<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Flag code={country.code} height={20} /><select style={{ flex: 1 }} value={country.code} onChange={(e) => setCountry(e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code} disabled={!c.open}>{c.name}{c.open ? '' : ' (opening soon)'}</option>)}</select></span></label>
          {country.sub_regions?.length > 0 && <label>{country.sub_region_label || 'State'}<select required value={f.sub_region || ''} onChange={set('sub_region')}><option value="">Choose…</option>{country.sub_regions.map((x) => <option key={x}>{x}</option>)}</select></label>}
        </div>
        {country.timezones?.length > 1 && <label>Time zone<select value={country.timezones.includes(f.timezone) ? f.timezone : country.timezones[0]} onChange={set('timezone')}>{country.timezones.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}</select></label>}
        {country.languages?.length > 1 && <label>Language<select value={f.language || country.languages[0]} onChange={set('language')}>{country.languages.map((x) => <option key={x} value={x}>{{ en: 'English', fr: 'Français', ar: 'العربية' }[x] || x}</option>)}</select></label>}
        <div className="lhint" aria-live="polite">Set from your country: {[country.currency, country.config?.date_style, country.config?.area?.labels?.[country.config?.area?.default], country.config?.timezone].filter(Boolean).join(' · ')}</div>
        {country.code !== 'PK' && <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}><input type="checkbox" checked={!!f.sample_data} onChange={set('sample_data')} style={{ width: 'auto', marginTop: 4 }} /><span>Add sample listings, clients and sales for {country.name} so I can explore (marked as demo data).</span></label>}
        {!country.open && <div className="lerr" role="status">Signups for {country.name} are not open yet. <Link to={`/contact?country=${country.code.toLowerCase()}`}>Join the waiting list</Link> and we will email you when they open.</div>}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}><input type="checkbox" checked={f.accept_terms} onChange={set('accept_terms')} style={{ width: 'auto', marginTop: 4 }} />
          <span>I agree to the <Link to="/legal/terms" target="_blank">Terms of Service</Link>, <Link to="/legal/subscription" target="_blank">Subscription Terms</Link> and <Link to="/legal/privacy" target="_blank">Privacy Policy</Link>.</span></label>
        <button className="lbtn p" disabled={busy || !country.open || (avail && !avail.available)}>{busy ? 'Creating your workspace…' : 'Create workspace'}</button>
        <p className="lmini" style={{ margin: 0, textAlign: 'center' }}>Already have one? <Link to="/login">Sign in</Link></p>
      </form>
    </div></section>
  );
}

// ---------------------------------------------------------------- shell
/** The page for a path. (The site is mounted from several top-level routes, so it picks its page itself.) */
function page(path, info) {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/' || PATH_COUNTRY[p.slice(1)]) return <Home info={info} />;
  if (p === '/real-estate') return <ProductPage info={info} product="real_estate" />;
  if (p === '/construction') return <ProductPage info={info} product="construction" />;
  if (p === '/pricing') return <Pricing info={info} />;
  if (p === '/contact') return <Contact info={info} />;
  if (p === '/signup') return <Signup info={info} />;
  if (p === '/login') return <FindWorkspace info={info} />;
  const legal = p.match(/^\/legal\/([a-z-]+)$/);
  if (legal) return <Legal key={legal[1]} info={info} slug={legal[1]} />;
  return <Navigate to="/" replace />;
}

export default function MarketingSite() {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [banner, setBanner] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { api.get('/api/platform/marketing').then((d) => { setInfo(d); configureGa4(d.ga4_id); }).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (!browserOptOut() && !consent()) setBanner(true); return onConsentChange(() => {}); }, []);
  useEffect(() => { window.scrollTo(0, 0); track('page_view'); }, [loc.pathname]);
  if (err) return <div className="lp"><div className="lwrap" style={{ padding: 40 }}><div className="lerr">{err}</div><button className="lbtn" onClick={() => nav(0)}>Try again</button></div></div>;
  if (!info) return <Loading />;
  // The glow-dark interactive home page ('/', also kept at /preview). It brings its own header and footer.
  if (loc.pathname === '/' || loc.pathname === '/preview') {
    return (
      <CountryProvider info={info}>
        <Glow info={info} />
        <div className="lp" style={{ minHeight: 0, background: "none" }}><ConsentBanner show={banner && !browserOptOut()} onClose={() => setBanner(false)} /></div>
      </CountryProvider>
    );
  }
  return (
    <CountryProvider info={info}>
    <div className="lp">
      <a href="#main" className="lhp">Skip to content</a>
      <Header info={info} />
      <main id="main">
        {page(loc.pathname, info)}
      </main>
      <Footer info={info} onCookies={() => setBanner(true)} />
      <ConsentBanner show={banner && !browserOptOut()} onClose={() => setBanner(false)} />
    </div>
    </CountryProvider>
  );
}
