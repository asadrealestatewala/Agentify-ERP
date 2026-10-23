// Interactive product tour: each tab shows a working preview built from the same ideas as the real screens, filled with
// sample data. Everything a visitor does here stays in this page and is forgotten on reload; nothing is saved anywhere.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCountry } from '../countryCtx.js';
import { track } from '../analytics.js';
import { AGENTS, LEADS, PROPERTIES, STAGES, TASKS, TEAM, TIMELINE, agentInitials, agentName, initials, leadById, propertyById, sampleMoney } from './sample.js';

const TABS = [
  { key: 'inbox', label: 'Lead inbox', title: 'Every new enquiry, with its source and next step',
    desc: 'Enquiries from your website form arrive as leads automatically. Add the rest by hand or import a spreadsheet.',
    benefits: ['Website enquiries are assigned to the listing’s agent, or to the next agent in turn', 'Filter by stage, source or agent; agents can be limited to their own leads', 'Each lead shows its priority and next follow-up'],
    status: 'live' },
  { key: 'c360', label: 'Customer 360', title: 'One profile for everything you know about a client',
    desc: 'Contact details, what they are looking for, every call and note, and the deals they are part of.',
    benefits: ['Budget, preferred area and property type on the profile', 'A timeline of calls, messages, stage changes and assignments', 'Linked properties and sales in the same place'],
    status: 'live', note: 'The buying timeline in this sample is a custom field; you can add your own fields in Settings.' },
  { key: 'pipeline', label: 'Sales pipeline', title: 'See where every opportunity stands',
    desc: 'Leads sit in stages. Drag a card to the next stage, or use the arrow on a card with the keyboard.',
    benefits: ['Drag and drop between stages, as in the product', 'Totals per stage update as deals move', 'Stage names and colours are yours to change'],
    status: 'live', note: 'These are the default stage names of a new workspace.' },
  { key: 'tasks', label: 'Follow-ups & tasks', title: 'Know what is overdue, due today and next',
    desc: 'Follow-up dates and tasks, with reminders inside the app, so nothing waits on someone’s memory.',
    benefits: ['Overdue, today and upcoming in one list', 'Filter by agent; managers see the whole team', 'Completing a follow-up records it on the lead'],
    status: 'live' },
  { key: 'properties', label: 'Properties & interests', title: 'Connect enquiries to the listings they asked about',
    desc: 'Listings with price, size and status, and the leads interested in each one.',
    benefits: ['Price, bedrooms, bathrooms, size and status on every listing', 'Enquiries from a listing page are linked to that listing', 'Reserve a property for a lead and start the sale'],
    status: 'partial', note: 'A lead is linked to the property it enquired about or that an agent chooses. There is no automatic matching yet.' },
  { key: 'team', label: 'Team performance', title: 'Keep the team accountable, fairly',
    desc: 'Leads assigned, follow-ups done and pipeline value per agent, for this month or last.',
    benefits: ['Per-agent leads, calls and sales on the Agents page', 'Daily and monthly goals with rewards', 'Agents see their own numbers; managers see everyone'],
    status: 'partial', note: 'The product shows these figures on the Agents and Goals pages; the layout here is simplified.' },
  { key: 'mobile', label: 'Mobile CRM', title: 'The same CRM on the phone',
    desc: 'Check new leads, open a client, see what they want and complete the follow-up between viewings.',
    benefits: ['Installs on Android and iPhone from the browser', 'Bottom tabs for leads, tasks and alerts', 'Push reminders once installed'],
    status: 'live', note: 'This is the installable web app. Store versions are not published yet.' },
];

const Chip = ({ tone = 'slate', children }) => <span className={`h-chip ${tone}`}>{children}</span>;
const stageOf = (k) => STAGES.find((s) => s.key === k) || STAGES[0];
const Avatar = ({ name, small }) => <span className={`h-av ${small ? 'sm' : ''}`} aria-hidden="true">{initials(name)}</span>;

// ---------------------------------------------------------------- lead inbox
function LeadInbox() {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [owner, setOwner] = useState({});
  const rows = LEADS.filter((l) => l.stage !== 'closed' && l.stage !== 'lost').filter((l) => filter === 'all' || (filter === 'new' ? l.stage === 'new' : filter === 'website' ? l.source === 'Website' : l.priority === 'High'));
  const lead = open ? leadById(open) : null;
  return (
    <div className="h-pv h-inbox">
      <div className="h-bar"><b>Leads</b><div className="h-filters" role="group" aria-label="Filter leads">
        {[['all', 'All open'], ['new', 'New'], ['website', 'From website'], ['high', 'High priority']].map(([k, l]) => <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
      </div></div>
      {!rows.length ? <p className="h-empty">No leads match this filter.</p> : (
        <ul className="h-list">{rows.map((l) => (
          <li key={l.id}><button type="button" className={open === l.id ? 'sel' : ''} onClick={() => setOpen(l.id)} aria-label={`Open ${l.name}`}>
            <Avatar name={l.name} /><span className="h-main"><b>{l.name}</b><small>{l.source} · {l.received}</small></span>
            <Chip tone={stageOf(l.stage).tone}>{stageOf(l.stage).label}</Chip>
            <span className="h-owner" title={agentName(owner[l.id] || l.agent)}>{agentInitials(owner[l.id] || l.agent)}</span>
          </button></li>))}</ul>)}
      {lead && (
        <aside className="h-drawer" aria-label={`${lead.name} details`}>
          <div className="h-drawer-h"><b>{lead.name}</b><button type="button" className="h-x" onClick={() => setOpen(null)} aria-label="Close details">×</button></div>
          <dl className="h-dl">
            <div><dt>Source</dt><dd>{lead.source}</dd></div><div><dt>Priority</dt><dd>{lead.priority}</dd></div>
            <div><dt>Stage</dt><dd>{stageOf(lead.stage).label}</dd></div><div><dt>Next step</dt><dd>{lead.next}</dd></div>
          </dl>
          <label className="h-field">Assigned agent
            <select value={owner[lead.id] || lead.agent} onChange={(e) => setOwner({ ...owner, [lead.id]: e.target.value })}>{AGENTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
          {owner[lead.id] && owner[lead.id] !== lead.agent && <p className="h-ok" role="status">Reassigned to {agentName(owner[lead.id])} in this preview (not saved).</p>}
        </aside>)}
    </div>
  );
}

// ---------------------------------------------------------------- customer 360
function Customer360({ currency }) {
  const l = LEADS[0];
  const p = propertyById(l.property);
  const [tab, setTab] = useState('activity');
  const [notes, setNotes] = useState(['Prefers a high floor; works from home.']);
  const [draft, setDraft] = useState('');
  const add = (e) => { e.preventDefault(); if (!draft.trim()) return; setNotes([draft.trim(), ...notes]); setDraft(''); };
  return (
    <div className="h-pv h-360">
      <div className="h-prof">
        <Avatar name={l.name} /><div><b className="h-big">{l.name}</b><small>{l.email} · {l.phone}</small></div>
        <Chip tone="blue">{stageOf(l.stage).label}</Chip>
      </div>
      <div className="h-prefs">
        <div><small>Budget</small><b>{sampleMoney(l.budget, currency)}</b></div>
        <div><small>Preferred area</small><b>{l.area}</b></div>
        <div><small>Property type</small><b>{l.type}, {l.beds} bed</b></div>
        <div><small>Buying timeline</small><b>{l.timeline}</b></div>
      </div>
      <div className="h-tabs" role="tablist" aria-label="Profile sections">
        {[['activity', 'Activity'], ['notes', `Notes (${notes.length})`], ['deals', 'Property & deals']].map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}
      </div>
      <div className="h-tabp" role="tabpanel">
        {tab === 'activity' && <ol className="h-time">{TIMELINE.map((t, i) => <li key={i}><small>{t.at}</small><span>{t.text}</span></li>)}</ol>}
        {tab === 'notes' && (<>
          <form className="h-note" onSubmit={add}><label className="h-sr" htmlFor="h-note-in">Add a note</label><input id="h-note-in" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note (stays in this preview)" maxLength={140} /><button type="submit" disabled={!draft.trim()}>Add</button></form>
          <ul className="h-notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></>)}
        {tab === 'deals' && <div className="h-deal"><div><b>{p.title}</b><small>{p.area} · {sampleMoney(p.price, currency)} · {p.status}</small></div><Chip tone="amber">Interested</Chip></div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pipeline
const PIPE = STAGES.filter((s) => ['new', 'contacted', 'follow', 'interested', 'closed'].includes(s.key));
function Pipeline({ currency }) {
  const [where, setWhere] = useState(() => Object.fromEntries(LEADS.map((l) => [l.id, l.stage])));
  const [drag, setDrag] = useState(null);
  const [moved, setMoved] = useState('');
  const move = (id, to) => { if (!PIPE.find((s) => s.key === to)) return; setWhere((w) => ({ ...w, [id]: to })); setMoved(`${leadById(id).name} moved to ${stageOf(to).label}.`); };
  const next = (id) => { const i = PIPE.findIndex((s) => s.key === where[id]); if (i >= 0 && i < PIPE.length - 1) move(id, PIPE[i + 1].key); };
  return (
    <div className="h-pv h-pipe">
      <div className="h-cols">{PIPE.map((s) => {
        const cards = LEADS.filter((l) => where[l.id] === s.key);
        const total = cards.reduce((a, l) => a + l.budget, 0);
        return (
          <section key={s.key} className={`h-col ${drag ? 'drop' : ''}`} aria-label={`${s.label}, ${cards.length} leads`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (drag) move(drag, s.key); setDrag(null); }}>
            <header><span className={`h-dot ${s.tone}`} />{s.label}<small>{cards.length} · {sampleMoney(total, currency)}</small></header>
            {cards.map((l) => (
              <div key={l.id} className="h-card" draggable onDragStart={() => setDrag(l.id)} onDragEnd={() => setDrag(null)}>
                <b>{l.name}</b><small>{l.type} · {sampleMoney(l.budget, currency)}</small>
                <span className="h-card-f"><span className="h-owner sm">{agentInitials(l.agent)}</span>
                  {s.key !== 'closed' && <button type="button" className="h-next" onClick={() => next(l.id)} aria-label={`Move ${l.name} to the next stage`}>→</button>}</span>
              </div>))}
            {!cards.length && <p className="h-empty sm">Drop a lead here</p>}
          </section>);
      })}</div>
      <p className="h-sr" role="status" aria-live="polite">{moved}</p>
    </div>
  );
}

// ---------------------------------------------------------------- follow-ups
function FollowUps() {
  const [done, setDone] = useState({});
  const [who, setWho] = useState('all');
  const groups = [['overdue', 'Overdue'], ['today', 'Today'], ['upcoming', 'Upcoming']];
  const list = TASKS.filter((t) => who === 'all' || t.agent === who);
  const left = list.filter((t) => !done[t.id]).length;
  return (
    <div className="h-pv h-tasks">
      <div className="h-bar"><b>Follow-ups <small>{left} open</small></b>
        <label className="h-field inline">Agent <select value={who} onChange={(e) => setWho(e.target.value)}><option value="all">Whole team</option>{AGENTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      </div>
      {groups.map(([k, label]) => {
        const items = list.filter((t) => t.due === k);
        if (!items.length) return null;
        return (
          <div key={k} className="h-group"><h4 className={k}>{label}</h4>
            <ul>{items.map((t) => (
              <li key={t.id} className={done[t.id] ? 'done' : ''}>
                <label><input type="checkbox" checked={!!done[t.id]} onChange={() => setDone({ ...done, [t.id]: !done[t.id] })} /><span><b>{t.title}</b><small>{t.kind} · {t.when} · {agentName(t.agent)}</small></span></label>
              </li>))}</ul></div>);
      })}
      {!left && <p className="h-ok" role="status">All caught up. In the product, each completed follow-up is recorded on the lead.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- properties
function Properties({ currency }) {
  const [status, setStatus] = useState('all');
  const [sel, setSel] = useState('p1');
  const list = PROPERTIES.filter((p) => status === 'all' || p.status === status);
  const interested = LEADS.filter((l) => l.property === sel);
  return (
    <div className="h-pv h-props">
      <div className="h-bar"><b>Listings</b><div className="h-filters" role="group" aria-label="Filter by status">
        {['all', 'For sale', 'Reserved', 'Sold'].map((k) => <button key={k} type="button" className={status === k ? 'on' : ''} aria-pressed={status === k} onClick={() => setStatus(k)}>{k === 'all' ? 'All' : k}</button>)}
      </div></div>
      <div className="h-props-g">
        <ul className="h-plist">{list.map((p) => (
          <li key={p.id}><button type="button" className={sel === p.id ? 'sel' : ''} onClick={() => setSel(p.id)}>
            <span className="h-ph" aria-hidden="true" /><span className="h-main"><b>{p.title}</b><small>{p.area} · {p.beds} bed · {p.baths} bath · {p.size.toLocaleString('en')} sq ft</small></span>
            <span className="h-pr"><b>{sampleMoney(p.price, currency)}</b><Chip tone={p.tone}>{p.status}</Chip></span>
          </button></li>))}
          {!list.length && <li className="h-empty">No listings with this status.</li>}</ul>
        <div className="h-int" aria-live="polite"><h4>Interested leads</h4>{interested.length ? <ul>{interested.map((l) => <li key={l.id}><Avatar name={l.name} small /><span><b>{l.name}</b><small>{stageOf(l.stage).label} · {agentName(l.agent)}</small></span></li>)}</ul> : <p className="h-empty sm">No leads linked to this listing yet.</p>}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- team
function Team({ currency }) {
  const [period, setPeriod] = useState('this');
  const rows = TEAM[period];
  const maxLeads = Math.max(...rows.map((r) => r.leads));
  return (
    <div className="h-pv h-team">
      <div className="h-bar"><b>Team</b><div className="h-filters" role="group" aria-label="Period">{[['this', 'This month'], ['last', 'Last month']].map(([k, l]) => <button key={k} type="button" className={period === k ? 'on' : ''} aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div></div>
      <table className="h-table"><caption className="h-sr">Leads, follow-ups completed and pipeline value per agent, sample data</caption>
        <thead><tr><th scope="col">Agent</th><th scope="col">Leads assigned</th><th scope="col">Follow-ups done</th><th scope="col">Pipeline</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.agent}><th scope="row"><span className="h-owner">{agentInitials(r.agent)}</span>{agentName(r.agent)}</th>
            <td><span className="h-barv" style={{ '--w': `${(r.leads / maxLeads) * 100}%` }} aria-hidden="true" />{r.leads}</td>
            <td><span className="h-barv green" style={{ '--w': `${r.done * 100}%` }} aria-hidden="true" />{Math.round(r.done * 100)}%</td>
            <td>{sampleMoney(r.value, currency)}</td></tr>))}</tbody></table>
    </div>
  );
}

// ---------------------------------------------------------------- phone
export function PhoneCRM({ currency, compact }) {
  const [screen, setScreen] = useState('leads');
  const [lead, setLead] = useState('l1');
  const [done, setDone] = useState({});
  const l = leadById(lead);
  const open = (id) => { setLead(id); setScreen('client'); };
  return (
    <div className={`h-phone ${compact ? 'compact' : ''}`}>
      <div className="h-phone-s">
        <div className="h-phone-top"><b>{screen === 'leads' ? 'Leads' : screen === 'client' ? 'Client' : 'Tasks'}</b></div>
        <div className="h-phone-body">
          {screen === 'leads' && <ul className="h-plead">{LEADS.slice(0, compact ? 3 : 5).map((x) => <li key={x.id}><button type="button" onClick={() => open(x.id)} aria-label={`Open ${x.name}`}><Avatar name={x.name} small /><span><b>{x.name}</b><small>{x.next}</small></span><Chip tone={stageOf(x.stage).tone}>{stageOf(x.stage).label}</Chip></button></li>)}</ul>}
          {screen === 'client' && (
            <div className="h-pclient"><Avatar name={l.name} /><b>{l.name}</b><small>{stageOf(l.stage).label} · {agentName(l.agent)}</small>
              <dl><div><dt>Budget</dt><dd>{sampleMoney(l.budget, currency)}</dd></div><div><dt>Looking for</dt><dd>{l.type}, {l.area}</dd></div></dl>
              <label className={`h-pcheck ${done[l.id] ? 'done' : ''}`}><input type="checkbox" checked={!!done[l.id]} onChange={() => setDone({ ...done, [l.id]: !done[l.id] })} /><span>{l.next}</span></label>
              <button type="button" className="h-plink" onClick={() => setScreen('leads')}>← All leads</button></div>)}
          {screen === 'tasks' && <ul className="h-ptasks">{TASKS.slice(0, 4).map((t) => <li key={t.id} className={done[t.id] ? 'done' : ''}><label><input type="checkbox" checked={!!done[t.id]} onChange={() => setDone({ ...done, [t.id]: !done[t.id] })} /><span>{t.title}<small>{t.when}</small></span></label></li>)}</ul>}
        </div>
        <nav className="h-phone-tabs" aria-label="Phone preview tabs">{[['leads', 'Leads'], ['client', 'Client'], ['tasks', 'Tasks']].map(([k, t]) => <button key={k} type="button" className={screen === k ? 'on' : ''} aria-pressed={screen === k} onClick={() => setScreen(k)}>{t}</button>)}</nav>
      </div>
    </div>
  );
}

function MobilePreview({ currency }) {
  return <div className="h-pv h-mob"><PhoneCRM currency={currency} /><p className="h-mob-t">Tap a lead to open the client, tick the follow-up, or switch to Tasks.</p></div>;
}

const PREVIEW = { inbox: LeadInbox, c360: Customer360, pipeline: Pipeline, tasks: FollowUps, properties: Properties, team: Team, mobile: MobilePreview };

export default function Tour() {
  const { country } = useCountry();
  const loc = useLocation();
  const [tab, setTab] = useState('inbox');
  const ref = useRef(null);
  const tabRefs = useRef({});
  // the "Pipeline" link in the menu opens this tour on the pipeline tab
  useEffect(() => { const m = /^#tour-([a-z0-9]+)$/.exec(loc.hash); if (m && TABS.some((x) => x.key === m[1])) setTab(m[1]); else if (loc.hash === '#pipeline') setTab('pipeline'); else if (loc.hash === '#tour') setTab('inbox'); }, [loc.hash]);
  const t = useMemo(() => TABS.find((x) => x.key === tab), [tab]);
  const choose = (k) => { setTab(k); track('tour_tab', { where: k }); };
  const onKey = (e) => {
    const i = TABS.findIndex((x) => x.key === tab);
    const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (j === null) return;
    e.preventDefault();
    const k = TABS[(j + TABS.length) % TABS.length].key;
    choose(k); tabRefs.current[k]?.focus();
  };
  const Preview = PREVIEW[tab];
  return (
    <section className="gx-sec gx-tour" id="tour" ref={ref} aria-labelledby="tour-h">
      <span id="pipeline" className="h-anchor" aria-hidden="true" /><span id="crm" className="h-anchor" aria-hidden="true" />
      <div className="gx-wrap">
        <p className="gx-eyebrow"><i>01</i> Try it yourself</p>
        <h2 id="tour-h" className="gx-h2">Try the CRM <span className="gx-grad">before you sign up</span></h2>
        <p className="gx-lead">Seven screens a brokerage uses every day, working right here on a sample agency. Nothing to install, nothing saved.</p>
        <div className="h-tour-tabs" role="tablist" aria-label="Product tour" onKeyDown={onKey}>
          {TABS.map((x) => <button key={x.key} ref={(el) => { tabRefs.current[x.key] = el; }} type="button" role="tab" id={`tt-${x.key}`} aria-controls="tour-panel" aria-selected={tab === x.key} tabIndex={tab === x.key ? 0 : -1} className={tab === x.key ? 'on' : ''} onClick={() => choose(x.key)}>{x.label}</button>)}
        </div>
        <div className="gx-window"><div className="gx-win-bar" aria-hidden="true"><i /><i /><i /><span className="gx-win-hint">▷ Try it: click anything</span></div>
        <div className="h-tour-g" role="tabpanel" id="tour-panel" aria-labelledby={`tt-${tab}`}>
          <div className="h-tour-copy">
            <h3>{t.title}</h3>
            <p>{t.desc}</p>
            <ul className="h-ticks">{t.benefits.map((b) => <li key={b}>{b}</li>)}</ul>
            <p className={`h-status ${t.status}`}><span>{t.status === 'live' ? 'In the product today' : 'Partly in the product'}</span>{t.note ? ` ${t.note}` : ''}</p>
          </div>
          <div className="h-tour-stage">
            <div className="h-sample">Sample data</div>
            <Preview key={tab} currency={country.currency} />
          </div>
        </div></div>
      </div>
    </section>
  );
}
