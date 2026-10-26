// Tenant-facing billing API (runs inside the workspace): plan, usage, quotes, checkout. Money events arrive on the platform webhook.
import { Router } from 'express';
import { asyncH, bad } from '../util.js';
import { requireStaff, can } from '../rbac.js';
import { billingState, planCatalog, usage, lockMessage, PRODUCTS, MODULES } from '../services/plans.js';
import { startCardCheckout, openCardPortal, availableMethods, submitLocalPayment, submissionsFor, invoicesFor, providerName } from '../services/billing.js';
import { quote, listAddons, tenantAddons, refundsFor } from '../services/commerce.js';
import { audit } from '../audit.js';
import { startPlatformCheckout, platformCheckoutStatus } from '../services/platformGateways.js';
import { recordServerEvent } from '../services/analytics.js';
import { platformDb, logTenantEvent } from '../platform.js';
import { marketingContent } from '../services/marketing.js';

const r = Router();
r.use(requireStaff);

/** Plans this workspace can buy: its own product family (and bundles), or everything for a combined workspace. */
const catalogFor = (t) => planCatalog(t.plan, t.product && t.product !== 'bundle' ? t.product : null);
const summary = (req) => {
  const st = billingState(req.tenant);
  return { ...st, message: st.locked ? lockMessage(st.reason) : null, usage: usage(), plans: catalogFor(req.tenant), provider: providerName(), methods: availableMethods(req.tenant), currency: req.tenant.currency, interval: req.tenant.billing_interval || null,
    product: req.tenant.product || 'real_estate', product_labels: PRODUCTS, modules: MODULES, trial_note: req.tenant.trial_note || null, slug: req.tenant.slug };
};

/** Any signed-in staff member: enough to show the trial / read-only banner and to hide what the subscription does not include. */
// The app downloads (Google Play link and the direct Android file) are for paying workspaces only; trials, expired and free-website accounts get null.
const appLinks = (s) => (!s.free_site && ['active', 'past_due'].includes(s.status) && !s.locked
  ? { android_store_url: marketingContent().android_store_url || null, apk_url: 'https://agentifyerp.co/downloads/agentify-erp.apk' } : null);
r.get('/status', (req, res) => {
  const s = summary(req);
  res.json({ status: s.status, locked: s.locked, reason: s.reason || null, message: s.message, days_left: s.days_left ?? null, trial_ends_at: s.trial_ends_at || null, plan: s.plan,
    grace_until: s.grace_until || null, period_end: s.period_end || null, products: s.products, product: s.product, modules: s.limits.modules, limits: s.limits, legacy: !!req.tenant.is_legacy, app: appLinks(s) });
});

r.get('/', can('settings', 'view'), (req, res) => res.json({ ...summary(req), invoices: req.tenant.is_legacy ? [] : invoicesFor(req.tenant.id), payments: req.tenant.is_legacy ? [] : submissionsFor(req.tenant.id),
  refunds: req.tenant.is_legacy ? [] : refundsFor(req.tenant.id), addons: listAddons({ activeOnly: true, product: req.tenant.product === 'bundle' ? null : req.tenant.product }),
  my_addons: req.tenant.is_legacy ? [] : tenantAddons(req.tenant.id), card_portal: req.tenant.billing_provider === 'stripe' }));

/** Price for a plan, interval, coupon and add-ons, computed on the server (the same figure the payment is checked against). */
r.post('/quote', can('settings', 'view'), asyncH((req, res) => {
  if (req.tenant.is_legacy) throw bad('This workspace is not billed');
  const b = req.body || {};
  res.json(quote(req.tenant, { plan: b.plan, interval: b.interval, currency: b.currency || 'PKR', coupon: b.coupon || null, addons: b.addons || [] }));
}));

/** Card checkout (Stripe when configured). Local methods use /manual-payment instead. */
r.post('/checkout', can('settings', 'edit'), asyncH(async (req, res) => {
  if (req.tenant.is_legacy) throw bad('This workspace is not billed');
  const out = await startCardCheckout(req, { plan: req.body?.plan, interval: req.body?.interval });
  recordServerEvent('checkout_started', { product: req.tenant.product, plan: req.body?.plan, tenant_id: req.tenant.id });
  audit(req, 'Started checkout', 'billing', null, `${req.body?.plan} / ${req.body?.interval || 'month'}`);
  res.json(out);
}));

/** Pay for one period through a connected online gateway (PayPal, Tap, ...). The plan activates only after the server confirms the payment with the provider. */
r.post('/gateway-checkout', can('settings', 'edit'), asyncH(async (req, res) => {
  if (req.tenant.is_legacy) throw bad('This workspace is not billed');
  const b = req.body || {};
  const out = await startPlatformCheckout(req, { provider: b.provider, plan: b.plan, interval: b.interval, coupon: b.coupon || null, addons: b.addons || [] });
  audit(req, 'Started online plan payment', 'billing', null, `${b.provider} ${b.plan} / ${b.interval || 'month'}`);
  res.json(out);
}));
r.get('/gateway-checkout/:token', can('settings', 'view'), (req, res) => {
  const k = platformCheckoutStatus(req.tenant.id, String(req.params.token));
  if (!k) return res.status(404).json({ error: 'Payment not found' });
  res.json({ ...k, status: ['paid', 'paid_test'].includes(k.status) ? k.status : ['failed', 'mismatch'].includes(k.status) ? 'failed' : k.status === 'needs_review' ? 'received' : 'pending' });
});

/** "I paid by Raast / Easypaisa / JazzCash / SadaPay / NayaPay": recorded for the operator to confirm. */
r.post('/manual-payment', can('settings', 'edit'), asyncH(async (req, res) => {
  if (req.tenant.is_legacy) throw bad('This workspace is not billed');
  const out = await submitLocalPayment(req.tenant, req.user, req.body || {});
  audit(req, 'Submitted payment for confirmation', 'billing', out.id, `${req.body.method} ${req.body.plan}`);
  res.status(201).json(out);
}));

/**
 * The workspace owner asks to close the account and delete its data. Nothing is deleted here: the platform team is
 * alerted, confirms with the owner, cancels the workspace and deletes the data (billing records are kept by law).
 * Export your data first (Settings > reports and My Space > Security > download database).
 */
r.post('/close-request', can('settings', 'edit'), asyncH((req, res) => {
  if (req.tenant.is_legacy) throw bad('This workspace is not billed');
  if (req.user.role !== 'Super Admin') throw bad('Only the workspace Super Admin can ask to close the account');
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (req.body?.confirm !== req.tenant.slug) throw bad(`Type your workspace address (${req.tenant.slug}) to confirm`);
  platformDb().prepare("UPDATE tenants SET close_requested_at=datetime('now') WHERE id=?").run(req.tenant.id);
  logTenantEvent(req.tenant.id, 'close-requested', { by: req.user.email, reason: reason || null });
  platformDb().prepare("INSERT INTO platform_notifications(kind,severity,title,body,link,tenant_id,dedupe) VALUES('account','warning',?,?,?,?,?) ON CONFLICT(dedupe) DO NOTHING")
    .run(`${req.tenant.name} asked to close the account and delete its data`, `${req.user.email}${reason ? `: ${reason}` : ''}`, `/platform/workspaces/${req.tenant.id}`, req.tenant.id, `close:${req.tenant.id}:${new Date().toISOString().slice(0, 10)}`);
  audit(req, 'Requested account closure', 'billing', null, reason);
  res.json({ ok: true, message: 'Your request was sent. We will confirm by email before anything is deleted.' });
}));

/** Stripe customer portal: update the card, change plan, cancel, download invoices. */
r.post('/portal', can('settings', 'edit'), asyncH(async (req, res) => res.json(await openCardPortal(req))));

export default r;
