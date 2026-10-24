// Integration API v1: what a website, a WordPress plugin or an automation tool uses to send leads in and read listings out.
// Auth is a per-connection key in the Authorization header (never the address). Every error is {"error":{"code","message"}}.
import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { all, get, getSetting, run, tx } from '../db.js';
import { asyncH, bad, HttpError, int } from '../util.js';
import { apiAccessGuard } from '../services/plans.js';
import { validateInput } from '../validation.js';
import { authenticate, touch, record } from '../services/connections.js';
import { submitLead } from '../services/leads.js';
import { publicProperty, publicProjects, publicProject } from '../services/website.js';
import { liveConfig } from '../services/siteRelease.js';

const r = Router();
const VISIBLE = "p.published=1 AND p.status IN ('available','featured','reserved','sold')";
export const ENQUIRY_TYPES = ['inquiry', 'contact', 'visit', 'callback', 'lead'];

const CODES = { 400: 'invalid_request', 401: 'invalid_key', 402: 'plan_limit', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'too_large', 422: 'unprocessable', 429: 'rate_limited' };
/** The one error shape of this API. */
export const v1Error = (res, status, message, code) => res.status(status).json({ error: { code: code || CODES[status] || 'server_error', message } });

// wrong keys are slowed down per address before anything is looked up
r.use(rateLimit({ windowMs: 60_000, limit: 30, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_req, res) => v1Error(res, 429, 'Too many requests with an invalid key. Try again in a minute.') }));

r.use((req, res, next) => {
  try { req.connection = authenticate(req.headers.authorization); } catch (e) { return next(e); }
  const json = res.json.bind(res);
  res.json = (body) => { try { touch(req.connection, res.statusCode < 400, body?.error?.message); } catch { /* bookkeeping must never break a call */ } return json(body); };
  next();
});
r.use(apiAccessGuard);
// each connection has its own allowance: 300 calls a minute, reported in the RateLimit headers
r.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${req.tenant?.slug || '-'}:${req.connection.id}`,
  handler: (_req, res) => v1Error(res, 429, 'Rate limit of 300 requests a minute reached. See the RateLimit headers.') }));
r.use(validateInput);

const need = (scope) => (req, _res, next) => (req.connection.scopes.includes(scope) ? next() : next(new HttpError(403, `This key does not have the "${scope}" permission`, { code: 'insufficient_scope' })));

// ---------------------------------------------------------------- ping
r.get('/ping', (req, res) => {
  const c = req.connection;
  res.json({ api_version: 'v1', workspace: { name: getSetting('company_name', '') || null, currency: getSetting('currency', null) }, connection: { id: c.id, name: c.name, platform: c.platform, scopes: c.scopes }, server_time: new Date().toISOString() });
});

// ---------------------------------------------------------------- leads
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const IDEM = /^[\x21-\x7e]{8,200}$/;
r.post('/leads', need('leads:write'), asyncH((req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Send the lead as a JSON object');
  const key = String(req.headers['idempotency-key'] || '');
  if (!IDEM.test(key)) throw bad('Send an Idempotency-Key header (8 to 200 characters, for example a UUID) so a retry never creates a second lead', { code: 'idempotency_key_required' });
  const c = req.connection, hash = sha(body);
  const prior = get('SELECT request_hash,status,response FROM api_idempotency WHERE connection_id=? AND idem_key=?', c.id, key);
  if (prior) {
    if (prior.request_hash !== hash) throw new HttpError(422, 'This Idempotency-Key was already used with a different request', { code: 'idempotency_conflict' });
    return res.set('Idempotent-Replay', 'true').status(prior.status).json(JSON.parse(prior.response));
  }
  const type = ENQUIRY_TYPES.includes(String(body.enquiry_type)) ? String(body.enquiry_type) : 'inquiry';
  const out = tx(() => {
    const lead = submitLead(body, { kind: type, connection: c, test: body.test === true });
    const resp = { lead_ref: `WEB-${lead.id}`, result: lead.result, test: body.test === true };
    const status = lead.result === 'created' ? 201 : 200;
    run('INSERT INTO api_idempotency(connection_id,idem_key,request_hash,status,response,created_at) VALUES(?,?,?,?,?,?)', c.id, key, hash, status, JSON.stringify(resp), new Date().toISOString());
    run('DELETE FROM api_idempotency WHERE created_at < ?', new Date(Date.now() - 864e5).toISOString());
    return { resp, status };
  });
  record(c.id, 'lead', 'success', `${out.resp.result}${body.test === true ? ' (test)' : ''} · ${type}`);
  res.status(out.status).json(out.resp);
}));

r.get('/form-options', need('leads:write'), (req, res) => {
  res.json({
    enquiry_types: ENQUIRY_TYPES,
    stages: all("SELECT id, value name FROM lookups WHERE type='lead_stage' AND active=1 ORDER BY sort_order"),
    lead_sources: all("SELECT value FROM lookups WHERE type='lead_source' AND active=1 ORDER BY sort_order").map((x) => x.value),
    connection_defaults: { lead_source: req.connection.config.lead_source || 'Website', stage_id: req.connection.config.stage_id ?? null },
    fields: { name: 'required', email: 'phone or email required', phone: 'phone or email required', message: 'optional, 2000 characters', property_ref: 'listing id or code', project_ref: 'project id or code', consent: '{ marketing, privacy, text, at }', source: '{ form, page_url, referrer, utm_* }', external_id: 'your own reference', test: 'true marks a test lead' },
  });
});

// ---------------------------------------------------------------- listings, projects, agents (public fields only)
const page = (q) => ({ page: Math.max(int(q.page, 1), 1), per: Math.min(Math.max(int(q.per_page, 20), 1), 100) });
/** "2026-10-24" or "2026-10-24T11:00:00Z" -> the stored 'YYYY-MM-DD HH:MM:SS' form. */
const since = (v) => { if (!v) return null; const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/.exec(String(v)); if (!m) throw bad('updated_since must be a date such as 2026-10-24 or 2026-10-24T09:00:00Z'); return `${m[1]} ${(m[2] || '00:00').padEnd(8, ':00')}`; };
/** What the wizard allowed this website to show: all listings, featured only, or only the chosen projects. */
function allowed(c) {
  const mode = c.config.listings || 'all';
  if (mode === 'featured') return { sql: "p.status='featured'", params: [] };
  if (mode === 'projects') { const ids = c.config.project_ids || []; return { sql: `p.project_id IN (${ids.map(() => '?').join(',') || 'NULL'})`, params: ids }; }
  return { sql: '1=1', params: [] };
}
const withUpdated = (p) => ({ ...publicProperty(p, { full: false }), updated_at: p.updated_at || p.created_at });

r.get('/listings', need('listings:read'), asyncH((req, res) => {
  const q = req.query, al = allowed(req.connection), where = [VISIBLE, al.sql], params = [...al.params];
  if (q.type) { where.push('p.property_type=?'); params.push(String(q.type)); }
  if (q.city) { where.push('p.city=?'); params.push(String(q.city)); }
  if (q.purpose) { where.push('p.purpose=?'); params.push(String(q.purpose)); }
  if (q.project_id) { where.push('p.project_id=?'); params.push(int(q.project_id)); }
  if (q.featured === '1') where.push("p.status='featured'");
  if (q.include_sold !== '1') where.push("p.status<>'sold'");
  const u = since(q.updated_since); if (u) { where.push('COALESCE(p.updated_at,p.created_at) >= ?'); params.push(u); }
  const { page: pg, per } = page(q);
  const total = get(`SELECT COUNT(*) n FROM properties p WHERE ${where.join(' AND ')}`, ...params).n;
  const rows = all(`SELECT p.* FROM properties p WHERE ${where.join(' AND ')} ORDER BY COALESCE(p.updated_at,p.created_at) DESC, p.id DESC LIMIT ? OFFSET ?`, ...params, per, (pg - 1) * per);
  res.json({ data: rows.map(withUpdated), page: pg, per_page: per, total });
}));
r.get('/listings/:ref', need('listings:read'), asyncH((req, res) => {
  const al = allowed(req.connection), ref = String(req.params.ref);
  const p = get(`SELECT p.* FROM properties p WHERE (p.id=? OR p.code=?) AND ${VISIBLE} AND ${al.sql}`, /^\d+$/.test(ref) ? Number(ref) : -1, ref, ...al.params);
  if (!p) throw new HttpError(404, 'Listing not found');
  res.json(publicProperty(p));
}));

r.get('/projects', need('projects:read'), (req, res) => {
  const c = req.connection.config;
  res.json({ data: publicProjects({ ids: c.listings === 'projects' ? c.project_ids || [] : null }) });
});
r.get('/projects/:ref', need('projects:read'), (req, res) => {
  const c = req.connection.config, p = publicProject(req.params.ref);
  if (!p || (c.listings === 'projects' && !(c.project_ids || []).includes(p.id))) throw new HttpError(404, 'Project not found');
  res.json(p);
});

r.get('/agents', need('agents:read'), (req, res) => {
  if (!liveConfig().listing?.show_agent) return res.json({ data: [] });
  const al = allowed(req.connection);
  const rows = all(`SELECT u.id,u.name,u.phone,u.email,r.name role, COUNT(p.id) listings FROM users u JOIN roles r ON r.id=u.role_id JOIN properties p ON p.agent_id=u.id AND ${VISIBLE} AND ${al.sql} WHERE u.active=1 GROUP BY u.id ORDER BY listings DESC, u.name`, ...al.params);
  res.json({ data: rows.map((a) => ({ id: a.id, name: a.name, role: a.role, phone: a.phone, email: a.email, whatsapp: (a.phone || '').replace(/[^\d+]/g, ''), listings: a.listings })) });
});

// ---------------------------------------------------------------- errors
r.use((_req, _res, next) => next(new HttpError(404, 'Unknown endpoint. See the API reference for the list of paths.')));
r.use((err, req, res, next) => {
  if (!(err instanceof HttpError)) return next(err);
  if (req.connection && err.status >= 400 && err.status !== 401) { try { touch(req.connection, false, err.message); } catch { /* ignore */ } }
  if (err.status === 429) res.set('Retry-After', '60');
  v1Error(res, err.status, err.message, err.extra?.code);
});
export default r;
