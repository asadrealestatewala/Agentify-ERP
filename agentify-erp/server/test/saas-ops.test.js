// Announcements (targeting, scheduling, read state, public), integrations registry (honest states, URL safety) and version.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-ops-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'root@agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { createTenant } = await import('../src/platform.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
let root, re, con;
const adm = (m, u, b) => call(P, m, `/api/platform/admin${u}`, b, { cookie: root });
const ws = async (slug, product) => {
  createTenant({ slug, name: slug, adminName: 'O', adminEmail: `o@${slug}.test`, adminPassword: 'Secret@123', product });
  const c = (await call(`${slug}.erp.test`, 'POST', '/api/auth/login', { identifier: `o@${slug}.test`, password: 'Secret@123' })).cookie;
  return (m, u, b) => call(`${slug}.erp.test`, m, u, b, { cookie: c });
};

test('announcements: drafts are invisible; targeting by product; read state; scheduling; retire', async () => {
  root = (await call(P, 'POST', '/api/platform/admin/login', { email: 'root@agentify.test', password: 'Console@12345' })).cookie;
  re = await ws('homes', 'real_estate'); con = await ws('build', 'construction');
  assert.equal((await adm('POST', '/announcements', { title: '', body: 'x' })).status, 400);
  const a = (await adm('POST', '/announcements', { title: 'BOQ import is here', body: 'Import BOQs from Excel.', kind: 'release', version_tag: '2.1', audience: { products: ['construction'] }, show_on_website: true })).data;
  assert.equal(a.state, 'draft');
  assert.equal((await con('GET', '/api/announcements')).data.items.length, 0, 'drafts are not shown');
  assert.equal((await adm('POST', `/announcements/${a.id}/publish`)).data.state, 'live');
  const cItems = (await con('GET', '/api/announcements')).data.items;
  assert.equal(cItems.length, 1); assert.equal(cItems[0].read, false);
  assert.equal((await re('GET', '/api/announcements')).data.items.length, 0, 'real estate workspaces are not targeted');
  assert.equal((await re('POST', `/api/announcements/${a.id}/read`)).status, 404, 'cannot touch an announcement not meant for you');
  assert.equal((await con('POST', `/api/announcements/${a.id}/read`)).status, 200);
  assert.equal((await con('GET', '/api/announcements')).data.items[0].read, true);
  const list = (await adm('GET', '/announcements')).data.items;
  assert.equal(list[0].seen, 1); assert.equal(list[0].read_count, 1);
  assert.equal((await call(P, 'GET', '/api/platform/announcements')).data.length, 1, 'shown on the public website');
  // scheduled for later: not visible yet
  const later = (await adm('POST', '/announcements', { title: 'Maintenance on Sunday', body: 'Short downtime.', kind: 'maintenance', publish_at: new Date(Date.now() + 864e5).toISOString() })).data;
  assert.equal((await adm('POST', `/announcements/${later.id}/publish`)).data.state, 'scheduled');
  assert.equal((await re('GET', '/api/announcements')).data.items.length, 0);
  await adm('POST', `/announcements/${a.id}/retire`);
  assert.equal((await con('GET', '/api/announcements')).data.items.length, 0, 'retired notes disappear');
  assert.ok((await adm('GET', '/announcements')).data.version.server_started_at, 'the running version is reported');
});

test('integrations: honest states, validated settings, no internal URLs, audited', async () => {
  const reg = (await adm('GET', '/integrations')).data;
  const by = Object.fromEntries(reg.map((i) => [i.id, i]));
  assert.equal(by.email.state, 'not_configured'); assert.equal(by.sms.state, 'not_available'); assert.equal(by.stripe.state, 'not_configured');
  assert.equal((await adm('PUT', '/integrations/ga4', { measurement_id: 'UA-123' })).status, 400);
  const ga = await adm('PUT', '/integrations/ga4', { measurement_id: 'g-abc12345' });
  assert.equal(ga.status, 200); assert.equal(ga.data.state, 'configured', 'saved but never claimed as connected');
  assert.equal((await call(P, 'GET', '/api/platform/marketing')).data.ga4_id, 'G-ABC12345');
  for (const url of ['http://hooks.example.com/x', 'https://127.0.0.1/hook', 'https://10.0.0.5/hook', 'https://user:pw@example.com/x']) assert.equal((await adm('PUT', '/integrations/alerts', { url })).status, 400, url);
  assert.equal((await adm('PUT', '/integrations/email', { api_key: 'not-a-key' })).status, 400);
  const e = await adm('PUT', '/integrations/email', { api_key: 're_testkey_1234567890', from: 'Agentify ERP <no-reply@example.com>' });
  assert.equal(e.status, 200); assert.equal(e.data.state, 'configured'); assert.equal(e.data.settings.api_key.hint, '…7890');
  assert.ok(!JSON.stringify(e.data).includes('re_testkey_1234567890'), 'secret never returned');
  assert.equal((await adm('DELETE', '/integrations/email')).data.state, 'not_configured');
  const v = (await adm('GET', '/version')).data;
  assert.ok(v.version && v.server_started_at); assert.ok(['local git checkout', 'deployment record', 'unknown'].includes(v.source));
});

test('retention: closure request, no early deletion, owner-requested deletion removes files but keeps billing records', async () => {
  const { getTenantBySlug, platformDb } = await import('../src/platform.js');
  const gone = await ws('goneco', 'construction');
  const t = getTenantBySlug('goneco');
  assert.equal((await gone('POST', '/api/billing/close-request', { confirm: 'wrong' })).status, 400);
  assert.equal((await gone('POST', '/api/billing/close-request', { confirm: 'goneco', reason: 'Moving to another system' })).status, 200);
  assert.ok(platformDb().prepare("SELECT 1 FROM platform_notifications WHERE kind='account' AND tenant_id=?").get(t.id), 'operators are alerted');
  platformDb().prepare("INSERT INTO invoices(tenant_id,provider_invoice_id,amount,currency,status) VALUES(?,?,?,?,?)").run(t.id, 'keep-me', 1000, 'PKR', 'paid');
  assert.equal((await adm('POST', `/workspaces/${t.id}/delete-data`, { confirm_slug: 'goneco', reason: 'Customer request', owner_request: true })).status, 400, 'must be cancelled first');
  assert.equal((await adm('POST', `/workspaces/${t.id}/status`, { status: 'cancelled', reason: 'Customer asked to close' })).status, 200);
  assert.equal((await adm('POST', `/workspaces/${t.id}/delete-data`, { confirm_slug: 'goneco', reason: 'Retention not over' })).status, 400, 'not before the retention period');
  assert.equal((await adm('POST', `/workspaces/${t.id}/delete-data`, { confirm_slug: 'nope', reason: 'Customer request', owner_request: true })).status, 400, 'slug must be typed');
  assert.ok(fs.existsSync(t.db_path));
  const del = await adm('POST', `/workspaces/${t.id}/delete-data`, { confirm_slug: 'goneco', reason: 'Customer request by email', owner_request: true, keep_archive: true });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.ok(!fs.existsSync(t.db_path), 'database file removed');
  assert.ok(platformDb().prepare("SELECT 1 FROM invoices WHERE provider_invoice_id='keep-me'").get(), 'billing records kept');
  assert.equal((await adm('POST', `/workspaces/${t.id}/status`, { status: 'active' })).status, 400, 'cannot be reactivated');
  assert.ok(platformDb().prepare("SELECT 1 FROM platform_audit WHERE action='workspace-data-deleted'").get());
  assert.equal((await adm('PUT', '/retention', { retention_days: 5 })).status, 400);
  // bulk delete: needs the word DELETE and a reason; skips (reports) workspaces that are not cancelled
  const live = platformDb().prepare("SELECT id FROM tenants WHERE is_legacy=1 OR status='active' LIMIT 1").get();
  assert.equal((await adm('POST', '/workspaces/delete-data-bulk', { ids: [live.id], reason: 'Test cleanup', owner_request: true })).status, 400, 'must type DELETE');
  const bulk = await adm('POST', '/workspaces/delete-data-bulk', { ids: [live.id], confirm: 'DELETE', reason: 'Test cleanup', owner_request: true });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.data.deleted.length, 0);
  assert.equal(bulk.data.failed.length, 1, 'an active or original workspace is refused');
  assert.equal((await adm('PUT', '/retention', { retention_days: 120 })).data.retention_days, 120);
});

test('remove record: only a data-deleted workspace without billing history can be removed', async () => {
  const { getTenantBySlug, platformDb } = await import('../src/platform.js');
  await ws('rmco', 'construction');
  const t = getTenantBySlug('rmco');
  const rm = (body) => adm('POST', '/workspaces/remove-records', { ids: [t.id], confirm: 'REMOVE', reason: 'Test cleanup', ...body });
  assert.equal((await rm({ confirm: 'no' })).status, 400, 'must type REMOVE');
  assert.equal((await rm({})).data.failed.length, 1, 'data not deleted yet');
  assert.equal((await adm('POST', `/workspaces/${t.id}/status`, { status: 'cancelled', reason: 'Test' })).status, 200);
  assert.equal((await adm('POST', `/workspaces/${t.id}/delete-data`, { confirm_slug: 'rmco', reason: 'Test cleanup', owner_request: true })).status, 200);
  const row = (await adm('GET', '/workspaces')).data.find((w) => w.id === t.id);
  assert.equal(row.remove_blocker, null, 'removable');
  // goneco kept an invoice in the previous test: its record must stay
  const g = getTenantBySlug('goneco');
  const kept = await adm('POST', '/workspaces/remove-records', { ids: [g.id], confirm: 'REMOVE', reason: 'Test cleanup' });
  assert.equal(kept.data.removed.length, 0); assert.match(kept.data.failed[0].error, /invoices/);
  const out = await rm({});
  assert.deepEqual(out.data.removed, ['rmco']);
  assert.ok(!platformDb().prepare('SELECT 1 FROM tenants WHERE id=?').get(t.id), 'row gone');
  assert.ok(platformDb().prepare("SELECT 1 FROM platform_audit WHERE action='workspace-records-removed'").get());
});
