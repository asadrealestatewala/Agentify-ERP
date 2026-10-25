// Location sharing controller for the signed-in employee (see server/src/services/fieldLocation.js).
//
// * Nothing runs until the employee presses a Share button. There is no background collection: foreground sharing only
//   reads the position while this page is visible, and the session lives in memory, so closing or reloading the app ends it.
// * A session is bound to the user it was started for. If the signed-in user changes (logout, another account, another
//   workspace) the loop stops before it can send anything, and the server refuses any ping for an ended session.
// * Readings are never queued offline: a missed reading is simply skipped, so nothing is replayed later under another
//   session, and the capture time sent is the device's own timestamp for that reading.
import { api, ApiError } from './api.js';
import { getRegion } from './format.js';
import { getLanguage } from './i18n.js';

const listeners = new Set();
let state = { mode: 'off', session: null, uid: null, interval: 120, lastSent: null, lastError: null, busy: false };
let timer = null;

const emit = () => listeners.forEach((fn) => fn(state));
const set = (patch) => { state = { ...state, ...patch }; emit(); };
export const getSharing = () => state;
export function subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }

const ERR = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
export const ERROR_TEXT = {
  denied: 'Location permission is blocked for this app. Allow it in the browser or phone settings, then try again.',
  unavailable: 'Your device could not find a position right now (no GPS or network fix).',
  timeout: 'Finding your position took too long. Move to an open area and try again.',
  unsupported: 'This browser or device does not support location.',
};

function readPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(Object.assign(new Error(ERROR_TEXT.unsupported), { code: 'unsupported' })); return; }
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(Object.assign(new Error(ERROR_TEXT[ERR[e.code]] || e.message), { code: ERR[e.code] || 'unavailable' })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  });
}

const bodyFor = (pos, extra) => ({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, captured_at: new Date(pos.timestamp || Date.now()).toISOString(), ...extra });

async function reportError(code) { try { await api.post('/api/field/me/location-error', { code }); } catch { /* best effort */ } }

/** Send a single reading now. Returns the server's status, or throws with a readable message. */
export async function shareOnce(uid) {
  set({ busy: true, lastError: null });
  try {
    const pos = await readPosition();
    const r = await api.post('/api/field/me/location', bodyFor(pos, { mode: 'once', uid }));
    set({ lastSent: new Date().toISOString() });
    return r;
  } catch (e) {
    if (e.code) await reportError(e.code);
    set({ lastError: e.message });
    throw e;
  } finally { set({ busy: false }); }
}

async function tick() {
  const { mode, session, uid } = state;
  if (mode !== 'foreground' || !session) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return; // never in the background
  try {
    const pos = await readPosition();
    if (state.session !== session) return; // stopped while the GPS was working
    await api.post('/api/field/me/location', bodyFor(pos, { mode: 'foreground', session, uid }));
    set({ lastSent: new Date().toISOString(), lastError: null });
  } catch (e) {
    if (state.session !== session) return;
    if (e instanceof ApiError && [401, 403, 409].includes(e.status)) { stopLocal(e.status === 401 ? 'Signed out, sharing stopped.' : e.message); return; }
    if (e.code) { await reportError(e.code); if (e.code === 'denied' || e.code === 'unsupported') { stopLocal(e.message); return; } }
    set({ lastError: e.message }); // offline or a one-off GPS miss: skip this reading, try again next time
  }
}

const onVisible = () => { if (document.visibilityState === 'visible') tick(); };

function stopLocal(reason = null) {
  if (timer) clearInterval(timer);
  timer = null;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  set({ mode: 'off', session: null, lastError: reason });
}

export async function startForeground(uid) {
  set({ busy: true, lastError: null });
  try {
    const pos = await readPosition(); // ask for the device permission first, before telling the server anything
    const r = await api.post('/api/field/me/sharing', { mode: 'foreground' });
    stopLocal();
    set({ mode: 'foreground', session: r.session, uid, interval: r.interval_seconds || 120 });
    await api.post('/api/field/me/location', bodyFor(pos, { mode: 'foreground', session: r.session, uid })).then(() => set({ lastSent: new Date().toISOString() })).catch(() => {});
    timer = setInterval(tick, Math.max(30, state.interval) * 1000);
    document.addEventListener('visibilitychange', onVisible);
    return r;
  } catch (e) {
    if (e.code) await reportError(e.code);
    set({ lastError: e.message });
    throw e;
  } finally { set({ busy: false }); }
}

/** Stop button: end the loop here and on the server. */
export async function stopSharing() {
  stopLocal();
  try { await api.post('/api/field/me/sharing', { mode: 'off' }); } catch { /* the server also ends quiet sessions on its own */ }
}

/**
 * Called whenever the signed-in user is known (or gone). A different user, or none, ends any session at once without a
 * network call that could carry the new user's cookie.
 */
export function bindUser(uid) {
  if (state.mode !== 'off' && state.uid !== uid) stopLocal();
  if (state.uid !== uid) set({ uid, lastSent: null, lastError: null });
}

// ---- display helpers (UTC from the server, shown in the workspace timezone; distances stored in metres)
export function whenText(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Intl.DateTimeFormat(getLanguage() || 'en', { timeZone: getRegion().config.timezone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(isoStr));
  } catch { return new Date(isoStr).toLocaleString(); }
}
export function accuracyText(m) {
  if (m == null) return '—';
  if (getRegion().config.units_system === 'imperial') return `±${Math.round(m * 3.28084).toLocaleString()} ft`;
  return m >= 1000 ? `±${(m / 1000).toFixed(1)} km` : `±${Math.round(m)} m`;
}
export function ageText(min) {
  if (min == null) return '';
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} d ago`;
}
export const FRESH_TONE = { fresh: 'green', recent: 'amber', stale: 'red', none: 'grey' };
export const FRESH_LABEL = { fresh: 'Fresh', recent: 'Recent', stale: 'Stale', none: 'No location' };
export const AVAIL_LABEL = { available: 'Available', busy: 'Busy', on_break: 'On break', off_duty: 'Off duty', unknown: 'Not set' };
export const AVAIL_TONE = { available: 'green', busy: 'amber', on_break: 'blue', off_duty: 'grey', unknown: 'grey' };
