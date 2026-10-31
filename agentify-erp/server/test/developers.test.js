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
