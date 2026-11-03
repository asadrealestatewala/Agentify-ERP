// Console side of Zernio posting: the key (write-only), billing mode, platform caps, which workspaces are switched on, the webhook, and
// the owner's own accounts used to test everything end to end before any workspace uses it. The key is never returned, only its last 4.
import crypto from 'node:crypto';
import { getSetting, setSetting, mask } from './platformConfig.js';
import { listTenants } from '../platform.js';
import { bad } from '../util.js';
import * as z from './zernio.js';
import { getCaps, saveCaps, listedWorkspaces, setListedWorkspaces } from './socialCalendar.js';

export function overview(origin) {
  const key = z.platformKey();
  return {
    mode: z.mode(), key: mask(key), caps: getCaps(), platforms: z.PLATFORMS,
    webhook: { url: `${origin}/api/platform/webhooks/zernio`, secret_saved: !!getSetting('zernio_webhook_secret'), registered_at: getSetting('zernio_webhook_registered_at') || null },
    workspaces: listTenants().filter((t) => t.status === 'active').map((t) => ({ id: t.id, slug: t.slug, name: t.name, on: listedWorkspaces().includes(Number(t.id)) })),
    note: 'Zernio bills the Agentify account for every connected account (profiles are free). In "workspace" mode each workspace pastes its own Zernio key and Zernio bills it directly.',
  };
}
export function save({ mode, key }, by) {
  if (mode !== undefined) { if (!['platform', 'workspace'].includes(mode)) throw bad('Billing mode must be platform or workspace'); setSetting('zernio_mode', mode, { by }); }
  if (key !== undefined && key !== '') { if (!z.validKey(key)) throw bad('That does not look like a Zernio API key (it starts with sk_).'); setSetting('zernio_api_key', String(key).trim(), { secret: true, by }); }
}
export const removeKey = (by) => setSetting('zernio_api_key', null, { by });
export async function test() { const k = z.platformKey(); if (!k) throw bad('Add the Zernio key first.'); return z.testKey(k); }
export const saveCapsFor = (b, by) => saveCaps(b, by);
export const saveWorkspaces = (ids, by) => { setListedWorkspaces(Array.isArray(ids) ? ids : [], by); return listedWorkspaces(); };
export async function setupWebhook(origin, by) {
  if (!z.platformKey()) throw bad('Add the Zernio key first.');
  const secret = crypto.randomBytes(32).toString('hex');
  await z.registerWebhook(`${origin}/api/platform/webhooks/zernio`, secret);
  setSetting('zernio_webhook_secret', secret, { secret: true, by }); setSetting('zernio_webhook_registered_at', new Date().toISOString(), { by });
  return { ok: true };
}

// ---- the owner's own accounts (a profile of its own, outside every workspace)
async function ownProfile() {
  const have = getSetting('zernio_own_profile'); if (have) return have;
  let id;
  try { const d = await z.call('POST', '/profiles', { key: z.platformKey(), body: { name: 'Agentify (own accounts)', externalId: 'agentify-own' } }); id = d.profile?._id || d._id; }
  catch (e) { id = e.data?.details?.existingProfileId; if (!id) throw e; }
  setSetting('zernio_own_profile', id); return id;
}
export async function ownAccounts() {
  const profileId = await ownProfile();
  const d = await z.call('GET', '/accounts', { key: z.platformKey(), query: { profileId } });
  return (d.accounts || []).map((a) => ({ account_id: String(a._id || a.id), platform: String(a.platform || '').toLowerCase(), name: a.displayName || a.name || a.username || a.platform, username: a.username || null })).filter((a) => z.PLATFORMS[a.platform]);
}
export async function ownConnect(platform, origin) {
  if (!z.PLATFORMS[platform]) throw bad('Choose Facebook or Instagram.');
  const d = await z.call('GET', `/connect/${platform}`, { key: z.platformKey(), query: { profileId: await ownProfile(), redirect_url: `${origin}/platform/social-posting?connected=1` } });
  if (!d.authUrl) throw bad('The posting service did not return a connect link.');
  return d.authUrl;
}
/** Publishes a REAL post to the chosen own account. Instagram needs a public image link because it cannot post text alone. */
export async function ownTestPost({ account_id, text, image_url, accept }) {
  if (accept !== true) throw bad('Confirm that this publishes a real post first.');
  const accounts = (await ownAccounts()).filter((a) => a.account_id === String(account_id)); if (!accounts.length) throw bad('Choose one of your connected accounts.');
  const body = String(text || '').trim().slice(0, 500); if (body.length < 3) throw bad('Write a short test line.');
  const img = String(image_url || '').trim();
  if (img && !/^https:\/\/[^\s]+$/i.test(img)) throw bad('The image link must start with https://');
  if (accounts[0].platform === 'instagram' && !img) throw bad('Instagram cannot post text alone: paste a public https link to a picture.');
  const out = await z.publishNow({ content: body, media: img ? [{ url: img, type: 'image' }] : [], accounts, idKey: `agentify-test-${Date.now()}` });
  return { id: out.id, status: out.status };
}
