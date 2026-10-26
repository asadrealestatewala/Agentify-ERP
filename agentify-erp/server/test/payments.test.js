import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-pay-'));
const WH = 'whsec_stripe_test';
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_PLATFORM_ADMIN_TOKEN: 'operator-secret', BILLING_PROVIDER: 'manual', STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: WH,
  STRIPE_PRICE_GROWTH_MONTH: 'price_growth_m', STRIPE_PRICE_STARTER_MONTH: 'price_starter_m',
  BILLING_PK_ACCOUNTS: JSON.stringify([{ method: 'raast', account: '03001234567', name: 'Agentify Pvt Ltd', note: 'Raast ID' }, { method: 'easypaisa', account: '03007654321', name: 'Agentify Pvt Ltd' }]) });

const { createApp } = await import('../src/index.js');
const stripe = await import('../src/services/stripe.js');
const { outbox } = await import('../src/services/mailer.js');
const { platformDb } = await import('../src/platform.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}, raw) => new Promise((resolve, reject) => {
  const data = raw ?? (body ? JSON.stringify(body) : null);
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const PW = 'Tenant@12345', OP = { authorization: 'Bearer operator-secret' };
const row = (slug) => platformDb().prepare('SELECT * FROM tenants WHERE slug=?').get(slug);
const patch = (slug, f) => platformDb().prepare(`UPDATE tenants SET ${Object.keys(f).map((k) => `${k}=?`).join(',')} WHERE slug=?`).run(...Object.values(f), slug);
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const unix = (n) => Math.floor((Date.now() + n * 864e5) / 1000);

async function workspace(slug) {
  const r = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Co`, admin_name: 'Owner', admin_email: `owner@${slug}.test`, admin_password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const host = `${slug}.erp.test`; const l = await call(host, 'POST', '/api/auth/login', { identifier: `owner@${slug}.test`, password: PW }); const c = l.cookie;
  return { host, id: r.data.tenant.id, slug, get: (u) => call(host, 'GET', u, null, { cookie: c }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }) };
}
const signed = (ev, { secret = WH, t = Math.floor(Date.now() / 1000) } = {}) => {
  const raw = JSON.stringify(ev);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return call('erp.test', 'POST', '/api/platform/billing/webhook/stripe', null, { 'Stripe-Signature': `t=${t},v1=${v1}` }, raw);
};
let n = 0;
const ev = (type, object) => ({ id: `evt_${++n}`, type, data: { object } });

test('card checkout creates a hosted Stripe session tagged with the workspace', async () => {
  const w = await workspace('card1');
  const calls = [];
  stripe.http.fetch = async (url, opts) => { calls.push({ url, opts, body: new URLSearchParams(opts.body) }); return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }; };
  const r = await w.post('/api/billing/checkout', { plan: 'growth', interval: 'month' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.deepEqual(r.data, { mode: 'redirect', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  const c = calls[0];
  assert.equal(c.url, 'https://api.stripe.com/v1/checkout/sessions'); assert.equal(c.opts.headers.Authorization, 'Bearer sk_test_123');
  assert.equal(c.body.get('mode'), 'subscription'); assert.equal(c.body.get('line_items[0][price]'), 'price_growth_m'); assert.equal(c.body.get('client_reference_id'), String(w.id));
  assert.equal(c.body.get('subscription_data[metadata][tenant_id]'), String(w.id)); assert.equal(c.body.get('subscription_data[metadata][plan]'), 'growth'); assert.equal(c.body.get('customer_email'), 'owner@card1.test');
  assert.match(c.body.get('success_url'), /^http:\/\/card1\.erp\.test:?\d*\/settings\/billing\?paid=1$|^http:\/\/card1\.erp\.test\/settings\/billing\?paid=1$/);
  assert.equal((await w.post('/api/billing/checkout', { plan: 'enterprise', interval: 'month' })).status, 503, 'no price configured for that plan');
  stripe.http.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'No such price' } }) });
  assert.equal((await w.post('/api/billing/checkout', { plan: 'growth', interval: 'month' })).status, 502);
});

test('Stripe webhooks: signature and freshness are enforced', async () => {
  await workspace('sig1');
  const e = ev('checkout.session.completed', { mode: 'subscription', client_reference_id: String(row('sig1').id), customer: 'cus_s', subscription: 'sub_s', metadata: { plan: 'growth', interval: 'month' } });
  assert.equal((await signed(e, { secret: 'whsec_wrong' })).status, 401);
  assert.equal((await signed(e, { t: Math.floor(Date.now() / 1000) - 3600 })).status, 401, 'stale timestamp is a replay');
  assert.equal((await call('erp.test', 'POST', '/api/platform/billing/webhook/stripe', e)).status, 401, 'unsigned');
  assert.equal(row('sig1').plan, 'trial', 'nothing applied');
});

test('Stripe subscription lifecycle drives the workspace state', async () => {
  const w = await workspace('life1'); const other = await workspace('life2'); const id = w.id;
  const done = await signed(ev('checkout.session.completed', { mode: 'subscription', client_reference_id: String(id), customer: 'cus_L', subscription: 'sub_L', metadata: { tenant_id: String(id), plan: 'growth', interval: 'month' } }));
  assert.deepEqual(done.data, { ok: true, applied: true });
  let t = row('life1'); assert.equal(t.plan, 'growth'); assert.equal(t.subscription_status, 'active'); assert.equal(t.billing_provider, 'stripe'); assert.equal(t.provider_customer_id, 'cus_L');
  const dup = ev('customer.subscription.updated', { id: 'sub_L', customer: 'cus_L', status: 'active', metadata: { tenant_id: String(id) }, items: { data: [{ price: { id: 'price_growth_m' }, current_period_end: unix(30) }] } });
  assert.equal((await signed(dup)).data.applied, true);
  assert.equal((await signed(dup)).data.applied, false, 'Stripe retries are harmless');
  assert.equal(row('life1').current_period_end, inDays(30), 'period end read from the subscription item (current API layout)');
  // a plan change made in the customer portal maps back through the price id
  await signed(ev('customer.subscription.updated', { id: 'sub_L', customer: 'cus_L', status: 'active', metadata: {}, current_period_end: unix(31), items: { data: [{ price: { id: 'price_starter_m' } }] } }));
  assert.equal(row('life1').plan, 'starter'); assert.equal(row('life1').current_period_end, inDays(31), 'older layout with the period on the subscription');
  // invoices carry no metadata: found through the Stripe customer id
  await signed(ev('invoice.paid', { id: 'in_1', customer: 'cus_L', subscription: 'sub_L', amount_paid: 2900, currency: 'usd', hosted_invoice_url: 'https://invoice.stripe.com/i/1' }));
  const inv = (await w.get('/api/billing')).data.invoices; assert.equal(inv.length, 1); assert.equal(inv[0].amount, 29); assert.equal(inv[0].currency, 'USD');
  // failed payment: grace, still writable
  await signed(ev('invoice.payment_failed', { id: 'in_2', customer: 'cus_L', subscription: 'sub_L' }));
  let b = (await w.get('/api/billing')).data; assert.equal(b.status, 'past_due'); assert.equal(b.locked, false);
  await signed(ev('invoice.paid', { id: 'in_3', customer: 'cus_L', subscription: 'sub_L', amount_paid: 2900, currency: 'usd' }));
  assert.equal((await w.get('/api/billing')).data.status, 'active');
  // cancel at period end keeps access until then; deletion ends it
  await signed(ev('customer.subscription.updated', { id: 'sub_L', customer: 'cus_L', status: 'active', cancel_at_period_end: true, metadata: { tenant_id: String(id) }, items: { data: [{ price: { id: 'price_starter_m' }, current_period_end: unix(10) }] } }));
  b = (await w.get('/api/billing')).data; assert.equal(b.status, 'canceled'); assert.equal(b.locked, false);
  await signed(ev('customer.subscription.deleted', { id: 'sub_L', customer: 'cus_L', ended_at: unix(-1), metadata: { tenant_id: String(id) } }));
  b = (await w.get('/api/billing')).data; assert.equal(b.locked, true); assert.equal(b.reason, 'subscription_ended');
  assert.equal((await other.get('/api/billing')).data.status, 'trialing', 'other workspaces untouched');
  // noise we do not act on is acknowledged, not retried forever
  assert.equal((await signed(ev('charge.succeeded', { id: 'ch_1' }))).data.ignored, true);
  assert.equal((await signed(ev('invoice.paid', { id: 'in_x', customer: 'cus_unknown', amount_paid: 100, currency: 'usd' }))).data.ignored, true);
  assert.equal((await signed(ev('checkout.session.completed', { mode: 'payment' }))).data.ignored, true);
});

test('customer portal needs an existing card subscription', async () => {
  const w = await workspace('portal1');
  assert.equal((await w.post('/api/billing/portal')).status, 400);
  await signed(ev('checkout.session.completed', { mode: 'subscription', client_reference_id: String(w.id), customer: 'cus_P', subscription: 'sub_P', metadata: { plan: 'growth', interval: 'month' } }));
  let body;
  stripe.http.fetch = async (url, opts) => { body = new URLSearchParams(opts.body); return { ok: true, json: async () => ({ url: 'https://billing.stripe.com/p/session/x' }) }; };
  const r = await w.post('/api/billing/portal');
  assert.equal(r.data.url, 'https://billing.stripe.com/p/session/x'); assert.equal(body.get('customer'), 'cus_P');
});

test('local methods are offered only when configured, next to card', async () => {
  const w = await workspace('methods1');
  const m = (await w.get('/api/billing')).data.methods;
  assert.deepEqual(m.map((x) => x.id), ['card', 'raast', 'easypaisa']);
  assert.equal(m[1].account, '03001234567'); assert.equal(m[1].kind, 'transfer');
});

test('Raast / Easypaisa payment: submit, operator confirms, plan activates; references cannot be reused', async () => {
  const w = await workspace('local1'); const w2 = await workspace('local2');
  const pay = (ws, b) => ws.post('/api/billing/manual-payment', b);
  assert.equal((await pay(w, { plan: 'growth', method: 'raast', reference: '123' })).status, 400, 'reference too short');
  assert.equal((await pay(w, { plan: 'growth', method: 'jazzcash', reference: 'JC-0001-XYZ' })).status, 400, 'method not offered');
  assert.equal((await pay(w, { plan: 'nope', method: 'raast', reference: 'RST-100001' })).status, 400);
  const s = await pay(w, { plan: 'growth', interval: 'month', method: 'raast', reference: 'RST-100001' });
  assert.equal(s.status, 201, JSON.stringify(s.data)); assert.equal(s.data.amount, 22000); assert.equal(s.data.currency, 'PKR');
  assert.equal((await pay(w, { plan: 'growth', method: 'raast', reference: 'RST-100002' })).status, 400, 'one pending payment at a time');
  assert.equal((await pay(w2, { plan: 'growth', method: 'raast', reference: 'rst-100001' })).status, 409, 'same reference, different workspace');
  assert.equal(row('local1').subscription_status, 'trialing', 'nothing activates before confirmation');
  const shown = (await w.get('/api/billing')).data.payments; assert.equal(shown[0].status, 'pending');
  // operator side
  assert.equal((await call('erp.test', 'GET', '/api/platform/payments')).status, 401);
  const pending = (await call('erp.test', 'GET', '/api/platform/payments?status=pending', null, OP)).data;
  const mine = pending.find((p) => p.slug === 'local1'); assert.ok(mine);
  const ok = await call('erp.test', 'POST', `/api/platform/payments/${mine.id}/approve`, { note: 'seen in Raast app' }, OP);
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.subscription_status, 'active'); assert.equal(ok.data.plan, 'growth');
  const t = row('local1'); const exp = new Date(); exp.setUTCMonth(exp.getUTCMonth() + 1);
  assert.ok(Math.abs(Date.parse(t.current_period_end) - exp.getTime()) < 4 * 864e5, `period end ${t.current_period_end}`);
  assert.equal(t.billing_provider, 'raast');
  assert.equal((await w.get('/api/billing')).data.invoices[0].amount, 22000);
  const rcpt = outbox.filter((m) => m.to === 'owner@local1.test' && /^Payment received/.test(m.subject));
  assert.equal(rcpt.length, 1, 'one receipt');
  assert.equal(rcpt[0].from, 'Agentify ERP Billing <billing@agentifyerp.co>');
  assert.match(rcpt[0].text, /PKR 22,000/); assert.match(rcpt[0].text, /RST-100001/); assert.match(rcpt[0].text, /Have a question\? Mail us at billing@agentifyerp\.co/);
  assert.equal((await call('erp.test', 'POST', `/api/platform/payments/${mine.id}/approve`, {}, OP)).status, 400, 'cannot approve twice');
  // renewing early extends from the current period end instead of losing days
  const again = await pay(w, { plan: 'growth', interval: 'year', method: 'easypaisa', reference: 'EP-9000001' });
  const before = row('local1').current_period_end;
  await call('erp.test', 'POST', `/api/platform/payments/${again.data.id}/approve`, {}, OP);
  const after = row('local1').current_period_end;
  assert.ok(Date.parse(after) - Date.parse(before) > 360 * 864e5, `${before} -> ${after}`);
});

test('a rejected payment needs a reason, tells the customer, and the reference can be sent again', async () => {
  const w = await workspace('reject1');
  const s = await w.post('/api/billing/manual-payment', { plan: 'starter', method: 'easypaisa', reference: 'EP-REJ-0001' });
  assert.equal((await call('erp.test', 'POST', `/api/platform/payments/${s.data.id}/reject`, {}, OP)).status, 400, 'reason required');
  assert.equal((await call('erp.test', 'POST', `/api/platform/payments/${s.data.id}/reject`, { note: 'Amount does not match' }, OP)).status, 200);
  assert.match(outbox.filter((m) => m.to === 'owner@reject1.test').pop().text, /Amount does not match/);
  assert.equal(row('reject1').subscription_status, 'trialing');
  assert.equal((await w.post('/api/billing/manual-payment', { plan: 'starter', method: 'easypaisa', reference: 'EP-REJ-0001' })).status, 201, 'corrected resubmission');
});

test('a confirmed payment unlocks a workspace whose trial had ended', async () => {
  const w = await workspace('unlock1');
  patch('unlock1', { trial_ends_at: inDays(-2) });
  assert.equal((await w.post('/api/contacts', { full_name: 'X', phone: '+92 300 1', lead_source: 'Walk-in' })).status, 402);
  const s = await w.post('/api/billing/manual-payment', { plan: 'starter', method: 'raast', reference: 'RST-UNLOCK-1' });
  assert.equal(s.status, 201, 'billing endpoints stay open while locked');
  await call('erp.test', 'POST', `/api/platform/payments/${s.data.id}/approve`, {}, OP);
  assert.equal((await w.post('/api/contacts', { full_name: 'Y', phone: '+92 300 2', lead_source: 'Walk-in' })).status, 201);
});

test('a paid Stripe invoice sends one receipt from billing@, and a retried webhook sends none', async () => {
  const w = await workspace('rcpt1');
  patch('rcpt1', { provider_customer_id: 'cus_R', provider_subscription_id: 'sub_R', plan: 'growth', subscription_status: 'active' });
  const before = outbox.length;
  const e = ev('invoice.paid', { id: 'in_rcpt1', customer: 'cus_R', subscription: 'sub_R', amount_paid: 2900, currency: 'usd' });
  await signed(e); await signed(e); await signed(ev('invoice.paid', { id: 'in_rcpt1', customer: 'cus_R', subscription: 'sub_R', amount_paid: 2900, currency: 'usd' }));
  const mails = outbox.slice(before).filter((m) => m.to === 'owner@rcpt1.test' && /^Payment received/.test(m.subject));
  assert.equal(mails.length, 1, 'exactly one receipt for one invoice');
  assert.equal(mails[0].from, 'Agentify ERP Billing <billing@agentifyerp.co>'); assert.match(mails[0].text, /USD 29/); assert.match(mails[0].text, /in_rcpt1/);
  assert.ok(!/sk_test|whsec|password/i.test(mails[0].text), 'no secrets in the mail');
  // zero-amount (trial) invoices send nothing
  await signed(ev('invoice.paid', { id: 'in_rcpt0', customer: 'cus_R', subscription: 'sub_R', amount_paid: 0, currency: 'usd' }));
  assert.equal(outbox.slice(before).filter((m) => /^Payment received/.test(m.subject)).length, 1);
  // console: receipts are listed and can be re-sent; billing view only
  const list = await call('erp.test', 'GET', '/api/platform/admin/billing-mail', null, OP);
  assert.equal(list.status, 200, JSON.stringify(list.data)); assert.equal(list.data.address, 'billing@agentifyerp.co');
  const rc = list.data.receipts.find((r) => r.reference === 'in_rcpt1'); assert.ok(rc);
  const n0 = outbox.length;
  assert.equal((await call('erp.test', 'POST', `/api/platform/admin/billing-mail/receipts/${rc.id}/resend`, {}, OP)).status, 200);
  assert.equal(outbox.length, n0 + 1);
  assert.equal((await call('erp.test', 'POST', '/api/platform/admin/billing-mail/receipts/99999/resend', {}, OP)).status, 404);
  assert.equal((await call('erp.test', 'GET', '/api/platform/admin/billing-mail')).status, 401);
  void w;
});

test('a failed card payment emails the owner once from billing@; renewal reminders also come from billing@', async () => {
  await workspace('fail1');
  patch('fail1', { provider_customer_id: 'cus_F', provider_subscription_id: 'sub_F', plan: 'growth', subscription_status: 'active' });
  const before = outbox.length;
  await signed(ev('invoice.payment_failed', { id: 'in_f1', customer: 'cus_F', subscription: 'sub_F' }));
  await signed(ev('customer.subscription.updated', { id: 'sub_F', customer: 'cus_F', status: 'past_due', metadata: { tenant_id: String(row('fail1').id), plan: 'growth' } }));
  const m = outbox.slice(before).filter((x) => x.to === 'owner@fail1.test' && /not successful/.test(x.subject));
  assert.equal(m.length, 1, 'one failure notice for one failed payment');
  assert.equal(m[0].from, 'Agentify ERP Billing <billing@agentifyerp.co>'); assert.match(m[0].text, /Mail us at billing@agentifyerp\.co/);
  patch('fail1', { subscription_status: 'active', billing_provider: 'raast', current_period_end: inDays(2), grace_until: null });
  const { runLifecycle } = await import('../src/services/lifecycle.js');
  await runLifecycle();
  const r = outbox.filter((x) => x.to === 'owner@fail1.test' && /renews on/.test(x.subject)).pop();
  assert.ok(r, 'renewal reminder sent'); assert.equal(r.from, 'Agentify ERP Billing <billing@agentifyerp.co>');
});
