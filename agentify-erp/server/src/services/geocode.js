// Address to coordinates for the property editor. Providers, in order (a failure or rate limit falls through to the next):
//   photon     (default) komoot's free Photon search on OpenStreetMap data, no key, built for search-as-you-type
//   locationiq used first when LOCATIONIQ_KEY is set (free tier, Nominatim-compatible answers)
//   nominatim  OpenStreetMap's public search, last resort only
// Set GEOCODE_PROVIDER=photon|locationiq|nominatim to pin the first choice. Photon and Nominatim ask for a real User-Agent,
// spaced calls and cached answers, so this keeps a small in-memory cache and spaces calls out per provider. Only the typed place
// text and the workspace country code leave the server. Photon answers are converted to the Nominatim row shape below.
//
// Street-level search: people type the street, the colony and the city into any field, so the fields' roles are not trusted.
// The pieces are tried from the widest to the most specific to find an "anchor" area, then each more specific piece is searched
// only inside that area (viewbox, bounded), with spelling variants. A piece that resolves inside the anchor gives a street or
// colony level pin; only when none does is the answer marked approximate.
const NOMINATIM_URL = process.env.GEOCODE_URL || 'https://nominatim.openstreetmap.org/search';
const PHOTON_URL = process.env.PHOTON_URL || 'https://photon.komoot.io/api/';
const LOCATIONIQ_URL = process.env.LOCATIONIQ_URL || 'https://us1.locationiq.com/v1/search';
const TTL = 24 * 60 * 60_000;
const MAX_CACHE = 500;
const MAX_CALLS = 8; // searches per lookup (each is spaced)
const GAP = { photon: 350, locationiq: 600, nominatim: 1100 };
const cache = new Map(); // key -> { at, rows }
const chains = {}; // provider -> promise chain, so each provider is called one at a time
const lastAt = {};

const ISO = { UK: 'gb' }; // region pack codes that differ from the ISO country code
export const cleanQuery = (q) => String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Runs one call at a time per provider with its minimum gap between calls. */
function spaced(provider, fn) {
  const run = (chains[provider] || Promise.resolve()).then(async () => {
    const wait = (lastAt[provider] || 0) + GAP[provider] - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { lastAt[provider] = Date.now(); }
  });
  chains[provider] = run.catch(() => {});
  return run;
}

/** Providers to try, first choice first. Nominatim is always the last resort. */
export function providerChain(env = process.env) {
  const want = String(env.GEOCODE_PROVIDER || '').toLowerCase();
  const hasIq = /^[A-Za-z0-9._-]{8,80}$/.test(String(env.LOCATIONIQ_KEY || '').trim());
  const first = want === 'nominatim' ? ['nominatim'] : want === 'locationiq' && hasIq ? ['locationiq'] : want === 'photon' ? ['photon'] : hasIq ? ['locationiq', 'photon'] : ['photon'];
  return [...new Set([...first, 'nominatim'])];
}

const countryOf = (country) => (/^[a-z]{2}$/i.test(country) ? (ISO[country.toUpperCase()] || country.toLowerCase()) : '');

const PHOTON_KIND = { house: 'house', street: 'road', locality: 'neighbourhood', district: 'city_district', city: 'city', county: 'county', state: 'state', country: 'country', other: 'other' };
/** Photon GeoJSON features as Nominatim-style rows, narrowed to the country when one is given. */
export function photonRows(json, cc = '') {
  const feats = Array.isArray(json?.features) ? json.features : [];
  return feats.filter((f) => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)).map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const kind = PHOTON_KIND[p.type] || 'other';
    const ext = Array.isArray(p.extent) && p.extent.length === 4 ? [p.extent[3], p.extent[1], p.extent[0], p.extent[2]].map(String) : undefined; // [south, north, west, east]
    const street = p.type === 'street' ? p.name : p.street;
    const address = { road: street, neighbourhood: p.type === 'locality' ? p.name : undefined, suburb: p.district || (p.type === 'locality' ? undefined : p.locality), city: p.city, county: p.county, state: p.state, postcode: p.postcode, country: p.country, country_code: String(p.countrycode || '').toLowerCase() };
    const name = p.name || '';
    return { lat: String(lat), lon: String(lon), name, addresstype: kind, type: kind, boundingbox: ext, address,
      display_name: [name, street && street !== name ? street : '', p.district, p.city, p.state, p.country].filter(Boolean).join(', ') };
  }).filter((r) => !cc || !r.address.country_code || r.address.country_code === cc);
}

function urlFor(provider, q, cc, extra) {
  if (provider === 'photon') {
    const sp = new URLSearchParams({ q, limit: '8', lang: 'en' });
    if (extra.viewbox) { const [l, t, r, b] = String(extra.viewbox).split(','); sp.set('bbox', `${l},${b},${r},${t}`); } // Photon wants minLon,minLat,maxLon,maxLat
    return `${PHOTON_URL}?${sp}`;
  }
  const base = { q, format: 'jsonv2', limit: '6', addressdetails: '1', 'accept-language': 'en', ...(cc ? { countrycodes: cc } : {}), ...extra };
  if (provider === 'locationiq') return `${LOCATIONIQ_URL}?${new URLSearchParams({ ...base, key: String(process.env.LOCATIONIQ_KEY).trim(), format: 'json', normalizeaddress: '1' })}`;
  return `${NOMINATIM_URL}?${new URLSearchParams(base)}`;
}

class RateLimited extends Error {}

async function fetchRows(provider, url, cc) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'agentify-erp/1.0 (property location search)', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (res.status === 429) {
      const wait = Math.min(3000, (Number(res.headers.get('retry-after')) || 1) * 1000);
      if (attempt === 0) { await new Promise((r) => setTimeout(r, wait)); continue; }
      throw new RateLimited(`${provider} is busy`);
    }
    if (!res.ok) throw new Error(`Map search answered ${res.status}`);
    const json = await res.json();
    return provider === 'photon' ? photonRows(json, cc) : Array.isArray(json) ? json : [];
  }
  throw new RateLimited(`${provider} is busy`);
}

/** One raw search; `extra` are additional URL parameters (viewbox, bounded). Cached by the full URL; falls through the provider chain. */
async function raw(q, cc, extra = {}) {
  let lastErr;
  for (const provider of providerChain()) {
    const url = urlFor(provider, q, cc, extra);
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < TTL) return { rows: hit.rows, cached: true };
    try {
      const rows = await spaced(provider, () => fetchRows(provider, url, cc));
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(url, { at: Date.now(), rows });
      return { rows, cached: false };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Map search is not available');
}

const AREA_KINDS = new Set(['country', 'state', 'region', 'state_district', 'county', 'city', 'town', 'village', 'municipality', 'district', 'city_district', 'administrative', 'postcode']);
const r6 = (n) => Math.round(n * 1e6) / 1e6;

/** Short readable label: the place's own name plus where it is, instead of Nominatim's very long display_name. */
function shortLabel(x) {
  const a = x.address || {};
  const own = x.name || a.road || a.neighbourhood || a.suburb || '';
  const bits = [own, a.road !== own ? a.road : '', a.neighbourhood, a.suburb, a.city || a.town || a.village || a.city_district || a.county, a.state].filter(Boolean);
  const seen = new Set();
  const out = bits.filter((b) => { const k = b.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4).join(', ');
  return (out || String(x.display_name || '')).slice(0, 160);
}

function toCandidate(x) {
  const lat = Number(x.lat); const lng = Number(x.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const kind = x.addresstype || x.type || '';
  const bb = Array.isArray(x.boundingbox) ? x.boundingbox.map(Number) : null; // [south, north, west, east]
  return { label: shortLabel(x), full: String(x.display_name || '').slice(0, 220), lat: r6(lat), lng: r6(lng), kind, level: AREA_KINDS.has(kind) ? 'area' : 'street',
    bbox: bb && bb.every(Number.isFinite) ? bb : null };
}
const candidates = (rows) => (Array.isArray(rows) ? rows : []).map(toCandidate).filter(Boolean);

/** Spelling variants of one piece of text: as typed, then with run-together words split and common alternate spellings unified. */
export function variants(piece) {
  const p = cleanQuery(piece);
  let n = p.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]+/g, ' ');
  n = n.replace(/\bquaid[\s-]*(e|i)?[\s-]*azam\b/gi, 'Quaid-e-Azam').replace(/\bquaide[\s-]*azam\b/gi, 'Quaid-e-Azam');
  n = cleanQuery(n);
  return n && n.toLowerCase() !== p.toLowerCase() ? [p, n] : [p];
}

/** A plain search for one text (kept for callers that have a single string). */
export async function geocode(query, country = '') {
  const q = cleanQuery(query);
  if (q.length < 2) return { results: [], cached: false };
  const { rows, cached } = await raw(q, countryOf(country));
  return { results: candidates(rows).map(({ bbox, ...c }) => c), cached };
}

const pad = (bb, d) => [bb[0] - d, bb[1] + d, bb[2] - d, bb[3] + d];
const viewbox = (bb) => `${r6(bb[2])},${r6(bb[1])},${r6(bb[3])},${r6(bb[0])}`; // left,top,right,bottom
// Same place twice: OpenStreetMap returns one road as several pieces with the same name, so equal labels and equal spots are merged (first, best ranked, kept).
const dedupe = (list) => { const seen = new Set(); return list.filter((c) => { const keys = [`${c.lat.toFixed(4)},${c.lng.toFixed(4)}`, c.label.toLowerCase()]; if (keys.some((k) => seen.has(k))) return false; keys.forEach((k) => seen.add(k)); return true; }); };

/**
 * `parts` run from specific to general as the form lists them (address, location, area, city) but are not trusted to be in that order
 * or in the right field. Returns { results: [{label, lat, lng, level}], query, approximate, anchor }, best first.
 * `approximate` is true only when a more specific piece was typed and nothing inside the wider area matched it.
 */
export async function geocodeParts(parts, country = '') {
  const cc = countryOf(country);
  const seen = new Set();
  const pieces = (Array.isArray(parts) ? parts : []).map(cleanQuery).filter((x) => {
    const k = x.toLowerCase();
    if (x.length < 2 || seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 5);
  if (!pieces.length) return { results: [], query: '', approximate: false, anchor: null };
  let calls = 0;
  const search = async (q, extra) => { calls += 1; return candidates((await raw(q, cc, extra)).rows); };

  // 1. The anchor: the widest piece that resolves to a place (usually the city, sometimes a road or colony typed in the city field).
  let anchor = null; let anchorIdx = -1;
  for (let i = pieces.length - 1; i >= 0 && calls < 3; i--) {
    for (const v of variants(pieces[i])) {
      const found = await search(v);
      if (found.length) { anchor = { text: pieces[i], list: found }; anchorIdx = i; break; }
      if (calls >= 3) break;
    }
    if (anchor) break;
  }
  if (!anchor) return { results: [], query: pieces.join(', '), approximate: false, anchor: null };
  const specific = pieces.slice(0, anchorIdx);
  if (!specific.length) return { results: dedupe(anchor.list).slice(0, 8).map(({ bbox, ...c }) => c), query: anchor.text, approximate: false, anchor: anchor.list[0].label };

  // 2. Each more specific piece, searched only inside the anchor area, most specific first.
  const box = anchor.list[0].bbox ? pad(anchor.list[0].bbox, 0.04) : pad([anchor.list[0].lat, anchor.list[0].lat, anchor.list[0].lng, anchor.list[0].lng], 0.12);
  const inside = [];
  let hit = null;
  for (const piece of specific) {
    for (const v of variants(piece)) {
      if (calls >= MAX_CALLS) break;
      const found = await search(v, { viewbox: viewbox(box), bounded: '1' });
      if (found.length) { inside.push(...found); hit = hit || piece; break; }
    }
    if (hit || calls >= MAX_CALLS) break;
  }
  const merged = dedupe([...inside, ...anchor.list]).slice(0, 8);
  return { results: merged.map(({ bbox, ...c }) => c), query: hit || anchor.text, approximate: !hit, anchor: anchor.list[0].label };
}
