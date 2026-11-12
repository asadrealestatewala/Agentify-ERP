// The server writes a short text version of a public page into #root (for search engines and for the first paint). React used
// to replace it with a grey skeleton and only then draw the real page: two jumps in a row. Now that text stays on screen,
// styled, until the page itself is ready, and the page's code starts downloading the moment this file runs.
import { useEffect } from 'react';
import { api } from './api.js';
import { Loading } from './components/ui.jsx';

const root = typeof document !== 'undefined' ? document.getElementById('root') : null;
const shell = root && root.firstElementChild ? root.innerHTML : '';
let shown = !shell; // the server text is used for the first view only, never again after another screen was drawn

// the main domain's public page is coming: fetch its code and the site settings now, in parallel with the app's start-up
export const marketingChunk = shell ? import('./marketing/Marketing.jsx') : null;
let siteInfo = shell ? api.get('/api/platform/site').catch(() => ({ landing: false })) : null;
/** /api/platform/site, fetched once per page load. */
export function loadSiteInfo() {
  siteInfo ||= api.get('/api/platform/site').catch(() => ({ landing: false }));
  return siteInfo;
}

/** What to show while the first screen loads: the server's text when there is one, otherwise the usual skeleton. */
export function FirstView() {
  if (shown) return <Loading />;
  return <div className="seo-shell" dangerouslySetInnerHTML={{ __html: shell }} />;
}

/** Wrap a real screen: once it is on screen the server text is retired. */
export function Drawn({ children }) {
  useEffect(() => { shown = true; }, []);
  return children;
}
