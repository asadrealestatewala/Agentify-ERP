// The remaining sections of the home page. Copy here only describes what the product does today; where something is
// partial or depends on the customer's own accounts, the text says so.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCountry } from '../core.jsx';
import { track } from '../analytics.js';
import { BRANDS } from '../brandIcons.js';
import { PhoneCRM } from './Tour.jsx';
import { APPROVED_LOGOS, STORE_LINKS } from './config.js';

// ---------------------------------------------------------------- logos (approved only) or a neutral capability line
export function LogoMarquee() {
  if (!APPROVED_LOGOS.length) {
    return (
      <section className="h-caps" aria-label="What the CRM covers">
        <div className="h-wrap"><p><b>Built for real estate teams.</b> Enquiries · Contacts · Follow-ups · Pipeline · Properties · Sales · Customer portal</p></div>
      </section>
    );
  }
  const row = APPROVED_LOGOS.map((l) => <li key={l.name}><img src={l.src} alt={l.name} width={l.width || 120} height={l.height || 32} loading="lazy" /></li>);
  return (
    <section className="h-logos" aria-label="Companies using Agentify ERP">
      <div className="h-wrap"><p className="h-logos-t">Used by real estate teams such as</p>
        <div className="h-marquee" tabIndex={0} aria-label="Customer logos. Hover or focus to pause.">
          <ul className="h-mq-track">{row}</ul>
          <ul className="h-mq-track" aria-hidden="true">{APPROVED_LOGOS.map((l) => <li key={`d-${l.name}`}><img src={l.src} alt="" width={l.width || 120} height={l.height || 32} loading="lazy" /></li>)}</ul>
        </div></div>
    </section>
  );
}

// ---------------------------------------------------------------- the workflow, step by step
const STEPS = [
  ['Capture the enquiry', 'Website enquiries become leads on their own. Add calls and walk-ins by hand, or import a spreadsheet.'],
  ['Assign an agent', 'A website enquiry goes to the listing’s agent, or to the next agent in turn. Reassign at any time.'],
  ['Record what they want', 'Budget, preferred area and property type on the profile, plus your own fields such as a buying timeline.'],
  ['Follow up on time', 'Set the next follow-up and get reminded in the app; done follow-ups are recorded on the lead.'],
  ['Show the right property', 'Link the lead to a listing and book the viewing; appointments can go to Google Calendar.'],
  ['Move the deal forward', 'Drag the lead through your stages so everyone sees where it stands.'],
  ['Turn it into a sale', 'Reserve the property and start the sale, with its payment schedule, receipts and commission.'],
];
export function Workflow() {
  return (
    <section className="h-sec h-flow" aria-labelledby="flow-h">
      <div className="h-wrap">
        <h2 id="flow-h" className="h-h2">From first enquiry to signed sale</h2>
        <p className="h-lead">The same seven steps your team already follows, kept in one place.</p>
        <ol className="h-steps">{STEPS.map(([t, d], i) => <li key={t}><span className="h-step-n" aria-hidden="true">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>)}</ol>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- features: CRM first, then the ERP behind it
const CRM_FEATURES = [
  ['Lead capture and sources', 'Website form, manual entry and spreadsheet import, with the source kept on every lead.'],
  ['Assignment and ownership', 'Automatic assignment for website enquiries; agents can be limited to their own leads.'],
  ['Client profiles and history', 'Contact details, preferences, notes and a timeline of every call, message and change.'],
  ['Pipeline by stage', 'Your own stages, drag and drop, and totals per stage.'],
  ['Follow-ups and tasks', 'Due dates, in-app reminders and push notifications on the installed app.'],
  ['Leads linked to properties', 'Each enquiry keeps the listing it came from; agents can link another one.'],
  ['Goals and team view', 'Daily and monthly goals, rewards and per-agent figures.'],
  ['Customer portal', 'Buyers see their property, payment schedule, receipts and documents.'],
  ['Roles and data separation', 'Role-based permissions, two-factor sign-in, an audit trail and a separate database per company.'],
];
const ERP_FEATURES = [
  ['Property and project inventory', 'Units, plots and listings with status, approvals and a plot map; listings feed your website.'],
  ['Sales and payment plans', 'Bookings, instalment and balloon schedules, and reservations.'],
  ['Receipts, commissions and statements', 'Receipts allocated to instalments, commission rules and payouts, customer statements.'],
  ['Accounting and reports', 'Double-entry accounts, vouchers and financial reports in your currency.'],
  ['Construction projects', 'For developers who also build: BOQs, budgets, purchase orders and progress.'],
];
export function Features() {
  return (
    <section className="h-sec h-feat" aria-labelledby="feat-h">
      <div className="h-wrap">
        <h2 id="feat-h" className="h-h2">Everything the CRM does for a brokerage</h2>
        <ul className="h-fgrid">{CRM_FEATURES.map(([t, d]) => <li key={t}><h3>{t}</h3><p>{d}</p></li>)}</ul>
        <div className="h-erp" id="properties">
          <div>
            <h2 className="h-h3">Property management and the ERP behind the CRM</h2>
            <p className="h-lead">When a lead becomes a buyer, the rest of the work happens in the same workspace.</p>
            <p className="h-links"><Link to="/real-estate">Real estate brokerage in detail</Link><Link to="/construction">Construction management</Link></p>
          </div>
          <ul className="h-elist">{ERP_FEATURES.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ul>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- integrations, stated precisely
const INTEGRATIONS = [
  ['googlecalendar', 'Google Calendar', 'Appointments and viewings', 'Connect your Google account'],
  ['twilio', 'Twilio', 'Calls from the dialer and text messages', 'Your own Twilio account'],
  ['whatsapp', 'WhatsApp', 'Open a ready message in your own WhatsApp', 'Links only, no automatic sending'],
  ['facebook', 'Facebook, Instagram, LinkedIn, TikTok', 'Publish and schedule posts', 'Your pages; the networks must approve the app'],
  ['openai', 'Claude, ChatGPT, Gemini', 'Ask about your numbers, write listing video scripts', 'Your own API key'],
  ['google', 'Google and Apple sign-in', 'Sign in without a password', 'Set up by the platform'],
];
export function Integrations() {
  const icon = (id) => BRANDS.find((b) => b.id === id);
  return (
    <section className="h-sec h-int-sec" aria-labelledby="int-h">
      <div className="h-wrap">
        <h2 id="int-h" className="h-h3">Works with tools you already use</h2>
        <ul className="h-ints">{INTEGRATIONS.map(([id, name, what, how]) => { const b = icon(id); return (
          <li key={name}>{b && <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d={b.path} fill="currentColor" /></svg>}<span><b>{name}</b><small>{what}</small></span><em>{how}</em></li>); })}</ul>
        <p className="h-fine">Logos are trademarks of their owners and show compatibility only, not partnership or endorsement.</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- mobile
const validStore = (url, host) => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === host ? u.toString() : null; } catch { return null; } };
export function MobileShowcase() {
  const { country } = useCountry();
  const android = validStore(STORE_LINKS.android, 'play.google.com');
  const ios = validStore(STORE_LINKS.ios, 'apps.apple.com');
  return (
    <section className="h-sec h-mobile" id="mobile" aria-labelledby="mob-h">
      <div className="h-wrap h-mobile-g">
        <div className="h-mobile-phone"><PhoneCRM currency={country.currency} /><p className="h-fine">Sample data. Try the tabs.</p></div>
        <div>
          <h2 id="mob-h" className="h-h2">The CRM in your pocket</h2>
          <p className="h-lead">Between viewings, check new leads, open a client, see what they are looking for and complete the follow-up.</p>
          <ul className="h-ticks">
            <li>New leads and follow-ups due today, with bottom tabs for quick moves</li>
            <li>Client profile with budget, area and property type</li>
            <li>Tick off a follow-up and set the next one</li>
            <li>Push reminders for your daily goals once installed</li>
          </ul>
          <div className="h-install">
            <h3>Install it today, from the browser</h3>
            <p>Open your workspace on your phone and sign in, then: on Android in Chrome, choose <b>Install app</b>; on iPhone in Safari, tap <b>Share</b> and <b>Add to Home Screen</b>. Signed-in users also find this under <b>My Space › Install the app</b>.</p>
            <p className="h-links"><Link to="/login">Find your workspace</Link></p>
            {(android || ios) ? (
              <p className="h-stores">{android && <a className="h-btn" href={android} target="_blank" rel="noreferrer">Get it on Google Play</a>}{ios && <a className="h-btn" href={ios} target="_blank" rel="noreferrer">Download on the App Store</a>}</p>
            ) : <p className="h-fine">Native store versions for Google Play and the App Store are not published yet.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- customer stories (real, approved quotes only)
const flagOf = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...(cc === 'UK' ? 'GB' : cc)].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
export function CustomerStories({ testimonials, trialDays }) {
  const { countries } = useCountry();
  const [i, setI] = useState(0);
  if (!testimonials.length) {
    return (
      <section className="h-sec h-stories" aria-labelledby="st-h">
        <div className="h-wrap">
          <div className="h-found">
            <div><h2 id="st-h" className="h-h3">Be one of the first brokerages on it</h2>
              <p>We are onboarding our first customers personally: the full {trialDays}-day trial, help moving your contacts and listings across, and a direct line to the people who build it. With your permission, your story could appear here.</p>
              <p className="h-fine">This page only ever shows real customer quotes that the customer approved.</p></div>
            <div className="h-found-c"><Link className="h-btn primary" to="/contact" onClick={() => track('cta_founding_customer', { where: 'stories' })}>Talk to us about onboarding</Link><Link className="h-btn" to="/signup" onClick={() => track('cta_start_trial', { where: 'stories' })}>Start free</Link></div>
          </div>
          {import.meta.env.DEV && <p className="h-dev">Development only: customer stories appear here once added in the console (Content › Testimonials) with the person’s name, role, company, optional country and their permission.</p>}
        </div>
      </section>
    );
  }
  const t = testimonials[i % testimonials.length];
  const cn = countries.find((c) => c.code === t.country)?.name;
  return (
    <section className="h-sec h-stories" aria-labelledby="st-h" aria-roledescription="carousel">
      <div className="h-wrap">
        <h2 id="st-h" className="h-h2">What brokerages say</h2>
        <figure className="h-quote" aria-live="polite" aria-roledescription="slide" aria-label={`${(i % testimonials.length) + 1} of ${testimonials.length}`}>
          <blockquote>“{t.quote}”</blockquote>
          <figcaption><span className="h-av" aria-hidden="true">{t.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span><span><b>{t.name}</b>{t.role ? `, ${t.role}` : ''}<small>{t.company}{cn ? ` · ${flagOf(t.country)} ${cn}` : ''}</small></span></figcaption>
        </figure>
        {testimonials.length > 1 && <div className="h-qnav"><button type="button" className="h-btn" onClick={() => setI(i - 1 + testimonials.length)} aria-label="Previous story">←</button><button type="button" className="h-btn" onClick={() => setI(i + 1)} aria-label="Next story">→</button></div>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- pricing (from the plan configuration)
const fmt = (amount, cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(amount);
const limit = (v, one, many) => (v == null ? `Unlimited ${many}` : `Up to ${Number(v).toLocaleString('en')} ${v === 1 ? one : many}`);
export function PricingPreview({ info }) {
  const { country } = useCountry();
  const [int, setInt] = useState('month');
  const plans = (info.plans || []).filter((p) => p.product === 'real_estate');
  const cur = plans.some((p) => p.price?.[country.currency]) ? country.currency : 'USD';
  if (!plans.length) return null;
  return (
    <section className="h-sec h-pricing" id="pricing" aria-labelledby="pr-h">
      <div className="h-wrap">
        <h2 id="pr-h" className="h-h2">Pricing for real estate teams</h2>
        <p className="h-lead">Every eligible new workspace starts with a {info.trial_days}-day free trial, no card needed{info.one_trial_per_email ? ', one trial per e-mail address' : ''}. Prices in {cur}{cur !== country.currency ? ` (${country.name} prices are not set yet)` : ''}.</p>
        <div className="h-seg" role="group" aria-label="Billing period">{[['month', 'Monthly'], ['year', 'Yearly']].map(([k, l]) => <button key={k} type="button" aria-pressed={int === k} className={int === k ? 'on' : ''} onClick={() => setInt(k)}>{l}</button>)}</div>
        <ul className="h-plans">{plans.map((p) => {
          const price = p.price?.[cur]?.[int];
          return (
            <li key={p.id} className={p.highlight ? 'hot' : ''}>
              <h3>{p.name}</h3>
              <p className="h-price">{price != null ? fmt(price, cur) : 'Contact us'}{price != null && <small> / {int === 'month' ? 'month' : 'year'}</small>}</p>
              {p.setup_fee?.[cur] ? <p className="h-fine">+ {fmt(p.setup_fee[cur], cur)} one-time setup</p> : null}
              <ul className="h-ticks sm">
                <li>{limit(p.seats, 'team member', 'team members')}</li>
                <li>{limit(p.properties, 'property', 'properties')}</li>
                <li>{p.storage_mb == null ? 'Unlimited file storage' : `${Math.round((p.storage_mb / 1024) * 10) / 10} GB file storage`}</li>
                {p.api_access && <li>Website and partner API</li>}
                {(p.features || []).map((f) => <li key={f}>{f}</li>)}
              </ul>
              <Link className={`h-btn ${p.highlight ? 'primary' : ''}`} to={`/signup?product=real_estate&plan=${p.id}`} onClick={() => track('cta_start_trial', { where: `plan_${p.id}` })}>{p.trial_eligible ? 'Start free trial' : 'Get started'}</Link>
            </li>);
        })}</ul>
        <p className="h-links"><Link to="/pricing">Full comparison, add-ons and construction plans</Link></p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- FAQ (answers only from how the product works today)
const CRM_FAQ = [
  ['How do website enquiries reach the CRM?', 'An enquiry from your website becomes a lead with its source. If it came from a listing, it goes to that listing’s agent; otherwise to the next agent in turn. Existing contacts are matched by phone or e-mail, so you do not get duplicates.'],
  ['Can agents see only their own leads?', 'Yes. Each role has its own permissions, and a role can be limited to the leads assigned to that person. Managers can see the whole team.'],
  ['Can we bring our existing contacts?', 'Yes. Import contacts from a spreadsheet, or add them by hand. We help founding customers move their data across.'],
  ['Can we change the pipeline stages?', 'Yes. Stage names, colours and lead sources are settings in your workspace.'],
  ['Is there a mobile app?', 'The CRM installs on Android and iPhone from the browser and works with bottom tabs and push reminders. Native versions in Google Play and the App Store are not published yet.'],
  ['Does it send WhatsApp messages?', 'It opens a ready message in your own WhatsApp; it does not send WhatsApp messages automatically. Text messages and calls go through your own Twilio account when you connect it.'],
  ['What about property management and sales?', 'Listings, projects, reservations, payment schedules, receipts, commissions and a customer portal are part of the same workspace.'],
];
export function FAQ({ faqs }) {
  const key = (q) => q.toLowerCase().replace(/[^a-z]/g, '');
  const all = [...CRM_FAQ, ...faqs.filter(([q]) => !CRM_FAQ.some(([x]) => key(x) === key(q)))];
  return (
    <section className="h-sec h-faq" id="faq" aria-labelledby="faq-h">
      <div className="h-wrap">
        <h2 id="faq-h" className="h-h2">Questions</h2>
        <div className="h-faq-l">{all.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
        <p className="h-links"><Link to="/contact">Ask us something else</Link></p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- final call to action
export function FinalCTA({ trialDays }) {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const go = (e) => {
    e.preventDefault();
    const v = email.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setErr('Enter a valid e-mail address, or leave it empty.'); return; }
    track('cta_start_trial', { where: 'final' });
    nav(`/signup${v ? `?email=${encodeURIComponent(v)}` : ''}`);
  };
  return (
    <section className="h-final" aria-labelledby="fin-h">
      <div className="h-wrap h-final-g">
        <div><h2 id="fin-h">Put every lead and follow-up in one place</h2><p>Free for {trialDays} days, no card needed. If you stop, your data becomes read-only and is never deleted.</p></div>
        <form className="h-final-f" onSubmit={go} noValidate>
          <label htmlFor="fin-email">Work e-mail</label>
          <div><input id="fin-email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(''); }} aria-invalid={!!err} aria-describedby={err ? 'fin-err' : undefined} placeholder="you@yourbrokerage.com" /><button className="h-btn primary" type="submit">Start free</button></div>
          {err && <p id="fin-err" className="h-err" role="alert">{err}</p>}
          <p className="h-fine"><Link to="/contact" onClick={() => track('cta_book_demo', { where: 'final' })}>Prefer a walkthrough? Book a demo</Link></p>
        </form>
      </div>
    </section>
  );
}
