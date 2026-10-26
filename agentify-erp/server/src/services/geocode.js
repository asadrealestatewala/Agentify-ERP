// Address to coordinates for the property editor, using OpenStreetMap's public Nominatim search (no key, no paid provider).
// Nominatim's usage policy asks for a real User-Agent, at most one request per second and cached answers, so this keeps a
// small in-memory cache and spaces calls out. Only the typed place text and the workspace country code leave the server.
const ENDPOINT = process.env.GEOCODE_URL || 'https://nominatim.openstreetmap.org/search';
const TTL = 24 * 60 * 60_000;
const MAX_CACHE = 500;
const cache = new Map(); // key -> { at, results }
let last = Promise.resolve();
let lastAt = 0;

const ISO = { UK: 'gb' }; // region pack codes that differ from the ISO country code
export const cleanQuery = (q) => String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Runs one call at a time with at least a second between calls to the provider. */
function spaced(fn) {
  const run = last.then(async () => {
    const wait = lastAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { lastAt = Date.now(); }
  });
  last = run.catch(() => {});
  return run;
}

/** Up to 5 matches as { label, lat, lng }, best first. `country` is a 2-letter code that narrows the search; empty searches the world. */
export async function geocode(query, country = '') {
  const q = cleanQuery(query);
  if (q.length < 2) return { results: [], cached: false };
  const cc = /^[a-z]{2}$/i.test(country) ? (ISO[country.toUpperCase()] || country.toLowerCase()) : '';
  const key = `${cc}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { results: hit.results, cached: true };
  const url = `${ENDPOINT}?${new URLSearchParams({ q, format: 'jsonv2', limit: '5', addressdetails: '0', ...(cc ? { countrycodes: cc } : {}) })}`;
  const rows = await spaced(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': 'agentify-erp/1.0 (property location search)', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Map search answered ${res.status}`);
    return res.json();
  });
  const results = (Array.isArray(rows) ? rows : [])
    .map((x) => ({ label: String(x.display_name || '').slice(0, 200), lat: Number(x.lat), lng: Number(x.lon) }))
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng) && Math.abs(x.lat) <= 90 && Math.abs(x.lng) <= 180)
    .map((x) => ({ ...x, lat: Math.round(x.lat * 1e6) / 1e6, lng: Math.round(x.lng * 1e6) / 1e6 }));
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), results });
  return { results, cached: false };
}

/**
 * Searches from the most specific text to the least. `parts` run from specific to general, e.g. [address, location, area, city].
 * Duplicates are dropped; if the whole text finds nothing the most specific part is dropped and it tries again, down to the last
 * part (usually the city), so a street Nominatim does not know still lands in the right town. `approximate` says the pin is only
 * as precise as the shorter text. At most 4 searches per call.
 */
export async function geocodeParts(parts, country = '') {
  const seen = new Set();
  const list = (Array.isArray(parts) ? parts : []).map(cleanQuery).filter((x) => {
    const k = x.toLowerCase();
    if (x.length < 2 || seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 6);
  for (let i = 0, tries = 0; i < list.length && tries < 4; i++, tries++) {
    const q = list.slice(i).join(', ');
    const { results } = await geocode(q, country);
    if (results.length) return { results, query: q, approximate: i > 0 };
  }
  return { results: [], query: list.join(', '), approximate: false };
}
