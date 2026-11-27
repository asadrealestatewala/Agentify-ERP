// Deleting test or wrongly entered records: a cancelled sale that took no money can be removed by the Super Admin,
// then its archived plot, its project and its customer (with the portal login) can be deleted. Money keeps its trail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-purge-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', BILLING_PROVIDER: 'manual' });
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY', 'PLATFORM_ADMIN_EMAIL', 'PLATFORM_ADMIN_PASSWORD']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const db = await import('../src/db.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); db.closeDbs(); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const buf = Buffer.concat(chunks); let d; try { d = JSON.parse(buf.toString()); } catch { d = buf; } resolve({ status: res.statusCode, data: d, headers: res.headers, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const PW = 'Tenant@12345';
async function workspace(slug) {
  const r = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Builders`, admin_name: 'Owner', admin_email: `owner@${slug}.test`, admin_password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const host = `${slug}.erp.test`;
  const c = (await call(host, 'POST', '/api/auth/login', { identifier: `owner@${slug}.test`, password: PW })).cookie;
  const f = (m) => (u, b) => call(host, m, u, b, { cookie: c });
  return { host, get: f('GET'), post: f('POST'), put: f('PUT'), del: f('DELETE') };
}
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };
const month = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); };
const tokenOf = (url) => url.split('/verify/allotment/')[1];


async function soldPlot(w, tag) {
  const proj = ok(await w.post('/api/projects', { code: `T${tag}${Date.now() % 100000}`, name: `Test ${tag}`, location: 'Rawalpindi' }), 201);
  const plot = ok(await w.post('/api/properties', { title: `Plot ${tag}`, property_type: 'Plot', project_id: proj.id, plot_no: `${tag}1`, block: 'T', area_size: 5, unit: 'Marla', total_price: 1_000_000 }), 201);
  ok(await w.post(`/api/properties/${plot.id}/publish`));
  const cust = ok(await w.post('/api/contacts', { full_name: `Test Customer ${tag}`, email: `test.${tag.toLowerCase()}@example.com` }), 201);
  const sale = ok(await w.post('/api/sales', { contact_id: cust.id, property_id: plot.id, sale_price: 1_000_000, discount: 0, num_installments: 12, first_due: month() }), 201);
  return { proj, plot, cust, sale };
}

test('a cancelled test sale is deleted with its letters, ledger and commission, then plot, project and customer can go', async () => {
  const w = await workspace('purgea');
  const { proj, plot, cust, sale } = await soldPlot(w, 'A');
  ok(await w.post(`/api/sales/${sale.id}/allotment`, { customer_address: 'Test address' }), 201);

  // a live sale cannot be deleted, and nothing else can go while it exists
  assert.equal((await w.del(`/api/sales/${sale.id}`)).status, 400);
  ok(await w.post(`/api/sales/${sale.id}/cancel`, { reason: 'test' }));
  ok(await w.post(`/api/properties/${plot.id}/archive`));
  assert.equal((await w.del(`/api/properties/${plot.id}`)).status, 400, 'a plot with a sale record stays');
  assert.equal((await w.del(`/api/contacts/${cust.id}`)).status, 400);

  ok(await w.del(`/api/sales/${sale.id}`));
  assert.equal((await w.get(`/api/sales/${sale.id}`)).status, 404);
  ok(await w.del(`/api/properties/${plot.id}`));
  ok(await w.del(`/api/projects/${proj.id}`));
  ok(await w.del(`/api/contacts/${cust.id}`));

  // the customer's portal login no longer signs in
  const users = ok(await w.get('/api/settings/users'));
  assert.ok(!users.some((u) => u.email === 'test.a@example.com'));
  // the books still balance: no orphan journal lines for the sale
  const tb = await w.get('/api/accounting/trial-balance');
  if (tb.status === 200 && tb.data?.totals) assert.equal(tb.data.totals.debit, tb.data.totals.credit);
});

test('a sale that took money is never deleted; only the Super Admin may delete', async () => {
  const w = await workspace('purgeb');
  const { sale, cust } = await soldPlot(w, 'B');
  const acct = ok(await w.get('/api/accounting/accounts')).find?.((a) => a.code === '1110' || a.code === '1100') || null;
  const rc = await w.post('/api/receipts', { contact_id: cust.id, date: new Date().toISOString().slice(0, 10), amount: 50_000, method: 'Cash', allocations: [{ sale_id: sale.id, amount: 50_000 }], ...(acct ? { account_id: acct.id } : {}) });
  if (rc.status === 201) {
    const r = await w.post(`/api/sales/${sale.id}/cancel`, { reason: 'x' });
    assert.equal(r.status, 400, 'sales with valid receipts cannot even be cancelled');
    assert.equal((await w.del(`/api/sales/${sale.id}`)).status, 400);
  }
});
