/**
 * The website block types a page may hold (keys of SECTION_TYPES in client/src/site/siteCore.jsx, which carries their
 * labels, defaults and fields). The server refuses anything else on save, so a page never stores a block nobody can render.
 */
export const SECTION_TYPE_NAMES = [
  'hero', 'listings', 'projects', 'stats', 'services', 'calculators', 'agents', 'testimonials', 'partners', 'reviews', 'embed',
  'blog', 'cta', 'text', 'imagetext', 'faq', 'contact', 'gallery', 'leadership', 'projectinfo', 'columns', 'spacer', 'livestats',
  'booking', 'portal', 'banner',
];

/** Most blocks one page may hold. */
export const MAX_SECTIONS = 150;
/** A block id: letters, digits, _ and -, as the editor, templates and the AI writer make them. */
export const SECTION_ID = /^[\w-]{1,64}$/;
