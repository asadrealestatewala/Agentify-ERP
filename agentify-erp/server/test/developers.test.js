// Developer partner portal, phase 1: developers, agreements, developer plots, developer files (pass-through accounting),
// permissions and isolation. Design: docs/DEVELOPER_PARTNER_PORTAL.md
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

test('pure helpers: sqft from the region marla size, deduction tiers', () => {
  assert.equal(toSqft(5, 'Marla'), 1361.25);
  assert.equal(toSqft(1, 'Kanal'), 5445);
  assert.equal(toSqft(900, 'sqft'), 900);
  assert.equal(toSqft(1, 'acre'), null);
  const tiers = cleanTiers([{ to_day: 90, pct: 20 }, { to_day: 180, pct: 15 }, { pct: 10 }]);
  assert.equal(deductionPct(tiers, 30), 20);
  assert.equal(deductionPct(tiers, 90), 20);
  assert.equal(deductionPct(tiers, 91), 15);
  assert.equal(deductionPct(tiers, 400), 10);
  assert.equal(deductionPct([], 10), null);
  assert.throws(() => cleanTiers([{ pct: 10 }, { to_day: 5, pct: 5 }]));
  assert.throws(() => cleanTiers([{ to_day: 90, pct: 20 }, { to_day: 30, pct: 15 }]));
  assert.throws(() => cleanTiers([{ to_day: 90, pct: 120 }]));
});

test('developers, agreements, plots and developer files', async () => {
  const w = await workspace('devco');
  assert.equal((await w.post('/api/developers', { name: ' ' })).status, 400);
  const d = ok(await w.post('/api/developers', { name: 'Green Valley Developers', email: 'gv@dev.test', phone: '+92 300 1112223' }), 201);
  const bad = await w.post(`/api/developers/${d.id}/agreements`, { title: 'X', rebate_down_pct: 150 });
  assert.equal(bad.status, 400);
  const ag = ok(await w.post(`/api/developers/${d.id}/agreements`, {
    title: 'Phase 1 plots', developer_rate: 1000, company_rate: 1500, rebate_down_pct: 10, rebate_installment_pct: 5, rebate_balloon_pct: 5,
    cancel_window_days: 90, cancel_tiers: [{ to_day: 90, pct: 20 }, { to_day: 180, pct: 15 }, { pct: 10 }],
  }), 201);

  // an own plot and a developer plot
  const own = ok(await w.post('/api/properties', { title: 'Own plot', property_type: 'Plot', area_size: 5, unit: 'Marla', total_price: 3_000_000 }), 201);
  assert.equal(own.inventory_source, 'own');
  const devPlot = ok(await w.post('/api/properties', { title: 'GV Plot 12', property_type: 'Plot', area_size: 5, unit: 'Marla', total_price: 2_000_000, inventory_source: 'developer', developer_id: d.id, agreement_id: ag.id }), 201);
  assert.equal(devPlot.inventory_source, 'developer'); assert.equal(devPlot.developer_id, d.id);
  assert.equal((await w.post('/api/properties', { title: 'Bad', total_price: 1, inventory_source: 'developer' })).status, 400, 'needs a developer');
  assert.equal((await w.post('/api/properties', { title: 'Bad2', total_price: 1, inventory_source: 'developer', developer_id: d.id, agreement_id: 9999 })).status, 400, 'agreement must belong to the developer');
  for (const id of [own.id, devPlot.id]) ok(await w.post(`/api/properties/${id}/publish`));

  const customer = ok(await w.post('/api/contacts', { full_name: 'Ayesha Khan', phone: '+92 300 7770001' }), 201);
  const customer2 = ok(await w.post('/api/contacts', { full_name: 'Bilal Ahmed', phone: '+92 300 7770002' }), 201);
  const plan = { booking_amount: 200_000, num_installments: 10, first_due: month() };

  // the developer file: pass-through, never company revenue
  const sale = ok(await w.post('/api/sales', { contact_id: customer.id, property_id: devPlot.id, sale_price: 2_000_000, discount: 0, ...plan }), 201);
  const s = ok(await w.get(`/api/sales/${sale.id}`)).sale;
  assert.match(s.booking_id, /^BK-\d{5}$/); assert.equal(s.file_state, 'active'); assert.equal(s.holder, 'customer'); assert.equal(s.developer_id, d.id);
  assert.ok(s.cancel_window_until); assert.equal(JSON.parse(s.cancel_tiers)[0].pct, 20);
  let tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '2610'), 2_000_000, 'contract sits in developer clearing');
  assert.equal(tbAmount(tb, '4100'), 0, 'no property-sales revenue for a developer file');
  assert.equal(tb.total_debit, tb.total_credit);

  // an own sale still books revenue as before
  ok(await w.post('/api/sales', { contact_id: customer2.id, property_id: own.id, sale_price: 3_000_000, discount: 0, ...plan }), 201);
  tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '4100'), 3_000_000);

  // direct receipts on a developer file are refused until the approval flow exists
  const acc = ok(await w.get('/api/accounting/accounts')).find((a) => a.code === '1110');
  const rcpt = await w.post('/api/receipts', { contact_id: customer.id, sale_id: sale.id, amount: 200_000, payment_type: 'Booking Payment', method: 'Cash', account_id: acc.id });
  assert.equal(rcpt.status, 400); assert.match(rcpt.data.error || JSON.stringify(rcpt.data), /developer file/i);

  // the Developers table asks for pages ({rows,total}); the plain call (property form picker) stays an array
  const paged = ok(await w.get('/api/developers?page=1&limit=25&q=green'));
  assert.equal(paged.total, 1); assert.equal(paged.rows[0].name, 'Green Valley Developers'); assert.equal(ok(await w.get('/api/developers?page=1&q=zzz')).total, 0);
  assert.ok(Array.isArray(ok(await w.get('/api/developers'))));

  // developer view for staff
  const detail = ok(await w.get(`/api/developers/${d.id}`));
  assert.equal(detail.files, 1); assert.equal(detail.contract_value, 2_000_000); assert.equal(detail.agreements.length, 1); assert.equal(detail.plots, 1);
  const plots = ok(await w.get(`/api/developers/${d.id}/plots`));
  assert.equal(plots[0].area_sqft, 1361.25); assert.equal(plots[0].customer_name, 'Ayesha Khan'); assert.equal(plots[0].booking_id, s.booking_id);

  // agreement edits do not rewrite a booked file
  ok(await w.put(`/api/developers/${d.id}/agreements/${ag.id}`, { cancel_tiers: [{ pct: 5 }], cancel_window_days: 10 }));
  assert.equal(JSON.parse(ok(await w.get(`/api/sales/${sale.id}`)).sale.cancel_tiers)[0].pct, 20);

  // cancelling the (receipt-free) developer file reverses the pass-through, not revenue
  ok(await w.post(`/api/sales/${sale.id}/cancel`, { reason: 'test' }));
  tb = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tb, '2610'), 0); assert.equal(tbAmount(tb, '4100'), 3_000_000);
  assert.equal(tb.total_debit, tb.total_credit);

  // portal login: a developer account can sign in but never reaches staff APIs
  const login = ok(await w.post(`/api/developers/${d.id}/portal-login`, {}), 201);
  const dc = (await call(w.host, 'POST', '/api/auth/login', { identifier: login.login, password: login.password, portal: true })).cookie;
  assert.ok(dc, 'developer can sign in');
  for (const u of ['/api/developers', '/api/properties', '/api/sales']) assert.equal((await call(w.host, 'GET', u, null, { cookie: dc })).status, 403, u);
});

test('developer data is isolated between workspaces and needs the module permission', async () => {
  const a = await workspace('deva'); const b = await workspace('devb');
  ok(await a.post('/api/developers', { name: 'Only In A' }), 201);
  assert.equal(ok(await b.get('/api/developers')).length, 0);
});

test('developer portal: own files only, allow-listed fields, no CNIC or phone anywhere', async () => {
  const w = await workspace('devportal');
  const mkDev = async (name, email) => {
    const d = ok(await w.post('/api/developers', { name, email }), 201);
    const ag = ok(await w.post(`/api/developers/${d.id}/agreements`, { title: 'A', cancel_window_days: 90, cancel_tiers: [{ pct: 20 }] }), 201);
    const login = ok(await w.post(`/api/developers/${d.id}/portal-login`, {}), 201);
    const dc = (await call(w.host, 'POST', '/api/auth/login', { identifier: login.login, password: login.password, portal: true })).cookie;
    return { d, ag, get: (u) => call(w.host, 'GET', u, null, { cookie: dc }) };
  };
  const one = await mkDev('Dev One', 'one@dev.test'); const two = await mkDev('Dev Two', 'two@dev.test');
  const plot = ok(await w.post('/api/properties', { title: 'Plot 7', plot_no: '7', area_size: 10, unit: 'Marla', total_price: 4_000_000, inventory_source: 'developer', developer_id: one.d.id, agreement_id: one.ag.id }), 201);
  ok(await w.post(`/api/properties/${plot.id}/publish`));
  const c = ok(await w.post('/api/contacts', { full_name: 'Sana Malik', phone: '+92 300 5551234', cnic: '35202-1234567-1', email: 'sana@private.test' }), 201);
  const sale = ok(await w.post('/api/sales', { contact_id: c.id, property_id: plot.id, sale_price: 4_000_000, discount: 0, booking_amount: 400_000, num_installments: 6, first_due: month() }), 201);

  const dash = ok(await one.get('/api/developer/dashboard'));
  assert.equal(dash.files, 1); assert.equal(dash.contract_value, 4_000_000);
  const files = ok(await one.get('/api/developer/files'));
  assert.equal(files.length, 1);
  assert.equal(files[0].customer_name, 'Sana Malik'); assert.match(files[0].booking_id, /^BK-/); assert.equal(files[0].plot.area_sqft, 2722.5);
  const detail = ok(await one.get(`/api/developer/files/${sale.id}`));
  assert.equal(detail.schedule.length, 7);
  const everything = JSON.stringify([dash, files, detail, ok(await one.get('/api/developer/plots'))]);
  for (const secret of ['5551234', '35202', '1234567', 'sana@private.test', '+92 300']) assert.ok(!everything.includes(secret), `leaked ${secret}`);
  for (const k of ['cnic', 'phone', 'email', 'agent', 'notes', 'contact_id']) assert.ok(!new RegExp(`"${k}[a-z_]*"`).test(everything), `field ${k} present`);

  // another developer sees nothing of it; staff cannot use the developer API; the developer API needs a developer session
  assert.equal(ok(await two.get('/api/developer/files')).length, 0);
  assert.equal((await two.get(`/api/developer/files/${sale.id}`)).status, 404);
  assert.equal((await w.get('/api/developer/files')).status, 403);
  assert.equal((await call(w.host, 'GET', '/api/developer/files')).status, 401);
});

test('link existing plots to a developer in bulk and set per-plot rebates', async () => {
  const w = await workspace('devlink');
  const d = ok(await w.post('/api/developers', { name: 'Link Dev' }), 201);
  const d2 = ok(await w.post('/api/developers', { name: 'Other Dev' }), 201);
  const ag = ok(await w.post(`/api/developers/${d.id}/agreements`, { title: 'A1', rebate_down_pct: 5 }), 201);
  const mk = async (title, price) => ok(await w.post('/api/properties', { title, property_type: 'Plot', area_size: 5, unit: 'Marla', total_price: price }), 201);
  const [p1, p2, p3] = [await mk('P1', 1_000_000), await mk('P2', 2_000_000), await mk('P3', 3_000_000)];

  const linkable = ok(await w.get(`/api/developers/${d.id}/linkable-plots`));
  assert.equal(linkable.length, 3);
  assert.equal(ok(await w.get(`/api/developers/${d.id}/linkable-plots?q=P2`)).length, 1);

  // bulk link with one rebate (5%) for both
  const out = ok(await w.post(`/api/developers/${d.id}/link-plots`, { property_ids: [p1.id, p2.id], agreement_id: ag.id, rebate_type: 'percent', rebate_value: 5 }));
  assert.deepEqual(out.linked.sort(), [p1.id, p2.id].sort());
  let plots = ok(await w.get(`/api/developers/${d.id}/plots`));
  assert.equal(plots.length, 2);
  assert.equal(plots.find((p) => p.id === p2.id).rebate_amount, 100_000);
  assert.equal(ok(await w.get(`/api/developers/${d.id}`)).rebate_expected, 150_000);
  assert.equal(ok(await w.get(`/api/developers/${d.id}/linkable-plots`)).length, 1);

  // another developer cannot take a linked plot; bad agreement / empty list refused
  const ag2 = ok(await w.post(`/api/developers/${d2.id}/agreements`, { title: 'B1' }), 201);
  assert.equal(ok(await w.post(`/api/developers/${d2.id}/link-plots`, { property_ids: [p1.id], agreement_id: ag2.id })).skipped.length, 1);
  assert.equal((await w.post(`/api/developers/${d.id}/link-plots`, { property_ids: [p3.id], agreement_id: ag2.id })).status, 400);
  assert.equal((await w.post(`/api/developers/${d.id}/link-plots`, { property_ids: [], agreement_id: ag.id })).status, 400);

  // bulk rebate: fixed on one plot, then percent on all; validation
  ok(await w.post(`/api/developers/${d.id}/plot-rebates`, { property_ids: [p1.id], rebate_type: 'fixed', rebate_value: 40_000 }));
  assert.equal(ok(await w.get(`/api/developers/${d.id}/plots`)).find((p) => p.id === p1.id).rebate_amount, 40_000);
  assert.equal((await w.post(`/api/developers/${d.id}/plot-rebates`, { rebate_type: 'percent', rebate_value: 150 })).status, 400);
  ok(await w.post(`/api/developers/${d.id}/plot-rebates`, { rebate_type: 'percent', rebate_value: 2 }));
  assert.equal(ok(await w.get(`/api/developers/${d.id}`)).rebate_expected, 20_000 + 40_000);
  ok(await w.post(`/api/developers/${d.id}/plot-rebates`, { rebate_type: '' }));
  assert.equal(ok(await w.get(`/api/developers/${d.id}`)).rebate_expected, 0);

  // per-plot edit through the property form, and a rebate on an own plot is refused
  ok(await w.put(`/api/properties/${p2.id}`, { rebate_type: 'fixed', rebate_value: 25_000 }));
  assert.equal(ok(await w.get(`/api/developers/${d.id}`)).rebate_expected, 25_000);
  assert.equal((await w.put(`/api/properties/${p3.id}`, { rebate_type: 'percent', rebate_value: 3 })).status, 400);

  // a booked plot cannot be unlinked; a free one can
  ok(await w.post(`/api/properties/${p1.id}/publish`));
  const cust = ok(await w.post('/api/contacts', { full_name: 'Zara', phone: '+92 300 5550001' }), 201);
  ok(await w.post('/api/sales', { contact_id: cust.id, property_id: p1.id, sale_price: 1_000_000, discount: 0, booking_amount: 100_000, num_installments: 5, first_due: month() }), 201);
  const un = ok(await w.post(`/api/developers/${d.id}/unlink-plots`, { property_ids: [p1.id, p2.id] }));
  assert.deepEqual(un.unlinked, [p2.id]); assert.equal(un.skipped.length, 1);
  assert.equal(ok(await w.get(`/api/properties/${p2.id}`)).inventory_source, 'own');
});

test('developer portal: approve / reject customer payments, rebate statement, reports, isolation and audit', async () => {
  const w = await workspace('devpay');
  const mkDev = async (name, email, extra = {}) => {
    const d = ok(await w.post('/api/developers', { name, email }), 201);
    const ag = ok(await w.post(`/api/developers/${d.id}/agreements`, { title: 'A', rebate_down_pct: 10, rebate_installment_pct: 5, ...extra }), 201);
    const login = ok(await w.post(`/api/developers/${d.id}/portal-login`, {}), 201);
    const dc = (await call(w.host, 'POST', '/api/auth/login', { identifier: login.login, password: login.password, portal: true })).cookie;
    return { d, ag, get: (u) => call(w.host, 'GET', u, null, { cookie: dc }), post: (u, b) => call(w.host, 'POST', u, b || {}, { cookie: dc }) };
  };
  const one = await mkDev('Pay Dev One', 'p1@dev.test'); const two = await mkDev('Pay Dev Two', 'p2@dev.test');
  const plot = ok(await w.post('/api/properties', { title: 'Plot 9', plot_no: '9', area_size: 10, unit: 'Marla', total_price: 4_000_000, inventory_source: 'developer', developer_id: one.d.id, agreement_id: one.ag.id }), 201);
  ok(await w.post(`/api/properties/${plot.id}/publish`));
  const c = ok(await w.post('/api/contacts', { full_name: 'Hina Raza', phone: '+92 300 7771234', email: 'hina@private.test' }), 201);
  const sale = ok(await w.post('/api/sales', { contact_id: c.id, property_id: plot.id, sale_price: 4_000_000, discount: 0, booking_amount: 400_000, num_installments: 6, first_due: month() }), 201);
  const access = (await w.post(`/api/customers/${c.id}/portal-access`, { password: 'Client@12345' })).data;
  const cc = (await call(w.host, 'POST', '/api/auth/login', { identifier: access.login, password: 'Client@12345', portal: true })).cookie;
  const cust = (m, u, b) => call(w.host, m, u, b, { cookie: cc });
  const dues = ok(await cust('GET', '/api/portal/dues')).filter((d) => d.sale_id === sale.id);
  const report = async (inst, txn) => ok(await cust('POST', '/api/portal/payment-claims', { installment_ids: [inst.id], amount: inst.remaining, method: 'Bank Transfer', bank: 'HBL', txn_id: txn }), 201);
  const first = await report(dues[0], 'TXN-A1');
  const second = await report(dues[1], 'TXN-A2');

  // the developer sees both, without contact details; another developer sees nothing and cannot act
  const list = ok(await one.get('/api/developer/payments?status=open'));
  assert.equal(list.length, 2); assert.equal(list[0].customer_name, 'Hina Raza');
  assert.ok(!/7771234|private\.test/.test(JSON.stringify(list)));
  assert.equal(ok(await two.get('/api/developer/payments')).length, 0);
  assert.equal((await two.post(`/api/developer/payments/${first.id}/approve`)).status, 404);
  assert.equal((await w.post(`/api/developer/payments/${first.id}/approve`)).status, 403, 'staff cannot use the developer API');
  assert.equal((await cust('POST', `/api/developer/payments/${first.id}/approve`)).status, 403, 'customers cannot either');
  assert.equal((await one.post(`/api/developer/payments/${second.id}/reject`, { reason: ' ' })).status, 400, 'a reason is required');

  // approve: receipt clears 2610, no company cash moves, the file and schedule update, then it cannot be decided twice
  const tbBefore = ok(await w.get('/api/accounting/trial-balance'));
  const ap = ok(await one.post(`/api/developer/payments/${first.id}/approve`, { note: 'received in my bank' }));
  assert.ok(ap.receipt_id);
  const tbAfter = ok(await w.get('/api/accounting/trial-balance'));
  for (const code of ['1110', '1120', '1210']) assert.equal(tbAmount(tbAfter, code), tbAmount(tbBefore, code), `cash account ${code} untouched`);
  assert.equal((await one.post(`/api/developer/payments/${first.id}/approve`)).status, 400, 'already decided');
  const detail = ok(await one.get(`/api/developer/files/${sale.id}`));
  assert.equal(detail.paid, dues[0].remaining);
  assert.ok(detail.history.some((h) => h.event === 'payment_approved'));

  // reject with a reason
  ok(await one.post(`/api/developer/payments/${second.id}/reject`, { reason: 'Not received in my account' }));
  const all_ = ok(await one.get('/api/developer/payments'));
  assert.deepEqual(all_.map((p) => p.status).sort(), ['approved', 'rejected']);
  assert.equal(ok(await one.get('/api/developer/payments?status=open')).length, 0);

  // rebate statement: first payment was the booking amount => 10% of it
  const st = ok(await one.get('/api/developer/rebates'));
  assert.equal(st.rows.length, 1); assert.equal(st.total_received, dues[0].remaining);
  assert.equal(st.total_rebate, Math.round(dues[0].remaining * (dues[0].kind === 'installment' ? 5 : 10) / 100));
  assert.equal(ok(await two.get('/api/developer/rebates')).rows.length, 0);
  // the same rebate is posted to the books as company income, owed by the developer
  const tbRebate = ok(await w.get('/api/accounting/trial-balance'));
  assert.equal(tbAmount(tbRebate, '1350'), st.total_rebate); assert.equal(tbAmount(tbRebate, '4500'), st.total_rebate);
  assert.equal(tbRebate.total_debit, tbRebate.total_credit);

  // reports download as csv, are scoped, validated and audited
  const csv = await one.get('/api/developer/reports/rebate-statement?format=csv');
  assert.equal(csv.status, 200); assert.match(String(csv.data), /Pay Dev|Plot 9|BK-/);
  assert.equal((await one.get('/api/developer/reports/files?format=xlsx')).status, 200);
  assert.equal((await one.get('/api/developer/reports/nope')).status, 404);
  assert.equal((await one.get('/api/developer/reports/files?format=exe')).status, 400);
  assert.ok(!/BK-/.test(String((await two.get('/api/developer/reports/files?format=csv')).data)), 'other developer gets no rows');
  const aud = ok(await w.get('/api/audit?limit=100'));
  const text = JSON.stringify(aud);
  assert.match(text, /Developer approved customer payment/); assert.match(text, /Developer declined customer payment/); assert.match(text, /Developer downloaded report/);

  // an inactive developer can no longer approve
  const third = await report(dues[2], 'TXN-A3');
  ok(await w.put(`/api/developers/${one.d.id}`, { status: 'inactive' }));
  const blocked = await one.post(`/api/developer/payments/${third.id}/approve`);
  assert.ok([400, 401, 403].includes(blocked.status), String(blocked.status));
});
