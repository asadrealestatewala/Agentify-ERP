// Billing is provider-agnostic. A provider only has to do two things: send the customer to a hosted checkout, and call
// our webhook (below) when the subscription changes. Nothing here talks to a payment API directly, so any provider that
// supports hosted payment links plus webhooks (Paddle, Lemon Squeezy, Safepay, Stripe, ...) fits with a small adapter.
//
//   BILLING_PROVIDER=manual   (default) no online checkout; the operator records payments (bank transfer, invoices)
//   BILLING_PROVIDER=generic  hosted payment links from env: BILLING_CHECKOUT_URL_<PLAN>_<MONTH|YEAR>, e.g.
//                             BILLING_CHECKOUT_URL_GROWTH_MONTH=https://pay.example.com/growth-monthly
//                             and a signed webhook to POST /api/platform/billing/webhook/generic
//   BILLING_WEBHOOK_SECRET    HMAC secret the provider (or its adapter) signs webhooks with
import crypto from 'node:crypto';
import { PLANS, graceDays, assertSellable } from './plans.js';
import { recordSubscriptionChange } from './subscriptions.js';
import { bad, HttpError } from '../util.js';
import { platformDb, getTenant, getTenantBySlug, logTenantEvent } from '../platform.js';
import * as stripe from './stripe.js';
import { PROVIDERS } from '../gateways/providers.js';
import { platformGatewayOffers } from './platformGateways.js';
import { sendMail, layout } from './mailer.js';
import { quote, recordRedemption, setTenantAddon, recordRefund } from './commerce.js';
import { recordServerEvent } from './analytics.js';
import { sendPaymentReceipt } from './billingMail.js';

/** Explicit subscription states (see services/plans.js billingState). */
export const SUB_STATUSES = ['trialing', 'pending', 'active', 'past_due', 'canceled', 'expired'];
export const providerName = () => (process.env.BILLING_PROVIDER || 'manual').toLowerCase();

/** Where to send the customer to pay for `plan`. Returns { mode:'redirect', url } or { mode:'manual', instructions }. */
export function startCheckout(tenant, { plan, interval = 'month', email }) {
  assertSellable(plan, tenant);
  if (!['month', 'year'].includes(interval)) throw bad('Interval must be month or year');
  if (providerName() === 'generic') {
    const base = process.env[`BILLING_CHECKOUT_URL_${plan.toUpperCase()}_${interval.toUpperCase()}`];
    if (!base) throw new HttpError(503, 'Online checkout is not configured for this plan yet');
    const u = new URL(base);
    u.searchParams.set('client_reference_id', `${tenant.id}`); // echoed back in the webhook so we know whose payment it was
    if (email) u.searchParams.set('email', email);
    return { mode: 'redirect', url: u.toString() };
  }
  return { mode: 'manual', instructions: process.env.BILLING_MANUAL_INSTRUCTIONS || 'Online payment is not enabled yet. Contact us to activate your plan by bank transfer or invoice.' };
}

/** Constant-time check of `X-Signature: sha256=<hex>` over the exact bytes received. */
export function verifySignature(rawBody, header) {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, 'Billing webhooks are not configured');
  if (!rawBody || !header) return false;
  const want = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = String(header).replace(/^sha256=/, '');
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const iso = (d) => String(d || '').slice(0, 10) || null;
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/**
 * Apply one normalised event:
 *   { id, type, tenant_id | tenant_slug, plan?, interval?, period_end?, customer_id?, subscription_id?, invoice?: { id, amount, currency, status, url, period_start, period_end } }
 * Types: subscription.activated | subscription.renewed | subscription.canceled | payment.failed | invoice.paid
 * Replays are ignored (provider + event id is unique), so a provider retrying a webhook is harmless.
 */
export function applyBillingEvent(provider, ev) {
  if (!ev?.id || !ev?.type) throw bad('Event id and type are required');
  const tenant = ev.tenant_id ? getTenant(Number(ev.tenant_id)) : ev.tenant_slug ? getTenantBySlug(ev.tenant_slug) : null;
  if (!tenant) throw new HttpError(404, 'Unknown tenant');
  if (tenant.is_legacy) throw bad('The original workspace is not billed');
  const db = platformDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const dup = db.prepare('INSERT OR IGNORE INTO billing_events(provider,event_id,tenant_id,type,payload) VALUES(?,?,?,?,?)').run(provider, String(ev.id), tenant.id, ev.type, JSON.stringify(ev));
    if (!dup.changes) { db.exec('COMMIT'); return { applied: false, duplicate: true, tenant }; }
    const set = (fields) => {
      const keys = Object.keys(fields);
      db.prepare(`UPDATE tenants SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => fields[k]), tenant.id);
    };
    const ids = { billing_provider: provider, ...(ev.customer_id ? { provider_customer_id: String(ev.customer_id) } : {}), ...(ev.subscription_id ? { provider_subscription_id: String(ev.subscription_id) } : {}) };
    switch (ev.type) {
      case 'subscription.activated':
      case 'subscription.renewed': {
        const plan = ev.plan || tenant.plan;
        if (!PLANS[plan]) throw bad(`Unknown plan: ${plan}`);
        const price = ev.invoice?.amount != null ? { price_amount: Math.round(Number(ev.invoice.amount) || 0), price_currency: String(ev.invoice.currency || 'USD').toUpperCase() } : {};
        set({ ...ids, plan, subscription_status: 'active', current_period_end: iso(ev.period_end), billing_interval: ev.interval === 'year' ? 'year' : 'month', grace_until: null, ...price });
        break;
      }
      case 'subscription.canceled':
        set({ ...ids, subscription_status: 'canceled', current_period_end: iso(ev.period_end) || iso(tenant.current_period_end), canceled_at: tenant.canceled_at || new Date().toISOString() });
        break;
      case 'payment.refunded':
        // a refund made in the provider's dashboard: recorded once against the invoice; access is not changed by itself
        if (!ev.refund?.id || !ev.refund?.invoice) throw bad('Refund events need refund.id and refund.invoice');
        recordRefund(tenant.id, { provider_invoice_id: ev.refund.invoice, amount: ev.refund.amount, reason: ev.refund.reason || 'Refunded at the payment provider', provider, provider_refund_id: String(ev.refund.id) }, `webhook:${provider}`, db);
        break;
      case 'payment.failed':
        // keep access for a grace period; do not extend it if a retry fails again
        set({ ...ids, subscription_status: 'past_due', grace_until: tenant.subscription_status === 'past_due' && tenant.grace_until ? tenant.grace_until : addDays(graceDays(tenant.plan)) });
        break;
      case 'invoice.paid':
        // a late payment (past due, or already expired after the grace period) restores access
        if (['past_due', 'expired'].includes(tenant.subscription_status) && PLANS[tenant.plan]) set({ subscription_status: 'active', grace_until: null, ...(ev.invoice?.period_end ? { current_period_end: iso(ev.invoice.period_end) } : {}) });
        break;
      default: throw bad(`Unsupported event type: ${ev.type}`);
    }
    if (ev.invoice?.id) {
      const i = ev.invoice;
      db.prepare('INSERT OR REPLACE INTO invoices(tenant_id,provider_invoice_id,amount,currency,status,hosted_url,period_start,period_end,plan) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(tenant.id, String(i.id), Math.round(Number(i.amount) || 0), String(i.currency || 'USD').toUpperCase(), String(i.status || 'paid'), i.url || null, iso(i.period_start), iso(i.period_end), getTenant(tenant.id).plan || null);
    }
    recordSubscriptionChange(tenant, getTenant(tenant.id), { source: `webhook:${provider}`, reason: ev.type }, db);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  logTenantEvent(tenant.id, `billing:${ev.type}`, { provider, plan: ev.plan });
  // one receipt per paid invoice (the key is the provider's invoice id, so a retried webhook cannot send a second one)
  if (ev.invoice?.id && String(ev.invoice.status || 'paid') === 'paid' && Number(ev.invoice.amount) > 0) {
    const t2 = getTenant(tenant.id);
    void sendPaymentReceipt(`invoice:${provider}:${ev.invoice.id}`, { tenant_id: tenant.id, to: t2.owner_email, amount: ev.invoice.amount, currency: ev.invoice.currency || 'USD', plan: t2.plan, interval: t2.billing_interval, method: provider === 'stripe' ? 'Card' : provider, reference: ev.invoice.id, period_end: iso(ev.invoice.period_end) || iso(t2.current_period_end) });
  }
  if (ev.type === 'subscription.activated' && tenant.subscription_status !== 'active') recordServerEvent('subscription_activated', { product: PLANS[ev.plan || tenant.plan]?.product, plan: ev.plan || tenant.plan, tenant_id: tenant.id });
  return { applied: true, tenant: getTenant(tenant.id) };
}

/** Operator override for manual billing (bank transfer): set plan and status directly. */
export function setSubscription(tenantId, { plan, status = 'active', period_end, interval = 'month' }, { actor = null, reason = null } = {}) {
  const tenant = getTenant(tenantId);
  if (!tenant) throw new HttpError(404, 'Tenant not found');
  if (tenant.is_legacy) throw bad('The original workspace is not billed');
  if (!PLANS[plan]) throw bad('Unknown plan');
  if (!SUB_STATUSES.includes(status)) throw bad('Unknown subscription status');
  const int = interval === 'year' ? 'year' : 'month';
  const cur = PLANS[plan].price[tenant.currency] ? tenant.currency : 'PKR';
  const amount = PLANS[plan].price[cur]?.[int] ?? null;
  const db = platformDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE tenants SET plan=?, subscription_status=?, current_period_end=?, billing_interval=?, billing_provider='manual', grace_until=NULL, price_amount=?, price_currency=?, canceled_at=CASE WHEN ?='canceled' THEN COALESCE(canceled_at, ?) ELSE NULL END, updated_at=datetime('now') WHERE id=?")
      .run(plan, status, iso(period_end), int, amount, amount == null ? null : cur, status, new Date().toISOString(), tenantId);
    recordSubscriptionChange(tenant, getTenant(tenantId), { source: 'admin', actor, reason }, db);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  logTenantEvent(tenantId, 'billing:manual', { plan, status, period_end });
  return getTenant(tenantId);
}

export const invoicesFor = (tenantId) => platformDb().prepare('SELECT * FROM invoices WHERE tenant_id=? ORDER BY id DESC LIMIT 50').all(tenantId);

// ---------------------------------------------------------------- payment methods
export const LOCAL_METHODS = { raast: 'Raast', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', sadapay: 'SadaPay', nayapay: 'NayaPay', bank: 'Bank transfer' };

/** Display name of a payment method id: local transfer methods and online gateways. */
export const methodLabel = (id) => LOCAL_METHODS[id] || PROVIDERS[id]?.label || id;

/**
 * Where customers send money for the local methods: the active rows of payment_accounts, managed in the admin console
 * (first start imports BILLING_PK_ACCOUNTS if set). A method is offered only when it has an active account.
 */
export function localAccounts() {
  return platformDb().prepare('SELECT method, account, account_name name, note FROM payment_accounts WHERE active=1 ORDER BY sort_order, id').all().filter((a) => LOCAL_METHODS[a.method]);
}

/** What the signed-in tenant may use to pay. */
export function availableMethods(tenant) {
  const out = [];
  if (stripe.stripeConfigured() || providerName() === 'generic') out.push({ id: 'card', label: 'Card (Visa, Mastercard)', kind: 'online' });
  for (const g of platformGatewayOffers(tenant)) out.push({ id: g.id, label: g.label, kind: 'gateway', test_mode: g.test_mode });
  for (const a of localAccounts()) out.push({ id: a.method, label: LOCAL_METHODS[a.method], kind: 'transfer', account: a.account, account_name: a.name || null, note: a.note || null });
  return out;
}

const origin = (req) => `${req.protocol}://${req.get('host')}`;

/** Start paying for a plan by card. Stripe when configured, otherwise the generic hosted-link flow. */
export async function startCardCheckout(req, { plan, interval = 'month' }) {
  assertSellable(plan, req.tenant);
  if (!['month', 'year'].includes(interval)) throw bad('Interval must be month or year');
  if (stripe.stripeConfigured()) return stripe.createCheckout(req.tenant, { plan, interval, email: req.user.email, origin: origin(req), firstPayment: !platformDb().prepare("SELECT 1 FROM invoices WHERE tenant_id=? AND status='paid'").get(req.tenant.id) });
  return startCheckout(req.tenant, { plan, interval, email: req.user.email });
}
export const openCardPortal = (req) => stripe.createPortal(req.tenant, { origin: origin(req) });

const addMonths = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`); const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // 31 Jan + 1 month = 28/29 Feb
  return d.toISOString().slice(0, 10);
};

/** A customer says "I paid PKR X by <method>, reference <ref>". Nothing activates until an operator confirms it arrived. */
export async function submitLocalPayment(tenant, user, { plan, interval = 'month', method, reference, note, coupon = null, addons = [] }) {
  assertSellable(plan, tenant);
  if (!['month', 'year'].includes(interval)) throw bad('Interval must be month or year');
  if (!localAccounts().some((a) => a.method === method)) throw bad('This payment method is not available');
  const ref = String(reference || '').trim();
  if (ref.length < 6) throw bad('Enter the transaction ID or reference from your payment receipt');
  // the amount is computed here (plan + setup fee + add-ons - coupon), never taken from the browser
  const q = quote(tenant, { plan, interval, currency: 'PKR', coupon, addons });
  const amount = q.total;
  const db = platformDb();
  if (db.prepare("SELECT 1 FROM payment_submissions WHERE tenant_id=? AND status='pending'").get(tenant.id)) throw bad('You already have a payment waiting for confirmation');
  let id;
  try {
    id = Number(db.prepare('INSERT INTO payment_submissions(tenant_id,plan,interval,method,amount,currency,reference,note,submitted_by,coupon_code,discount_amount,setup_fee,addons,list_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(tenant.id, plan, interval, method, amount, 'PKR', ref, String(note || '').slice(0, 500) || null, user.email, q.coupon, q.discount, q.setup_fee, q.addons.length ? JSON.stringify(q.addons) : null, q.list_amount).lastInsertRowid);
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'This transaction reference has already been submitted');
    throw e;
  }
  logTenantEvent(tenant.id, 'billing:payment-submitted', { id, method, plan });
  if (process.env.BILLING_OPERATOR_EMAIL) {
    const mail = layout({ brand: 'platform', heading: 'Payment to confirm', lines: [`${tenant.name} (${tenant.slug}) says they paid PKR ${amount.toLocaleString('en-PK')} by ${methodLabel(method)} for ${PLANS[plan].name} (${interval}).`, `Reference: ${ref}`] });
    await sendMail({ type: 'billing', to: process.env.BILLING_OPERATOR_EMAIL, subject: `Payment to confirm: ${tenant.name}`, ...mail });
  }
  return { id, amount, currency: 'PKR', status: 'pending', quote: q };
}

export const submissionsFor = (tenantId) => platformDb().prepare('SELECT id,plan,interval,method,amount,currency,reference,status,decision_note,created_at,decided_at FROM payment_submissions WHERE tenant_id=? ORDER BY id DESC LIMIT 20').all(tenantId);
export const listSubmissions = (status) => platformDb().prepare(`SELECT s.*, t.slug, t.name tenant_name FROM payment_submissions s JOIN tenants t ON t.id=s.tenant_id ${status ? 'WHERE s.status=?' : ''} ORDER BY s.id DESC LIMIT 100`).all(...(status ? [status] : []));

/** Operator confirms the money arrived: activates the plan for one period (extending from the current period end if still active) and records an invoice. */
export async function approveSubmission(id, decisionNote, decidedBy = null) {
  const db = platformDb();
  const s = db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(id);
  if (!s) throw new HttpError(404, 'Payment not found');
  if (s.status !== 'pending') throw bad(`This payment was already ${s.status}`);
  const tenant = getTenant(s.tenant_id);
  const today = new Date().toISOString().slice(0, 10);
  const current = tenant.subscription_status === 'active' && tenant.current_period_end && tenant.current_period_end > today && tenant.plan === s.plan ? tenant.current_period_end : today;
  const periodEnd = addMonths(current, s.interval === 'year' ? 12 : 1);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE payment_submissions SET status='approved', decision_note=?, decided_at=datetime('now') WHERE id=?").run(decisionNote || null, id);
    // the recurring price excludes the one-time setup fee; with a coupon it is what the workspace actually pays per period
    const recurring = s.list_amount != null ? Math.max(0, s.list_amount - (s.discount_amount || 0)) : s.amount;
    db.prepare("UPDATE tenants SET plan=?, subscription_status='active', current_period_end=?, billing_interval=?, billing_provider=?, grace_until=NULL, price_amount=?, price_currency=?, canceled_at=NULL, updated_at=datetime('now') WHERE id=?")
      .run(s.plan, periodEnd, s.interval, s.method, recurring, s.currency, s.tenant_id);
    db.prepare('INSERT OR IGNORE INTO invoices(tenant_id,provider_invoice_id,amount,currency,status,period_start,period_end,one_time_amount,plan) VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id, `local-${id}`, s.amount, s.currency, 'paid', current, periodEnd, Math.min(s.amount, s.setup_fee || 0), s.plan);
    if (s.coupon_code) recordRedemption(s.coupon_code, s.tenant_id, id, s.discount_amount || 0, s.currency, db);
    for (const a of (() => { try { return JSON.parse(s.addons || '[]'); } catch { return []; } })()) setTenantAddon(s.tenant_id, { addon_id: a.id, quantity: a.quantity, active: true }, decidedBy, db);
    recordSubscriptionChange(tenant, getTenant(s.tenant_id), { source: 'payment', actor: decidedBy, reason: `Payment ${s.reference} (${s.method})` }, db);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  logTenantEvent(s.tenant_id, 'billing:payment-approved', { id, method: s.method });
  if (!['active', 'past_due'].includes(tenant.subscription_status)) recordServerEvent('subscription_activated', { product: PLANS[s.plan]?.product, plan: s.plan, tenant_id: s.tenant_id });
  await sendPaymentReceipt(`local:${id}`, { tenant_id: s.tenant_id, to: s.submitted_by || tenant.owner_email, amount: s.amount, currency: s.currency, plan: s.plan, interval: s.interval, method: methodLabel(s.method), reference: s.reference, period_end: periodEnd });
  return getTenant(s.tenant_id);
}

export async function rejectSubmission(id, decisionNote) {
  const db = platformDb();
  const s = db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(id);
  if (!s) throw new HttpError(404, 'Payment not found');
  if (s.status !== 'pending') throw bad(`This payment was already ${s.status}`);
  if (!String(decisionNote || '').trim()) throw bad('Say why it was rejected so the customer can fix it');
  db.prepare("UPDATE payment_submissions SET status='rejected', decision_note=?, decided_at=datetime('now') WHERE id=?").run(decisionNote, id);
  logTenantEvent(s.tenant_id, 'billing:payment-rejected', { id });
  const mail = layout({ brand: 'platform', heading: 'We could not confirm your payment', lines: [`Reference ${s.reference}: ${decisionNote}`, 'Please check the details and submit again, or contact us.'] });
  await sendMail({ type: 'billing', to: s.submitted_by, subject: 'We could not confirm your payment', ...mail });
}

/** Find the tenant a Stripe object belongs to when it carries no metadata (e.g. invoices). */
export function tenantByProviderIds(customerId, subscriptionId) {
  const r = platformDb().prepare('SELECT id FROM tenants WHERE (provider_customer_id IS NOT NULL AND provider_customer_id=?) OR (provider_subscription_id IS NOT NULL AND provider_subscription_id=?)').get(customerId || null, subscriptionId || null);
  return r?.id ?? null;
}
