// Location search in the property editor: result cleaning, country narrowing, caching, errors and permissions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-geo-'));
process.env.ERP_DATA_DIR = dir;
process.env.GEOCODE_PROVIDER = 'nominatim';
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
const { geocode, geocodeParts, cleanQuery, variants } = await import('../src/services/geocode.js');
let server, port;
const realFetch = globalThis.fetch;
const seen = [];
let mode = 'ok';
const row = (name, lat, lon, type, bb, address = {}) => ({ display_name: `${name}, Rawalpindi, Punjab, Pakistan`, name, lat: String(lat), lon: String(lon), addresstype: type, boundingbox: bb.map(String), address: { city: 'Rawalpindi', state: 'Punjab', ...address } });
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    const sp = new URL(u).searchParams;
    seen.push({ u, ua: opts.headers?.['User-Agent'], q: sp.get('q'), bounded: sp.get('bounded'), viewbox: sp.get('viewbox') });
    const J = (x) => new Response(JSON.stringify(x), { status: 200 });
    if (mode === 'down') return new Response('x', { status: 503 });
    if (mode === 'none') return J([]);
    if (mode === 'pieces' && /Lahore|piece/.test(sp.get('q'))) return J([row('Chakri Road', 33.5, 73.0, 'road', [33.5, 33.5, 73, 73], { road: 'Chakri Road' }), row('Chakri Road', 33.51, 73.01, 'road', [33.5, 33.5, 73, 73], { road: 'Chakri Road' }), row('Rawalpindi', 33.6, 73.05, 'city', [33.4, 33.8, 72.9, 73.2])]);
    const q = sp.get('q');
    if (q === 'Rawalpindi') return J([row('Rawalpindi', 33.6, 73.05, 'city', [33.4, 33.8, 72.9, 73.2])]);
    if (q === 'dhamial road') return J([row('Dhamial Road', 33.554, 73.024, 'road', [33.55, 33.56, 73.02, 73.03], { road: 'Dhamial Road', suburb: 'Dhamial' })]);
    if (q === 'Quaid-e-Azam colony' && sp.get('bounded') === '1') return J([row('Quaid-e-Azam Colony', 33.5571, 73.0262, 'neighbourhood', [33.556, 33.558, 73.025, 73.027], { suburb: 'Dhamial' })]);
    if (sp.get('bounded') === '1') return J([]);
    if (q === 'Quaid-e-Azam colony' || q === 'QuaideAzam colony' || q === 'Nowhere Lane') return J([]);
    return J([{ ...row('Islamabad', 33.6938118, 73.0651511, 'city', [33.5, 33.8, 72.9, 73.2]) }, { ...row('Bad', 999, 1, 'city', [0, 0, 0, 0]) }]);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

test('geocode cleans answers, narrows by country, sends a User-Agent and caches', async () => {
  assert.equal(cleanQuery('  a   b '), 'a b');
  assert.deepEqual((await geocode('x')).results, []);
  const r = await geocode('Islamabad', 'UK');
  assert.equal(r.results.length, 1, 'out-of-range rows are dropped');
  assert.equal(r.results[0].lat, 33.693812);
  assert.equal(r.results[0].level, 'area');
  assert.match(seen[0].u, /countrycodes=gb/);
  assert.match(seen[0].u, /accept-language=en/);
  assert.match(seen[0].ua, /agentify-erp/);
  const n = seen.length;
  assert.equal((await geocode('islamabad', 'UK')).cached, false, 'cache is keyed on the exact text');
  assert.equal((await geocode('Islamabad', 'UK')).cached, true);
  assert.equal(seen.length, n + 1);
  mode = 'none';
  assert.deepEqual((await geocode('Nowhereville')).results, []);
  mode = 'down';
  await assert.rejects(() => geocode('Down town'), /503/);
  mode = 'ok';
});

test('spelling variants split run-together words and unify alternate spellings', () => {
  assert.deepEqual(variants('QuaideAzam colony'), ['QuaideAzam colony', 'Quaid-e-Azam colony']);
  assert.deepEqual(variants('Quaid e Azam Road'), ['Quaid e Azam Road', 'Quaid-e-Azam Road']);
  assert.deepEqual(variants('Saddar'), ['Saddar']);
});

test('street search finds the anchor, then looks for the street inside it, whatever field it was typed in', async () => {
  // the person typed the road in City, a colony in Area and a misspelt colony in Location
  const r = await geocodeParts(['QuaideAzam colony', 'bank colony', 'dhamial road'], 'PK');
  assert.equal(r.approximate, false);
  assert.equal(r.results[0].label.startsWith('Quaid-e-Azam Colony'), true);
  assert.equal(r.results[0].level, 'street');
  assert.ok(r.results.some((x) => x.label.startsWith('Dhamial Road')), 'the wider road stays a clickable candidate');
  const bounded = seen.filter((x) => x.bounded === '1');
  assert.ok(bounded.length >= 1 && bounded[0].viewbox, 'specific pieces are searched inside the anchor area only');
});

test('the same road returned in several pieces is listed once', async () => {
  mode = 'pieces';
  const r = await geocodeParts(['Chakri Road piece', 'Lahore'], 'PK');
  mode = 'ok';
  assert.equal(new Set(r.results.map((x) => x.label.toLowerCase())).size, r.results.length);
});

test('approximate only when nothing specific matched inside the area', async () => {
  const r = await geocodeParts(['Nowhere Lane', 'Rawalpindi'], 'PK');
  assert.equal(r.approximate, true);
  assert.equal(r.results[0].label.startsWith('Rawalpindi'), true);
  const single = await geocodeParts(['Rawalpindi'], 'PK');
  assert.equal(single.approximate, false);
  assert.deepEqual((await geocodeParts([' ', 'x'])).results, []);
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
  const ok = await call(host, 'GET', '/api/properties/geocode?p=Gulberg&p=Lahore', null, c);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.results.length >= 1);
  assert.match(seen.at(-1).u, /countrycodes=pk/);
  assert.equal((await call(host, 'GET', '/api/properties/geocode?q=a', null, c)).status, 400);
  mode = 'down';
  const down = await call(host, 'GET', '/api/properties/geocode?q=Karachi%20Clifton', null, c);
  assert.equal(down.status, 502);
  assert.match(down.data.error, /by hand/);
  mode = 'ok';
});
