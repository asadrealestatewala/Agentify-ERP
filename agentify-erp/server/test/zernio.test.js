import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Content calendar with approval and posting through Zernio (simulated Zernio): stages, approval, caps, failures and Retry, webhook, key secrecy.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-creative-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const { platformDb, getTenantBySlug } = await import('../src/platform.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const { runDue } = await import('../src/services/socialCalendar.js');
const { withTenant, getTenant } = await import('../src/platform.js');
const crypto = await import('node:crypto');
const dbm = await import('../src/db.js');



const KEY = 'sk_' + 'a1'.repeat(32);
const zlog = []; let zFail = false, zStatus = 'published'; const zAccounts = [];
let server, port;
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 280 } }), { status: 200 });
    if (u.startsWith('https://zernio.test/')) {
      const path = u.replace('https://zernio.test/api/v1', '').split('?')[0]; const method = opts.method || 'GET';
      const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
      zlog.push({ path, method, body, auth: opts.headers?.Authorization, rid: opts.headers?.['x-request-id'] });
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
      if (opts.headers?.Authorization !== `Bearer ${KEY}`) return json({ error: 'bad key' }, 401);
      if (path === '/profiles') return json({ profile: { _id: 'prof-' + (body.externalId || 'x') } });
      if (path === '/accounts' && method === 'GET') return json({ accounts: zAccounts });
      if (path.startsWith('/connect/')) return json({ authUrl: 'https://zernio.test/oauth/' + path.split('/')[2] });
      if (path === '/media/presign') return json({ uploadUrl: 'https://upload.zernio.test/put/1', publicUrl: 'https://media.zernio.test/temp/1.png' });
      if (path === '/posts' && method === 'POST') {
        if (zFail) return json({ error: 'platform down' }, 500);
        const id = 'zp' + zlog.length;
        zPosts[id] = { _id: id, status: zStatus, platforms: body.platforms.map((p) => ({ platform: p.platform, accountId: p.accountId, status: zStatus, error: zStatus === 'failed' ? 'Media could not be processed' : undefined })) };
        return json({ post: zPosts[id] });
      }
      if (path.startsWith('/posts/') && method === 'GET') return json({ post: zPosts[path.split('/')[2]] });
      if (path === '/webhooks/settings') return json({ ok: true });
      return json({ error: 'unexpected ' + path }, 404);
    }
    if (u.startsWith('https://upload.zernio.test/')) return new Response('', { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  };
  process.env.ZERNIO_API_BASE = 'https://zernio.test/api/v1';
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
const zPosts = {};
after(async () => { globalThis.fetch = realFetch; server.close(); dbm.closeDbs(); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c));
    res.on('end', () => { const buf = Buffer.concat(ch); let d; try { d = JSON.parse(buf.toString()); } catch { d = buf; } resolve({ status: res.statusCode, data: d, headers: res.headers, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const A = '/api/platform/admin';
const as = (cookie, method, url, body) => call('erp.test', method, `${A}${url}`, body, { cookie });
const signup = (slug, email) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', region: 'PK' });
const login = async (slug, id) => { const host = `${slug}.erp.test`; const l = await call(host, 'POST', '/api/auth/login', { identifier: id, password: 'Tenant@12345' }); assert.equal(l.status, 200); return (m, u, b) => call(host, m, u, b, { cookie: l.cookie }); };



const ymd = (d) => d.toISOString().slice(0, 10);
const YESTERDAY = ymd(new Date(Date.now() - 2 * 86400000));

test('Zernio posting: key secrecy, rollout switch, approval, publishing, caps, failures and Retry, webhook', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await signup('zn', 'owner@zn.test')).status, 201);
  const a = await login('zn', 'owner@zn.test'); const tid = getTenantBySlug('zn').id;

  // the key is write-only: accepted, tested, never returned
  assert.equal((await as(owner, 'PUT', '/social/zernio', { key: 'not-a-key' })).status, 400);
  const saved = await as(owner, 'PUT', '/social/zernio', { key: KEY, mode: 'platform' });
  assert.equal(saved.status, 200); assert.ok(!JSON.stringify(saved.data).includes(KEY)); assert.equal(saved.data.key.hint, '…' + KEY.slice(-4));
  assert.equal((await as(owner, 'POST', '/social/zernio/test')).status, 200);
  assert.ok(!JSON.stringify((await as(owner, 'GET', '/social/zernio')).data).includes(KEY));

  // not switched on for this workspace: the old manual flow, and the new calls refuse politely
  const meta0 = (await a('GET', '/api/content/meta')).data; assert.equal(meta0.posting.enabled, false);
  assert.equal((await a('POST', '/api/content/posting/sync')).data.code, 'posting_off');
  const manual = await a('POST', '/api/content/posts', { title: 'Manual post', post_date: ymd(new Date()), platforms: ['facebook'] });
  assert.equal(manual.status, 201); assert.equal(manual.data.stage, 'draft');
  assert.equal((await as(owner, 'PUT', '/social/zernio/workspaces', { ids: [tid] })).status, 200);
  assert.equal((await a('GET', '/api/content/meta')).data.posting.enabled, true);

  // connect + accounts (profile created with our own externalId)
  assert.match((await a('POST', '/api/content/posting/connect', { platform: 'instagram' })).data.url, /oauth\/instagram/);
  assert.equal((await a('POST', '/api/content/posting/connect', { platform: 'tiktok' })).status, 400);
  zAccounts.push({ _id: 'A-fb', platform: 'facebook', displayName: 'Zn Homes', profileId: 'prof-tenant-' + tid }, { _id: 'A-ig', platform: 'instagram', username: 'zn_homes', profileId: 'prof-tenant-' + tid }, { _id: 'A-other', platform: 'facebook', displayName: 'Someone else', profileId: 'prof-other' });
  const sync = await a('POST', '/api/content/posting/sync'); assert.equal(sync.status, 200);
  assert.deepEqual(sync.data.accounts.map((x) => x.account_id).sort(), ['A-fb', 'A-ig'], 'only this workspace\'s own profile');
  assert.ok(zlog.some((l) => l.path === '/profiles' && l.body.externalId === 'tenant-' + tid));

  // approval gates publishing: a draft or a waiting post is never sent
  const mk = async (over = {}) => (await a('POST', '/api/content/posts', { title: 'Open day', caption: 'Visit our open day this Saturday', post_date: YESTERDAY, post_time: '10:00', account_ids: ['A-fb'], ...over })).data;
  const p1 = await mk(); assert.equal(p1.stage, 'draft');
  await runDue(); assert.ok(!zlog.some((l) => l.path === '/posts' && l.method === 'POST'), 'a draft is not published');
  const sub = await a('POST', `/api/content/posts/${p1.id}/submit`); assert.equal(sub.data.stage, 'pending_approval');
  await withTenant(getTenant(tid), () => runDue()); assert.ok(!zlog.some((l) => l.path === '/posts' && l.method === 'POST'), 'waiting approval is not published');
  assert.equal((await a('POST', `/api/content/posts/${p1.id}/approve`)).data.stage, 'scheduled');
  const ap = (await a('GET', '/api/content/posts')).data.find((x) => x.id === p1.id); assert.equal(ap.approver, 'Owner'); assert.ok(ap.approved_at);

  // editing words after approval needs a new approval; moving the time does not
  const edit = await a('PUT', `/api/content/posts/${p1.id}`, { caption: 'Visit our open day this Sunday' }); assert.equal(edit.data.stage, 'pending_approval'); assert.equal(edit.data.approver, null);
  assert.equal((await a('POST', `/api/content/posts/${p1.id}/approve`)).data.stage, 'scheduled');
  assert.equal((await a('PUT', `/api/content/posts/${p1.id}`, { post_time: '11:30' })).data.stage, 'scheduled', 'a new time keeps the approval');

  // due: published through Zernio with publishNow and an idempotency header; the post is Posted
  await withTenant(getTenant(tid), () => runDue());
  const sent = zlog.filter((l) => l.path === '/posts' && l.method === 'POST'); assert.equal(sent.length, 1);
  assert.equal(sent[0].body.publishNow, true); assert.deepEqual(sent[0].body.platforms, [{ platform: 'facebook', accountId: 'A-fb' }]); assert.match(sent[0].rid, /^erp-t\d+-p\d+-a0$/); assert.equal(sent[0].auth, `Bearer ${KEY}`);
  assert.equal((await a('GET', '/api/content/posts')).data.find((x) => x.id === p1.id).stage, 'posted');

  // Instagram needs media: a clear failure, then Retry once a picture exists
  const p2 = await mk({ title: 'IG post', account_ids: ['A-ig'] });
  await a('POST', `/api/content/posts/${p2.id}/submit`); await a('POST', `/api/content/posts/${p2.id}/approve`);
  await withTenant(getTenant(tid), () => runDue());
  let g2 = (await a('GET', '/api/content/posts')).data.find((x) => x.id === p2.id); assert.equal(g2.stage, 'failed'); assert.match(g2.fail_reason, /need a picture or video/);

  // a Studio creation sent to the calendar carries its picture
  withTenant(getTenant(tid), () => { const d2 = path.join(dbm.uploadDir(), 'media'); fs.mkdirSync(d2, { recursive: true }); fs.writeFileSync(path.join(d2, 'pic.png'), Buffer.alloc(2000, 5)); });
  const itemId = withTenant(getTenant(tid), () => Number(dbm.run("INSERT INTO creative_items(kind,title,prompt,file_ref,mime,size_bytes,credits,created_at) VALUES('post','Studio picture','p','media/pic.png','image/png',2000,3,datetime('now'))").lastInsertRowid));
  const studio = await a('POST', '/api/content/from-studio', { kind: 'item', id: itemId, caption: 'Studio caption' }); assert.equal(studio.status, 201); assert.equal(studio.data.stage, 'draft');
  await a('PUT', `/api/content/posts/${studio.data.id}`, { account_ids: ['A-ig'], post_date: YESTERDAY, post_time: '09:00' });
  await a('POST', `/api/content/posts/${studio.data.id}/submit`); assert.equal((await a('POST', `/api/content/posts/${studio.data.id}/approve`)).data.stage, 'scheduled');
  await withTenant(getTenant(tid), () => runDue());
  const igSend = zlog.filter((l) => l.path === '/posts' && l.method === 'POST').pop();
  assert.deepEqual(igSend.body.mediaItems, [{ url: 'https://media.zernio.test/temp/1.png', type: 'image' }]);
  assert.equal((await a('GET', '/api/content/posts')).data.find((x) => x.id === studio.data.id).stage, 'posted');

  // cap: Instagram allows 1 in 24 hours here; the next IG post stays Scheduled with a message
  await as(owner, 'PUT', '/social/zernio/caps', { instagram: 1 });
  const p4 = (await a('POST', '/api/content/from-studio', { kind: 'item', id: itemId, caption: 'Second picture post' })).data;
  await a('PUT', `/api/content/posts/${p4.id}`, { account_ids: ['A-ig'], post_date: YESTERDAY, post_time: '09:30' });
  await a('POST', `/api/content/posts/${p4.id}/submit`); await a('POST', `/api/content/posts/${p4.id}/approve`);
  const before = zlog.filter((l) => l.path === '/posts' && l.method === 'POST').length;
  await withTenant(getTenant(tid), () => runDue());
  const g4 = (await a('GET', '/api/content/posts')).data.find((x) => x.id === p4.id);
  assert.equal(g4.stage, 'scheduled'); assert.match(g4.blocked_reason, /allows 1 posts in 24 hours/); assert.equal(zlog.filter((l) => l.path === '/posts' && l.method === 'POST').length, before);
  await as(owner, 'PUT', '/social/zernio/caps', { instagram: 25 });
  await withTenant(getTenant(tid), () => runDue());
  assert.equal((await a('GET', '/api/content/posts')).data.find((x) => x.id === p4.id).stage, 'posted', 'goes out once the limit allows');

  // Zernio refuses a post: the reason is shown; Retry sends it again
  zStatus = 'failed';
  const p5 = await mk({ title: 'Will fail', caption: 'Another update' });
  await a('POST', `/api/content/posts/${p5.id}/submit`); await a('POST', `/api/content/posts/${p5.id}/approve`);
  await withTenant(getTenant(tid), () => runDue());
  let g5 = (await a('GET', '/api/content/posts')).data.find((x) => x.id === p5.id); assert.equal(g5.stage, 'failed'); assert.match(g5.fail_reason, /Media could not be processed/);
  zStatus = 'published';
  const rt = await a('POST', `/api/content/posts/${p5.id}/retry`); assert.equal(rt.status, 200); assert.equal(rt.data.stage, 'posted');

  // Zernio is down: the post is not lost
  zFail = true;
  const p6 = await mk({ title: 'Network trouble', caption: 'Third update' });
  await a('POST', `/api/content/posts/${p6.id}/submit`); await a('POST', `/api/content/posts/${p6.id}/approve`);
  await withTenant(getTenant(tid), () => runDue());
  const g6 = (await a('GET', '/api/content/posts')).data.find((x) => x.id === p6.id); assert.equal(g6.stage, 'failed'); zFail = false;
  assert.equal((await a('POST', `/api/content/posts/${p6.id}/retry`)).data.stage, 'posted');

  // webhook: signature checked on the raw body; duplicates ignored; the key never appears
  assert.equal((await as(owner, 'POST', '/social/zernio/webhook')).status, 200);
  const secret = (await import('../src/services/platformConfig.js')).getSetting('zernio_webhook_secret'); assert.ok(secret);
  const evt = JSON.stringify({ id: 'evt-1', event: 'post.published', post: { _id: 'zp-none' }, profiles: [{ id: 'prof', externalId: 'tenant-' + tid }] });
  const sign = (b) => crypto.createHmac('sha256', secret).update(b).digest('hex');
  const hook = (b, sig) => call('erp.test', 'POST', '/api/platform/webhooks/zernio', JSON.parse(b), { 'x-zernio-signature': sig });
  assert.equal((await hook(evt, 'deadbeef')).status, 401);
  assert.equal((await hook(evt, sign(evt))).status, 200);
  assert.equal((await hook(evt, sign(evt))).data.duplicate, true);
  assert.ok(!JSON.stringify(zlog.map((l) => l.body)).includes(KEY));
});
