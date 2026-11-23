import { get, all, run, tx, nextNo } from '../db.js';
import { now, today, bad, int, num, moneyText, curCode } from '../util.js';
import { postJournal, reverseJournal, assertTreasury, assertFunds } from './accounting.js';
import { audit, notifyPerm } from '../audit.js';
import { notifyVendor } from './vendorAccount.js';

export const EXPENSE_STATUS = ['created', 'submitted', 'approved', 'partial', 'paid', 'rejected', 'void'];


const str = (v, n = 200) => { const t = String(v ?? '').trim().slice(0, n); return t || null; };
/** The extra details the buyer types for an asset purchase — everything else comes from the voucher itself. */
export function cleanAssetInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const units = Math.round(Number(info.units) || 1);
  if (units < 1 || units > 500) throw bad('Units bought must be between 1 and 500');
  if (info.warranty_until && !/^\d{4}-\d{2}-\d{2}$/.test(info.warranty_until)) throw bad('Warranty date must be YYYY-MM-DD');
  return { name: str(info.name), category: str(info.category, 60), brand_model: str(info.brand_model), serial_no: str(info.serial_no, 80), warranty_until: str(info.warranty_until, 10), units, instructions: str(info.instructions, 500) };
}

/**
 * An approved asset purchase becomes records in the Asset Library: name, cost, purchase date, vendor and the voucher link are
 * copied from the voucher, so only genuinely extra details (serial, warranty…) are ever typed again. Several units split the
 * cost evenly. Idempotent — an asset already linked to the voucher (e.g. added from the library) is not duplicated.
 */
export function createAssetsFromVoucher(v, req) {
  if (get('SELECT 1 FROM assets WHERE voucher_id=?', v.id)) return [];
  let info = {}; try { info = JSON.parse(v.asset_info || '{}') || {}; } catch { info = {}; }
  const units = Math.max(1, Math.min(500, Number(info.units) || 1));
  const name = info.name || v.description || 'Asset';
  const each = Math.floor(v.amount / units), nos = [];
  for (let i = 0; i < units; i++) {
    const cost = i === units - 1 ? v.amount - each * (units - 1) : each;
    const no = nextNo('AST', 'AST', 4);
    const id = Number(run(`INSERT INTO assets(asset_no,name,category,brand_model,serial_no,purchase_date,cost,voucher_id,vendor_id,project_id,warranty_until,status,instructions,notes,source,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, no, units > 1 ? `${name} (${i + 1} of ${units})` : name, info.category ?? null, info.brand_model ?? null, units === 1 ? info.serial_no ?? null : null,
    v.date, cost, v.id, v.vendor_id ?? null, v.project_id ?? null, info.warranty_until ?? null, 'in_stock', info.instructions ?? null, `Created from expense voucher ${v.voucher_no}`, 'voucher', req.user.id, now()).lastInsertRowid);
    run('INSERT INTO asset_history(asset_id,action,date,note,user_id) VALUES(?,?,?,?,?)', id, 'added', v.date, `Purchased — voucher ${v.voucher_no}`, req.user.id);
    nos.push(no);
  }
  audit(req, 'Assets added from voucher', 'asset', v.id, `${v.voucher_no}: ${nos.join(', ')}`);
  notifyPerm('hrm', 'view', 'asset', 'New asset in the Asset Library', `${name} (${nos.join(', ')}) from ${v.voucher_no} — add the serial number and assign it`, '/assets');
  return nos;
}

export function createVoucher(inp, req) {
  const qty = num(inp.quantity, 1) || 1;
  const unit = num(inp.unit_cost, 0);
  const amount = int(inp.amount) || Math.round(qty * unit);
  if (amount <= 0) throw bad('Amount must be greater than zero');
  const acc = get('SELECT * FROM accounts WHERE id=?', inp.expense_account_id);
  if (!acc || acc.type !== 'expense') throw bad('Select a valid expense account');
  if (inp.project_id && !get('SELECT id FROM projects WHERE id=?', inp.project_id)) throw bad('Project not found');
  if (inp.vendor_id && !get('SELECT id FROM vendors WHERE id=?', inp.vendor_id)) throw bad('Vendor not found');
  const contract = inp.sale_id ? get('SELECT id, project_id FROM sales WHERE id=?', inp.sale_id) : null;
  if (inp.sale_id && !contract) throw bad('Contract not found');
  const projectId = inp.project_id || contract?.project_id || null;
  if (contract && projectId !== contract.project_id) throw bad('The contract belongs to a different project');
  if (inp.paid_from_account_id) assertTreasury(inp.paid_from_account_id);
  const isAsset = acc.code === '5800' || inp.is_asset ? 1 : 0; // the Assets & Equipment account is always an asset purchase
  const assetInfo = isAsset ? cleanAssetInfo(inp.asset_info) : null;
  const isCredit = inp.is_credit ? 1 : 0;
  if (isCredit && !inp.vendor_id) throw bad('A credit purchase needs a vendor');
  return tx(() => {
    const no = nextNo('EV', 'EV');
    const r = run(`INSERT INTO expense_vouchers(voucher_no,date,project_id,sale_id,vendor_id,expense_account_id,description,quantity,unit_cost,amount,
      payment_method,reference_no,paid_from_account_id,is_credit,due_date,status,notes,created_by,created_at,show_paid_from,is_asset,asset_info) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    no, inp.date || today(), projectId, contract?.id ?? null, inp.vendor_id || null, acc.id, inp.description ?? null, qty,
    unit || amount / qty, amount, inp.payment_method || null, inp.reference_no || null, inp.paid_from_account_id || null,
    isCredit, inp.due_date || null, 'created', inp.notes ?? null, req.user.id, now(), inp.show_paid_from ? 1 : 0, isAsset, assetInfo ? JSON.stringify(assetInfo) : null);
    const id = Number(r.lastInsertRowid);
    audit(req, 'Created Expense Voucher', 'expense', id, `${no} ${curCode()} ${amount}`);
    return id;
  });
}

export function submitVoucher(id, req) {
  const v = get('SELECT * FROM expense_vouchers WHERE id=?', id);
  if (!v) throw bad('Voucher not found');
  if (!['created', 'rejected'].includes(v.status)) throw bad(`Cannot submit a ${v.status} voucher`);
  run("UPDATE expense_vouchers SET status='submitted' WHERE id=?", id);
  audit(req, 'Submitted Expense Voucher', 'expense', id, v.voucher_no);
  notifyPerm('accounting', 'approve', 'expense', 'Expense awaiting approval', `${v.voucher_no}: ${moneyText(v.amount)}`, `/expenses/${id}`);
}

export function rejectVoucher(id, req) {
  const v = get('SELECT * FROM expense_vouchers WHERE id=?', id);
  if (!v || v.status !== 'submitted') throw bad('Only submitted vouchers can be rejected');
  run("UPDATE expense_vouchers SET status='rejected' WHERE id=?", id);
  audit(req, 'Rejected Expense Voucher', 'expense', id, v.voucher_no);
}

/** Approval books the expense (Dr expense / Cr vendor payable) against the project. */
export function approveVoucher(id, req) {
  return tx(() => {
    const v = get('SELECT * FROM expense_vouchers WHERE id=?', id);
    if (!v) throw bad('Voucher not found');
    if (v.status !== 'submitted') throw bad('Only submitted vouchers can be approved');
    const jid = postJournal({
      date: v.date, memo: `Expense ${v.voucher_no}: ${v.description || ''}`, refType: 'expense', refId: id, projectId: v.project_id, userId: req.user.id,
      lines: [{ account: v.expense_account_id, debit: v.amount, saleId: v.sale_id }, { account: '2100', credit: v.amount, vendorId: v.vendor_id }],
    });
    run("UPDATE expense_vouchers SET status='approved', approved_by=?, journal_id=? WHERE id=?", req.user.id, jid, id);
    if (v.is_asset) createAssetsFromVoucher({ ...v, journal_id: jid }, req);
    audit(req, 'Approved Expense Voucher', 'expense', id, `${v.voucher_no} ${curCode()} ${v.amount}`);
    if (v.vendor_id) notifyVendor(v.vendor_id, 'payment', 'Voucher approved', `${v.voucher_no}: ${moneyText(v.amount)} is approved${v.is_credit ? ' (credit purchase)' : ''}`, '/vendor/payments');
  });
}

export function payVoucher(id, inp, req) {
  return tx(() => {
    const v = get('SELECT * FROM expense_vouchers WHERE id=?', id);
    if (!v) throw bad('Voucher not found');
    if (!['approved', 'partial'].includes(v.status)) throw bad('Voucher must be approved before payment');
    const amount = int(inp.amount, v.amount - v.paid_amount);
    if (amount <= 0 || amount > v.amount - v.paid_amount) throw bad('Invalid payment amount');
    const acc = assertTreasury(inp.account_id || v.paid_from_account_id);
    assertFunds(acc.id, amount);
    const pno = nextNo('VP', 'VP');
    const jid = postJournal({
      date: inp.date || today(), memo: `Payment ${pno} for ${v.voucher_no}`, refType: 'vendor_payment', refId: id, projectId: v.project_id, userId: req.user.id,
      lines: [{ account: '2100', debit: amount, vendorId: v.vendor_id }, { account: acc.id, credit: amount }],
    });
    run(`INSERT INTO vendor_payments(payment_no,vendor_id,voucher_id,date,amount,account_id,method,reference_no,journal_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      pno, v.vendor_id, id, inp.date || today(), amount, acc.id, inp.method || v.payment_method || null, inp.reference_no ?? null, jid, req.user.id, now());
    const paid = v.paid_amount + amount;
    run('UPDATE expense_vouchers SET paid_amount=?, status=?, paid_by=? WHERE id=?', paid, paid >= v.amount ? 'paid' : 'partial', req.user.id, id);
    audit(req, 'Paid Expense Voucher', 'expense', id, `${v.voucher_no} ${curCode()} ${amount} via ${acc.name}`);
    if (v.vendor_id) notifyVendor(v.vendor_id, 'payment', 'Payment released', `${moneyText(amount)} released against ${v.voucher_no} (${pno})`, '/vendor/payments');
  });
}

/** Pay a vendor on account (not tied to one voucher): clears oldest approved vouchers first. */
export function payVendor(vendorId, inp, req) {
  return tx(() => {
    const vendor = get('SELECT * FROM vendors WHERE id=?', vendorId);
    if (!vendor) throw bad('Vendor not found');
    let left = int(inp.amount);
    if (left <= 0) throw bad('Amount must be greater than zero');
    const open = require_open(vendorId);
    const total = open.reduce((s, v) => s + (v.amount - v.paid_amount), 0);
    if (left > total) throw bad(`Payment exceeds the vendor's outstanding balance (${moneyText(total)})`);
    for (const v of open) {
      if (left <= 0) break;
      const take = Math.min(left, v.amount - v.paid_amount);
      payVoucher(v.id, { ...inp, amount: take }, req);
      left -= take;
    }
  });
}
function require_open(vendorId) {
  return all(`SELECT * FROM expense_vouchers WHERE vendor_id=? AND status IN ('approved','partial') ORDER BY date, id`, vendorId);
}

/**
 * Super-Admin-only: void an approved / partly paid / paid voucher. Every payment journal and the approval journal are reversed
 * (bank or cash comes back, the vendor payable and the expense go away), the voucher stays on file as "void" with who/when/why.
 */
export function voidVoucher(id, { reason, confirm_no } = {}, req) {
  return tx(() => {
    const v = get('SELECT * FROM expense_vouchers WHERE id=?', id);
    if (!v) throw bad('Voucher not found');
    if (v.status === 'void') throw bad('Voucher is already void');
    if (!['approved', 'partial', 'paid'].includes(v.status)) throw bad('Draft, submitted and rejected vouchers are deleted, not voided');
    if (!String(reason || '').trim()) throw bad('A reason is required to void a voucher');
    if (String(confirm_no || '').trim() !== v.voucher_no) throw bad(`Type the voucher number (${v.voucher_no}) to confirm`);
    if (get('SELECT 1 FROM assets WHERE voucher_id=?', id)) throw bad('This voucher created assets in the Asset Library. Remove or dispose of those assets first.');
    const why = `Void of ${v.voucher_no}: ${String(reason).trim()}`;
    for (const p of all('SELECT * FROM vendor_payments WHERE voucher_id=? AND voided=0', id)) {
      if (p.journal_id) reverseJournal(p.journal_id, why, req.user.id);
      run('UPDATE vendor_payments SET voided=1 WHERE id=?', p.id);
    }
    if (v.journal_id) reverseJournal(v.journal_id, why, req.user.id);
    run("UPDATE expense_vouchers SET status='void', void_reason=?, voided_by=?, voided_at=? WHERE id=?", String(reason).trim(), req.user.id, now(), id);
    audit(req, 'Voided Expense Voucher', 'expense', id, `${v.voucher_no} (${v.status}, paid ${v.paid_amount}): ${String(reason).trim()}`);
  });
}
