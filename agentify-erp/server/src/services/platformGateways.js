// How Agentify itself is paid: card/online gateways for plan subscriptions, configured in the Super Admin console.
// Stripe subscriptions keep their own, richer integration (services/stripe.js, console "Stripe" tab). Everything else here
// reuses the same provider adapters as the tenant gateways (gateways/providers.js) and takes ONE-TIME PERIOD PAYMENTS:
// a confirmed payment is turned into a payment submission and approved exactly like a manual bank transfer, so the plan,
// invoice, coupon and add-on logic is the existing code. Renewal is by paying again (no recurring mandate).
// Safety is the same as for tenants: amount from a server-side quote, the provider is asked for the result before anything
// activates, test mode never activates a plan, secrets are encrypted in platform_settings and never returned.
import crypto from 'node:crypto';
import { platformDb } from '../platform.js';
import { bad, HttpError } from '../util.js';
import { PROVIDERS, toMinor, toMajor } from '../gateways/providers.js';
import { getSetting, setSetting, mask, audit } from './platformConfig.js';
import { PLANS, assertSellable } from './plans.js';
import { quote } from './commerce.js';
import { approveSubmission } from './billing.js';

// Stripe is handled by its own integration; these are the providers this module can run.
const GATEWAY_IDS = ['paypal', 'tap', 'paypro', 'payoneer'];
const K = (id, field) => `pgw_${id}_${field}`;
const prov = (id) => { if (!GATEWAY_IDS.includes(id)) throw new HttpError(404, 'Unknown payment provider'); return PROVIDERS[id]; };
const db = () => platformDb();

function config(id) {
  const p = PROVIDERS[id]; const cfg = { mode: getSetting(K(id, 'mode')) === 'live' ? 'live' : 'test' };
  for (const f of p.fields) cfg[f.key] = getSetting(K(id, f.key)) || '';
  return cfg;
}
const isSet = (id) => PROVIDERS[id].fields.length > 0 && PROVIDERS[id].fields.filter((f) => f.key !== 'webhook_id').every((f) => config(id)[f.key]);
const enabled = (id) => getSetting(K(id, 'enabled')) === '1';

/** Console view: secrets masked, plus a plain "live or not" status. */
export function platformGatewayList(origin) {
  return GATEWAY_IDS.map((id) => {
    const p = PROVIDERS[id], cfg = config(id), connected = getSetting(K(id, 'connected')) === '1';
    return {
      id, label: p.label, blurb: p.blurb, available: p.available, note: p.note || null, docs: p.docs, currencies: p.currencies,
      status: !p.available ? 'not_built' : !isSet(id) ? 'no_keys' : !connected ? 'untested' : enabled(id) ? (cfg.mode === 'live' ? 'live' : 'test') : 'off',
      mode: cfg.mode, enabled: enabled(id), account: getSetting(K(id, 'account')) || null,
      fields: p.fields.map((f) => ({ key: f.key, label: f.label, secret: !!f.secret, hint: f.hint || null, value: f.secret ? (cfg[f.key] ? mask(cfg[f.key]).hint : '') : cfg[f.key] })),
      webhook_url: p.available ? `${origin}/api/platform/pay/webhook/${id}` : null,
    };
  });
}

export async function savePlatformGateway(id, body, by) {
  const p = prov(id);
  if (!p.available) throw bad(`${p.label} is not available yet`);
  const prev = config(id);
  const input = { mode: body.mode === 'live' ? 'live' : 'test' };
  for (const f of p.fields) { const v = body[f.key]; input[f.key] = (v == null || v === '' || /^…/.test(String(v))) ? prev[f.key] : v; }
  const cfg = { ...p.validate(input), mode: input.mode };
  let t;
  try { t = await p.test(cfg); } catch (e) { audit(by, 'payment-gateway-test-failed', { id }, { outcome: 'failure' }); throw bad(`${p.label} did not accept these details: ${e.message}`); }
  setSetting(K(id, 'mode'), cfg.mode, { by });
  for (const f of p.fields) setSetting(K(id, f.key), cfg[f.key], { secret: !!f.secret, by });
  setSetting(K(id, 'connected'), '1', { by }); setSetting(K(id, 'account'), t.account, { by });
  if (body.enabled !== undefined) setSetting(K(id, 'enabled'), body.enabled ? '1' : '', { by });
  audit(by, 'payment-gateway-saved', { id, mode: cfg.mode }); // never the keys
}
export function setPlatformGatewayEnabled(id, on, by) {
  prov(id);
  if (on && getSetting(K(id, 'connected')) !== '1') throw bad('Save and test the keys first');
  setSetting(K(id, 'enabled'), on ? '1' : '', { by });
  audit(by, on ? 'payment-gateway-enabled' : 'payment-gateway-disabled', { id });
}
export function removePlatformGateway(id, by) {
  const p = prov(id);
  for (const k of ['mode', 'enabled', 'connected', 'account', ...p.fields.map((f) => f.key)]) setSetting(K(id, k), null);
  audit(by, 'payment-gateway-removed', { id });
}

/** The workspace's own currency when the plan is priced in it and the gateway can charge it, otherwise the first plan currency the gateway can charge. */
const chargeCurrency = (plan, tenant, p) => [tenant.currency, ...Object.keys(PLANS[plan]?.price || {})].find((c) => c && PLANS[plan]?.price?.[c] && (!p.currencies || p.currencies.includes(c))) || null;
const live = (id) => PROVIDERS[id].available && getSetting(K(id, 'connected')) === '1' && enabled(id);
/** Gateways a workspace can use: keys saved, tested and switched on. The charge currency is chosen per plan at checkout. */
export function platformGatewayOffers(tenant) {
  if (!tenant) return [];
  return GATEWAY_IDS.filter((id) => live(id))
    .map((id) => ({ id, label: PROVIDERS[id].label, test_mode: config(id).mode !== 'live' }));
}

export async function startPlatformCheckout(req, { provider: pid, plan, interval = 'month', coupon = null, addons = [] }) {
  const p = prov(pid); const tenant = req.tenant;
  if (!platformGatewayOffers(tenant).some((g) => g.id === pid)) throw bad('This payment option is not available');
  assertSellable(plan, tenant);
  const currency = chargeCurrency(plan, tenant, p);
  if (!currency) throw bad(`${p.label} cannot charge this plan's currency`);
  const q = quote(tenant, { plan, interval, currency, coupon, addons });
  if (!(q.total > 0)) throw bad('Nothing to pay for this plan');
  const minor = toMinor(q.total, currency, 0), cfg = config(pid), token = crypto.randomBytes(18).toString('hex');
  const origin = `${req.protocol}://${req.get('host')}`;
  const id = Number(db().prepare('INSERT INTO platform_checkouts(token,provider,tenant_id,plan,interval,quote,amount,currency,minor_amount,sandbox,created_by,return_origin) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(token, pid, tenant.id, plan, interval, JSON.stringify(q), q.total, currency, minor, cfg.mode === 'live' ? 0 : 1, req.user.email, origin).lastInsertRowid);
  try {
    const r = await p.createCheckout(cfg, { token, minor, major: toMajor(minor, currency), currency, description: `${PLANS[plan].name} (${interval === 'year' ? 'yearly' : 'monthly'}) - ${tenant.name}`.slice(0, 200),
      successUrl: `${origin}/api/platform/pay/return/${pid}/${token}`, cancelUrl: `${origin}/settings/billing?cancelled=1`, webhookUrl: `${origin}/api/platform/pay/webhook/${pid}`, email: req.user.email, name: tenant.name });
    db().prepare("UPDATE platform_checkouts SET status='pending', external_id=?, updated_at=datetime('now') WHERE id=?").run(r.externalId, id);
    return { mode: 'redirect', url: r.url, test_mode: cfg.mode !== 'live' };
  } catch (e) {
    db().prepare("UPDATE platform_checkouts SET status='failed', error=?, updated_at=datetime('now') WHERE id=?").run(String(e.message).slice(0, 300), id);
    throw bad('We could not start this payment. Please try another way or contact us.');
  }
}

const notifyOperator = (k, title, body) => db().prepare("INSERT INTO platform_notifications(kind,severity,title,body,link,tenant_id,dedupe) VALUES('billing','warning',?,?,?,?,?) ON CONFLICT(dedupe) DO NOTHING")
  .run(title, body, `/platform/workspaces/${k.tenant_id}`, k.tenant_id, `pgw:${k.id}:${title.length}`);

/** Ask the provider; activate the plan only for a confirmed, matching, live-mode payment. Idempotent. */
export async function settlePlatformCheckout(token) {
  const get = () => db().prepare('SELECT * FROM platform_checkouts WHERE token=?').get(token);
  let k = get();
  if (!k) throw new HttpError(404, 'Unknown payment');
  if (['paid', 'paid_test', 'posting'].includes(k.status) || !k.external_id) return k;
  const p = PROVIDERS[k.provider]; const cfg = config(k.provider);
  const r = await p.confirm(cfg, { external_id: k.external_id, token: k.token });
  if (!r.paid) return k;
  if (r.currency !== k.currency || Number(r.minor) !== k.minor_amount) {
    db().prepare("UPDATE platform_checkouts SET status='mismatch', error=?, updated_at=datetime('now') WHERE id=?").run(`Provider reports ${r.currency} ${r.minor}, expected ${k.currency} ${k.minor_amount}`, k.id);
    notifyOperator(k, 'Online plan payment amount mismatch', `${p.label} checkout ${k.id}: the amount does not match the quote. Check it at the provider before activating.`);
    return get();
  }
  if (db().prepare("UPDATE platform_checkouts SET status='posting', payment_ref=?, updated_at=datetime('now') WHERE id=? AND status IN ('created','pending','mismatch','failed')").run(String(r.ref || k.external_id), k.id).changes !== 1) return get();
  if (k.sandbox) { db().prepare("UPDATE platform_checkouts SET status='paid_test', updated_at=datetime('now') WHERE id=?").run(k.id); return get(); }
  const q = JSON.parse(k.quote);
  try {
    const sid = Number(db().prepare('INSERT INTO payment_submissions(tenant_id,plan,interval,method,amount,currency,reference,note,submitted_by,coupon_code,discount_amount,setup_fee,addons,list_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(k.tenant_id, k.plan, k.interval, k.provider, k.amount, k.currency, `gw-${r.ref || k.external_id}`, `Paid online through ${p.label}, confirmed with ${p.label} by the server`, k.created_by, q.coupon, q.discount, q.setup_fee, q.addons?.length ? JSON.stringify(q.addons) : null, q.list_amount).lastInsertRowid);
    await approveSubmission(sid, `Confirmed automatically with ${p.label}`, null);
    db().prepare("UPDATE platform_checkouts SET status='paid', submission_id=?, error=NULL, updated_at=datetime('now') WHERE id=?").run(sid, k.id);
  } catch (e) {
    db().prepare("UPDATE platform_checkouts SET status='needs_review', error=?, updated_at=datetime('now') WHERE id=?").run(String(e.message).slice(0, 300), k.id);
    notifyOperator(k, 'Online plan payment received, needs activating', `${p.label} checkout ${k.id} was paid but could not be applied: ${e.message}`);
  }
  return get();
}

export async function handlePlatformWebhook(pid, req) {
  const p = PROVIDERS[pid];
  if (!GATEWAY_IDS.includes(pid) || !p?.available || !isSet(pid)) return 404;
  let ev;
  try { ev = await p.parseWebhook(req, config(pid)); } catch { return 400; }
  if (!ev) return 200;
  const k = ev.checkoutToken ? db().prepare('SELECT token FROM platform_checkouts WHERE token=? AND provider=?').get(ev.checkoutToken, pid) : db().prepare('SELECT token FROM platform_checkouts WHERE provider=? AND external_id=?').get(pid, ev.externalId);
  if (k) { try { await settlePlatformCheckout(k.token); } catch { return 502; } }
  return 200;
}

export const platformCheckoutStatus = (tenantId, token) => {
  const k = db().prepare('SELECT status, amount, currency, provider, sandbox FROM platform_checkouts WHERE token=? AND tenant_id=?').get(token, tenantId);
  return k ? { ...k, provider: PROVIDERS[k.provider]?.label } : null;
};
export const platformCheckouts = () => db().prepare('SELECT k.id, k.provider, k.amount, k.currency, k.status, k.sandbox, k.error, k.created_at, t.slug, t.name tenant FROM platform_checkouts k JOIN tenants t ON t.id=k.tenant_id ORDER BY k.id DESC LIMIT 100').all()
  .map((k) => ({ ...k, provider_label: PROVIDERS[k.provider]?.label || k.provider }));
