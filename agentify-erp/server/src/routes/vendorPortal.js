import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, uploadDir } from '../db.js';
import { requireVendor } from '../rbac.js';
import { audit, notifyPerm } from '../audit.js';
import { asyncH, bad, forbidden, notFound, now, today, jparse, moneyText, curCode } from '../util.js';
import { sendTable, uploader, storedPath, discardUploads } from './helpers.js';
import { sendStored, removeRef } from '../services/storage.js';
import { loadExpense } from './accounting.js';
import { expensePdf } from '../services/voucherPdf.js';
import { vendorAccount, vendorLedger, vendorLedgerTable } from '../services/vendorAccount.js';
import { effectiveStatus, visibleTo, priceBid, intIn, tenderRow } from '../services/tenders.js';

/**
 * Vendor portal: a vendor sees only their own money (straight from the books), registration and bids, plus the
 * contracts the company has announced. The vendor id always comes from the session, never from the request.
 */
const r = Router();
r.use(requireVendor);
const mine = (req) => req.user.vendor_id;
const vendorOf = (req) => get('SELECT * FROM vendors WHERE id=?', mine(req));
const SEEN = "('approved','partial','paid')";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const up = uploader('documents', 'documents', 25, { module: 'documents' });

// ------------------------------------------------------------------ overview & registration
r.get('/dashboard', asyncH((req, res) => {
  const t = today(), v = vendorOf(req);
  const money = vendorAccount(v.id, t);
  const tenders = openTenders(v).filter((x) => x.is_open);
  res.json({
    vendor: { id: v.id, vendor_code: v.vendor_code, name: v.name, company: v.company, category: v.category, active: !!v.active, payment_terms: v.payment_terms },
    money,
    recent_payments: all(`SELECT p.payment_no, p.date, p.amount, p.method, p.reference_no, e.voucher_no FROM vendor_payments p LEFT JOIN expense_vouchers e ON e.id=p.voucher_id WHERE p.vendor_id=? ORDER BY p.date DESC, p.id DESC LIMIT 6`, v.id),
    tenders: { open: tenders.length, not_yet_bid: tenders.filter((x) => !x.my_bid_status).length, closing_soon: tenders.filter((x) => x.days_left <= 3).length },
    bids: all("SELECT status, COUNT(*) n FROM tender_bids WHERE vendor_id=? AND status<>'withdrawn' GROUP BY status", v.id),
  });
}));

r.get('/profile', asyncH((req, res) => {
  const v = vendorOf(req);
  const login = get('SELECT email, last_login FROM users WHERE vendor_id=?', v.id);
  res.json({
    registration: { vendor_code: v.vendor_code, name: v.name, company: v.company, category: v.category, cnic_tax: v.cnic_tax, phone: v.phone, email: v.email, address: v.address,
      payment_terms: v.payment_terms, bank_details: v.bank_details, status: v.active ? 'Active' : 'Inactive', registered_on: v.created_at },
    portal: { login: login?.email, last_login: login?.last_login },
    worked_on: all(`SELECT DISTINCT pr.name FROM expense_vouchers e JOIN projects pr ON pr.id=e.project_id WHERE e.vendor_id=? AND e.status IN ${SEEN} ORDER BY pr.name`, v.id).map((x) => x.name),
    first_voucher: get(`SELECT MIN(date) d FROM expense_vouchers WHERE vendor_id=? AND status IN ${SEEN}`, v.id)?.d || null,
    contracts_won: all(`SELECT t.tender_no, t.title, b.total_amount FROM tender_bids b JOIN tenders t ON t.id=b.tender_id WHERE b.vendor_id=? AND b.status='awarded' ORDER BY t.id DESC`, v.id),
  });
}));

// ------------------------------------------------------------------ money: vouchers, payments, ledger
const VOUCHER = `SELECT e.id, e.voucher_no, e.date, e.description, e.amount, e.paid_amount, (e.amount-e.paid_amount) balance, e.status, e.is_credit, e.due_date, e.payment_method, pr.name project_name
  FROM expense_vouchers e LEFT JOIN projects pr ON pr.id=e.project_id`;
r.get('/vouchers', asyncH((req, res) => {
  const where = [`e.vendor_id=? AND e.status IN ${SEEN}`], params = [mine(req)];
  if (req.query.credit === '1') where.push('e.is_credit=1');
  if (req.query.open === '1') where.push('e.amount>e.paid_amount');
  const t = today();
  const rows = all(`${VOUCHER} WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC LIMIT 500`, ...params).map((x) => ({ ...x, overdue: x.balance > 0 && x.is_credit && (x.due_date || x.date) < t }));
  res.json({ rows, summary: vendorAccount(mine(req), t) });
}));
const ownVoucher = (req) => {
  const e = get(`SELECT * FROM expense_vouchers WHERE id=? AND vendor_id=? AND status IN ${SEEN}`, req.params.id, mine(req));
  if (!e) throw notFound('Voucher not found');
  return e;
};
r.get('/vouchers/:id(\\d+)', asyncH((req, res) => {
  const e = ownVoucher(req);
  const row = get(`${VOUCHER} WHERE e.id=?`, e.id);
  res.json({ ...row, payments: all('SELECT payment_no, date, amount, method, reference_no FROM vendor_payments WHERE voucher_id=? ORDER BY date, id', e.id) });
}));
r.get('/vouchers/:id(\\d+)/pdf', asyncH((req, res) => {
  const e = ownVoucher(req);
  audit(req, 'Vendor portal voucher download', 'expense', e.id, e.voucher_no);
  expensePdf(res, loadExpense(e.id));
}));
r.get('/payments', asyncH((req, res) => {
  const rows = all(`SELECT p.id, p.payment_no, p.date, p.amount, p.method, p.reference_no, e.voucher_no, e.description FROM vendor_payments p LEFT JOIN expense_vouchers e ON e.id=p.voucher_id
    WHERE p.vendor_id=? ORDER BY p.date DESC, p.id DESC LIMIT 500`, mine(req));
  res.json({ rows, total_released: rows.reduce((s, x) => s + x.amount, 0) });
}));

r.get('/ledger', asyncH(async (req, res) => {
  const { from, to, format } = req.query;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw notFound('Invalid date');
  const v = vendorOf(req);
  const ledger = vendorLedger(v.id, { from, to });
  if (!['pdf', 'xlsx', 'csv'].includes(format)) return res.json({ ...ledger, summary: vendorAccount(v.id) });
  const t = vendorLedgerTable(ledger);
  audit(req, 'Vendor portal ledger download', 'vendor', v.id, `${format} ${from || ''}..${to || ''}`);
  return sendTable(res, format, `vendor-ledger-${v.vendor_code || v.id}`, t.columns, t.rows.concat([{ description: t.totals.description, balance: ledger.balance }]), {
    title: 'VENDOR ACCOUNT LEDGER', subtitle: `${v.name}${v.vendor_code ? ` · ${v.vendor_code}` : ''}\n${from || 'Beginning'} to ${to || 'today'}`,
    summary: [['Opening balance', `${moneyText(ledger.opening)}`], ['Total billed', `${moneyText(ledger.total_billed)}`], ['Total paid', `${moneyText(ledger.total_paid)}`], ['Closing balance (payable to you)', `${moneyText(ledger.balance)}`]],
    totals: t.totals,
  });
}));

// ------------------------------------------------------------------ announcements: open contracts and bidding
function openTenders(v) {
  const t = today();
  return all(`SELECT t.*, pr.name project_name FROM tenders t LEFT JOIN projects pr ON pr.id=t.project_id WHERE t.status IN ('open','closed','awarded','cancelled') ORDER BY t.closes_on DESC, t.id DESC LIMIT 300`)
    .filter((x) => visibleTo(x, v) || get('SELECT 1 FROM tender_bids WHERE tender_id=? AND vendor_id=?', x.id, v.id))
    .map((x) => {
      const status = effectiveStatus(x, t);
      const bid = get('SELECT id,status,total_amount,submitted_at FROM tender_bids WHERE tender_id=? AND vendor_id=?', x.id, v.id);
      // a vendor who never bid has no business with closed / cancelled contracts
      return { x, status, bid };
    })
    .filter(({ status, bid }) => status === 'open' || bid)
    .map(({ x, status, bid }) => ({
      id: x.id, tender_no: x.tender_no, title: x.title, category: x.category, project_name: x.project_name, location: x.location, closes_on: x.closes_on,
      days_left: Math.round((new Date(`${x.closes_on}T00:00:00Z`) - new Date(`${t}T00:00:00Z`)) / 86400000), status, is_open: status === 'open',
      boq_lines: jparse(x.boq, []).length, estimated_budget: x.show_budget ? x.estimated_budget : null,
      my_bid_status: bid && bid.status !== 'withdrawn' ? bid.status : (bid ? 'withdrawn' : null), my_bid_total: bid?.total_amount ?? null,
    }));
}
r.get('/tenders', asyncH((req, res) => {
  const rows = openTenders(vendorOf(req));
  res.json({ rows, open: rows.filter((x) => x.is_open).length });
}));

function loadTender(req) {
  const v = vendorOf(req);
  const t = tenderRow(req.params.id);
  const bid = t && get('SELECT * FROM tender_bids WHERE tender_id=? AND vendor_id=?', t.id, v.id);
  if (!t || t.status === 'draft' || (!bid && !visibleTo(t, v))) throw notFound('Contract not found');
  const status = effectiveStatus(t);
  if (!bid && status !== 'open') throw notFound('Contract not found');
  return { v, t, bid, status };
}
const bidView = (b) => b && { ...b, boq_rates: jparse(b.boq_rates, []), files: all("SELECT id,name,category,size,mime,created_at FROM documents WHERE entity_type='bid' AND entity_id=? ORDER BY id", b.id) };

r.get('/tenders/:id(\\d+)', asyncH((req, res) => {
  const { t, bid, status } = loadTender(req);
  const mineView = bidView(bid);
  res.json({
    id: t.id, tender_no: t.tender_no, title: t.title, description: t.description, scope: t.scope, category: t.category, location: t.location, required_docs: t.required_docs,
    project_name: t.project_id ? get('SELECT name FROM projects WHERE id=?', t.project_id)?.name : null, closes_on: t.closes_on, status, is_open: status === 'open',
    boq: jparse(t.boq, []), estimated_budget: t.show_budget ? t.estimated_budget : null,
    files: all("SELECT id,name,category,size,mime,created_at FROM documents WHERE entity_type='tender' AND entity_id=? AND portal_visible=1 ORDER BY id", t.id),
    my_bid: mineView, outcome: t.status === 'awarded' ? (bid?.status === 'awarded' ? 'won' : bid ? 'not_selected' : null) : t.status === 'cancelled' ? 'cancelled' : null,
    award_note: t.status === 'awarded' && bid?.status === 'awarded' ? t.award_note : null,
  });
}));

r.post('/tenders/:id(\\d+)/bid', asyncH((req, res) => {
  const { v, t, bid, status } = loadTender(req);
  if (status !== 'open') throw bad('Bidding on this contract has closed');
  if (!v.active) throw forbidden('Your vendor registration is inactive — contact the company');
  if (bid && !['submitted', 'withdrawn'].includes(bid.status)) throw bad(`Your bid is ${bid.status} and can no longer be changed`);
  const body = req.body || {};
  const { rates, total } = priceBid(jparse(t.boq, []), body);
  const dur = intIn(body.duration_days, 1, 3650, 'Duration (days)'), valid = intIn(body.validity_days, 1, 365, 'Bid validity (days)') ?? 30;
  const text = (k, max) => (body[k] === undefined || body[k] === null || String(body[k]).trim() === '' ? null : String(body[k]).trim().slice(0, max));
  const proposal = text('proposal', 20000), terms = text('payment_terms', 500), notes = text('notes', 2000);
  let id;
  if (bid) {
    run("UPDATE tender_bids SET total_amount=?, duration_days=?, validity_days=?, boq_rates=?, proposal=?, payment_terms=?, notes=?, status='submitted', updated_at=? WHERE id=?",
      total, dur, valid, JSON.stringify(rates), proposal, terms, notes, now(), bid.id);
    id = bid.id;
  } else {
    id = Number(run('INSERT INTO tender_bids(tender_id,vendor_id,total_amount,duration_days,validity_days,boq_rates,proposal,payment_terms,notes,status,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      t.id, v.id, total, dur, valid, JSON.stringify(rates), proposal, terms, notes, 'submitted', now()).lastInsertRowid);
  }
  notifyStaff(t, v, total, !!bid);
  audit(req, bid ? 'Updated bid' : 'Submitted bid', 'tender', t.id, `${v.name} ${curCode()} ${total}`);
  res.status(bid ? 200 : 201).json({ id, total_amount: total });
}));
function notifyStaff(t, v, total, updated) {
  notifyPerm('vendors', 'approve', 'tender', updated ? 'Bid updated' : 'New bid received', `${v.name} bid ${moneyText(total)} on ${t.tender_no} — ${t.title}`, `/vendors/tenders/${t.id}`);
}

r.delete('/tenders/:id(\\d+)/bid', asyncH((req, res) => {
  const { t, bid, status } = loadTender(req);
  if (!bid || bid.status !== 'submitted') throw bad('You have no active bid on this contract');
  if (status !== 'open') throw bad('Bidding has closed — a bid can no longer be withdrawn');
  run("UPDATE tender_bids SET status='withdrawn', updated_at=? WHERE id=?", now(), bid.id);
  audit(req, 'Withdrew bid', 'tender', t.id, `bid ${bid.id}`);
  res.json({ ok: true });
}));

r.get('/bids', asyncH((req, res) => {
  const rows = all(`SELECT b.id, b.status, b.total_amount, b.duration_days, b.submitted_at, t.id tender_id, t.tender_no, t.title, t.closes_on, t.status tender_status
    FROM tender_bids b JOIN tenders t ON t.id=b.tender_id WHERE b.vendor_id=? ORDER BY b.id DESC`, mine(req));
  res.json({ rows: rows.map((x) => ({ ...x, tender_status: effectiveStatus({ status: x.tender_status, closes_on: x.closes_on }) })) });
}));

// ------------------------------------------------------------------ files (bid attachments, tender documents)
r.post('/bids/:id(\\d+)/files', up.array('files', 5), asyncH((req, res) => {
  const cleanup = () => discardUploads(req);
  try {
    const b = get('SELECT b.*, t.status tstatus, t.closes_on FROM tender_bids b JOIN tenders t ON t.id=b.tender_id WHERE b.id=? AND b.vendor_id=?', req.params.id, mine(req));
    if (!b) throw notFound('Bid not found');
    if (effectiveStatus({ status: b.tstatus, closes_on: b.closes_on }) !== 'open' || b.status !== 'submitted') throw bad('Files can only be added to an active bid while the contract is open');
    const category = ['BOQ', 'Proposal', 'Other'].includes(req.body.category) ? req.body.category : 'Other';
    if (all("SELECT 1 FROM documents WHERE entity_type='bid' AND entity_id=?", b.id).length + (req.files || []).length > 12) throw bad('A bid can have at most 12 files');
    const ids = (req.files || []).map((f) => Number(run(`INSERT INTO documents(entity_type,entity_id,category,name,path,mime,size,portal_visible,uploaded_by,created_at) VALUES('bid',?,?,?,?,?,?,1,?,?)`,
      b.id, category, f.originalname.slice(0, 200), storedPath(f, 'documents'), f.mimetype, f.size, req.user.id, now()).lastInsertRowid));
    audit(req, 'Vendor uploaded bid file', 'tender', b.tender_id, `${ids.length} ${category} file(s)`);
    res.status(201).json({ ids });
  } catch (e) { cleanup(); throw e; }
}));

function ownDoc(req, id) {
  const d = get('SELECT * FROM documents WHERE id=?', id);
  if (!d) throw notFound('File not found');
  if (d.entity_type === 'bid') {
    const b = get('SELECT * FROM tender_bids WHERE id=? AND vendor_id=?', d.entity_id, mine(req));
    if (!b) throw notFound('File not found');
  } else if (d.entity_type === 'tender') {
    const t = tenderRow(d.entity_id), v = vendorOf(req);
    if (!d.portal_visible || !t || t.status === 'draft' || !(visibleTo(t, v) || get('SELECT 1 FROM tender_bids WHERE tender_id=? AND vendor_id=?', t.id, v.id))) throw notFound('File not found');
  } else throw notFound('File not found');
  return d;
}
r.get('/files/:id(\\d+)', asyncH(async (req, res) => {
  const d = ownDoc(req, req.params.id);
  await sendStored(req, res, d.path, { mime: d.mime, name: d.name, download: !!req.query.download });
}));
r.delete('/files/:id(\\d+)', asyncH((req, res) => {
  const d = ownDoc(req, req.params.id);
  if (d.entity_type !== 'bid') throw forbidden('Only your own bid files can be removed');
  const b = get('SELECT b.status, t.status tstatus, t.closes_on FROM tender_bids b JOIN tenders t ON t.id=b.tender_id WHERE b.id=?', d.entity_id);
  if (b.status !== 'submitted' || effectiveStatus({ status: b.tstatus, closes_on: b.closes_on }) !== 'open') throw bad('Files can no longer be removed from this bid');
  run('DELETE FROM documents WHERE id=?', d.id);
  removeRef(d.path).catch(() => {});
  res.json({ ok: true });
}));

export default r;
