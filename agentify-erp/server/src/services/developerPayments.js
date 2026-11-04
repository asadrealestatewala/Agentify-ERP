// Developer partner portal, write side: a developer approves or rejects the customer payments reported on their own files,
// reads a rebate statement and downloads reports. Scope always comes from the session (developer_id), never from the request.
// Approving records the payment as a receipt that clears account 2610 (Developer clearing): no company cash moves.
import { all, get, run, tx } from '../db.js';
import { bad, notFound, now, int, jparse, moneyText } from '../util.js';
import { audit, notify, notifyPerm } from '../audit.js';
import { receivePayment } from './payments.js';
import { claimRef, OPEN } from './claims.js';
import { logFileEvent } from './developers.js';
import { postPaymentRebate, rebateLedger } from './developerRebates.js';

const pkr = (n) => moneyText(Math.round(Number(n || 0)));

/** The developer must be active to act; reading stays open so a paused developer still sees their history. */
export function assertActiveDeveloper(developerId) {
  const d = get('SELECT status FROM developers WHERE id=?', developerId);
  if (!d) throw notFound('Developer not found');
  if (d.status !== 'active') throw bad('Your developer account is inactive. Please contact the company.');
}

const claimOnMyFile = (developerId, id) => get(`SELECT c.*, s.booking_id, s.sale_no, s.property_id, s.holder, s.status sale_status
  FROM payment_claims c JOIN sales s ON s.id=c.sale_id WHERE c.id=? AND s.developer_id=?`, id, developerId) || (() => { throw notFound('Payment not found'); })();

/** Customer-reported payments on this developer's files. Only allow-listed fields: a display name, never contact details. */
export function paymentsFor(developerId, status) {
  const where = status === 'open' ? `AND c.status IN ('pending','verifying')` : ['approved', 'rejected'].includes(status) ? `AND c.status='${status}'` : '';
  return all(`SELECT c.id, c.amount, c.method, c.txn_id, c.paid_date, c.status, c.reject_reason, c.created_at, c.decided_at, c.installment_ids, c.slip_path,
      s.id file_id, s.booking_id, COALESCE(p.title, s.title) plot, ct.full_name customer_name
    FROM payment_claims c JOIN sales s ON s.id=c.sale_id JOIN contacts ct ON ct.id=c.contact_id LEFT JOIN properties p ON p.id=s.property_id
    WHERE s.developer_id=? AND s.holder='customer' ${where} ORDER BY (c.status IN ('pending','verifying')) DESC, c.id DESC LIMIT 300`, developerId)
    .map(({ slip_path, installment_ids, ...c }) => ({ ...c, ref: claimRef(c.id), has_slip: !!slip_path, installment_ids: undefined,
      dues: jparse(installment_ids, []).length ? all(`SELECT kind, seq, due_date FROM installments WHERE id IN (${jparse(installment_ids, []).map(() => '?').join(',')}) ORDER BY due_date`, ...jparse(installment_ids, [])) : [] }));
}

export function slipRef(developerId, id) { return claimOnMyFile(developerId, id).slip_path || null; }

export function approvePayment(req, id, body = {}) {
  const dev = req.user.developer_id;
  assertActiveDeveloper(dev);
  const c = claimOnMyFile(dev, id);
  if (c.holder !== 'customer') throw bad('This file is now held by the company, so the company handles its payments');
  if (!OPEN.includes(c.status)) throw bad('This payment was already decided');
  const amount = int(body.amount) || c.amount;
  if (amount <= 0 || amount > c.amount) throw bad('You can approve the amount the customer reported, or less if you received less');
  const note = String(body.note || '').trim().slice(0, 300);
  // settle the stage the customer said they paid (booking / balloon / installment), so the rebate rate of that stage applies
  const ids = jparse(c.installment_ids, []);
  const kinds = new Set(ids.length ? all(`SELECT kind FROM installments WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((i) => i.kind) : []);
  const type = kinds.size === 1 && (kinds.has('booking') || kinds.has('advance')) ? 'Booking Payment' : kinds.size === 1 && kinds.has('balloon') ? 'Balloon Payment' : 'Installment';
  return tx(() => {
    const rid = receivePayment({ contact_id: c.contact_id, sale_id: c.sale_id, amount, method: c.method, txn_id: c.txn_id, bank: c.bank, cheque_no: c.cheque_no, date: c.paid_date,
      payment_type: type, developerApproval: true,
      notes: `Approved by the developer (${claimRef(id)}) ${req.user.name}.${note ? ` ${note}` : ''}` }, req);
    postPaymentRebate(rid, req);
    run("UPDATE payment_claims SET status='approved', receipt_id=?, decided_by=?, decided_at=?, received_amount=?, verified_channel='Developer approval', verified_note=?, verified_by=?, verified_at=? WHERE id=?",
      rid, req.user.id, now(), amount, note || null, req.user.id, now(), id);
    logFileEvent(c.sale_id, 'payment_approved', { user: req.user, amount, note: claimRef(id) });
    audit(req, 'Developer approved customer payment', 'payment_claim', id, `${claimRef(id)} ${c.booking_id} ${pkr(amount)} ip ${req.ip || ''}`);
    notify(all('SELECT id FROM users WHERE contact_id=? AND active=1', c.contact_id).map((u) => u.id), 'payment', 'Payment confirmed', `${claimRef(id)} · ${pkr(amount)} was approved by the developer.`, '/portal/payments');
    notifyPerm('payments', 'view', 'payment', 'Developer approved a payment', `${c.booking_id}: ${pkr(amount)} (${claimRef(id)})`, '/payments/claims');
    return { receipt_id: rid };
  });
}

export function rejectPayment(req, id, reason) {
  const dev = req.user.developer_id;
  assertActiveDeveloper(dev);
  const c = claimOnMyFile(dev, id);
  if (c.holder !== 'customer') throw bad('This file is now held by the company, so the company handles its payments');
  if (!OPEN.includes(c.status)) throw bad('This payment was already decided');
  const why = String(reason || '').trim();
  if (!why) throw bad('Tell the customer why: a reason is required');
  run("UPDATE payment_claims SET status='rejected', reject_reason=?, decided_by=?, decided_at=? WHERE id=?", why.slice(0, 400), req.user.id, now(), id);
  logFileEvent(c.sale_id, 'payment_rejected', { user: req.user, amount: c.amount, note: why.slice(0, 200) });
  audit(req, 'Developer declined customer payment', 'payment_claim', id, `${claimRef(id)} ${c.booking_id}: ${why}`);
  notify(all('SELECT id FROM users WHERE contact_id=? AND active=1', c.contact_id).map((u) => u.id), 'payment', 'Payment could not be confirmed', `${claimRef(id)} · ${pkr(c.amount)}: ${why}`, '/portal/payments');
  notifyPerm('payments', 'view', 'payment', 'Developer declined a payment', `${c.booking_id}: ${pkr(c.amount)} (${claimRef(id)}): ${why}`, '/payments/claims');
}

/**
 * What the developer owes the company, one row per approved payment, read from the rebates already posted to the books
 * (so it always matches the accounts). `rebate` is the amount earned; `rebate_status` says whether the developer has paid it.
 */
export function rebateStatement(developerId, { from, to } = {}) {
  const byReceipt = new Map();
  for (const x of rebateLedger(developerId).rows) {
    if (x.status === 'reversed' || (from && x.payment_date < from) || (to && x.payment_date > to)) continue;
    const row = byReceipt.get(x.receipt_no) || { date: x.payment_date, booking_id: x.booking_id, plot: x.plot_title || '', customer_name: x.customer_name || '', receipt_no: x.receipt_no,
      method: get('SELECT method FROM receipts WHERE receipt_no=?', x.receipt_no)?.method, amount: 0, rebate: 0, paid: 0 };
    row.amount += x.base_amount; row.rebate += x.amount; if (x.status === 'received') row.paid += x.amount;
    byReceipt.set(x.receipt_no, row);
  }
  const rows = [...byReceipt.values()].map((r) => ({ ...r, rebate_status: r.paid >= r.rebate ? 'received' : r.paid ? 'part paid' : 'due' })).sort((a, b) => b.date.localeCompare(a.date));
  const total_rebate = rows.reduce((a, r) => a + r.rebate, 0), rebate_received = rows.reduce((a, r) => a + r.paid, 0);
  return { rows, total_received: rows.reduce((a, r) => a + r.amount, 0), total_rebate, rebate_received, rebate_due: total_rebate - rebate_received };
}
