// "Report" on an AI result: people flag wrong, unsafe or poor answers; the console lists them (AI page > Reported AI answers).
import { ensureTable } from './aiUsage.js';
import { bad } from '../util.js';

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
export function createReport({ tenantId = null, tenantName = null, userName = null, feature, prompt, output, note }) {
  if (!feature) throw bad('Nothing to report');
  const id = ensureTable().prepare('INSERT INTO ai_reports(tenant_id, tenant_name, user_name, feature, prompt, output, note) VALUES(?,?,?,?,?,?,?)')
    .run(tenantId, clip(tenantName, 120), clip(userName, 120), clip(feature, 60), clip(prompt, 1500), clip(output, 3000), clip(note, 500)).lastInsertRowid;
  return { id: Number(id) };
}
export function listReports({ handled = false, limit = 100 } = {}) {
  return ensureTable().prepare(`SELECT * FROM ai_reports ${handled ? '' : "WHERE status='open'"} ORDER BY id DESC LIMIT ?`).all(limit);
}
export const openReportCount = () => ensureTable().prepare("SELECT COUNT(*) n FROM ai_reports WHERE status='open'").get().n;
export function handleReport(id, by, handled = true) {
  const r = ensureTable().prepare('SELECT id FROM ai_reports WHERE id=?').get(Number(id));
  if (!r) throw bad('Report not found');
  ensureTable().prepare('UPDATE ai_reports SET status=?, handled_by=?, handled_at=? WHERE id=?').run(handled ? 'handled' : 'open', handled ? by || null : null, handled ? new Date().toISOString() : null, r.id);
  return { id: r.id, status: handled ? 'handled' : 'open' };
}
