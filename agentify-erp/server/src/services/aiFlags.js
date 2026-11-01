// Flagged AI output: a person in a workspace presses "Report" on an AI suggestion that is wrong, unsafe or off-brand. The report
// (feature, the text they saw, their reason) is kept in the platform database for the console team to review. Only what the person
// chose to report is stored; nothing else from the workspace is copied.
import { platformDb } from '../platform.js';
import { bad, notFound } from '../util.js';
import { AI_FEATURES } from './aiUsage.js';

const SCHEMA = `CREATE TABLE IF NOT EXISTS ai_flags(
  id INTEGER PRIMARY KEY, tenant_id INTEGER, feature TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, output TEXT NOT NULL, reported_by TEXT,
  status TEXT NOT NULL DEFAULT 'open', resolution TEXT, reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_ai_flags_status ON ai_flags(status, id);`;
let ready = false;
const db = () => { const d = platformDb(); if (!ready) { d.exec(SCHEMA); ready = true; } return d; };

export const REASONS = { wrong: 'Wrong or made-up facts', unsafe: 'Offensive or unsafe', misleading: 'Misleading claim', off_brand: 'Off-brand or poor wording', other: 'Something else' };
export const STATUSES = ['open', 'reviewed', 'dismissed'];
const PER_DAY = 30;

export function report(tenantId, by, b) {
  const feature = AI_FEATURES[b.feature] ? b.feature : 'workspace_ai';
  const reason = REASONS[b.reason] ? b.reason : null;
  if (!reason) throw bad('Choose what is wrong with the answer');
  const output = String(b.output || '').trim().slice(0, 4000);
  if (!output) throw bad('There is no AI text to report');
  const note = String(b.note || '').trim().slice(0, 500) || null;
  if (tenantId && db().prepare("SELECT COUNT(*) n FROM ai_flags WHERE tenant_id=? AND created_at>=datetime('now','-1 day')").get(tenantId).n >= PER_DAY) throw bad('You have sent many reports today. Please try again tomorrow.');
  const id = Number(db().prepare('INSERT INTO ai_flags(tenant_id, feature, reason, note, output, reported_by) VALUES(?,?,?,?,?,?)').run(tenantId || null, feature, reason, note, output, by || null).lastInsertRowid);
  return { id };
}

export function list({ status } = {}) {
  const where = STATUSES.includes(status) ? 'WHERE f.status=?' : '';
  const rows = db().prepare(`SELECT f.*, t.name workspace, t.slug FROM ai_flags f LEFT JOIN tenants t ON t.id=f.tenant_id ${where} ORDER BY (f.status='open') DESC, f.id DESC LIMIT 200`).all(...(where ? [status] : []));
  const open = db().prepare("SELECT COUNT(*) n FROM ai_flags WHERE status='open'").get().n;
  return { open, reasons: REASONS, features: AI_FEATURES, rows: rows.map((r) => ({ ...r, reason_label: REASONS[r.reason] || r.reason, feature_label: AI_FEATURES[r.feature] || r.feature })) };
}

export function resolve(id, { status, resolution }, by) {
  if (!['reviewed', 'dismissed', 'open'].includes(status)) throw bad('Choose Reviewed, Dismissed or Reopen');
  const row = db().prepare('SELECT id FROM ai_flags WHERE id=?').get(Number(id));
  if (!row) throw notFound('Report not found');
  db().prepare("UPDATE ai_flags SET status=?, resolution=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?").run(status, String(resolution || '').trim().slice(0, 500) || null, by || null, row.id);
  return list().rows.find((r) => r.id === row.id) || db().prepare('SELECT * FROM ai_flags WHERE id=?').get(row.id);
}
