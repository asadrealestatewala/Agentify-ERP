// Move a workspace's existing private files from the VPS disk to the bucket. Safe to repeat: rows already pointing at the bucket
// are skipped, each file is verified (size) before its row is switched, and local copies are only deleted when asked.
// Public website images (media/) and training videos are never moved.
import fs from 'node:fs';
import path from 'node:path';
import { all, run } from '../db.js';
import { getTenantBySlug, platformDb, withTenant } from '../platform.js';
import { putFile, headFile, localFile, isStoredRef, storageEnabled, removeRef } from './storage.js';
import { DATA_DIR } from '../db.js';

/** Where private file references live in a workspace database. */
const SOURCES = [
  { module: 'documents', sql: 'SELECT id, path ref, name, mime FROM documents', set: 'UPDATE documents SET path=? WHERE id=?' },
  { module: 'claims', sql: 'SELECT id, slip_path ref, NULL name, NULL mime FROM payment_claims WHERE slip_path IS NOT NULL', set: 'UPDATE payment_claims SET slip_path=? WHERE id=?' },
  { module: 'content', sql: 'SELECT id, creative_path ref, creative_name name, creative_mime mime FROM content_posts WHERE creative_path IS NOT NULL', set: 'UPDATE content_posts SET creative_path=? WHERE id=?' },
  { module: 'recordings', sql: "SELECT id, path ref, 'call-' || call_id || '-' || id || '.mp3' name, 'audio/mpeg' mime FROM call_recordings WHERE path IS NOT NULL AND path<>''", set: 'UPDATE call_recordings SET path=? WHERE id=?' },
  { module: 'recordings', sql: "SELECT id, path ref, 'meeting-' || meeting_id || '-' || id || CASE WHEN mime LIKE '%mp4%' THEN '.mp4' ELSE '.webm' END name, mime FROM meeting_recordings WHERE path IS NOT NULL AND path NOT IN ('', 'pending')", set: 'UPDATE meeting_recordings SET path=? WHERE id=?' },
];
const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' };

/** Migrate one workspace (call inside nothing; this enters the workspace itself). */
export async function migrateTenant(slug, { dryRun = false, deleteLocal = false, log = () => {} } = {}) {
  const t = getTenantBySlug(slug);
  if (!t) throw new Error(`No workspace with the address "${slug}"`);
  if (!dryRun && !storageEnabled()) throw new Error('Object storage is not configured: set the S3_* environment settings first');
  const out = { slug, files: 0, bytes: 0, moved: 0, skipped: 0, missing: [], failed: [] };
  const jobs = withTenant(t, () => SOURCES.flatMap((s) => all(s.sql).map((r) => ({ ...r, module: s.module, set: s.set }))));
  for (const j of jobs) {
    if (!j.ref || isStoredRef(j.ref)) { out.skipped += 1; continue; }
    const file = withTenant(t, () => localFile(j.ref));
    if (!file || !fs.existsSync(file)) { out.missing.push(j.ref); continue; }
    const size = fs.statSync(file).size;
    out.files += 1; out.bytes += size;
    if (dryRun) continue;
    try {
      const mime = j.mime || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      await withTenant(t, async () => {
        const stored = await putFile(file, { module: j.module, filename: j.name || path.basename(file), mime, size });
        const head = await headFile(stored.ref);
        if (Number(head.size) !== size) { await removeRef(stored.ref); throw new Error(`size mismatch (${head.size} in the bucket, ${size} on disk)`); }
        run(j.set, stored.ref, j.id);
      });
      out.moved += 1;
      if (deleteLocal) fs.rmSync(file, { force: true });
      log(`  moved ${j.ref}`);
    } catch (e) { out.failed.push({ file: j.ref, error: e.message }); }
  }
  // billing payment proofs sit in the control plane, one folder per workspace
  const proofs = platformDb().prepare("SELECT id, proof_file, proof_name, proof_type FROM payment_submissions WHERE tenant_id=? AND proof_file IS NOT NULL AND proof_file NOT LIKE 's3:%'").all(t.id);
  for (const p of proofs) {
    const file = path.join(DATA_DIR, 'billing-proofs', String(t.id), path.basename(p.proof_file));
    if (!fs.existsSync(file)) { out.missing.push(`billing-proofs/${p.proof_file}`); continue; }
    const size = fs.statSync(file).size; out.files += 1; out.bytes += size;
    if (dryRun) continue;
    try {
      const stored = await putFile(file, { module: 'billing', filename: p.proof_name || p.proof_file, mime: p.proof_type, size, tenantId: t.id });
      const head = await headFile(stored.ref, { tenantId: t.id });
      if (Number(head.size) !== size) { await removeRef(stored.ref, { tenantId: t.id }); throw new Error('size mismatch'); }
      platformDb().prepare('UPDATE payment_submissions SET proof_file=? WHERE id=?').run(stored.ref, p.id);
      out.moved += 1;
      if (deleteLocal) fs.rmSync(file, { force: true });
    } catch (e) { out.failed.push({ file: `billing-proofs/${p.proof_file}`, error: e.message }); }
  }
  return out;
}

export async function migrateAll(opts) {
  const slugs = platformDb().prepare("SELECT slug FROM tenants WHERE is_legacy=0 AND data_deleted_at IS NULL ORDER BY id").all().map((r) => r.slug);
  const results = [];
  for (const s of slugs) results.push(await migrateTenant(s, opts));
  return results;
}
