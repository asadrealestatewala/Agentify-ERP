import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-valid-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { isEmail, isPersonName } = await import('../src/validation.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function login() {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
    return { status: r.status, data };
  };
  const l = await call('POST', '/api/auth/login', { identifier: 'admin@expertdevelopers.pk', password: 'Demo@12345' });
  assert.equal(l.status, 200);
  return call;
}

test('name rule: letters, spaces and . \' - only', () => {
  for (const ok of ['Ali Khan', 'Mary-Jane O\'Neil', 'Dr. Ayesha B. Zaman', 'José Núñez', 'محمد علی']) assert.ok(isPersonName(ok), ok);
  for (const no of ['Ali123', '12345', 'Ali@Khan', '---', '', 'A'.repeat(101)]) assert.ok(!isPersonName(no), no);
});

test('email rule', () => {
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.com']) assert.ok(isEmail(ok), ok);
  for (const no of ['abc', 'a@b', 'a@b.', '@b.com', 'a b@c.com', 'a@@b.com', 'a@b..com', 'a@b.c1']) assert.ok(!isEmail(no), no);
});

test('saving a contact refuses digits in the name and a bad email', async () => {
  const call = await login();
  const base = { phone: '03001234567' };
  const n = await call('POST', '/api/contacts', { ...base, full_name: 'Ali 123' });
  assert.equal(n.status, 400);
  assert.match(n.data.error, /letters only/);
  const e = await call('POST', '/api/contacts', { ...base, full_name: 'Ali Khan', email: 'not-an-email' });
  assert.equal(e.status, 400);
  assert.match(e.data.error, /valid email/);
  const ok = await call('POST', '/api/contacts', { ...base, full_name: 'Ali Khan', email: 'ali.khan@example.com' });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

test('team invite and employee name follow the same rules', async () => {
  const call = await login();
  assert.equal((await call('POST', '/api/settings/invites', { email: 'x@y', role_id: 1 })).status, 400);
  assert.equal((await call('POST', '/api/settings/invites', { email: 'new.person@example.com', name: 'Bob 99', role_id: 1 })).status, 400);
  assert.equal((await call('POST', '/api/hrm/employees', { name: 'Emp 7' })).status, 400);
});
