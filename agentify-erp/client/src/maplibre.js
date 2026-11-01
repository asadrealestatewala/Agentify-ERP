// MapLibre GL helpers: the library is loaded on demand (its own chunk), every map is created the same way, and the same
// phone-friendly settings apply to all of them (capped pixel ratio, compact attribution, no heavy extras).
import { fetchMapsConfig } from './googleMaps.js';

let libP = null;
export const loadMapLibre = () => (libP ||= Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([m]) => m.default || m).catch((e) => { libP = null; throw e; }));

export const STYLE_KINDS = ['streets', 'satellite'];
/** Style URL: OpenFreeMap streets by default; MapTiler hybrid satellite when a MapTiler key exists. */
export function styleUrl(cfg, kind = 'streets') {
  const mt = cfg?.maplibre?.maptiler?.key;
  if (kind === 'satellite' && mt) return `https://api.maptiler.com/maps/hybrid/style.json?key=${encodeURIComponent(mt)}`;
  return cfg?.maplibre?.styles?.streets || 'https://tiles.openfreemap.org/styles/liberty';
}

/** Creates a map. `opts` are MapLibre options; `lng`/`lat` set the start. Rejects (so callers can fall back) if WebGL fails. */
export async function createMap(container, { lat = 30, lng = 70, zoom = 4, cooperative = false, kind = 'streets', ...opts } = {}) {
  const [ml, cfg] = await Promise.all([loadMapLibre(), fetchMapsConfig()]);
  const map = new ml.Map({
    container, style: styleUrl(cfg, kind), center: [lng, lat], zoom, maxZoom: 19, attributionControl: { compact: true },
    cooperativeGestures: cooperative, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fadeDuration: 120, dragRotate: false, pitchWithRotate: false, ...opts,
  });
  map.touchZoomRotate.disableRotation();
  return { ml, map, cfg };
}

/** A circle (metres) as a GeoJSON polygon, for the GPS accuracy ring. */
export function circleFeature(lat, lng, radiusM, steps = 48) {
  const pts = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * 2 * Math.PI; pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}
