// Address to coordinates for the property editor, using OpenStreetMap's public Nominatim search (no key, no paid provider).
// Nominatim's usage policy asks for a real User-Agent, at most one request per second and cached answers, so this keeps a
// small in-memory cache and spaces calls out. Only the typed place text and the workspace country code leave the server.
//
// Street-level search: people type the street, the colony and the city into any field, so the fields' roles are not trusted.
// The pieces are tried from the widest to the most specific to find an "anchor" area, then each more specific piece is searched
// only inside that area (viewbox, bounded), with spelling variants. A piece that resolves inside the anchor gives a street or
// colony level pin; only when none does is the answer marked approximate.
const ENDPOINT = process.env.GEOCODE_URL || 'https://nominatim.openstreetmap.org/search';
const TTL = 24 * 60 * 60_000;
const MAX_CACHE = 500;
const MAX_CALLS = 8; // searches per lookup (each is spaced by a second)
const cache = new Map(); // key -> { at, rows }
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

const countryOf = (country) => (/^[a-z]{2}$/i.test(country) ? (ISO[country.toUpperCase()] || country.toLowerCase()) : '');

/** One raw Nominatim search; `extra` are additional URL parameters. Cached by the full URL. */
async function raw(q, cc, extra = {}) {
  const url = `${ENDPOINT}?${new URLSearchParams({ q, format: 'jsonv2', limit: '6', addressdetails: '1', 'accept-language': 'en', ...(cc ? { countrycodes: cc } : {}), ...extra })}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return { rows: hit.rows, cached: true };
  const rows = await spaced(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': 'agentify-erp/1.0 (property location search)', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Map search answered ${res.status}`);
    return res.json();
  });
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(url, { at: Date.now(), rows: Array.isArray(rows) ? rows : [] });
  return { rows: Array.isArray(rows) ? rows : [], cached: false };
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
const dedupe = (list) => { const seen = new Set(); return list.filter((c) => { const k = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

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
