// Revenue and subscription figures for the super admin console, computed from billing records only.
// Formulas (also in docs/BILLING.md):
//
//   MRR (monthly recurring revenue, per currency)
//       sum over workspaces whose subscription is `active` of the recurring price they pay per period
//       (tenants.price_amount: after coupons, without the one-time setup fee), yearly prices / 12.
//       Excluded: trials, pending, cancelled (no future renewal), expired, suspended/cancelled workspaces.
//       Past-due workspaces are shown separately as "MRR at risk", not in MRR.
//   ARR (run-rate)            = MRR x 12. A forward-looking run-rate, NOT recognised accounting revenue.
//   Invoiced (billed)         = invoices raised in the period, any status.
//   Collected (gross cash)    = paid invoices in the period (by payment date), including setup fees.
//   Refunds                   = refunds recorded in the period.
//   Net collections           = collected - refunds.
//   Recognised revenue        = each paid invoice spread evenly over its service period (period_start..period_end),
//                               the part falling inside the range; one-time amounts (setup fees) on the payment date;
//                               refunds deducted on the refund date.
//   Outstanding               = payments customers reported that are waiting for confirmation, plus the recurring
//                               price of past-due workspaces (what is owed but not collected).
//   Failed payments           = provider payment failures + rejected bank/wallet submissions in the period.
// Currencies are never added together: every money figure is a map { PKR: n, USD: n }.
// Taxes: prices are tax-inclusive; no tax is split out until a tax rule exists. Discounts reduce the price paid.
import { platformDb, listTenants } from '../platform.js';
import { PLANS, PRODUCTS, billingState, perMonth, intervalMonths } from './plans.js';
import { resolveRange, utcStart, addDays, localToday } from './platformMetrics.js';
import { bad } from '../util.js';

const pdb = () => platformDb();
const add = (m, c, n) => { if (n) m[c] = (m[c] || 0) + n; return m; };
const DAY = 864e5;
const dms = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);

/** Monthly recurring value of one workspace, or null. */
export function monthlyValue(t) {
  if (t.price_amount != null) return { currency: t.price_currency || 'PKR', amount: perMonth(t.price_amount, t.billing_interval) };
  const p = PLANS[t.plan];
  const cur = p && [t.currency, 'PKR'].find((c) => p.price?.[c]);
  if (!cur) return null;
  return { currency: cur, amount: (t.billing_interval === 'year' || t.billing_interval === 'half') ? perMonth(p.price[cur][t.billing_interval] ?? p.price[cur].month * intervalMonths(t.billing_interval), t.billing_interval) : p.price[cur].month };
}

const FILTER_KEYS = ['product', 'plan', 'status', 'currency', 'tenant'];
/** Which workspaces a set of console filters selects. */
export function filterTenants(f = {}) {
  for (const k of Object.keys(f)) if (FILTER_KEYS.includes(k) && f[k] && String(f[k]).length > 60) throw bad(`Filter ${k} is too long`);
  return listTenants().filter((t) => {
    if (t.is_legacy) return false;
    if (f.product && !(t.product === f.product || (f.product !== 'bundle' && PLANS[t.plan]?.product === 'bundle' && t.subscription_status === 'active'))) return false;
    if (f.plan && t.plan !== f.plan) return false;
    if (f.status) { const st = billingState(t).status; if (st !== f.status && t.subscription_status !== f.status) return false; }
    if (f.tenant && String(t.id) !== String(f.tenant) && t.slug !== f.tenant) return false;
    if (f.currency && t.price_currency && t.price_currency !== f.currency) return false;
    return true;
  });
}

/** Recognised part of one paid invoice inside [from, to] (inclusive local days, as UTC dates). */
export function recognisedIn(inv, from, to) {
  const oneTime = Math.min(inv.amount, inv.one_time_amount || 0);
  const recurring = inv.amount - oneTime;
  const paidDay = String(inv.created_at).slice(0, 10);
  let out = paidDay >= from && paidDay <= to ? oneTime : 0;
  if (!inv.period_start || !inv.period_end || inv.period_end <= inv.period_start) return out + (paidDay >= from && paidDay <= to ? recurring : 0);
  const a = dms(inv.period_start), b = dms(inv.period_end); // service days [a, b)
  const lo = Math.max(a, dms(from)), hi = Math.min(b, dms(to) + DAY);
  if (hi > lo) out += Math.round((recurring * (hi - lo)) / (b - a));
  return out;
}

export function finance(q = {}) {
  const r = resolveRange(q);
  const tenants = filterTenants(q);
  const ids = new Set(tenants.map((t) => t.id));
  const inSet = (id) => ids.has(id);
  const curOk = (c) => !q.currency || c === q.currency;
  const a = utcStart(r.from), b = utcStart(addDays(r.to, 1));

  const mrr = {}, atRisk = {}, byProduct = {}, byPlan = {};
  const counts = { trialing: 0, active: 0, past_due: 0, canceled: 0, expired: 0, pending: 0, suspended: 0 };
  for (const t of tenants) {
    const st = billingState(t);
    counts[st.status] = (counts[st.status] || 0) + 1;
    const prodKey = PLANS[t.plan]?.product && !['trialing', 'pending'].includes(t.subscription_status) ? PLANS[t.plan].product : t.product || 'real_estate';
    const pk = (byProduct[prodKey] ||= { workspaces: 0, paying: 0, trialing: 0, mrr: {} });
    pk.workspaces += 1;
    if (st.status === 'trialing' && !st.locked) pk.trialing += 1;
    const v = monthlyValue(t);
    if (st.status === 'active' && v && curOk(v.currency)) {
      add(mrr, v.currency, v.amount); add(pk.mrr, v.currency, v.amount); pk.paying += 1;
      const pl = (byPlan[t.plan] ||= { plan: t.plan, name: PLANS[t.plan]?.name || t.plan, product: PLANS[t.plan]?.product || null, subscribers: 0, mrr: {} });
      pl.subscribers += 1; add(pl.mrr, v.currency, v.amount);
    }
    if (st.status === 'past_due' && v && curOk(v.currency)) add(atRisk, v.currency, v.amount);
  }
  const arr = Object.fromEntries(Object.entries(mrr).map(([c, n]) => [c, n * 12]));

  const invoices = pdb().prepare('SELECT * FROM invoices WHERE created_at>=? AND created_at<?').all(a, b).filter((i) => inSet(i.tenant_id) && curOk(i.currency));
  const invoiced = {}, collected = {}, setupFees = {};
  for (const i of invoices) { add(invoiced, i.currency, i.amount); if (i.status === 'paid') { add(collected, i.currency, i.amount); add(setupFees, i.currency, Math.min(i.amount, i.one_time_amount || 0)); } }
  const refundRows = pdb().prepare('SELECT * FROM refunds WHERE created_at>=? AND created_at<?').all(a, b).filter((x) => inSet(x.tenant_id) && curOk(x.currency));
  const refunds = {}; for (const x of refundRows) add(refunds, x.currency, x.amount);
  const net = {}; for (const c of new Set([...Object.keys(collected), ...Object.keys(refunds)])) net[c] = (collected[c] || 0) - (refunds[c] || 0);

  // recognised revenue: every paid invoice whose service period or payment touches the range
  const recognised = {};
  for (const i of pdb().prepare("SELECT * FROM invoices WHERE status='paid' AND (created_at<? ) AND (period_end IS NULL OR period_end>=? OR created_at>=?)").all(b, r.from, a)) {
    if (!inSet(i.tenant_id) || !curOk(i.currency)) continue;
    add(recognised, i.currency, recognisedIn(i, r.from, r.to));
  }
  for (const x of refundRows) add(recognised, x.currency, -x.amount);

  const pendingSubs = pdb().prepare("SELECT tenant_id, amount, currency FROM payment_submissions WHERE status='pending'").all().filter((s) => inSet(s.tenant_id) && curOk(s.currency));
  const outstanding = {}; for (const s of pendingSubs) add(outstanding, s.currency, s.amount);
  for (const [c, n] of Object.entries(atRisk)) add(outstanding, c, n);

  const failed = pdb().prepare("SELECT tenant_id FROM billing_events WHERE type='payment.failed' AND created_at>=? AND created_at<?").all(a, b).filter((x) => inSet(x.tenant_id)).length
    + pdb().prepare("SELECT tenant_id FROM payment_submissions WHERE status='rejected' AND decided_at>=? AND decided_at<?").all(a, b).filter((x) => inSet(x.tenant_id)).length;

  // movement in the period from subscription history
  const hist = pdb().prepare('SELECT * FROM subscription_history WHERE created_at>=? AND created_at<? ORDER BY id').all(a, b).filter((h) => inSet(h.tenant_id));
  const firstPaid = new Map(pdb().prepare("SELECT tenant_id, MIN(created_at) first FROM invoices WHERE status='paid' GROUP BY tenant_id").all().map((x) => [x.tenant_id, x.first]));
  const newSubs = [...firstPaid].filter(([id, d]) => inSet(id) && d >= a && d < b).length;
  const renewals = invoices.filter((i) => i.status === 'paid' && firstPaid.get(i.tenant_id) && firstPaid.get(i.tenant_id) < i.created_at).length;
  const churned = new Set(hist.filter((h) => h.to_status === 'canceled' || (h.to_status === 'expired' && h.from_status !== 'trialing' && h.from_status !== 'pending')).map((h) => h.tenant_id)).size;
  const upgrades = hist.filter((h) => h.from_plan && h.to_plan && h.from_plan !== h.to_plan && PLANS[h.from_plan] && PLANS[h.to_plan] && (PLANS[h.to_plan].price?.PKR?.month || 0) > (PLANS[h.from_plan].price?.PKR?.month || 0)).length;
  const downgrades = hist.filter((h) => h.from_plan && h.to_plan && h.from_plan !== h.to_plan && PLANS[h.from_plan] && PLANS[h.to_plan] && (PLANS[h.to_plan].price?.PKR?.month || 0) < (PLANS[h.from_plan].price?.PKR?.month || 0)).length;
  // trial conversion: trials that ended in the range, and how many of those workspaces have paid
  const cohort = tenants.filter((t) => t.trial_ends_at && String(t.trial_ends_at).slice(0, 10) >= r.from && String(t.trial_ends_at).slice(0, 10) <= r.to);
  const converted = cohort.filter((t) => firstPaid.has(t.id)).length;

  // what needs attention next
  const today = localToday();
  const soon = addDays(today, 30), week = addDays(today, 7);
  const upcoming_renewals = tenants.filter((t) => t.subscription_status === 'active' && t.current_period_end && t.current_period_end >= today && t.current_period_end <= soon)
    .map((t) => ({ id: t.id, name: t.name, slug: t.slug, plan: t.plan, date: t.current_period_end, provider: t.billing_provider, value: monthlyValue(t) })).sort((x, y) => x.date.localeCompare(y.date));
  const expiring_trials = tenants.filter((t) => t.subscription_status === 'trialing' && t.trial_ends_at && String(t.trial_ends_at).slice(0, 10) >= today && String(t.trial_ends_at).slice(0, 10) <= week)
    .map((t) => ({ id: t.id, name: t.name, slug: t.slug, product: t.product, ends_at: t.trial_ends_at })).sort((x, y) => String(x.ends_at).localeCompare(String(y.ends_at)));
  const overdue = tenants.filter((t) => t.subscription_status === 'past_due').map((t) => ({ id: t.id, name: t.name, slug: t.slug, plan: t.plan, grace_until: t.grace_until, value: monthlyValue(t) }));

  return {
    range: r, filters: Object.fromEntries(FILTER_KEYS.filter((k) => q[k]).map((k) => [k, q[k]])), workspaces: tenants.length,
    money: { mrr, arr, mrr_at_risk: atRisk, invoiced, collected, setup_fees: setupFees, refunds, net_collections: net, recognised_revenue: recognised, outstanding },
    counts, failed_payments: failed,
    movement: { new_subscriptions: newSubs, renewals, churned, upgrades, downgrades, trial_cohort: cohort.length, trial_converted: converted, trial_conversion_rate: cohort.length ? Math.round((converted / cohort.length) * 1000) / 10 : null },
    by_product: Object.entries(byProduct).map(([product, v]) => ({ product, label: PRODUCTS[product]?.label || (product === 'bundle' ? 'Both products' : product), ...v })),
    by_plan: Object.values(byPlan).sort((x, y) => y.subscribers - x.subscribers),
    upcoming_renewals, expiring_trials, overdue,
    definitions: DEFINITIONS,
  };
}

export const DEFINITIONS = {
  mrr: 'Monthly recurring revenue: what active subscriptions pay per month (yearly / 12, after coupons, without setup fees). Trials, cancelled and past-due workspaces are not included.',
  arr: 'Annual run-rate: MRR x 12. Not recognised accounting revenue.',
  mrr_at_risk: 'Monthly value of past-due subscriptions (payment failed or renewal not paid yet).',
  invoiced: 'Invoices raised in the period, paid or not.',
  collected: 'Money received in the period (paid invoices, including setup fees).',
  refunds: 'Money returned to customers in the period.',
  net_collections: 'Collected minus refunds.',
  recognised_revenue: 'Paid invoices spread over the service period they cover; setup fees on the payment date; refunds deducted when made.',
  outstanding: 'Payments reported by customers and waiting for confirmation, plus the monthly value of past-due subscriptions.',
};
