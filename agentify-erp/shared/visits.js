// Property visits: the rules shared by the server, the app and the tests. Pure functions, no I/O.
//
// Time: a visit is fixed in its own IANA time zone (the appointment's `timezone`, else the workspace's). `starts_at` is
// the wall-clock time in that zone (as other appointments always stored it) and `starts_utc` is the same instant in UTC.
// Every check-in/out stamp is UTC from the server clock. Screens show the visit in its own zone, labelled, and add the
// viewer's own time when their zone differs.
//
// Distance: always metres internally; converted only for display.

export const VISIT_STATES = ['scheduled', 'in_progress', 'completed', 'canceled', 'no_show'];
/** Allowed moves. Completed, canceled and no-show are final. */
export const TRANSITIONS = {
  scheduled: ['in_progress', 'canceled', 'no_show'],
  in_progress: ['completed', 'no_show'],
  completed: [], canceled: [], no_show: [],
};
export const canMove = (from, to) => (TRANSITIONS[from] || []).includes(to);
/** Older rows and some clients spell it the British way. */
export const normState = (s) => (s === 'cancelled' ? 'canceled' : s);

export const OUTCOMES = ['interested', 'not_interested', 'offer_expected', 'second_visit', 'needs_info', 'other'];

/** How a location reading is classified on the server. Only `verified` counts as a captured location. */
export const LOCATION_STATES = ['verified', 'stale', 'denied', 'unavailable', 'manual'];

export const VISIT_DEFAULTS = Object.freeze({
  proximity_m: 200, // "near" radius around the property's saved coordinates
  max_fix_age_s: 120, // a reading older than this when it reaches the server is "stale"
  manual_exception: false, // let agents record a check-in without a location, with a reason
  retention_days: 0, // 0 keeps coordinates as long as the visit; otherwise coordinates are cleared after N days
});

// ---- time zones (DST-safe: offsets are looked up for the instant, never fixed)
export function validTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
function offsetMs(tz, atMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(atMs)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - atMs;
}
/**
 * Wall-clock 'YYYY-MM-DD HH:MM[:SS]' in `tz` -> epoch ms. A time that does not exist (the spring-forward gap) moves
 * forward by the gap; a time that happens twice (fall-back) takes the first occurrence (`later` takes the second, for
 * an end time). Returns NaN for bad input.
 */
export function wallToMs(wall, tz, { later = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(wall || '').trim());
  if (!m || !validTimeZone(tz)) return NaN;
  const w = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const first = w - offsetMs(tz, w - 12 * 3600e3); // offset before any switch that day
  const second = w - offsetMs(tz, w + 12 * 3600e3); // offset after it
  const ok = (ms) => msToWall(ms, tz) === msToWall(w, 'UTC');
  if (ok(first) && ok(second)) return later ? Math.max(first, second) : Math.min(first, second);
  if (ok(first)) return first;
  if (ok(second)) return second;
  return Math.max(first, second); // in the gap: same face value, later offset
}
export function msToWall(ms, tz) {
  return new Date(ms + offsetMs(tz, ms)).toISOString().slice(0, 19).replace('T', ' ');
}
export const toUtcIso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** Short zone name at that instant, e.g. EDT / GMT+4 / BST. */
export function zoneLabel(tz, atMs = Date.now(), locale = 'en-US') {
  try { return new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(atMs)).find((p) => p.type === 'timeZoneName')?.value || tz; } catch { return tz; }
}

// ---- distance
export function haversineM(a, b) {
  const R = 6371008.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const validCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/**
 * Near / far / uncertain relative to the radius, taking the reading's accuracy into account. A GPS reading never
 * proves someone was there; this is an indicator only.
 */
export function proximity(distanceM, accuracyM, radiusM) {
  if (!Number.isFinite(distanceM)) return 'unknown';
  const acc = Number.isFinite(accuracyM) ? Math.max(0, accuracyM) : 0;
  if (distanceM + acc <= radiusM) return 'near';
  if (distanceM - acc > radiusM) return 'far';
  return distanceM <= radiusM ? 'near_uncertain' : 'uncertain';
}

/**
 * Metres -> "350 m" / "1.2 km" / "800 ft" / "1.4 mi", numbers in the viewer's locale. `unit` is the region pack's
 * `distance_unit` ('km' or 'mi'), which is separate from its area units (Canada lists sq ft but drives in km).
 */
export function formatDistance(m, { unit = 'km', locale = 'en' } = {}) {
  if (!Number.isFinite(m)) return '—';
  const n = (v, d) => new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(v);
  if (unit === 'mi') {
    const ft = m / 0.3048;
    return ft < 1000 ? `${n(Math.round(ft / 10) * 10, 0)} ft` : `${n(m / 1609.344, 1)} mi`;
  }
  return m < 1000 ? `${n(Math.round(m / 5) * 5, 0)} m` : `${n(m / 1000, 1)} km`;
}

/**
 * Classify a reading sent with a check-in/out. `reading` is what the device reported:
 *   { status: 'captured' | 'denied' | 'unavailable' | 'manual', lat, lng, accuracy, captured_at (ISO), reason }
 * Returns what is stored. Coordinates are kept only for captured readings; a manual exception keeps none.
 */
export function classifyReading(reading, { serverMs, maxAgeS = VISIT_DEFAULTS.max_fix_age_s, manualAllowed = false } = {}) {
  const r = reading || {};
  const st = String(r.status || '');
  if (st === 'manual') {
    if (!manualAllowed) return { error: 'Manual check-in without a location is not allowed in this workspace.' };
    const reason = String(r.reason || '').trim();
    if (reason.length < 3) return { error: 'Give a reason for the manual check-in.' };
    return { location_status: 'manual', manual_reason: reason.slice(0, 300) };
  }
  if (st === 'denied' || st === 'unavailable') return { location_status: st };
  if (st !== 'captured') return { error: 'Say whether a location was captured.' };
  const lat = Number(r.lat), lng = Number(r.lng), acc = Number(r.accuracy);
  if (!validCoord(lat, lng)) return { location_status: 'unavailable' };
  const cap = Date.parse(String(r.captured_at || ''));
  const out = { lat, lng, accuracy_m: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null, captured_at: Number.isFinite(cap) ? toUtcIso(cap) : null };
  const age = Number.isFinite(cap) ? (serverMs - cap) / 1000 : Infinity;
  // stale: too old when it arrived, missing its capture time, or stamped in the future (device clock off)
  out.location_status = age > maxAgeS || age < -60 ? 'stale' : 'verified';
  return out;
}
