// Tenant e-mail engine: durable queue, usage ledger and delivery worker. Control-plane tables (platform database) because
// one worker serves every workspace and quota must be enforced in one place.
//
// One row in email_queue is one recipient and is both the queue entry and the ledger line:
//   status       queued -> sending -> accepted -> delivered | bounced | complained     (or failed / suppressed / cancelled / ambiguous)
//   quota_state  reserved (counted, not yet sent) -> committed (provider accepted) | released (definitively not sent)
// Allowance used = rows whose quota_state is reserved or committed in the period. Campaigns are never counted: recipients are.
// A message the provider accepted stays committed even if it later bounces or is complained about: the tenant used the
// capacity. Delivery events never refund or re-charge; only definitive pre-send failures and opt-outs release a reservation.
import crypto from 'node:crypto';
import { platformDb, getTenant, withTenant, listTenants, BASE_DOMAIN, isMultiTenant } from '../platform.js';
import { PLANS, PLAN_SETTINGS } from './plans.js';
import { getSetting, setSetting } from './platformConfig.js';
import { emailProvider } from './emailProvider.js';
import { eligibility, suppress, lc, isAddress, unsubscribeUrl, fireOptOut } from './emailConsent.js';
import { resolveLimits, periodFor, reachedThresholds, METERED } from './emailLimits.js';
import { activeSenderFor } from './emailSenders.js';
import { sendMail, layout } from './mailer.js';
import { bad, HttpError } from '../util.js';
import { all as tAll, get as tGet } from '../db.js';
import { notify } from '../audit.js';
import { replyAddressFor, inboundDomain } from './emailInbound.js';

export const EMAIL_PLATFORM_SCHEMA = `
CREATE TABLE IF NOT EXISTS email_queue(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, category TEXT NOT NULL CHECK(category IN ('operational','marketing')),
  idem_key TEXT NOT NULL, to_addr TEXT NOT NULL, contact_id INTEGER, sender_id INTEGER, from_addr TEXT NOT NULL, reply_to TEXT, subject TEXT NOT NULL, text_body TEXT, html_body TEXT, headers TEXT,
  ref_kind TEXT, ref_id TEXT, status TEXT NOT NULL DEFAULT 'queued', quota_state TEXT NOT NULL DEFAULT 'reserved', period_key TEXT NOT NULL, day TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, provider_id TEXT, last_error TEXT, events TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), accepted_at TEXT, final_at TEXT, UNIQUE(tenant_id, idem_key));
CREATE INDEX IF NOT EXISTS idx_eq_due ON email_queue(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_eq_usage ON email_queue(tenant_id, category, period_key, quota_state);
CREATE INDEX IF NOT EXISTS idx_eq_day ON email_queue(tenant_id, category, day, quota_state);
CREATE INDEX IF NOT EXISTS idx_eq_provider ON email_queue(provider_id);
CREATE INDEX IF NOT EXISTS idx_eq_to ON email_queue(tenant_id, to_addr, status);
-- provider events that arrived before we knew the provider id of the message (replayed when it is recorded)
CREATE TABLE IF NOT EXISTS email_unmatched_events(id INTEGER PRIMARY KEY, provider_id TEXT NOT NULL, type TEXT NOT NULL, at TEXT, bounce_type TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_eue ON email_unmatched_events(provider_id);
-- extra messages granted to one workspace for one usage period (by a super admin; no price is attached here)
CREATE TABLE IF NOT EXISTS email_topups(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, category TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), period_key TEXT NOT NULL,
  note TEXT, granted_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;
let ready = false;
export const pdb = () => { const d = platformDb(); if (!ready || !d.__emailReady) { d.exec(EMAIL_PLATFORM_SCHEMA); d.__emailReady = true; ready = true; } return d; };
export const resetEmailSchemaFlag = () => { ready = false; };

const iso = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

/** BEGIN IMMEDIATE transaction on the platform database (the quota check and the reservation are one step). */
export function ptx(fn) {
  const d = pdb();
  d.exec('BEGIN IMMEDIATE');
  try { const r = fn(d); d.exec('COMMIT'); return r; } catch (e) { try { d.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
}

// ---------------------------------------------------------------- who may send, and how much
export function sendState(tenant) {
  if (!tenant) return { ok: false, reason: 'no_workspace' };
  if (tenant.status !== 'active') return { ok: false, reason: 'workspace_suspended' };
  if (tenant.product === 'website') return { ok: false, reason: 'not_in_plan' };
  if (tenant.is_legacy) return { ok: true };
  const sub = tenant.subscription_status || 'trialing';
  if (['expired', 'canceled', 'pending'].includes(sub)) return { ok: false, reason: 'subscription_inactive' };
  return { ok: true };
}
const planIdFor = (t) => ((t.subscription_status || 'trialing') === 'trialing' ? PLAN_SETTINGS.trial_plans?.[t.product === 'bundle' ? 'real_estate' : t.product] || PLAN_SETTINGS.trial_plan : t.plan);

/** Limits that apply to a workspace: platform default < plan < workspace override. `configured[cat]` is false when nobody set an allowance. */
export function limitsFor(tenant) {
  if (tenant.is_legacy) return { unmetered: true, limits: resolveLimits(), configured: { operational: true, marketing: true }, source: 'unmetered' };
  const def = parse(getSetting('email_default_limits'), null);
  const plan = PLANS[planIdFor(tenant)]?.email_limits || null;
  const own = parse(tenant.entitlements, null)?.email || null;
  const limits = resolveLimits(def, plan, own);
  const has = (c) => !!(own?.[c] || plan?.[c] || def?.[c]);
  return { unmetered: false, limits, configured: { operational: has('operational'), marketing: has('marketing') }, source: own ? 'workspace' : plan ? 'plan' : def ? 'platform_default' : 'none' };
}

export const anchorDay = (tenant) => String(tenant.created_at || new Date().toISOString()).slice(0, 10);
export const periodOf = (tenant, nowMs = Date.now()) => periodFor(anchorDay(tenant), nowMs);

export function usageOf(tenantId, category, period, day) {
  const d = pdb();
  const c = (q, ...p) => d.prepare(q).get(...p).n;
  const reserved = c("SELECT COUNT(*) n FROM email_queue WHERE tenant_id=? AND category=? AND period_key=? AND quota_state='reserved'", tenantId, category, period.key);
  const committed = c("SELECT COUNT(*) n FROM email_queue WHERE tenant_id=? AND category=? AND period_key=? AND quota_state='committed'", tenantId, category, period.key);
  const today = c("SELECT COUNT(*) n FROM email_queue WHERE tenant_id=? AND category=? AND day=? AND quota_state IN ('reserved','committed')", tenantId, category, day);
  const topup = d.prepare('SELECT COALESCE(SUM(amount),0) n FROM email_topups WHERE tenant_id=? AND category=? AND period_key=?').get(tenantId, category, period.key).n;
  return { reserved, committed, used: reserved + committed, today, topup };
}

/** What the workspace may do now, per category: allowance, used, remaining and the reason it is limited (if it is). */
export function allowanceSummary(tenant, nowMs = Date.now()) {
  const L = limitsFor(tenant), period = periodOf(tenant, nowMs), day = iso(nowMs).slice(0, 10);
  const out = { period: { start: period.start, resets_at: period.resets_at }, plan: tenant.plan, plan_name: PLANS[planIdFor(tenant)]?.name || null, unmetered: L.unmetered, hard_stop: L.limits.hard_stop, thresholds: L.limits.thresholds, topups_supported: !!L.limits.topups, send_state: sendState(tenant), categories: {} };
  for (const c of METERED) {
    const u = usageOf(tenant.id, c, period, day);
    const lim = L.limits[c];
    const monthly = lim?.monthly == null ? null : lim.monthly + u.topup;
    const row = { configured: L.configured[c], monthly_allowance: monthly, base_allowance: lim?.monthly ?? null, topup: u.topup, daily_limit: lim?.daily ?? null, used: u.used, reserved: u.reserved, committed: u.committed, today: u.today,
      remaining: monthly == null ? null : Math.max(0, monthly - u.used), percent: monthly ? Math.round((u.used * 100) / monthly) : null, state: 'ok', message: null };
    if (!out.send_state.ok) { row.state = 'paused'; row.message = PAUSE_TEXT[out.send_state.reason]; }
    else if (!row.configured && !L.unmetered) { row.state = 'not_configured'; row.message = PAUSE_TEXT.not_configured; }
    else if (L.limits.hard_stop && monthly != null && u.used >= monthly) { row.state = 'exhausted'; row.message = PAUSE_TEXT.monthly_exhausted; }
    else if (L.limits.hard_stop && lim?.daily != null && u.today >= lim.daily) { row.state = 'daily_limit'; row.message = PAUSE_TEXT.daily_exhausted; }
    else if (row.percent != null && row.percent >= (L.limits.thresholds[0] || 70)) { row.state = 'warning'; row.message = `You have used ${row.percent}% of this period's allowance.`; }
    out.categories[c] = row;
  }
  return out;
}
export const PAUSE_TEXT = {
  workspace_suspended: 'Sending is paused because this workspace is suspended.',
  subscription_inactive: 'Sending is paused because the subscription is not active. Renew your plan to resume.',
  not_in_plan: 'E-mail sending is not part of this workspace type.',
  not_configured: 'No e-mail allowance is set for your plan yet. Ask your administrator or Agentify support to enable it.',
  monthly_exhausted: 'The monthly allowance is used up. Sending resumes when the period resets, or when more capacity is added.',
  daily_exhausted: 'The daily sending limit is reached. Sending resumes tomorrow (UTC).',
  no_sender: 'Sending is paused until a verified sender address is set up (Settings, Email).',
  provider_capacity: 'Sending is delayed to protect capacity for account and security messages.',
};

// ---------------------------------------------------------------- composing
export function tenantBaseUrl(t) {
  if (t.custom_domain) return `https://${t.custom_domain}`;
  if (isMultiTenant()) return `https://${t.slug}.${BASE_DOMAIN}`;
  return (process.env.PUBLIC_URL || '').replace(/\/$/, '');
}
const fromHeader = (s) => `${String(s.display_name || '').replace(/["<>\r\n]/g, '').trim() ? `"${String(s.display_name).replace(/["<>\r\n]/g, '').trim()}" ` : ''}<${s.local_part}@${s.domain}>`;

/** Build the body (and the unsubscribe headers for marketing) with the workspace's own identity. */
export function compose({ category, heading, lines, button, footer, to, tenant }) {
  const base = tenantBaseUrl(tenant);
  const unsub = category === 'marketing' ? unsubscribeUrl(to, base) : null;
  const mail = layout({ brand: 'tenant', heading, lines, button, footer, unsubscribe: unsub ? { url: unsub, label: 'Unsubscribe' } : undefined });
  return { text: mail.text, html: mail.html, headers: unsub ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : null };
}

// ---------------------------------------------------------------- enqueue (reserve)
const fail = (code, message, status = 409) => Object.assign(new HttpError(status, message, { code }), { code });

/** Reserve quota and queue one message. Must run inside the workspace (withTenant): consent and suppression are read from it. */
export function enqueue({ tenant, category, to, subject, text, html, heading, lines, button, footer, headers, senderId, contactId = null, idemKey, replyTo, refKind = null, refId = null, sendAfterMs, trackReplies = false, nowMs = Date.now() }) {
  if (!METERED.includes(category)) throw bad('Tenant mail is operational or marketing. Account and security mail is sent by the platform.');
  const addr = lc(to);
  if (!isAddress(addr)) throw bad('That email address is not valid');
  if (!String(subject || '').trim() && !heading) throw bad('A subject is required');
  const st = sendState(tenant);
  if (!st.ok) throw fail('paused', PAUSE_TEXT[st.reason]);
  const sender = activeSenderFor(tenant.id, senderId);
  if (!sender) throw fail('sender_not_verified', PAUSE_TEXT.no_sender);
  const el = eligibility(addr, category);
  if (!el.ok) throw fail(el.reason, { invalid_address: 'That address is not valid.', suppressed: 'This address cannot be mailed (it bounced or is suppressed).', opted_out: 'This contact has unsubscribed from marketing mail.', no_consent: 'No marketing consent is recorded for this address.' }[el.reason]);
  const body = html || text ? { text, html, headers: headers || null } : compose({ category, heading, lines, button, footer, to: addr, tenant });
  const key = String(idemKey || crypto.randomUUID()).slice(0, 200);
  return ptx((d) => {
    const dup = d.prepare('SELECT id, status FROM email_queue WHERE tenant_id=? AND idem_key=?').get(tenant.id, key);
    if (dup) return { id: dup.id, status: dup.status, duplicate: true };
    const L = limitsFor(tenant), period = periodOf(tenant, nowMs), day = iso(nowMs).slice(0, 10);
    if (!L.unmetered) {
      if (!L.configured[category]) throw fail('not_configured', PAUSE_TEXT.not_configured);
      const u = usageOf(tenant.id, category, period, day), lim = L.limits[category];
      const monthly = lim.monthly == null ? null : lim.monthly + u.topup;
      if (L.limits.hard_stop) {
        if (monthly != null && u.used + 1 > monthly) throw fail('quota_exhausted', PAUSE_TEXT.monthly_exhausted);
        if (lim.daily != null && u.today + 1 > lim.daily) throw fail('daily_limit', PAUSE_TEXT.daily_exhausted);
      }
    }
    const r = d.prepare(`INSERT INTO email_queue(tenant_id,category,idem_key,to_addr,contact_id,sender_id,from_addr,reply_to,subject,text_body,html_body,headers,ref_kind,ref_id,period_key,day,next_attempt_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tenant.id, category, key, addr, contactId, sender.id, fromHeader(sender), replyTo || sender.reply_to || null, String(subject).slice(0, 300), body.text || null, body.html || null,
      body.headers ? JSON.stringify(body.headers) : null, refKind, refId == null ? null : String(refId), period.key, day, iso(sendAfterMs ?? nowMs));
    const id = Number(r.lastInsertRowid);
    if (trackReplies) { const addr = replyAddressFor(id); if (addr) d.prepare('UPDATE email_queue SET reply_to=? WHERE id=?').run(addr, id); }
    return { id, status: 'queued', duplicate: false, reply_tracked: !!(trackReplies && inboundDomain()) };
  });
}

/** After a reservation: warn the workspace once per period when usage crosses a configured threshold. */
export function warnThresholds(tenant, category, nowMs = Date.now()) {
  try {
    const s = allowanceSummary(tenant, nowMs), c = s.categories[category];
    if (!c || c.monthly_allowance == null) return [];
    const hit = reachedThresholds(c.used, c.monthly_allowance, s.thresholds);
    const sent = [];
    for (const t of hit) {
      const ref = `${category}:${s.period.start}:${t}`;
      if (!pdb().prepare('INSERT OR IGNORE INTO lifecycle_notices(tenant_id,kind,ref) VALUES(?,?,?)').run(tenant.id, 'email-threshold', ref).changes) continue;
      sent.push(t);
      const title = t >= 100 ? `Your ${category} email allowance is used up` : `${t}% of your ${category} email allowance is used`;
      const body = t >= 100 ? 'Sending of this type is paused until the period resets or more capacity is added.' : `${c.used} of ${c.monthly_allowance} used. It resets on ${s.period.resets_at.slice(0, 10)}.`;
      try { withTenant(tenant, () => notify(tAll("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 AND r.name IN ('Super Admin','Admin')").map((x) => x.id), 'email', title, body, '/settings/email', { dedupe: `emailq:${ref}` })); } catch { /* notification is best effort */ }
      if (tenant.owner_email) sendMail({ type: 'email_allowance', to: tenant.owner_email, workspaceId: tenant.id, subject: `${tenant.name}: ${title}`, ...layout({ brand: 'platform', heading: title, lines: [body] }) }).catch(() => {});
    }
    return sent;
  } catch { return []; }
}

// ---------------------------------------------------------------- worker
const RANK = { queued: 0, sending: 0, ambiguous: 0, accepted: 1, delivered: 2, failed: 3, bounced: 3, complained: 3, suppressed: 3, cancelled: 3 };
const EVENT_STATUS = { 'email.sent': 'accepted', 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'suppressed' };
const BACKOFF_MIN = [1, 5, 30, 120, 360];
const MAX_ATTEMPTS = 5;
let pausedUntilMs = 0;
export const resetWorkerState = () => { pausedUntilMs = 0; };

const guards = {};
/** Modules (sequences) register a last check for the messages they queued: return { cancel: 'reason' } to stop the send. */
export const registerSendGuard = (refKind, fn) => { guards[refKind] = fn; };

const setRow = (id, f) => {
  const keys = Object.keys(f);
  pdb().prepare(`UPDATE email_queue SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => f[k]), id);
};
const addEvent = (row, type, at, extra) => {
  const ev = parse(row.events, []); ev.push({ type, at: at || new Date().toISOString(), ...extra });
  return JSON.stringify(ev.slice(-30));
};
const release = (row, status, error) => setRow(row.id, { status, quota_state: 'released', last_error: error ? String(error).slice(0, 300) : null, final_at: iso(Date.now()), html_body: null, text_body: null, events: addEvent(row, `queue.${status}`, null, { reason: error }) });

function providerGuard(row, nowMs) {
  const lim = parse(getSetting('email_provider_limits'), null);
  if (!lim || (!lim.monthly && !lim.daily)) return null;
  const reserve = Number(lim.reserve_for_service) || 0, d = pdb();
  const dayStart = iso(nowMs).slice(0, 10), monthStart = dayStart.slice(0, 8) + '01';
  const used = (since) => d.prepare("SELECT COUNT(*) n FROM email_queue WHERE accepted_at>=? AND quota_state='committed'").get(since).n + d.prepare('SELECT COUNT(*) n FROM platform_email_log WHERE created_at>=?').get(since).n;
  const ceiling = row.category === 'marketing' ? reserve : Math.floor(reserve / 2);
  if (lim.daily && used(dayStart) + ceiling >= lim.daily) return 'provider_capacity';
  if (lim.monthly && used(monthStart) + ceiling >= lim.monthly) return 'provider_capacity';
  return null;
}

async function sendOne(row, nowMs) {
  const tenant = getTenant(row.tenant_id);
  // 1. recheck everything that may have changed while the message waited
  let stop = null;
  const st = sendState(tenant);
  if (!st.ok) stop = { cancel: st.reason };
  else if (!activeSenderFor(row.tenant_id, row.sender_id)) stop = { cancel: 'sender_not_verified' };
  else {
    withTenant(tenant, () => {
      const el = eligibility(row.to_addr, row.category);
      if (!el.ok) stop = { suppress: el.reason };
      else if (row.ref_kind && guards[row.ref_kind]) stop = guards[row.ref_kind](row) || null;
    });
  }
  if (stop?.suppress) return release(row, 'suppressed', stop.suppress);
  if (stop?.cancel) return release(row, 'cancelled', stop.cancel);
  // 2. the platform's own capacity: promotional mail yields to account and security mail
  const held = providerGuard(row, nowMs);
  if (held) return setRow(row.id, { status: 'queued', next_attempt_at: iso(nowMs + 10 * 60_000), last_error: held });
  // 3. hand it to the provider; the idempotency key makes a retry after a lost answer harmless inside the provider's window
  try {
    const out = await emailProvider().send({ from: row.from_addr, to: row.to_addr, subject: row.subject, text: row.text_body, html: row.html_body, replyTo: row.reply_to, headers: parse(row.headers, null), tags: [{ name: 'workspace', value: String(row.tenant_id) }, { name: 'category', value: row.category }] },
      { idempotencyKey: `agentify-${row.tenant_id}-${row.id}-${crypto.createHash('sha1').update(row.idem_key).digest('hex').slice(0, 16)}` });
    return accept(row, out?.id, nowMs);
  } catch (e) {
    const kind = e.kind || 'transient';
    if (kind === 'rate_limited') { pausedUntilMs = nowMs + (e.retryAfterSec || 5) * 1000; return setRow(row.id, { status: 'queued', next_attempt_at: iso(pausedUntilMs), last_error: 'rate limited' }); }
    if (kind === 'config') { pausedUntilMs = nowMs + 10 * 60_000; return setRow(row.id, { status: 'queued', next_attempt_at: iso(pausedUntilMs), last_error: e.message }); }
    if (kind === 'definitive') return release(row, 'failed', e.message);
    const attempts = row.attempts + 1;
    if (kind === 'ambiguous') {
      // the provider may have accepted it: never release quota or send a differently-keyed copy until we have looked
      if (attempts >= MAX_ATTEMPTS) return setRow(row.id, { status: 'failed', attempts, last_error: 'Unconfirmed: the provider never confirmed or denied this message. Quota stays used; a super admin can release it.', final_at: iso(nowMs), html_body: null, text_body: null, quota_state: 'committed' });
      return setRow(row.id, { status: 'ambiguous', attempts, next_attempt_at: iso(nowMs + 2 * 60_000), last_error: e.message });
    }
    if (attempts >= MAX_ATTEMPTS) return release({ ...row, attempts }, 'failed', `Gave up after ${attempts} attempts: ${e.message}`);
    return setRow(row.id, { status: 'queued', attempts, next_attempt_at: iso(nowMs + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000), last_error: e.message });
  }
}

function accept(row, providerId, nowMs) {
  setRow(row.id, { status: 'accepted', quota_state: 'committed', provider_id: providerId || null, accepted_at: iso(nowMs), last_error: null, html_body: null, text_body: null, events: addEvent(row, 'queue.accepted', null) });
  if (providerId) for (const ev of pdb().prepare('SELECT * FROM email_unmatched_events WHERE provider_id=? ORDER BY id').all(providerId)) applyProviderEvent(providerId, ev.type, ev.at, { bounce_type: ev.bounce_type });
  pdb().prepare('DELETE FROM email_unmatched_events WHERE provider_id=?').run(providerId || '');
  const t = getTenant(row.tenant_id);
  if (t) warnThresholds(t, row.category, nowMs);
}

/** An ambiguous message: did the provider accept it? Found = accepted. Not found = send again with the SAME key. */
async function reconcile(row, nowMs) {
  try {
    const hit = await emailProvider().findSent({ to: row.to_addr, subject: row.subject, sinceIso: new Date(Date.parse(`${row.created_at.replace(' ', 'T')}Z`) - 60_000).toISOString() });
    if (hit) return accept(row, hit.id, nowMs);
  } catch { /* cannot look: fall through to a keyed retry, which the provider dedupes */ }
  setRow(row.id, { status: 'queued' });
  return sendOne({ ...row, status: 'queued' }, nowMs);
}

/**
 * One pass of the delivery worker. Fair across workspaces (round-robin, at most `perTenant` per pass), service-adjacent
 * operational mail before marketing, and it honours a provider rate limit by pausing all sending until the delay passes.
 */
export async function runEmailQueue({ nowMs = Date.now(), max = 100, perTenant = 20 } = {}) {
  pdb();
  const out = { sent: 0, picked: 0, paused: false };
  if (nowMs < pausedUntilMs) return { ...out, paused: true };
  const due = pdb().prepare("SELECT * FROM email_queue WHERE status IN ('queued','ambiguous') AND next_attempt_at<=? ORDER BY CASE category WHEN 'operational' THEN 0 ELSE 1 END, next_attempt_at, id LIMIT 1000").all(iso(nowMs));
  const byTenant = new Map();
  for (const r of due) { if (!byTenant.has(r.tenant_id)) byTenant.set(r.tenant_id, []); if (byTenant.get(r.tenant_id).length < perTenant) byTenant.get(r.tenant_id).push(r); }
  const lists = [...byTenant.values()];
  const picked = [];
  for (let i = 0; picked.length < max; i++) {
    let any = false;
    for (const l of lists) if (l[i]) { picked.push(l[i]); any = true; if (picked.length >= max) break; }
    if (!any) break;
  }
  for (const row of picked) {
    if (Date.now() < pausedUntilMs && nowMs < pausedUntilMs) { out.paused = true; break; }
    // claim: another worker may have taken it
    if (!pdb().prepare("UPDATE email_queue SET status='sending', updated_at=datetime('now') WHERE id=? AND status IN ('queued','ambiguous')").run(row.id).changes) continue;
    out.picked += 1;
    try { await (row.status === 'ambiguous' ? reconcile : sendOne)(row, nowMs); } catch (e) { console.error('[email worker]', e); setRow(row.id, { status: 'queued', next_attempt_at: iso(nowMs + 60_000), last_error: String(e.message).slice(0, 200) }); }
  }
  out.sent = picked.length ? pdb().prepare("SELECT COUNT(*) n FROM email_queue WHERE id IN (" + picked.map(() => '?').join(',') + ") AND status IN ('accepted','delivered')").get(...picked.map((p) => p.id)).n : 0;
  return out;
}

// ---------------------------------------------------------------- provider events (webhook)
/**
 * Apply one delivery event. The workspace comes from OUR row for that provider message id, never from the request.
 * Duplicates and out-of-order events are safe: a status only moves forward and events are de-duplicated by type and time.
 */
export function applyProviderEvent(providerId, type, at, { bounce_type } = {}) {
  const d = pdb();
  const row = d.prepare('SELECT * FROM email_queue WHERE provider_id=?').get(providerId);
  if (!row) {
    if (EVENT_STATUS[type] && type !== 'email.sent') d.prepare('INSERT INTO email_unmatched_events(provider_id,type,at,bounce_type) VALUES(?,?,?,?)').run(providerId, type, at || null, bounce_type || null);
    return null;
  }
  const ev = parse(row.events, []);
  if (ev.some((e) => e.type === type && e.at === at)) return row;
  const next = EVENT_STATUS[type];
  const fields = { events: addEvent(row, type, at, bounce_type ? { bounce_type } : undefined) };
  if (next && RANK[next] >= RANK[row.status] && !(RANK[row.status] === 3 && next === 'delivered')) { fields.status = next; if (RANK[next] === 3) fields.final_at = iso(Date.now()); }
  setRow(row.id, fields);
  // consequences for the address, in the workspace that owns this message
  const t = getTenant(row.tenant_id);
  if (t && (type === 'email.bounced' || type === 'email.complained' || type === 'email.suppressed')) {
    const permanent = type !== 'email.bounced' || !bounce_type || /perm/i.test(bounce_type);
    if (permanent) {
      try {
        withTenant(t, () => {
          if (type === 'email.complained') suppress(row.to_addr, { scope: 'marketing', reason: 'complained', source: 'provider' });
          else suppress(row.to_addr, { scope: 'all', reason: type === 'email.bounced' ? 'bounced' : 'provider_suppressed', source: 'provider' });
        });
        cancelQueued(row.tenant_id, row.to_addr, type === 'email.complained' ? 'marketing' : 'all', 'suppressed');
      } catch (e) { console.error('[email event]', e.message); }
    }
  }
  return { ...row, ...fields };
}

/** Stop everything still waiting for an address in one workspace (opt-out, suppression); frees the reservations. */
export function cancelQueued(tenantId, email, scope = 'marketing', status = 'suppressed') {
  const rows = pdb().prepare(`SELECT * FROM email_queue WHERE tenant_id=? AND to_addr=? AND status IN ('queued','ambiguous')${scope === 'marketing' ? " AND category='marketing'" : ''}`).all(tenantId, lc(email));
  for (const r of rows) release(r, status, scope === 'marketing' ? 'opted_out' : 'suppressed');
  return rows.length;
}

// ---------------------------------------------------------------- history and dashboards
export function historyFor(tenantId, { status, category, q, limit = 50, offset = 0 } = {}) {
  const where = ['tenant_id=?'], p = [tenantId];
  if (status) { where.push('status=?'); p.push(status); }
  if (category) { where.push('category=?'); p.push(category); }
  if (q) { where.push("(to_addr LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\')"); const like = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`; p.push(like, like); }
  const total = pdb().prepare(`SELECT COUNT(*) n FROM email_queue WHERE ${where.join(' AND ')}`).get(...p).n;
  const rows = pdb().prepare(`SELECT id,category,to_addr,from_addr,subject,status,quota_state,attempts,last_error,ref_kind,created_at,accepted_at,final_at,contact_id FROM email_queue WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...p, Math.min(200, Math.max(1, Number(limit) || 50)), Math.max(0, Number(offset) || 0));
  return { total, rows };
}
export function statusCounts(tenantId) {
  return Object.fromEntries(pdb().prepare('SELECT status, COUNT(*) n FROM email_queue WHERE tenant_id=? GROUP BY status').all(tenantId).map((r) => [r.status, r.n]));
}

export function grantTopup(tenantId, category, amount, note, by, nowMs = Date.now()) {
  const t = getTenant(tenantId);
  if (!t) throw new HttpError(404, 'Workspace not found');
  if (!METERED.includes(category)) throw bad('Top-ups apply to operational or marketing mail');
  const n = Math.trunc(Number(amount));
  if (!(n >= 1 && n <= 10_000_000)) throw bad('Top-up must be a whole number of messages from 1');
  if (!limitsFor(t).limits.topups) throw bad('Top-ups are switched off for this workspace\'s plan');
  const period = periodOf(t, nowMs);
  pdb().prepare('INSERT INTO email_topups(tenant_id,category,amount,period_key,note,granted_by) VALUES(?,?,?,?,?,?)').run(tenantId, category, n, period.key, note ? String(note).slice(0, 200) : null, by || null);
  return allowanceSummary(t, nowMs);
}

/** Super admin: free a stuck reservation (an unconfirmed ambiguous send). */
export function adminRelease(id, by) {
  const row = pdb().prepare('SELECT * FROM email_queue WHERE id=?').get(id);
  if (!row) throw new HttpError(404, 'Message not found');
  if (row.quota_state === 'released') return row;
  if (['accepted', 'delivered', 'bounced', 'complained'].includes(row.status)) throw bad('The provider accepted this message, so its quota stays used.');
  release(row, row.status === 'failed' ? 'failed' : 'cancelled', `released by ${by || 'admin'}`);
  return pdb().prepare('SELECT * FROM email_queue WHERE id=?').get(id);
}

export function platformSummary(nowMs = Date.now()) {
  const d = pdb();
  const since = iso(nowMs - 30 * 864e5);
  const n = (q, ...p) => d.prepare(q).get(...p).n;
  const accepted30 = n("SELECT COUNT(*) n FROM email_queue WHERE accepted_at>=?", since);
  const bounced = n("SELECT COUNT(*) n FROM email_queue WHERE status='bounced' AND accepted_at>=?", since);
  const complained = n("SELECT COUNT(*) n FROM email_queue WHERE status='complained' AND accepted_at>=?", since);
  const usage = parse(getSetting('email_provider_usage'), null);
  const tenants = d.prepare(`SELECT q.tenant_id, t.name, t.slug, q.category, COUNT(*) used,
      SUM(q.status IN ('accepted','delivered')) accepted, SUM(q.status='delivered') delivered, SUM(q.status='bounced') bounced, SUM(q.status='complained') complained, SUM(q.status='failed') failed, SUM(q.status IN ('suppressed','cancelled')) stopped
    FROM email_queue q JOIN tenants t ON t.id=q.tenant_id WHERE q.created_at>=? GROUP BY q.tenant_id, q.category ORDER BY used DESC LIMIT 200`).all(since);
  return {
    provider: { name: emailProvider().name || 'resend', connected: !!(getSetting('resend_api_key') || process.env.RESEND_API_KEY), usage, usage_error: getSetting('email_provider_usage_error') || null,
      last_success_at: usage?.at || null, limits: parse(getSetting('email_provider_limits'), null),
      commercial: { ...(parse(getSetting('email_provider_commercial'), {}) || {}), note: 'Entered by hand. Not read from the provider and only an estimate.' } },
    queue: { queued: n("SELECT COUNT(*) n FROM email_queue WHERE status='queued'"), ambiguous: n("SELECT COUNT(*) n FROM email_queue WHERE status='ambiguous'"), failed_30d: n("SELECT COUNT(*) n FROM email_queue WHERE status='failed' AND created_at>=?", since),
      oldest_queued: d.prepare("SELECT MIN(next_attempt_at) v FROM email_queue WHERE status='queued'").get().v || null, paused_until: pausedUntilMs > nowMs ? new Date(pausedUntilMs).toISOString() : null },
    health: { accepted_30d: accepted30, bounced_30d: bounced, complained_30d: complained, bounce_rate: accepted30 ? +(bounced / accepted30).toFixed(4) : null, complaint_rate: accepted30 ? +(complained / accepted30).toFixed(4) : null },
    tenants,
    recent_failures: d.prepare("SELECT id,tenant_id,category,to_addr,status,last_error,created_at FROM email_queue WHERE status IN ('failed','ambiguous') ORDER BY id DESC LIMIT 20").all(),
    service_mail_30d: n('SELECT COUNT(*) n FROM platform_email_log WHERE created_at>=?', since),
  };
}

/** Pull account usage from the provider's documented usage endpoint. The answer is kept as received; nothing is inferred. */
export async function syncProviderUsage(nowMs = Date.now()) {
  try {
    const data = await emailProvider().getUsage();
    setSetting('email_provider_usage', JSON.stringify({ at: new Date(nowMs).toISOString(), data }));
    setSetting('email_provider_usage_error', '');
    return { ok: true, data };
  } catch (e) {
    setSetting('email_provider_usage_error', `${new Date(nowMs).toISOString()} ${String(e.message).slice(0, 200)}`);
    return { ok: false, error: e.message };
  }
}

export const _internals = { RANK, iso };
export { listTenants, tGet };
