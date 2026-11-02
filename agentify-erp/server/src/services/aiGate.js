// The gatekeeper for calls made with Agentify's OWN AI key. Runs inside aiGateway.js before every call and refuses with a plain
// message and a machine code. Checks, in this order:
//   1 master switch  2 feature switch  3 workspace switch  4 daily limit per workspace  5 monthly budget  6 video budget and Creative Studio credits
// A refused attempt is not charged and not logged as usage. A check happens before the call starts, so a call that has begun is
// never cut off: the call that crosses the budget finishes and the next one is refused. Workspaces using their OWN key are
// governed by assertAiAllowed in aiUsage.js and are not touched here.
import { platformDb } from '../platform.js';
import { getSetting } from './platformConfig.js';
import { AI_FEATURES, flag, featuresOff, dayStart, monthStartOf } from './aiUsage.js';
import { bad } from '../util.js';

export const DEFAULT_DAILY_LIMIT = 300;
const db = () => platformDb();
const numSetting = (k) => { const v = getSetting(k); return v == null || v === '' ? null : Number(v); };
/** The on/off switch a feature is listed under (both voices share one switch). */
export const switchKey = (feature) => (feature.startsWith('video_voice') ? 'video_voice' : feature);
const refuse = (code, msg, extra = {}) => bad(msg, { code, ...extra });

export const budgetUsd = () => numSetting('ai_budget_usd_month') ?? ((getSetting('ai_money_label') || 'USD').toUpperCase() === 'USD' ? numSetting('ai_budget_month') : null);
export const videoBudgetUsd = () => numSetting('ai_video_budget_usd_month');
export const platformDailyLimit = (tenantId) => {
  const ws = tenantId ? db().prepare('SELECT platform_daily_limit FROM workspace_ai_settings WHERE tenant_id=?').get(tenantId) : null;
  return ws?.platform_daily_limit ?? numSetting('ai_platform_daily_limit') ?? DEFAULT_DAILY_LIMIT;
};
export const defaultMonthlyCredits = () => numSetting('ai_default_monthly_credits');

export function spentUsd({ feature = null, now = new Date() } = {}) {
  const since = monthStartOf(now);
  return feature
    ? db().prepare("SELECT COALESCE(SUM(usd),0) s FROM ai_usage WHERE key_owner='platform' AND feature=? AND at>=?").get(feature, since).s
    : db().prepare("SELECT COALESCE(SUM(usd),0) s FROM ai_usage WHERE key_owner='platform' AND at>=?").get(since).s;
}
export const usesToday = (tenantId, now = new Date()) => db().prepare("SELECT COUNT(*) n FROM ai_usage WHERE key_owner='platform' AND tenant_id=? AND at>=?").get(tenantId, dayStart(now)).n;

/** Credits a workspace may spend this month (allowance + any top-up made this month), or null for no limit. */
export function creditsAllowance(tenantId, now = new Date()) {
  const r = db().prepare('SELECT monthly_credits, topup_credits, topup_month FROM ai_tenant_credits WHERE tenant_id=?').get(tenantId);
  const base = r?.monthly_credits ?? defaultMonthlyCredits();
  if (base == null) return null;
  return base + (r && r.topup_month === now.toISOString().slice(0, 7) ? r.topup_credits : 0);
}
export const creditsUsed = (tenantId, now = new Date()) => db().prepare("SELECT COALESCE(SUM(credits),0) s FROM ai_usage WHERE key_owner='platform' AND tenant_id=? AND at>=?").get(tenantId, monthStartOf(now)).s;
export const creditsLeft = (tenantId, now = new Date()) => { const a = creditsAllowance(tenantId, now); return a == null ? null : Math.max(0, a - creditsUsed(tenantId, now)); };

/** Console: set a workspace's monthly credits (null = platform default) and/or add a top-up for the current month. */
export function setCredits(tenantId, { monthly_credits, add_topup }, by, now = new Date()) {
  if (!db().prepare('SELECT 1 FROM tenants WHERE id=?').get(Number(tenantId))) throw bad('Workspace not found');
  const whole = (v, label) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw bad(`${label} must be a whole number of credits from 0 to 10,000,000`); return n; };
  const prev = db().prepare('SELECT * FROM ai_tenant_credits WHERE tenant_id=?').get(Number(tenantId));
  const month = now.toISOString().slice(0, 7);
  const monthly = monthly_credits === undefined ? (prev?.monthly_credits ?? null) : monthly_credits === '' || monthly_credits === null ? null : whole(monthly_credits, 'Monthly credits');
  let top = prev && prev.topup_month === month ? prev.topup_credits : 0;
  if (add_topup !== undefined && add_topup !== '') top += whole(add_topup, 'The top-up');
  db().prepare(`INSERT INTO ai_tenant_credits(tenant_id, monthly_credits, topup_credits, topup_month, updated_by, updated_at) VALUES(?,?,?,?,?,datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET monthly_credits=excluded.monthly_credits, topup_credits=excluded.topup_credits, topup_month=excluded.topup_month, updated_by=excluded.updated_by, updated_at=datetime('now')`)
    .run(Number(tenantId), monthly, top, month, by || null);
  return { monthly_credits: monthly, topup_credits: top, left: creditsLeft(Number(tenantId), now) };
}

/**
 * Throws when this platform-key call may not start. tenantId is null for the console's own calls (workspace checks are skipped).
 * credits: what this use will cost a workspace in Creative Studio credits (0 for features that do not use credits).
 */
export function assertPlatformAllowed({ feature, tenantId = null, credits = 0, now = new Date() }) {
  const sw = switchKey(feature), label = AI_FEATURES[sw] || 'This AI feature';
  if (flag('ai_kill_switch')) throw refuse('ai_off', 'AI is switched off for everyone right now. Please try again later.');
  if (featuresOff().includes(sw)) throw refuse('feature_off', `${label} is switched off at the moment.`);
  if (tenantId) {
    const ws = db().prepare('SELECT ai_enabled FROM workspace_ai_settings WHERE tenant_id=?').get(tenantId);
    if (ws && !ws.ai_enabled) throw refuse('tenant_off', 'AI is switched off for this workspace. Contact Agentify support to switch it back on.');
    const limit = platformDailyLimit(tenantId);
    if (limit != null && usesToday(tenantId, now) >= limit) throw refuse('daily_limit', `This workspace has used its ${limit} AI uses for today. It resets tomorrow (midnight UTC).`, { limit });
  }
  const budget = budgetUsd();
  if (budget != null && spentUsd({ now }) >= budget) throw refuse('budget_reached', 'AI is paused for everyone because this month\'s AI budget is used up. It starts again on the 1st or when the budget is raised. The rest of the app keeps working.');
  if (feature === 'creative_video') {
    const vb = videoBudgetUsd();
    if (vb != null && spentUsd({ feature: 'creative_video', now }) >= vb) throw refuse('video_budget_reached', 'Video creation is paused for this month because the video budget is used up. Images and text still work.');
  }
  if (tenantId && credits > 0) {
    const left = creditsLeft(tenantId, now);
    if (left != null && left < credits) throw refuse('no_credits', `This needs ${credits} credits but your workspace has ${left} left this month. Ask Agentify support to top up.`, { needed: credits, left });
  }
}
