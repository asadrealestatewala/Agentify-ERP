// Developer files, phase 3: a customer payment the developer has approved is recorded here, and the rebate the developer
// owes the company on it is posted to the books at the same moment. Design: docs/DEVELOPER_PARTNER_PORTAL.md sections 6 and 7.
//
// Journals (the company never touches the customer's cash on a developer file):
//   approved payment X : Dr 2610 Developer Clearing X   / Cr 1300 Customer Receivable X      (no income, no bank)
//   rebate R           : Dr 1350 Developer Rebate Receivable R / Cr 4500 Developer Rebate Income R   (the company's revenue)
//   developer pays R   : Dr bank/cash R / Cr 1350 R
import { get, all, run, tx, val } from '../db.js';
import { now, today, bad, int, jparse, moneyText, curCode } from '../util.js';
import { postJournal, reverseJournal, assertTreasury } from './accounting.js';
import { PAYMENT_METHODS, receivePayment } from './payments.js';
import { audit, notify } from '../audit.js';
import { logFileEvent, rebateTermsOf } from './developers.js';

const STAGE_OF = { booking: 'down', advance: 'down', balloon: 'balloon' };
export const stageOf = (kind) => STAGE_OF[kind] || 'installment';
export const STAGES = ['down', 'installment', 'balloon'];

/** The rebate rules for a file: the snapshot taken at booking, or (older files) the plot and agreement as they are now. */
export function saleRebateTerms(sale) {
  const snap = jparse(sale.rebate_terms, null);
  if (snap && snap.mode) return snap;
  return rebateTermsOf(get('SELECT * FROM properties WHERE id=?', sale.property_id), get('SELECT * FROM developer_agreements WHERE id=?', sale.agreement_id));
}

/**
 * Rebate earned by one approved payment, one row per stage.
 *  - A plot rebate is the developer's total for the plot (percent of the contract price, or a fixed amount). It is earned in proportion
 *    to the money paid, the running total never passes the plot rebate, and the payment that clears the file takes whatever rounding left.
 *  - Without a plot rebate, each stage uses the agreement's rate for that stage (down payment / installment / balloon) on the amount paid.
 * `allocations` are [{kind, amount}] for this payment; `fullyPaid` says the payment cleared the contract.
 */
export function computeRebate(sale, terms, allocations, { fullyPaid = false } = {}) {
  const byStage = new Map();
  const add = (stage, base, rate, amount) => {
    const row = byStage.get(stage) || { stage, base_amount: 0, rate, amount: 0 };
    row.base_amount += base; row.amount += amount; row.rate = rate === row.rate ? rate : null;
    byStage.set(stage, row);
  };
  if (terms.mode === 'plot') {
    const price = Number(sale.net_price) || 0;
    const total = terms.type === 'percent' ? Math.round(price * terms.value / 100) : Math.round(terms.value);
    let left = Math.max(0, total - val("SELECT COALESCE(SUM(amount),0) FROM developer_rebates WHERE sale_id=? AND status<>'reversed'", sale.id));
    const rate = terms.type === 'percent' ? terms.value : null;
    allocations.forEach((a, i) => {
      const share = Math.min(left, price ? Math.round(total * a.amount / price) : 0);
      left -= share;
      const last = i === allocations.length - 1;
      add(stageOf(a.kind), a.amount, rate, last && fullyPaid ? share + left : share);
      if (last && fullyPaid) left = 0;
    });
  } else {
    for (const a of allocations) {
      const pct = Number(terms[stageOf(a.kind)]) || 0;
      add(stageOf(a.kind), a.amount, pct, Math.round(a.amount * pct / 100));
    }
  }
  return STAGES.map((s) => byStage.get(s)).filter((r) => r && r.amount > 0);
}

/**
 * Post the rebate a developer-approved receipt has earned (called right after the receipt exists: by the developer portal's
 * approvePayment and by recordDeveloperPayment). The receipt itself already cleared 2610 against the customer's receivable.
 * Safe to call twice for one receipt.
 */
export function postPaymentRebate(receiptId, req, { amount: fixed, extra = false, date: onDate } = {}) {
  return tx(() => {
    const rc = get('SELECT * FROM receipts WHERE id=?', receiptId);
    const sale = rc?.sale_id ? get('SELECT * FROM sales WHERE id=?', rc.sale_id) : null;
    if (!sale || !sale.developer_id) return { rebate: 0, rebates: [] };
    if (!extra && get('SELECT 1 FROM developer_rebates WHERE receipt_id=?', receiptId)) return { rebate: 0, rebates: [], already: true };
    const terms = saleRebateTerms(sale);
    const allocs = all('SELECT i.kind, ra.amount FROM receipt_allocations ra JOIN installments i ON i.id=ra.installment_id WHERE ra.receipt_id=? AND i.sale_id=? AND ra.amount>0', receiptId, sale.id);
    let rows;
    if (fixed !== undefined && fixed !== null) {
      // the rebate was agreed for this payment by hand (e.g. 10,000 of a 25,000 installment): it replaces the computed one, so nothing is counted twice
      const paid = allocs.reduce((t, a) => t + a.amount, 0);
      const already = extra ? val("SELECT COALESCE(SUM(amount),0) FROM developer_rebates WHERE receipt_id=? AND status<>'reversed'", receiptId) : 0;
      if (fixed + already > paid) throw bad('The rebate cannot be more than the payment');
      rows = fixed > 0 ? [{ stage: stageOf(allocs.slice().sort((a, b) => b.amount - a.amount)[0]?.kind), base_amount: paid, rate: null, amount: fixed }] : [];
    } else rows = computeRebate(sale, terms, allocs, { fullyPaid: sale.paid_amount >= sale.net_price });
    const total = rows.reduce((t, r) => t + r.amount, 0);
    if (total > 0) {
      const rj = postJournal({ date: onDate || rc.date, memo: `Rebate on ${rc.receipt_no} — ${sale.booking_id || sale.sale_no}`, refType: 'developer_rebate', refId: receiptId, projectId: sale.project_id, userId: req.user.id,
        lines: [{ account: '1350', debit: total, saleId: sale.id }, { account: '4500', credit: total, saleId: sale.id }] });
      for (const r of rows) {
        run(`INSERT INTO developer_rebates(developer_id,sale_id,receipt_id,stage,source,base_amount,rate,amount,status,recognised_journal_id,created_at) VALUES(?,?,?,?,?,?,?,?,'due',?,?)`,
          sale.developer_id, sale.id, receiptId, r.stage, terms.mode, r.base_amount, r.rate, r.amount, rj, now());
      }
      logFileEvent(sale.id, 'rebate_posted', { user: req.user, amount: total, note: rc.receipt_no });
      audit(req, 'Posted developer rebate', 'receipt', receiptId, `${rc.receipt_no} ${curCode()} ${total}`);
      notify(all('SELECT id FROM users WHERE developer_id=? AND active=1', sale.developer_id).map((u) => u.id), 'payment', 'Rebate due to the company',
        `${moneyText(total)} on ${sale.booking_id || sale.sale_no} (receipt ${rc.receipt_no}).`, '/developer/rebates');
    }
    return { rebate: total, rebates: rows };
  });
}

/**
 * Staff record a customer payment the developer has approved outside the portal (call, WhatsApp, cash at the developer's office).
 * Same books as a portal approval: nothing touches the company's cash, and the rebate is posted.
 */
export function recordDeveloperPayment(inp, req) {
  return tx(() => {
    const sale = get('SELECT * FROM sales WHERE id=?', inp.sale_id);
    if (!sale || !sale.developer_id) throw bad('This is not a developer file');
    if (sale.holder !== 'customer') throw bad('This file is held by the company, so the company handles its payments');
    const type = inp.payment_type || 'Installment';
    if (['Refund', 'Adjustment'].includes(type)) throw bad('Choose a payment type: booking, down payment, installment, balloon, partial or full');
    // the customer paid the company (e.g. into a staff member's wallet) and the company passes it on to the developer afterwards
    const held = !!inp.paid_to_company;
    if (held && !inp.account_id) throw bad('Choose the account the customer’s money was received into');
    const rid = receivePayment({ contact_id: sale.contact_id, sale_id: sale.id, amount: inp.amount, method: inp.method, txn_id: inp.txn_id, bank: inp.bank, cheque_no: inp.cheque_no,
      reference_no: inp.reference_no, date: inp.date, payment_type: type, developerApproval: !held, developerHeld: held, account_id: held ? inp.account_id : undefined,
      notes: [held ? 'Received by the company for the developer' : 'Approved by the developer, recorded by staff', inp.notes].filter(Boolean).join('. ') }, req);
    logFileEvent(sale.id, held ? 'payment_held' : 'payment_approved', { user: req.user, amount: int(inp.amount), note: held ? 'received by the company, to be passed on' : 'recorded by staff' });
    // money held for the developer earns no rebate until staff record what the developer pays back (Record rebate on the file)
    if (held) return { receipt_id: rid, rebate: 0, held: true };
    const hand = inp.rebate_amount !== undefined && inp.rebate_amount !== null && inp.rebate_amount !== '';
    const out = postPaymentRebate(rid, req, hand ? { amount: int(inp.rebate_amount) } : {});
    // the developer already handed the rebate over (e.g. 10,000 of this installment came back to the company): mark it received into the chosen account
    if (hand && out.rebate > 0 && inp.rebate_received_account_id) {
      const ids = all('SELECT id FROM developer_rebates WHERE receipt_id=?', rid).map((r) => r.id);
      receiveRebates(sale.developer_id, { rebate_ids: ids, account_id: inp.rebate_received_account_id, method: inp.rebate_received_method || inp.method, reference_no: inp.rebate_received_ref, date: inp.date }, req);
      out.rebate_received = out.rebate;
    }
    return { receipt_id: rid, ...out };
  });
}

/** What the developer owes and has paid, row by row, in a shape that is safe to show the developer too (no contact details). */
export function rebateLedger(developerId, { status } = {}) {
  const params = [developerId];
  let where = 'b.developer_id=?';
  if (status) { where += ' AND b.status=?'; params.push(status); }
  const rows = all(`SELECT b.id, b.stage, b.source, b.base_amount, b.rate, b.amount, b.status, b.received_on, b.received_method, b.reference_no, b.created_at,
      r.receipt_no, r.date payment_date, s.id sale_id, s.booking_id, p.title plot_title, p.plot_no, c.full_name customer_name
    FROM developer_rebates b JOIN receipts r ON r.id=b.receipt_id JOIN sales s ON s.id=b.sale_id LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN contacts c ON c.id=s.contact_id
    WHERE ${where} ORDER BY b.id DESC`, ...params);
  const sum = (st) => rows.filter((x) => x.status === st).reduce((t, x) => t + x.amount, 0);
  return { rows, totals: { due: sum('due'), received: sum('received'), reversed: sum('reversed'), earned: sum('due') + sum('received') } };
}

/** The developer paid some of what it owes: clear the receivable against the bank or cash account the money went into. */
export function receiveRebates(developerId, inp, req) {
  const method = inp.method || 'Bank Transfer';
  if (!PAYMENT_METHODS.includes(method)) throw bad('Invalid payment method');
  const date = inp.date || today();
  return tx(() => {
    const ids = Array.isArray(inp.rebate_ids) && inp.rebate_ids.length ? inp.rebate_ids.map(int).filter(Boolean) : null;
    let rows = all("SELECT * FROM developer_rebates WHERE developer_id=? AND status='due' ORDER BY id", developerId);
    if (ids) rows = rows.filter((x) => ids.includes(x.id));
    if (!rows.length) throw bad('There is no rebate waiting to be paid');
    if (ids && rows.length !== new Set(ids).size) throw bad('Some of the chosen rebates are not waiting to be paid');
    const acc = assertTreasury(inp.account_id);
    const total = rows.reduce((t, x) => t + x.amount, 0);
    const ref = [inp.cheque_no ? `Cheque ${String(inp.cheque_no).trim()}` : '', String(inp.bank || '').trim(), String(inp.reference_no || '').trim()].filter(Boolean).join(' · ').slice(0, 200) || null;
    const jid = postJournal({ date, memo: `Rebate received from developer${ref ? ` — ${ref}` : ''}`, refType: 'developer_rebate_payment', refId: developerId, userId: req.user.id,
      lines: [{ account: acc.id, debit: total }, { account: '1350', credit: total }] });
    for (const x of rows) run("UPDATE developer_rebates SET status='received', received_journal_id=?, received_on=?, received_method=?, reference_no=? WHERE id=?", jid, date, method, ref, x.id);
    audit(req, 'Recorded developer rebate payment', 'developer', developerId, `${curCode()} ${total} (${rows.length} rebates)`);
    return { received: total, count: rows.length, journal_id: jid };
  });
}

/**
 * The developer's account in the company's books, in date order. Money the customers paid to the developer is shown for reference
 * ("Collected by developer") and never counts as company income; the running balance is only the rebate the developer still owes the company.
 */
export function developerAccount(developerId, { from, to } = {}) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const entries = [];
  for (const r of all(`SELECT r.id, r.receipt_no, r.date, r.method, r.payment_type, r.amount, c.full_name customer, s.booking_id
      FROM receipts r JOIN sales s ON s.id=r.sale_id JOIN contacts c ON c.id=r.contact_id
      WHERE s.developer_id=? AND r.status='valid' AND r.account_id IN (SELECT id FROM accounts WHERE code='2610') ORDER BY r.date, r.id`, developerId)) {
    entries.push({ date: r.date, ord: 1, kind: 'collected', ref: r.receipt_no, description: `${r.payment_type} from ${r.customer} (${r.booking_id || 'file'}) paid to the developer by ${r.method}`,
      collected: r.payment_type === 'Refund' ? -r.amount : r.amount, earned: 0, received: 0 });
  }
  const held = all(`SELECT r.receipt_no, r.date, r.amount, r.payment_type, c.full_name customer, s.booking_id FROM receipts r JOIN sales s ON s.id=r.sale_id JOIN contacts c ON c.id=r.contact_id
    WHERE s.developer_id=? AND r.status='valid' AND r.held_for_developer=1 ORDER BY r.date, r.id`, developerId);
  for (const r of held) entries.push({ date: r.date, ord: 1, kind: 'held', ref: r.receipt_no, description: `${r.payment_type} from ${r.customer} (${r.booking_id || 'file'}) received by the company for the developer`, collected: 0, earned: 0, received: 0, held_in: r.amount, sent: 0 });
  for (const t of all(`SELECT t.*, s.booking_id FROM developer_transfers t JOIN sales s ON s.id=t.sale_id WHERE t.developer_id=? AND t.status='valid' ORDER BY t.date, t.id`, developerId))
    entries.push({ date: t.date, ord: 1, kind: 'sent', ref: t.reference_no || `T-${t.id}`, description: `Sent to the developer for ${t.booking_id || 'file'}${t.rebate_kept ? ` (rebate ${t.rebate_kept} kept)` : ''}`, collected: 0, earned: 0, received: 0, held_in: 0, sent: t.amount + t.rebate_kept });
  const earned = new Map(), got = new Map();
  for (const b of all(`SELECT b.*, r.receipt_no, r.date payment_date FROM developer_rebates b JOIN receipts r ON r.id=b.receipt_id WHERE b.developer_id=? AND b.status<>'reversed' ORDER BY b.id`, developerId)) {
    const e = earned.get(b.receipt_id) || { date: b.payment_date, ord: 2, kind: 'rebate', ref: b.receipt_no, description: `Rebate earned on ${b.receipt_no}`, collected: 0, earned: 0, received: 0 };
    e.earned += b.amount; earned.set(b.receipt_id, e);
    if (b.status === 'received') {
      const g = got.get(b.received_journal_id) || { date: b.received_on, ord: 3, kind: 'received', ref: b.reference_no || '', description: `Rebate received from the developer by ${b.received_method || 'transfer'}`, collected: 0, earned: 0, received: 0 };
      g.received += b.amount; got.set(b.received_journal_id, g);
    }
  }
  const all_ = [...entries, ...earned.values(), ...got.values()].sort((a, b) => a.date.localeCompare(b.date) || a.ord - b.ord);
  let bal = 0, open = 0;
  const rows = [];
  for (const e of all_) {
    if (to && e.date > to) break;
    bal += e.earned - e.received;
    if (!inRange(e.date)) { if (from && e.date < from) open = bal; continue; }
    rows.push({ ...e, ord: undefined, balance: bal });
  }
  const sum = (k) => rows.reduce((t, x) => t + (x[k] || 0), 0);
  return { rows, opening: open, balance: bal, held: heldForDeveloper(developerId), totals: { collected: sum('collected'), earned: sum('earned'), received: sum('received'), held_in: sum('held_in'), sent: sum('sent') } };
}

// ---------------------------------------------------------------- customer pays the company, the company passes it on (v1.119)
// Customer pays X into the company's own account : Dr bank/wallet X / Cr 2610 X   (owed to the developer, not income)
// Company hands it on                           : Dr 2610 (sent + rebate kept) / Cr bank sent / Cr 4500 rebate kept
// Developer pays the rebate later               : Dr bank R / Cr 4500 R   (see recordFileRebate)

/** What the company still holds for the developer on one file (or on all of the developer's files). */
export function heldForDeveloper(developerId, saleId) {
  const bySale = saleId ? ' AND s.id=?' : '';
  const args = saleId ? [developerId, saleId] : [developerId];
  const got = val(`SELECT COALESCE(SUM(r.amount),0) FROM receipts r JOIN sales s ON s.id=r.sale_id WHERE s.developer_id=? AND r.status='valid' AND r.held_for_developer=1${bySale}`, ...args);
  const sent = val(`SELECT COALESCE(SUM(t.amount+t.rebate_kept),0) FROM developer_transfers t JOIN sales s ON s.id=t.sale_id WHERE s.developer_id=? AND t.status='valid'${bySale}`, ...args);
  return { received: got, sent, held: got - sent };
}

/** Hand money the company holds for a developer's file on to the developer, keeping the rebate first if agreed. */
export function sendToDeveloper(developerId, inp, req) {
  const date = inp.date || today();
  const amount = int(inp.amount), kept = int(inp.rebate_kept || 0);
  if (amount < 0 || kept < 0 || amount + kept <= 0) throw bad('Enter the amount sent to the developer');
  return tx(() => {
    const sale = get('SELECT * FROM sales WHERE id=? AND developer_id=?', inp.sale_id, developerId);
    if (!sale) throw bad('This is not one of the developer\'s files');
    const acc = assertTreasury(inp.account_id);
    const h = heldForDeveloper(developerId, sale.id);
    if (amount + kept > h.held) throw bad(`Only ${moneyText(h.held)} is being held for the developer on this file`);
    const lastReceipt = kept > 0 ? get("SELECT id FROM receipts WHERE sale_id=? AND status='valid' AND held_for_developer=1 ORDER BY date DESC, id DESC", sale.id) : null;
    if (kept > 0 && !lastReceipt) throw bad('There is no payment on this file to attach the rebate to');
    const ref = [String(inp.reference_no || '').trim()].filter(Boolean).join(' · ').slice(0, 200) || null;
    const lines = [{ account: '2610', debit: amount + kept, saleId: sale.id }];
    if (amount > 0) lines.push({ account: acc.id, credit: amount });
    if (kept > 0) lines.push({ account: '4500', credit: kept, saleId: sale.id });
    const jid = postJournal({ date, memo: `Sent to developer — ${sale.booking_id || sale.sale_no}${kept ? ` (rebate ${moneyText(kept)} kept)` : ''}${ref ? ` — ${ref}` : ''}`,
      refType: 'developer_transfer', refId: sale.id, projectId: sale.project_id, userId: req.user.id, lines });
    const r = run(`INSERT INTO developer_transfers(developer_id,sale_id,date,amount,rebate_kept,account_id,method,reference_no,notes,journal_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      developerId, sale.id, date, amount, kept, acc.id, inp.method || null, ref, inp.notes || null, jid, req.user.id, now());
    if (kept > 0) {
      const allocs = all('SELECT i.kind, ra.amount FROM receipt_allocations ra JOIN installments i ON i.id=ra.installment_id WHERE ra.receipt_id=? AND ra.amount>0', lastReceipt.id);
      run(`INSERT INTO developer_rebates(developer_id,sale_id,receipt_id,stage,source,base_amount,rate,amount,status,recognised_journal_id,received_journal_id,received_on,received_method,reference_no,created_at) VALUES(?,?,?,?,?,?,?,?,'received',?,?,?,?,?,?)`,
        developerId, sale.id, lastReceipt.id, stageOf(allocs.sort((a, b) => b.amount - a.amount)[0]?.kind), 'agreement', amount + kept, null, kept, jid, jid, date, 'Kept from transfer', ref, now());
    }
    logFileEvent(sale.id, 'sent_to_developer', { user: req.user, amount: amount + kept, note: kept ? `rebate ${kept} kept` : undefined });
    audit(req, 'Sent money to developer', 'developer', developerId, `${sale.booking_id || sale.sale_no} ${curCode()} ${amount}${kept ? ` + rebate kept ${kept}` : ''}`);
    return { id: Number(r.lastInsertRowid), journal_id: jid, held: h.held - amount - kept };
  });
}

/** Undo a transfer to the developer (reverses its journal and any rebate that was kept in it). */
export function cancelTransfer(developerId, transferId, reason, req) {
  return tx(() => {
    const t = get('SELECT * FROM developer_transfers WHERE id=? AND developer_id=?', transferId, developerId);
    if (!t) throw bad('Transfer not found');
    if (t.status === 'void') throw bad('This transfer is already cancelled');
    if (!reason) throw bad('A reason is required');
    if (t.journal_id) reverseJournal(t.journal_id, `Cancelled transfer to developer: ${reason}`, req.user.id);
    run("UPDATE developer_transfers SET status='void' WHERE id=?", t.id);
    run("UPDATE developer_rebates SET status='reversed' WHERE recognised_journal_id=? AND received_journal_id=?", t.journal_id, t.journal_id);
    audit(req, 'Cancelled transfer to developer', 'developer', developerId, `#${t.id}: ${reason}`);
    return { ok: true };
  });
}

export function transferLedger(developerId) {
  return all(`SELECT t.*, a.name account_name, s.booking_id, c.full_name customer_name FROM developer_transfers t JOIN accounts a ON a.id=t.account_id
    JOIN sales s ON s.id=t.sale_id LEFT JOIN contacts c ON c.id=s.contact_id WHERE t.developer_id=? ORDER BY t.date DESC, t.id DESC`, developerId);
}

/** The developer paid its rebate on one file, afterwards: books the rebate (income) and the money coming in, in one step. */
export function recordFileRebate(developerId, inp, req) {
  return tx(() => {
    const sale = get('SELECT * FROM sales WHERE id=? AND developer_id=?', inp.sale_id, developerId);
    if (!sale) throw bad('This is not one of the developer\'s files');
    const amount = int(inp.amount);
    if (amount <= 0) throw bad('Enter the rebate received');
    if (!inp.account_id) throw bad('Choose the account the rebate was received into');
    const rc = inp.receipt_id ? get("SELECT id FROM receipts WHERE id=? AND sale_id=? AND status='valid'", inp.receipt_id, sale.id)
      : get("SELECT id FROM receipts WHERE sale_id=? AND status='valid' AND payment_type<>'Refund' ORDER BY date DESC, id DESC", sale.id);
    if (!rc) throw bad('This file has no payment to attach the rebate to');
    // the rebate earns its date from the day it was received, not from the payment it hangs on
    const out = postPaymentRebate(rc.id, req, { amount, extra: true, date: inp.date || today() });
    const row = get("SELECT id FROM developer_rebates WHERE receipt_id=? AND status='due' ORDER BY id DESC", rc.id);
    if (!row) throw bad('The rebate could not be recorded');
    receiveRebates(developerId, { rebate_ids: [row.id], account_id: inp.account_id, method: inp.method, reference_no: inp.reference_no, date: inp.date }, req);
    return { rebate: out.rebate };
  });
}
