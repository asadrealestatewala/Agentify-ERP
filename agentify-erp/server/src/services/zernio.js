// Zernio (zernio.com): the one place that talks to the posting service. A workspace's posts are published to Facebook and Instagram
// through the connected accounts of its Zernio profile. Two billing modes (console setting `zernio_mode`):
//   workspace - (default) the workspace pastes its own Zernio key and Zernio bills it directly; automatic posting is optional and the workspace switches it on itself
//   platform  - Agentify's own Zernio key, one profile per workspace (Agentify pays Zernio and recovers it in plan prices)
// Keys are stored encrypted and are never returned to a browser, written to a log, or put in an error message.
import { getSetting as platformGet, setSetting as platformSet, encrypt, decrypt } from './platformConfig.js';
import { getSetting, setSetting } from '../db.js';
import { currentTenant } from '../context.js';
import { bad, HttpError } from '../util.js';

export const BASE = () => (process.env.ZERNIO_API_BASE || 'https://zernio.com/api/v1').replace(/\/+$/, '');
export const PLATFORMS = { facebook: 'Facebook', instagram: 'Instagram' }; // later stages: YouTube, LinkedIn profiles, TikTok
const KEY_RE = /^sk_[A-Za-z0-9_-]{16,128}$/;
export const validKey = (k) => KEY_RE.test(String(k || '').trim());

export const mode = () => (platformGet('zernio_mode') === 'platform' ? 'platform' : 'workspace'); // default: each workspace connects its own Zernio account and pays Zernio directly
export const platformKey = () => platformGet('zernio_api_key');
export function workspaceKey() { const v = getSetting('zernio_key_enc'); if (!v) return null; try { return decrypt(v); } catch { return null; } }
export const saveWorkspaceKey = (key) => { if (!key) { setSetting('zernio_key_enc', ''); return; } if (!validKey(key)) throw bad('That does not look like a Zernio API key (it starts with sk_).'); setSetting('zernio_key_enc', encrypt(String(key).trim())); };
export const keyFor = () => (mode() === 'workspace' ? workspaceKey() : platformKey());
export const keyHint = (k) => (k ? `…${String(k).slice(-4)}` : null);

/** One call to Zernio. Never throws the key; turns provider failures into plain messages. */
export async function call(method, path, { body, key = keyFor(), headers = {}, timeout = 30_000, query } = {}) {
  if (!key) throw bad('Posting is not set up yet. Ask your administrator to connect it.', { code: 'zernio_no_key' });
  const url = new URL(`${BASE()}${path}`); for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
  let res, data = {};
  try {
    res = await fetch(url, { method, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    try { data = await res.json(); } catch { data = {}; }
  } catch (e) { throw bad(`The posting service could not be reached (${e.name === 'TimeoutError' ? 'timed out' : 'network error'}). Please try again in a moment.`, { code: 'zernio_unreachable' }); }
  if (res.ok) return data;
  const msg = String(data?.error?.message || data?.error || data?.message || '').slice(0, 200);
  const code = res.status === 401 || res.status === 403 ? 'zernio_key_rejected' : res.status === 402 ? 'zernio_payment' : res.status === 409 ? 'zernio_duplicate' : res.status === 429 ? 'zernio_rate' : 'zernio_error';
  const text = code === 'zernio_key_rejected' ? 'The posting service did not accept the saved key.'
    : code === 'zernio_payment' ? 'The posting service is paused because its subscription needs payment.'
    : code === 'zernio_duplicate' ? 'The same text was already posted to this account in the last 24 hours. Change the text a little and try again.'
    : code === 'zernio_rate' ? 'The posting service asked us to slow down. It will be tried again shortly.'
    : `The posting service refused this${msg ? `: ${msg}` : ` (${res.status})`}.`;
  const err = new HttpError(res.status === 429 ? 429 : 400, text, { code }); err.code = code; err.retryAfter = Number(res.headers.get('retry-after')) || null; err.data = data; throw err;
}

/** Console: does Zernio accept this key? */
export async function testKey(key) { const d = await call('GET', '/accounts', { key }); return { ok: true, accounts: (d.accounts || []).length }; }

/** The workspace's Zernio profile id (created on first use; our own id is the profile's externalId). */
export async function ensureProfile() {
  const have = getSetting('zernio_profile_id'); if (have) return have;
  const t = currentTenant(); const externalId = `tenant-${t?.id ?? 'legacy'}`;
  let id;
  try { const d = await call('POST', '/profiles', { body: { name: String(t?.name || t?.slug || 'Workspace').slice(0, 80), externalId } }); id = d.profile?._id || d._id; }
  catch (e) { id = e.data?.details?.existingProfileId; if (!id) throw e; }
  if (!id) throw bad('The posting service did not return a profile.');
  setSetting('zernio_profile_id', id); return id;
}
export const profileExternalId = (t = currentTenant()) => `tenant-${t?.id ?? 'legacy'}`;

export async function connectUrl(platform, redirect) {
  if (!PLATFORMS[platform]) throw bad('Choose Facebook or Instagram.');
  const profileId = await ensureProfile();
  const d = await call('GET', `/connect/${platform}`, { query: { profileId, redirect_url: redirect } });
  if (!d.authUrl) throw bad('The posting service did not return a connect link.');
  return d.authUrl;
}
const norm = (a) => ({ account_id: String(a._id || a.id), platform: String(a.platform || '').toLowerCase(), name: String(a.displayName || a.name || a.username || a.platform || '').slice(0, 120), username: a.username ? String(a.username).slice(0, 120) : null, profile: String(a.profileId?._id || a.profileId || '') });
/** Accounts of this workspace's profile (platform mode filters by profile; workspace mode uses the whole team). */
export async function listAccounts() {
  const profileId = await ensureProfile();
  const d = await call('GET', '/accounts', { query: { profileId } });
  return (d.accounts || []).map(norm).filter((a) => PLATFORMS[a.platform] && (!a.profile || a.profile === profileId));
}
export async function removeAccount(accountId) { await call('DELETE', `/accounts/${encodeURIComponent(accountId)}`); }

/** Put a file where Zernio can read it. Returns the public URL. */
export async function uploadMedia(buf, { filename, contentType }) {
  const p = await call('POST', '/media/presign', { body: { filename, contentType, size: buf.length } });
  if (!p.uploadUrl || !p.publicUrl) throw bad('The posting service could not take the file.');
  const res = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: buf, signal: AbortSignal.timeout(180_000) }).catch(() => null);
  if (!res || !res.ok) throw bad('The file could not be sent to the posting service. It will be tried again.', { code: 'zernio_unreachable' });
  return p.publicUrl;
}
/** Publish now to the given accounts. idKey makes a retry return the first post instead of creating a second. */
export async function publishNow({ content, media = [], accounts, idKey }) {
  const d = await call('POST', '/posts', { headers: idKey ? { 'x-request-id': idKey } : {}, body: { content, publishNow: true, platforms: accounts.map((a) => ({ platform: a.platform, accountId: a.account_id })), ...(media.length ? { mediaItems: media } : {}) } });
  const post = d.post || d; return { id: String(post._id || post.id || ''), status: String(post.status || ''), platforms: post.platforms || [] };
}
export async function getPost(id) { const d = await call('GET', `/posts/${encodeURIComponent(id)}`); const post = d.post || d; return { id: String(post._id || id), status: String(post.status || ''), platforms: post.platforms || [] }; }
export async function registerWebhook(url, secret) {
  return call('POST', '/webhooks/settings', { key: platformKey(), body: { name: 'Agentify ERP', url, secret, events: ['post.published', 'post.failed', 'account.connected', 'account.disconnected'] } });
}
