import { Router } from 'express';
import { removeRef } from '../services/storage.js';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, nextNo, uploadDir } from '../db.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad, notFound, now, today, jparse, moneyText, curCode } from '../util.js';
import { cleanBoq, effectiveStatus, vendorsFor, TENDER_STATUS } from '../services/tenders.js';
import { notifyVendor } from '../services/vendorAccount.js';
import { sendTable } from './helpers.js';

/**
 * Tenders ("open contracts"): staff announce work, vendors bid from their portal, staff compare the BOQ rates and award.
 * Permissions follow the Vendors module: view / create / edit (publish, close) / approve (shortlist, award) / delete.
 */
const r = Router();
r.use(requireStaff);

const parse = (t) => ({ ...t, boq: jparse(t.boq, []), effective_status: effectiveStatus(t) });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BASE = `SELECT t.*, pr.name project_name,
  (SELECT COUNT(*) FROM tender_bids b WHERE b.tender_id=t.id AND b.status<>'withdrawn') bid_count,
  (SELECT MIN(total_amount) FROM tender_bids b WHERE b.tender_id=t.id AND b.status NOT IN ('withdrawn','rejected')) lowest_bid
  FROM tenders t LEFT JOIN projects pr ON pr.id=t.project_id`;

function fields(body, existing) {
  const d = {};
  const text = (k, max) => { if (body[k] !== undefined) d[k] = body[k] === null || String(body[k]).trim() === '' ? null : String(body[k]).trim().slice(0, max); };
  text('title', 160); text('description', 8000); text('category', 80); text('location', 160); text('scope', 8000); text('required_docs', 2000);
  if (body.title !== undefined && !d.title) throw bad('A title is required');
  if (body.project_id !== undefined) d.project_id = body.project_id ? Number(body.project_id) : null;
  if (d.project_id && !get('SELECT 1 FROM projects WHERE id=?', d.project_id)) throw bad('Unknown project');
  if (body.estimated_budget !== undefined) d.estimated_budget = body.estimated_budget === '' || body.estimated_budget === null ? null : Math.max(0, Math.round(Number(body.estimated_budget) || 0));
  if (body.show_budget !== undefined) d.show_budget = body.show_budget ? 1 : 0;
  if (body.visibility !== undefined) { if (!['all', 'category'].includes(body.visibility)) throw bad('Visibility must be "all" or "category"'); d.visibility = body.visibility; }
  if (body.closes_on !== undefined) { if (!DATE.test(body.closes_on)) throw bad('Closing date must be YYYY-MM-DD'); d.closes_on = body.closes_on; }
  if (body.boq !== undefined) d.boq = JSON.stringify(cleanBoq(body.boq));
  if (d.visibility === 'category' && !(d.category ?? existing?.category)) throw bad('Choose a category to address this tender to one category of vendors');
  return d;
}

r.get('/', can('vendors', 'view'), asyncH((req, res) => {
  const where = ['1=1'], params = [];
  if (req.query.q) { where.push('(t.title LIKE ? OR t.tender_no LIKE ? OR t.category LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
  let rows = all(`${BASE} WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT 500`, ...params).map(parse);
  const summary = Object.fromEntries(TENDER_STATUS.map((s) => [s, rows.filter((x) => x.effective_status === s).length]));
  if (req.query.status) rows = rows.filter((x) => x.effective_status === req.query.status);
  res.json({ rows, summary, total: rows.length });
}));

r.get('/:id(\\d+)', can('vendors', 'view'), asyncH((req, res) => {
  const t = get(`${BASE} WHERE t.id=?`, req.params.id);
  if (!t) throw notFound('Tender not found');
  const bids = all(`SELECT b.*, v.name vendor_name, v.vendor_code, v.company, v.category vendor_category, v.phone vendor_phone,
      (SELECT COUNT(*) FROM tender_bids x WHERE x.vendor_id=b.vendor_id AND x.status='awarded') awards_won
    FROM tender_bids b JOIN vendors v ON v.id=b.vendor_id WHERE b.tender_id=? AND b.status<>'withdrawn' ORDER BY b.total_amount, b.id`, t.id)
    .map((b) => ({ ...b, boq_rates: jparse(b.boq_rates, []), files: all("SELECT id,name,category,size,mime,created_at FROM documents WHERE entity_type='bid' AND entity_id=? ORDER BY id", b.id) }));
  const live = bids.filter((b) => b.status !== 'rejected');
  bids.forEach((b) => { b.rank = live.findIndex((x) => x.id === b.id) + 1 || null; b.is_lowest = live.length > 0 && b.id === live[0].id; });
  res.json({ ...parse(t), bids, files: all("SELECT id,name,category,size,mime,portal_visible,created_at FROM documents WHERE entity_type='tender' AND entity_id=? ORDER BY id", t.id),
    eligible_vendors: vendorsFor(t).length });
}));

r.post('/', can('vendors', 'create'), asyncH((req, res) => {
  const d = fields(req.body || {});
  if (!d.title) throw bad('A title is required');
  if (!d.closes_on) throw bad('A closing date is required');
  if (d.closes_on < today()) throw bad('The closing date cannot be in the past');
  const no = nextNo('TND', 'TND', 4);
  const id = Number(run(`INSERT INTO tenders(tender_no,title,description,category,project_id,location,scope,boq,required_docs,estimated_budget,show_budget,closes_on,status,visibility,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`, no, d.title, d.description ?? null, d.category ?? null, d.project_id ?? null, d.location ?? null, d.scope ?? null, d.boq ?? '[]', d.required_docs ?? null,
    d.estimated_budget ?? null, d.show_budget ?? 0, d.closes_on, d.visibility ?? 'all', req.user.id, now()).lastInsertRowid);
  audit(req, 'Created tender', 'tender', id, `${no} ${d.title}`);
  res.status(201).json({ id, tender_no: no });
}));

r.put('/:id(\\d+)', can('vendors', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM tenders WHERE id=?', req.params.id);
  if (!t) throw notFound('Tender not found');
  if (['awarded', 'cancelled'].includes(t.status)) throw bad(`A ${t.status} tender can no longer be edited`);
  const d = fields(req.body || {}, t);
  if (d.boq && d.boq !== t.boq && get("SELECT 1 FROM tender_bids WHERE tender_id=? AND status<>'withdrawn'", t.id)) throw bad('Bids have been received, so the BOQ can no longer change');
  const keys = Object.keys(d);
  if (!keys.length) return res.json({ ok: true });
  run(`UPDATE tenders SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`, ...keys.map((k) => d[k]), now(), t.id);
  audit(req, 'Edited tender', 'tender', t.id, t.tender_no);
  res.json({ ok: true });
}));

r.post('/:id(\\d+)/publish', can('vendors', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM tenders WHERE id=?', req.params.id);
  if (!t) throw notFound('Tender not found');
  if (t.status !== 'draft') throw bad('Only a draft can be published');
  if (t.closes_on < today()) throw bad('Move the closing date forward before publishing');
  run("UPDATE tenders SET status='open', updated_at=? WHERE id=?", now(), t.id);
  const vendors = vendorsFor(t);
  for (const v of vendors) notifyVendor(v.id, 'tender', 'New contract open for bidding', `${t.title} — closes ${t.closes_on}`, `/vendor/tenders/${t.id}`);
  audit(req, 'Published tender', 'tender', t.id, `${t.tender_no} to ${vendors.length} vendor(s)`);
  res.json({ ok: true, vendors: vendors.length });
}));

r.post('/:id(\\d+)/close', can('vendors', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM tenders WHERE id=?', req.params.id);
  if (!t) throw notFound('Tender not found');
  if (t.status !== 'open') throw bad('Only an open tender can be closed');
  run("UPDATE tenders SET status='closed', updated_at=? WHERE id=?", now(), t.id);
  audit(req, 'Closed tender', 'tender', t.id, t.tender_no);
  res.json({ ok: true });
}));

r.post('/:id(\\d+)/reopen', can('vendors', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM tenders WHERE id=?', req.params.id);
  if (!t) throw notFound('Tender not found');
  if (effectiveStatus(t) !== 'closed') throw bad('Only a closed tender can be reopened');
  const closes = req.body?.closes_on;
  if (!DATE.test(closes || '') || closes < today()) throw bad('Choose a new closing date in the future');
  run("UPDATE tenders SET status='open', closes_on=?, updated_at=? WHERE id=?", closes, now(), t.id);
  for (const b of all("SELECT vendor_id FROM tender_bids WHERE tender_id=? AND status<>'withdrawn'", t.id)) notifyVendor(b.vendor_id, 'tender', 'Tender reopened', `${t.title} is open again until ${closes}`, `/vendor/tenders/${t.id}`);
  audit(req, 'Reopened tender', 'tender', t.id, `${t.tender_no} until ${closes}`);
  res.json({ ok: true });
}));

r.post('/:id(\\d+)/cancel', can('vendors', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM tenders WHERE id=?', req.params.id);
  if (!t) throw notFound('Tender not found');
  if (['awarded', 'cancelled'].includes(t.status)) throw bad(`This tender is already ${t.status}`);
  run("UPDATE tenders SET status='cancelled', updated_at=? WHERE id=?", now(), t.id);
  for (const b of all("SELECT vendor_id FROM tender_bids WHERE tender_id=? AND status<>'withdrawn'", t.id)) notifyVendor(b.vendor_id, 'tender', 'Tender cancelled', `${t.title} was cancelled by the company`, `/vendor/tenders/${t.id}`);
  audit(req, 'Cancelled tender', 'tender', t.id, t.tender_no);
  res.json({ ok: true });
}));

r.post('/:id(\\d+)/award', can('vendors', 'approve'), asyncH((req, res) => {
  const t = get('SELECT * FROM tenders WHERE id=?', req.params.id);
  if (!t) throw notFound('Tender not found');
  if (!['open', 'closed'].includes(t.status)) throw bad(t.status === 'awarded' ? 'This tender is already awarded' : 'Publish the tender before awarding it');
  const bid = get('SELECT * FROM tender_bids WHERE id=? AND tender_id=?', req.body?.bid_id, t.id);
  if (!bid || !['submitted', 'shortlisted'].includes(bid.status)) throw bad('Choose one of the submitted bids');
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 1000) : null;
  tx(() => {
    run("UPDATE tender_bids SET status='awarded', updated_at=? WHERE id=?", now(), bid.id);
    run("UPDATE tender_bids SET status='rejected', updated_at=? WHERE tender_id=? AND id<>? AND status IN ('submitted','shortlisted')", now(), t.id, bid.id);
    run("UPDATE tenders SET status='awarded', awarded_bid_id=?, award_note=?, updated_at=? WHERE id=?", bid.id, note, now(), t.id);
  });
  notifyVendor(bid.vendor_id, 'tender', 'Congratulations — contract awarded', `${t.title} was awarded to you (${moneyText(bid.total_amount)})${note ? `: ${note}` : ''}`, `/vendor/tenders/${t.id}`);
  for (const o of all("SELECT vendor_id FROM tender_bids WHERE tender_id=? AND id<>? AND status='rejected'", t.id, bid.id)) notifyVendor(o.vendor_id, 'tender', 'Tender decided', `${t.title} was awarded to another vendor. Thank you for bidding.`, `/vendor/tenders/${t.id}`);
  audit(req, 'Awarded tender', 'tender', t.id, `${t.tender_no} → vendor ${bid.vendor_id} ${curCode()} ${bid.total_amount}`);
  res.json({ ok: true });
}));

r.put('/bids/:id(\\d+)', can('vendors', 'approve'), asyncH((req, res) => {
  const b = get('SELECT b.*, t.status tender_status, t.title, t.id tid FROM tender_bids b JOIN tenders t ON t.id=b.tender_id WHERE b.id=?', req.params.id);
  if (!b) throw notFound('Bid not found');
  if (['awarded', 'cancelled'].includes(b.tender_status) || ['awarded', 'withdrawn'].includes(b.status)) throw bad('This bid can no longer be changed');
  const status = req.body?.status;
  if (status !== undefined && !['submitted', 'shortlisted', 'rejected'].includes(status)) throw bad('Status must be submitted, shortlisted or rejected');
  const note = req.body?.staff_note === undefined ? b.staff_note : (String(req.body.staff_note).trim().slice(0, 1000) || null);
  run('UPDATE tender_bids SET status=?, staff_note=?, updated_at=? WHERE id=?', status ?? b.status, note, now(), b.id);
  if (status === 'shortlisted' && b.status !== 'shortlisted') notifyVendor(b.vendor_id, 'tender', 'Your bid was shortlisted', `${b.title}: the company may contact you for the next step`, `/vendor/tenders/${b.tid}`);
  if (status === 'rejected' && b.status !== 'rejected') notifyVendor(b.vendor_id, 'tender', 'Your bid was not selected', `${b.title}${note ? `: ${note}` : ''}`, `/vendor/tenders/${b.tid}`);
  audit(req, 'Updated bid', 'tender', b.tid, `bid ${b.id} → ${status ?? b.status}`);
  res.json({ ok: true });
}));

r.delete('/:id(\\d+)', can('vendors', 'delete'), asyncH((req, res) => {
  const t = get('SELECT * FROM tenders WHERE id=?', req.params.id);
  if (!t) throw notFound('Tender not found');
  if (t.status !== 'draft' && !(t.status === 'cancelled' && !get('SELECT 1 FROM tender_bids WHERE tender_id=?', t.id))) throw bad('Only a draft (or an unbid cancelled tender) can be deleted — cancel it instead');
  for (const d of all("SELECT * FROM documents WHERE entity_type='tender' AND entity_id=?", t.id)) removeRef(d.path).catch(() => {});
  run("DELETE FROM documents WHERE entity_type='tender' AND entity_id=?", t.id);
  run('DELETE FROM tenders WHERE id=?', t.id);
  audit(req, 'Deleted tender', 'tender', t.id, t.tender_no);
  res.json({ ok: true });
}));

/** Side-by-side BOQ comparison as a download (pdf / xlsx / csv). */
r.get('/:id(\\d+)/comparison', can('vendors', 'view'), asyncH(async (req, res) => {
  const t = get('SELECT * FROM tenders WHERE id=?', req.params.id);
  if (!t) throw notFound('Tender not found');
  const boq = jparse(t.boq, []);
  const bids = all(`SELECT b.*, v.name vendor_name FROM tender_bids b JOIN vendors v ON v.id=b.vendor_id WHERE b.tender_id=? AND b.status NOT IN ('withdrawn') ORDER BY b.total_amount`, t.id).map((b) => ({ ...b, rates: new Map(jparse(b.boq_rates, []).map((x) => [x.no, x.rate])) }));
  const columns = [{ key: 'no', label: '#' }, { key: 'description', label: 'Item' }, { key: 'unit', label: 'Unit' }, { key: 'qty', label: 'Qty' }, ...bids.map((b) => ({ key: `b${b.id}`, label: b.vendor_name, type: 'money' }))];
  const rows = boq.map((l) => ({ no: l.no, description: l.description, unit: l.unit, qty: l.qty, ...Object.fromEntries(bids.map((b) => [`b${b.id}`, b.rates.get(l.no) ?? null])) }));
  rows.push({ description: 'TOTAL', ...Object.fromEntries(bids.map((b) => [`b${b.id}`, b.total_amount])) });
  const duration = { description: 'Duration (days)', ...Object.fromEntries(bids.map((b) => [`b${b.id}`, b.duration_days])) };
  rows.push(duration);
  audit(req, 'Exported tender comparison', 'tender', t.id, req.query.format || 'csv');
  return sendTable(res, ['pdf', 'xlsx', 'csv'].includes(req.query.format) ? req.query.format : 'csv', `comparison-${t.tender_no}`, columns, rows, { title: `BID COMPARISON — ${t.tender_no}`, subtitle: `${t.title}\nClosing ${t.closes_on}` });
}));

export default r;
