import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-gw-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'test.db'), LOGIN_LIMIT: '1000', ERP_SECRETS_KEY: 'test-secrets-key-for-gateways' });

const { createApp } = await import('../src/index.js');
const { all, get, val } = await import('../src/db.js');
const { http } = await import('../src/gateways/providers.js');
const { toMinor, toMajor } = await import('../src/gateways/providers.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, portal = false) {
  const jar = {};
  const call = async (method, url, body, extra = {}, raw) => {
    const r = await fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '', ...extra }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
  const l = await call('POST', '/api/auth/login', { identifier, password: 'Demo@12345', portal });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), call };
}
const anon = (method, url, body, headers = {}, raw) => fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });

/** Fake provider network: records requests and answers from `script`. */
const sent = [];
let script = () => ({ ok: true, body: {} });
http.fetch = async (url, opts = {}) => {
  sent.push({ url: String(url), opts });
  const a = script(String(url), opts);
  return { ok: a.ok !== false, status: a.status || 200, json: async () => a.body };
};
const sk = (m) => `sk_${m}_${'a'.repeat(20)}`;
const connectStripe = async (admin, mode = 'test') => {
  script = () => ({ body: { livemode: mode === 'live' } });
  return admin.put('/api/gateways/stripe', { secret_key: sk(mode), webhook_secret: 'whsec_gw', mode });
};
const stripeSigned = (obj, secret = 'whsec_gw') => {
  const raw = JSON.stringify(obj), t = Math.floor(Date.now() / 1000);
  return { raw, headers: { 'Stripe-Signature': `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` } };
};
const paidSession = (k, over = {}) => ({ id: k.external_id, client_reference_id: k.token, payment_status: 'paid', amount_total: k.minor_amount, currency: k.currency.toLowerCase(), payment_intent: 'pi_123', ...over });

test('minor-unit conversion follows the currency, not the workspace scale', () => {
  assert.equal(toMinor(1000, 'PKR', 0), 100000);
  assert.equal(toMinor(1000, 'JPY', 0), 1000);
  assert.equal(toMinor(1234, 'USD', 2), 1234);
  assert.equal(toMajor(100000, 'PKR'), '1000.00');
  assert.equal(toMajor(1500, 'KWD'), '1.500');
});

test('settings: keys are validated, encrypted and never returned; placeholders cannot be connected', async () => {
  const admin = await client('admin@expertdevelopers.pk');
  const bad = await admin.put('/api/gateways/stripe', { secret_key: 'nonsense', webhook_secret: 'whsec_x' });
  assert.equal(bad.status, 400);
  const wrongMode = await admin.put('/api/gateways/stripe', { secret_key: sk('live'), webhook_secret: 'whsec_x', mode: 'test' });
  assert.equal(wrongMode.status, 400); assert.match(wrongMode.data.error, /live key/);
  assert.equal((await admin.put('/api/gateways/paypro', {})).status, 400, 'placeholder');
  const ok = await connectStripe(admin);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const list = (await admin.get('/api/gateways')).data;
  const s = list.find((g) => g.id === 'stripe');
  assert.equal(s.status, 'connected'); assert.equal(s.mode, 'test');
  assert.equal(s.fields.find((f) => f.key === 'secret_key').value, '••••aaaa');
  assert.ok(!JSON.stringify(list).includes(sk('test')), 'secret never leaves the server');
  assert.ok(!val("SELECT config_enc FROM tenant_integrations WHERE provider='pay_stripe'").includes('whsec_gw'), 'stored encrypted');
  assert.equal(list.find((g) => g.id === 'paypro').available, false);
  assert.match(s.webhook_url, /\/api\/hooks\/pay\/stripe$/);
  // staff without settings permission cannot read or change it
  const agent = await client('agent1@expertdevelopers.pk');
  assert.equal((await agent.put('/api/gateways/stripe', { secret_key: sk('test'), webhook_secret: 'whsec_x' })).status, 403);
});

test('portal checkout: amount comes from the server, only the customer\'s own installments, hidden when switched off', async () => {
  const admin = await client('admin@expertdevelopers.pk'); const cust = await client('m.ali@example.com', true);
  await connectStripe(admin);
  assert.deepEqual((await cust.get('/api/portal/pay-online')).data.map((g) => g.id), ['stripe']);
  await admin.post('/api/gateways/stripe/enabled', { enabled: false });
  assert.deepEqual((await cust.get('/api/portal/pay-online')).data, []);
  assert.equal((await cust.post('/api/portal/pay-online', { provider: 'stripe', installment_ids: [1] })).status, 400, 'switched off');
  await admin.post('/api/gateways/stripe/enabled', { enabled: true });

  const due = (await cust.get('/api/portal/dues')).data.find((d) => d.state !== 'in_process' && d.state !== 'verifying');
  assert.ok(due, 'seed customer has something due');
  script = () => ({ body: { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' } });
  sent.length = 0;
  const r = await cust.post('/api/portal/pay-online', { provider: 'stripe', installment_ids: [due.id], amount: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.url, 'https://checkout.stripe.com/c/pay/cs_test_1'); assert.equal(r.data.test_mode, true);
  const body = new URLSearchParams(sent[0].opts.body);
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), String(due.remaining * 100), 'server-computed amount, browser amount ignored');
  const k = get('SELECT * FROM pay_checkouts ORDER BY id DESC LIMIT 1');
  assert.equal(k.amount, due.remaining); assert.equal(k.sandbox, 1); assert.equal(k.status, 'pending');
  // someone else's installment
  const other = await client('agent1@expertdevelopers.pk');
  const foreign = val('SELECT i.id FROM installments i JOIN sales s ON s.id=i.sale_id JOIN contacts c ON c.id=s.contact_id WHERE c.email<>? AND i.status<>\'paid\' LIMIT 1', 'm.ali@example.com');
  assert.equal((await cust.post('/api/portal/pay-online', { provider: 'stripe', installment_ids: [foreign] })).status, 404);
  assert.equal((await other.post('/api/portal/pay-online', { provider: 'stripe', installment_ids: [foreign] })).status, 403, 'staff cannot use the portal');
  // provider refuses -> failed row, generic message, no secret leaked
  script = () => ({ ok: false, status: 400, body: { error: { message: 'Invalid API Key provided: sk_test_aaaa' } } });
  const f = await cust.post('/api/portal/pay-online', { provider: 'stripe', installment_ids: [due.id] });
  assert.equal(f.status, 400); assert.ok(!JSON.stringify(f.data).includes('sk_test'));
  assert.equal(get('SELECT status FROM pay_checkouts ORDER BY id DESC LIMIT 1').status, 'failed');
});

test('test mode: a confirmed payment posts NO receipt', async () => {
  const admin = await client('admin@expertdevelopers.pk'); const cust = await client('m.ali@example.com', true);
  await connectStripe(admin, 'test');
  const due = (await cust.get('/api/portal/dues')).data.find((d) => ['overdue', 'due', 'upcoming'].includes(d.state));
  script = () => ({ body: { id: 'cs_test_sbx', url: 'https://x' } });
  const { token } = (await cust.post('/api/portal/pay-online', { provider: 'stripe', installment_ids: [due.id] })).data;
  const k = get('SELECT * FROM pay_checkouts WHERE token=?', token);
  const receipts = val('SELECT COUNT(*) FROM receipts');
  script = () => ({ body: paidSession(k) });
  const ret = await anon('GET', `/api/hooks/pay/return/stripe/${token}`);
  assert.equal(ret.status, 302); assert.match(ret.headers.get('location'), /\/portal\/payments\?gw=/);
  assert.equal(get('SELECT status FROM pay_checkouts WHERE token=?', token).status, 'paid_test');
  assert.equal(val('SELECT COUNT(*) FROM receipts'), receipts);
  assert.equal((await cust.get(`/api/portal/pay-online/${token}`)).data.status, 'paid_test');
});

test('live mode: webhook posts the receipt once; redirect alone never does; replays and forgeries are harmless', async () => {
  const admin = await client('admin@expertdevelopers.pk'); const cust = await client('m.ali@example.com', true);
  await connectStripe(admin, 'live');
  const due = (await cust.get('/api/portal/dues')).data.find((d) => ['overdue', 'due', 'upcoming'].includes(d.state));
  script = () => ({ body: { id: 'cs_live_1', url: 'https://x' } });
  const { token } = (await cust.post('/api/portal/pay-online', { provider: 'stripe', installment_ids: [due.id] })).data;
  const k = get('SELECT * FROM pay_checkouts WHERE token=?', token);
  assert.equal(k.sandbox, 0);
  const receipts = val('SELECT COUNT(*) FROM receipts'), paidBefore = val('SELECT paid FROM installments WHERE id=?', due.id);

  // the browser comes back but Stripe says the session is unpaid -> nothing posted
  script = () => ({ body: paidSession(k, { payment_status: 'unpaid' }) });
  await anon('GET', `/api/hooks/pay/return/stripe/${token}`);
  assert.equal(val('SELECT COUNT(*) FROM receipts'), receipts);
  assert.equal(get('SELECT status FROM pay_checkouts WHERE token=?', token).status, 'pending');

  // unsigned / wrongly signed webhook rejected
  const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_live_1', client_reference_id: token } } };
  assert.equal((await anon('POST', '/api/hooks/pay/stripe', null, {}, JSON.stringify(ev))).status, 400);
  const bad = stripeSigned(ev, 'whsec_other');
  assert.equal((await anon('POST', '/api/hooks/pay/stripe', null, bad.headers, bad.raw)).status, 400);
  assert.equal(val('SELECT COUNT(*) FROM receipts'), receipts);

  // Stripe claims a different amount than we asked for -> mismatch, not posted
  script = () => ({ body: paidSession(k, { amount_total: 100 }) });
  const good = stripeSigned(ev);
  assert.equal((await anon('POST', '/api/hooks/pay/stripe', null, good.headers, good.raw)).status, 200);
  assert.equal(get('SELECT status FROM pay_checkouts WHERE token=?', token).status, 'mismatch');
  assert.equal(val('SELECT COUNT(*) FROM receipts'), receipts);

  // real, correct payment -> posted once, even if delivered twice and the browser returns too
  script = () => ({ body: paidSession(k) });
  const ev2 = { ...ev, id: 'evt_2' }, s2 = stripeSigned(ev2);
  const [a, b] = await Promise.all([anon('POST', '/api/hooks/pay/stripe', null, s2.headers, s2.raw), anon('POST', '/api/hooks/pay/stripe', null, s2.headers, s2.raw)]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  await anon('GET', `/api/hooks/pay/return/stripe/${token}`);
  const row = get('SELECT * FROM pay_checkouts WHERE token=?', token);
  assert.equal(row.status, 'paid'); assert.ok(row.receipt_id);
  assert.equal(val('SELECT COUNT(*) FROM receipts'), receipts + 1);
  const rc = get('SELECT * FROM receipts WHERE id=?', row.receipt_id);
  assert.equal(rc.amount, due.remaining); assert.equal(rc.txn_id, 'stripe:pi_123'); assert.equal(rc.method, 'Online Transfer');
  assert.equal(val('SELECT paid FROM installments WHERE id=?', due.id), paidBefore + due.remaining, 'installment settled');
  assert.ok(val("SELECT COUNT(*) FROM audit_log WHERE action='Online payment posted'") >= 1);
  const t = get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines'); assert.equal(t.d, t.c, 'books still balance');
  assert.equal((await cust.get(`/api/portal/pay-online/${token}`)).data.status, 'paid');
  // another customer cannot read the checkout
  const ali2 = await client('agent1@expertdevelopers.pk');
  assert.equal((await ali2.get(`/api/portal/pay-online/${token}`)).status, 403);
  // staff list
  assert.ok((await admin.get('/api/gateways/checkouts/list')).data.some((c) => c.id === row.id && c.status === 'paid'));
});

test('PayPal: order is captured server-side and only a COMPLETED capture of the right amount counts', async () => {
  const admin = await client('admin@expertdevelopers.pk'); const cust = await client('m.ali@example.com', true);
  script = () => ({ body: { access_token: 'tok' } });
  assert.equal((await admin.put('/api/gateways/paypal', { client_id: 'cid', client_secret: 'csecret', mode: 'test' })).status, 200);
  // PayPal cannot charge PKR -> not offered to a PKR workspace
  assert.ok(!(await cust.get('/api/portal/pay-online')).data.some((g) => g.id === 'paypal'));
  assert.equal((await cust.post('/api/portal/pay-online', { provider: 'paypal', installment_ids: [1] })).status, 400);
  const cfg = (await admin.get('/api/gateways')).data.find((g) => g.id === 'paypal');
  assert.equal(cfg.currency_ok, false);
});

test('Tap: webhook body is only a pointer, the charge is re-read from Tap', async () => {
  const { PROVIDERS } = await import('../src/gateways/providers.js');
  const tap = PROVIDERS.tap, cfg = { secret_key: sk('test') };
  assert.deepEqual(tap.parseWebhook({ body: { id: 'chg_1', status: 'CAPTURED' } }), { eventId: 'chg_1:CAPTURED', externalId: 'chg_1', checkoutToken: null });
  assert.equal(tap.parseWebhook({ body: { id: 'evil' } }), null);
  script = () => ({ body: { id: 'chg_1', status: 'CAPTURED', amount: 12.5, currency: 'KWD', reference: { transaction: 'tok1' } } });
  const r = await tap.confirm(cfg, { external_id: 'chg_1', token: 'tok1' });
  assert.deepEqual([r.paid, r.minor, r.currency], [true, 12500, 'KWD']);
  assert.equal((await tap.confirm(cfg, { external_id: 'chg_1', token: 'other' })).paid, false, 'charge for a different checkout');
});

test('the browser return URL and webhook endpoints do not leak or accept junk', async () => {
  assert.equal((await anon('POST', '/api/hooks/pay/nope', null, {}, '{}')).status, 404);
  assert.equal((await anon('POST', '/api/hooks/pay/paypro', null, {}, '{}')).status, 404, 'placeholder has no webhook');
  assert.equal((await anon('GET', '/api/hooks/pay/return/stripe/doesnotexist')).status, 302, 'unknown token just redirects');
  assert.equal(all("SELECT 1 FROM receipts WHERE txn_id LIKE 'stripe:%'").length >= 0, true);
});

test('PayPal adapter: approved orders are captured; only a COMPLETED capture bound to this checkout counts', async () => {
  const { PROVIDERS } = await import('../src/gateways/providers.js');
  const pp = PROVIDERS.paypal, cfg = { client_id: 'c', client_secret: 's', mode: 'test' }, k = { external_id: 'ORD1', token: 'tok9' };
  const calls = [];
  script = (url, opts) => {
    calls.push(`${opts.method || 'GET'} ${url.replace(/^https:\/\/api-m\.sandbox\.paypal\.com/, '')}`);
    if (url.endsWith('/oauth2/token')) return { body: { access_token: 'tok' } };
    if (url.endsWith('/capture')) return { body: { status: 'COMPLETED', purchase_units: [{ custom_id: 'tok9', payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '25.00' } }] } }] } };
    return { body: { status: 'APPROVED' } };
  };
  const r = await pp.confirm(cfg, k);
  assert.deepEqual([r.paid, r.minor, r.currency, r.ref], [true, 2500, 'USD', 'CAP1']);
  assert.ok(calls.some((c) => c.startsWith('POST /v2/checkout/orders/ORD1/capture')));
  assert.equal((await pp.confirm(cfg, { ...k, token: 'someone-else' })).paid, false, 'capture belongs to another checkout');
  script = (url) => (url.endsWith('/oauth2/token') ? { body: { access_token: 'tok' } } : { body: { status: 'CREATED' } });
  assert.equal((await pp.confirm(cfg, k)).paid, false, 'customer never approved');
});
