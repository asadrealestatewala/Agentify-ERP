import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Tenant files in object storage: key format, the tenant path guard, private uploads, signed links and legacy local files.
// An in-memory provider stands in for the bucket (no network); the S3 settings themselves come only from the environment.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-storage-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1' });

const S = await import('../src/services/storage.js');
const { createApp } = await import('../src/index.js');
const { getTenantBySlug, withTenant } = await import('../src/platform.js');
const dbm = await import('../src/db.js');

/** A bucket that lives in a Map. `urls` records every signed link that was asked for. */
const bucket = new Map(); const urls = [];
const memory = {
  name: 'contabo_s3',
  async put(key, body) { const chunks = []; if (Buffer.isBuffer(body)) chunks.push(body); else for await (const c of body) chunks.push(Buffer.from(c)); bucket.set(key, Buffer.concat(chunks)); },
  async get(key) { if (!bucket.has(key)) throw new Error('NoSuchKey'); const { Readable } = await import('node:stream'); return Readable.from([bucket.get(key)]); },
  async head(key) { return { size: bucket.get(key).length }; },
  async del(key) { bucket.delete(key); },
  async url(key, { seconds, disposition }) { urls.push({ key, seconds, disposition }); return `https://bucket.test/${key}?expires=${seconds}`; },
  async list(prefix) { return [...bucket].filter(([k]) => k.startsWith(prefix)).map(([key, b]) => ({ key, size: b.length })); },
  async delMany(keys) { for (const k of keys) bucket.delete(k); },
};

let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { S.setProviderForTests(null); server.close(); dbm.closeDbs(); });

const call = (host, method, url, body, headers = {}, raw = null) => new Promise((resolve, reject) => {
  const data = raw || (body ? JSON.stringify(body) : null);
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const buf = Buffer.concat(chunks); let d = buf.toString(); try { d = JSON.parse(d); } catch { /* not json */ } resolve({ status: res.statusCode, data: d, buf, headers: res.headers, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const signup = (slug, email) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', region: 'PK' });
async function login(host, identifier) {
  const l = await call(host, 'POST', '/api/auth/login', { identifier, password: 'Tenant@12345' });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  return { c: l.cookie, host };
}
const upload = (w, fields, file) => {
  const b = '----erp' + Math.random().toString(16).slice(2);
  const parts = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('')
    + `--${b}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n${file.body}\r\n--${b}--\r\n`;
  return call(w.host, 'POST', '/api/documents', null, { cookie: w.c, 'Content-Type': `multipart/form-data; boundary=${b}` }, parts);
};

test('keys follow tenants/{id}/{module}/{year}/{uuid}-{filename} and names are made safe', () => {
  const k = S.buildKey(7, 'documents', '../../Contract (final).pdf', { date: new Date('2027-03-04T00:00:00Z'), uuid: '123e4567-e89b-12d3-a456-426614174000' });
  assert.equal(k, 'tenants/7/documents/2027/123e4567-e89b-12d3-a456-426614174000-Contract-final.pdf');
  assert.equal(S.assertKeyBelongsToTenant(k, 7), k);
  assert.equal(S.safeName('a/b\\c d?.PNG'), 'c-d.png');
  assert.throws(() => S.buildKey(7, 'nope', 'x.pdf'), /Unknown file area/);
  assert.throws(() => S.buildKey(0, 'documents', 'x.pdf'), /No workspace/);
});

test('the path guard refuses another workspace, traversal and odd encodings', () => {
  const ok = 'tenants/7/documents/2027/123e4567-e89b-12d3-a456-426614174000-a.pdf';
  S.assertKeyBelongsToTenant(ok, 7);
  const refused = [
    [ok, 8], [ok, null], [ok, 0], [ok, '7'],
    ['tenants/70/documents/2027/123e4567-e89b-12d3-a456-426614174000-a.pdf', 7],
    ['tenants/7/../8/documents/2027/123e4567-e89b-12d3-a456-426614174000-a.pdf', 7],
    ['/tenants/7/documents/2027/123e4567-e89b-12d3-a456-426614174000-a.pdf', 7],
    ['tenants/7/documents/2027/123e4567-e89b-12d3-a456-426614174000-%2e%2e.pdf', 7],
    ['tenants/7/documents//2027/123e4567-e89b-12d3-a456-426614174000-a.pdf', 7],
    ['tenants/7/documents/2027/123e4567-e89b-12d3-a456-426614174000-a\\b.pdf', 7],
    ['tenants/7/documents/2027/123e4567-e89b-12d3-a456-426614174000-a.pdf\0', 7],
    ['tenants/7/secrets/2027/123e4567-e89b-12d3-a456-426614174000-a.pdf', 7],
    ['documents/abc.pdf', 7], ['', 7], [undefined, 7],
  ];
  for (const [key, id] of refused) assert.throws(() => S.assertKeyBelongsToTenant(key, id), (e) => e.status === 403, `${JSON.stringify(key)} for ${id}`);
});

test('without S3 settings private files stay where they were; with them, uploads go to the workspace folder of the bucket', async () => {
  assert.equal(S.storageEnabled(), false);
  S.setProviderForTests(null);
  assert.equal((await signup('stoa', 'owner@stoa.test')).status, 201);
  assert.equal((await signup('stob', 'owner@stob.test')).status, 201);
  const A = await login('stoa.erp.test', 'owner@stoa.test'), B = await login('stob.erp.test', 'owner@stob.test');
  const ta = getTenantBySlug('stoa'), tb = getTenantBySlug('stob');

  // legacy behaviour: no bucket, the file is saved in the workspace's upload folder and served from disk
  const local = await upload(A, { entity_type: 'contact', entity_id: '1' }, { name: 'old.pdf', type: 'application/pdf', body: '%PDF-1.4 local' });
  assert.equal(local.status, 201, JSON.stringify(local.data));
  const localRow = withTenant(ta, () => dbm.get('SELECT * FROM documents WHERE id=?', local.data.ids[0]));
  assert.match(localRow.path, /^documents\/[0-9a-f]{32}\.pdf$/);
  assert.equal((await call(A.host, 'GET', `/api/documents/${local.data.ids[0]}/file`, null, { cookie: A.c })).buf.toString(), '%PDF-1.4 local');

  // bucket on
  S.setProviderForTests(memory);
  const up = await upload(A, { entity_type: 'contact', entity_id: '1' }, { name: 'Title Deed.pdf', type: 'application/pdf', body: '%PDF-1.4 secret deed' });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const row = withTenant(ta, () => dbm.get('SELECT * FROM documents WHERE id=?', up.data.ids[0]));
  assert.match(row.path, new RegExp(`^s3:tenants/${ta.id}/documents/${new Date().getUTCFullYear()}/[0-9a-f-]{36}-Title-Deed\\.pdf$`));
  assert.ok(bucket.has(S.keyOf(row.path)), 'the object is in the bucket');
  assert.ok(!fs.existsSync(path.join(ta.upload_dir, 'documents')) || fs.readdirSync(path.join(ta.upload_dir, 'documents')).length === 1, 'no new file on the VPS disk');
  const reg = withTenant(ta, () => dbm.get('SELECT * FROM stored_files WHERE file_key=?', S.keyOf(row.path)));
  assert.deepEqual({ t: reg.tenant_id, s: reg.size_bytes, m: reg.mime_type, p: reg.storage_provider, mod: reg.module }, { t: ta.id, s: 20, m: 'application/pdf', p: 'contabo_s3', mod: 'documents' });
  assert.ok(!JSON.stringify(row).includes('http'), 'no URL is stored');

  // a scripted request (fetch) gets the bytes through the app; a browser navigation gets a 15 minute signed link
  const viaApp = await call(A.host, 'GET', `/api/documents/${up.data.ids[0]}/file`, null, { cookie: A.c, 'Sec-Fetch-Dest': 'empty' });
  assert.equal(viaApp.status, 200); assert.equal(viaApp.buf.toString(), '%PDF-1.4 secret deed');
  const nav = await call(A.host, 'GET', `/api/documents/${up.data.ids[0]}/file?download=1`, null, { cookie: A.c, 'Sec-Fetch-Dest': 'document' });
  assert.equal(nav.status, 302);
  assert.match(nav.headers.location, /^https:\/\/bucket\.test\/tenants\/\d+\/documents\//);
  const signed = urls.at(-1);
  assert.equal(signed.key, S.keyOf(row.path)); assert.equal(signed.seconds, 900);
  assert.match(signed.disposition, /^attachment; filename\*=UTF-8''Title%20Deed\.pdf$/);

  // no session, no link
  assert.equal((await call(A.host, 'GET', `/api/documents/${up.data.ids[0]}/file`, null, { 'Sec-Fetch-Dest': 'document' })).status, 401);
  // another workspace cannot reach it: its own database has no such document, and A's cookie is useless on B
  assert.equal((await call(B.host, 'GET', `/api/documents/${up.data.ids[0]}/file`, null, { cookie: B.c, 'Sec-Fetch-Dest': 'document' })).status, 404);
  assert.equal((await call(B.host, 'GET', `/api/documents/${up.data.ids[0]}/file`, null, { cookie: A.c, 'Sec-Fetch-Dest': 'document' })).status, 401);

  // even a row in B that points at A's key is refused by the guard, and nothing is signed
  const before = urls.length;
  const forged = withTenant(tb, () => Number(dbm.run("INSERT INTO documents(entity_type,entity_id,category,name,path,mime,size,portal_visible,uploaded_by,created_at) VALUES('contact',1,'Other','x.pdf',?, 'application/pdf',1,0,1,datetime('now'))", row.path).lastInsertRowid));
  for (const dest of ['document', 'empty']) assert.equal((await call(B.host, 'GET', `/api/documents/${forged}/file`, null, { cookie: B.c, 'Sec-Fetch-Dest': dest })).status, 403);
  assert.equal(urls.length, before, 'no link was signed for the other workspace');
  assert.equal(bucket.has(S.keyOf(row.path)), true);

  // module level: A's reference cannot be signed, read or deleted for B, whatever tenant id is claimed
  await assert.rejects(S.signedUrl(row.path, { tenantId: tb.id }), (e) => e.status === 403);
  await assert.rejects(S.getBuffer(row.path, { tenantId: tb.id }), (e) => e.status === 403);
  await S.removeRef(row.path, { tenantId: tb.id }).catch(() => {});
  assert.equal(bucket.has(S.keyOf(row.path)), true, 'B could not delete it');
  await assert.rejects(withTenant(tb, () => S.getBuffer(row.path)), (e) => e.status === 403);

  // the legacy file keeps working while the bucket is on
  assert.equal((await call(A.host, 'GET', `/api/documents/${local.data.ids[0]}/file`, null, { cookie: A.c })).buf.toString(), '%PDF-1.4 local');

  // deleting the document removes the object and its register row
  assert.equal((await call(A.host, 'DELETE', `/api/documents/${up.data.ids[0]}`, null, { cookie: A.c })).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(bucket.has(S.keyOf(row.path)), false);
  assert.equal(withTenant(ta, () => dbm.get('SELECT 1 FROM stored_files WHERE file_key=?', S.keyOf(row.path))), undefined);

  // a workspace's whole folder can be removed without touching another's
  await withTenant(ta, () => S.putFile(Buffer.from('a'), { module: 'documents', filename: 'a.txt', mime: 'text/plain' }));
  await withTenant(tb, () => S.putFile(Buffer.from('b'), { module: 'documents', filename: 'b.txt', mime: 'text/plain' }));
  assert.equal(await S.removeTenantPrefix(ta.id), 1);
  assert.deepEqual([...bucket.keys()].map((k) => k.split('/')[1]), [String(tb.id)]);
  S.setProviderForTests(null);
});

test('a file that is refused after it arrived is not left in the bucket', async () => {
  S.setProviderForTests(memory);
  const A = await login('stoa.erp.test', 'owner@stoa.test');
  const n = bucket.size;
  const r = await upload(A, { entity_type: 'nonsense', entity_id: '1' }, { name: 'x.pdf', type: 'application/pdf', body: '%PDF x' });
  assert.equal(r.status, 400);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(bucket.size, n);
  const bad = await upload(A, { entity_type: 'contact', entity_id: '1' }, { name: 'virus.exe', type: 'application/octet-stream', body: 'MZ' });
  assert.equal(bad.status, 400);
  assert.equal(bucket.size, n);
  S.setProviderForTests(null);
});
