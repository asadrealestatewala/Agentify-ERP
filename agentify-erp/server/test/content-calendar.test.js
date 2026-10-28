import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-cal-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const { problems, nextSlot, DEFAULT_LIMITS } = await import('../src/services/contentCalendar.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: 'erp.test', 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const A = '/api/platform/admin';
const as = (cookie, method, url, body) => call(method, `${A}${url}`, body, { cookie });
const L = { per_day: 2, per_channel_per_day: 1, min_gap_minutes: 60, window_start: '09:00', window_end: '18:00', timezone: 'UTC' };
const at = (s) => new Date(`${s}Z`);

test('limits: hours, per-day, per-channel and gap rules, and the next free slot', () => {
  const posts = [{ id: 1, status: 'scheduled', channel: 'facebook', scheduled_at: '2030-01-07T10:00:00.000Z' }, { id: 2, status: 'posted', channel: 'linkedin', posted_at: '2030-01-07T11:00:00.000Z' }, { id: 3, status: 'canceled', channel: 'x', scheduled_at: '2030-01-07T12:00:00.000Z' }];
  assert.match(problems(posts, L, { at: at('2030-01-07T08:00:00'), channel: 'x' })[0], /hours/);
  assert.match(problems(posts, L, { at: at('2030-01-07T15:00:00'), channel: 'x' }).join(), /2 posts a day/, 'canceled posts do not count, the two others fill the day');
  assert.deepEqual(problems(posts, L, { at: at('2030-01-08T10:00:00'), channel: 'facebook' }), []);
  assert.match(problems([posts[0]], { ...L, per_day: 5, per_channel_per_day: 5 }, { at: at('2030-01-07T10:30:00'), channel: 'facebook' }).join(), /60 minutes/);
  assert.deepEqual(problems(posts, L, { at: at('2030-01-07T10:00:00'), channel: 'x', exclude: 1 }).length, 0, 'the post being edited does not block itself');
  assert.equal(nextSlot(posts, L, { channel: 'x', after: at('2030-01-07T09:00:00') }), '2030-01-08T09:00:00.000Z', 'the day is full, so the next day opens');
  assert.equal(nextSlot([], L, { channel: 'x', after: at('2030-01-07T18:30:00') }), '2030-01-08T09:00:00.000Z', 'after hours rolls to the next morning');
  assert.ok(DEFAULT_LIMITS.per_day > 0);
});

test('a Social Media Manager plans, schedules and records posts, and nothing else', async () => {
  const owner = (await call('POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  const mk = await as(owner, 'POST', '/admins', { email: 'smm@agentify.test', name: 'Sana', role: 'social_media_manager', password: 'Saffron#Tide2026' });
  assert.equal(mk.status, 201, JSON.stringify(mk.data));
  const smm = (await call('POST', `${A}/login`, { email: 'smm@agentify.test', password: 'Saffron#Tide2026' })).cookie;
  assert.deepEqual((await as(smm, 'GET', '/me')).data.permissions, ['content.calendar']);
  for (const url of ['/workspaces', '/dashboard', '/transactions', '/training-videos']) assert.equal((await as(smm, 'GET', url)).status, 403, `${url} is closed to the manager`);
  assert.equal((await as(smm, 'PUT', '/content/limits', L)).status, 403, 'only a super admin edits the limits');

  assert.equal((await as(owner, 'PUT', '/content/limits', { ...L, window_start: '00:00', window_end: '23:59', per_day: 2, per_channel_per_day: 1 })).status, 200);
  const start = Date.now() + 3 * 86400_000; const t1 = new Date(Math.ceil(start / 3600_000) * 3600_000);
  const p1 = await as(smm, 'POST', '/content/posts', { title: 'Launch post', body: 'Hello', channel: 'facebook', scheduled_at: t1.toISOString() });
  assert.equal(p1.status, 201, JSON.stringify(p1.data)); assert.equal(p1.data.status, 'scheduled');
  const p2 = await as(smm, 'POST', '/content/posts', { title: 'Second', channel: 'facebook' });
  assert.equal(p2.data.status, 'draft');
  const clash = await as(smm, 'POST', `/content/posts/${p2.data.id}/schedule`, { scheduled_at: new Date(t1.getTime() + 600_000).toISOString() });
  assert.equal(clash.status, 409); assert.match(clash.data.error, /next free time/); assert.ok(clash.data.next_slot);
  assert.equal((await as(smm, 'POST', `/content/posts/${p2.data.id}/schedule`, { scheduled_at: new Date(t1.getTime() + 86400_000).toISOString() })).status, 200);
  assert.equal((await as(smm, 'POST', `/content/posts/${p2.data.id}/schedule`, { scheduled_at: 'nonsense' })).status, 400);
  assert.equal((await as(smm, 'POST', '/content/posts', { title: '', channel: 'facebook' })).status, 400);
  assert.equal((await as(smm, 'POST', '/content/posts', { title: 'x', channel: 'nope' })).status, 400);
  assert.equal((await as(smm, 'POST', '/content/posts', { title: 'x', channel: 'x', link: 'javascript:alert(1)' })).status, 400, 'only web addresses');

  const done = await as(smm, 'POST', `/content/posts/${p1.data.id}/posted`, { post_url: 'https://facebook.com/x/1' });
  assert.equal(done.status, 200, JSON.stringify(done.data)); assert.equal(done.data.post.status, 'posted');
  assert.equal((await as(smm, 'POST', `/content/posts/${p1.data.id}/posted`, {})).status, 400, 'recorded once');
  assert.equal((await as(smm, 'DELETE', `/content/posts/${p1.data.id}`)).status, 400, 'posted items are a record');
  assert.equal((await as(smm, 'PUT', `/content/posts/${p1.data.id}`, { title: 'changed' })).status, 400);

  const ov = (await as(smm, 'GET', '/content')).data;
  assert.equal(ov.counts.posted, 1); assert.equal(ov.counts.scheduled, 1); assert.equal(ov.counts.not_posted, 1);
  assert.equal(ov.can_edit_limits, false);
  assert.equal((await as(owner, 'GET', '/content')).data.can_edit_limits, true);
  assert.ok(ov.next_slot.facebook);
  assert.equal((await as(smm, 'POST', `/content/posts/${p2.data.id}/cancel`)).data.status, 'canceled');
  assert.equal((await as(smm, 'DELETE', `/content/posts/${p2.data.id}`)).status, 200);
});
