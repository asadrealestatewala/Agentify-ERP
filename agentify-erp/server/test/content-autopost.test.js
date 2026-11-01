import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-autopost-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const auto = await import('../src/services/contentAutopost.js');
const social = await import('../src/integrations/social.js');
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
const future = (h) => new Date(Math.ceil((Date.now() + h * 3600_000) / 60_000) * 60_000).toISOString();
let owner, smm;
const login = async () => {
  owner = (await call('POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  await as(owner, 'POST', '/admins', { email: 'smm@agentify.test', name: 'Sana', role: 'social_media_manager', password: 'Saffron#Tide2026' });
  smm = (await call('POST', `${A}/login`, { email: 'smm@agentify.test', password: 'Saffron#Tide2026' })).cookie;
  await as(owner, 'PUT', '/content/limits', { per_day: 50, per_channel_per_day: 50, min_gap_minutes: 0, window_start: '00:00', window_end: '23:59', timezone: 'UTC' });
};
const mkPost = async (b) => { const r = await as(smm, 'POST', '/content/posts', b); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
const due = (id) => { // moves a scheduled post's time into the past without going through the API (which refuses past times)
  return import('../src/platform.js').then(({ platformDb }) => platformDb().prepare('UPDATE content_posts SET scheduled_at=? WHERE id=?').run(new Date(Date.now() - 60_000).toISOString(), id));
};
const fb = { provider: 'facebook', externalId: 'PAGE1', name: 'Agentify ERP', secret: { token: 'tok-fb' }, meta: null };
const ig = { provider: 'instagram', externalId: 'IG1', name: '@agentify', secret: { token: 'tok-fb' }, meta: { page_id: 'PAGE1' } };

test('approval: needs a connected account, a schedule and no hold; the switch and connections are for a super admin only', async () => {
  await login();
  const p = await mkPost({ title: 'Hello world', body: 'Text', channel: 'facebook' });
  assert.match((await as(smm, 'POST', `/content/posts/${p.id}/auto-post`, {})).data.error, /Schedule the post first/);
  await as(smm, 'POST', `/content/posts/${p.id}/schedule`, { scheduled_at: future(5) });
  assert.match((await as(smm, 'POST', `/content/posts/${p.id}/auto-post`, {})).data.error, /Connect a Facebook account first/);
  assert.equal((await as(smm, 'PUT', '/content/autopost/enabled', { enabled: true })).status, 403, 'the manager cannot flip the master switch');
  assert.equal((await as(smm, 'GET', '/content/autopost/connect/meta')).status, 403);
  assert.equal((await as(owner, 'GET', '/content/autopost/connect/meta')).status, 400, 'no app keys yet');
  auto.saveConnections([fb, ig], 'test');
  assert.equal((await as(smm, 'POST', `/content/posts/${p.id}/auto-post`, {})).status, 200);
  const st = (await as(smm, 'GET', '/content')).data.autopost;
  assert.equal(st.enabled, false, 'off by default'); assert.equal(st.waiting, 1); assert.equal(st.accounts.length, 2);
  assert.ok(!JSON.stringify(st).includes('tok-fb'), 'tokens never leave the server');

  const x = await mkPost({ title: 'On X', body: 'Text', channel: 'x' }); await as(smm, 'POST', `/content/posts/${x.id}/schedule`, { scheduled_at: future(6) });
  assert.match((await as(smm, 'POST', `/content/posts/${x.id}/auto-post`, {})).data.error, /cannot be posted automatically/);
  const noMedia = await mkPost({ title: 'Reel', body: 'Text', channel: 'instagram' }); await as(smm, 'POST', `/content/posts/${noMedia.id}/schedule`, { scheduled_at: future(7) });
  assert.match((await as(smm, 'POST', `/content/posts/${noMedia.id}/auto-post`, {})).data.error, /need an image or video/);
  const hold = await mkPost({ title: 'ON HOLD (partner consent) Promo', body: 'Text', channel: 'facebook', notes: 'DO NOT POST: consent not confirmed' }); await as(smm, 'POST', `/content/posts/${hold.id}/schedule`, { scheduled_at: future(8) });
  assert.match((await as(smm, 'POST', `/content/posts/${hold.id}/auto-post`, {})).data.error, /on hold/);
});

test('editing, rescheduling or unscheduling an approved post takes the approval away', async () => {
  const mk = async () => { const p = await mkPost({ title: `Approved ${Math.random()}`, body: 'Text', channel: 'facebook' }); await as(smm, 'POST', `/content/posts/${p.id}/schedule`, { scheduled_at: future(30) }); await as(smm, 'POST', `/content/posts/${p.id}/auto-post`, {}); return p; };
  const approved = async (id) => (await as(smm, 'GET', '/content')).data.posts.find((q) => q.id === id).auto_post;
  let p = await mk(); assert.equal(await approved(p.id), 1);
  await as(smm, 'PUT', `/content/posts/${p.id}`, { title: p.title, body: 'Text' }); assert.equal(await approved(p.id), 1, 'saving with no change keeps it');
  await as(smm, 'POST', `/content/posts/${p.id}/schedule`, { scheduled_at: (await as(smm, 'GET', '/content')).data.posts.find((q) => q.id === p.id).scheduled_at }); assert.equal(await approved(p.id), 1, 'same time keeps it');
  await as(smm, 'PUT', `/content/posts/${p.id}`, { body: 'Changed text' }); assert.equal(await approved(p.id), 0, 'new text');
  p = await mk(); await as(smm, 'POST', `/content/posts/${p.id}/schedule`, { scheduled_at: future(40) }); assert.equal(await approved(p.id), 0, 'new time');
  p = await mk(); await as(smm, 'POST', `/content/posts/${p.id}/unschedule`); assert.equal(await approved(p.id), 0, 'unscheduled');
  p = await mk(); await as(smm, 'POST', `/content/posts/${p.id}/cancel`); assert.equal(await approved(p.id), 0, 'canceled');
  p = await mk(); assert.equal((await as(smm, 'POST', `/content/posts/${p.id}/auto-post`, { enabled: false })).data.post.auto_post, 0, 'withdrawn');
});

test('the job posts only approved, due posts, only while the switch is on, and never twice', async () => {
  const db = (await import('../src/platform.js')).platformDb();
  db.exec('DELETE FROM content_posts');
  const make = async (b, approve = true) => { const p = await mkPost(b); await as(smm, 'POST', `/content/posts/${p.id}/schedule`, { scheduled_at: future(2) }); if (approve) assert.equal((await as(smm, 'POST', `/content/posts/${p.id}/auto-post`, {})).status, 200); return p; };
  const a = await make({ title: 'A approved', body: 'Alpha', channel: 'facebook', link: 'https://agentifyerp.co' });
  const b = await make({ title: 'B not approved', body: 'Beta', channel: 'facebook' }, false);
  const c = await make({ title: 'C future', body: 'Gamma', channel: 'facebook' });
  await due(a.id); await due(b.id);
  const calls = [];
  const publish = async (acc, post) => { calls.push({ acc: acc.external_id, post }); return 'PAGE1_999'; };

  let out = await auto.runDueAutoposts({ publish });
  assert.equal(out.skipped_off, true); assert.equal(calls.length, 0, 'switch is off: nothing goes out');
  assert.equal((await as(smm, 'PUT', '/content/autopost/enabled', { enabled: true })).status, 403);
  assert.equal((await as(owner, 'PUT', '/content/autopost/enabled', { enabled: true })).data.enabled, true);

  out = await auto.runDueAutoposts({ publish });
  assert.deepEqual(out.posted.map((x) => x.id), [a.id], 'only the approved, due post');
  assert.deepEqual(calls[0], { acc: 'PAGE1', post: { message: 'Alpha', media_url: null, link: 'https://agentifyerp.co' } });
  const rows = (await as(smm, 'GET', '/content')).data.posts; const byId = (id) => rows.find((r) => r.id === id);
  assert.equal(byId(a.id).status, 'posted'); assert.equal(byId(a.id).posted_by, 'auto-post'); assert.equal(byId(a.id).post_url, 'https://www.facebook.com/PAGE1_999');
  assert.equal(byId(b.id).status, 'scheduled', 'not approved: left for a person'); assert.equal(byId(c.id).status, 'scheduled', 'not due yet');
  out = await auto.runDueAutoposts({ publish }); assert.equal(out.posted.length, 0); assert.equal(calls.length, 1, 'never twice');
});

test('a failure stops that post, keeps it scheduled with the reason, and is not retried; late and held posts are not posted', async () => {
  const db = (await import('../src/platform.js')).platformDb();
  db.exec('DELETE FROM content_posts');
  const make = async (b) => { const p = await mkPost(b); await as(smm, 'POST', `/content/posts/${p.id}/schedule`, { scheduled_at: future(2) }); await as(smm, 'POST', `/content/posts/${p.id}/auto-post`, {}); return p; };
  const bad = await make({ title: 'Will fail', body: 'x', channel: 'facebook' });
  const late = await make({ title: 'Late', body: 'x', channel: 'facebook' });
  const held = await make({ title: 'Held', body: 'x', channel: 'facebook' });
  await due(bad.id);
  db.prepare('UPDATE content_posts SET scheduled_at=? WHERE id=?').run(new Date(Date.now() - 8 * 3600_000).toISOString(), late.id);
  db.prepare("UPDATE content_posts SET scheduled_at=?, notes='DO NOT POST: consent' WHERE id=?").run(new Date(Date.now() - 60_000).toISOString(), held.id);
  let n = 0;
  const publish = async () => { n += 1; throw new Error('(#200) Permission denied'); };
  const out = await auto.runDueAutoposts({ publish });
  assert.equal(n, 1, 'only the genuinely due one was tried'); assert.equal(out.failed.length, 3);
  const rows = (await as(smm, 'GET', '/content')).data.posts; const byId = (id) => rows.find((r) => r.id === id);
  assert.equal(byId(bad.id).status, 'scheduled'); assert.equal(byId(bad.id).auto_post, 0); assert.match(byId(bad.id).auto_error, /Permission denied/);
  assert.match(byId(late.id).auto_error, /more than 6 hours/); assert.match(byId(held.id).auto_error, /on hold/);
  await auto.runDueAutoposts({ publish }); assert.equal(n, 1, 'no automatic retry');
  // an interrupted publish is never repeated on its own
  db.prepare("UPDATE content_posts SET auto_post=1, auto_state='publishing', auto_error=NULL, auto_started_at=? WHERE id=?").run(new Date(Date.now() - 3600_000).toISOString(), bad.id);
  await auto.runDueAutoposts({ publish }); assert.equal(n, 1);
  assert.match((await as(smm, 'GET', '/content')).data.posts.find((r) => r.id === bad.id).auto_error, /not known whether it went out/);
});

test('disconnecting an account withdraws the approvals that relied on it', async () => {
  const db = (await import('../src/platform.js')).platformDb();
  db.exec('DELETE FROM content_posts');
  const p = await mkPost({ title: 'Needs IG', body: 'x', channel: 'instagram', media_url: 'https://agentifyerp.co/promo-media/kinetic-promo-9x16.mp4' });
  await as(smm, 'POST', `/content/posts/${p.id}/schedule`, { scheduled_at: future(3) });
  assert.equal((await as(smm, 'POST', `/content/posts/${p.id}/auto-post`, {})).status, 200);
  const igId = (await as(owner, 'GET', '/content')).data.autopost.accounts.find((a) => a.provider === 'instagram').id;
  assert.equal((await as(smm, 'DELETE', `/content/autopost/accounts/${igId}`)).status, 403);
  assert.equal((await as(owner, 'DELETE', `/content/autopost/accounts/${igId}`)).status, 200);
  const row = (await as(smm, 'GET', '/content')).data.posts.find((r) => r.id === p.id);
  assert.equal(row.auto_post, 0); assert.match(row.auto_error, /disconnected/);
});

test('publishing: videos go to the video endpoints, Instagram waits for processing, LinkedIn video is refused', async () => {
  social.timing.igPollMs = 1;
  const real = globalThis.fetch; const seen = [];
  let polls = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); seen.push({ u, body: opts.body ? String(opts.body) : '' });
    const json = (d) => ({ ok: true, status: 200, json: async () => d, headers: new Map() });
    if (/\/PAGE1\/videos/.test(u)) return json({ id: 'vid1' });
    if (/\/IG1\/media\?|\/IG1\/media$/.test(u) || /\/IG1\/media/.test(u) && !/publish/.test(u)) return json({ id: 'c1' });
    if (/\/c1\?fields=status_code/.test(u)) { polls += 1; return json({ status_code: polls < 3 ? 'IN_PROGRESS' : 'FINISHED' }); }
    if (/media_publish/.test(u)) return json({ id: 'ig-post-1' });
    return json({});
  };
  try {
    const accounts = Object.fromEntries(auto.listConnections().map((a) => [a.provider, a]));
    const { encrypt } = await import('../src/services/platformConfig.js');
    const acc = (id, provider) => ({ external_id: id, provider, token_enc: encrypt(JSON.stringify({ token: 't' })) });
    assert.equal(await social.publishToAccount(acc('PAGE1', 'facebook'), { message: 'Hi', media_url: 'https://x.test/a.mp4' }), 'vid1');
    assert.match(seen[0].body, /file_url=/);
    assert.equal(await social.publishToAccount(acc('IG1', 'instagram'), { message: 'Hi', media_url: 'https://x.test/a.mp4' }), 'ig-post-1');
    assert.ok(polls >= 3, 'waited for the video to be ready');
    assert.ok(seen.some((s) => /media_type=REELS/.test(s.body)));
    await assert.rejects(social.publishToAccount(acc('L1', 'linkedin'), { message: 'Hi', media_url: 'https://x.test/a.mp4' }), /LinkedIn video/);
    void accounts;
  } finally { globalThis.fetch = real; }
});
