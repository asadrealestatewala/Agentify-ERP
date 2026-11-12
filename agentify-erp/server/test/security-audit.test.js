// Fixes from the November 2026 audit: internal-address checks, sign-in lockout, 2FA code limits, sign-out ending the
// session, password rules and own-records scoping of receipts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-secaudit-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_DEMO = '0';
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { createTenant, withTenant } = await import('../src/platform.js');
const { get, run } = await import('../src/db.js');
const { assertPublicHttps } = await import('../src/services/integrations.js');
const { isPrivateAddress } = await import('../src/services/netGuard.js');
const { passwordProblem } = await import('../src/validation.js');
const { LOCK_LIMIT } = await import('../src/routes/auth.js');

let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, p, body, cookie) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : '';
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', 'Content-Length': Buffer.byteLength(data), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
    let buf = ''; res.on('data', (c) => { buf += c; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* not json */ } resolve({ status: res.statusCode, data: json, cookie: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('erp_token=')) }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

test('internal addresses written in IPv6 form are refused, public ones pass', async () => {
  for (const u of ['https://[::ffff:169.254.169.254]/', 'https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/', 'https://[::]/', 'https://[::1]/', 'https://[fd00::1]/', 'https://[fe80::1]/', 'https://100.64.0.1/', 'https://192.0.0.8/', 'https://198.18.0.1/']) {
    await assert.rejects(assertPublicHttps(u), /Internal network/, u);
  }
  assert.equal(await assertPublicHttps('https://93.184.216.34/hook'), 'https://93.184.216.34/hook');
  assert.equal(await assertPublicHttps('https://[2606:4700::1111]/'), 'https://[2606:4700::1111]/');
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  for (const ip of ['10.0.0.1', '172.31.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '::ffff:8.8.8.8', '64:ff9b::a00:1', 'not-an-ip']) assert.equal(isPrivateAddress(ip), true, ip);
});

test('password rules: length, common passwords and the e-mail are refused', () => {
  assert.match(passwordProblem('short'), /at least 8/);
  assert.match(passwordProblem('Password123'), /too easy/);
  assert.match(passwordProblem('12345678'), /too easy/);
  assert.match(passwordProblem('aaaaaaaa'), /too easy/);
  assert.match(passwordProblem('owner@acme.pk', { email: 'owner@acme.pk' }), /e-mail/);
  assert.equal(passwordProblem('Tenant@12345'), null);
});

test('an account locks after repeated wrong passwords, even for the right one, and a good sign-in clears the count', async () => {
  const t = createTenant({ slug: 'lockco', name: 'Lock Co', adminName: 'Owner', adminEmail: 'owner@lock.test', adminPassword: 'Secret@12345' });
  const host = 'lockco.erp.test';
  for (let i = 0; i < 3; i++) assert.equal((await call(host, 'POST', '/api/auth/login', { identifier: 'owner@lock.test', password: 'nope-nope' })).status, 401);
  assert.equal((await call(host, 'POST', '/api/auth/login', { identifier: 'owner@lock.test', password: 'Secret@12345' })).status, 200);
  assert.equal(withTenant(t, () => get("SELECT COUNT(*) n FROM login_failures WHERE alerted=0").n), 0, 'a good sign-in clears the count');
  for (let i = 0; i < LOCK_LIMIT; i++) await call(host, 'POST', '/api/auth/login', { identifier: 'owner@lock.test', password: 'nope-nope' });
  const locked = await call(host, 'POST', '/api/auth/login', { identifier: 'owner@lock.test', password: 'Secret@12345' });
  assert.equal(locked.status, 429); assert.equal(locked.data.code, 'account_locked');
  // an unknown e-mail gets the usual answer, never the lock message
  assert.equal((await call(host, 'POST', '/api/auth/login', { identifier: 'nobody@lock.test', password: 'whatever12345' })).status, 401);
  withTenant(t, () => run("UPDATE login_failures SET created_at=datetime('now','-20 minutes')"));
  assert.equal((await call(host, 'POST', '/api/auth/login', { identifier: 'owner@lock.test', password: 'Secret@12345' })).status, 200, 'the lock ends by itself');
});

test('a 2FA step token is spent after 5 wrong codes and cannot be reused after a good sign-in', async () => {
  const t = createTenant({ slug: 'mfaco', name: 'MFA Co', adminName: 'Owner', adminEmail: 'owner@mfa.test', adminPassword: 'Secret@12345' });
  const { encrypt } = await import('../src/services/platformConfig.js');
  const { newSecret } = await import('../src/services/totp.js');
  withTenant(t, () => run('UPDATE users SET totp_enabled=1, totp_secret=?, recovery_codes=? WHERE email=?', encrypt(newSecret()), JSON.stringify([bcrypt.hashSync('RECOVERY-1', 4)]), 'owner@mfa.test'));
  const host = 'mfaco.erp.test';
  const step = await call(host, 'POST', '/api/auth/login', { identifier: 'owner@mfa.test', password: 'Secret@12345' });
  assert.equal(step.data.mfa_required, true);
  for (let i = 0; i < 5; i++) assert.equal((await call(host, 'POST', '/api/auth/login/mfa', { mfa_token: step.data.mfa_token, code: '000000' })).status, 401);
  const spent = await call(host, 'POST', '/api/auth/login/mfa', { mfa_token: step.data.mfa_token, code: '000000' });
  assert.equal(spent.status, 401); assert.match(spent.data.error, /expired/);
  assert.ok(withTenant(t, () => get('SELECT COUNT(*) n FROM login_failures').n) >= 5, 'wrong codes count toward the account lock');
});

test('signing out ends that session; the token no longer works', async () => {
  createTenant({ slug: 'outco', name: 'Out Co', adminName: 'Owner', adminEmail: 'owner@out.test', adminPassword: 'Secret@12345' });
  const host = 'outco.erp.test';
  const login = await call(host, 'POST', '/api/auth/login', { identifier: 'owner@out.test', password: 'Secret@12345' });
  const other = await call(host, 'POST', '/api/auth/login', { identifier: 'owner@out.test', password: 'Secret@12345' });
  assert.equal((await call(host, 'GET', '/api/auth/me', null, login.cookie)).status, 200);
  assert.equal((await call(host, 'POST', '/api/auth/logout', {}, login.cookie)).status, 200);
  assert.equal((await call(host, 'GET', '/api/auth/me', null, login.cookie)).status, 401, 'the signed-out token is refused');
  assert.equal((await call(host, 'GET', '/api/auth/me', null, other.cookie)).status, 200, 'other devices stay signed in');
  const weak = await call(host, 'POST', '/api/auth/change-password', { current: 'Secret@12345', next: 'password123' }, other.cookie);
  assert.equal(weak.status, 400); assert.match(weak.data.error, /too easy/);
});

test('own-records roles only see receipts of their own customers or sales', async () => {
  const t = createTenant({ slug: 'rcco', name: 'Receipt Co', adminName: 'Owner', adminEmail: 'owner@rc.test', adminPassword: 'Secret@12345' });
  const ids = withTenant(t, () => {
    const role = Number(run("INSERT INTO roles(name,description,own_scope) VALUES('Field Cashier','test',1)").lastInsertRowid);
    run("INSERT INTO role_permissions(role_id,module,action) VALUES(?,'payments','view')", role);
    const at = new Date().toISOString();
    const me = Number(run('INSERT INTO users(name,email,password_hash,role_id,created_at) VALUES(?,?,?,?,?)', 'Agent One', 'agent@rc.test', bcrypt.hashSync('Agent@12345', 4), role, at).lastInsertRowid);
    const acct = get('SELECT id FROM accounts ORDER BY id LIMIT 1').id;
    const mine = Number(run('INSERT INTO contacts(full_name,agent_id,created_at) VALUES(?,?,?)', 'My Customer', me, at).lastInsertRowid);
    const theirs = Number(run('INSERT INTO contacts(full_name,agent_id,created_at) VALUES(?,?,?)', 'Other Customer', null, at).lastInsertRowid);
    const rc = (no, c) => Number(run("INSERT INTO receipts(receipt_no,date,contact_id,account_id,payment_type,amount,method,created_at) VALUES(?,?,?,?,'Installment',1000,'Cash',?)", no, at.slice(0, 10), c, acct, at).lastInsertRowid);
    return { mine: rc('RC-T1', mine), theirs: rc('RC-T2', theirs) };
  });
  const host = 'rcco.erp.test';
  const login = await call(host, 'POST', '/api/auth/login', { identifier: 'agent@rc.test', password: 'Agent@12345' });
  assert.equal(login.status, 200);
  assert.equal((await call(host, 'GET', `/api/receipts/${ids.mine}`, null, login.cookie)).status, 200);
  assert.equal((await call(host, 'GET', `/api/receipts/${ids.theirs}`, null, login.cookie)).status, 404);
  const list = await call(host, 'GET', '/api/receipts', null, login.cookie);
  assert.deepEqual(list.data.rows.map((r) => r.id), [ids.mine]);
});
