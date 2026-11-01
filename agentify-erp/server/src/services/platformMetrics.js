// Executive dashboard, daily metric snapshots, notifications, global search and health checks for the super admin console.
// Every figure is computed from platform records (tenants, invoices, billing events, payment submissions, tenant events).
// Where the past cannot be reconstructed (e.g. how many workspaces were suspended last month) the value comes from the
// daily snapshot table; if no snapshot exists the comparison is null, never guessed.
import fs from 'node:fs';
import path from 'node:path';
import { platformDb, listTenants, BASE_DOMAIN, isMultiTenant } from '../platform.js';
import { DATA_DIR } from '../db.js';
import { PLANS } from './plans.js';
import { expiryOf, tenantSummaries } from './platformTenants.js';
import { stripeView } from './platformConfig.js';
import { listBackups } from './backup.js';
import { bad } from '../util.js';
import { PLATFORM_TZ, localToday } from './platformTime.js';

export { PLATFORM_TZ };
const pdb = () => platformDb();

// ---------------------------------------------------------------- time
/** Minutes the platform timezone is ahead of UTC at `when`. */
function offsetMin(when = Date.now()) {
  const local = Date.parse(`${new Date(when).toLocaleString('sv-SE', { timeZone: PLATFORM_TZ }).replace(' ', 'T')}Z`);
  return Math.round((local - Math.floor(when / 1000) * 1000) / 60000);
}
export { localToday };
export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Start of a local day as a UTC 'YYYY-MM-DD HH:MM:SS' string, comparable with SQLite datetime('now') values. */
export function utcStart(day) {
  const ms = Date.parse(`${day}T00:00:00Z`) - offsetMin(Date.parse(`${day}T12:00:00Z`)) * 60000;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}
/** SQL expression turning a UTC timestamp column into the platform-local date. */
export const localDayExpr = (col) => `date(${col}, '${offsetMin() >= 0 ? '+' : ''}${offsetMin()} minutes')`;

export const RANGES = ['today', '7d', '30d', 'month', 'prev_month', 'quarter', 'year', 'custom'];
/** Resolve a range key to inclusive local dates plus the previous equivalent period. */
export function resolveRange({ range = '30d', from, to } = {}) {
  const t = localToday();
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const ymd = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  let f, e, pf, pe;
  switch (range) {
    case 'today': f = e = t; pf = pe = addDays(t, -1); break;
    case '7d': f = addDays(t, -6); e = t; break;
    case '30d': f = addDays(t, -29); e = t; break;
    case 'month': f = ymd(y, m, 1); e = t; pf = ymd(y, m - 1, 1); pe = addDays(pf, daysBetween(f, e)); if (pe >= f) pe = addDays(f, -1); break;
    case 'prev_month': f = ymd(y, m - 1, 1); e = ymd(y, m, 0); pf = ymd(y, m - 2, 1); pe = ymd(y, m - 1, 0); break;
    case 'quarter': { const q = Math.floor((m - 1) / 3) * 3 + 1; f = ymd(y, q, 1); e = t; pf = ymd(y, q - 3, 1); pe = addDays(pf, daysBetween(f, e)); if (pe >= f) pe = addDays(f, -1); break; }
    case 'year': f = ymd(y, 1, 1); e = t; pf = ymd(y - 1, 1, 1); pe = addDays(pf, daysBetween(f, e)); break;
    case 'custom':
      if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to)) || from > to) throw bad('Custom range needs from and to dates (YYYY-MM-DD), from on or before to');
      if (daysBetween(from, to) > 3660) throw bad('Custom range can be at most 10 years');
      f = from; e = to; break;
    default: throw bad(`Range must be one of: ${RANGES.join(', ')}`);
  }
  if (!pf) { const len = daysBetween(f, e) + 1; pe = addDays(f, -1); pf = addDays(pe, -(len - 1)); }
  const bucket = daysBetween(f, e) > 92 ? 'month' : 'day';
  return { range, from: f, to: e, prev_from: pf, prev_to: pe, bucket, timezone: PLATFORM_TZ, includes_today: e >= t };
}

// ---------------------------------------------------------------- live state and snapshots
const lastInvoiceCurrency = () => {
  const out = {};
  for (const r of pdb().prepare("SELECT tenant_id, currency FROM invoices WHERE status='paid' ORDER BY id").all()) out[r.tenant_id] = r.currency;
  return out;
};
/** Monthly value of one workspace's subscription, in the currency it pays in. Yearly plans count as price / 12. */
function monthlyValue(t, invoiceCur) {
  // the price this workspace actually pays (kept when plan prices change), else the plan's current price
  if (t.price_amount != null) return { currency: t.price_currency || 'PKR', amount: t.billing_interval === 'year' ? Math.round(t.price_amount / 12) : t.price_amount };
  const p = PLANS[t.plan];
  if (!p) return null;
  const cur = [invoiceCur, t.currency, 'PKR'].find((c) => c && p.price[c]);
  if (!cur) return null;
  const price = p.price[cur];
  return { currency: cur, amount: t.billing_interval === 'year' ? Math.round(price.year / 12) : price.month };
}
const addTo = (map, cur, n) => { map[cur] = (map[cur] || 0) + n; return map; };

/** What the platform looks like right now (the same rules the workspaces themselves are held to). */
export function liveState() {
  const cur = lastInvoiceCurrency();
  const s = { workspaces: 0, active: 0, suspended: 0, cancelled: 0, trialing: 0, paying: 0, past_due: 0, locked: 0, expiring: 0, mrr: {} };
  for (const t of listTenants()) {
    s.workspaces += 1;
    if (t.status === 'suspended') s.suspended += 1;
    if (t.status === 'cancelled') s.cancelled += 1;
    if (t.status !== 'active') continue;
    s.active += 1;
    if (t.is_legacy) continue;
    const e = expiryOf(t);
    if (e.locked) s.locked += 1;
    if (e.billing_status === 'trialing' && !e.locked) s.trialing += 1;
    if (e.billing_status === 'past_due') s.past_due += 1;
    if (!e.locked && ['urgent', 'soon'].includes(e.level)) s.expiring += 1;
    if ((e.billing_status === 'active' || (e.billing_status === 'canceled' && !e.locked)) && PLANS[t.plan]) {
      s.paying += 1;
      if (e.billing_status === 'active') { const v = monthlyValue(t, cur[t.id]); if (v) addTo(s.mrr, v.currency, v.amount); }
    }
  }
  return s;
}

/** Record today's figures (idempotent: re-running the same day overwrites that day's row). */
export function snapshot() {
  const s = liveState();
  pdb().prepare(`INSERT INTO platform_metrics_daily(day,workspaces,active,suspended,cancelled,trialing,paying,past_due,locked,mrr,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(day) DO UPDATE SET workspaces=excluded.workspaces, active=excluded.active, suspended=excluded.suspended, cancelled=excluded.cancelled, trialing=excluded.trialing,
    paying=excluded.paying, past_due=excluded.past_due, locked=excluded.locked, mrr=excluded.mrr, updated_at=excluded.updated_at`)
    .run(localToday(), s.workspaces, s.active, s.suspended, s.cancelled, s.trialing, s.paying, s.past_due, s.locked, JSON.stringify(s.mrr));
  return s;
}
/** The figures as they were at the end of `day`: live for today or later, else the nearest snapshot at most 3 days earlier. */
function stateAt(day, live) {
  if (day >= localToday()) return live;
  const r = pdb().prepare('SELECT * FROM platform_metrics_daily WHERE day<=? ORDER BY day DESC LIMIT 1').get(day);
  if (!r || daysBetween(r.day, day) > 3) return null;
  return { ...r, mrr: JSON.parse(r.mrr || '{}'), snapshot_day: r.day };
}

// ---------------------------------------------------------------- KPIs
const sumByCurrency = (rows) => rows.reduce((m, r) => addTo(m, r.currency, r.total), {});
function paymentsIn(from, to) {
  const rows = pdb().prepare("SELECT currency, SUM(amount) total, COUNT(*) n FROM invoices WHERE status='paid' AND created_at>=? AND created_at<? GROUP BY currency").all(utcStart(from), utcStart(addDays(to, 1)));
  return { by_currency: sumByCurrency(rows), count: rows.reduce((s, r) => s + r.n, 0) };
}
function failuresIn(from, to) {
  const a = utcStart(from), b = utcStart(addDays(to, 1));
  const failed = pdb().prepare("SELECT COUNT(*) n FROM billing_events WHERE type='payment.failed' AND created_at>=? AND created_at<?").get(a, b).n;
  const rejected = pdb().prepare("SELECT COUNT(*) n FROM payment_submissions WHERE status='rejected' AND decided_at>=? AND decided_at<?").get(a, b).n;
  return failed + rejected;
}
const paidTenantIds = () => new Set(pdb().prepare("SELECT DISTINCT tenant_id FROM invoices WHERE status='paid'").all().map((r) => r.tenant_id));
/** Of the trials that ended in the period, how many became paying. */
function conversionIn(from, to, paid) {
  const cohort = pdb().prepare('SELECT id, subscription_status FROM tenants WHERE is_legacy=0 AND trial_ends_at>=? AND trial_ends_at<=?').all(from, to);
  const converted = cohort.filter((t) => paid.has(t.id) || ['active', 'past_due', 'canceled'].includes(t.subscription_status)).length;
  return { cohort: cohort.length, converted, rate: cohort.length ? Math.round((converted / cohort.length) * 1000) / 10 : null };
}
/** Paying workspaces at the start of the period (paid invoice covering that day) and how many cancelled during it. */
function churnIn(from, to) {
  const payingAtStart = pdb().prepare("SELECT COUNT(DISTINCT tenant_id) n FROM invoices WHERE status='paid' AND period_start<=? AND period_end>=?").get(from, from).n;
  const lost = pdb().prepare(`SELECT COUNT(DISTINCT tenant_id) n FROM tenant_events WHERE action IN ('status:cancelled','billing:subscription.canceled') AND created_at>=? AND created_at<?`)
    .get(utcStart(from), utcStart(addDays(to, 1))).n;
  return { paying_at_start: payingAtStart, cancelled: lost, rate: payingAtStart ? Math.round((lost / payingAtStart) * 1000) / 10 : null };
}
const createdBefore = (day) => pdb().prepare('SELECT COUNT(*) n FROM tenants WHERE created_at<?').get(utcStart(addDays(day, 1))).n;
const delta = (cur, prev) => (cur == null || prev == null ? { previous: prev ?? null, change: null } : { previous: prev, change: cur - prev, percent: prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null });
const mainCurrency = (maps) => { const tot = {}; for (const m of maps) for (const [c, v] of Object.entries(m || {})) addTo(tot, c, v); return Object.keys(tot).sort((a, b) => tot[b] - tot[a])[0] || 'PKR'; };

export function kpis(r, live = liveState()) {
  const end = stateAt(r.to, live), prevEnd = stateAt(r.prev_to, live);
  const pay = paymentsIn(r.from, r.to), payPrev = paymentsIn(r.prev_from, r.prev_to);
  const paid = paidTenantIds();
  const conv = conversionIn(r.from, r.to, paid), convPrev = conversionIn(r.prev_from, r.prev_to, paid);
  const churn = churnIn(r.from, r.to), churnPrev = churnIn(r.prev_from, r.prev_to);
  const cur = mainCurrency([live.mrr, pay.by_currency]);
  const fromState = (key) => ({ value: end ? end[key] : null, ...delta(end ? end[key] : null, prevEnd ? prevEnd[key] : null) });
  const money = (map) => (map ? map[cur] || 0 : null);
  const failedNow = failuresIn(r.from, r.to), failedPrev = failuresIn(r.prev_from, r.prev_to);
  return {
    currency: cur,
    total_workspaces: { value: createdBefore(r.to), ...delta(createdBefore(r.to), createdBefore(r.prev_to)), link: '/platform/workspaces' },
    active_workspaces: { ...fromState('active'), link: '/platform/workspaces?status=active' },
    paying_workspaces: { ...fromState('paying'), link: '/platform/workspaces?status=paying' },
    trial_workspaces: { ...fromState('trialing'), link: '/platform/workspaces?status=trial' },
    suspended_workspaces: { ...fromState('suspended'), link: '/platform/workspaces?status=suspended' },
    expiring: { value: live.expiring, previous: null, change: null, note: 'Expired or due in the next 14 days (live)', link: '/platform/expiry' },
    mrr: { value: end ? money(end.mrr) : null, ...delta(end ? money(end.mrr) : null, prevEnd ? money(prevEnd.mrr) : null), by_currency: end?.mrr || null, money: true, link: '/platform/workspaces?status=paying' },
    arr: { value: end ? money(end.mrr) * 12 : null, ...delta(end ? money(end.mrr) * 12 : null, prevEnd ? money(prevEnd.mrr) * 12 : null), money: true, link: '/platform/workspaces?status=paying' },
    payments_received: { value: pay.by_currency[cur] || 0, ...delta(pay.by_currency[cur] || 0, payPrev.by_currency[cur] || 0), by_currency: pay.by_currency, count: pay.count, money: true, link: '/platform/payments' },
    failed_payments: { value: failedNow, ...delta(failedNow, failedPrev), past_due_now: live.past_due, inverse: true, link: '/platform/workspaces?status=attention' },
    trial_conversion: { value: conv.rate, ...delta(conv.rate, convPrev.rate), percent_unit: true, detail: conv, link: '/platform/workspaces?status=trial' },
    churn_rate: { value: churn.rate, ...delta(churn.rate, churnPrev.rate), percent_unit: true, inverse: true, detail: churn, link: '/platform/workspaces?status=cancelled' },
    snapshot_note: (!end || !prevEnd) ? 'Some comparisons need daily history. The console records it from now on.' : null,
  };
}

// ---------------------------------------------------------------- charts and lists
export function buckets(r) {
  const out = [];
  if (r.bucket === 'day') for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d);
  else { let d = `${r.from.slice(0, 7)}-01`; while (d.slice(0, 7) <= r.to.slice(0, 7)) { out.push(d.slice(0, 7)); d = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1)).toISOString().slice(0, 10); } }
  return out;
}
export const keyExpr = (col, r) => (r.bucket === 'day' ? localDayExpr(col) : `substr(${localDayExpr(col)},1,7)`);

export function charts(r, req) {
  const a = utcStart(r.from), b = utcStart(addDays(r.to, 1));
  const keys = buckets(r);
  const rev = pdb().prepare(`SELECT ${keyExpr('created_at', r)} k, currency, SUM(amount) total FROM invoices WHERE status='paid' AND created_at>=? AND created_at<? GROUP BY k, currency`).all(a, b);
  const currencies = [...new Set(rev.map((x) => x.currency))];
  const revenue = keys.map((k) => Object.fromEntries([['x', k], ...currencies.map((c) => [c, rev.filter((x) => x.k === k && x.currency === c).reduce((s, x) => s + x.total, 0)])]));
  const reg = pdb().prepare(`SELECT ${keyExpr('created_at', r)} k, COUNT(*) n FROM tenants WHERE created_at>=? AND created_at<? GROUP BY k`).all(a, b);
  const registrations = keys.map((k) => ({ x: k, workspaces: reg.find((x) => x.k === k)?.n || 0 }));
  const ok = pdb().prepare(`SELECT ${keyExpr('created_at', r)} k, COUNT(*) n FROM invoices WHERE status='paid' AND created_at>=? AND created_at<? GROUP BY k`).all(a, b);
  const bad1 = pdb().prepare(`SELECT ${keyExpr('created_at', r)} k, COUNT(*) n FROM billing_events WHERE type='payment.failed' AND created_at>=? AND created_at<? GROUP BY k`).all(a, b);
  const bad2 = pdb().prepare(`SELECT ${keyExpr('decided_at', r)} k, COUNT(*) n FROM payment_submissions WHERE status='rejected' AND decided_at>=? AND decided_at<? GROUP BY k`).all(a, b);
  const payments = keys.map((k) => ({ x: k, succeeded: ok.find((x) => x.k === k)?.n || 0, failed: (bad1.find((x) => x.k === k)?.n || 0) + (bad2.find((x) => x.k === k)?.n || 0) }));

  const tenants = listTenants();
  const status = ['active', 'suspended', 'cancelled'].map((s) => ({ name: s, value: tenants.filter((t) => t.status === s).length }));
  const planDist = {};
  for (const t of tenants) if (t.status === 'active') { const e = expiryOf(t); const k = t.is_legacy ? 'Original' : e.billing_status === 'trialing' ? 'Free trial' : (PLANS[t.plan]?.name || t.plan); addTo(planDist, k, 1); }

  // funnel for workspaces that signed up in the period; reading each workspace's own database for the setup steps
  const paid = paidTenantIds();
  const cohort = tenantSummaries(req).filter((t) => !t.is_legacy && t.created_at >= a && t.created_at < b);
  const step = (t, id) => !!t.progress?.steps.find((s) => s.id === id)?.done;
  const funnel = [
    { stage: 'Signed up', value: cohort.length },
    { stage: 'Email confirmed', value: cohort.filter((t) => step(t, 'verified')).length },
    { stage: 'Started using (3+ setup steps)', value: cohort.filter((t) => (t.progress?.done || 0) >= 3).length },
    { stage: 'Paid', value: cohort.filter((t) => paid.has(t.id) || ['active', 'past_due', 'canceled'].includes(t.subscription_status)).length },
  ];

  // next 8 weeks: when trials and paid periods end
  const today = localToday();
  const weeks = Array.from({ length: 8 }, (_, i) => ({ x: addDays(today, i * 7), trials: 0, subscriptions: 0 }));
  for (const t of tenants) {
    if (t.is_legacy || t.status !== 'active') continue;
    const e = expiryOf(t);
    if (!e.date || e.date < today) continue;
    const i = Math.floor(daysBetween(today, e.date) / 7);
    if (i < 8) weeks[i][e.kind === 'trial' ? 'trials' : 'subscriptions'] += 1;
  }

  const top = pdb().prepare(`SELECT t.id, t.name, t.slug, i.currency, SUM(i.amount) total, COUNT(*) n FROM invoices i JOIN tenants t ON t.id=i.tenant_id
    WHERE i.status='paid' AND i.created_at>=? AND i.created_at<? GROUP BY t.id, i.currency ORDER BY total DESC LIMIT 8`).all(a, b);
  const recentTx = [
    ...pdb().prepare(`SELECT 'invoice' kind, i.id, i.created_at, i.amount, i.currency, i.status, i.provider_invoice_id reference, t.name tenant, t.id tenant_id FROM invoices i JOIN tenants t ON t.id=i.tenant_id ORDER BY i.id DESC LIMIT 10`).all(),
    ...pdb().prepare(`SELECT 'submission' kind, s.id, s.created_at, s.amount, s.currency, s.status, s.reference, t.name tenant, t.id tenant_id, s.method FROM payment_submissions s JOIN tenants t ON t.id=s.tenant_id ORDER BY s.id DESC LIMIT 10`).all(),
  ].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, 10);
  const activity = pdb().prepare('SELECT id, admin, action, detail, created_at FROM platform_audit ORDER BY id DESC LIMIT 10').all();
  return { bucket: r.bucket, currencies, revenue, registrations, payments, status, plans: Object.entries(planDist).map(([name, value]) => ({ name, value })), funnel, expiry_timeline: weeks, top_workspaces: top, recent_transactions: recentTx, recent_activity: activity };
}

export function dashboard(q, req) {
  const r = resolveRange(q);
  const live = snapshot();
  generateNotifications(req);
  return { range: r, kpis: kpis(r, live), charts: charts(r, req), health: health() };
}

// ---------------------------------------------------------------- health
const jobs = {};
/** Background jobs report in here so the health page shows when they last ran and whether they failed. */
export function markJob(name, error = null) { jobs[name] = { last_run: new Date().toISOString(), error: error ? String(error.message || error).slice(0, 200) : null }; }
const check = (id, label, state, detail, link) => ({ id, label, state, detail, link: link || null });

/** Real checks only. `unknown` means nothing has verified it; it is never shown as healthy. */
export function health() {
  const out = [];
  const t0 = process.hrtime.bigint();
  try { pdb().prepare('SELECT COUNT(*) FROM tenants').get(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; out.push(check('database', 'Platform database', ms < 200 ? 'healthy' : 'degraded', `Query answered in ${ms.toFixed(1)} ms`)); }
  catch { out.push(check('database', 'Platform database', 'unhealthy', 'The platform database did not answer')); }
  const missing = listTenants().filter((t) => !fs.existsSync(t.db_path)).length;
  out.push(check('workspaces', 'Workspace databases', missing ? 'unhealthy' : 'healthy', missing ? `${missing} workspace database file(s) missing` : 'Every workspace database file is present', '/platform/workspaces'));
  try {
    const st = fs.statfsSync(path.resolve(DATA_DIR));
    const free = st.bavail * st.bsize, total = st.blocks * st.bsize, pct = total ? (free / total) * 100 : 0;
    out.push(check('storage', 'Disk space', pct < 5 ? 'unhealthy' : pct < 15 ? 'degraded' : 'healthy', `${(free / 1e9).toFixed(1)} GB free (${pct.toFixed(0)}%)`));
  } catch { out.push(check('storage', 'Disk space', 'unknown', 'Disk space could not be read on this system')); }
  const backupsOn = process.env.BACKUP_ENABLED !== '0';
  const last = listBackups()[0];
  const every = Number(process.env.BACKUP_EVERY_HOURS) || 24;
  if (!backupsOn) out.push(check('backups', 'Backups', 'degraded', 'Automatic backups are turned off', '/platform/backups'));
  else if (!last?.created_at) out.push(check('backups', 'Backups', 'unhealthy', 'No completed backup yet', '/platform/backups'));
  else {
    const age = (Date.now() - Date.parse(last.created_at)) / 3600e3;
    out.push(check('backups', 'Backups', last.errors?.length ? 'degraded' : age > every * 1.5 ? 'unhealthy' : 'healthy', `${last.errors?.length ? `${last.errors.length} problem(s) in the last backup. ` : ''}Last completed ${age < 1 ? 'under an hour' : `${Math.round(age)} h`} ago`, '/platform/backups'));
  }
  out.push(process.env.RESEND_API_KEY
    ? check('email', 'Email delivery', 'unknown', 'A mail key is set. Delivery is not monitored yet.')
    : check('email', 'Email delivery', 'degraded', 'Not configured: emails are only written to the server log'));
  const s = stripeView();
  if (!s.ready) out.push(check('stripe', 'Stripe card payments', 'unknown', 'Not configured', '/platform/billing/stripe'));
  else {
    const lastHook = pdb().prepare("SELECT MAX(created_at) at FROM billing_events WHERE provider='stripe'").get().at;
    out.push(check('stripe', 'Stripe card payments', 'unknown', `Keys saved (${s.mode} mode). ${lastHook ? `Last webhook received ${lastHook} UTC.` : 'No webhook received yet.'} Use Test connection to verify.`, '/platform/billing/stripe'));
  }
  const accounts = pdb().prepare('SELECT COUNT(*) n FROM payment_accounts WHERE active=1').get().n;
  out.push(check('local', 'Local payment accounts', accounts ? 'healthy' : 'unknown', accounts ? `${accounts} account(s) shown to customers` : 'None configured', '/platform/billing/accounts'));
  for (const [name, label, everyMin] of [['tenant-jobs', 'Scheduled reminders', 30], ['platform-jobs', 'Platform jobs (snapshots, alerts)', 60]]) {
    const j = jobs[name];
    if (!j) out.push(check(name, label, 'unknown', 'Has not run since the server started'));
    else {
      const age = (Date.now() - Date.parse(j.last_run)) / 60000;
      out.push(check(name, label, j.error ? 'unhealthy' : age > everyMin * 2.5 ? 'degraded' : 'healthy', j.error ? `Last run failed: ${j.error}` : `Last ran ${Math.max(1, Math.round(age))} min ago`));
    }
  }
  out.push(check('domain', 'Workspace addresses', isMultiTenant() ? 'healthy' : 'degraded', isMultiTenant() ? `Workspaces are served at <name>.${BASE_DOMAIN}` : 'Single-company mode (ERP_BASE_DOMAIN not set)'));
  // the overall state is the worst *verified* state; unchecked items are counted separately, never folded into "healthy"
  const rank = { unhealthy: 3, degraded: 2, healthy: 1 };
  const checked = out.filter((c) => c.state !== 'unknown');
  const overall = checked.length ? checked.reduce((w, c) => (rank[c.state] > rank[w] ? c.state : w), 'healthy') : 'unknown';
  return { overall, unknown: out.length - checked.length, checks: out, checked_at: new Date().toISOString() };
}

// ---------------------------------------------------------------- notifications
let lastGen = 0;
/** Create one alert per open condition and resolve alerts whose condition has cleared. Throttled to once a minute. */
export function generateNotifications(req, force = false) {
  if (!force && Date.now() - lastGen < 60_000) return;
  lastGen = Date.now();
  const want = new Map();
  const add = (n) => want.set(n.dedupe, n);
  const summaries = tenantSummaries(req);
  for (const t of summaries) {
    if (t.is_legacy || t.status !== 'active') continue;
    const e = t.expiry;
    const link = `/platform/workspaces/${t.id}`;
    if (e.locked) add({ kind: 'expired', severity: 'critical', title: `${t.name} is read-only`, body: { trial_ended: 'Free trial ended', payment_failed: 'Grace period after a failed payment ended', subscription_ended: 'Subscription ended' }[e.reason] || 'Billing is not up to date', link, tenant_id: t.id, dedupe: `locked:${t.id}:${e.reason}:${e.date}` });
    else if (e.kind === 'grace') add({ kind: 'payment_failed', severity: 'critical', title: `Payment failed: ${t.name}`, body: `Read-only after ${e.date} unless paid`, link, tenant_id: t.id, dedupe: `pastdue:${t.id}:${e.date}` });
    else if (e.days_left != null && e.days_left <= 7) {
      add({ kind: 'expiring', severity: 'warning', title: `${t.name}: ${e.kind === 'trial' ? 'trial' : 'subscription'} ends in ${e.days_left} day${e.days_left === 1 ? '' : 's'}`, body: `Ends ${e.date}`, link, tenant_id: t.id, dedupe: `expiry:${t.id}:${e.kind}:${e.date}` });
      if (e.kind === 'trial' && (t.progress?.percent || 0) >= 50) add({ kind: 'conversion', severity: 'info', title: `Conversion opportunity: ${t.name}`, body: `${t.progress.percent}% set up and the trial ends ${e.date}`, link, tenant_id: t.id, dedupe: `convert:${t.id}:${e.date}` });
    }
  }
  for (const p of pdb().prepare("SELECT s.id, s.amount, s.currency, s.method, t.name, t.id tid FROM payment_submissions s JOIN tenants t ON t.id=s.tenant_id WHERE s.status='pending'").all()) {
    add({ kind: 'approval', severity: 'warning', title: `Payment to confirm: ${p.name}`, body: `${p.currency} ${p.amount.toLocaleString('en')} by ${p.method}`, link: '/platform/payments', tenant_id: p.tid, dedupe: `payment:${p.id}` });
  }
  for (const c of health().checks) if (c.state === 'unhealthy' || (c.state === 'degraded' && c.id === 'backups')) add({ kind: 'health', severity: c.state === 'unhealthy' ? 'critical' : 'warning', title: `${c.label}: ${c.state}`, body: c.detail, link: c.link || '/platform/health', dedupe: `health:${c.id}:${c.state}` });

  const db = pdb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const ins = db.prepare('INSERT INTO platform_notifications(kind,severity,title,body,link,tenant_id,dedupe) VALUES(?,?,?,?,?,?,?) ON CONFLICT(dedupe) DO UPDATE SET resolved_at=NULL, title=excluded.title, body=excluded.body');
    for (const n of want.values()) ins.run(n.kind, n.severity, n.title, n.body || null, n.link || null, n.tenant_id || null, n.dedupe);
    // only alerts this generator raises are closed here; security alerts (sign-ins) stay until someone reads them
    const open = db.prepare("SELECT id, dedupe FROM platform_notifications WHERE resolved_at IS NULL AND kind IN ('expired','payment_failed','expiring','conversion','approval','health')").all();
    const res = db.prepare("UPDATE platform_notifications SET resolved_at=datetime('now') WHERE id=?");
    for (const o of open) if (!want.has(o.dedupe)) res.run(o.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function listNotifications(adminId, { all = false } = {}) {
  const rows = pdb().prepare(`SELECT n.*, r.read_at FROM platform_notifications n LEFT JOIN platform_notification_reads r ON r.notification_id=n.id AND r.admin_id=?
    ${all ? '' : 'WHERE n.resolved_at IS NULL'} ORDER BY n.resolved_at IS NOT NULL, CASE n.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, n.id DESC LIMIT 200`).all(adminId ?? -1);
  return { unread: rows.filter((n) => !n.read_at && !n.resolved_at).length, items: rows.map((n) => ({ ...n, read: !!n.read_at, resolved: !!n.resolved_at })) };
}
export function markRead(adminId, ids) {
  if (!adminId) throw bad('Sign in as an admin to mark notifications');
  const st = pdb().prepare('INSERT OR IGNORE INTO platform_notification_reads(admin_id, notification_id) SELECT ?, id FROM platform_notifications WHERE id=?');
  const list = ids === 'all' ? pdb().prepare('SELECT id FROM platform_notifications WHERE resolved_at IS NULL').all().map((r) => r.id) : [].concat(ids || []).map(Number).filter(Boolean);
  for (const id of list) st.run(adminId, id);
  return list.length;
}

// ---------------------------------------------------------------- global search
export function search(q) {
  const s = String(q || '').trim();
  if (s.length < 2) return [];
  const like = `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const out = [];
  for (const t of pdb().prepare(`SELECT id, name, slug, owner_email, status FROM tenants WHERE name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' OR owner_email LIKE ? ESCAPE '\\' OR custom_domain LIKE ? ESCAPE '\\'
    OR provider_customer_id=? OR provider_subscription_id=? ORDER BY name LIMIT 10`).all(like, like, like, like, s, s)) out.push({ type: 'Workspace', title: t.name, sub: `${t.slug} · ${t.owner_email || ''} · ${t.status}`, link: `/platform/workspaces/${t.id}` });
  for (const i of pdb().prepare(`SELECT i.id, i.provider_invoice_id, i.amount, i.currency, i.status, t.name, t.id tid FROM invoices i JOIN tenants t ON t.id=i.tenant_id WHERE i.provider_invoice_id LIKE ? ESCAPE '\\' LIMIT 10`).all(like)) out.push({ type: 'Invoice', title: i.provider_invoice_id, sub: `${i.name} · ${i.currency} ${i.amount} · ${i.status}`, link: `/platform/workspaces/${i.tid}` });
  for (const p of pdb().prepare(`SELECT s.id, s.reference, s.amount, s.currency, s.status, t.name FROM payment_submissions s JOIN tenants t ON t.id=s.tenant_id WHERE s.reference LIKE ? ESCAPE '\\' LIMIT 10`).all(like)) out.push({ type: 'Payment', title: p.reference, sub: `${p.name} · ${p.currency} ${p.amount} · ${p.status}`, link: '/platform/payments' });
  for (const a of pdb().prepare(`SELECT id, email, name FROM platform_admins WHERE email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' LIMIT 5`).all(like, like)) out.push({ type: 'Super admin', title: a.name, sub: a.email, link: '/platform/admins' });
  return out;
}
