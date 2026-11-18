import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-ytq-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', ERP_MAIL_QUIET: '1', ERP_SECRETS_KEY: 'test-secrets-key-0123456789',
  PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });

const q = await import('../src/services/trainingQueue.js');
const { setSetting } = await import('../src/services/platformConfig.js');
after(async () => { (await import('../src/db.js')).closeDbs(); });

const calls = [];
const fakeFetch = async (url, init) => { calls.push(`${init.method} ${url.replace(/\?.*/, '')}`); const j = (d, ok = true, status = 200) => ({ ok, status, json: async () => d });
  if (url.includes('/playlists') && init.method === 'GET') return j({ items: [] });
  if (url.includes('/playlists')) return j({ id: 'PL1' });
  return j({}); };
let n = 0;
const fakeUpload = async () => ({ id: `vid${++n}` });
const deps = { fetchFn: fakeFetch, uploadFn: fakeUpload, tokenFn: async () => 'tok' };

test('queue is off and refuses to start until YouTube is connected', async () => {
  q.seed();
  const v = q.view();
  assert.equal(v.rows.length, 78);
  assert.deepEqual(v.rows.slice(0, 3).map((r) => r.file), ['agentify-erp-full-course-en.mp4', 'agentify-erp-full-course-ur.mp4', 'agentify-erp-full-course-ar.mp4']);
  assert.equal(v.settings.on, false);
  assert.deepEqual(await q.tick(deps), { state: 'off' });
  assert.throws(() => q.saveSettings({ on: true }, 'x'), /Connect the YouTube/);
});

test('posts one video per tick up to the daily limit, then sets thumbnail and playlist', async () => {
  setSetting('youtube_refresh_token', 'rt', { secret: true });
  q.saveSettings({ on: true, limit: 3, privacy: 'unlisted' }, 'x');
  for (let i = 0; i < 3; i++) assert.equal((await q.tick(deps)).state, 'posted');
  assert.equal((await q.tick(deps)).state, 'limit');
  const v = q.view();
  assert.equal(v.counts.posted, 3); assert.equal(v.today, 3);
  assert.ok(v.rows.slice(0, 3).every((r) => r.status === 'posted' && r.thumb === 'set' && r.playlist === 'PL1'));
  assert.ok(calls.some((c) => c.includes('thumbnails/set')));
});

test('a quota error pauses the queue without losing the video; other errors retry then fail', async () => {
  q.saveSettings({ limit: 10 }, 'x');
  const quota = async () => { throw new Error('YouTube\'s daily upload quota for this project is used up.'); };
  assert.equal((await q.tick({ ...deps, uploadFn: quota })).state, 'quota');
  assert.equal((await q.tick(deps)).state, 'paused');
  q.saveSettings({ on: true }, 'x'); // switching on again clears the pause
  const boom = async () => { throw new Error('nope'); };
  for (let i = 0; i < 3; i++) assert.equal((await q.tick({ ...deps, uploadFn: boom })).state, 'failed');
  const v = q.view();
  assert.equal(v.counts.failed, 1);
  q.retry(v.rows.find((r) => r.status === 'failed').file);
  assert.equal(q.view().counts.failed, 0);
  assert.throws(() => q.saveSettings({ limit: 50 }, 'x'), /between 1 and 10/);
});
