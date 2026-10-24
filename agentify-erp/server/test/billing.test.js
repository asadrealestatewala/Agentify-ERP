import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-billing-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_PLATFORM_ADMIN_TOKEN: 'operator-secret', BILLING_WEBHOOK_SECRET: 'whsec_test', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { outbox } = await import('../src/services/mailer.js');
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
const PW = 'Tenant@12345';
const OP = { authorization: 'Bearer operator-secret' };
const tenantRow = (slug) => platformDb().prepare('SELECT * FROM tenants WHERE slug=?').get(slug);
const patchTenant = (slug, fields) => platformDb().prepare(`UPDATE tenants SET ${Object.keys(fields).map((k) => `${k}=?`).join(',')} WHERE slug=?`).run(...Object.values(fields), slug);
const daysFromNow = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const webhook = (ev, secret = 'whsec_test') => { const raw = JSON.stringify(ev); return call('erp.test', 'POST', '/api/platform/billing/webhook/generic', null, { 'X-Signature': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` }, raw); };

async function workspace(slug) {
  const r = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Co`, admin_name: 'Owner', admin_email: `owner@${slug}.test`, admin_password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const host = `${slug}.erp.test`;
  const tok = outbox.filter((m) => m.to === `owner@${slug}.test`).pop().text.match(/verify-email\/(\S+)/)[1];
  assert.equal((await call(host, 'POST', '/api/auth/verify-email', { token: tok })).status, 200);
  const l = await call(host, 'POST', '/api/auth/login', { identifier: `owner@${slug}.test`, password: PW });
  const c = l.cookie;
  return { host, id: r.data.tenant.id, get: (u) => call(host, 'GET', u, null, { cookie: c }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }), put: (u, b) => call(host, 'PUT', u, b || {}, { cookie: c }) };
}

test('a new workspace starts on a 7-day trial (the default) with trial limits', async () => {
  const w = await workspace('trialco');
  const b = await w.get('/api/billing');
  assert.equal(b.status, 200);
  assert.equal(b.data.status, 'trialing'); assert.equal(b.data.locked, false);
  assert.ok(b.data.days_left >= 6 && b.data.days_left <= 7, `days_left ${b.data.days_left}`);
  assert.equal(b.data.usage.seats, 1);
  assert.equal(b.data.plans.length, 3);
});

test('seat limit counts users and pending invitations, and is lifted by upgrading', async () => {
  const w = await workspace('seats');
  assert.equal((await call('erp.test', 'POST', `/api/platform/tenants/${w.id}/subscription`, { plan: 'starter', period_end: daysFromNow(30) }, OP)).status, 200);
  const roles = (await w.get('/api/settings/roles')).data;
  const agent = roles.find((r) => r.name === 'Sales Agent').id;
  for (let i = 1; i <= 3; i += 1) assert.equal((await w.post('/api/settings/users', { name: `User ${'ABC'[i - 1]}`, email: `u${i}@seats.test`, password: 'Passw0rd!x', role_id: agent })).status, 201);
  assert.equal((await w.post('/api/settings/invites', { email: 'inv@seats.test', role_id: agent })).status, 201);   // 5th seat reserved
  const over = await w.post('/api/settings/users', { name: 'User Nine', email: 'u9@seats.test', password: 'Passw0rd!x', role_id: agent });
  assert.equal(over.status, 402); assert.equal(over.data.code, 'seat_limit');
  assert.equal((await w.post('/api/settings/invites', { email: 'inv2@seats.test', role_id: agent })).status, 402);
  // accepting the reserved invitation still works
  const list = (await w.get('/api/settings/invites')).data; assert.equal(list.length, 1);
  await call('erp.test', 'POST', `/api/platform/tenants/${w.id}/subscription`, { plan: 'growth', period_end: daysFromNow(30) }, OP);
  assert.equal((await w.post('/api/settings/users', { name: 'User Nine', email: 'u9@seats.test', password: 'Passw0rd!x', role_id: agent })).status, 201);
});

test('project limit is enforced on the plan', async () => {
  const w = await workspace('projlimit');
  await call('erp.test', 'POST', `/api/platform/tenants/${w.id}/subscription`, { plan: 'starter', period_end: daysFromNow(30) }, OP);
  for (let i = 1; i <= 3; i += 1) assert.equal((await w.post('/api/projects', { code: `P${i}`, name: `Project ${i}` })).status, 201);
  const over = await w.post('/api/projects', { code: 'P4', name: 'Project 4' });
  assert.equal(over.status, 402); assert.equal(over.data.code, 'project_limit');
});

test('an expired trial makes the workspace read-only, never deletes data, and a payment unlocks it', async () => {
  const w = await workspace('expired');
  assert.equal((await w.post('/api/contacts', { full_name: 'Kept Lead', phone: '+92 300 5550001', lead_source: 'Walk-in' })).status, 201);
  patchTenant('expired', { trial_ends_at: daysFromNow(-1) });
  const blocked = await w.post('/api/contacts', { full_name: 'Blocked Lead', phone: '+92 300 5550002', lead_source: 'Walk-in' });
  assert.equal(blocked.status, 402); assert.equal(blocked.data.code, 'billing_locked'); assert.equal(blocked.data.reason, 'trial_ended');
  assert.match(JSON.stringify((await w.get('/api/contacts?q=Kept')).data), /Kept Lead/, 'reads and exports still work');
  const b = await w.get('/api/billing');
  assert.equal(b.data.locked, true); assert.match(b.data.message, /read-only/);
  assert.equal((await call(w.host, 'POST', '/api/auth/login', { identifier: 'owner@expired.test', password: PW })).status, 200, 'sign-in stays open');
  assert.equal((await w.post('/api/billing/checkout', { plan: 'growth' })).status, 200, 'billing stays open');
  const paid = await webhook({ id: 'evt_exp_1', type: 'subscription.activated', tenant_id: w.id, plan: 'growth', interval: 'month', period_end: daysFromNow(30), customer_id: 'cus_1', subscription_id: 'sub_1',
    invoice: { id: 'inv_1', amount: 79, currency: 'USD', status: 'paid', url: 'https://pay.test/inv_1' } });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal((await w.post('/api/contacts', { full_name: 'Unlocked Lead', phone: '+92 300 5550003', lead_source: 'Walk-in' })).status, 201);
  const after = (await w.get('/api/billing')).data;
  assert.equal(after.status, 'active'); assert.equal(after.plan, 'growth'); assert.equal(after.invoices.length, 1);
});

test('webhooks: signature required, replays ignored, failed payment gives a grace period, cancel keeps access to period end', async () => {
  const w = await workspace('hooks'); const other = await workspace('hooks2');
  const ev = { id: 'evt_h_1', type: 'subscription.activated', tenant_slug: 'hooks', plan: 'starter', interval: 'year', period_end: daysFromNow(365) };
  assert.equal((await webhook(ev, 'wrong-secret')).status, 401);
  assert.equal((await call('erp.test', 'POST', '/api/platform/billing/webhook/generic', ev)).status, 401, 'unsigned');
  assert.equal((await webhook({ ...ev, plan: 'platinum', id: 'evt_h_bad' })).status, 400, 'unknown plan');
  assert.equal((await webhook({ id: 'x', type: 'subscription.activated', tenant_slug: 'nobody', plan: 'starter' })).status, 404);
  assert.deepEqual((await webhook(ev)).data, { ok: true, applied: true });
  assert.deepEqual((await webhook(ev)).data, { ok: true, applied: false }, 'a retried event is not applied twice');
  assert.equal(tenantRow('hooks').billing_interval, 'year');
  assert.equal(tenantRow('hooks2').plan, 'trial', 'other workspaces are untouched');
  // payment fails: still writable during grace, then locked
  await webhook({ id: 'evt_h_2', type: 'payment.failed', tenant_slug: 'hooks' });
  let st = (await w.get('/api/billing')).data; assert.equal(st.status, 'past_due'); assert.equal(st.locked, false);
  assert.equal((await w.post('/api/contacts', { full_name: 'Grace Lead', phone: '+92 300 5550004', lead_source: 'Walk-in' })).status, 201);
  patchTenant('hooks', { grace_until: daysFromNow(-1) });
  st = (await w.get('/api/billing')).data; assert.equal(st.locked, true); assert.equal(st.reason, 'payment_failed');
  assert.equal((await w.post('/api/contacts', { full_name: 'Late Lead', phone: '+92 300 5550005', lead_source: 'Walk-in' })).status, 402);
  // retry succeeds
  await webhook({ id: 'evt_h_3', type: 'invoice.paid', tenant_slug: 'hooks', invoice: { id: 'inv_h', amount: 290, currency: 'USD' } });
  assert.equal((await w.get('/api/billing')).data.status, 'active');
  // cancel: access until the paid period ends
  await webhook({ id: 'evt_h_4', type: 'subscription.canceled', tenant_slug: 'hooks', period_end: daysFromNow(10) });
  st = (await w.get('/api/billing')).data; assert.equal(st.status, 'canceled'); assert.equal(st.locked, false);
  patchTenant('hooks', { current_period_end: daysFromNow(-1) });
  st = (await w.get('/api/billing')).data; assert.equal(st.locked, true); assert.equal(st.reason, 'subscription_ended');
  assert.equal((await other.get('/api/billing')).data.locked, false);
});

test('checkout: manual provider explains how to pay; generic provider returns a hosted link tagged with the workspace', async () => {
  const w = await workspace('checkout');
  const manual = await w.post('/api/billing/checkout', { plan: 'growth' });
  assert.equal(manual.data.mode, 'manual'); assert.match(manual.data.instructions, /Contact us/);
  assert.equal((await w.post('/api/billing/checkout', { plan: 'nope' })).status, 400);
  process.env.BILLING_PROVIDER = 'generic';
  process.env.BILLING_CHECKOUT_URL_GROWTH_MONTH = 'https://pay.example.com/growth-monthly';
  const link = await w.post('/api/billing/checkout', { plan: 'growth', interval: 'month' });
  assert.equal(link.data.mode, 'redirect');
  const u = new URL(link.data.url);
  assert.equal(u.origin + u.pathname, 'https://pay.example.com/growth-monthly'); assert.equal(u.searchParams.get('client_reference_id'), String(w.id));
  assert.equal((await w.post('/api/billing/checkout', { plan: 'starter', interval: 'year' })).status, 503, 'plan without a configured link');
  process.env.BILLING_PROVIDER = 'manual';
});

test('the original workspace is never metered or locked', async () => {
  const l = await call('default.erp.test', 'POST', '/api/auth/login', { identifier: 'owner@legacy.test', password: 'Legacy@12345' });
  const b = await call('default.erp.test', 'GET', '/api/billing', null, { cookie: l.cookie });
  assert.equal(b.data.plan, 'legacy'); assert.equal(b.data.locked, false); assert.equal(b.data.limits.seats, null);
  const t = (await call('erp.test', 'GET', '/api/platform/tenants', null, OP)).data.find((x) => x.slug === 'default');
  assert.equal((await webhook({ id: 'evt_l', type: 'payment.failed', tenant_id: t.id })).status, 400);
});
