// Which map engine a page should draw. The free MapLibre map is the default; Google is used only when the platform owner chose it and
// Google accepts the key. Browsers without WebGL (very old phones) get the lightweight Leaflet map instead, so a map is always shown.
//   'loading' | 'maplibre' | 'google' | 'off'  (off = no WebGL: draw the Leaflet / embed fallback)
import { useEffect, useState } from 'react';
import { fetchMapsConfig, loadGoogleMaps, onGoogleFail } from './googleMaps.js';

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

export function useMapEngine() {
  const [engine, setEngine] = useState('loading');
  useEffect(() => {
    let live = true;
    const free = () => live && setEngine(hasWebGL() ? 'maplibre' : 'off');
    const stop = onGoogleFail(free);
    fetchMapsConfig().then((c) => {
      if (!live) return;
      if (c.provider === 'google' && c.google) loadGoogleMaps().then(() => live && setEngine('google')).catch(free);
      else free();
    });
    return () => { live = false; stop(); };
  }, []);
  return engine;
}

/** Optional MapTiler key from the platform config (adds a satellite view); null when not configured. */
export function useMaptilerKey() {
  const [k, setK] = useState(null);
  useEffect(() => { let live = true; fetchMapsConfig().then((c) => live && setK(c.maplibre?.maptiler?.key || null)); return () => { live = false; }; }, []);
  return k;
}
