// Reports and the reconciliation check for the super admin console. Every report reads the same records the dashboard
// does (tenants, invoices, payment submissions, billing events, daily snapshots, audit log) with the same date ranges
// and timezone, so a report and the dashboard always agree. Exports are built on the server and permission-checked.
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { platformDb, listTenants } from '../platform.js';
import { PLANS } from './plans.js';
import { resolveRange, utcStart, addDays, buckets, keyExpr, health } from './platformMetrics.js';
import { expiryOf, tenantSummaries, storageOf } from './platformTenants.js';
import { listBackups } from './backup.js';
import { recentErrors } from './maintenance.js';
import { bad, HttpError } from '../util.js';
import { localDay } from './platformTime.js';

const pdb = () => platformDb();
const n = (v) => Number(v || 0);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const monthsIn = (r) => buckets({ ...r, bucket: 'month' });
const monthEnd = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** id -> { title, group, permission, description, run(range, req) => { columns, rows, chart? } } */
export const REPORTS = {
  growth: {
    title: 'Workspace registrations and growth', group: 'Growth', perm: 'workspaces.view', description: 'New workspaces per period and the running total.',
    run(r) {
      const a = utcStart(r.from), b = utcStart(addDays(r.to, 1));
      const rows = pdb().prepare(`SELECT ${keyExpr('created_at', r)} k, COUNT(*) n FROM tenants WHERE created_at>=? AND created_at<? GROUP BY k`).all(a, b);
      let total = pdb().prepare('SELECT COUNT(*) n FROM tenants WHERE created_at<?').get(a).n;
      return { columns: [['period', 'Period'], ['new', 'New workspaces'], ['total', 'Total at end of period']], chart: { x: 'period', series: ['new'] },
        rows: buckets(r).map((k) => { const nw = rows.find((x) => x.k === k)?.n || 0; total += nw; return { period: k, new: nw, total }; }) };
    },
  },
  revenue: {
    title: 'Revenue and collections', group: 'Revenue', perm: 'billing.view', description: 'Money received (paid invoices) per period and currency.',
    run(r) {
      const a = utcStart(r.from), b = utcStart(addDays(r.to, 1));
      const rows = pdb().prepare(`SELECT ${keyExpr('created_at', r)} k, currency, SUM(amount) total, COUNT(*) n FROM invoices WHERE status='paid' AND created_at>=? AND created_at<? GROUP BY k, currency`).all(a, b);
      const curs = [...new Set(rows.map((x) => x.currency))].sort();
      return { columns: [['period', 'Period'], ...curs.flatMap((c) => [[c, `Collected ${c}`], [`${c}_n`, `Payments ${c}`]])], chart: { x: 'period', series: curs },
        rows: buckets(r).map((k) => Object.fromEntries([['period', k], ...curs.flatMap((c) => { const x = rows.find((y) => y.k === k && y.currency === c); return [[c, n(x?.total)], [`${c}_n`, n(x?.n)]]; })])) };
    },
  },
  mrr: {
    title: 'MRR and ARR', group: 'Revenue', perm: 'billing.view', description: 'Monthly and annual recurring revenue at the end of each month, from the daily snapshots.',
    run(r) {
      const snaps = pdb().prepare('SELECT day, mrr, paying FROM platform_metrics_daily WHERE day>=? AND day<=? ORDER BY day').all(addDays(r.from, -3), r.to);
      const rows = monthsIn(r).map((m) => {
        const end = monthEnd(m) > r.to ? r.to : monthEnd(m);
        const s = snaps.filter((x) => x.day <= end && x.day >= `${m}-01`).pop();
        const mrr = s ? JSON.parse(s.mrr || '{}') : null;
        return { month: m, as_of: s?.day || null, paying: s ? s.paying : null, mrr_pkr: mrr ? n(mrr.PKR) : null, arr_pkr: mrr ? n(mrr.PKR) * 12 : null, mrr_usd: mrr ? n(mrr.USD) : null, arr_usd: mrr ? n(mrr.USD) * 12 : null };
      });
      return { columns: [['month', 'Month'], ['as_of', 'Figures as of'], ['paying', 'Paying workspaces'], ['mrr_pkr', 'MRR PKR'], ['arr_pkr', 'ARR PKR'], ['mrr_usd', 'MRR USD'], ['arr_usd', 'ARR USD']], chart: { x: 'month', series: ['mrr_pkr'] },
        rows, note: 'Months before daily snapshots began show no figures; history builds up from the day the console was upgraded.' };
    },
  },
  conversion: {
    title: 'Trial conversion', group: 'Customers', perm: 'billing.view', description: 'Trials grouped by the month they ended, and how many became paying.',
    run(r) {
      const paid = new Set(pdb().prepare("SELECT DISTINCT tenant_id FROM invoices WHERE status='paid'").all().map((x) => x.tenant_id));
      const t = pdb().prepare('SELECT id, trial_ends_at, subscription_status FROM tenants WHERE is_legacy=0 AND trial_ends_at>=? AND trial_ends_at<=?').all(r.from, r.to);
      return { columns: [['month', 'Trial ended in'], ['trials', 'Trials ended'], ['converted', 'Became paying'], ['rate', 'Conversion %']], chart: { x: 'month', series: ['trials', 'converted'] },
        rows: monthsIn(r).map((m) => { const c = t.filter((x) => x.trial_ends_at.startsWith(m)); const conv = c.filter((x) => paid.has(x.id) || ['active', 'past_due', 'canceled'].includes(x.subscription_status)).length; return { month: m, trials: c.length, converted: conv, rate: pct(conv, c.length) }; }) };
    },
  },
  churn: {
    title: 'Renewals and churn', group: 'Customers', perm: 'billing.view', description: 'Paying workspaces at the start of each month, how many renewed (paid again) and how many cancelled.',
    run(r) {
      return { columns: [['month', 'Month'], ['paying_start', 'Paying at start'], ['renewals', 'Renewal payments'], ['cancelled', 'Cancelled'], ['churn', 'Churn %']], chart: { x: 'month', series: ['renewals', 'cancelled'] },
        rows: monthsIn(r).map((m) => {
          const start = `${m}-01`, end = monthEnd(m);
          const paying = pdb().prepare("SELECT COUNT(DISTINCT tenant_id) n FROM invoices WHERE status='paid' AND period_start<=? AND period_end>=?").get(start, start).n;
          const renew = pdb().prepare("SELECT COUNT(*) n FROM invoices i WHERE status='paid' AND created_at>=? AND created_at<? AND EXISTS(SELECT 1 FROM invoices j WHERE j.tenant_id=i.tenant_id AND j.status='paid' AND j.id<i.id)").get(utcStart(start), utcStart(addDays(end, 1))).n;
          const lost = pdb().prepare("SELECT COUNT(DISTINCT tenant_id) n FROM tenant_events WHERE action IN ('status:cancelled','billing:subscription.canceled') AND created_at>=? AND created_at<?").get(utcStart(start), utcStart(addDays(end, 1))).n;
          return { month: m, paying_start: paying, renewals: renew, cancelled: lost, churn: pct(lost, paying) };
        }) };
    },
  },
  outstanding: {
    title: 'Outstanding and overdue', group: 'Revenue', perm: 'billing.view', description: 'Workspaces whose payment failed or whose access ended, plus transfers waiting for approval. Not limited by the date range.',
    run() {
      const rows = [];
      for (const t of listTenants()) {
        if (t.is_legacy || t.status !== 'active') continue;
        const e = expiryOf(t);
        if (!(e.billing_status === 'past_due' || (e.locked && e.kind !== 'trial'))) continue;
        rows.push({ workspace: t.name, slug: t.slug, owner: t.owner_email, state: e.locked ? 'Read-only' : 'Payment failed (grace)', since: e.date, plan: PLANS[t.plan]?.name || t.plan, amount: t.price_amount, currency: t.price_currency || 'PKR' });
      }
      for (const s of pdb().prepare("SELECT s.*, t.name, t.slug, t.owner_email FROM payment_submissions s JOIN tenants t ON t.id=s.tenant_id WHERE s.status='pending'").all()) {
        rows.push({ workspace: s.name, slug: s.slug, owner: s.owner_email, state: `Transfer to confirm (${s.method} ${s.reference})`, since: localDay(s.created_at), plan: PLANS[s.plan]?.name || s.plan, amount: s.amount, currency: s.currency });
      }
      return { columns: [['workspace', 'Workspace'], ['slug', 'Address'], ['owner', 'Owner'], ['state', 'State'], ['since', 'Date'], ['plan', 'Plan'], ['amount', 'Amount'], ['currency', 'Currency']], rows };
    },
  },
  failures: {
    title: 'Payment failures', group: 'Revenue', perm: 'billing.view', description: 'Failed card payments and rejected transfers, with the reason where known.',
    run(r) {
      const a = utcStart(r.from), b = utcStart(addDays(r.to, 1));
      const ev = pdb().prepare("SELECT e.created_at, e.provider, e.payload, t.name, t.slug FROM billing_events e LEFT JOIN tenants t ON t.id=e.tenant_id WHERE e.type='payment.failed' AND e.created_at>=? AND e.created_at<?").all(a, b)
        .map((x) => { let reason = null; try { reason = JSON.parse(x.payload || '{}').reason || null; } catch { /* not JSON */ } return { when: x.created_at, workspace: x.name, slug: x.slug, channel: x.provider, reference: null, amount: null, currency: null, reason: reason || 'Card payment failed' }; });
      const rj = pdb().prepare("SELECT s.decided_at, s.method, s.reference, s.amount, s.currency, s.decision_note, t.name, t.slug FROM payment_submissions s JOIN tenants t ON t.id=s.tenant_id WHERE s.status='rejected' AND s.decided_at>=? AND s.decided_at<?").all(a, b)
        .map((x) => ({ when: x.decided_at, workspace: x.name, slug: x.slug, channel: x.method, reference: x.reference, amount: x.amount, currency: x.currency, reason: x.decision_note }));
      const rows = [...ev, ...rj].sort((p, q) => String(q.when).localeCompare(String(p.when)));
      const succeeded = pdb().prepare("SELECT COUNT(*) n FROM invoices WHERE status='paid' AND created_at>=? AND created_at<?").get(a, b).n;
      return { columns: [['when', 'When (UTC)'], ['workspace', 'Workspace'], ['channel', 'Channel'], ['reference', 'Reference'], ['amount', 'Amount'], ['currency', 'Currency'], ['reason', 'Reason']], rows,
        summary: { 'Successful payments': succeeded, 'Failed or rejected': rows.length, 'Success rate %': pct(succeeded, succeeded + rows.length) } };
    },
  },
  by_plan: {
    title: 'Revenue by plan and payment method', group: 'Revenue', perm: 'billing.view', description: 'Money received in the period split by plan and by how it was paid.',
    run(r) {
      const a = utcStart(r.from), b = utcStart(addDays(r.to, 1));
      const rows = pdb().prepare(`SELECT COALESCE(s.plan, t.plan) plan, COALESCE(s.method, CASE WHEN t.billing_provider='stripe' THEN 'card (Stripe)' ELSE t.billing_provider END, 'other') method, i.currency, SUM(i.amount) total, COUNT(*) n
        FROM invoices i JOIN tenants t ON t.id=i.tenant_id LEFT JOIN payment_submissions s ON 'local-' || s.id = i.provider_invoice_id
        WHERE i.status='paid' AND i.created_at>=? AND i.created_at<? GROUP BY 1, 2, 3 ORDER BY total DESC`).all(a, b)
        .map((x) => ({ plan: PLANS[x.plan]?.name || x.plan, method: x.method, currency: x.currency, payments: x.n, total: x.total }));
      return { columns: [['plan', 'Plan'], ['method', 'Paid by'], ['currency', 'Currency'], ['payments', 'Payments'], ['total', 'Total']], rows };
    },
  },
  usage: {
    title: 'Customer activity and usage', group: 'Customers', perm: 'workspaces.view', description: 'Every workspace with its users, records, storage, setup progress and last activity. Not limited by the date range.',
    run(_r, req) {
      const tenants = Object.fromEntries(listTenants().map((t) => [t.id, t]));
      const rows = tenantSummaries(req).map((t) => {
        const st = storageOf(tenants[t.id]);
        return { workspace: t.name, slug: t.slug, status: t.status, plan: t.is_legacy ? 'Original' : t.expiry.kind === 'trial' ? 'Free trial' : (PLANS[t.plan]?.name || t.plan), users: t.stats?.seats, user_limit: t.expiry.limits?.seats ?? 'Unlimited', projects: t.stats?.projects,
          properties: t.stats?.properties, contacts: t.stats?.contacts, sales: t.stats?.sales, setup_pct: t.progress?.percent, storage_mb: Math.round(((st.database_bytes || 0) + (st.upload_bytes || 0)) / 1e5) / 10, last_activity: t.stats?.last_activity ? t.stats.last_activity.replace('T', ' ').slice(0, 16) : null };
      });
      return { columns: [['workspace', 'Workspace'], ['slug', 'Address'], ['status', 'Status'], ['plan', 'Plan'], ['users', 'Users'], ['user_limit', 'User limit'], ['projects', 'Projects'], ['properties', 'Properties'], ['contacts', 'Customers & leads'], ['sales', 'Sales'], ['setup_pct', 'Setup %'], ['storage_mb', 'Storage MB'], ['last_activity', 'Last activity (UTC)']], rows };
    },
  },
  admin_activity: {
    title: 'Administrator activity', group: 'Security', perm: 'audit.view', description: 'What each console user did in the period, by action.',
    run(r) {
      const rows = pdb().prepare('SELECT admin, action, outcome, COUNT(*) n, MAX(created_at) last FROM platform_audit WHERE created_at>=? AND created_at<? GROUP BY admin, action, outcome ORDER BY admin, n DESC').all(utcStart(r.from), utcStart(addDays(r.to, 1)))
        .map((x) => ({ admin: x.admin, action: x.action, outcome: x.outcome || 'success', count: x.n, last: x.last }));
      return { columns: [['admin', 'Console user'], ['action', 'Action'], ['outcome', 'Result'], ['count', 'Times'], ['last', 'Last (UTC)']], rows };
    },
  },
  reliability: {
    title: 'System reliability', group: 'Security', perm: 'system.view', description: 'Current health checks, backup history and server errors since the last restart.',
    run() {
      const h = health();
      const rows = [
        ...h.checks.map((c) => ({ type: 'Health check', item: c.label, state: c.state, detail: c.detail, when: h.checked_at })),
        ...listBackups().slice(0, 30).map((bk) => ({ type: 'Backup', item: bk.name, state: !bk.created_at ? 'unfinished' : bk.errors.length ? 'problems' : 'ok', detail: bk.errors.join('; ') || `${bk.tenants ?? '?'} workspace(s)`, when: bk.created_at })),
        ...recentErrors().map((e) => ({ type: 'Server error', item: `${e.method} ${e.path}`, state: 'error', detail: e.message, when: e.at })),
      ];
      return { columns: [['type', 'Type'], ['item', 'Item'], ['state', 'State'], ['detail', 'Detail'], ['when', 'When (UTC)']], rows };
    },
  },
};

export const reportList = (operatorCan) => Object.entries(REPORTS).filter(([, d]) => operatorCan(d.perm)).map(([id, d]) => ({ id, title: d.title, group: d.group, description: d.description }));

export function runReport(id, q, req, operatorCan) {
  const def = REPORTS[id];
  if (!def) throw new HttpError(404, 'Unknown report');
  if (!operatorCan(def.perm)) throw new HttpError(403, 'Your role does not allow this report', { code: 'forbidden' });
  const range = resolveRange(q);
  // reports that are monthly by nature always use months
  const r = ['mrr', 'conversion', 'churn'].includes(id) ? { ...range, bucket: 'month' } : range;
  const out = def.run(r, req);
  return { id, title: def.title, description: def.description, range, ...out };
}

const MAX_ROWS = 50000;
/** CSV or Excel file of a report, built on the server. */
export async function exportReport(rep, format) {
  if (rep.rows.length > MAX_ROWS) throw bad(`This report has ${rep.rows.length} rows; narrow the date range (limit ${MAX_ROWS}).`);
  const header = rep.columns.map(([, label]) => label);
  const values = rep.rows.map((row) => rep.columns.map(([k]) => row[k] ?? ''));
  const name = `${rep.id}-${rep.range.from}-to-${rep.range.to}`;
  if (format === 'csv') {
    // a leading = + - @ would be run as a formula by spreadsheet apps, so such cells are prefixed with '
    const esc = (v) => { let s = String(v); if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
    return { name: `${name}.csv`, type: 'text/csv; charset=utf-8', body: Buffer.from(`﻿${[header, ...values].map((r) => r.map(esc).join(',')).join('\r\n')}`) };
  }
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Agentify ERP';
    const ws = wb.addWorksheet(rep.title.slice(0, 31));
    ws.addRow([rep.title]).font = { bold: true, size: 13 };
    ws.addRow([`${rep.range.from} to ${rep.range.to} (${rep.range.timezone})`]);
    ws.addRow([]);
    ws.addRow(header).font = { bold: true };
    for (const v of values) ws.addRow(v.map((x) => (typeof x === 'string' && /^[=+\-@]/.test(x) ? `'${x}` : x)));
    ws.columns.forEach((c) => { c.width = 18; });
    if (rep.summary) { ws.addRow([]); for (const [k, v] of Object.entries(rep.summary)) ws.addRow([k, v]); }
    return { name: `${name}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from(await wb.xlsx.writeBuffer()) };
  }
  throw bad('Format must be csv or xlsx');
}

// ---------------------------------------------------------------- saved report views (per console user)
export function savedViews(adminId) {
  const raw = pdb().prepare('SELECT value FROM platform_settings WHERE key=?').get(`report_views:${adminId}`)?.value;
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}
export function saveView(adminId, { name, report, range, from, to }) {
  if (!adminId) throw bad('Sign in as a console user to save views');
  if (!REPORTS[report]) throw bad('Unknown report');
  const label = String(name || '').trim().slice(0, 60);
  if (!label) throw bad('Give the view a name');
  resolveRange({ range, from, to });
  const views = savedViews(adminId).filter((v) => v.name !== label).concat([{ name: label, report, range, from: from || null, to: to || null }]).slice(-30);
  pdb().prepare("INSERT INTO platform_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(`report_views:${adminId}`, JSON.stringify(views));
  return views;
}
export function deleteView(adminId, name) {
  const views = savedViews(adminId).filter((v) => v.name !== name);
  pdb().prepare("INSERT INTO platform_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(`report_views:${adminId}`, JSON.stringify(views));
  return views;
}

// ---------------------------------------------------------------- reconciliation
/** Cross-checks between the billing records. Each check lists the records that do not agree. */
export function reconcile() {
  const db = pdb();
  const checks = [];
  const add = (id, label, severity, rows, ok) => checks.push({ id, label, state: rows.length ? severity : 'ok', count: rows.length, detail: rows.length ? null : ok, rows: rows.slice(0, 50) });
  add('approved-has-invoice', 'Every approved transfer has a paid invoice', 'error',
    db.prepare("SELECT s.id, s.reference, s.amount, s.currency, t.name workspace FROM payment_submissions s JOIN tenants t ON t.id=s.tenant_id WHERE s.status='approved' AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.provider_invoice_id='local-' || s.id AND i.status='paid')").all(), 'All approved transfers are invoiced');
  add('invoice-has-payment', 'Every transfer invoice belongs to an approved payment', 'error',
    db.prepare("SELECT i.id, i.provider_invoice_id reference, i.amount, i.currency, t.name workspace FROM invoices i JOIN tenants t ON t.id=i.tenant_id WHERE i.provider_invoice_id LIKE 'local-%' AND NOT EXISTS(SELECT 1 FROM payment_submissions s WHERE 'local-' || s.id = i.provider_invoice_id AND s.status='approved')").all(), 'No orphan invoices');
  add('amounts-match', 'Invoice amounts equal the approved payment amounts', 'error',
    db.prepare("SELECT s.id, s.reference, s.amount payment_amount, i.amount invoice_amount, t.name workspace FROM payment_submissions s JOIN invoices i ON i.provider_invoice_id='local-' || s.id JOIN tenants t ON t.id=s.tenant_id WHERE s.amount<>i.amount OR s.currency<>i.currency").all(), 'All amounts match');
  const today = localDay();
  add('active-period', 'Active subscriptions have a valid plan and paid-until date', 'warning',
    listTenants().filter((t) => !t.is_legacy && t.status === 'active' && t.subscription_status === 'active' && (!PLANS[t.plan] || !t.current_period_end || t.current_period_end < today))
      .map((t) => ({ workspace: t.name, plan: t.plan, paid_until: t.current_period_end || null, problem: !PLANS[t.plan] ? 'Unknown plan' : !t.current_period_end ? 'No paid-until date' : 'Paid-until date has passed but still marked active' })), 'All consistent');
  add('paid-has-history', 'Paying workspaces have a subscription history entry', 'warning',
    db.prepare("SELECT t.name workspace, t.plan, t.subscription_status FROM tenants t WHERE t.is_legacy=0 AND t.subscription_status='active' AND NOT EXISTS(SELECT 1 FROM subscription_history h WHERE h.tenant_id=t.id)").all(),
    'Every paying workspace has history (workspaces paid before the upgrade may show here once)');
  add('db-files', 'Every workspace database file exists', 'error', listTenants().filter((t) => !fs.existsSync(t.db_path)).map((t) => ({ workspace: t.name, slug: t.slug })), 'All present');
  const totals = db.prepare("SELECT currency, SUM(amount) total, COUNT(*) n FROM invoices WHERE status='paid' GROUP BY currency").all();
  return { checked_at: new Date().toISOString(), ok: checks.every((c) => c.state === 'ok'), checks, paid_totals: totals };
}
