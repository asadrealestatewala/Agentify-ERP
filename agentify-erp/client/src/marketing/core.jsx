// Shared pieces of the public marketing site: the page title helper and the visitor's market (country, and city when a
// headline exists for it).
//
// How the market is chosen (in this order):
//   1. ?country=xx in the address, or /us /uk /ae /pk /ca  - a link someone shared; used for this visit only.
//   2. A country the visitor picked in the switcher        - remembered on this device (localStorage) until they reset it.
//   3. The approximate location of their connection        - GET /api/platform/geo, asked once per browser session.
//   4. Otherwise the global headline. The browser's time zone only picks the currency and number formats then.
// Until 3 answers, the hero shows the global headline, then switches once. Nothing here assumes language, currency
// preferences or anything else about the person; it only picks which approved copy to show.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Flag from '../components/Flag.jsx';
import { setRegion } from '../format.js';
import { track } from './analytics.js';

export function useTitle(title, description) {
  useEffect(() => {
    if (!title) return;
    document.title = title;
    let m = document.querySelector('meta[name=description]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    m.content = description || '';
  }, [title, description]);
}

export const PATH_COUNTRY = { us: 'US', uk: 'UK', ae: 'AE', pk: 'PK', ca: 'CA' };
const CHOICE_KEY = 'agentify_country_choice';
const GEO_KEY = 'agentify_geo';
const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch { /* storage blocked: the choice lasts for this page only */ } },
  del: (k, s = localStorage) => { try { s.removeItem(k); } catch { /* ignore */ } },
};
function timezoneCountry() {
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  if (tz === 'Asia/Karachi') return 'PK';
  if (tz === 'Asia/Dubai') return 'AE';
  if (tz === 'Europe/London') return 'UK';
  if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal)/.test(tz)) return 'CA';
  if (tz.startsWith('America/')) return 'US';
  return null;
}
/** Asks the server once per browser session; never waits longer than 2.5 s. */
async function detectOnce() {
  const cached = store.get(GEO_KEY, sessionStorage);
  if (cached) { try { return JSON.parse(cached); } catch { /* ask again */ } }
  let out = { country: null, city: null, supported: false, source: 'unavailable' };
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('/api/platform/geo', { signal: ctl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (r.ok) out = await r.json();
  } catch { /* slow, blocked or offline: the page stays global */ }
  store.set(GEO_KEY, JSON.stringify(out), sessionStorage);
  return out;
}

const CountryCtx = createContext(null);
export const useCountry = () => useContext(CountryCtx);

export function CountryProvider({ info, children }) {
  const loc = useLocation();
  const nav = useNavigate();
  const countries = info.countries?.length ? info.countries : [{ code: 'PK', name: 'Pakistan', currency: 'PKR', open: true, config: {}, copy: {}, timezones: ['Asia/Karachi'] }];
  const byCode = (c) => countries.find((x) => x.code === String(c || '').toUpperCase());
  const fromUrl = () => {
    const q = new URLSearchParams(loc.search).get('country');
    const slug = loc.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    return byCode(q)?.code || byCode(PATH_COUNTRY[slug])?.code || null;
  };
  const [urlCode, setUrlCode] = useState(fromUrl);
  const [manual, setManual] = useState(() => byCode(store.get(CHOICE_KEY))?.code || null);
  const [detected, setDetected] = useState(null); // { country, city, supported, source } once known
  const tzCode = useMemo(() => byCode(timezoneCountry())?.code || null, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setUrlCode(fromUrl()); }, [loc.search, loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let live = true; detectOnce().then((d) => { if (live) setDetected(d); }); return () => { live = false; }; }, []);

  const detectedCode = detected?.supported ? byCode(detected.country)?.code || null : null;
  // the headline follows only a detected, supported country; anything else keeps the global headline
  const autoCode = detectedCode;
  const chosen = urlCode || manual;
  const code = chosen || autoCode || tzCode || countries.find((c) => c.open)?.code || countries[0].code;
  const country = byCode(code) || countries[0];
  // formats and calculators follow the country on the first paint
  if (country.config?.region) setRegion(country.config);

  // which headline: a chosen or detected supported country; the city only when it is one of that market's listed cities
  const pending = !chosen && !detected;
  const marketCode = chosen || autoCode;
  const crm = marketCode ? byCode(marketCode)?.copy?.crm : null;
  const city = !chosen && detectedCode && detected?.city && crm?.cities?.includes(detected.city) ? detected.city : null;
  const market = useMemo(() => {
    const g = info.crm_global || {};
    if (!crm) return { key: 'GLOBAL', hook: g.hook, sub: g.sub, emphasis: g.emphasis || [], city: null };
    return { key: marketCode, hook: city && crm.city_hook ? crm.city_hook.replace('{city}', city) : crm.hook, sub: crm.sub, emphasis: crm.emphasis || [], city };
  }, [crm, city, marketCode, info.crm_global]);

  const setQuery = useCallback((c) => {
    const q = new URLSearchParams(loc.search);
    if (c) q.set('country', c.toLowerCase()); else q.delete('country');
    const s = q.toString();
    nav({ pathname: PATH_COUNTRY[loc.pathname.replace(/^\/+|\/+$/g, '').toLowerCase()] ? '/' : loc.pathname, search: s ? `?${s}` : '', hash: loc.hash }, { replace: true });
  }, [loc.search, loc.pathname, loc.hash, nav]);
  const setCountry = (c) => { setManual(c); store.set(CHOICE_KEY, c); setQuery(c); track('market_select', { where: c }); };
  const resetCountry = () => { setManual(null); store.del(CHOICE_KEY); setUrlCode(null); setQuery(null); track('market_select', { where: 'reset' }); };

  const value = { country, countries, setCountry, resetCountry, detected, detectedCode, manual: chosen, pending, market };
  return <CountryCtx.Provider value={value}>{children}</CountryCtx.Provider>;
}

/** The country menu: always visible, keyboard friendly, with a way back to the detected location. */
export function CountrySwitch({ id = 'country-menu' }) {
  const { country, countries, setCountry, resetCountry, detected, detectedCode, manual } = useCountry();
  const [open, setOpen] = useState(false);
  const btn = useRef(null), list = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!e.target.closest?.(`#${id}-wrap`)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('click', close); document.addEventListener('keydown', esc);
    (list.current?.querySelector('button[aria-selected="true"]') || list.current?.querySelector('button'))?.focus();
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
  }, [open, id]);
  const onListKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...list.current.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const pick = (c) => { setCountry(c); setOpen(false); btn.current?.focus(); };
  const where = detected?.country ? [detected.city, countries.find((c) => c.code === detected.country)?.name || detected.country].filter(Boolean).join(', ') : null;
  return (
    <div className="lcountry" id={`${id}-wrap`}>
      <button ref={btn} type="button" className="lcountry-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={`Country: ${country.name}. Change country`} onClick={() => setOpen(!open)}>
        <Flag code={country.code} /><span className="lcountry-name">{country.name}</span><span aria-hidden className="lcountry-caret">▾</span>
      </button>
      {open && (
        <div className="lcountry-pop">
          <ul role="listbox" id={id} aria-label="Choose your country" ref={list} onKeyDown={onListKey}>
            {countries.map((c) => (
              <li key={c.code} role="presentation">
                <button type="button" role="option" aria-selected={c.code === country.code} onClick={() => pick(c.code)}>
                  <Flag code={c.code} /><span>{c.name}</span>{!c.open && <small>soon</small>}
                </button>
              </li>))}
          </ul>
          <div className="lcountry-foot">
            {manual && <button type="button" className="llinkbtn" onClick={() => { resetCountry(); setOpen(false); btn.current?.focus(); }}>{detectedCode ? `Use detected location (${where})` : 'Reset to automatic'}</button>}
            <p>{where ? `Detected from your connection: ${where}. ` : ''}The country only changes the headline, currency and examples. Your location is approximate and is not stored.</p>
          </div>
        </div>)}
    </div>
  );
}
