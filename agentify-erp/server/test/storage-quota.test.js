import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Storage quota: checked before every upload, counted exactly, warned at 80% and 100%, editable per plan and per workspace,
// and summed for the console against the bucket total.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-quota-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1' });

const S = await import('../src/services/storage.js');
const Q = await import('../src/services/storageAlerts.js');
const P = await import('../src/services/plans.js');
const { createApp } = await import('../src/index.js');
const { getTenantBySlug, getTenant, withTenant, platformDb } = await import('../src/platform.js');
const { setEntitlements } = await import('../src/services/platformTenants.js');
const { outbox } = await import('../src/services/mailer.js');
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
    res.on('end', () => { const buf = Buffer.concat(chunks); let d = buf.toString(); try { d = JSON.parse(d); } catch { /* text */ } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const signup = (slug, email) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', region: 'PK' });
const login = async (host, id) => { const l = await call(host, 'POST', '/api/auth/login', { identifier: id, password: 'Tenant@12345' }); assert.equal(l.status, 200); return { c: l.cookie, host }; };
const upload = (w, bytes, name = 'f.pdf') => {
  const b = '----q' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="entity_type"\r\n\r\ncontact\r\n--${b}\r\nContent-Disposition: form-data; name="entity_id"\r\n\r\n1\r\n--${b}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`),
    Buffer.alloc(bytes, 'a'), Buffer.from(`\r\n--${b}--\r\n`)]);
  return call(w.host, 'POST', '/api/documents', null, { cookie: w.c, 'Content-Type': `multipart/form-data; boundary=${b}` }, body);
};
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const MB = 1048576;

test('uploads are checked against the quota, counted exactly, and warned at 80% and 100%', async () => {
  assert.equal((await signup('quota', 'owner@quota.test')).status, 201);
  const w = await login('quota.erp.test', 'owner@quota.test');
  S.setProviderForTests(memory);
  let t = getTenantBySlug('quota');
  setEntitlements(t.id, { storage_mb: 1, reason: 'test quota' }, 'tester');
  t = getTenant(t.id);
  withTenant(t, () => assert.equal(P.storageQuotaBytes(t), MB));

  const first = await upload(w, 400 * 1024, 'a.pdf');
  assert.equal(first.status, 201, JSON.stringify(first.data));
  await wait();
  withTenant(t, () => assert.equal(S.privateBytes(), 400 * 1024));
  assert.equal(outbox.filter((m) => m.to === 'owner@quota.test' && /file storage/.test(m.subject)).length, 0, 'under 75%: nothing sent');

  // too big for what is left: refused up front with a clear message, nothing stored
  const n = bucket.size;
  const big = await upload(w, 700 * 1024, 'big.pdf');
  assert.equal(big.status, 402);
  assert.equal(big.data.code, 'storage_limit');
  assert.match(big.data.error, /needs 7\d\d KB but only 6\d\d KB of your 1024 KB|needs .* but only .* left/);
  assert.equal(bucket.size, n);

  // crossing 80% sends one warning, once
  assert.equal((await upload(w, 450 * 1024, 'b.pdf')).status, 201);
  await wait(200);
  let warn = outbox.filter((m) => m.to === 'owner@quota.test' && /% full/.test(m.subject));
  assert.equal(warn.length, 1, JSON.stringify(outbox.map((m) => m.subject)));
  assert.match(warn[0].subject, /83% full/);
  assert.equal((await upload(w, 10 * 1024, 'c.pdf')).status, 201);
  await wait(200);
  assert.equal(outbox.filter((m) => m.to === 'owner@quota.test' && /% full/.test(m.subject)).length, 1, 'no second warning');

  // 100%: the last bytes fit, then uploads are blocked and the upgrade notice goes out once
  const left = MB - (400 + 450 + 10) * 1024;
  assert.equal((await upload(w, left, 'd.pdf')).status, 201);
  await wait(200);
  const full = outbox.filter((m) => m.to === 'owner@quota.test' && /is full/.test(m.subject));
  assert.equal(full.length, 1);
  assert.match(full[0].text, /upgrade/i);
  const blocked = await upload(w, 1024, 'e.pdf');
  assert.equal(blocked.status, 402);
  assert.match(blocked.data.error, /full/);
  assert.equal(blocked.data.upgrade, true);
  await wait(100);
  assert.equal(outbox.filter((m) => m.to === 'owner@quota.test' && /is full/.test(m.subject)).length, 1);

  // freeing space resets the flags, and the quota can be raised for this workspace alone
  const docs = withTenant(t, () => dbm.all('SELECT id FROM documents WHERE entity_type=?', 'contact'));
  for (const d of docs) await call(w.host, 'DELETE', `/api/documents/${d.id}`, null, { cookie: w.c });
  await wait(200);
  withTenant(t, () => assert.equal(S.privateBytes(), 0));
  await withTenant(t, () => Q.checkStorageAlerts(t));
  const flags = platformDb().prepare('SELECT storage_warned_at w, storage_full_notified_at f FROM tenants WHERE id=?').get(t.id);
  assert.deepEqual({ ...flags }, { w: null, f: null });
  setEntitlements(t.id, { storage_mb: 5, reason: 'raised' }, 'tester');
  assert.equal((await upload(w, 2 * MB, 'g.pdf')).status, 201);
  S.setProviderForTests(null);
});

test('unlimited plans are never blocked, and the console overview sums usage, quotas and the bucket', async () => {
  assert.equal((await signup('quotb', 'owner@quotb.test')).status, 201);
  const w = await login('quotb.erp.test', 'owner@quotb.test');
  S.setProviderForTests(memory);
  const t = getTenantBySlug('quotb');
  setEntitlements(t.id, { storage_mb: null, reason: 'unlimited for test' }, 'tester');
  assert.equal((await upload(w, 3 * MB, 'u.pdf')).status, 201);

  const o = await Q.overview();
  const a = o.tenants.find((x) => x.slug === 'quota'), b = o.tenants.find((x) => x.slug === 'quotb');
  assert.equal(b.quota_bytes, null); assert.equal(b.private_bytes, 3 * MB); assert.equal(b.pct, null);
  assert.equal(a.override_mb, 5); assert.equal(a.quota_mb, 5);
  assert.equal(o.bucket.total_gb, 250);
  assert.ok(o.totals.quota_sold_bytes >= 5 * MB && o.totals.unlimited >= 1);
  assert.ok(o.plans.some((p) => p.id === 'starter' && p.storage_mb === 2048), 'plans listed with their current storage');

  // live count of the bucket per workspace folder
  const sync = await Q.syncBucket('tester');
  assert.equal(sync.workspaces >= 1, true);
  const o2 = await Q.overview();
  assert.equal(o2.tenants.find((x) => x.slug === 'quotb').bucket_bytes, 3 * MB);
  assert.equal(o2.bucket.used_bytes, [...bucket.values()].reduce((n, x) => n + x.length, 0));
  assert.ok(o2.bucket.synced_at);

  assert.equal(Q.setTotalGb(300, 'tester'), 300);
  assert.throws(() => Q.setTotalGb(0, 'tester'), /from 1/);
  S.setProviderForTests(null);
  await assert.rejects(Q.syncBucket('tester'), /not configured/);
});

test('a workspace quota can be set, made unlimited or reset to the plan without losing its other limits', async () => {
  assert.equal((await signup('quotc', 'owner@quotc.test')).status, 201);
  const t = getTenantBySlug('quotc');
  setEntitlements(t.id, { seats: 9, reason: 'nine seats' }, 'tester');
  const mbOf = () => { const o = JSON.parse(getTenant(t.id).entitlements || 'null'); return o; };
  Q.setWorkspaceQuota(t.id, { mb: 3072, reason: 'agreed 3 GB' }, 'tester');
  assert.deepEqual(mbOf(), { seats: 9, storage_mb: 3072 });
  assert.equal(withTenant(getTenant(t.id), () => P.storageQuotaBytes(getTenant(t.id))), 3072 * MB);
  Q.setWorkspaceQuota(t.id, { mb: 'unlimited', reason: 'enterprise deal' }, 'tester');
  assert.equal(withTenant(getTenant(t.id), () => P.storageQuotaBytes(getTenant(t.id))), null);
  Q.setWorkspaceQuota(t.id, { mb: 'plan', reason: 'back to plan' }, 'tester');
  assert.deepEqual(mbOf(), { seats: 9 });
  assert.throws(() => Q.setWorkspaceQuota(t.id, { mb: 0, reason: 'bad value' }, 'tester'), /from 1/);
  assert.throws(() => Q.setWorkspaceQuota(t.id, { mb: 10, reason: '' }, 'tester'), /reason/);
  assert.throws(() => Q.setWorkspaceQuota(9999, { mb: 10, reason: 'nobody here' }, 'tester'), /not found/);
});
