import { bad } from '../util.js';
import { checkTools } from '../../../shared/constructionTools.js';
import { isHtml, sanitizeHtml } from './richText.js';
import { cleanSectionStyle } from '../../../shared/sectionStyle.js';
import { MAX_SECTIONS, SECTION_ID, SECTION_TYPE_NAMES } from '../../../shared/sectionTypes.js';

/** Fonts offered in the editor (kept in step with client/src/site/siteCore.jsx FONTS). Anything else would be injected into CSS. */
export const SITE_FONTS = ['Inter', 'Poppins', 'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Nunito', 'Playfair Display', 'Merriweather', 'DM Sans', 'Manrope', 'Raleway', 'Work Sans', 'Source Sans 3'];

const SAFE_LINK = /^(https?:\/\/[^\s]+|\/[^\s]*|#[^\s]*|mailto:[^\s]+|tel:[^\s]+)$/i;
/** Links on the public site may only be web pages, internal paths, mail or phone — never script or data URLs. */
export function checkLink(v, label) {
  if (v === undefined || v === null || v === '') return;
  if (typeof v !== 'string' || !SAFE_LINK.test(v.trim())) throw bad(`${label} must start with https://, / , mailto: or tel: (got “${String(v).slice(0, 40)}”)`);
}
const checkImage = (v, label) => {
  if (!v) return;
  if (typeof v !== 'string' || !/^(media\/[\w.-]+|\/uploads\/[\w./-]+|\/site\/[\w.-]+|https?:\/\/[^\s]+)$/i.test(v)) throw bad(`${label} must be an uploaded image or an https:// link`);
};
const num = (v, label, min, max) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max) throw bad(`${label} must be a number between ${min} and ${max}`);
  return n;
};

/** Validate the website configuration before it is saved and served to every visitor. */
export function validateSiteConfig(c) {
  const t = c.theme || {};
  for (const k of ['font_heading', 'font_body']) if (t[k] !== undefined && t[k] !== '' && !SITE_FONTS.includes(t[k])) throw bad(`Font “${String(t[k]).slice(0, 30)}” is not one of the available fonts`);
  if (t.radius !== undefined && t.radius !== '') num(t.radius, 'Corner roundness', 0, 40);
  checkImage(c.brand?.logo, 'The logo');
  checkImage(c.seo?.image, 'The share image');
  if (c.seo) {
    for (const [k, max] of [['title', 120], ['description', 320], ['keywords', 400]]) if (c.seo[k] !== undefined && String(c.seo[k] ?? '').length > max) throw bad(`The SEO ${k} is too long (max ${max} characters)`);
    if (c.seo.base_url && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(String(c.seo.base_url))) throw bad('The website address must start with https://');
  }
  if (c.bot) {
    if (c.bot.name !== undefined && (!String(c.bot.name).trim() || String(c.bot.name).length > 40)) throw bad('The assistant needs a name (up to 40 characters)');
    if (c.bot.greeting !== undefined && String(c.bot.greeting).length > 400) throw bad('The assistant greeting is too long (max 400 characters)');
    if (c.bot.quick_replies !== undefined && (!Array.isArray(c.bot.quick_replies) || c.bot.quick_replies.length > 8 || c.bot.quick_replies.some((q) => typeof q !== 'string' || q.length > 60))) throw bad('Quick replies must be up to 8 short phrases');
  }
  const h = c.header || {};
  if (h.style !== undefined && !['light', 'dark', 'transparent'].includes(h.style)) throw bad('Header style must be light, dark or transparent');
  if (c.footer?.style !== undefined && !['dark', 'light'].includes(c.footer.style)) throw bad('Footer style must be dark or light');
  if (c.active_theme !== undefined && c.active_theme !== null && !/^[a-z0-9-]{1,40}$/.test(String(c.active_theme))) throw bad('Unknown theme');
  checkLink(h.cta_href, 'The header button link');
  (h.links || []).forEach((l, i) => checkLink(l.href, `Header menu link ${i + 1}`));
  (c.footer?.columns || []).forEach((col) => (col.links || []).forEach((l, i) => checkLink(l.href, `Footer link “${l.label || i + 1}”`)));
  (c.social || []).forEach((s) => { if (s.url && !/^https?:\/\//i.test(s.url) && !/^(mailto:|tel:)/i.test(s.url)) throw bad(`The ${s.platform || 'social'} link must start with https://`); checkLink(s.url, `The ${s.platform || 'social'} link`); });

  const calc = c.calculators || {};
  if (calc.tools) { try { checkTools(calc.tools); } catch (e) { throw bad(e.message); } }
  const con = calc.construction;
  if (con) {
    const rates = con.rates;
    if (rates !== undefined) {
      if (!rates || typeof rates !== 'object' || Array.isArray(rates) || !Object.keys(rates).length) throw bad('Add at least one finishing grade to the construction calculator');
      for (const [g, v] of Object.entries(rates)) { if (!String(g).trim()) throw bad('Every finishing grade needs a name'); num(v, `The rate for “${g}”`, 1, 1_000_000); }
    }
    if (con.basement_rate !== undefined && con.basement_rate !== '') num(con.basement_rate, 'The basement rate', 0, 1_000_000);
    if (con.floor_extra_pct !== undefined && con.floor_extra_pct !== '') num(con.floor_extra_pct, 'The extra cost per floor', 0, 100);
    if (Array.isArray(con.breakdown) && con.breakdown.length) {
      let sum = 0;
      for (const b of con.breakdown) { if (!String(b.label || '').trim()) throw bad('Every cost-breakdown line needs a name'); sum += num(b.pct, `The percentage for “${b.label}”`, 0, 100); }
      if (Math.abs(sum - 100) > 0.5) throw bad(`The cost breakdown must add up to 100% (it adds up to ${Math.round(sum * 10) / 10}%)`);
    }
  }
  const ins = calc.installment;
  if (ins) {
    const max = ins.max_years === undefined || ins.max_years === '' ? 10 : num(ins.max_years, 'The maximum plan length', 1, 30);
    if (ins.default_years !== undefined && ins.default_years !== '') { const y = num(ins.default_years, 'The default plan length', 1, 30); if (y > max) throw bad('The default plan length cannot be longer than the maximum'); }
    if (ins.default_down_pct !== undefined && ins.default_down_pct !== '') num(ins.default_down_pct, 'The default down payment', 0, 90);
    if (ins.markup_pct !== undefined && ins.markup_pct !== '') num(ins.markup_pct, 'The default markup', 0, 30);
  }
  const l = c.listing || {};
  if (l.per_page !== undefined && l.per_page !== '') num(l.per_page, 'Listings per page', 4, 48);
}

/** Every href/url/link-like value inside page sections (hero buttons, banners, CTAs…) gets the same check. */
const EMBED_HOSTS = /^(https:\/\/(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/|vimeo\.com\/(\d+|video\/\d+)|player\.vimeo\.com\/video\/|google\.com\/maps\/embed|calendly\.com\/|openstreetmap\.org\/export\/embed)[^\s"'<>]*)$/i;
export function validateSections(sections) {
  if (sections.length > MAX_SECTIONS) throw bad(`A page can hold up to ${MAX_SECTIONS} blocks`);
  const ids = new Set();
  for (const sec of sections) {
    if (!sec || typeof sec !== 'object' || Array.isArray(sec)) throw bad('Invalid section');
    if (!SECTION_TYPE_NAMES.includes(sec.type)) throw bad(`“${String(sec.type ?? '').slice(0, 30)}” is not a block this website can show. Delete that block, then save again.`);
    const id = typeof sec.id === 'number' ? String(sec.id) : sec.id;
    if (typeof id !== 'string' || !SECTION_ID.test(id)) throw bad('Every block needs an id made of letters, digits, _ or -');
    if (ids.has(id)) throw bad('Two blocks on this page have the same id. Duplicate the block again instead of copying its data.');
    ids.add(id);
    if (sec.props !== undefined && (typeof sec.props !== 'object' || sec.props === null || Array.isArray(sec.props))) throw bad('Invalid block settings');
    if (sec.type === 'embed' && sec.props?.url && !EMBED_HOSTS.test(String(sec.props.url).trim())) throw bad('A video, map or calendar block takes a link from YouTube, Vimeo, Google Maps (Share, Embed a map), Calendly or OpenStreetMap');
    if (sec.style !== undefined) {
      try { const s = cleanSectionStyle(sec.style); if (s) sec.style = s; else delete sec.style; } catch (e) { throw bad(e.message); }
    }
  }
  const walk = (v, path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (/^(html|text|a|body|bio|intro|answer)$/.test(k) && typeof val === 'string' && isHtml(val)) { v[k] = sanitizeHtml(val); continue; }
        if (/(^|_)(href|url|link)$/i.test(k) && typeof val === 'string') checkLink(val, `A link in the page (${k})`);
        else if (/^(image|src|bg|background|bg_image|cover|logo|photo)$/i.test(k) && typeof val === 'string') checkImage(val, `The ${k} in the page`);
        else walk(val, `${path}.${k}`);
      }
    }
  };
  walk(sections, 'sections');
}

/**
 * Defence in depth for what visitors receive: every text that holds HTML is cleaned again on the way out (pages saved
 * before the sanitiser existed, or written by other code, are covered too). Returns a cleaned copy; never throws.
 */
export function cleanForOutput(value) {
  if (typeof value === 'string') return isHtml(value) ? sanitizeHtml(value) : value;
  if (Array.isArray(value)) return value.map(cleanForOutput);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanForOutput(v)]));
  return value;
}
