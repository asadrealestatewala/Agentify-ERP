import crypto from 'node:crypto';
import { all, get, getSetting, run, setSetting, tx } from '../db.js';
import { bad, int, jparse, notFound, now, today, moneyText } from '../util.js';
import { audit, notify, notifyPerm } from '../audit.js';
import { PAYMENT_METHODS, receivePayment } from './payments.js';

/**
 * Customer payments, from "I have paid" to a receipt.
 *
 *   Due / Overdue  →  In process (customer reported it, proof on its way)  →  Under verification (finance has the proof and is
 *   checking the bank / wallet)  →  Paid (finance confirms: the receipt voucher is issued, the ledger moves, the portal shows it)
 *
 * The proof (slip / screenshot) normally goes to the company WhatsApp number — the portal builds the message. Confirmation is
 * either manual (finance records where it was verified) or automatic: bank / wallet transactions that arrive through the
 * statement import or the payment-feed webhook are matched to open reports by transaction ID and amount.
 */

export const OPEN = ['pending', 'verifying'];
const ONLINE = ['Bank Transfer', 'Online Transfer', 'JazzCash', 'Easypaisa'];
export const claimRef = (id) => `CLM-${String(id).padStart(5, '0')}`;
export const normTxn = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const pkr = (n) => `${moneyText(Math.round(Number(n || 0)))}`;
const customerUsers = (contactId) => all('SELECT id FROM users WHERE contact_id=? AND active=1', contactId).map((u) => u.id);

/** The company WhatsApp number in international form (0300… → 92300…). */
export function companyWhatsApp() {
  const c = jparse(getSetting('site_config'), {}).contact || {};
  let n = String(c.whatsapp || c.phone || getSetting('company_phone', '')).replace(/[^\d]/g, '');
  if (n.startsWith('00')) n = n.slice(2); else if (n.startsWith('0')) n = `92${n.slice(1)}`;
  return n || null;
}
function waUrl(c) {
  const num = companyWhatsApp(); if (!num) return null;
  const text = `Payment proof — ref ${claimRef(c.id)}\nCustomer: ${c.customer}${c.customer_code ? ` (${c.customer_code})` : ''}\nPlan: ${c.property || ''} ${c.sale_no ? `(${c.sale_no})` : ''}\nAmount: ${pkr(c.amount)} via ${c.method}${c.txn_id ? `\nTransaction ID: ${c.txn_id}` : ''}${c.dues_text ? `\nFor: ${c.dues_text}` : ''}\n(slip / screenshot attached)`;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}
const duesText = (ids) => (ids.length ? all(`SELECT i.seq,i.kind,i.due_date FROM installments i WHERE i.id IN (${ids.map(() => '?').join(',')}) ORDER BY i.due_date`, ...ids).map((i) => `${i.kind} #${i.seq} due ${i.due_date}`).join(', ') : '');

// ---------------------------------------------------------------- customer side
/** Open installments of the customer with their state (overdue, due soon, upcoming, in process, under verification). */
export function dues(contactId) {
  const t = today();
  const days = Number(getSetting('installment_reminder_days', 7)) || 7;
  const rows = all(`SELECT i.id, i.sale_id, i.seq, i.kind, i.due_date, i.amount - i.paid remaining, s.sale_no, COALESCE(s.title, p.title) title, s.kind sale_kind
    FROM installments i JOIN sales s ON s.id=i.sale_id LEFT JOIN properties p ON p.id=s.property_id
    WHERE s.contact_id=? AND s.status='confirmed' AND i.status<>'paid' AND i.amount - i.paid > 0 ORDER BY i.due_date, i.id`, contactId);
  const byInst = claimStateByInstallment(contactId);
  const perSale = {};
  const out = [];
  for (const i of rows) {
    const c = byInst.get(i.id);
    const gap = Math.round((new Date(i.due_date) - new Date(t)) / 864e5);
    const state = c ? (c.status === 'verifying' ? 'verifying' : 'in_process') : i.due_date < t ? 'overdue' : gap <= days ? 'due' : 'upcoming';
    if (state === 'upcoming') { perSale[i.sale_id] = (perSale[i.sale_id] || 0) + 1; if (perSale[i.sale_id] > 3) continue; }
    out.push({ ...i, state, days: gap, claim_id: c?.id || null, claim_ref: c ? claimRef(c.id) : null, wa_url: c?.wa_url || null });
  }
  return out;
}

/** installment id → its open report (so tables can show "In process" / "Under verification"). */
export function claimStateByInstallment(contactId) {
  const m = new Map();
  for (const c of ownClaims(contactId).filter((x) => OPEN.includes(x.status))) for (const id of c.installment_ids) if (!m.has(id)) m.set(id, c);
  return m;
}

export function submitClaim(req, body, slipPath) {
  const contactId = req.user.contact_id;
  const ids = [...new Set((Array.isArray(body.installment_ids) ? body.installment_ids : String(body.installment_ids || '').split(',')).map((x) => int(x)).filter(Boolean))];
  let sale;
  if (ids.length) {
    const rows = all(`SELECT i.id, i.sale_id, i.amount - i.paid remaining FROM installments i JOIN sales s ON s.id=i.sale_id WHERE i.id IN (${ids.map(() => '?').join(',')}) AND s.contact_id=? AND s.status='confirmed' AND i.status<>'paid'`, ...ids, contactId);
    if (rows.length !== ids.length) throw notFound('One of the selected payments was not found or is already paid');
    if (new Set(rows.map((r) => r.sale_id)).size > 1) throw bad('Please report one plan at a time (plot and house payments separately)');
    sale = get("SELECT s.id, s.sale_no, COALESCE(s.title, p.title) title, s.net_price, s.paid_amount FROM sales s LEFT JOIN properties p ON p.id=s.property_id WHERE s.id=?", rows[0].sale_id);
    const busy = ownClaims(contactId).filter((c) => OPEN.includes(c.status)).find((c) => c.installment_ids.some((x) => ids.includes(x)));
    if (busy) throw bad(`A payment for this installment is already being processed (${claimRef(busy.id)})`);
    if (!int(body.amount)) body.amount = rows.reduce((a, r) => a + r.remaining, 0);
  } else {
    sale = get("SELECT s.id, s.sale_no, COALESCE(s.title, p.title) title, s.net_price, s.paid_amount FROM sales s LEFT JOIN properties p ON p.id=s.property_id WHERE s.id=? AND s.contact_id=? AND s.status='confirmed'", int(body.sale_id), contactId);
    if (!sale) throw notFound('That property or contract was not found');
  }
  const amount = int(body.amount);
  if (amount <= 0) throw bad('Enter the amount you paid');
  if (amount > sale.net_price - sale.paid_amount + 1) throw bad('The amount is more than the balance of this plan — please check it');
  const method = String(body.method || '');
  if (!PAYMENT_METHODS.includes(method)) throw bad('Choose how you paid');
  const txn = String(body.txn_id || '').trim().slice(0, 80), bank = String(body.bank || '').trim().slice(0, 80), chq = String(body.cheque_no || '').trim().slice(0, 40);
  if (ONLINE.includes(method) && (!txn || !bank)) throw bad('Enter the transaction ID and the bank / channel you paid from');
  if (method === 'Cheque' && (!chq || !bank)) throw bad('Enter the cheque number and bank');
  const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.paid_date || '')) ? body.paid_date : today();
  if (paidDate > today()) throw bad('The payment date cannot be in the future');
  if (txn && all("SELECT txn_id FROM payment_claims WHERE status IN ('pending','verifying','approved') AND txn_id IS NOT NULL").some((c) => normTxn(c.txn_id) === normTxn(txn))) throw bad('This transaction ID was already submitted');
  if (txn && get("SELECT 1 FROM receipts WHERE txn_id=? AND status='valid'", txn)) throw bad('This transaction has already been recorded as a receipt');
  const id = Number(run(`INSERT INTO payment_claims(contact_id,sale_id,amount,method,txn_id,bank,cheque_no,paid_date,note,slip_path,installment_ids,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
    contactId, sale.id, amount, method, txn || null, bank || null, chq || null, paidDate, String(body.note || '').trim().slice(0, 500) || null, slipPath || null, JSON.stringify(ids), req.user.id, now()).lastInsertRowid);
  const who = get('SELECT full_name FROM contacts WHERE id=?', contactId)?.full_name;
  notifyPerm('payments', 'create', 'payment', 'Customer payment to verify', `${claimRef(id)} · ${who}: ${pkr(amount)} via ${method} for ${sale.title || sale.sale_no}`, '/payments/claims');
  audit(req, 'Customer reported a payment', 'payment_claim', id, `${claimRef(id)} ${who} ${pkr(amount)} ${method}`);
  matchClaimToFeed(id);
  return { id, ref: claimRef(id), wa_url: ownClaims(contactId).find((c) => c.id === id)?.wa_url || null };
}

export function ownClaims(contactId) {
  return all(`SELECT c.id, c.amount, c.method, c.txn_id, c.paid_date, c.status, c.reject_reason, c.created_at, c.decided_at, c.proof_sent_at, c.installment_ids, c.slip_path, c.contact_id,
      COALESCE(s.title, p.title) property, s.sale_no, r.id receipt_id, r.receipt_no, ct.full_name customer, ct.customer_code
    FROM payment_claims c JOIN sales s ON s.id=c.sale_id JOIN contacts ct ON ct.id=c.contact_id LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN receipts r ON r.id=c.receipt_id
    WHERE c.contact_id=? ORDER BY c.id DESC LIMIT 40`, contactId).map(({ slip_path, contact_id, ...c }) => {
    const ids = jparse(c.installment_ids, []);
    const row = { ...c, installment_ids: ids, ref: claimRef(c.id), has_slip: !!slip_path };
    return { ...row, dues_text: duesText(ids), wa_url: OPEN.includes(c.status) ? waUrl({ ...row, dues_text: duesText(ids) }) : null };
  }).map(({ dues_text, customer, customer_code, ...c }) => c);
}

/** The customer says the proof has been sent on WhatsApp — finance is told so they know to look. */
export function proofSent(req, id) {
  const c = get('SELECT * FROM payment_claims WHERE id=? AND contact_id=?', id, req.user.contact_id);
  if (!c) throw notFound('Submission not found');
  if (!OPEN.includes(c.status)) throw bad('This payment was already decided');
  if (!c.proof_sent_at) {
    run('UPDATE payment_claims SET proof_sent_at=? WHERE id=?', now(), id);
    const who = get('SELECT full_name FROM contacts WHERE id=?', c.contact_id)?.full_name;
    notifyPerm('payments', 'create', 'payment', 'Payment proof sent on WhatsApp', `${claimRef(id)} · ${who}: ${pkr(c.amount)} — check WhatsApp and the bank / wallet`, '/payments/claims');
  }
}

// ---------------------------------------------------------------- finance side
export function allClaims(status) {
  const where = status === 'open' ? `WHERE c.status IN ('pending','verifying')` : status ? 'WHERE c.status=?' : '';
  return all(`SELECT c.*, ct.full_name customer, ct.customer_code, ct.phone, COALESCE(s.title, p.title) property, s.sale_no, s.net_price, s.paid_amount, r.receipt_no, u.name decided_by_name, f.channel feed_channel, f.paid_date feed_date
    FROM payment_claims c JOIN contacts ct ON ct.id=c.contact_id JOIN sales s ON s.id=c.sale_id LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN receipts r ON r.id=c.receipt_id LEFT JOIN users u ON u.id=c.decided_by LEFT JOIN payment_feed f ON f.id=c.feed_id
    ${where} ORDER BY (c.status IN ('pending','verifying')) DESC, c.auto_matched DESC, c.id DESC LIMIT 200`, ...(status && status !== 'open' ? [status] : []))
    .map((c) => ({ ...c, ref: claimRef(c.id), installment_ids: jparse(c.installment_ids, []), dues: duesText(jparse(c.installment_ids, [])), has_slip: !!c.slip_path, slip_path: undefined }));
}

/** Finance has the proof and is checking the bank / wallet: the customer sees "Under verification". */
export function startVerifying(id, req) {
  const c = get('SELECT * FROM payment_claims WHERE id=?', id);
  if (!c) throw notFound('Submission not found');
  if (c.status !== 'pending') throw bad('This payment is not waiting for verification');
  run("UPDATE payment_claims SET status='verifying', verifying_at=? WHERE id=?", now(), id);
  notify(customerUsers(c.contact_id), 'payment', 'Payment under verification', `${claimRef(id)} · ${pkr(c.amount)}: we have your proof and are confirming it with the bank / wallet.`, '/portal/payments');
  audit(req, 'Payment moved to verification', 'payment_claim', id, claimRef(id));
}

/**
 * Confirm the payment: record where it was verified, issue the receipt voucher (allocated to the installments) and tell the customer.
 * `body`: account_id, verified_channel, verified_ref, verified_note, amount (if the bank shows a different amount), received_date.
 */
export function approveClaim(id, body, req, { auto = false } = {}) {
  const c = get('SELECT * FROM payment_claims WHERE id=?', id);
  if (!c) throw notFound('Submission not found');
  if (!OPEN.includes(c.status)) throw bad('This payment was already decided');
  if (!body.account_id) throw bad('Choose the account the money was deposited to');
  const channel = String(body.verified_channel || '').trim();
  if (!channel) throw bad('Say where you verified the payment (bank portal, Easypaisa, JazzCash, …)');
  const amount = int(body.amount) || c.amount;
  if (amount <= 0) throw bad('Enter the amount received');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.received_date || '')) ? body.received_date : c.paid_date;
  const ref = String(body.verified_ref || '').trim().slice(0, 100), note = String(body.verified_note || '').trim().slice(0, 300);
  return tx(() => {
    const rid = receivePayment({ contact_id: c.contact_id, sale_id: c.sale_id, amount, method: c.method, txn_id: c.txn_id, bank: c.bank, cheque_no: c.cheque_no, date, account_id: int(body.account_id), payment_type: 'Installment',
      notes: `Reported by the customer on the portal (${claimRef(id)}). ${auto ? 'Verified automatically' : 'Verified'} on ${channel}${ref ? ` — ref ${ref}` : ''}${req.user ? ` by ${req.user.name}` : ''}.${note ? ` ${note}` : ''}` }, req);
    run("UPDATE payment_claims SET status='approved', receipt_id=?, decided_by=?, decided_at=?, received_amount=?, verified_channel=?, verified_ref=?, verified_note=?, verified_by=?, verified_at=?, auto_synced=? WHERE id=?",
      rid, req.user?.id ?? null, now(), amount, channel, ref || null, note || null, req.user?.id ?? null, now(), auto ? 1 : 0, id);
    audit(req, auto ? 'Auto-approved customer payment (feed match)' : 'Approved customer payment submission', 'payment_claim', id, `${claimRef(id)} ${channel} ${ref}`);
    return rid;
  });
}

export function rejectClaim(id, reason, req) {
  const c = get('SELECT * FROM payment_claims WHERE id=?', id);
  if (!c) throw notFound('Submission not found');
  if (!OPEN.includes(c.status)) throw bad('This payment was already decided');
  const why = String(reason || '').trim();
  if (!why) throw bad('Tell the customer why — a reason is required');
  run("UPDATE payment_claims SET status='rejected', reject_reason=?, decided_by=?, decided_at=? WHERE id=?", why.slice(0, 400), req.user.id, now(), id);
  notify(customerUsers(c.contact_id), 'payment', 'Payment could not be confirmed', `${claimRef(id)} · ${pkr(c.amount)}: ${why}`, '/portal/payments');
  audit(req, 'Declined customer payment submission', 'payment_claim', id, why);
}

// ---------------------------------------------------------------- bank / wallet feed (auto-sync)
export function syncSettings({ regenerate = false } = {}) {
  let key = getSetting('payment_feed_key');
  if (!key || regenerate) { key = crypto.randomBytes(24).toString('hex'); setSetting('payment_feed_key', key); }
  return { feed_key: key, auto_approve: getSetting('payment_auto_approve') === '1' };
}
export const setAutoApprove = (on) => setSetting('payment_auto_approve', on ? '1' : '0');
export const feedKeyOk = (k) => { const key = getSetting('payment_feed_key'); if (!key || !k) return false; const a = Buffer.from(String(k)), b = Buffer.from(key); return a.length === b.length && crypto.timingSafeEqual(a, b); };

export const depositAccount = (method) => {
  const type = method === 'Cash' ? 'cash' : ['Bank Transfer', 'Cheque'].includes(method) ? 'bank' : 'online';
  return get('SELECT id FROM accounts WHERE subtype=? ORDER BY id LIMIT 1', type)?.id || get("SELECT id FROM accounts WHERE subtype='bank' ORDER BY id LIMIT 1")?.id;
};
export const systemActor = () => { const u = get("SELECT u.id,u.name,r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 AND r.name IN ('Finance Manager','Super Admin') ORDER BY (r.name='Finance Manager') DESC, u.id LIMIT 1"); return u ? { user: { ...u }, ip: 'payment-feed' } : null; };

/** Does an arrived bank / wallet transaction match an open customer report (same transaction ID and amount)? */
function matchFeedRow(f) {
  const claim = all("SELECT * FROM payment_claims WHERE status IN ('pending','verifying') AND feed_id IS NULL AND txn_id IS NOT NULL").find((c) => normTxn(c.txn_id) === f.txn_norm && c.amount === f.amount);
  if (!claim) return null;
  run('UPDATE payment_claims SET feed_id=?, auto_matched=1 WHERE id=?', f.id, claim.id);
  run('UPDATE payment_feed SET claim_id=? WHERE id=?', claim.id, f.id);
  let auto = false;
  if (getSetting('payment_auto_approve') === '1') {
    const actor = systemActor(), acc = depositAccount(claim.method);
    if (actor && acc) { try { approveClaim(claim.id, { account_id: acc, verified_channel: `Auto-sync · ${f.channel}`, verified_ref: f.txn_id, amount: f.amount, received_date: f.paid_date || undefined }, actor, { auto: true }); auto = true; } catch (e) { notifyPerm('payments', 'create', 'payment', 'Auto-approval failed', `${claimRef(claim.id)}: ${e.message}`, '/payments/claims'); } }
  }
  if (!auto) notifyPerm('payments', 'create', 'payment', 'Payment found in bank / wallet feed', `${claimRef(claim.id)} matches ${f.channel} transaction ${f.txn_id} (${pkr(f.amount)}) — ready to confirm`, '/payments/claims');
  return { claim_id: claim.id, auto };
}
/** A customer report that arrives after the money was already seen in the feed. */
function matchClaimToFeed(claimId) {
  const c = get('SELECT * FROM payment_claims WHERE id=?', claimId);
  if (!c?.txn_id) return;
  const f = all('SELECT * FROM payment_feed WHERE claim_id IS NULL').find((x) => x.txn_norm === normTxn(c.txn_id) && x.amount === c.amount);
  if (f) matchFeedRow(f);
}

/** Store bank / wallet transactions (credits only) and match them to open reports. Returns what happened to each. */
export function ingestFeed(entries, defaults = {}) {
  const out = { received: 0, new: 0, duplicate: 0, matched: [], auto_approved: [], unmatched: 0 };
  for (const e of entries) {
    const txn = String(e.txn_id || '').trim().slice(0, 80), amount = Math.round(Number(String(e.amount ?? '').replace(/,/g, '')));
    if (!txn || !(amount > 0)) continue;
    out.received++;
    const norm = normTxn(txn);
    if (get('SELECT 1 FROM payment_feed WHERE txn_norm=? AND amount=?', norm, amount)) { out.duplicate++; continue; }
    const channel = String(e.channel || defaults.channel || 'Bank').slice(0, 40);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) ? e.date : null;
    const id = Number(run('INSERT INTO payment_feed(channel,txn_id,txn_norm,amount,paid_date,sender,note,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)', channel, txn, norm, amount, date, String(e.sender || '').slice(0, 120) || null, String(e.note || '').slice(0, 200) || null, defaults.source || 'webhook', now()).lastInsertRowid);
    out.new++;
    const m = matchFeedRow(get('SELECT * FROM payment_feed WHERE id=?', id));
    if (m) { out.matched.push(m.claim_id); if (m.auto) out.auto_approved.push(m.claim_id); } else out.unmatched++;
  }
  return out;
}

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function isoDate(s) {
  const v = String(s || '').trim(); let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})/.exec(v)) && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
/** Parse a pasted / uploaded bank or wallet statement (CSV or tab separated) into feed entries; recognises common column names. */
export function parseStatement(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw bad('The statement needs a header row and at least one transaction');
  const delim = [',', '\t', ';', '|'].map((d) => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === delim && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const col = (re, not) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const iTxn = col(/(txn|transaction|trans|ref|utr|stan|reference|id)/, /(date|amount|balance)/), iAmt = col(/(credit|deposit|amount|received)/, /(debit|withdraw|balance)/), iDate = col(/date/), iFrom = col(/(sender|from|desc|narration|particular|remarks|detail)/);
  if (iTxn < 0 || iAmt < 0) throw bad('Could not find the transaction ID and amount columns — the header row should contain names like "Reference" / "Transaction ID" and "Credit" / "Amount"');
  return lines.slice(1).map((l) => { const c = split(l); return { txn_id: c[iTxn], amount: c[iAmt], date: iDate >= 0 ? isoDate(c[iDate]) : null, sender: iFrom >= 0 ? c[iFrom] : '' }; });
}
export const feedStats = () => ({ total: get('SELECT COUNT(*) n FROM payment_feed').n, matched: get('SELECT COUNT(*) n FROM payment_feed WHERE claim_id IS NOT NULL').n, last: get('SELECT created_at FROM payment_feed ORDER BY id DESC LIMIT 1')?.created_at || null });
export { customerUsers };
