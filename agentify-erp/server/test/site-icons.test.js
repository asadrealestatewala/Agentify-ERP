import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-site-icons-'));
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

const { SITE_ICONS, SITE_ICON_IDS, LEGACY_ICON_MAP, FALLBACK_ICON, resolveIconId } = await import('../../shared/siteIcons.js');
const { validateSections } = await import('../src/services/siteValidate.js');
const { SITE_THEMES } = await import('../../shared/siteThemes.js');
const { createApp } = await import('../src/index.js');

let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

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
  return { get: (u) => call(host, 'GET', u, null, { cookie: c }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }), put: (u, b) => call(host, 'PUT', u, b || {}, { cookie: c }) };
}
const signup = (slug, email) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345' });

test('icon ids resolve to themselves, legacy emoji map to ids, anything else falls back predictably', () => {
  for (const id of SITE_ICON_IDS) assert.equal(resolveIconId(id), id);
  assert.equal(resolveIconId('Residential'), 'residential');
  // the four "How we can help" cards from the original company website
  assert.equal(resolveIconId('🏡'), 'residential');
  assert.equal(resolveIconId('🏗️'), 'construction');
  assert.equal(resolveIconId('🏗'), 'construction');
  assert.equal(resolveIconId('🏢'), 'commercial');
  assert.equal(resolveIconId('🌾'), 'agricultural');
  for (const [emoji, id] of Object.entries(LEGACY_ICON_MAP)) assert.ok(SITE_ICONS[id], `${emoji} maps to unknown id ${id}`);
  assert.equal(resolveIconId(''), '');
  assert.equal(resolveIconId('   '), '');
  assert.equal(resolveIconId(undefined), '');
  assert.equal(resolveIconId({ svg: '<svg/>' }), '');
  for (const junk of ['🦄', 'removed-icon', 'IconHome', '<svg onload=alert(1)>', 'https://evil.test/i.svg', '../../etc/passwd', '@tabler/icons-react/IconHome', 'constructor', '__proto__', 'toString']) {
    assert.equal(resolveIconId(junk), FALLBACK_ICON, junk);
  }
});

test('the website icon component maps every registry id, and nothing else', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../../client/src/site/SiteIcon.jsx', import.meta.url)), 'utf8');
  const block = src.slice(src.indexOf('ICON_COMPONENTS = {'), src.indexOf('};', src.indexOf('ICON_COMPONENTS = {')));
  const mapped = [...block.matchAll(/^\s+(\w+): (Icon\w+),/gm)];
  assert.deepEqual(mapped.map((m) => m[1]).sort(), [...SITE_ICON_IDS].sort());
  const imported = src.slice(src.indexOf('import {'), src.indexOf("from '@tabler/icons-react'"));
  for (const [, , comp] of mapped) assert.ok(imported.includes(comp), `${comp} is used but not imported explicitly`);
  assert.ok(!/import \* as/.test(src), 'never import the whole icon library');
});

test('saving a page keeps only approved icon ids', () => {
  const sections = [{ id: 's1', type: 'services', props: { title: 'How we can help', items: [
    { icon: '🏡', title: 'Residential plots & houses', text: 'Copy stays as written 🏡', href: '/site/properties' },
    { icon: 'construction', title: 'House construction', text: '', href: '' },
    { icon: '<svg onload=alert(1)>', title: 'Bad', text: '', href: '' },
    { icon: { component: 'IconHome' }, title: 'Object', text: '', href: '' },
    { icon: '', title: 'No icon', text: '', href: '' },
  ] } }];
  validateSections(sections);
  assert.deepEqual(sections[0].props.items.map((i) => i.icon), ['residential', 'construction', FALLBACK_ICON, '', '']);
  assert.equal(sections[0].props.items[0].text, 'Copy stays as written 🏡', 'only icon fields change, never the text');
});

test('built-in themes and the default company services only use registry ids', async () => {
  const icons = [];
  for (const t of SITE_THEMES) for (const p of t.pages) for (const b of p.blocks) if (b.type === 'services') for (const i of b.props.items || []) icons.push(i.icon);
  const src = fs.readFileSync(fileURLToPath(new URL('../src/services/siteDefaults.js', import.meta.url)), 'utf8');
  for (const m of src.matchAll(/icon: '([^']*)'/g)) icons.push(m[1]);
  assert.ok(icons.length > 10);
  for (const i of icons) assert.ok(i === '' || SITE_ICONS[i], `“${i}” is not a registry id`);
});

test('icons are saved per workspace: one tenant’s pages and icons never reach another', async () => {
  assert.equal((await signup('iconsa', 'owner@iconsa.test')).status, 201);
  assert.equal((await signup('iconsb', 'owner@iconsb.test')).status, 201);
  const a = await login('iconsa.erp.test', 'owner@iconsa.test', 'Tenant@12345');
  const b = await login('iconsb.erp.test', 'owner@iconsb.test', 'Tenant@12345');
  const made = await a.post('/api/site-admin/pages', { title: 'Help', sections: [{ id: 'svc1', type: 'services', props: { title: 'How we can help', items: [{ icon: '🌾', title: 'Agricultural land', text: '', href: '' }, { icon: 'javascript:alert(1)', title: 'X', text: '', href: '' }] } }] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.deepEqual(made.data.sections[0].props.items.map((i) => i.icon), ['agricultural', FALLBACK_ICON]);
  const upd = await a.put(`/api/site-admin/pages/${made.data.id}`, { sections: [{ id: 'svc1', type: 'services', props: { title: 'How we can help', items: [{ icon: 'construction', title: 'House construction', text: '', href: '' }] } }] });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));
  const bPages = await b.get('/api/site-admin/pages');
  assert.equal(bPages.status, 200);
  assert.ok(!JSON.stringify(bPages.data).includes('svc1'), 'tenant B must not see tenant A’s page');
  assert.notEqual((await b.put(`/api/site-admin/pages/${made.data.id}`, { sections: [] })).status, 200, 'tenant B cannot edit tenant A’s page by id');
  const again = await a.get('/api/site-admin/pages');
  const page = (again.data.data || again.data).find((p) => p.id === made.data.id);
  assert.ok(page, 'tenant A still has its page');
});
