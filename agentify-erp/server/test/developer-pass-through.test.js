// Developer partner portal, phase 3: payments approved by the developer post the rebate.
// Design: docs/DEVELOPER_PARTNER_PORTAL.md
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-dev-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', BILLING_PROVIDER: 'manual' });
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY', 'PLATFORM_ADMIN_EMAIL', 'PLATFORM_ADMIN_PASSWORD']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { toSqft, deductionPct, cleanTiers } = await import('../src/services/developers.js');
const db = await import('../src/db.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); db.closeDbs(); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const PW = 'Tenant@12345';
async function workspace(slug) {
  const r = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Co`, admin_name: 'Owner', admin_email: `owner@${slug}.test`, admin_password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const host = `${slug}.erp.test`;
  const c = (await call(host, 'POST', '/api/auth/login', { identifier: `owner@${slug}.test`, password: PW })).cookie;
  const f = (m) => (u, b) => call(host, m, u, b, { cookie: c });
  return { host, get: f('GET'), post: f('POST'), put: f('PUT') };
}
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };
const tbAmount = (tb, code) => { const a = tb.rows.find((x) => x.code === code); return a ? a.balance : 0; };
const month = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); };

async function setup(w, { name, rebate, agreement = {} }) {
  const d = ok(await w.post('/api/developers', { name, email: `${name.replace(/\W/g, '').toLowerCase()}@dev.test` }), 201);
  const ag = ok(await w.post(`/api/developers/${d.id}/agreements`, { title: 'A', rebate_down_pct: 10, rebate_installment_pct: 5, rebate_balloon_pct: 2, ...agreement }), 201);
  return { d, ag, plot: async (price, title) => {
    const p = ok(await w.post('/api/properties', { title, property_type: 'Plot', area_size: 5, unit: 'Marla', total_price: price, inventory_source: 'developer', developer_id: d.id, agreement_id: ag.id, ...(rebate || {}) }), 201);
    ok(await w.post(`/api/properties/${p.id}/publish`));
    return p;
  } };
}
const book = async (w, plot, price, booking, n, name) => {
  const c = ok(await w.post('/api/contacts', { full_name: name, phone: `+92 300 ${Math.floor(1000000 + Math.random() * 8999999)}` }), 201);
  return ok(await w.post('/api/sales', { contact_id: c.id, property_id: plot.id, sale_price: price, discount: 0, booking_amount: booking, num_installments: n, first_due: month() }), 201);
};


test('customer pays the company, which passes it on: held for the developer, not income; rebate recorded afterwards', async () => {
  const w = await workspace('devhold');
  assert.equal((await w.post('/api/contacts', { full_name: 'No Phone Lead' })).status, 400, 'a lead needs a way to be reached');
  ok(await w.post('/api/contacts', { full_name: 'No Phone Customer', is_customer: true }), 201);
  const { d, plot } = await setup(w, { name: 'Iqbal Dev' });
  const sale = await book(w, await plot(1_000_000, 'IH1'), 1_000_000, 0, 8, 'Zaheer');
  const accts = ok(await w.get('/api/accounting/accounts'));
  const wallet = accts.find((a) => a.code === '1230');
  const pay = (b) => w.post(`/api/developers/${d.id}/files/${sale.id}/payments`, { method: 'Easypaisa', txn_id: `T${Math.random()}`, bank: 'Easypaisa', paid_to_company: true, account_id: wallet.id, ...b });
  assert.equal((await w.post(`/api/developers/${d.id}/files/${sale.id}/payments`, { method: 'Cash', amount: 1000, paid_to_company: true })).status, 400, 'needs an account');
  const r = ok(await pay({ amount: 100_000, payment_type: 'Booking Payment' }), 201);
  assert.equal(r.rebate, 0); assert.ok(r.held);
  let tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '1230'), 100_000); assert.equal(tbAmount(tb, '2610'), 100_000, 'owed to the developer'); assert.equal(tbAmount(tb, '4500'), 0, 'not income');
  const dash = ok(await w.get('/api/dashboard'));
  assert.equal(dash.finance.collected, 0, 'held money is not company collections');
  assert.equal(ok(await w.get(`/api/developers/${d.id}`)).held_for_developer, 100_000);
  // more than is held is refused
  assert.equal((await w.post(`/api/developers/${d.id}/transfers`, { sale_id: sale.id, amount: 150_000, account_id: wallet.id })).status, 400);
  // pass 60,000 on in full, keep 10,000 as rebate on the rest
  ok(await w.post(`/api/developers/${d.id}/transfers`, { sale_id: sale.id, amount: 60_000, account_id: wallet.id, reference_no: 'EP1' }), 201);
  const t2 = ok(await w.post(`/api/developers/${d.id}/transfers`, { sale_id: sale.id, amount: 30_000, rebate_kept: 10_000, account_id: wallet.id }), 201);
  tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '1230'), 10_000); assert.equal(tbAmount(tb, '2610'), 0); assert.equal(tbAmount(tb, '4500'), 10_000);
  assert.equal(ok(await w.get(`/api/developers/${d.id}`)).held_for_developer, 0);
  // voiding the money is blocked once it was passed on
  const rcpt = ok(await w.get(`/api/receipts?sale_id=${sale.id}`)).rows?.[0] || ok(await w.get(`/api/receipts?sale_id=${sale.id}`))[0];
  assert.equal((await w.post(`/api/receipts/${rcpt.id}/void`, { reason: 'x' })).status, 400);
  // the developer pays its rebate later on this file
  ok(await w.post(`/api/developers/${d.id}/files/${sale.id}/rebate`, { amount: 5_000, account_id: wallet.id, date: '2026-11-20' }), 201);
  tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '4500'), 15_000); assert.equal(tbAmount(tb, '1230'), 15_000); assert.equal(tbAmount(tb, '1350'), 0);
  // revenue by source: only the rebates, never the held client money
  const rev = ok(await w.get('/api/reports/revenue-by-source?range=custom&from=2020-01-01&to=2099-12-31'));
  assert.equal(rev.summary.find((x) => x.label === 'Developer rebates').value, 15_000);
  assert.equal(rev.summary.find((x) => x.label === 'Customer payments').value, 0);
  assert.equal(rev.totals.amount, 15_000);
  // cancel the transfer that kept a rebate: the 10,000 rebate goes away and the money is held again
  ok(await w.post(`/api/developers/${d.id}/transfers/${t2.id}/cancel`, { reason: 'entered twice' }));
  tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '2610'), 40_000); assert.equal(tbAmount(tb, '4500'), 5_000);
  assert.equal((await w.post(`/api/developers/${d.id}/transfers/${t2.id}/cancel`, { reason: 'again' })).status, 400);
});

test('a sale can carry a schedule given row by row', async () => {
  const w = await workspace('devsched');
  const { plot } = await setup(w, { name: 'Sched Dev' });
  const p = await plot(1_000_000, 'SC1');
  const c = ok(await w.post('/api/contacts', { full_name: 'Row By Row', is_customer: true }), 201);
  const body = { contact_id: c.id, property_id: p.id, sale_price: 1_000_000, discount: 0, booking_amount: 300_000, num_installments: 3,
    schedule: [{ kind: 'installment', due_date: '2027-01-05', amount: 25_000 }, { kind: 'installment', due_date: '2027-02-05', amount: 80_000 }, { kind: 'installment', due_date: '2027-03-05', amount: 595_000 }] };
  assert.equal((await w.post('/api/sales', { ...body, schedule: body.schedule.slice(0, 2) })).status, 400, 'rows must add up');
  const s = ok(await w.post('/api/sales', body), 201);
  const d = ok(await w.get(`/api/sales/${s.id}`)).sale;
  assert.deepEqual(d.installments.map((i) => i.amount), [300_000, 25_000, 80_000, 595_000]);
});
