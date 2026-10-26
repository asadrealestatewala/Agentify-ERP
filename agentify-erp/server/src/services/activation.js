// Tenant activation: a checklist worked out from the workspace's real data (not from opening a page), and the behaviour-driven
// onboarding e-mails sent to the owner. These are Agentify's own mail (service category: never counted in a tenant allowance).
//
//   * A step is recorded the first time real data shows it done and then stays done.
//   * Each onboarding mail is sent at most once, only when it still helps (completed steps are skipped), only inside the
//     owner's local sending hours, within a weekly frequency cap, and never to an owner who switched them off.
//   * Trial reminders / expiry live in lifecycle.js and are relative to the real expiry date; paid activation here states the
//     actual package. Nothing here states a metric that was not counted.
import { platformDb, listTenants, withTenant, isMultiTenant, BASE_DOMAIN } from '../platform.js';
import { all, get, run, getSetting } from '../db.js';
import { PLANS, PLAN_SETTINGS, PRODUCTS } from './plans.js';
import { sendMail, layout } from './mailer.js';
import { getSetting as pGet, setSetting as pSet } from './platformConfig.js';
import { listSenders } from './emailSenders.js';
import { limitsFor } from './tenantEmail.js';
import { bad } from '../util.js';

export const STEPS = [
  { id: 'verify_account', label: 'Verify your email address', hint: 'Confirm the link we sent so you can invite others and publish.', link: '/settings/security' },
  { id: 'business_details', label: 'Complete your business details', hint: 'Company name, phone or email, and address appear on documents and emails.', link: '/settings' },
  { id: 'sender_identity', label: 'Set up your sender address', hint: 'Verify your domain so follow-up emails come from your own address.', link: '/settings/email' },
  { id: 'first_lead', label: 'Add or import your first lead', hint: 'Add one by hand or import a list.', link: '/contacts' },
  { id: 'invite_team', label: 'Invite a team member', hint: 'Give an agent a login so leads can be shared.', link: '/settings/users' },
  { id: 'first_followup', label: 'Create your first follow-up', hint: 'Set a follow-up date or task on a lead.', link: '/tasks' },
  { id: 'activate_sequence', label: 'Activate a follow-up sequence', hint: 'Let a sequence nudge new enquiries automatically.', link: '/sequences' },
];

const tbl = (name) => !!get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", name);
const has = (sql, ...p) => !!get(sql, ...p);

/** Evaluate every step from current data. Pure reads of this workspace (and the control-plane sender list). */
export function evaluateSteps(tenant) {
  const owner = get('SELECT email_verified FROM users WHERE lower(email)=lower(?)', tenant.owner_email || '');
  const g = (k) => String(getSetting(k) || '').trim();
  const planSeats = PLANS[tenant.plan]?.seats;
  const out = {
    verify_account: { done: !owner || owner.email_verified === 1 },
    business_details: { done: !!(g('company_name') && (g('company_phone') || g('company_email') || g('print_phone') || g('print_email')) && (g('company_address') || g('print_address'))) },
    sender_identity: { done: listSenders(tenant.id).some((s) => s.can_send) },
    first_lead: { done: has('SELECT 1 FROM contacts WHERE is_demo=0 LIMIT 1') },
    invite_team: { done: (get("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0").n || 0) > 1, applicable: planSeats == null || planSeats > 1 },
    first_followup: { done: has("SELECT 1 FROM tasks WHERE entity_type='contact' LIMIT 1") || has('SELECT 1 FROM contacts WHERE followup_date IS NOT NULL LIMIT 1') },
    activate_sequence: tbl('sequences') ? { done: has("SELECT 1 FROM sequences WHERE status='active' LIMIT 1"), applicable: true } : { done: false, applicable: false },
  };
  return out;
}

/** Record newly completed steps and return the checklist. Safe to call often. */
export function activationStatus(tenant) {
  const now = evaluateSteps(tenant);
  const saved = new Map(all('SELECT step, completed_at FROM activation_progress').map((r) => [r.step, r.completed_at]));
  for (const [id, s] of Object.entries(now)) if (s.done && !saved.has(id)) { run("INSERT OR IGNORE INTO activation_progress(step, source) VALUES(?, 'data')", id); saved.set(id, new Date().toISOString().slice(0, 19).replace('T', ' ')); }
  const steps = STEPS.map((st) => ({ ...st, applicable: now[st.id].applicable !== false, done: saved.has(st.id), completed_at: saved.get(st.id) || null }));
  const counted = steps.filter((s) => s.applicable);
  return { steps, done: counted.filter((s) => s.done).length, total: counted.length, next: counted.find((s) => !s.done) || null };
}

// ---------------------------------------------------------------- onboarding e-mails
export const ONBOARDING_DEFAULTS = {
  enabled: true, hours: [9, 18], max_per_week: 3, stale_hours: 48,
  messages: { welcome: { enabled: true }, day1: { enabled: true, day: 1 }, day3: { enabled: true, day: 3 }, day5: { enabled: true, day: 5 }, day7: { enabled: true, day: 7 }, day30: { enabled: true, day: 30 }, paid_activation: { enabled: true } },
};
export function onboardingConfig() {
  let saved = null; try { saved = JSON.parse(pGet('onboarding_email_config') || 'null'); } catch { /* defaults */ }
  const c = { ...ONBOARDING_DEFAULTS, ...(saved || {}), messages: { ...ONBOARDING_DEFAULTS.messages } };
  for (const [k, v] of Object.entries(saved?.messages || {})) if (c.messages[k]) c.messages[k] = { ...c.messages[k], ...v };
  return c;
}
export function saveOnboardingConfig(input, by) {
  const c = onboardingConfig();
  if (input.enabled !== undefined) c.enabled = !!input.enabled;
  if (input.hours !== undefined) {
    const [a, b] = (input.hours || []).map(Number);
    if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b <= 24 && a < b)) throw bad('Sending hours are two whole hours, start before end (for example 9 and 18)');
    c.hours = [a, b];
  }
  if (input.max_per_week !== undefined) { const n = Number(input.max_per_week); if (!(Number.isInteger(n) && n >= 1 && n <= 14)) throw bad('The weekly cap is 1 to 14 emails'); c.max_per_week = n; }
  for (const [k, v] of Object.entries(input.messages || {})) {
    if (!c.messages[k]) throw bad(`Unknown onboarding email: ${k}`);
    if (v.enabled !== undefined) c.messages[k].enabled = !!v.enabled;
    if (v.day !== undefined && c.messages[k].day !== undefined) { const n = Number(v.day); if (!(Number.isInteger(n) && n >= 1 && n <= 60)) throw bad('Day must be 1 to 60'); c.messages[k].day = n; }
  }
  pSet('onboarding_email_config', JSON.stringify(c), { by });
  return c;
}

const localHour = (ms, tz) => { try { return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz || 'UTC' }).format(new Date(ms))); } catch { return new Date(ms).getUTCHours(); } };
const DAY = 864e5;

/**
 * Decide which one onboarding mail (if any) is due now. Pure: no I/O, so every rule is testable.
 * ctx: { nowMs, tenant, status (activationStatus), config, sent:Set of refs, recentCount, ownerVerified, facts }
 */
export function nextOnboardingMail(ctx) {
  const { nowMs, tenant, status, config, sent, recentCount, ownerVerified } = ctx;
  if (!config.enabled) return null;
  const prefs = (() => { try { return JSON.parse(tenant.email_prefs || '{}'); } catch { return {}; } })();
  if (prefs.onboarding === false) return null;
  const created = Date.parse(String(tenant.created_at).replace(' ', 'T') + (String(tenant.created_at).includes('Z') ? '' : 'Z'));
  const age = nowMs - created;
  const sub = tenant.subscription_status || 'trialing';
  const paid = sub === 'active';
  const inWindow = (() => { const h = localHour(nowMs, tenant.timezone); return h >= config.hours[0] && h < config.hours[1]; })();
  const capped = recentCount >= config.max_per_week;
  const open = status.steps.filter((s) => s.applicable && !s.done);
  const cand = [];
  // paid activation is a billing confirmation: not subject to the window or the cap
  if (paid && config.messages.paid_activation.enabled && !sent.has(`paid:${tenant.plan}`)) return { kind: 'paid_activation', ref: `paid:${tenant.plan}`, exempt: true };
  if (!inWindow || capped) return null;
  if (config.messages.welcome.enabled && ownerVerified && !sent.has('welcome') && open.length) cand.push({ kind: 'welcome', ref: 'welcome', due: created });
  for (const key of ['day1', 'day3', 'day5', 'day7', 'day30']) {
    const m = config.messages[key];
    if (!m.enabled || sent.has(key)) continue;
    const due = created + m.day * DAY;
    if (nowMs < due) continue;
    if (nowMs > due + config.stale_hours * 3600e3) { cand.push({ kind: key, ref: key, skip: 'stale' }); continue; }
    // irrelevant once it no longer helps: the content below needs something still open (day 7 and 30 report facts instead)
    if (key === 'day1' && !open.length) { cand.push({ kind: key, ref: key, skip: 'nothing_to_do' }); continue; }
    if (key === 'day3' && (status.steps.find((s) => s.id === 'first_lead').done && status.steps.find((s) => s.id === 'first_followup').done)) { cand.push({ kind: key, ref: key, skip: 'nothing_to_do' }); continue; }
    const seq = status.steps.find((s) => s.id === 'activate_sequence');
    if (key === 'day5' && (!seq.applicable || seq.done)) { cand.push({ kind: key, ref: key, skip: 'nothing_to_do' }); continue; }
    if ((key === 'day7' || key === 'day30') && ['expired', 'canceled'].includes(sub)) { cand.push({ kind: key, ref: key, skip: 'inactive' }); continue; }
    cand.push({ kind: key, ref: key, due });
  }
  // skipped ones are recorded without sending; the first real one is sent (one mail per pass)
  return cand.find((c) => !c.skip) ? { ...cand.find((c) => !c.skip), skips: cand.filter((c) => c.skip) } : (cand.length ? { kind: null, skips: cand } : null);
}

const url = (t, path) => (isMultiTenant() ? `https://${t.custom_domain || `${t.slug}.${BASE_DOMAIN}`}${path}` : path);
const nonDemo = () => get('SELECT COUNT(*) n FROM contacts WHERE is_demo=0').n;

/** The facts a summary may state: counts taken from this workspace right now. Nothing estimated. */
function facts(tenant) {
  const q = platformDb().prepare("SELECT COUNT(*) n FROM email_queue WHERE tenant_id=? AND status IN ('accepted','delivered','bounced','complained')");
  let sent = 0; try { sent = q.get(tenant.id).n; } catch { /* queue table not created yet */ }
  return { leads: nonDemo(), tasks: get("SELECT COUNT(*) n FROM tasks WHERE entity_type='contact'").n, team: get("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0").n, emails: sent };
}

function build(kind, tenant, status) {
  const next = status.next;
  const name = tenant.name;
  const stepLine = next ? `Next step: ${next.label}. ${next.hint}` : null;
  const btn = (s) => ({ label: s ? s.label : 'Open your workspace', url: url(tenant, s ? s.link : '/') });
  switch (kind) {
    case 'welcome': return { subject: `${name} is verified. Here is where to start`, heading: 'Your account is verified', lines: [`Thank you for confirming your email. ${status.done} of ${status.total} setup steps are done.`, stepLine].filter(Boolean), button: btn(next) };
    case 'day1': return { subject: `${name}: your next setup step`, heading: 'Your next setup step', lines: [`${status.done} of ${status.total} setup steps are done.`, stepLine].filter(Boolean), button: btn(next) };
    case 'day3': {
      const lead = status.steps.find((s) => s.id === 'first_lead'), fu = status.steps.find((s) => s.id === 'first_followup');
      const s = !lead.done ? lead : fu;
      return { subject: `${name}: one useful thing to do today`, heading: s.label, lines: [s.hint], button: btn(s) };
    }
    case 'day5': return { subject: `${name}: let follow-ups run themselves`, heading: 'Automate your follow-ups', lines: ['A follow-up sequence sends your emails and creates tasks on a schedule, and pauses by itself when a customer replies.', 'Start from a ready-made template and edit it to suit your market.'], button: btn(status.steps.find((s) => s.id === 'activate_sequence')) };
    case 'day7': { const f = facts(tenant); return { subject: `${name}: your first week`, heading: 'Your first week', lines: [`Setup: ${status.done} of ${status.total} steps done.`, `In your workspace right now: ${f.leads} lead${f.leads === 1 ? '' : 's'}, ${f.tasks} follow-up task${f.tasks === 1 ? '' : 's'}, ${f.team} team member${f.team === 1 ? '' : 's'}.`, stepLine || 'Every setup step is done.', 'Reply to this email or open Help if you would like a hand.'].filter(Boolean), button: btn(next) }; }
    case 'day30': { const f = facts(tenant); return { subject: `${name}: 30 days in`, heading: 'Your first 30 days', lines: [`Setup: ${status.done} of ${status.total} steps done.`, `Leads in the CRM: ${f.leads}. Follow-up tasks created: ${f.tasks}. Team members: ${f.team}. Emails accepted by the provider: ${f.emails}.`, stepLine].filter(Boolean), button: btn(next) }; }
    default: return null;
  }
}

function paidMail(tenant) {
  const p = PLANS[tenant.plan];
  const lim = limitsFor(tenant);
  const lines = [`Your ${p?.name || tenant.plan} plan (${PRODUCTS[p?.product]?.short || tenant.product}) is active.`,
    `Included: ${p?.seats == null ? 'unlimited' : p.seats} users, ${p?.projects == null ? 'unlimited' : p.projects} projects, ${p?.properties == null ? 'unlimited' : p.properties} properties.`];
  const m = lim.unmetered ? null : ['operational', 'marketing'].filter((c) => lim.configured[c]).map((c) => `${lim.limits[c].monthly == null ? 'unlimited' : lim.limits[c].monthly} ${c} emails a month`);
  if (m?.length) lines.push(`Email allowance: ${m.join(', ')}.`);
  if (tenant.current_period_end) lines.push(`Paid until ${String(tenant.current_period_end).slice(0, 10)}.`);
  return { subject: `${tenant.name}: your plan is active`, heading: 'Your plan is active', lines, button: { label: 'Open Plan & Billing', url: url(tenant, '/settings/billing') } };
}

/** One pass over every workspace: refresh the checklist and send whichever onboarding mail is due. */
export async function runActivation({ nowMs = Date.now() } = {}) {
  const out = { checked: 0, sent: 0, skipped: 0 };
  const config = onboardingConfig();
  const pdb = platformDb();
  for (const t of listTenants()) {
    if (t.is_legacy || t.status !== 'active' || t.product === 'website' || !t.owner_email) continue;
    try {
      out.checked += 1;
      const { status, ownerVerified } = withTenant(t, () => ({ status: activationStatus(t), ownerVerified: evaluateSteps(t).verify_account.done }));
      const sent = new Set(pdb.prepare("SELECT ref FROM lifecycle_notices WHERE tenant_id=? AND kind='onb'").all(t.id).map((r) => r.ref));
      const recent = pdb.prepare("SELECT COUNT(*) n FROM lifecycle_notices WHERE tenant_id=? AND kind='onb' AND ref NOT LIKE 'skip:%' AND ref NOT LIKE 'paid:%' AND sent_at>=datetime(?, '-7 days')").get(t.id, new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ')).n;
      const pick = nextOnboardingMail({ nowMs, tenant: t, status, config, sent, recentCount: recent, ownerVerified });
      if (!pick) continue;
      for (const s of pick.skips || []) { pdb.prepare("INSERT OR IGNORE INTO lifecycle_notices(tenant_id,kind,ref) VALUES(?,?,?)").run(t.id, 'onb', s.ref); out.skipped += 1; }
      if (!pick.kind) continue;
      if (!pdb.prepare("INSERT OR IGNORE INTO lifecycle_notices(tenant_id,kind,ref) VALUES(?,?,?)").run(t.id, 'onb', pick.ref).changes) continue;
      const m = pick.kind === 'paid_activation' ? paidMail(t) : withTenant(t, () => build(pick.kind, t, status));
      if (!m) continue;
      await sendMail({ type: 'onboarding', to: t.owner_email, workspaceId: t.id, subject: m.subject, ...layout({ brand: 'platform', heading: m.heading, lines: m.lines, button: m.button }) });
      out.sent += 1;
    } catch (e) { console.error(`[activation ${t.slug}]`, e.message); }
  }
  return out;
}
