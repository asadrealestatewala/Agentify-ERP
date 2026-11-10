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


test('built-in accounts can be renamed, re-opened and deleted (except engine accounts)', async () => {
  const adm = await client('admin@expertdevelopers.pk');
  const id = (code) => val('SELECT id FROM accounts WHERE code=?', code);
  const before = get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines');
  assert.equal(before.d, before.c);
  const main = id('1210');
  let r = await adm.put(`/api/accounting/accounts/${main}`, { name: 'HBL Current', opening_balance: 12_345_000 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(val('SELECT name FROM accounts WHERE id=?', main), 'HBL Current');
  const list = (await adm.get('/api/accounting/accounts')).data;
  assert.equal(list.find((a) => a.id === main).opening_now, 12_345_000);
  assert.equal(list.find((a) => a.id === main).protected, true);
  const after = get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines');
  assert.equal(after.d, after.c, 'books stay balanced');
  // engine accounts cannot be deleted or deactivated
  assert.equal((await adm.del(`/api/accounting/accounts/${main}`)).status, 400);
  assert.equal((await adm.put(`/api/accounting/accounts/${main}`, { active: false })).status, 400);
  // an unused built-in account (Online Payment Account) can be deleted
  const online = id('1230');
  r = await adm.del(`/api/accounting/accounts/${online}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!id('1230'));
  const end = get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines');
  assert.equal(end.d, end.c);
});
