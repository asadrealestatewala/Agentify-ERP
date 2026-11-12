// The public pages on the main domain load in one round trip: their HTML already carries the data the page needs
// (/api/platform/site and /api/platform/marketing) and tells the browser which code and style files to fetch at once,
// instead of the browser finding them one after another (HTML -> app code -> page code -> data).
import fs from 'node:fs';
import path from 'node:path';

const escJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

let preloadTags = null;
/** <link> tags for the public page's code and styles, read from the build manifest (empty when there is none). */
export function marketingPreloads(dist) {
  if (preloadTags !== null) return preloadTags;
  preloadTags = '';
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite', 'manifest.json'), 'utf8'));
    const entry = Object.values(manifest).find((c) => c.isEntry);
    const have = new Set();
    const walk = (key, out) => { const c = manifest[key]; if (!c || have.has(key)) return; have.add(key); out.push(c); for (const k of c.imports || []) walk(k, out); };
    walk(Object.keys(manifest).find((k) => manifest[k] === entry), []); // the app's own files are already in the HTML
    const page = [];
    walk('src/marketing/Marketing.jsx', page);
    const js = page.map((c) => c.file);
    const css = [...new Set(page.flatMap((c) => c.css || []))];
    preloadTags = [...css.map((f) => `<link rel="preload" as="style" href="/${f}" />`), ...js.map((f) => `<link rel="modulepreload" href="/${f}" />`)].join('');
  } catch { /* no manifest (dev build): the page still loads, only less eagerly */ }
  return preloadTags;
}

/** The JSON the public page would otherwise fetch first, as an inert <script> the app reads (never run as code). */
export function bootData(builders) {
  try {
    const data = { main: true, site: builders.site(), marketing: builders.marketing() };
    return `<script type="application/json" id="erp-boot">${escJson(data)}</script>`;
  } catch (e) {
    console.error('[landing boot]', e.message);
    return ''; // the page fetches the data itself, as before
  }
}

/** Put the preload tags and the data into the page shell. */
export function fastLanding(html, { dist, site, marketing }) {
  return html.replace('</head>', `${marketingPreloads(dist)}${bootData({ site, marketing })}</head>`);
}

/** For tests: forget the cached manifest tags. */
export function resetLandingCache() { preloadTags = null; }
