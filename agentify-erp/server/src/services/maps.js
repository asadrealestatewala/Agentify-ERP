// Google Maps for the browser. The key is a *browser* key: Google expects it to be public and protects it with
// "HTTP referrer" restrictions in the Google Cloud console, so it is handed to the page rather than hidden.
// It comes from the deploy secret GOOGLE_MAPS_API_KEY (optionally GOOGLE_MAPS_MAP_ID for a styled cloud map).
// With no key set the app keeps using OpenStreetMap, so nothing breaks before the key exists.
const KEY_RE = /^[A-Za-z0-9_-]{20,80}$/;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export function publicMapsConfig(env = process.env) {
  const key = String(env.GOOGLE_MAPS_API_KEY || '').trim();
  const mapId = String(env.GOOGLE_MAPS_MAP_ID || '').trim();
  return { google: KEY_RE.test(key) ? { key, mapId: ID_RE.test(mapId) ? mapId : null } : null };
}
