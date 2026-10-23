// Every e-mail the platform sends through Resend, kept locally so the console can filter by workspace and type (Resend's own list
// cannot), and updated from Resend's delivery webhooks. The body is never stored: only the subject and a type, so one-time codes and
// reset links never sit in this table. Also remembers webhook event ids (so a repeated delivery is ignored) and what mail arrived.
import { platformDb } from '../platform.js';

const pdb = () => platformDb();
export const EMAIL_LOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS platform_email_log(
  id INTEGER PRIMARY KEY, resend_email_id TEXT UNIQUE, type TEXT NOT NULL DEFAULT 'other', workspace_id INTEGER, to_addr TEXT NOT NULL, from_addr TEXT, subject TEXT,
  status TEXT NOT NULL DEFAULT 'queued', events TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_email_log_created ON platform_email_log(created_at);
CREATE INDEX IF NOT EXISTS idx_email_log_ws ON platform_email_log(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS platform_webhook_events(
  event_id TEXT PRIMARY KEY, source TEXT NOT NULL, type TEXT NOT NULL, summary TEXT, received_at TEXT NOT NULL DEFAULT (datetime('now')));
`;
let ready = false;
const ensure = () => { if (!ready) { pdb().exec(EMAIL_LOG_SCHEMA); ready = true; } };

export const STATUSES = ['queued', 'sent', 'delivered', 'bounced', 'complained', 'failed'];
// a later or worse outcome never gets overwritten by an earlier event that happens to arrive afterwards
const RANK = { queued: 0, sent: 1, delivered: 2, bounced: 3, complained: 3, failed: 3 };
const EVENT_STATUS = { 'email.sent': 'sent', 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'failed' };
/** Types whose message holds a one-time code or a sign-in link: the console shows the subject only. */
export const SENSITIVE_TYPES = ['verification', 'password_reset', 'invitation', 'otp', 'welcome'];

/** Hook for mailer.sendMail: a row for each accepted message. Never throws. */
export function logSent({ resendId, type = 'other', workspaceId = null, to, from = null, subject = '', status = 'queued' }) {
  try {
    ensure();
    pdb().prepare('INSERT OR IGNORE INTO platform_email_log(resend_email_id, type, workspace_id, to_addr, from_addr, subject, status) VALUES(?,?,?,?,?,?,?)')
      .run(resendId || null, String(type).slice(0, 40), workspaceId || null, String(to).slice(0, 300), from ? String(from).slice(0, 300) : null, String(subject || '').slice(0, 300), status);
  } catch { /* the log must never break sending */ }
}

/** Apply a Resend delivery event to the row for that e-mail. Returns the row, or null when the e-mail is not ours. */
export function applyEvent(resendId, eventType, at) {
  ensure();
  const row = pdb().prepare('SELECT * FROM platform_email_log WHERE resend_email_id=?').get(resendId);
  if (!row) return null;
  const events = JSON.parse(row.events || '[]');
  if (!events.some((e) => e.type === eventType && e.at === at)) events.push({ type: eventType, at });
  const next = EVENT_STATUS[eventType];
  const status = next && RANK[next] >= RANK[row.status] ? next : row.status;
  pdb().prepare("UPDATE platform_email_log SET status=?, events=?, updated_at=datetime('now') WHERE id=?").run(status, JSON.stringify(events.slice(-30)), row.id);
  return { ...row, status };
}

const view = (r) => ({ id: r.id, resend_email_id: r.resend_email_id, type: r.type, workspace_id: r.workspace_id, to: r.to_addr, from: r.from_addr, subject: r.subject, status: r.status, created_at: r.created_at, updated_at: r.updated_at });
export function listLog({ status, type, workspace, from, to, q, limit = 50, offset = 0 } = {}) {
  ensure();
  const where = [], params = [];
  if (status && STATUSES.includes(status)) { where.push('l.status=?'); params.push(status); }
  if (type) { where.push('l.type=?'); params.push(String(type)); }
  if (workspace) { where.push('l.workspace_id=?'); params.push(Number(workspace)); }
  if (from && /^\d{4}-\d{2}-\d{2}/.test(from)) { where.push('l.created_at>=?'); params.push(from.slice(0, 10)); }
  if (to && /^\d{4}-\d{2}-\d{2}/.test(to)) { where.push("l.created_at<date(?, '+1 day')"); params.push(to.slice(0, 10)); }
  if (q) { where.push("(l.to_addr LIKE ? ESCAPE '\\' OR l.subject LIKE ? ESCAPE '\\')"); const like = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`; params.push(like, like); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = pdb().prepare(`SELECT COUNT(*) n FROM platform_email_log l ${w}`).get(...params).n;
  const rows = pdb().prepare(`SELECT l.*, t.name workspace_name FROM platform_email_log l LEFT JOIN tenants t ON t.id=l.workspace_id ${w} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`)
    .all(...params, Math.min(200, Math.max(1, Number(limit) || 50)), Math.max(0, Number(offset) || 0));
  return { total, rows: rows.map((r) => ({ ...view(r), workspace_name: r.workspace_name || null })), types: pdb().prepare('SELECT DISTINCT type FROM platform_email_log ORDER BY type').all().map((x) => x.type),
    workspaces: pdb().prepare('SELECT DISTINCT l.workspace_id id, t.name FROM platform_email_log l JOIN tenants t ON t.id=l.workspace_id ORDER BY t.name').all() };
}
export function getLog(id) {
  ensure();
  const r = pdb().prepare('SELECT l.*, t.name workspace_name FROM platform_email_log l LEFT JOIN tenants t ON t.id=l.workspace_id WHERE l.id=?').get(Number(id));
  return r ? { ...view(r), workspace_name: r.workspace_name || null, events: JSON.parse(r.events || '[]') } : null;
}
/** Import e-mails Resend knows about that this log does not (sent before the log existed, or from a mailbox reply). */
export function importFromResend(list) {
  ensure();
  let added = 0;
  const st = pdb().prepare('INSERT OR IGNORE INTO platform_email_log(resend_email_id, type, to_addr, from_addr, subject, status, created_at) VALUES(?,?,?,?,?,?,?)');
  for (const e of list) {
    const last = String(e.last_event || '').replace(/^email\./, '');
    const status = STATUSES.includes(last) ? last : last === 'delivery_delayed' ? 'sent' : 'sent';
    const iso = e.created_at ? new Date(String(e.created_at).replace(' ', 'T').replace(/\+00$/, 'Z')).toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (st.run(e.id, 'other', (Array.isArray(e.to) ? e.to.join(', ') : String(e.to || '')).slice(0, 300), e.from || null, String(e.subject || '').slice(0, 300), status, iso).changes) added += 1;
  }
  return added;
}

// ---------------------------------------------------------------- webhook bookkeeping
/** False when this event id was already handled (Resend and Svix retry), true the first time. */
export function recordWebhook(eventId, source, type, summary = null) {
  ensure();
  const r = pdb().prepare('INSERT OR IGNORE INTO platform_webhook_events(event_id, source, type, summary) VALUES(?,?,?,?)').run(String(eventId).slice(0, 120), source, type, summary ? JSON.stringify(summary).slice(0, 600) : null);
  pdb().prepare("DELETE FROM platform_webhook_events WHERE received_at < datetime('now','-30 days')").run();
  return r.changes > 0;
}
export function webhookStatus() {
  ensure();
  const last = pdb().prepare('SELECT type, received_at FROM platform_webhook_events ORDER BY received_at DESC LIMIT 1').get();
  const lastReceived = pdb().prepare("SELECT received_at, summary FROM platform_webhook_events WHERE type IN ('email.received','inbox.email.received') ORDER BY received_at DESC LIMIT 1").get();
  return { last_event_at: last?.received_at || null, last_event_type: last?.type || null, last_mail_at: lastReceived?.received_at || null, last_mail: lastReceived?.summary ? JSON.parse(lastReceived.summary) : null };
}
