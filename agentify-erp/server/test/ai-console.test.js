import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-aiu-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
let server, port;
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 282 } }), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: 'erp.test', 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const A = '/api/platform/admin';
const as = (cookie, method, url, body) => call(method, `${A}${url}`, body, { cookie });

test('AI console: overview, controls, prices, rate, credits and Azure key (never echoed)', async () => {
  const owner = (await call('POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  const smm = await (async () => { await as(owner, 'POST', '/admins', { email: 'smm@agentify.test', name: 'S', role: 'social_media_manager', password: 'Saffron#Tide2026' }); return (await call('POST', `${A}/login`, { email: 'smm@agentify.test', password: 'Saffron#Tide2026' })).cookie; })();
  assert.equal((await as(smm, 'GET', '/ai/overview')).status, 403);
  platformDb().prepare("INSERT INTO tenants(slug, name, plan, db_file, upload_dir, subscription_status, owner_email) VALUES('acme','Acme','growth','x.db','x','active','o@acme.test')").run();
  const tid = platformDb().prepare("SELECT id FROM tenants WHERE slug='acme'").get().id;

  let o = (await as(owner, 'GET', '/ai/overview')).data;
  assert.equal(o.features.length, 8); assert.equal(o.limits.platform_daily_limit_effective, 300);
  assert.equal(o.technical.gemini.added, false); assert.equal(o.technical.azure.key_added, false);
  assert.ok(o.prices.every((p) => p.usd > 0));

  assert.equal((await as(owner, 'PUT', '/ai/controls', { budget_usd_month: 40, video_budget_usd_month: 15, platform_daily_limit: 200, default_monthly_credits: 500 })).status, 200);
  assert.equal((await as(owner, 'PUT', `/ai/workspaces/${tid}`, { platform_daily_limit: 50 })).status, 200);
  assert.equal((await as(owner, 'PUT', `/ai/workspaces/${tid}/credits`, { monthly_credits: 100, add_topup: 25 })).data.left, 125);
  assert.equal((await as(owner, 'PUT', `/ai/workspaces/${tid}/credits`, { add_topup: -5 })).status, 400);
  assert.equal((await as(owner, 'PUT', '/ai/prices/creative_post', { usd: 0.06 })).status, 200);
  assert.equal((await as(owner, 'PUT', '/ai/prices/nope', { usd: 1 })).status, 400);
  assert.equal((await as(owner, 'PUT', '/ai/fx', { live: false, manual_rate: 290 })).data.rate, 290);
  assert.equal((await as(owner, 'POST', '/ai/fx/refresh')).data.rate, 290, 'manual still wins while live is off');
  assert.equal((await as(owner, 'PUT', '/ai/fx', { live: true })).data.rate, 282, 'the refreshed live rate is used once live is on');
  await as(owner, 'PUT', '/ai/fx', { live: false });
  assert.equal((await as(owner, 'PUT', '/ai/fx', { manual_rate: 'abc' })).status, 400);

  const key = 'a'.repeat(32);
  const saved = await as(owner, 'PUT', '/ai/azure', { key, region: 'UAENorth' });
  assert.equal(saved.data.region, 'uaenorth'); assert.equal(saved.data.key_added, true);
  assert.ok(!JSON.stringify(saved.data).includes(key), 'the key is not echoed');
  assert.equal((await as(owner, 'PUT', '/ai/azure', { key: 'bad key!' })).status, 400);
  o = (await as(owner, 'GET', '/ai/overview')).data;
  assert.ok(!JSON.stringify(o).includes(key), 'the overview never carries the key');
  assert.equal(o.month.budget_usd, 40); assert.equal(o.month.video_budget_usd, 15); assert.equal(o.limits.default_monthly_credits, 500);
  const w = o.workspaces.find((x) => x.id === tid);
  assert.equal(w.daily_limit, 50); assert.equal(w.credits.allowance, 125); assert.equal(o.prices.find((p) => p.key === 'creative_post').source, 'override');
  assert.equal(o.rate.source, 'manual'); assert.equal(o.technical.azure.key_added, true);
  assert.equal((await as(owner, 'DELETE', '/ai/azure/key')).data.key_added, false);
  assert.equal((await as(smm, 'PUT', '/ai/azure', { region: 'x' })).status, 403);
});
