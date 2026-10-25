// Field-agent location sharing: explicit, employee-started sharing of a last-known position, never a route history.
//
// Rules this module enforces (the routes in routes/field.js only call into it):
// * Off for the whole workspace until an admin turns it on, and off for each employee until they accept the current
//   notice. A browser/phone permission is only a technical permission; the accepted notice is what we record.
// * One row per employee (field_agents) holds the latest reading only. A new reading overwrites the old one, nothing is
//   appended, and readings older than the retention period are wiped by purgeFieldLocations().
// * Foreground sharing is bound to a session id the app creates when the employee presses Share. Stopping, logging out,
//   withdrawing consent or the session going quiet ends it, and a late or replayed ping for an ended session is refused.
// * All times here are UTC ISO strings (Date#toISOString); the app shows them in the workspace's timezone.
import crypto from 'node:crypto';
import { all, get, run, getSetting, setSetting } from '../db.js';
import { hasPerm } from '../rbac.js';
import { employeeOf } from './hr.js';
import { HttpError, bad, forbidden, jparse } from '../util.js';

export { FIELD_SCHEMA } from '../fieldSchema.js';


export const AVAILABILITY = ['available', 'busy', 'on_break', 'off_duty', 'unknown'];
export const LOCATION_ERRORS = ['denied', 'unavailable', 'timeout', 'unsupported'];
export const MAP_PROVIDERS = ['osm_embed', 'none'];

export const DEFAULT_NOTICE = 'When you choose to share, your manager and HR can see your last shared location, when it was taken and how accurate it was. '
  + 'Nothing is shared until you press Share. One-time sharing sends a single reading; "Share while the app is open" sends a reading every few minutes '
  + 'only while this app is open on your screen, and stops when you press Stop sharing, sign out or close the app. No route history is kept and nothing is '
  + 'collected in the background. Your last location is deleted automatically after the retention period. You can stop and withdraw at any time.';

export const DEFAULTS = Object.freeze({
  enabled: false, foreground_allowed: true, interval_seconds: 120, fresh_minutes: 10, stale_minutes: 60, retention_days: 30,
  map_provider: 'osm_embed', notice: DEFAULT_NOTICE, notice_version: 1,
});

const clampInt = (v, lo, hi, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

export function fieldSettings() {
  const s = { ...DEFAULTS, ...jparse(getSetting('field_location'), {}) };
  return {
    enabled: s.enabled === true, foreground_allowed: s.foreground_allowed !== false,
    interval_seconds: clampInt(s.interval_seconds, 30, 1800, DEFAULTS.interval_seconds),
    fresh_minutes: clampInt(s.fresh_minutes, 1, 240, DEFAULTS.fresh_minutes),
    stale_minutes: Math.max(clampInt(s.stale_minutes, 2, 1440, DEFAULTS.stale_minutes), clampInt(s.fresh_minutes, 1, 240, DEFAULTS.fresh_minutes) + 1),
    retention_days: clampInt(s.retention_days, 1, 365, DEFAULTS.retention_days),
    map_provider: MAP_PROVIDERS.includes(s.map_provider) ? s.map_provider : DEFAULTS.map_provider,
    notice: String(s.notice || DEFAULT_NOTICE).slice(0, 4000), notice_version: clampInt(s.notice_version, 1, 1e6, 1),
  };
}

/** Save admin changes. Changing the notice text bumps its version, so every employee has to read and accept it again. */
export function saveFieldSettings(body = {}) {
  const cur = fieldSettings();
  const next = { ...cur };
  if ('enabled' in body) next.enabled = body.enabled === true || body.enabled === 'true' || body.enabled === 1;
  if ('foreground_allowed' in body) next.foreground_allowed = !!body.foreground_allowed && body.foreground_allowed !== 'false';
  for (const [k, lo, hi] of [['interval_seconds', 30, 1800], ['fresh_minutes', 1, 240], ['stale_minutes', 2, 1440], ['retention_days', 1, 365]]) {
    if (!(k in body)) continue;
    const n = Math.trunc(Number(body[k]));
    if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}`);
    next[k] = n;
  }
  if (next.stale_minutes <= next.fresh_minutes) throw bad('"Stale after" must be longer than "fresh for"');
  if ('map_provider' in body) {
    if (!MAP_PROVIDERS.includes(body.map_provider)) throw bad('Unknown map option');
    next.map_provider = body.map_provider;
  }
  if ('notice' in body) {
    const text = String(body.notice || '').trim();
    if (text.length < 40) throw bad('The employee notice must explain what is shared (at least 40 characters)');
    if (text !== cur.notice) { next.notice = text.slice(0, 4000); next.notice_version = cur.notice_version + 1; }
  }
  setSetting('field_location', JSON.stringify(next));
  if (!next.enabled && cur.enabled) run("UPDATE field_agents SET sharing='off', sharing_session=NULL WHERE sharing<>'off'");
  return fieldSettings();
}

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const rowOf = (uid) => get('SELECT * FROM field_agents WHERE user_id=?', uid);
function ensureRow(uid) {
  run('INSERT INTO field_agents(user_id,updated_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING', uid, iso());
  return rowOf(uid);
}

export function consentOf(uid, s = fieldSettings()) {
  const c = get('SELECT * FROM field_consents WHERE user_id=?', uid);
  const active = !!c && !c.withdrawn_at;
  return { accepted: active && c.notice_version === s.notice_version, needs_reaccept: active && c.notice_version !== s.notice_version,
    accepted_at: c?.accepted_at || null, withdrawn_at: c?.withdrawn_at || null, notice_version: c?.notice_version ?? null };
}

const requireEnabled = (s) => { if (!s.enabled) throw new HttpError(403, 'Location sharing is turned off for this workspace.', { code: 'field_location_disabled' }); };
function requireConsent(uid, s) {
  const c = consentOf(uid, s);
  if (!c.accepted) throw new HttpError(403, c.needs_reaccept ? 'The location notice changed. Read and accept it again before sharing.' : 'Read and accept the location notice before sharing.', { code: 'consent_required' });
}

export function acceptNotice(uid, version) {
  const s = fieldSettings();
  requireEnabled(s);
  if (Number(version) !== s.notice_version) throw new HttpError(409, 'The notice was updated. Read the current version and accept again.', { code: 'notice_changed', notice_version: s.notice_version });
  run(`INSERT INTO field_consents(user_id,notice_version,accepted_at,withdrawn_at) VALUES(?,?,?,NULL)
    ON CONFLICT(user_id) DO UPDATE SET notice_version=excluded.notice_version, accepted_at=excluded.accepted_at, withdrawn_at=NULL`, uid, s.notice_version, iso());
  ensureRow(uid);
  return consentOf(uid, s);
}

/** Withdraw: stop sharing and delete the stored location straight away (availability and service area stay). */
export function withdrawConsent(uid) {
  run('UPDATE field_consents SET withdrawn_at=? WHERE user_id=? AND withdrawn_at IS NULL', iso(), uid);
  run(`UPDATE field_agents SET sharing='off', sharing_session=NULL, lat=NULL, lng=NULL, accuracy_m=NULL, captured_at=NULL, received_at=NULL, source=NULL, updated_at=? WHERE user_id=?`, iso(), uid);
  return consentOf(uid);
}

const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;
export function startForeground(uid) {
  const s = fieldSettings();
  requireEnabled(s);
  if (!s.foreground_allowed) throw new HttpError(403, 'This workspace allows one-time sharing only.', { code: 'foreground_not_allowed' });
  requireConsent(uid, s);
  ensureRow(uid);
  const session = crypto.randomBytes(18).toString('base64url');
  run("UPDATE field_agents SET sharing='foreground', sharing_session=?, sharing_started_at=?, updated_at=? WHERE user_id=?", session, iso(), iso(), uid);
  return { session, interval_seconds: s.interval_seconds };
}

/** Stop foreground sharing. Safe to call any number of times (logout, Stop button, tab switch to another tenant). */
export function stopSharing(uid) {
  run("UPDATE field_agents SET sharing='off', sharing_session=NULL, updated_at=? WHERE user_id=? AND sharing<>'off'", iso(), uid);
}

/**
 * Store one reading as the employee's last-known location. `body`: lat, lng, accuracy (metres), captured_at (ISO, from the
 * device), mode ('once' | 'foreground'), session (foreground only) and uid (the user the app started sharing as).
 */
export function submitLocation(uid, body = {}, nowMs = Date.now()) {
  const s = fieldSettings();
  requireEnabled(s);
  requireConsent(uid, s);
  if (body.uid != null && Number(body.uid) !== uid) throw new HttpError(409, 'This reading was started by another sign-in and was not saved.', { code: 'session_mismatch' });
  const mode = body.mode === 'foreground' ? 'foreground' : 'once';
  const row = ensureRow(uid);
  if (mode === 'foreground') {
    if (!s.foreground_allowed) throw new HttpError(403, 'This workspace allows one-time sharing only.', { code: 'foreground_not_allowed' });
    if (row.sharing !== 'foreground' || !SESSION_RE.test(String(body.session || '')) || body.session !== row.sharing_session) {
      throw new HttpError(409, 'Sharing was stopped, so this reading was not saved.', { code: 'sharing_stopped' });
    }
  }
  const lat = Number(body.lat), lng = Number(body.lng), acc = Number(body.accuracy);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) throw bad('Latitude/longitude are out of range');
  if (lat === 0 && lng === 0) throw bad('The device did not return a real position');
  if (!Number.isFinite(acc) || acc <= 0 || acc > 100000) throw bad('The device did not report how accurate the reading is');
  const cap = Date.parse(String(body.captured_at || ''));
  if (!Number.isFinite(cap)) throw bad('captured_at is required (when the device took the reading)');
  if (cap > nowMs + 2 * 60_000) throw bad('The reading is dated in the future. Check the phone\'s clock.');
  if (nowMs - cap > s.fresh_minutes * 60_000) throw new HttpError(422, `The reading is older than ${s.fresh_minutes} minutes and was not saved. Share again for a fresh one.`, { code: 'reading_too_old' });
  // never let an older reading (a delayed retry) replace a newer one
  if (row.captured_at && Date.parse(row.captured_at) >= cap) return { ok: true, ignored: 'older_than_current', status: statusFor(rowOf(uid), s, nowMs) };
  run(`UPDATE field_agents SET lat=?, lng=?, accuracy_m=?, captured_at=?, received_at=?, source=?, last_error=NULL, last_error_at=NULL, updated_at=? WHERE user_id=?`,
    Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, Math.round(acc * 10) / 10, iso(cap), iso(nowMs), mode, iso(nowMs), uid);
  return { ok: true, status: statusFor(rowOf(uid), s, nowMs) };
}

/** The device refused or could not give a position: remember that, separately from any real reading. */
export function reportLocationError(uid, code) {
  const s = fieldSettings();
  requireEnabled(s);
  if (!LOCATION_ERRORS.includes(code)) throw bad('Unknown location error');
  ensureRow(uid);
  run('UPDATE field_agents SET last_error=?, last_error_at=?, updated_at=? WHERE user_id=?', code, iso(), iso(), uid);
  if (code === 'denied' || code === 'unsupported') stopSharing(uid);
  return { ok: true };
}

export function setAvailability(uid, availability) {
  if (!AVAILABILITY.includes(availability)) throw bad(`Availability must be one of: ${AVAILABILITY.join(', ')}`);
  ensureRow(uid);
  run('UPDATE field_agents SET availability=?, availability_at=?, updated_at=? WHERE user_id=?', availability, iso(), iso(), uid);
  return { availability };
}

export function setServiceArea(uid, area) {
  const text = String(area ?? '').trim().slice(0, 200) || null;
  ensureRow(uid);
  run('UPDATE field_agents SET service_area=?, updated_at=? WHERE user_id=?', text, iso(), uid);
  return { service_area: text };
}

/** Freshness is about the reading only. Availability is the employee's own status and is reported next to it, never mixed in. */
export function freshnessOf(capturedAt, s = fieldSettings(), nowMs = Date.now()) {
  if (!capturedAt) return { freshness: 'none', age_minutes: null };
  const age = Math.max(0, (nowMs - Date.parse(capturedAt)) / 60_000);
  return { freshness: age <= s.fresh_minutes ? 'fresh' : age <= s.stale_minutes ? 'recent' : 'stale', age_minutes: Math.round(age) };
}

function statusFor(row, s, nowMs = Date.now()) {
  if (!row) return { sharing: 'off', availability: 'unknown', location: null, freshness: 'none', age_minutes: null, last_error: null };
  const loc = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng, accuracy_m: row.accuracy_m, captured_at: row.captured_at, received_at: row.received_at, source: row.source } : null;
  return { sharing: row.sharing, sharing_started_at: row.sharing === 'off' ? null : row.sharing_started_at, availability: row.availability, availability_at: row.availability_at,
    service_area: row.service_area, location: loc, ...freshnessOf(loc?.captured_at, s, nowMs), last_error: row.last_error, last_error_at: row.last_error_at };
}

export function myStatus(uid) {
  const s = fieldSettings();
  return { settings: { enabled: s.enabled, foreground_allowed: s.foreground_allowed, interval_seconds: s.interval_seconds, fresh_minutes: s.fresh_minutes,
    stale_minutes: s.stale_minutes, retention_days: s.retention_days, notice: s.notice, notice_version: s.notice_version },
  consent: consentOf(uid, s), status: statusFor(rowOf(uid), s) };
}

/**
 * Who the signed-in user may see: everyone for HR (hrm:view) and Super Admin, otherwise the people in their reporting
 * line (direct and indirect reports, via employees.manager_id). Customers and vendors never get here (requireStaff).
 */
export function teamScope(user) {
  if (hasPerm(user, 'hrm', 'view')) return { all: true, ids: null };
  const mine = employeeOf(user);
  if (!mine) return { all: false, ids: [] };
  const ids = all(`WITH RECURSIVE r(id) AS (SELECT id FROM employees WHERE manager_id=? UNION SELECT e.id FROM employees e JOIN r ON e.manager_id=r.id)
    SELECT DISTINCT e.user_id FROM employees e JOIN r ON r.id=e.id WHERE e.user_id IS NOT NULL AND e.user_id<>?`, mine.id, user.id).map((x) => x.user_id);
  return { all: false, ids };
}
export const canSeeAgent = (user, agentId) => { const sc = teamScope(user); return sc.all || sc.ids.includes(Number(agentId)); };

export function teamList(user, nowMs = Date.now()) {
  const s = fieldSettings();
  const sc = teamScope(user);
  if (!sc.all && !sc.ids.length) return { scope: 'none', settings: publicSettings(s), agents: [] };
  const where = sc.all ? '' : `AND u.id IN (${sc.ids.map(() => '?').join(',')})`;
  const rows = all(`SELECT fa.*, u.id user_id, u.name, r.name role, e.designation, e.department, e.branch, fc.notice_version consent_version, fc.withdrawn_at consent_withdrawn
    FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.user_id=u.id LEFT JOIN field_agents fa ON fa.user_id=u.id LEFT JOIN field_consents fc ON fc.user_id=u.id
    WHERE u.active=1 AND r.portal=0 ${where} ORDER BY u.name`, ...(sc.all ? [] : sc.ids));
  const agents = rows.map((r) => {
    const st = statusFor(r.updated_at ? r : null, s, nowMs);
    const consented = r.consent_version != null && !r.consent_withdrawn;
    return { user_id: r.user_id, name: r.name, role: r.role, designation: r.designation, department: r.department, branch: r.branch,
      service_area: r.service_area || null, consent: consented ? (r.consent_version === s.notice_version ? 'accepted' : 'needs_reaccept') : 'not_given', ...st };
  });
  return { scope: sc.all ? 'all' : 'reports', settings: publicSettings(s), agents };
}
const publicSettings = (s) => ({ enabled: s.enabled, foreground_allowed: s.foreground_allowed, fresh_minutes: s.fresh_minutes, stale_minutes: s.stale_minutes,
  retention_days: s.retention_days, map_provider: s.map_provider, interval_seconds: s.interval_seconds });

/**
 * Background clean-up (runs with the other tenant jobs): delete readings older than the retention period and end
 * foreground sessions whose app went quiet (closed, crashed or lost signal) so nobody looks "live" when they are not.
 */
export function purgeFieldLocations(nowMs = Date.now()) {
  const s = fieldSettings();
  const cutoff = iso(nowMs - s.retention_days * 864e5);
  const purged = run(`UPDATE field_agents SET lat=NULL, lng=NULL, accuracy_m=NULL, captured_at=NULL, received_at=NULL, source=NULL WHERE captured_at IS NOT NULL AND captured_at < ?`, cutoff).changes;
  const quiet = iso(nowMs - Math.max(s.stale_minutes * 60_000, s.interval_seconds * 3000));
  const ended = run(`UPDATE field_agents SET sharing='off', sharing_session=NULL WHERE sharing='foreground' AND COALESCE(received_at, sharing_started_at, '') < ?`, quiet).changes;
  return { purged, ended };
}

export const _forbiddenUnlessVisible = (user, agentId) => { if (!canSeeAgent(user, agentId)) throw forbidden('This employee is not in your team'); };
