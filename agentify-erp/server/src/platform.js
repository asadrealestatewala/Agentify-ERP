// Control plane: the registry of tenants (companies) and the glue that runs each request inside its tenant.
// Every tenant has its own SQLite database file and upload folder; this file only knows who the tenants are.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR, UPLOAD_DIR, DEFAULT_DB_FILE, openDb, setSetting } from './db.js';
import { als } from './context.js';
import { bootstrap, upgradePermissions, seedDemo, ensureBootstrapped } from './seed.js';
import { ensureSite } from './services/siteDefaults.js';
import { HttpError, bad } from './util.js';
import { isEmail, isPersonName } from './validation.js';
import { initPlans } from './services/plansStore.js';
import { PLAN_SETTINGS, PLANS, PRODUCT_CHOICES } from './services/plans.js';
import crypto from 'node:crypto';
import { seedRegionDemo } from './regions/demo.js';
import { syncRegionLookups } from './regions/lookups.js';
import { initRegions, REGION_COLUMNS, selectableRegions } from './regions/index.js';

export const PLATFORM_DB_FILE = process.env.ERP_PLATFORM_DB || path.join(DATA_DIR, 'platform.db');
/** Set ERP_BASE_DOMAIN (e.g. agentifyerp.com, or localhost in development) to serve many tenants by subdomain. */
export const BASE_DOMAIN = (process.env.ERP_BASE_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
export const isMultiTenant = () => !!BASE_DOMAIN;
/** Slug of the original single-company install, which keeps its existing database and uploads in place. */
export const LEGACY_SLUG = (process.env.ERP_DEFAULT_TENANT || 'default').toLowerCase();

/** Columns added after the first release; added in place so existing platform databases upgrade on start-up. */
const TENANT_COLUMNS = [['subscription_status', "TEXT NOT NULL DEFAULT 'trialing'"], ['current_period_end', 'TEXT'], ['grace_until', 'TEXT'], ['billing_interval', 'TEXT'],
  ['billing_provider', 'TEXT'], ['provider_customer_id', 'TEXT'], ['provider_subscription_id', 'TEXT'],
  // per-workspace limit overrides (JSON {seats, projects, modules}), the price this workspace pays, and profile fields
  ['entitlements', 'TEXT'], ['price_amount', 'INTEGER'], ['price_currency', 'TEXT'], ['owner_name', 'TEXT'], ['owner_phone', 'TEXT'], ['account_manager', 'TEXT'],
  // SaaS release: product chosen at signup, trial start (UTC), when a subscription was cancelled, why a trial was not granted
  ['product', "TEXT NOT NULL DEFAULT 'real_estate'"], ['trial_started_at', 'TEXT'], ['canceled_at', 'TEXT'], ['trial_note', 'TEXT'],
  ['email_prefs', 'TEXT'], ['terms_version', 'INTEGER'], ['terms_accepted_at', 'TEXT'], ['data_deleted_at', 'TEXT'], ['close_requested_at', 'TEXT']];

const PLATFORM_SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','cancelled')),
  plan TEXT NOT NULL DEFAULT 'trial', trial_ends_at TEXT,
  db_file TEXT NOT NULL, upload_dir TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Karachi', currency TEXT NOT NULL DEFAULT 'PKR',
  custom_domain TEXT UNIQUE COLLATE NOCASE, owner_email TEXT, is_legacy INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS billing_events(
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, event_id TEXT NOT NULL, tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL, type TEXT NOT NULL,
  payload TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(provider, event_id));
-- online one-time period payments (PayPal, Tap, ...) for plan subscriptions; confirmed with the provider, then approved like a manual payment
CREATE TABLE IF NOT EXISTS platform_checkouts(
  id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, plan TEXT NOT NULL, interval TEXT NOT NULL,
  quote TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, minor_amount INTEGER NOT NULL, sandbox INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'created',
  external_id TEXT, payment_ref TEXT, submission_id INTEGER, error TEXT, created_by TEXT, return_origin TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_platform_checkouts_ext ON platform_checkouts(provider, external_id);
CREATE TABLE IF NOT EXISTS invoices(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, provider_invoice_id TEXT, amount INTEGER NOT NULL, currency TEXT NOT NULL,
  status TEXT NOT NULL, hosted_url TEXT, period_start TEXT, period_end TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, provider_invoice_id));
CREATE TABLE IF NOT EXISTS payment_submissions(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, plan TEXT NOT NULL, interval TEXT NOT NULL, method TEXT NOT NULL,
  amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'PKR', reference TEXT NOT NULL, note TEXT, submitted_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), decision_note TEXT, decided_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- the same transaction reference can back only one live submission, whichever workspace sends it
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_sub_ref ON payment_submissions(method, lower(reference)) WHERE status<>'rejected';
-- platform-level configuration edited from the admin console; secret values are stored encrypted (services/platformConfig.js)
CREATE TABLE IF NOT EXISTS platform_settings(key TEXT PRIMARY KEY, value TEXT, secret INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT);
-- one-time email codes (signup proof of mailbox, workspace sign-in): only an HMAC of the code is stored (services/emailOtp.js)
CREATE TABLE IF NOT EXISTS email_otps(
  id INTEGER PRIMARY KEY, purpose TEXT NOT NULL, email TEXT NOT NULL, tenant_id INTEGER, user_id INTEGER, code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, ip TEXT, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON email_otps(purpose, email, tenant_id, id);
-- the Super Admin's own list of email domains to refuse (or always accept) on top of the built-in disposable list
CREATE TABLE IF NOT EXISTS email_domain_rules(
  domain TEXT PRIMARY KEY, action TEXT NOT NULL CHECK(action IN ('block','allow')), note TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- where customers send money for the local methods (Raast, Easypaisa, JazzCash, SadaPay, NayaPay, bank)
CREATE TABLE IF NOT EXISTS payment_accounts(
  id INTEGER PRIMARY KEY, method TEXT NOT NULL, account TEXT NOT NULL, account_name TEXT, note TEXT, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS platform_admins(
  totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, recovery_codes TEXT, totp_last_step INTEGER NOT NULL DEFAULT 0,
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, token_version INTEGER NOT NULL DEFAULT 0,
  last_login TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS platform_audit(id INTEGER PRIMARY KEY, admin TEXT, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- one row per day (platform timezone): what the platform looked like, so dashboards can compare with earlier periods
CREATE TABLE IF NOT EXISTS platform_metrics_daily(
  day TEXT PRIMARY KEY, workspaces INTEGER NOT NULL, active INTEGER NOT NULL, suspended INTEGER NOT NULL, cancelled INTEGER NOT NULL,
  trialing INTEGER NOT NULL, paying INTEGER NOT NULL, past_due INTEGER NOT NULL, locked INTEGER NOT NULL, mrr TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')));
-- alerts for super admins; dedupe keeps one row per condition, resolved_at is set when the condition clears
CREATE TABLE IF NOT EXISTS platform_notifications(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')), title TEXT NOT NULL, body TEXT,
  link TEXT, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, dedupe TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
CREATE INDEX IF NOT EXISTS idx_pnotif_open ON platform_notifications(resolved_at, id);
CREATE TABLE IF NOT EXISTS platform_notification_reads(admin_id INTEGER NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE, notification_id INTEGER NOT NULL REFERENCES platform_notifications(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(admin_id, notification_id));
CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_billing_events_created ON billing_events(created_at);
CREATE TABLE IF NOT EXISTS tenant_events(
  id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, action TEXT NOT NULL, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_tenant_events_created ON tenant_events(created_at);
-- every change to a workspace's plan or billing state, append-only (written by services/subscriptions.js)
CREATE TABLE IF NOT EXISTS subscription_history(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, source TEXT NOT NULL, actor TEXT, reason TEXT,
  from_plan TEXT, to_plan TEXT, from_status TEXT, to_status TEXT, from_period_end TEXT, to_period_end TEXT, trial_ends_at TEXT, grace_until TEXT,
  interval TEXT, price_amount INTEGER, price_currency TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_sub_hist ON subscription_history(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_sub_hist_created ON subscription_history(created_at);
CREATE TRIGGER IF NOT EXISTS sub_hist_no_update BEFORE UPDATE ON subscription_history BEGIN SELECT RAISE(ABORT, 'subscription history is append-only'); END;
CREATE TABLE IF NOT EXISTS tenant_notes(id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, admin TEXT NOT NULL, body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_tenant_notes ON tenant_notes(tenant_id, id);
`;

// added after the first release (run after the column upgrades above)
const PLATFORM_SCHEMA_2 = `
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_platform_audit_admin ON platform_audit(admin, id);
-- the audit trail is append-only: no edits or deletions, even from the console
CREATE TRIGGER IF NOT EXISTS platform_audit_no_update BEFORE UPDATE ON platform_audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS platform_audit_no_delete BEFORE DELETE ON platform_audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TABLE IF NOT EXISTS platform_logins(id INTEGER PRIMARY KEY, admin_id INTEGER, email TEXT, outcome TEXT NOT NULL, ip TEXT, user_agent TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_platform_logins ON platform_logins(created_at);
CREATE INDEX IF NOT EXISTS idx_platform_logins_email ON platform_logins(email, created_at);
-- money returned to customers; invoices stay as collected so gross, refunds and net are reported separately
CREATE TABLE IF NOT EXISTS refunds(id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK(amount > 0), currency TEXT NOT NULL, reason TEXT, reference TEXT, provider TEXT NOT NULL DEFAULT 'manual', provider_refund_id TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(provider, provider_refund_id));
CREATE INDEX IF NOT EXISTS idx_refunds_created ON refunds(created_at);
-- one row per reminder / lifecycle email actually sent, so the hourly job never sends the same notice twice
CREATE TABLE IF NOT EXISTS lifecycle_notices(id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, kind, ref));
-- one free trial per owner email (hash only); a second workspace for the same email starts without a trial
CREATE TABLE IF NOT EXISTS trial_claims(email_hash TEXT PRIMARY KEY, tenant_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_tenants_sub ON tenants(subscription_status, trial_ends_at);
CREATE INDEX IF NOT EXISTS idx_tenants_period ON tenants(current_period_end);
CREATE INDEX IF NOT EXISTS idx_tenants_product ON tenants(product, plan);
CREATE TABLE IF NOT EXISTS platform_sessions(id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE, ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_admin ON platform_sessions(admin_id, revoked_at);
`;

/** Subdomains that can never be a tenant: they belong to the product itself. */
export const RESERVED_SLUGS = new Set(['www', 'app', 'api', 'admin', 'platform', 'static', 'assets', 'cdn', 'mail', 'email', 'smtp',
  'support', 'help', 'docs', 'blog', 'status', 'billing', 'signup', 'login', 'auth', 'dashboard', 'portal', 'site', 'dev', 'staging', 'test']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

let pdb = null;
export function platformDb() {
  if (pdb) return pdb;
  fs.mkdirSync(path.dirname(path.resolve(PLATFORM_DB_FILE)), { recursive: true });
  pdb = new DatabaseSync(PLATFORM_DB_FILE);
  pdb.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  pdb.exec(PLATFORM_SCHEMA);
  const have = new Set(pdb.prepare('PRAGMA table_info(tenants)').all().map((c) => c.name));
  for (const [c, def] of TENANT_COLUMNS) if (!have.has(c)) pdb.exec(`ALTER TABLE tenants ADD COLUMN ${c} ${def}`);
  const adm = new Set(pdb.prepare('PRAGMA table_info(platform_admins)').all().map((c) => c.name));
  for (const [c, def] of [['totp_secret', 'TEXT'], ['totp_enabled', 'INTEGER NOT NULL DEFAULT 0'], ['recovery_codes', 'TEXT'], ['totp_last_step', 'INTEGER NOT NULL DEFAULT 0'],
    ['role', "TEXT NOT NULL DEFAULT 'super_admin'"], ['active', 'INTEGER NOT NULL DEFAULT 1'],
    // invitations: the account cannot sign in until the invitee sets a password with the one-time link
    ['invited_by', 'TEXT'], ['invite_token_hash', 'TEXT'], ['invite_expires_at', 'TEXT'], ['activated_at', 'TEXT']]) if (!adm.has(c)) pdb.exec(`ALTER TABLE platform_admins ADD COLUMN ${c} ${def}`);
  const aud = new Set(pdb.prepare('PRAGMA table_info(platform_audit)').all().map((c) => c.name));
  for (const c of ['actor_role', 'target', 'reason', 'outcome', 'ip', 'user_agent', 'request_id']) if (!aud.has(c)) pdb.exec(`ALTER TABLE platform_audit ADD COLUMN ${c} TEXT`);
  // invoices: the one-time part (setup fee) is recognised at once, the rest over the invoice period
  const inv = new Set(pdb.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name));
  if (!inv.has('one_time_amount')) pdb.exec('ALTER TABLE invoices ADD COLUMN one_time_amount INTEGER NOT NULL DEFAULT 0');
  if (!inv.has('plan')) pdb.exec('ALTER TABLE invoices ADD COLUMN plan TEXT');
  pdb.exec(PLATFORM_SCHEMA_2);
  for (const [c, def] of REGION_COLUMNS) if (!have.has(c)) pdb.exec(`ALTER TABLE tenants ADD COLUMN ${c} ${def}`);
  initRegions(pdb);
  // the original install keeps every product it already used and gains the construction module
  pdb.exec("UPDATE tenants SET product='bundle' WHERE is_legacy=1 AND product='real_estate'");
  ensureLegacyTenant();
  seedFromEnv();
  initPlans(pdb);
  return pdb;
}
/** One-time import of what used to be configured only through environment variables. */
function seedFromEnv() {
  const flag = (k) => pdb.prepare('SELECT 1 FROM platform_settings WHERE key=?').get(k);
  const mark = (k) => pdb.prepare("INSERT OR IGNORE INTO platform_settings(key,value) VALUES(?,'1')").run(k);
  if (!flag('seeded_pk_accounts')) {
    try {
      let i = 0;
      for (const a of JSON.parse(process.env.BILLING_PK_ACCOUNTS || '[]')) if (a?.method && a?.account) pdb.prepare('INSERT INTO payment_accounts(method,account,account_name,note,sort_order) VALUES(?,?,?,?,?)').run(String(a.method), String(a.account), a.name || null, a.note || null, i++);
    } catch { /* malformed env: ignore */ }
    mark('seeded_pk_accounts');
  }
}
export function closePlatformDb() { try { pdb?.close(); } catch { /* closed */ } pdb = null; }

const pget = (sql, ...p) => platformDb().prepare(sql).get(...p);
const pall = (sql, ...p) => platformDb().prepare(sql).all(...p);
const prun = (sql, ...p) => platformDb().prepare(sql).run(...p);

/** The original install is always tenant #1: registered once, pointing at the existing erp.db and uploads folder. */
function ensureLegacyTenant() {
  if (pdb.prepare('SELECT 1 FROM tenants WHERE is_legacy=1').get()) return;
  const name = process.env.ERP_DEFAULT_TENANT_NAME || 'Expert Marketing & Developers';
  pdb.prepare("INSERT INTO tenants(slug,name,plan,db_file,upload_dir,is_legacy,product) VALUES(?,?,'legacy','(legacy)','(legacy)',1,'bundle')").run(LEGACY_SLUG, name);
}

/** Absolute paths for a tenant row; the legacy tenant follows ERP_DB / ERP_UPLOAD_DIR so existing setups keep working. */
function hydrate(row) {
  if (!row) return null;
  const t = { ...row };
  if (t.is_legacy) { t.db_path = path.resolve(DEFAULT_DB_FILE); t.upload_dir = path.resolve(UPLOAD_DIR); }
  else { t.db_path = path.resolve(DATA_DIR, t.db_file); t.upload_dir = path.resolve(UPLOAD_DIR, t.upload_dir); }
  return t;
}

export const getTenant = (id) => hydrate(pget('SELECT * FROM tenants WHERE id=?', id));
export const getTenantBySlug = (slug) => hydrate(pget('SELECT * FROM tenants WHERE slug=?', String(slug || '').toLowerCase()));
export const listTenants = () => pall('SELECT * FROM tenants ORDER BY id').map(hydrate);
export const legacyTenant = () => hydrate(pget('SELECT * FROM tenants WHERE is_legacy=1'));


// ---------------------------------------------------------------- free-website domain (set in the admin console)
// Free websites are served only from this separate domain, never from the app's own domain, so a flagged or abused free
// site cannot hurt the app's reputation or share its cookies. Empty until a super admin sets it.
let sitesCache = { at: 0, domain: '' };
/** The free-websites domain (for example agentifysites.co), or '' when none is set. Cached for 30 seconds. */
export function sitesDomain() {
  if (Date.now() - sitesCache.at > 30_000) {
    const r = platformDb().prepare("SELECT value FROM platform_settings WHERE key='free_sites_domain'").get();
    sitesCache = { at: Date.now(), domain: String(r?.value || '').toLowerCase() };
  }
  return sitesCache.domain;
}
export const forgetSitesDomain = () => { sitesCache = { at: 0, domain: '' }; };
const cleanHost = (h) => String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
/** Is this host the free-websites domain or one of its subdomains? */
export function isSitesHost(hostname) {
  const d = isMultiTenant() ? sitesDomain() : '';
  const h = cleanHost(hostname);
  return !!d && (h === d || h.endsWith(`.${d}`));
}

/**
 * Which tenant a request is for, from its host name.
 * Single-tenant mode (no ERP_BASE_DOMAIN): always the original install.
 * Multi-tenant: <slug>.<base domain> or a tenant's custom domain; the bare base domain (marketing site) has no tenant.
 */
export function resolveTenant(hostname) {
  if (!isMultiTenant()) return legacyTenant();
  const host = String(hostname || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host || host === BASE_DOMAIN || host === `www.${BASE_DOMAIN}`) return null;
  // <slug>.<free-websites domain>: only free website workspaces are served there
  if (isSitesHost(host)) {
    const d = sitesDomain();
    if (host === d || host === `www.${d}`) return null;
    const slug = host.slice(0, -(d.length + 1));
    const t = slug.includes('.') ? null : getTenantBySlug(slug);
    return t && t.product === 'website' ? t : null;
  }
  if (host.endsWith(`.${BASE_DOMAIN}`)) {
    const slug = host.slice(0, -(BASE_DOMAIN.length + 1));
    return slug.includes('.') ? null : getTenantBySlug(slug);
  }
  return hydrate(pget('SELECT * FROM tenants WHERE custom_domain=?', host));
}

/** Run `fn` inside a tenant: every query, upload path and timestamp in it belongs to that tenant. */
export function withTenant(tenant, fn) {
  return als.run({ tenant, db: openDb(tenant.db_path, tenant) }, fn);
}

/** Run a background job once per active tenant; one tenant's failure never stops the others. */
/** Like forEachTenant for jobs that wait on the network (posting to social accounts); one failing workspace never stops the rest. */
export async function forEachTenantAsync(fn) {
  for (const t of listTenants().filter((x) => x.status === 'active')) {
    try { await withTenant(t, () => fn(t)); } catch (e) { console.error(`[tenant ${t.slug}]`, e); }
  }
}

export function forEachTenant(fn) {
  for (const t of listTenants().filter((x) => x.status === 'active')) {
    try { withTenant(t, () => fn(t)); } catch (e) { console.error(`[tenant ${t.slug}]`, e); }
  }
}

/** Express middleware: resolve the tenant from the host and run the rest of the request inside it. */
export function tenantContext(req, res, next) {
  let tenant;
  try { tenant = resolveTenant(req.hostname); } catch (e) { return next(e); }
  const needsTenant = req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path === '/sitemap.xml' || req.path === '/robots.txt';
  if (!tenant) {
    // an unknown address on the free-websites domain is never the marketing site
    if (isSitesHost(req.hostname)) {
      const apex = cleanHost(req.hostname) === sitesDomain();
      if (apex && req.method === 'GET') return res.redirect(302, `https://${BASE_DOMAIN}/`);
      return res.status(404).type('text/plain').send('This website does not exist.');
    }
    if (needsTenant && !req.path.startsWith('/api/platform/')) return res.status(404).json({ error: 'Workspace not found' });
    return next();
  }
  if (tenant.status !== 'active' && needsTenant) return res.status(403).json({ error: 'This workspace is suspended. Please contact support.' });
  req.tenant = tenant;
  withTenant(tenant, () => next());
}

export function validateSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(s)) throw bad('Workspace address must be 1-32 lowercase letters, digits or hyphens, starting and ending with a letter or digit');
  if (RESERVED_SLUGS.has(s)) throw bad(`"${s}" is reserved; please choose another workspace address`);
  if (pget('SELECT 1 FROM tenants WHERE slug=?', s)) throw new HttpError(409, 'That workspace address is already taken');
  return s;
}

/**
 * Provision a new tenant: register it, create its database with the base configuration and its first Super Admin.
 * Nothing is shared with other tenants. If anything fails the half-made tenant is removed again.
 */
const emailHash = (e) => crypto.createHash('sha256').update(`trial:${String(e).trim().toLowerCase()}`).digest('hex');
/** Has this owner email already had a free trial on the platform? (only a hash of the address is kept) */
export const trialUsed = (email) => !!pget('SELECT 1 FROM trial_claims WHERE email_hash=?', emailHash(email));

/**
 * Provision a new tenant: register it, create its database with the base configuration and its first Super Admin.
 * Nothing is shared with other tenants. If anything fails the half-made tenant is removed again.
 * Self-serve sign-ups (`trialPolicy: true`) get the default trial for their product unless the owner email already had
 * one, or trials are switched off; then the workspace starts as `pending` (read-only until the first payment).
 * Trial start and end are stored as UTC timestamps.
 */
export function createTenant({ slug, name, adminName, adminEmail, adminPassword, timezone = 'Asia/Karachi', currency = 'PKR', demo = false, plan = 'trial',
  trialDays = PLAN_SETTINGS.default_trial_days, product = 'real_estate', trialPolicy = false, region = 'PK', sub_region = null, language = null }) {
  const s = validateSlug(slug);
  // the region decides currency, minor units, timezone and formats; only active regions can be chosen
  const rp = selectableRegions(platformDb()).get(String(region || 'PK').toUpperCase());
  if (!rp) throw bad('That region is not available yet');
  region = rp.code;
  if (sub_region && rp.sub_regions?.length && !rp.sub_regions.includes(sub_region)) throw bad(`Choose a valid ${String(rp.sub_region_label || 'state').toLowerCase()}`);
  if (language && !(rp.languages || [rp.language]).includes(language)) throw bad('That language is not offered in this region');
  if (region !== 'PK') { timezone = (rp.timezones || []).includes(timezone) ? timezone : rp.timezone; currency = rp.currency; }
  if (!String(name || '').trim()) throw bad('Company name is required');
  if (!isEmail(String(adminEmail || '').trim())) throw bad('A valid admin email is required');
  if (adminName && !isPersonName(String(adminName))) throw bad('Please enter a valid name: letters only, no numbers or symbols');
  if (String(adminPassword || '').length < 8) throw bad('Admin password must be at least 8 characters');
  const freeSite = product === 'website';
  if (!freeSite && !PRODUCT_CHOICES.includes(product)) throw bad('Choose Real Estate Brokerage or Construction Management');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw bad(`Unknown timezone: ${timezone}`); }
  const email = String(adminEmail).toLowerCase();
  let days = trialDays, status = 'trialing', note = null;
  // a free website has no trial and no payment: it is simply active on its own plan
  if (freeSite) { days = null; status = 'active'; plan = 'site_free'; }
  else if (trialPolicy) {
    const trialPlan = PLANS[PLAN_SETTINGS.trial_plans?.[product === 'bundle' ? 'real_estate' : product]];
    if (!days || trialPlan?.trial_eligible === false) { days = null; status = 'pending'; note = 'Free trials are not offered for this product'; }
    else if (PLAN_SETTINGS.one_trial_per_email && trialUsed(email)) { days = null; status = 'pending'; note = 'A free trial was already used with this owner email'; }
  }
  const start = new Date();
  const trialStart = days ? start.toISOString() : null;
  const trialEnds = days ? new Date(start.getTime() + days * 864e5).toISOString() : null;
  const id = Number(prun('INSERT INTO tenants(slug,name,plan,trial_ends_at,trial_started_at,subscription_status,trial_note,product,db_file,upload_dir,timezone,currency,owner_email,region,sub_region,money_scale,locale,language,units_system) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    s, String(name).trim(), plan, trialEnds, trialStart, status, note, product, path.join('tenants', s, 'erp.db'), path.join('tenants', s), timezone, String(currency).toUpperCase(), email,
    region, sub_region || null, rp.money_scale ?? 0, rp.locale, language || rp.language || 'en', rp.units_system || null).lastInsertRowid);
  if (days) prun('INSERT OR IGNORE INTO trial_claims(email_hash,tenant_id) VALUES(?,?)', emailHash(email), id);
  const tenant = getTenant(id);
  try {
    withTenant(tenant, () => {
      bootstrap({ companyName: tenant.name, adminName, adminEmail: String(adminEmail).toLowerCase(), adminPassword, currency: tenant.currency });
      upgradePermissions();
      syncRegionLookups();
      ensureSite({ withPosts: demo });
      if (freeSite) setSetting('site_offline', '1'); // offline until the owner confirms their email and publishes
      if (demo) { if (region === 'PK') seedDemo(); else seedRegionDemo(); }
    });
  } catch (e) {
    prun('DELETE FROM tenants WHERE id=?', id);
    fs.rmSync(path.dirname(tenant.db_path), { recursive: true, force: true });
    throw e;
  }
  logTenantEvent(id, 'created', { plan, product, demo: !!demo, trial_days: days || null, status });
  return tenant;
}

export function setTenantStatus(id, status) {
  if (!['active', 'suspended', 'cancelled'].includes(status)) throw bad('Unknown status');
  prun("UPDATE tenants SET status=?, updated_at=datetime('now') WHERE id=?", status, id);
  logTenantEvent(id, `status:${status}`);
  return getTenant(id);
}

export function logTenantEvent(tenantId, action, detail) {
  prun('INSERT INTO tenant_events(tenant_id,action,detail) VALUES(?,?,?)', tenantId, action, detail == null ? null : JSON.stringify(detail));
}

/** Start-up: register the original install, then bring every tenant's base configuration up to date. */
export function bootstrapTenants() {
  platformDb();
  forEachTenant(() => ensureBootstrapped());
}
