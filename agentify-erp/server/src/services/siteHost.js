// How a workspace's website is served to visitors: on a customer's own domain only the website is reachable (the ERP
// sign-in lives on the workspace address), and the HTML of every website page carries its own title, description,
// canonical link and sharing tags from the server, so search engines and link previews (WhatsApp, Facebook) see them
// without running JavaScript.
import { get, getSetting } from '../db.js';
import { BASE_DOMAIN, isMultiTenant } from '../platform.js';
import { publicSite, validPreview } from './siteRelease.js';

const hostOf = (req) => String(req.hostname || '').toLowerCase().replace(/\.$/, '');

/** Is this request for a workspace through its own connected domain (not <slug>.<base domain>)? */
export const viaCustomDomain = (req) => !!(isMultiTenant() && req.tenant?.custom_domain && hostOf(req) === String(req.tenant.custom_domain).toLowerCase());

/** The workspace address, where staff, customers and vendors sign in. */
export const workspaceUrl = (tenant, req) => (BASE_DOMAIN === 'localhost' && req ? `${req.protocol}://${tenant.slug}.localhost${req.get('host')?.match(/:\d+$/)?.[0] || ''}` : `https://${tenant.slug}.${BASE_DOMAIN}`);

// what a custom domain serves: the website, its data, public images and the app's static files
const SITE_API = /^\/api\/(site|public|hooks|meet)(\/|$)|^\/api\/v1\/forms\/[\w-]+\/submit$/;
const SITE_PATH = /^\/(site(\/.*)?|sitemap\.xml|robots\.txt|assets\/.+|embed\/.+|uploads\/media\/.+|[\w.-]+\.(png|ico|svg|webmanifest|js|json|txt|jpg|webp))?$/;

/** Express middleware: on a custom domain everything except the website goes to the workspace address. */
export function websiteOnlyOnCustomDomain(req, res, next) {
  if (!viaCustomDomain(req)) return next();
  if (SITE_API.test(req.path) || SITE_PATH.test(req.path)) return next();
  const ws = workspaceUrl(req.tenant, req);
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: `This address shows the website only. Use ${ws} for the workspace.` });
  if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(302, `${ws}${req.originalUrl}`);
  return res.status(404).json({ error: 'Not found' });
}

// ---------------------------------------------------------------- server-side page tags
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (s, max = 200) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/[#*_`>[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const origin = (req, cfg) => (cfg.seo?.base_url || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const abs = (base, u) => (!u ? '' : /^https?:/.test(u) ? u : `${base}${u.startsWith('/') ? u : `/uploads/${u}`}`);

/** Title, description and image for one website address, from published data only (null when nothing matches). */
function pageMeta(path, site) {
  const cfg = site.config;
  const brand = cfg.brand?.name || getSetting('company_name', '') || 'Website';
  const titled = (t) => (t ? `${t} · ${brand}` : (cfg.seo?.title || brand));
  const defDesc = cfg.seo?.description || '';
  const parts = path.replace(/^\/site\/?/, '').split('/').filter(Boolean);
  if (!parts.length) {
    const home = site.pages.find((p) => p.slug === 'home' && p.published);
    return { title: home?.seo_title || cfg.seo?.title || brand, description: home?.seo_desc || defDesc };
  }
  const [kind, key] = parts;
  if (kind === 'p' && key) {
    const p = site.pages.find((x) => x.slug === key && x.published);
    return p ? { title: titled(p.seo_title || p.title), description: p.seo_desc || defDesc } : null;
  }
  if (kind === 'property' && /^\d+$/.test(key || '')) {
    const p = get("SELECT p.id,p.title,p.short_desc,p.description,(SELECT path FROM media WHERE entity_type='property' AND entity_id=p.id AND kind IN ('cover','gallery') ORDER BY kind='cover' DESC, sort_order LIMIT 1) cover FROM properties p WHERE p.id=? AND p.published=1 AND p.status IN ('available','featured','reserved','sold')", Number(key));
    return p ? { title: titled(p.title), description: plain(p.short_desc || p.description) || defDesc, image: p.cover } : null;
  }
  if (kind === 'project' && /^\d+$/.test(key || '')) {
    const p = get("SELECT p.id,p.name,p.description,(SELECT path FROM media WHERE entity_type='project' AND entity_id=p.id ORDER BY sort_order LIMIT 1) cover FROM projects p WHERE p.id=? AND p.site_visible=1", Number(key));
    return p ? { title: titled(p.name), description: plain(p.description) || defDesc, image: p.cover } : null;
  }
  if (kind === 'blog' && key) {
    const p = get('SELECT title,excerpt,seo_title,seo_desc,cover FROM site_posts WHERE slug=? AND published=1', key);
    return p ? { title: titled(p.seo_title || p.title), description: p.seo_desc || plain(p.excerpt) || defDesc, image: p.cover, type: 'article' } : null;
  }
  const names = { properties: 'Properties', projects: 'Projects', agents: 'Our agents', blog: 'Blog', calculators: 'Calculators' };
  return names[kind] && !key ? { title: titled(names[kind]), description: defDesc } : { title: titled(''), description: defDesc };
}

/** The app's HTML shell with the tags for a website page. Drafts (preview links) and offline sites are never indexed. */
export function injectSiteMeta(html, req) {
  if (req.path.startsWith('/site/__editor')) return html;
  const preview = !!req.query.preview && validPreview(req.query.preview);
  const site = publicSite({ preview });
  const cfg = site.config;
  const base = origin(req, cfg);
  const m = site.offline ? { title: cfg.brand?.name || 'Website', description: '' } : pageMeta(req.path, site);
  const noindex = preview || site.offline || !!cfg.seo?.noindex || !m;
  const meta = m || { title: cfg.brand?.name || 'Website', description: '' };
  const url = `${base}${req.path === '/site/' ? '/site' : req.path}`;
  const image = abs(base, meta.image || cfg.seo?.image);
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    meta.description && `<meta name="description" content="${esc(meta.description)}" />`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />`,
    !noindex && `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${meta.type || 'website'}" />`, `<meta property="og:site_name" content="${esc(cfg.brand?.name || '')}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`, meta.description && `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`, image && `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`, `<meta name="twitter:title" content="${esc(meta.title)}" />`,
  ].filter(Boolean).join('\n    ');
  return html.replace(/<title>[\s\S]*?<\/title>/, tags);
}

