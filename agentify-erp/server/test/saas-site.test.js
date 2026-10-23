// Marketing site API, legal documents, demo requests, SEO on the main domain, analytics consent, and neutral website
// defaults for new workspaces (no data from the original company).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-site-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'root@agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual', PUBLIC_FORM_LIMIT: '1000' });
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { platformDb, getTenantBySlug, withTenant } = await import('../src/platform.js');
const db = await import('../src/db.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); db.closeDbs(); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, text: t, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0], headers: res.headers }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
let root;
const adm = (m, u, b) => call(P, m, `/api/platform/admin${u}`, b, { cookie: root });

test('marketing API: products, plans per family, honest defaults, main domain only', async () => {
  root = (await call(P, 'POST', '/api/platform/admin/login', { email: 'root@agentify.test', password: 'Console@12345' })).cookie;
  const m = await call(P, 'GET', '/api/platform/marketing');
  assert.equal(m.status, 200);
  assert.deepEqual(Object.keys(m.data.products), ['real_estate', 'construction']);
  assert.ok(m.data.plans.some((p) => p.product === 'construction') && m.data.plans.some((p) => p.product === 'real_estate'));
  assert.deepEqual(m.data.content.testimonials, [], 'no invented testimonials');
  assert.equal(m.data.trial_days, 7);
  assert.ok(m.data.content.legal.every((d) => d.status === 'draft'));
  assert.equal((await call('acme.erp.test', 'GET', '/api/platform/marketing')).status, 404);
  // testimonials need a named person, company and permission
  assert.equal((await adm('PUT', '/marketing', { testimonials: [{ quote: 'Great', name: '', company: '' }] })).status, 400);
  const ok = await adm('PUT', '/marketing', { hero_title: 'Manage property and construction', testimonials: [{ quote: 'Saved us hours', name: 'A. Customer', company: 'Real Co', permission: true }] });
  assert.equal(ok.status, 200);
  assert.equal((await call(P, 'GET', '/api/platform/marketing')).data.content.hero_title, 'Manage property and construction');
});

test('legal documents: drafts until a named reviewer publishes them; placeholders block publishing; versions kept', async () => {
  const d = await call(P, 'GET', '/api/platform/legal/terms');
  assert.equal(d.data.status, 'draft'); assert.match(d.data.body, /\[Company legal name\]/);
  assert.equal((await adm('POST', '/legal/terms/publish', { reviewed_by: 'Counsel' })).status, 400, 'placeholders must be replaced first');
  const body = '## Terms\nThese are the reviewed terms of Agentify ERP Ltd.';
  assert.equal((await adm('PUT', '/legal/terms', { body })).status, 200);
  assert.equal((await adm('POST', '/legal/terms/publish', {})).status, 400, 'a reviewer is required');
  const pub = await adm('POST', '/legal/terms/publish', { reviewed_by: 'Jane Counsel, Advocate' });
  assert.equal(pub.status, 200); assert.equal(pub.data.version, 1);
  assert.equal((await call(P, 'GET', '/api/platform/legal/terms')).data.status, 'published');
  // editing again makes a draft, but the public keeps seeing version 1
  await adm('PUT', '/legal/terms', { body: `${body}\nNew clause in progress.` });
  const live = (await call(P, 'GET', '/api/platform/legal/terms')).data;
  assert.equal(live.version, 1); assert.ok(!live.body.includes('New clause'));
  // signups record the accepted version
  assert.equal((await call(P, 'POST', '/api/platform/signup', { slug: 'noterms', company_name: 'X', admin_email: 'x@noterms.test', admin_password: 'Tenant@12345' })).status, 400, 'terms must be accepted');
  const s = await call(P, 'POST', '/api/platform/signup', { accept_terms: true, slug: 'acme', company_name: 'Acme Build', admin_name: 'Owner', admin_email: 'o@acme.test', admin_password: 'Tenant@12345', product: 'construction' });
  assert.equal(s.status, 201);
  const t = platformDb().prepare("SELECT terms_version, terms_accepted_at FROM tenants WHERE slug='acme'").get();
  assert.equal(t.terms_version, 1); assert.ok(t.terms_accepted_at);
});

test('a new workspace gets a neutral website: nothing from the original company', async () => {
  const t = getTenantBySlug('acme');
  const dump = withTenant(t, () => JSON.stringify({ cfg: db.getSetting('site_config'), pages: db.all('SELECT * FROM site_pages'), kb: db.all('SELECT * FROM bot_kb') }));
  for (const marker of ['Expert Marketing', 'Raja Usman', '0300-5551350', 'expertdevelopers', 'Chakri Road', '200+', 'Muhammad Ali']) assert.ok(!dump.includes(marker), `no "${marker}"`);
  assert.ok(dump.includes('Acme Build'));
  const pub = await call('acme.erp.test', 'GET', '/api/site/config');
  assert.ok(!JSON.stringify(pub.data).includes('Expert Marketing'));
});

test('demo requests: stored, honeypot ignored, listed in the console', async () => {
  assert.equal((await call(P, 'POST', '/api/platform/demo-request', { name: 'Bot', email: 'bot@x.test', website: 'http://spam' })).status, 201);
  assert.equal((await call(P, 'POST', '/api/platform/demo-request', { name: 'Z', email: 'not-an-email' })).status, 400);
  assert.equal((await call(P, 'POST', '/api/platform/demo-request', { name: 'Hamza', email: 'hamza@builders.test', company: 'Builders', product: 'construction', message: 'Please show BOQs' })).status, 201);
  const list = (await adm('GET', '/demo-requests')).data;
  assert.equal(list.length, 1); assert.equal(list[0].product, 'construction');
  assert.equal((await adm('PATCH', `/demo-requests/${list[0].id}`, { status: 'contacted', note: 'Called' })).data.status, 'contacted');
});

test('SEO on the main domain: sitemap, robots, server-rendered meta tags', async () => {
  const sm = await call(P, 'GET', '/sitemap.xml');
  assert.equal(sm.status, 200); assert.match(sm.text, /<loc>https?:\/\/erp\.test(:\d+)?\/pricing<\/loc>/); assert.match(sm.text, /\/construction</);
  const rb = await call(P, 'GET', '/robots.txt');
  assert.match(rb.text, /Disallow: \/platform/); assert.match(rb.text, /Sitemap: /);
  const dist = path.join(process.cwd(), '..', 'client', 'dist', 'index.html');
  if (fs.existsSync(dist)) {
    const page = await call(P, 'GET', '/construction');
    assert.match(page.text, /<title>Construction Management software \| Agentify ERP<\/title>/);
    assert.match(page.text, /<link rel="canonical" href="https?:\/\/erp\.test(:\d+)?\/construction"/);
    assert.match(page.text, /property="og:title"/);
  }
});

test('analytics: nothing stored without consent or with Do Not Track; consented events feed the dashboard', async () => {
  const ev = { visitor_id: 'v_abcdefgh12', session_id: 's_abcdefgh12', events: [{ name: 'page_view', path: '/pricing?x=1', landing_page: '/', referrer: 'https://www.google.com/search?q=erp' }] };
  assert.equal((await call(P, 'POST', '/api/platform/analytics/collect', ev)).data.stored, 0, 'no consent');
  assert.equal((await call(P, 'POST', '/api/platform/analytics/collect', { ...ev, consent: true }, { DNT: '1' })).data.stored, 0, 'Do Not Track');
  assert.equal((await call(P, 'POST', '/api/platform/analytics/collect', { ...ev, consent: true }, { 'Sec-GPC': '1' })).data.stored, 0, 'Global Privacy Control');
  assert.equal((await call(P, 'POST', '/api/platform/analytics/collect', { ...ev, consent: true })).data.stored, 1);
  await call(P, 'POST', '/api/platform/analytics/collect', { ...ev, consent: true, events: [{ name: 'evil_event', path: '/' }, { name: 'pricing_view', path: '/pricing' }] });
  const row = platformDb().prepare("SELECT * FROM analytics_events WHERE name='page_view'").get();
  assert.equal(row.path, '/pricing', 'query strings dropped'); assert.equal(row.channel, 'Organic search'); assert.equal(row.referrer_host, 'google.com');
  assert.ok(!platformDb().prepare("SELECT 1 FROM analytics_events WHERE name='evil_event'").get());
  const a = await adm('GET', '/analytics?range=7d');
  assert.equal(a.status, 200);
  assert.equal(a.data.visitors, 1); assert.equal(a.data.sessions, 1); assert.ok(a.data.funnel.signup_completed >= 1, 'server-side signups counted');
  assert.match(a.data.note, /accepted analytics/);
});

test('partner logos: none by default; each needs a name, a real image and written permission; only permitted ones are public', async () => {
  assert.deepEqual((await call(P, 'GET', '/api/platform/marketing')).data.content.partners, [], 'no invented partners');
  const logo = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString('base64')}`;
  const put = (partners) => adm('PUT', '/marketing', { partners });
  assert.equal((await put([{ name: 'Acme Realty', country: 'US', logo, permission: false }])).status, 400, 'permission required');
  assert.equal((await put([{ name: 'Acme Realty', country: 'US', logo: 'http://x.test/a.png', permission: true }])).status, 400, 'https or an uploaded image only');
  assert.equal((await put([{ name: 'Acme Realty', country: 'US', logo: 'javascript:alert(1)', permission: true }])).status, 400);
  assert.equal((await put([{ name: '', country: 'US', logo, permission: true }])).status, 400, 'a name is required');
  assert.equal((await put([{ name: 'Acme Realty', country: 'US', logo: `data:image/png;base64,${'A'.repeat(60000)}`, permission: true }])).status, 400, 'too large');
  const ok = await put([{ name: 'Acme Realty', country: 'us', logo, url: 'https://acme.test', permission: true }]);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const pub = (await call(P, 'GET', '/api/platform/marketing')).data.content.partners;
  assert.equal(pub.length, 1); assert.equal(pub[0].country, 'US'); assert.equal(pub[0].name, 'Acme Realty');
  assert.equal((await put([])).status, 200);
  assert.deepEqual((await call(P, 'GET', '/api/platform/marketing')).data.content.partners, []);
});

test('customer reviews: anyone can submit, nothing shows until approved, photos are checked, only the console decides', async () => {
  const post = (b) => call(P, 'POST', '/api/platform/reviews', b);
  const good = { name: 'Dana Ruiz', role: 'Broker', company: 'Ruiz Realty', country: 'us', rating: 5, quote: 'Follow-ups and receipts are finally in one place for our whole team.', email: 'dana@ruiz.test', consent: true };
  assert.equal((await post({ ...good, consent: false })).status, 400, 'consent needed');
  assert.equal((await post({ ...good, quote: 'too short' })).status, 400);
  assert.equal((await post({ ...good, quote: 'Great, see https://spam.test for more details please' })).status, 400, 'no links');
  assert.equal((await post({ ...good, rating: 9 })).status, 400);
  assert.equal((await post({ ...good, email: 'nope' })).status, 400);
  assert.equal((await post({ ...good, photo: 'data:image/png;base64,AAAA' })).status, 400, 'not a real image');
  assert.equal((await post({ ...good, photo: `data:image/png;base64,${Buffer.alloc(70000, 1).toString('base64')}` })).status, 400, 'too large');
  assert.equal((await post({ ...good, website: 'http://bot.test' })).status, 201, 'honeypot answers ok but stores nothing');
  assert.equal((await adm('GET', '/reviews')).data.counts.pending, 0);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);
  assert.equal((await post({ ...good, photo: `data:image/png;base64,${png.toString('base64')}` })).status, 201);
  assert.deepEqual((await call(P, 'GET', '/api/platform/marketing')).data.content.reviews, [], 'pending reviews are not public');
  const list = (await adm('GET', '/reviews?status=pending')).data;
  assert.equal(list.rows.length, 1); assert.equal(list.rows[0].has_photo, true); assert.equal(list.rows[0].email, 'dana@ruiz.test');
  const id = list.rows[0].id;
  assert.equal((await call(P, 'GET', `/api/platform/reviews/${id}/photo`)).status, 404, 'photo of a pending review is not public');
  assert.equal((await call(P, 'GET', `/api/platform/admin/reviews/${id}/photo`, null, { cookie: root })).status, 200, 'console can preview it');
  assert.equal((await call(P, 'POST', `/api/platform/admin/reviews/${id}/approve`)).status, 401, 'sign-in required');
  assert.equal((await adm('POST', `/reviews/${id}/approve`)).data.status, 'approved');
  const pub = (await call(P, 'GET', '/api/platform/marketing')).data.content.reviews;
  assert.equal(pub.length, 1); assert.equal(pub[0].name, 'Dana Ruiz'); assert.equal(pub[0].country, 'US'); assert.ok(!('email' in pub[0]), 'e-mail is never public');
  assert.equal((await call(P, 'GET', pub[0].photo)).status, 200);
  assert.equal((await adm('POST', `/reviews/${id}/reject`)).data.status, 'rejected');
  assert.deepEqual((await call(P, 'GET', '/api/platform/marketing')).data.content.reviews, []);
  assert.equal((await adm('DELETE', `/reviews/${id}`)).status, 200);
  assert.equal((await adm('DELETE', `/reviews/${id}`)).status, 404);
  assert.equal((await call('acme.erp.test', 'POST', '/api/platform/reviews', good)).status, 404, 'main domain only');
});
