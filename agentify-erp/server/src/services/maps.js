// Which map the pages draw. The default is free and needs no key: MapLibre GL with OpenFreeMap vector tiles.
//   MAP_PROVIDER=maplibre (default) | google   (also settable as the console/platform setting "map_provider")
//   MAPTILER_API_KEY   optional MapTiler key (free tier): adds a satellite view and street tiles from MapTiler
//   GOOGLE_MAPS_API_KEY / GOOGLE_MAPS_MAP_ID   optional Google browser key, used only when the provider is "google"
// Browser keys are public by design (MapTiler and Google protect them with allowed-domain lists in their consoles), so they are
// handed to the page. Anything that is not well formed is dropped so no markup or quotes can reach the page.
const KEY_RE = /^[A-Za-z0-9_-]{20,80}$/;
const MT_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
export const PROVIDERS = ['maplibre', 'google'];
const OPENFREEMAP = { streets: 'https://tiles.openfreemap.org/styles/liberty', light: 'https://tiles.openfreemap.org/styles/positron' };

export function publicMapsConfig(env = process.env, consoleChoice = '') {
  const gKey = String(env.GOOGLE_MAPS_API_KEY || '').trim();
  const mapId = String(env.GOOGLE_MAPS_MAP_ID || '').trim();
  const mtKey = String(env.MAPTILER_API_KEY || '').trim();
  const google = KEY_RE.test(gKey) ? { key: gKey, mapId: ID_RE.test(mapId) ? mapId : null } : null;
  const maptiler = MT_RE.test(mtKey) ? { key: mtKey } : null;
  const asked = (String(consoleChoice || '') || String(env.MAP_PROVIDER || '')).trim().toLowerCase();
  // Google only when asked for AND a key exists; everything else is the free provider, so a missing key can never blank a map
  const provider = asked === 'google' && google ? 'google' : 'maplibre';
  return {
    provider,
    google: provider === 'google' ? google : null,
    maplibre: { styles: OPENFREEMAP, maptiler: maptiler ? { key: maptiler.key } : null },
  };
}
