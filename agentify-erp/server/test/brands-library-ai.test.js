import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Console features: brand groups (shared logo and colours only), the shared template library with per-workspace overrides,
// and AI limits for workspace-key AI (kill switch, monthly cap, per-feature and per-workspace switches, daily call limit).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-bla-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const aiu = await import('../src/services/aiUsage.js');
const { completeJson } = await import('../src/integrations/ai.js');
const { saveIntegration } = await import('../src/integrations/store.js');
const { platformDb, getTenantBySlug, withTenant } = await import('../src/platform.js');
const dbm = await import('../src/db.js');

let server, port;
const realFetch = globalThis.fetch; let modelCalls = 0;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.includes('api.anthropic.com/v1/messages')) { modelCalls += 1; return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 }); }
    throw new Error(`unexpected fetch ${u}`);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}).then(() => boot()));
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
const as = (cookie, method, url, body) => call('erp.test', method, `${A}${url}`, body, { cookie });
const signup = (slug, email) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', region: 'PK' });
const login = async (slug, id) => { const host = `${slug}.erp.test`; const l = await call(host, 'POST', '/api/auth/login', { identifier: id, password: 'Tenant@12345' }); assert.equal(l.status, 200); return (m, u, b) => call(host, m, u, b, { cookie: l.cookie }); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const tid = (slug) => getTenantBySlug(slug).id;

let owner;
const boot = async () => {
  owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  for (const s of ['bra', 'brb', 'brc']) assert.equal((await signup(s, `owner@${s}.test`)).status, 201);
};

test('brand group shares logo and colour only, locks the workspace look, and releases on removal', async () => {
  const a = await login('bra', 'owner@bra.test'); const b = await login('brb', 'owner@brb.test'); const c = await login('brc', 'owner@brc.test');
  assert.equal((await as(owner, 'POST', '/brands', { name: 'X', primary_color: '#1a56db' })).status, 400, 'name too short');
  assert.equal((await as(owner, 'POST', '/brands', { name: 'Skyline Group', primary_color: '#ffff00' })).status, 400, 'too light for white text');
  assert.equal((await as(owner, 'POST', '/brands', { name: 'Skyline Group', logo: 'data:image/svg+xml;base64,AAAA' })).status, 400, 'png, jpg or webp only');
  const made = await as(owner, 'POST', '/brands', { name: 'Skyline Group', owner_email: 'boss@skyline.test', primary_color: '#1a56db', accent_color: '#0e7c6b', logo: PNG });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal((await as(owner, 'POST', '/brands', { name: 'skyline group' })).status, 400, 'names are unique');
  const id = made.data.id;

  for (const slug of ['bra', 'brb']) assert.equal((await as(owner, 'PUT', `/workspaces/${tid(slug)}/brand`, { brand_id: id })).status, 200);
  const own = await a('GET', '/api/auth/brand'); const other = await b('GET', '/api/auth/brand'); const free = await c('GET', '/api/auth/brand');
  assert.equal(own.data.color, '#1a56db'); assert.equal(other.data.color, '#1a56db'); assert.match(own.data.app_logo, /^media\/brand-\d+-/);
  assert.ok(fs.existsSync(path.join(getTenantBySlug('bra').upload_dir, own.data.app_logo)), 'the logo file is in the workspace\'s own folder');
  assert.notEqual(free.data.color, '#1a56db', 'an independent workspace is untouched');
  assert.equal(own.data.name, 'bra Realty', 'each workspace keeps its own name');

  // the workspace cannot change what the brand sets, but a form saved with the same colour still works
  const sys = (await a('GET', '/api/settings/system')).data;
  assert.equal((await a('GET', '/api/settings/brand-group')).data.name, 'Skyline Group');
  assert.equal((await c('GET', '/api/settings/brand-group')).data, null);
  assert.equal((await a('PUT', '/api/settings/system', { brand_color: '#aa0000' })).status, 400);
  const same = await a("PUT", "/api/settings/system", { company_name: sys.company_name, brand_color: "#1a56db" }); assert.equal(same.status, 200, JSON.stringify(same.data));
  assert.equal((await a('DELETE', '/api/settings/branding/app-logo')).status, 400);
  assert.equal((await c('PUT', '/api/settings/system', { brand_color: '#aa0000' })).status, 200, 'independent workspace may still change its colour');

  // a data separation check: contacts of one workspace never show in the other
  assert.equal((await a('POST', '/api/contacts', { full_name: 'Only In A', phone: '+92 300 1112223', lead_source: 'Walk-in' })).status, 201);
  assert.ok(!JSON.stringify((await b('GET', '/api/contacts')).data).includes('Only In A'));

  // changing the brand updates every member; main workspace and roll-up
  const upd = await as(owner, 'PUT', `/brands/${id}`, { primary_color: '#7c3aed' });
  assert.equal(upd.status, 200); assert.ok(upd.data.sync.every((s) => s.ok));
  assert.equal((await b('GET', '/api/auth/brand')).data.color, '#7c3aed');
  assert.equal((await as(owner, 'PUT', `/brands/${id}/main`, { tenant_id: tid('brc') })).status, 400, 'main must be a member');
  assert.equal((await as(owner, 'PUT', `/brands/${id}/main`, { tenant_id: tid('bra') })).data.main_tenant_id, tid('bra'));
  const detail = (await as(owner, 'GET', `/brands/${id}`)).data;
  assert.equal(detail.workspaces.length, 2); assert.equal(detail.rollup.workspaces, 2); assert.ok(detail.workspaces.find((w) => w.main).slug === 'bra');
  assert.equal(detail.rollup.contacts, 1);

  // leaving the brand frees the workspace and clears main
  assert.equal((await as(owner, 'PUT', `/workspaces/${tid('bra')}/brand`, { brand_id: null })).status, 200);
  assert.equal((await as(owner, 'GET', `/brands/${id}`)).data.main_tenant_id, null);
  assert.equal((await a('PUT', '/api/settings/system', { brand_color: '#aa0000' })).status, 200);
  assert.equal((await as(owner, 'DELETE', `/brands/${id}`)).status, 200);
  assert.equal((await b('PUT', '/api/settings/system', { brand_color: '#aa0000' })).status, 200, 'deleting the brand frees its workspaces');
});

test('shared library: workspaces read it, override their own copy, and the console sees drift', async () => {
  const a = await login('bra', 'owner@bra.test'); const b = await login('brb', 'owner@brb.test');
  assert.equal((await as(owner, 'POST', '/library', { type: 'nope', title: 'Bad', content: 'x' })).status, 400);
  assert.equal((await as(owner, 'POST', '/library', { type: 'clause', title: 'Empty', content: '  ' })).status, 400);
  const item = (await as(owner, 'POST', '/library', { type: 'clause', title: 'Payment clause', content: 'Pay within 30 days.' })).data;
  const other = (await as(owner, 'POST', '/library', { type: 'email_template', title: 'Viewing follow-up', content: 'Thanks for visiting.' })).data;
  assert.equal(item.version, 1);

  let seen = (await a('GET', '/api/library')).data.items;
  assert.equal(seen.length, 2); assert.equal(seen.find((i) => i.id === item.id).overridden, false);
  assert.equal((await a('PUT', `/api/library/${item.id}/override`, { content: '' })).status, 400);
  const mine = await a('PUT', `/api/library/${item.id}/override`, { content: 'Pay within 14 days.' });
  assert.equal(mine.status, 200); assert.equal(mine.data.content, 'Pay within 14 days.'); assert.equal(mine.data.overridden, true);
  assert.equal((await b('GET', '/api/library')).data.items.find((i) => i.id === item.id).content, 'Pay within 30 days.', 'the other workspace still sees the shared text');

  // the shared text moves on: new version, the overriding workspace is told
  const edited = (await as(owner, 'PUT', `/library/${item.id}`, { content: 'Pay within 21 days.' })).data;
  assert.equal(edited.version, 2);
  seen = (await a('GET', '/api/library')).data.items.find((i) => i.id === item.id);
  assert.equal(seen.content, 'Pay within 14 days.'); assert.equal(seen.shared_changed, true); assert.equal(seen.shared_content, 'Pay within 21 days.');
  const lib = (await as(owner, 'GET', '/library')).data;
  assert.deepEqual(lib.drift.map((d) => [d.workspace, d.behind]), [['bra Realty', true]]);
  assert.equal(lib.items.find((i) => i.id === item.id).overrides, 1);

  // retired items disappear for workspaces; going back to the shared version removes the override
  await as(owner, 'POST', `/library/${other.id}/retire`);
  assert.equal((await a('GET', '/api/library')).data.items.some((i) => i.id === other.id), false);
  await as(owner, 'POST', `/library/${other.id}/reinstate`);
  assert.equal((await a('DELETE', `/api/library/${item.id}/override`)).data.content, 'Pay within 21 days.');
  assert.equal((await as(owner, 'GET', '/library')).data.drift.length, 0);

  // only roles with the permission manage the library
  await as(owner, 'POST', '/admins', { email: 'smm2@agentify.test', name: 'S', role: 'social_media_manager', password: 'Saffron#Tide2026' });
  const smm = (await call('erp.test', 'POST', `${A}/login`, { email: 'smm2@agentify.test', password: 'Saffron#Tide2026' })).cookie;
  assert.equal((await as(smm, 'GET', '/library')).status, 403);
  assert.equal((await as(smm, 'POST', '/library', { type: 'clause', title: 'No', content: 'no' })).status, 403);
});

test('AI limits: kill switch, feature switch, workspace switch, daily limit and monthly cap are enforced before a call starts', async () => {
  const t = getTenantBySlug('bra');
  const rec = (n, who = t.id) => { for (let i = 0; i < n; i += 1) aiu.record({ keyOwner: 'tenant', provider: 'anthropic', model: 'm', purpose: 'property_writer', tenantId: who, tokens: { input: 1000, output: 500 } }); };
  rec(2);
  let c = (await as(owner, 'GET', '/ai/controls')).data;
  const row = c.workspaces.find((w) => w.id === t.id);
  assert.equal(row.calls_today, 2); assert.equal(row.ai_enabled, true); assert.equal(row.effective_limit, null);
  assert.equal(c.features.find((f) => f.key === 'property_writer').calls, 2);
  assert.equal(c.features.find((f) => f.key === 'property_writer').est_cost, null, 'no prices entered, so no invented cost');

  // the gate runs inside the real model-call path
  withTenant(t, () => saveIntegration('ai_anthropic', { api_key: `sk-ant-${'k'.repeat(30)}`, model: 'm' }, { publicInfo: {}, status: 'connected', userId: null }));
  const ask = () => withTenant(t, () => completeJson('anthropic', { system: 's', prompt: 'p', purpose: 'property_writer' }));
  const before = modelCalls;
  assert.deepEqual(await ask(), { ok: true }); assert.equal(modelCalls, before + 1);

  assert.equal((await as(owner, 'PUT', '/ai/workspaces/' + t.id, { daily_call_limit: 3 })).data.effective_limit, 3);
  await assert.rejects(ask, /used its 3 AI calls/); assert.equal(modelCalls, before + 1, 'blocked before any request to the provider');
  await as(owner, 'PUT', '/ai/workspaces/' + t.id, { daily_call_limit: 50 });
  assert.deepEqual(await ask(), { ok: true });

  await as(owner, 'PUT', '/ai/workspaces/' + t.id, { ai_enabled: false });
  await assert.rejects(ask, /switched off for this workspace/);
  await as(owner, 'PUT', '/ai/workspaces/' + t.id, { ai_enabled: true });

  await as(owner, 'PUT', '/ai/controls', { features: { property_writer: false } });
  await assert.rejects(ask, /Property writer is switched off/);
  await as(owner, 'PUT', '/ai/controls', { features: { property_writer: true } });

  await as(owner, 'PUT', '/ai/controls', { kill_switch: true });
  await assert.rejects(ask, /switched off for every workspace/);
  await as(owner, 'PUT', '/ai/controls', { kill_switch: false });
  assert.deepEqual(await ask(), { ok: true });

  // a workspace with no limit uses the platform default
  assert.equal((await as(owner, 'PUT', '/ai/controls', { default_daily_limit: 'abc' })).status, 400);
  const other = getTenantBySlug('brb').id;
  await as(owner, 'PUT', '/ai/workspaces/' + t.id, { daily_call_limit: '' });
  await as(owner, 'PUT', '/ai/controls', { default_daily_limit: 1 });
  rec(1, other);
  assert.throws(() => aiu.assertAiAllowed(other, 'property_writer'), /used its 1 AI calls/);
  await as(owner, 'PUT', '/ai/controls', { default_daily_limit: '' });

  // monthly cap needs prices, then stops AI for everyone once the estimate reaches it
  assert.equal((await as(owner, 'PUT', '/ai/controls', { monthly_cap: 5 })).status, 400);
  await as(owner, 'PUT', '/ai/settings', { price_in_per_m: 1000, price_out_per_m: 2000 });
  assert.equal((await as(owner, 'PUT', '/ai/controls', { monthly_cap: 1000 })).status, 200);
  assert.doesNotThrow(() => aiu.assertAiAllowed(t.id, 'property_writer'));
  await as(owner, 'PUT', '/ai/controls', { monthly_cap: 0.001 });
  assert.throws(() => aiu.assertAiAllowed(t.id, 'property_writer'), /monthly AI allowance is used up/);
  c = (await as(owner, 'GET', '/ai/controls')).data;
  assert.equal(c.month.over, true); assert.ok(c.workspaces.find((w) => w.id === t.id).est_cost_month > 0);
  await as(owner, 'PUT', '/ai/controls', { monthly_cap: '' });
  assert.doesNotThrow(() => aiu.assertAiAllowed(t.id, 'property_writer'));

  // permissions: viewing needs finance.view, changing needs integrations.manage
  const smm = (await call('erp.test', 'POST', `${A}/login`, { email: 'smm2@agentify.test', password: 'Saffron#Tide2026' })).cookie;
  assert.equal((await as(smm, 'GET', '/ai/controls')).status, 403);
  assert.equal((await as(smm, 'PUT', '/ai/controls', { kill_switch: true })).status, 403);
  assert.ok(platformDb().prepare("SELECT 1 FROM platform_audit WHERE action='ai-controls-changed'").get());
});
