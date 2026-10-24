import { progressSql } from '../services/schedule.js';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { all, get, run, getSetting } from '../db.js';
import { activity, notify } from '../audit.js';
import { asyncH, bad, HttpError, notFound, now, int } from '../util.js';
import { publicProperty } from '../services/website.js';

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
  res.json({ data: all('SELECT id,code,name,location,developer,description,total_units,dev_status,expected_completion FROM projects WHERE site_visible=1 ORDER BY name')
    .map((p) => ({ ...p, available_units: get("SELECT COUNT(*) n FROM properties WHERE project_id=? AND published=1 AND status IN ('available','featured')", p.id).n,
      images: all("SELECT path FROM media WHERE entity_type='project' AND entity_id=? ORDER BY sort_order", p.id).map((m) => `/uploads/${m.path}`) })) });
}));
r.get('/project/:id(\\d+)', asyncH((req, res) => {
  const p = get('SELECT id,code,name,location,developer,description,total_land_area,land_unit,total_units,dev_status,start_date,expected_completion FROM projects WHERE id=? AND site_visible=1', req.params.id);
  if (!p) throw notFound('Project not found');
  res.json({ ...p, progress: get(`SELECT ${progressSql(String(Number(p.id)))} v`).v ?? 0,
    images: all("SELECT path FROM media WHERE entity_type='project' AND entity_id=? ORDER BY sort_order", p.id).map((m) => `/uploads/${m.path}`),
    properties: all(`SELECT p.* FROM properties p WHERE p.project_id=? AND ${VISIBLE} LIMIT 100`, p.id).map((x) => publicProperty(x, { full: false })) });
}));

/** Round-robin lead routing: website -> CRM lead -> sales agent -> sales manager. */
function nextAgent() {
  const agents = all(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Sales Agent' AND u.active=1 ORDER BY u.id`);
  if (!agents.length) return null;
  const last = Number(getSetting('lead_rr_last', 0));
  const next = agents.find((a) => a.id > last) || agents[0];
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'lead_rr_last', String(next.id));
  return next.id;
}
export function ingest(body, kind) {
  const name = String(body.name || '').trim().slice(0, 120);
  const phone = String(body.phone || '').trim().slice(0, 30);
  const email = String(body.email || '').trim().slice(0, 120);
  if (!name) throw bad('Name is required');
  if (!phone && !email) throw bad('Phone or email is required');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw bad('Email is not valid');
  if (phone && !/^[+\d][\d\s\-()]{6,19}$/.test(phone)) throw bad('Phone is not valid');
  const message = String(body.message || '').slice(0, 2000);
  const prop = body.property_id ? get('SELECT id,title,project_id,agent_id FROM properties WHERE id=?', int(body.property_id)) : null;
  const existing = (phone && get('SELECT id,agent_id FROM contacts WHERE phone=?', phone)) || (email && get('SELECT id,agent_id FROM contacts WHERE email=?', email)) || null;
  const mgr = get(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Sales Manager' AND u.active=1 LIMIT 1`)?.id ?? null;
  let cid, agent;
  if (existing) {
    cid = existing.id; agent = existing.agent_id;
    activity(cid, null, `Website ${kind}`, { detail: `${prop ? prop.title + ' — ' : ''}${message}`.slice(0, 300) });
  } else {
    agent = prop?.agent_id || nextAgent();
    const stage = get(`SELECT id FROM lookups WHERE type='lead_stage' AND active=1 ORDER BY sort_order LIMIT 1`)?.id;
    cid = Number(run(`INSERT INTO contacts(first_name,last_name,full_name,phone,email,lead_source,stage_id,agent_id,manager_id,tags,project_id,property_id,created_at,last_activity_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, name.split(' ')[0], name.split(' ').slice(1).join(' ') || null, name, phone || null, email || null, 'Website', stage, agent, mgr,
    JSON.stringify(['website']), prop?.project_id ?? null, prop?.id ?? null, now(), now()).lastInsertRowid);
    activity(cid, null, 'Lead created', { detail: `Website ${kind}${prop ? ' for ' + prop.title : ''}` });
    if (agent) activity(cid, null, 'Contact assigned', { field: 'Sales agent', next: get('SELECT name FROM users WHERE id=?', agent)?.name });
    if (message) run("INSERT INTO notes(entity_type,entity_id,body,user_id,created_at) VALUES('contact',?,?,NULL,?)", cid, `[Website ${kind}] ${message}`, now());
  }
  notify([agent, mgr], 'lead', `New website ${kind}`, `${name}${prop ? ' — ' + prop.title : ''}`, `/contacts/${cid}`);
  return cid;
}
for (const kind of ['lead', 'inquiry', 'contact']) {
  r.post(`/${kind}`, asyncH((req, res) => {
    const id = ingest(req.body || {}, kind);
    res.status(201).json({ ok: true, reference: `WEB-${id}` });
  }));
}

export default r;
