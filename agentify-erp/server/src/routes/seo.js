import { Router } from 'express';
import { all, get, run, setSetting } from '../db.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad, notFound, now } from '../util.js';
import { siteConfig } from './site.js';
import { validateSiteConfig } from '../services/siteValidate.js';
import { sendTable } from './helpers.js';
import { liveConfig, livePages, liveRelease, isOffline } from '../services/siteRelease.js';

/** SEO manager backend (permission module: seo) plus the public sitemap.xml and robots.txt. */
const r = Router();
r.use(requireStaff);

const TITLE = [30, 60], DESC = [70, 160];
const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** Plain-language problems with a title / description pair. */
export function metaIssues(title, desc, { fallbackTitle = '' } = {}) {
  const out = [];
  const t = String(title || '').trim(), d = String(desc || '').trim();
  if (!t) out.push(fallbackTitle ? 'No SEO title — the page name is used' : 'Missing SEO title');
  else if (t.length < TITLE[0]) out.push(`Title is short (${t.length} characters, aim for ${TITLE[0]}–${TITLE[1]})`);
  else if (t.length > TITLE[1]) out.push(`Title is long (${t.length} characters) and may be cut off in Google`);
  if (!d) out.push('Missing meta description');
  else if (d.length < DESC[0]) out.push(`Description is short (${d.length} characters, aim for ${DESC[0]}–${DESC[1]})`);
  else if (d.length > DESC[1]) out.push(`Description is long (${d.length} characters) and may be cut off`);
  return out;
}

function collect() {
  const pages = all('SELECT id,slug,title,seo_title,seo_desc,published,updated_at FROM site_pages ORDER BY sort_order,id').map((p) => ({ ...p, kind: 'page', url: p.slug === 'home' ? '/site' : `/site/p/${p.slug}`, issues: metaIssues(p.seo_title, p.seo_desc, { fallbackTitle: p.title }) }));
  const posts = all('SELECT id,slug,title,excerpt,seo_title,seo_desc,published FROM site_posts ORDER BY id DESC').map((p) => ({ ...p, kind: 'post', url: `/site/blog/${p.slug}`, issues: metaIssues(p.seo_title, p.seo_desc || p.excerpt, { fallbackTitle: p.title }) }));
  const dupes = (rows, key) => { const seen = {}; rows.forEach((x) => { const v = String(x[key] || '').trim().toLowerCase(); if (v) (seen[v] ||= []).push(x); }); Object.values(seen).filter((g) => g.length > 1).forEach((g) => g.forEach((x) => x.issues.push(`Same ${key === 'seo_title' ? 'title' : 'description'} as another page`))); };
  const all2 = [...pages, ...posts]; dupes(all2, 'seo_title'); dupes(all2, 'seo_desc');
  return { pages, posts };
}

r.get('/overview', can('seo', 'view'), asyncH((req, res) => {
  const cfg = siteConfig();
  const { pages, posts } = collect();
  const items = [...pages, ...posts].filter((x) => x.published);
  const siteIssues = [];
  if (!cfg.seo?.title) siteIssues.push('Add a default site title'); else if (cfg.seo.title.length > TITLE[1]) siteIssues.push('Default site title is too long');
  if (!cfg.seo?.description) siteIssues.push('Add a default site description');
  if (!cfg.seo?.image) siteIssues.push('Add a share image (shown when links are shared on WhatsApp and Facebook)');
  if (!cfg.seo?.base_url) siteIssues.push('Set your website address so the sitemap uses your real domain');
  if (cfg.seo?.noindex) siteIssues.push('Search engines are currently blocked from the whole site');
  const total = items.length * 2 + 5;
  const bad2 = items.reduce((s, x) => s + Math.min(2, x.issues.length), 0) + siteIssues.length;
  const proj = get("SELECT COUNT(*) n FROM projects WHERE site_visible=1 AND (description IS NULL OR LENGTH(description)<60)").n;
  const live = get("SELECT COUNT(*) n FROM properties WHERE published=1 AND status IN ('available','featured') AND (description IS NULL OR LENGTH(description)<60)").n;
  res.json({
    site: { title: cfg.seo?.title || '', description: cfg.seo?.description || '', image: cfg.seo?.image || '', keywords: cfg.seo?.keywords || '', base_url: cfg.seo?.base_url || '', noindex: !!cfg.seo?.noindex, org_type: cfg.seo?.org_type || 'RealEstateAgent' },
    brand: cfg.brand?.name, pages, posts, siteIssues,
    score: Math.max(0, Math.round(100 - (bad2 / Math.max(1, total)) * 100)),
    content: { projects_thin: proj, listings_thin: live, listings_live: get("SELECT COUNT(*) n FROM properties WHERE published=1 AND status IN ('available','featured')").n, projects_live: get('SELECT COUNT(*) n FROM projects WHERE site_visible=1').n },
    sitemap: '/sitemap.xml', robots: '/robots.txt',
  });
}));

// edits here change the draft: make sure the live website is frozen as a release first
r.use((req, _res, next) => { if (req.method !== 'GET') liveRelease(); next(); });

r.put('/site', can('seo', 'edit'), asyncH((req, res) => {
  const b = req.body || {};
  const cfg = siteConfig();
  const seo = { ...cfg.seo };
  const text = (k, max) => { if (b[k] !== undefined) { const v = String(b[k] ?? '').trim(); if (v.length > max) throw bad(`${k.replace('_', ' ')} is too long (max ${max} characters)`); seo[k] = v; } };
  text('title', 120); text('description', 320); text('keywords', 400); text('image', 300); text('org_type', 40);
  if (b.base_url !== undefined) { const v = String(b.base_url || '').trim().replace(/\/+$/, ''); if (v && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(v)) throw bad('The website address must start with https:// (for example https://www.expertdevelopers.pk)'); seo.base_url = v; }
  if (b.noindex !== undefined) seo.noindex = !!b.noindex;
  if (!['RealEstateAgent', 'Organization', 'LocalBusiness', 'GeneralContractor'].includes(seo.org_type)) seo.org_type = 'RealEstateAgent';
  const next = { ...cfg, seo };
  validateSiteConfig(next);
  setSetting('site_config', JSON.stringify(next));
  audit(req, 'Updated SEO settings', 'website', null, Object.keys(b).join(', '));
  res.json({ ok: true });
}));

const metaBody = (b) => {
  const seo_title = String(b.seo_title ?? '').trim(), seo_desc = String(b.seo_desc ?? '').trim();
  if (seo_title.length > 90) throw bad('SEO title is too long (max 90 characters)');
  if (seo_desc.length > 250) throw bad('Meta description is too long (max 250 characters)');
  return { seo_title, seo_desc };
};
r.put('/pages/:id(\\d+)', can('seo', 'edit'), asyncH((req, res) => {
  const p = get('SELECT id,title FROM site_pages WHERE id=?', req.params.id); if (!p) throw notFound('Page not found');
  const m = metaBody(req.body || {});
  run('UPDATE site_pages SET seo_title=?, seo_desc=?, updated_at=? WHERE id=?', m.seo_title, m.seo_desc, now(), p.id);
  audit(req, 'Updated page SEO', 'website', p.id, p.title);
  res.json({ ok: true, issues: metaIssues(m.seo_title, m.seo_desc, { fallbackTitle: p.title }) });
}));
r.put('/posts/:id(\\d+)', can('seo', 'edit'), asyncH((req, res) => {
  const p = get('SELECT id,title,excerpt FROM site_posts WHERE id=?', req.params.id); if (!p) throw notFound('Post not found');
  const m = metaBody(req.body || {});
  run('UPDATE site_posts SET seo_title=?, seo_desc=?, updated_at=? WHERE id=?', m.seo_title, m.seo_desc, now(), p.id);
  audit(req, 'Updated blog post SEO', 'website', p.id, p.title);
  res.json({ ok: true, issues: metaIssues(m.seo_title, m.seo_desc || p.excerpt, { fallbackTitle: p.title }) });
}));

r.get('/export', can('seo', 'export'), asyncH((req, res) => {
  const { pages, posts } = collect();
  const rows = [...pages, ...posts].map((x) => ({ type: x.kind, title: x.title, url: x.url, seo_title: x.seo_title || '', seo_desc: x.seo_desc || '', issues: x.issues.join('; ') }));
  return sendTable(res, req.query.format, 'seo-audit', [{ key: 'type', label: 'Type' }, { key: 'title', label: 'Title' }, { key: 'url', label: 'URL' }, { key: 'seo_title', label: 'SEO title' }, { key: 'seo_desc', label: 'Meta description' }, { key: 'issues', label: 'Issues' }], rows);
}));

// ---------------------------------------------------------------- public: sitemap.xml and robots.txt (mounted at the site root)
const baseUrl = (req, cfg) => (cfg.seo?.base_url || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
export function sitemap(req, res) {
  const cfg = liveConfig(), base = baseUrl(req, cfg);
  const urls = [{ loc: '/site', pri: '1.0' }, { loc: '/site/properties', pri: '0.9' }, { loc: '/site/projects', pri: '0.8' }, { loc: '/site/agents', pri: '0.5' }, { loc: '/site/calculators', pri: '0.7' }, { loc: '/site/blog', pri: '0.6' }];
  if (isOffline()) return res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
  // published pages of the live release (unpublished edits are not on the site yet)
  const releasedAt = liveRelease().published_at;
  for (const p of livePages().filter((x) => x.slug !== 'home')) urls.push({ loc: `/site/p/${p.slug}`, mod: releasedAt, pri: '0.7' });
  for (const p of all("SELECT id,updated_at FROM properties WHERE published=1 AND status IN ('available','featured','reserved')")) urls.push({ loc: `/site/property/${p.id}`, mod: p.updated_at, pri: '0.8' });
  for (const p of all('SELECT id FROM projects WHERE site_visible=1')) urls.push({ loc: `/site/project/${p.id}`, pri: '0.8' });
  for (const p of all('SELECT slug,COALESCE(updated_at,published_at) m FROM site_posts WHERE published=1')) urls.push({ loc: `/site/blog/${p.slug}`, mod: p.m, pri: '0.5' });
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(base + u.loc)}</loc>${u.mod ? `<lastmod>${esc(String(u.mod).slice(0, 10))}</lastmod>` : ''}<priority>${u.pri}</priority></url>`).join('\n')}\n</urlset>\n`);
}
export function robots(req, res) {
  const cfg = liveConfig(), base = baseUrl(req, cfg);
  res.type('text/plain').send(cfg.seo?.noindex || isOffline() ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /site\nDisallow: /api/\nDisallow: /uploads/documents\nDisallow: /portal\nDisallow: /vendor\nDisallow: /login\n\nSitemap: ${base}/sitemap.xml\n`);
}

export default r;
