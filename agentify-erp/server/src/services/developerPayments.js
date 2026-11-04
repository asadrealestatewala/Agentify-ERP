// Developer partner portal, write side: a developer approves or rejects the customer payments reported on their own files,
// reads a rebate statement and downloads reports. Scope always comes from the session (developer_id), never from the request.
// Approving records the payment as a receipt that clears account 2610 (Developer clearing): no company cash moves.
import { all, get, run, tx } from '../db.js';
import { bad, notFound, now, int, jparse, moneyText } from '../util.js';
import { audit, notify, notifyPerm } from '../audit.js';
import { receivePayment } from './payments.js';
import { claimRef, OPEN } from './claims.js';
import { logFileEvent, plotRebateAmount } from './developers.js';

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
 * Rebate on one received amount: the plot's own rebate (spread across the contract in proportion to what was paid) when set,
 * otherwise the agreement's per-stage rate for the installment kinds the payment settled.
 */
export function rebateOnPayment(sale, prop, agreement, allocations) {
  const paid = allocations.reduce((a, x) => a + x.amount, 0);
  if (prop?.rebate_type) return sale.net_price > 0 ? Math.round(plotRebateAmount({ ...prop, net_price: prop.net_price ?? sale.net_price }) * paid / sale.net_price) : 0;
  if (!agreement) return 0;
  const rate = { booking: agreement.rebate_down_pct, advance: agreement.rebate_down_pct, installment: agreement.rebate_installment_pct, balloon: agreement.rebate_balloon_pct };
  return Math.round(allocations.reduce((a, x) => a + x.amount * (Number(rate[x.kind]) || 0) / 100, 0));
}

/** What the developer owes the company, per approved payment. Informational: it does not record that the developer has paid it. */
export function rebateStatement(developerId, { from, to } = {}) {
  const rows = [];
  for (const sale of all("SELECT * FROM sales WHERE developer_id=? AND status IN ('confirmed','cancelled') ORDER BY id", developerId)) {
    const prop = get('SELECT * FROM properties WHERE id=?', sale.property_id);
    const ag = sale.agreement_id ? get('SELECT * FROM developer_agreements WHERE id=?', sale.agreement_id) : null;
    for (const r of all("SELECT r.id, r.date, r.method FROM receipts r JOIN receipt_sales rs ON rs.receipt_id=r.id WHERE rs.sale_id=? AND r.status='valid' ORDER BY r.date, r.id", sale.id)) {
      if ((from && r.date < from) || (to && r.date > to)) continue;
      const allocs = all('SELECT i.kind, ra.amount FROM receipt_allocations ra JOIN installments i ON i.id=ra.installment_id WHERE ra.receipt_id=? AND i.sale_id=?', r.id, sale.id);
      const amount = get('SELECT amount FROM receipt_sales WHERE receipt_id=? AND sale_id=?', r.id, sale.id)?.amount || 0;
      rows.push({ date: r.date, booking_id: sale.booking_id, plot: prop?.title || sale.title || '', customer_name: sale.holder === 'company' ? 'Company' : get('SELECT full_name FROM contacts WHERE id=?', sale.contact_id)?.full_name || '',
        method: r.method, amount, rebate: rebateOnPayment(sale, prop, ag, allocs) });
    }
  }
  return { rows, total_received: rows.reduce((a, r) => a + r.amount, 0), total_rebate: rows.reduce((a, r) => a + r.rebate, 0) };
}
