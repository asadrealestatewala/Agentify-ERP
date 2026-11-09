// Stripe adapter (cards, international). Uses Stripe's REST API directly (no SDK dependency).
// Keys, webhook secret and price ids are managed in the platform admin console (services/platformConfig.js); the old
// environment variables (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_<PLAN>_<MONTH|YEAR>) still work as a fallback.
// Stripe events are translated into the provider-neutral events that services/billing.js applies.
import crypto from 'node:crypto';
import { PLANS } from './plans.js';
import { LADDER_IDS, LADDER_HOME_CURRENCY } from './planLadder.js';
import { HttpError, bad } from '../util.js';
import { stripeConfig } from './platformConfig.js';

/** Swappable HTTP client so tests never touch the network. */
export const http = { fetch: (...a) => fetch(...a) };

export const stripeConfigured = () => !!stripeConfig().secret_key;
/** Stripe price for a plan and billing period. Ladder plans sold in a currency other than the home currency use that currency's own price slot (no fallback to the home-currency one: a card must never be charged in the wrong currency). */
export const priceId = (plan, interval, currency = null) => {
  const cur = String(currency || '').toLowerCase();
  if (cur && cur !== LADDER_HOME_CURRENCY.toLowerCase() && LADDER_IDS.includes(plan)) return stripeConfig().prices[`${plan}_${interval}_${cur}`] || null;
  return stripeConfig().prices[`${plan}_${interval}`] || null;
};
/** Can a card pay for this plan in the workspace's currency? */
export const cardAvailable = (plan, interval, currency) => !!priceId(plan, interval, currency);

/** Reverse lookup, so a plan change made in Stripe's customer portal maps back to our plan. */
export function planFromPrice(id) {
  for (const plan of Object.keys(PLANS)) for (const interval of ['month', 'year']) {
    if (id && priceId(plan, interval) === id) return { plan, interval };
    for (const cur of Object.keys(PLANS[plan].price || {})) if (cur !== LADDER_HOME_CURRENCY && id && LADDER_IDS.includes(plan) && priceId(plan, interval, cur) === id) return { plan, interval };
  }
  return null;
}

const form = (obj, prefix = '', out = new URLSearchParams()) => {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
};

async function api(path, body) {
  const res = await http.fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${stripeConfig().secret_key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(body).toString(), signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('[stripe]', res.status, data?.error?.message); throw new HttpError(502, 'The card payment service rejected the request. Please try again or use another payment method.'); }
  return data;
}

/** Hosted Stripe Checkout for a subscription. The tenant id travels with the session and the subscription. */
export async function createCheckout(tenant, { plan, interval, email, origin, firstPayment = false }) {
  const price = priceId(plan, interval, tenant.currency);
  if (!price) throw new HttpError(503, 'Card payment is not configured for this plan yet');
  const meta = { tenant_id: String(tenant.id), plan, interval };
  const s = await api('checkout/sessions', {
    mode: 'subscription', 'line_items': { 0: { price, quantity: 1 }, ...(firstPayment && priceId(plan, 'setup', tenant.currency) ? { 1: { price: priceId(plan, 'setup', tenant.currency), quantity: 1 } } : {}) }, client_reference_id: String(tenant.id),
    ...(tenant.provider_customer_id && tenant.billing_provider === 'stripe' ? { customer: tenant.provider_customer_id } : { customer_email: email }),
    success_url: `${origin}/settings/billing?paid=1`, cancel_url: `${origin}/settings/billing`,
    metadata: meta, subscription_data: { metadata: meta }, allow_promotion_codes: 'true',
  });
  return { mode: 'redirect', url: s.url };
}

/** Stripe's customer portal (update card, switch plan, cancel, invoices). */
export async function createPortal(tenant, { origin }) {
  if (tenant.billing_provider !== 'stripe' || !tenant.provider_customer_id) throw bad('There is no card subscription to manage yet');
  const s = await api('billing_portal/sessions', { customer: tenant.provider_customer_id, return_url: `${origin}/settings/billing` });
  return { mode: 'redirect', url: s.url };
}

/** Read-only call that proves a secret key works. Returns { ok, livemode } or { ok:false, error }. */
export async function testConnection(secretKey) {
  if (!secretKey) return { ok: false, error: 'No secret key saved for this mode' };
  try {
    const res = await http.fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${secretKey}` }, signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error?.message || `Stripe answered ${res.status}` };
    return { ok: true, livemode: !!data.livemode };
  } catch (e) { return { ok: false, error: `Could not reach Stripe: ${e.message}` }; }
}

/** Verify `Stripe-Signature: t=<unix>,v1=<hmac>` over `${t}.${rawBody}`; rejects stale timestamps (replay protection). */
export function verifyWebhook(rawBody, header, toleranceSec = 300) {
  const cfg = stripeConfig();
  // the endpoint secret differs between test and live; accept either, active mode first
  const secrets = [cfg.modes[cfg.mode].webhook_secret, ...Object.entries(cfg.modes).filter(([m]) => m !== cfg.mode).map(([, v]) => v.webhook_secret)].filter(Boolean);
  if (!secrets.length) throw new HttpError(503, 'Stripe webhooks are not configured');
  if (!rawBody || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')).filter((p) => p.length === 2));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const sigs = String(header).split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return secrets.some((secret) => {
    const want = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
    return sigs.some((got) => got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want)));
  });
}

const day = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);
const periodEnd = (sub) => day(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end);

/**
 * Translate one Stripe event into the neutral shape, or null for events we do not act on.
 * `lookup(customerId, subscriptionId)` finds a tenant id when the object carries no metadata (invoices).
 */
export function mapEvent(ev, lookup = () => null) {
  const o = ev.data?.object || {};
  const base = { id: ev.id };
  switch (ev.type) {
    case 'checkout.session.completed': {
      if (o.mode !== 'subscription') return null;
      const m = o.metadata || {};
      const iv = m.interval === 'year' ? 'year' : 'month';
      // the exact period arrives with customer.subscription.updated; until then grant one period
      return { ...base, type: 'subscription.activated', tenant_id: o.client_reference_id || m.tenant_id, plan: m.plan, interval: iv, customer_id: o.customer, subscription_id: o.subscription, period_end: day(Date.now() / 1000 + (iv === 'year' ? 366 : 32) * 86400) };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const tenant_id = o.metadata?.tenant_id || lookup(o.customer, o.id);
      const mapped = planFromPrice(o.items?.data?.[0]?.price?.id);
      const common = { ...base, tenant_id, customer_id: o.customer, subscription_id: o.id, period_end: periodEnd(o), plan: mapped?.plan || o.metadata?.plan, interval: mapped?.interval || o.metadata?.interval };
      if (['past_due', 'unpaid'].includes(o.status)) return { ...common, type: 'payment.failed' };
      if (['canceled', 'incomplete_expired'].includes(o.status)) return { ...common, type: 'subscription.canceled' };
      if (o.cancel_at_period_end) return { ...common, type: 'subscription.canceled' }; // keeps access until the paid period ends
      if (['active', 'trialing'].includes(o.status)) return { ...common, type: 'subscription.renewed' };
      return null;
    }
    case 'customer.subscription.deleted':
      return { ...base, type: 'subscription.canceled', tenant_id: o.metadata?.tenant_id || lookup(o.customer, o.id), customer_id: o.customer, subscription_id: o.id, period_end: day(o.ended_at || o.canceled_at || Date.now() / 1000) };
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      return { ...base, type: 'invoice.paid', tenant_id: o.subscription_details?.metadata?.tenant_id || lookup(o.customer, o.subscription), customer_id: o.customer, subscription_id: o.subscription,
        invoice: { id: o.id, amount: Math.round((o.amount_paid || 0) / 100), currency: o.currency, status: 'paid', url: o.hosted_invoice_url, period_start: day(o.period_start), period_end: day(o.period_end) } };
    case 'charge.refunded': {
      // the newest refund on the charge; the invoice it paid identifies what is being refunded
      const rf = o.refunds?.data?.[0];
      if (!o.invoice) return null;
      return { ...base, type: 'payment.refunded', tenant_id: o.metadata?.tenant_id || lookup(o.customer, null), customer_id: o.customer,
        refund: { id: rf?.id || `${o.id}:${o.amount_refunded}`, amount: Math.round((rf?.amount ?? o.amount_refunded ?? 0) / 100), invoice: o.invoice, reason: rf?.reason || null } };
    }
    case 'invoice.payment_failed':
      return { ...base, type: 'payment.failed', tenant_id: o.subscription_details?.metadata?.tenant_id || lookup(o.customer, o.subscription), customer_id: o.customer, subscription_id: o.subscription };
    default: return null;
  }
}
