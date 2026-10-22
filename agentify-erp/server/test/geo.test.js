// Visitor location for the marketing headline: trusted proxy headers, a lookup provider (mocked), failures, unsupported
// countries, caching, and no lookups for private addresses.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-geo-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', ERP_MAIL_QUIET: '1' });
delete process.env.GEO_PROVIDER; delete process.env.GEO_TOKEN; delete process.env.GEO_TRUST_HEADERS;

const { createApp } = await import('../src/index.js');
const { _clearGeoCache, normalizeCountry } = await import('../src/services/geo.js');
let server, port;
const realFetch = globalThis.fetch;
let providerCalls = [];
let providerReply = null; // (url) => Response
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    providerCalls.push(u);
    return providerReply(u);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); (await import('../src/db.js')).closeDbs(); });
beforeEach(() => { _clearGeoCache(); providerCalls = []; delete process.env.GEO_PROVIDER; delete process.env.GEO_TOKEN; delete process.env.GEO_TRUST_HEADERS; });

const geo = (headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/api/platform/geo', method: 'GET', headers: { Host: 'erp.test', ...headers } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(t), cache: res.headers['cache-control'] }));
  });
  req.on('error', reject); req.end();
});
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

test('nothing configured: unknown country, page falls back to the global version', async () => {
  const r = await geo({ 'X-Forwarded-For': '8.8.8.8' });
  assert.equal(r.status, 200);
  assert.deepEqual({ country: r.data.country, city: r.data.city, supported: r.data.supported, configured: r.data.configured }, { country: null, city: null, supported: false, configured: false });
  assert.match(r.cache, /private/);
  assert.equal(providerCalls.length, 0);
});

test('trusted proxy headers: GB becomes UK and is a supported market; headers are ignored unless trusted', async () => {
  assert.equal((await geo({ 'CF-IPCountry': 'GB', 'CF-IPCity': 'London' })).data.country, null, 'untrusted headers are ignored');
  process.env.GEO_TRUST_HEADERS = '1';
  const r = await geo({ 'CF-IPCountry': 'GB', 'CF-IPCity': 'London' });
  assert.deepEqual([r.data.country, r.data.city, r.data.supported, r.data.source], ['UK', 'London', true, 'proxy']);
  assert.equal((await geo({ 'X-Geo-Country': 'XX' })).data.country, null, 'unknown country code');
});

test('provider: country and city, cached per address, private addresses never looked up', async () => {
  process.env.GEO_PROVIDER = 'ipinfo'; process.env.GEO_TOKEN = 'tok';
  providerReply = () => J({ ip: '5.0.0.1', city: 'Dubai', country: 'AE' });
  const a = await geo({ 'X-Forwarded-For': '5.0.0.1' });
  assert.deepEqual([a.data.country, a.data.city, a.data.supported, a.data.source], ['AE', 'Dubai', true, 'ipinfo']);
  await geo({ 'X-Forwarded-For': '5.0.0.1' });
  assert.equal(providerCalls.length, 1, 'second request served from the in-memory cache');
  assert.match(providerCalls[0], /^https:\/\/ipinfo\.io\/5\.0\.0\.1\/json\?token=tok$/);
  const local = await geo({ 'X-Forwarded-For': '192.168.1.20' });
  assert.equal(local.data.source, 'local'); assert.equal(providerCalls.length, 1);
});

test('unsupported country and missing city still answer cleanly', async () => {
  process.env.GEO_PROVIDER = 'ipapi';
  providerReply = () => J({ country_code: 'FR', city: '' });
  const r = await geo({ 'X-Forwarded-For': '5.0.0.2' });
  assert.deepEqual([r.data.country, r.data.city, r.data.supported], ['FR', null, false]);
  assert.match(providerCalls[0], /^https:\/\/ipapi\.co\/5\.0\.0\.2\/json\/$/);
});

test('provider failure or timeout: no country, no error for the page', async () => {
  process.env.GEO_PROVIDER = 'ipapi';
  providerReply = () => J({ error: true, reason: 'RateLimited' }, 429);
  const r = await geo({ 'X-Forwarded-For': '5.0.0.3' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.country, r.data.source], [null, 'unavailable']);
  providerReply = () => { throw new Error('network down'); };
  const r2 = await geo({ 'X-Forwarded-For': '5.0.0.4' });
  assert.deepEqual([r2.status, r2.data.country], [200, null]);
});

test('country codes are normalised and junk is rejected', () => {
  assert.equal(normalizeCountry('gb'), 'UK');
  assert.equal(normalizeCountry('PK'), 'PK');
  assert.equal(normalizeCountry('T1'), null);
  assert.equal(normalizeCountry('<script>'), null);
});
