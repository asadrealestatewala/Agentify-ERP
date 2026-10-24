// Free website-only accounts: closed until a sites domain is set, served only from that domain, website builder only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-free-'));
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
process.env.ERP_SERVER_IP = '203.0.113.7';

const { createApp } = await import('../src/index.js');
const { platformDb, getTenantBySlug, withTenant } = await import('../src/platform.js');
const { setRegionStatus } = await import('../src/regions/admin.js');
const { saveFreeSites, freeSitesConfig, checkFreeSitesDns } = await import('../src/services/freeSites.js');
const { mayIssueCertificate } = await import('../src/integrations/domains.js');
const { run, get } = await import('../src/db.js');
const { issueVerification } = await import('../src/services/accessLinks.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, location: res.headers.location, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const signup = (o) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, region: 'US', sub_region: 'Texas', admin_name: 'Owner', admin_password: 'Tenant@12345', ...o });

test('closed until a sites domain is set and the switch is on; the domain must be separate from the app', async () => {
  setRegionStatus(platformDb(), 'US', 'active', 'tester');
  const closed = await signup({ product: 'website', slug: 'early', company_name: 'Early Site', admin_email: 'early@free.test' });
  assert.equal(closed.status, 403);
  assert.equal((await call('erp.test', 'GET', '/api/platform/site')).data.free_sites.open, false);
  assert.throws(() => saveFreeSites({ domain: '', open: true }, 't'), /Set the domain/);
  assert.throws(() => saveFreeSites({ domain: 'sites.erp.test', open: false }, 't'), /separate/);
  assert.throws(() => saveFreeSites({ domain: 'erp.test', open: false }, 't'), /separate/);
  assert.throws(() => saveFreeSites({ domain: 'not a domain', open: false }, 't'), /domain such as/);
  assert.equal((await signup({ product: 'website', slug: 'early', company_name: 'Early Site', admin_email: 'early@free.test' })).status, 403, 'a domain alone does not open signup');
  saveFreeSites({ domain: 'https://Sites.Test/', open: true }, 't');
  assert.equal(freeSitesConfig().domain, 'sites.test');
  assert.equal((await call('erp.test', 'GET', '/api/platform/site')).data.free_sites.domain, 'sites.test');
  assert.equal((await call('erp.test', 'GET', '/api/platform/admin/free-sites')).status, 401, 'the console setting needs a console sign-in');
});

test('a free website: own plan, website builder only, public only on the sites domain, live only after the email is confirmed', async () => {
  const su = await signup({ product: 'website', slug: 'fs1', company_name: 'Free Site One', admin_email: 'one@free.test' });
  assert.equal(su.status, 201, JSON.stringify(su.data));
  assert.equal(su.data.site_url, 'https://fs1.sites.test');
  const t = getTenantBySlug('fs1');
  assert.deepEqual([t.product, t.plan, t.subscription_status, t.trial_ends_at], ['website', 'site_free', 'active', null]);
  assert.equal((await signup({ product: 'website', slug: 'fs2', company_name: 'Another', admin_email: 'ONE@free.test' })).status, 409, 'one free website per email');

  const login = await call('fs1.erp.test', 'POST', '/api/auth/login', { identifier: 'one@free.test', password: 'Tenant@12345' });
  const c = { cookie: login.cookie };
  const st = (await call('fs1.erp.test', 'GET', '/api/billing/status', null, c)).data;
  assert.equal(st.product, 'website'); assert.deepEqual(st.products, []); assert.equal(st.locked, false);
  assert.equal((await call('fs1.erp.test', 'GET', '/api/site-admin/publish', null, c)).status, 200);
  for (const p of ['/api/contacts', '/api/properties', '/api/accounting/accounts', '/api/hrm/employees', '/api/dashboard/summary']) {
    const r = await call('fs1.erp.test', 'GET', p, null, c);
    assert.equal(r.status, 403, `${p} is not part of a free website`); assert.equal(r.data.code, 'free_site_only');
  }

  // nothing is public yet: offline, and publishing needs a confirmed email
  assert.equal((await call('fs1.sites.test', 'GET', '/api/site/bootstrap')).data.offline, true);
  const early = await call('fs1.erp.test', 'POST', '/api/site-admin/publish', {}, c);
  assert.equal(early.status, 403); assert.equal(early.data.code, 'email_not_verified');
  const token = withTenant(t, () => { const u = get('SELECT id FROM users WHERE lower(email)=?', 'one@free.test'); return issueVerification(u.id); });
  assert.equal((await call('fs1.erp.test', 'POST', '/api/auth/verify-email', { token })).status, 200);
  assert.equal((await call('fs1.erp.test', 'POST', '/api/site-admin/publish', {}, c)).status, 200);
  const live = (await call('fs1.sites.test', 'GET', '/api/site/bootstrap')).data;
  assert.ok(!live.offline && live.company, 'live on the sites domain after publishing');

  // the sites domain shows the website only
  const built = fs.existsSync(path.join(process.cwd(), '..', 'client', 'dist', 'index.html'));
  if (built) assert.equal((await call('fs1.sites.test', 'GET', '/site/')).status, 200);
  const login2 = await call('fs1.sites.test', 'GET', '/login');
  assert.equal(login2.status, 302); assert.match(login2.location, /^http.*fs1\.erp\.test|\/\/fs1\.erp\.test/);
  assert.equal((await call('fs1.sites.test', 'GET', '/api/contacts')).status, 404);
  assert.equal((await call('fs1.sites.test', 'POST', '/api/auth/login', { identifier: 'one@free.test', password: 'Tenant@12345' })).status, 404, 'no sign-in on the sites domain');
  // the app address sends visitors to the sites domain; private previews stay on the app address
  const onApp = await call('fs1.erp.test', 'GET', '/site/p/about');
  assert.equal(onApp.status, 302); assert.equal(onApp.location, 'https://fs1.sites.test/site/p/about');
  if (built) assert.equal((await call('fs1.erp.test', 'GET', '/site/?preview=abc')).status, 200);
});

test('only free websites exist on the sites domain; unknown names and the bare domain never show the app', async () => {
  const su = await signup({ product: 'real_estate', slug: 'rea', company_name: 'Real Co', admin_email: 'rea@free.test' });
  assert.equal(su.status, 201);
  assert.equal((await call('rea.sites.test', 'GET', '/site')).status, 404, 'a normal workspace is not served on the sites domain');
  assert.equal((await call('nope.sites.test', 'GET', '/')).status, 404);
  const apex = await call('sites.test', 'GET', '/');
  assert.equal(apex.status, 302); assert.equal(apex.location, 'https://erp.test/');
  assert.equal((await call('erp.test', 'GET', '/api/platform/site')).data.landing, true, 'the marketing site is unaffected');
});

test('certificates are approved only for real free websites on the sites domain', () => {
  assert.equal(mayIssueCertificate('fs1.sites.test'), true);
  assert.equal(mayIssueCertificate('sites.test'), true);
  assert.equal(mayIssueCertificate('nope.sites.test'), false);
  assert.equal(mayIssueCertificate('rea.sites.test'), false);
  assert.equal(mayIssueCertificate('evil.example'), false);
});

test('DNS check compares the wildcard and bare domain with this server', async () => {
  const fake = (m) => ({ resolve4: async (h) => { if (m[h]) return m[h]; if (m['*'] && h.endsWith('.sites.test')) return m['*']; throw new Error('ENOTFOUND'); } });
  const ok = await checkFreeSitesDns(fake({ '*': ['203.0.113.7'], 'sites.test': ['203.0.113.7'] }));
  assert.deepEqual([ok.wildcard_ok, ok.apex_ok], [true, true]);
  const bad = await checkFreeSitesDns(fake({ 'sites.test': ['198.51.100.1'] }));
  assert.deepEqual([bad.wildcard_ok, bad.apex_ok], [false, false]);
});

test('paying workspaces keep their own subdomain and can attach their own domain to it', async () => {
  const { resolver, records, requestDomain, verifyDomain } = await import('../src/integrations/domains.js');
  const su = await signup({ product: 'real_estate', slug: 'paid1', company_name: 'Paid Realty', admin_email: 'paid@free.test' });
  assert.equal(su.status, 201);
  assert.equal((await call('paid1.erp.test', 'GET', '/api/platform/site')).status, 200, 'the workspace answers at <name>.<app domain>');
  const t = getTenantBySlug('paid1');
  assert.equal(mayIssueCertificate('paid1.erp.test'), true);
  requestDomain(t, 'www.paidrealty.example');
  const rec = records(t);
  const cname = rec.records.find((x) => x.type === 'CNAME');
  assert.equal(cname.value, 'paid1.erp.test', 'the customer domain points at the workspace subdomain');
  assert.equal(mayIssueCertificate('www.paidrealty.example'), false, 'no certificate before the domain is verified');
  const old = { ...resolver };
  resolver.txt = async () => [[rec.records.find((x) => x.type === 'TXT').value]];
  resolver.cname = async () => ['paid1.erp.test.'];
  try { await verifyDomain(t); } finally { Object.assign(resolver, old); }
  assert.equal(mayIssueCertificate('www.paidrealty.example'), true, 'certificate allowed once verified');
  assert.throws(() => requestDomain(t, 'x.sites.test'), /ours/, 'a paying workspace cannot take a name under the free-sites domain');
});

test('builder presets: Webflow, Wix and Squarespace steps are served, with the right snippet kind and the form address', async () => {
  const { PRESETS } = await import('../src/services/presets.js');
  assert.deepEqual(Object.keys(PRESETS).sort(), ['squarespace', 'webflow', 'wix']);
  assert.equal(PRESETS.wix.snippet, 'iframe', 'Wix HTML embeds are framed by Wix, so Wix uses the address-based embed');
  for (const p of Object.values(PRESETS)) { assert.ok(p.steps.length >= 3 && p.allow.length && p.summary); }
});
