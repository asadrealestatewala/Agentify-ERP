// Super-admin views over every workspace: setup progress, usage, expiry, and help with a workspace's sign-ins.
// Each workspace keeps its own database; these helpers open it read-mostly through withTenant and never copy data out
// beyond counts, user names/emails and recent activity.
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { platformDb, listTenants, getTenant, withTenant, logTenantEvent, BASE_DOMAIN, isMultiTenant, createTenant, setTenantStatus } from '../platform.js';
import { all, get, run, val } from '../db.js';
import { billingState, usage, PLANS, PLAN_SETTINGS, MODULES, PRODUCTS, tenantProducts } from './plans.js';
import { refundsFor, tenantAddons, listAddons } from './commerce.js';
import { retentionState } from './retention.js';
import { cleanModules } from './plansStore.js';
import { recordSubscriptionChange, subscriptionHistory } from './subscriptions.js';
import { approveSubmission, LOCAL_METHODS } from './billing.js';
import path from 'node:path';
import { ROLES, TOP_ROLES, mayManageOwners, setOwnerCounter } from './platformAccess.js';
import { checkPassword } from './platformStaff.js';
import { adminResetLink, issueVerification } from './accessLinks.js';
import { sendMail, layout } from './mailer.js';
import { stripeView } from './platformConfig.js';
import { listBackups } from './backup.js';
import { bad, HttpError } from '../util.js';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysUntil = (d) => (d ? Math.round((Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 864e5) : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Address of a workspace. On localhost keep the scheme and port the console was opened on (http://acme.localhost:4000). */
export function workspaceUrl(t, req) {
  if (!isMultiTenant()) return req ? `${req.protocol}://${req.get('host')}` : null;
  if (BASE_DOMAIN === 'localhost' && req) return `${req.protocol}://${t.slug}.${req.get('host')}`;
  return t.custom_domain ? `https://${t.custom_domain}` : `https://${t.slug}.${BASE_DOMAIN}`;
}

const inTenant = (t, fn) => {
  if (!fs.existsSync(t.db_path)) return null; // registered but never opened (should not happen outside a failed restore)
  return withTenant(t, fn);
};
const hasTable = (name) => !!get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", name);
const count = (table, where = '') => (hasTable(table) ? val(`SELECT COUNT(*) FROM ${table} ${where}`) : 0);
/** Rows people entered themselves: seeded demo rows do not count as progress. */
const realCount = (table) => (hasTable(table) && all(`PRAGMA table_info(${table})`).some((c) => c.name === 'is_demo') ? count(table, 'WHERE is_demo=0') : count(table));

/** Workspace rows store wall-clock time in the workspace's timezone; the console needs real instants to say "2 h ago". */
function toUtc(local, tz) {
  if (!local) return null;
  const asUtc = Date.parse(`${String(local).replace(' ', 'T').slice(0, 19)}Z`);
  if (!Number.isFinite(asUtc)) return null;
  const offset = Date.parse(`${new Date(asUtc).toLocaleString('sv-SE', { timeZone: tz || 'Asia/Karachi' }).replace(' ', 'T')}Z`) - asUtc;
  return new Date(asUtc - offset).toISOString();
}

/** Setup milestones a new company normally reaches, in order. Measured from real data, not a checklist people tick. */
function progressNow() {
  const staff = val('SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 AND u.is_demo=0');
  const invites = val("SELECT COUNT(*) FROM auth_tokens WHERE kind='invite'");
  const owner = get("SELECT u.email_verified FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' ORDER BY u.id LIMIT 1");
  const steps = [
    { id: 'verified', label: 'Owner email confirmed', done: !!owner?.email_verified },
    { id: 'team', label: 'Team invited', done: staff > 1 || invites > 0 },
    { id: 'project', label: 'First project added', done: realCount('projects') > 0 },
    { id: 'property', label: 'First property added', done: realCount('properties') > 0 },
    { id: 'contact', label: 'First customer / lead', done: realCount('contacts') > 0 },
    { id: 'sale', label: 'First sale recorded', done: realCount('sales') > 0 },
    { id: 'receipt', label: 'First payment received', done: realCount('receipts') > 0 },
    { id: 'website', label: 'Website edited', done: count('site_page_versions') > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, percent: Math.round((done / steps.length) * 100) };
}

function statsNow(tz) {
  const u = usage();
  const lastLogin = val('SELECT MAX(last_login) FROM users');
  const lastAudit = val('SELECT MAX(created_at) FROM audit_log');
  return {
    seats: u.seats, invited: u.invited, projects: u.projects,
    properties: count('properties'), contacts: count('contacts'), sales: count('sales'), receipts: count('receipts'),
    portal_users: val('SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.portal=1'),
    last_login: toUtc(lastLogin, tz), last_activity: toUtc([lastLogin, lastAudit].filter(Boolean).sort().pop(), tz),
  };
}

/** When access next changes for this workspace, and how urgent it is. */
export function expiryOf(t) {
  const st = billingState(t);
  let date = null, kind = null;
  if (t.is_legacy) kind = 'never';
  else if (t.status === 'cancelled') kind = 'cancelled';
  else if (st.status === 'trialing') { date = st.trial_ends_at; kind = 'trial'; }
  else if (st.status === 'past_due') { date = st.grace_until; kind = 'grace'; }
  else { date = st.period_end || null; kind = st.status === 'canceled' ? 'ends' : 'renews'; }
  const days = daysUntil(date);
  const level = t.is_legacy ? 'ok' : st.locked || t.status !== 'active' ? 'expired' : days == null ? 'ok' : days <= 3 ? 'urgent' : days <= 14 ? 'soon' : 'ok';
  return { kind, date: date || null, days_left: days, locked: !!st.locked, reason: st.reason || null, billing_status: st.status, level, limits: st.limits };
}

const tenantRow = (t, req) => ({
  id: t.id, slug: t.slug, name: t.name, owner_email: t.owner_email, is_legacy: !!t.is_legacy, status: t.status, plan: t.plan, product: t.product || 'real_estate', products: tenantProducts(t),
  trial_started_at: t.trial_started_at || null, trial_note: t.trial_note || null, canceled_at: t.canceled_at || null,
  subscription_status: t.subscription_status, billing_interval: t.billing_interval, billing_provider: t.billing_provider,
  trial_ends_at: t.trial_ends_at, current_period_end: t.current_period_end, grace_until: t.grace_until, custom_domain: t.custom_domain,
  timezone: t.timezone, currency: t.currency, created_at: t.created_at, url: workspaceUrl(t, req), expiry: expiryOf(t),
  owner_name: t.owner_name || null, owner_phone: t.owner_phone || null, account_manager: t.account_manager || null,
  price: t.price_amount != null ? { amount: t.price_amount, currency: t.price_currency, interval: t.billing_interval } : null,
  entitlements: (() => { try { return t.entitlements ? JSON.parse(t.entitlements) : null; } catch { return null; } })(),
});

/** Every workspace with its usage, setup progress and expiry. One failing database never hides the others. */
export function tenantSummaries(req) {
  return listTenants().map((t) => {
    let stats = null, progress = null, error = null;
    try { inTenant(t, () => { stats = statsNow(t.timezone); progress = progressNow(); }); } catch (e) { error = e.message; }
    return { ...tenantRow(t, req), stats, progress, error };
  });
}

export function tenantDetail(id, req) {
  const t = mustTenant(id);
  let stats = null, progress = null, users = [], activity = [], pending_invites = [], error = null;
  try {
    inTenant(t, () => {
      stats = statsNow(t.timezone); progress = progressNow();
      users = all(`SELECT u.id, u.name, u.email, u.phone, r.name role, r.portal, u.active, u.email_verified, u.totp_enabled, u.last_login, u.created_at, u.is_demo
        FROM users u JOIN roles r ON r.id=u.role_id ORDER BY r.portal, u.id`).map((u) => ({ ...u, portal: !!u.portal, active: !!u.active, email_verified: u.email_verified !== 0, totp_enabled: !!u.totp_enabled, is_demo: !!u.is_demo, last_login: toUtc(u.last_login, t.timezone) }));
      pending_invites = all("SELECT t.id, t.email, r.name role, t.expires_at, t.created_at FROM auth_tokens t LEFT JOIN roles r ON r.id=t.role_id WHERE t.kind='invite' AND t.used_at IS NULL AND t.expires_at>? ORDER BY t.id DESC", new Date().toISOString());
      activity = all('SELECT user_name, action, entity, created_at FROM audit_log ORDER BY id DESC LIMIT 25');
    });
  } catch (e) { error = e.message; }
  const pdb = platformDb();
  return {
    ...tenantRow(t, req), stats, progress, users, pending_invites, activity, error,
    events: pdb.prepare('SELECT action, detail, created_at FROM tenant_events WHERE tenant_id=? ORDER BY id DESC LIMIT 50').all(t.id),
    invoices: pdb.prepare('SELECT * FROM invoices WHERE tenant_id=? ORDER BY id DESC LIMIT 20').all(t.id),
    payments: pdb.prepare('SELECT id, plan, interval, method, amount, currency, reference, status, decision_note, submitted_by, created_at, decided_at FROM payment_submissions WHERE tenant_id=? ORDER BY id DESC LIMIT 20').all(t.id),
    notes: pdb.prepare('SELECT id, admin, body, pinned, created_at FROM tenant_notes WHERE tenant_id=? ORDER BY pinned DESC, id DESC').all(t.id),
    history: subscriptionHistory({ tenantId: t.id, limit: 50 }).rows,
    storage: storageOf(t), modules: MODULES, plans: Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name, product: p.product, active: p.active, price: p.price })),
    refunds: refundsFor(t.id), addons: tenantAddons(t.id), available_addons: listAddons({ activeOnly: true }), retention: retentionState(t), close_requested_at: t.close_requested_at || null, data_deleted_at: t.data_deleted_at || null,
  };
}

function mustTenant(id) {
  const t = getTenant(Number(id));
  if (!t) throw new HttpError(404, 'Workspace not found');
  return t;
}
const mustBilled = (t) => { if (t.is_legacy) throw bad('The original workspace has no trial or subscription'); };

// ---------------------------------------------------------------- expiry actions
/** A trial end as an instant (ms). Date-only values (older rows) last until the end of that UTC day. */
const trialEndMs = (v) => {
  if (!v) return null;
  const s = String(v);
  return s.length > 10 ? Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`) : Date.parse(`${s}T23:59:59.999Z`);
};
/** On trial now, or a trial that ran out without the workspace ever paying (so it can be extended again). */
const trialish = (t) => (t.subscription_status || 'trialing') === 'trialing' || (['expired', 'pending'].includes(t.subscription_status) && !t.current_period_end);
export const TRIAL_ACTIONS = ['extend', 'shorten', 'end', 'revoke', 'grant'];

/**
 * Change a workspace's free trial (super admin, `trials.manage`, reason required, written to subscription history):
 *   extend  { days } adds days to the current end (or from now if it already ended) | { until: YYYY-MM-DD } ends that day (UTC)
 *   shorten { days } moves the end earlier; if that is in the past the trial ends now
 *   end     the trial ends now; the workspace becomes read-only until it subscribes
 *   revoke  like end, for abuse; noted on the workspace
 *   grant   start a new trial of { days } for a workspace that is pending or whose trial ran out
 * The lifecycle job reads the dates on every run, so reminders and expiry follow the new dates automatically.
 */
export function trialAction(id, { action = 'extend', days, until, reason }, actor = null) {
  const t = mustTenant(id); mustBilled(t);
  if (!TRIAL_ACTIONS.includes(action)) throw bad(`Action must be one of: ${TRIAL_ACTIONS.join(', ')}`);
  needReason(reason, `changing a trial (${action})`);
  if (!trialish(t)) throw bad('This workspace has a paid subscription, not a trial. Use Set plan to change it.');
  const now = Date.now();
  const n = () => { const v = Math.trunc(Number(days)); if (!(v >= 1 && v <= 365)) throw bad('Days must be between 1 and 365'); return v; };
  const curEnd = trialEndMs(t.trial_ends_at);
  const set = { };
  if (action === 'extend') {
    if (until) {
      if (!DATE_RE.test(String(until))) throw bad('Date must be YYYY-MM-DD');
      if (String(until) < today()) throw bad('The new trial end date is in the past');
      set.trial_ends_at = `${until}T23:59:59.000Z`;
    } else set.trial_ends_at = new Date(Math.max(now, curEnd || now) + n() * 864e5).toISOString();
    set.subscription_status = 'trialing';
  } else if (action === 'grant') {
    if (t.subscription_status === 'trialing' && curEnd && curEnd > now) throw bad('This workspace is already on a trial. Use extend.');
    set.trial_started_at = new Date(now).toISOString();
    set.trial_ends_at = new Date(now + n() * 864e5).toISOString();
    set.subscription_status = 'trialing';
    set.trial_note = null;
  } else if (action === 'shorten') {
    if (t.subscription_status !== 'trialing' || !curEnd) throw bad('Only a running trial with an end date can be shortened');
    const next = curEnd - n() * 864e5;
    if (next <= now) { set.trial_ends_at = new Date(now).toISOString(); set.subscription_status = 'expired'; }
    else set.trial_ends_at = new Date(next).toISOString();
  } else {
    if (t.subscription_status !== 'trialing') throw bad('This workspace is not on a running trial');
    set.trial_ends_at = new Date(now).toISOString();
    set.subscription_status = 'expired';
    if (action === 'revoke') set.trial_note = `Trial revoked: ${String(reason).trim().slice(0, 200)}`;
  }
  const keys = Object.keys(set);
  platformDb().prepare(`UPDATE tenants SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => set[k]), t.id);
  recordSubscriptionChange(t, getTenant(t.id), { source: 'admin', actor, reason: `Trial ${action}: ${reason}` });
  logTenantEvent(t.id, `trial-${action}`, { until: set.trial_ends_at || null, reason });
  return getTenant(t.id);
}
/** Kept for existing callers: extend a trial. */
export const extendTrial = (id, body, actor = null) => trialAction(id, { ...body, action: 'extend' }, actor);

/** Give a workspace whose payment failed more time before it becomes read-only. */
export function extendGrace(id, { until, reason }, actor = null) {
  const t = mustTenant(id); mustBilled(t);
  needReason(reason, 'extending a grace period');
  if (t.subscription_status !== 'past_due') throw bad('Only a workspace with a failed payment has a grace period');
  if (!DATE_RE.test(String(until || '')) || until < today()) throw bad('Choose a date from today onwards (YYYY-MM-DD)');
  platformDb().prepare("UPDATE tenants SET grace_until=?, updated_at=datetime('now') WHERE id=?").run(until, t.id);
  recordSubscriptionChange(t, getTenant(t.id), { source: 'admin', actor, reason });
  logTenantEvent(t.id, 'grace-extended', { until, reason });
  return getTenant(t.id);
}

/** Email the owner about their trial or subscription ending, with a link to the billing page. */
export async function remindOwner(id, req) {
  const t = mustTenant(id); mustBilled(t);
  if (!t.owner_email) throw bad('This workspace has no owner email');
  const e = expiryOf(t);
  const when = e.date ? (e.days_left < 0 ? `ended on ${e.date}` : e.days_left === 0 ? 'ends today' : `ends on ${e.date} (${e.days_left} day${e.days_left === 1 ? '' : 's'} left)`) : null;
  const what = { trial: 'Your free trial', grace: 'The grace period after your failed payment', ends: 'Your subscription', renews: 'Your current billing period' }[e.kind] || 'Your subscription';
  const lines = [when ? `${what} ${when}.` : 'Your workspace needs a plan to keep editing.', e.locked ? 'Your data is safe but read-only until a plan is active.' : 'Choose or renew a plan to keep full access. Nothing is deleted.'];
  const sent = await withTenant(t, () => sendMail({ type: 'billing_notice', to: t.owner_email, subject: `${t.name}: ${e.locked ? 'your workspace is read-only' : 'your plan needs attention'}`, ...layout({ brand: 'platform', heading: `${t.name} billing reminder`, lines, button: { label: 'Open billing', url: `${workspaceUrl(t, req)}/billing` } }) }));
  logTenantEvent(t.id, 'reminder-sent', { kind: e.kind, date: e.date });
  return { sent, to: t.owner_email };
}

// ---------------------------------------------------------------- sign-in help
const userIn = (uid) => {
  const u = get('SELECT u.*, r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?', Number(uid));
  if (!u) throw new HttpError(404, 'User not found');
  return u;
};

/**
 * Help a workspace user who cannot sign in. Actions:
 *   reset-link     one-time password link (24h) shown to the super admin, optionally emailed to the user
 *   verify-email   mark the address confirmed (the owner could not find the welcome email)
 *   resend-verify  send a fresh confirmation email
 *   disable-2fa    turn off two-factor sign-in (lost phone)
 *   disable-login-otp   turn off the workspace's email sign-in code (its email cannot be delivered)
 *   activate / deactivate   allow or block sign-in
 *   sign-out       end every session of that user
 */
export async function userAction(tenantId, userId, action, { email = false } = {}, req) {
  const t = mustTenant(tenantId);
  return withTenant(t, async () => {
    const u = userIn(userId);
    const base = workspaceUrl(t, req);
    let out = { ok: true };
    switch (action) {
      case 'reset-link': {
        if (!u.active) throw bad('This user is deactivated. Activate them first.');
        if (!u.email) throw bad('This user has no email address');
        const token = adminResetLink(u.id, u.email);
        const link = `${base}/reset-password/${token}`;
        let sent = false;
        if (email) sent = await sendMail({ type: 'password_reset', to: u.email, subject: 'Set a new password', ...layout({ brand: 'platform', heading: 'Set a new password', lines: [`Hi ${u.name}, support created this link so you can choose a new password for ${t.name}.`, 'It works once and expires in 24 hours.'], button: { label: 'Choose a new password', url: link } }) });
        out = { link, email_sent: sent, expires_in_hours: 24 };
        break;
      }
      case 'verify-email': run('UPDATE users SET email_verified=1 WHERE id=?', u.id); break;
      case 'resend-verify': {
        if (!u.email) throw bad('This user has no email address');
        const token = issueVerification(u.id);
        out = { email_sent: await sendMail({ type: 'verification', to: u.email, subject: 'Confirm your email address', ...layout({ brand: 'platform', heading: 'Confirm your email address', lines: [`Hi ${u.name}, please confirm this address for ${t.name}.`], button: { label: 'Confirm email', url: `${base}/verify-email/${token}` } }) }) };
        break;
      }
      case 'disable-login-otp': run("INSERT INTO settings(key,value) VALUES('login_email_otp','off') ON CONFLICT(key) DO UPDATE SET value='off'"); break;
      case 'disable-2fa': run('UPDATE users SET totp_enabled=0, totp_secret=NULL, recovery_codes=NULL, token_version=token_version+1 WHERE id=?', u.id); break;
      case 'activate': run('UPDATE users SET active=1 WHERE id=?', u.id); break;
      case 'deactivate': {
        const supers = val("SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' AND u.active=1");
        if (u.role === 'Super Admin' && supers <= 1) throw bad('This is the only active Super Admin of the workspace; it cannot be deactivated');
        run('UPDATE users SET active=0, token_version=token_version+1 WHERE id=?', u.id);
        break;
      }
      case 'sign-out': run('UPDATE users SET token_version=token_version+1 WHERE id=?', u.id); break;
      default: throw bad('Unknown action');
    }
    logTenantEvent(t.id, `support:${action}`, { user: u.email || u.id });
    return out;
  });
}

/** Change who the workspace owner is (the email billing reminders go to). Must be an existing staff user. */
export function setOwner(id, ownerEmail) {
  const t = mustTenant(id);
  const e = String(ownerEmail || '').trim().toLowerCase();
  const ok = withTenant(t, () => get('SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.email)=? AND r.portal=0', e));
  if (!ok) throw bad('The owner must be a staff user of this workspace');
  platformDb().prepare("UPDATE tenants SET owner_email=?, updated_at=datetime('now') WHERE id=?").run(e, t.id);
  logTenantEvent(t.id, 'owner-changed', { owner: e });
  return getTenant(t.id);
}

/** A workspace created by a super admin for a customer (sales-led onboarding). The owner's email counts as confirmed. */
export function createWorkspace(b, req) {
  const trialDays = b.trial_days === undefined || b.trial_days === '' ? PLAN_SETTINGS.default_trial_days : Math.trunc(Number(b.trial_days));
  if (!(trialDays >= 0 && trialDays <= 365)) throw bad('Trial days must be between 0 and 365');
  const t = createTenant({ slug: b.slug, name: b.company_name, adminName: String(b.admin_name || '').trim() || 'Admin', adminEmail: b.admin_email, adminPassword: b.admin_password,
    timezone: b.timezone || 'Asia/Karachi', currency: b.currency || 'PKR', demo: !!b.demo, trialDays: trialDays || null, product: b.product || 'real_estate',
    region: b.region || 'PK', sub_region: b.sub_region || null, language: b.language || null });
  return tenantRow(t, req);
}

// ---------------------------------------------------------------- overview
const monthly = (t) => {
  if (t.price_amount != null && (t.price_currency || 'PKR') === 'PKR') return t.billing_interval === 'year' ? Math.round(t.price_amount / 12) : t.price_amount;
  const p = PLANS[t.plan]; if (!p?.price?.PKR) return 0; const price = p.price.PKR; return t.billing_interval === 'year' ? Math.round(price.year / 12) : price.month;
};

export function overview(req, operator) {
  const tenants = listTenants();
  const billed = tenants.filter((t) => !t.is_legacy);
  const exp = billed.map((t) => ({ t, e: expiryOf(t) }));
  const since = addDays(today(), -30);
  const pdb = platformDb();
  const counts = {
    workspaces: tenants.length,
    active: tenants.filter((t) => t.status === 'active').length,
    suspended: tenants.filter((t) => t.status === 'suspended').length,
    cancelled: tenants.filter((t) => t.status === 'cancelled').length,
    trialing: exp.filter((x) => x.e.billing_status === 'trialing' && !x.e.locked && x.t.status === 'active').length,
    paying: exp.filter((x) => x.e.billing_status === 'active' && x.t.status === 'active').length,
    past_due: exp.filter((x) => x.e.billing_status === 'past_due').length,
    locked: exp.filter((x) => x.e.locked && x.t.status === 'active').length,
    new_30d: tenants.filter((t) => String(t.created_at).slice(0, 10) >= since).length,
    pending_payments: pdb.prepare("SELECT COUNT(*) n FROM payment_submissions WHERE status='pending'").get().n,
  };
  const mrr = exp.filter((x) => x.e.billing_status === 'active' && x.t.status === 'active').reduce((s, x) => s + monthly(x.t), 0);
  const revenue30 = pdb.prepare("SELECT currency, SUM(amount) total FROM invoices WHERE status='paid' AND created_at>=? GROUP BY currency").all(since);
  const expiring = exp.filter((x) => x.t.status === 'active' && (x.e.level === 'urgent' || x.e.level === 'soon' || x.e.level === 'expired'))
    .sort((a, b) => (a.e.days_left ?? -999) - (b.e.days_left ?? -999)).slice(0, 10).map((x) => tenantRow(x.t, req));
  const recent = tenants.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5).map((t) => tenantRow(t, req));
  const byPlan = {};
  for (const x of exp) if (x.t.status === 'active') { const k = x.e.billing_status === 'trialing' ? 'trial' : x.t.plan; byPlan[k] = (byPlan[k] || 0) + 1; }
  return { counts, mrr: { amount: mrr, currency: 'PKR' }, revenue_30d: revenue30, by_plan: byPlan, expiring, recent, setup: setupChecklist(operator) };
}

/** Platform credentials and configuration the super admin should have in place before taking real customers. */
export function setupChecklist(operator) {
  const s = stripeView();
  const accounts = platformDb().prepare('SELECT COUNT(*) n FROM payment_accounts WHERE active=1').get().n;
  const admin = operator?.id ? platformDb().prepare('SELECT totp_enabled FROM platform_admins WHERE id=?').get(operator.id) : null;
  const admins = platformDb().prepare('SELECT COUNT(*) n FROM platform_admins').get().n;
  const last = listBackups()[0];
  const backupsOn = process.env.BACKUP_ENABLED !== '0';
  return [
    { id: 'domain', label: 'Workspace addresses', ok: isMultiTenant(), detail: isMultiTenant() ? `Workspaces live at <name>.${BASE_DOMAIN}` : 'Single-company mode: set ERP_BASE_DOMAIN to host many companies', where: 'server' },
    { id: '2fa', label: 'Two-factor sign-in for you', ok: !!admin?.totp_enabled, detail: admin?.totp_enabled ? 'On' : 'Turn it on in Security', where: 'security' },
    { id: 'admins', label: 'A second super admin', ok: admins > 1, detail: admins > 1 ? `${admins} super admins` : 'Add a backup admin so you are never locked out', where: 'admins' },
    { id: 'email', label: 'Email sending', ok: !!process.env.RESEND_API_KEY, detail: process.env.RESEND_API_KEY ? `Sending from ${process.env.MAIL_FROM || 'the default address'}` : 'No RESEND_API_KEY: emails are only printed in the server window', where: 'server' },
    { id: 'cards', label: 'Card payments (Stripe)', ok: !!s.ready, detail: s.ready ? `Ready in ${s.mode} mode` : 'Add a secret key and prices', where: 'stripe' },
    { id: 'local', label: 'Local payment accounts', ok: accounts > 0, detail: accounts ? `${accounts} account(s) shown to customers` : 'Add Raast / Easypaisa / JazzCash / bank details', where: 'accounts' },
    { id: 'operator_email', label: 'Payment alerts email', ok: !!process.env.BILLING_OPERATOR_EMAIL, detail: process.env.BILLING_OPERATOR_EMAIL ? `Sent to ${process.env.BILLING_OPERATOR_EMAIL}` : 'Set BILLING_OPERATOR_EMAIL to be emailed when someone pays', where: 'server' },
    { id: 'secrets', label: 'Encryption key', ok: !!process.env.ERP_SECRETS_KEY, detail: process.env.ERP_SECRETS_KEY ? 'Set in ERP_SECRETS_KEY' : 'Using data/.secrets-key: back that file up separately', where: 'server' },
    { id: 'backups', label: 'Backups', ok: backupsOn && !!last?.created_at, detail: !backupsOn ? 'Turned off (BACKUP_ENABLED=0)' : last?.created_at ? `Last: ${String(last.created_at).replace('T', ' ').slice(0, 16)}` : 'No backup yet', where: 'backups' },
  ];
}

// ---------------------------------------------------------------- platform admins
export const listAdmins = () => platformDb().prepare('SELECT id, email, name, role, active, totp_enabled, last_login, created_at, invited_by, invite_expires_at, activated_at FROM platform_admins ORDER BY id').all()
  .map((a) => ({ ...a, totp_enabled: !!a.totp_enabled, active: !!a.active, role_label: ROLES[a.role]?.label || a.role,
    status: !a.active ? 'disabled' : a.invite_expires_at && !a.activated_at ? (Date.parse(a.invite_expires_at) > Date.now() ? 'invited' : 'invite_expired') : 'active' }));
/** Active accounts holding every permission (Platform Owner / Super Admin) other than `exceptId`. */
const activeTop = (exceptId = null) => platformDb().prepare(`SELECT COUNT(*) n FROM platform_admins WHERE role IN (${TOP_ROLES.map(() => '?').join(',')}) AND active=1 AND (invite_expires_at IS NULL OR activated_at IS NOT NULL) AND id<>?`).get(...TOP_ROLES, exceptId ?? -1).n;
setOwnerCounter(() => platformDb().prepare("SELECT COUNT(*) n FROM platform_admins WHERE role='platform_owner' AND active=1").get().n);
/** Only a Platform Owner can create, change or remove a Platform Owner (a Super Admin may appoint the first one). */
const guardOwnerRole = (operator, ...roles) => { if (roles.includes('platform_owner') && !mayManageOwners(operator)) throw new HttpError(403, 'Only a Platform Owner can grant, change or remove the Platform Owner role'); };
export function addAdmin({ email, name, password, role = 'read_only' }, operator = null) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('A valid email is required');
  checkPassword(password);
  if (!ROLES[role]) throw bad(`Role must be one of: ${Object.keys(ROLES).join(', ')}`);
  guardOwnerRole(operator, role);
  if (platformDb().prepare('SELECT 1 FROM platform_admins WHERE email=?').get(e)) throw new HttpError(409, 'A console user with this email already exists');
  const id = Number(platformDb().prepare("INSERT INTO platform_admins(email,name,password_hash,role,activated_at) VALUES(?,?,?,?,datetime('now'))").run(e, String(name || '').trim() || 'Console user', bcrypt.hashSync(String(password), 10), role).lastInsertRowid);
  return listAdmins().find((a) => a.id === id);
}
/** Change a console user's role or switch their access off. At least one active Platform Owner / Super Admin always remains. */
export function updateAdmin(id, { role, active, name }, selfId, operator = null) {
  const a = platformDb().prepare('SELECT * FROM platform_admins WHERE id=?').get(Number(id));
  if (!a) throw new HttpError(404, 'Admin not found');
  const out = {};
  if (role !== undefined) { if (!ROLES[role]) throw bad('Unknown role'); out.role = role; }
  if (active !== undefined) out.active = active ? 1 : 0;
  if (name !== undefined) { const n = String(name || '').trim(); if (!n) throw bad('Name is required'); out.name = n.slice(0, 80); }
  if (a.id === selfId && ((out.role && out.role !== a.role) || out.active === 0)) throw bad('You cannot change your own role or switch off your own access');
  if ((out.role && out.role !== a.role) || out.active === 0) guardOwnerRole(operator, a.role, out.role);
  const losesTop = TOP_ROLES.includes(a.role) && a.active && ((out.role && !TOP_ROLES.includes(out.role)) || out.active === 0);
  if (losesTop && !activeTop(a.id)) throw bad('At least one active Platform Owner or Super Admin must remain');
  const keys = Object.keys(out);
  if (keys.length) platformDb().prepare(`UPDATE platform_admins SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => out[k]), a.id);
  if (out.active === 0 || (out.role && out.role !== a.role)) platformDb().prepare("UPDATE platform_sessions SET revoked_at=datetime('now'), revoked_by='access-changed' WHERE admin_id=? AND revoked_at IS NULL").run(a.id);
  return { admin: listAdmins().find((x) => x.id === a.id), before: { role: a.role, active: !!a.active }, changed: keys };
}
export function removeAdmin(id, selfId, operator = null) {
  if (Number(id) === selfId) throw bad('You cannot remove yourself');
  const a = platformDb().prepare('SELECT * FROM platform_admins WHERE id=?').get(Number(id));
  if (!a) throw new HttpError(404, 'Admin not found');
  guardOwnerRole(operator, a.role);
  if (TOP_ROLES.includes(a.role) && a.active && !activeTop(a.id)) throw bad('At least one active Platform Owner or Super Admin must remain');
  platformDb().prepare('DELETE FROM platform_admins WHERE id=?').run(a.id);
  return a;
}

// ---------------------------------------------------------------- lifecycle and profile
const needReason = (r, what) => { if (String(r || '').trim().length < 3) throw bad(`A reason is required for ${what}`); };

function dirSize(dir) {
  let total = 0, files = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else { try { total += fs.statSync(p).size; files += 1; } catch { /* vanished */ } }
    }
  };
  walk(dir);
  return { bytes: total, files };
}
/** Bytes on disk: the workspace database (with its write-ahead log) and its uploaded files. */
export function storageOf(t) {
  const db = ['', '-wal', '-shm'].reduce((s, x) => { try { return s + fs.statSync(t.db_path + x).size; } catch { return s; } }, 0);
  // the legacy workspace's upload folder also holds every other workspace's folder under tenants/, so count only its own files
  const up = t.is_legacy ? { bytes: null, files: null } : dirSize(t.upload_dir);
  return { database_bytes: db, upload_bytes: up.bytes, upload_files: up.files };
}

/** Suspend, cancel or reactivate. Suspension and cancellation need a reason; nothing is ever deleted. */
export function changeStatus(id, { status, reason }, actor) {
  const t = mustTenant(id);
  if (t.is_legacy && status !== 'active') throw bad('The original workspace cannot be suspended or cancelled');
  if (status !== 'active') needReason(reason, status === 'cancelled' ? 'cancelling a workspace' : 'suspending a workspace');
  if (t.status === status) throw bad(`The workspace is already ${status}`);
  if (t.data_deleted_at) throw bad('The data of this workspace was deleted; it cannot be reactivated');
  setTenantStatus(t.id, status);
  logTenantEvent(t.id, 'status-reason', { status, reason: reason || null, by: actor });
  return getTenant(t.id);
}

const PROFILE = {
  name: (v) => { const s = String(v || '').trim(); if (!s || s.length > 120) throw bad('Company name is required (up to 120 characters)'); return s; },
  owner_name: (v) => String(v || '').trim().slice(0, 120) || null,
  owner_phone: (v) => { const s = String(v || '').trim(); if (s && !/^[+\d][\d\s()-]{5,24}$/.test(s)) throw bad('Phone number looks wrong'); return s || null; },
  account_manager: (v) => String(v || '').trim().slice(0, 120) || null,
  custom_domain: (v) => {
    const s = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!s) return null;
    if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s)) throw bad('Custom domain must be a domain name like erp.company.com');
    if (BASE_DOMAIN && (s === BASE_DOMAIN || s.endsWith(`.${BASE_DOMAIN}`))) throw bad('Custom domain cannot be under the platform domain');
    return s;
  },
  timezone: (v) => { try { new Intl.DateTimeFormat('en', { timeZone: String(v) }); } catch { throw bad(`Unknown timezone: ${v}`); } return String(v); },
};
/** Edit the workspace's company profile. Currency is fixed after creation because the workspace's records are kept in it. */
export function updateProfile(id, b) {
  const t = mustTenant(id);
  const out = {};
  for (const [k, clean] of Object.entries(PROFILE)) if (b[k] !== undefined) out[k] = clean(b[k]);
  if (b.currency !== undefined && b.currency !== t.currency) throw bad('Currency cannot be changed after a workspace is created');
  const keys = Object.keys(out).filter((k) => String(out[k] ?? '') !== String(t[k] ?? ''));
  if (!keys.length) return { tenant: t, changed: [] };
  if (keys.includes('custom_domain') && out.custom_domain && platformDb().prepare('SELECT 1 FROM tenants WHERE custom_domain=? AND id<>?').get(out.custom_domain, t.id)) throw new HttpError(409, 'Another workspace already uses that domain');
  platformDb().prepare(`UPDATE tenants SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => out[k]), t.id);
  logTenantEvent(t.id, 'profile-edited', Object.fromEntries(keys.map((k) => [k, { from: t[k] ?? null, to: out[k] }])));
  return { tenant: getTenant(t.id), changed: keys };
}

/** Workspace-specific limits on top of its plan. Pass null for a field to go back to the plan's value; clear=true removes all overrides. */
export function setEntitlements(id, b, actor) {
  const t = mustTenant(id);
  needReason(b.reason, 'changing a workspace\'s limits');
  let next = null;
  if (!b.clear) {
    next = {};
    const label = { seats: 'User', projects: 'Project', properties: 'Property', storage_mb: 'Storage (MB)' };
    for (const k of Object.keys(label)) {
      if (b[k] === undefined || b[k] === 'plan') continue;
      if (b[k] === null || b[k] === '') next[k] = null;
      else { const n = Math.trunc(Number(b[k])); if (!(n >= 1 && n <= 10_000_000)) throw bad(`${label[k]} limit must be a whole number from 1, or empty for unlimited`); next[k] = n; }
    }
    if (b.api_access !== undefined && b.api_access !== 'plan') next.api_access = !!b.api_access;
    if (b.modules !== undefined && b.modules !== 'plan') next.modules = cleanModules(b.modules);
    if (b.products !== undefined && b.products !== 'plan') {
      if (!Array.isArray(b.products) || !b.products.length || b.products.some((p) => !PRODUCTS[p])) throw bad(`Products must be a list of: ${Object.keys(PRODUCTS).join(', ')}`);
      next.products = [...new Set(b.products)];
    }
    if (!Object.keys(next).length) next = null;
  }
  platformDb().prepare("UPDATE tenants SET entitlements=?, updated_at=datetime('now') WHERE id=?").run(next ? JSON.stringify(next) : null, t.id);
  logTenantEvent(t.id, 'entitlements', { to: next, reason: b.reason, by: actor });
  return getTenant(t.id);
}

export const listNotes = (id) => platformDb().prepare('SELECT id, admin, body, pinned, created_at FROM tenant_notes WHERE tenant_id=? ORDER BY pinned DESC, id DESC').all(mustTenant(id).id);
export function addNote(id, body, actor, pinned = false) {
  const t = mustTenant(id);
  const text = String(body || '').trim();
  if (!text || text.length > 4000) throw bad('Note text is required (up to 4000 characters)');
  platformDb().prepare('INSERT INTO tenant_notes(tenant_id,admin,body,pinned) VALUES(?,?,?,?)').run(t.id, actor || 'unknown', text, pinned ? 1 : 0);
  return listNotes(t.id);
}

/**
 * A payment received outside the app (bank transfer, cash, cheque) recorded by a super admin. It goes through the same
 * path as a customer-submitted payment: one payment record (unique reference per method), one paid invoice, the period
 * extended, subscription history written, and a receipt emailed to the owner.
 */
export async function recordManualPayment(id, b, actor) {
  const t = mustTenant(id); mustBilled(t);
  if (!PLANS[b.plan]) throw bad('Unknown plan');
  if (!['month', 'year'].includes(b.interval)) throw bad('Interval must be month or year');
  if (!LOCAL_METHODS[b.method]) throw bad(`Method must be one of: ${Object.keys(LOCAL_METHODS).join(', ')}`);
  const ref = String(b.reference || '').trim();
  if (ref.length < 4 || ref.length > 80) throw bad('Enter the bank or wallet transaction reference (4 to 80 characters)');
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.trunc(amount) !== amount) throw bad('Amount must be a whole number above zero');
  const currency = String(b.currency || 'PKR').toUpperCase();
  if (!['PKR', 'USD'].includes(currency)) throw bad('Currency must be PKR or USD');
  if (!t.owner_email) throw bad('The workspace has no owner email for the receipt');
  const db = platformDb();
  if (db.prepare("SELECT 1 FROM payment_submissions WHERE tenant_id=? AND status='pending'").get(t.id)) throw bad('This workspace has a payment waiting for approval. Approve or reject it first.');
  let sid;
  try {
    sid = Number(db.prepare('INSERT INTO payment_submissions(tenant_id,plan,interval,method,amount,currency,reference,note,submitted_by) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(t.id, b.plan, b.interval, b.method, amount, currency, ref, `Recorded by ${actor}${b.note ? `: ${String(b.note).slice(0, 400)}` : ''}`, t.owner_email).lastInsertRowid);
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'This transaction reference has already been recorded');
    throw e;
  }
  await approveSubmission(sid, b.note ? String(b.note).slice(0, 400) : 'Recorded by support', actor);
  logTenantEvent(t.id, 'billing:payment-recorded', { id: sid, method: b.method, amount, currency, by: actor });
  return { id: sid, tenant: getTenant(t.id) };
}

/** Send the owner a fresh email-confirmation / welcome link. */
export async function resendOnboarding(id, req) {
  const t = mustTenant(id);
  if (!t.owner_email) throw bad('This workspace has no owner email');
  const uid = withTenant(t, () => get('SELECT id FROM users WHERE lower(email)=lower(?)', t.owner_email)?.id);
  if (!uid) throw bad('The owner email does not match a user in the workspace');
  return userAction(t.id, uid, 'resend-verify', {}, req);
}

/** One list of money in: invoices (card and approved transfers) and customer-submitted transfers, each with its own status. */
export function transactions({ status, method, tenant, q, page = 0, per = 50 } = {}) {
  const pdb = platformDb();
  const inv = pdb.prepare(`SELECT 'invoice' kind, i.id, i.tenant_id, t.name tenant, t.slug, i.provider_invoice_id reference, i.amount, i.currency, i.status invoice_status,
      NULL payment_status, CASE WHEN i.provider_invoice_id LIKE 'local-%' THEN (SELECT method FROM payment_submissions s WHERE 'local-' || s.id = i.provider_invoice_id) ELSE COALESCE(t.billing_provider, 'card') END method,
      i.period_start, i.period_end, i.hosted_url, i.created_at FROM invoices i JOIN tenants t ON t.id=i.tenant_id`).all();
  const subs = pdb.prepare(`SELECT 'payment' kind, s.id, s.tenant_id, t.name tenant, t.slug, s.reference, s.amount, s.currency,
      (SELECT i.status FROM invoices i WHERE i.provider_invoice_id='local-' || s.id) invoice_status, s.status payment_status, s.method, s.plan, s.interval, s.note, s.decision_note, s.submitted_by, s.decided_at, s.created_at
      FROM payment_submissions s JOIN tenants t ON t.id=s.tenant_id`).all();
  let rows = [...subs, ...inv.filter((i) => !String(i.reference || '').startsWith('local-'))];
  if (status) rows = rows.filter((r) => r.payment_status === status || r.invoice_status === status);
  if (method) rows = rows.filter((r) => r.method === method);
  if (tenant) rows = rows.filter((r) => r.tenant_id === Number(tenant));
  if (q) { const s = String(q).toLowerCase(); rows = rows.filter((r) => `${r.reference} ${r.tenant} ${r.slug}`.toLowerCase().includes(s)); }
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const totals = {};
  for (const r of rows) if (r.invoice_status === 'paid') totals[r.currency] = (totals[r.currency] || 0) + r.amount;
  const p = Math.max(0, Math.trunc(Number(page)) || 0), n = Math.min(200, Math.max(1, Math.trunc(Number(per)) || 50));
  return { total: rows.length, page: p, per: n, paid_totals: totals, rows: rows.slice(p * n, p * n + n) };
}
