import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { all, get, getSetting } from '../db.js';
import { asyncH, HttpError, notFound, int } from '../util.js';
import { publicProperty, publicProjects, publicProject } from '../services/website.js';
import { submitLead } from '../services/leads.js';

/** Website API — authenticated with X-API-Key (settings → Website API). */
const r = Router();
r.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Rate limit exceeded' } }));

r.use((req, res, next) => {
  const key = getSetting('website_api_key', '');
  const header = String(req.headers['x-api-key'] || '');
  // ?api_key= still works for existing websites, but a key in the address ends up in server logs, browser history and
  // referrers; such calls are told so (Deprecation header) and will stop working once the old API is retired
  const fromQuery = !header && req.query.api_key ? String(req.query.api_key) : '';
  const given = header || fromQuery;
  const ok = key && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
  if (!ok) return next(new HttpError(401, 'Invalid API key'));
  if (fromQuery) res.setHeader('Deprecation', 'true').setHeader('Warning', '299 - "Send the key in the X-API-Key header; ?api_key= will be removed"');
  next();
});

const VISIBLE = "p.published=1 AND p.status IN ('available','featured','reserved','sold')";

r.get('/properties', asyncH((req, res) => {
  const q = req.query, where = [VISIBLE], params = [];
  if (q.type) { where.push('p.property_type=?'); params.push(q.type); }
  if (q.city) { where.push('p.city=?'); params.push(q.city); }
  if (q.project_id) { where.push('p.project_id=?'); params.push(q.project_id); }
  if (q.purpose) { where.push('p.purpose=?'); params.push(q.purpose); }
  if (q.min_price) { where.push('p.net_price>=?'); params.push(int(q.min_price)); }
  if (q.max_price) { where.push('p.net_price<=?'); params.push(int(q.max_price)); }
  if (q.q) { where.push('(p.title LIKE ? OR p.location LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.include_sold !== '1') where.push("p.status<>'sold'");
  const limit = Math.min(int(q.limit, 20), 100), page = Math.max(int(q.page, 1), 1);
  const total = get(`SELECT COUNT(*) n FROM properties p WHERE ${where.join(' AND ')}`, ...params).n;
  const rows = all(`SELECT p.* FROM properties p WHERE ${where.join(' AND ')} ORDER BY (p.status='featured') DESC, p.updated_at DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  res.json({ total, page, limit, data: rows.map((p) => publicProperty(p, { full: false })) });
}));
r.get('/properties/featured', asyncH((req, res) => {
  const rows = all(`SELECT p.* FROM properties p WHERE p.published=1 AND p.status='featured' ORDER BY p.updated_at DESC LIMIT 50`);
  res.json({ data: rows.map((p) => publicProperty(p, { full: false })) });
}));
r.get('/property/:id(\\d+)', asyncH((req, res) => {
  const p = get(`SELECT p.* FROM properties p WHERE p.id=? AND ${VISIBLE}`, req.params.id);
  if (!p) throw notFound('Property not found');
  res.json(publicProperty(p));
}));
r.get('/projects', asyncH((req, res) => {
  // only projects the company chose to show on its website (site_visible), the same rule as the company's own site
  res.json({ data: publicProjects() });
}));
r.get('/project/:id(\\d+)', asyncH((req, res) => {
  const p = publicProject(req.params.id);
  if (!p) throw notFound('Project not found');
  res.json(p);
}));

/** Website enquiry -> CRM lead (see services/leads.js). Returns the contact id. */
export const ingest = (body, kind) => submitLead(body, { kind }).id;
for (const kind of ['lead', 'inquiry', 'contact']) {
  r.post(`/${kind}`, asyncH((req, res) => {
    const id = ingest(req.body || {}, kind);
    res.status(201).json({ ok: true, reference: `WEB-${id}` });
  }));
}

export default r;
