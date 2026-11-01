import { Router } from 'express';
import { assertRecordEmailFree } from '../services/uniqueEmail.js';
import { all, get, run, tx, insert, update, nextNo } from '../db.js';
import { can, hasPerm, requireStaff } from '../rbac.js';
import { createVendorPortalUser } from '../services/vendorAccount.js';
import { audit } from '../audit.js';
import { sendTable, crud } from './helpers.js';
import { asyncH, bad, notFound, int, today, now, dateRange, moneyText, curCode } from '../util.js';
import { postJournal, reverseJournal, accountBalance, trialBalance, treasuryAccounts, assertTreasury, assertFunds, postOpening, isDebitNature } from '../services/accounting.js';
import { sendPdf } from '../services/pdf.js';
import { expensePdf } from '../services/voucherPdf.js';
import { createVoucher, submitVoucher, approveVoucher, rejectVoucher, payVoucher, payVendor, cleanAssetInfo } from '../services/expenses.js';
import { projectFinancials } from '../services/projectFinance.js';

const r = Router();
r.use(requireStaff);

// ---------------- Chart of accounts
r.get('/accounts', can('accounting', 'view'), asyncH((req, res) => {
  const tb = trialBalance({ to: req.query.to });
  res.json(tb);
}));
r.post('/accounts', can('accounting', 'create'), asyncH((req, res) => {
  const { code, name, type, subtype, parent_id, opening_balance } = req.body;
  if (!code || !name || !type) throw bad('Code, name and type are required');
  if (!['asset', 'liability', 'income', 'expense', 'equity'].includes(type)) throw bad('Invalid account type');
  if (get('SELECT 1 FROM accounts WHERE code=?', code)) throw bad('Account code already exists');
  if (parent_id) { const p = get('SELECT type FROM accounts WHERE id=?', parent_id); if (!p) throw bad('Parent not found'); if (p.type !== type) throw bad('Child account must have the same type as its parent'); }
  const id = tx(() => {
    const aid = insert('accounts', { code, name, type, subtype: subtype || null, parent_id: parent_id || null }, ['code', 'name', 'type', 'subtype', 'parent_id']);
    if (int(opening_balance) > 0) postOpening(aid, int(opening_balance), req.user.id);
    return aid;
  });
  audit(req, 'Created account', 'account', id, `${code} ${name}`);
  res.status(201).json({ id });
}));
r.put('/accounts/:id(\\d+)', can('accounting', 'edit'), asyncH((req, res) => {
  const a = get('SELECT * FROM accounts WHERE id=?', req.params.id);
  if (!a) throw notFound();
  const d = { name: req.body.name, active: req.body.active === undefined ? undefined : req.body.active ? 1 : 0 };
  if (a.is_system && d.active === 0) throw bad('System accounts cannot be deactivated');
  update('accounts', a.id, d, ['name', 'active']);
  audit(req, 'Edited account', 'account', a.id, a.code);
  res.json({ ok: true });
}));
r.delete('/accounts/:id(\\d+)', can('accounting', 'delete'), asyncH((req, res) => {
  const a = get('SELECT * FROM accounts WHERE id=?', req.params.id);
  if (!a) throw notFound();
  if (a.is_system) throw bad('System accounts cannot be deleted');
  if (get('SELECT 1 FROM journal_lines WHERE account_id=?', a.id)) throw bad('Account has transactions — deactivate it instead');
  if (get('SELECT 1 FROM accounts WHERE parent_id=?', a.id)) throw bad('Account has child accounts');
  run('DELETE FROM accounts WHERE id=?', a.id);
  audit(req, 'Deleted account', 'account', a.id, a.code);
  res.json({ ok: true });
}));

// ---------------- Journals & ledger
r.get('/journals', can('accounting', 'view'), asyncH((req, res) => {
  const q = req.query, where = ['1=1'], params = [];
  if (q.from) { where.push('j.date>=?'); params.push(q.from); }
  if (q.to) { where.push('j.date<=?'); params.push(q.to); }
  if (q.project_id) { where.push('j.project_id=?'); params.push(q.project_id); }
  if (q.ref_type) { where.push('j.ref_type=?'); params.push(q.ref_type); }
  if (q.account_id) { where.push('EXISTS(SELECT 1 FROM journal_lines l WHERE l.journal_id=j.id AND l.account_id=?)'); params.push(q.account_id); }
  if (q.q) { where.push('(j.journal_no LIKE ? OR j.memo LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  const limit = Math.min(int(q.limit, 25), 500), page = Math.max(int(q.page, 1), 1);
  const total = get(`SELECT COUNT(*) n FROM journals j WHERE ${where.join(' AND ')}`, ...params).n;
  const rows = all(`SELECT j.*, (SELECT SUM(debit) FROM journal_lines WHERE journal_id=j.id) amount, pr.name project_name, u.name user_name
    FROM journals j LEFT JOIN projects pr ON pr.id=j.project_id LEFT JOIN users u ON u.id=j.created_by WHERE ${where.join(' AND ')} ORDER BY j.date DESC, j.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  res.json({ rows, total, page, limit });
}));
r.get('/journals/:id(\\d+)', can('accounting', 'view'), asyncH((req, res) => {
  const j = get('SELECT * FROM journals WHERE id=?', req.params.id);
  if (!j) throw notFound();
  j.lines = all(`SELECT l.*, a.code, a.name account_name, c.full_name contact_name, v.name vendor_name FROM journal_lines l JOIN accounts a ON a.id=l.account_id
    LEFT JOIN contacts c ON c.id=l.contact_id LEFT JOIN vendors v ON v.id=l.vendor_id WHERE l.journal_id=? ORDER BY l.id`, j.id);
  res.json(j);
}));
/** Manual journal — restricted to approvers; flagged 'manual' in the audit log. */
r.post('/journals', can('accounting', 'approve'), asyncH((req, res) => {
  const { date, memo, lines, project_id } = req.body;
  if (!memo) throw bad('A memo is required for manual journals');
  const id = postJournal({ date: date || today(), memo, refType: 'manual', projectId: project_id, userId: req.user.id,
    lines: (lines || []).map((l) => ({ account: Number(l.account_id), debit: int(l.debit), credit: int(l.credit), memo: l.memo })) });
  audit(req, 'Manual journal', 'journal', id, memo);
  res.status(201).json({ id });
}));
r.post('/journals/:id(\\d+)/reverse', can('accounting', 'approve'), asyncH((req, res) => {
  const j = get('SELECT * FROM journals WHERE id=?', req.params.id);
  if (!j) throw notFound();
  if (j.ref_type && j.ref_type !== 'manual') throw bad('System-generated journals are reversed by voiding the originating document');
  const id = reverseJournal(j.id, req.body.memo, req.user.id);
  audit(req, 'Reversed journal', 'journal', id, j.journal_no);
  res.json({ id });
}));

/** General ledger / account statement with running balance. */
r.get('/ledger/:id(\\d+)', can('accounting', 'view'), asyncH(async (req, res) => {
  const a = get('SELECT * FROM accounts WHERE id=?', req.params.id);
  if (!a) throw notFound();
  const { from, to } = dateRange(req.query.range, req.query.from, req.query.to);
  const opening = from > '1900-01-01' ? accountBalance(a.id, { to: addDay(from, -1) }) : 0;
  const rows = all(`SELECT l.*, j.date, j.journal_no, j.memo jmemo, j.ref_type, j.ref_id, c.full_name contact_name, v.name vendor_name, pr.name project_name
    FROM journal_lines l JOIN journals j ON j.id=l.journal_id LEFT JOIN contacts c ON c.id=l.contact_id LEFT JOIN vendors v ON v.id=l.vendor_id
    LEFT JOIN projects pr ON pr.id=l.project_id WHERE l.account_id=? AND j.date>=? AND j.date<=? ORDER BY j.date, j.id, l.id`, a.id, from, to);
  let bal = opening;
  for (const x of rows) { bal += isDebitNature(a.type) ? x.debit - x.credit : x.credit - x.debit; x.balance = bal; }
  if (['csv', 'xlsx', 'pdf'].includes(req.query.format)) {
    return sendTable(res, req.query.format, `ledger-${a.code}`, [['date', 'Date'], ['journal_no', 'Journal'], ['jmemo', 'Description'], ['debit', 'Debit'], ['credit', 'Credit'], ['balance', 'Balance']].map(([key, label]) => ({ key, label })), rows);
  }
  res.json({ account: a, opening, rows, closing: bal, from, to });
}));
function addDay(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

r.get('/trial-balance', can('accounting', 'view'), asyncH((req, res) => {
  const { from, to } = dateRange(req.query.range, req.query.from, req.query.to);
  const rows = trialBalance({ from: req.query.range ? from : undefined, to, projectId: req.query.project_id }).filter((a) => a.debit || a.credit);
  res.json({ rows, total_debit: rows.reduce((s, x) => s + x.debit, 0), total_credit: rows.reduce((s, x) => s + x.credit, 0) });
}));

/** Income statement from journals. */
export function incomeStatement({ from, to, projectId }) {
  const rows = trialBalance({ from, to, projectId }).filter((a) => ['income', 'expense'].includes(a.type) && (a.debit || a.credit));
  const income = rows.filter((a) => a.type === 'income'), expense = rows.filter((a) => a.type === 'expense');
  const ti = income.reduce((s, a) => s + a.balance, 0), te = expense.reduce((s, a) => s + a.balance, 0);
  return { income, expense, total_income: ti, total_expense: te, net: ti - te };
}
r.get('/income-statement', can('accounting', 'view'), asyncH((req, res) => {
  const { from, to } = dateRange(req.query.range, req.query.from, req.query.to);
  res.json({ from, to, ...incomeStatement({ from, to, projectId: req.query.project_id }) });
}));
r.get('/balance-sheet', can('accounting', 'view'), asyncH(async (req, res) => {
  const asOf = req.query.to || today();
  const rows = trialBalance({ to: asOf });
  const sum = (t) => rows.filter((a) => a.type === t).reduce((s, a) => s + a.balance, 0);
  const profit = sum('income') - sum('expense');
  const out = { as_of: asOf, assets: rows.filter((a) => a.type === 'asset' && a.balance), liabilities: rows.filter((a) => a.type === 'liability' && a.balance),
    equity: rows.filter((a) => a.type === 'equity' && a.balance), total_assets: sum('asset'), total_liabilities: sum('liability'), total_equity: sum('equity'), current_profit: profit };
  out.balanced = out.total_assets === out.total_liabilities + out.total_equity + profit;
  if (['pdf', 'xlsx', 'csv'].includes(req.query.format)) {
    if (!hasPerm(req.user, 'accounting', 'export')) throw bad('You do not have permission to export');
    const cols = [{ key: 'account', label: 'Account' }, { key: 'balance', label: 'Balance', type: 'money' }];
    const mk = (title, list, total, extra = []) => ({ heading: title, columns: cols, rows: [...list.map((a) => ({ account: `${a.code} ${a.name}`, balance: a.balance })), ...extra], totals: { account: `Total ${title.toLowerCase()}`, balance: total } });
    const sections = [mk('Assets', out.assets, out.total_assets), mk('Liabilities', out.liabilities, out.total_liabilities),
      mk('Equity', out.equity, out.total_equity + profit, [{ account: 'Current profit / (loss)', balance: profit }])];
    if (req.query.format === 'pdf') return sendPdf(res, 'balance-sheet', { title: 'BALANCE SHEET', subtitle: `As of ${asOf}`, summary: [['Total assets', `${moneyText(out.total_assets)}`], ['Liabilities', `${moneyText(out.total_liabilities)}`], ['Equity + profit', `${moneyText((out.total_equity + profit))}`], ['Books balance', out.balanced ? 'Yes' : 'NO']], sections });
    return sendTable(res, req.query.format, 'balance-sheet', [{ key: 'section', label: 'Section' }, ...cols], sections.flatMap((x) => x.rows.map((r) => ({ section: x.heading, ...r }))));
  }
  res.json(out);
}));

// ---------------- Treasury: cash / till / banks
r.get('/treasury', can('accounting', 'view'), asyncH((req, res) => {
  const { from, to } = dateRange(req.query.range || 'this_month', req.query.from, req.query.to);
  const rows = treasuryAccounts().map((a) => {
    const opening = from > '1900-01-01' ? accountBalance(a.id, { to: addDay(from, -1) }) : 0;
    const mv = get(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c,
      COALESCE(SUM(CASE WHEN j.ref_type='receipt' THEN l.debit-l.credit ELSE 0 END),0) receipts,
      COALESCE(SUM(CASE WHEN j.ref_type IN ('vendor_payment','commission_payment','payroll') THEN l.credit-l.debit ELSE 0 END),0) expenses,
      COALESCE(SUM(CASE WHEN j.ref_type='transfer' THEN l.debit-l.credit ELSE 0 END),0) transfers
      FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND j.date>=? AND j.date<=?`, a.id, from, to);
    const last = get('SELECT * FROM reconciliations WHERE account_id=? ORDER BY id DESC LIMIT 1', a.id);
    return { ...a, opening, receipts: mv.receipts, expenses: mv.expenses, transfers: mv.transfers, closing: accountBalance(a.id, { to }), balance: accountBalance(a.id), last_reconciliation: last || null };
  });
  res.json({ from, to, accounts: rows, total: rows.reduce((s, a) => s + a.balance, 0) });
}));
r.post('/transfers', can('accounting', 'create'), asyncH((req, res) => {
  const { from_account_id, to_account_id, amount, date, memo } = req.body;
  const amt = int(amount);
  if (amt <= 0) throw bad('Amount must be greater than zero');
  if (Number(from_account_id) === Number(to_account_id)) throw bad('Source and destination must differ');
  const from = assertTreasury(from_account_id), to = assertTreasury(to_account_id);
  const id = tx(() => {
    assertFunds(from.id, amt);
    return postJournal({ date: date || today(), memo: memo || `Transfer ${from.name} → ${to.name}`, refType: 'transfer', userId: req.user.id,
      lines: [{ account: to.id, debit: amt }, { account: from.id, credit: amt }] });
  });
  audit(req, 'Treasury transfer', 'journal', id, `${from.name} → ${to.name} ${curCode()} ${amt}`);
  res.status(201).json({ id });
}));
r.post('/reconciliations', can('accounting', 'approve'), asyncH((req, res) => {
  const { account_id, date, statement_balance, notes } = req.body;
  const a = assertTreasury(account_id);
  const book = accountBalance(a.id, { to: date || today() });
  const stmt = int(statement_balance);
  const id = Number(run('INSERT INTO reconciliations(account_id,date,statement_balance,book_balance,difference,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
    a.id, date || today(), stmt, book, stmt - book, notes ?? null, req.user.id, now()).lastInsertRowid);
  audit(req, 'Reconciled account', 'account', a.id, `${a.name}: statement ${stmt}, book ${book}, diff ${stmt - book}`);
  res.status(201).json({ id, book_balance: book, difference: stmt - book });
}));
r.get('/reconciliations', can('accounting', 'view'), (req, res) => {
  res.json(all(`SELECT r.*, a.name account_name FROM reconciliations r JOIN accounts a ON a.id=r.account_id ORDER BY r.id DESC LIMIT 100`));
});

r.get('/project-accounts/:id(\\d+)', can('accounting', 'view'), asyncH((req, res) => {
  res.json(projectFinancials(Number(req.params.id)));
}));

// ---------------- Vendors
const vend = Router();
const VBASE = `SELECT vendors.*,
  (SELECT COALESCE(SUM(credit-debit),0) FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code='2100' AND l.vendor_id=vendors.id) balance
  FROM vendors`;
crud(vend, {
  table: 'vendors', module: 'vendors', cols: ['vendor_code', 'name', 'company', 'phone', 'email', 'address', 'cnic_tax', 'category', 'bank_details', 'payment_terms', 'notes', 'active', 'created_at'],
  before: (data, _r, existing) => { if (data.email !== undefined && data.email !== null) { data.email = String(data.email).trim() || null; assertRecordEmailFree('vendors', data.email, existing); } if (!existing && !data.vendor_code) data.vendor_code = nextNo('VND', 'VND', 4); if (existing) delete data.vendor_code; },
  search: ['vendors.name', 'vendors.company', 'vendors.phone', 'vendors.vendor_code'], filters: ['category'], required: ['name'], select: VBASE, orderBy: 'vendors.name', label: 'vendor',
  canDelete: (v) => { if (get('SELECT 1 FROM expense_vouchers WHERE vendor_id=?', v.id)) throw bad('Vendor has transactions — mark inactive instead'); },
});
r.use('/vendors', vend);

r.get('/vendors-ledger/:id(\\d+)', can('vendors', 'view'), asyncH((req, res) => {
  const v = get('SELECT * FROM vendors WHERE id=?', req.params.id);
  if (!v) throw notFound();
  const rows = all(`SELECT l.*, j.date, j.journal_no, j.ref_type, j.ref_id, j.memo, pr.name project_name FROM journal_lines l JOIN journals j ON j.id=l.journal_id
    JOIN accounts a ON a.id=l.account_id LEFT JOIN projects pr ON pr.id=l.project_id WHERE a.code='2100' AND l.vendor_id=? ORDER BY j.date, j.id`, v.id);
  let bal = 0;
  const entries = rows.map((x) => {
    bal += x.credit - x.debit;
    return { date: x.date, journal_no: x.journal_no, description: x.memo, project_name: x.project_name, ref_type: x.ref_type, ref_id: x.ref_id,
      purchase: x.credit, payment: x.debit, debit: x.debit, credit: x.credit, balance: bal };
  });
  res.json({ vendor: v, entries, balance: bal });
}));

/** Staff create (or reset) the vendor's portal login. The password is shown once. */
r.post('/vendors/:id(\\d+)/portal-access', can('vendors', 'edit'), asyncH((req, res) => {
  const out = createVendorPortalUser(Number(req.params.id), req.body?.password);
  audit(req, out.created ? 'Created vendor portal access' : 'Reset vendor portal password', 'vendor', Number(req.params.id), out.login);
  res.json(out);
}));
r.get('/vendors/:id(\\d+)/portal', can('vendors', 'view'), asyncH((req, res) => {
  const u = get('SELECT id,email,active,last_login FROM users WHERE vendor_id=?', req.params.id);
  res.json(u ? { has_portal: true, login: u.email, active: !!u.active, last_login: u.last_login } : { has_portal: false });
}));
r.get('/credit-book', can('vendors', 'view'), asyncH((req, res) => {
  const t = today();
  const rows = all(`SELECT e.id, e.voucher_no, e.date, e.due_date, e.amount, e.paid_amount, (e.amount-e.paid_amount) outstanding, e.status, v.id vendor_id, v.name vendor_name, pr.name project_name, e.description,
    CAST(julianday(?)-julianday(COALESCE(e.due_date,e.date)) AS INTEGER) days_past
    FROM expense_vouchers e JOIN vendors v ON v.id=e.vendor_id LEFT JOIN projects pr ON pr.id=e.project_id
    WHERE e.is_credit=1 AND e.status IN ('approved','partial','paid') ${req.query.all ? '' : 'AND e.amount>e.paid_amount'} ORDER BY COALESCE(e.due_date,e.date)`, t)
    .map((x) => ({ ...x, bucket: x.outstanding <= 0 ? 'Settled' : x.days_past <= 0 ? 'Current' : x.days_past <= 30 ? '1-30' : x.days_past <= 60 ? '31-60' : x.days_past <= 90 ? '61-90' : '90+' }));
  const aging = {};
  for (const x of rows) aging[x.bucket] = (aging[x.bucket] || 0) + x.outstanding;
  res.json({ rows, aging, total_outstanding: rows.reduce((s, x) => s + x.outstanding, 0) });
}));
r.post('/vendors/:id(\\d+)/pay', can('accounting', 'create'), asyncH((req, res) => {
  payVendor(Number(req.params.id), req.body, req);
  res.json({ ok: true });
}));

// ---------------- Expense vouchers
const EV = `SELECT e.*, pr.name project_name, v.name vendor_name, v.vendor_code vendor_code, v.phone vendor_phone, v.email vendor_email, a.name expense_account_name, a.code expense_account_code, pa.name paid_from_name,
  cu.name created_by_name, ap.name approved_by_name, sl.sale_no contract_no, sl.title contract_title, sc.full_name contract_customer FROM expense_vouchers e LEFT JOIN projects pr ON pr.id=e.project_id LEFT JOIN vendors v ON v.id=e.vendor_id
  JOIN accounts a ON a.id=e.expense_account_id LEFT JOIN accounts pa ON pa.id=e.paid_from_account_id LEFT JOIN users cu ON cu.id=e.created_by LEFT JOIN users ap ON ap.id=e.approved_by LEFT JOIN sales sl ON sl.id=e.sale_id LEFT JOIN contacts sc ON sc.id=sl.contact_id`;
r.get('/expenses', can('accounting', 'view'), asyncH(async (req, res) => {
  const q = req.query, where = ['1=1'], params = [];
  if (q.q) { where.push('(e.voucher_no LIKE ? OR e.description LIKE ? OR v.name LIKE ?)'); params.push(...Array(3).fill(`%${q.q}%`)); }
  for (const [k, col] of [['project_id', 'e.project_id'], ['sale_id', 'e.sale_id'], ['vendor_id', 'e.vendor_id'], ['status', 'e.status'], ['expense_account_id', 'e.expense_account_id']]) if (q[k]) { where.push(`${col}=?`); params.push(q[k]); }
  if (q.from) { where.push('e.date>=?'); params.push(q.from); }
  if (q.to) { where.push('e.date<=?'); params.push(q.to); }
  if (q.credit === '1') where.push('e.is_credit=1');
  const limit = ['csv', 'xlsx', 'pdf'].includes(q.format) ? 100000 : Math.min(int(q.limit, 25), 500), page = Math.max(int(q.page, 1), 1);
  const total = get(`SELECT COUNT(*) n FROM (${EV} WHERE ${where.join(' AND ')})`, ...params).n;
  const rows = all(`${EV} WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  if (['csv', 'xlsx', 'pdf'].includes(q.format)) {
    if (!hasPerm(req.user, 'accounting', 'export')) throw bad('You do not have permission to export');
    return sendTable(res, q.format, 'expense-vouchers', [['voucher_no', 'Voucher'], ['date', 'Date'], ['project_name', 'Project'], ['vendor_name', 'Vendor'], ['expense_account_name', 'Expense'], ['description', 'Description'], ['amount', 'Amount'], ['paid_amount', 'Paid'], ['status', 'Status']].map(([key, label]) => ({ key, label })), rows);
  }
  res.json({ rows, total, page, limit });
}));
export function loadExpense(id) {
  const e = get(`${EV} WHERE e.id=?`, id);
  if (!e) throw notFound();
  e.payments = all('SELECT vp.*, a.name account_name FROM vendor_payments vp JOIN accounts a ON a.id=vp.account_id WHERE voucher_id=? ORDER BY date', e.id);
  e.documents = all('SELECT * FROM documents WHERE entity_type=? AND entity_id=?', 'expense', e.id);
  e.journal = e.journal_id ? get('SELECT id,journal_no FROM journals WHERE id=?', e.journal_id) : null;
  e.assets = all('SELECT id,asset_no,name,cost,status,category,brand_model,serial_no FROM assets WHERE voucher_id=? ORDER BY id', e.id);
  try { e.asset_info = e.asset_info ? JSON.parse(e.asset_info) : null; } catch { e.asset_info = null; }
  return e;
}
r.get('/expenses/:id(\\d+)', can('accounting', 'view'), asyncH((req, res) => res.json(loadExpense(req.params.id))));
/** Expense voucher as a real PDF (letterhead, logo, payments, signatures). */
r.get('/expenses/:id(\\d+)/pdf', can('accounting', 'view'), asyncH((req, res) => {
  const e = loadExpense(req.params.id);
  audit(req, 'Downloaded expense voucher PDF', 'expense', e.id, e.voucher_no);
  expensePdf(res, e);
}));
r.post('/expenses', can('accounting', 'create'), asyncH((req, res) => {
  if (req.body.pay_now && !hasPerm(req.user, 'accounting', 'approve')) throw bad('Approving and paying in one step needs approval permission');
  // all-or-nothing: if the payment is refused (e.g. insufficient funds) no voucher is left behind
  const id = tx(() => {
    const vid = createVoucher(req.body, req);
    if (req.body.pay_now) {
      submitVoucher(vid, req); approveVoucher(vid, req);
      payVoucher(vid, { account_id: req.body.paid_from_account_id, method: req.body.payment_method, reference_no: req.body.reference_no, date: req.body.date }, req);
    } else if (req.body.submit) submitVoucher(vid, req);
    return vid;
  });
  res.status(201).json({ id });
}));
r.put('/expenses/:id(\\d+)', can('accounting', 'edit'), asyncH((req, res) => {
  const e = get('SELECT * FROM expense_vouchers WHERE id=?', req.params.id);
  if (!e) throw notFound();
  if (!['created', 'rejected'].includes(e.status)) throw bad('Only draft vouchers can be edited');
  for (const k of ['project_id', 'sale_id', 'vendor_id', 'paid_from_account_id', 'due_date', 'reference_no']) if (req.body[k] === '') req.body[k] = null; // an empty form field is "not set", not an invalid id
  if (req.body.paid_from_account_id) assertTreasury(req.body.paid_from_account_id);
  const acct = get('SELECT code FROM accounts WHERE id=?', req.body.expense_account_id ?? e.expense_account_id);
  req.body.show_paid_from = req.body.show_paid_from === undefined ? undefined : req.body.show_paid_from ? 1 : 0;
  const asset = req.body.is_asset === undefined ? e.is_asset : req.body.is_asset ? 1 : 0;
  req.body.is_asset = acct?.code === '5800' ? 1 : asset;
  if (req.body.asset_info !== undefined || req.body.is_asset) { const ai = req.body.is_asset ? cleanAssetInfo(req.body.asset_info ?? (e.asset_info ? JSON.parse(e.asset_info) : null)) : null; req.body.asset_info = ai ? JSON.stringify(ai) : null; }
  const qty = Number(req.body.quantity ?? e.quantity), unit = Number(req.body.unit_cost ?? e.unit_cost);
  const amount = req.body.amount !== undefined ? int(req.body.amount) : Math.round(qty * unit);
  update('expense_vouchers', e.id, { ...req.body, quantity: qty, unit_cost: unit, amount, is_credit: req.body.is_credit === undefined ? undefined : req.body.is_credit ? 1 : 0 },
    ['date', 'project_id', 'sale_id', 'vendor_id', 'expense_account_id', 'description', 'quantity', 'unit_cost', 'amount', 'payment_method', 'reference_no', 'paid_from_account_id', 'is_credit', 'due_date', 'notes', 'show_paid_from', 'is_asset', 'asset_info']);
  audit(req, 'Edited Expense Voucher', 'expense', e.id, e.voucher_no);
  res.json({ ok: true });
}));
/** Whether the printed voucher / PDF names the account the money was paid from. May be changed at any time. */
r.post('/expenses/:id(\\d+)/show-paid-from', can('accounting', 'edit'), asyncH((req, res) => {
  const e = get('SELECT * FROM expense_vouchers WHERE id=?', req.params.id);
  if (!e) throw notFound();
  run('UPDATE expense_vouchers SET show_paid_from=? WHERE id=?', req.body.show ? 1 : 0, e.id);
  audit(req, req.body.show ? 'Voucher will show the paying account' : 'Voucher hides the paying account', 'expense', e.id, e.voucher_no);
  res.json({ show_paid_from: req.body.show ? 1 : 0 });
}));
r.post('/expenses/:id(\\d+)/submit', can('accounting', 'create'), asyncH((req, res) => { submitVoucher(Number(req.params.id), req); res.json({ ok: true }); }));
r.post('/expenses/:id(\\d+)/approve', can('accounting', 'approve'), asyncH((req, res) => { approveVoucher(Number(req.params.id), req); res.json({ ok: true }); }));
r.post('/expenses/:id(\\d+)/reject', can('accounting', 'approve'), asyncH((req, res) => { rejectVoucher(Number(req.params.id), req); res.json({ ok: true }); }));
r.post('/expenses/:id(\\d+)/pay', can('accounting', 'approve'), asyncH((req, res) => { payVoucher(Number(req.params.id), req.body, req); res.json({ ok: true }); }));
r.delete('/expenses/:id(\\d+)', can('accounting', 'delete'), asyncH((req, res) => {
  const e = get('SELECT * FROM expense_vouchers WHERE id=?', req.params.id);
  if (!e) throw notFound();
  if (!['created', 'rejected'].includes(e.status)) throw bad('Only draft vouchers can be deleted');
  run('DELETE FROM expense_vouchers WHERE id=?', e.id);
  audit(req, 'Deleted Expense Voucher', 'expense', e.id, e.voucher_no);
  res.json({ ok: true });
}));

export default r;
