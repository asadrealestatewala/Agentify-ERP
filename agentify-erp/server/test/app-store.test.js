// Google Play readiness on the server: public deletion request, privacy template, Play link setting, and who may see the app download.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-appstore-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'root@agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', ERP_PLATFORM_ADMIN_TOKEN: 'operator-secret', BILLING_PROVIDER: 'manual', PUBLIC_FORM_LIMIT: '1000' });
delete process.env.RESEND_API_KEY;

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { outbox } = await import('../src/services/mailer.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, agent: false, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, text: t, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
const PW = 'Tenant@12345';
const OP = { authorization: 'Bearer operator-secret' };

async function workspace(slug) {
  const r = await call(P, 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Co`, admin_name: 'Owner', admin_email: `owner@${slug}.test`, admin_password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const host = `${slug}.erp.test`;
  const tok = outbox.filter((m) => m.to === `owner@${slug}.test`).pop().text.match(/verify-email\/(\S+)/)[1];
  await call(host, 'POST', '/api/auth/verify-email', { token: tok });
  const l = await call(host, 'POST', '/api/auth/login', { identifier: `owner@${slug}.test`, password: PW });
  return { id: r.data.tenant.id, get: (u) => call(host, 'GET', u, null, { cookie: l.cookie }) };
}

test('public account-deletion request is accepted without sign-in, validated and rate-safe', async () => {
  assert.equal((await call(P, 'POST', '/api/platform/deletion-request', { email: 'nope' })).status, 400);
  assert.equal((await call(P, 'POST', '/api/platform/deletion-request', { email: 'bot@x.test', website: 'spam' })).status, 201);
  assert.equal(platformDb().prepare("SELECT COUNT(*) n FROM platform_notifications WHERE title LIKE 'Account deletion request%'").get().n, 0, 'honeypot creates nothing');
  const ok = await call(P, 'POST', '/api/platform/deletion-request', { email: 'Person@Firm.test', workspace: 'firm', reason: 'closing' });
  assert.equal(ok.status, 201);
  assert.equal(platformDb().prepare("SELECT COUNT(*) n FROM platform_notifications WHERE title='Account deletion request from person@firm.test'").get().n, 1);
  assert.equal((await call('acme.erp.test', 'POST', '/api/platform/deletion-request', { email: 'a@b.test' })).status, 404, 'main domain only');
  const page = await call(P, 'GET', '/delete-account');
  assert.equal(page.status, 200);
  assert.match(page.text, /Delete your account/);
});

test('privacy template covers the apps and points to the deletion page', async () => {
  const d = await call(P, 'GET', '/api/platform/legal/privacy');
  assert.equal(d.status, 200);
  for (const w of ['Location', 'microphone', '/delete-account', 'controller', 'processor']) assert.ok(d.data.body.includes(w), w);
  assert.equal(d.data.status, 'draft', 'still a draft until a reviewer publishes it');
});

test('Google Play link must be a play.google.com address and is shown publicly', async () => {
  const root = (await call(P, 'POST', '/api/platform/admin/login', { email: 'root@agentify.test', password: 'Console@12345' })).cookie;
  const put = (v) => call(P, 'PUT', '/api/platform/admin/marketing', { android_store_url: v }, { cookie: root });
  assert.equal((await call(P, 'GET', '/api/platform/marketing')).data.content.android_store_url, '');
  assert.equal((await put('https://evil.example/app')).status, 400);
  assert.equal((await put('http://play.google.com/x')).status, 400);
  const url = 'https://play.google.com/store/apps/details?id=co.agentifyerp.app';
  assert.equal((await put(url)).status, 200);
  assert.equal((await call(P, 'GET', '/api/platform/marketing')).data.content.android_store_url, url);
});

test('the app download links are only given to paying workspaces', async () => {
  const w = await workspace('trialapp');
  const trial = (await w.get('/api/billing/status')).data;
  assert.equal(trial.status, 'trialing'); assert.equal(trial.app, null, 'a trial does not get the app download');
  assert.equal((await call(P, 'POST', `/api/platform/tenants/${w.id}/subscription`, { plan: 'starter', period_end: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }, OP)).status, 200);
  const paid = (await w.get('/api/billing/status')).data;
  assert.equal(paid.status, 'active');
  assert.ok(paid.app?.apk_url.endsWith('/downloads/agentify-erp.apk'));
  assert.match(paid.app.android_store_url, /^https:\/\/play\.google\.com\//);
});
