// "Continue with Google" on the signup page (new workspace and owner, no password) and the e-mail copy of in-app notifications
// through Resend, with Google and Resend mocked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-gsignup-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_DEMO = '0';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.LOGIN_LIMIT = '1000';
process.env.SIGNUP_LIMIT = '1000';
delete process.env.RESEND_API_KEY;

const { createApp } = await import('../src/index.js');
const { platformDb, getTenant, withTenant } = await import('../src/platform.js');
const { setRegionStatus } = await import('../src/regions/admin.js');
const oauth = await import('../src/services/oauthApps.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const { outbox } = await import('../src/services/mailer.js');
const { notify } = await import('../src/audit.js');
const { run } = await import('../src/db.js');
let server, port;
const realFetch = globalThis.fetch;
const resendCalls = [];
let googleUser = { email: 'New.Owner@Gmail.test', email_verified: true, name: 'New Owner' };
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'g-access', expires_in: 3600 });
    if (u.startsWith('https://openidconnect.googleapis.com')) return J(googleUser);
    if (u.startsWith('https://api.resend.com/emails')) { resendCalls.push({ auth: opts.headers?.Authorization, body: JSON.parse(opts.body) }); return J({ id: 'em_1' }); }
    return J({ error: 'unmocked ' + u }, 404);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, location: res.headers.location, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const stateOf = (location) => new URL(location).searchParams.get('state');
const signupBody = (over = {}) => ({ accept_terms: true, slug: 'gco', company_name: 'Google Co', admin_name: '', region: 'US', timezone: 'America/New_York', currency: 'USD', product: 'real_estate', ...over });

test('Google sign-up is offered only once the platform has a Google app, and the start address is the registered one', async () => {
  setRegionStatus(platformDb(), 'US', 'active', 'tester');
  assert.equal((await call('erp.test', 'GET', '/api/platform/marketing')).data.google_signup, false);
  assert.equal((await call('erp.test', 'GET', '/api/platform/oauth/google/signup')).status, 400);
  oauth.saveAppCreds('google', { client_id: 'cid.apps.googleusercontent.com', client_secret: 'csecret' }, 'tester');
  assert.equal((await call('erp.test', 'GET', '/api/platform/marketing')).data.google_signup, true);
  const start = await call('erp.test', 'GET', '/api/platform/oauth/google/signup?product=real_estate&country=US&evil=x');
  assert.equal(start.status, 303);
  const au = new URL(start.location);
  assert.equal(au.origin + au.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(au.searchParams.get('redirect_uri'), 'http://erp.test/api/platform/oauth/google/callback');
  assert.match(au.searchParams.get('scope'), /email/); assert.equal(au.searchParams.get('prompt'), 'select_account');
  const st = oauth.readState(au.searchParams.get('state'));
  assert.equal(st.purpose, 'signup'); assert.equal(st.origin, 'http://erp.test'); assert.equal(st.q, 'product=real_estate&country=US', 'only product and country travel along');
});

test('the callback hands a verified Google identity to the signup page, and refuses anything unverified or forged', async () => {
  const start = await call('erp.test', 'GET', '/api/platform/oauth/google/signup?product=construction');
  const state = stateOf(start.location);
  assert.equal((await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=x&state=${state.slice(0, -2)}zz`)).status, 400, 'forged state');
  let cb = await call('erp.test', 'GET', `/api/platform/oauth/google/callback?error=access_denied&state=${state}`);
  assert.match(cb.location, /^http:\/\/erp\.test\/signup\?google_error=cancelled&product=construction$/);
  googleUser = { email: 'x@gmail.test', email_verified: false, name: 'X' };
  cb = await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=abc&state=${state}`);
  assert.match(cb.location, /google_error=email_not_verified/);
  googleUser = { email: 'New.Owner@Gmail.test', email_verified: true, name: 'New Owner' };
  cb = await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=abc&state=${state}`);
  assert.equal(cb.status, 303); assert.match(cb.location, /^http:\/\/erp\.test\/signup\?google=.+&product=construction$/);
  const token = new URL(cb.location).searchParams.get('google');
  const who = await call('erp.test', 'GET', `/api/platform/google-identity?token=${encodeURIComponent(token)}`);
  assert.deepEqual(who.data, { email: 'new.owner@gmail.test', name: 'New Owner' });
  assert.equal((await call('erp.test', 'GET', `/api/platform/google-identity?token=${encodeURIComponent(token.slice(0, -2))}zz`)).status, 400);
  // a token meant for something else (a sign-in state) is not a sign-up token
  const loginState = oauth.signState({ purpose: 'login', tid: 1, origin: 'http://x.erp.test' });
  assert.equal((await call('erp.test', 'GET', `/api/platform/google-identity?token=${encodeURIComponent(loginState)}`)).status, 400);
});

test('signing up with Google creates the workspace for the Google address, no password, confirmed, and signs the owner in', async () => {
  const cb = await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=abc&state=${stateOf((await call('erp.test', 'GET', '/api/platform/oauth/google/signup')).location)}`);
  const token = new URL(cb.location).searchParams.get('google');
  // a tampered token is refused
  assert.equal((await call('erp.test', 'POST', '/api/platform/signup', signupBody({ google_token: token.slice(0, -2) + 'zz', admin_email: 'x@y.test' }))).status, 400);
  // the address in the form is ignored in favour of the one Google verified
  const su = await call('erp.test', 'POST', '/api/platform/signup', signupBody({ google_token: token, admin_email: 'attacker@evil.test', admin_password: 'whatever12345' }));
  assert.equal(su.status, 201, JSON.stringify(su.data));
  assert.equal(su.data.tenant.owner_email, 'new.owner@gmail.test');
  const t = platformDb().prepare('SELECT * FROM tenants WHERE slug=?').get('gco');
  const { get } = await import('../src/db.js');
  const row = withTenant(getTenant(t.id), () => get('SELECT email, email_verified FROM users WHERE lower(email)=?', 'new.owner@gmail.test'));
  assert.equal(row.email_verified, 1, 'Google already verified the address');
  assert.equal(withTenant(getTenant(t.id), () => get("SELECT COUNT(*) n FROM users WHERE lower(email)='attacker@evil.test'")).n, 0);
  // signed in with the one-time code; the form's password does not work, and neither does guessing
  assert.match(su.data.enter_url, /\/login\?sso=/);
  const code = new URL(su.data.enter_url).searchParams.get('sso');
  const ex = await call('gco.erp.test', 'POST', '/api/auth/sso/exchange', { code });
  assert.equal(ex.status, 200, JSON.stringify(ex.data)); assert.ok(ex.cookie);
  assert.equal((await call('gco.erp.test', 'POST', '/api/auth/login', { identifier: 'new.owner@gmail.test', password: 'whatever12345' })).status, 401);
  // the welcome mail says there is nothing to confirm and carries no confirmation link
  const welcome = outbox.find((m) => m.to === 'new.owner@gmail.test');
  assert.ok(welcome, 'a welcome mail was queued'); assert.doesNotMatch(welcome.text, /verify-email/); assert.match(welcome.text, /nothing to confirm/);
  // and the same Google account can sign in again from the workspace login page
  const start = await call('gco.erp.test', 'GET', '/api/auth/sso/google/start');
  const again = await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=abc&state=${stateOf(start.location)}`);
  assert.match(again.location, /^http:\/\/gco\.erp\.test\/login\?sso=/);
});

test('notifications are e-mailed through Resend only when the workspace switched e-mail on, to confirmed staff, and never more than five in ten minutes', async () => {
  const t = platformDb().prepare('SELECT * FROM tenants WHERE slug=?').get('gco');
  const ten = getTenant(t.id);
  const { get } = await import('../src/db.js');
  const owner = withTenant(ten, () => get('SELECT id FROM users WHERE lower(email)=?', 'new.owner@gmail.test'));
  const fire = (n, title = 'Task assigned') => withTenant(ten, () => { for (let i = 0; i < n; i += 1) notify(owner.id, 'task', `${title} ${i}`, 'Call the buyer', '/tasks'); });
  await new Promise((r) => setTimeout(r, 20)); resendCalls.length = 0;
  fire(1); await new Promise((r) => setTimeout(r, 30));
  assert.equal(resendCalls.length, 0, 'no key and the switch is off: in-app only');
  setSetting('resend_api_key', 're_testkey1234567890', { secret: true, by: 'tester' }); setSetting('mail_from', 'Agentify ERP <noreply@agentifyerp.co>', { by: 'tester' });
  fire(1); await new Promise((r) => setTimeout(r, 30));
  assert.equal(resendCalls.length, 0, 'key saved but the workspace switch is still off');
  withTenant(ten, () => run("INSERT INTO settings(key,value) VALUES('notify_email_enabled','1') ON CONFLICT(key) DO UPDATE SET value='1'"));
  fire(1, 'Follow-up due'); await new Promise((r) => setTimeout(r, 40));
  assert.equal(resendCalls.length, 1);
  assert.equal(resendCalls[0].auth, 'Bearer re_testkey1234567890'); assert.deepEqual(resendCalls[0].body.to, ['new.owner@gmail.test']);
  assert.match(resendCalls[0].body.subject, /Follow-up due 0/); assert.match(resendCalls[0].body.html, /https:\/\/gco\.erp\.test\/tasks/);
  assert.match(resendCalls[0].body.from, /noreply@agentifyerp\.co/);
  resendCalls.length = 0; fire(10); await new Promise((r) => setTimeout(r, 60));
  assert.ok(resendCalls.length <= 4, `throttled (got ${resendCalls.length} more after the first)`);
  // an address that was never confirmed gets nothing
  withTenant(ten, () => run('UPDATE users SET email_verified=0 WHERE id=?', owner.id));
  resendCalls.length = 0; fire(1); await new Promise((r) => setTimeout(r, 30));
  assert.equal(resendCalls.length, 0);
});
