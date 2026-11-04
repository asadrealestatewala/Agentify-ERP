// Developer partner portal (/api/developer): a developer sees only their own files, and only the allow-listed fields of
// toDeveloperFile(). The developer id comes from the session, never from the request.
import { Router } from 'express';
import { get, all } from '../db.js';
import { requireDeveloper } from '../rbac.js';
import path from 'node:path';
import { asyncH, bad, notFound } from '../util.js';
import { audit } from '../audit.js';
import { developerFiles, toDeveloperFile } from '../services/developers.js';
import { approvePayment, rejectPayment, paymentsFor, rebateStatement, slipRef } from '../services/developerPayments.js';
import { sendStored, isStoredRef } from '../services/storage.js';
import { sendTable } from './helpers.js';

const r = Router();
r.use(requireDeveloper);
const mine = (req) => req.user.developer_id;

r.get('/dashboard', asyncH((req, res) => {
  const d = get('SELECT id, name, company FROM developers WHERE id=?', mine(req));
  const files = developerFiles(mine(req)).filter((s) => s.status === 'confirmed');
  res.json({
    developer: d,
    files: files.length, plots_available: get("SELECT COUNT(*) n FROM properties WHERE developer_id=? AND status IN ('available','featured')", mine(req)).n,
    contract_value: files.reduce((a, s) => a + s.net_price, 0), collected: files.reduce((a, s) => a + s.paid_amount, 0),
    outstanding: files.reduce((a, s) => a + (s.net_price - s.paid_amount), 0),
    held_by_company: files.filter((s) => s.holder === 'company').length,
  });
}));

r.get('/files', asyncH((req, res) => res.json(developerFiles(mine(req)).map((s) => toDeveloperFile(s)))));

r.get('/files/:id(\\d+)', asyncH((req, res) => {
  const s = get('SELECT * FROM sales WHERE id=? AND developer_id=?', req.params.id, mine(req));
  if (!s) throw notFound('File not found');
  res.json(toDeveloperFile(s, { detail: true }));
}));

r.get('/plots', asyncH((req, res) => {
  res.json(all("SELECT id, title, plot_no, block, property_type, area_size, unit, net_price, status FROM properties WHERE developer_id=? ORDER BY id DESC", mine(req)));
}));

// ---- payments on my files: approve / reject what customers report (the developer is the one who received the money)
r.get('/payments', asyncH((req, res) => res.json(paymentsFor(mine(req), String(req.query.status || '')))));
r.post('/payments/:id(\\d+)/approve', asyncH((req, res) => res.json(approvePayment(req, Number(req.params.id), req.body || {}))));
r.post('/payments/:id(\\d+)/reject', asyncH((req, res) => { rejectPayment(req, Number(req.params.id), req.body?.reason); res.json({ ok: true }); }));
const SLIP = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
r.get('/payments/:id(\\d+)/slip', asyncH(async (req, res) => {
  const ref = slipRef(mine(req), Number(req.params.id));
  if (!ref || !(isStoredRef(ref) || /^claims\/[\w.-]+$/.test(ref))) return res.status(404).json({ error: 'No slip attached' });
  try { await sendStored(req, res, ref, { mime: SLIP[path.extname(ref).toLowerCase()] || 'application/octet-stream', name: 'payment-slip' + path.extname(ref) }); } catch (e) { if (e.status === 404) return res.status(404).json({ error: 'No slip attached' }); throw e; }
}));

// ---- rebate statement and downloadable reports (every download is audited)
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const range = (q) => ({ from: DATE.test(q.from || '') ? q.from : null, to: DATE.test(q.to || '') ? q.to : null });
r.get('/rebates', asyncH((req, res) => res.json(rebateStatement(mine(req), range(req.query)))));

const REPORTS = {
  'rebate-statement': { title: 'Rebate statement', columns: [{ key: 'date', label: 'Date' }, { key: 'booking_id', label: 'Booking' }, { key: 'plot', label: 'Plot' }, { key: 'customer_name', label: 'Customer' },
    { key: 'method', label: 'Method' }, { key: 'amount', label: 'Payment amount', type: 'money' }, { key: 'rebate', label: 'Rebate due', type: 'money' }],
    rows: (dev, q) => rebateStatement(dev, range(q)).rows },
  files: { title: 'Files', columns: [{ key: 'booking_id', label: 'Booking' }, { key: 'plot', label: 'Plot' }, { key: 'registration_no', label: 'Registration no.' }, { key: 'customer_name', label: 'Customer' },
    { key: 'state', label: 'State' }, { key: 'contract_value', label: 'Contract value', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'outstanding', label: 'Outstanding', type: 'money' }],
    rows: (dev) => developerFiles(dev).map((s) => toDeveloperFile(s)).map((f) => ({ ...f, plot: f.plot.title, state: f.held_by_company ? 'Held by company' : f.file_state })) },
  payments: { title: 'Customer payments', columns: [{ key: 'created_at', label: 'Reported' }, { key: 'ref', label: 'Reference' }, { key: 'booking_id', label: 'Booking' }, { key: 'plot', label: 'Plot' },
    { key: 'customer_name', label: 'Customer' }, { key: 'method', label: 'Method' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'status', label: 'Status' }],
    rows: (dev) => paymentsFor(dev, '') },
};
r.get('/reports/:key', asyncH(async (req, res) => {
  const def = REPORTS[req.params.key];
  if (!def) throw notFound('Report not found');
  const format = req.query.format || 'csv';
  if (!['csv', 'xlsx', 'pdf'].includes(format)) throw bad('Choose csv, xlsx or pdf');
  const rows = def.rows(mine(req), req.query);
  audit(req, 'Developer downloaded report', 'developer_report', req.params.key, `${def.title} (${format})`);
  return sendTable(res, format, req.params.key, def.columns, rows, { title: def.title });
}));

export default r;
