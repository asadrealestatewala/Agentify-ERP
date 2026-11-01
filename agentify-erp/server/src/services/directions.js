// Turn-by-turn directions for the in-app map. Free routing only, no key and no billing:
//   osrm     (default) OSRM on routing.openstreetmap.de (FOSSGIS), separate car / bike / foot servers
//   valhalla fallback: valhalla1.openstreetmap.de (FOSSGIS). Used when OSRM fails or finds no route.
// Set OSRM_URL (a base with {profile}, e.g. https://osrm.example.com/routed-{profile}) or VALHALLA_URL to use your own server.
// Public servers ask for a real User-Agent and modest use, so calls are spaced, answers cached for a few minutes and only the two
// coordinates leave the server. The answer is the same whichever provider produced it:
//   { provider, profile, distance_m, duration_s, geometry: [[lng, lat], ...], steps: [{ text, distance_m, duration_s, lng, lat, kind }] }
const OSRM_URL = process.env.OSRM_URL || 'https://routing.openstreetmap.de/routed-{profile}';
const VALHALLA_URL = process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de/route';
const UA = 'agentify-erp/1.0 (in-app directions)';
const TTL = 5 * 60_000;
const MAX_CACHE = 300;
const GAP = 400;
const MAX_POINTS = 1500;

export const PROFILES = { driving: { osrm: 'car', valhalla: 'auto' }, walking: { osrm: 'foot', valhalla: 'pedestrian' }, cycling: { osrm: 'bike', valhalla: 'bicycle' } };
const cache = new Map();
let chain = Promise.resolve();
let lastAt = 0;

const spaced = (fn) => {
  const run = chain.then(async () => {
    const wait = lastAt + GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { lastAt = Date.now(); }
  });
  chain = run.catch(() => {});
  return run;
};

export class NoRoute extends Error {}

const round = (n) => Math.round(n * 1e6) / 1e6;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** Keeps the line light for phones: drops points until at most `max` remain, always keeping the first and the last. */
export function thin(points, max = MAX_POINTS) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.round(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
const MOD = { 'sharp left': 'sharp left', left: 'left', 'slight left': 'slight left', straight: 'straight', 'slight right': 'slight right', right: 'right', 'sharp right': 'sharp right', uturn: 'U-turn' };

/** One OSRM step as a sentence a driver can follow. */
export function osrmText(step) {
  const m = step.maneuver || {};
  const road = step.name ? ` onto ${step.name}` : '';
  const on = step.name ? ` on ${step.name}` : '';
  const dir = MOD[m.modifier] || '';
  switch (m.type) {
    case 'depart': return `Head ${m.bearing_after != null ? compass(m.bearing_after) : 'out'}${on}`;
    case 'arrive': return dir && dir !== 'straight' ? `Arrive, your destination is on the ${dir}` : 'Arrive at your destination';
    case 'turn': return dir ? (dir === 'straight' ? `Continue straight${on}` : dir === 'U-turn' ? `Make a U-turn${on}` : `Turn ${dir}${road}`) : `Turn${road}`;
    case 'new name': return `Continue${road}`;
    case 'continue': return dir && dir !== 'straight' ? `Bear ${dir}${road}` : `Continue straight${on}`;
    case 'merge': return `Merge${dir && dir !== 'straight' ? ` ${dir}` : ''}${road}`;
    case 'on ramp': return `Take the ramp${dir && dir !== 'straight' ? ` on the ${dir}` : ''}${road}`;
    case 'off ramp': return `Take the exit${dir && dir !== 'straight' ? ` on the ${dir}` : ''}${road}`;
    case 'fork': return `Keep ${dir === 'left' || dir === 'slight left' ? 'left' : dir === 'right' || dir === 'slight right' ? 'right' : 'straight'} at the fork${road}`;
    case 'end of road': return `At the end of the road turn ${dir || 'ahead'}${road}`;
    case 'roundabout': case 'rotary': case 'roundabout turn': {
      const n = Number(m.exit);
      return n >= 1 ? `At the roundabout take the ${ORD[n] || `${n}th`} exit${road}` : `Enter the roundabout${road}`;
    }
    case 'exit roundabout': case 'exit rotary': return `Exit the roundabout${road}`;
    default: return dir ? `Go ${dir}${on}` : `Continue${on}`;
  }
}
const compass = (b) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((b % 360) + 360) % 360) / 45) % 8];

export function fromOsrm(json, profile) {
  const rt = json?.routes?.[0];
  if (json?.code === 'NoRoute' || !rt) throw new NoRoute('No route found');
  const geometry = (rt.geometry?.coordinates || []).map(([lng, lat]) => [round(lng), round(lat)]);
  if (geometry.length < 2) throw new NoRoute('No route found');
  const steps = (rt.legs || []).flatMap((l) => l.steps || []).map((s) => ({
    text: osrmText(s), distance_m: Math.round(num(s.distance)), duration_s: Math.round(num(s.duration)),
    lng: round(num(s.maneuver?.location?.[0])), lat: round(num(s.maneuver?.location?.[1])), kind: s.maneuver?.type || 'turn',
  }));
  return { provider: 'osrm', profile, distance_m: Math.round(num(rt.distance)), duration_s: Math.round(num(rt.duration)), geometry: thin(geometry), steps };
}

/** Valhalla shapes are encoded polylines with 6 decimals. */
export function decodePolyline6(str) {
  const out = [];
  let i = 0; let lat = 0; let lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0; let result = 0; let b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push([round(lng / 1e6), round(lat / 1e6)]);
  }
  return out;
}

export function fromValhalla(json, profile) {
  const trip = json?.trip;
  const leg = trip?.legs?.[0];
  if (!trip || !leg?.shape || trip.status !== 0) throw new NoRoute('No route found');
  const line = decodePolyline6(leg.shape);
  if (line.length < 2) throw new NoRoute('No route found');
  const steps = (leg.maneuvers || []).map((m) => ({
    text: String(m.instruction || '').replace(/\.$/, ''), distance_m: Math.round(num(m.length) * 1000), duration_s: Math.round(num(m.time)),
    lng: line[Math.min(num(m.begin_shape_index), line.length - 1)][0], lat: line[Math.min(num(m.begin_shape_index), line.length - 1)][1], kind: 'turn',
  }));
  return { provider: 'valhalla', profile, distance_m: Math.round(num(trip.summary?.length) * 1000), duration_s: Math.round(num(trip.summary?.time)), geometry: thin(line), steps };
}

async function viaOsrm(from, to, profile, fetchFn) {
  const base = OSRM_URL.replace('{profile}', PROFILES[profile].osrm).replace(/\/$/, '');
  const url = `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=false`;
  const res = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (res.status === 400) { const j = await res.json().catch(() => ({})); if (j.code === 'NoRoute' || j.code === 'NoSegment') throw new NoRoute('No route found'); }
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  return fromOsrm(await res.json(), profile);
}

async function viaValhalla(from, to, profile, fetchFn) {
  const body = { locations: [{ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng }], costing: PROFILES[profile].valhalla, directions_options: { units: 'kilometers', language: 'en-US' } };
  const res = await fetchFn(VALHALLA_URL, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) });
  if (res.status === 400) throw new NoRoute('No route found');
  if (!res.ok) throw new Error(`Valhalla ${res.status}`);
  return fromValhalla(await res.json(), profile);
}

export function validCoord(p) {
  const lat = Number(p?.lat); const lng = Number(p?.lng);
  return p != null && p.lat !== '' && p.lng !== '' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Route between two points. Throws NoRoute when none exists, or Error when every provider is down. `fetchFn` is for tests. */
export async function directions(from, to, profile = 'driving', { fetchFn = fetch, now = Date.now() } = {}) {
  if (!PROFILES[profile]) throw new Error('Unknown travel mode');
  const a = { lat: round(Number(from.lat)), lng: round(Number(from.lng)) };
  const b = { lat: round(Number(to.lat)), lng: round(Number(to.lng)) };
  const key = `${profile}|${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) return hit.route;
  let route; let noRoute = false;
  for (const via of [viaOsrm, viaValhalla]) {
    try { route = await spaced(() => via(a, b, profile, fetchFn)); break; } catch (e) { if (e instanceof NoRoute) noRoute = true; }
  }
  if (!route) throw noRoute ? new NoRoute('No route found') : new Error('Routing is not available right now');
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, route });
  return route;
}

export const _clearDirectionsCache = () => cache.clear();
