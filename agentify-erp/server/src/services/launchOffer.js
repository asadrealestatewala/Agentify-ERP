// The launch offer: a percentage off the first N monthly payments, per country (currency), switched on and off in the console.
// Everything is a setting (platform_settings key `launch_offer`), never hard-coded. The offer is truthful by construction: when it is switched
// off, past its end date or out of founding spots, activeOffer() is null, so the banner, the crossed-out prices and the checkout discount all
// disappear together. Eligibility: plans flagged launch_offer, monthly payments only, and only workspaces whose first paid invoice came after the
// offer was switched on (existing subscribers keep their price). A workspace gets the discount on its first `months` paid periods.
import { getSetting, setSetting } from './platformConfig.js';
import { platformDb } from '../platform.js';
import { bad } from '../util.js';
import { CURRENCIES } from './plansStore.js';

export const OFFER_CURRENCIES = CURRENCIES; // the first currency is the launch market (home market) and carries the demo offer
export const DEFAULT_OFFER = {
  on: false,
  banner_text: 'Launch offer: {percent}% off for your first {months} months',
  button_text: 'See the prices',
  ends_at: null, show_countdown: false,
  spots: null, show_spots: false,
  started_at: null,
  countries: Object.fromEntries(CURRENCIES.map((c, i) => [c, i === 0 ? { percent: 30, months: 3 } : { percent: 0, months: 0 }])),
};
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const sqlNow = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');

export function getOffer() {
  const s = parse(getSetting('launch_offer')) || {};
  return { ...DEFAULT_OFFER, ...s, countries: Object.fromEntries(OFFER_CURRENCIES.map((c) => [c, { ...DEFAULT_OFFER.countries[c], ...(s.countries?.[c] || {}) }])) };
}

const pct = (v, label) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 90) throw bad(`${label}: the discount must be a whole number from 0 to 90`); return n; };
const mon = (v, label) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 24) throw bad(`${label}: the number of months must be a whole number from 0 to 24`); return n; };

export function saveOffer(b, by) {
  const cur = getOffer();
  const next = { ...cur };
  if (b.on !== undefined) next.on = !!b.on;
  if (b.banner_text !== undefined) { next.banner_text = String(b.banner_text || '').trim().slice(0, 140); if (!next.banner_text) throw bad('Write the banner text'); }
  if (b.button_text !== undefined) next.button_text = String(b.button_text || '').trim().slice(0, 30) || DEFAULT_OFFER.button_text;
  if (b.ends_at !== undefined) {
    if (b.ends_at === null || b.ends_at === '') next.ends_at = null;
    else { const t = Date.parse(b.ends_at); if (!Number.isFinite(t)) throw bad('The end date is not a valid date'); next.ends_at = new Date(t).toISOString(); }
  }
  if (b.show_countdown !== undefined) next.show_countdown = !!b.show_countdown;
  if (b.spots !== undefined) {
    if (b.spots === null || b.spots === '') next.spots = null;
    else { const n = Number(b.spots); if (!Number.isInteger(n) || n < 1 || n > 100000) throw bad('Founding spots must be a whole number from 1, or empty for no limit'); next.spots = n; }
  }
  if (b.show_spots !== undefined) next.show_spots = !!b.show_spots;
  if (next.show_countdown && !next.ends_at) throw bad('Set an end date before switching the countdown on');
  if (next.show_spots && next.spots == null) throw bad('Set the number of founding spots before showing them');
  for (const c of OFFER_CURRENCIES) {
    const v = b.countries?.[c]; if (!v) continue;
    if (v.percent !== undefined) next.countries[c].percent = pct(v.percent, c);
    if (v.months !== undefined) next.countries[c].months = mon(v.months, c);
  }
  if (next.on && !OFFER_CURRENCIES.some((c) => next.countries[c].percent > 0 && next.countries[c].months > 0)) throw bad('Set a discount and a number of months for at least one country before switching the offer on');
  if (next.on && !cur.on) next.started_at = sqlNow(); // a fresh start: only workspaces that pay for the first time from now on are eligible
  setSetting('launch_offer', JSON.stringify(next), { by });
  return getOffer();
}

/** Workspaces that became paying customers since the offer started (the founding customers so far). */
export function claimedSpots(o = getOffer()) {
  if (!o.started_at) return 0;
  return platformDb().prepare(`SELECT COUNT(*) n FROM (SELECT tenant_id, MIN(created_at) first FROM invoices WHERE status='paid' GROUP BY tenant_id) WHERE first >= ?`).get(o.started_at).n;
}
/** The offer if it is running right now, else null. */
export function activeOffer(now = new Date()) {
  const o = getOffer();
  if (!o.on) return null;
  if (o.ends_at && now.getTime() >= Date.parse(o.ends_at)) return null;
  if (o.spots != null && claimedSpots(o) >= o.spots) return null;
  return o;
}
export function offerFor(currency, now = new Date()) {
  const o = activeOffer(now); if (!o) return null;
  const c = o.countries[String(currency).toUpperCase()];
  return c && c.percent > 0 && c.months > 0 ? { percent: c.percent, months: c.months } : null;
}
const fill = (t, c) => String(t).replaceAll('{percent}', c.percent).replaceAll('{months}', c.months);

/** What the public landing page may show (no internal numbers). Spots and the end date appear only when the owner turned them on. */
export function publicOffer(now = new Date()) {
  const o = activeOffer(now);
  if (!o) return { on: false };
  const countries = {};
  for (const c of OFFER_CURRENCIES) { const f = offerFor(c, now); if (f) countries[c] = { ...f, banner: fill(o.banner_text, f) }; }
  return { on: Object.keys(countries).length > 0, button_text: o.button_text, countries, ends_at: o.show_countdown ? o.ends_at : null, spots_left: o.show_spots && o.spots != null ? Math.max(0, o.spots - claimedSpots(o)) : null };
}

/** The launch discount for one quote, or null. Used by commerce.quote(), the single place a plan price is computed. */
export function launchLine(tenant, plan, currency, interval, base, now = new Date()) {
  if (!plan?.launch_offer || interval !== 'month' || !tenant) return null;
  const f = offerFor(currency, now); if (!f) return null;
  const o = getOffer();
  const r = platformDb().prepare("SELECT COUNT(*) n, MIN(created_at) first FROM invoices WHERE tenant_id=? AND status='paid'").get(tenant.id);
  if (r.n > 0 && (r.first < o.started_at || r.n >= f.months)) return null; // an earlier customer, or the offer months are used up
  return { percent: f.percent, months: f.months, month_no: r.n + 1, amount: Math.round((base * f.percent) / 100) };
}
