import { propertyDeveloperFields } from '../services/developers.js';
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, insert, update, nextNo, uploadDir } from '../db.js';
import { can, hasPerm, requireStaff } from '../rbac.js';
import { audit, activity, notifyPerm } from '../audit.js';
import { uploader, sendTable } from './helpers.js';
import { asyncH, bad, notFound, forbidden, jparse, now, int, num, required } from '../util.js';
import { getSetting } from '../db.js';
import { websiteState, fireWebhook } from '../services/website.js';
import { saleSummary } from '../services/sales.js';
import { notifyReviewers } from '../services/listings.js';
import { currentRegion } from '../regions/runtime.js';
import rateLimit from 'express-rate-limit';
import { writeListingText, LANGUAGES, TONES, REWRITE_GOALS, RTL_LANGUAGES } from '../services/listingAi.js';
import { activeProvider } from '../integrations/ai.js';
import { currentTenant } from '../context.js';
import { geocodeParts } from '../services/geocode.js';

const r = Router();
r.use(requireStaff);

/** Sales agents may list and publish their OWN properties; everything else stays with managers. */
const owns = (req, p) => !req.user.own_scope || p.created_by === req.user.id || p.agent_id === req.user.id;
const assertOwner = (req, p) => { if (!owns(req, p)) throw forbidden('You can only manage your own listings'); };
const canPublish = (req, _res, next) => {
  if (hasPerm(req.user, 'properties', 'approve')) return next();
  if (req.user.own_scope && hasPerm(req.user, 'properties', 'edit') && getSetting('agents_can_publish', '0') === '1') return next();
  return next(forbidden('You do not have permission to publish properties'));
};

export const FILE_STATUS = ['Active', 'Inactive', 'Paused', 'Defaulted', 'Suspended'];
export const PROPERTY_STATUS = ['draft', 'available', 'featured', 'reserved', 'sold', 'cancelled', 'on_hold'];
const COLS = ['title', 'purpose', 'property_type', 'project_id', 'block', 'sector', 'plot_no', 'city', 'area_name', 'location', 'address', 'lat', 'lng',
  'area_size', 'unit', 'total_price', 'price_per_unit', 'discount', 'net_price', 'installment_available', 'ready_possession', 'features', 'amenities',
  'short_desc', 'description', 'videos', 'agent_id', 'contact_email', 'contact_phone', 'contact_whatsapp', 'dev_status', 'file_no', 'registration_no', 'file_status', 'file_notes', 'inventory_source', 'developer_id', 'agreement_id', 'updated_at'];

const BASE = `SELECT p.*, pr.name project_name, pr.code project_code, u.name agent_name,
  (SELECT path FROM media WHERE entity_type='property' AND entity_id=p.id AND kind='cover' ORDER BY sort_order LIMIT 1) cover,
  (SELECT c.full_name FROM sales s JOIN contacts c ON c.id=s.contact_id WHERE s.property_id=p.id AND s.status='confirmed' LIMIT 1) customer_name,
  (SELECT s.id FROM sales s WHERE s.property_id=p.id AND s.status='confirmed' LIMIT 1) sale_id
  FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id LEFT JOIN users u ON u.id=p.agent_id`;

const present = (p) => p && ({ ...p, features: jparse(p.features, {}), amenities: jparse(p.amenities, []), videos: jparse(p.videos, []), website_state: websiteState(p) });

function prepare(body, existing) {
  const d = { ...body };
  for (const k of ['features', 'amenities', 'videos']) if (d[k] !== undefined && typeof d[k] !== 'string') d[k] = JSON.stringify(d[k]);
  for (const k of ['project_id', 'agent_id']) if (d[k] === '') d[k] = null;
  for (const k of ['installment_available', 'ready_possession']) if (d[k] !== undefined) d[k] = d[k] ? 1 : 0;
  const total = d.total_price !== undefined ? int(d.total_price) : existing?.total_price ?? 0;
  const discount = d.discount !== undefined ? int(d.discount) : existing?.discount ?? 0;
  const area = d.area_size !== undefined ? num(d.area_size) : existing?.area_size ?? 0;
  if (total < 0 || discount < 0) throw bad('Price and discount cannot be negative');
  if (discount > total) throw bad('Discount cannot exceed the total price');
  if (d.total_price !== undefined || d.discount !== undefined) { d.total_price = total; d.discount = discount; d.net_price = total - discount; }
  if (area > 0 && (d.total_price !== undefined || d.area_size !== undefined)) d.price_per_unit = Math.round(total / area);
  if (d.lat !== undefined && d.lat !== '' && d.lat !== null && Math.abs(Number(d.lat)) > 90) throw bad('Latitude must be between -90 and 90');
  if (d.lng !== undefined && d.lng !== '' && d.lng !== null && Math.abs(Number(d.lng)) > 180) throw bad('Longitude must be between -180 and 180');
  if (d.lat === '') d.lat = null; if (d.lng === '') d.lng = null;
  if (d.file_status && !FILE_STATUS.includes(d.file_status)) throw bad(`File status must be one of ${FILE_STATUS.join(', ')}`);
  if (d.file_status === '') d.file_status = null;
  if (d.registration_no !== undefined) {
    d.registration_no = String(d.registration_no || '').trim();
    if (!d.registration_no) { if (existing?.registration_no) d.registration_no = existing.registration_no; else delete d.registration_no; }
    else { const dup = get('SELECT id,title FROM properties WHERE lower(registration_no)=lower(?) AND id<>?', d.registration_no, existing?.id ?? 0); if (dup) throw bad(`Registration number ${d.registration_no} is already used by “${dup.title}”`); }
  }
  if (d.inventory_source !== undefined || d.developer_id !== undefined || d.agreement_id !== undefined) {
    if (existing?.status === 'sold') throw bad('A sold plot cannot change owner');
    Object.assign(d, propertyDeveloperFields(d, existing));
  }
  d.updated_at = now();
  return d;
}

function checkPlotUnique(d, existing) {
  const project = d.project_id ?? existing?.project_id, block = d.block ?? existing?.block ?? '', plot = d.plot_no ?? existing?.plot_no;
  if (!plot || !project) return;
  const dup = get(`SELECT id FROM properties WHERE project_id=? AND IFNULL(block,'')=? AND plot_no=? AND status<>'cancelled' AND id<>?`, project, block, plot, existing?.id ?? 0);
  if (dup) throw bad(`Plot ${plot}${block ? ' in block ' + block : ''} already exists in this project`);
}

r.get('/', can('properties', 'view'), asyncH(async (req, res) => {
  const q = req.query, where = ['1=1'], params = [];
  if (q.q) { where.push('(p.title LIKE ? OR p.plot_no LIKE ? OR p.code LIKE ? OR p.location LIKE ? OR pr.name LIKE ? OR p.file_no LIKE ? OR p.registration_no LIKE ?)'); params.push(...Array(7).fill(`%${q.q}%`)); }
  for (const [k, col] of [['status', 'p.status'], ['project_id', 'p.project_id'], ['property_type', 'p.property_type'], ['purpose', 'p.purpose'], ['city', 'p.city'], ['agent_id', 'p.agent_id'], ['review_state', 'p.review_state'], ['file_status', 'p.file_status']]) {
    if (q[k]) { where.push(`${col}=?`); params.push(q[k]); }
  }
  if (q.published === '1') { where.push('p.published=1'); }
  if (q.min_price) { where.push('p.net_price>=?'); params.push(int(q.min_price)); }
  if (q.max_price) { where.push('p.net_price<=?'); params.push(int(q.max_price)); }
  // Agents may only browse properties that are open for sale
  if (req.user.own_scope) { where.push("(p.status IN ('available','featured','reserved') OR p.created_by=? OR p.agent_id=?)"); params.push(req.user.id, req.user.id); }
  const sorts = { title: 'p.title', price: 'p.net_price', created: 'p.created_at', status: 'p.status', project: 'pr.name' };
  const order = `${sorts[q.sort] || 'p.id'} ${q.dir === 'asc' ? 'ASC' : 'DESC'}`;
  const exporting = ['csv', 'xlsx', 'pdf'].includes(q.format);
  const limit = exporting ? 100000 : Math.min(int(q.limit, 25), 500), page = Math.max(int(q.page, 1), 1);
  const total = get(`SELECT COUNT(*) n FROM (${BASE} WHERE ${where.join(' AND ')})`, ...params).n;
  const rows = all(`${BASE} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit).map(present);
  if (req.user.own_scope) rows.forEach((x) => { delete x.customer_name; delete x.sale_id; });
  if (exporting) {
    if (!hasPerm(req.user, 'properties', 'export')) throw bad('You do not have permission to export');
    return sendTable(res, q.format, 'properties', [['code', 'Code'], ['title', 'Title'], ['project_name', 'Project'], ['block', 'Block'], ['plot_no', 'Plot'], ['file_no', 'File no.'], ['registration_no', 'Registration no.'], ['file_status', 'File status'], ['property_type', 'Type'],
      ['area_size', 'Area'], ['unit', 'Unit'], ['net_price', 'Net price'], ['status', 'Status'], ['website_state', 'Website']].map(([key, label]) => ({ key, label })), rows);
  }
  res.json({ rows, total, page, limit });
}));

r.get('/summary', can('properties', 'view'), asyncH((req, res) => {
  res.json(all('SELECT status, COUNT(*) n, COALESCE(SUM(net_price),0) value FROM properties GROUP BY status'));
}));

r.get('/:id(\\d+)', can('properties', 'view'), asyncH((req, res) => {
  const p = present(get(`${BASE} WHERE p.id=?`, req.params.id));
  if (!p) throw notFound();
  p.media = all('SELECT * FROM media WHERE entity_type=? AND entity_id=? ORDER BY sort_order,id', 'property', p.id);
  res.json(p);
}));

/** Unit workspace: everything about one plot/unit. */
r.get('/:id(\\d+)/workspace', can('properties', 'view'), asyncH((req, res) => {
  const p = present(get(`${BASE} WHERE p.id=?`, req.params.id));
  if (!p) throw notFound();
  p.media = all('SELECT * FROM media WHERE entity_type=? AND entity_id=? ORDER BY sort_order,id', 'property', p.id);
  const out = { property: p, documents: all('SELECT * FROM documents WHERE entity_type=? AND entity_id=? ORDER BY id DESC', 'property', p.id) };
  const sale = get("SELECT id FROM sales WHERE property_id=? AND status='confirmed'", p.id);
  if (sale && !req.user.own_scope) {
    out.sale = saleSummary(sale.id);
    out.customer = get('SELECT id,full_name,phone,email FROM contacts WHERE id=?', out.sale.contact_id);
    if (hasPerm(req.user, 'payments', 'view')) {
      out.receipts = all('SELECT * FROM receipts WHERE sale_id=? ORDER BY date,id', out.sale.id);
      out.income = out.sale.paid_amount;
    }
  }
  if (p.project_id) out.project = get('SELECT id,code,name FROM projects WHERE id=?', p.project_id);
  res.json(out);
}));

/** Quick status check by registration number, file number, code or plot — returns what a salesperson needs at the counter. */
r.get('/lookup', can('properties', 'view'), asyncH((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;
  const own = req.user.own_scope ? " AND (p.status IN ('available','featured','reserved') OR p.created_by=" + Number(req.user.id) + ' OR p.agent_id=' + Number(req.user.id) + ')' : '';
  const rows = all(`${BASE} WHERE (p.registration_no LIKE ? OR p.file_no LIKE ? OR p.code LIKE ? OR p.plot_no LIKE ? OR p.title LIKE ?)${own} ORDER BY (lower(p.registration_no)=lower(?)) DESC, p.id DESC LIMIT 6`, like, like, like, like, like, q);
  res.json(rows.map((p) => ({ id: p.id, title: p.title, code: p.code, registration_no: p.registration_no, file_no: p.file_no, file_status: p.file_status, file_notes: p.file_notes, status: p.status, website_state: websiteState(p),
    project_name: p.project_name, block: p.block, plot_no: p.plot_no, area_size: p.area_size, unit: p.unit, net_price: p.net_price, agent_name: p.agent_name,
    sold_to: req.user.own_scope ? undefined : p.customer_name, sale_id: req.user.own_scope ? undefined : p.sale_id })));
}));

r.post('/', can('properties', 'create'), asyncH((req, res) => {
  const d = prepare(req.body, null);
  required(d, 'title');
  if (req.user.own_scope) d.agent_id = req.user.id; // the listing agent is the person who adds it
  checkPlotUnique(d, null);
  const id = tx(() => {
    const code = nextNo('PR', 'PR');
    const pid = insert('properties', { ...d, registration_no: d.registration_no || nextNo('REG', 'REG', 4), code, status: 'draft', review_state: 'draft', published: 0, created_by: req.user.id, created_at: now() },
      [...COLS, 'code', 'status', 'review_state', 'published', 'created_by', 'created_at']);
    audit(req, 'Created property', 'property', pid, `${code} ${d.title}`);
    return pid;
  });
  res.status(201).json(present(get(`${BASE} WHERE p.id=?`, id)));
}));

r.put('/:id(\\d+)', can('properties', 'edit'), asyncH((req, res) => {
  const p = get('SELECT * FROM properties WHERE id=?', req.params.id);
  if (!p) throw notFound();
  assertOwner(req, p);
  if (req.user.own_scope) delete req.body.agent_id;
  if (p.status === 'sold' && (req.body.total_price !== undefined || req.body.discount !== undefined)) throw bad('The price of a sold property is locked — it is held by the sale record');
  const d = prepare(req.body, p);
  checkPlotUnique(d, p);
  update('properties', p.id, d, COLS);
  audit(req, 'Edited property', 'property', p.id, `${p.code} ${d.title || p.title}`);
  if (p.published) fireWebhook(p.id, 'property.updated');
  res.json(present(get(`${BASE} WHERE p.id=?`, p.id)));
}));

r.delete('/:id(\\d+)', can('properties', 'delete'), asyncH((req, res) => {
  const p = get('SELECT * FROM properties WHERE id=?', req.params.id);
  if (!p) throw notFound();
  assertOwner(req, p);
  if (p.status !== 'draft') throw bad('Only draft properties can be deleted — cancel it instead');
  if (get('SELECT 1 FROM sales WHERE property_id=?', p.id)) throw bad('Property has sales records');
  tx(() => { run("DELETE FROM media WHERE entity_type='property' AND entity_id=?", p.id); run('DELETE FROM properties WHERE id=?', p.id); });
  audit(req, 'Deleted property', 'property', p.id, p.title);
  res.json({ ok: true });
}));

// ---- AI listing writer: suggestions only. Nothing is saved or published here; the editor shows a preview and the person applies it.
const canWrite = (req, _res, next) => (hasPerm(req.user, 'properties', 'edit') || hasPerm(req.user, 'properties', 'create') ? next() : next(forbidden('You do not have permission to edit properties')));
const aiWriterLimit = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.PROPERTY_AI_LIMIT) || 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${currentTenant()?.id ?? 'legacy'}:${req.user.id}`, message: { error: 'You have used the AI writer many times this hour. Please try again later.' } });
// ---- Find coordinates from a typed place: suggestions only, the editor fills the fields and the person saves as usual.
const geocodeLimit = rateLimit({ windowMs: 60_000, limit: Number(process.env.GEOCODE_LIMIT) || 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${currentTenant()?.id ?? 'legacy'}:${req.user.id}`, message: { error: 'Too many location searches. Please wait a minute and try again.' } });
r.get('/geocode', canWrite, geocodeLimit, asyncH(async (req, res) => {
  // `p` repeats, most specific first (address, location, area, city); a single `q` still works
  const parts = [req.query.p, req.query.q].flat().filter((x) => typeof x === 'string').map((x) => x.trim()).filter((x) => x.length >= 2);
  if (!parts.length) throw bad('Type a location first');
  try { res.json(await geocodeParts(parts, currentRegion().config.region)); }
  catch { res.status(502).json({ error: 'The map search is not available right now. Enter the latitude and longitude by hand, or try again in a moment.' }); }
}));
r.get('/ai-writer', canWrite, (_req, res) => res.json({ languages: LANGUAGES, tones: TONES, goals: REWRITE_GOALS, rtl: RTL_LANGUAGES, connected: !!activeProvider(getSetting('ai_default', null)) }));
r.post('/ai-writer', canWrite, aiWriterLimit, asyncH(async (req, res) => {
  const pid = Number(req.body?.property_id) || null;
  let stored = null;
  if (pid) {
    stored = get('SELECT * FROM properties WHERE id=?', pid);
    if (!stored) throw notFound('Property not found');
    if (!hasPerm(req.user, 'properties', 'edit')) throw forbidden('You do not have permission to edit properties');
    assertOwner(req, stored);
  }
  const out = await writeListingText(req.body || {}, stored);
  audit(req, 'Wrote listing text with AI', 'property', pid, `${out.mode}${out.field ? ` ${out.field}` : ''} (${out.language}, ${out.provider})`);
  res.json(out);
}));

// ---- Status / publishing workflow
function setState(req, res, fn) {
  const p = get('SELECT * FROM properties WHERE id=?', req.params.id);
  if (!p) throw notFound();
  assertOwner(req, p);
  const before = { status: p.status, review: p.review_state, published: p.published };
  tx(() => fn(p));
  const after = get('SELECT * FROM properties WHERE id=?', p.id);
  audit(req, 'Property status', 'property', p.id, `${p.title}: ${before.status}/${before.review}/${before.published ? 'published' : 'unpublished'} → ${after.status}/${after.review_state}/${after.published ? 'published' : 'unpublished'}`);
  return after;
}
const needNotSold = (p) => { if (p.status === 'sold') throw bad('This property is sold'); };

r.post('/:id(\\d+)/submit-review', can('properties', 'edit'), asyncH((req, res) => {
  const a = setState(req, res, (p) => {
    needNotSold(p);
    if (p.review_state !== 'draft') throw bad('Only draft listings can be submitted for review');
    run("UPDATE properties SET review_state='review', updated_at=? WHERE id=?", now(), p.id);
  });
  notifyReviewers('Listing awaiting approval', `${a.title} — added by ${req.user.name}`, '/listings/approvals');
  res.json(present(a));
}));
r.post('/:id(\\d+)/approve', can('properties', 'approve'), asyncH((req, res) => {
  res.json(present(setState(req, res, (p) => {
    if (p.review_state !== 'review') throw bad('Property is not awaiting review');
    run("UPDATE properties SET review_state='approved', updated_at=? WHERE id=?", now(), p.id);
  })));
}));
r.post('/:id(\\d+)/publish', canPublish, asyncH((req, res) => {
  const a = setState(req, res, (p) => {
    needNotSold(p);
    if (!p.title || !p.net_price) throw bad('A listing needs a title and a price before it can be published');
    if (currentRegion().config.permit_required && !get("SELECT 1 FROM region_ext_values WHERE entity='property' AND entity_id=? AND key='rera_permit_no' AND value<>''", p.id)) throw bad('A listing in the UAE needs its advertising permit number before it can be published. Add it under the UAE details.');
    if (!['approved', 'published'].includes(p.review_state)) run("UPDATE properties SET review_state='approved' WHERE id=?", p.id);
    run("UPDATE properties SET published=1, review_state='published', status=CASE WHEN status IN ('draft','on_hold') THEN 'available' ELSE status END, updated_at=? WHERE id=?", now(), p.id);
  });
  fireWebhook(a.id, 'property.published');
  res.json(present(a));
}));
r.post('/:id(\\d+)/feature', can('properties', 'approve'), asyncH((req, res) => {
  const a = setState(req, res, (p) => {
    if (p.status !== 'available') throw bad(`Only available properties can be featured (current: ${p.status})`);
    if (!p.published) throw bad('Publish the property before featuring it');
    run("UPDATE properties SET status='featured', updated_at=? WHERE id=?", now(), p.id);
  });
  fireWebhook(a.id, 'property.featured');
  res.json(present(a));
}));
r.post('/:id(\\d+)/unfeature', can('properties', 'approve'), asyncH((req, res) => {
  const a = setState(req, res, (p) => {
    if (p.status !== 'featured') throw bad('Property is not featured');
    run("UPDATE properties SET status='available', updated_at=? WHERE id=?", now(), p.id);
  });
  fireWebhook(a.id, 'property.unfeatured');
  res.json(present(a));
}));
r.post('/:id(\\d+)/unpublish', canPublish, asyncH((req, res) => {
  const a = setState(req, res, (p) => {
    needNotSold(p);
    run("UPDATE properties SET published=0, status=CASE WHEN status='featured' THEN 'available' ELSE status END, updated_at=? WHERE id=?", now(), p.id);
  });
  fireWebhook(a.id, 'property.hidden');
  res.json(present(a));
}));
r.post('/:id(\\d+)/hold', can('properties', 'edit'), asyncH((req, res) => {
  const a = setState(req, res, (p) => {
    if (!['available', 'featured', 'draft'].includes(p.status)) throw bad(`Cannot put a ${p.status} property on hold`);
    run("UPDATE properties SET status='on_hold', updated_at=? WHERE id=?", now(), p.id);
  });
  fireWebhook(a.id, 'property.hidden');
  res.json(present(a));
}));
r.post('/:id(\\d+)/release', can('properties', 'edit'), asyncH((req, res) => {
  const a = setState(req, res, (p) => {
    if (!['on_hold', 'reserved', 'cancelled'].includes(p.status)) throw bad('Property is not on hold, reserved or cancelled');
    run("UPDATE properties SET status=?, reserved_contact_id=NULL, updated_at=? WHERE id=?", p.published ? 'available' : 'draft', now(), p.id);
    if (p.reserved_contact_id) activity(p.reserved_contact_id, req.user, 'Property reservation released', { detail: p.title });
  });
  fireWebhook(a.id, 'property.available');
  res.json(present(a));
}));
r.post('/:id(\\d+)/archive', canPublish, asyncH((req, res) => {
  const a = setState(req, res, (p) => {
    needNotSold(p);
    run("UPDATE properties SET status='cancelled', published=0, updated_at=? WHERE id=?", now(), p.id);
  });
  fireWebhook(a.id, 'property.hidden');
  res.json(present(a));
}));

// ---- Media
const mediaUp = uploader('media', 'media', 50);
r.post('/:id(\\d+)/media', can('properties', 'edit'), mediaUp.array('files', 20), asyncH((req, res) => {
  const p = get('SELECT * FROM properties WHERE id=?', req.params.id);
  if (!p) throw notFound();
  try { assertOwner(req, p); } catch (e) { (req.files || []).forEach((x) => fs.rm(x.path, { force: true }, () => {})); throw e; }
  const kind = ['cover', 'gallery', 'siteplan', 'map', 'dev', 'document'].includes(req.body.kind) ? req.body.kind : 'gallery';
  const max = get('SELECT COALESCE(MAX(sort_order),0) m FROM media WHERE entity_type=? AND entity_id=?', 'property', p.id).m;
  tx(() => {
    if (kind === 'cover') run("DELETE FROM media WHERE entity_type='property' AND entity_id=? AND kind='cover'", p.id);
    (req.files || []).forEach((f, i) => run('INSERT INTO media(entity_type,entity_id,kind,path,caption,sort_order,created_at) VALUES(?,?,?,?,?,?,?)',
      'property', p.id, kind, `media/${f.filename}`, f.originalname.slice(0, 120), max + i + 1, now()));
  });
  audit(req, 'Uploaded property media', 'property', p.id, `${req.files?.length || 0} ${kind}`);
  res.status(201).json(all('SELECT * FROM media WHERE entity_type=? AND entity_id=? ORDER BY sort_order,id', 'property', p.id));
}));
r.put('/:id(\\d+)/media-order', can('properties', 'edit'), asyncH((req, res) => {
  const ids = req.body.ids;
  if (!Array.isArray(ids)) throw bad('ids required');
  assertOwner(req, get('SELECT * FROM properties WHERE id=?', req.params.id) || {});
  tx(() => ids.forEach((id, i) => run("UPDATE media SET sort_order=? WHERE id=? AND entity_type='property' AND entity_id=?", i + 1, id, req.params.id)));
  res.json({ ok: true });
}));
r.post('/:id(\\d+)/media/:mid(\\d+)/cover', can('properties', 'edit'), asyncH((req, res) => {
  assertOwner(req, get('SELECT * FROM properties WHERE id=?', req.params.id) || {});
  tx(() => {
    run("UPDATE media SET kind='gallery' WHERE entity_type='property' AND entity_id=? AND kind='cover'", req.params.id);
    run("UPDATE media SET kind='cover' WHERE id=? AND entity_type='property' AND entity_id=?", req.params.mid, req.params.id);
  });
  res.json({ ok: true });
}));
r.delete('/:id(\\d+)/media/:mid(\\d+)', can('properties', 'edit'), asyncH((req, res) => {
  assertOwner(req, get('SELECT * FROM properties WHERE id=?', req.params.id) || {});
  const m = get("SELECT * FROM media WHERE id=? AND entity_type='property' AND entity_id=?", req.params.mid, req.params.id);
  if (!m) throw notFound();
  run('DELETE FROM media WHERE id=?', m.id);
  fs.rm(path.join(uploadDir(), m.path), { force: true }, () => {});
  res.json({ ok: true });
}));

export default r;
