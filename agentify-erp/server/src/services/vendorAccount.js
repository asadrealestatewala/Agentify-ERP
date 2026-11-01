import bcrypt from 'bcryptjs';
import { assertUserEmailFree } from './uniqueEmail.js';
import crypto from 'node:crypto';
import { all, get, run, val } from '../db.js';
import { bad, now, today as todayPK } from '../util.js';
import { notify } from '../audit.js';

const APPROVED = "('approved','partial','paid')";

/** User ids of the vendor's portal logins (usually one). */
export const vendorUserIds = (vendorId) => all('SELECT id FROM users WHERE vendor_id=? AND active=1', vendorId).map((u) => u.id);
/** In-app (and phone push) notification to a vendor's portal login. */
export function notifyVendor(vendorId, type, title, body, link) {
  const ids = vendorUserIds(vendorId);
  if (ids.length) notify(ids, type, title, body, link);
}

/**
 * What the company owes this vendor, straight from the books (account 2100 by vendor) and cross-checked against the
 * expense vouchers, so the vendor portal can never disagree with accounting.
 */
export function vendorAccount(vendorId, t = todayPK()) {
  const book = get(`SELECT COALESCE(SUM(l.credit),0) billed, COALESCE(SUM(l.debit),0) released FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code='2100' AND l.vendor_id=?`, vendorId);
  const v = get(`SELECT COUNT(*) vouchers, COALESCE(SUM(amount),0) approved, COALESCE(SUM(paid_amount),0) paid, COALESCE(SUM(amount-paid_amount),0) outstanding FROM expense_vouchers WHERE vendor_id=? AND status IN ${APPROVED}`, vendorId);
  const credit = get(`SELECT COUNT(*) n, COALESCE(SUM(amount-paid_amount),0) outstanding, COALESCE(SUM(CASE WHEN COALESCE(due_date,date)<? THEN amount-paid_amount ELSE 0 END),0) overdue
    FROM expense_vouchers WHERE vendor_id=? AND is_credit=1 AND status IN ${APPROVED} AND amount>paid_amount`, t, vendorId);
  const next = get(`SELECT voucher_no, due_date, amount-paid_amount balance FROM expense_vouchers WHERE vendor_id=? AND is_credit=1 AND status IN ${APPROVED} AND amount>paid_amount ORDER BY COALESCE(due_date,date) LIMIT 1`, vendorId);
  const remaining = book.billed - book.released;
  return {
    total_billed: book.billed, total_released: book.released, total_remaining: remaining,
    credit_outstanding: credit.outstanding, credit_overdue: credit.overdue, credit_vouchers: credit.n, next_credit_due: next || null,
    vouchers: v.vouchers,
    books_in_sync: remaining === v.outstanding && book.released === v.paid,
    voucher_outstanding: v.outstanding,
  };
}

/** Ledger of the vendor's payable account for a date range, with opening balance. Debit = payment released, credit = billed. */
export function vendorLedger(vendorId, { from, to } = {}) {
  const opening = from ? val(`SELECT COALESCE(SUM(l.credit-l.debit),0) FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journals j ON j.id=l.journal_id WHERE a.code='2100' AND l.vendor_id=? AND j.date<?`, vendorId, from) : 0;
  const rows = all(`SELECT l.credit, l.debit, j.date, j.journal_no, j.ref_type, j.memo, e.voucher_no, e.description edesc, pr.name project_name
    FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id LEFT JOIN projects pr ON pr.id=l.project_id
    LEFT JOIN expense_vouchers e ON e.id=j.ref_id AND j.ref_type IN ('expense','vendor_payment')
    WHERE a.code='2100' AND l.vendor_id=? ${from ? 'AND j.date>=?' : ''} ${to ? 'AND j.date<=?' : ''} ORDER BY j.date, j.id`, vendorId, ...(from ? [from] : []), ...(to ? [to] : []));
  let bal = opening;
  const entries = rows.map((x) => {
    bal += x.credit - x.debit;
    const description = x.ref_type === 'vendor_payment' ? `Payment released${x.voucher_no ? ` — ${x.voucher_no}` : ''}` : x.voucher_no ? `${x.voucher_no}${x.edesc ? ` — ${x.edesc}` : ''}` : (x.memo || 'Entry');
    return { date: x.date, ref: x.voucher_no || x.journal_no, description, project_name: x.project_name, billed: x.credit, paid: x.debit, debit: x.debit, credit: x.credit, balance: bal };
  });
  return { from: from || null, to: to || null, opening, entries, balance: bal, total_billed: entries.reduce((s, e) => s + e.billed, 0), total_paid: entries.reduce((s, e) => s + e.paid, 0) };
}

/** Table form of the ledger for PDF / Excel / CSV. */
export function vendorLedgerTable(l) {
  const rows = [];
  if (l.from) rows.push({ date: l.from, ref: '', description: 'Opening balance', billed: null, paid: null, balance: l.opening });
  for (const e of l.entries) rows.push({ date: e.date, ref: e.ref, description: e.description, billed: e.billed || null, paid: e.paid || null, balance: e.balance });
  const columns = [{ key: 'date', label: 'Date' }, { key: 'ref', label: 'Voucher / ref' }, { key: 'description', label: 'Description' }, { key: 'billed', label: 'Billed', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance due', type: 'money' }];
  return { columns, rows, totals: { description: 'Closing balance (payable to you)', billed: l.total_billed, paid: l.total_paid, balance: l.balance } };
}

const ROLE = 'Vendor';
/** Create (or reset) a vendor's portal login. Returns the password only when it was generated or given. */
export function createVendorPortalUser(vendorId, password) {
  const v = get('SELECT * FROM vendors WHERE id=?', vendorId);
  if (!v) throw bad('Vendor not found');
  const email = String(v.email || '').trim().toLowerCase();
  if (!email) throw bad('Add the vendor’s e-mail address first — it becomes their login');
  if (password && String(password).length < 8) throw bad('Password must be at least 8 characters');
  const pw = password ? String(password) : `${crypto.randomBytes(4).toString('hex')}-${crypto.randomInt(1000, 9999)}`;
  const hash = bcrypt.hashSync(pw, 10);
  const existing = get('SELECT id FROM users WHERE vendor_id=?', vendorId);
  assertUserEmailFree(email, existing?.id || 0);
  if (existing) {
    run('UPDATE users SET password_hash=?, token_version=token_version+1, active=1, email=? WHERE id=?', hash, email, existing.id);
    return { created: false, login: email, password: pw };
  }
  let role = val('SELECT id FROM roles WHERE name=?', ROLE);
  if (!role) role = Number(run('INSERT INTO roles(name,description,own_scope,portal,is_system) VALUES(?,?,0,1,1)', ROLE, 'Vendor portal only').lastInsertRowid);
  run('INSERT INTO users(name,email,phone,password_hash,role_id,active,vendor_id,created_at) VALUES(?,?,?,?,?,1,?,?)', v.name, email, v.phone || null, hash, role, vendorId, now());
  return { created: true, login: email, password: pw };
}
