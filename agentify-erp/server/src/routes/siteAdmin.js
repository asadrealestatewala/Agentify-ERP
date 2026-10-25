import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, getSetting, setSetting, uploadDir } from '../db.js';
import { can, hasPerm, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { uploader } from './helpers.js';
import { asyncH, bad, notFound, jparse, now, HttpError } from '../util.js';
import { siteConfig } from './site.js';
import { validateSiteConfig, validateSections } from '../services/siteValidate.js';
import { defaultConfig, defaultPages } from '../services/siteDefaults.js';
import { SITE_THEMES, themeById } from '../../../shared/siteThemes.js';
import { buildKnowledge, reply } from '../services/bot.js';
import rateLimit from 'express-rate-limit';
import { generateSiteDraft, BUSINESS_TYPES, STYLES, TONES } from '../services/siteAi.js';
import { isHtml, sanitizeHtml, wordCount } from '../services/richText.js';
import { liveRelease, isOffline, draftDiffers, publishDraft, setOffline, releaseList, restoreRelease, discardDraft, createPreviewLink, revokePreviewLinks } from '../services/siteRelease.js';

/** Website editor backend (permission module: website). */
const r = Router();
r.use(requireStaff);

const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// Every change made here is a draft. Before the first one, the website visitors see is frozen as the live release.
r.use((req, _res, next) => { if (req.method !== 'GET') liveRelease(); next(); });

// ---- publishing: draft -> release (what visitors see), unpublish, history with restore, shareable preview links
const releaseRow = (id) => get('SELECT r.id, r.label, r.published_at, u.name by_name FROM site_releases r LEFT JOIN users u ON u.id=r.published_by WHERE r.id=?', id);
r.get('/publish', can('website', 'view'), (req, res) => {
  const live = liveRelease();
  res.json({ live: releaseRow(live.id), offline: isOffline(), changes: draftDiffers(), releases: get('SELECT COUNT(*) n FROM site_releases').n });
});
/** A free website goes public only once its owner has confirmed their email address (keeps throwaway signups off the web). */
const verifiedToPublish = (req, _res, next) => {
  if (req.tenant?.product === 'website' && !get('SELECT email_verified FROM users WHERE id=?', req.user.id)?.email_verified) {
    return next(new HttpError(403, 'Confirm your email address first: open the link in the welcome email, then publish.', { code: 'email_not_verified' }));
  }
  next();
};
r.post('/publish', can('website', 'edit'), verifiedToPublish, asyncH((req, res) => {
  const label = String(req.body?.label || '').trim().slice(0, 120);
  const id = publishDraft(req.user.id, label || 'Published');
  audit(req, 'Published the website', 'website', id, label || null);
  res.json({ ok: true, live: releaseRow(id) });
}));
r.post('/unpublish', can('website', 'delete'), asyncH((req, res) => {
  setOffline(true);
  audit(req, 'Took the website offline', 'website');
  res.json({ ok: true, offline: true });
}));
r.post('/online', can('website', 'edit'), verifiedToPublish, asyncH((req, res) => {
  setOffline(false);
  audit(req, 'Put the website back online', 'website');
  res.json({ ok: true, offline: false });
}));
r.get('/releases', can('website', 'view'), (req, res) => res.json(releaseList()));
r.post('/releases/:id(\\d+)/restore', can('website', 'edit'), verifiedToPublish, asyncH((req, res) => {
  const id = restoreRelease(Number(req.params.id), req.user.id);
  audit(req, 'Restored an earlier version of the website', 'website', id, `from release ${req.params.id}`);
  res.json({ ok: true, live: releaseRow(id) });
}));
r.post('/draft/discard', can('website', 'delete'), asyncH((req, res) => {
  discardDraft(req.user.id);
  audit(req, 'Discarded unpublished website changes', 'website');
  res.json({ ok: true });
}));
r.post('/preview-link', can('website', 'view'), asyncH((req, res) => {
  const { token, expires_at } = createPreviewLink(req.user.id);
  audit(req, 'Created a website preview link', 'website');
  res.status(201).json({ path: `/site?preview=${token}`, expires_at });
}));
r.delete('/preview-links', can('website', 'edit'), asyncH((req, res) => {
  revokePreviewLinks();
  audit(req, 'Revoked website preview links', 'website');
  res.json({ ok: true });
}));

r.get('/config', can('website', 'view'), (req, res) => res.json(siteConfig()));
r.put('/config', can('website', 'edit'), asyncH((req, res) => {
  const c = req.body;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('Invalid configuration');
  if (c.theme) for (const k of ['primary', 'accent', 'dark', 'bg', 'soft']) if (c.theme[k] && !/^#[0-9a-fA-F]{3,8}$/.test(c.theme[k])) throw bad(`Theme colour "${k}" must be a hex value like #0f766e`);
  validateSiteConfig(c);
  setSetting('site_config', JSON.stringify(c));
  audit(req, 'Updated website settings', 'website', null, Object.keys(c).join(', '));
  res.json({ ok: true });
}));
r.post('/config/reset', can('website', 'delete'), asyncH((req, res) => {
  setSetting('site_config', JSON.stringify(defaultConfig()));
  audit(req, 'Reset website settings', 'website');
  res.json({ ok: true });
}));

// ---- "Create with AI": a draft page from a short brief, using the workspace's own AI connection. Nothing is saved here.
const aiLimit = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.SITE_AI_LIMIT) || 12, standardHeaders: true, legacyHeaders: false, message: { error: 'You have used the AI page writer many times this hour. Please try again later.' } });
r.get('/ai/options', can('website', 'view'), (req, res) => res.json({ types: BUSINESS_TYPES, styles: STYLES, tones: TONES }));
r.post('/ai/generate', can('website', 'edit'), aiLimit, asyncH(async (req, res) => {
  const draft = await generateSiteDraft(req.body || {});
  audit(req, 'Generated a website draft with AI', 'website', null, draft.brief.company);
  res.json(draft);
}));

// ---- customer reviews sent from the website: approve before they show
r.get('/reviews', can('website', 'view'), (req, res) => {
  const st = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) n FROM site_reviews GROUP BY status').map((x) => [x.status, x.n]));
  res.json({ counts: { pending: 0, approved: 0, rejected: 0, ...counts }, rows: all(`SELECT id,name,role,company,country,rating,quote,email,status,decided_by,decided_at,created_at,(photo IS NOT NULL) has_photo FROM site_reviews ${st ? 'WHERE status=?' : ''} ORDER BY id DESC LIMIT 300`, ...(st ? [st] : [])) });
});
r.get('/reviews/:id(\\d+)/photo', can('website', 'view'), (req, res) => {
  const p = get('SELECT photo, photo_type FROM site_reviews WHERE id=? AND photo IS NOT NULL', req.params.id);
  if (!p) throw notFound('Not found');
  res.set({ 'Content-Type': p.photo_type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(p.photo, 'base64'));
});
r.post('/reviews/:id(\\d+)/:decision(approve|reject|reset)', can('website', 'edit'), asyncH((req, res) => {
  const status = { approve: 'approved', reject: 'rejected', reset: 'pending' }[req.params.decision];
  const row = get('SELECT id,name FROM site_reviews WHERE id=?', req.params.id);
  if (!row) throw notFound('Review not found');
  run("UPDATE site_reviews SET status=?, decided_by=?, decided_at=datetime('now') WHERE id=?", status, req.user.name || req.user.email, row.id);
  audit(req, `Review ${status}`, 'website', row.id, row.name);
  res.json({ ok: true, status });
}));
r.delete('/reviews/:id(\\d+)', can('website', 'delete'), asyncH((req, res) => {
  const row = get('SELECT id,name FROM site_reviews WHERE id=?', req.params.id);
  if (!row) throw notFound('Review not found');
  run('DELETE FROM site_reviews WHERE id=?', row.id);
  audit(req, 'Review deleted', 'website', row.id, row.name);
  res.json({ ok: true });
}));

// ---- pages
const parsePage = (p) => (p ? { ...p, sections: jparse(p.sections, []) } : p);
r.get('/pages', can('website', 'view'), (req, res) => res.json(all('SELECT id,slug,title,published,show_in_menu,sort_order,seo_title,seo_desc,updated_at FROM site_pages ORDER BY sort_order,id')));
r.get('/pages/:id(\\d+)', can('website', 'view'), asyncH((req, res) => {
  const p = get('SELECT * FROM site_pages WHERE id=?', req.params.id);
  if (!p) throw notFound();
  res.json(parsePage(p));
}));
/** Version history: every save keeps a snapshot (the newest 40 per page) so any earlier layout can be restored. */
function snapshot(pageId, title, sections, label, userId) {
  const last = get('SELECT sections FROM site_page_versions WHERE page_id=? ORDER BY id DESC LIMIT 1', pageId);
  if (last && last.sections === sections && !label) return;
  run('INSERT INTO site_page_versions(page_id,title,sections,label,user_id,created_at) VALUES(?,?,?,?,?,?)', pageId, title, sections, String(label || '').slice(0, 80), userId, now());
  run('DELETE FROM site_page_versions WHERE page_id=? AND id NOT IN (SELECT id FROM site_page_versions WHERE page_id=? ORDER BY id DESC LIMIT 40)', pageId, pageId);
}
r.get('/pages/:id(\\d+)/versions', can('website', 'view'), (req, res) => res.json(all(`SELECT v.id,v.label,v.title,v.created_at,u.name by_name, json_array_length(v.sections) sections FROM site_page_versions v LEFT JOIN users u ON u.id=v.user_id WHERE v.page_id=? ORDER BY v.id DESC`, req.params.id)));
r.get('/pages/:id(\\d+)/versions/:vid(\\d+)', can('website', 'view'), asyncH((req, res) => {
  const v = get('SELECT id,title,label,created_at,sections FROM site_page_versions WHERE id=? AND page_id=?', req.params.vid, req.params.id);
  if (!v) throw notFound('Version not found');
  res.json({ ...v, sections: jparse(v.sections, []) });
}));
r.post('/pages/:id(\\d+)/versions', can('website', 'edit'), asyncH((req, res) => {
  const p = get('SELECT id,title,sections FROM site_pages WHERE id=?', req.params.id); if (!p) throw notFound();
  snapshot(p.id, p.title, p.sections, String(req.body?.label || 'Saved version').trim() || 'Saved version', req.user.id);
  res.status(201).json({ ok: true });
}));
r.post('/pages', can('website', 'create'), asyncH((req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) throw bad('Page title is required');
  const slug = slugify(req.body.slug || title);
  if (!slug) throw bad('Invalid page address');
  if (get('SELECT 1 FROM site_pages WHERE slug=?', slug)) throw bad('A page with this address already exists');
  if (Array.isArray(req.body.sections)) validateSections(req.body.sections);
  const id = Number(run('INSERT INTO site_pages(slug,title,sections,published,sort_order,show_in_menu,updated_at) VALUES(?,?,?,?,?,?,?)', slug, title, JSON.stringify(req.body.sections || []), 1, (get('SELECT COALESCE(MAX(sort_order),0) m FROM site_pages').m) + 1, 0, now()).lastInsertRowid);
  audit(req, 'Created website page', 'website', id, title);
  res.status(201).json(parsePage(get('SELECT * FROM site_pages WHERE id=?', id)));
}));
r.put('/pages/:id(\\d+)', can('website', 'edit'), asyncH((req, res) => {
  const p = get('SELECT * FROM site_pages WHERE id=?', req.params.id);
  if (!p) throw notFound();
  const b = req.body;
  if (b.sections !== undefined && !Array.isArray(b.sections)) throw bad('Sections must be a list');
  if (b.sections) validateSections(b.sections);
  let slug = p.slug;
  if (b.slug !== undefined && p.slug !== 'home') { slug = slugify(b.slug); if (!slug) throw bad('Invalid page address'); if (get('SELECT 1 FROM site_pages WHERE slug=? AND id<>?', slug, p.id)) throw bad('A page with this address already exists'); }
  if (b.sections) {
    const lastV = get('SELECT sections FROM site_page_versions WHERE page_id=? ORDER BY id DESC LIMIT 1', p.id);
    if (!lastV && p.sections !== JSON.stringify(b.sections)) snapshot(p.id, p.title, p.sections, 'Before first editor save', req.user.id);
  }
  run(`UPDATE site_pages SET title=COALESCE(?,title), slug=?, sections=COALESCE(?,sections), published=COALESCE(?,published), seo_title=COALESCE(?,seo_title), seo_desc=COALESCE(?,seo_desc), show_in_menu=COALESCE(?,show_in_menu), updated_at=? WHERE id=?`,
    b.title ?? null, slug, b.sections ? JSON.stringify(b.sections) : null, b.published === undefined ? null : b.published ? 1 : 0, b.seo_title ?? null, b.seo_desc ?? null, b.show_in_menu === undefined ? null : b.show_in_menu ? 1 : 0, now(), p.id);
  if (b.sections) snapshot(p.id, b.title ?? p.title, JSON.stringify(b.sections), b.version_label || '', req.user.id);
  audit(req, 'Edited website page', 'website', p.id, p.title);
  res.json(parsePage(get('SELECT * FROM site_pages WHERE id=?', p.id)));
}));
r.post('/pages/:id(\\d+)/duplicate', can('website', 'create'), asyncH((req, res) => {
  const p = get('SELECT * FROM site_pages WHERE id=?', req.params.id);
  if (!p) throw notFound();
  let slug = `${p.slug}-copy`, n = 2;
  while (get('SELECT 1 FROM site_pages WHERE slug=?', slug)) slug = `${p.slug}-copy-${n++}`;
  const id = Number(run('INSERT INTO site_pages(slug,title,sections,published,sort_order,show_in_menu,updated_at) VALUES(?,?,?,?,?,?,?)', slug, `${p.title} (copy)`, p.sections, 0, p.sort_order + 1, 0, now()).lastInsertRowid);
  res.status(201).json({ id });
}));
r.delete('/pages/:id(\\d+)', can('website', 'delete'), asyncH((req, res) => {
  const p = get('SELECT * FROM site_pages WHERE id=?', req.params.id);
  if (!p) throw notFound();
  if (p.slug === 'home') throw bad('The home page cannot be deleted');
  run('DELETE FROM site_pages WHERE id=?', p.id);
  audit(req, 'Deleted website page', 'website', p.id, p.title);
  res.json({ ok: true });
}));
r.post('/pages/:id(\\d+)/reset', can('website', 'delete'), asyncH((req, res) => {
  const p = get('SELECT * FROM site_pages WHERE id=?', req.params.id);
  const d = defaultPages().find((x) => x.slug === p?.slug);
  if (!p || !d) throw bad('Only the starter pages (home, about, contact) can be reset');
  run('UPDATE site_pages SET sections=?, updated_at=? WHERE id=?', JSON.stringify(d.sections), now(), p.id);
  res.json({ ok: true });
}));

// ---- theme library: install a theme's design and pages as a draft. Nothing is overwritten silently: the editor says
// which pages change, a replaced page keeps its current layout in its version history first, a page whose address is
// taken can be added beside it (hidden), and visitors see nothing until Publish.
r.get('/themes', can('website', 'view'), (req, res) => res.json({ active: siteConfig().active_theme || null, themes: SITE_THEMES.map((t) => ({ id: t.id, name: t.name, pages: t.pages.map((p) => ({ slug: p.slug, title: p.title, exists: !!get('SELECT 1 FROM site_pages WHERE slug=?', p.slug) })) })) }));
r.post('/themes/:id/install', can('website', 'edit'), asyncH((req, res) => {
  const t = themeById(req.params.id);
  if (!t) throw notFound();
  const { design, pages = [] } = req.body || {};
  if (!Array.isArray(pages) || pages.length > t.pages.length) throw bad('Choose the pages to install');
  const known = new Map(t.pages.map((p) => [p.slug, p]));
  const seen = new Set();
  for (const p of pages) {
    if (!p || !known.has(p.slug)) throw bad(`“${String(p?.slug || '').slice(0, 40)}” is not a page of the ${t.name} theme`);
    if (seen.has(p.slug)) throw bad('Each page can be chosen once'); seen.add(p.slug);
    if (!['replace', 'add', 'skip'].includes(p.mode)) throw bad('Choose replace, add or skip for each page');
    if (p.mode !== 'skip') { if (!Array.isArray(p.sections)) throw bad('Sections must be a list'); validateSections(p.sections); }
  }
  let cfg = null;
  if (design) {
    const cur = siteConfig();
    cfg = { ...cur, theme: { ...(cur.theme || {}), ...t.design.theme }, header: { ...(cur.header || {}), ...t.design.header }, footer: { ...(cur.footer || {}), ...t.design.footer }, active_theme: t.id };
    validateSiteConfig(cfg);
  }
  if (!cfg && !pages.some((p) => p.mode !== 'skip')) throw bad('Nothing to install: choose the design or at least one page');
  const done = tx(() => {
    const out = [];
    for (const p of pages) {
      if (p.mode === 'skip') continue;
      const json = JSON.stringify(p.sections);
      const cur = get('SELECT * FROM site_pages WHERE slug=?', p.slug);
      if (cur && p.mode === 'replace') {
        snapshot(cur.id, cur.title, cur.sections, `Before the ${t.name} theme`, req.user.id);
        run('UPDATE site_pages SET sections=?, updated_at=? WHERE id=?', json, now(), cur.id);
        snapshot(cur.id, cur.title, json, `${t.name} theme`, req.user.id);
        out.push({ slug: cur.slug, id: cur.id, action: 'replaced' });
      } else {
        let slug = p.slug, k = 2;
        if (cur) { slug = `${p.slug}-${t.id}`; while (get('SELECT 1 FROM site_pages WHERE slug=?', slug)) slug = `${p.slug}-${t.id}-${k++}`; }
        const title = cur ? `${known.get(p.slug).title} (${t.name})` : known.get(p.slug).title;
        const id = Number(run('INSERT INTO site_pages(slug,title,sections,published,sort_order,show_in_menu,updated_at) VALUES(?,?,?,?,?,?,?)', slug, title, json, cur ? 0 : 1, (get('SELECT COALESCE(MAX(sort_order),0) m FROM site_pages').m) + 1, !cur && known.get(p.slug).show_in_menu ? 1 : 0, now()).lastInsertRowid);
        snapshot(id, title, json, `${t.name} theme`, req.user.id);
        out.push({ slug, id, action: 'added', hidden: !!cur });
      }
    }
    if (cfg) setSetting('site_config', JSON.stringify(cfg));
    return out;
  });
  audit(req, 'Installed website theme', 'website', null, `${t.name}: ${[cfg ? 'design' : '', ...done.map((d) => `${d.slug} ${d.action}`)].filter(Boolean).join(', ')}`);
  res.json({ ok: true, design: !!cfg, pages: done });
}));

// ---- blog posts
/** SEO managers write and edit articles (and upload their images) without needing access to the rest of the website editor. */
const blogCan = (action) => (req, res, next) => (req.user && action !== 'delete' && hasPerm(req.user, 'seo', 'edit') ? next() : can('website', action)(req, res, next));
const parsePost = (p) => (p ? { ...p, tags: jparse(p.tags, []) } : p);
r.get('/posts', blogCan('view'), (req, res) => res.json(all('SELECT id,slug,title,excerpt,body,cover,tags,published,published_at,created_at,seo_title,seo_desc,focus_keyword FROM site_posts ORDER BY id DESC').map((p) => { const { body, ...rest } = parsePost(p); return { ...rest, words: wordCount(body) }; })));
r.get('/posts/:id(\\d+)', blogCan('view'), asyncH((req, res) => {
  const p = get('SELECT * FROM site_posts WHERE id=?', req.params.id);
  if (!p) throw notFound();
  res.json(parsePost(p));
}));
function savePost(req, id) {
  const b = req.body;
  const title = String(b.title || '').trim();
  if (!title) throw bad('Title is required');
  const slug = slugify(b.slug || title);
  if (get('SELECT 1 FROM site_posts WHERE slug=? AND id<>?', slug, id || 0)) throw bad('Another article already uses this address');
  const tags = JSON.stringify((b.tags || []).map((t) => String(t).trim()).filter(Boolean));
  const published = b.published ? 1 : 0;
  const body = isHtml(b.body) ? sanitizeHtml(b.body) : String(b.body ?? '').slice(0, 100_000);
  const seoTitle = String(b.seo_title ?? '').trim().slice(0, 90), seoDesc = String(b.seo_desc ?? '').trim().slice(0, 250), focus = String(b.focus_keyword ?? '').trim().slice(0, 80);
  if (id) {
    const old = get('SELECT * FROM site_posts WHERE id=?', id);
    run('UPDATE site_posts SET slug=?,title=?,excerpt=?,body=?,cover=?,tags=?,seo_title=?,seo_desc=?,focus_keyword=?,published=?,published_at=?,updated_at=? WHERE id=?', slug, title, b.excerpt ?? '', body, b.cover ?? '', tags, seoTitle, seoDesc, focus, published, published ? (old.published_at || now()) : old.published_at, now(), id);
    return id;
  }
  return Number(run('INSERT INTO site_posts(slug,title,excerpt,body,cover,tags,seo_title,seo_desc,focus_keyword,author_id,published,published_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', slug, title, b.excerpt ?? '', body, b.cover ?? '', tags, seoTitle, seoDesc, focus, req.user.id, published, published ? now() : null, now()).lastInsertRowid);
}
r.post('/posts', blogCan('create'), asyncH((req, res) => { const id = savePost(req, null); audit(req, 'Created blog post', 'website', id, req.body.title); res.status(201).json({ id }); }));
r.put('/posts/:id(\\d+)', blogCan('edit'), asyncH((req, res) => {
  if (!get('SELECT 1 FROM site_posts WHERE id=?', req.params.id)) throw notFound();
  savePost(req, Number(req.params.id)); audit(req, 'Edited blog post', 'website', req.params.id, req.body.title); res.json({ ok: true });
}));
r.delete('/posts/:id(\\d+)', can('website', 'delete'), asyncH((req, res) => { run('DELETE FROM site_posts WHERE id=?', req.params.id); audit(req, 'Deleted blog post', 'website', req.params.id); res.json({ ok: true }); }));

// ---- media library (logos, hero images, blog covers)
const up = uploader('media', 'image', 10);
r.get('/media', blogCan('view'), (req, res) => res.json(all("SELECT id,path,caption,created_at FROM media WHERE entity_type='site' ORDER BY id DESC LIMIT 300")));
r.post('/media', blogCan('edit'), up.array('files', 20), asyncH((req, res) => {
  const out = tx(() => (req.files || []).map((f) => ({ id: Number(run("INSERT INTO media(entity_type,entity_id,kind,path,caption,sort_order,created_at) VALUES('site',0,'library',?,?,0,?)", `media/${f.filename}`, f.originalname.slice(0, 120), now()).lastInsertRowid), path: `media/${f.filename}` })));
  audit(req, 'Uploaded website images', 'website', null, `${out.length} file(s)`);
  res.status(201).json(out);
}));
r.delete('/media/:id(\\d+)', can('website', 'delete'), asyncH((req, res) => {
  const m = get("SELECT * FROM media WHERE id=? AND entity_type='site'", req.params.id);
  if (!m) throw notFound();
  // an image that is still the logo, a hero background, a section image or a blog cover must not vanish from the live site
  const usedIn = [];
  if (String(getSetting('site_config') || '').includes(m.path)) usedIn.push('the site design (logo / social image)');
  for (const pg of all('SELECT title,sections FROM site_pages')) if (String(pg.sections).includes(m.path)) usedIn.push(`the “${pg.title}” page`);
  for (const po of all('SELECT title FROM site_posts WHERE cover=? OR body LIKE ?', m.path, `%${m.path}%`)) usedIn.push(`the article “${po.title}”`);
  if (usedIn.length) throw bad(`This image is still used on ${usedIn.join(', ')}. Replace it there first, then delete it.`);
  run('DELETE FROM media WHERE id=?', m.id);
  // an earlier published version or a saved page version may still show it: keep the file so restoring them keeps the image
  const like = `%${m.path}%`;
  const kept = !!get('SELECT 1 FROM site_releases WHERE config LIKE ? OR pages LIKE ? LIMIT 1', like, like) || !!get('SELECT 1 FROM site_page_versions WHERE sections LIKE ? LIMIT 1', like);
  if (!kept) fs.rm(path.join(uploadDir(), m.path), { force: true }, () => {});
  res.json({ ok: true, file_kept: kept });
}));

// ---------------------------------------------------------------- chatbot knowledge bank
const kbBody = (b) => {
  const title = String(b.title || '').trim(), content = String(b.content || '').trim();
  if (!title) throw bad('Give the entry a title (usually the question)');
  if (content.length < 10) throw bad('Write the answer the assistant should give');
  if (content.length > 2000) throw bad('Keep the answer under 2,000 characters');
  const link = String(b.link || '').trim();
  if (link && !/^(\/[^\s]*|https?:\/\/[^\s]+)$/.test(link)) throw bad('The link must start with / or https://');
  return { title: title.slice(0, 160), category: String(b.category || 'General').trim().slice(0, 40) || 'General', content, keywords: String(b.keywords || '').trim().slice(0, 300), link, active: b.active === false || b.active === 0 ? 0 : 1 };
};
r.get('/bot/kb', can('website', 'view'), (req, res) => res.json(all('SELECT * FROM bot_kb ORDER BY category, title')));
r.post('/bot/kb', can('website', 'create'), asyncH((req, res) => {
  const k = kbBody(req.body || {});
  const id = Number(run('INSERT INTO bot_kb(title,category,content,keywords,link,active,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)', k.title, k.category, k.content, k.keywords, k.link, k.active, req.user.id, now()).lastInsertRowid);
  audit(req, 'Added chatbot knowledge', 'website', id, k.title);
  res.status(201).json({ id });
}));
r.put('/bot/kb/:id(\\d+)', can('website', 'edit'), asyncH((req, res) => {
  if (!get('SELECT 1 FROM bot_kb WHERE id=?', req.params.id)) throw notFound('Entry not found');
  const k = kbBody(req.body || {});
  run('UPDATE bot_kb SET title=?,category=?,content=?,keywords=?,link=?,active=?,updated_at=? WHERE id=?', k.title, k.category, k.content, k.keywords, k.link, k.active, now(), req.params.id);
  audit(req, 'Updated chatbot knowledge', 'website', Number(req.params.id), k.title);
  res.json({ ok: true });
}));
r.delete('/bot/kb/:id(\\d+)', can('website', 'delete'), asyncH((req, res) => {
  const k = get('SELECT title FROM bot_kb WHERE id=?', req.params.id); if (!k) throw notFound('Entry not found');
  run('DELETE FROM bot_kb WHERE id=?', req.params.id);
  audit(req, 'Deleted chatbot knowledge', 'website', Number(req.params.id), k.title);
  res.json({ ok: true });
}));
/** What the assistant learns on its own from the website (read-only), grouped by source. */
r.get('/bot/knowledge', can('website', 'view'), (req, res) => {
  const docs = buildKnowledge(siteConfig());
  const by = {};
  docs.forEach((d) => { (by[d.source] ||= []).push(d.title); });
  res.json({ total: docs.length, sources: Object.entries(by).map(([source, titles]) => ({ source, count: titles.length, sample: titles.slice(0, 6) })) });
});
r.get('/bot/chats', can('website', 'view'), (req, res) => {
  const only = req.query.unanswered === '1' ? 'WHERE matched=0' : '';
  const rows = all(`SELECT c.*, ct.full_name contact_name FROM bot_chats c LEFT JOIN contacts ct ON ct.id=c.contact_id ${only} ORDER BY c.id DESC LIMIT 300`);
  res.json({ rows, stats: { total: get('SELECT COUNT(*) n FROM bot_chats').n, unanswered: get('SELECT COUNT(*) n FROM bot_chats WHERE matched=0').n, sessions: get('SELECT COUNT(DISTINCT session) n FROM bot_chats').n, leads: get('SELECT COUNT(DISTINCT contact_id) n FROM bot_chats WHERE contact_id IS NOT NULL').n } });
});
r.delete('/bot/chats/:id(\\d+)', can('website', 'delete'), (req, res) => { run('DELETE FROM bot_chats WHERE id=?', req.params.id); res.json({ ok: true }); });
r.post('/bot/test', can('website', 'view'), asyncH((req, res) => {
  const m = String(req.body?.message || '').trim();
  if (!m) throw bad('Type a question to test');
  res.json(reply(m, siteConfig()));
}));

export default r;
