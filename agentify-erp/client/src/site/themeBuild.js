// Turns a theme from the library (shared/siteThemes.js) into ready-to-save pages and a site configuration.
// Blocks get their full default settings, fresh ids, and photos from the workspace's own published listings where the
// theme asks for one. A workspace without listing photos gets the sample photos shipped with the app (demoContent.js),
// so a freshly installed theme looks complete and every picture can be swapped in the editor. Nothing here saves anything: the editor previews the result, and installing goes through the server.
import { SITE_THEMES, THEME_BUILD_KEYS } from '../../../shared/siteThemes.js';
import { SECTION_TYPES } from './siteCore.jsx';
import { api } from '../api.js';
import { DEMO_NAMED, DEMO_PHOTOS } from './demoContent.js';

export { SITE_THEMES };
const clone = (x) => JSON.parse(JSON.stringify(x));
let n = 0;
const uid = () => `t${Date.now().toString(36)}${(n++).toString(36)}`;

/** Up to 12 photos from the workspace's published listings (featured first), to fill theme pictures. */
export async function listingPhotos() {
  try {
    const seen = new Set(), out = [];
    for (const q of [{ featured: 1, limit: 12 }, { limit: 24 }]) {
      const r = await api.get('/api/site/listings', q);
      for (const p of r?.data || []) if (p.cover && !seen.has(p.cover)) { seen.add(p.cover); out.push(p.cover); }
      if (out.length >= 12) break;
    }
    return out.slice(0, 12);
  } catch { return []; }
}

/** One theme block as a stored section. */
export function themeSection(block, photos = [], theme = null) {
  const T = SECTION_TYPES[block.type];
  const raw = { ...(block.props || {}) };
  const photo = raw.photo, many = raw.photos, anchor = raw.anchor, demo = raw.demo;
  THEME_BUILD_KEYS.forEach((k) => delete raw[k]);
  const props = { ...clone(T?.defaults || {}), ...clone(raw) };
  const own = photos.length > 0, pics = own ? photos : theme?.samplePhotos || DEMO_PHOTOS;
  if (photo !== undefined) {
    const src = !own && !theme?.samplePhotos && DEMO_NAMED[demo] ? DEMO_NAMED[demo] : pics[photo % pics.length];
    if (block.type === 'hero' || block.type === 'imagetext' || block.type === 'cta') props.image = src;
  }
  if (block.type === 'gallery') props.images = pics.slice(0, many || 6).map((src) => ({ src, caption: '' }));
  const s = { id: uid(), type: block.type, props };
  if (anchor) s.style = { anchor };
  return s;
}

/** All pages of a theme, ready to preview or install. */
export const themePages = (theme, photos = []) => theme.pages.map((p) => ({ slug: p.slug, title: p.title, show_in_menu: !!p.show_in_menu, sections: p.blocks.map((bk) => themeSection(bk, photos, theme)) }));

/** The site configuration with the theme's design applied (colours, fonts, header and footer look). */
export function themeConfig(cfg, theme) {
  const d = theme.design;
  return {
    ...cfg,
    theme: { ...(cfg.theme || {}), ...d.theme },
    header: { ...(cfg.header || {}), ...d.header },
    footer: { ...(cfg.footer || {}), ...d.footer },
    active_theme: theme.id,
  };
}
