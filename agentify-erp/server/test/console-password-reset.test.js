// Console "forgot password": one-time emailed link, expiry, single use, no account enumeration, rate limit, 2FA untouched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-reset-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', RESET_LIMIT: '12', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', BILLING_PROVIDER: 'manual', NODE_ENV: 'test',
  PLATFORM_ADMIN_EMAIL: 'owner@agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345' });
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { outbox } = await import('../src/services/mailer.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test', A = '/api/platform/admin';
const forgot = (email) => call(P, 'POST', `${A}/password/forgot`, { email });
const tick = () => new Promise((r) => setTimeout(r, 50));
const lastToken = () => outbox.filter((m) => m.type === 'password_reset').at(-1)?.text.match(/reset-password\/([\w-]+)/)?.[1];
const clearGap = () => platformDb().prepare('UPDATE platform_admins SET reset_sent_at=NULL').run();

test('forgot password: same answer for a real and an unknown email, mail only for the real one', async () => {
  const known = await forgot('owner@agentify.test'); await tick();
  const unknown = await forgot('nobody@agentify.test'); await tick();
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.deepEqual(known.data, unknown.data);
  const mails = outbox.filter((m) => m.type === 'password_reset');
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'owner@agentify.test');
  assert.match(mails[0].text, /\/platform\/reset-password\/[\w-]+/);
  assert.equal((await forgot('not-an-email')).status, 200);
  assert.equal((await call('acme.erp.test', 'POST', `${A}/password/forgot`, { email: 'owner@agentify.test' })).status, 404, 'platform host only');
  assert.equal((await call(P, 'POST', `${A}/password/forgot`, { email: 'x@y.test' }, { 'X-Requested-With': 'x' })).status, 403, 'CSRF header required');
});

test('reset link stores only a hash, works once, then the new password signs in and the old one does not', async () => {
  const token = lastToken(); assert.ok(token);
  const row = platformDb().prepare("SELECT reset_token_hash FROM platform_admins WHERE email='owner@agentify.test'").get();
  assert.ok(row.reset_token_hash && row.reset_token_hash !== token && !JSON.stringify(row).includes(token));
  assert.equal((await call(P, 'GET', `${A}/password/reset/${token}`)).data.email, 'owner@agentify.test');
  assert.equal((await call(P, 'POST', `${A}/password/reset`, { token, password: 'short' })).status, 400, 'password rules apply');
  assert.equal((await call(P, 'POST', `${A}/password/reset`, { token, password: 'Fresh#Harbor2026' })).status, 200);
  assert.equal((await call(P, 'POST', `${A}/password/reset`, { token, password: 'Another#Pass2026' })).status, 404, 'single use');
  assert.equal((await call(P, 'GET', `${A}/password/reset/${token}`)).status, 404);
  assert.equal((await call(P, 'POST', `${A}/login`, { email: 'owner@agentify.test', password: 'Console@12345' })).status, 401);
  assert.equal((await call(P, 'POST', `${A}/login`, { email: 'owner@agentify.test', password: 'Fresh#Harbor2026' })).status, 200);
});

test('reset link expires, a new request replaces the old link, and requests are spaced', async () => {
  clearGap(); await forgot('owner@agentify.test'); await tick();
  const first = lastToken();
  await forgot('owner@agentify.test'); await tick();
  assert.equal(lastToken(), first, 'second request within a minute sends nothing new');
  clearGap(); await forgot('owner@agentify.test'); await tick();
  const second = lastToken(); assert.notEqual(second, first);
  assert.equal((await call(P, 'GET', `${A}/password/reset/${first}`)).status, 404, 'old link replaced');
  platformDb().prepare("UPDATE platform_admins SET reset_expires_at=datetime('now','-1 minute')").run();
  assert.equal((await call(P, 'GET', `${A}/password/reset/${second}`)).status, 404, 'expired');
  assert.equal((await call(P, 'POST', `${A}/password/reset`, { token: second, password: 'Fresh#Harbor2027' })).status, 404);
});

test('reset keeps two-factor on, signs out sessions and disabled accounts get no link', async () => {
  const db = platformDb();
  db.prepare("UPDATE platform_admins SET totp_enabled=1, totp_secret='x', recovery_codes='[]'").run();
  const login = await call(P, 'POST', `${A}/login`, { email: 'owner@agentify.test', password: 'Fresh#Harbor2026' });
  assert.equal(login.data.mfa_required, true);
  clearGap(); await forgot('owner@agentify.test'); await tick();
  const token = lastToken();
  assert.equal((await call(P, 'POST', `${A}/password/reset`, { token, password: 'Fresh#Harbor2028' })).status, 200);
  assert.equal(db.prepare('SELECT totp_enabled FROM platform_admins').get().totp_enabled, 1, '2FA untouched');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_sessions WHERE revoked_at IS NULL').get().n, 0);
  db.prepare('UPDATE platform_admins SET active=0').run(); clearGap();
  const before = outbox.length; await forgot('owner@agentify.test'); await tick();
  assert.equal(outbox.length, before, 'disabled account: no mail');
});

test('forgot password is rate limited', async () => {
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await forgot(`x${i}@agentify.test`)).status);
  assert.ok(codes.includes(429), codes.join(','));
});
