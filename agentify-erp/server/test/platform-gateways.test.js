import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-pgw-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_PLATFORM_ADMIN_TOKEN: 'operator-secret', BILLING_PROVIDER: 'manual', ERP_SECRETS_KEY: 'pgw-test-key' });

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { http: provHttp } = await import('../src/gateways/providers.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, headers: res.headers, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const OP = { authorization: 'Bearer operator-secret' }, PW = 'Tenant@12345';
const sent = []; let script = () => ({ body: {} });
provHttp.fetch = async (url, opts = {}) => { sent.push({ url: String(url), opts }); const a = script(String(url), opts); return { ok: a.ok !== false, status: a.status || 200, json: async () => a.body }; };

async function workspace(slug) {
  const r = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Co`, admin_name: 'Owner', admin_email: `owner@${slug}.test`, admin_password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  platformDb().prepare("UPDATE tenants SET currency='USD' WHERE slug=?").run(slug);
  const host = `${slug}.erp.test`; const l = await call(host, 'POST', '/api/auth/login', { identifier: `owner@${slug}.test`, password: PW }); const c = l.cookie;
  return { host, id: r.data.tenant.id, slug, get: (u) => call(host, 'GET', u, null, { cookie: c }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }) };
}
const row = (slug) => platformDb().prepare('SELECT * FROM tenants WHERE slug=?').get(slug);
const orderOk = (k, over = {}) => ({ id: k.external_id, status: 'COMPLETED', purchase_units: [{ custom_id: k.token, payments: { captures: [{ id: 'CAP9', status: 'COMPLETED', amount: { currency_code: k.currency, value: (k.minor_amount / 100).toFixed(2) } }] } }], ...over });
const connectPaypal = async (mode, enabled = true) => {
  script = () => ({ body: { access_token: 't' } });
  return call('erp.test', 'PUT', '/api/platform/admin/settings/gateways/paypal', { client_id: 'cid-123', client_secret: 'csecret-9876', mode, enabled }, OP);
};

test('console: keys are write-only, not live until keys + switch on, placeholders refuse keys', async () => {
  const before = await call('erp.test', 'GET', '/api/platform/admin/settings/gateways', null, OP);
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.equal(before.data.gateways.find((g) => g.id === 'paypal').status, 'no_keys');
  assert.equal(before.data.gateways.find((g) => g.id === 'paypro').status, 'not_built');
  assert.equal((await call('erp.test', 'PUT', '/api/platform/admin/settings/gateways/paypro', {}, OP)).status, 400);
  const ok = await connectPaypal('test');
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const pp = ok.data.gateways.find((g) => g.id === 'paypal');
  assert.equal(pp.status, 'test'); assert.ok(!JSON.stringify(ok.data).includes('csecret-9876'), 'secret never returned');
  assert.equal(pp.fields.find((f) => f.key === 'client_secret').value, '…9876');
  assert.ok(!platformDb().prepare("SELECT value FROM platform_settings WHERE key='pgw_paypal_client_secret'").get().value.includes('csecret'), 'stored encrypted');
  assert.equal((await call('erp.test', 'POST', '/api/platform/admin/settings/gateways/paypal/enabled', { enabled: false }, OP)).data.gateways.find((g) => g.id === 'paypal').status, 'off');
  assert.equal((await call('erp.test', 'GET', '/api/platform/admin/settings/gateways')).status, 401, 'operators only');
});

test('test mode: customer sees the gateway, pays, plan does NOT change', async () => {
  await connectPaypal('test');
  const w = await workspace('pgw1');
  const st = (await w.get('/api/billing')).data;
  assert.ok(st.methods.some((m) => m.id === 'paypal' && m.kind === 'gateway' && m.test_mode));
  script = () => ({ body: { id: 'ORD-T1', links: [{ rel: 'payer-action', href: 'https://paypal.test/approve' }], access_token: 't' } });
  sent.length = 0;
  const r = await w.post('/api/billing/gateway-checkout', { provider: 'paypal', plan: 'growth', interval: 'month', amount: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.url, 'https://paypal.test/approve');
  const order = JSON.parse(sent.find((s) => s.url.endsWith('/v2/checkout/orders')).opts.body);
  assert.equal(order.purchase_units[0].amount.value, '79.00', 'server-side quote: USD growth monthly');
  const k = platformDb().prepare('SELECT * FROM platform_checkouts ORDER BY id DESC LIMIT 1').get();
  assert.equal(k.sandbox, 1);
  script = (url) => (url.endsWith('/oauth2/token') ? { body: { access_token: 't' } } : { body: orderOk(k) });
  const ret = await call('pgw1.erp.test', 'GET', `/api/platform/pay/return/paypal/${k.token}`);
  assert.equal(ret.status, 302); assert.match(ret.headers.location, /\/settings\/billing\?gw=/);
  assert.equal(platformDb().prepare('SELECT status FROM platform_checkouts WHERE id=?').get(k.id).status, 'paid_test');
  assert.equal(row('pgw1').subscription_status, 'trialing', 'test payments never activate a plan');
  assert.equal((await w.get(`/api/billing/gateway-checkout/${k.token}`)).data.status, 'paid_test');
});

test('live mode: only a provider-confirmed, matching payment activates the plan, once', async () => {
  await connectPaypal('live');
  const w = await workspace('pgw2'); const other = await workspace('pgw3');
  script = () => ({ body: { id: 'ORD-L1', links: [{ rel: 'payer-action', href: 'https://paypal.test/a' }], access_token: 't' } });
  assert.equal((await w.post('/api/billing/gateway-checkout', { provider: 'paypal', plan: 'growth', interval: 'month' })).status, 200);
  const k = platformDb().prepare('SELECT * FROM platform_checkouts ORDER BY id DESC LIMIT 1').get();
  assert.equal(k.sandbox, 0);
  const tok = (b) => (url) => (url.endsWith('/oauth2/token') ? { body: { access_token: 't' } } : { body: b });
  // customer comes back but PayPal says it was never approved -> nothing
  script = tok({ id: k.external_id, status: 'CREATED' });
  await call('pgw2.erp.test', 'GET', `/api/platform/pay/return/paypal/${k.token}`);
  assert.equal(row('pgw2').subscription_status, 'trialing');
  // wrong amount -> mismatch, nothing activates
  script = tok(orderOk({ ...k, minor_amount: 100 }));
  await call('pgw2.erp.test', 'GET', `/api/platform/pay/return/paypal/${k.token}`);
  assert.equal(platformDb().prepare('SELECT status FROM platform_checkouts WHERE id=?').get(k.id).status, 'mismatch');
  assert.equal(row('pgw2').subscription_status, 'trialing');
  // a capture that belongs to another checkout is not ours
  script = tok(orderOk(k, { purchase_units: [{ custom_id: 'someone-else', payments: { captures: [{ id: 'C', status: 'COMPLETED', amount: { currency_code: 'USD', value: '79.00' } }] } }] }));
  await call('pgw2.erp.test', 'GET', `/api/platform/pay/return/paypal/${k.token}`);
  assert.equal(row('pgw2').subscription_status, 'trialing');
  // the real thing, delivered twice in parallel
  script = tok(orderOk(k));
  await Promise.all([1, 2].map(() => call('pgw2.erp.test', 'GET', `/api/platform/pay/return/paypal/${k.token}`)));
  const t = row('pgw2');
  assert.equal(t.subscription_status, 'active'); assert.equal(t.plan, 'growth'); assert.equal(t.billing_provider, 'paypal');
  assert.equal(platformDb().prepare('SELECT status FROM platform_checkouts WHERE id=?').get(k.id).status, 'paid');
  const inv = platformDb().prepare("SELECT * FROM invoices WHERE tenant_id=? AND provider_invoice_id LIKE 'local-%'").all(t.id);
  assert.equal(inv.length, 1, 'exactly one invoice'); assert.equal(inv[0].amount, 79);
  assert.equal(row('pgw3').subscription_status, 'trialing', 'another workspace untouched');
  assert.equal((await other.get(`/api/billing/gateway-checkout/${k.token}`)).status, 404, 'cannot read another workspace\'s payment');
  // manual billing still works alongside
  assert.ok((await w.get('/api/billing')).data.methods.some((m) => m.kind === 'gateway'));
});

test('webhook: unverifiable senders cannot activate anything; unknown providers 404', async () => {
  await connectPaypal('live');
  // PayPal webhook with no webhook id configured -> ignored
  assert.equal((await call('erp.test', 'POST', '/api/platform/pay/webhook/paypal', { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORD-L1' } })).status, 200);
  assert.equal((await call('erp.test', 'POST', '/api/platform/pay/webhook/nope', {})).status, 404);
  assert.equal((await call('erp.test', 'POST', '/api/platform/pay/webhook/paypro', {})).status, 404);
});

test('a workspace whose own currency the gateway cannot charge is billed in a plan currency it can', async () => {
  await connectPaypal('live');
  const w = await workspace('pgw4');
  platformDb().prepare("UPDATE tenants SET currency='PKR' WHERE slug='pgw4'").run();
  assert.ok((await w.get('/api/billing')).data.methods.some((m) => m.id === 'paypal'));
  script = () => ({ body: { id: 'ORD-X', links: [{ rel: 'payer-action', href: 'https://paypal.test/x' }], access_token: 't' } });
  assert.equal((await w.post('/api/billing/gateway-checkout', { provider: 'paypal', plan: 'growth', interval: 'month' })).status, 200);
  assert.equal(platformDb().prepare('SELECT currency FROM platform_checkouts ORDER BY id DESC LIMIT 1').get().currency, 'USD');
});
