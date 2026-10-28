// Product tour: each tab shows a real screen of the running Agentify ERP (captured from its demo workspaces, one set per
// country), next to what the screen does and whether it is fully in the product today.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCountry } from '../countryCtx.js';
import { track } from '../analytics.js';
import { Screen, PhoneShot } from './RealShots.jsx';

const TABS = [
  { key: 'inbox', shot: 'inbox', label: 'Lead inbox', title: 'Every new enquiry, with its source and next step',
    desc: 'Enquiries from your website form arrive as leads automatically. Add the rest by hand or import a spreadsheet.',
    benefits: ['Website enquiries are assigned to the listing’s agent, or to the next agent in turn', 'Filter by stage, source or agent; agents can be limited to their own leads', 'Each lead shows its priority and next follow-up'],
    status: 'live' },
  { key: 'c360', shot: 'c360', label: 'Customer 360', title: 'One profile for everything you know about a client',
    desc: 'Contact details, what they are looking for, every call and note, and the deals they are part of.',
    benefits: ['Budget, preferred area and property type on the profile', 'A timeline of calls, messages, stage changes and assignments', 'Linked properties and sales in the same place'],
    status: 'live', note: 'Add your own fields, such as a buying timeline, in Settings.' },
  { key: 'pipeline', shot: 'pipeline', label: 'Sales pipeline', title: 'See where every opportunity stands',
    desc: 'Leads sit in stages. Drag a card to the next stage, or use the arrow on a card with the keyboard.',
    benefits: ['Drag and drop between stages, as in the product', 'Totals per stage update as deals move', 'Stage names and colours are yours to change'],
    status: 'live', note: 'These are the default stage names of a new workspace.' },
  { key: 'tasks', shot: 'tasks', label: 'Follow-ups & tasks', title: 'Know what is overdue, due today and next',
    desc: 'Follow-up dates and tasks, with reminders inside the app, so nothing waits on someone’s memory.',
    benefits: ['Overdue, today and upcoming in one list', 'Filter by agent; managers see the whole team', 'Completing a follow-up records it on the lead'],
    status: 'live' },
  { key: 'properties', shot: 'props', label: 'Properties & interests', title: 'Connect enquiries to the listings they asked about',
    desc: 'Listings with price, size and status, and the leads interested in each one.',
    benefits: ['Price, bedrooms, bathrooms, size and status on every listing', 'Enquiries from a listing page are linked to that listing', 'Reserve a property for a lead and start the sale'],
    status: 'partial', note: 'A lead is linked to the property it enquired about or that an agent chooses. There is no automatic matching yet.' },
  { key: 'team', shot: 'team', label: 'Team performance', title: 'Keep the team accountable, fairly',
    desc: 'Leads assigned, follow-ups done and pipeline value per agent, for this month or last.',
    benefits: ['Per-agent leads, calls and sales on the Agents page', 'Daily and monthly goals with rewards', 'Agents see their own numbers; managers see everyone'],
    status: 'partial', note: 'These figures are on the Agents and Goals pages.' },
  { key: 'mobile', shot: 'mobile', label: 'Mobile CRM', title: 'The same CRM on the phone',
    desc: 'Check new leads, open a client, see what they want and complete the follow-up between viewings.',
    benefits: ['Installs on Android and iPhone from the browser', 'Bottom tabs for leads, tasks and alerts', 'Push reminders once installed'],
    status: 'live', note: 'This is the installable web app. Store versions are not published yet.' },
];

export default function Tour() {
  const { country } = useCountry();
  const loc = useLocation();
  const [tab, setTab] = useState('inbox');
  const ref = useRef(null);
  const tabRefs = useRef({});
  // "#tour-<tab>" (hero buttons, menu) and "#pipeline" open the tour on that screen
  useEffect(() => { const m = /^#tour-([a-z0-9]+)$/.exec(loc.hash); if (m && TABS.some((x) => x.key === m[1])) setTab(m[1]); else if (loc.hash === '#pipeline') setTab('pipeline'); else if (loc.hash === '#tour') setTab('inbox'); }, [loc.hash]);
  const t = useMemo(() => TABS.find((x) => x.key === tab), [tab]);
  // keep the chosen tab in view when the strip scrolls sideways
  useEffect(() => { const el = tabRefs.current[tab]; const box = el?.parentElement; if (el && box && box.scrollWidth > box.clientWidth) box.scrollTo({ left: el.offsetLeft - 12, behavior: 'smooth' }); }, [tab]);
  const choose = (k) => { setTab(k); track('tour_tab', { where: k }); };
  const onKey = (e) => {
    const i = TABS.findIndex((x) => x.key === tab);
    const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (j === null) return;
    e.preventDefault();
    const k = TABS[(j + TABS.length) % TABS.length].key;
    choose(k); tabRefs.current[k]?.focus();
  };
  return (
    <section className="gx-sec gx-tour" id="tour" ref={ref} aria-labelledby="tour-h">
      <span id="pipeline" className="h-anchor" aria-hidden="true" /><span id="crm" className="h-anchor" aria-hidden="true" />
      <div className="gx-wrap">
        <p className="gx-eyebrow"><i>01</i> The real screens</p>
        <h2 id="tour-h" className="gx-h2">See the CRM <span className="gx-grad">as your team will use it</span></h2>
        <p className="gx-lead">Seven screens a brokerage uses every day, taken from the running app. Each one is in your own free workspace from the first day.</p>
        <div className="h-tour-tabs" role="tablist" aria-label="Product screens" onKeyDown={onKey}>
          {TABS.map((x) => <button key={x.key} ref={(el) => { tabRefs.current[x.key] = el; }} type="button" role="tab" id={`tt-${x.key}`} aria-controls="tour-panel" aria-selected={tab === x.key} tabIndex={tab === x.key ? 0 : -1} className={tab === x.key ? 'on' : ''} onClick={() => choose(x.key)}>{x.label}</button>)}
        </div>
        <div className="gx-window"><div className="gx-win-bar" aria-hidden="true"><i /><i /><i /><span className="gx-win-hint">Agentify ERP · demo workspace</span></div>
        <div className="h-tour-g" role="tabpanel" id="tour-panel" aria-labelledby={`tt-${tab}`}>
          <div className="h-tour-copy">
            <h3>{t.title}</h3>
            <p>{t.desc}</p>
            <ul className="h-ticks">{t.benefits.map((b) => <li key={b}>{b}</li>)}</ul>
            <p className={`h-status ${t.status}`}><span>{t.status === 'live' ? 'In the product today' : 'Partly in the product'}</span>{t.note ? ` ${t.note}` : ''}</p>
            <Link to="/signup" className="gx-btn cream sm" onClick={() => track('cta_start_trial', { where: 'tour' })}>Open it in your free workspace</Link>
          </div>
          <div className="h-tour-stage">
            <p className="gx-shotnote">Screen from the app, demo workspace with sample records</p>
            {t.key === 'mobile'
              ? <PhoneShot code={country.code} />
              : <Screen key={`${t.shot}${country.code}`} kind={t.shot} code={country.code} alt={`${t.label}: a screen of the Agentify ERP from a ${country.name} demo workspace`} />}
          </div>
        </div></div>
      </div>
    </section>
  );
}
