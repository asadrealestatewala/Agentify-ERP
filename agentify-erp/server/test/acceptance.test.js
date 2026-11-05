import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { all, get, val } = await import('../src/db.js');
const { today, addMonths } = await import('../src/util.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, password = 'Demo@12345', portal = false) {
  const jar = {};
  const call = async (method, url, body, extra = {}) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '', ...extra }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const l = await call('POST', '/api/auth/login', { identifier, password, portal });
  assert.equal(l.status, 200, `login failed for ${identifier}: ${JSON.stringify(l.data)}`);
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), call, me: l.data };
}

const acc = (code) => val('SELECT id FROM accounts WHERE code=?', code);
const bal = (code) => { const a = get('SELECT * FROM accounts WHERE id=?', acc(code)); const r = get('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM journal_lines WHERE account_id=?', a.id); return ['asset', 'expense'].includes(a.type) ? r.d - r.c : r.c - r.d; };

test('seeded database is internally consistent', () => {
  const t = get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines');
  assert.equal(t.d, t.c, 'trial balance must balance');
  // customer receivable control account == sum of outstanding on confirmed sales
  const outstanding = val("SELECT SUM(net_price-paid_amount) FROM sales WHERE status='confirmed'");
  assert.equal(bal('1300'), outstanding, 'AR control account must reconcile to sales sub-ledger');
  // installments paid == sale.paid_amount
  for (const s of all("SELECT * FROM sales WHERE status='confirmed'")) {
    assert.equal(val('SELECT SUM(paid) FROM installments WHERE sale_id=?', s.id), s.paid_amount, `installments vs paid_amount for ${s.sale_no}`);
    assert.equal(val("SELECT COALESCE(SUM(rs.amount),0) FROM receipt_sales rs JOIN receipts r ON r.id=rs.receipt_id WHERE rs.sale_id=? AND r.status='valid'", s.id), s.paid_amount, `receipt shares vs paid for ${s.sale_no}`);
    assert.equal(val('SELECT SUM(amount) FROM installments WHERE sale_id=?', s.id), s.net_price, 'schedule must sum to net price');
  }
  const payable = val("SELECT COALESCE(SUM(credit-debit),0) FROM journal_lines WHERE account_id=? AND vendor_id IS NOT NULL", acc('2100'));
  const vouchers = val("SELECT SUM(amount-paid_amount) FROM expense_vouchers WHERE status IN ('approved','partial')");
  assert.equal(payable, vouchers, 'vendor payable control account must reconcile');
});

test('Scenario 1 — agent lead flows to the manager, follow-up, conversion', async () => {
  const agent = await client('agent3@expertdevelopers.pk');
  const sm = await client('salesmanager@expertdevelopers.pk');
  const created = await agent.post('/api/contacts', { full_name: 'Test Lead One', phone: '+92 300 9990001', lead_source: 'Walk-in', budget: 7_000_000, followup_date: today() });
  assert.equal(created.status, 201);
  assert.equal(created.data.agent_id, agent.me.id, 'agent leads are assigned to themselves');
  const list = await sm.get('/api/contacts?q=Test%20Lead%20One');
  assert.equal(list.data.total, 1, 'sales manager sees the agent lead');
  const dup = await agent.post('/api/contacts', { full_name: 'Dup', phone: '+92 300 9990001' });
  assert.equal(dup.status, 400, 'duplicate phone rejected');
  const ws = await agent.get(`/api/contacts/${created.data.id}/workspace`);
  assert.ok(ws.data.activities.some((a) => a.action === 'Lead created'));
  assert.ok(ws.data.tasks.length >= 1, 'follow-up task created');
  const move = await sm.put('/api/pipeline/move', { contact_id: created.data.id, stage_id: get("SELECT id FROM lookups WHERE value='Contacted'").id });
  assert.equal(move.status, 200);
  const ws2 = await sm.get(`/api/contacts/${created.data.id}/workspace`);
  const stageAct = ws2.data.activities.find((a) => a.action === 'Lead stage changed');
  assert.equal(stageAct.prev_value, 'Non Contacted'); assert.equal(stageAct.new_value, 'Contacted');
});

test('agents cannot see other agents’ leads or finance', async () => {
  const a1 = await client('agent1@expertdevelopers.pk');
  const a3 = await client('agent3@expertdevelopers.pk');
  const other = get("SELECT id FROM contacts WHERE full_name='Muhammad Ali'").id; // agent1's customer
  assert.equal((await a3.get(`/api/contacts/${other}/workspace`)).status, 403);
  assert.equal((await a3.put(`/api/contacts/${other}`, { full_name: 'Hacked' })).status, 403);
  assert.equal((await a1.get(`/api/contacts/${other}/workspace`)).status, 200);
  assert.equal((await a1.get('/api/accounting/accounts')).status, 403);
  assert.equal((await a1.get('/api/receipts')).status, 403);
  assert.equal((await a1.get('/api/accounting/treasury')).status, 403);
  const comm = await a1.get('/api/commissions');
  assert.ok(comm.data.rows.every((c) => c.agent_id === a1.me.id), 'agent sees only own commissions');
  const foreign = get('SELECT id FROM commissions WHERE agent_id<>?', a1.me.id);
  if (foreign) {
    assert.equal((await a1.get(`/api/commissions/${foreign.id}`)).status, 403);
    assert.equal((await a1.post(`/api/commissions/${foreign.id}/approve`)).status, 403);
    assert.equal((await a1.post(`/api/commissions/${foreign.id}/pay`, { account_id: acc('1110') })).status, 403);
  }
  const dash = await a1.get('/api/dashboard');
  assert.equal(dash.data.finance, undefined, 'no company finance on the agent dashboard');
  assert.equal((await a1.post('/api/sales', { contact_id: other, property_id: 1 })).status, 403, 'agents cannot create sales');
});

test('Scenario 2 + 3 — sale, schedule, commission, payment cascade', async () => {
  const sm = await client('salesmanager@expertdevelopers.pk');
  const fin = await client('finance@expertdevelopers.pk');
  const prop = get("SELECT id FROM properties WHERE plot_no='2D'");
  const contact = get("SELECT id FROM contacts WHERE full_name='Hamza Qureshi'");
  const preview = await sm.post('/api/sales/preview', { sale_price: 5_400_000, discount: 0, booking_amount: 400_000, num_installments: 10, first_due: addMonths(today(), 1) });
  assert.equal(preview.data.rows.reduce((s, r) => s + r.amount, 0), 5_400_000);
  const sale = await sm.post('/api/sales', { contact_id: contact.id, property_id: prop.id, sale_price: 5_400_000, discount: 0, booking_amount: 400_000, num_installments: 10, first_due: addMonths(today(), 1), agent_id: get("SELECT id FROM users WHERE email='agent1@expertdevelopers.pk'").id });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  assert.equal(get('SELECT status FROM properties WHERE id=?', prop.id).status, 'sold');
  assert.equal(get('SELECT is_customer FROM contacts WHERE id=?', contact.id).is_customer, 1);
  const cm = get('SELECT * FROM commissions WHERE sale_id=?', sale.data.id);
  assert.equal(cm.amount, 108_000, '2% of 5,400,000');
  // customer-wise installments view groups the schedule per customer
  const byCust = await fin.get('/api/installments/by-customer?limit=500');
  assert.equal(byCust.status, 200);
  const hamza = byCust.data.rows.find((r) => r.contact_id === contact.id);
  assert.ok(hamza && hamza.installments_count >= 10 && hamza.balance > 0, 'Hamza appears with his installments');
  assert.equal(new Set(byCust.data.rows.map((r) => r.contact_id)).size, byCust.data.rows.length, 'one row per customer');
  // installments list: open filter, open-first ordering, summary stats for the tiles
  const openList = await fin.get('/api/installments?status=open&limit=500');
  assert.equal(openList.status, 200);
  assert.ok(openList.data.rows.length > 0 && openList.data.rows.every((i) => i.status !== 'paid'), 'open = nothing fully paid');
  const allList = await fin.get('/api/installments?status=all&limit=500');
  const firstPaid = allList.data.rows.findIndex((i) => i.status === 'paid');
  assert.ok(firstPaid === -1 || allList.data.rows.slice(firstPaid).every((i) => i.status === 'paid'), 'paid rows sink to the bottom of All');
  assert.ok(allList.data.stats && ['overdue_count', 'overdue_amount', 'soon_count', 'soon_amount', 'collected_month'].every((k) => typeof allList.data.stats[k] === 'number'), 'summary stats present');
  const byCustOpen = await fin.get('/api/installments/by-customer?status=open&limit=500');
  assert.equal(byCustOpen.status, 200);
  // cannot sell again
  const again =await sm.post('/api/sales', { contact_id: contact.id, property_id: prop.id, sale_price: 1, booking_amount: 0, num_installments: 1, first_due: today() });
  assert.equal(again.status, 400); assert.match(again.data.error, /already sold/);
  // payment cascade
  const cashBefore = bal('1210');
  const sid = sale.data.id;
  const over = await fin.post('/api/receipts', { contact_id: contact.id, sale_id: sid, amount: 99_999_999, payment_type: 'Installment', method: 'Cash', account_id: acc('1110') });
  assert.equal(over.status, 400); assert.match(over.data.error, /exceeds (its|the) outstanding/);
  const noTxn = await fin.post('/api/receipts', { contact_id: contact.id, sale_id: sid, amount: 100_000, payment_type: 'Installment', method: 'JazzCash', account_id: acc('1230') });
  assert.equal(noTxn.status, 400); assert.match(noTxn.data.error, /Transaction ID/);
  const pay = await fin.post('/api/receipts', { contact_id: contact.id, sale_id: sid, amount: 400_000, payment_type: 'Booking Payment', method: 'Bank Transfer', bank: 'HBL', txn_id: 'T-ACC-1', account_id: acc('1210') });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));
  const pay2 = await fin.post('/api/receipts', { contact_id: contact.id, sale_id: sid, amount: 500_000, payment_type: 'Installment', method: 'Bank Transfer', bank: 'HBL', txn_id: 'T-ACC-2', account_id: acc('1210') });
  assert.equal(pay2.status, 201);
  const detail = await fin.get(`/api/sales/${sid}`);
  assert.equal(detail.data.sale.paid_amount, 900_000);
  assert.equal(detail.data.sale.outstanding, 4_500_000);
  assert.equal(detail.data.sale.installments.filter((i) => i.status === 'paid').length, 2, 'booking + first installment paid');
  assert.equal(detail.data.sale.installments.filter((i) => i.status === 'pending').length, 9);
  assert.equal(bal('1210') - cashBefore, 900_000, 'bank balance rose by payments');
  assert.equal(detail.data.ledger.balance, 4_500_000, 'customer ledger reconciles');
  // duplicate txn id refused
  assert.equal((await fin.post('/api/receipts', { contact_id: contact.id, sale_id: sid, amount: 1000, payment_type: 'Installment', method: 'Bank Transfer', bank: 'HBL', txn_id: 'T-ACC-2', account_id: acc('1210') })).status, 400);
  // overpayment accepted only when flagged
  const adv = await fin.post('/api/receipts', { contact_id: contact.id, sale_id: sid, amount: 4_600_000, payment_type: 'Full Payment', method: 'Cash', account_id: acc('1110'), overpayment: true });
  assert.equal(adv.status, 201);
  assert.equal(bal('2200'), 100_000, 'excess booked to customer advances');
  const void1 = await fin.post(`/api/receipts/${adv.data.id}/void`, { reason: 'test' });
  assert.equal(void1.status, 200);
  assert.equal(bal('2200'), 0);
  assert.equal(get('SELECT paid_amount FROM sales WHERE id=?', sid).paid_amount, 900_000);
  await test('ledger still reconciles', () => {});
  const t = get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines'); assert.equal(t.d, t.c);
});

test('Scenario 4 — project expense via vendor credit', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  const project = get("SELECT id FROM projects WHERE code='EC'").id, vendor = get("SELECT id FROM vendors WHERE name='ABC Bricks'").id;
  const before = { payable: bal('2100'), cash: bal('1210'), pf: (await fin.get(`/api/accounting/project-accounts/${project}`)).data };
  const created = await fin.post('/api/accounting/expenses', { project_id: project, vendor_id: vendor, expense_account_id: acc('5110'), description: 'Bricks', quantity: 1000, unit_cost: 250, is_credit: 1, due_date: today() });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;
  assert.equal((await fin.post(`/api/accounting/expenses/${id}/approve`)).status, 400, 'must be submitted first');
  assert.equal((await fin.post(`/api/accounting/expenses/${id}/submit`)).status, 200);
  assert.equal((await fin.post(`/api/accounting/expenses/${id}/approve`)).status, 200);
  assert.equal(bal('2100') - before.payable, 250_000, 'vendor payable up');
  const mid = (await fin.get(`/api/accounting/project-accounts/${project}`)).data;
  assert.equal(mid.expenses - before.pf.expenses, 250_000, 'project expense up');
  assert.equal(mid.gross_profit - before.pf.gross_profit, -250_000);
  assert.equal(bal('1210'), before.cash, 'cash untouched until payment');
  assert.equal((await fin.post(`/api/accounting/expenses/${id}/pay`, { account_id: acc('1210'), amount: 100_000, method: 'Bank Transfer' })).status, 200);
  assert.equal(bal('1210'), before.cash - 100_000, 'bank reduced');
  const ledger = (await fin.get(`/api/accounting/vendors-ledger/${vendor}`)).data;
  assert.equal(ledger.balance, val("SELECT COALESCE(SUM(credit-debit),0) FROM journal_lines WHERE account_id=? AND vendor_id=?", acc('2100'), vendor), 'vendor ledger matches control account');
  assert.equal(ledger.balance, val("SELECT SUM(amount-paid_amount) FROM expense_vouchers WHERE vendor_id=? AND status IN ('approved','partial')", vendor), 'vendor ledger matches vouchers');
  assert.equal((await fin.post(`/api/accounting/expenses/${id}/pay`, { account_id: acc('1210'), amount: 999_999_999 })).status, 400, 'cannot overpay a voucher');
  // insufficient cash is refused
  const huge = await fin.post('/api/accounting/transfers', { from_account_id: acc('1120'), to_account_id: acc('1110'), amount: 99_999_999 });
  assert.equal(huge.status, 400); assert.match(huge.data.error, /Insufficient funds/);
});

test('Scenario 5 — customer portal sees only own data', async () => {
  const cust = await client('m.ali@example.com', 'Demo@12345', true);
  const dash = await cust.get('/api/portal/dashboard');
  assert.equal(dash.status, 200);
  assert.equal(dash.data.properties.length, 1);
  assert.ok(dash.data.totals.paid > 0 && dash.data.totals.outstanding > 0);
  const sale = dash.data.properties[0].sale_id;
  const det = await cust.get(`/api/portal/properties/${sale}`);
  assert.equal(det.status, 200);
  assert.ok(det.data.receipts.length >= 5);
  assert.equal(det.data.sale.agent_id, undefined, 'no agent info in the portal payload');
  assert.equal(JSON.stringify(det.data).includes('commission'), false);
  const dev = await cust.get('/api/portal/development');
  assert.ok(dev.data[0].items.length >= 5 && dev.data[0].updates.length >= 1);
  // other customer's sale is invisible
  const others = get("SELECT id FROM sales WHERE contact_id<>? LIMIT 1", dash.data.customer.id);
  assert.equal((await cust.get(`/api/portal/properties/${others.id}`)).status, 404);
  // customers have no ERP access
  for (const u of ['/api/contacts', '/api/accounting/accounts', '/api/receipts', '/api/properties', '/api/dashboard', '/api/settings/users']) {
    assert.ok([401, 403].includes((await cust.get(u)).status), `${u} must be blocked`);
  }
  // staff cannot use portal login and vice-versa
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'finance@expertdevelopers.pk', password: 'Demo@12345', portal: true }) });
  assert.equal(bad.status, 403);
});

test('Scenario 6 — website publishing and API', async () => {
  const admin = await client('admin.demo@expertdevelopers.pk');
  const key = val("SELECT value FROM settings WHERE key='website_api_key'");
  const api = (u, opt = {}) => fetch(base + u, { headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, ...opt }).then(async (r) => ({ status: r.status, data: await r.json() }));
  const created = await admin.post('/api/properties', { title: 'Plot 9Z — Test', property_type: 'Plots', project_id: 1, block: 'Z', plot_no: '9Z', area_size: 5, unit: 'Marla', total_price: 4_000_000, discount: 0, city: 'Faisalabad' });
  assert.equal(created.status, 201);
  const pid = created.data.id;
  assert.equal(created.data.status, 'draft'); assert.equal(created.data.website_state, 'hidden');
  assert.equal((await admin.post('/api/properties', { title: 'Dup', project_id: 1, block: 'Z', plot_no: '9Z', total_price: 1 })).status, 400, 'duplicate plot rejected');
  assert.equal((await api(`/api/public/property/${pid}`)).status, 404, 'draft hidden from website');
  assert.equal((await admin.post(`/api/properties/${pid}/feature`)).status, 400, 'cannot feature unpublished');
  const pub = await admin.post(`/api/properties/${pid}/publish`);
  assert.equal(pub.data.website_state, 'published');
  assert.equal((await api(`/api/public/property/${pid}`)).data.status, 'published');
  assert.ok(!(await api('/api/public/properties/featured')).data.data.some((p) => p.id === pid));
  const feat = await admin.post(`/api/properties/${pid}/feature`);
  assert.equal(feat.data.website_state, 'featured');
  assert.ok((await api('/api/public/properties/featured')).data.data.some((p) => p.id === pid));
  await admin.post(`/api/properties/${pid}/unfeature`);
  assert.ok(!(await api('/api/public/properties/featured')).data.data.some((p) => p.id === pid));
  // api key required
  assert.equal((await fetch(base + '/api/public/properties')).status, 401);
  // inquiry -> lead -> agent -> manager
  const inq = await api('/api/public/inquiry', { method: 'POST', body: JSON.stringify({ name: 'Web Visitor', phone: '+92 300 5550000', message: 'Interested', property_id: pid }) });
  assert.equal(inq.status, 201);
  const c = get("SELECT * FROM contacts WHERE phone='+92 300 5550000'");
  assert.equal(c.lead_source, 'Website'); assert.ok(c.agent_id); assert.ok(c.manager_id);
  assert.ok(val('SELECT COUNT(*) FROM notifications WHERE user_id=? AND type=?', c.agent_id, 'lead') >= 1);
  assert.equal((await api('/api/public/lead', { method: 'POST', body: JSON.stringify({ name: '' }) })).status, 400);
});

test('RBAC: roles gate modules; CSRF header enforced; audit log written', async () => {
  const hr = await client('hr@expertdevelopers.pk');
  assert.equal((await hr.get('/api/hrm/employees')).status, 200);
  assert.equal((await hr.get('/api/accounting/accounts')).status, 403);
  assert.equal((await hr.get('/api/contacts')).status, 403);
  const fin = await client('finance@expertdevelopers.pk');
  assert.equal((await fin.get('/api/settings/users')).status, 403);
  const r = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie: 'erp_token=x' } });
  assert.ok([401, 403].includes(r.status));
  const sup = await client('admin@expertdevelopers.pk');
  const audit = await sup.get('/api/audit?q=Receipt');
  assert.ok(audit.data.rows.length > 0, 'receipt vouchers are audited');
  const dash = await sup.get('/api/dashboard?range=this_year');
  assert.ok(dash.data.finance.collected > 0 && dash.data.crm.total_leads > 0);
});

test('reminders: overdue installments, follow-ups and vendor dues notify the right people (idempotent per day)', async () => {
  const { runReminders } = await import('../src/services/reminders.js');
  const before = val('SELECT COUNT(*) FROM notifications');
  const r = runReminders(true);
  assert.ok(r.sent > 0, 'something is due in the seed data');
  assert.ok(val('SELECT COUNT(*) FROM notifications') > before);
  assert.ok(val("SELECT COUNT(*) FROM notifications WHERE type='followup'") >= 1, 'follow-up due today reminder');
  assert.equal(runReminders().skipped, true, 'second run on the same day is skipped');
});

test('data integrity: cancel sale is blocked while receipts exist; void restores balances', async () => {
  const sm = await client('admin@expertdevelopers.pk');
  const mgr = await client('salesmanager@expertdevelopers.pk');
  assert.equal((await mgr.post('/api/sales/3/cancel', { reason: 'x' })).status, 403, 'sales manager lacks sales:delete');
  const fin = await client('finance@expertdevelopers.pk');
  const s = get("SELECT * FROM sales WHERE sale_no='SL-00003'"); // Bilal Ahmed, shop 12
  const blocked = await sm.post(`/api/sales/${s.id}/cancel`, { reason: 'test' });
  assert.equal(blocked.status, 400); assert.match(blocked.data.error, /valid receipts/);
  const rc = get("SELECT id FROM receipts WHERE sale_id=? AND status='valid'", s.id);
  const beforeAR = bal('1300'), beforeCash = bal('1220');
  assert.equal((await fin.post(`/api/receipts/${rc.id}/void`, { reason: 'bounced cheque' })).status, 200);
  assert.equal(bal('1300') - beforeAR, 3_000_000, 'receivable restored');
  assert.equal(beforeCash - bal('1220'), 3_000_000, 'bank reduced');
  assert.equal(get('SELECT paid_amount FROM sales WHERE id=?', s.id).paid_amount, 0);
  assert.equal((await fin.post(`/api/receipts/${rc.id}/void`, { reason: 'again' })).status, 400, 'cannot void twice');
  const ok = await sm.post(`/api/sales/${s.id}/cancel`, { reason: 'customer withdrew' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(get('SELECT status FROM properties WHERE id=?', s.property_id).status, 'available');
  assert.equal(get("SELECT status FROM commissions WHERE sale_id=?", s.id).status, 'cancelled');
  const t = get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines'); assert.equal(t.d, t.c);
  assert.equal(bal('1300'), val("SELECT COALESCE(SUM(net_price-paid_amount),0) FROM sales WHERE status='confirmed'"), 'AR still reconciles');
});


test('bundle: plot + house construction paid with one combined receipt, split per sale', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  const sm = await client('salesmanager@expertdevelopers.pk');
  const zainab = get("SELECT id FROM contacts WHERE full_name='Zainab Malik'").id;
  const sales = all("SELECT * FROM sales WHERE contact_id=? ORDER BY id", zainab);
  assert.equal(sales.length, 2); assert.equal(sales[0].kind, 'property'); assert.equal(sales[1].kind, 'construction');
  assert.equal(sales[0].bundle_id, sales[1].bundle_id); assert.ok(sales[0].bundle_id);
  assert.equal(sales[1].property_id, sales[0].property_id, 'house is linked to the plot without re-entering it');
  assert.equal(sales[1].num_installments, 36, 'installment cadence inherited from the plot sale');
  const firstInst = (id) => val("SELECT MIN(due_date) FROM installments WHERE sale_id=? AND kind='installment'", id);
  assert.equal(firstInst(sales[1].id), firstInst(sales[0].id), 'same monthly due dates');
  assert.equal(sales[0].paid_amount, 300_000 + 50_000, 'booking + 2 x 25,000');
  assert.equal(sales[1].paid_amount, 50_000);
  const detail = await fin.get(`/api/sales/${sales[1].id}`);
  assert.equal(detail.data.sale.bundle.monthly_total, 50_000, '25k plot + 25k construction');
  assert.equal(detail.data.sale.bundle.schedule.find((m) => m.parts.length === 2).amount, 50_000);
  assert.equal(detail.data.bundle_ledger.balance, detail.data.sale.bundle.outstanding, 'combined ledger reconciles');
  // construction commission uses the construction rule (1.5%)
  assert.equal(get('SELECT amount FROM commissions WHERE sale_id=?', sales[1].id).amount, 13_500);
  assert.equal(get('SELECT amount FROM commissions WHERE sale_id=?', sales[0].id).amount, 24_000, 'plot keeps the 2% rule');
  // construction income goes to its own account
  assert.equal(bal('4150'), 900_000);
  // validation: split must not exceed any part's balance
  const over = await fin.post('/api/receipts', { contact_id: zainab, splits: [{ sale_id: sales[0].id, amount: 5_000_000 }, { sale_id: sales[1].id, amount: 10_000 }], payment_type: 'Installment', method: 'Cash', account_id: acc('1110') });
  assert.equal(over.status, 400); assert.match(over.data.error, /exceeds/);
  const before = { ar: bal('1300'), cash: bal('1110') };
  const rc = await fin.post('/api/receipts', { contact_id: zainab, splits: [{ sale_id: sales[0].id, amount: 25_000 }, { sale_id: sales[1].id, amount: 25_000 }], payment_type: 'Installment', method: 'Cash', account_id: acc('1110') });
  assert.equal(rc.status, 201, JSON.stringify(rc.data));
  assert.equal(rc.data.amount, 50_000);
  assert.equal(bal('1110') - before.cash, 50_000); assert.equal(before.ar - bal('1300'), 50_000);
  assert.equal(get('SELECT paid_amount FROM sales WHERE id=?', sales[0].id).paid_amount, 375_000);
  assert.equal(get('SELECT paid_amount FROM sales WHERE id=?', sales[1].id).paid_amount, 75_000);
  const view = await fin.get(`/api/receipts/${rc.data.id}`);
  assert.equal(view.data.parts.length, 2);
  // each sale's own ledger shows only its share
  const l = (await fin.get(`/api/sales/${sales[1].id}`)).data.ledger;
  assert.equal(l.balance, 900_000 - 75_000);
  // void restores both sales
  assert.equal((await fin.post(`/api/receipts/${rc.data.id}/void`, { reason: 'test' })).status, 200);
  assert.equal(get('SELECT paid_amount FROM sales WHERE id=?', sales[0].id).paid_amount, 350_000);
  assert.equal(get('SELECT paid_amount FROM sales WHERE id=?', sales[1].id).paid_amount, 50_000);
  assert.equal(bal('1300'), val("SELECT COALESCE(SUM(net_price-paid_amount),0) FROM sales WHERE status='confirmed'"));
  const t = get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines'); assert.equal(t.d, t.c);
});

test('construction contract for an existing customer links to their plot sale and takes contract costs', async () => {
  const sm = await client('salesmanager@expertdevelopers.pk');
  const fin = await client('finance@expertdevelopers.pk');
  const ali = get("SELECT id FROM contacts WHERE full_name='Muhammad Ali'").id;
  const plotSale = get("SELECT * FROM sales WHERE contact_id=? AND kind='property'", ali);
  const eh = get("SELECT id FROM projects WHERE code='EH'").id;
  const bad1 = await sm.post('/api/sales', { kind: 'construction', contact_id: ali, project_id: eh, sale_price: 5_000_000, num_installments: 10, first_due: today() });
  assert.equal(bad1.status, 400); assert.match(bad1.data.error, /title/i);
  const made = await sm.post('/api/sales', { kind: 'construction', title: 'House on Plot 2B', contact_id: ali, project_id: eh, property_id: plotSale.property_id, linked_sale_id: plotSale.id, sale_price: 5_000_000, discount: 0, booking_amount: 500_000, num_installments: 18, first_due: addMonths(today(), 1), agent_id: plotSale.agent_id });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(get('SELECT status FROM properties WHERE id=?', plotSale.property_id).status, 'sold', 'linking does not touch the plot');
  const now = get('SELECT * FROM sales WHERE id=?', made.data.id);
  assert.equal(now.bundle_id, get('SELECT bundle_id FROM sales WHERE id=?', plotSale.id).bundle_id); assert.ok(now.bundle_id);
  // contract cost: expense tagged to the contract hits the project and the contract
  const proj = (await fin.get(`/api/accounting/project-accounts/${eh}`)).data;
  const ev = await fin.post('/api/accounting/expenses', { sale_id: made.data.id, expense_account_id: acc('5110'), description: 'Bricks for Ali house', amount: 120_000, paid_from_account_id: acc('1210'), payment_method: 'Bank Transfer', pay_now: true });
  assert.equal(ev.status, 201, JSON.stringify(ev.data));
  assert.equal(get('SELECT project_id FROM expense_vouchers WHERE id=?', ev.data.id).project_id, eh, 'project inferred from the contract');
  const after = (await fin.get(`/api/accounting/project-accounts/${eh}`)).data;
  assert.equal(after.expenses - proj.expenses, 120_000);
  const det = (await fin.get(`/api/sales/${made.data.id}`)).data;
  assert.equal(det.cost_total, 120_000);
  // agent ledger: accrual + payments, running balance
  const agent = await client('agent1@expertdevelopers.pk');
  const led = await agent.get(`/api/agents/${agent.me.id}/ledger`);
  assert.equal(led.status, 200); assert.ok(led.data.entries.length >= 2);
  assert.equal(led.data.entries.at(-1).balance, led.data.balance);
  const other = await client('agent3@expertdevelopers.pk');
  assert.equal((await other.get(`/api/agents/${agent.me.id}/ledger`)).status, 403);
});

test('schedule: completion is calculated from dates, delays and forecast propagate', async () => {
  const { computeSchedule, OVERDUE_CAP } = await import('../src/services/schedule.js');
  const base = { project_id: 1, sale_id: null, parent_id: null, weight: 1, client_visible: 1, actual_start: null, actual_end: null, predecessor_id: null, progress: 0 };
  // a 10-day activity: day 5 of 10 => 50% automatically, whatever number is stored
  const half = computeSchedule([{ ...base, id: 1, name: 'Footing', planned_start: '2026-02-01', planned_end: '2026-02-10', progress: 77 }], '2026-02-05');
  assert.equal(half.tasks[0].progress, 50, 'percentage is derived from the dates, not typed');
  assert.equal(half.tasks[0].status, 'on_track'); assert.equal(half.summary.actual_pct, 50); assert.equal(half.summary.planned_pct, 50);
  // before start = 0, past due without completion is held at the cap and flagged delayed
  assert.equal(computeSchedule([{ ...base, id: 1, name: 'A', planned_start: '2026-03-01', planned_end: '2026-03-10' }], '2026-02-20').tasks[0].progress, 0);
  const late = computeSchedule([{ ...base, id: 1, name: 'Slab', planned_start: '2026-02-01', planned_end: '2026-02-10' }], '2026-02-15');
  assert.equal(late.tasks[0].progress, OVERDUE_CAP); assert.equal(late.tasks[0].status, 'delayed'); assert.equal(late.tasks[0].delay_days, 5);
  assert.ok(late.warnings.some((w) => w.type === 'overdue'));
  // completing (even early) = 100, and a late predecessor pushes the successor's forecast out
  const early = computeSchedule([{ ...base, id: 1, name: 'A', planned_start: '2026-02-01', planned_end: '2026-02-10', actual_end: '2026-02-06' }], '2026-02-07');
  assert.equal(early.tasks[0].progress, 100); assert.equal(early.tasks[0].status, 'completed');
  const chain = computeSchedule([
    { ...base, id: 1, name: 'Footing', planned_start: '2026-01-01', planned_end: '2026-01-10' },
    { ...base, id: 2, name: 'Slab', planned_start: '2026-01-11', planned_end: '2026-01-20', predecessor_id: 1 },
  ], '2026-01-15');
  assert.equal(chain.tasks[0].status, 'delayed');
  assert.ok(chain.tasks[1].forecast_delay_days > 0, 'successor slips because its predecessor is late');
  assert.ok(chain.summary.projected_delay_days > 0); assert.notEqual(chain.summary.health, 'on_track');
  // overall % is the duration-weighted average: a 90-day task dominates a 10-day task
  const w = computeSchedule([
    { ...base, id: 1, name: 'Long', planned_start: '2026-01-01', planned_end: '2026-03-31' },
    { ...base, id: 2, name: 'Short', planned_start: '2026-01-01', planned_end: '2026-01-10', actual_end: '2026-01-10' },
  ], '2026-02-14');
  assert.ok(w.summary.actual_pct > 50 && w.summary.actual_pct < 100);
});

test('schedule API + portal: managers edit tasks; customers see only their own schedule with delays', async () => {
  const pm = await client('pm@expertdevelopers.pk');
  const eh = get("SELECT id FROM projects WHERE code='EH'").id, er = get("SELECT id FROM projects WHERE code='ER'").id;
  const zainabContract = get("SELECT s.id FROM sales s JOIN contacts c ON c.id=s.contact_id WHERE c.full_name='Zainab Malik' AND s.kind='construction'").id;
  const sch = await pm.get(`/api/projects/${eh}/schedule`, { scope: zainabContract });
  assert.equal(sch.status, 200);
  const res = (await pm.get(`/api/projects/${eh}/schedule?scope=${zainabContract}`)).data;
  assert.ok(res.tasks.length >= 5); assert.ok(res.warnings.length >= 1, 'seeded schedule has a delay');
  assert.ok(['delayed', 'at_risk'].includes(res.summary.health));
  // validation
  const bad = await pm.post(`/api/projects/${er}/tasks`, { name: 'Bad', planned_start: '2026-05-10', planned_end: '2026-05-01' });
  assert.equal(bad.status, 400);
  const created = await pm.post(`/api/projects/${er}/tasks`, { name: 'Lighting poles', planned_start: today(), planned_end: addMonths(today(), 1), weight: 1 });
  assert.equal(created.status, 201);
  assert.equal((await pm.put(`/api/project-tasks/${created.data.id}`, { progress: 80 })).status, 200);
  assert.equal(get('SELECT progress FROM project_tasks WHERE id=?', created.data.id).progress, 0, 'a typed percentage is ignored');
  const done = await pm.post(`/api/project-tasks/${created.data.id}/complete`, {});
  assert.equal(done.status, 200);
  const row = get('SELECT * FROM project_tasks WHERE id=?', created.data.id);
  assert.equal(row.actual_end, today(), 'completion date is stamped'); assert.equal(row.progress, 100);
  assert.equal((await pm.post(`/api/project-tasks/${created.data.id}/reopen`)).status, 200);
  assert.equal(get('SELECT actual_end FROM project_tasks WHERE id=?', created.data.id).actual_end, null);
  // portal: Zainab sees her contract schedule and the project schedule
  const zc = await client('zainab.m@example.com', 'Demo@12345', true);
  const dev = (await zc.get('/api/portal/development')).data;
  const home = dev.find((p) => p.contracts.length);
  assert.ok(home, 'construction contract schedule is shared with its customer');
  assert.ok(home.contracts[0].schedule.warnings.length >= 1);
  assert.ok(home.contracts[0].schedule.summary.actual_pct >= 0 && home.contracts[0].schedule.summary.actual_pct <= 100);
  const erProj = dev.find((p) => p.id === er);
  assert.ok(erProj.schedule.tasks.length >= 7);
  // Ali has no contract here so he must not see Zainab's schedule
  const ali = await client('m.ali@example.com', 'Demo@12345', true);
  const aliDev = (await ali.get('/api/portal/development')).data;
  assert.ok(aliDev.every((p) => p.contracts.every((c) => c.sale_id !== zainabContract)));
  const zdash = (await zc.get('/api/portal/dashboard')).data;
  assert.equal(zdash.properties.length, 2); assert.equal(zdash.bundles.length, 1); assert.equal(zdash.bundles[0].monthly_total, 50_000);
  const house = zdash.properties.find((p) => p.kind === 'construction');
  assert.ok(house.schedule, 'schedule progress shown on the portal card');
  const detail = (await zc.get(`/api/portal/properties/${house.sale_id}`)).data;
  assert.ok(detail.bundle.schedule.length >= 30); assert.ok(detail.bundle_ledger.entries.length > 2); assert.ok(detail.schedule.tasks.length);
  assert.equal((await ali.get(`/api/portal/properties/${house.sale_id}`)).status, 404);
  // delayed tasks trigger one-off notifications to the PM and the customer
  const { runReminders } = await import('../src/services/reminders.js');
  runReminders(true);
  assert.ok(val("SELECT COUNT(*) FROM notifications WHERE type='development' AND title='Project schedule update'") >= 1);
});

test('branding: logo, header/footer, contact and social handles are editable and exposed to documents', async () => {
  const admin = await client('admin@expertdevelopers.pk');
  const fin = await client('finance@expertdevelopers.pk');
  assert.equal((await fin.put('/api/settings/system', { print_footer: 'hacked' })).status, 403);
  const save = await admin.put('/api/settings/system', { print_header: 'Expert Test Header', receipt_footer: 'Custom receipt footer', expense_footer: 'Custom expense footer', print_phone: '+92 300 1234567', print_email: 'accounts@example.com', print_social: JSON.stringify([{ platform: 'Facebook', handle: '@expert' }]) });
  assert.equal(save.status, 200);
  assert.equal((await admin.put('/api/settings/system', { print_social: '{"not":"a list"}' })).status, 400);
  const meta = (await fin.get('/api/settings/meta')).data;
  assert.equal(meta.settings.receipt_footer, 'Custom receipt footer'); assert.equal(meta.settings.print_phone, '+92 300 1234567');
  // logo upload: images only
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData(); form.append('logo', new Blob([png], { type: 'image/png' }), 'logo.png');
  const cookie = (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify({ identifier: 'admin@expertdevelopers.pk', password: 'Demo@12345' }) })).headers.get('set-cookie').split(';')[0];
  const up = await fetch(base + '/api/settings/branding/logo', { method: 'POST', headers: { cookie, 'X-Requested-With': 'ERP' }, body: form });
  assert.equal(up.status, 200);
  const { print_logo } = await up.json();
  assert.match(print_logo, /^media\/[0-9a-f]+\.png$/);
  assert.equal((await fetch(`${base}/uploads/${print_logo}`)).status, 200, 'logo is publicly servable for printed documents');
  const bad = new FormData(); bad.append('logo', new Blob(['<script>'], { type: 'text/html' }), 'x.html');
  assert.equal((await fetch(base + '/api/settings/branding/logo', { method: 'POST', headers: { cookie, 'X-Requested-With': 'ERP' }, body: bad })).status, 400);
});
