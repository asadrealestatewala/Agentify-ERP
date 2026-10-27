import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-brandlook-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { all, get, val, run } = await import('../src/db.js');
const { today, addDays } = await import('../src/util.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, password = 'Demo@12345', portal = false) {
  const jar = {};
  const call = async (method, url, body, raw) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    if (raw) return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const l = await call('POST', '/api/auth/login', { identifier, password, portal });
  assert.equal(l.status, 200, `login failed for ${identifier}`);
  return { get: (u) => call('GET', u), raw: (u, m = 'GET', b) => call(m, u, b, true), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), me: l.data, cookie: () => jar.c || '' };
}
const anon = async (u, opt = {}) => { const r = await fetch(base + u, { headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, ...opt }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d }; };

import { checkBrandColor, contrastOnWhite, shades } from '../../shared/brandColor.js';

test('brand colour helper: hex only, readable with white text', () => {
  assert.deepEqual(checkBrandColor(''), { ok: true, hex: '' });
  assert.equal(checkBrandColor('#1A56DB').hex, '#1a56db');
  for (const bad of ['red', '#fff', '#12345', 'javascript:1', '#gggggg', 'url(x)']) assert.equal(checkBrandColor(bad).ok, false, bad);
  assert.equal(checkBrandColor('#ffff00').ok, false, 'yellow is too light for white text');
  assert.ok(contrastOnWhite('#000000') > 20);
  assert.equal(shades('#0e7c6b')[0], '#0e7c6b');
});

test('a workspace sets its own colour and logo; default stays when unset', async () => {
  const admin = await client('admin@expertdevelopers.pk');
  const agent = await client('agent1@expertdevelopers.pk');
  const before = (await anon('/api/auth/brand')).data;
  assert.equal(before.color, ''); assert.equal(before.app_logo, '');
  assert.equal((await admin.put('/api/settings/system', { brand_color: 'blue' })).status, 400);
  assert.equal((await admin.put('/api/settings/system', { brand_color: '#ffee00' })).status, 400);
  assert.equal((await agent.put('/api/settings/system', { brand_color: '#1a56db' })).status, 403);
  assert.equal((await admin.put('/api/settings/system', { brand_color: '#1A56DB' })).status, 200);
  assert.equal((await anon('/api/auth/brand')).data.color, '#1a56db');
  assert.equal((await admin.put('/api/settings/system', { brand_color: '' })).status, 200);
  assert.equal((await anon('/api/auth/brand')).data.color, '');
});

test('workspace logo: image types and size are checked', async () => {
  const admin = await client('admin@expertdevelopers.pk');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const send = async (name, type, buf) => {
    const fd = new FormData(); fd.append('logo', new Blob([buf], { type }), name);
    const r = await fetch(base + '/api/settings/branding/app-logo', { method: 'POST', headers: { 'X-Requested-With': 'ERP', cookie: admin.cookie() }, body: fd });
    return r.status;
  };
  assert.equal(await send('logo.png', 'image/png', png), 200);
  assert.match((await anon('/api/auth/brand')).data.app_logo, /^media\/.+\.png$/);
  assert.notEqual(await send('logo.svg', 'image/svg+xml', Buffer.from('<svg/>')), 200);
  assert.notEqual(await send('big.png', 'image/png', Buffer.concat([png, Buffer.alloc(1.2 * 1024 * 1024)])), 200);
  assert.equal((await admin.del('/api/settings/branding/app-logo')).status, 200);
  assert.equal((await anon('/api/auth/brand')).data.app_logo, '');
});
