// Data retention and deletion for cancelled workspaces.
//
// Policy (configurable in the console): a cancelled workspace keeps all its data for N days (default 90) so it can be
// reactivated or exported. After that it is listed as "eligible for deletion review"; nothing is ever deleted
// automatically. A Platform Owner / Super Admin can then delete the workspace's database and uploaded files, typing the
// workspace address to confirm and giving a reason. Billing records (invoices, payments, refunds, subscription history)
// live in the platform database and are kept for legal and accounting obligations; the workspace row stays as a
// tombstone with the deletion date. An optional final archive can be written to the backup folder first.
import fs from 'node:fs';
import { removeTenantPrefix } from './storage.js';
import path from 'node:path';
import { platformDb, getTenant, listTenants, withTenant, logTenantEvent } from '../platform.js';
import { db, closeDb } from '../db.js';
import { backupDir } from './backup.js';
import { bad, HttpError } from '../util.js';

const pdb = () => platformDb();
const setting = (k) => pdb().prepare('SELECT value FROM platform_settings WHERE key=?').get(k)?.value;
export const retentionDays = () => { const n = Number(setting('retention_days_after_cancel')); return Number.isFinite(n) && n >= 0 ? n : 90; };
export function setRetentionDays(days, by) {
  const n = Math.trunc(Number(days));
  if (!(n >= 30 && n <= 3650)) throw bad('Retention must be between 30 and 3650 days');
  pdb().prepare("INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES('retention_days_after_cancel',?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(String(n), by);
  return retentionDays();
}

/** When the workspace was (last) cancelled, as an ISO date string, or null. */
export function cancelledOn(t) {
  const ev = pdb().prepare("SELECT created_at FROM tenant_events WHERE tenant_id=? AND action='status:cancelled' ORDER BY id DESC LIMIT 1").get(t.id);
  return ev ? String(ev.created_at).slice(0, 10) : t.status === 'cancelled' ? String(t.updated_at || t.created_at).slice(0, 10) : null;
}
export function retentionState(t) {
  if (t.is_legacy || t.status !== 'cancelled') return { applies: false };
  if (t.data_deleted_at) return { applies: true, deleted_at: t.data_deleted_at };
  const since = cancelledOn(t);
  const until = since ? new Date(Date.parse(`${since}T00:00:00Z`) + retentionDays() * 864e5).toISOString().slice(0, 10) : null;
  return { applies: true, cancelled_on: since, keep_until: until, eligible: !!until && new Date().toISOString().slice(0, 10) >= until, retention_days: retentionDays() };
}
export const eligibleForDeletion = () => listTenants().filter((t) => retentionState(t).eligible);

/**
 * Delete a cancelled workspace's data. Needs: cancelled status, the slug typed back, a reason, and either the retention
 * period to have passed or `owner_request: true` (the customer asked for deletion; their request is the reason).
 */
export function deleteWorkspaceData(id, { confirm_slug, reason, owner_request = false, keep_archive = false }, actor) {
  const t = getTenant(Number(id));
  if (!t) throw new HttpError(404, 'Workspace not found');
  if (t.is_legacy) throw bad('The original workspace cannot be deleted');
  if (t.status !== 'cancelled') throw bad('Only a cancelled workspace can be deleted. Cancel it first.');
  if (t.data_deleted_at) throw bad('This workspace\'s data was already deleted');
  if (String(confirm_slug || '').trim().toLowerCase() !== t.slug) throw bad(`Type the workspace address (${t.slug}) to confirm`);
  if (String(reason || '').trim().length < 5) throw bad('A reason is required');
  const st = retentionState(t);
  if (!st.eligible && !owner_request) throw bad(`The retention period runs until ${st.keep_until}. Delete earlier only when the customer asked for it (owner request).`);
  let archive = null;
  if (keep_archive && fs.existsSync(t.db_path)) {
    const dir = path.join(backupDir(), 'deleted-workspaces');
    fs.mkdirSync(dir, { recursive: true });
    archive = path.join(dir, `${t.slug}-${new Date().toISOString().slice(0, 10)}.db`);
    fs.rmSync(archive, { force: true });
    withTenant(t, () => db.prepare('VACUUM INTO ?').run(archive));
  }
  closeDb(t.db_path);
  for (const f of [t.db_path, `${t.db_path}-wal`, `${t.db_path}-shm`]) fs.rmSync(f, { force: true });
  if (t.upload_dir && fs.existsSync(t.upload_dir)) fs.rmSync(t.upload_dir, { recursive: true, force: true });
  // private files kept in object storage go with the workspace (its own tenants/{id}/ folder only)
  removeTenantPrefix(t.id).catch(() => {});
  const dbDir = path.dirname(t.db_path);
  try { if (fs.existsSync(dbDir) && !fs.readdirSync(dbDir).length) fs.rmdirSync(dbDir); } catch { /* not empty */ }
  pdb().prepare("UPDATE tenants SET data_deleted_at=datetime('now'), custom_domain=NULL, updated_at=datetime('now') WHERE id=?").run(t.id);
  logTenantEvent(t.id, 'data-deleted', { reason: String(reason).slice(0, 300), owner_request: !!owner_request, archive: archive ? path.basename(archive) : null, by: actor });
  return { slug: t.slug, archive: archive ? path.basename(archive) : null };
}

/** Lifecycle hook: raise one console alert per workspace that has reached the end of its retention period. */
export function flagEligible() {
  const ins = pdb().prepare("INSERT INTO platform_notifications(kind,severity,title,body,link,tenant_id,dedupe) VALUES('retention','info',?,?,?,?,?) ON CONFLICT(dedupe) DO NOTHING");
  let n = 0;
  for (const t of eligibleForDeletion()) {
    n += ins.run(`${t.name}: retention period over`, `Cancelled on ${cancelledOn(t)}. Review whether its data should now be deleted (never automatic).`, `/platform/workspaces/${t.id}`, t.id, `retention:${t.id}`).changes;
  }
  return n;
}
