import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-pub-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { get, run } = await import('../src/db.js');
const { signWebhook } = await import('../src/services/website.js');
const { injectSiteMeta } = await import('../src/services/siteHost.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, password = 'Demo@12345') {
  const jar = {};
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
  const l = await call('POST', '/api/auth/login', { identifier, password });
  assert.equal(l.status, 200, `login failed for ${identifier}`);
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}
const anon = async (u, headers = {}) => { const r = await fetch(base + u, { headers: { 'X-Requested-With': 'ERP', ...headers } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r.headers }; };
const admin = () => client('admin@expertdevelopers.pk');

test('website API: hidden projects stay private, a key in the address still works but is deprecated', async () => {
  const a = await admin();
  const key = (await a.get('/api/settings/system')).data.website_api_key;
  assert.ok(key, 'demo workspace has a website API key');
  const hidden = get('SELECT id FROM projects ORDER BY id LIMIT 1').id;
  run('UPDATE projects SET site_visible=0 WHERE id=?', hidden);
  const list = await anon('/api/public/projects', { 'X-API-Key': key });
  assert.equal(list.status, 200);
  const rows = Array.isArray(list.data) ? list.data : list.data.data;
  assert.ok(!rows.some((p) => p.id === hidden), 'a project hidden from the website is not listed');
  assert.equal((await anon(`/api/public/project/${hidden}`, { 'X-API-Key': key })).status, 404, 'nor readable by id');
  run('UPDATE projects SET site_visible=1 WHERE id=?', hidden);
  assert.equal((await anon(`/api/public/project/${hidden}`, { 'X-API-Key': key })).status, 200);

  const viaHeader = await anon('/api/public/projects', { 'X-API-Key': key });
  assert.equal(viaHeader.headers.get('deprecation'), null);
  const viaQuery = await anon(`/api/public/projects?api_key=${encodeURIComponent(key)}`);
  assert.equal(viaQuery.status, 200); assert.equal(viaQuery.headers.get('deprecation'), 'true');
  assert.equal((await anon('/api/public/projects', { 'X-API-Key': 'x'.repeat(key.length) })).status, 401);

  // saving the settings form never puts back an old key (it used to, after Regenerate, from a stale form)
  const form = (await a.get('/api/settings/system')).data;
  const fresh = (await a.post('/api/settings/system/regenerate-api-key')).data;
  assert.equal((await a.put('/api/settings/system', form)).status, 200);
  const now = (await a.get('/api/settings/system')).data.website_api_key;
  assert.notEqual(now, key); assert.equal(now, fresh.key, 'the regenerated key is kept');
});

test('webhooks: signed with a per-workspace secret, https only, no API key sent', async () => {
  const a = await admin();
  const s1 = (await a.get('/api/settings/system')).data.website_webhook_secret;
  assert.match(s1, /^whsec_[0-9a-f]{48}$/);
  assert.equal((await a.post('/api/settings/system/regenerate-webhook-secret')).status, 200);
  const s2 = (await a.get('/api/settings/system')).data.website_webhook_secret;
  assert.notEqual(s1, s2);
  assert.ok(!(await a.get('/api/settings/meta')).data?.some?.((m) => m.key === 'website_webhook_secret'), 'secret not in the general settings list');

  const body = JSON.stringify({ event: 'property.updated', property: { id: 1 } });
  const h = signWebhook(body, s2, 1_700_000_000);
  const [, t, v1] = h['Agentify-Signature'].match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  assert.equal(t, '1700000000');
  assert.equal(v1, crypto.createHmac('sha256', s2).update(`${t}.${body}`).digest('hex'), 'receiver can recompute the signature');
  assert.match(h['Agentify-Event-Id'], /^[0-9a-f-]{36}$/);
  assert.notEqual(signWebhook(body, s2, 1_700_000_000)['Agentify-Signature'], signWebhook(body + ' ', s2, 1_700_000_000)['Agentify-Signature']);

  const form = (await a.get('/api/settings/system')).data;
  assert.equal((await a.put('/api/settings/system', { ...form, website_webhook_url: 'http://example.com/hook' })).status, 400, 'plain http is refused');
  assert.equal((await a.put('/api/settings/system', { ...form, website_webhook_url: ' https://example.com/hook ' })).status, 200);
  assert.equal((await a.get('/api/settings/system')).data.website_webhook_url, 'https://example.com/hook');
  await a.put('/api/settings/system', { ...form, website_webhook_url: '' });
  const src = fs.readFileSync(new URL('../src/services/website.js', import.meta.url), 'utf8');
  assert.ok(!/X-ERP-Key/.test(src), 'the API key is no longer sent to the webhook');
});

test('draft vs live: save is a draft, publish puts it live, restore and offline undo it', async () => {
  const a = await admin();
  const first = (await a.get('/api/site-admin/publish')).data;
  assert.ok(first.live?.id, 'an existing website gets a first release automatically');
  assert.equal(first.offline, false);
  const liveName = (await anon('/api/site/bootstrap')).data.config.brand.name;

  // a new page and a new brand name: saved, but visitors do not see them
  const cfg = (await a.get('/api/site-admin/config')).data;
  assert.equal((await a.put('/api/site-admin/config', { ...cfg, brand: { ...cfg.brand, name: 'Draft Name Ltd' } })).status, 200);
  const page = (await a.post('/api/site-admin/pages', { title: 'Eid offers', sections: [{ id: 'e1', type: 'text', props: { title: 'Eid', html: '<p>Offers</p>', align: 'left' } }] })).data;
  assert.equal((await anon('/api/site/bootstrap')).data.config.brand.name, liveName);
  assert.equal((await anon(`/api/site/pages/${page.slug}`)).status, 404);
  assert.equal((await a.get('/api/site-admin/publish')).data.changes, true);

  // a preview link shows the draft, is not indexed, and a made-up token does not work
  const link = await a.post('/api/site-admin/preview-link');
  assert.equal(link.status, 201); const token = link.data.path.split('preview=')[1];
  assert.ok(new Date(link.data.expires_at) > new Date(Date.now() + 6 * 864e5));
  const pv = await anon(`/api/site/bootstrap?preview=${token}`);
  assert.equal(pv.data.preview, true); assert.equal(pv.data.config.brand.name, 'Draft Name Ltd'); assert.match(pv.headers.get('x-robots-tag') || '', /noindex/);
  assert.equal((await anon(`/api/site/pages/${page.slug}?preview=${token}`)).status, 200);
  assert.equal((await anon(`/api/site/bootstrap?preview=${'A'.repeat(32)}`)).data.config.brand.name, liveName);
  assert.equal((await anon(`/api/site/pages/${page.slug}?preview=${'A'.repeat(32)}`)).status, 404);

  // publish
  const pub = await a.post('/api/site-admin/publish', { label: 'Eid launch' });
  assert.equal(pub.status, 200); assert.equal(pub.data.live.label, 'Eid launch');
  assert.equal((await anon('/api/site/bootstrap')).data.config.brand.name, 'Draft Name Ltd');
  assert.equal((await anon(`/api/site/pages/${page.slug}`)).status, 200);
  assert.equal((await a.get('/api/site-admin/publish')).data.changes, false);
  assert.ok((await (await fetch(base + '/sitemap.xml')).text()).includes(`/site/p/${page.slug}`));

  // restore the first release: the page and name go away for visitors, the draft is untouched
  const rel = (await a.get('/api/site-admin/releases')).data;
  assert.ok(rel[0].live && rel[0].label === 'Eid launch');
  const old = rel.find((r) => r.id === first.live.id);
  assert.equal((await a.post(`/api/site-admin/releases/${old.id}/restore`)).status, 200);
  assert.equal((await anon('/api/site/bootstrap')).data.config.brand.name, liveName);
  assert.equal((await anon(`/api/site/pages/${page.slug}`)).status, 404);
  assert.equal((await a.get('/api/site-admin/config')).data.brand.name, 'Draft Name Ltd', 'draft kept');
  assert.equal((await a.get('/api/site-admin/releases')).data.length, rel.length + 1, 'restoring adds a version, history only grows');
  assert.equal((await a.post('/api/site-admin/releases/999999/restore')).status, 404);

  // offline: visitors get the offline notice, search engines are kept out; back online restores it as it was
  assert.equal((await a.post('/api/site-admin/unpublish')).status, 200);
  assert.deepEqual(Object.keys((await anon('/api/site/bootstrap')).data).sort(), ['company', 'offline']);
  assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \/\n/);
  assert.ok(!(await (await fetch(base + '/sitemap.xml')).text()).includes('<loc>'));
  assert.equal((await a.post('/api/site-admin/online')).status, 200);
  assert.equal((await anon('/api/site/bootstrap')).data.config.brand.name, liveName);

  // discard: the draft goes back to the live release; the page added since is hidden, not deleted
  assert.equal((await a.post('/api/site-admin/draft/discard')).status, 200);
  assert.equal((await a.get('/api/site-admin/config')).data.brand.name, liveName);
  const after = (await a.get(`/api/site-admin/pages/${page.id}`)).data;
  assert.equal(after.published, 0); assert.equal((await a.get('/api/site-admin/publish')).data.changes, false);

  // preview links can all be stopped
  assert.equal((await a.del('/api/site-admin/preview-links')).status, 200);
  assert.notEqual((await anon(`/api/site/bootstrap?preview=${token}`)).data.preview, true);
});

test('publishing needs website edit permission; agents cannot publish or take the site offline', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  assert.equal((await agent.post('/api/site-admin/publish')).status, 403);
  assert.equal((await agent.post('/api/site-admin/unpublish')).status, 403);
  assert.equal((await agent.post('/api/site-admin/draft/discard')).status, 403);
  const seo = await client('seo@expertdevelopers.pk');
  assert.equal((await seo.post('/api/site-admin/publish')).status, 403, 'SEO manager can view but not publish');
  assert.equal((await seo.post('/api/site-admin/preview-link')).status, 201);
});

test('website pages carry their own title, description, canonical and sharing tags from the server', async () => {
  const shell = '<!doctype html><html><head><title>Agentify ERP</title></head><body></body></html>';
  const req = (p, query = {}) => ({ path: p, query, protocol: 'https', get: () => 'www.example.com' });
  const home = injectSiteMeta(shell, req('/site'));
  assert.ok(!home.includes('<title>Agentify ERP</title>'));
  assert.match(home, /<meta name="robots" content="index, follow/); assert.match(home, /<link rel="canonical" href="https:\/\/[^"]+\/site"/);
  assert.match(home, /<meta property="og:title" content="[^"]+"/);
  const prop = get("SELECT id,title FROM properties WHERE published=1 AND status IN ('available','featured') LIMIT 1");
  const html = injectSiteMeta(shell, req(`/site/property/${prop.id}`));
  assert.ok(html.includes(`<meta property="og:title" content="${prop.title.replace(/&/g, '&amp;')}`), 'listing title is used');
  const missing = injectSiteMeta(shell, req('/site/property/99999999'));
  assert.match(missing, /noindex/); assert.ok(!missing.includes('rel="canonical"'));
  run('UPDATE properties SET title=? WHERE id=?', '<script>x</script> & "quotes"', prop.id);
  assert.ok(!injectSiteMeta(shell, req(`/site/property/${prop.id}`)).includes('<script>x'), 'escaped');
  assert.match(injectSiteMeta(shell, req('/site', { preview: 'A'.repeat(30) })), /index, follow/, 'an invalid preview token is just the live page');
  assert.equal(injectSiteMeta(shell, req('/site/__editor')), shell);
});
