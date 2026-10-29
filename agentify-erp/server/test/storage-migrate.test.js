import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Moving a workspace's existing local files into the bucket: dry run first, verified copies, rows switched, safe to repeat.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-migrate-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1' });

const S = await import('../src/services/storage.js');
const M = await import('../src/services/storageMigrate.js');
const { createApp } = await import('../src/index.js');
const { getTenantBySlug, withTenant } = await import('../src/platform.js');
const dbm = await import('../src/db.js');

const bucket = new Map();
const memory = {
  name: 'contabo_s3',
  async put(key, body) { const c = []; if (Buffer.isBuffer(body)) c.push(body); else for await (const x of body) c.push(Buffer.from(x)); bucket.set(key, Buffer.concat(c)); },
  async get(key) { const { Readable } = await import('node:stream'); return Readable.from([bucket.get(key)]); },
  async head(key) { return { size: bucket.get(key).length }; },
  async del(key) { bucket.delete(key); },
  async url(key) { return `https://bucket.test/${key}`; },
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
    res.on('end', () => { const buf = Buffer.concat(chunks); let d = buf.toString(); try { d = JSON.parse(d); } catch { /* text */ } resolve({ status: res.statusCode, data: d, buf, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

test('existing local files move to the workspace folder of the bucket and keep working', async () => {
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'migr', company_name: 'Migr Realty', admin_name: 'Owner', admin_email: 'owner@migr.test', admin_password: 'Tenant@12345', region: 'PK' });
  assert.equal(su.status, 201);
  const l = await call('migr.erp.test', 'POST', '/api/auth/login', { identifier: 'owner@migr.test', password: 'Tenant@12345' });
  const ck = { cookie: l.cookie };
  const t = getTenantBySlug('migr');
  // two legacy files exactly as the old code stored them
  fs.mkdirSync(path.join(t.upload_dir, 'documents'), { recursive: true });
  fs.writeFileSync(path.join(t.upload_dir, 'documents', 'aaaa.pdf'), '%PDF old one');
  fs.writeFileSync(path.join(t.upload_dir, 'documents', 'bbbb.pdf'), '%PDF old two!');
  const ids = withTenant(t, () => ['aaaa', 'bbbb'].map((n) => Number(dbm.run("INSERT INTO documents(entity_type,entity_id,category,name,path,mime,size,portal_visible,uploaded_by,created_at) VALUES('contact',1,'Other',?,?,'application/pdf',10,0,1,datetime('now'))", `${n}.pdf`, `documents/${n}.pdf`).lastInsertRowid)));
  withTenant(t, () => dbm.run("INSERT INTO documents(entity_type,entity_id,category,name,path,mime,size,portal_visible,uploaded_by,created_at) VALUES('contact',1,'Other','gone.pdf','documents/gone.pdf','application/pdf',1,0,1,datetime('now'))"));

  const dry = await M.migrateTenant('migr', { dryRun: true });
  assert.deepEqual({ files: dry.files, moved: dry.moved, missing: dry.missing.length }, { files: 2, moved: 0, missing: 1 });
  assert.equal(bucket.size, 0);
  await assert.rejects(M.migrateTenant('migr', {}), /not configured/);

  S.setProviderForTests(memory);
  const real = await M.migrateTenant('migr', {});
  assert.deepEqual({ moved: real.moved, failed: real.failed.length }, { moved: 2, failed: 0 });
  const rows = withTenant(t, () => ids.map((id) => dbm.get('SELECT path FROM documents WHERE id=?', id).path));
  for (const r of rows) assert.match(r, new RegExp(`^s3:tenants/${t.id}/documents/\\d{4}/`));
  assert.equal(bucket.size, 2);
  assert.ok(fs.existsSync(path.join(t.upload_dir, 'documents', 'aaaa.pdf')), 'local copies stay unless asked');
  assert.equal(withTenant(t, () => S.privateBytes()), 12 + 13);

  // the app now serves them from the bucket, and a second run changes nothing
  const got = await call('migr.erp.test', 'GET', `/api/documents/${ids[0]}/file`, null, { ...ck, 'Sec-Fetch-Dest': 'empty' });
  assert.equal(got.buf.toString(), '%PDF old one');
  const again = await M.migrateTenant('migr', {});
  assert.deepEqual({ moved: again.moved, files: again.files }, { moved: 0, files: 0 });
  assert.equal(bucket.size, 2);

  // deleting local copies is a separate, explicit step (the files are already in the bucket, so this run just removes nothing new)
  withTenant(t, () => dbm.run("UPDATE documents SET path='documents/aaaa.pdf' WHERE id=?", ids[0]));
  const del = await M.migrateTenant('migr', { deleteLocal: true });
  assert.equal(del.moved, 1);
  assert.ok(!fs.existsSync(path.join(t.upload_dir, 'documents', 'aaaa.pdf')));
  S.setProviderForTests(null);
});
