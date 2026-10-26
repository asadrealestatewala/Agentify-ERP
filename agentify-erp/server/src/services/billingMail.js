// Billing mail: every message about money (receipts, payment confirmations, renewal notices) is sent from the billing address,
// replies land in the billing inbox (a Resend inbox shown in the console Mailbox), and each recorded payment gets exactly one
// receipt. Receipts are remembered in `billing_receipts` (unique key per payment) so a retried webhook, a double click or a
// restart can never send a second one. A receipt holds amount, plan, date and reference only: no card data, links or secrets.
import { platformDb } from '../platform.js';
import { getSetting } from './platformConfig.js';
import { setBillingIdentity, sendMail, layout, mailReady } from './mailer.js';
import { PLANS } from './plans.js';

export const DEFAULT_BILLING_ADDRESS = 'billing@agentifyerp.co';
/** The billing mailbox address (console can override it with the `billing_mail_address` setting or BILLING_MAIL_ADDRESS). */
export const billingAddress = () => {
  const v = String((() => { try { return getSetting('billing_mail_address'); } catch { return ''; } })() || process.env.BILLING_MAIL_ADDRESS || '').trim().toLowerCase();
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/.test(v) ? v : DEFAULT_BILLING_ADDRESS;
};
export const billingFrom = () => `Agentify ERP Billing <${billingAddress()}>`;
setBillingIdentity(() => ({ from: billingFrom(), replyTo: billingAddress() }));

const SCHEMA = `CREATE TABLE IF NOT EXISTS billing_receipts(
  id INTEGER PRIMARY KEY, receipt_key TEXT NOT NULL UNIQUE, tenant_id INTEGER, to_addr TEXT, amount INTEGER, currency TEXT, plan TEXT, interval TEXT, method TEXT,
  reference TEXT, paid_on TEXT, period_end TEXT, status TEXT NOT NULL DEFAULT 'pending', error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT);
CREATE INDEX IF NOT EXISTS idx_billing_receipts_tenant ON billing_receipts(tenant_id, id);`;
let ready = false;
const db = () => { const d = platformDb(); if (!ready) { d.exec(SCHEMA); ready = true; } return d; };

const money = (amount, currency) => `${String(currency || '').toUpperCase()} ${Number(amount || 0).toLocaleString('en-US')}`.trim();

function compose(r, tenantName) {
  const planName = PLANS[r.plan]?.name || r.plan;
  const lines = [
    `We have received your payment of ${money(r.amount, r.currency)} for ${tenantName}. Thank you.`,
    `Amount: ${money(r.amount, r.currency)}`,
    ...(planName ? [`Plan: ${planName}${r.interval ? ` (${r.interval === 'year' ? 'yearly' : 'monthly'})` : ''}`] : []),
    `Paid on: ${r.paid_on}`,
    ...(r.method ? [`Payment method: ${r.method}`] : []),
    `Reference: ${r.reference}`,
    ...(r.period_end ? [`Your plan is paid up to ${r.period_end}.`] : []),
  ];
  return layout({ brand: 'platform', heading: 'Payment received successfully', lines, footer: `Have a question? Mail us at ${billingAddress()}` });
}

async function deliver(row) {
  const d = db();
  const tenant = row.tenant_id ? d.prepare('SELECT name FROM tenants WHERE id=?').get(row.tenant_id) : null;
  d.prepare('UPDATE billing_receipts SET attempts=attempts+1 WHERE id=?').run(row.id);
  let ok = false, error = null;
  if (!row.to_addr) error = 'No email address to send the receipt to';
  else {
    try { ok = await sendMail({ type: 'billing', workspaceId: row.tenant_id, to: row.to_addr, subject: `Payment received: ${money(row.amount, row.currency)} (${row.reference})`, ...compose(row, tenant?.name || 'your workspace') }); }
    catch (e) { error = e.message; }
    if (!ok && !error) error = mailReady() ? 'The email provider did not accept the message' : 'No email provider key is saved, so nothing was sent';
  }
  d.prepare("UPDATE billing_receipts SET status=?, error=?, sent_at=CASE WHEN ? THEN datetime('now') ELSE sent_at END WHERE id=?").run(ok ? 'sent' : 'failed', ok ? null : error, ok ? 1 : 0, row.id);
  return ok;
}

/**
 * One receipt per payment. `key` names the payment (e.g. `local:12`, `invoice:stripe:in_1`); the first call inserts the row
 * synchronously and sends, every later call with the same key does nothing. Never throws into the payment path.
 */
export async function sendPaymentReceipt(key, p) {
  try {
    const d = db();
    const amount = Math.round(Number(p.amount) || 0);
    if (!key || amount <= 0 || !p.reference) return { sent: false, skipped: true };
    const ins = d.prepare('INSERT OR IGNORE INTO billing_receipts(receipt_key,tenant_id,to_addr,amount,currency,plan,interval,method,reference,paid_on,period_end) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(String(key), p.tenant_id ?? null, p.to || null, amount, String(p.currency || '').toUpperCase(), p.plan || null, p.interval || null, p.method || null, String(p.reference).slice(0, 120), p.paid_on || new Date().toISOString().slice(0, 10), p.period_end || null);
    if (!ins.changes) return { sent: false, duplicate: true };
    const row = d.prepare('SELECT * FROM billing_receipts WHERE receipt_key=?').get(String(key));
    return { sent: await deliver(row), id: row.id };
  } catch (e) { console.error('[billing receipt]', e.message); return { sent: false, error: e.message }; }
}

export function listReceipts({ tenant, status, limit = 100 } = {}) {
  const w = [], a = [];
  if (tenant) { w.push('r.tenant_id=?'); a.push(Number(tenant)); }
  if (status) { w.push('r.status=?'); a.push(String(status)); }
  return db().prepare(`SELECT r.*, t.name tenant_name, t.slug FROM billing_receipts r LEFT JOIN tenants t ON t.id=r.tenant_id ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT ?`).all(...a, Math.min(500, Number(limit) || 100));
}
/** Send a receipt again on request (a failed one, or the customer lost it). Allowed only for receipts that exist. */
export async function resendReceipt(id) {
  const row = db().prepare('SELECT * FROM billing_receipts WHERE id=?').get(Number(id));
  return row ? { found: true, sent: await deliver(row) } : { found: false };
}
