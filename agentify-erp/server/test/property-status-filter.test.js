import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-propstatus-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

test('GET /api/properties accepts a comma list of statuses applied before the row limit', async () => {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json() };
  };
  assert.equal((await call('POST', '/api/auth/login', { identifier: 'admin@expertdevelopers.pk', password: 'Demo@12345' })).status, 200);
  const sellable = ['available', 'featured', 'reserved'];
  const r = await call('GET', `/api/properties?status=${sellable.join(',')}&limit=3&sort=created`);
  assert.equal(r.status, 200);
  assert.ok(r.data.rows.length > 0);
  assert.ok(r.data.rows.every((p) => sellable.includes(p.status)));
  const one = await call('GET', '/api/properties?status=sold&limit=500');
  assert.ok(one.data.rows.every((p) => p.status === 'sold'));
});
