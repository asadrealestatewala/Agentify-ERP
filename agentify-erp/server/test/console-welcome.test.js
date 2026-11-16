// Console invitation status messages, temporary-password welcome, forced first change and recovery code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-welcome-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', BILLING_PROVIDER: 'manual', NODE_ENV: 'test' });
// no PLATFORM_ADMIN_* : the platform starts with no console account and must be bootstrapped with the one-time token
for (const k of ['PLATFORM_ADMIN_EMAIL', 'PLATFORM_ADMIN_PASSWORD', 'ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { SETUP_TOKEN_FILE } = await import('../src/services/platformStaff.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
const A = '/api/platform/admin';
const signIn = async (email, password) => (await call(P, 'POST', `${A}/login`, { email, password })).cookie;
let owner;
const as = (cookie, method, url, body) => call(P, method, `${A}${url}`, body, { cookie });


test('invitation links say why they stop working; temporary-password welcome forces a new password and gives a recovery code', async () => {
  const token = fs.readFileSync(SETUP_TOKEN_FILE, 'utf8').trim();
  await call(P, 'POST', `${A}/setup`, { token, email: 'founder@agentify.test', name: 'Founder', password: 'Kestrel#Moon2026' });
  const owner = await signIn('founder@agentify.test', 'Kestrel#Moon2026');
  const as = (method, url, body) => call(P, method, `${A}${url}`, body, { cookie: owner });

  // invitation: used, then replaced
  const inv = await as('POST', '/admins', { email: 'sm@agentify.test', name: 'Social', role: 'read_only' });
  const t1 = inv.data.link.split('/accept-invite/')[1];
  const inv2 = await as('POST', '/admins', { email: 'sm@agentify.test', name: 'Social', role: 'read_only' });
  const t2 = inv2.data.link.split('/accept-invite/')[1];
  const old = await call(P, 'GET', `${A}/invite/${t1}`);
  assert.equal(old.status, 404); assert.equal(old.data.code, 'replaced'); assert.match(old.data.error, /newer invitation/);
  assert.equal((await call(P, 'POST', `${A}/invite/accept`, { token: t2, password: 'Harbor#Light2026' })).status, 200);
  const used = await call(P, 'GET', `${A}/invite/${t2}`);
  assert.equal(used.data.code, 'used'); assert.match(used.data.error, /already used/);
  assert.equal((await call(P, 'GET', `${A}/invite/nonsense`)).data.code, 'unknown');

  // temporary password
  const made = await as('POST', '/admins', { email: 'media@agentify.test', name: 'Media Lead', role: 'read_only', method: 'temp_password' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const m = made.data.welcome.text;
  const pw = m.match(/Temporary password: (\S+)/)[1];
  assert.match(m, /Welcome to Agentify ERP, Media Lead!/); assert.match(m, /\/platform/); assert.match(m, /media@agentify.test/);
  assert.ok(!JSON.stringify(platformDb().prepare('SELECT detail FROM platform_audit').all()).includes(pw), 'the password is never audited');
  assert.equal(platformDb().prepare('SELECT password_hash h FROM platform_admins WHERE email=?').get('media@agentify.test').h.includes(pw), false);
  const first = await call(P, 'POST', `${A}/login`, { email: 'media@agentify.test', password: pw });
  assert.equal(first.data.must_change_password, true); assert.ok(!first.cookie, 'no session yet');
  const ct = first.data.change_token;
  assert.equal((await call(P, 'POST', `${A}/login/first-password`, { change_token: ct, password: pw })).status, 400, 'must differ');
  assert.equal((await call(P, 'POST', `${A}/login/first-password`, { change_token: ct, password: 'weak' })).status, 400);
  const done = await call(P, 'POST', `${A}/login/first-password`, { change_token: ct, password: 'Lantern#Fox2026' });
  assert.equal(done.status, 200, JSON.stringify(done.data)); assert.ok(done.cookie);
  const code = done.data.recovery_code; assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal((await call(P, 'POST', `${A}/login`, { email: 'media@agentify.test', password: pw })).status, 401, 'temporary password is gone');
  assert.ok((await call(P, 'POST', `${A}/login`, { email: 'media@agentify.test', password: 'Lantern#Fox2026' })).cookie);

  // recovery code
  assert.equal((await call(P, 'POST', `${A}/password/recover`, { email: 'media@agentify.test', recovery_code: 'AAAA-BBBB-CCCC-DDDD', password: 'Pebble#Rain2026' })).status, 401);
  const rec = await call(P, 'POST', `${A}/password/recover`, { email: 'media@agentify.test', recovery_code: code.toLowerCase(), password: 'Pebble#Rain2026' });
  assert.equal(rec.status, 200, JSON.stringify(rec.data)); assert.notEqual(rec.data.recovery_code, code);
  assert.equal((await call(P, 'POST', `${A}/password/recover`, { email: 'media@agentify.test', recovery_code: code, password: 'Other#Pass2026x' })).status, 401, 'used up');
  assert.ok((await call(P, 'POST', `${A}/login`, { email: 'media@agentify.test', password: 'Pebble#Rain2026' })).cookie);

  // new temporary password for an existing user
  const id = platformDb().prepare('SELECT id FROM platform_admins WHERE email=?').get('media@agentify.test').id;
  const again = await as('POST', `/admins/${id}/temp-password`);
  assert.equal(again.status, 200); assert.match(again.data.welcome.text, /Temporary password:/);
  assert.equal((await call(P, 'POST', `${A}/login`, { email: 'media@agentify.test', password: 'Pebble#Rain2026' })).status, 401);
});
