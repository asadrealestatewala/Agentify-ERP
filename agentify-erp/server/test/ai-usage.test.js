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
const aiu = await import('../src/services/aiUsage.js');
const { platformDb } = await import('../src/platform.js');
let server, port;
const realFetch = globalThis.fetch; const calls = [];
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    calls.push(u);
    if (u.includes('/models?pageSize')) return new Response(JSON.stringify({ models: [{}] }), { status: 200 });
    if (u.includes(':generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Hello","body":"Manage leads in one place."}' }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 50, thoughtsTokenCount: 10 } }), { status: 200 });
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

test('token counts are read from each provider and Gemini thinking tokens count as output', () => {
  assert.deepEqual(aiu.tokensOf('gemini', { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, thoughtsTokenCount: 3 } }), { input: 5, output: 5 });
  assert.deepEqual(aiu.tokensOf('anthropic', { usage: { input_tokens: 7, output_tokens: 1 } }), { input: 7, output: 1 });
  assert.deepEqual(aiu.tokensOf('openai', { usage: { prompt_tokens: 4, completion_tokens: 9 } }), { input: 4, output: 9 });
  assert.equal(aiu.tokensOf('gemini', {}), null);
});

test('Gemini connection, AI drafts, metering, budget and the usage report', async () => {
  const owner = (await call('POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  const smm = await (async () => { await as(owner, 'POST', '/admins', { email: 'smm@agentify.test', name: 'S', role: 'social_media_manager', password: 'Saffron#Tide2026' }); return (await call('POST', `${A}/login`, { email: 'smm@agentify.test', password: 'Saffron#Tide2026' })).cookie; })();
  assert.equal((await as(smm, 'GET', '/ai/usage')).status, 403, 'the manager does not see costs');
  assert.equal((await as(smm, 'PUT', '/ai/settings', { api_key: 'x' })).status, 403);
  assert.equal((await as(smm, 'GET', '/content')).data.ai.connected, false);
  assert.equal((await as(smm, 'POST', '/content/ai-draft', { channel: 'facebook', topic: 'A post about our lead inbox' })).status, 400, 'not connected yet');

  
  const key = `AIza${'k'.repeat(35)}`;
  const saved = await as(owner, 'PUT', '/ai/settings', { api_key: key, draft_daily_cap: 2 });
  assert.equal(saved.status, 200, JSON.stringify(saved.data)); assert.equal(saved.data.connected, true);
  assert.ok(!JSON.stringify(saved.data).includes(key), 'the key is never returned');
  assert.ok(!JSON.stringify(platformDb().prepare("SELECT value FROM platform_settings WHERE key='platform_gemini_key'").all()).includes(key), 'stored encrypted');

  const d1 = await as(smm, 'POST', '/content/ai-draft', { channel: 'facebook', topic: 'A post about our lead inbox' });
  assert.equal(d1.status, 201, JSON.stringify(d1.data)); assert.equal(d1.data.source, 'ai'); assert.equal(d1.data.status, 'draft'); assert.equal(d1.data.body, 'Manage leads in one place.');
  assert.equal((await as(smm, 'POST', '/content/ai-draft', { channel: 'nope', topic: 'A post about our lead inbox' })).status, 400);
  assert.equal((await as(smm, 'POST', '/content/ai-draft', { channel: 'x', topic: 'short' })).status, 400);
  assert.equal((await as(smm, 'POST', '/content/ai-draft', { channel: 'x', topic: 'Another post about the mobile app' })).status, 201);
  const capped = await as(smm, 'POST', '/content/ai-draft', { channel: 'x', topic: 'A third post about reports' });
  assert.equal(capped.status, 400); assert.match(capped.data.error, /daily limit/);
  assert.equal((await as(smm, 'GET', '/content')).data.ai.drafts_left_today, 0);

  // a workspace's own key is recorded too, but is not Agentify cost
  const t = platformDb().prepare("SELECT id, plan FROM tenants LIMIT 1").get() || { id: null };
  aiu.record({ keyOwner: 'tenant', provider: 'openai', model: 'm', purpose: 'workspace_assistant', tenantId: t.id, tokens: { input: 1000, output: 500 } });

  let rep = (await as(owner, 'GET', '/ai/usage')).data;
  assert.equal(rep.owners.platform.calls, 2); assert.equal(rep.owners.platform.input_tokens, 400); assert.equal(rep.owners.platform.output_tokens, 120);
  assert.equal(rep.owners.platform.est_cost, null, 'no prices entered, so no invented cost');
  assert.equal(rep.month.left, null); assert.match(rep.notes.estimate, /prices/);
  assert.equal(rep.owners.tenant.est_cost, null, 'tenant-key calls are never Agentify cost');
  assert.ok(rep.by_purpose.some((p) => p.purpose === 'content_draft' && p.key_owner === 'platform'));
  assert.ok(rep.by_plan.length >= 1);

  assert.equal((await as(owner, 'PUT', '/ai/settings', { price_in_per_m: -1 })).status, 400);
  await as(owner, 'PUT', '/ai/settings', { price_in_per_m: 1, price_out_per_m: 2, budget_month: 10, draft_daily_cap: 50 });
  rep = (await as(owner, 'GET', '/ai/usage')).data;
  assert.ok(Math.abs(rep.owners.platform.est_cost - (400 / 1e6 + (120 * 2) / 1e6)) < 1e-9);
  assert.ok(Math.abs(rep.month.left - (10 - rep.month.spent)) < 1e-9);
  // budget used up: drafts stop
  await as(owner, 'PUT', '/ai/settings', { budget_month: 0.0000001 });
  const over = await as(smm, 'POST', '/content/ai-draft', { channel: 'x', topic: 'A fourth post about the website builder' });
  assert.equal(over.status, 400); assert.match(over.data.error, /budget/);
  assert.equal((await as(owner, 'DELETE', '/ai/settings/key')).data.connected, false);
});

test('cost and profit: revenue per workspace and plan, costs only from entered figures, conversion needs a rate', async () => {
  const { profit, saveCostConfig } = await import('../src/services/profitReport.js');
  const db = platformDb();
  const stamp = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
  const t = db.prepare("SELECT id, plan FROM tenants WHERE is_legacy=0 LIMIT 1").get()
    || (() => { db.prepare("INSERT INTO tenants(slug, name, plan, db_file, upload_dir, subscription_status, owner_email) VALUES('acme','Acme','growth','x.db','x','active','o@acme.test')").run(); return db.prepare("SELECT id, plan FROM tenants WHERE slug='acme'").get(); })();
  db.prepare("UPDATE tenants SET subscription_status='active' WHERE id=?").run(t.id);
  // the report's month is the platform-local month (Asia/Karachi by default), not the UTC month: they differ in the last hours of a UTC month day.
  // Midday UTC on the first local day falls on the same date in both, so the invoice always lands inside the report's month.
  const { resolveRange } = await import('../src/services/platformMetrics.js');
  const start = new Date(`${resolveRange({ range: 'month' }).from}T11:00:00Z`);
  db.prepare("INSERT INTO invoices(tenant_id, provider_invoice_id, amount, currency, status, created_at) VALUES(?,?,?,?,'paid',?)").run(t.id, 'inv-profit-1', 3000, 'PKR', stamp(new Date(start.getTime() + 3600_000)));
  let p = profit({ range: 'month' });
  const row = p.workspaces.find((w) => w.id === t.id);
  assert.equal(row.revenue.PKR, 3000);
  assert.equal(row.profit, null, 'no cost figures and no exchange rate: profit is not guessed');
  assert.ok(p.missing.some((m) => /exchange rate/.test(m)) && p.missing.some((m) => /monthly cost/.test(m)));
  assert.equal(p.totals.complete, false);

  const { saveFx } = await import('../src/regions/admin.js');
  saveFx(db, { base: 'PKR', quote: 'USD', rate: 0.01 }, 'test');
  saveCostConfig({ currency: 'USD', overhead_month: 5, plan_month: { [t.plan]: 4 } }, 'test');
  p = profit({ range: 'month' });
  const r2 = p.workspaces.find((w) => w.id === t.id);
  assert.ok(Math.abs(r2.revenue_converted - 30) < 1e-6);
  assert.ok(r2.direct_cost > 0 && r2.profit != null && Math.abs(r2.profit - (30 - r2.direct_cost - (r2.ai_cost || 0))) < 1e-9);
  assert.equal(p.plans.find((x) => x.plan === t.plan).workspaces >= 1, true);
  assert.ok(p.totals.overhead > 0 && Math.abs(p.totals.net_profit - (p.totals.workspace_profit - (p.totals.ai_unallocated || 0) - p.totals.overhead)) < 1e-9);
  assert.throws(() => saveCostConfig({ overhead_month: -1 }, 'test'));

  const owner = (await call('POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await as(owner, 'GET', '/profit?range=month')).status, 200);
  assert.equal((await as(owner, 'PUT', '/profit/config', { overhead_month: 7 })).status, 200);
  const mgr = (await call('POST', `${A}/login`, { email: 'smm@agentify.test', password: 'Saffron#Tide2026' })).cookie;
  assert.equal((await as(mgr, 'GET', '/profit')).status, 403);
});
