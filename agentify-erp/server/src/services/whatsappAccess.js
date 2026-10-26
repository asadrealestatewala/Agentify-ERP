// Entitlement for the WhatsApp inbox, resolved from the platform settings, the plan and the workspace override.
import { getSetting } from './platformConfig.js';
import { PLANS, PLAN_SETTINGS } from './plans.js';
import { mergeWhatsappLimits } from './whatsappLimits.js';
import { sendState } from './tenantEmail.js';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const planIdFor = (t) => ((t.subscription_status || 'trialing') === 'trialing' ? PLAN_SETTINGS.trial_plans?.[t.product === 'bundle' ? 'real_estate' : t.product] || PLAN_SETTINGS.trial_plan : t.plan);

export const platformEnabled = () => getSetting('whatsapp_enabled') === '1';
export const defaultLimits = () => parse(getSetting('whatsapp_default_limits'));

/** { enabled, reason, monthly, daily, source }. `reason` says why it is off, in a form the screen can translate. */
export function whatsappAccess(tenant) {
  if (!platformEnabled()) return { enabled: false, reason: 'platform_off', monthly: 0, daily: 0, source: 'platform' };
  const def = defaultLimits();
  if (!tenant) { const l = mergeWhatsappLimits(def); return { ...l, reason: l.enabled ? null : 'not_in_plan', source: 'platform_default' }; }
  const plan = PLANS[planIdFor(tenant)]?.whatsapp_limits || null;
  const own = parse(tenant.entitlements)?.whatsapp || null;
  const l = mergeWhatsappLimits(def, plan, own);
  const source = own ? 'workspace' : plan ? 'plan' : def ? 'platform_default' : 'none';
  if (!l.enabled) return { ...l, reason: 'not_in_plan', source };
  const st = sendState(tenant);
  if (!st.ok) return { ...l, enabled: false, reason: st.reason, source };
  return { ...l, reason: null, source };
}
export const REASON_TEXT = {
  platform_off: 'WhatsApp is not switched on for this platform yet.',
  not_in_plan: 'WhatsApp is not included in your plan. Ask support to add it.',
  workspace_suspended: 'This workspace is suspended.',
  subscription_inactive: 'Your subscription is not active.',
};
