// Location search in the property editor: result cleaning, country narrowing, caching, errors and permissions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-geo-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_DEMO = '0';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.LOGIN_LIMIT = '1000';
process.env.SIGNUP_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { geocode, cleanQuery } = await import('../src/services/geocode.js');
let server, port;
const realFetch = globalThis.fetch;
const seen = [];
let mode = 'ok';
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    seen.push({ u, ua: opts.headers?.['User-Agent'] });
    if (mode === 'down') return new Response('x', { status: 503 });
    if (mode === 'none') return new Response('[]', { status: 200 });
    return new Response(JSON.stringify([{ display_name: 'Islamabad, Pakistan', lat: '33.6938118', lon: '73.0651511' }, { display_name: 'Bad', lat: '999', lon: '1' }]), { status: 200 });
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

test('geocode cleans answers, narrows by country, sends a User-Agent and caches', async () => {
  assert.equal(cleanQuery('  a   b '), 'a b');
  assert.deepEqual((await geocode('x')).results, []);
  const r = await geocode('Islamabad', 'UK');
  assert.deepEqual(r.results, [{ label: 'Islamabad, Pakistan', lat: 33.693812, lng: 73.065151 }], 'out-of-range rows are dropped, values rounded');
  assert.match(seen[0].u, /countrycodes=gb/);
  assert.match(seen[0].ua, /agentify-erp/);
  const again = await geocode('islamabad', 'UK');
  assert.equal(again.cached, true);
  assert.equal(seen.length, 1);
  mode = 'none';
  assert.deepEqual((await geocode('Nowhereville')).results, []);
  mode = 'down';
  await assert.rejects(() => geocode('Down town'), /503/);
  mode = 'ok';
});

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const s = Buffer.concat(chunks).toString(); let d; try { d = JSON.parse(s); } catch { d = s; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

test('property geocode route needs a signed-in editor and reports provider problems clearly', async () => {
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'geo', company_name: 'Geo Realty', admin_name: 'Owner', admin_email: 'owner@geo.test', admin_password: 'Tenant@12345', region: 'PK' });
  assert.equal(su.status, 201, JSON.stringify(su.data));
  const host = 'geo.erp.test';
  assert.equal((await call(host, 'GET', '/api/properties/geocode?q=Lahore')).status, 401);
  const l = await call(host, 'POST', '/api/auth/login', { identifier: 'owner@geo.test', password: 'Tenant@12345' });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const c = { cookie: l.cookie };
  const ok = await call(host, 'GET', '/api/properties/geocode?q=Gulberg%20Lahore', null, c);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.results[0].lat, 33.693812);
  assert.match(seen.at(-1).u, /countrycodes=pk/);
  assert.equal((await call(host, 'GET', '/api/properties/geocode?q=a', null, c)).status, 400);
  mode = 'down';
  const down = await call(host, 'GET', '/api/properties/geocode?q=Karachi%20Clifton', null, c);
  assert.equal(down.status, 502);
  assert.match(down.data.error, /by hand/);
  mode = 'ok';
});
