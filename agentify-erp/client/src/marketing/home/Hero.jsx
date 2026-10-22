// Hero: the market's headline on the left, and on the right a small working CRM preview (pipeline + client profile) with a
// phone beside it. One short animation plays once: a new enquiry arrives, then a follow-up is ticked off. It can be replayed,
// and it does not play at all when the visitor prefers reduced motion.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCountry } from '../core.jsx';
import { track } from '../analytics.js';
import { PhoneCRM } from './Tour.jsx';
import { LEADS, STAGES, agentInitials, agentName, initials, sampleMoney } from './sample.js';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const COLS = ['new', 'contacted', 'follow'];

function HeroCRMPreview() {
  const { country } = useCountry();
  const cur = country.currency;
  // step 0: before; 1: the new website enquiry has arrived; 2: its follow-up is done
  const [step, setStep] = useState(() => (reduced() ? 2 : 0));
  const timers = useRef([]);
  const play = () => {
    timers.current.forEach(clearTimeout);
    if (reduced()) { setStep(2); return; }
    setStep(0);
    timers.current = [setTimeout(() => setStep(1), 700), setTimeout(() => setStep(2), 2300)];
  };
  useEffect(() => { play(); return () => timers.current.forEach(clearTimeout); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = LEADS[0]; // the incoming website enquiry
  const cards = (k) => LEADS.filter((l) => l.stage === k && l.id !== fresh.id).slice(0, 2);
  return (
    <div className="h-hero-v">
      <div className="h-win" role="img" aria-label="Preview of the Agentify CRM with sample data: a pipeline with a new website enquiry, and the client’s profile with a completed follow-up">
        <div className="h-win-top" aria-hidden="true"><span className="h-win-t">Leads · Pipeline</span><span className="h-sample sm">Sample data</span></div>
        <div className="h-win-g" aria-hidden="true">
          <div className="h-mini-pipe">
            {COLS.map((k) => {
              const s = STAGES.find((x) => x.key === k);
              return (
                <div key={k} className="h-mcol">
                  <header><span className={`h-dot ${s.tone}`} />{s.label}</header>
                  {k === 'new' && step >= 1 && (
                    <div className="h-mcard fresh"><b>{fresh.name}</b><small>Website · {fresh.received}</small><span className="h-tag">New enquiry</span></div>)}
                  {cards(k).map((l) => <div key={l.id} className="h-mcard"><b>{l.name}</b><small>{l.type} · {sampleMoney(l.budget, cur)}</small></div>)}
                </div>);
            })}
          </div>
          <div className="h-mini-prof">
            <div className="h-mp-h"><span className="h-av">{initials(fresh.name)}</span><span><b>{fresh.name}</b><small>Assigned to {agentName(fresh.agent)}</small></span></div>
            <dl>
              <div><dt>Budget</dt><dd>{sampleMoney(fresh.budget, cur)}</dd></div>
              <div><dt>Looking for</dt><dd>{fresh.type}, {fresh.beds} bed</dd></div>
              <div><dt>Area</dt><dd>{fresh.area}</dd></div>
              <div><dt>Source</dt><dd>Website</dd></div>
            </dl>
            <p className="h-mp-l">Next follow-up</p>
            <div className={`h-mp-task ${step >= 2 ? 'done' : ''}`}><span className="h-box">{step >= 2 ? '✓' : ''}</span><span>{fresh.next}</span></div>
            <p className="h-mp-own"><span className="h-owner sm">{agentInitials(fresh.agent)}</span>{step >= 2 ? 'Follow-up done · next one scheduled' : 'Due today'}</p>
          </div>
        </div>
      </div>
      <div className="h-hero-phone"><PhoneCRM currency={cur} compact /></div>
      <button type="button" className="h-replay" onClick={play}>Replay the preview</button>
    </div>
  );
}

export default function Hero({ trialDays }) {
  const { market, pending, country } = useCountry();
  return (
    <section className="h-hero" aria-labelledby="hero-h">
      <div className="h-wrap h-hero-g">
        <div className="h-hero-t">
          <p className="h-aud">For real estate agents, brokerage teams and property sales teams{market.key !== 'GLOBAL' ? ` in ${country.name}` : ''}</p>
          <h1 id="hero-h" className={pending ? 'h-pending' : 'h-ready'} key={market.hook}>{market.hook}</h1>
          <p className="h-sub">{market.sub}</p>
          <div className="h-cta">
            <Link className="h-btn primary" to="/#tour" onClick={() => track('cta_explore_crm', { where: 'hero' })}>Explore the CRM</Link>
            <Link className="h-btn" to="/signup" onClick={() => track('cta_start_trial', { where: 'hero' })}>Start free for {trialDays} days</Link>
          </div>
          <p className="h-fine">No card needed to start. <Link to="/contact" onClick={() => track('cta_book_demo', { where: 'hero' })}>Or book a demo</Link>.</p>
          {!!market.emphasis?.length && <ul className="h-emph" aria-label="Useful for your market">{market.emphasis.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
        <HeroCRMPreview />
      </div>
    </section>
  );
}
