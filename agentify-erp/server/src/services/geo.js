// Approximate visitor location for the public marketing page (GET /api/platform/geo).
//
// Only the country and, when a source gives one, the city. It is used to pick a headline; the visitor can always choose
// another country. The address is never written to disk or logs: results are cached in memory under a salted hash of
// the address for a few hours, then forgotten.
//
// Sources, tried in order, all optional (nothing configured = "unknown" and the page shows its global version):
//   1. A trusted reverse proxy that already knows the country, when GEO_TRUST_HEADERS=1:
//      CF-IPCountry / CF-IPCity (Cloudflare), or X-Geo-Country / X-Geo-City (for example nginx with a GeoIP module).
//   2. A lookup service chosen with GEO_PROVIDER:
//      ipinfo  https://ipinfo.io/<ip>/json?token=GEO_TOKEN   (token required; country + city)
//      ipapi   https://ipapi.co/<ip>/json/[?key=GEO_TOKEN]    (country + city; small free allowance without a key)
//      Requests time out after GEO_TIMEOUT_MS (default 1500) and failures are cached briefly, so a slow or blocked
//      provider never slows the page.
import crypto from 'node:crypto';

const TTL = 6 * 3600_000, FAIL_TTL = 10 * 60_000, MAX = 5000;
const cache = new Map(); // hash -> { at, ttl, value }
const SALT = crypto.randomBytes(16); // per process: hashes cannot be reversed or matched across restarts

const hash = (ip) => crypto.createHmac('sha256', SALT).update(String(ip)).digest('base64url');
const isPrivate = (ip) => !ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80|::ffff:(127|10|192\.168)\.)/i.test(ip);
const clean = (s, max = 60) => { const v = String(s || '').trim(); return v && v.length <= max && /^[\p{L}\p{M} .'’-]+$/u.test(v) ? v : null; };
/** ISO codes from providers, mapped to the codes the region packs use (GB is "UK" here). */
export const normalizeCountry = (code) => { const c = String(code || '').trim().toUpperCase(); if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1') return null; return c === 'GB' ? 'UK' : c; };

function fromHeaders(req) {
  if (process.env.GEO_TRUST_HEADERS !== '1') return null;
  const country = normalizeCountry(req.get('cf-ipcountry') || req.get('x-geo-country'));
  if (!country) return null;
  return { country, city: clean(req.get('cf-ipcity') || req.get('x-geo-city')), source: 'proxy' };
}

async function fromProvider(ip) {
  const provider = String(process.env.GEO_PROVIDER || '').toLowerCase();
  const token = process.env.GEO_TOKEN || '';
  let url;
  if (provider === 'ipinfo') { if (!token) return null; url = `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`; }
  else if (provider === 'ipapi') url = `https://ipapi.co/${encodeURIComponent(ip)}/json/${token ? `?key=${encodeURIComponent(token)}` : ''}`;
  else return null;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(Number(process.env.GEO_TIMEOUT_MS) || 1500) });
  if (!res.ok) throw new Error(`provider answered ${res.status}`);
  const d = await res.json();
  if (d.error) throw new Error('provider error');
  const country = normalizeCountry(d.country || d.country_code);
  return country ? { country, city: clean(d.city), source: provider } : null;
}

/** { country, city, source } or { country: null }. Never throws. */
export async function locate(req) {
  try {
    const h = fromHeaders(req);
    if (h) return h;
    const ip = req.ip;
    if (isPrivate(ip)) return { country: null, city: null, source: 'local' };
    const key = hash(ip);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
    let value, ttl = TTL;
    try { value = (await fromProvider(ip)) || { country: null, city: null, source: 'none' }; }
    catch { value = { country: null, city: null, source: 'unavailable' }; ttl = FAIL_TTL; }
    if (cache.size >= MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), ttl, value });
    return value;
  } catch { return { country: null, city: null, source: 'unavailable' }; }
}
export const geoConfigured = () => process.env.GEO_TRUST_HEADERS === '1' || ['ipinfo', 'ipapi'].includes(String(process.env.GEO_PROVIDER || '').toLowerCase());
export const _clearGeoCache = () => cache.clear();
