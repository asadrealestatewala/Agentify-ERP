import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-super-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'boss@agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual', BACKUP_ENABLED: '0' });
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_PK_ACCOUNTS', 'ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { outbox } = await import('../src/services/mailer.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, text: t, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
let cookie;
const adm = (method, url, body) => call(P, method, `/api/platform/admin${url}`, body, { cookie });
const signIn = async (email, password) => (await call(P, 'POST', '/api/platform/admin/login', { email, password })).cookie;
let acme;

test('super admin endpoints need a platform sign-in and are not reachable on a workspace address', async () => {
  assert.equal((await call(P, 'GET', '/api/platform/admin/overview')).status, 401);
  cookie = await signIn('boss@agentify.test', 'Console@12345'); assert.ok(cookie);
  assert.equal((await call('acme.erp.test', 'GET', '/api/platform/admin/workspaces', null, { cookie })).status, 404);
});

test('creating a workspace from the console; it shows up with progress, usage and expiry', async () => {
  const bad = await adm('POST', '/workspaces', { slug: 'admin', company_name: 'X', admin_email: 'a@x.test', admin_password: 'Secret@123' });
  assert.equal(bad.status, 400, 'reserved address refused');
  const c = await adm('POST', '/workspaces', { slug: 'acme', company_name: 'Acme Estates', admin_name: 'Ayesha', admin_email: 'ayesha@acme.test', admin_password: 'Acme@12345', trial_days: 10 });
  assert.equal(c.status, 201, c.text); acme = c.data;
  assert.equal(acme.expiry.kind, 'trial'); assert.equal(acme.expiry.days_left, 10); assert.equal(acme.expiry.level, 'soon');
  const list = (await adm('GET', '/workspaces')).data;
  const row = list.find((t) => t.slug === 'acme');
  assert.equal(row.stats.seats, 1); assert.equal(row.progress.total, 8);
  assert.ok(row.progress.steps.find((s) => s.id === 'verified').done, 'an admin-created owner counts as confirmed');
  assert.ok(list.find((t) => t.is_legacy).expiry.kind === 'never');
  const d = (await adm('GET', `/workspaces/${acme.id}`)).data;
  assert.equal(d.users.length, 1); assert.equal(d.users[0].email, 'ayesha@acme.test'); assert.equal(d.users[0].role, 'Super Admin');
  assert.ok(d.events.some((e) => e.action === 'created'));
});

test('expiry: extend a trial, refuse grace on a trial, remind the owner, overview counts it', async () => {
  const ext = await adm('POST', `/workspaces/${acme.id}/trial`, { days: 20, reason: 'Customer asked for more time' });
  assert.equal(ext.status, 200, ext.text); assert.equal(ext.data.expiry.days_left, 30, 'adds to the current end date');
  assert.equal((await adm('POST', `/workspaces/${acme.id}/trial`, { until: '2001-01-01', reason: 'test' })).status, 400);
  assert.equal((await adm('POST', `/workspaces/${acme.id}/grace`, { until: '2099-01-01', reason: 'test' })).status, 400, 'not past due');
  const before = outbox.length;
  const rem = await adm('POST', `/workspaces/${acme.id}/remind`);
  assert.equal(rem.status, 200, rem.text); assert.equal(rem.data.to, 'ayesha@acme.test');
  assert.equal(outbox.length, before + 1); assert.match(outbox.at(-1).text, /acme\.erp\.test:\d+\/billing|acme\.erp\.test\/billing/);
  // an expired trial becomes locked and is listed as expiring
  platformDb().prepare("UPDATE tenants SET trial_ends_at='2000-01-01' WHERE id=?").run(acme.id);
  const ov = (await adm('GET', '/overview')).data;
  assert.equal(ov.counts.locked, 1); assert.ok(ov.expiring.some((t) => t.slug === 'acme' && t.expiry.level === 'expired'));
  assert.ok(Array.isArray(ov.setup) && ov.setup.find((s) => s.id === 'email').ok === false);
  await adm('POST', `/workspaces/${acme.id}/trial`, { days: 5, reason: 'Sales follow-up' });
  assert.equal((await adm('GET', `/workspaces/${acme.id}`)).data.expiry.locked, false, 'extending unlocks it');
});

test('sign-in help: reset link works once in the workspace, 2FA can be switched off, last owner cannot be deactivated', async () => {
  const uid = (await adm('GET', `/workspaces/${acme.id}`)).data.users[0].id;
  const r = await adm('POST', `/workspaces/${acme.id}/users/${uid}/reset-link`, { email: true });
  assert.equal(r.status, 200, r.text); assert.match(r.data.link, /\/reset-password\/[\w-]+$/);
  const token = r.data.link.split('/').pop();
  assert.ok(!(await adm('GET', '/audit')).text.includes(token), 'the link is never logged');
  const reset = await call('acme.erp.test', 'POST', '/api/auth/reset-password', { token, password: 'NewPass@123' });
  assert.ok(reset.status < 300, reset.text);
  assert.equal((await call('acme.erp.test', 'POST', '/api/auth/login', { identifier: 'ayesha@acme.test', password: 'NewPass@123' })).status, 200);
  assert.equal((await adm('POST', `/workspaces/${acme.id}/users/${uid}/disable-2fa`)).status, 200);
  assert.equal((await adm('POST', `/workspaces/${acme.id}/users/${uid}/deactivate`)).status, 400);
  assert.equal((await adm('POST', `/workspaces/${acme.id}/users/${uid}/explode`)).status, 400);
  assert.equal((await adm('POST', `/workspaces/${acme.id}/users/9999/activate`)).status, 404);
});

test('super admin accounts: add a second one, it can sign in, nobody can remove themselves or the last one', async () => {
  assert.equal((await adm('POST', '/admins', { email: 'two@agentify.test', name: 'Two', password: 'short' })).status, 400);
  const a = await adm('POST', '/admins', { email: 'two@agentify.test', name: 'Two', password: 'Second@12345' });
  assert.equal(a.status, 201, a.text);
  assert.equal((await adm('POST', '/admins', { email: 'TWO@agentify.test', password: 'Second@12345' })).status, 409);
  const me = (await adm('GET', '/admins')).data;
  assert.equal(me.admins.length, 2);
  assert.equal((await adm('DELETE', `/admins/${me.me}`)).status, 400);
  const second = await signIn('two@agentify.test', 'Second@12345'); assert.ok(second);
  assert.equal((await adm('DELETE', `/admins/${a.data.id}`)).status, 200);
  assert.equal((await call(P, 'GET', '/api/platform/admin/overview', null, { cookie: second })).status, 401, 'a removed admin loses access');
});

test('dashboard: KPIs reconcile with invoice records, ranges are validated, health never invents a green light', async () => {
  cookie = await signIn('boss@agentify.test', 'Console@12345');
  assert.equal((await adm('GET', '/dashboard?range=bogus')).status, 400);
  assert.equal((await adm('GET', '/dashboard?range=custom&from=2026-02-01&to=2026-01-01')).status, 400);
  const pdb = platformDb();
  const now = pdb.prepare("SELECT datetime('now') n").get().n;
  pdb.prepare("UPDATE tenants SET plan='growth', subscription_status='active', current_period_end='2099-01-01', billing_interval='month' WHERE id=?").run(acme.id);
  pdb.prepare("INSERT INTO invoices(tenant_id,provider_invoice_id,amount,currency,status,period_start,period_end,created_at) VALUES(?,?,?,?,?,?,?,?)").run(acme.id, 'inv-a', 22000, 'PKR', 'paid', '2026-01-01', '2099-01-01', now);
  pdb.prepare("INSERT INTO invoices(tenant_id,provider_invoice_id,amount,currency,status,period_start,period_end,created_at) VALUES(?,?,?,?,?,?,?,?)").run(acme.id, 'inv-b', 1000, 'PKR', 'paid', '2026-01-01', '2099-01-01', now);
  pdb.prepare("INSERT INTO invoices(tenant_id,provider_invoice_id,amount,currency,status,period_start,period_end,created_at) VALUES(?,?,?,?,?,?,?,?)").run(acme.id, 'inv-old', 5000, 'PKR', 'paid', '2020-01-01', '2020-02-01', '2020-01-05 10:00:00');
  pdb.prepare("INSERT INTO billing_events(provider,event_id,tenant_id,type,created_at) VALUES('generic','f1',?,'payment.failed',?)").run(acme.id, now);
  const d = await adm('GET', '/dashboard?range=30d');
  assert.equal(d.status, 200, d.text);
  const k = d.data.kpis;
  assert.equal(k.payments_received.value, 23000, 'sum of paid invoices in range, old invoice excluded');
  assert.equal(k.payments_received.count, 2);
  assert.equal(k.failed_payments.value, 1);
  assert.equal(k.paying_workspaces.value, 1);
  assert.equal(k.mrr.value, 22000, 'growth monthly PKR price');
  assert.equal(k.arr.value, 264000);
  assert.equal(k.total_workspaces.value, 2);
  assert.equal(d.data.charts.revenue.reduce((s, x) => s + (x.PKR || 0), 0), 23000, 'chart agrees with the KPI');
  assert.ok(d.data.charts.top_workspaces.some((t) => t.slug === 'acme' && t.total === 23000));
  const email = d.data.health.checks.find((c) => c.id === 'email');
  assert.notEqual(email.state, 'healthy', 'no mail key: not healthy');
  assert.ok(d.data.health.checks.find((c) => c.id === 'stripe').state === 'unknown');
  const m = await adm('GET', '/dashboard?range=prev_month');
  assert.equal(m.status, 200); assert.equal(m.data.kpis.payments_received.value, 0);
});

test('notifications: one alert per condition, read state per admin, resolved when the condition clears', async () => {
  const pdb = platformDb();
  pdb.prepare("UPDATE tenants SET subscription_status='trialing', trial_ends_at=date('now','+3 days') WHERE id=?").run(acme.id);
  const { generateNotifications } = await import('../src/services/platformMetrics.js');
  generateNotifications(null, true); generateNotifications(null, true);
  let n = (await adm('GET', '/notifications')).data;
  const exp = n.items.filter((i) => i.kind === 'expiring' && i.tenant_id === acme.id);
  assert.equal(exp.length, 1, 'deduplicated');
  assert.ok(n.unread >= 1);
  await adm('POST', '/notifications/read', { ids: [exp[0].id] });
  n = (await adm('GET', '/notifications')).data;
  assert.equal(n.items.find((i) => i.id === exp[0].id).read, true);
  pdb.prepare("UPDATE tenants SET trial_ends_at=date('now','+60 days') WHERE id=?").run(acme.id);
  generateNotifications(null, true);
  n = (await adm('GET', '/notifications')).data;
  assert.ok(!n.items.some((i) => i.id === exp[0].id), 'cleared condition is resolved');
});

test('global search finds workspaces, invoices and admins; short queries return nothing', async () => {
  assert.deepEqual((await adm('GET', '/search?q=a')).data, []);
  const r = (await adm('GET', '/search?q=acme')).data;
  assert.ok(r.some((x) => x.type === 'Workspace' && x.link === `/platform/workspaces/${acme.id}`));
  assert.ok((await adm('GET', '/search?q=inv-a')).data.some((x) => x.type === 'Invoice'));
  assert.ok((await adm('GET', '/search?q=boss')).data.some((x) => x.type === 'Super admin'));
  assert.equal((await adm('GET', '/search?q=%25')).data.length, 0, 'wildcards are escaped');
});

test('plans: editable, prices versioned, existing subscribers keep their price, retired plans cannot be bought', async () => {
  let p = (await adm('GET', '/plans')).data;
  assert.deepEqual(p.plans.map((x) => x.id), ['starter', 'growth', 'enterprise', 'con_starter', 'con_professional', 'con_enterprise'], 'seeded from the defaults (both product families)');
  assert.equal((await adm('PUT', '/plans/Bad-Id', { name: 'x' })).status, 400);
  assert.equal((await adm('PUT', '/plans/pro', { name: 'Pro' })).status, 400, 'a new plan needs PKR prices');
  const created = await adm('PUT', '/plans/pro', { name: 'Pro', seats: 10, projects: 10, modules: ['accounting', 'hrm'], price: { PKR: { month: 15000, year: 150000 } } });
  assert.equal(created.status, 200, created.text); assert.equal(created.data.price.PKR.month, 15000);
  assert.equal((await adm('PUT', '/plans/pro', { modules: ['nope'] })).status, 400);
  // acme subscribes to growth at today's price, then the price goes up
  const set = await adm('POST', `/workspaces/${acme.id}/subscription`, { plan: 'growth', status: 'active', interval: 'month', period_end: '2099-01-01', reason: 'Bank transfer INV-1' });
  assert.equal(set.status, 200, set.text); assert.deepEqual(set.data.price, { amount: 22000, currency: 'PKR', interval: 'month' });
  assert.equal((await adm('POST', `/workspaces/${acme.id}/subscription`, { plan: 'growth', status: 'active' })).status, 400, 'reason required');
  const up = await adm('PUT', '/plans/growth', { price: { PKR: { month: 25000 } } });
  assert.equal(up.data.price.PKR.month, 25000); assert.equal(up.data.price.PKR.year, 220000, 'untouched prices stay');
  assert.ok(up.data.price_history.some((h) => h.amount === 22000) && up.data.price_history.some((h) => h.amount === 25000), 'old price kept on record');
  const d = (await adm('GET', '/dashboard?range=30d')).data;
  assert.equal(d.kpis.mrr.value, 22000, 'MRR uses the price the workspace pays, not the new list price');
  assert.ok((await adm('GET', `/workspaces/${acme.id}`)).data.history.some((h) => h.to_plan === 'growth' && h.reason === 'Bank transfer INV-1'));
  // retire Pro: hidden from the public price list
  await adm('PUT', '/plans/pro', { active: false });
  const site = await call(P, 'GET', '/api/platform/site');
  assert.ok(!site.data.plans.some((x) => x.id === 'pro'));
  assert.equal((await adm('PUT', '/plan-settings', { default_trial_days: 21 })).data.default_trial_days, 21);
  assert.equal((await call(P, 'GET', '/api/platform/site')).data.trial_days, 21);
  await adm('PUT', '/plan-settings', { default_trial_days: 14 });
});

test('entitlements: per-workspace overrides and module access are enforced by the API', async () => {
  assert.equal((await adm('PUT', `/workspaces/${acme.id}/entitlements`, { seats: 3 })).status, 400, 'reason required');
  const r = await adm('PUT', `/workspaces/${acme.id}/entitlements`, { seats: 3, modules: ['hrm'], reason: 'Pilot scope' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.expiry.limits.seats, 3); assert.deepEqual(r.data.expiry.limits.modules, ['hrm']);
  const login = await call('acme.erp.test', 'POST', '/api/auth/login', { identifier: 'ayesha@acme.test', password: 'NewPass@123' });
  const ws = login.cookie;
  const acc = await call('acme.erp.test', 'GET', '/api/accounting/accounts', null, { cookie: ws });
  assert.equal(acc.status, 402); assert.equal(acc.data.code, 'module_not_in_plan');
  const field = await call('acme.erp.test', 'GET', '/api/field/team', null, { cookie: ws });
  assert.equal(field.status, 402, 'field coverage follows the plan modules too'); assert.equal(field.data.module, 'field');
  assert.notEqual((await call('acme.erp.test', 'GET', '/api/hrm/employees', null, { cookie: ws })).status, 402, 'included module still works');
  await adm('PUT', `/workspaces/${acme.id}/entitlements`, { clear: true, reason: 'Pilot over' });
  assert.notEqual((await call('acme.erp.test', 'GET', '/api/accounting/accounts', null, { cookie: ws })).status, 402);
});

test('manual payment: one record, a paid invoice, the period extended, history written, duplicates refused', async () => {
  const before = (await adm('GET', `/workspaces/${acme.id}`)).data;
  const body = { plan: 'growth', interval: 'month', method: 'bank', amount: 25000, currency: 'PKR', reference: 'HBL-778899', note: 'Slip emailed' };
  const r = await adm('POST', `/workspaces/${acme.id}/payments`, body);
  assert.equal(r.status, 201, r.text);
  assert.ok(r.data.current_period_end > '2099-01-01', 'extends from the current end date');
  assert.deepEqual(r.data.price, { amount: 25000, currency: 'PKR', interval: 'month' });
  assert.equal(r.data.history.length, before.history.length + 1);
  assert.equal((await adm('POST', `/workspaces/${acme.id}/payments`, body)).status, 409, 'same reference twice');
  const tx = (await adm('GET', `/transactions?tenant=${acme.id}`)).data;
  const row = tx.rows.find((x) => x.reference === 'HBL-778899');
  assert.equal(row.payment_status, 'approved'); assert.equal(row.invoice_status, 'paid');
  assert.ok(!tx.rows.some((x) => x.reference === `local-${row.id}`), 'the invoice of a transfer is not listed twice');
  const d = (await adm('GET', '/dashboard?range=30d')).data;
  assert.equal(d.kpis.payments_received.value, 23000 + 25000, 'dashboard picks it up');
});

test('workspace profile, status reasons and notes', async () => {
  assert.equal((await adm('PATCH', `/workspaces/${acme.id}`, { custom_domain: 'erp.erp.test' })).status, 400);
  assert.equal((await adm('PATCH', `/workspaces/${acme.id}`, { currency: 'USD' })).status, 400);
  const e = await adm('PATCH', `/workspaces/${acme.id}`, { owner_name: 'Ayesha Khan', owner_phone: '+92 300 1234567', account_manager: 'Bilal', custom_domain: 'https://erp.acme-estates.pk/' });
  assert.equal(e.status, 200, e.text); assert.equal(e.data.custom_domain, 'erp.acme-estates.pk'); assert.equal(e.data.owner_phone, '+92 300 1234567');
  assert.equal((await adm('POST', `/workspaces/${acme.id}/status`, { status: 'suspended' })).status, 400, 'reason required');
  const s = await adm('POST', `/workspaces/${acme.id}/status`, { status: 'suspended', reason: 'Chargeback under review' });
  assert.equal(s.data.status, 'suspended');
  assert.equal((await adm('POST', `/workspaces/${acme.id}/status`, { status: 'active' })).data.status, 'active');
  assert.equal((await adm('POST', `/workspaces/${acme.id}/notes`, { body: '' })).status, 400);
  const n = await adm('POST', `/workspaces/${acme.id}/notes`, { body: 'Prefers WhatsApp', pinned: true });
  assert.equal(n.status, 201); assert.equal(n.data[0].body, 'Prefers WhatsApp');
  assert.ok((await adm('GET', '/audit')).data.some((a) => a.action === 'workspace-suspended' && /Chargeback/.test(a.detail)));
});

test('roles: each console role can only do what it is allowed; denials are audited', async () => {
  for (const [email, role] of [['fin@agentify.test', 'finance_admin'], ['ro@agentify.test', 'read_only'], ['cs@agentify.test', 'customer_success']]) {
    const made = await adm('POST', '/admins', { email, name: role, password: 'Role@123456', role }); assert.equal(made.status, 201, JSON.stringify(made.data));
  }
  assert.equal((await adm('POST', '/admins', { email: 'x@agentify.test', password: 'Role@123456', role: 'god' })).status, 400);
  const fin = await signIn('fin@agentify.test', 'Role@123456'), ro = await signIn('ro@agentify.test', 'Role@123456'), cs = await signIn('cs@agentify.test', 'Role@123456');
  const as = (c, method, url, body) => call(P, method, `/api/platform/admin${url}`, body, { cookie: c });
  const me = (await as(fin, 'GET', '/me')).data;
  assert.equal(me.role, 'finance_admin'); assert.ok(me.permissions.includes('billing.manage') && !me.permissions.includes('workspaces.suspend'));
  assert.equal((await as(fin, 'GET', '/transactions')).status, 200);
  const deny = await as(fin, 'POST', `/workspaces/${acme.id}/status`, { status: 'suspended', reason: 'nope' });
  assert.equal(deny.status, 403); assert.equal(deny.data.code, 'forbidden');
  assert.equal((await call(P, 'POST', `/api/platform/tenants/${acme.id}/status`, { status: 'suspended' }, { cookie: fin })).status, 403, 'the older endpoint is guarded too');
  assert.equal((await as(ro, 'GET', '/workspaces')).status, 200);
  assert.equal((await as(ro, 'PUT', '/plans/growth', { name: 'Hacked' })).status, 403);
  assert.equal((await as(ro, 'GET', '/admins')).status, 403);
  assert.equal((await as(ro, 'GET', '/audit/search')).status, 403);
  assert.equal((await as(cs, 'POST', `/workspaces/${acme.id}/notes`, { body: 'Called them' })).status, 201);
  assert.equal((await as(cs, 'POST', `/workspaces/${acme.id}/payments`, { plan: 'growth' })).status, 403);
  const log = (await adm('GET', '/audit/search?outcome=denied')).data;
  assert.ok(log.rows.some((r) => r.admin === 'fin@agentify.test' && /workspaces.suspend/.test(r.detail)));
  // switching a user off ends their sessions at once; the last active Super Admin is protected
  const fid = (await adm('GET', '/admins')).data.admins.find((a) => a.email === 'fin@agentify.test').id;
  assert.equal((await adm('PATCH', `/admins/${fid}`, { active: false })).status, 200);
  assert.equal((await as(fin, 'GET', '/me')).status, 401);
  assert.equal((await call(P, 'POST', '/api/platform/admin/login', { email: 'fin@agentify.test', password: 'Role@123456' })).status, 401);
  const myId = (await adm('GET', '/me')).data.id;
  assert.equal((await adm('PATCH', `/admins/${myId}`, { role: 'read_only' })).status, 400, 'cannot demote yourself');
});

test('audit log: records role, IP and request id; cannot be edited or deleted', async () => {
  const r = await adm('POST', `/workspaces/${acme.id}/notes`, { body: 'Audit check' });
  assert.equal(r.status, 201);
  const row = (await adm('GET', '/audit/search?action=note-added')).data.rows[0];
  assert.equal(row.actor_role, 'platform_owner', 'the first account is the Platform Owner'); assert.ok(row.ip); assert.ok(row.request_id); assert.equal(row.outcome, 'success'); assert.equal(row.target, `workspace#${acme.id}`);
  assert.throws(() => platformDb().prepare("UPDATE platform_audit SET action='x' WHERE id=?").run(row.id), /append-only/);
  assert.throws(() => platformDb().prepare('DELETE FROM platform_audit WHERE id=?').run(row.id), /append-only/);
});

test('sign-ins: history is kept, repeated failures raise an alert, sessions can be listed and revoked', async () => {
  for (let i = 0; i < 5; i += 1) await call(P, 'POST', '/api/platform/admin/login', { email: 'ro@agentify.test', password: 'wrong-password' });
  const h = (await adm('GET', '/logins?outcome=failed&email=ro@')).data;
  assert.ok(h.total >= 5); assert.ok(!JSON.stringify(h).includes('wrong-password'), 'passwords are never stored');
  assert.ok((await adm('GET', '/notifications')).data.items.some((n) => n.kind === 'security' && /failed console sign-ins/.test(n.title)));
  const other = await signIn('boss@agentify.test', 'Console@12345');
  const mine = (await adm('GET', '/sessions')).data.rows;
  assert.ok(mine.length >= 2 && mine.some((s) => s.current));
  assert.ok(mine.every((s) => !s.id && s.ref.length === 8), 'full session ids never leave the server');
  assert.ok((await adm('POST', '/sessions/revoke-others')).data.revoked >= 1);
  assert.equal((await call(P, 'GET', '/api/platform/admin/me', null, { cookie: other })).status, 401, 'revoked session stops working');
  assert.equal((await adm('GET', '/me')).status, 200, 'current session kept');
  const tmp = await signIn('boss@agentify.test', 'Console@12345');
  await call(P, 'POST', '/api/platform/admin/logout', null, { cookie: tmp });
  assert.equal((await call(P, 'GET', '/api/platform/admin/me', null, { cookie: tmp })).status, 401, 'logout ends the session on the server');
});

test('require two-factor: cannot be switched on without it yourself; users without it are held at setup', async () => {
  assert.equal((await adm('PUT', '/security-settings', { require_2fa: true })).status, 400);
  platformDb().prepare("INSERT INTO platform_settings(key,value) VALUES('require_2fa','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  const m = await adm('GET', '/me');
  assert.equal(m.status, 200); assert.equal(m.data.mfa_setup_needed, true);
  const w = await adm('GET', '/workspaces');
  assert.equal(w.status, 403); assert.equal(w.data.code, 'mfa_required');
  assert.equal((await adm('GET', '/2fa')).status, 200, 'setup stays reachable');
  platformDb().prepare("UPDATE platform_settings SET value='0' WHERE key='require_2fa'").run();
  assert.equal((await adm('GET', '/workspaces')).status, 200);
});

test('maintenance mode closes workspaces but never the console; needs a reason', async () => {
  assert.equal((await adm('PUT', '/maintenance', { on: true })).status, 400);
  assert.equal((await adm('PUT', '/maintenance', { on: true, reason: 'Database upgrade', message: 'Back at 10pm' })).status, 200);
  const ws = await call('acme.erp.test', 'POST', '/api/auth/login', { identifier: 'ayesha@acme.test', password: 'NewPass@123' });
  assert.equal(ws.status, 503); assert.equal(ws.data.code, 'maintenance'); assert.equal(ws.data.error, 'Back at 10pm');
  assert.equal((await adm('GET', '/dashboard?range=7d')).status, 200, 'console still works');
  assert.equal((await adm('GET', '/me')).data.maintenance, true);
  assert.equal((await adm('PUT', '/maintenance', { on: false })).data.on, false);
  assert.equal((await call('acme.erp.test', 'POST', '/api/auth/login', { identifier: 'ayesha@acme.test', password: 'NewPass@123' })).status, 200);
});

test('reports: list follows the role, figures agree with the dashboard, exports need permission and are safe', async () => {
  const list = (await adm('GET', '/reports')).data;
  assert.ok(list.reports.length >= 10 && list.can_export);
  const ro = await signIn('ro@agentify.test', 'Role@123456');
  const roList = (await call(P, 'GET', '/api/platform/admin/reports', null, { cookie: ro })).data;
  assert.ok(!roList.reports.some((x) => x.id === 'admin_activity'), 'read-only analysts do not see the admin activity report');
  assert.equal((await call(P, 'GET', '/api/platform/admin/reports/admin_activity', null, { cookie: ro })).status, 403);
  assert.equal((await call(P, 'GET', '/api/platform/admin/reports/growth/export?format=csv', null, { cookie: ro })).status, 403, 'no export permission');
  const rev = (await adm('GET', '/reports/revenue?range=30d')).data;
  const dash = (await adm('GET', '/dashboard?range=30d')).data;
  assert.equal(rev.rows.reduce((s, x) => s + (x.PKR || 0), 0), dash.kpis.payments_received.value, 'report and dashboard agree');
  for (const id of list.reports.map((x) => x.id)) assert.equal((await adm('GET', `/reports/${id}?range=year`)).status, 200, `${id} runs`);
  assert.equal((await adm('GET', '/reports/nope')).status, 404);
  // a workspace named like a spreadsheet formula must not become one in the export
  platformDb().prepare("UPDATE tenants SET name='=HYPERLINK(\"http://x\")' WHERE id=?").run(acme.id);
  const csv = await adm('GET', '/reports/usage/export?format=csv');
  assert.equal(csv.status, 200); assert.match(csv.text, /"'=HYPERLINK/);
  platformDb().prepare("UPDATE tenants SET name='Acme Estates' WHERE id=?").run(acme.id);
  const x = await adm('GET', '/reports/revenue/export?format=xlsx&range=30d');
  assert.equal(x.status, 200);
  assert.ok((await adm('GET', '/audit/search?action=report-exported')).data.total >= 2, 'exports are audited');
  // saved views
  assert.equal((await adm('POST', '/reports/views', { name: 'Q revenue', report: 'revenue', range: 'quarter' })).data.length, 1);
  assert.equal((await adm('DELETE', `/reports/views/${encodeURIComponent('Q revenue')}`)).data.length, 0);
});

test('reconciliation: clean records pass; a broken payment record is reported', async () => {
  const ok = (await adm('GET', '/reconciliation')).data;
  const failing = ok.checks.filter((c) => c.state === 'error');
  assert.equal(failing.length, 0, JSON.stringify(failing));
  const id = Number(platformDb().prepare("INSERT INTO payment_submissions(tenant_id,plan,interval,method,amount,currency,reference,status) VALUES(?,'growth','month','bank',100,'PKR','BROKEN-1','approved')").run(acme.id).lastInsertRowid);
  const bad = (await adm('GET', '/reconciliation')).data;
  const c = bad.checks.find((x) => x.id === 'approved-has-invoice');
  assert.equal(c.state, 'error'); assert.equal(c.rows[0].reference, 'BROKEN-1'); assert.equal(bad.ok, false);
  platformDb().prepare('DELETE FROM payment_submissions WHERE id=?').run(id);
});
