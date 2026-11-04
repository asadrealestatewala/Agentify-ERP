import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-pwa-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
const { createApp } = await import('../src/index.js');
const here = path.dirname(new URL(import.meta.url).pathname);
const built = fs.existsSync(path.join(here, '..', '..', 'client', 'dist'));

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

test('manifest start page follows the login page, only for known paths', { skip: !built }, async () => {
  const get = async (q) => (await fetch(`${base}/manifest.webmanifest${q}`)).json();
  assert.equal((await get('')).start_url, '/?source=pwa');
  assert.equal((await get('?start=/developer/login')).start_url, '/developer/login?source=pwa');
  assert.equal((await get('?start=/login')).start_url, '/login?source=pwa');
  assert.equal((await get('?start=//evil.com')).start_url, '/?source=pwa');
  assert.equal((await get('?start=/platform')).start_url, '/?source=pwa');
});
