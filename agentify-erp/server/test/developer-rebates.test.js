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

test('pure rebate maths: plot rebate is earned pro rata and never passes the total; agreement rates apply per stage', async () => {
  const { computeRebate } = await import('../src/services/developerRebates.js');
  const sale = { id: 999999, net_price: 1_000_000 };
  const plot = { mode: 'plot', type: 'fixed', value: 30_000 };
  assert.deepEqual(computeRebate(sale, plot, [{ kind: 'booking', amount: 333_333 }]).map((r) => [r.stage, r.amount]), [['down', 10_000]]);
  const pct = { mode: 'plot', type: 'percent', value: 5 };
  assert.equal(computeRebate(sale, pct, [{ kind: 'booking', amount: 200_000 }, { kind: 'installment', amount: 100_000 }]).reduce((t, r) => t + r.amount, 0), 15_000);
  const ag = { mode: 'agreement', down: 10, installment: 5, balloon: 2 };
  assert.deepEqual(computeRebate(sale, ag, [{ kind: 'advance', amount: 100_000 }, { kind: 'installment', amount: 100_000 }, { kind: 'balloon', amount: 100_000 }]).map((r) => [r.stage, r.amount]),
    [['down', 10_000], ['installment', 5_000], ['balloon', 2_000]]);
  assert.deepEqual(computeRebate(sale, { mode: 'agreement', down: 0, installment: 0, balloon: 0 }, [{ kind: 'booking', amount: 5 }]), []);
});

test('an approved payment on a developer file posts the plot rebate to the books and the developer statement', async () => {
  const w = await workspace('devreb');
  const { d, plot } = await setup(w, { name: 'Rebate Dev', rebate: { rebate_type: 'percent', rebate_value: 5 } });
  const sale = await book(w, await plot(2_000_000, 'RP1'), 2_000_000, 200_000, 10, 'Ayesha Khan');
  const pay = (b) => w.post(`/api/developers/${d.id}/files/${sale.id}/payments`, { method: 'Cash', ...b });

  const p1 = ok(await pay({ amount: 200_000, payment_type: 'Booking Payment' }), 201);
  assert.equal(p1.rebate, 10_000, '5% of the 200,000 booking');
  let tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '2610'), 1_800_000, 'contract less what the developer has been paid');
  assert.equal(tbAmount(tb, '1350'), 10_000); assert.equal(tbAmount(tb, '4500'), 10_000);
  assert.equal(tbAmount(tb, '1110'), 0, 'no company cash moved'); assert.equal(tbAmount(tb, '4100'), 0);
  assert.equal(tb.total_debit, tb.total_credit);
  const s1 = ok(await w.get(`/api/sales/${sale.id}`)).sale;
  assert.equal(s1.paid_amount, 200_000);

  // the same transaction id cannot be recorded twice; over-payment and a stranger's file are refused
  ok(await pay({ amount: 100_000, method: 'Bank Transfer', bank: 'HBL', txn_id: 'TX-1', payment_type: 'Installment' }), 201);
  assert.equal((await pay({ amount: 100_000, method: 'Bank Transfer', bank: 'HBL', txn_id: 'TX-1' })).status, 400);
  assert.equal((await pay({ amount: 9_000_000 })).status, 400);
  assert.equal((await pay({ amount: 0 })).status, 400);
  assert.equal((await w.post(`/api/developers/${d.id}/files/999999/payments`, { amount: 1000 })).status, 404);

  // voiding a payment takes its rebate back; the books balance again
  const rcp = ok(await w.get(`/api/receipts?limit=10`));
  const list = Array.isArray(rcp) ? rcp : rcp.rows;
  const second = list.find((r) => r.amount === 100_000);
  ok(await w.post(`/api/receipts/${second.id}/void`, { reason: 'bounced' }));
  tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '1350'), 10_000); assert.equal(tbAmount(tb, '4500'), 10_000);
  assert.equal(tb.total_debit, tb.total_credit);
  let st = ok(await w.get(`/api/developers/${d.id}/rebates`));
  assert.equal(st.totals.due, 10_000); assert.equal(st.totals.reversed, 5_000); assert.equal(st.rows.length, 2);

  // pay the rest in two goes; the rebate adds up to exactly 5% of the contract
  ok(await pay({ amount: 1_000_000, payment_type: 'Installment' }), 201);
  ok(await pay({ amount: 800_000, payment_type: 'Full Payment' }), 201);
  st = ok(await w.get(`/api/developers/${d.id}/rebates`));
  assert.equal(st.totals.earned, 100_000);
  tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '2610'), 0, 'clearing returns to zero when the file is complete');
  assert.equal(tbAmount(tb, '1350'), 100_000); assert.equal(tbAmount(tb, '4500'), 100_000);
  assert.equal(ok(await w.get(`/api/developers/${d.id}`)).rebate_on_sold, 100_000);

  // the developer pays the rebate: receivable clears into the bank; a paid rebate's receipt can no longer be voided
  const acc = ok(await w.get('/api/accounting/accounts')).find((a) => a.code === '1110');
  assert.equal((await w.post(`/api/developers/${d.id}/rebates/receive`, { account_id: 999999 })).status, 400);
  const got = ok(await w.post(`/api/developers/${d.id}/rebates/receive`, { account_id: acc.id, method: 'Cash', reference_no: 'REB-1' }));
  assert.equal(got.received, 100_000);
  tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '1350'), 0); assert.equal(tbAmount(tb, '1110'), 100_000); assert.equal(tbAmount(tb, '4500'), 100_000);
  assert.equal(tb.total_debit, tb.total_credit);
  st = ok(await w.get(`/api/developers/${d.id}/rebates`));
  assert.equal(st.totals.due, 0); assert.equal(st.totals.received, 100_000);
  assert.equal((await w.post(`/api/developers/${d.id}/rebates/receive`, { account_id: acc.id })).status, 400, 'nothing left to receive');
  const first = (Array.isArray(ok(await w.get('/api/receipts?limit=10'))) ? ok(await w.get('/api/receipts?limit=10')) : ok(await w.get('/api/receipts?limit=10')).rows).find((r) => r.amount === 200_000);
  assert.equal((await w.post(`/api/receipts/${first.id}/void`, { reason: 'x' })).status, 400);
});

test('without a plot rebate the agreement rates apply per stage; the file keeps the terms it was booked under', async () => {
  const w = await workspace('devagr');
  const { d, ag, plot } = await setup(w, { name: 'Agreement Dev' });
  const sale = await book(w, await plot(1_000_000, 'AP1'), 1_000_000, 200_000, 8, 'Bilal Ahmed');
  const pay = (b) => w.post(`/api/developers/${d.id}/files/${sale.id}/payments`, { method: 'Cash', ...b });
  // later agreement edits do not change this file
  ok(await w.put(`/api/developers/${d.id}/agreements/${ag.id}`, { rebate_down_pct: 50, rebate_installment_pct: 50 }));
  assert.equal(ok(await pay({ amount: 200_000, payment_type: 'Booking Payment' }), 201).rebate, 20_000, '10% on the down payment');
  assert.equal(ok(await pay({ amount: 100_000, payment_type: 'Installment' }), 201).rebate, 5_000, '5% on an installment');
  const st = ok(await w.get(`/api/developers/${d.id}/rebates`));
  assert.deepEqual(st.rows.map((r) => [r.stage, r.rate, r.amount, r.source]).sort(), [['down', 10, 20_000, 'agreement'], ['installment', 5, 5_000, 'agreement']].sort());
  // a payment spanning stages books one row per stage: 100,000 settles the booking-free part as installments
  const tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '4500'), 25_000); assert.equal(tb.total_debit, tb.total_credit);
});

test('rebate posting needs developers.approve and the developer sees only their own rebates, without contact details', async () => {
  const w = await workspace('devperm');
  const { d, plot } = await setup(w, { name: 'Perm Dev', rebate: { rebate_type: 'fixed', rebate_value: 30_000 } });
  const other = await setup(w, { name: 'Other Dev' });
  const sale = await book(w, await plot(1_000_000, 'PP1'), 1_000_000, 300_000, 7, 'Sana Malik');
  ok(await w.post(`/api/developers/${d.id}/files/${sale.id}/payments`, { amount: 300_000, method: 'Cash', payment_type: 'Booking Payment' }), 201);
  // a file belongs to its own developer only
  assert.equal((await w.post(`/api/developers/${other.d.id}/files/${sale.id}/payments`, { amount: 1000, method: 'Cash' })).status, 404);

  // odd instalments: the plot rebate still adds up to exactly the fixed 30,000 once the file is paid
  ok(await w.post(`/api/developers/${d.id}/files/${sale.id}/payments`, { amount: 333_333, method: 'Cash', payment_type: 'Installment' }), 201);
  ok(await w.post(`/api/developers/${d.id}/files/${sale.id}/payments`, { amount: 366_667, method: 'Cash', payment_type: 'Full Payment' }), 201);
  assert.equal(ok(await w.get(`/api/developers/${d.id}/rebates`)).totals.earned, 30_000);
  const login = ok(await w.post(`/api/developers/${d.id}/portal-login`, {}), 201);
  const dc = (await call(w.host, 'POST', '/api/auth/login', { identifier: login.login, password: login.password, portal: true })).cookie;
  const mine = ok(await call(w.host, 'GET', '/api/developer/rebates', null, { cookie: dc }));
  assert.equal(mine.totals.due, 30_000); assert.equal(mine.rows[0].customer_name, 'Sana Malik');
  assert.ok(!/phone|cnic|email|agent|notes/i.test(JSON.stringify(mine)));
  // the developer cannot record or receive rebates through staff routes
  assert.equal((await call(w.host, 'POST', `/api/developers/${d.id}/files/${sale.id}/payments`, { amount: 1000, method: 'Cash' }, { cookie: dc })).status, 403);
  assert.equal((await call(w.host, 'GET', '/api/developers/' + d.id + '/rebates', null, { cookie: dc })).status, 403);
  const login2 = ok(await w.post(`/api/developers/${other.d.id}/portal-login`, {}), 201);
  const dc2 = (await call(w.host, 'POST', '/api/auth/login', { identifier: login2.login, password: login2.password, portal: true })).cookie;
  assert.equal(ok(await call(w.host, 'GET', '/api/developer/rebates', null, { cookie: dc2 })).rows.length, 0);
});
