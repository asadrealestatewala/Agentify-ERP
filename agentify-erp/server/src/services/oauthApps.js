// OAuth for Google, Apple, Meta (Facebook and Instagram), LinkedIn and TikTok.
//
// The platform owner registers ONE app per provider (client id and secret, entered in the console and stored encrypted).
// Providers only allow a fixed list of redirect addresses, and workspaces live on many addresses (subdomains and
// customers' own domains), so every provider sends the browser back to the main domain:
//     https://<main domain>/api/platform/oauth/<provider>/callback
// The "state" value, signed with the platform secret, says which workspace and user the sign-in is for and where to send
// the browser afterwards. Tokens are then stored inside that workspace's own database.
import crypto from 'node:crypto';
import { getSetting, setSetting } from './platformConfig.js';
import { secretsKey } from './platformConfig.js';
import { BASE_DOMAIN } from '../platform.js';
import { bad } from '../util.js';

export const PROVIDERS = {
  google: {
    label: 'Google', auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: { login: ['openid', 'email', 'profile'], signup: ['openid', 'email', 'profile'], calendar: ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email'], youtube: ['https://www.googleapis.com/auth/youtube.upload', 'openid', 'email'] },
    extra: { login: { prompt: 'select_account' }, signup: { prompt: 'select_account' }, calendar: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }, youtube: { access_type: 'offline', prompt: 'consent' } },
    fields: [['client_id', 'Client ID'], ['client_secret', 'Client secret']],
    console: 'https://console.cloud.google.com/apis/credentials',
  },
  apple: {
    label: 'Apple', auth: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token',
    scopes: { login: ['name', 'email'] }, extra: { login: { response_mode: 'form_post' } },
    fields: [['client_id', 'Services ID'], ['team_id', 'Team ID'], ['key_id', 'Key ID'], ['private_key', 'Private key (.p8 contents)']],
    console: 'https://developer.apple.com/account/resources/identifiers/list/serviceId',
  },
  meta: {
    label: 'Facebook and Instagram', auth: 'https://www.facebook.com/v19.0/dialog/oauth', token: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: { social: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'business_management'] }, extra: { social: {} },
    fields: [['client_id', 'App ID'], ['client_secret', 'App secret']], console: 'https://developers.facebook.com/apps/',
  },
  linkedin: {
    label: 'LinkedIn', auth: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: { social: ['openid', 'profile', 'w_member_social'] }, extra: { social: {} },
    fields: [['client_id', 'Client ID'], ['client_secret', 'Client secret']], console: 'https://www.linkedin.com/developers/apps',
  },
  tiktok: {
    label: 'TikTok', auth: 'https://www.tiktok.com/v2/auth/authorize/', token: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: { social: ['user.info.basic', 'video.publish', 'video.upload', 'video.list'] }, extra: { social: {} },
    fields: [['client_id', 'Client key'], ['client_secret', 'Client secret']], console: 'https://developers.tiktok.com/apps/',
  },
};

const key = (p, f) => `oauth_${p}_${f}`;
export function appCreds(provider) {
  const def = PROVIDERS[provider];
  if (!def) return null;
  const c = {};
  for (const [f] of def.fields) c[f] = getSetting(key(provider, f)) || process.env[`${provider.toUpperCase()}_${f.toUpperCase()}`] || '';
  return c.client_id && (provider === 'apple' ? c.private_key && c.team_id && c.key_id : c.client_secret) ? c : null;
}
export function saveAppCreds(provider, values, actor) {
  const def = PROVIDERS[provider];
  if (!def) throw bad('Unknown provider');
  for (const [f] of def.fields) {
    const v = String(values[f] ?? '').trim();
    if (!v) continue; // blank keeps what is saved
    setSetting(key(provider, f), v, { secret: f !== 'client_id' && f !== 'team_id' && f !== 'key_id', by: actor });
  }
}
export function clearAppCreds(provider) { for (const [f] of PROVIDERS[provider].fields) setSetting(key(provider, f), null); }
export const configuredProviders = () => Object.keys(PROVIDERS).filter((p) => !!appCreds(p));

/** The main-domain origin of this server as the browser sees it (keeps the port in local development). */
export function mainOrigin(req) {
  const port = (req.get('host') || '').match(/:(d+)$/)?.[1];
  return `${req.protocol}://${BASE_DOMAIN || req.hostname}${port ? `:${port}` : ''}`;
}
export const redirectUri = (provider, req) => `${mainOrigin(req)}/api/platform/oauth/${provider}/callback`;

// ---- signed state
const b64 = (b) => Buffer.from(b).toString('base64url');
const mac = (s) => crypto.createHmac('sha256', secretsKey()).update(s).digest('base64url');
export function signState(payload) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + 15 * 60_000, n: crypto.randomBytes(6).toString('hex') }));
  return `${body}.${mac(body)}`;
}
export function readState(s) {
  const [body, sig] = String(s || '').split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), c = Buffer.from(mac(body));
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}

export function authorizeUrl(provider, purpose, { state, redirect }) {
  const def = PROVIDERS[provider]; const app = appCreds(provider);
  if (!def || !app) throw bad(`${def?.label || 'This provider'} is not set up on this platform yet.`);
  const scopes = def.scopes[purpose];
  if (!scopes) throw bad('That sign-in type is not supported for this provider.');
  const q = new URLSearchParams({ response_type: 'code', client_id: app.client_id, redirect_uri: redirect, scope: scopes.join(provider === 'tiktok' ? ',' : ' '), state, ...(provider === 'tiktok' ? { client_key: app.client_id } : {}), ...(def.extra[purpose] || {}) });
  if (provider === 'tiktok') q.delete('client_id');
  return `${def.auth}?${q}`;
}

/** Apple's client secret is a short-lived ES256 JWT signed with the .p8 key. */
export function appleClientSecret(app) {
  const enc = (o) => b64(JSON.stringify(o));
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'ES256', kid: app.key_id, typ: 'JWT' });
  const body = enc({ iss: app.team_id, iat: now, exp: now + 600, aud: 'https://appleid.apple.com', sub: app.client_id });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: app.private_key.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64(sig)}`;
}

async function postForm(url, form) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(form).toString() });
  let data = {}; try { data = await res.json(); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, data };
}
export async function exchangeCode(provider, code, redirect) {
  const app = appCreds(provider), def = PROVIDERS[provider];
  const form = provider === 'tiktok'
    ? { client_key: app.client_id, client_secret: app.client_secret, code, grant_type: 'authorization_code', redirect_uri: redirect }
    : { grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: app.client_id, client_secret: provider === 'apple' ? appleClientSecret(app) : app.client_secret };
  const r = await postForm(def.token, form);
  if (!r.ok || r.data.error) throw new Error(r.data.error_description || r.data.error || `${def.label} answered ${r.status}`);
  return r.data;
}
export async function refreshAccessToken(provider, refreshToken) {
  const app = appCreds(provider), def = PROVIDERS[provider];
  const r = await postForm(def.token, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.client_id, client_secret: app.client_secret });
  if (!r.ok || r.data.error) throw new Error(r.data.error_description || r.data.error || `${def.label} answered ${r.status}`);
  return r.data;
}

/** A real credentials test with no side effects: a deliberately wrong code is answered differently for a wrong app than for a right one. */
export async function testAppCreds(provider) {
  const app = appCreds(provider);
  if (!app) throw new Error('Nothing saved yet');
  if (provider === 'apple') { appleClientSecret(app); return 'The private key is valid and a client secret could be signed. Apple cannot be tested further without a real sign-in.'; }
  if (provider === 'meta') {
    const res = await fetch(`https://graph.facebook.com/oauth/access_token?${new URLSearchParams({ client_id: app.client_id, client_secret: app.client_secret, grant_type: 'client_credentials' })}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.access_token) throw new Error(d.error?.message || `Meta answered ${res.status}`);
    return 'Meta accepted the app ID and secret.';
  }
  const r = await exchangeCode(provider, 'agentify-test-code', 'https://example.com/callback').then(() => ({ passed: true }), (e) => ({ error: e.message }));
  const msg = String(r.error || '');
  if (/invalid[_ ]client|unauthorized_client|client_secret|Unauthorized/i.test(msg)) throw new Error(`The provider rejected the client ID or secret (${msg}).`);
  return 'The provider recognised the client ID and secret.';
}
