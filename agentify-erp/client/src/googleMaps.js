// Loads the Google Maps JavaScript API once, only when the platform has a browser key (GET /api/platform/maps-config).
// Without a key, or when Google refuses it (wrong referrer, billing off), `useMaps()` reports 'off' and the pages keep
// their OpenStreetMap maps, so a bad key can never leave a page without a map.
import { useEffect, useState } from 'react';
import { api } from './api.js';

export const BRAND = '#0e7c6b';
let cfgP = null;
let loadP = null;
let failed = false;
const listeners = new Set();

const fetchConfig = () => (cfgP ||= api.get('/api/platform/maps-config').then((c) => c?.google || null).catch(() => null));

export function loadGoogleMaps() {
  if (failed) return Promise.reject(new Error('maps-failed'));
  if (typeof window !== 'undefined' && window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  return (loadP ||= fetchConfig().then((cfg) => new Promise((resolve, reject) => {
    if (!cfg) { reject(new Error('no-key')); return; }
    // Google calls this when the key is rejected (referrer not allowed, billing not enabled, API not enabled)
    window.gm_authFailure = () => { failed = true; listeners.forEach((f) => f()); };
    window.__erpMapsReady = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.key)}&v=weekly&loading=async&libraries=marker&callback=__erpMapsReady`;
    s.onerror = () => { failed = true; reject(new Error('maps-load')); };
    document.head.appendChild(s);
    mapIdValue = cfg.mapId || 'DEMO_MAP_ID';
  })).catch((e) => { loadP = null; throw e; }));
}
let mapIdValue = 'DEMO_MAP_ID';
export const mapId = () => mapIdValue;

/** 'loading' | 'ready' | 'off' */
export function useMaps() {
  const [state, setState] = useState(() => (failed ? 'off' : window.google?.maps?.importLibrary ? 'ready' : 'loading'));
  useEffect(() => {
    let live = true;
    const off = () => live && setState('off');
    listeners.add(off);
    loadGoogleMaps().then(() => live && !failed && setState('ready')).catch(off);
    return () => { live = false; listeners.delete(off); };
  }, []);
  return state;
}

/** Brand colour of the current workspace (falls back to the teal brand colour). */
export const brandColour = () => (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()) || BRAND;

export const roundCoord = (n) => Math.round(n * 1e6) / 1e6;

/** Ease a value between two positions; used to glide a marker instead of jumping. Returns a cancel function. */
export function glide(from, to, ms, step) {
  const t0 = performance.now();
  let raf = 0;
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    step({ lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e });
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
