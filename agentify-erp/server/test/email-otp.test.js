// Email one-time codes (signup and sign-in), "new sign-in" emails and the disposable-address blocklist.
// Resend is mocked; DNS is stubbed so no test touches the network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-otp-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_DEMO = '0';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.PLATFORM_ADMIN_EMAIL = 'root@agentify.test';
process.env.PLATFORM_ADMIN_PASSWORD = 'Console@12345';
process.env.LOGIN_LIMIT = '1000';
process.env.SIGNUP_LIMIT = '1000';
process.env.SIGNUP_CODE_LIMIT = '1000';
delete process.env.RESEND_API_KEY;

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { setRegionStatus } = await import('../src/regions/admin.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const dis = await import('../src/services/disposableEmail.js');
let server, port;
const realFetch = globalThis.fetch;
const sent = [];
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.startsWith('https://api.resend.com/emails')) { sent.push(JSON.parse(opts.body)); return J({ id: 'em_' + sent.length }); }
    return J({ error: 'unmocked ' + u }, 404);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, agent: false, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookies: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]) }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const codeFrom = (mail) => mail.text.match(/Your code is (\d{3}) (\d{3})/).slice(1).join('');
const lastTo = (email) => [...sent].reverse().find((m) => m.to.includes(email));
const signupBody = (over = {}) => ({ accept_terms: true, slug: 'otpco', company_name: 'Otp Co', admin_name: 'Olive Owner', admin_email: 'olive@otpco.test', admin_password: 'Owner@12345', region: 'US', timezone: 'America/New_York', currency: 'USD', product: 'real_estate', ...over });
const resetCooldown = () => platformDb().prepare("UPDATE email_otps SET created_at=datetime('now','-2 minutes')").run();

test('disposable addresses, your own block list and the allow list', async () => {
  setRegionStatus(platformDb(), 'US', 'active', 'tester');
  const ok = async (e) => (await dis.checkEmail(e)).ok;
  assert.equal(await ok('someone@mailinator.com'), false);
  assert.equal(await ok('someone@sub.mailinator.com'), false, 'subdomains of a listed domain');
  assert.equal(await ok('someone@my-tempmail-service.xyz'), false, 'telltale word in a new domain');
  assert.equal(await ok('someone@gmail.com'), true);
  assert.equal((await dis.checkEmail('not-an-email')).code, 'syntax');
  // the Super Admin blocks a new throw-away service, and can allow one the list gets wrong
  dis.addRule({ domain: '@NewTrash.example.org', action: 'block', note: 'seen in signups' }, 'root');
  assert.equal(await ok('a@newtrash.example.org'), false);
  assert.equal(await ok('a@mail.newtrash.example.org'), false, 'the block covers subdomains');
  dis.addRule({ domain: 'mailinator.com', action: 'allow' }, 'root');
  assert.equal(await ok('someone@mailinator.com'), true, 'allow beats the built-in list');
  assert.throws(() => dis.addRule({ domain: 'not a domain', action: 'block' }, 'root'), /domain/);
  dis.removeRule('mailinator.com'); dis.removeRule('newtrash.example.org');
  assert.equal(await ok('someone@mailinator.com'), false);
  // switching the list off lets it through
  dis.setSwitches({ block_disposable_email: false }, 'root');
  assert.equal(await ok('someone@mailinator.com'), true);
  dis.setSwitches({ block_disposable_email: true }, 'root');
  // mail servers: a domain with none is refused, a DNS outage never blocks anyone
  dis.setMailResolver({ mail: async (d) => d !== 'typo-domain.test' });
  assert.equal((await dis.checkEmail('a@typo-domain.test')).code, 'no_mail');
  assert.equal(await ok('a@real-domain.test'), true);
  dis.setMailResolver({ mail: async () => { throw Object.assign(new Error('down'), { code: 'ESERVFAIL' }); } });
  assert.equal(await ok('a@other-domain.test'), true, 'fails open on a DNS error');
  dis.setMailResolver({ mail: async () => true });
});

test('without a mail provider the signup code is skipped, but disposable addresses are still refused', async () => {
  assert.equal((await call(P, 'GET', '/api/platform/marketing')).data.signup_email_code, false);
  const r = await call(P, 'POST', '/api/platform/signup/email-code', { email: 'x@mailinator.com' });
  assert.equal(r.status, 400); assert.match(r.data.error, /disposable/i);
  assert.deepEqual((await call(P, 'POST', '/api/platform/signup/email-code', { email: 'x@gmail.com' })).data, { required: false });
  const su = await call(P, 'POST', '/api/platform/signup', signupBody({ slug: 'nomail', admin_email: 'x@mailinator.com' }));
  assert.equal(su.status, 400); assert.match(su.data.error, /disposable/i);
});

test('with mail connected, signup needs the emailed code: wrong guesses burn it, the proof is single use and tied to the address', async () => {
  setSetting('resend_api_key', 're_testkey1234567890', { secret: true, by: 'tester' }); setSetting('mail_from', 'Agentify ERP <noreply@agentifyerp.co>', { by: 'tester' });
  assert.equal((await call(P, 'GET', '/api/platform/marketing')).data.signup_email_code, true);
  // no proof, no workspace
  let r = await call(P, 'POST', '/api/platform/signup', signupBody());
  assert.equal(r.status, 400); assert.match(r.data.error, /code/i);
  r = await call(P, 'POST', '/api/platform/signup/email-code', { email: 'olive@mailinator.com' });
  assert.equal(r.status, 400, 'throw-away address refused before any email is sent');
  r = await call(P, 'POST', '/api/platform/signup/email-code', { email: 'Olive@OtpCo.test' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.required, true);
  await wait();
  const mail = lastTo('olive@otpco.test'); assert.ok(mail, 'the code was emailed');
  const code = codeFrom(mail);
  assert.match(mail.subject, new RegExp(code));
  const stored = platformDb().prepare('SELECT * FROM email_otps ORDER BY id DESC').get();
  assert.notEqual(stored.code_hash, code); assert.doesNotMatch(JSON.stringify(stored), new RegExp(`\\b${code}\\b`), 'only a hash is stored');
  // asking again straight away is refused
  assert.equal((await call(P, 'POST', '/api/platform/signup/email-code', { email: 'olive@otpco.test' })).status, 429);
  // wrong guesses: 4 tries left, then the right code still works; 5 wrong burns it
  const wrong = code === '000000' ? '111111' : '000000';
  r = await call(P, 'POST', '/api/platform/signup/verify-code', { email: 'olive@otpco.test', code: wrong });
  assert.equal(r.status, 400); assert.match(r.data.error, /4 tries left/);
  for (let i = 0; i < 4; i += 1) await call(P, 'POST', '/api/platform/signup/verify-code', { email: 'olive@otpco.test', code: wrong });
  r = await call(P, 'POST', '/api/platform/signup/verify-code', { email: 'olive@otpco.test', code });
  assert.equal(r.status, 400, 'five wrong guesses burn the code even if the right one follows');
  // a new code
  resetCooldown();
  await call(P, 'POST', '/api/platform/signup/email-code', { email: 'olive@otpco.test' }); await wait();
  const code2 = codeFrom(lastTo('olive@otpco.test'));
  r = await call(P, 'POST', '/api/platform/signup/verify-code', { email: 'olive@otpco.test', code: code2 });
  assert.equal(r.status, 200, JSON.stringify(r.data)); const proof = r.data.proof; assert.ok(proof);
  assert.equal((await call(P, 'POST', '/api/platform/signup/verify-code', { email: 'olive@otpco.test', code: code2 })).status, 400, 'a code works once');
  // the proof is for that address only
  r = await call(P, 'POST', '/api/platform/signup', signupBody({ slug: 'other', admin_email: 'someone.else@otpco.test', email_proof: proof }));
  assert.equal(r.status, 400);
  r = await call(P, 'POST', '/api/platform/signup', signupBody({ email_proof: proof + 'x' }));
  assert.equal(r.status, 400, 'forged proof');
  r = await call(P, 'POST', '/api/platform/signup', signupBody({ email_proof: proof }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  // used up
  r = await call(P, 'POST', '/api/platform/signup', signupBody({ slug: 'otpco2', company_name: 'Otp Co 2', email_proof: proof }));
  assert.equal(r.status, 400, 'a proof cannot start a second signup');
  // the code already confirmed the owner, so the welcome mail has nothing to confirm
  const welcome = lastTo('olive@otpco.test');
  assert.doesNotMatch(welcome.text, /verify-email/);
  const login = await call('otpco.erp.test', 'POST', '/api/auth/login', { identifier: 'olive@otpco.test', password: 'Owner@12345' });
  assert.equal(login.status, 200); assert.equal(login.data.email_verified, true);
});

test('email sign-in code: off by default, optional for new browsers or every sign-in, and a wrong code never signs in', async () => {
  const H = 'otpco.erp.test';
  let owner = await call(H, 'POST', '/api/auth/login', { identifier: 'olive@otpco.test', password: 'Owner@12345' });
  const cookie = owner.cookies.find((c) => c.startsWith('erp_token=')); assert.ok(cookie);
  const auth = { Cookie: cookie };
  assert.equal((await call(H, 'GET', '/api/auth/login-otp', null, auth)).data.mode, 'off');
  assert.equal((await call(H, 'PUT', '/api/auth/login-otp', { mode: 'sometimes' }, auth)).status, 400);
  assert.equal((await call(H, 'PUT', '/api/auth/login-otp', { mode: 'always' }, auth)).status, 200);
  // password alone no longer signs in
  sent.length = 0;
  let r = await call(H, 'POST', '/api/auth/login', { identifier: 'olive@otpco.test', password: 'Owner@12345' });
  assert.equal(r.status, 200); assert.equal(r.data.otp_required, true); assert.equal(r.data.email_hint, 'o***@otpco.test');
  assert.ok(!r.cookies.some((c) => c.startsWith('erp_token=')), 'no session before the code');
  await wait();
  const code = codeFrom(lastTo('olive@otpco.test'));
  const tok = r.data.otp_token;
  assert.equal((await call(H, 'POST', '/api/auth/login/otp', { otp_token: tok, code: code === '123456' ? '654321' : '123456' })).status, 400);
  assert.equal((await call(H, 'POST', '/api/auth/login/otp', { otp_token: 'junk', code })).status, 401);
  // resend is rate limited, then works
  assert.equal((await call(H, 'POST', '/api/auth/login/otp/resend', { otp_token: tok })).status, 429);
  resetCooldown();
  assert.equal((await call(H, 'POST', '/api/auth/login/otp/resend', { otp_token: tok })).status, 200); await wait();
  const code2 = codeFrom(lastTo('olive@otpco.test'));
  r = await call(H, 'POST', '/api/auth/login/otp', { otp_token: tok, code: code2 });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(r.cookies.some((c) => c.startsWith('erp_token=')));
  const device = r.cookies.find((c) => c.startsWith('erp_device='));
  assert.ok(device, 'this browser is remembered');
  // "new browsers only": the remembered browser goes straight in, a different one is asked
  await call(H, 'PUT', '/api/auth/login-otp', { mode: 'new_device' }, { Cookie: r.cookies.find((c) => c.startsWith('erp_token=')) });
  r = await call(H, 'POST', '/api/auth/login', { identifier: 'olive@otpco.test', password: 'Owner@12345' }, { Cookie: device });
  assert.equal(r.status, 200); assert.equal(r.data.otp_required, undefined); assert.equal(r.data.email, 'olive@otpco.test');
  resetCooldown();
  r = await call(H, 'POST', '/api/auth/login', { identifier: 'olive@otpco.test', password: 'Owner@12345' });
  assert.equal(r.data.otp_required, true);
  // asking for codes in a loop is capped for the address, whatever the browser
  for (let i = 0; i < 6 && r.status === 200; i += 1) { resetCooldown(); r = await call(H, 'POST', '/api/auth/login', { identifier: 'olive@otpco.test', password: 'Owner@12345' }); }
  assert.equal(r.status, 429); assert.match(r.data.error, /Too many codes/);
});

test('a sign-in from an address and browser never seen before emails the person; the usual browser on a new network does not', async () => {
  const H = 'otpco.erp.test';
  // clear the sign-in code step so only the alert is being tested
  const { withTenant, getTenant } = await import('../src/platform.js');
  const { run } = await import('../src/db.js');
  const ten = getTenant(platformDb().prepare('SELECT id FROM tenants WHERE slug=?').get('otpco').id);
  withTenant(ten, () => { run("UPDATE settings SET value='off' WHERE key='login_email_otp'"); run('DELETE FROM login_devices'); run('DELETE FROM login_alerts'); });
  const login = (ip, headers = {}) => call(H, 'POST', '/api/auth/login', { identifier: 'olive@otpco.test', password: 'Owner@12345' }, { 'X-Forwarded-For': ip, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36', ...headers });
  const alerts = () => sent.filter((m) => /New sign-in/.test(m.subject));
  sent.length = 0;
  let r = await login('10.0.0.1'); await wait();
  assert.equal(alerts().length, 0, 'the first sign-in only sets the baseline');
  const device = r.cookies.find((c) => c.startsWith('erp_device='));
  await login('10.0.0.2', { Cookie: device }); await wait();
  assert.equal(alerts().length, 0, 'same browser, new network: no email');
  await login('10.0.0.1'); await wait();
  assert.equal(alerts().length, 0, 'a known address from a fresh browser is not new');
  await login('203.0.113.9'); await wait();
  assert.equal(alerts().length, 1, 'new address and unseen browser: email');
  const mail = alerts()[0];
  assert.deepEqual(mail.to, ['olive@otpco.test']);
  assert.match(mail.text, /203\.0\.113\.9/); assert.match(mail.text, /Chrome on Windows/); assert.match(mail.text, /Change my password/);
  await login('203.0.113.9'); await wait();
  assert.equal(alerts().length, 1, 'the same new address is only reported once');
  // at most three a day
  for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4']) { await login(ip); await wait(30); }
  assert.equal(alerts().length, 3);
  // failed passwords are never reported as sign-ins
  const before = sent.length;
  await call(H, 'POST', '/api/auth/login', { identifier: 'olive@otpco.test', password: 'wrong-pass' }, { 'X-Forwarded-For': '192.0.2.77' }); await wait();
  assert.equal(sent.length, before);
});

test('console: switches, your own domain list, a test check, and the lock-out escape hatch', async () => {
  const lg = await call(P, 'POST', '/api/platform/admin/login', { email: 'root@agentify.test', password: 'Console@12345' });
  assert.equal(lg.status, 200, JSON.stringify(lg.data));
  const auth = { Cookie: lg.cookies.find((c) => c.startsWith('platform_token=')) };
  const A = '/api/platform/admin/email-safety';
  assert.equal((await call(P, 'GET', A)).status, 401);
  let r = await call(P, 'GET', A, null, auth);
  assert.equal(r.status, 200); assert.equal(r.data.block_disposable_email, true); assert.equal(r.data.signup_email_code, true); assert.ok(r.data.builtin_count > 100);
  r = await call(P, 'POST', `${A}/rules`, { domain: 'shady-mail.example', action: 'block', note: 'abuse' }, auth);
  assert.equal(r.status, 201); assert.equal(r.data.rules.length, 1);
  assert.equal((await call(P, 'POST', `${A}/rules`, { domain: 'nope', action: 'block' }, auth)).status, 400);
  r = await call(P, 'POST', `${A}/check`, { email: 'a@shady-mail.example' }, auth);
  assert.equal(r.data.ok, false); assert.equal(r.data.code, 'disposable');
  assert.equal((await call(P, 'POST', '/api/platform/signup/email-code', { email: 'a@shady-mail.example' })).status, 400, 'signup honours the new rule at once');
  assert.equal((await call(P, 'DELETE', `${A}/rules/shady-mail.example`, null, auth)).status, 200);
  assert.equal((await call(P, 'DELETE', `${A}/rules/shady-mail.example`, null, auth)).status, 404);
  r = await call(P, 'PUT', A, { signup_email_code: false }, auth);
  assert.equal(r.data.signup_email_code, false);
  assert.equal((await call(P, 'GET', '/api/platform/marketing')).data.signup_email_code, false, 'the signup page stops asking for a code');
  await call(P, 'PUT', A, { signup_email_code: true }, auth);
  // a workspace whose email breaks can have the sign-in code switched off by support
  const ten = platformDb().prepare('SELECT id FROM tenants WHERE slug=?').get('otpco');
  const { withTenant, getTenant } = await import('../src/platform.js');
  const { get, run } = await import('../src/db.js');
  const { userAction } = await import('../src/services/platformTenants.js');
  const t = getTenant(ten.id);
  withTenant(t, () => run("INSERT INTO settings(key,value) VALUES('login_email_otp','always') ON CONFLICT(key) DO UPDATE SET value='always'"));
  const uid = withTenant(t, () => get('SELECT id FROM users LIMIT 1').id);
  await userAction(ten.id, uid, 'disable-login-otp', {}, { protocol: 'http', get: () => 'otpco.erp.test' });
  assert.equal(withTenant(t, () => get("SELECT value FROM settings WHERE key='login_email_otp'").value), 'off');
});
