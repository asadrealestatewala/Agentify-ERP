// The Resend adapter and the console's connection panel, exercised against RECORDED-SHAPE HTTP (a stubbed fetch that checks the
// method, path, headers and body we send and answers with Resend-shaped JSON). Nothing reaches the network or a real account.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-resend-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_MAIL_QUIET = '1';
delete process.env.RESEND_API_KEY;

const P = await import('../src/platform.js');
P.bootstrapTenants?.();
const { setSetting, getSetting } = await import('../src/services/platformConfig.js');
const prov = await import('../src/services/emailProvider.js');
const conn = await import('../src/services/resendConnection.js');
const db = await import('../src/db.js');
after(() => db.closeDbs());

const realFetch = globalThis.fetch;
const calls = [];
const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
let routes = {};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  calls.push({ method: init.method, path: u.pathname + u.search, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
  const h = routes[`${init.method} ${u.pathname}`];
  return h ? h(init) : reply(404, { name: 'not_found', message: 'no route' });
};
after(() => { globalThis.fetch = realFetch; });
const SECRET_KEY = 're_test_key_1234567890abcd';

test('adapter: sends the documented requests with the key and idempotency header, and maps errors to actionable kinds', async () => {
  setSetting('resend_api_key', SECRET_KEY, { secret: true, by: 't' });
  routes = { 'POST /emails': () => reply(200, { id: 'em_1' }), 'GET /domains': () => reply(200, { data: [{ id: 'd1', name: 'mail.example.com', status: 'verified' }] }) };
  const out = await prov.resendProvider.send({ from: 'A <a@mail.example.com>', to: 'x@y.test', subject: 'S', text: 't', html: '<p>t</p>', replyTo: 'reply+1.sig@r.example.com', headers: { 'List-Unsubscribe': '<u>' }, tags: [{ name: 'workspace', value: '1' }] }, { idempotencyKey: 'key-1' });
  assert.equal(out.id, 'em_1');
  const c = calls.at(-1);
  assert.equal(c.method, 'POST'); assert.equal(c.path, '/emails');
  assert.equal(c.headers.Authorization, `Bearer ${SECRET_KEY}`); assert.equal(c.headers['Idempotency-Key'], 'key-1');
  assert.deepEqual(c.body.to, ['x@y.test']); assert.equal(c.body.reply_to, 'reply+1.sig@r.example.com'); assert.equal(c.body.headers['List-Unsubscribe'], '<u>');
  // error mapping
  routes['POST /emails'] = () => reply(429, { message: 'slow' }, { 'retry-after': '12' });
  await assert.rejects(prov.resendProvider.send({ from: 'a', to: 'b', subject: 's' }, { idempotencyKey: 'k2' }), (e) => e.kind === 'rate_limited' && e.retryAfterSec === 12);
  routes['POST /emails'] = () => reply(422, { name: 'validation_error', message: 'The from address is not verified' });
  await assert.rejects(prov.resendProvider.send({ from: 'a', to: 'b', subject: 's' }, { idempotencyKey: 'k3' }), (e) => e.kind === 'definitive' && /not verified/.test(e.message));
  routes['POST /emails'] = () => reply(503, { message: 'down' });
  await assert.rejects(prov.resendProvider.send({ from: 'a', to: 'b', subject: 's' }, { idempotencyKey: 'k4' }), (e) => e.kind === 'ambiguous');
  routes['GET /domains'] = () => reply(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' });
  await assert.rejects(prov.resendProvider.listDomains(), (e) => e.kind === 'restricted_key' && /full access/.test(e.message));
  routes['GET /domains'] = () => reply(401, { name: 'invalid_api_key', message: 'API key is invalid' });
  await assert.rejects(prov.resendProvider.listDomains(), (e) => e.kind === 'config');
});

test('connection test: reports each capability separately, never returns the key, and stores the result', async () => {
  routes = {
    'GET /domains': () => reply(200, { data: [{ id: 'd1', status: 'verified' }, { id: 'd2', status: 'pending' }] }),
    'GET /webhooks': () => reply(200, { data: [] }),
    'GET /usage': () => reply(200, { emails: { monthly: { used: 12, limit: 3000 } } }),
  };
  const r = await conn.testConnection('owner@console.test');
  assert.equal(r.ok, true);
  assert.deepEqual([r.checks.domains.count, r.checks.domains.verified], [2, 1]);
  assert.ok(!JSON.stringify(r).includes(SECRET_KEY) && !JSON.stringify(conn.connectionStatus('https://x.example')).includes(SECRET_KEY));
  assert.equal(conn.connectionStatus('https://x.example').key.last4, SECRET_KEY.slice(-4));
  // a send-only key: domains/webhooks/usage fail with a plain explanation
  routes = { 'GET /domains': () => reply(401, { name: 'restricted_api_key', message: 'restricted' }), 'GET /webhooks': () => reply(401, { name: 'restricted_api_key', message: 'restricted' }), 'GET /usage': () => reply(401, { name: 'restricted_api_key', message: 'restricted' }) };
  const bad = await conn.testConnection('owner@console.test');
  assert.equal(bad.ok, false); assert.match(bad.summary, /only send email/);
  // no key at all
  setSetting('resend_api_key', null, { secret: true, by: 't' });
  await assert.rejects(conn.testConnection('x'), /Save your Resend API key/);
  setSetting('resend_api_key', SECRET_KEY, { secret: true, by: 't' });
});

test('webhook registration: creates our endpoint once, stores the signing secret encrypted, refuses non-public addresses', async () => {
  let created = 0;
  routes = {
    'GET /webhooks': () => reply(200, { data: calls.length && created ? [{ id: 'wh_1', endpoint: 'https://erp.example.com/api/platform/webhooks/resend' }] : [] }),
    'POST /webhooks': (init) => { created++; const b = JSON.parse(init.body); assert.equal(b.endpoint, 'https://erp.example.com/api/platform/webhooks/resend'); assert.ok(b.events.includes('email.received') && b.events.includes('email.bounced') && !b.events.includes('email.opened') && !b.events.includes('email.clicked')); return reply(201, { id: 'wh_1', signing_secret: 'whsec_AbCdEfGhIjKlMnOpQrStUvWx' }); },
  };
  await assert.rejects(conn.registerWebhook('http://localhost:4000', 'op'), /public https/);
  const r = await conn.registerWebhook('https://erp.example.com', 'op');
  assert.equal(r.created, true); assert.equal(r.needs_secret, false);
  assert.equal(getSetting('resend_webhook_secret'), 'whsec_AbCdEfGhIjKlMnOpQrStUvWx');
  const raw = P.platformDb().prepare("SELECT value, secret FROM platform_settings WHERE key='resend_webhook_secret'").get();
  assert.equal(raw.secret, 1); assert.ok(!raw.value.includes('whsec_'), 'encrypted at rest');
  assert.ok(!JSON.stringify(r).includes('whsec_'));
  const again = await conn.registerWebhook('https://erp.example.com', 'op');
  assert.equal(again.created, false); assert.equal(created, 1, 'a second click does not create a second webhook');
  // the provider did not return a secret: say what to do instead of guessing
  setSetting('resend_webhook_secret', null, { secret: true, by: 't' });
  routes['GET /webhooks'] = () => reply(200, { data: [] });
  routes['POST /webhooks'] = () => reply(201, { id: 'wh_2' });
  const noSecret = await conn.registerWebhook('https://erp.example.com', 'op');
  assert.equal(noSecret.needs_secret, true); assert.match(noSecret.note, /whsec_/);
});
