export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

// ---- offline queue: small field actions are kept on the phone and replayed when the signal returns ----
const QKEY = 'erp-offline-queue';
const QUEUEABLE = [['POST', /^\/api\/notes$/], ['POST', /^\/api\/contacts$/], ['POST', /^\/api\/tasks$/], ['PUT', /^\/api\/tasks\/\d+$/],
  ['POST', /^\/api\/hrm\/attendance(\/bulk)?$/], ['POST', /^\/api\/staff\/work-tasks$/], ['PUT', /^\/api\/staff\/work-tasks\/\d+$/]];
const canQueue = (method, url) => QUEUEABLE.some(([m, re]) => m === method && re.test(url));
export const readQueue = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const writeQueue = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* storage full or blocked */ } window.dispatchEvent(new Event('erp:queue')); };
// Each queued item records who saved it (user id, staff or portal) and on which workspace address. A shared phone can switch
// users while offline, so only the signed-in user's own items are replayed; the others wait for their owner to sign in again.
let owner = null; // { uid, host } of the signed-in user, or null when nobody is signed in
const hostNow = () => (typeof location === 'undefined' ? '' : location.host);
const isMine = (item) => !!owner && item.uid === owner.uid && item.host === owner.host;
/** Actions waiting on this device for the signed-in user. */
export const myQueue = () => readQueue().filter(isMine);
/** Called whenever the signed-in user is known (or gone). Replays that user's saved actions. */
export function setQueueOwner(user) {
  owner = user && user.id != null ? { uid: `${user.portal ? 'portal' : 'staff'}:${user.id}`, host: hostNow() } : null;
  window.dispatchEvent(new Event('erp:queue'));
  if (owner) flushQueue();
}
let flushing = false;
/**
 * Replay the signed-in user's queued actions in order. Network failures stop the run (retry later); server rejections are
 * dropped and reported. Items saved before items were stamped with their owner cannot be told apart, so they are dropped
 * unsent (reported as failed) rather than risk sending them as someone else.
 */
export async function flushQueue() {
  if (flushing || !owner) return { sent: 0, failed: [] };
  const legacy = readQueue().filter((x) => !x.uid || !x.host);
  const failed = legacy.map((x) => ({ ...x, error: 'An action saved on this device before an update was discarded because it did not record who saved it' }));
  if (legacy.length) writeQueue(readQueue().filter((x) => x.uid && x.host));
  if (!myQueue().length) {
    if (failed.length) window.dispatchEvent(new CustomEvent('erp:synced', { detail: { sent: 0, failed } }));
    return { sent: 0, failed };
  }
  flushing = true;
  let sent = 0;
  try {
    for (const item of myQueue()) {
      if (!isMine(item)) break; // signed-in user changed mid-run
      try {
        const res = await fetch(item.url, { method: item.method, headers: { 'X-Requested-With': 'ERP', 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(item.body) });
        if (res.status === 401) break;
        if (!res.ok) { let m = `Request failed (${res.status})`; try { m = (await res.json()).error || m; } catch { /* ignore */ } failed.push({ ...item, error: m }); }
        else sent += 1;
        writeQueue(readQueue().filter((x) => x.id !== item.id));
      } catch { break; } // still offline
    }
  } finally { flushing = false; }
  if (sent || failed.length) window.dispatchEvent(new CustomEvent('erp:synced', { detail: { sent, failed } }));
  return { sent, failed };
}
if (typeof window !== 'undefined') window.addEventListener('online', () => flushQueue());

async function request(method, url, body, isForm) {
  const headers = { 'X-Requested-With': 'ERP' };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, credentials: 'same-origin', keepalive: !isForm, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  } catch (e) {
    // no connection: keep field actions for later instead of losing them
    if (!isForm && owner && canQueue(method, url)) {
      writeQueue([...readQueue(), { id: Date.now() + Math.random(), uid: owner.uid, host: owner.host, method, url, body, at: new Date().toISOString() }]);
      return { queued: true, offline: true };
    }
    throw new ApiError('You appear to be offline. Check your connection and try again.', 0);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/')) window.dispatchEvent(new Event('erp:unauthorized'));
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

/** Build a query string, skipping empty values. */
export function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, formData) => request('POST', url, formData, true),
};

/** Authenticated download of exports (xlsx/csv) — fetch as blob so cookies + CSRF header apply. */
export async function download(url, params, filename) {
  const res = await fetch(url + qs(params), { credentials: 'same-origin', headers: { 'X-Requested-With': 'ERP' } });
  if (!res.ok) {
    let msg = 'Export failed';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const fileUrl = (path) => (path ? `/uploads/${path}` : null);

/** POST then save the response as a file (e.g. assistant PDF report). */
export async function downloadPost(url, body, filename) {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'ERP', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = 'Download failed';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
