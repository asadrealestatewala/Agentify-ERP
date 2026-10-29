import { Router } from 'express';
import { sendStored, isStoredRef } from '../services/storage.js';
const SLIP_MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const mimeOfSlip = (ref) => SLIP_MIME[path.extname(ref).toLowerCase()] || 'application/octet-stream';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { can, requireStaff } from '../rbac.js';
import { asyncH, bad } from '../util.js';
import { allClaims, approveClaim, feedKeyOk, feedStats, ingestFeed, parseStatement, rejectClaim, setAutoApprove, startVerifying, syncSettings } from '../services/claims.js';
import { audit } from '../audit.js';
import { get, uploadDir } from '../db.js';

/** Staff side of the customers' payment reports (permission module: payments). */
const r = Router();
r.use(requireStaff);
r.get('/', can('payments', 'view'), asyncH((req, res) => {
  const status = ['open', 'pending', 'verifying', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
  res.json({ rows: allClaims(status), open: get("SELECT COUNT(*) n FROM payment_claims WHERE status IN ('pending','verifying')").n, matched: get("SELECT COUNT(*) n FROM payment_claims WHERE status IN ('pending','verifying') AND auto_matched=1").n });
}));
r.post('/:id(\\d+)/verifying', can('payments', 'create'), asyncH((req, res) => { startVerifying(Number(req.params.id), req); res.json({ ok: true }); }));
r.post('/:id(\\d+)/approve', can('payments', 'create'), asyncH((req, res) => res.json({ receipt_id: approveClaim(Number(req.params.id), req.body || {}, req) })));
r.post('/:id(\\d+)/reject', can('payments', 'create'), asyncH((req, res) => { rejectClaim(Number(req.params.id), req.body?.reason, req); res.json({ ok: true }); }));
/** Confirm every report the bank / wallet feed has matched, in one go (one deposit account, one verification channel). */
r.post('/bulk-approve', can('payments', 'create'), asyncH((req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('Choose at least one payment');
  const done = [], failed = [];
  for (const id of ids) {
    const c = get("SELECT id FROM payment_claims WHERE id=? AND auto_matched=1 AND status IN ('pending','verifying')", id);
    if (!c) { failed.push({ id, error: 'Not a matched, open report' }); continue; }
    try { approveClaim(id, { account_id: req.body.account_id, verified_channel: req.body.verified_channel || 'Statement import' }, req); done.push(id); } catch (e) { failed.push({ id, error: e.message }); }
  }
  res.json({ approved: done.length, failed });
}));
r.get('/:id(\\d+)/slip', can('payments', 'view'), asyncH(async (req, res) => {
  const c = get('SELECT slip_path FROM payment_claims WHERE id=?', req.params.id);
  const ref = c?.slip_path && (isStoredRef(c.slip_path) || /^claims\/[\w.-]+$/.test(c.slip_path)) ? c.slip_path : null;
  if (!ref) return res.status(404).json({ error: 'No slip attached' });
  try { await sendStored(req, res, ref, { mime: mimeOfSlip(ref), name: 'payment-slip' + path.extname(ref) }); } catch (e) { if (e.status === 404) return res.status(404).json({ error: 'No slip attached' }); throw e; }
}));

// ---- auto-sync: statement import, webhook key, auto-approval switch
r.post('/statement', can('payments', 'create'), asyncH((req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : parseStatement(req.body?.csv);
  if (rows.length > 2000) throw bad('Import up to 2,000 transactions at a time');
  const out = ingestFeed(rows, { channel: String(req.body?.channel || 'Bank statement'), source: 'statement' });
  audit(req, 'Imported bank / wallet statement', 'payment_feed', null, `${out.new} new, ${out.matched.length} matched`);
  res.json(out);
}));
r.get('/sync-settings', can('payments', 'approve'), (req, res) => res.json({ ...syncSettings(), ...feedStats(), webhook: `${req.protocol}://${req.get('host')}/api/payment-feed` }));
r.put('/sync-settings', can('payments', 'approve'), asyncH((req, res) => {
  if (req.body?.auto_approve !== undefined) setAutoApprove(!!req.body.auto_approve);
  if (req.body?.regenerate) audit(req, 'Regenerated payment feed key', 'payment_feed', null, '');
  res.json({ ...syncSettings({ regenerate: !!req.body?.regenerate }), ...feedStats(), webhook: `${req.protocol}://${req.get('host')}/api/payment-feed` });
}));

/**
 * Webhook for bank / wallet notifications (Easypaisa, JazzCash, a bank's alert forwarder, an SMS-forwarding app…).
 * POST /api/payment-feed with header X-Feed-Key: { channel, txn_id, amount, date?, sender? }  (or { entries: [...] }).
 * No session: protected by the secret key, rate-limited, and only ever records credits and matches them to customer reports.
 */
export const feed = Router();
feed.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));
feed.post('/', asyncH((req, res) => {
  if (!feedKeyOk(req.headers['x-feed-key'])) return res.status(401).json({ error: 'Invalid feed key' });
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [req.body];
  if (entries.length > 200) throw bad('Send up to 200 transactions per request');
  const out = ingestFeed(entries, { source: 'webhook' });
  res.json(out);
}));
export default r;
