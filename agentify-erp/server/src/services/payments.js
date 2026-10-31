import { get, all, run, tx, nextNo } from '../db.js';
import { now, today, bad, int, moneyText, curCode } from '../util.js';
import { postJournal, reverseJournal, assertTreasury, assertFunds } from './accounting.js';
import { audit, activity, notify } from '../audit.js';

export const PAYMENT_TYPES = ['Booking Payment', 'Advance Payment', 'Installment', 'Balloon Payment', 'Down Payment',
  'Partial Payment', 'Full Payment', 'Refund', 'Adjustment', 'Other'];
export const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Online Transfer', 'JazzCash', 'Easypaisa', 'Cheque', 'Other'];
const ONLINE = ['Bank Transfer', 'Online Transfer', 'JazzCash', 'Easypaisa'];

const instStatus = (paid, amount) => (paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'pending');

function preferredKinds(type) {
  if (type === 'Booking Payment' || type === 'Down Payment') return ['booking', 'advance'];
  if (type === 'Advance Payment') return ['advance', 'booking'];
  if (type === 'Balloon Payment') return ['balloon'];
  if (type === 'Installment') return ['installment'];
  return [];
}

/** Pick the installments a payment should settle: preferred kind first, then oldest due. */
function allocate(saleId, amount, type) {
  const open = all(`SELECT * FROM installments WHERE sale_id=? AND paid<amount ORDER BY due_date, seq`, saleId);
  const pref = preferredKinds(type);
  const ordered = [...open.filter((i) => pref.includes(i.kind)), ...open.filter((i) => !pref.includes(i.kind))];
  const out = [];
  let left = amount;
  for (const i of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, i.amount - i.paid);
    out.push({ installment: i, amount: take });
    left -= take;
  }
  return { allocations: out, unallocated: left };
}

function applyAllocation(installmentId, delta, date) {
  const i = get('SELECT * FROM installments WHERE id=?', installmentId);
  const paid = i.paid + delta;
  if (paid < 0 || paid > i.amount) throw bad('Allocation would corrupt the installment ledger');
  const status = instStatus(paid, i.amount);
  run('UPDATE installments SET paid=?, status=?, paid_date=? WHERE id=?', paid, status, status === 'paid' ? (date || today()) : null, installmentId);
}

/**
 * Records one receipt voucher. It can settle a single sale (`sale_id`), several sales of one customer at once
 * (`splits: [{sale_id, amount}]` — e.g. plot + house construction paid with one monthly cheque), or be a plain advance.
 */
export function receivePayment(inp, req) {
  const user = req.user;
  const type = inp.payment_type || 'Installment';
  if (!PAYMENT_TYPES.includes(type)) throw bad('Invalid payment type');
  const method = inp.method || 'Cash';
  if (!PAYMENT_METHODS.includes(method)) throw bad('Invalid payment method');
  if (ONLINE.includes(method) && !inp.txn_id) throw bad('Transaction ID is required for online payments');
  if (ONLINE.includes(method) && !inp.bank) throw bad('Bank / channel is required for online payments');
  if (method === 'Cheque' && (!inp.cheque_no || !inp.bank)) throw bad('Cheque number and bank are required for cheque payments');
  const date = inp.date || today();
  const isRefund = type === 'Refund';
  const splits = Array.isArray(inp.splits) && inp.splits.length ? inp.splits.map((s) => ({ sale_id: Number(s.sale_id), amount: int(s.amount) })).filter((s) => s.amount > 0) : null;
  const amount = splits ? splits.reduce((a, s) => a + s.amount, 0) : int(inp.amount);
  if (amount <= 0) throw bad('Amount must be greater than zero');
  if (splits && isRefund) throw bad('Refunds must be made against one sale');
  if (splits && new Set(splits.map((s) => s.sale_id)).size !== splits.length) throw bad('A sale appears twice in the split');

  return tx(() => {
    const contact = get('SELECT * FROM contacts WHERE id=?', inp.contact_id);
    if (!contact) throw bad('Customer not found');
    const wanted = splits || (inp.sale_id ? [{ sale_id: Number(inp.sale_id), amount }] : []);
    const parts = wanted.map((w) => {
      const sale = get('SELECT * FROM sales WHERE id=?', w.sale_id);
      if (!sale) throw bad('Sale not found');
      if (sale.contact_id !== contact.id) throw bad('Sale does not belong to this customer');
      if (sale.status !== 'confirmed') throw bad('Payments can only be recorded against confirmed sales');
      if (sale.developer_id && sale.holder === 'customer') throw bad(`${sale.sale_no} is a developer file: the customer pays the developer, and the payment is recorded once the developer approves it. Direct receipts are not available for it yet.`);
      return { sale, amount: w.amount, allocations: [], settled: 0, advance: 0 };
    });
    const acc = assertTreasury(inp.account_id);
    if (inp.txn_id && get("SELECT id FROM receipts WHERE txn_id=? AND status='valid'", inp.txn_id)) throw bad('This transaction ID has already been recorded');

    if (isRefund) {
      const p = parts[0];
      if (!p) throw bad('A refund must reference a sale');
      if (amount > p.sale.paid_amount) throw bad(`Refund exceeds amount paid (${moneyText(p.sale.paid_amount)})`);
      assertFunds(acc.id, amount);
      let left = amount;
      for (const i of all('SELECT * FROM installments WHERE sale_id=? AND paid>0 ORDER BY due_date DESC, seq DESC', p.sale.id)) {
        if (left <= 0) break;
        const take = Math.min(left, i.paid);
        p.allocations.push({ installment: i, amount: -take });
        left -= take;
      }
      p.settled = -amount;
    } else if (parts.length) {
      for (const p of parts) {
        const outstanding = p.sale.net_price - p.sale.paid_amount;
        if (p.amount > outstanding && !inp.overpayment) {
          throw bad(`Payment for ${p.sale.sale_no} exceeds its outstanding balance of ${moneyText(outstanding)}. Mark it as an overpayment/advance to accept the excess.`);
        }
        p.settled = Math.min(p.amount, outstanding);
        p.advance = p.amount - p.settled;
        p.allocations = allocate(p.sale.id, p.settled, type).allocations;
      }
    } else {
      if (!inp.overpayment && type !== 'Advance Payment') throw bad('Select a sale, or record this as an advance payment');
    }
    const advanceTotal = parts.length ? parts.reduce((a, p) => a + p.advance, 0) : amount;
    const single = parts.length === 1 ? parts[0].sale : null;

    const no = nextNo('RV', 'RV');
    const r = run(`INSERT INTO receipts(receipt_no,date,contact_id,sale_id,project_id,property_id,account_id,payment_type,amount,advance_amount,method,
      reference_no,cheque_no,bank,txn_id,sender,notes,received_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    no, date, contact.id, single?.id ?? null, (single || parts[0]?.sale)?.project_id ?? null, single?.property_id ?? null, acc.id, type, amount, advanceTotal, method,
    inp.reference_no ?? null, inp.cheque_no ?? null, inp.bank ?? null, inp.txn_id ?? null, inp.sender ?? null, inp.notes ?? null,
    inp.received_by || user.id, 'valid', now());
    const rid = Number(r.lastInsertRowid);

    for (const p of parts) {
      for (const a of p.allocations) {
        applyAllocation(a.installment.id, a.amount, date);
        run('INSERT INTO receipt_allocations(receipt_id,installment_id,amount) VALUES(?,?,?)', rid, a.installment.id, a.amount);
      }
      run('UPDATE sales SET paid_amount=paid_amount+?, advance_credit=advance_credit+? WHERE id=?', p.settled, p.advance, p.sale.id);
      run('INSERT INTO receipt_sales(receipt_id,sale_id,amount,advance) VALUES(?,?,?,?)', rid, p.sale.id, p.settled, p.advance);
    }

    let lines;
    if (isRefund) {
      lines = [{ account: '1300', debit: amount, contactId: contact.id, saleId: parts[0].sale.id, projectId: parts[0].sale.project_id }, { account: acc.id, credit: amount }];
    } else {
      lines = [{ account: acc.id, debit: amount }];
      if (parts.length) {
        for (const p of parts) {
          lines.push({ account: '1300', credit: p.settled, contactId: contact.id, saleId: p.sale.id, projectId: p.sale.project_id });
          lines.push({ account: '2200', credit: p.advance, contactId: contact.id, saleId: p.sale.id, projectId: p.sale.project_id });
        }
      } else lines.push({ account: '2200', credit: amount, contactId: contact.id });
    }
    const jid = postJournal({
      date, memo: `${isRefund ? 'Refund' : 'Receipt'} ${no} — ${contact.full_name}`, refType: 'receipt', refId: rid,
      projectId: parts[0]?.sale.project_id, userId: user.id, lines,
    });
    run('UPDATE receipts SET journal_id=? WHERE id=?', jid, rid);

    const partText = parts.length > 1 ? ` split: ${parts.map((p) => `${p.sale.sale_no} ${moneyText(p.amount)}`).join(' + ')}` : '';
    activity(contact.id, user, isRefund ? 'Refund issued' : 'Payment received', { detail: `${no} — ${moneyText(amount)} (${type}, ${method})${partText}`, entityType: 'receipt', entityId: rid });
    activity(contact.id, user, 'Receipt generated', { detail: no, entityType: 'receipt', entityId: rid });
    audit(req, isRefund ? 'Created refund voucher' : 'Created Receipt Voucher', 'receipt', rid, `${no} ${curCode()} ${amount} ${contact.full_name}${partText}`);
    notify([contact.agent_id, ...parts.map((p) => p.sale.agent_id)], 'payment', isRefund ? 'Refund issued' : 'Payment received', `${contact.full_name}: ${moneyText(amount)} (${no})`, `/receipts/${rid}`);
    // the customer's own portal login is told too, with a link to the receipt
    notify(all('SELECT id FROM users WHERE contact_id=? AND active=1', contact.id).map((u) => u.id), 'payment', isRefund ? 'Refund issued' : 'Payment received — receipt ready',
      `${moneyText(amount)} · receipt ${no}. Open Payments to view or download it.`, '/portal/payments');
    return rid;
  });
}

export function voidReceipt(id, reason, req) {
  return tx(() => {
    const r = get('SELECT * FROM receipts WHERE id=?', id);
    if (!r) throw bad('Receipt not found');
    if (r.status === 'void') throw bad('Receipt already void');
    if (!reason) throw bad('A reason is required to void a receipt');
    for (const a of all('SELECT * FROM receipt_allocations WHERE receipt_id=?', id)) applyAllocation(a.installment_id, -a.amount, r.date);
    for (const rs of all('SELECT * FROM receipt_sales WHERE receipt_id=?', id)) {
      run('UPDATE sales SET paid_amount=paid_amount-?, advance_credit=advance_credit-? WHERE id=?', rs.amount, rs.advance, rs.sale_id);
    }
    reverseJournal(r.journal_id, `Void of ${r.receipt_no}: ${reason}`, req.user.id);
    run("UPDATE receipts SET status='void', void_reason=? WHERE id=?", reason, id);
    activity(r.contact_id, req.user, 'Receipt voided', { detail: `${r.receipt_no}: ${reason}`, entityType: 'receipt', entityId: id });
    audit(req, 'Voided Receipt Voucher', 'receipt', id, `${r.receipt_no}: ${reason}`);
  });
}

/**
 * Customer ledger from the sub-ledger. `saleIds` limits it to one sale or a bundle of sales; credits come from
 * the receipt_sales split so a combined voucher appears in each sale's ledger for its own share.
 */
export function customerLedger(contactId, saleIds, range = {}) {
  const ids = saleIds == null || saleIds === '' ? null : [].concat(saleIds).map(Number);
  const filter = ids ? `AND s.id IN (${ids.map(() => '?').join(',')})` : '';
  const sales = all(`SELECT s.id, s.sale_no, s.sale_date date, s.net_price, s.kind, COALESCE(s.title, p.title) title FROM sales s LEFT JOIN properties p ON p.id=s.property_id
    WHERE s.contact_id=? AND s.status='confirmed' ${filter}`, contactId, ...(ids || []));
  const receipts = all(`SELECT r.id, r.receipt_no, r.date, r.payment_type, r.method, rs.sale_id, rs.amount, s.sale_no FROM receipt_sales rs JOIN receipts r ON r.id=rs.receipt_id
    JOIN sales s ON s.id=rs.sale_id WHERE r.contact_id=? AND r.status='valid' AND s.status='confirmed' ${filter}`, contactId, ...(ids || []));
  const entries = [
    ...sales.map((s) => ({ date: s.date, ref: s.sale_no, sale_id: s.id, description: `${s.kind === 'construction' ? 'Construction contract' : 'Sale'} — ${s.title}`, debit: s.net_price, credit: 0, kind: 'sale', id: s.id })),
    ...receipts.filter((r) => r.amount !== 0).map((r) => ({ date: r.date, ref: r.receipt_no, sale_id: r.sale_id, description: `${r.payment_type} (${r.method})${ids && ids.length > 1 ? ` — ${r.sale_no}` : ''}`,
      debit: r.amount < 0 ? -r.amount : 0, credit: r.amount > 0 ? r.amount : 0, kind: 'receipt', id: r.id })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'sale' ? -1 : 1));
  let bal = 0;
  for (const e of entries) { bal += e.debit - e.credit; e.balance = bal; }
  const { from, to } = range;
  if (!from && !to) return { entries, balance: bal };
  // date filter: carry the balance before `from` forward as an opening balance
  const before = entries.filter((e) => from && e.date < from);
  const opening = before.length ? before[before.length - 1].balance : 0;
  const within = entries.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  const closing = within.length ? within[within.length - 1].balance : opening;
  return { entries: within, opening, balance: closing, from: from || null, to: to || null, total_debit: within.reduce((a, e) => a + e.debit, 0), total_credit: within.reduce((a, e) => a + e.credit, 0) };
}

/** Ledger as a downloadable table (PDF / Excel / CSV) with opening and closing balance rows. */
export function ledgerTable(ledger) {
  const rows = [];
  if (ledger.opening !== undefined) rows.push({ date: ledger.from || '', ref: '', description: 'Opening balance', debit: null, credit: null, balance: ledger.opening });
  for (const e of ledger.entries) rows.push({ date: e.date, ref: e.ref, description: e.description, debit: e.debit || null, credit: e.credit || null, balance: e.balance });
  const columns = [{ key: 'date', label: 'Date' }, { key: 'ref', label: 'Reference' }, { key: 'description', label: 'Description' }, { key: 'debit', label: 'Debit', type: 'money' }, { key: 'credit', label: 'Credit', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }];
  const totals = { description: 'Closing balance', debit: ledger.entries.reduce((a, e) => a + e.debit, 0), credit: ledger.entries.reduce((a, e) => a + e.credit, 0), balance: ledger.balance };
  return { columns, rows, totals };
}
