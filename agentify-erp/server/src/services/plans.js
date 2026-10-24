// Products, plans, limits and the billing state machine. Pure functions over a tenant row (no I/O beyond counting the
// tenant's own records) so they are easy to test.
//
// Plans live in the platform database (tables plans / plan_prices, see services/plansStore.js) and are edited in the
// super admin console. PLANS below is the in-memory copy every module reads; plansStore refreshes it in place, so
// `PLANS[plan].price.PKR.month` keeps working everywhere. DEFAULT_PLANS only seeds a brand-new platform database.
// A `null` limit means unlimited; `modules: null` means every module of the plan's product is included.
//
// Products: every plan belongs to one product family (real_estate, construction) or to `bundle` (both). A workspace may
// use the modules of the products its plan covers (during a trial: the product chosen at signup). Product modules are
// enforced here on the server; the client only hides menus.
import fs from 'node:fs';
import path from 'node:path';
import { val, uploadDir } from '../db.js';
import { HttpError } from '../util.js';

export const PRODUCTS = {
  real_estate: { label: 'Real Estate Brokerage', short: 'Real Estate' },
  construction: { label: 'Construction Management', short: 'Construction' },
};
/** A plan's `product` may also be `bundle`: every product. */
export const PRODUCT_CHOICES = [...Object.keys(PRODUCTS), 'bundle'];
export const expandProduct = (p) => (p === 'bundle' ? Object.keys(PRODUCTS) : PRODUCTS[p] ? [p] : ['real_estate']);

export const DEFAULT_PLANS = {
  starter:    { name: 'Starter',    product: 'real_estate', seats: 5,    projects: 3,    properties: 200,  storage_mb: 2048,  api_access: 0, price: { USD: { month: 29, year: 290 },   PKR: { month: 8000, year: 80000 } } },
  growth:     { name: 'Growth',     product: 'real_estate', seats: 25,   projects: 25,   properties: 2000, storage_mb: 10240, api_access: 1, price: { USD: { month: 79, year: 790 },   PKR: { month: 22000, year: 220000 } } },
  enterprise: { name: 'Enterprise', product: 'real_estate', seats: null, projects: null, properties: null, storage_mb: null,  api_access: 1, price: { USD: { month: 199, year: 1990 }, PKR: { month: 55000, year: 550000 } } },
};
/**
 * Construction tiers seeded once into existing and new platform databases. Prices mirror the real-estate tiers as
 * placeholders: the platform owner sets the real prices in the console (Plans & pricing) before launch.
 */
export const DEFAULT_CONSTRUCTION_PLANS = {
  con_starter:      { name: 'Starter',      product: 'construction', seats: 5,    projects: 3,    properties: null, storage_mb: 2048,  api_access: 0, price: { USD: { month: 29, year: 290 },   PKR: { month: 8000, year: 80000 } } },
  con_professional: { name: 'Professional', product: 'construction', seats: 25,   projects: 25,   properties: null, storage_mb: 10240, api_access: 1, price: { USD: { month: 79, year: 790 },   PKR: { month: 22000, year: 220000 } } },
  con_enterprise:   { name: 'Enterprise',   product: 'construction', seats: null, projects: null, properties: null, storage_mb: null,  api_access: 1, price: { USD: { month: 199, year: 1990 }, PKR: { month: 55000, year: 550000 } } },
};
export const PLANS = Object.fromEntries(Object.entries(DEFAULT_PLANS).map(([k, v]) => [k, { ...v, grace_days: 7, modules: null, visible: true, active: true, trial_eligible: true, features: [], setup_fee: {} }]));
/** Platform-wide plan settings, kept in sync by plansStore. */
export const PLAN_SETTINGS = { trial_plan: 'growth', trial_plans: { real_estate: 'growth', construction: 'con_professional' }, default_trial_days: 7, trial_reminder_days: [3, 1, 0], renewal_reminder_days: [7, 3, 1], one_trial_per_email: true };

/**
 * Modules a plan can include, the API prefixes (under /api) each one owns, and the product it belongs to (none = shared
 * by every product). Everything not listed is always available.
 */
export const MODULES = {
  re_inventory: { label: 'Property inventory & listings', product: 'real_estate', paths: ['/properties', '/listings'] },
  construction: { label: 'Construction management', product: 'construction', paths: ['/construction'] },
  accounting: { label: 'Accounting & finance', paths: ['/accounting'] },
  hrm: { label: 'HR & payroll', paths: ['/hrm'] },
  tenders: { label: 'Tenders & vendor portal', paths: ['/tenders', '/vendor'] },
  marketing: { label: 'Content & promotions', paths: ['/content', '/promos'] },
  website: { label: 'Website builder & SEO', paths: ['/site-admin', '/seo'] },
  assistant: { label: 'AI assistant', paths: ['/assistant'] },
  insights: { label: 'Insights & analytics', paths: ['/insights'] },
  portal: { label: 'Customer / client portal', paths: ['/portal'] },
};
const trialPlanFor = (product) => {
  const want = PLAN_SETTINGS.trial_plans?.[product] || (product === 'real_estate' ? PLAN_SETTINGS.trial_plan : null);
  if (want && PLANS[want]) return want;
  // otherwise the middle tier of the product family
  const fam = Object.entries(PLANS).filter(([, p]) => p.product === product);
  return fam.length ? fam[Math.floor((fam.length - 1) / 2)][0] : PLAN_SETTINGS.trial_plan;
};
export const trialLimits = (product = 'real_estate') => {
  const p = PLANS[trialPlanFor(product === 'bundle' ? 'real_estate' : product)];
  return { name: 'Free trial', seats: p ? p.seats : null, projects: p ? p.projects : null, properties: p ? p.properties ?? null : null, storage_mb: p ? p.storage_mb ?? null : null, api_access: p ? p.api_access !== false && p.api_access !== 0 : true, modules: p ? p.modules : null };
};
/** A free website (product `website`): the website builder only, no CRM, no payment, never locked for billing. */
export const FREE_SITE_LIMITS = { name: 'Free website', seats: 2, projects: 0, properties: 0, storage_mb: 200, api_access: true, modules: ['website'] };
export const isFreeSite = (tenant) => tenant?.product === 'website';
/** The only API areas a free website workspace can use (everything else is refused on the server, not just hidden). */
const FREE_SITE_API = /^\/(auth|billing|site|site-admin|seo|website-integrations|region|settings|privacy|push|announcements|training|notifications)(\/|$)/;
/** The original install is not metered. */
const LEGACY_LIMITS = { name: 'Unlimited', seats: null, projects: null, properties: null, storage_mb: null, api_access: true, modules: null };
export const GRACE_DAYS = 7;
export const graceDays = (plan) => PLANS[plan]?.grace_days ?? GRACE_DAYS;

const day = (iso) => String(iso || '').slice(0, 10);
const todayUtc = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
/**
 * Has a deadline passed? Full timestamps (trials since the SaaS release, stored in UTC) are compared to the instant;
 * date-only values (older rows) stay valid until the end of that UTC day.
 */
export function ended(when, nowMs = Date.now(), today = todayUtc()) {
  if (!when) return false;
  const s = String(when);
  if (s.length > 10) { const t = Date.parse(s.includes('T') || s.includes('Z') ? s : `${s.replace(' ', 'T')}Z`); return Number.isFinite(t) ? nowMs >= t : today > day(s); }
  return today > s;
}

const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
/** Plan limits with the workspace's own overrides (tenants.entitlements, set by a super admin) and add-ons on top. */
export function effectiveLimits(tenant, base, addons = []) {
  const out = { name: base.name, seats: base.seats ?? null, projects: base.projects ?? null, properties: base.properties ?? null, storage_mb: base.storage_mb ?? null,
    api_access: base.api_access === undefined ? true : !!base.api_access, modules: base.modules ?? null };
  // add-ons raise numeric limits (an unlimited limit stays unlimited) and can switch on API access
  for (const a of addons) {
    for (const k of ['seats', 'projects', 'properties', 'storage_mb']) if (a[k] && out[k] != null) out[k] += a[k];
    if (a.api_access) out.api_access = true;
  }
  const o = parseJson(tenant?.entitlements);
  if (o) {
    for (const k of ['seats', 'projects', 'properties', 'storage_mb']) if (o[k] !== undefined) out[k] = o[k];
    if (o.api_access !== undefined) out.api_access = !!o.api_access;
    if (o.modules !== undefined) out.modules = o.modules;
    out.overridden = true;
  }
  return out;
}

/** Products a workspace may use right now. */
export function tenantProducts(tenant) {
  if (!tenant || tenant.is_legacy) return Object.keys(PRODUCTS);
  if (isFreeSite(tenant)) return [];
  const o = parseJson(tenant.entitlements);
  if (Array.isArray(o?.products) && o.products.length) return o.products.filter((p) => PRODUCTS[p]);
  const sub = tenant.subscription_status || 'trialing';
  const plan = PLANS[tenant.plan];
  if (plan && !['trialing', 'pending'].includes(sub)) return expandProduct(plan.product);
  return expandProduct(tenant.product || 'real_estate');
}

/** Add-on entitlements attached to a workspace; filled in by plansStore (platform DB) so this file stays I/O free. */
let addonLookup = () => [];
export const setAddonLookup = (fn) => { addonLookup = fn; };

/**
 * What a tenant may do right now. Explicit subscription states:
 *  pending   -> waiting for a first payment (no trial); read-only until paid
 *  trialing  -> trial limits until trial_ends_at, then read-only until they subscribe
 *  active    -> their plan
 *  past_due  -> their plan for the plan's grace days after the failed payment, then read-only
 *  canceled  -> their plan until the paid period ends, then read-only
 *  expired   -> trial or paid period over (set by the lifecycle job); read-only
 *  suspended -> the workspace itself is suspended by the platform (no access at all, see platform.js)
 * "Locked" means read-only: nothing is ever deleted for non-payment.
 */
export function billingState(tenant, today = todayUtc(), nowMs = Date.now()) {
  if (!tenant) return { plan: null, status: 'none', locked: false, limits: LEGACY_LIMITS, products: Object.keys(PRODUCTS) };
  const products = tenantProducts(tenant);
  if (tenant.is_legacy) return { plan: 'legacy', status: 'active', locked: false, limits: effectiveLimits(tenant, LEGACY_LIMITS), products };
  if (isFreeSite(tenant)) {
    const base = { products, limits: effectiveLimits(tenant, FREE_SITE_LIMITS), product: 'website', free_site: true, plan: 'site_free', period_end: null };
    if (tenant.status === 'suspended') return { ...base, status: 'suspended', locked: true, reason: 'suspended' };
    if (tenant.status === 'cancelled') return { ...base, status: 'canceled', locked: true, reason: 'cancelled' };
    return { ...base, status: 'active', locked: false };
  }
  const sub = tenant.subscription_status || 'trialing';
  const plan = PLANS[tenant.plan] ? tenant.plan : null;
  const paid = plan && !['trialing', 'pending'].includes(sub);
  const limits = effectiveLimits(tenant, paid ? PLANS[plan] : trialLimits(tenant.product || 'real_estate'), addonLookup(tenant));
  const base = { products, limits, product: tenant.product || 'real_estate' };
  if (tenant.status === 'suspended') return { ...base, plan, status: 'suspended', locked: true, reason: 'suspended' };
  if (tenant.status === 'cancelled') return { ...base, plan, status: 'canceled', locked: true, reason: 'cancelled' };
  if (sub === 'active') return { ...base, plan, status: 'active', locked: false, period_end: tenant.current_period_end || null };
  if (sub === 'past_due') {
    const until = tenant.grace_until ? day(tenant.grace_until) : addDaysIso(today, graceDays(plan));
    const locked = today > until;
    return { ...base, plan, status: 'past_due', locked, reason: locked ? 'payment_failed' : undefined, grace_until: until, period_end: tenant.current_period_end || null };
  }
  if (sub === 'canceled') {
    const end = day(tenant.current_period_end);
    const locked = !end || today > end;
    return { ...base, plan, status: 'canceled', locked, reason: locked ? 'subscription_ended' : undefined, period_end: end || null };
  }
  if (sub === 'expired') {
    const fromTrial = !paid || !tenant.current_period_end;
    return { ...base, plan: paid ? plan : null, status: 'expired', locked: true, reason: fromTrial ? 'trial_ended' : 'subscription_ended', trial_ends_at: tenant.trial_ends_at || null, period_end: tenant.current_period_end || null };
  }
  if (sub === 'pending') return { ...base, plan: null, status: 'pending', locked: true, reason: 'payment_pending' };
  // trialing
  const end = tenant.trial_ends_at || null;
  const locked = !!end && ended(end, nowMs, today);
  return { ...base, plan: null, status: 'trialing', locked, reason: locked ? 'trial_ended' : undefined, trial_started_at: tenant.trial_started_at || null, trial_ends_at: end, days_left: end ? Math.max(0, daysBetween(today, day(end))) : null };
}

/** Plans a customer can choose: visible and on sale (optionally of one product), plus the plan they are already on. */
export const planCatalog = (current, product = null) => Object.entries(PLANS)
  .filter(([id, p]) => ((p.visible && p.active) || id === current) && (!product || p.product === product || p.product === 'bundle' || id === current))
  .map(([id, p]) => ({ id, name: p.name, product: p.product, description: p.description || null, seats: p.seats, projects: p.projects, properties: p.properties ?? null, storage_mb: p.storage_mb ?? null,
    api_access: !!p.api_access, modules: p.modules, features: p.features || [], highlight: !!p.highlight, trial_eligible: p.trial_eligible !== false, setup_fee: p.setup_fee || {}, price: p.price }));
/** A plan may be bought when it is on sale, or renewed when it is the workspace's current plan. */
export function assertSellable(plan, tenant) {
  const p = PLANS[plan];
  if (!p) throw new HttpError(400, 'Unknown plan');
  if (!p.active && tenant?.plan !== plan) throw new HttpError(400, 'This plan is no longer available');
  // a workspace stays in its product family; moving to both products is done with a bundle plan
  const own = tenant && !tenant.is_legacy ? tenant.product || 'real_estate' : null;
  if (own && own !== 'bundle' && p.product !== 'bundle' && p.product !== own && tenant.plan !== plan) throw new HttpError(400, 'That plan belongs to another product. Choose a combined (bundle) plan or contact us to add a product.');
}

export class PlanLimitError extends HttpError {
  constructor(message, code, extra = {}) { super(402, message, { code, ...extra }); }
}

// ---------------------------------------------------------------- usage (inside the tenant's own database)
const sizeCache = new Map();
/** Bytes stored in the workspace's upload folder; recounted at most every 10 minutes. */
export function storageBytes(dir = uploadDir()) {
  const hit = sizeCache.get(dir);
  if (hit && Date.now() - hit.at < 600_000) return hit.bytes;
  let bytes = 0;
  const walk = (d) => { let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of list) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { try { bytes += fs.statSync(p).size; } catch { /* vanished */ } } } };
  walk(dir);
  sizeCache.set(dir, { bytes, at: Date.now() });
  return bytes;
}
export const forgetStorage = (dir = uploadDir()) => sizeCache.delete(dir);

/** Counts that plans limit: active staff logins (+ pending invitations, so you cannot invite past the limit), projects, properties and storage. */
export function usage() {
  const seats = val('SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0');
  const invited = val("SELECT COUNT(*) FROM auth_tokens WHERE kind='invite' AND used_at IS NULL AND expires_at>?", new Date().toISOString());
  return { seats, invited, projects: val('SELECT COUNT(*) FROM projects'), properties: val('SELECT COUNT(*) FROM properties'), storage_mb: Math.round((storageBytes() / 1048576) * 10) / 10 };
}

export function assertSeatAvailable(tenant, { includeInvites = true, extra = 1 } = {}) {
  const st = billingState(tenant);
  if (st.limits.seats == null) return;
  const u = usage();
  if (u.seats + (includeInvites ? u.invited : 0) + extra > st.limits.seats) {
    throw new PlanLimitError(`Your ${st.limits.name} plan allows ${st.limits.seats} team members. Upgrade to add more.`, 'seat_limit', { limit: st.limits.seats });
  }
}
const countLimit = (key, noun) => (tenant) => {
  const st = billingState(tenant);
  if (st.limits[key] == null) return;
  if (val(`SELECT COUNT(*) FROM ${key}`) + 1 > st.limits[key]) {
    throw new PlanLimitError(`Your ${st.limits.name} plan allows ${st.limits[key]} ${noun}. Upgrade to add more.`, `${key.replace(/s$/, '').replace('propertie', 'property')}_limit`, { limit: st.limits[key] });
  }
};
export const assertProjectAvailable = countLimit('projects', 'projects');
export const assertPropertyAvailable = countLimit('properties', 'properties');
export function assertStorageAvailable(tenant) {
  const st = billingState(tenant);
  if (st.limits.storage_mb == null) return;
  if (storageBytes() / 1048576 >= st.limits.storage_mb) throw new PlanLimitError(`Your ${st.limits.name} plan includes ${st.limits.storage_mb} MB of file storage, which is full. Delete files or upgrade.`, 'storage_limit', { limit: st.limits.storage_mb });
}

const LOCK_MESSAGES = {
  trial_ended: 'Your free trial has ended. Your data is safe and read-only; choose a plan to keep editing.',
  payment_failed: 'Your last payment failed and the grace period has ended. Your data is safe and read-only; update your payment to continue.',
  subscription_ended: 'Your subscription has ended. Your data is safe and read-only; renew to continue.',
  payment_pending: 'Your workspace is waiting for its first payment. Your data is safe and read-only; choose a plan to start.',
  cancelled: 'This workspace has been cancelled. Contact support to reactivate it.',
  suspended: 'This workspace is suspended. Please contact support.',
};
export const lockMessage = (reason) => LOCK_MESSAGES[reason] || 'This workspace is read-only until billing is up to date.';

/** Which module (if any) owns an /api path. */
export const moduleFor = (p) => Object.entries(MODULES).find(([, m]) => m.paths.some((x) => p === x || p.startsWith(`${x}/`)));

/**
 * Express guard: while a workspace is locked, reads still work (people can see and export their data) but writes are
 * refused with 402. Sign-in, billing, and the public website's visitor forms stay open. Product modules, plan modules
 * and usage limits are enforced here, so hiding a menu item is never the only protection.
 */
export function billingGuard(req, _res, next) {
  const t = req.tenant;
  if (!t) return next();
  const st = billingState(t);
  const open = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /^\/(auth|billing|site|public)(\/|$)/.test(req.path);
  if (st.locked && !open) return next(new HttpError(402, lockMessage(st.reason), { code: 'billing_locked', reason: st.reason }));
  if (st.free_site && !FREE_SITE_API.test(req.path)) return next(new HttpError(403, 'This is a free website account: it includes the website builder only.', { code: 'free_site_only' }));
  const mod = moduleFor(req.path);
  if (mod && mod[1].product && !st.products.includes(mod[1].product)) {
    return next(new HttpError(402, `${mod[1].label} is part of ${PRODUCTS[mod[1].product].label}, which your subscription does not include. Add it from Plan & Billing.`, { code: 'product_not_in_plan', product: mod[1].product, module: mod[0] }));
  }
  if (mod && Array.isArray(st.limits.modules) && !st.limits.modules.includes(mod[0])) return next(new HttpError(402, `${mod[1].label} is not included in your plan. Upgrade to use it.`, { code: 'module_not_in_plan', module: mod[0] }));
  try {
    if (req.method === 'POST' && req.path === '/projects') assertProjectAvailable(t);
    if (req.method === 'POST' && req.path === '/properties') assertPropertyAvailable(t);
    if (['POST', 'PUT'].includes(req.method) && /^multipart\/form-data/i.test(req.headers['content-type'] || '')) assertStorageAvailable(t);
  } catch (e) { return next(e); }
  next();
}

/** Guard for the key-authenticated website API: plans without API access get 402. */
export function apiAccessGuard(req, _res, next) {
  if (!req.tenant) return next();
  const st = billingState(req.tenant);
  if (!st.limits.api_access) return next(new HttpError(402, 'API access is not included in this workspace\'s plan.', { code: 'api_not_in_plan' }));
  next();
}
