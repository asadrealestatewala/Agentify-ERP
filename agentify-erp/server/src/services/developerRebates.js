// Developer files, phase 3: a customer payment the developer has approved is recorded here, and the rebate the developer
// owes the company on it is posted to the books at the same moment. Design: docs/DEVELOPER_PARTNER_PORTAL.md sections 6 and 7.
//
// Journals (the company never touches the customer's cash on a developer file):
//   approved payment X : Dr 2610 Developer Clearing X   / Cr 1300 Customer Receivable X      (no income, no bank)
//   rebate R           : Dr 1350 Developer Rebate Receivable R / Cr 4500 Developer Rebate Income R   (the company's revenue)
//   developer pays R   : Dr bank/cash R / Cr 1350 R
import { get, all, run, tx, val } from '../db.js';
import { now, today, bad, int, jparse, moneyText, curCode } from '../util.js';
import { postJournal, assertTreasury } from './accounting.js';
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
export function postPaymentRebate(receiptId, req) {
  return tx(() => {
    const rc = get('SELECT * FROM receipts WHERE id=?', receiptId);
    const sale = rc?.sale_id ? get('SELECT * FROM sales WHERE id=?', rc.sale_id) : null;
    if (!sale || !sale.developer_id) return { rebate: 0, rebates: [] };
    if (get('SELECT 1 FROM developer_rebates WHERE receipt_id=?', receiptId)) return { rebate: 0, rebates: [], already: true };
    const terms = saleRebateTerms(sale);
    const allocs = all('SELECT i.kind, ra.amount FROM receipt_allocations ra JOIN installments i ON i.id=ra.installment_id WHERE ra.receipt_id=? AND i.sale_id=? AND ra.amount>0', receiptId, sale.id);
    const rows = computeRebate(sale, terms, allocs, { fullyPaid: sale.paid_amount >= sale.net_price });
    const total = rows.reduce((t, r) => t + r.amount, 0);
    if (total > 0) {
      const rj = postJournal({ date: rc.date, memo: `Rebate on ${rc.receipt_no} — ${sale.booking_id || sale.sale_no}`, refType: 'developer_rebate', refId: receiptId, projectId: sale.project_id, userId: req.user.id,
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
    const rid = receivePayment({ contact_id: sale.contact_id, sale_id: sale.id, amount: inp.amount, method: inp.method, txn_id: inp.txn_id, bank: inp.bank, cheque_no: inp.cheque_no,
      reference_no: inp.reference_no, date: inp.date, payment_type: type, developerApproval: true,
      notes: ['Approved by the developer, recorded by staff', inp.notes].filter(Boolean).join('. ') }, req);
    logFileEvent(sale.id, 'payment_approved', { user: req.user, amount: int(inp.amount), note: 'recorded by staff' });
    const out = postPaymentRebate(rid, req);
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
    const jid = postJournal({ date, memo: `Rebate received from developer${inp.reference_no ? ` — ${inp.reference_no}` : ''}`, refType: 'developer_rebate_payment', refId: developerId, userId: req.user.id,
      lines: [{ account: acc.id, debit: total }, { account: '1350', credit: total }] });
    for (const x of rows) run("UPDATE developer_rebates SET status='received', received_journal_id=?, received_on=?, received_method=?, reference_no=? WHERE id=?", jid, date, method, inp.reference_no ?? null, x.id);
    audit(req, 'Recorded developer rebate payment', 'developer', developerId, `${curCode()} ${total} (${rows.length} rebates)`);
    return { received: total, count: rows.length, journal_id: jid };
  });
}
