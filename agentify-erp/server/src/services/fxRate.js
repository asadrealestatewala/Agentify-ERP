// USD -> rupee rate for showing AI cost in the owner's display currency (setting ai_display_currency, rupees by default). Gemini and Azure bill in US dollars; the rupee figure is for display only.
// Order of use: the manual override when "live rate" is switched off, else the latest live rate (refreshed at most once a day),
// else the manual override, else a built-in fallback that is flagged so the console can say the rate is not live.
import { platformDb } from '../platform.js';
import { getSetting, setSetting } from './platformConfig.js';
import { saveFx } from '../regions/admin.js';
import { bad } from '../util.js';

export const FALLBACK_RATE = 280;
export const displayCurrency = () => getSetting('ai_display_currency') || 'PKR';
const RATE_URL = 'https://open.er-api.com/v6/latest/USD';
const STALE_MS = 24 * 3600_000;

const liveOn = () => getSetting('ai_fx_live') !== '0';
const manual = () => { const v = Number(getSetting('ai_fx_manual')); return v > 0 ? { rate: v, at: getSetting('ai_fx_manual_at') || null } : null; };
const latestLive = () => {
  const r = platformDb().prepare("SELECT rate_ppm FROM fx_rates WHERE base='USD' AND quote=? AND source='live' ORDER BY as_of DESC LIMIT 1").get(displayCurrency());
  return r?.rate_ppm ? { rate: r.rate_ppm / 1e6, at: getSetting('ai_fx_live_at') || null } : null;
};

/** The rate in force right now: { rate, source: 'live' | 'manual' | 'fallback', updated_at, live_enabled }. */
export function getRate() {
  const live = liveOn(), m = manual(), l = latestLive();
  const pick = live ? (l && { ...l, source: 'live' }) || (m && { ...m, source: 'manual' }) : (m && { ...m, source: 'manual' }) || (l && { ...l, source: 'live' });
  const r = pick || { rate: FALLBACK_RATE, at: null, source: 'fallback' };
  return { rate: r.rate, source: r.source, updated_at: r.at, live_enabled: live };
}

/** Fetches the live rate and stores it. Returns the stored rate; throws a plain message when the source cannot be reached. */
export async function refreshLive() {
  let d;
  try {
    const res = await fetch(RATE_URL, { signal: AbortSignal.timeout(15_000) });
    d = await res.json();
    if (!res.ok) throw new Error(`rate service answered ${res.status}`);
  } catch (e) { throw bad(`Could not fetch the live dollar rate: ${e.message}`); }
  const cur = displayCurrency();
  const rate = Number(d?.rates?.[cur]);
  if (!(rate > 0 && rate < 1e6)) throw bad(`The rate service returned an unusable USD to ${cur} rate.`);
  const at = new Date().toISOString();
  saveFx(platformDb(), { base: 'USD', quote: cur, rate, source: 'live' }, 'system');
  setSetting('ai_fx_live_at', at);
  return rate;
}

let inflight = null;
/** Refreshes the live rate in the background when it is older than a day. Never throws and never blocks an AI call. */
export function refreshIfStale() {
  if (!liveOn() || inflight) return;
  const at = Date.parse(getSetting('ai_fx_live_at') || '');
  if (Number.isFinite(at) && Date.now() - at < STALE_MS) return;
  inflight = refreshLive().catch(() => {}).finally(() => { inflight = null; });
}

/** Console: set or clear the manual rate and the live toggle. */
export function saveFxSettings(b, by) {
  if ('live' in b) setSetting('ai_fx_live', b.live ? '1' : '0', { by });
  if ('manual_rate' in b) {
    if (b.manual_rate === '' || b.manual_rate == null) { setSetting('ai_fx_manual', null, { by }); setSetting('ai_fx_manual_at', null, { by }); }
    else {
      const n = Number(b.manual_rate);
      if (!(n > 0 && n < 1e6)) throw bad('Enter the rupees you get for one US dollar, for example 280.');
      setSetting('ai_fx_manual', String(n), { by }); setSetting('ai_fx_manual_at', new Date().toISOString(), { by });
    }
  }
  return getRate();
}
