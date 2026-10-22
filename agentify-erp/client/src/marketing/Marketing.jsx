// Public website on the main domain: home, the two product pages, pricing, contact/demo, legal documents, sign-up and
// "find my workspace". Texts, plans, prices, trial terms and legal documents come from /api/platform/marketing and are
// edited by platform staff in the console. Nothing here invents customers, counts, testimonials or integrations.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { Loading } from '../components/ui.jsx';
import Flag from '../components/Flag.jsx';
import { CountryProvider, CountrySwitch, useCountry, useTitle, PATH_COUNTRY } from './core.jsx';
import { track, consent, setConsent, browserOptOut, configureGa4, attributionFields, onConsentChange } from './analytics.js';
import { setRegion } from '../format.js';
import { MortgageCalculator, PurchaseCostCalculator, UnitConverter } from '../site/RegionCalculators.jsx';
import '../site/site.css';
import '../pages/landing.css';
import './marketing.css';
// after the shared styles, so the home page's tokens win
import Home from './home/Home.jsx';

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
  return <figure className="lshot" style={{ margin: 0 }}><img src={`/marketing/${file}`} alt={caption} width="2200" height="1480" loading="lazy" decoding="async" onError={() => setOk(false)} /><figcaption>{caption}. Screenshot of a demo workspace with sample data.</figcaption></figure>;
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

const NAV = [['/#tour', 'CRM'], ['/#pipeline', 'Pipeline'], ['/#properties', 'Property management'], ['/#mobile', 'Mobile app'], ['/#pricing', 'Pricing'], ['/#faq', 'FAQ']];
function Header({ info }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  const menuBtn = useRef(null), drawer = useRef(null);
  useEffect(() => setOpen(false), [loc.pathname, loc.hash]);
  useEffect(() => { const h = () => setScrolled(window.scrollY > 4); h(); window.addEventListener('scroll', h, { passive: true }); return () => window.removeEventListener('scroll', h); }, []);
  useEffect(() => {
    if (!open) return undefined;
    drawer.current?.querySelector('a')?.focus();
    const k = (e) => { if (e.key === 'Escape') { setOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open]);
  const brand = info.content.brand;
  return (
    <>
      {info.content.announcement_bar && <div className="lbar">{info.content.announcement_bar}</div>}
      <header className={scrolled ? 'scrolled' : ''}><div className="lwrap">
        <Link className="llogo" to="/" aria-label={`${brand} home`}><i aria-hidden>⌂</i>{brand}</Link>
        <nav aria-label="Main">
          {NAV.map(([to, l]) => <Link key={to} className="hide-m" to={to}>{l}</Link>)}
          <NavLink className="hide-m" to="/login">Sign in</NavLink>
          <span className="hide-m"><CountrySwitch id="country-menu" /></span>
          <Link className="lbtn p sm" to="/signup" onClick={() => track('cta_start_trial', { where: 'header' })}>Start free</Link>
          <button ref={menuBtn} type="button" className="lmenu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="main-drawer" onClick={() => setOpen(!open)}>{open ? '✕' : '☰'}</button>
        </nav>
      </div></header>
      <div id="main-drawer" ref={drawer} className={`ldrawer ${open ? 'open' : ''}`} hidden={!open}>
        {[...NAV, ['/login', 'Sign in']].map(([to, l]) => <Link key={to} to={to}>{l}</Link>)}
        <div className="ldrawer-c"><CountrySwitch id="country-menu-m" /></div>
      </div>
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
// Screenshots come from a demo workspace in each country, so a visitor never sees another country's currency.
// current screens of each country's demo workspace (sample data), with the older Pakistan PNGs as the fallback
const COUNTRY_SCREENS = (code) => ({
  real_estate: [[`m-re-dash-${code}.webp`, 'Dashboard with collections, new leads and follow-ups'], [`m-re-sale-${code}.webp`, 'A sale with its payment schedule']],
  construction: [[`m-con-project-${code}.webp`, 'Construction project: budget, committed and actual cost, and progress'], [`m-con-boq-${code}.webp`, 'Bill of quantities with measured progress']],
});
function Screens({ product }) {
  const { country } = useCountry();
  const set = COUNTRY_SCREENS(country.code.toLowerCase());
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
      {product === 'real_estate' && <CalcStrip />}
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
    try { setDone(await api.post('/api/platform/signup', { ...f, region: country.code, currency: country.currency, timezone: (country.timezones || []).includes(f.timezone) ? f.timezone : (country.timezones || [f.timezone])[0], language: f.language || null, sample_data: !!f.sample_data, product, analytics: attributionFields() })); } catch (x) { setErr(x.message); } finally { setBusy(false); }
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
        <label>Company name<input required value={f.company_name} onChange={(e) => { const v = e.target.value; setF((s) => ({ ...s, company_name: v, slug: slugTouched ? s.slug : slugify(v) })); }} autoComplete="organization" /></label>
        <label>Workspace address<span className="lhint">{avail ? (avail.available ? `Available: ${f.slug}.${info.base_domain}` : avail.reason) : 'Letters, digits and hyphens'}</span>
          <input required value={f.slug} onChange={(e) => { setSlugTouched(true); setF((s) => ({ ...s, slug: slugify(e.target.value) })); }} placeholder="your-company" aria-invalid={avail && !avail.available} /></label>
        <div className="lrow"><label>Your name<input required value={f.admin_name} onChange={set('admin_name')} autoComplete="name" /></label><label>Work email<input type="email" required value={f.admin_email} onChange={set('admin_email')} autoComplete="email" /></label></div>
        <label>Password<span className="lhint">At least 8 characters</span><input type="password" minLength={8} required value={f.admin_password} onChange={set('admin_password')} autoComplete="new-password" /></label>
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
