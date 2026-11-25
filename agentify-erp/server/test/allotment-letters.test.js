// Allotment letters for plot sales: issue, PDF with a QR code, public verification on the workspace's own address,
// no sensitive data on the public page, unguessable tokens, cancel / replace, workspace isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-allot-'));
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
  return { host, get: f('GET'), post: f('POST'), put: f('PUT') };
}
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };
const month = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); };
const tokenOf = (url) => url.split('/verify/allotment/')[1];

async function soldPlot(w, { address = 'Mehmood Khel, Post Office Dagar Nari, District Karak' } = {}) {
  const proj = ok(await w.post('/api/projects', { code: `UC${Date.now() % 100000}`, name: 'University City', location: 'Chakri Road Rawalpindi' }), 201);
  const plot = ok(await w.post('/api/properties', { title: 'Plot 201 D', property_type: 'Plot', project_id: proj.id, plot_no: '201', block: 'D', area_size: 5, unit: 'Marla', total_price: 2_500_000 }), 201);
  ok(await w.post(`/api/properties/${plot.id}/publish`));
  const cust = ok(await w.post('/api/contacts', { full_name: 'Sad Badshah', father_name: 'Gul Badshah', phone: '+92 300 7771234', cnic: '14202-1234567-1', address }), 201);
  const sale = ok(await w.post('/api/sales', { contact_id: cust.id, property_id: plot.id, sale_price: 2_500_000, discount: 0, booking_amount: 500_000, num_installments: 10, first_due: month() }), 201);
  return { proj, plot, cust, sale };
}

test('issue a letter, print it with a QR, and verify it publicly without sensitive data', async () => {
  const w = await workspace('roots');
  const { sale, plot } = await soldPlot(w);

  const before = ok(await w.get(`/api/sales/${sale.id}/allotment`));
  assert.equal(before.letters.length, 0);
  assert.equal(before.draft.customer_name, 'Sad Badshah');
  assert.equal(before.draft.relation, 'S/O Gul Badshah');
  assert.match(before.draft.customer_address, /Mehmood Khel/);
  assert.equal(before.draft.plot_no, '201'); assert.equal(before.draft.block, 'D');
  assert.match(before.draft.plot_location, /University City/); assert.match(before.draft.plot_location, /Chakri Road Rawalpindi/);

  assert.equal((await w.post(`/api/sales/${sale.id}/allotment`, { dimensions: 'twenty' })).status, 400, 'dimensions must look like 25x45');
  const issued = ok(await w.post(`/api/sales/${sale.id}/allotment`, { dimensions: '25x45' }), 201);
  assert.match(issued.letter_no, /^AL-\d{5}$/);
  assert.equal(ok(await w.get(`/api/properties/${plot.id}`)).dimensions, '25x45', 'dimensions saved on the plot when it had none');

  const { letters } = ok(await w.get(`/api/sales/${sale.id}/allotment`));
  assert.equal(letters.length, 1);
  assert.equal(letters[0].token, undefined, 'the raw token is not sent separately');
  const url = letters[0].verify_url;
  assert.match(url, /^http:\/\/roots\.localhost|^https:\/\/roots\.erp\.test\/verify\/allotment\/[\w-]{20,}$/);
  const token = tokenOf(url);
  assert.ok(token.length >= 20 && !/^\d+$/.test(token), 'unguessable token, not an id');

  const pdf = await w.get(`/api/allotment-letters/${letters[0].id}/pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');

  // public page data: no sign-in, on the workspace's own address
  const pub = await call(w.host, 'GET', `/api/verify/allotment/${token}`);
  const v = ok(pub);
  assert.equal(v.valid, true); assert.equal(v.state, 'valid');
  assert.equal(v.customer_name, 'Sad Badshah'); assert.equal(v.plot_no, '201'); assert.equal(v.block, 'D');
  assert.equal(v.project_name, 'University City'); assert.match(v.area, /25x45/); assert.match(v.area, /5 Marla/);
  assert.equal(v.company.name, 'roots Builders');
  const raw = JSON.stringify(v);
  for (const secret of ['14202', '7771234', 'Gul Badshah', 'Mehmood Khel', '2500000', '2,500,000', 'sale_id', 'contact_id']) assert.ok(!raw.includes(secret), `public view must not include ${secret}`);
  assert.equal(pub.headers['cache-control'], 'no-store');

  assert.equal((await call(w.host, 'GET', '/api/verify/allotment/1')).status, 404, 'ids do not work');
  assert.equal((await call(w.host, 'GET', `/api/verify/allotment/${token.slice(0, -2)}xx`)).status, 404);
});

test('re-issuing replaces the earlier letter, cancelling and a cancelled sale void it', async () => {
  const w = await workspace('rootstwo');
  const { sale } = await soldPlot(w);
  ok(await w.post(`/api/sales/${sale.id}/allotment`, {}), 201);
  const firstUrl = ok(await w.get(`/api/sales/${sale.id}/allotment`)).letters[0].verify_url;
  const second = ok(await w.post(`/api/sales/${sale.id}/allotment`, { note: 'Duplicate issued on request.' }), 201);
  assert.equal(second.replaced, 1);
  const list = ok(await w.get(`/api/sales/${sale.id}/allotment`)).letters;
  assert.deepEqual(list.map((l) => l.status), ['issued', 'cancelled']);
  const old = ok(await call(w.host, 'GET', `/api/verify/allotment/${tokenOf(firstUrl)}`));
  assert.equal(old.valid, false); assert.match(old.reason, /replaced/);

  assert.equal((await w.post(`/api/allotment-letters/${list[0].id}/cancel`, {})).status, 400, 'a reason is required');
  ok(await w.post(`/api/allotment-letters/${list[0].id}/cancel`, { reason: 'Issued in error' }));
  const now = ok(await call(w.host, 'GET', `/api/verify/allotment/${tokenOf(list[0].verify_url)}`));
  assert.equal(now.valid, false); assert.equal(now.state, 'cancelled');

  // a fresh letter, then the sale is cancelled: the letter no longer verifies
  ok(await w.post(`/api/sales/${sale.id}/allotment`, {}), 201);
  const live = ok(await w.get(`/api/sales/${sale.id}/allotment`)).letters[0];
  ok(await w.post(`/api/sales/${sale.id}/cancel`, { reason: 'Customer withdrew' }));
  assert.equal(ok(await call(w.host, 'GET', `/api/verify/allotment/${tokenOf(live.verify_url)}`)).valid, false);
  assert.equal((await w.post(`/api/sales/${sale.id}/allotment`, {})).status, 400, 'no new letters on a cancelled sale');
});

test('a letter needs a residential address and only verifies on its own workspace', async () => {
  const a = await workspace('alpha');
  const b = await workspace('bravo');
  const { sale, cust } = await soldPlot(a, { address: '' });
  assert.equal((await a.post(`/api/sales/${sale.id}/allotment`, {})).status, 400, 'no address on file and none given');
  ok(await a.post(`/api/sales/${sale.id}/allotment`, { customer_address: 'House 12, Street 4, Karak', save_address: true }), 201);
  assert.equal(ok(await a.get(`/api/contacts/${cust.id}/workspace`)).contact.address, 'House 12, Street 4, Karak', 'saved on the customer record');
  const url = ok(await a.get(`/api/sales/${sale.id}/allotment`)).letters[0].verify_url;
  assert.equal((await call(b.host, 'GET', `/api/verify/allotment/${tokenOf(url)}`)).status, 404, 'another workspace does not know the letter');
  assert.equal((await call(b.host, 'GET', `/api/sales/${sale.id}/allotment`)).status, 401, 'staff routes need sign-in');
});
