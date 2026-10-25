import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { all, get, getSetting, run } from '../db.js';
import { asyncH, bad, notFound, int, jparse, today, moneyText, curCode } from '../util.js';
import { websiteState } from '../services/website.js';
import { progressSql, scheduleFor } from '../services/schedule.js';
import { ingest } from './public.js';
import { mergeConfig, publicSite, liveConfig, validPreview } from '../services/siteRelease.js';
import { viaCustomDomain, workspaceUrl } from '../services/siteHost.js';
import { sendPdf } from '../services/pdf.js';
import { buildPlan } from '../../../shared/installmentPlan.js';
import { botConfig, logChat, reply } from '../services/bot.js';
import { cleanReview } from '../services/reviews.js';
import { isHtml, outline, readingMinutes, sanitizeHtml } from '../services/richText.js';
import { cleanForOutput } from '../services/siteValidate.js';

/**
 * The company's own public website. No login: only published, customer-safe data leaves this router.
 * (The key-protected /api/public API remains for external websites.)
 */
const r = Router();
r.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));
const inquiryLimit = rateLimit({ windowMs: 10 * 60_000, limit: 12, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many enquiries — please try again later.' } });

/** The editor's draft configuration (what the website editor and the SEO manager edit). Visitors get the live release. */
export const siteConfig = () => mergeConfig(jparse(getSetting('site_config'), {}));

/** The configuration visitors see: the published release, or the draft through a valid preview link. */
const isPreview = (req) => !!req.query.preview && validPreview(req.query.preview);
const visitorConfig = (req) => (isPreview(req) ? siteConfig() : liveConfig());

const VISIBLE = "p.published=1 AND p.status IN ('available','featured','reserved')";
const img = (p) => (p ? `/uploads/${p}` : null);

function agentOf(p, cfg) {
  if (!cfg.listing.show_agent || !p.agent_id) return null;
  return { id: p.agent_id, name: p.agent_name, phone: p.contact_phone || p.agent_phone || null, email: p.contact_email || p.agent_email || null, whatsapp: (p.contact_whatsapp || p.contact_phone || p.agent_phone || '').replace(/[^\d+]/g, '') || null };
}

const SELECT = `SELECT p.*, pr.name project_name, u.name agent_name, u.phone agent_phone, u.email agent_email,
  (SELECT path FROM media WHERE entity_type='property' AND entity_id=p.id AND kind IN ('cover','gallery') ORDER BY kind='cover' DESC, sort_order LIMIT 1) cover,
  (SELECT COUNT(*) FROM media WHERE entity_type='property' AND entity_id=p.id AND kind IN ('cover','gallery')) photos
  FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id LEFT JOIN users u ON u.id=p.agent_id`;

function card(p, cfg) {
  const f = jparse(p.features, {});
  return {
    id: p.id, code: p.code, title: p.title, purpose: p.purpose, type: p.property_type, city: p.city, area_name: p.area_name, location: p.location, price: p.net_price, total_price: p.total_price, discount: p.discount,
    area: p.area_size, unit: p.unit, bedrooms: f.bedrooms ?? null, bathrooms: f.bathrooms ?? null, status: websiteState(p), featured: p.status === 'featured', installment: !!p.installment_available, ready: !!p.ready_possession,
    cover: img(p.cover), photos: p.photos, project: p.project_id ? { id: p.project_id, name: p.project_name } : null, agent: agentOf(p, cfg), short: p.short_desc, added: (p.created_at || '').slice(0, 10),
  };
}

r.get('/bootstrap', (req, res) => {
  const preview = isPreview(req);
  const site = publicSite({ preview });
  if (preview) res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' });
  if (site.offline) return res.json({ offline: true, company: { name: getSetting('company_name') } });
  const cfg = cleanForOutput(site.config);
  const menu = site.pages.filter((p) => p.published && p.show_in_menu).sort((a, b) => a.sort_order - b.sort_order).map((p) => ({ slug: p.slug, title: p.title }));
  res.json({ config: { ...cfg, listing: { show_agent: cfg.listing.show_agent, per_page: cfg.listing.per_page } }, menu, company: { name: getSetting('company_name') }, ...(preview ? { preview: true } : {}),
    ...(viaCustomDomain(req) ? { workspace_url: workspaceUrl(req.tenant, req) } : {}) });
});

r.get('/pages/:slug', asyncH((req, res) => {
  const site = publicSite({ preview: isPreview(req) });
  const p = !site.offline && site.pages.find((x) => x.slug === req.params.slug && x.published);
  if (!p) throw notFound('Page not found');
  if (site.preview) res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' });
  res.json({ slug: p.slug, title: p.title, sections: cleanForOutput(p.sections), seo_title: p.seo_title, seo_desc: p.seo_desc });
}));

// --- listings (Zameen-style search)
r.get('/listings', asyncH((req, res) => {
  const cfg = visitorConfig(req), q = req.query;
  const where = [VISIBLE], params = [];
  if (cfg.listing.show_sold && q.include_sold === '1') where[0] = "p.published=1 AND p.status IN ('available','featured','reserved','sold')";
  const eq = (col, v) => { if (v) { where.push(`${col}=?`); params.push(v); } };
  eq('p.purpose', q.purpose); eq('p.city', q.city); eq('p.property_type', q.type); eq('p.project_id', q.project_id); eq('p.agent_id', q.agent_id);
  if (q.min_price) { where.push('p.net_price>=?'); params.push(int(q.min_price)); }
  if (q.max_price) { where.push('p.net_price<=?'); params.push(int(q.max_price)); }
  if (q.min_area) { where.push('p.area_size>=?'); params.push(Number(q.min_area)); }
  if (q.max_area) { where.push('p.area_size<=?'); params.push(Number(q.max_area)); }
  if (q.unit) eq('p.unit', q.unit);
  if (q.beds) { where.push(q.beds === '6+' ? "CAST(json_extract(p.features,'$.bedrooms') AS INTEGER)>=6" : "CAST(json_extract(p.features,'$.bedrooms') AS INTEGER)=?"); if (q.beds !== '6+') params.push(int(q.beds)); }
  if (q.featured === '1') where.push("p.status='featured'");
  if (q.installment === '1') where.push('p.installment_available=1');
  if (q.ready === '1') where.push('p.ready_possession=1');
  if (q.q) { where.push('(p.title LIKE ? OR p.location LIKE ? OR p.area_name LIKE ? OR p.city LIKE ? OR pr.name LIKE ? OR p.plot_no LIKE ?)'); params.push(...Array(6).fill(`%${q.q}%`)); }
  const sort = { price_asc: 'p.net_price ASC', price_desc: 'p.net_price DESC', area: 'p.area_size DESC', oldest: 'p.id ASC' }[q.sort] || "(p.status='featured') DESC, p.id DESC";
  const limit = Math.min(int(q.limit, cfg.listing.per_page), 48), page = Math.max(int(q.page, 1), 1);
  const total = get(`SELECT COUNT(*) n FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id WHERE ${where.join(' AND ')}`, ...params).n;
  const rows = all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  res.json({ total, page, pages: Math.max(1, Math.ceil(total / limit)), data: rows.map((p) => card(p, cfg)) });
}));

r.get('/facets', (req, res) => {
  const v = `FROM properties p WHERE ${VISIBLE}`;
  res.json({
    cities: all(`SELECT p.city value, COUNT(*) n ${v} AND p.city<>'' GROUP BY p.city ORDER BY n DESC`),
    types: all(`SELECT p.property_type value, COUNT(*) n ${v} AND p.property_type IS NOT NULL GROUP BY p.property_type ORDER BY n DESC`),
    purposes: all(`SELECT p.purpose value, COUNT(*) n ${v} GROUP BY p.purpose`),
    price: get(`SELECT MIN(p.net_price) min, MAX(p.net_price) max ${v}`),
    units: all(`SELECT p.unit value, COUNT(*) n ${v} AND p.unit<>'' GROUP BY p.unit ORDER BY n DESC`),
    projects: all("SELECT id, name FROM projects WHERE site_visible=1 ORDER BY name"),
    project_kinds: all("SELECT kind value, COUNT(*) n FROM projects WHERE site_visible=1 AND kind<>'' GROUP BY kind ORDER BY n DESC"),
    project_statuses: all("SELECT dev_status value, COUNT(*) n FROM projects WHERE site_visible=1 AND dev_status<>'' GROUP BY dev_status ORDER BY n DESC"),
    popular: all(`SELECT p.area_name value, p.city, COUNT(*) n ${v} AND p.area_name<>'' GROUP BY p.area_name ORDER BY n DESC LIMIT 8`),
  });
});

r.get('/listings/:id(\\d+)', asyncH((req, res) => {
  const cfg = visitorConfig(req);
  const p = get(`${SELECT} WHERE p.id=? AND p.published=1 AND p.status IN ('available','featured','reserved','sold')`, req.params.id);
  if (!p) throw notFound('This listing is no longer available');
  const images = all("SELECT kind,path,caption FROM media WHERE entity_type='property' AND entity_id=? AND kind IN ('cover','gallery','siteplan','map','dev') ORDER BY kind='cover' DESC, sort_order", p.id).map((m) => ({ kind: m.kind, url: img(m.path), caption: m.caption }));
  const similar = all(`${SELECT} WHERE ${VISIBLE} AND p.id<>? AND (p.city=? OR p.property_type=?) ORDER BY (p.property_type=?) DESC, (p.city=?) DESC, p.id DESC LIMIT 4`, p.id, p.city, p.property_type, p.property_type, p.city).map((x) => card(x, cfg));
  res.json({ ...card(p, cfg), description: cleanForOutput(p.description), features: jparse(p.features, {}), amenities: jparse(p.amenities, []), images, videos: jparse(p.videos, []), lat: p.lat, lng: p.lng, address: p.address, block: p.block, plot_no: p.plot_no,
    sector: p.sector, development_status: p.dev_status, installment_plan: cfg.calculators.installment, similar });
}));

// --- projects
r.get('/projects', asyncH((req, res) => {
  const q = req.query, where = ['p.site_visible=1'], params = [];
  if (q.kind) { where.push('p.kind=?'); params.push(String(q.kind)); }
  if (q.status) { where.push('p.dev_status=?'); params.push(String(q.status)); }
  if (q.q) { where.push('(p.name LIKE ? OR p.location LIKE ? OR p.description LIKE ?)'); params.push(...Array(3).fill(`%${q.q}%`)); }
  if (q.available === '1') where.push("EXISTS (SELECT 1 FROM properties x WHERE x.project_id=p.id AND x.published=1 AND x.status IN ('available','featured'))");
  const rows = all(`SELECT p.id,p.code,p.name,p.location,p.description,p.dev_status,p.kind,p.total_units,p.start_date,p.expected_completion, ${progressSql('p.id')} progress,
    (SELECT COUNT(*) FROM properties x WHERE x.project_id=p.id AND x.published=1 AND x.status IN ('available','featured')) available,
    (SELECT path FROM media WHERE entity_type='project' AND entity_id=p.id ORDER BY sort_order LIMIT 1) cover FROM projects p WHERE ${where.join(' AND ')} ORDER BY p.site_featured DESC, p.name`, ...params);
  res.json({ data: rows.map((p) => ({ ...p, description: cleanForOutput(p.description), cover: img(p.cover) })) });
}));
r.get('/projects/:id(\\d+)', asyncH((req, res) => {
  const cfg = visitorConfig(req);
  const p = get(`SELECT p.id,p.code,p.name,p.location,p.developer,p.description,p.total_land_area,p.land_unit,p.total_units,p.dev_status,p.kind,p.start_date,p.expected_completion, ${progressSql('p.id')} progress FROM projects p WHERE p.id=? AND p.site_visible=1`, req.params.id);
  if (!p) throw notFound('Project not found');
  const sch = scheduleFor(p.id, { scope: 'project', clientOnly: true });
  res.json({ ...p, description: cleanForOutput(p.description), images: all("SELECT path,caption FROM media WHERE entity_type='project' AND entity_id=? ORDER BY sort_order", p.id).map((m) => ({ url: img(m.path), caption: m.caption })),
    schedule: sch.tasks.length ? { summary: { actual_pct: sch.summary.actual_pct, planned_pct: sch.summary.planned_pct, health: sch.summary.health }, tasks: sch.tasks.filter((t) => !t.is_group).map((t) => ({ name: t.name, planned_start: t.planned_start, planned_end: t.planned_end, progress: t.progress, status: t.status })) } : null,
    listings: all(`${SELECT} WHERE ${VISIBLE} AND p.project_id=? ORDER BY p.id DESC LIMIT 24`, p.id).map((x) => card(x, cfg)) });
}));

// --- agents who have published listings
r.get('/agents', asyncH((req, res) => {
  const cfg = visitorConfig(req);
  if (!cfg.listing.show_agent) return res.json({ data: [] });
  const rows = all(`SELECT u.id,u.name,u.phone,u.email,r.name role, COUNT(p.id) listings FROM users u JOIN roles r ON r.id=u.role_id JOIN properties p ON p.agent_id=u.id AND ${VISIBLE} WHERE u.active=1 GROUP BY u.id ORDER BY listings DESC, u.name`);
  res.json({ data: rows.map((a) => ({ id: a.id, name: a.name, role: a.role, phone: a.phone, email: a.email, whatsapp: (a.phone || '').replace(/[^\d+]/g, ''), listings: a.listings })) });
}));
r.get('/agents/:id(\\d+)', asyncH((req, res) => {
  const cfg = visitorConfig(req);
  const a = get("SELECT u.id,u.name,u.phone,u.email,r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1", req.params.id);
  if (!a || !cfg.listing.show_agent) throw notFound('Agent not found');
  res.json({ ...a, whatsapp: (a.phone || '').replace(/[^\d+]/g, ''), listings: all(`${SELECT} WHERE ${VISIBLE} AND p.agent_id=? ORDER BY p.id DESC LIMIT 48`, a.id).map((x) => card(x, cfg)) });
}));

// --- blog
r.get('/posts', asyncH((req, res) => {
  const limit = Math.min(int(req.query.limit, 9), 30), page = Math.max(int(req.query.page, 1), 1);
  const w = req.query.tag ? "AND tags LIKE ?" : '';
  const prm = req.query.tag ? [`%"${String(req.query.tag).replace(/[%"]/g, '')}"%`] : [];
  const total = get(`SELECT COUNT(*) n FROM site_posts WHERE published=1 ${w}`, ...prm).n;
  const rows = all(`SELECT id,slug,title,excerpt,cover,tags,published_at,body FROM site_posts WHERE published=1 ${w} ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?`, ...prm, limit, (page - 1) * limit);
  res.json({ total, pages: Math.max(1, Math.ceil(total / limit)), data: rows.map(({ body, ...p }) => ({ ...p, cover: img(p.cover), tags: jparse(p.tags, []), reading_min: readingMinutes(body) })) });
}));
r.get('/posts/:slug', asyncH((req, res) => {
  const p = get('SELECT s.id,s.slug,s.title,s.excerpt,s.body,s.cover,s.tags,s.published_at,s.updated_at,s.seo_title,s.seo_desc,u.name author FROM site_posts s LEFT JOIN users u ON u.id=s.author_id WHERE s.slug=? AND s.published=1', req.params.slug);
  if (!p) throw notFound('Article not found');
  const html = isHtml(p.body);
  const body = html ? sanitizeHtml(p.body) : p.body; // defence in depth: sanitised again on the way out
  res.json({ ...p, body, format: html ? 'html' : 'markdown', toc: html ? outline(body) : [], reading_min: readingMinutes(p.body), cover: img(p.cover), tags: jparse(p.tags, []), related: all('SELECT slug,title,excerpt,cover,published_at FROM site_posts WHERE published=1 AND id<>? ORDER BY published_at DESC LIMIT 3', p.id).map((x) => ({ ...x, cover: img(x.cover) })) });
}));

// --- enquiry -> CRM lead -> sales agent -> sales manager (same pipeline as the keyed API)
// Customer reviews: visitors send them, the company approves each one in the website editor before it shows
const reviewLimit = rateLimit({ windowMs: 60 * 60_000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many reviews from this address. Please try again later.' } });
r.get('/reviews', (req, res) => res.json({ data: all("SELECT id,name,role,company,rating,quote,(photo IS NOT NULL) has_photo FROM site_reviews WHERE status='approved' ORDER BY decided_at DESC, id DESC LIMIT 30").map((x) => ({ id: x.id, name: x.name, role: x.role, company: x.company, rating: x.rating, quote: x.quote, photo: x.has_photo ? `/api/site/reviews/${x.id}/photo` : null })) }));
r.get('/reviews/:id(\\d+)/photo', (req, res) => {
  const p = get("SELECT photo, photo_type FROM site_reviews WHERE id=? AND status='approved' AND photo IS NOT NULL", req.params.id);
  if (!p) throw notFound('Not found');
  res.set({ 'Content-Type': p.photo_type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(p.photo, 'base64'));
});
r.post('/reviews', reviewLimit, asyncH((req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // honeypot for bots
  const c = cleanReview(b);
  if (get("SELECT COUNT(*) n FROM site_reviews WHERE email=? AND status='pending'", c.email).n >= 2) throw bad('You already have reviews waiting for approval. Thank you.');
  run('INSERT INTO site_reviews(name,role,company,country,rating,quote,email,photo,photo_type,consent) VALUES(?,?,?,?,?,?,?,?,?,1)', c.name, c.role, c.company, c.country, c.rating, c.quote, c.email, c.photo ? c.photo.toString('base64') : null, c.photoType);
  res.status(201).json({ ok: true });
}));
r.post('/inquiry', inquiryLimit, asyncH((req, res) => {
  if (req.body.website) return res.json({ ok: true }); // honeypot for bots
  const id = ingest(req.body || {}, ['contact', 'visit'].includes(req.body.kind) ? req.body.kind : 'inquiry');
  res.status(201).json({ ok: true, reference: `WEB-${id}` });
}));

// --- installment plan (same generator the website calculator runs in the browser)
const planInput = (b = {}) => ({ ...b, booking_date: /^\d{4}-\d{2}-\d{2}$/.test(b.booking_date || '') ? b.booking_date : today() });
r.post('/installment-plan', (req, res) => {
  const p = buildPlan(planInput(req.body));
  if (!p.ok) return res.status(400).json({ error: p.errors[0], errors: p.errors });
  res.json(p);
});
r.post('/installment-plan/pdf', (req, res) => {
  const p = buildPlan(planInput(req.body));
  if (!p.ok) throw bad(p.errors[0]);
  const t = p.totals, money = (n) => `${moneyText(Number(n || 0))}`;
  sendPdf(res, 'installment-plan', {
    title: 'INSTALLMENT PLAN', subtitle: `Indicative plan · ${t.installments} installments over ${t.months} months`,
    summary: [['Total price', money(t.price)], ['Booking', money(t.booking)], ['Advance', money(t.advance)], ['Monthly installment', money(t.installment_amount)],
      ...(t.balloons ? [[`${t.balloons} balloon payment(s)`, money(t.balloon_amount) + ' each']] : []), ...(t.markup ? [['Markup', money(t.markup)]] : []), ['Total payable', money(t.payable)]],
    columns: [{ key: 'n', label: '#' }, { key: 'date', label: 'Due date' }, { key: 'label', label: 'Payment' }, { key: 'amount', label: `Amount (${curCode()})`, type: 'money' }, { key: 'balance', label: 'Balance after (PKR)', type: 'money' }],
    rows: p.rows.map((r, i) => ({ n: i + 1, date: r.date, label: r.label, amount: r.amount, balance: r.balance })),
    totals: { label: 'Total payable', amount: t.payable },
  });
});

// --- live numbers for data-bound sections (public, aggregate only)
r.get('/metrics', (req, res) => res.json({
  listings: get(`SELECT COUNT(*) n FROM properties p WHERE ${VISIBLE}`).n,
  featured: get("SELECT COUNT(*) n FROM properties p WHERE p.published=1 AND p.status='featured'").n,
  for_rent: get(`SELECT COUNT(*) n FROM properties p WHERE ${VISIBLE} AND p.purpose='Rent'`).n,
  sold: get("SELECT COUNT(*) n FROM properties WHERE status='sold' AND published=1").n,
  projects: get('SELECT COUNT(*) n FROM projects WHERE site_visible=1').n,
  agents: get("SELECT COUNT(DISTINCT agent_id) n FROM properties p WHERE p.published=1 AND p.agent_id IS NOT NULL").n,
  articles: get('SELECT COUNT(*) n FROM site_posts WHERE published=1').n,
}));
r.get('/booking-options', (req, res) => res.json({ projects: all('SELECT id,name FROM projects WHERE site_visible=1 ORDER BY name') }));

// --- website assistant: answers from the knowledge bank, then captures a lead into the CRM
const botLimit = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'You are sending messages too quickly — please wait a moment.' } });
const sessionOf = (b) => String(b?.session || '').replace(/[^\w-]/g, '').slice(0, 64) || 'anon';
r.post('/bot/message', botLimit, asyncH((req, res) => {
  const cfg = visitorConfig(req);
  if (!botConfig(cfg).enabled) throw notFound('The assistant is switched off');
  const text = String(req.body?.message || '').trim().slice(0, 400);
  if (!text) throw bad('Type a message');
  const out = reply(text, cfg);
  logChat(sessionOf(req.body), text, out);
  res.json(out);
}));
r.post('/bot/lead', inquiryLimit, asyncH((req, res) => {
  if (req.body?.website) return res.json({ ok: true }); // honeypot
  const cfg = visitorConfig(req);
  if (!botConfig(cfg).enabled) throw notFound('The assistant is switched off');
  const b = req.body || {}, session = sessionOf(b);
  const bit = (label, v) => (String(v || '').trim() ? `${label}: ${String(v).trim().slice(0, 200)}` : '');
  const asked = all('SELECT message FROM bot_chats WHERE session=? ORDER BY id DESC LIMIT 4', session).map((x) => x.message).reverse();
  const message = [bit('Interested in', b.interest), bit('Budget', b.budget), bit('Project / area', b.project), bit('Notes', b.message), asked.length ? `Asked the assistant: ${asked.join(' | ')}` : ''].filter(Boolean).join('\n');
  const id = ingest({ name: b.name, phone: b.phone, email: b.email, message }, 'chatbot');
  const tags = jparse(get('SELECT tags FROM contacts WHERE id=?', id)?.tags, []);
  if (!tags.includes('chatbot')) run('UPDATE contacts SET tags=? WHERE id=?', JSON.stringify([...tags, 'chatbot']), id);
  run('UPDATE bot_chats SET contact_id=? WHERE session=?', id, session);
  res.status(201).json({ ok: true, reference: `WEB-${id}` });
}));

export default r;
