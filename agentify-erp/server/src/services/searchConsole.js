// Google Search Console (read-only) for the Blog agent: a service account that was added as a user on the property signs in with a
// signed JWT, and the Search Analytics API returns clicks, impressions, average position and the real searches that reached the site.
import crypto from 'node:crypto';
import { getSetting, setSetting } from './platformConfig.js';

const bad = (m) => Object.assign(new Error(m), { status: 400 });
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const b64 = (x) => Buffer.from(x).toString('base64url');
let tokenCache = null; let reportCache = null;

const account = () => { try { const a = JSON.parse(getSetting('gsc_service_account') || 'null'); return a?.client_email && a?.private_key ? a : null; } catch { return null; } };
export const siteUrl = () => getSetting('gsc_site') || 'https://agentifyerp.co/';
export const status = () => { const a = account(); return { connected: !!a, email: a?.client_email || null, site: siteUrl() }; };

/** Save or remove the service-account JSON (pasted whole) and the property address. The private key is stored encrypted and never returned. */
export function save({ json, site } = {}, by = null) {
  if (json !== undefined) {
    if (json === '') { setSetting('gsc_service_account', '', { secret: true, by }); }
    else {
      let a; try { a = JSON.parse(json); } catch { throw bad('That is not the JSON file. Open the downloaded .json key file and paste everything in it.'); }
      if (a.type !== 'service_account' || !a.client_email || !String(a.private_key || '').includes('PRIVATE KEY')) throw bad('This JSON is not a Google service-account key.');
      setSetting('gsc_service_account', JSON.stringify({ client_email: a.client_email, private_key: a.private_key }), { secret: true, by });
    }
  }
  if (site !== undefined) {
    const v = String(site).trim();
    if (v && !/^(https?:\/\/[^\s]+\/|sc-domain:[a-z0-9.-]+)$/i.test(v)) throw bad('The property must look like https://agentifyerp.co/ (with the final slash) or sc-domain:agentifyerp.co');
    setSetting('gsc_site', v, { by });
  }
  tokenCache = null; reportCache = null;
  return status();
}

async function token() {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.value;
  const a = account(); if (!a) throw bad('Search Console is not connected yet.');
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64(JSON.stringify({ iss: a.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(a.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }), signal: AbortSignal.timeout(15_000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw bad(`Google refused the service account (${d.error_description || d.error || res.status}). Check the key file.`);
  tokenCache = { value: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

async function query(body) {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl())}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const d = await res.json().catch(() => ({}));
  if (res.status === 403 || res.status === 404) throw bad(`Google says this account cannot read ${siteUrl()}. In Search Console open Settings > Users and permissions and add ${account()?.client_email} as a user (Restricted is enough).`);
  if (!res.ok) throw bad(`Search Console error (${d.error?.message || res.status})`);
  return d.rows || [];
}

const iso = (d) => d.toISOString().slice(0, 10);
const row = (r) => ({ key: r.keys?.[0] ?? '', clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: Math.round((r.ctr || 0) * 1000) / 10, position: Math.round((r.position || 0) * 10) / 10 });

/** Last 28 days (Search Console data runs about 2 days behind): totals, top searches, top pages. Cached for an hour. */
export async function report({ fresh = false } = {}) {
  if (!fresh && reportCache && reportCache.at > Date.now() - 3600_000) return reportCache.data;
  const end = new Date(Date.now() - 2 * 86400_000); const start = new Date(end.getTime() - 27 * 86400_000);
  const base = { startDate: iso(start), endDate: iso(end) };
  const [tot, queries, pages] = await Promise.all([query(base), query({ ...base, dimensions: ['query'], rowLimit: 25 }), query({ ...base, dimensions: ['page'], rowLimit: 25 })]);
  const t = tot[0] || {};
  const data = { range: { from: base.startDate, to: base.endDate }, site: siteUrl(), totals: { clicks: t.clicks || 0, impressions: t.impressions || 0, ctr: Math.round((t.ctr || 0) * 1000) / 10, position: Math.round((t.position || 0) * 10) / 10 }, queries: queries.map(row), pages: pages.map(row) };
  reportCache = { at: Date.now(), data };
  return data;
}

/** Real searches (for topic ideas): the best queries that already reach the site. Empty when not connected or on any error. */
export async function topQueries(n = 15) {
  if (!account()) return [];
  try { return (await report()).queries.slice(0, n).map((q) => q.key); } catch { return []; }
}
