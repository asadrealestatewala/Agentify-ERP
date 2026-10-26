// Plans, add-ons and coupons in the platform database. Prices are versioned: editing a price adds a new row with the date
// it takes effect, so earlier prices stay on record and invoices keep the amount actually charged. Workspaces already
// subscribed keep the price they signed up at (tenants.price_amount) until a new payment renews them at the then-current price.
//
// Effects of editing a plan on existing workspaces:
//   name / description / features / visibility      immediate, cosmetic
//   limits (users, projects, properties, storage,
//           API access, modules)                     immediate for every workspace on the plan (unless it has its own overrides)
//   prices / setup fee                               new purchases and renewals only
//   on sale (active = 0)                             no new purchases; current subscribers can still renew
//   product family                                   cannot be changed once a workspace is subscribed to the plan
import { PLANS, DEFAULT_PLANS, DEFAULT_CONSTRUCTION_PLANS, PLAN_SETTINGS, MODULES, PRODUCT_CHOICES, setAddonLookup } from './plans.js';
import { bad, HttpError } from '../util.js';
import { cleanEmailLimits } from './emailLimits.js';

export const PLANS_SCHEMA = `
CREATE TABLE IF NOT EXISTS plans(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, seats INTEGER, projects INTEGER, grace_days INTEGER NOT NULL DEFAULT 7,
  modules TEXT, visible INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT);
CREATE TABLE IF NOT EXISTS plan_prices(
  id INTEGER PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, currency TEXT NOT NULL, interval TEXT NOT NULL CHECK(interval IN ('month','year')),
  amount INTEGER NOT NULL CHECK(amount >= 0), effective_from TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT);
CREATE INDEX IF NOT EXISTS idx_plan_prices ON plan_prices(plan_id, currency, interval, effective_from);
-- optional extras sold on top of a plan (extra users, storage, API access, ...); entitlements are added to the plan's limits
CREATE TABLE IF NOT EXISTS addons(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, product TEXT NOT NULL DEFAULT 'any', price TEXT NOT NULL DEFAULT '{}', entitlements TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT);
CREATE TABLE IF NOT EXISTS tenant_addons(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, addon_id TEXT NOT NULL REFERENCES addons(id), quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')), started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, source TEXT, created_by TEXT);
CREATE INDEX IF NOT EXISTS idx_tenant_addons ON tenant_addons(tenant_id, status);
-- discount codes for local / manual payments (Stripe checkout uses Stripe's own promotion codes)
CREATE TABLE IF NOT EXISTS coupons(
  code TEXT PRIMARY KEY COLLATE NOCASE, description TEXT, percent_off INTEGER CHECK(percent_off IS NULL OR (percent_off BETWEEN 1 AND 100)), amount_off TEXT,
  products TEXT, plans TEXT, intervals TEXT, first_payment_only INTEGER NOT NULL DEFAULT 1, max_redemptions INTEGER, valid_from TEXT, valid_until TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS coupon_redemptions(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, submission_id INTEGER, amount_off INTEGER NOT NULL, currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(code, submission_id));
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions ON coupon_redemptions(code);
`;
/** Columns added to plans for the SaaS release (product families, more limits, marketing content, setup fee). */
const PLAN_COLUMNS = [['product', "TEXT NOT NULL DEFAULT 'real_estate'"], ['properties', 'INTEGER'], ['storage_mb', 'INTEGER'], ['api_access', 'INTEGER NOT NULL DEFAULT 1'],
  ['features', 'TEXT'], ['highlight', 'INTEGER NOT NULL DEFAULT 0'], ['trial_eligible', 'INTEGER NOT NULL DEFAULT 1'], ['setup_fee', 'TEXT'], ['email_limits', 'TEXT']];
export const CURRENCIES = ['PKR', 'USD'];
const ID_RE = /^[a-z][a-z0-9_]{1,30}$/;

let db = null;
const setting = (k) => db.prepare('SELECT value FROM platform_settings WHERE key=?').get(k)?.value;
const mark = (k) => db.prepare("INSERT OR IGNORE INTO platform_settings(key,value) VALUES(?,'1')").run(k);

function insertPlan(id, p, sort) {
  db.prepare('INSERT OR IGNORE INTO plans(id,name,product,seats,projects,properties,storage_mb,api_access,sort_order,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, p.name, p.product, p.seats, p.projects, p.properties ?? null, p.storage_mb ?? null, p.api_access ? 1 : 0, sort, 'system');
  for (const [cur, byInt] of Object.entries(p.price)) for (const [int, amount] of Object.entries(byInt)) {
    if (!db.prepare('SELECT 1 FROM plan_prices WHERE plan_id=? AND currency=? AND interval=?').get(id, cur, int)) db.prepare("INSERT INTO plan_prices(plan_id,currency,interval,amount,effective_from,created_by) VALUES(?,?,?,?,'2000-01-01 00:00:00','system')").run(id, cur, int, amount);
  }
}

/** Called once by platformDb(): create/upgrade the tables, seed the default plans once, load PLANS. */
export function initPlans(pdb) {
  db = pdb;
  db.exec(PLANS_SCHEMA);
  const have = new Set(db.prepare('PRAGMA table_info(plans)').all().map((c) => c.name));
  for (const [c, def] of PLAN_COLUMNS) if (!have.has(c)) db.exec(`ALTER TABLE plans ADD COLUMN ${c} ${def}`);
  const sub = new Set(db.prepare('PRAGMA table_info(payment_submissions)').all().map((c) => c.name));
  for (const [c, def] of [['coupon_code', 'TEXT'], ['discount_amount', 'INTEGER NOT NULL DEFAULT 0'], ['setup_fee', 'INTEGER NOT NULL DEFAULT 0'], ['addons', 'TEXT'], ['list_amount', 'INTEGER']]) if (!sub.has(c)) db.exec(`ALTER TABLE payment_submissions ADD COLUMN ${c} ${def}`);
  if (!db.prepare('SELECT 1 FROM plans LIMIT 1').get()) {
    let i = 0;
    for (const [id, p] of Object.entries(DEFAULT_PLANS)) insertPlan(id, p, i++);
  }
  // existing real-estate plans keep their limits; the new limits start at the seeded values for the known tiers only
  if (!setting('seeded_saas_limits')) {
    for (const [id, p] of Object.entries(DEFAULT_PLANS)) db.prepare('UPDATE plans SET properties=COALESCE(properties,?), storage_mb=COALESCE(storage_mb,?), api_access=? WHERE id=?').run(p.properties, p.storage_mb, p.api_access ? 1 : 0, id);
    mark('seeded_saas_limits');
  }
  // the construction product family is added once; deleting or renaming those plans later is respected
  if (!setting('seeded_construction_plans')) {
    let i = (db.prepare('SELECT COALESCE(MAX(sort_order),0) n FROM plans').get().n || 0) + 1;
    for (const [id, p] of Object.entries(DEFAULT_CONSTRUCTION_PLANS)) insertPlan(id, p, i++);
    mark('seeded_construction_plans');
  }
  // placeholder prices in the other launch currencies, derived from the USD price once; the platform owner edits them in the console
  if (!setting('seeded_local_currencies_v1')) {
    const RATE = { GBP: 0.8, AED: 3.67, CAD: 1.4 };
    for (const r of db.prepare("SELECT plan_id, interval, amount FROM plan_prices WHERE currency='USD'").all()) {
      for (const [cur, k] of Object.entries(RATE)) {
        if (db.prepare('SELECT 1 FROM plan_prices WHERE plan_id=? AND currency=? AND interval=?').get(r.plan_id, cur, r.interval)) continue;
        db.prepare("INSERT INTO plan_prices(plan_id,currency,interval,amount,effective_from,created_by) VALUES(?,?,?,?,'2000-01-01 00:00:00','system')").run(r.plan_id, cur, r.interval, Math.round(r.amount * k));
      }
    }
    mark('seeded_local_currencies_v1');
  }
  setAddonLookup((tenant) => {
    if (!tenant?.id) return [];
    return db.prepare("SELECT a.entitlements, ta.quantity FROM tenant_addons ta JOIN addons a ON a.id=ta.addon_id WHERE ta.tenant_id=? AND ta.status='active'").all(tenant.id).map((r) => {
      const e = parseJson(r.entitlements) || {};
      const out = {};
      for (const k of ['seats', 'projects', 'properties', 'storage_mb']) if (e[k]) out[k] = Number(e[k]) * r.quantity;
      if (e.api_access) out.api_access = true;
      return out;
    });
  });
  reloadPlans();
}

const parseJson = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
/** Rebuild the in-memory PLANS object in place (same object, so every importer sees the change). */
export function reloadPlans() {
  const rows = db.prepare('SELECT * FROM plans ORDER BY sort_order, id').all();
  const prices = db.prepare(`SELECT p.plan_id, p.currency, p.interval, p.amount FROM plan_prices p
    WHERE p.id = (SELECT q.id FROM plan_prices q WHERE q.plan_id=p.plan_id AND q.currency=p.currency AND q.interval=p.interval AND q.effective_from<=datetime('now') ORDER BY q.effective_from DESC, q.id DESC LIMIT 1)`).all();
  for (const k of Object.keys(PLANS)) delete PLANS[k];
  for (const r of rows) {
    const price = {};
    for (const p of prices.filter((x) => x.plan_id === r.id)) (price[p.currency] ||= {})[p.interval] = p.amount;
    PLANS[r.id] = { name: r.name, product: r.product || 'real_estate', description: r.description, seats: r.seats, projects: r.projects, properties: r.properties, storage_mb: r.storage_mb, api_access: !!r.api_access,
      grace_days: r.grace_days, modules: r.modules ? JSON.parse(r.modules) : null, visible: !!r.visible, active: !!r.active, features: parseJson(r.features, []), highlight: !!r.highlight,
      trial_eligible: r.trial_eligible !== 0, setup_fee: parseJson(r.setup_fee, {}), email_limits: parseJson(r.email_limits, null), price };
  }
  PLAN_SETTINGS.trial_plan = setting('trial_plan') || (PLANS.growth ? 'growth' : Object.keys(PLANS)[0] || 'growth');
  PLAN_SETTINGS.trial_plans = { real_estate: PLAN_SETTINGS.trial_plan, construction: setting('trial_plan_construction') || (PLANS.con_professional ? 'con_professional' : null) };
  PLAN_SETTINGS.default_trial_days = Number(setting('default_trial_days') ?? 7);
  PLAN_SETTINGS.trial_reminder_days = parseJson(setting('trial_reminder_days'), [3, 1, 0]);
  PLAN_SETTINGS.renewal_reminder_days = parseJson(setting('renewal_reminder_days'), [7, 3, 1]);
  PLAN_SETTINGS.one_trial_per_email = setting('one_trial_per_email') !== '0';
}

export function listPlans() {
  const subs = Object.fromEntries(db.prepare("SELECT plan, COUNT(*) n FROM tenants WHERE is_legacy=0 AND status='active' AND subscription_status NOT IN ('trialing','pending','expired') GROUP BY plan").all().map((r) => [r.plan, r.n]));
  return db.prepare('SELECT * FROM plans ORDER BY sort_order, id').all().map((r) => ({
    id: r.id, name: r.name, product: r.product, description: r.description, seats: r.seats, projects: r.projects, properties: r.properties, storage_mb: r.storage_mb, api_access: !!r.api_access,
    grace_days: r.grace_days, modules: r.modules ? JSON.parse(r.modules) : null, features: parseJson(r.features, []), highlight: !!r.highlight, trial_eligible: r.trial_eligible !== 0, setup_fee: parseJson(r.setup_fee, {}), email_limits: parseJson(r.email_limits, null),
    visible: !!r.visible, active: !!r.active, sort_order: r.sort_order, updated_at: r.updated_at, updated_by: r.updated_by, subscribers: subs[r.id] || 0,
    price: PLANS[r.id]?.price || {},
    price_history: db.prepare('SELECT currency, interval, amount, effective_from, created_by FROM plan_prices WHERE plan_id=? ORDER BY effective_from DESC, id DESC LIMIT 40').all(r.id),
  }));
}

const limitVal = (v, label) => {
  if (v === null || v === '' || v === undefined) return null;
  const n = Math.trunc(Number(v));
  if (!(n >= 1 && n <= 10_000_000)) throw bad(`${label} must be a whole number from 1, or empty for unlimited`);
  return n;
};
export function cleanModules(m) {
  if (m === null || m === undefined) return null;
  if (!Array.isArray(m)) throw bad('Modules must be a list');
  const bad1 = m.filter((x) => !MODULES[x]);
  if (bad1.length) throw bad(`Unknown module(s): ${bad1.join(', ')}`);
  return [...new Set(m)];
}
const cleanFeatures = (f) => {
  if (f === null || f === undefined) return null;
  if (!Array.isArray(f)) throw bad('Features must be a list of short lines');
  return f.map((x) => String(x || '').trim().slice(0, 120)).filter(Boolean).slice(0, 30);
};
export function cleanMoneyMap(m, label) {
  if (m === null || m === undefined || m === '') return {};
  if (typeof m !== 'object') throw bad(`${label} must be amounts per currency`);
  const out = {};
  for (const [cur, v] of Object.entries(m)) {
    if (v === null || v === '' || v === undefined) continue;
    if (!CURRENCIES.includes(cur)) throw bad(`${label}: unknown currency ${cur}`);
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9 || Math.trunc(n) !== n) throw bad(`${label} in ${cur} must be a whole amount`);
    if (n > 0) out[cur] = n;
  }
  return out;
}

/** Create or update a plan. Only prices that differ from the current ones get a new price row. */
export function savePlan(id, b, actor) {
  const pid = String(id || '').trim().toLowerCase();
  if (!ID_RE.test(pid) || ['trial', 'legacy', 'manual'].includes(pid)) throw bad('Plan ID must be 2-31 lowercase letters, digits or underscores, starting with a letter (not trial, legacy or manual)');
  const exists = db.prepare('SELECT * FROM plans WHERE id=?').get(pid);
  const name = String(b.name ?? exists?.name ?? '').trim();
  if (!name || name.length > 60) throw bad('Plan name is required (up to 60 characters)');
  const grace = b.grace_days === undefined ? (exists?.grace_days ?? 7) : Math.trunc(Number(b.grace_days));
  if (!(grace >= 0 && grace <= 90)) throw bad('Grace days must be between 0 and 90');
  const product = b.product === undefined ? exists?.product ?? 'real_estate' : String(b.product);
  if (!PRODUCT_CHOICES.includes(product)) throw bad(`Product must be one of: ${PRODUCT_CHOICES.join(', ')}`);
  if (exists && product !== exists.product && db.prepare("SELECT 1 FROM tenants WHERE plan=? AND subscription_status NOT IN ('trialing','pending')").get(pid)) throw bad('Workspaces are subscribed to this plan, so its product cannot change. Create a new plan instead.');
  const fields = {
    name, product, description: b.description === undefined ? exists?.description ?? null : (String(b.description || '').trim().slice(0, 300) || null),
    seats: b.seats === undefined ? exists?.seats ?? null : limitVal(b.seats, 'User limit'),
    projects: b.projects === undefined ? exists?.projects ?? null : limitVal(b.projects, 'Project limit'),
    properties: b.properties === undefined ? exists?.properties ?? null : limitVal(b.properties, 'Property limit'),
    storage_mb: b.storage_mb === undefined ? exists?.storage_mb ?? null : limitVal(b.storage_mb, 'Storage (MB)'),
    api_access: b.api_access === undefined ? exists?.api_access ?? 1 : (b.api_access ? 1 : 0),
    grace_days: grace,
    modules: b.modules === undefined ? exists?.modules ?? null : (cleanModules(b.modules) ? JSON.stringify(cleanModules(b.modules)) : null),
    features: b.features === undefined ? exists?.features ?? null : (cleanFeatures(b.features) ? JSON.stringify(cleanFeatures(b.features)) : null),
    highlight: b.highlight === undefined ? exists?.highlight ?? 0 : (b.highlight ? 1 : 0),
    trial_eligible: b.trial_eligible === undefined ? exists?.trial_eligible ?? 1 : (b.trial_eligible ? 1 : 0),
    setup_fee: b.setup_fee === undefined ? exists?.setup_fee ?? null : JSON.stringify(cleanMoneyMap(b.setup_fee, 'Setup fee')),
    email_limits: b.email_limits === undefined ? exists?.email_limits ?? null : (cleanEmailLimits(b.email_limits) ? JSON.stringify(cleanEmailLimits(b.email_limits)) : null),
    visible: b.visible === undefined ? exists?.visible ?? 1 : (b.visible ? 1 : 0),
    active: b.active === undefined ? exists?.active ?? 1 : (b.active ? 1 : 0),
    sort_order: b.sort_order === undefined ? exists?.sort_order ?? (db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM plans').get().n) : Math.trunc(Number(b.sort_order)) || 0,
  };
  const newPrices = [];
  for (const cur of CURRENCIES) for (const int of ['month', 'year']) {
    const v = b.price?.[cur]?.[int];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9 || Math.trunc(n) !== n) throw bad(`${cur} ${int}ly price must be a whole amount`);
    if (PLANS[pid]?.price?.[cur]?.[int] !== n) newPrices.push([cur, int, n]);
  }
  if (!exists && !newPrices.some(([cur]) => cur === 'PKR')) throw bad('A new plan needs at least its PKR monthly and yearly prices');
  const changes = { created: !exists, fields: Object.keys(fields).filter((k) => !exists || String(exists[k] ?? '') !== String(fields[k] ?? '')), prices: newPrices.map(([c, i, a]) => ({ currency: c, interval: i, from: PLANS[pid]?.price?.[c]?.[i] ?? null, to: a })) };
  db.exec('BEGIN IMMEDIATE');
  try {
    if (exists) db.prepare(`UPDATE plans SET ${Object.keys(fields).map((k) => `${k}=?`).join(',')}, updated_at=datetime('now'), updated_by=? WHERE id=?`).run(...Object.values(fields), actor, pid);
    else db.prepare(`INSERT INTO plans(id,${Object.keys(fields).join(',')},updated_by) VALUES(?,${Object.keys(fields).map(() => '?').join(',')},?)`).run(pid, ...Object.values(fields), actor);
    for (const [cur, int, amount] of newPrices) db.prepare('INSERT INTO plan_prices(plan_id,currency,interval,amount,created_by) VALUES(?,?,?,?,?)').run(pid, cur, int, amount, actor);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  reloadPlans();
  return { plan: listPlans().find((p) => p.id === pid), changes };
}

const dayList = (v, label) => {
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = [...new Set(arr.map((x) => Math.trunc(Number(x))).filter((n) => Number.isFinite(n)))].sort((a, b) => b - a);
  if (out.some((n) => n < 0 || n > 60) || out.length > 6) throw bad(`${label}: up to 6 whole numbers of days between 0 and 60`);
  return out;
};
/** Trial length for new sign-ups, which plan's limits a trial gets per product, reminder schedules and trial abuse rules. */
export function savePlanSettings({ default_trial_days, trial_plan, trial_plan_construction, trial_reminder_days, renewal_reminder_days, one_trial_per_email }, actor) {
  const set = (k, v) => db.prepare("INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(k, String(v), actor);
  if (default_trial_days !== undefined) {
    const n = Math.trunc(Number(default_trial_days));
    if (!(n >= 0 && n <= 365)) throw bad('Trial days must be between 0 and 365');
    set('default_trial_days', n);
  }
  if (trial_plan !== undefined) {
    if (!PLANS[trial_plan]) throw new HttpError(400, 'Unknown plan');
    set('trial_plan', trial_plan);
  }
  if (trial_plan_construction !== undefined) {
    if (!PLANS[trial_plan_construction]) throw new HttpError(400, 'Unknown plan');
    set('trial_plan_construction', trial_plan_construction);
  }
  if (trial_reminder_days !== undefined) set('trial_reminder_days', JSON.stringify(dayList(trial_reminder_days, 'Trial reminders')));
  if (renewal_reminder_days !== undefined) set('renewal_reminder_days', JSON.stringify(dayList(renewal_reminder_days, 'Renewal reminders')));
  if (one_trial_per_email !== undefined) set('one_trial_per_email', one_trial_per_email ? '1' : '0');
  reloadPlans();
  return { ...PLAN_SETTINGS };
}
