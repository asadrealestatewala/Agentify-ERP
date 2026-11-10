// The margin view for the content tiers: what a workspace on each plan costs us against what it pays. Pure arithmetic over the plan
// table, the live AI price list (aiPricing.js) and a few cost inputs the owner keeps in the console (platform_settings `margin_settings`).
// Prices are treated as tax-inclusive: tax = price x t / (1 + t). Costs are worked in US dollars; local prices are converted at the editable rates.
import { getSetting, setSetting } from './platformConfig.js';
import { unitPrice } from './aiPricing.js';
import { REEL_CREDITS, CREDIT_COST } from './creativeStudio.js';
import { PLANS } from './plans.js';
import { getOffer, OFFER_CURRENCIES } from './launchOffer.js';
import { CURRENCIES } from './plansStore.js';
// values listed in CURRENCIES order (home market, USD, GBP, CAD, AED)
const byCur = (...v) => Object.fromEntries(CURRENCIES.map((c, i) => [c, v[i]]));
import { bad } from '../util.js';

export const DEFAULT_MARGIN = {
  vps_usd: 10, resend_usd: 20, resend_emails: 50000, storage_usd: 10, storage_gb: 350,
  paying_tenants: 25, typical_use_pct: 40, commission_pct: 4.5, sales_commission_pct: 20, payment_fee_pct: 3, target_multiple: 2, yearly_discount_pct: 15,
  fx: byCur(280, 1, 0.79, 1.37, 3.67), tax_pct: byCur(16, 0, 20, 5, 5),
  mix: { video: 60, voice: 10, image: 30 },
};
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
export function getMarginSettings() {
  const s = parse(getSetting('margin_settings')) || {};
  return { ...DEFAULT_MARGIN, ...s, fx: { ...DEFAULT_MARGIN.fx, ...(s.fx || {}) }, tax_pct: { ...DEFAULT_MARGIN.tax_pct, ...(s.tax_pct || {}) }, mix: { ...DEFAULT_MARGIN.mix, ...(s.mix || {}) } };
}
const num = (v, label, min, max) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} must be a number from ${min} to ${max}`); return n; };
export function saveMarginSettings(b, by) {
  const cur = getMarginSettings(), next = { ...cur, fx: { ...cur.fx }, tax_pct: { ...cur.tax_pct }, mix: { ...cur.mix } };
  const flat = { vps_usd: [0, 100000], resend_usd: [0, 100000], resend_emails: [1, 1e9], storage_usd: [0, 100000], storage_gb: [1, 1e7], paying_tenants: [1, 100000],
    typical_use_pct: [1, 100], commission_pct: [0, 50], sales_commission_pct: [0, 100], payment_fee_pct: [0, 20], target_multiple: [1, 20], yearly_discount_pct: [0, 60] };
  for (const [k, [lo, hi]] of Object.entries(flat)) if (b[k] !== undefined) next[k] = num(b[k], k.replaceAll('_', ' '), lo, hi);
  for (const c of OFFER_CURRENCIES) {
    if (b.fx?.[c] !== undefined) next.fx[c] = num(b.fx[c], `Exchange rate ${c}`, 0.0001, 100000);
    if (b.tax_pct?.[c] !== undefined) next.tax_pct[c] = num(b.tax_pct[c], `Tax ${c}`, 0, 50);
  }
  for (const k of ['video', 'voice', 'image']) if (b.mix?.[k] !== undefined) next.mix[k] = num(b.mix[k], `Credit mix ${k}`, 0, 100);
  if (next.mix.video + next.mix.voice + next.mix.image <= 0) throw bad('The credit mix cannot be all zero');
  next.fx.USD = 1;
  setSetting('margin_settings', JSON.stringify(next), { by });
  return getMarginSettings();
}

/** USD cost of one credit for each kind of use, from the live AI price list, and the blended figure for the chosen mix. */
export function creditCosts(m = getMarginSettings()) {
  const video = unitPrice('creative_video').usd / REEL_CREDITS.per_second;
  const voice = (unitPrice('video_voice_en').usd / 1000) * 100 / REEL_CREDITS.voice_per_100_chars;
  const image = unitPrice('creative_post').usd / CREDIT_COST.creative_post;
  const t = m.mix.video + m.mix.voice + m.mix.image;
  return { video, voice, image, blended: (video * m.mix.video + voice * m.mix.voice + image * m.mix.image) / t };
}

/** Cost, profit and margin of one price for one plan. `price` is in the currency's own units, per month. */
export function costOf({ plan, currency, price }, m = getMarginSettings(), cpc = creditCosts(m).blended) {
  const al = plan.allowances || {};
  const credits = al.credits?.[currency] ?? al.credits?.default ?? 0;
  const use = m.typical_use_pct / 100;
  const priceUsd = price / m.fx[currency];
  const gb = (plan.storage_mb ?? 0) / 1024;
  const ai = credits * cpc, storage = gb * (m.storage_usd / m.storage_gb), fixed = (m.vps_usd + m.resend_usd) / m.paying_tenants;
  const fees = priceUsd * (m.payment_fee_pct / 100), commission = priceUsd * (m.commission_pct / 100);
  const t = (m.tax_pct[currency] || 0) / 100, tax = priceUsd * t / (1 + t);
  const costFull = ai + storage + fixed + fees + commission + tax;
  const costTyp = ai * use + storage * use + fixed + fees + commission + tax;
  const flag = priceUsd < costFull ? 'red' : priceUsd / costFull < m.target_multiple ? 'orange' : 'ok';
  const r2 = (n) => Math.round(n * 100) / 100;
  // Sales-team view in the plan's own currency, per month: what the sales team earns, what we keep, the usage cost we carry, and the net.
  const sc = price * ((m.sales_commission_pct ?? 20) / 100), keptL = price - sc, usageL = (ai * use + storage * use) * m.fx[currency];
  return { sales_commission_local: r2(sc), kept_local: r2(keptL), usage_cost_local: r2(usageL), net_local: r2(keptL - usageL), price_usd: r2(priceUsd), credits, ai_full: r2(ai), ai_typical: r2(ai * use), storage_full: r2(storage), storage_typical: r2(storage * use), fixed: r2(fixed), fees: r2(fees), commission: r2(commission), tax: r2(tax),
    cost_full: r2(costFull), cost_typical: r2(costTyp), profit_full: r2(priceUsd - costFull), profit_typical: r2(priceUsd - costTyp),
    margin_full_pct: Math.round(((priceUsd - costFull) / priceUsd) * 100), margin_typical_pct: Math.round(((priceUsd - costTyp) / priceUsd) * 100),
    multiple_full: r2(priceUsd / costFull), flag };
}

/** Every content-tier plan x currency x (monthly, launch, yearly per month), with flags. Launch rows use the offer percentages even while the offer is off. */
export function marginReport(m = getMarginSettings()) {
  const cc = creditCosts(m), offer = getOffer(), rows = [];
  for (const [id, plan] of Object.entries(PLANS)) {
    if (!plan.allowances) continue;
    for (const cur of OFFER_CURRENCIES) {
      const mo = plan.price?.[cur]?.month, yr = plan.price?.[cur]?.year;
      if (mo == null) continue;
      const base = { plan: id, name: plan.name, currency: cur };
      rows.push({ ...base, kind: 'month', label: 'Monthly', price: mo, ...costOf({ plan, currency: cur, price: mo }, m, cc.blended) });
      const o = offer.countries[cur];
      if (plan.launch_offer && o?.percent > 0 && o.months > 0) { const lp = Math.round(mo * (1 - o.percent / 100)); rows.push({ ...base, kind: 'launch', label: `Launch (${o.percent}% off, ${o.months} mo)`, price: lp, ...costOf({ plan, currency: cur, price: lp }, m, cc.blended) }); }
      const hf = plan.price?.[cur]?.half;
      if (hf != null) { const per = Math.round(hf / 6); rows.push({ ...base, kind: 'half', label: '6 months (per month)', price: per, half_price: hf, ...costOf({ plan, currency: cur, price: per }, m, cc.blended) }); }
      if (yr != null) { const per = Math.round(yr / 12); rows.push({ ...base, kind: 'year', label: 'Yearly (per month)', price: per, yearly_price: yr, ...costOf({ plan, currency: cur, price: per }, m, cc.blended) }); }
    }
  }
  const fixedTotal = m.vps_usd + m.resend_usd;
  return { settings: m, credit_costs: cc, per_email_usd: m.resend_usd / m.resend_emails, fixed_per_tenant: Object.fromEntries([10, 25, 50].map((n) => [n, Math.round((fixedTotal / n) * 100) / 100])), rows,
    warnings: rows.filter((r) => r.flag !== 'ok').length };
}
