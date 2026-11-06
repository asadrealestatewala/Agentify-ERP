// Add-ons, coupons, price quotes and refunds (platform database).
//
// A quote is the single place an amount to pay is computed: plan price for the interval, plus a one-time setup fee on a
// workspace's first payment, plus add-ons, minus a coupon. Customers never send amounts; the server computes them.
// Refunds are recorded against an invoice and reported separately from collections (gross - refunds = net).
import { platformDb, getTenant, logTenantEvent } from '../platform.js';
import { PLANS, PRODUCTS, assertSellable, isInterval, intervalLabel, intervalMonths } from './plans.js';
import { setCredits } from './aiGate.js';
import { CURRENCIES, cleanMoneyMap } from './plansStore.js';
import { launchLine } from './launchOffer.js';
import { bad, HttpError } from '../util.js';

const pdb = () => platformDb();
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const ID_RE = /^[a-z][a-z0-9_]{1,30}$/;
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

// ---------------------------------------------------------------- add-ons
const addonView = (a) => ({ id: a.id, name: a.name, description: a.description, product: a.product, price: parse(a.price, {}), entitlements: parse(a.entitlements, {}), active: !!a.active, sort_order: a.sort_order, updated_at: a.updated_at, updated_by: a.updated_by });
export const listAddons = ({ activeOnly = false, product = null } = {}) => pdb().prepare(`SELECT * FROM addons ${activeOnly ? 'WHERE active=1' : ''} ORDER BY sort_order, id`).all()
  .map(addonView).filter((a) => !product || a.product === 'any' || a.product === product);

export function saveAddon(id, b, actor) {
  const aid = String(id || '').trim().toLowerCase();
  if (!ID_RE.test(aid)) throw bad('Add-on ID must be 2-31 lowercase letters, digits or underscores, starting with a letter');
  const exists = pdb().prepare('SELECT * FROM addons WHERE id=?').get(aid);
  const name = String(b.name ?? exists?.name ?? '').trim();
  if (!name || name.length > 60) throw bad('Add-on name is required (up to 60 characters)');
  const product = b.product ?? exists?.product ?? 'any';
  if (product !== 'any' && !PRODUCTS[product]) throw bad('Product must be any, real_estate or construction');
  const price = { };
  const src = b.price ?? parse(exists?.price, {});
  for (const cur of CURRENCIES) {
    const m = src?.[cur];
    if (!m) continue;
    const clean = cleanMoneyMap({ [cur]: m.month }, 'Monthly price');
    const cleanH = cleanMoneyMap({ [cur]: m.half }, '6-month price');
    const cleanY = cleanMoneyMap({ [cur]: m.year }, 'Yearly price');
    if (clean[cur] || cleanH[cur] || cleanY[cur]) price[cur] = { month: clean[cur] || 0, half: cleanH[cur] || 0, year: cleanY[cur] || 0 };
  }
  if (!price.PKR) throw bad('An add-on needs at least a PKR price');
  const ent = b.entitlements ?? parse(exists?.entitlements, {});
  const entitlements = {};
  for (const k of ['seats', 'projects', 'properties', 'storage_mb']) if (ent?.[k] !== undefined && ent[k] !== '' && ent[k] !== null) {
    const n = Math.trunc(Number(ent[k]));
    if (!(n >= 1 && n <= 1_000_000)) throw bad(`${k} must be a whole number above zero`);
    entitlements[k] = n;
  }
  if (ent?.api_access) entitlements.api_access = true;
  if (ent?.topup_credits !== undefined && ent.topup_credits !== '' && ent.topup_credits !== null) {
    const n = Math.trunc(Number(ent.topup_credits));
    if (!(n >= 1 && n <= 1_000_000)) throw bad('Top-up credits must be a whole number above zero');
    entitlements.topup_credits = n;
  }
  const row = { name, description: String(b.description ?? exists?.description ?? '').trim().slice(0, 300) || null, product, price: JSON.stringify(price), entitlements: JSON.stringify(entitlements),
    active: b.active === undefined ? exists?.active ?? 1 : (b.active ? 1 : 0), sort_order: Math.trunc(Number(b.sort_order ?? exists?.sort_order ?? 0)) || 0 };
  if (exists) pdb().prepare(`UPDATE addons SET ${Object.keys(row).map((k) => `${k}=?`).join(',')}, updated_at=datetime('now'), updated_by=? WHERE id=?`).run(...Object.values(row), actor, aid);
  else pdb().prepare(`INSERT INTO addons(id,${Object.keys(row).join(',')},updated_by) VALUES(?,${Object.keys(row).map(() => '?').join(',')},?)`).run(aid, ...Object.values(row), actor);
  return addonView(pdb().prepare('SELECT * FROM addons WHERE id=?').get(aid));
}

export const tenantAddons = (tenantId) => pdb().prepare("SELECT ta.*, a.name FROM tenant_addons ta JOIN addons a ON a.id=ta.addon_id WHERE ta.tenant_id=? ORDER BY ta.status, ta.id DESC").all(tenantId);
/** Super admin: switch an add-on on (or off) for a workspace by hand, e.g. after an offline payment or as a goodwill gesture. */
export function setTenantAddon(tenantId, { addon_id, quantity = 1, active = true, reason }, actor, db = pdb()) {
  if (!db.prepare('SELECT 1 FROM addons WHERE id=?').get(addon_id)) throw new HttpError(404, 'Unknown add-on');
  const q = Math.trunc(Number(quantity));
  if (!(q >= 1 && q <= 1000)) throw bad('Quantity must be between 1 and 1000');
  // an AI top-up pack is one-time: it adds credits to this month and leaves no recurring add-on behind
  const pack = parse(db.prepare('SELECT entitlements FROM addons WHERE id=?').get(addon_id)?.entitlements, {})?.topup_credits;
  if (pack) {
    if (!active) throw bad('A top-up pack is one-time and cannot be switched off');
    setCredits(tenantId, { add_topup: pack * q }, actor || 'payment');
    logTenantEvent(tenantId, 'ai-topup', { addon: addon_id, quantity: q, credits: pack * q, reason: reason || null, by: actor || null });
    return tenantAddons(tenantId);
  }
  const cur = db.prepare("SELECT * FROM tenant_addons WHERE tenant_id=? AND addon_id=? AND status='active'").get(tenantId, addon_id);
  if (!active) {
    if (!cur) throw bad('That add-on is not active for this workspace');
    db.prepare("UPDATE tenant_addons SET status='ended', ended_at=datetime('now') WHERE id=?").run(cur.id);
  } else if (cur) db.prepare('UPDATE tenant_addons SET quantity=? WHERE id=?').run(q, cur.id);
  else db.prepare('INSERT INTO tenant_addons(tenant_id,addon_id,quantity,source,created_by) VALUES(?,?,?,?,?)').run(tenantId, addon_id, q, reason ? 'admin' : 'payment', actor || null);
  logTenantEvent(tenantId, active ? 'addon-on' : 'addon-off', { addon: addon_id, quantity: q, reason: reason || null, by: actor || null });
  return tenantAddons(tenantId);
}

// ---------------------------------------------------------------- coupons
const couponView = (c) => ({ code: c.code, description: c.description, percent_off: c.percent_off, amount_off: parse(c.amount_off, {}), products: parse(c.products, null), plans: parse(c.plans, null),
  intervals: parse(c.intervals, null), first_payment_only: !!c.first_payment_only, max_redemptions: c.max_redemptions, valid_from: c.valid_from, valid_until: c.valid_until, active: !!c.active,
  redeemed: pdb().prepare('SELECT COUNT(*) n FROM coupon_redemptions WHERE code=?').get(c.code).n, created_by: c.created_by, created_at: c.created_at });
export const listCoupons = () => pdb().prepare('SELECT * FROM coupons ORDER BY created_at DESC').all().map(couponView);

export function saveCoupon(code, b, actor) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) throw bad('Coupon code: 3-32 capital letters, digits, - or _');
  const exists = pdb().prepare('SELECT * FROM coupons WHERE code=?').get(c);
  const percent = b.percent_off === undefined ? exists?.percent_off ?? null : (b.percent_off === '' || b.percent_off === null ? null : Math.trunc(Number(b.percent_off)));
  if (percent !== null && !(percent >= 1 && percent <= 100)) throw bad('Percent off must be between 1 and 100');
  const amount = b.amount_off === undefined ? parse(exists?.amount_off, {}) : cleanMoneyMap(b.amount_off, 'Amount off');
  if (!percent && !Object.keys(amount).length) throw bad('Give a percent off or an amount off');
  if (percent && Object.keys(amount).length) throw bad('Use either a percent or an amount off, not both');
  const list = (v, ok, label) => {
    if (v === undefined) return undefined;
    if (v === null || (Array.isArray(v) && !v.length)) return null;
    if (!Array.isArray(v) || v.some((x) => !ok(x))) throw bad(`Unknown ${label}`);
    return JSON.stringify([...new Set(v)]);
  };
  const dateOk = (d, label) => { if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad(`${label} must be YYYY-MM-DD`); return d || null; };
  const row = {
    description: String(b.description ?? exists?.description ?? '').trim().slice(0, 200) || null, percent_off: percent, amount_off: Object.keys(amount).length ? JSON.stringify(amount) : null,
    products: list(b.products, (x) => !!PRODUCTS[x], 'product') ?? exists?.products ?? null, plans: list(b.plans, (x) => !!PLANS[x], 'plan') ?? exists?.plans ?? null,
    intervals: list(b.intervals, (x) => isInterval(x), 'interval') ?? exists?.intervals ?? null,
    first_payment_only: b.first_payment_only === undefined ? exists?.first_payment_only ?? 1 : (b.first_payment_only ? 1 : 0),
    max_redemptions: b.max_redemptions === undefined ? exists?.max_redemptions ?? null : (b.max_redemptions === '' || b.max_redemptions === null ? null : Math.max(1, Math.trunc(Number(b.max_redemptions)) || 1)),
    valid_from: b.valid_from === undefined ? exists?.valid_from ?? null : dateOk(b.valid_from, 'Valid from'), valid_until: b.valid_until === undefined ? exists?.valid_until ?? null : dateOk(b.valid_until, 'Valid until'),
    active: b.active === undefined ? exists?.active ?? 1 : (b.active ? 1 : 0),
  };
  if (exists) pdb().prepare(`UPDATE coupons SET ${Object.keys(row).map((k) => `${k}=?`).join(',')} WHERE code=?`).run(...Object.values(row), c);
  else pdb().prepare(`INSERT INTO coupons(code,${Object.keys(row).join(',')},created_by) VALUES(?,${Object.keys(row).map(() => '?').join(',')},?)`).run(c, ...Object.values(row), actor);
  return couponView(pdb().prepare('SELECT * FROM coupons WHERE code=?').get(c));
}

const hasPaid = (tenantId) => !!pdb().prepare("SELECT 1 FROM invoices WHERE tenant_id=? AND status='paid' LIMIT 1").get(tenantId);

/** Can `code` be used by this workspace for this purchase? Returns the coupon row or throws a 400 that says why not. */
export function checkCoupon(code, tenant, { plan, interval }) {
  const c = pdb().prepare('SELECT * FROM coupons WHERE code=?').get(String(code || '').trim());
  const nope = (why) => { throw bad(`Coupon ${String(code).toUpperCase()} ${why}`); };
  if (!c || !c.active) nope('is not valid');
  const today = new Date().toISOString().slice(0, 10);
  if (c.valid_from && today < c.valid_from) nope('is not active yet');
  if (c.valid_until && today > c.valid_until) nope('has expired');
  const products = parse(c.products, null), plans = parse(c.plans, null), intervals = parse(c.intervals, null);
  if (products && !products.includes(PLANS[plan]?.product) && PLANS[plan]?.product !== 'bundle') nope('does not apply to this product');
  if (plans && !plans.includes(plan)) nope('does not apply to this plan');
  if (intervals && !intervals.includes(interval)) nope(`does not apply to ${intervalLabel(interval)} billing`);
  if (c.max_redemptions && pdb().prepare('SELECT COUNT(*) n FROM coupon_redemptions WHERE code=?').get(c.code).n >= c.max_redemptions) nope('has been used up');
  if (c.first_payment_only && tenant && hasPaid(tenant.id)) nope('is for first payments only');
  if (tenant && pdb().prepare('SELECT 1 FROM coupon_redemptions WHERE code=? AND tenant_id=?').get(c.code, tenant.id)) nope('was already used by this workspace');
  return c;
}

// ---------------------------------------------------------------- quotes
/**
 * What a purchase costs, line by line, in one currency. Treatment (documented in docs/BILLING.md):
 *   plan price for the interval (yearly prices already include any annual discount)
 * + setup fee, only on the workspace's first paid invoice
 * + add-ons at their price for the interval x quantity
 * - coupon: percent off the plan + add-ons (never the setup fee), or a fixed amount, never below zero
 * Taxes are not added: prices are treated as tax-inclusive until a tax rule is configured.
 */
export function quote(tenant, { plan, interval = 'month', currency = 'PKR', coupon = null, addons = [] } = {}) {
  assertSellable(plan, tenant);
  if (!isInterval(interval)) throw bad('Interval must be month, 6 months or year');
  const cur = String(currency || 'PKR').toUpperCase();
  const p = PLANS[plan];
  const base = p.price?.[cur]?.[interval];
  if (base == null) throw bad(`${p.name} has no ${cur} ${intervalLabel(interval)} price`);
  const lines = [{ kind: 'plan', label: `${p.name} (${intervalLabel(interval)})`, amount: base }];
  const launch = launchLine(tenant, p, cur, interval, base);
  if (launch) lines.push({ kind: 'launch_offer', label: `Launch offer: ${launch.percent}% off (month ${launch.month_no} of ${launch.months})`, amount: -launch.amount });
  const fee = p.setup_fee?.[cur] || 0;
  const firstPayment = !tenant || !hasPaid(tenant.id);
  if (fee && firstPayment) lines.push({ kind: 'setup_fee', label: 'One-time setup fee', amount: fee });
  const chosen = [];
  for (const a of Array.isArray(addons) ? addons : []) {
    const row = pdb().prepare('SELECT * FROM addons WHERE id=? AND active=1').get(String(a?.id || ''));
    if (!row) throw bad(`Unknown add-on: ${a?.id}`);
    if (row.product !== 'any' && p.product !== 'bundle' && row.product !== p.product) throw bad(`${row.name} is not available with ${p.name}`);
    const q = Math.trunc(Number(a.quantity ?? 1));
    if (!(q >= 1 && q <= 1000)) throw bad('Add-on quantity must be between 1 and 1000');
    const ent = parse(row.entitlements, {}) || {};
    const prices = parse(row.price, {})?.[cur] || {};
    // a one-time pack costs the same whichever period is chosen; a missing period price falls back to the monthly price x months (no discount)
    const unit = ent.topup_credits ? prices.month : (prices[interval] ?? (prices.month != null ? prices.month * intervalMonths(interval) : null));
    if (unit == null) throw bad(`${row.name} has no ${cur} price`);
    lines.push({ kind: ent.topup_credits ? 'topup' : 'addon', id: row.id, label: `${row.name}${q > 1 ? ` x ${q}` : ''}`, amount: unit * q, quantity: q });
    chosen.push({ id: row.id, quantity: q });
  }
  // one-time lines (setup fee, AI top-up packs) are charged once and are not part of the recurring price
  const recurring = lines.filter((l) => !['setup_fee', 'topup'].includes(l.kind)).reduce((s, l) => s + l.amount, 0);
  const oneTime = lines.filter((l) => l.kind === 'topup').reduce((s, l) => s + l.amount, 0) + (fee && firstPayment ? fee : 0);
  let discount = 0, couponRow = null;
  if (coupon) {
    couponRow = checkCoupon(coupon, tenant, { plan, interval });
    discount = couponRow.percent_off ? Math.round((recurring * couponRow.percent_off) / 100) : Math.min(recurring, parse(couponRow.amount_off, {})[cur] || 0);
    if (!couponRow.percent_off && !parse(couponRow.amount_off, {})[cur]) throw bad(`Coupon ${couponRow.code} has no ${cur} amount`);
    lines.push({ kind: 'discount', label: `Coupon ${couponRow.code}`, amount: -discount });
  }
  const total = Math.max(0, lines.reduce((s, l) => s + l.amount, 0));
  return { plan, interval, currency: cur, lines, list_amount: recurring, setup_fee: oneTime, discount, total, coupon: couponRow?.code || null, addons: chosen };
}

export function recordRedemption(code, tenantId, submissionId, amountOff, currency, db = pdb()) {
  if (!code || !amountOff) return;
  db.prepare('INSERT OR IGNORE INTO coupon_redemptions(code,tenant_id,submission_id,amount_off,currency) VALUES(?,?,?,?,?)').run(code, tenantId, submissionId, amountOff, currency);
}

// ---------------------------------------------------------------- refunds
export const refundsFor = (tenantId) => pdb().prepare('SELECT r.*, i.provider_invoice_id FROM refunds r LEFT JOIN invoices i ON i.id=r.invoice_id WHERE r.tenant_id=? ORDER BY r.id DESC').all(tenantId);
const refundedOn = (invoiceId, db = pdb()) => db.prepare('SELECT COALESCE(SUM(amount),0) n FROM refunds WHERE invoice_id=?').get(invoiceId).n;

/**
 * Record money returned to a customer against one paid invoice. Card refunds made in Stripe arrive by webhook and call
 * this with `provider_refund_id` (idempotent); money returned by bank transfer is recorded by a Billing Manager with the
 * transfer reference. A refund never deletes the invoice; reports show gross collections, refunds and net.
 */
export function recordRefund(tenantId, { invoice_id, provider_invoice_id, amount, reason, reference, provider = 'manual', provider_refund_id = null }, actor = null, db = pdb()) {
  const t = getTenant(Number(tenantId));
  if (!t) throw new HttpError(404, 'Workspace not found');
  const inv = invoice_id ? db.prepare('SELECT * FROM invoices WHERE id=? AND tenant_id=?').get(Number(invoice_id), t.id)
    : db.prepare('SELECT * FROM invoices WHERE provider_invoice_id=? AND tenant_id=?').get(String(provider_invoice_id || ''), t.id);
  if (!inv) throw new HttpError(404, 'Invoice not found for this workspace');
  // the invoice stays 'paid' (it was collected); refunds are their own records so gross, refunds and net stay separate
  if (inv.status !== 'paid') throw bad('Only a paid invoice can be refunded');
  const amt = Math.round(Number(amount));
  if (!(amt > 0)) throw bad('Refund amount must be above zero');
  if (provider === 'manual' && String(reason || '').trim().length < 3) throw bad('A reason is required for a refund');
  if (provider === 'manual' && String(reference || '').trim().length < 3) throw bad('Enter the reference of the transfer that returned the money');
  if (provider_refund_id && db.prepare('SELECT 1 FROM refunds WHERE provider=? AND provider_refund_id=?').get(provider, provider_refund_id)) return { duplicate: true };
  const already = refundedOn(inv.id, db);
  if (already + amt > inv.amount) throw bad(`Only ${inv.currency} ${inv.amount - already} of this invoice is left to refund`);
  const id = Number(db.prepare('INSERT INTO refunds(tenant_id,invoice_id,amount,currency,reason,reference,provider,provider_refund_id,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(t.id, inv.id, amt, inv.currency, String(reason || '').slice(0, 300) || null, String(reference || '').slice(0, 80) || null, provider, provider_refund_id, actor).lastInsertRowid);
  logTenantEvent(t.id, 'billing:refund', { invoice: inv.id, amount: amt, currency: inv.currency, provider });
  return { id, invoice_id: inv.id, amount: amt, currency: inv.currency };
}
