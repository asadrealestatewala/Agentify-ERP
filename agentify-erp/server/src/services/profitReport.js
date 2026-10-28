// Cost and profit per workspace and plan (Super Admin console > Reports & Analytics > Cost & profit).
// Revenue is the finance report's recognised revenue (paid invoices spread over their service period, refunds deducted).
// Costs are what the owner enters plus AI usage recorded with Agentify's own key; there are no built-in cost numbers.
//   workspace profit = revenue - AI cost attributed to it - direct cost (plan's monthly cost x months in the range, active workspaces only)
//   net profit       = sum of workspace profit - AI used by Agentify itself (post drafts) - platform overhead x months
// Revenue arrives in each workspace's own currency and is converted with the latest manual rate in the Regions exchange-rate
// table; a currency without a rate is listed as unconverted and left out of profit rather than guessed.
import { platformDb, listTenants } from '../platform.js';
import { getSetting, setSetting } from './platformConfig.js';
import { PLANS } from './plans.js';
import { resolveRange, utcStart, addDays } from './platformMetrics.js';
import { recognisedIn } from './finance.js';
import { config as aiConfig, ensureTable } from './aiUsage.js';
import { bad } from '../util.js';

const pdb = () => platformDb();
const num = (k) => { const v = getSetting(k); return v == null || v === '' ? null : Number(v); };
export function costConfig() {
  let plans = {}; try { plans = JSON.parse(getSetting('cost_plan_month') || '{}'); } catch { /* none */ }
  return { currency: getSetting('profit_currency') || getSetting('ai_money_label') || 'USD', plan_month: plans, overhead_month: num('cost_overhead_month') };
}
export function saveCostConfig(b, by) {
  const money = (v, label) => { if (v === '' || v == null) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1e9) throw bad(`${label} must be a number of zero or more`); return n; };
  if ('currency' in b) { const c = String(b.currency || '').trim().toUpperCase(); if (c && !/^[A-Z]{3,6}$/.test(c)) throw bad('Use a currency code such as USD'); setSetting('profit_currency', c || null, { by }); }
  if ('overhead_month' in b) setSetting('cost_overhead_month', money(b.overhead_month, 'Platform overhead') == null ? null : String(money(b.overhead_month, 'Platform overhead')), { by });
  if (b.plan_month && typeof b.plan_month === 'object') {
    const out = {};
    for (const [plan, v] of Object.entries(b.plan_month)) { if (!PLANS[plan]) continue; const n = money(v, `Cost for ${plan}`); if (n != null) out[plan] = n; }
    setSetting('cost_plan_month', Object.keys(out).length ? JSON.stringify(out) : null, { by });
  }
  return costConfig();
}

/** Units of `to` for one unit of `from`, from the latest manual rate (either direction); null when none is stored. */
function rate(from, to) {
  if (from === to) return 1;
  const d = pdb().prepare('SELECT rate_ppm FROM fx_rates WHERE base=? AND quote=? ORDER BY as_of DESC LIMIT 1').get(from, to);
  if (d?.rate_ppm) return d.rate_ppm / 1e6;
  const i = pdb().prepare('SELECT rate_ppm FROM fx_rates WHERE base=? AND quote=? ORDER BY as_of DESC LIMIT 1').get(to, from);
  return i?.rate_ppm ? 1e6 / i.rate_ppm : null;
}
const priced = (inp, out, c) => (c.price_in == null || c.price_out == null ? null : (inp / 1e6) * c.price_in + (out / 1e6) * c.price_out);

export function profit(q = {}) {
  ensureTable();
  const r = resolveRange({ range: 'month', ...q });
  const cc = costConfig(), ai = aiConfig();
  const a = utcStart(r.from), b = utcStart(addDays(r.to, 1));
  const months = (Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`) + 864e5) / 864e5 / 30.4375;
  const aiSame = ai.currency === cc.currency; // AI prices are entered in the AI money label
  const tenants = listTenants().filter((t) => !t.is_legacy);
  const rows = new Map(tenants.map((t) => [t.id, { id: t.id, name: t.name, slug: t.slug, plan: t.plan, status: t.subscription_status, revenue: {}, revenue_converted: 0, unconverted: {}, ai_cost: aiSame ? 0 : null, ai_tokens: 0, direct_cost: null }]));
  const addMap = (m, c, n) => { if (n) m[c] = (m[c] || 0) + n; };
  const revenue = (row, cur, n) => { addMap(row.revenue, cur, n); const f = rate(cur, cc.currency); if (f == null) addMap(row.unconverted, cur, n); else row.revenue_converted += n * f; };

  for (const i of pdb().prepare("SELECT * FROM invoices WHERE status='paid' AND created_at<? AND (period_end IS NULL OR period_end>=? OR created_at>=?)").all(b, r.from, a)) {
    const row = rows.get(i.tenant_id); if (row) revenue(row, i.currency, recognisedIn(i, r.from, r.to));
  }
  for (const x of pdb().prepare('SELECT * FROM refunds WHERE created_at>=? AND created_at<?').all(a, b)) { const row = rows.get(x.tenant_id); if (row) revenue(row, x.currency, -x.amount); }

  // AI recorded with Agentify's own key, split into what is attributed to a workspace and what Agentify used itself
  let aiUnallocated = aiSame ? 0 : null, aiUnallocTokens = 0, aiTotalTokens = 0;
  const aiRows = pdb().prepare("SELECT tenant_id, COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o FROM ai_usage WHERE key_owner='platform' AND at>=? AND at<? GROUP BY tenant_id").all(`${a.replace(' ', 'T')}.000Z`, `${b.replace(' ', 'T')}.000Z`);
  for (const x of aiRows) {
    const c = aiSame ? priced(x.i, x.o, ai) : null;
    aiTotalTokens += x.i + x.o;
    const row = x.tenant_id ? rows.get(x.tenant_id) : null;
    if (row) { row.ai_tokens += x.i + x.o; if (c != null && row.ai_cost != null) row.ai_cost += c; else row.ai_cost = null; }
    else { aiUnallocTokens += x.i + x.o; if (c != null && aiUnallocated != null) aiUnallocated += c; else aiUnallocated = null; }
  }

  for (const row of rows.values()) {
    const per = cc.plan_month[row.plan];
    row.direct_cost = row.status === 'active' && per != null ? per * months : row.status === 'active' ? null : 0;
    const known = row.ai_cost != null && row.direct_cost != null && !Object.keys(row.unconverted).length;
    row.profit = known ? row.revenue_converted - row.ai_cost - row.direct_cost : null;
    row.margin = known && row.revenue_converted > 0 ? row.profit / row.revenue_converted : null;
  }
  const list = [...rows.values()].filter((x) => Object.keys(x.revenue).length || x.ai_tokens || x.status === 'active');
  const byPlan = {};
  for (const x of list) {
    const p = (byPlan[x.plan] ||= { plan: x.plan, plan_name: PLANS[x.plan]?.name || x.plan, workspaces: 0, revenue_converted: 0, ai_cost: 0, direct_cost: 0, unknown: 0, unconverted: {} });
    p.workspaces += 1; p.revenue_converted += x.revenue_converted;
    for (const [c, n] of Object.entries(x.unconverted)) addMap(p.unconverted, c, n);
    if (x.ai_cost == null || x.direct_cost == null) p.unknown += 1; else { p.ai_cost += x.ai_cost; p.direct_cost += x.direct_cost; }
  }
  for (const p of Object.values(byPlan)) { p.profit = p.unknown || Object.keys(p.unconverted).length ? null : p.revenue_converted - p.ai_cost - p.direct_cost; p.margin = p.profit != null && p.revenue_converted > 0 ? p.profit / p.revenue_converted : null; }

  const sum = (k) => list.reduce((s, x) => s + (x[k] || 0), 0);
  const missing = [];
  if (!aiSame) missing.push(`AI prices are in ${ai.currency} but profit is shown in ${cc.currency}. Set both to the same currency to include AI cost.`);
  else if (ai.price_in == null || ai.price_out == null) missing.push('Enter the Gemini prices under AI usage & credits to include AI cost.');
  const noCost = [...new Set(list.filter((x) => x.status === 'active' && cc.plan_month[x.plan] == null).map((x) => x.plan))];
  if (noCost.length) missing.push(`No monthly cost is set for: ${noCost.map((p) => PLANS[p]?.name || p).join(', ')}.`);
  const noRate = [...new Set(list.flatMap((x) => Object.keys(x.unconverted)))];
  if (noRate.length) missing.push(`No exchange rate to ${cc.currency} for ${noRate.join(', ')}. Add one under Regions > Exchange rates; that revenue is left out of profit.`);
  if (cc.overhead_month == null) missing.push('Platform overhead (servers and tools) is not set, so net profit leaves it out.');
  const complete = !missing.length && !list.some((x) => x.profit == null && (x.status === 'active' || Object.keys(x.revenue).length));
  const overhead = cc.overhead_month == null ? 0 : cc.overhead_month * months;
  const wsProfit = list.reduce((s, x) => s + (x.profit || 0), 0);
  const totals = { revenue: sum('revenue_converted'), ai_cost: list.reduce((s, x) => s + (x.ai_cost || 0), 0), direct_cost: list.reduce((s, x) => s + (x.direct_cost || 0), 0), ai_unallocated: aiUnallocated, ai_unallocated_tokens: aiUnallocTokens, overhead,
    workspace_profit: wsProfit, net_profit: wsProfit - (aiUnallocated || 0) - overhead, complete };
  return { range: { from: r.from, to: r.to, months: Math.round(months * 100) / 100 }, currency: cc.currency, config: cc, ai_currency: ai.currency, workspaces: list.sort((x, y) => y.revenue_converted - x.revenue_converted), plans: Object.values(byPlan).sort((x, y) => y.revenue_converted - x.revenue_converted), totals, missing,
    plan_options: Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name })),
    method: 'Revenue = recognised revenue (paid invoices spread over their service period, refunds deducted). Direct cost = the plan\'s monthly cost x months in the range, for active workspaces. Costs are your own figures, not provider invoices.' };
}
