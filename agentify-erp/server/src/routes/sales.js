import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, getSetting, run } from '../db.js';
import { can, hasPerm, ownerId, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { receiptPdf } from '../services/voucherPdf.js';
import { receiptQr } from '../services/receiptQr.js';
import { receiptCopiesPdf } from '../services/receiptSheet.js';
import { customerSearchClause, receiptRecord } from '../services/customers.js';
import { sendTable } from './helpers.js';
import { asyncH, bad, forbidden, notFound, int, now, today, moneyText, region } from '../util.js';
import { assertUserEmailFree } from '../services/uniqueEmail.js';
import { createSale, cancelSale, planSchedule, saleSummary, ensurePortalUser } from '../services/sales.js';
import { sendPdf } from '../services/pdf.js';
import { scheduleFor } from '../services/schedule.js';
import { receivePayment, voidReceipt, customerLedger, ledgerTable, PAYMENT_TYPES, PAYMENT_METHODS } from '../services/payments.js';
import { approveCommission, payCommission, cancelCommission } from '../services/commissions.js';

const r = Router();

const SALE_BASE = `SELECT s.*, COALESCE(s.title, p.title) property_title, p.plot_no, p.block, pr.name project_name, c.full_name customer_name, c.phone customer_phone, u.name agent_name
  FROM sales s LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN projects pr ON pr.id=s.project_id JOIN contacts c ON c.id=s.contact_id LEFT JOIN users u ON u.id=s.agent_id`;

function assertSaleAccess(req, s) {
  if (!s) throw notFound('Sale not found');
  const o = ownerId(req);
  if (o && s.agent_id !== o) throw forbidden('This sale is not yours');
}

// ---------------- Sales
r.get('/sales', can('sales', 'view'), asyncH(async (req, res) => {
  const q = req.query, where = ['1=1'], params = [];
  const o = ownerId(req);
  if (o) { where.push('s.agent_id=?'); params.push(o); }
  if (q.q) { where.push('(s.sale_no LIKE ? OR c.full_name LIKE ? OR p.title LIKE ? OR s.title LIKE ? OR p.plot_no LIKE ? OR c.customer_code LIKE ? OR p.registration_no LIKE ?)'); params.push(...Array(7).fill(`%${q.q}%`)); }
  for (const [k, col] of [['project_id', 's.project_id'], ['agent_id', 's.agent_id'], ['status', 's.status'], ['contact_id', 's.contact_id'], ['kind', 's.kind']]) if (q[k]) { where.push(`${col}=?`); params.push(q[k]); }
  if (q.from) { where.push('s.sale_date>=?'); params.push(q.from); }
  if (q.to) { where.push('s.sale_date<=?'); params.push(q.to); }
  const limit = ['csv', 'xlsx', 'pdf'].includes(q.format) ? 100000 : Math.min(int(q.limit, 25), 500), page = Math.max(int(q.page, 1), 1);
  const total = get(`SELECT COUNT(*) n FROM (${SALE_BASE} WHERE ${where.join(' AND ')})`, ...params).n;
  const rows = all(`${SALE_BASE} WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit)
    .map((s) => ({ ...s, outstanding: s.net_price - s.paid_amount }));
  if (['csv', 'xlsx', 'pdf'].includes(q.format)) {
    if (!hasPerm(req.user, 'sales', 'export')) throw forbidden();
    return sendTable(res, q.format, 'sales', [['sale_no', 'Sale'], ['kind', 'Type'], ['sale_date', 'Date'], ['customer_name', 'Customer'], ['property_title', 'Property / contract'], ['project_name', 'Project'],
      ['net_price', 'Net price'], ['paid_amount', 'Paid'], ['outstanding', 'Outstanding'], ['agent_name', 'Agent'], ['status', 'Status']].map(([key, label]) => ({ key, label })), rows);
  }
  res.json({ rows, total, page, limit });
}));

r.post('/sales/preview', can('sales', 'view'), asyncH((req, res) => {
  const b = { ...req.body, sale_price: int(req.body.sale_price), discount: int(req.body.discount) };
  const plan = planSchedule(b);
  res.json({ ...plan, net_price: plan.net });
}));

r.post('/sales', can('sales', 'create'), asyncH((req, res) => {
  if (req.body.collect_booking && !hasPerm(req.user, 'payments', 'create')) throw forbidden('Collecting the booking amount needs permission to record payments');
  const out = createSale(req.body, req);
  res.status(201).json({ ...out, sale: saleSummary(out.id), sales: out.ids.map((i) => saleSummary(i, false)) });
}));

r.get('/sales/:id(\\d+)', can('sales', 'view'), asyncH((req, res) => {
  const s = saleSummary(Number(req.params.id));
  assertSaleAccess(req, s);
  const out = { sale: s, commission: null };
  out.documents = all('SELECT * FROM documents WHERE entity_type=? AND entity_id=? ORDER BY id DESC', 'sale', s.id);
  if (hasPerm(req.user, 'payments', 'view')) {
    out.receipts = all(`SELECT r.*, a.name account_name, rs.amount share, rs.advance share_advance,
      (SELECT COUNT(*) FROM receipt_sales x WHERE x.receipt_id=r.id) parts FROM receipt_sales rs JOIN receipts r ON r.id=rs.receipt_id
      JOIN accounts a ON a.id=r.account_id WHERE rs.sale_id=? ORDER BY r.date, r.id`, s.id);
    out.ledger = customerLedger(s.contact_id, s.id);
    if (s.bundle) out.bundle_ledger = customerLedger(s.contact_id, s.bundle.sales.map((x) => x.id));
    if (s.kind === 'construction') {
      out.costs = all(`SELECT e.id,e.voucher_no,e.date,e.description,e.amount,e.status,a.name account,v.name vendor FROM expense_vouchers e JOIN accounts a ON a.id=e.expense_account_id
        LEFT JOIN vendors v ON v.id=e.vendor_id WHERE e.sale_id=? ORDER BY e.date DESC`, s.id);
      out.cost_total = out.costs.filter((c) => ['approved', 'partial', 'paid'].includes(c.status)).reduce((a, c) => a + c.amount, 0);
    }
  }
  if (s.project_id && s.kind === 'construction') out.schedule = scheduleFor(s.project_id, { scope: s.id }).summary;
  out.commission = get(`SELECT commission_no,amount,status,paid_amount,rate_type,rate_value FROM commissions WHERE sale_id=? AND status<>'cancelled'`, s.id) || null;
  res.json(out);
}));

r.post('/sales/:id(\\d+)/cancel', can('sales', 'delete'), asyncH((req, res) => {
  cancelSale(Number(req.params.id), req.body.reason, req);
  res.json({ ok: true });
}));

// ---------------- Customers
const CUSTOMER_BASE = `SELECT c.id, c.customer_code, c.full_name, c.phone, c.email, c.city, c.customer_since, c.lead_type, c.agent_id, ag.name agent_name,
  (SELECT COUNT(*) FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed') properties,
  (SELECT COALESCE(SUM(net_price),0) FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed') purchase_value,
  (SELECT COALESCE(SUM(paid_amount),0) FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed') paid,
  (SELECT COALESCE(SUM(net_price-paid_amount),0) FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed') outstanding,
  (SELECT COALESCE(SUM(i.amount-i.paid),0) FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.contact_id=c.id AND s.status='confirmed' AND i.status<>'paid' AND i.due_date<?) overdue,
  (SELECT COUNT(*) FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed' AND s.num_installments>0 AND s.paid_amount<s.net_price) installment_plans,
  (SELECT COUNT(*) FROM users u WHERE u.contact_id=c.id) has_portal
  FROM contacts c LEFT JOIN users ag ON ag.id=c.agent_id`;

/**
 * Look a customer up by phone, e-mail, CNIC, customer ID or name and see their file(s): registration no., file no., plot,
 * file status, booking date and what is paid / outstanding — for when a customer asks the finance desk about their record.
 */
r.get('/customers/lookup', can('customers', 'view'), asyncH((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json([]);
  const sc = customerSearchClause(q), where = ['c.is_customer=1', sc.sql], params = [...sc.params];
  const o = ownerId(req); if (o) { where.push('c.agent_id=?'); params.push(o); }
  const people = all(`SELECT c.id, c.customer_code, c.full_name, c.cnic, c.phone, c.email, c.address, c.city, c.customer_since, ag.name agent_name FROM contacts c LEFT JOIN users ag ON ag.id=c.agent_id WHERE ${where.join(' AND ')} ORDER BY c.full_name LIMIT 6`, ...params);
  res.json(people.map((c) => {
    const files = all("SELECT id FROM sales WHERE contact_id=? AND status='confirmed' ORDER BY id", c.id).map((s) => {
      const sum = saleSummary(s.id, false); const rec = receiptRecord(c.id, s.id);
      return { sale_id: sum.id, sale_no: sum.sale_no, kind: sum.kind, title: sum.property_title, registration_no: rec.registration_no, file_no: rec.file_no, file_status: rec.file_status, property_type: sum.kind === 'construction' ? 'House construction' : rec.property_type, plot_size: rec.plot_size, address: rec.address,
        booking_date: rec.booking_date, net_price: sum.net_price, paid: sum.paid_amount, outstanding: sum.outstanding, overdue: sum.overdue_amount };
    });
    return { ...c, agent_name: o ? undefined : c.agent_name, files, totals: { net: files.reduce((a, f) => a + f.net_price, 0), paid: files.reduce((a, f) => a + f.paid, 0), outstanding: files.reduce((a, f) => a + f.outstanding, 0), overdue: files.reduce((a, f) => a + f.overdue, 0) } };
  }));
}));
r.get('/customers', can('customers', 'view'), asyncH(async (req, res) => {
  const q = req.query, where = ['c.is_customer=1'], params = [today()];
  const o = ownerId(req);
  if (o) { where.push('c.agent_id=?'); params.push(o); }
  if (q.q) { const sc = customerSearchClause(q.q); where.push(sc.sql); params.push(...sc.params); }
  if (q.agent_id) { where.push('c.agent_id=?'); params.push(q.agent_id); }
  const seg = q.segment;
  const having = seg === 'active' ? 'outstanding>0' : seg === 'installment' ? 'installment_plans>0' : seg === 'buyers' ? 'properties>0' : '1=1';
  const total = get(`SELECT COUNT(*) n FROM (${CUSTOMER_BASE} WHERE ${where.join(' AND ')}) WHERE ${having}`, ...params).n;
  const limit = Math.min(int(q.limit, 25), 500), page = Math.max(int(q.page, 1), 1);
  const rows = all(`SELECT * FROM (${CUSTOMER_BASE} WHERE ${where.join(' AND ')}) WHERE ${having} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  if (['csv', 'xlsx', 'pdf'].includes(q.format)) {
    if (!hasPerm(req.user, 'customers', 'export')) throw forbidden();
    return sendTable(res, q.format, 'customers', [['full_name', 'Customer'], ['phone', 'Phone'], ['email', 'Email'], ['properties', 'Properties'], ['purchase_value', 'Purchase value'], ['paid', 'Paid'], ['outstanding', 'Outstanding'], ['overdue', 'Overdue']].map(([key, label]) => ({ key, label })), rows);
  }
  res.json({ rows, total, page, limit });
}));

/** Printable customer statement (PDF via browser print). */
r.get('/customers/:id(\\d+)/statement', can('customers', 'view'), asyncH((req, res) => {
  const c = get('SELECT * FROM contacts WHERE id=?', req.params.id);
  if (!c) throw notFound();
  const o = ownerId(req);
  if (o && c.agent_id !== o) throw forbidden();
  if (o) throw forbidden('Statements are available to finance staff');
  const sales = (req.query.sale_id ? [Number(req.query.sale_id)] : all("SELECT id FROM sales WHERE contact_id=? AND status='confirmed'", c.id).map((s) => s.id)).map(saleSummary);
  const entries = sales.map((s) => ({ sale: s, receipts: all("SELECT r.id,r.receipt_no,r.date,r.payment_type,r.method,rs.amount FROM receipt_sales rs JOIN receipts r ON r.id=rs.receipt_id WHERE rs.sale_id=? AND r.status='valid' AND rs.amount<>0 ORDER BY r.date,r.id", s.id) }));
  audit(req, 'Viewed customer statement', 'contact', c.id, c.full_name);
  const ledger = customerLedger(c.id, req.query.sale_id || null, { from: req.query.from, to: req.query.to });
  if (['pdf', 'xlsx', 'csv'].includes(req.query.format)) {
    const t = ledgerTable(ledger);
    if (req.query.format === 'pdf') {
      return sendPdf(res, `statement-${c.full_name}`, { title: 'ACCOUNT STATEMENT', subtitle: `${c.full_name}${c.customer_code ? ' · ' + c.customer_code : ''}${c.cnic ? ' · CNIC ' + c.cnic : ''}\n${req.query.from || 'Beginning'} to ${req.query.to || 'today'}`,
        summary: sales.map((s) => [s.property_title, `Paid ${moneyText(s.paid_amount)} / ${region().money.number(s.net_price)}`]).slice(0, 4), columns: t.columns, rows: t.rows, totals: t.totals });
    }
    return sendTable(res, req.query.format, `statement-${c.full_name}`, t.columns, t.rows);
  }
  res.json({ customer: c, entries, ledger, generated_at: now() });
}));

r.post('/customers/:id(\\d+)/portal-access', can('customers', 'edit'), asyncH((req, res) => {
  const c = get('SELECT * FROM contacts WHERE id=?', req.params.id);
  if (!c) throw notFound();
  const { password } = req.body;
  const u = get('SELECT * FROM users WHERE contact_id=?', c.id);
  if (u) {
    if (!password || String(password).length < 8) throw bad('Password must be at least 8 characters');
    run('UPDATE users SET password_hash=?, token_version=token_version+1, active=1 WHERE id=?', bcrypt.hashSync(String(password), 10), u.id);
    audit(req, 'Reset portal password', 'contact', c.id, c.full_name);
    return res.json({ login: u.email || u.phone });
  }
  assertUserEmailFree(c.email); // "This email already exists" rather than a vague refusal
  const created = ensurePortalUser(c.id);
  if (!created) throw bad('The customer needs a unique email or phone to receive portal access');
  if (password) {
    if (String(password).length < 8) throw bad('Password must be at least 8 characters');
    run('UPDATE users SET password_hash=? WHERE contact_id=?', bcrypt.hashSync(String(password), 10), c.id);
    created.password = undefined;
  }
  audit(req, 'Created portal access', 'contact', c.id, c.full_name);
  res.json(created);
}));

// ---------------- Receipts / Payments
const RC_BASE = `SELECT r.*, c.full_name customer_name, c.customer_code customer_code, COALESCE(p.title, (SELECT GROUP_CONCAT(COALESCE(s2.title, p2.title), ' + ') FROM receipt_sales rs2 JOIN sales s2 ON s2.id=rs2.sale_id LEFT JOIN properties p2 ON p2.id=s2.property_id WHERE rs2.receipt_id=r.id)) property_title, pr.name project_name, a.name account_name, u.name received_by_name, s.sale_no
  FROM receipts r JOIN contacts c ON c.id=r.contact_id LEFT JOIN properties p ON p.id=r.property_id LEFT JOIN projects pr ON pr.id=r.project_id
  JOIN accounts a ON a.id=r.account_id LEFT JOIN users u ON u.id=r.received_by LEFT JOIN sales s ON s.id=r.sale_id`;

r.get('/receipts', can('payments', 'view'), asyncH(async (req, res) => {
  const q = req.query, where = ['1=1'], params = [];
  if (q.q) { where.push('(r.receipt_no LIKE ? OR c.full_name LIKE ? OR r.txn_id LIKE ? OR r.reference_no LIKE ? OR r.cheque_no LIKE ? OR c.customer_code LIKE ?)'); params.push(...Array(6).fill(`%${q.q}%`)); }
  for (const [k, col] of [['project_id', 'r.project_id'], ['contact_id', 'r.contact_id'], ['method', 'r.method'], ['payment_type', 'r.payment_type'], ['status', 'r.status'], ['account_id', 'r.account_id']]) if (q[k]) { where.push(`${col}=?`); params.push(q[k]); }
  if (q.sale_id) { where.push('EXISTS(SELECT 1 FROM receipt_sales x WHERE x.receipt_id=r.id AND x.sale_id=?)'); params.push(q.sale_id); }
  if (q.from) { where.push('r.date>=?'); params.push(q.from); }
  if (q.to) { where.push('r.date<=?'); params.push(q.to); }
  const limit = ['csv', 'xlsx', 'pdf'].includes(q.format) ? 100000 : Math.min(int(q.limit, 25), 500), page = Math.max(int(q.page, 1), 1);
  const total = get(`SELECT COUNT(*) n FROM (${RC_BASE} WHERE ${where.join(' AND ')})`, ...params).n;
  const rows = all(`${RC_BASE} WHERE ${where.join(' AND ')} ORDER BY r.date DESC, r.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  if (['csv', 'xlsx', 'pdf'].includes(q.format)) {
    if (!hasPerm(req.user, 'payments', 'export')) throw forbidden();
    return sendTable(res, q.format, 'receipts', [['receipt_no', 'Receipt'], ['date', 'Date'], ['customer_name', 'Customer'], ['project_name', 'Project'], ['property_title', 'Property'], ['payment_type', 'Type'], ['method', 'Method'], ['amount', 'Amount'], ['status', 'Status']].map(([key, label]) => ({ key, label })), rows);
  }
  const sum = get(`SELECT COALESCE(SUM(CASE WHEN r.payment_type='Refund' THEN -r.amount ELSE r.amount END),0) v FROM (${RC_BASE} WHERE ${where.join(' AND ')} AND r.status='valid') r`, ...params).v;
  res.json({ rows, total, page, limit, net_total: sum });
}));
r.get('/receipts/options', can('payments', 'view'), (req, res) => res.json({ types: PAYMENT_TYPES, methods: PAYMENT_METHODS }));
function loadReceipt(id) {
  const rc = get(`${RC_BASE} WHERE r.id=?`, id);
  if (!rc) throw notFound();
  rc.allocations = all(`SELECT ra.*, i.kind, i.due_date, i.seq FROM receipt_allocations ra JOIN installments i ON i.id=ra.installment_id WHERE ra.receipt_id=? ORDER BY i.due_date`, rc.id);
  rc.agent_name = rc.sale_id ? get('SELECT u.name FROM sales s JOIN users u ON u.id=s.agent_id WHERE s.id=?', rc.sale_id)?.name : get('SELECT u.name FROM receipt_sales rs JOIN sales s ON s.id=rs.sale_id JOIN users u ON u.id=s.agent_id WHERE rs.receipt_id=? LIMIT 1', rc.id)?.name;
  rc.agent_phone = rc.sale_id ? get('SELECT u.phone FROM sales s JOIN users u ON u.id=s.agent_id WHERE s.id=?', rc.sale_id)?.phone : get('SELECT u.phone FROM receipt_sales rs JOIN sales s ON s.id=rs.sale_id JOIN users u ON u.id=s.agent_id WHERE rs.receipt_id=? LIMIT 1', rc.id)?.phone;
  rc.journal = rc.journal_id ? get('SELECT id,journal_no FROM journals WHERE id=?', rc.journal_id) : null;
  rc.parts = all(`SELECT rs.sale_id, rs.amount, rs.advance, s.sale_no, s.kind, COALESCE(s.title, p.title) title FROM receipt_sales rs JOIN sales s ON s.id=rs.sale_id LEFT JOIN properties p ON p.id=s.property_id WHERE rs.receipt_id=? ORDER BY s.id`, rc.id);
  rc.documents = all('SELECT * FROM documents WHERE entity_type=? AND entity_id=?', 'receipt', rc.id);
  rc.record = receiptRecord(rc.contact_id, rc.sale_id || rc.parts.find((x) => x.kind === 'property')?.sale_id || rc.parts[0]?.sale_id);
  return rc;
}
/** Customer + plot/file details for a (customer, sale) — drives the live preview on the new-receipt form. */
r.get('/receipts/record', can('payments', 'view'), asyncH((req, res) => res.json(receiptRecord(Number(req.query.contact_id), req.query.sale_id ? Number(req.query.sale_id) : null))));
r.get('/receipts/:id(\\d+)', can('payments', 'view'), asyncH((req, res) => res.json(loadReceipt(req.params.id))));
/** Receipt voucher as a real PDF (letterhead, logo, split, signatures; VOID watermark when voided). */
r.get('/receipts/:id(\\d+)/pdf', can('payments', 'view'), asyncH(async (req, res) => {
  const rc = loadReceipt(req.params.id);
  const wantQr = req.query.qr !== undefined ? req.query.qr === '1' : getSetting('receipt_qr', '1') !== '0';
  const qr = wantQr && rc.status === 'valid' ? await receiptQr(rc, req) : null; // generated the first time the voucher is saved as a digital copy
  audit(req, 'Downloaded receipt PDF', 'receipt', rc.id, rc.receipt_no);
  receiptCopiesPdf(res, rc, { qr, layout: String(req.query.layout || '') }); // one A4 page: office copy + client copy
}));
/** QR code of a receipt: ledger summary (as of this receipt) + customer-portal link. Created on first use, kept, refreshable. */
r.get('/receipts/:id(\\d+)/qr', can('payments', 'view'), asyncH(async (req, res) => {
  const rc = loadReceipt(req.params.id);
  if (rc.status !== 'valid') throw bad('A voided receipt has no QR code');
  const { png, ...q } = await receiptQr(rc, req);
  res.json(q);
}));
r.get('/receipts/:id(\\d+)/qr.png', can('payments', 'view'), asyncH(async (req, res) => {
  const rc = loadReceipt(req.params.id);
  if (rc.status !== 'valid') throw bad('A voided receipt has no QR code');
  const q = await receiptQr(rc, req);
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' }).send(q.png);
}));
r.post('/receipts/:id(\\d+)/qr/refresh', can('payments', 'edit'), asyncH(async (req, res) => {
  const rc = loadReceipt(req.params.id);
  if (rc.status !== 'valid') throw bad('A voided receipt has no QR code');
  const { png, ...q } = await receiptQr(rc, req, { refresh: true });
  audit(req, 'Refreshed receipt QR', 'receipt', rc.id, rc.receipt_no);
  res.json(q);
}));
r.post('/receipts', can('payments', 'create'), asyncH((req, res) => {
  const id = receivePayment(req.body, req);
  res.status(201).json(get(`${RC_BASE} WHERE r.id=?`, id));
}));
r.post('/receipts/:id(\\d+)/void', can('payments', 'approve'), asyncH((req, res) => {
  voidReceipt(Number(req.params.id), req.body.reason, req);
  res.json({ ok: true });
}));

// ---------------- Installments views
r.get('/installments', can('payments', 'view'), asyncH((req, res) => {
  const q = req.query, where = ["s.status='confirmed'"], params = [];
  const t = today();
  if (q.kind) { where.push('i.kind=?'); params.push(q.kind); }
  if (q.status === 'overdue') { where.push("i.status<>'paid' AND i.due_date<?"); params.push(t); }
  else if (q.status === 'upcoming') { where.push("i.status<>'paid' AND i.due_date>=? AND i.due_date<=?"); params.push(t, q.days ? new Date(Date.now() + Number(q.days) * 86400000 + 5 * 3600000).toISOString().slice(0, 10) : '2999-12-31'); }
  else if (q.status) { where.push('i.status=?'); params.push(q.status); }
  if (q.project_id) { where.push('s.project_id=?'); params.push(q.project_id); }
  if (q.agent_id) { where.push('s.agent_id=?'); params.push(q.agent_id); }
  if (q.contact_id) { where.push('s.contact_id=?'); params.push(q.contact_id); }
  if (q.sale_id) { where.push('s.id=?'); params.push(q.sale_id); }
  if (q.q) { where.push('(c.full_name LIKE ? OR s.sale_no LIKE ? OR p.title LIKE ?)'); params.push(...Array(3).fill(`%${q.q}%`)); }
  const limit = Math.min(int(q.limit, 50), 500), page = Math.max(int(q.page, 1), 1);
  const base = `FROM installments i JOIN sales s ON s.id=i.sale_id JOIN contacts c ON c.id=s.contact_id LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN projects pr ON pr.id=s.project_id WHERE ${where.join(' AND ')}`;
  const total = get(`SELECT COUNT(*) n ${base}`, ...params).n;
  const rows = all(`SELECT i.*, s.sale_no, s.contact_id, c.full_name customer_name, c.phone, COALESCE(s.title, p.title) property_title, s.kind sale_kind, pr.name project_name,
    (i.amount-i.paid) balance, (i.status<>'paid' AND i.due_date<'${t}') overdue, CAST(julianday('${t}')-julianday(i.due_date) AS INTEGER) days_overdue ${base} ORDER BY i.due_date, i.id LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  const sums = get(`SELECT COALESCE(SUM(i.amount-i.paid),0) balance ${base}`, ...params).balance;
  res.json({ rows, total, page, limit, balance_total: sums });
}));

r.get('/receivables', can('payments', 'view'), asyncH((req, res) => {
  const t = today();
  const rows = all(`SELECT s.id sale_id, s.sale_no, c.id contact_id, c.full_name customer_name, c.phone, COALESCE(s.title, p.title) property_title, s.kind sale_kind, pr.name project_name, s.net_price, s.paid_amount,
    (s.net_price-s.paid_amount) outstanding,
    (SELECT COALESCE(SUM(i.amount-i.paid),0) FROM installments i WHERE i.sale_id=s.id AND i.status<>'paid' AND i.due_date<?) overdue,
    (SELECT MIN(i.due_date) FROM installments i WHERE i.sale_id=s.id AND i.status<>'paid') next_due, s.bundle_id
    FROM sales s JOIN contacts c ON c.id=s.contact_id LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN projects pr ON pr.id=s.project_id
    WHERE s.status='confirmed' AND s.net_price>s.paid_amount ORDER BY overdue DESC, outstanding DESC`, t);
  res.json({ rows, total: rows.length, outstanding_total: rows.reduce((a, x) => a + x.outstanding, 0), overdue_total: rows.reduce((a, x) => a + x.overdue, 0) });
}));

// ---------------- Commissions
const CM_BASE = `SELECT cm.*, u.name agent_name, c.full_name customer_name, p.title property_title, pr.name project_name, s.sale_no
  FROM commissions cm JOIN users u ON u.id=cm.agent_id LEFT JOIN contacts c ON c.id=cm.contact_id LEFT JOIN properties p ON p.id=cm.property_id
  LEFT JOIN projects pr ON pr.id=cm.project_id JOIN sales s ON s.id=cm.sale_id`;
r.get('/commissions', can('commissions', 'view'), asyncH((req, res) => {
  const q = req.query, where = ['1=1'], params = [];
  const o = ownerId(req);
  if (o) { where.push('cm.agent_id=?'); params.push(o); }
  for (const [k, col] of [['agent_id', 'cm.agent_id'], ['status', 'cm.status'], ['project_id', 'cm.project_id']]) if (q[k]) { where.push(`${col}=?`); params.push(q[k]); }
  const rows = all(`${CM_BASE} WHERE ${where.join(' AND ')} ORDER BY cm.id DESC LIMIT 500`, ...params).map((c) => ({ ...c, balance: c.amount - c.paid_amount }));
  const live = rows.filter((c) => c.status !== 'cancelled');
  res.json({ rows, totals: { earned: live.reduce((a, c) => a + c.amount, 0), paid: live.reduce((a, c) => a + c.paid_amount, 0),
    pending: live.reduce((a, c) => a + c.amount - c.paid_amount, 0) } });
}));
r.get('/commissions/:id(\\d+)', can('commissions', 'view'), asyncH((req, res) => {
  const c = get(`${CM_BASE} WHERE cm.id=?`, req.params.id);
  if (!c) throw notFound();
  const o = ownerId(req);
  if (o && c.agent_id !== o) throw forbidden();
  c.payments = all('SELECT * FROM commission_payments WHERE commission_id=? ORDER BY date', c.id);
  res.json(c);
}));
r.post('/commissions/:id(\\d+)/approve', can('commissions', 'approve'), asyncH((req, res) => { approveCommission(Number(req.params.id), req); res.json({ ok: true }); }));
r.post('/commissions/:id(\\d+)/pay', can('accounting', 'create'), asyncH((req, res) => { payCommission(Number(req.params.id), req.body, req); res.json({ ok: true }); }));
r.post('/commissions/:id(\\d+)/cancel', can('commissions', 'approve'), asyncH((req, res) => { cancelCommission(Number(req.params.id), req); res.json({ ok: true }); }));

import { crud } from './helpers.js';
import { Router as R2 } from 'express';
const rules = R2();
crud(rules, {
  table: 'commission_rules', module: 'settings', cols: ['name', 'type', 'value', 'tiers', 'project_id', 'property_id', 'property_type', 'sale_kind', 'active'], json: ['tiers'],
  required: ['name', 'type'], label: 'commission rule', orderBy: 'commission_rules.id',
  before: (d) => { for (const k of ['project_id', 'property_id']) if (d[k] === '') d[k] = null; if (d.property_type === '') d.property_type = null; if (d.sale_kind === '') d.sale_kind = null;
    if (d.type && !['percentage', 'fixed', 'tier'].includes(d.type)) throw bad('Invalid commission type'); },
});
r.use('/commission-rules', rules);

export default r;
