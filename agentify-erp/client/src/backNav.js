import { useEffect, useRef } from 'react';

// Phone and tablet "Back" must step back through screens, and close an open pop-up first, instead of leaving the app.

/** Stack of open pop-ups (modals, drawers); the Back button closes the top one. */
const layers = [];
let skip = 0; // popstate events we caused ourselves (closing a pop-up with its own button)
let installed = false;

function onPop() {
  if (skip > 0) { skip -= 1; return; }
  const top = layers.pop();
  if (top) { top.popped = true; top.close?.(); }
}

/** While a pop-up is open, Back closes it (and stays on the same page). */
export function useBackClose(onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!installed) { window.addEventListener('popstate', onPop); installed = true; }
    const layer = { popped: false, close: () => ref.current?.() };
    layers.push(layer);
    try { window.history.pushState({ ...(window.history.state || {}), __layer: true }, ''); } catch { /* ignore */ }
    return () => {
      const i = layers.indexOf(layer);
      if (i !== -1) layers.splice(i, 1);
      // closed with its own button: remove the extra history entry we added (unless the page already moved on)
      if (!layer.popped && window.history.state?.__layer) { skip += 1; window.history.back(); }
    };
  }, []);
}

/**
 * Opened straight onto an inner page with no history behind it (installed app, a shared link, a refresh)?
 * Put the home screen underneath so Back goes there first and only leaves the app from the home screen.
 */
export function seedHomeEntry() {
  try {
    const { pathname, search, hash } = window.location;
    const inApp = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone || !!window.Capacitor;
    if (!inApp || window.history.length > 1 || pathname === '/' || window.history.state?.__seeded) return;
    window.history.replaceState({ __seeded: true }, '', '/');
    window.history.pushState({ __seeded: true }, '', pathname + search + hash);
  } catch { /* ignore */ }
}
