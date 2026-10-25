import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-sitehard-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { get, run } = await import('../src/db.js');
const { SECTION_TYPE_NAMES } = await import('../../shared/sectionTypes.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function admin() {
  const jar = {};
  const call = async (method, url, body, form) => {
    const headers = { 'X-Requested-With': 'ERP', cookie: jar.c || '' };
    if (!form) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  assert.equal((await call('POST', '/api/auth/login', { identifier: 'admin@expertdevelopers.pk', password: 'Demo@12345' })).status, 200);
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), upload: (u, fd) => call('POST', u, null, fd) };
}
const anon = async (u) => { const r = await fetch(base + u, { headers: { 'X-Requested-With': 'ERP' } }); return { status: r.status, data: await r.json() }; };
const text = (id, html) => ({ id, type: 'text', props: { title: '', html, align: 'left' } });
// a real 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const fileForm = (name, bytes, type) => { const fd = new FormData(); fd.append('files', new Blob([bytes], { type }), name); return fd; };

test('the server block list matches the editor’s SECTION_TYPES', () => {
  const src = fs.readFileSync(new URL('../../client/src/site/siteCore.jsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const SECTION_TYPES = {'), src.indexOf('\n};', src.indexOf('export const SECTION_TYPES = {')));
  const keys = [...body.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), [...SECTION_TYPE_NAMES].sort());
});

test('pages refuse unknown blocks, bad or repeated ids, too many blocks and unsafe gallery images', async () => {
  const a = await admin();
  const make = (sections) => a.post('/api/site-admin/pages', { title: `T ${Math.random()}`, sections });
  assert.equal((await make([{ id: 'x1', type: 'rawhtml', props: { html: '<script>1</script>' } }])).status, 400);
  assert.equal((await make([text('a1', 'One'), text('a1', 'Two')])).status, 400);
  assert.equal((await make([text('bad id!', 'One')])).status, 400);
  assert.equal((await make([{ type: 'text', props: {} }])).status, 400);
  assert.equal((await make(Array.from({ length: 151 }, (_, i) => text(`b${i}`, 'x')))).status, 400);
  assert.equal((await make([{ id: 'g1', type: 'gallery', props: { title: '', images: [{ src: 'javascript:alert(1)', caption: '' }] } }])).status, 400);
  assert.equal((await make([{ id: 'g2', type: 'gallery', props: { title: '', images: [{ src: 'media/abc.png', caption: '' }] } }, text('t2', '<p>ok</p>')])).status, 201);
  // an existing page with an unknown block can still be fixed: removing the block makes it save again
  const p = (await make([text('k1', 'Keep')])).data;
  run('UPDATE site_pages SET sections=? WHERE id=?', JSON.stringify([text('k1', 'Keep'), { id: 'old', type: 'retired', props: {} }]), p.id);
  assert.equal((await a.put(`/api/site-admin/pages/${p.id}`, { sections: [text('k1', 'Keep'), { id: 'old', type: 'retired', props: {} }] })).status, 400);
  assert.equal((await a.put(`/api/site-admin/pages/${p.id}`, { sections: [text('k1', 'Keep')] })).status, 200);
});

test('HTML stored before the sanitiser (or by other code) is cleaned again before visitors get it', async () => {
  const a = await admin();
  const page = (await a.post('/api/site-admin/pages', { title: 'Legacy text', sections: [text('l1', '<p>Hello</p>')] })).data;
  // simulate an old row written before validation existed
  run('UPDATE site_pages SET sections=? WHERE id=?', JSON.stringify([text('l1', '<p>Hello<img src=x onerror="alert(1)"></p><script>alert(2)</script>')]), page.id);
  assert.equal((await a.post('/api/site-admin/publish', { label: 'legacy' })).status, 200);
  const out = await anon(`/api/site/pages/${page.slug}`);
  assert.equal(out.status, 200);
  const html = out.data.sections[0].props.html;
  assert.match(html, /Hello/);
  assert.doesNotMatch(html, /onerror|<script|alert\(2\)/i);

  // a property description typed with HTML in the ERP is cleaned on the public listing and in the website API
  const prop = get("SELECT id FROM properties WHERE published=1 AND status IN ('available','featured') LIMIT 1");
  assert.ok(prop, 'seed data has a published property');
  run('UPDATE properties SET description=? WHERE id=?', '<p>Nice home</p><img src=x onerror="alert(3)"><script>alert(4)</script>', prop.id);
  const d = (await anon(`/api/site/listings/${prop.id}`)).data.description;
  assert.match(d, /Nice home/);
  assert.doesNotMatch(d, /onerror|<script/i);
});

test('image uploads must really be images; deleting one keeps the file while a published version uses it', async () => {
  const a = await admin();
  const pngs = () => { try { return fs.readdirSync(path.join(dir, 'uploads', 'media')).filter((f) => f.endsWith('.png')).length; } catch { return 0; } };
  const before = pngs();
  const fake = await a.upload('/api/site-admin/media', fileForm('photo.png', Buffer.from('<svg onload=alert(1)>'), 'image/png'));
  assert.equal(fake.status, 400);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pngs(), before, 'the refused file is removed');
  const up = await a.upload('/api/site-admin/media', fileForm('photo.png', PNG, 'image/png'));
  assert.equal(up.status, 201);
  const img = up.data[0];

  const page = (await a.post('/api/site-admin/pages', { title: 'Gallery page', sections: [{ id: 'gp1', type: 'gallery', props: { title: 'G', images: [{ src: img.path, caption: '' }] } }] })).data;
  assert.equal((await a.post('/api/site-admin/publish', { label: 'with image' })).status, 200);
  // the page still uses it: refused
  assert.equal((await a.del(`/api/site-admin/media/${img.id}`)).status, 400);
  // the draft stops using it; the published release (and the page history) still do, so the file stays for a rollback
  assert.equal((await a.put(`/api/site-admin/pages/${page.id}`, { sections: [text('gp2', 'No image')] })).status, 200);
  const del = await a.del(`/api/site-admin/media/${img.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.data.file_kept, true);
  assert.ok(fs.existsSync(path.join(dir, 'uploads', img.path)), 'the file is still on disk');
  assert.equal(get('SELECT 1 x FROM media WHERE id=?', img.id), undefined, 'gone from the library');

  // an image nothing ever used is removed from disk
  const lone = (await a.upload('/api/site-admin/media', fileForm('lone.png', PNG, 'image/png'))).data[0];
  const del2 = await a.del(`/api/site-admin/media/${lone.id}`);
  assert.equal(del2.data.file_kept, false);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(path.join(dir, 'uploads', lone.path)), false);
});
