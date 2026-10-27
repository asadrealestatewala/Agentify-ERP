// The phone app (Android, a Capacitor shell around this website) is controlled from here. Nothing in the shell is
// hard-wired: it asks the server for /api/platform/app-config (edited in the console under Website builder > Mobile app)
// and applies it through the one native plugin, AgentifyShell. The page itself, including this file, updates the moment
// the site is deployed, so changing colours, the Back behaviour or the update notice never needs a new app file.
import { useSyncExternalStore } from 'react';
import { inNativeApp } from './installApp.js';

const CACHE = 'erp.appcfg';
const LEGACY_VERSION = 2; // app 1.1.0 had no AgentifyShell plugin
const state = { native: false, bridge: false, version: 0, versionName: '', config: null, dismissed: '', v: 0 };
const subs = new Set();
const emit = () => { state.v += 1; subs.forEach((f) => f()); };
let started = false;

const plugin = () => { try { return window.Capacitor?.registerPlugin ? window.Capacitor.registerPlugin('AgentifyShell') : null; } catch { return null; } };

/** Calls a native method; resolves null when the shell does not have it (older app) instead of throwing. */
export async function nativeCall(method, args) {
  const p = state.native ? plugin() : null;
  if (!p || typeof p[method] !== 'function') return null;
  try { return await p[method](args || {}); } catch { return null; }
}
/** Asks Android for permissions by name: 'camera', 'microphone', 'location', 'notifications'. Resolves { camera: 'granted' | 'denied' | 'prompt', ... }. */
export const requestNativePermissions = (permissions) => nativeCall('requestPermissions', { permissions });
export async function openExternal(url) {
  if (!(await nativeCall('openExternal', { url }))) window.open(url, '_blank', 'noopener');
}

const read = () => { try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; } };
const write = (c) => { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch { /* private mode */ } };

function applyAppearance() {
  const c = state.config;
  if (!c) return;
  const root = document.documentElement;
  const mode = root.dataset.theme === 'dark' ? c.dark : c.light;
  root.dataset.insets = c.insets === 'web' ? 'web' : 'native';
  if (state.bridge) nativeCall('setAppearance', { chrome: mode.chrome, icons: mode.icons, insets: c.insets, title: c.appName });
}

async function refresh() {
  try {
    const r = await fetch('/api/platform/app-config', { credentials: 'same-origin' });
    if (!r.ok) return;
    state.config = await r.json(); write(state.config); state.fetchedAt = Date.now();
    applyAppearance(); emit();
  } catch { /* offline: the last saved configuration keeps applying */ }
}

export async function startNativeShell() {
  if (started || typeof window === 'undefined') return;
  started = true;
  state.native = inNativeApp();
  if (!state.native) return;
  const info = await nativeCall('getInfo');
  state.bridge = !!info;
  state.version = info ? Number(info.versionCode) || 0 : LEGACY_VERSION;
  state.versionName = info?.versionName || '1.1.0';
  state.config = read();
  try { state.dismissed = localStorage.getItem('erp.appcfg.dismissed') || ''; } catch { /* ignore */ }
  applyAppearance(); emit();
  refresh();
  // a returning visit (app brought back from the background) checks again at most every 10 minutes
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - (state.fetchedAt || 0) > 600_000) refresh(); });
  // light/dark follows the person's appearance choice
  new MutationObserver(applyAppearance).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export function dismissUpdate() {
  state.dismissed = String(state.config?.update?.latest || '');
  try { localStorage.setItem('erp.appcfg.dismissed', state.dismissed); } catch { /* ignore */ }
  emit();
}

/** What the update notice should do for this install: 'required' blocks the app, 'optional' shows a dismissible banner. */
export function updateStatus(s = state) {
  const u = s.config?.update;
  if (!s.native || !u) return { level: 'none' };
  if (u.min && s.version < u.min) return { level: 'required', ...u };
  if (u.latest && s.version < u.latest && s.dismissed !== String(u.latest)) return { level: 'optional', ...u };
  return { level: 'none' };
}

const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
const snapshot = () => state.v;
export function useNativeShell() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return { native: state.native, bridge: state.bridge, version: state.version, versionName: state.versionName, config: state.config, update: updateStatus() };
}
