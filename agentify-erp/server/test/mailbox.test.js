// Super Admin Mailbox: only Platform Owner / Super Admin reach it, the Resend webhook is signed and idempotent, inbound HTML is sanitised,
// and the sent log follows delivery events without ever keeping a code or link. Resend is mocked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-mailbox-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'root@agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY', 'MAIL_FROM']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { sendMail } = await import('../src/services/mailer.js');
const log = await import('../src/services/emailLog.js');
const mb = await import('../src/services/mailbox.js');
const { ROLES, permsOf } = await import('../src/services/platformAccess.js');
let server, port;
const realFetch = globalThis.fetch;
const resend = [];
const INBOXES = [{ id: '11111111-1111-4111-8111-111111111111', email_address: 'hello@agentifyerp.co', from_name: 'Agentify' }, { id: '22222222-2222-4222-8222-222222222222', email_address: 'admin@agentifyerp.co', from_name: '' },
  { id: '33333333-3333-4333-8333-333333333333', email_address: 'noreply@agentifyerp.co', from_name: '' }];
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u.startsWith('https://api.resend.com')) {
      resend.push({ url: u, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
      if (u === 'https://api.resend.com/emails' && opts.method === 'POST') return J({ id: `em_${resend.length}` });
      if (u.startsWith('https://api.resend.com/inboxes?')) return J({ data: INBOXES, has_more: false });
      return J({ data: [], has_more: false });
    }
    return J({ error: 'unmocked ' + u }, 404);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}, raw = null) => new Promise((resolve, reject) => {
  const data = raw ?? (body ? JSON.stringify(body) : null);
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test', A = '/api/platform/admin';
const as = (cookie, m, u, b) => call(P, m, `${A}${u}`, b, { cookie });
const signIn = async (email, password) => (await call(P, 'POST', `${A}/login`, { email, password })).cookie;
let owner;

test('only Platform Owner and Super Admin hold mailbox.manage; every mailbox route answers 403 to anyone else', async () => {
  assert.ok(permsOf('platform_owner').includes('mailbox.manage') && permsOf('super_admin').includes('mailbox.manage'));
  for (const role of Object.keys(ROLES).filter((x) => !['platform_owner', 'super_admin'].includes(x))) assert.ok(!permsOf(role).includes('mailbox.manage'), role);
  owner = await signIn('root@agentify.test', 'Console@12345');
  assert.ok(owner);
  const routes = [['GET', '/mailbox/inboxes'], ['GET', '/mailbox/threads'], ['GET', '/mailbox/log'], ['GET', '/mailbox/settings'], ['POST', '/mailbox/send', {}], ['POST', '/mailbox/log/sync', {}], ['PUT', '/mailbox/settings/reply-to', { reply_to: 'a@b.co' }], ['GET', '/mailbox/drafts']];
  for (const [role, pw] of [['platform_admin', 'Cobalt#Harbor2026'], ['technical_admin', 'Cobalt#Harbor2027'], ['billing_manager', 'Cobalt#Harbor2028']]) {
    assert.equal((await as(owner, 'POST', '/admins', { email: `${role}@agentify.test`, name: role, role, password: pw })).status, 201, role);
    const c = await signIn(`${role}@agentify.test`, pw);
    for (const [m, u, b] of routes) assert.equal((await as(c, m, u, b)).status, 403, `${role} ${m} ${u}`);
  }
  for (const [m, u, b] of routes.slice(0, 1)) assert.equal((await call(P, m, `${A}${u}`, b)).status, 401, 'not signed in');
  assert.equal((await as(owner, 'GET', '/mailbox/log')).status, 200);
});

test('the Resend webhook needs a saved secret, a valid Svix signature and a fresh timestamp, and handles each event once', async () => {
  const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-10-23T10:00:00.000Z', data: { email_id: 'em_hook1' } });
  const secretBytes = crypto.randomBytes(24);
  const secret = `whsec_${secretBytes.toString('base64')}`;
  const sign = (id, ts, payload = body, key = secretBytes) => `v1,${crypto.createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64')}`;
  const send = (id, ts, sig, payload = body) => call(P, 'POST', '/api/platform/webhooks/resend', null, { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': sig }, payload);
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await send('msg_a', now, sign('msg_a', now))).status, 503, 'no secret saved yet');

  assert.equal((await as(owner, 'PUT', '/integrations/email', { webhook_secret: 'not-a-secret' })).status, 400);
  assert.equal((await as(owner, 'PUT', '/integrations/email', { webhook_secret: secret })).status, 200);
  const saved = (await as(owner, 'GET', '/integrations')).data.find((i) => i.id === 'email');
  assert.equal(saved.settings.webhook_secret.set, true);
  assert.ok(!JSON.stringify(saved).includes(secret), 'the secret is never sent back');

  log.logSent({ resendId: 'em_hook1', type: 'invitation', to: 'x@y.test', subject: 'Invite', status: 'queued' });
  assert.equal((await send('msg_a', now, 'v1,AAAA')).status, 401, 'wrong signature');
  assert.equal((await send('msg_a', now, sign('msg_a', now, body, crypto.randomBytes(24)))).status, 401, 'signed with another secret');
  assert.equal((await send('msg_a', now, sign('msg_a', now, body + ' '))).status, 401, 'body changed after signing');
  assert.equal((await send('msg_old', now - 3600, sign('msg_old', now - 3600))).status, 401, 'old timestamp');
  assert.equal(log.getLog(1).status, 'queued', 'nothing applied by rejected calls');

  const ok = await send('msg_a', now, sign('msg_a', now));
  assert.equal(ok.status, 200); assert.equal(ok.data.duplicate, undefined);
  assert.equal(platformDb().prepare('SELECT status FROM platform_email_log WHERE resend_email_id=?').get('em_hook1').status, 'delivered');
  const again = await send('msg_a', now, sign('msg_a', now));
  assert.equal(again.status, 200); assert.equal(again.data.duplicate, true, 'a repeated delivery is ignored');
  assert.equal(platformDb().prepare("SELECT COUNT(*) n FROM platform_webhook_events WHERE event_id='msg_a'").get().n, 1);
  // a received message is noted for the status panel
  const rx = JSON.stringify({ type: 'email.received', data: { from: 'Client <c@x.test>', subject: 'Hello' } });
  assert.equal((await send('msg_b', now, sign('msg_b', now, rx), rx)).status, 200);
  assert.equal(log.webhookStatus().last_mail.subject, 'Hello');
  // the account's mailbox event (inbox.email.received) is accepted, signed and recorded the same way, once
  const ix = JSON.stringify({ type: 'inbox.email.received', data: { inbox_id: 'ib_1', from: 'Client <c@x.test>', subject: 'Via inbox' } });
  assert.equal((await send('msg_inbox', now, sign('msg_inbox', now, ix), ix)).status, 200);
  assert.equal((await send('msg_inbox', now, sign('msg_inbox', now, ix), ix)).data.duplicate, true);
  assert.equal(platformDb().prepare("SELECT COUNT(*) n FROM platform_webhook_events WHERE type='inbox.email.received'").get().n, 1);
  assert.equal(mb.verifyWebhook(Buffer.from(body), { 'svix-id': 'i', 'svix-timestamp': String(now), 'svix-signature': `v1,bad ${sign('i', now)}` }, secret), true, 'any matching signature in a rotation list is enough');
  assert.equal(mb.verifyWebhook(body, { 'svix-id': 'i', 'svix-timestamp': String(now), 'svix-signature': sign('i', now) }, secret), false, 'raw bytes are required');
});

test('sent log: automated mail is logged by type with no body, follows delivery events upward only, and filters', async () => {
  await as(owner, 'PUT', '/integrations/email', { api_key: 're_testkey_1234567890', from: 'Agentify ERP <noreply@agentifyerp.co>' });
  resend.length = 0;
  assert.equal(await sendMail({ to: 'new.owner@acme.test', subject: 'Confirm your email address', text: 'Code 481516 and https://x/verify/SECRET', type: 'verification' }), true);
  const sent = resend.find((c) => c.url === 'https://api.resend.com/emails');
  assert.equal(sent.body.reply_to, 'hello@agentifyerp.co', 'replies to automated mail reach hello@');
  assert.equal(sent.body.from, 'Agentify ERP <noreply@agentifyerp.co>');
  const row = platformDb().prepare("SELECT * FROM platform_email_log WHERE to_addr='new.owner@acme.test'").get();
  assert.equal(row.type, 'verification'); assert.equal(row.status, 'queued'); assert.match(row.resend_email_id, /^em_/);
  assert.ok(!JSON.stringify(row).match(/481516|SECRET/), 'no code or link is stored');
  assert.equal(log.applyEvent(row.resend_email_id, 'email.delivered', '2026-10-23T10:00:01Z').status, 'delivered');
  assert.equal(log.applyEvent(row.resend_email_id, 'email.sent', '2026-10-23T10:00:00Z').status, 'delivered', 'a late earlier event does not move the status back');
  assert.equal(log.applyEvent('em_unknown', 'email.delivered', 'x'), null);
  assert.equal(log.getLog(row.id).events.length, 2);
  log.applyEvent(row.resend_email_id, 'email.bounced', '2026-10-23T10:05:00Z');
  assert.equal(log.getLog(row.id).status, 'bounced');
  await sendMail({ to: 'p@q.test', subject: 'Reset your password', text: 't', type: 'password_reset' });
  const l = await as(owner, 'GET', '/mailbox/log?status=bounced&type=verification&q=acme');
  assert.equal(l.data.total, 1); assert.equal(l.data.rows[0].to, 'new.owner@acme.test');
  assert.equal((await as(owner, 'GET', '/mailbox/log?type=password_reset')).data.total, 1);
  assert.equal((await as(owner, 'GET', '/mailbox/log?from=2999-01-01')).data.total, 0, 'date filter');
  assert.equal((await as(owner, 'GET', `/mailbox/log/${row.id}`)).data.events.at(-1).type, 'email.bounced');
  assert.equal((await as(owner, 'GET', '/mailbox/log/99999')).status, 404);
});

test('compose: only the company inboxes can send, never no-reply; addresses and attachments are checked; sends are audited', async () => {
  resend.length = 0;
  const send = (b) => as(owner, 'POST', '/mailbox/send', b);
  const noreply = await send({ inbox: 'noreply@agentifyerp.co', to: 'a@b.co', subject: 'x', html: '<p>hi</p>' });
  assert.equal(noreply.status, 400); assert.match(noreply.data.error, /no-reply/);
  assert.equal((await send({ inbox: 'someone@gmail.com', to: 'a@b.co', subject: 'x', html: '<p>hi</p>' })).status, 400, 'not one of our inboxes');
  assert.equal((await send({ inbox: 'hello@agentifyerp.co', to: 'not-an-address', subject: 'x', html: '<p>hi</p>' })).status, 400);
  assert.equal((await send({ inbox: 'hello@agentifyerp.co', to: 'a@b.co', subject: '', html: '<p>hi</p>' })).status, 400, 'subject needed');
  assert.equal((await send({ inbox: 'hello@agentifyerp.co', to: 'a@b.co', subject: 'x', html: '' })).status, 400, 'body needed');
  assert.throws(() => mb.attachmentsFrom([{ size: 21 * 1024 * 1024, buffer: Buffer.alloc(1), originalname: 'big.bin' }]), /20 MB/);
  assert.equal(mb.attachmentsFrom([{ size: 3, buffer: Buffer.from('abc'), originalname: '../x:y.txt', mimetype: 'text/plain' }])[0].filename, '.._x_y.txt');
  const ok = await send({ inbox: 'hello@agentifyerp.co', to: 'a@b.co, c@d.co', cc: 'e@f.co', subject: 'Hello there', html: '<p>Hi <script>alert(1)</script><b>team</b></p>' });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.from, 'hello@agentifyerp.co');
  const draftCall = resend.find((c) => c.url.endsWith('/drafts') && c.method === 'POST');
  assert.deepEqual(draftCall.body.to, ['a@b.co', 'c@d.co']);
  assert.ok(!/script|alert/.test(draftCall.body.html), 'the body is sanitised before it leaves');
  assert.ok(resend.some((c) => /\/drafts\/[^/]+\/send$/.test(c.url)));
  const audit = platformDb().prepare("SELECT detail FROM platform_audit WHERE action='mailbox-sent'").all();
  assert.equal(audit.length, 1); assert.match(audit[0].detail, /Hello there/);
  assert.ok(!audit[0].detail.includes('team'), 'the audit row holds no message body');
});

test('inbound HTML: scripts, handlers, forms, unsafe links and remote images are removed', () => {
  const dirty = '<p onclick="x()">Hi <a href="javascript:alert(1)">bad</a> <a href="https://ok.test/a?b=1&c=2">good</a> <a href=" JaVaScRiPt:alert(2)">bad2</a></p>'
    + '<script>alert(3)</script><style>body{display:none}</style><iframe src="https://evil.test"></iframe><form action="https://evil.test"><input name=p></form>'
    + '<img src="https://track.test/p.gif?u=1" alt="logo"><img src="data:image/png;base64,AAAA"><img src="javascript:x"><svg onload="x()"><circle/></svg>'
    + '<div style="color:red;background:url(https://track.test/x);position:fixed;font-size:14px">styled</div><table><tr><td colspan="2" onclick="x()">cell</td></tr></table>';
  const blocked = mb.sanitizeEmailHtml(dirty);
  assert.ok(!/<script|<style|<iframe|<form|<input|<svg|onclick|onload|javascript:|alert\(|track\.test|display:none|position/i.test(blocked), blocked);
  assert.match(blocked, /href="https:\/\/ok\.test\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow"/);
  assert.match(blocked, /\[remote image blocked: logo\]/);
  assert.match(blocked, /style="color: red; font-size: 14px"/);
  assert.match(blocked, /<td colspan="2">cell<\/td>/);
  const shown = mb.sanitizeEmailHtml(dirty, { images: true });
  assert.match(shown, /<img src="https:\/\/track\.test\/p\.gif\?u=1" alt="logo" referrerpolicy="no-referrer">/);
  assert.ok(!/data:image|javascript:/.test(shown), 'data: and javascript: images never load');
  assert.equal(mb.sanitizeEmailHtml('<p>unclosed <b>bold'), '<p>unclosed <b>bold</b></p>', 'tags are balanced');
  assert.equal(mb.sanitizeEmailHtml('a < b & "c" <3'), 'a &lt; b &amp; &quot;c&quot; &lt;3');
  assert.equal(mb.sanitizeEmailHtml('<p>x</p><!-- <script>y</script> -->'), '<p>x</p>');
  assert.equal(mb.sanitizeEmailHtml(null), '');
});

test('settings: the webhook address and Reply-To for automated mail are managed here and audited', async () => {
  const s = (await as(owner, 'GET', '/mailbox/settings')).data;
  assert.equal(s.configured, true); assert.match(s.webhook.url, /\/api\/platform\/webhooks\/resend$/); assert.equal(s.webhook.secret_saved, true);
  assert.deepEqual(s.inboxes.map((i) => [i.email, i.can_send]), [['hello@agentifyerp.co', true], ['admin@agentifyerp.co', true], ['noreply@agentifyerp.co', false]]);
  assert.equal(s.reply_to_default, 'hello@agentifyerp.co');
  assert.equal((await as(owner, 'PUT', '/mailbox/settings/reply-to', { reply_to: 'two@a.co, b@c.co' })).status, 400);
  assert.equal((await as(owner, 'PUT', '/mailbox/settings/reply-to', { reply_to: 'admin@agentifyerp.co' })).status, 200);
  resend.length = 0; await sendMail({ to: 'z@z.test', subject: 'S', text: 't', type: 'notification' });
  assert.equal(resend.find((c) => c.url === 'https://api.resend.com/emails').body.reply_to, 'admin@agentifyerp.co');
  assert.equal((await as(owner, 'PUT', `/mailbox/settings/inboxes/${INBOXES[2].id}`, { from_name: 'No Reply' })).status, 400, 'the no-reply sender cannot be edited here');
  const named = await as(owner, 'PUT', `/mailbox/settings/inboxes/${INBOXES[0].id}`, { from_name: 'Agentify ERP' });
  assert.equal(named.status, 200);
  assert.equal(resend.find((c) => c.method === 'PATCH' && c.url.endsWith(`/inboxes/${INBOXES[0].id}`)).body.from_name, 'Agentify ERP');
  assert.equal((await as(owner, 'PUT', `/mailbox/settings/inboxes/${INBOXES[0].id}`, { from_name: 'Bad <name>' })).status, 400);
  assert.ok(platformDb().prepare("SELECT COUNT(*) n FROM platform_audit WHERE action='mailbox-settings'").get().n >= 2);
});
