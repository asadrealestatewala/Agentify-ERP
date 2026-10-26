// Tenant-facing billing documents: payment history, ledger statement (CSV / PDF), invoice PDFs and proof-of-payment files.
// Everything is read from this workspace's own rows in the platform database (the caller passes the tenant, never an id from the
// request), and money amounts are whole currency units exactly as stored. No tax is calculated here, so the PDFs say "Receipt".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { platformDb, logTenantEvent } from '../platform.js';
import { DATA_DIR } from '../db.js';
import { bad, HttpError } from '../util.js';
import { PLANS } from './plans.js';
import { platformBrand } from './mailer.js';
import { methodLabel } from './billing.js';
import { billingAddress } from './billingMail.js';

const pdb = () => platformDb();
const TEAL = '#0e7c6b', INK = '#1f2937', GREY = '#6b7280', LINE = '#e5e7eb';
const money = (n, cur) => `${cur ? `${cur} ` : ''}${Number(n || 0).toLocaleString('en-US')}`;
const day = (v) => String(v || '').slice(0, 10);
const planName = (p) => PLANS[p]?.name || p || '';
export const invoiceNumber = (inv) => `INV-${String(inv.created_at || '').slice(0, 4) || '0000'}-${String(inv.id).padStart(5, '0')}`;
const submissionOf = (inv) => { const m = /^local-(\d+)$/.exec(inv.provider_invoice_id || ''); return m ? pdb().prepare('SELECT * FROM payment_submissions WHERE id=? AND tenant_id=?').get(Number(m[1]), inv.tenant_id) : null; };
const methodOf = (inv, sub) => (sub ? methodLabel(sub.method) : 'Card');

// ---------------------------------------------------------------- payment history (every attempt, any outcome)
export function paymentHistory(tenantId) {
  const subs = pdb().prepare('SELECT id,plan,interval,method,amount,currency,reference,status,decision_note,created_at,decided_at,proof_name FROM payment_submissions WHERE tenant_id=? ORDER BY id DESC LIMIT 200').all(tenantId)
    .map((s) => ({ kind: 'payment', id: s.id, date: s.created_at, decided: s.decided_at, method: methodLabel(s.method), amount: s.amount, currency: s.currency, reference: s.reference, plan: planName(s.plan), interval: s.interval,
      status: s.status === 'approved' ? 'paid' : s.status, note: s.decision_note, proof: s.proof_name || null, invoice_id: null }));
  const invs = pdb().prepare('SELECT * FROM invoices WHERE tenant_id=? ORDER BY id DESC LIMIT 200').all(tenantId);
  const byLocal = new Map(invs.filter((i) => /^local-/.test(i.provider_invoice_id || '')).map((i) => [Number(i.provider_invoice_id.slice(6)), i]));
  for (const s of subs) if (byLocal.has(s.id)) s.invoice_id = byLocal.get(s.id).id;
  const card = invs.filter((i) => !/^local-/.test(i.provider_invoice_id || '')).map((i) => ({ kind: 'invoice', id: i.id, date: i.created_at, method: 'Card', amount: i.amount, currency: i.currency, reference: i.provider_invoice_id || invoiceNumber(i),
    plan: planName(i.plan), status: i.status === 'paid' ? 'paid' : i.status, note: null, proof: null, invoice_id: i.id }));
  return [...subs, ...card].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ---------------------------------------------------------------- ledger
/** Rows between two dates (inclusive). Charges and payments come from invoices, refunds from refunds; pending or rejected transfers are not money received and stay in the history only. */
export function ledger(tenantId, { from, to } = {}) {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : null, t = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : null;
  const all = [];
  for (const i of pdb().prepare('SELECT * FROM invoices WHERE tenant_id=?').all(tenantId)) {
    const sub = submissionOf(i);
    const desc = `${planName(i.plan) || 'Subscription'}${i.period_start ? ` (${day(i.period_start)} to ${day(i.period_end)})` : ''}`;
    all.push({ date: day(i.created_at), at: i.created_at, ord: 0, description: `Invoice ${invoiceNumber(i)}: ${desc}`, reference: i.provider_invoice_id || '', method: methodOf(i, sub), charge: i.amount, payment: 0, refund: 0, currency: i.currency });
    if (i.status === 'paid') all.push({ date: day(i.created_at), at: i.created_at, ord: 1, description: `Payment received (${methodOf(i, sub)})`, reference: sub?.reference || i.provider_invoice_id || '', method: methodOf(i, sub), charge: 0, payment: i.amount, refund: 0, currency: i.currency });
  }
  for (const r of pdb().prepare('SELECT r.*, i.provider_invoice_id inv_ref, i.currency inv_cur FROM refunds r LEFT JOIN invoices i ON i.id=r.invoice_id WHERE r.tenant_id=?').all(tenantId)) {
    all.push({ date: day(r.created_at), at: r.created_at, ord: 2, description: `Refund${r.reason ? `: ${r.reason}` : ''}`, reference: r.provider_refund_id || r.inv_ref || '', method: '', charge: 0, payment: 0, refund: r.amount, currency: r.currency || r.inv_cur || '' });
  }
  all.sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.ord - b.ord);
  // balance due = charges - payments; net paid = payments - refunds. Both run from the first record ever, so a date range keeps correct opening figures.
  let due = 0, net = 0; const rows = []; let openingDue = 0, openingNet = 0;
  for (const r of all) {
    due += r.charge - r.payment; net += r.payment - r.refund;
    if (f && r.date < f) { openingDue = due; openingNet = net; continue; }
    if (t && r.date > t) continue;
    rows.push({ ...r, balance_due: due, net_paid: net });
  }
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return { from: f, to: t, currency: rows[0]?.currency || all[0]?.currency || '', opening: { balance_due: openingDue, net_paid: openingNet }, rows,
    totals: { charges: sum('charge'), payments: sum('payment'), refunds: sum('refund') }, closing: { balance_due: rows.length ? rows[rows.length - 1].balance_due : openingDue, net_paid: rows.length ? rows[rows.length - 1].net_paid : openingNet } };
}

const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
export function statementCsv(tenant, l) {
  const head = ['Date', 'Description', 'Reference', 'Charges', 'Payments', 'Refunds', 'Balance due', 'Net paid'];
  const lines = [[`Statement for ${tenant.name}`], [`Period`, l.from || 'start', l.to || 'today'], [], head, ...l.rows.map((r) => [r.date, r.description, r.reference, r.charge || '', r.payment || '', r.refund || '', r.balance_due, r.net_paid]),
    [], ['Totals', '', '', l.totals.charges, l.totals.payments, l.totals.refunds, l.closing.balance_due, l.closing.net_paid], ['Currency', l.currency]];
  return `﻿${lines.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------- PDFs
function header(doc, title, sub) {
  const b = platformBrand(), M = 40, W = doc.page.width - M * 2;
  doc.rect(0, 0, doc.page.width, 64).fill(TEAL);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(17).text(b.name, M, 22, { width: W / 2 });
  doc.font('Helvetica-Bold').fontSize(14).text(title, M, 20, { width: W, align: 'right' });
  if (sub) doc.font('Helvetica').fontSize(9).text(sub, M, 40, { width: W, align: 'right' });
  doc.fillColor(INK); doc.y = 86; return { M, W };
}
function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // text below the bottom margin would otherwise open an empty extra page
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text(`Questions about billing? Mail ${billingAddress()}   ·   Page ${i + 1} of ${range.count}`, 40, doc.page.height - 34, { width: doc.page.width - 80, align: 'center', lineBreak: false });
  }
}
function pdfBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    build(doc); footer(doc); doc.end();
  });
}

export function statementPdf(tenant, l) {
  return pdfBuffer((doc) => {
    const { M, W } = header(doc, 'Account statement', `${l.from || 'Start'} to ${l.to || 'today'}`);
    doc.font('Helvetica-Bold').fontSize(11).text(tenant.name).font('Helvetica').fontSize(9).fillColor(GREY).text(tenant.owner_email || '').fillColor(INK).moveDown(0.8);
    const cols = [{ k: 'date', l: 'Date', w: 58 }, { k: 'description', l: 'Description', w: 190 }, { k: 'charge', l: 'Charges', w: 62, r: 1 }, { k: 'payment', l: 'Payments', w: 62, r: 1 }, { k: 'refund', l: 'Refunds', w: 54, r: 1 }, { k: 'balance_due', l: 'Balance due', w: 62, r: 1 }, { k: 'net_paid', l: 'Net paid', w: 62, r: 1 }];
    const total = cols.reduce((a, c) => a + c.w, 0), k = W / total;
    const row = (vals, bold, shade) => {
      let x = M; const y = doc.y;
      const h = Math.max(...cols.map((c) => doc.heightOfString(String(vals[c.k] ?? ''), { width: c.w * k - 6 }))) + 6;
      if (y + h > doc.page.height - 60) { doc.addPage(); doc.y = 50; return row(vals, bold, shade); }
      if (shade) doc.rect(M, y - 2, W, h).fill('#f3f4f6');
      doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      for (const c of cols) { doc.text(String(vals[c.k] ?? ''), x + 3, y + 1, { width: c.w * k - 6, align: c.r ? 'right' : 'left' }); x += c.w * k; }
      doc.y = y + h; doc.moveTo(M, doc.y - 2).lineTo(M + W, doc.y - 2).lineWidth(0.4).strokeColor(LINE).stroke();
      return undefined;
    };
    row(Object.fromEntries(cols.map((c) => [c.k, c.l])), true, true);
    if (l.from) row({ date: l.from, description: 'Opening position', balance_due: money(l.opening.balance_due), net_paid: money(l.opening.net_paid) }, false, false);
    if (!l.rows.length) doc.font('Helvetica').fontSize(9).fillColor(GREY).text('No transactions in this period.', M, doc.y + 6);
    for (const r of l.rows) row({ date: r.date, description: `${r.description}${r.reference ? `\nRef: ${r.reference}` : ''}`, charge: r.charge ? money(r.charge) : '', payment: r.payment ? money(r.payment) : '', refund: r.refund ? money(r.refund) : '', balance_due: money(r.balance_due), net_paid: money(r.net_paid) });
    row({ description: 'Totals', charge: money(l.totals.charges), payment: money(l.totals.payments), refund: money(l.totals.refunds), balance_due: money(l.closing.balance_due), net_paid: money(l.closing.net_paid) }, true, true);
    doc.moveDown(1).font('Helvetica').fontSize(8).fillColor(GREY).text(`All amounts in ${l.currency || 'the billing currency'}. Balance due is charges less payments. Net paid is payments less refunds. Pending or rejected transfers are not counted.`, M, doc.y, { width: W });
  });
}

export function invoicePdf(tenant, inv) {
  const sub = submissionOf(inv);
  const refunded = pdb().prepare('SELECT COALESCE(SUM(amount),0) n FROM refunds WHERE invoice_id=?').get(inv.id).n;
  return pdfBuffer((doc) => {
    const { M, W } = header(doc, inv.status === 'paid' ? 'Payment receipt' : 'Invoice', invoiceNumber(inv));
    const kv = (label, value, x, y, w = 240) => { doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(label, x, y, { width: w }); doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(value || '-', x, doc.y, { width: w }); };
    const y0 = doc.y; kv('Billed to', `${tenant.name}${tenant.owner_email ? `\n${tenant.owner_email}` : ''}`, M, y0); kv('Date', day(inv.created_at), M + 300, y0, 200);
    doc.y = Math.max(doc.y, y0 + 56) + 6; const y1 = doc.y;
    kv('Status', inv.status === 'paid' ? 'PAID' : String(inv.status).toUpperCase(), M, y1); kv('Payment method', methodOf(inv, sub), M + 300, y1, 200);
    doc.y = y1 + 44; const y2 = doc.y; kv('Reference', sub?.reference || inv.provider_invoice_id || '', M, y2); kv('Period covered', inv.period_start ? `${day(inv.period_start)} to ${day(inv.period_end)}` : '-', M + 300, y2, 200);
    doc.y = y2 + 56;
    doc.rect(M, doc.y, W, 22).fill('#f3f4f6'); doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text('Description', M + 8, doc.y - 15).text('Amount', M, doc.y - 11, { width: W - 8, align: 'right' }); doc.y += 12;
    const line = (d, a) => { const y = doc.y; doc.font('Helvetica').fontSize(10).text(d, M + 8, y, { width: W - 140 }); doc.text(a, M, y, { width: W - 8, align: 'right' }); doc.y = Math.max(doc.y, y + 16) + 4; };
    const oneTime = Math.min(inv.amount, inv.one_time_amount || 0);
    line(`${planName(inv.plan) || 'Subscription'}${inv.period_start ? ` (${day(inv.period_start)} to ${day(inv.period_end)})` : ''}`, money(inv.amount - oneTime, inv.currency));
    if (oneTime) line('One-time setup fee', money(oneTime, inv.currency));
    doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(0.6).strokeColor(LINE).stroke(); doc.y += 8;
    doc.font('Helvetica-Bold').fontSize(12).text(`Total ${inv.status === 'paid' ? 'paid' : 'due'}: ${money(inv.amount, inv.currency)}`, M, doc.y, { width: W - 8, align: 'right' });
    if (refunded) doc.font('Helvetica').fontSize(9).fillColor(GREY).text(`Refunded: ${money(refunded, inv.currency)}`, M, doc.y + 2, { width: W - 8, align: 'right' });
    doc.fillColor(INK).moveDown(2).font('Helvetica').fontSize(8.5).fillColor(GREY).text('This is a receipt for payment of your subscription. Amounts are shown as charged; no tax breakdown is included.', M, doc.y, { width: W });
  });
}

export function ownInvoice(tenantId, id) {
  const inv = pdb().prepare('SELECT * FROM invoices WHERE id=? AND tenant_id=?').get(Number(id), tenantId);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  return inv;
}

// ---------------------------------------------------------------- proof of payment
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = {
  png: { ext: '.png', mime: 'image/png', ok: (b) => b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' },
  jpg: { ext: '.jpg', mime: 'image/jpeg', ok: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { ext: '.webp', mime: 'image/webp', ok: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  pdf: { ext: '.pdf', mime: 'application/pdf', ok: (b) => b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-' },
};
const proofDir = (tenantId) => path.join(DATA_DIR, 'billing-proofs', String(Number(tenantId)));
/** The file's real type is read from its first bytes; the name and the type the browser claims are not trusted. */
export function sniffProof(buf) { return Object.values(PROOF_TYPES).find((t) => t.ok(buf)) || null; }

/** Attach (or replace) the proof for one of this workspace's payments that is still waiting for confirmation. */
export function saveProof(tenant, user, submissionId, file) {
  const s = pdb().prepare('SELECT * FROM payment_submissions WHERE id=? AND tenant_id=?').get(Number(submissionId), tenant.id);
  if (!s) throw new HttpError(404, 'Payment not found');
  if (s.status !== 'pending') throw bad('This payment has already been reviewed, so a new file cannot be added');
  if (!file?.buffer?.length) throw bad('Choose a file to upload');
  if (file.buffer.length > PROOF_MAX_BYTES) throw bad('The file is over 5 MB. Choose a smaller photo or PDF.');
  const type = sniffProof(file.buffer);
  if (!type) throw bad('Upload a photo (PNG, JPG, WEBP) or a PDF of your payment receipt');
  const dir = proofDir(tenant.id); fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}${type.ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer, { mode: 0o600 });
  if (s.proof_file) fs.rmSync(path.join(dir, path.basename(s.proof_file)), { force: true });
  const shown = String(file.originalname || `proof${type.ext}`).replace(/[\\/\r\n"<>:*?|]/g, '_').slice(0, 80);
  pdb().prepare('UPDATE payment_submissions SET proof_file=?, proof_name=?, proof_type=?, proof_at=datetime(\'now\') WHERE id=?').run(name, shown, type.mime, s.id);
  logTenantEvent(tenant.id, 'billing:proof-uploaded', { id: s.id, by: user?.email || null });
  return { id: s.id, proof: shown };
}
/** Stream a proof to the owner of the payment or, from the console, to billing staff. `tenantId` null = console (any workspace). */
export function sendProof(res, submissionId, tenantId = null) {
  const s = pdb().prepare(`SELECT * FROM payment_submissions WHERE id=?${tenantId == null ? '' : ' AND tenant_id=?'}`).get(...[Number(submissionId), ...(tenantId == null ? [] : [tenantId])]);
  if (!s || !s.proof_file) throw new HttpError(404, 'No file was uploaded for this payment');
  const file = path.join(proofDir(s.tenant_id), path.basename(s.proof_file));
  if (!fs.existsSync(file)) throw new HttpError(404, 'The file is no longer available');
  res.setHeader('Content-Type', PROOF_TYPES[Object.keys(PROOF_TYPES).find((k) => PROOF_TYPES[k].mime === s.proof_type)]?.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${String(s.proof_name || 'proof').replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"); res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(file).pipe(res);
}
