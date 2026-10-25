import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-site-filters-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_PLATFORM_ADMIN_TOKEN = 'operator-secret';
process.env.ERP_DEMO = '0';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.LOGIN_LIMIT = '1000';
process.env.SIGNUP_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

/** HTTP call to a given host name (the test server is on localhost; the Host header picks the tenant). */
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

async function login(host, identifier, password) {
  const l = await call(host, 'POST', '/api/auth/login', { identifier, password });
  assert.equal(l.status, 200, `login on ${host}: ${JSON.stringify(l.data)}`);
  const c = l.cookie;
  return { c, get: (u) => call(host, 'GET', u, null, { cookie: c }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }), me: l.data };
}

const signup = (slug, email, extra = {}) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', ...extra });



const mkProject = (a, code, name, extra = {}) => a.post('/api/projects', { code, name, location: 'Rawalpindi', is_development: 1, kind: 'development', dev_status: 'Planning', description: `${name} description`, site_visible: 1, ...extra });

test('agents add properties and ask for projects; only what the manager approves reaches the website, with filters', async () => {
  assert.equal((await signup('filt', 'owner@filt.test')).status, 201);
  const a = await login('filt.erp.test', 'owner@filt.test', 'Tenant@12345');
  const roles = (await call('filt.erp.test', 'GET', '/api/settings/roles', null, { cookie: a.c })).data;
  const roleId = (n) => roles.find((r) => r.name === n).id;
  assert.equal((await a.post('/api/settings/users', { name: 'Test Agent', email: 'agent@filt.test', password: 'Agent@12345', role_id: roleId('Sales Agent') })).status, 201);
  const ag = await login('filt.erp.test', 'agent@filt.test', 'Agent@12345');
  const site = (u) => call('filt.erp.test', 'GET', u).then((r) => r.data);

  // projects: two live (one of each kind), one hidden until an agent asks and the manager approves
  const dev = (await mkProject(a, 'D1', 'University Homes', { dev_status: 'Under Development' })).data;
  await mkProject(a, 'C1', 'House Construction', { kind: 'construction', is_development: 0, dev_status: 'Developed' });
  const hidden = (await mkProject(a, 'H1', 'Hidden Heights', { site_visible: 0 })).data;
  assert.deepEqual((await site('/api/site/projects')).data.map((p) => p.name).sort(), ['House Construction', 'University Homes']);
  assert.equal((await ag.post(`/api/listings/projects/${hidden.id}/request`)).status, 200);
  assert.equal((await site('/api/site/projects')).data.length, 2, 'a requested project is still hidden');
  assert.equal((await a.post(`/api/listings/projects/${hidden.id}/approve`)).status, 200);
  assert.equal((await site('/api/site/projects')).data.length, 3);

  // properties: the agent cannot publish; the listing shows only after approval
  const mk = (extra) => ag.post('/api/properties', { title: 'Plot', purpose: 'Sell', property_type: 'Plots', project_id: dev.id, city: 'Rawalpindi', area_size: 5, unit: 'Marla', total_price: 240000000, net_price: 240000000, description: 'A test listing added by a sales agent.', ...extra });
  const p1 = (await mk({ title: 'Plot A', area_size: 5, unit: 'Marla' })).data, p2 = (await mk({ title: 'Shop B', property_type: 'Shops', area_size: 180, unit: 'Sq Ft' })).data;
  assert.equal(p1.review_state, 'draft');
  assert.equal((await ag.post(`/api/properties/${p1.id}/publish`)).status, 403);
  assert.equal((await site('/api/site/listings')).total, 0);
  for (const p of [p1, p2]) assert.equal((await ag.post(`/api/properties/${p.id}/submit-review`)).status, 200);
  assert.equal((await site('/api/site/listings')).total, 0, 'waiting for approval is not public');
  assert.equal((await a.get('/api/listings/queue')).data.properties.length, 2);
  assert.equal((await ag.post(`/api/listings/properties/${p1.id}/approve`)).status, 403, 'an agent cannot approve');
  assert.equal((await a.post(`/api/listings/properties/${p1.id}/approve`)).status, 200);
  assert.deepEqual((await site('/api/site/listings')).data.map((p) => p.title), ['Plot A']);
  assert.equal((await a.post(`/api/listings/properties/${p2.id}/approve`)).status, 200);

  // property filters, including the size unit
  assert.equal((await site('/api/site/listings?unit=Marla')).total, 1);
  assert.equal((await site('/api/site/listings?unit=Sq%20Ft')).data[0].title, 'Shop B');
  assert.equal((await site('/api/site/listings?type=Shops')).total, 1);
  assert.equal((await site(`/api/site/listings?project_id=${dev.id}`)).total, 2);
  const f = await site('/api/site/facets');
  assert.deepEqual(f.units.map((u) => u.value).sort(), ['Marla', 'Sq Ft']);
  assert.deepEqual(f.project_kinds.map((k) => k.value).sort(), ['construction', 'development']);
  assert.ok(f.project_statuses.some((s) => s.value === 'Under Development'));

  // project filters
  const names = async (qs) => (await site(`/api/site/projects?${qs}`)).data.map((p) => p.name).sort();
  assert.deepEqual(await names('kind=construction'), ['House Construction']);
  assert.deepEqual(await names('status=Under%20Development'), ['University Homes']);
  assert.deepEqual(await names('q=heights'), ['Hidden Heights']);
  assert.deepEqual(await names('available=1'), ['University Homes'], 'only projects with an approved, available property');
  assert.deepEqual(await names('q=%27%20OR%201%3D1%20--'), [], 'search text is a value, not SQL');
});
