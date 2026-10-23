// Subscription lifecycle job: runs hourly from the server (and on demand with `npm run platform:lifecycle`).
// It makes the stored state match the dates even when nobody signs in, and sends each reminder exactly once.
//
//   trialing, trial end passed                    -> expired   (history row, owner emailed, workspace admins notified)
//   trialing, N days before the end               -> reminder  (N from the console setting, default 3, 1 and 0 = "ends today")
//   active, billed by hand (local / manual) and
//     the paid period ended                       -> past_due with the plan's grace days (Stripe renews by itself)
//   active, N days before a manual renewal        -> renewal reminder (default 7, 3 and 1 days)
//   past_due, grace period over                   -> expired
//   canceled, paid period over                    -> expired
// Everything is idempotent: a state only moves forward once and lifecycle_notices stops a reminder being sent twice.
// "Expired" is read-only access: nothing is ever deleted.
import { platformDb, listTenants, getTenant, withTenant, logTenantEvent, BASE_DOMAIN, isMultiTenant } from '../platform.js';
import { PLANS, PLAN_SETTINGS, PRODUCTS, graceDays, ended } from './plans.js';
import { recordSubscriptionChange } from './subscriptions.js';
import { sendMail, layout } from './mailer.js';
import { all } from '../db.js';
import { notify } from '../audit.js';
import { flagEligible } from './retention.js';

const pdb = () => platformDb();
const day = (v) => String(v || '').slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const STRIPE_RENEWS = new Set(['stripe', 'generic']);

const billingUrl = (t) => (isMultiTenant() ? `https://${t.custom_domain || `${t.slug}.${BASE_DOMAIN}`}/settings/billing` : '/settings/billing');

/** Record that a notice went out; false when it was already sent (so the caller skips it). */
const claim = (tenantId, kind, ref) => pdb().prepare('INSERT OR IGNORE INTO lifecycle_notices(tenant_id,kind,ref) VALUES(?,?,?)').run(tenantId, kind, String(ref)).changes > 0;

function transition(t, fields, reason) {
  const keys = Object.keys(fields);
  const db = pdb();
  db.exec('BEGIN IMMEDIATE');
  try {
    // only move if nothing changed the row since we read it (a payment can arrive in between)
    const cur = getTenant(t.id);
    if (cur.subscription_status !== t.subscription_status) { db.exec('ROLLBACK'); return false; }
    db.prepare(`UPDATE tenants SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => fields[k]), t.id);
    recordSubscriptionChange(t, getTenant(t.id), { source: 'system', actor: 'lifecycle', reason }, db);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  logTenantEvent(t.id, `lifecycle:${fields.subscription_status || 'update'}`, { reason });
  return true;
}

/** Email the owner and put an in-app notification in front of the workspace's admins. */
async function tell(t, { subject, heading, lines, dedupe }) {
  const url = billingUrl(t);
  if (t.owner_email) await withTenant(t, () => sendMail({ type: 'billing_notice', to: t.owner_email, subject, ...layout({ heading, lines, button: { label: 'Open Plan & Billing', url } }) }));
  try {
    withTenant(t, () => {
      const admins = all("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 AND r.name IN ('Super Admin','Admin')").map((r) => r.id);
      notify(admins, 'billing', heading, lines[0], '/settings/billing', { dedupe: `lifecycle:${dedupe}` });
    });
  } catch (e) { console.error(`[lifecycle ${t.slug}] notify`, e.message); }
}

const product = (t) => PRODUCTS[t.product]?.label || 'Agentify ERP';

/** One pass over every billed workspace. Returns what it did (for logs, the console and tests). */
export async function runLifecycle({ now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const out = { expired_trials: 0, trial_reminders: 0, renewals_due: 0, renewal_reminders: 0, grace_expired: 0, canceled_expired: 0, errors: [] };
  for (const t of listTenants()) {
    if (t.is_legacy || t.status !== 'active') continue;
    try {
      const sub = t.subscription_status || 'trialing';
      if (sub === 'trialing' && t.trial_ends_at) {
        if (ended(t.trial_ends_at, now, today)) {
          if (transition(t, { subscription_status: 'expired' }, 'Trial ended')) {
            out.expired_trials += 1;
            if (claim(t.id, 'trial-ended', day(t.trial_ends_at))) await tell(t, { dedupe: `trial-ended:${day(t.trial_ends_at)}`, subject: `${t.name}: your free trial has ended`, heading: 'Your free trial has ended',
              lines: [`Your ${product(t)} trial ended on ${day(t.trial_ends_at)}. Your data is safe and you can still sign in, view and export it.`, 'Choose a plan to keep adding and editing records.'] });
          }
          continue;
        }
        const left = daysBetween(today, day(t.trial_ends_at));
        // the smallest configured reminder that applies, so a late first run does not send three emails at once
        const due = [...(PLAN_SETTINGS.trial_reminder_days || [])].sort((a, b) => a - b).find((d) => left <= d);
        if (due !== undefined) {
          const ref = `${day(t.trial_ends_at)}:${due}`;
          if (claim(t.id, 'trial-reminder', ref)) {
            // mark the larger reminders as done too (their moment has passed)
            for (const d of PLAN_SETTINGS.trial_reminder_days || []) if (d > due) claim(t.id, 'trial-reminder', `${day(t.trial_ends_at)}:${d}`);
            out.trial_reminders += 1;
            await tell(t, { dedupe: `trial:${ref}`, subject: `${t.name}: ${left <= 0 ? 'your trial ends today' : `${left} day${left === 1 ? '' : 's'} left in your trial`}`,
              heading: left <= 0 ? 'Your free trial ends today' : `${left} day${left === 1 ? '' : 's'} left in your free trial`,
              lines: [`Your ${product(t)} trial ends on ${day(t.trial_ends_at)} (UTC).`, 'Choose a plan before then to keep editing. If you do not, your workspace becomes read-only; nothing is deleted.'] });
          }
        }
        continue;
      }
      if (sub === 'active' && t.current_period_end && !STRIPE_RENEWS.has(t.billing_provider)) {
        const end = day(t.current_period_end);
        if (today > end) {
          const grace = addDays(end, graceDays(t.plan));
          if (transition(t, { subscription_status: 'past_due', grace_until: grace }, 'Renewal payment not received by the end of the paid period')) {
            out.renewals_due += 1;
            if (claim(t.id, 'renewal-due', end)) await tell(t, { dedupe: `renewal-due:${end}`, subject: `${t.name}: renewal payment due`, heading: 'Your renewal payment is due',
              lines: [`Your ${PLANS[t.plan]?.name || ''} plan period ended on ${end}. You keep full access until ${grace} while we wait for the payment.`, 'Pay from Plan & Billing to continue without interruption.'] });
          }
          continue;
        }
        const left = daysBetween(today, end);
        const due = [...(PLAN_SETTINGS.renewal_reminder_days || [])].sort((a, b) => a - b).find((d) => left <= d);
        if (due !== undefined && claim(t.id, 'renewal-reminder', `${end}:${due}`)) {
          for (const d of PLAN_SETTINGS.renewal_reminder_days || []) if (d > due) claim(t.id, 'renewal-reminder', `${end}:${d}`);
          out.renewal_reminders += 1;
          await tell(t, { dedupe: `renewal:${end}:${due}`, subject: `${t.name}: your plan renews on ${end}`, heading: `Your plan period ends on ${end}`,
            lines: [`Your ${PLANS[t.plan]?.name || ''} plan is paid until ${end}. Renew from Plan & Billing to keep full access.`] });
        }
        continue;
      }
      if (sub === 'past_due' && t.grace_until && today > day(t.grace_until)) {
        if (transition(t, { subscription_status: 'expired' }, 'Grace period ended without payment')) out.grace_expired += 1;
        continue;
      }
      if (sub === 'canceled' && (!t.current_period_end || today > day(t.current_period_end))) {
        if (transition(t, { subscription_status: 'expired' }, 'Cancelled subscription reached the end of its paid period')) out.canceled_expired += 1;
      }
    } catch (e) { out.errors.push({ tenant: t.slug, error: e.message }); console.error(`[lifecycle ${t.slug}]`, e); }
  }
  try { out.retention_flagged = flagEligible(); } catch (e) { out.errors.push({ tenant: '*', error: e.message }); }
  return out;
}
