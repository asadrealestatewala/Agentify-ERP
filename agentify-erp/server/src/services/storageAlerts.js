// Storage warnings for workspaces and the console's storage overview (used vs quota per workspace, the bucket total).
//
//  * 80% of the quota: one warning e-mail to the owner and an in-app notice for the admins.
//  * 100%: uploads are blocked (see plans.assertStorageAvailable); one e-mail with an upgrade prompt.
//  * Below 75% the flags reset, so a workspace that frees space is warned again if it fills up later.
//  * The quota is the plan's storage limit unless the console set a limit for that workspace (entitlements.storage_mb).
import { platformDb, getTenant, withTenant, logTenantEvent, BASE_DOMAIN, isMultiTenant } from '../platform.js';
import { all } from '../db.js';
import { notify } from '../audit.js';
import { sendMail, layout } from './mailer.js';
import { PLANS, billingState, storageBytes, forgetStorage, storageUsedBytes, storageQuotaBytes, bytesText, onStorageUploaded } from './plans.js';
import { privateBytes, listUsage, storageEnabled } from './storage.js';
import { getSetting, setSetting } from './platformConfig.js';
import { HttpError } from '../util.js';

const pdb = () => platformDb();
const billingUrl = (t) => (isMultiTenant() ? `https://${t.custom_domain || `${t.slug}.${BASE_DOMAIN}`}/settings/billing` : '/settings/billing');

/** Warn at 80%, tell at 100%, reset under 75%. Call inside the workspace's context. Returns the state, or null when unlimited. */
export async function checkStorageAlerts(tenant) {
  if (!tenant || tenant.is_legacy) return null;
  const quota = storageQuotaBytes(tenant);
  if (quota == null) return null;
  forgetStorage();
  const used = storageUsedBytes(), pct = used / quota;
  const db = pdb();
  const flags = db.prepare('SELECT storage_warned_at w, storage_full_notified_at f FROM tenants WHERE id=?').get(tenant.id) || {};
  if (pct < 0.75) {
    if (flags.w || flags.f) db.prepare('UPDATE tenants SET storage_warned_at=NULL, storage_full_notified_at=NULL WHERE id=?').run(tenant.id);
    return { used, quota, pct, sent: null };
  }
  let kind = null;
  if (pct >= 1) {
    if (db.prepare("UPDATE tenants SET storage_full_notified_at=datetime('now'), storage_warned_at=COALESCE(storage_warned_at, datetime('now')) WHERE id=? AND storage_full_notified_at IS NULL").run(tenant.id).changes) kind = 'full';
  } else if (pct >= 0.8) {
    if (db.prepare("UPDATE tenants SET storage_warned_at=datetime('now') WHERE id=? AND storage_warned_at IS NULL").run(tenant.id).changes) kind = 'warn';
  }
  if (kind) await tell(tenant, kind, used, quota);
  return { used, quota, pct, sent: kind };
}

async function tell(t, kind, used, quota) {
  const plan = billingState(t).limits.name;
  const pct = Math.round((used / quota) * 100);
  const full = kind === 'full';
  const heading = full ? 'Your file storage is full' : `Your file storage is ${pct}% full`;
  const lines = full
    ? [`Your ${plan} plan includes ${bytesText(quota)} of file storage and all of it is used (${bytesText(used)}).`, 'New uploads are paused until you delete files or upgrade your plan. Everything you have already stored is safe and still available.']
    : [`You are using ${bytesText(used)} of the ${bytesText(quota)} file storage in your ${plan} plan.`, 'When it is full, new uploads pause until you delete files or upgrade your plan.'];
  const subject = full ? 'Your Agentify ERP file storage is full' : `Your Agentify ERP file storage is ${pct}% full`;
  logTenantEvent(t.id, `storage:${kind}`, { used, quota });
  try {
    withTenant(t, () => {
      const admins = all("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 AND r.name IN ('Super Admin','Admin')").map((r) => r.id);
      notify(admins, 'billing', heading, lines[0], '/settings/billing', { dedupe: `storage:${kind}:${new Date().toISOString().slice(0, 7)}` });
    });
  } catch (e) { console.error(`[storage ${t.slug}] notify`, e.message); }
  if (t.owner_email) {
    try { await withTenant(t, () => sendMail({ type: 'billing_notice', to: t.owner_email, subject, ...layout({ brand: 'platform', heading, lines, button: { label: full ? 'Upgrade your plan' : 'Open Plan & Billing', url: billingUrl(t) } }) })); }
    catch (e) { console.error(`[storage ${t.slug}] mail`, e.message); }
  }
}
onStorageUploaded((t) => { checkStorageAlerts(t).catch((e) => console.error('[storage] alert', e.message)); });

/** Daily: catch workspaces that crossed a line without uploading (plan change, deleted files) and reset flags for those that dropped. */
export async function storageSweep() {
  let sent = 0;
  const rows = pdb().prepare("SELECT * FROM tenants WHERE is_legacy=0 AND status='active' AND data_deleted_at IS NULL").all();
  for (const row of rows) {
    try {
      const t = getTenant(row.id);
      const r = await withTenant(t, () => checkStorageAlerts(t));
      if (r?.sent) sent += 1;
    } catch (e) { console.error(`[storage ${row.slug}] sweep`, e.message); }
  }
  return sent;
}

// ---------------------------------------------------------------- console overview
export const totalGb = () => Number(getSetting('storage_total_gb')) || Number(process.env.S3_TOTAL_QUOTA_GB) || 250;
export function setTotalGb(v, by) {
  const n = Number(v);
  if (!(n >= 1 && n <= 1_000_000)) throw new HttpError(400, 'Total storage must be a number of GB from 1');
  setSetting('storage_total_gb', String(n), { by });
  return totalGb();
}
/**
 * Set (or clear) one workspace's storage limit without touching its other limits. `mb` = a whole number of MB, 'unlimited', or
 * 'plan' to go back to the plan's value. A reason is required and kept in the workspace's history.
 */
export function setWorkspaceQuota(id, { mb, reason }, actor) {
  const t = getTenant(Number(id));
  if (!t || t.is_legacy) throw new HttpError(404, 'Workspace not found');
  if (String(reason || '').trim().length < 5) throw new HttpError(400, 'A reason is required when changing a workspace\'s limits');
  const ent = parse(t.entitlements) || {};
  if (mb === 'plan' || mb === undefined) delete ent.storage_mb;
  else if (mb === 'unlimited' || mb === null) ent.storage_mb = null;
  else {
    const n = Math.trunc(Number(mb));
    if (!(n >= 1 && n <= 10_000_000)) throw new HttpError(400, 'Storage must be a whole number of MB from 1 (or unlimited)');
    ent.storage_mb = n;
  }
  pdb().prepare("UPDATE tenants SET entitlements=?, storage_warned_at=NULL, storage_full_notified_at=NULL, updated_at=datetime('now') WHERE id=?").run(Object.keys(ent).length ? JSON.stringify(ent) : null, t.id);
  logTenantEvent(t.id, 'entitlements', { to: ent, reason: String(reason).trim().slice(0, 300), by: actor, field: 'storage_mb' });
  return getTenant(t.id);
}
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** Every workspace's usage against its quota, the plans, and the bucket total. Reads each workspace's own data, so it is exact. */
export async function overview() {
  const rows = pdb().prepare("SELECT id FROM tenants WHERE is_legacy=0 AND data_deleted_at IS NULL ORDER BY name COLLATE NOCASE").all();
  const tenants = [];
  for (const { id } of rows) {
    const t = getTenant(id);
    let disk = 0, priv = 0;
    try { withTenant(t, () => { disk = storageBytes(); priv = privateBytes(); }); } catch { /* workspace database not readable: show zero */ }
    const st = billingState(t);
    const ent = parse(t.entitlements);
    const quota = st.limits.storage_mb == null ? null : st.limits.storage_mb * 1048576;
    tenants.push({
      id: t.id, slug: t.slug, name: t.name, status: t.status, subscription_status: t.subscription_status, plan: t.plan, plan_name: st.limits.name,
      plan_mb: PLANS[t.plan]?.storage_mb ?? null, override_mb: ent && 'storage_mb' in ent ? ent.storage_mb : undefined, quota_mb: st.limits.storage_mb,
      public_bytes: disk, private_bytes: priv, used_bytes: disk + priv, quota_bytes: quota, pct: quota ? (disk + priv) / quota : null,
      bucket_bytes: t.storage_bucket_bytes ?? null, bucket_files: t.storage_bucket_files ?? null, warned: !!t.storage_warned_at, full: !!t.storage_full_notified_at,
    });
  }
  const sold = tenants.reduce((n, t) => n + (t.quota_bytes || 0), 0);
  const gb = totalGb();
  return {
    bucket: {
      configured: storageEnabled(), name: process.env.S3_BUCKET || null, endpoint: process.env.S3_ENDPOINT || null, region: process.env.S3_REGION || null,
      total_gb: gb, total_bytes: gb * 1024 ** 3, synced_at: getSetting('storage_synced_at'), used_bytes: getSetting('storage_bucket_bytes') == null ? null : Number(getSetting('storage_bucket_bytes')),
      unassigned_bytes: Number(getSetting('storage_unassigned_bytes') || 0),
    },
    totals: { used_bytes: tenants.reduce((n, t) => n + t.used_bytes, 0), private_bytes: tenants.reduce((n, t) => n + t.private_bytes, 0), public_bytes: tenants.reduce((n, t) => n + t.public_bytes, 0),
      quota_sold_bytes: sold, unlimited: tenants.filter((t) => t.quota_bytes == null && t.status === 'active').length },
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name, product: p.product, storage_mb: p.storage_mb ?? null, active: p.active !== false, subscribers: tenants.filter((t) => t.plan === id).length })),
    tenants,
  };
}

/** Count what is really in the bucket, per workspace folder and in total, and keep the result for the console. */
export async function syncBucket(by) {
  if (!storageEnabled()) throw new HttpError(400, 'Object storage is not configured: set the S3_* settings first.');
  const live = await listUsage();
  const db = pdb();
  const known = new Set(db.prepare('SELECT id FROM tenants').all().map((r) => r.id));
  const stamp = new Date().toISOString();
  let unassigned = 0;
  db.exec('BEGIN');
  try {
    const up = db.prepare('UPDATE tenants SET storage_bucket_bytes=?, storage_bucket_files=?, storage_synced_at=? WHERE id=?');
    for (const id of known) { const u = live.per.get(id); up.run(u?.bytes ?? 0, u?.files ?? 0, stamp, id); }
    for (const [id, u] of live.per) if (!known.has(id)) unassigned += u.bytes;
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  setSetting('storage_bucket_bytes', String(live.total), { by });
  setSetting('storage_unassigned_bytes', String(unassigned), { by });
  setSetting('storage_synced_at', stamp, { by });
  return { synced_at: stamp, total_bytes: live.total, workspaces: live.per.size, unassigned_bytes: unassigned };
}
