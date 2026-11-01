import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// A brand group can pin a default brochure layout that member workspaces inherit; a workspace's own version wins.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-bro-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const { getTenantBySlug } = await import('../src/platform.js');
const dbm = await import('../src/db.js');

let server, port, whisperCalls = 0;
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('api.openai.com/v1/audio/transcriptions')) { whisperCalls += 1; return new Response('hello world', { status: 200 }); }
    throw new Error(`unexpected fetch ${u}`);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}).then(async () => { owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie; assert.equal((await signup('bro', 'owner@bro.test')).status, 201); assert.equal((await signup('brp', 'owner@brp.test')).status, 201); assert.equal((await signup('brq', 'owner@brq.test')).status, 201); }));
after(async () => { globalThis.fetch = realFetch; server.close(); dbm.closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const A = '/api/platform/admin';
let owner;
const signup = (slug, email) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', region: 'PK' });
const login = async (slug, id) => { const host = `${slug}.erp.test`; const l = await call(host, 'POST', '/api/auth/login', { identifier: id, password: 'Tenant@12345' }); assert.equal(l.status, 200); return (m, u, b) => call(host, m, u, b, { cookie: l.cookie }); };
const as = (method, url, body) => call('erp.test', method, `${A}${url}`, body, { cookie: owner });


const tid = (slug) => getTenantBySlug(slug).id;
test('workspaces inherit the brand\'s brochure layout unless they keep their own', async () => {
  const [a, b, c] = [await login('bro', 'owner@bro.test'), await login('brp', 'owner@brp.test'), await login('brq', 'owner@brq.test')];
  const lay = (await as('POST', '/library', { type: 'brochure_layout', title: 'Luxury two-page', content: 'Layout A' })).data;
  const clause = (await as('POST', '/library', { type: 'clause', title: 'Clause', content: 'x' })).data;
  const brand = (await as('POST', '/brands', { name: 'Brochure Group' })).data;
  assert.equal((await as('PUT', `/brands/${brand.id}`, { brochure_item_id: clause.id })).status, 400, 'must be a brochure layout');
  assert.equal((await as('PUT', `/brands/${brand.id}`, { brochure_item_id: 99999 })).status, 400);
  await as('PUT', `/workspaces/${tid('bro')}/brand`, { brand_id: brand.id });
  await as('PUT', `/workspaces/${tid('brp')}/brand`, { brand_id: brand.id });
  assert.equal((await a('GET', '/api/library/brochure')).data, null, 'nothing pinned yet');
  assert.equal((await as('PUT', `/brands/${brand.id}`, { brochure_item_id: lay.id })).data.brand.brochure_item_id, lay.id);
  assert.deepEqual((await as('GET', `/brands/${brand.id}`)).data.brochure_options.map((o) => o.title), ['Luxury two-page']);
  const got = (await a('GET', '/api/library/brochure')).data;
  assert.equal(got.source, 'brand'); assert.equal(got.content, 'Layout A');
  assert.equal((await a('GET', '/api/library')).data.items.find((i) => i.id === lay.id).brand_default, true);
  assert.equal((await c('GET', '/api/library/brochure')).data, null, 'an independent workspace gets nothing');
  assert.equal((await c('GET', '/api/library')).data.items.find((i) => i.id === lay.id).brand_default, false);
  // a workspace\'s own version wins; the sibling still inherits
  assert.equal((await b('PUT', `/api/library/${lay.id}/override`, { content: 'Own layout' })).status, 200);
  const own = (await b('GET', '/api/library/brochure')).data;
  assert.equal(own.source, 'workspace'); assert.equal(own.content, 'Own layout');
  assert.equal((await a('GET', '/api/library/brochure')).data.content, 'Layout A');
  // clearing the pick or retiring the layout stops inheritance
  await as('POST', `/library/${lay.id}/retire`);
  assert.equal((await a('GET', '/api/library/brochure')).data, null);
});
