// One place that owns "install the app" (PWA). The browser fires `beforeinstallprompt` once, early, so it is captured
// here as soon as the bundle loads (imported first in main.jsx) instead of in whichever component happens to be mounted.
// The landing page and the workspace both read it through useInstallApp(), so a click on any "Download the app" button
// opens the browser's own install dialog straight away where the browser supports that.
import { useSyncExternalStore } from 'react';

const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
const state = { evt: typeof window !== 'undefined' ? window.__erpInstallEvt || null : null, installed: standalone(), v: 0 };
const subs = new Set();
const emit = () => { state.v += 1; subs.forEach((f) => f()); };

if (typeof window !== 'undefined' && !window.__erpInstallWired) {
  window.__erpInstallWired = true;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.evt = e; window.__erpInstallEvt = e; emit(); });
  window.addEventListener('appinstalled', () => { state.evt = null; window.__erpInstallEvt = null; state.installed = true; emit(); });
}

const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
const snapshot = () => state.v;

const isIOS = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
};

/** Asks the browser to install the app. Resolves true when the person accepted. */
async function install() {
  const evt = state.evt;
  if (!evt) return false;
  evt.prompt();
  const choice = await evt.userChoice.catch(() => null);
  state.evt = null; window.__erpInstallEvt = null;
  if (choice?.outcome === 'accepted') state.installed = true;
  emit();
  return choice?.outcome === 'accepted';
}

export function useInstallApp() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return { canPrompt: !!state.evt && !state.installed, installed: state.installed, ios: isIOS() && !state.installed, install };
}
