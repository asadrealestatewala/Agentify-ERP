// The server writes a short text version of a public page into #root for search engines; index.html hides it and shows the
// teal logo instead. That first view is kept (instead of a grey skeleton) until the page itself is ready, and the page's code
// starts downloading the moment this file runs. Its data normally arrives inside the HTML already (see boot.js).
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api.js';
import { Loading } from './components/ui.jsx';
import { boot } from './boot.js';

const root = typeof document !== 'undefined' ? document.getElementById('root') : null;
const shell = root && root.firstElementChild ? root.innerHTML : '';
const shellPath = typeof location !== 'undefined' ? location.pathname : '';
let retired = !shell; // set once the signed-in app has drawn; the text then never comes back

// the main domain's public page is coming: fetch its code, the site switch and the page content now, in parallel
export const marketingChunk = shell ? import('./marketing/Marketing.jsx') : null;
let siteInfo = boot?.site ? Promise.resolve(boot.site) : shell ? api.get('/api/platform/site').catch(() => ({ landing: false })) : null;
let marketingInfo = boot?.marketing ? Promise.resolve(boot.marketing) : shell ? api.get('/api/platform/marketing') : null;
if (marketingInfo) marketingInfo.catch(() => { /* the page asks again and shows the error itself */ });

/** The site settings already in the page, or null. */
export const siteKnownAtStart = boot?.site || null;
/** /api/platform/site, fetched once per page load. */
export function loadSiteInfo() {
  siteInfo ||= api.get('/api/platform/site').catch(() => ({ landing: false }));
  return siteInfo;
}

let marketingLast = boot?.marketing || null;
/** /api/platform/marketing: the early copy the first time, a fresh request after that. */
export function loadMarketing() {
  const p = marketingInfo; marketingInfo = null;
  return (p ? p.catch(() => api.get('/api/platform/marketing')) : api.get('/api/platform/marketing')).then((d) => { marketingLast = d; return d; });
}
/** The last page content received in this visit, so moving between public pages draws at once (then refreshes). */
export const marketingCached = () => marketingLast;

/** What to show while the first screen loads: the server's text for the page it was written for, otherwise the skeleton. */
export function FirstView() {
  const { pathname } = useLocation();
  if (retired || pathname !== shellPath) return <Loading />;
  return <div className="seo-shell" dangerouslySetInnerHTML={{ __html: shell }} />;
}

/** Wrap a screen that is not the public website: once it is on screen the server text is retired. */
export function Drawn({ children }) {
  useEffect(() => { retired = true; }, []);
  return children;
}
