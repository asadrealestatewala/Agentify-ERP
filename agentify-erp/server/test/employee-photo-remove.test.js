import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-photo-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { get, run } = await import('../src/db.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

test('admin can remove an employee photo and the file is deleted', async () => {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
    return { status: r.status, data };
  };
  assert.equal((await call('POST', '/api/auth/login', { identifier: 'admin@expertdevelopers.pk', password: 'Demo@12345' })).status, 200);
  const emp = get('SELECT id FROM employees LIMIT 1');
  assert.ok(emp, 'seed has an employee');
  assert.equal((await call('DELETE', `/api/hrm/employees/${emp.id}/photo`)).status, 400);
  fs.mkdirSync(path.join(dir, 'uploads', 'media'), { recursive: true });
  const file = path.join(dir, 'uploads', 'media', 'x.png');
  fs.writeFileSync(file, 'x');
  run('UPDATE employees SET photo=? WHERE id=?', 'media/x.png', emp.id);
  assert.equal((await call('DELETE', `/api/hrm/employees/${emp.id}/photo`)).status, 200);
  assert.equal(get('SELECT photo FROM employees WHERE id=?', emp.id).photo, null);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(file), false);
});
