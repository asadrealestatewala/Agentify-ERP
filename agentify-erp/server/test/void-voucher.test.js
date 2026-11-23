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
const { get, val } = await import('../src/db.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, password = 'Demo@12345') {
  const jar = {};
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const l = await call('POST', '/api/auth/login', { identifier, password });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), me: l.data };
}

test('only the Super Admin can void a paid expense voucher, and the books are reversed', async () => {
  const sa = await client('admin@expertdevelopers.pk');
  const role = sa.me.user?.role ?? sa.me.role;
  const exp = val("SELECT id FROM accounts WHERE type='expense' ORDER BY code LIMIT 1");
  const bank = val("SELECT id FROM accounts WHERE code='1210'") || val("SELECT id FROM accounts WHERE code LIKE '12%' LIMIT 1");
  const totals = () => get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines');
  const cashBefore = get('SELECT SUM(debit)-SUM(credit) b FROM journal_lines WHERE account_id=?', bank).b || 0;
  const c = await sa.post('/api/accounting/expenses', { expense_account_id: exp, amount: 1000, description: 'void test', date: '2026-01-05', pay_now: true, paid_from_account_id: bank, payment_method: 'Cash' });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const id = c.data.id, no = get('SELECT voucher_no FROM expense_vouchers WHERE id=?', id).voucher_no;
  assert.equal(get('SELECT status FROM expense_vouchers WHERE id=?', id).status, 'paid');
  assert.equal(role, 'Super Admin');
  assert.equal((await sa.post(`/api/accounting/expenses/${id}/void`, { reason: '', confirm_no: no })).status, 400);
  assert.equal((await sa.post(`/api/accounting/expenses/${id}/void`, { reason: 'duplicate', confirm_no: 'WRONG' })).status, 400);
  const ok = await sa.post(`/api/accounting/expenses/${id}/void`, { reason: 'duplicate', confirm_no: no });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const v = get('SELECT * FROM expense_vouchers WHERE id=?', id);
  assert.equal(v.status, 'void'); assert.equal(v.void_reason, 'duplicate');
  assert.equal(get('SELECT voided FROM vendor_payments WHERE voucher_id=?', id).voided, 1);
  const t = totals(); assert.equal(t.d, t.c);
  assert.equal(get('SELECT SUM(debit)-SUM(credit) b FROM journal_lines WHERE account_id=?', bank).b || 0, cashBefore);
  assert.equal((await sa.post(`/api/accounting/expenses/${id}/void`, { reason: 'x', confirm_no: no })).status, 400);
});

test('a non Super Admin is refused', async () => {
  const fm = await client('salesmanager@expertdevelopers.pk');
  const r = await fm.post('/api/accounting/expenses/1/void', { reason: 'x', confirm_no: 'x' });
  assert.ok([400, 403].includes(r.status));
});
