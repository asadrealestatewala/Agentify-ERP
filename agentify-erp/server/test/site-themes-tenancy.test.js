import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-themes-tenancy-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_PLATFORM_ADMIN_TOKEN = 'operator-secret';
process.env.ERP_DEMO = '0';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.LOGIN_LIMIT = '1000';
process.env.SIGNUP_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

/** HTTP call to a given host name (the test server is on localhost; the Host header picks the tenant). */
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

async function login(host, identifier, password) {
  const l = await call(host, 'POST', '/api/auth/login', { identifier, password });
  assert.equal(l.status, 200, `login on ${host}: ${JSON.stringify(l.data)}`);
  const c = l.cookie;
  return { c, get: (u) => call(host, 'GET', u, null, { cookie: c }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }), me: l.data };
}

const signup = (slug, email, extra = {}) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', ...extra });


const { SITE_THEMES } = await import('../../shared/siteThemes.js');
const { DEMO_PHOTOS, DEMO_NAMED } = await import('../../client/src/site/demoContent.js');
const { THEME_BUILD_KEYS } = await import('../../shared/siteThemes.js');

const sectionsOf = (theme, slug) => theme.pages.find((p) => p.slug === slug).blocks.map((b, i) => {
  const props = Object.fromEntries(Object.entries(b.props).filter(([k]) => !THEME_BUILD_KEYS.includes(k)));
  if (b.props.photo !== undefined && ['hero', 'imagetext', 'cta'].includes(b.type)) props.image = (theme.samplePhotos ? null : DEMO_NAMED[b.props.demo]) || (theme.samplePhotos || DEMO_PHOTOS)[b.props.photo % (theme.samplePhotos || DEMO_PHOTOS).length];
  if (b.type === 'gallery') props.images = (theme.samplePhotos || DEMO_PHOTOS).slice(0, b.props.photos || 6).map((src) => ({ src, caption: '' }));
  return { id: `${theme.id}-${slug}-${i}`, type: b.type, props };
});
const installAll = (a, id) => { const t = SITE_THEMES.find((x) => x.id === id); return a.post(`/api/site-admin/themes/${id}/install`, { design: true, pages: t.pages.map((p) => ({ slug: p.slug, mode: p.slug === 'home' ? 'replace' : 'add', sections: sectionsOf(t, p.slug) })) }); };
const SAMPLE_WORDS = ['Modern family home with garden', 'Sample Agent', 'Five things to check before you buy', 'Sample listings'];

test('a new workspace installs and publishes a new theme with no listings: visitors see no invented inventory', async () => {
  assert.equal((await signup('acme', 'owner@acme.test')).status, 201);
  assert.equal((await signup('beta', 'owner@beta.test')).status, 201);
  const a = await login('acme.erp.test', 'owner@acme.test', 'Tenant@12345');
  for (const id of ['horizon', 'urban']) {
    assert.equal((await installAll(a, id)).status, 200, id);
    assert.equal((await a.post('/api/site-admin/publish', { label: id })).status, 200);
    // what visitors receive: the pages' own words, never sample listings, agents or articles
    const pages = SITE_THEMES.find((t) => t.id === id).pages;
    for (const p of pages) {
      const r = await call('acme.erp.test', 'GET', `/api/site/pages/${p.slug}`);
      assert.equal(r.status, 200, `${id}/${p.slug} is live after Publish`);
      for (const w of SAMPLE_WORDS) assert.equal(JSON.stringify(r.data).includes(w), false, `${id}/${p.slug} must not carry "${w}"`);
    }
    assert.equal((await call('acme.erp.test', 'GET', '/api/site/listings?limit=50')).data.total, 0, 'no listings: none shown');
    assert.deepEqual((await call('acme.erp.test', 'GET', '/api/site/agents')).data.data.filter((x) => x.sample), []);
    assert.equal((await call('acme.erp.test', 'GET', '/api/site/posts')).data.data.length, 0);
  }
});

test('listings reach a theme\'s blocks only when published, and leave when unpublished or deleted', async () => {
  const a = await login('acme.erp.test', 'owner@acme.test', 'Tenant@12345');
  const listings = async () => (await call('acme.erp.test', 'GET', '/api/site/listings?limit=50')).data;
  const made = await a.post('/api/properties', { title: 'Theme test house', property_type: 'Houses', purpose: 'Sell', total_price: 9_000_000, city: 'Testville' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.id;
  assert.equal((await listings()).total, 0, 'a draft is not shown');
  assert.equal((await call('acme.erp.test', 'GET', `/api/site/listings/${id}`)).status, 404);
  assert.equal((await a.post(`/api/properties/${id}/publish`)).status, 200);
  assert.equal((await listings()).total, 1, 'a published listing is shown');
  assert.equal((await a.post(`/api/properties/${id}/unpublish`)).status, 200);
  assert.equal((await listings()).total, 0, 'an unpublished listing disappears');
  assert.equal((await a.post(`/api/properties/${id}/publish`)).status, 200);
  assert.equal((await listings()).total, 1);
  assert.equal((await call('acme.erp.test', 'DELETE', `/api/properties/${id}`, null, { cookie: a.c })).status, 400, 'a published listing cannot be deleted');
  // a draft that is deleted never reaches visitors, and a listing that was published cannot be deleted from under a live page
  const draft = (await a.post('/api/properties', { title: 'Theme test draft', property_type: 'Houses', purpose: 'Rent', total_price: 100_000, city: 'Testville' })).data.id;
  assert.equal((await listings()).total, 1, 'a second draft is not shown');
  assert.equal((await call('acme.erp.test', 'DELETE', `/api/properties/${draft}`, null, { cookie: a.c })).status, 200);
  assert.equal((await call('acme.erp.test', 'GET', `/api/site/listings/${draft}`)).status, 404, 'a deleted record is gone');
  assert.equal((await a.post(`/api/properties/${id}/unpublish`)).status, 200);
  assert.equal((await listings()).total, 0);
  assert.equal((await call('acme.erp.test', 'GET', `/api/site/listings/${id}`)).status, 404, 'an unpublished record is gone from the site');
});

test('one workspace\'s theme, pages and settings are invisible to and untouchable by another', async () => {
  const a = await login('acme.erp.test', 'owner@acme.test', 'Tenant@12345');
  const b = await login('beta.erp.test', 'owner@beta.test', 'Tenant@12345');
  assert.equal((await a.get('/api/site-admin/config')).data.active_theme, 'urban');
  assert.notEqual((await b.get('/api/site-admin/config')).data.active_theme, 'urban', 'installing in acme does not touch beta');
  const bPages = (await b.get('/api/site-admin/pages')).data.map((p) => p.slug);
  for (const slug of ['collection', 'developments', 'buy', 'rent', 'neighbourhoods']) assert.equal(bPages.includes(slug), false, `beta has no ${slug} page`);
  assert.equal((await call('beta.erp.test', 'GET', '/api/site/pages/buy')).status, 404);
  assert.equal((await call('acme.erp.test', 'GET', '/api/site/pages/buy')).status, 200);
  // acme's session cannot install into or read from beta
  assert.equal((await call('beta.erp.test', 'GET', '/api/site-admin/config', null, { cookie: a.c })).status, 401);
  assert.equal((await call('beta.erp.test', 'POST', '/api/site-admin/themes/horizon/install', { design: true, pages: [{ slug: 'home', mode: 'replace', sections: [] }] }, { cookie: a.c })).status, 401);
  // beta installs its own theme: acme keeps its own
  assert.equal((await installAll(b, 'horizon')).status, 200);
  assert.equal((await a.get('/api/site-admin/config')).data.active_theme, 'urban');
  assert.equal((await b.get('/api/site-admin/config')).data.active_theme, 'horizon');
  // the shared definitions are untouched by either install
  assert.equal(SITE_THEMES.find((t) => t.id === 'horizon').pages[0].blocks[0].props.headline, 'Architecture you can live in');
});
