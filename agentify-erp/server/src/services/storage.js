// The one door to tenant files held in object storage (Contabo S3). Everything private a workspace uploads (documents,
// payment slips, content creatives, recordings, billing proofs) is written, read, signed and deleted here and nowhere else.
//
//  * Key:       tenants/{tenant_id}/{module}/{year}/{uuid}-{filename}
//  * Tenant:    always the signed-in workspace (AsyncLocalStorage context), never a request field. `tenantId` can be passed only
//               by server code that already has the tenant row (billing proofs) and is re-checked against the key.
//  * Reference: rows keep `path` = "s3:<key>" for objects in the bucket; any other value is a legacy file on the VPS disk
//               (storage_provider 'local') and keeps working until it is migrated. The full URL is never stored.
//  * Settings:  S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY (environment only, path-style addressing).
//  * Public website images (media/) are NOT stored here: they stay on the VPS so shared pages never break.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { get, run, uploadDir } from '../db.js';
import { currentTenant } from '../context.js';
import { HttpError, now } from '../util.js';

export const S3_PREFIX = 's3:';
export const SIGNED_URL_SECONDS = 900;
/** Folders (the `module` part of a key) that may hold files. */
export const MODULES = ['documents', 'claims', 'content', 'recordings', 'billing', 'training', 'properties', 'projects', 'website', 'hr', 'branding', 'promo', 'other'];

const env = () => ({
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY,
});
export const s3Configured = () => { const e = env(); return !!(e.endpoint && e.region && e.bucket && e.accessKeyId && e.secretAccessKey); };

// ---------------------------------------------------------------- providers
let override = null; // tests inject an in-memory provider
export function setProviderForTests(p) { override = p; }
let cached = null;
function s3Provider() {
  const e = env();
  const sig = [e.endpoint, e.region, e.bucket, e.accessKeyId].join('|');
  if (cached?.sig === sig) return cached.provider;
  const client = new S3Client({ endpoint: e.endpoint, region: e.region, forcePathStyle: true, credentials: { accessKeyId: e.accessKeyId, secretAccessKey: e.secretAccessKey } });
  const Bucket = e.bucket;
  const provider = {
    name: 'contabo_s3',
    async put(Key, body, { mime, size } = {}) {
      await new Upload({ client, params: { Bucket, Key, Body: body, ContentType: mime || 'application/octet-stream' }, queueSize: 3, partSize: 8 * 1024 * 1024 }).done();
      return size;
    },
    async get(Key) { return (await client.send(new GetObjectCommand({ Bucket, Key }))).Body; },
    async head(Key) { const r = await client.send(new HeadObjectCommand({ Bucket, Key })); return { size: r.ContentLength, mime: r.ContentType }; },
    async del(Key) { await client.send(new DeleteObjectCommand({ Bucket, Key })); },
    async url(Key, { seconds, mime, disposition }) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key, ResponseContentType: mime || undefined, ResponseContentDisposition: disposition || undefined }), { expiresIn: seconds });
    },
    /** Every object under a prefix with its size (used by the console sync and by tenant deletion). */
    async list(Prefix) {
      const out = []; let ContinuationToken;
      do {
        const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
        for (const o of r.Contents || []) out.push({ key: o.Key, size: o.Size });
        ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    },
    async delMany(keys) {
      for (let i = 0; i < keys.length; i += 1000) await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) } }));
    },
  };
  cached = { sig, provider };
  return provider;
}
/** The provider new private files go to: the bucket when configured, otherwise null (files stay local, as before). */
export function provider() { return override || (s3Configured() ? s3Provider() : null); }
export const storageEnabled = () => !!provider();

// ---------------------------------------------------------------- keys and the tenant guard
const bad = (m) => new HttpError(400, m);
/** Original name reduced to safe characters; the extension is kept. */
export function safeName(name) {
  const base = path.basename(String(name || 'file').replace(/\\/g, '/'));
  const ext = path.extname(base).replace(/[^A-Za-z0-9.]/g, '').slice(0, 12).toLowerCase();
  const stem = base.slice(0, base.length - path.extname(base).length).normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  return `${stem || 'file'}${ext}`;
}
export const sessionTenantId = () => { const id = currentTenant()?.id; return id == null ? null : Number(id); };
export function buildKey(tenantId, module, filename, { date = new Date(), uuid = crypto.randomUUID() } = {}) {
  if (!Number.isInteger(tenantId) || tenantId < 1) throw bad('No workspace for this file');
  if (!MODULES.includes(module)) throw bad('Unknown file area');
  return `tenants/${tenantId}/${module}/${date.getUTCFullYear()}/${uuid}-${safeName(filename)}`;
}
const KEY_SHAPE = /^tenants\/(\d+)\/([a-z]+)\/(\d{4})\/[0-9a-f-]{36}-[A-Za-z0-9._-]+$/;
/** A tenant may only ever touch keys under its own tenants/{id}/ folder. Throws for anything else (traversal, another tenant, odd encodings). */
export function assertKeyBelongsToTenant(key, tenantId) {
  const k = String(key ?? '');
  let dec = k;
  try { dec = decodeURIComponent(k); } catch { throw new HttpError(403, 'This file is not available'); }
  const m = KEY_SHAPE.exec(k);
  if (!Number.isInteger(tenantId) || tenantId < 1 || !m || Number(m[1]) !== tenantId || !MODULES.includes(m[2]) || dec !== k || /\.\.|\/\/|\\|\0/.test(k) || k.startsWith('/')) {
    throw new HttpError(403, 'This file is not available');
  }
  return k;
}
export const isStoredRef = (p) => typeof p === 'string' && p.startsWith(S3_PREFIX);
export const refOf = (key) => `${S3_PREFIX}${key}`;
export const keyOf = (ref) => String(ref).slice(S3_PREFIX.length);
const tenantFor = (opt) => { const id = opt?.tenantId != null ? Number(opt.tenantId) : sessionTenantId(); if (!id) throw new HttpError(403, 'This file is not available'); return id; };

// ---------------------------------------------------------------- per-workspace file register (the database record)
export function recordFile({ key, tenantId, module, size, mime, name, provider: prov = 'contabo_s3' }) {
  run('INSERT OR REPLACE INTO stored_files(file_key, tenant_id, module, size_bytes, mime_type, original_name, storage_provider, created_at) VALUES(?,?,?,?,?,?,?,?)',
    key, tenantId, module, size ?? 0, mime || null, name ? String(name).slice(0, 200) : null, prov, now());
}
export const fileRow = (key) => get('SELECT * FROM stored_files WHERE file_key=?', key);
export const forgetFile = (key) => run('DELETE FROM stored_files WHERE file_key=?', key);

// ---------------------------------------------------------------- write / read / sign / delete
/**
 * Store a file (local temp path or Buffer) under the workspace's own folder. Returns the reference to save in the row's
 * `path` column plus the fields of the register. The caller deletes its temp file afterwards.
 */
export async function putFile(source, { module, filename, mime, size, tenantId: forTenant } = {}) {
  const p = provider();
  if (!p) throw new HttpError(503, 'File storage is not configured');
  const tenantId = tenantFor({ tenantId: forTenant });
  const key = assertKeyBelongsToTenant(buildKey(tenantId, module, filename), tenantId);
  const body = Buffer.isBuffer(source) ? source : fs.createReadStream(source);
  const bytes = size ?? (Buffer.isBuffer(source) ? source.length : fs.statSync(source).size);
  await p.put(key, body, { mime, size: bytes });
  const out = { key, ref: refOf(key), tenant_id: tenantId, module, size_bytes: bytes, mime_type: mime || null, storage_provider: p.name };
  if (forTenant == null) recordFile({ key, tenantId, module, size: bytes, mime, name: filename, provider: p.name });
  return out;
}
export async function getStream(ref, opt) {
  const p = provider(); if (!p) throw new HttpError(503, 'File storage is not configured');
  return p.get(assertKeyBelongsToTenant(keyOf(ref), tenantFor(opt)));
}
export async function getBuffer(ref, opt) {
  const s = await getStream(ref, opt); const chunks = [];
  for await (const c of s) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}
export async function headFile(ref, opt) {
  const p = provider(); if (!p) throw new HttpError(503, 'File storage is not configured');
  return p.head(assertKeyBelongsToTenant(keyOf(ref), tenantFor(opt)));
}
/** A link that works for about 15 minutes. Callers must already have checked that the signed-in user may see this record. */
export async function signedUrl(ref, { seconds = SIGNED_URL_SECONDS, mime, name, download = false, tenantId } = {}) {
  const p = provider(); if (!p) throw new HttpError(503, 'File storage is not configured');
  const key = assertKeyBelongsToTenant(keyOf(ref), tenantFor({ tenantId }));
  const disposition = name ? `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}` : undefined;
  return p.url(key, { seconds: Math.min(Math.max(Number(seconds) || SIGNED_URL_SECONDS, 30), SIGNED_URL_SECONDS), mime, disposition });
}
/** Delete the object behind a reference; a legacy local path is removed from disk instead. Never throws for "already gone". */
export async function removeRef(ref, opt) {
  if (!ref) return;
  if (isStoredRef(ref)) {
    const p = provider(); if (!p) return;
    const key = assertKeyBelongsToTenant(keyOf(ref), tenantFor(opt));
    try { await p.del(key); } catch { /* already gone */ }
    if (opt?.tenantId == null) { try { forgetFile(key); } catch { /* register row missing */ } }
    return;
  }
  const f = localFile(ref);
  if (f) fs.rm(f, { force: true }, () => {});
}
/** Delete everything a workspace has in the bucket (used when a workspace's data is removed). */
export async function removeTenantPrefix(tenantId) {
  const p = provider(); if (!p || !Number.isInteger(Number(tenantId)) || Number(tenantId) < 1) return 0;
  const objs = await p.list(`tenants/${Number(tenantId)}/`);
  await p.delMany(objs.map((o) => o.key));
  return objs.length;
}
/** Live count of the bucket per workspace folder (console "Sync"). Returns Map(tenantId -> { files, bytes }) and the total. */
export async function listUsage() {
  const p = provider(); if (!p) return null;
  const per = new Map(); let total = 0;
  for (const o of await p.list('tenants/')) {
    const id = Number(/^tenants\/(\d+)\//.exec(o.key)?.[1]); if (!id) continue;
    const t = per.get(id) || { files: 0, bytes: 0 }; t.files += 1; t.bytes += o.size; per.set(id, t); total += o.size;
  }
  return { per, total };
}

// ---------------------------------------------------------------- legacy local files
/** Absolute path of a legacy file inside the workspace's own upload folder, or null when it points anywhere else. */
export function localFile(rel) {
  if (!rel || isStoredRef(rel)) return null;
  const root = path.resolve(uploadDir());
  const file = path.resolve(root, String(rel));
  return file.startsWith(root + path.sep) ? file : null;
}
export const isLocalRef = (p) => !!p && !isStoredRef(p);

/**
 * Answer a request with a stored file. Bucket objects: browsers loading an image, video, audio or downloading a document
 * are sent to a 15-minute signed link; scripted fetches and framed documents are streamed through the app, so the
 * Content-Security-Policy and same-origin fetches keep working. Legacy local files are served from disk as before.
 */
export async function sendStored(req, res, ref, { mime, name, download = false, tenantId } = {}) {
  const type = mime || 'application/octet-stream';
  const disposition = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name || 'file')}`;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (isStoredRef(ref)) {
    const dest = String(req.headers['sec-fetch-dest'] || '');
    if (['document', 'image', 'video', 'audio'].includes(dest) || (download && dest !== 'empty' && dest !== 'iframe')) {
      return res.redirect(302, await signedUrl(ref, { mime: type, name, download, tenantId }));
    }
    let body;
    try { body = await getStream(ref, { tenantId }); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(404, 'File missing'); }
    res.setHeader('Content-Type', type); res.setHeader('Content-Disposition', disposition); res.setHeader('Cache-Control', 'private, no-store');
    return body.pipe(res);
  }
  const file = localFile(ref);
  if (!file || !fs.existsSync(file)) throw new HttpError(404, 'File missing');
  res.setHeader('Content-Type', type); res.setHeader('Content-Disposition', disposition);
  return res.sendFile(file);
}

/** Bytes of private files this workspace keeps in the bucket (from the register; exact, no scanning). */
export const privateBytes = () => Number(get('SELECT COALESCE(SUM(size_bytes),0) n FROM stored_files').n);
