/**
 * Icon picker for website blocks (studio only; it ships in the editor's chunk, never on public pages).
 * Offers the approved semantic icons from shared/siteIcons.js, drawn by the same SiteIcon the public website uses,
 * and saves the semantic id. Keyboard: type to filter, arrow keys move, Enter picks, Escape closes.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import SiteIcon from '../../site/SiteIcon.jsx';
import { SITE_ICONS, resolveIconId } from '../../../../shared/siteIcons.js';

/** Extra search words per icon (picker only). Add words here when you add an icon to the registry. */
const KEYWORDS = {
  residential: 'home house villa plot residential bungalow', construction: 'build crane construction site develop', commercial: 'office shop business tower commercial',
  agricultural: 'farm wheat crop agriculture land kanal', land: 'plot trees land park green', apartment: 'flat apartment block tower',
  city: 'city area neighbourhood community town', key: 'rent key let tenant handover', sell: 'sell price tag offer', valuation: 'valuation value worth appraisal',
  tools: 'repair maintenance tools renovation vendor', location: 'map pin address location', area: 'size area marla sq ft ruler', bedrooms: 'bed bedroom room',
  bathrooms: 'bath bathroom washroom', parking: 'car garage parking', photos: 'camera photo marketing', installments: 'installment card payment plan',
  agent: 'agent person user broker', team: 'team people staff', phone: 'call phone mobile', landline: 'landline telephone office phone', email: 'mail email message',
  whatsapp: 'whatsapp chat message', chat: 'chat message talk support', search: 'search find look', calendar: 'calendar date booking visit appointment',
  hours: 'time hours clock opening', verified: 'verified trust safe secure check', paperwork: 'documents paperwork file legal', receipt: 'receipt payment invoice',
  handshake: 'deal partner handshake care', investment: 'money cash investment profit', growth: 'growth chart returns', award: 'award best prize quality',
  checklist: 'steps checklist process', star: 'star featured favourite', diamond: 'luxury premium diamond', news: 'news blog article', image: 'picture image gallery', dot: 'dot plain simple',
};

const COLS = 4;

export default function IconPicker({ value, onChange, label = 'Icon' }) {
  const current = resolveIconId(value);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const uid = useId();
  const input = useRef(null);
  const trigger = useRef(null);

  const options = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all = [{ id: '', label: 'No icon', group: '' }, ...Object.entries(SITE_ICONS).map(([id, m]) => ({ id, ...m }))];
    return all.filter((o) => !words.length || words.every((w) => `${o.id} ${o.label} ${o.group} ${KEYWORDS[o.id] || ''}`.toLowerCase().includes(w)));
  }, [q]);

  useEffect(() => { if (open) { const i = options.findIndex((o) => o.id === current); setActive(i < 0 ? 0 : i); input.current?.focus(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive((a) => Math.min(a, Math.max(options.length - 1, 0))); }, [options.length]);

  const pick = (id) => { onChange(id); setOpen(false); setQ(''); trigger.current?.focus(); };
  const onKey = (e) => {
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
    if (move) { e.preventDefault(); setActive((a) => Math.min(Math.max(a + move, 0), options.length - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[active]) pick(options[active].id); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQ(''); trigger.current?.focus(); }
  };
  const optId = (i) => `${uid}-o${i}`;
  const currentLabel = current ? SITE_ICONS[current]?.label : 'No icon';

  return (
    <div className="ip">
      <button ref={trigger} type="button" className="ip-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ip-prev">{current ? <SiteIcon name={current} size={22} /> : <span className="ip-none" aria-hidden="true">–</span>}</span>
        <span className="grow">{currentLabel}</span>
        <span className="sr-only">{label}: change</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="ip-panel">
          <input ref={input} className="input ip-search" type="search" placeholder="Search icons, e.g. house, land" value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
            role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-activedescendant={options[active] ? optId(active) : undefined} aria-label={`Search ${label.toLowerCase()}s`} aria-autocomplete="list" />
          <div id={`${uid}-list`} className="ip-grid" role="listbox" aria-label={`${label} choices`}>
            {options.map((o, i) => (
              <div key={o.id || 'none'} id={optId(i)} role="option" aria-selected={o.id === current} title={o.label}
                className={`ip-opt${o.id === current ? ' on' : ''}${i === active ? ' active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.id)}>
                {o.id ? <SiteIcon name={o.id} size={22} /> : <span className="ip-none" aria-hidden="true">–</span>}
                <span className="ip-lab">{o.label}</span>
              </div>
            ))}
            {!options.length && <p className="ip-empty">No icon matches “{q}”.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
