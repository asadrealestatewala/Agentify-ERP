// What happens when a provider sends the browser back to the main domain (see oauthApps.js for the overall design).
import crypto from 'node:crypto';
import { platformDb, getTenant, withTenant } from '../platform.js';
import { get, run } from '../db.js';
import { saveIntegration } from '../integrations/store.js';
import { appCreds, exchangeCode, readState, redirectUri, signState, PROVIDERS } from './oauthApps.js';
import { onSocialConnected } from '../integrations/social.js';

const CODES = `CREATE TABLE IF NOT EXISTS oauth_login_codes(code TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, provider TEXT NOT NULL, expires_at INTEGER NOT NULL);`;
let ready = false;
const pdb = () => { const d = platformDb(); if (!ready) { d.exec(CODES); ready = true; } return d; };

/** A one-time code the workspace exchanges for a session (valid for two minutes, usable once). */
export function issueLoginCode(tenantId, userId, provider) {
  const code = crypto.randomBytes(24).toString('base64url');
  pdb().prepare('INSERT INTO oauth_login_codes(code, tenant_id, user_id, provider, expires_at) VALUES(?,?,?,?,?)').run(code, tenantId, userId, provider, Date.now() + 120_000);
  return code;
}
export function redeemLoginCode(code, tenantId) {
  const d = pdb();
  const row = d.prepare('SELECT * FROM oauth_login_codes WHERE code=?').get(String(code || ''));
  if (row) d.prepare('DELETE FROM oauth_login_codes WHERE code=?').run(row.code);
  d.prepare('DELETE FROM oauth_login_codes WHERE expires_at<?').run(Date.now());
  return row && row.tenant_id === tenantId && row.expires_at > Date.now() ? row : null;
}

/** Reads the verified email out of an Apple id_token (signature checked against Apple's published keys). */
async function appleIdentity(idToken, app) {
  const [h, p, s] = String(idToken || '').split('.');
  if (!h || !p || !s) throw new Error('Apple did not return an identity token');
  const head = JSON.parse(Buffer.from(h, 'base64url').toString());
  const keys = (await (await fetch('https://appleid.apple.com/auth/keys')).json()).keys || [];
  const jwk = keys.find((k) => k.kid === head.kid);
  if (!jwk) throw new Error('Apple signing key not found');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (!ok || claims.iss !== 'https://appleid.apple.com' || claims.aud !== app.client_id || claims.exp * 1000 < Date.now()) throw new Error('The Apple identity token is not valid');
  return { email: claims.email, verified: claims.email_verified === true || claims.email_verified === 'true' };
}
async function googleIdentity(accessToken) {
  const r = await fetch(PROVIDERS.google.userinfo, { headers: { Authorization: `Bearer ${accessToken}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google did not return the account details');
  return { email: d.email, verified: d.email_verified === true, name: d.name };
}

/** Returns the address to send the browser to next. Never throws: problems become a message on the workspace's own page. */
export async function handleCallback(provider, params, req) {
  const st = readState(params.state);
  if (!st) return { redirect: null, error: 'This sign-in link expired. Go back and try again.' };
  // Google sign-up: no workspace exists yet. Hand the verified name and email to the signup page as a signed token (15 minutes).
  if (st.purpose === 'signup') {
    const back = (q) => `${st.origin}/signup?${q}`;
    if (provider !== 'google') return { redirect: back('google_error=unsupported') };
    if (params.error) return { redirect: back(`google_error=${params.error === 'access_denied' ? 'cancelled' : 'failed'}${st.q ? '&' + st.q : ''}`) };
    try {
      const tokens = await exchangeCode('google', params.code, redirectUri('google', req));
      const who = await googleIdentity(tokens.access_token);
      if (!who.email || !who.verified) return { redirect: back(`google_error=email_not_verified${st.q ? '&' + st.q : ''}`) };
      const token = signState({ purpose: 'google-signup', email: String(who.email).toLowerCase(), name: who.name || '' });
      return { redirect: back(`google=${encodeURIComponent(token)}${st.q ? '&' + st.q : ''}`) };
    } catch (e) { return { redirect: back(`google_error=failed${st.q ? '&' + st.q : ''}`), detail: e.message }; }
  }
  const fail = (code) => `${st.origin}${st.purpose === 'login' ? '/login' : '/settings/integrations'}?oauth_error=${encodeURIComponent(code)}`;
  if (params.error) return { redirect: fail(params.error === 'access_denied' ? 'cancelled' : params.error) };
  try {
    const tenant = getTenant(st.tid);
    if (!tenant || tenant.status !== 'active') return { redirect: fail('workspace_unavailable') };
    const redirect = redirectUri(provider, req);
    const tokens = await exchangeCode(provider, params.code, redirect);
    if (st.purpose === 'login') {
      const who = provider === 'apple' ? await appleIdentity(tokens.id_token, appCreds('apple')) : await googleIdentity(tokens.access_token);
      if (!who.email || !who.verified) return { redirect: fail('email_not_verified') };
      const user = withTenant(tenant, () => get('SELECT id FROM users WHERE lower(email)=lower(?) AND active=1 AND contact_id IS NULL', who.email));
      if (!user) return { redirect: fail('no_account') };
      return { redirect: `${st.origin}/login?sso=${issueLoginCode(tenant.id, user.id, provider)}` };
    }
    if (st.purpose === 'calendar') {
      const info = provider === 'google' ? await googleIdentity(tokens.access_token) : {};
      withTenant(tenant, () => {
        const prev = get('SELECT 1 FROM users WHERE id=?', st.uid);
        if (!prev) return;
        saveIntegration(`google_calendar:${st.uid}`, { refresh_token: tokens.refresh_token, access_token: tokens.access_token, expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 }, { publicInfo: { email: info.email }, status: 'connected', userId: st.uid });
      });
      return { redirect: `${st.origin}/settings/integrations?connected=google_calendar` };
    }
    if (st.purpose === 'social') {
      await withTenant(tenant, () => onSocialConnected(provider, tokens, st.uid));
      return { redirect: `${st.origin}/settings/integrations?connected=${provider}` };
    }
    return { redirect: fail('unsupported') };
  } catch (e) {
    return { redirect: fail('failed'), detail: e.message };
  }
}
export { run };
