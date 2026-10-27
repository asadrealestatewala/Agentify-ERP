import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-ytv-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;

const { createApp } = await import('../src/index.js');
const yt = await import('../src/services/trainingYoutube.js');
const { setSetting } = await import('../src/services/platformConfig.js');
// deleting a server copy really removes the shipped file, so the test puts it back
const shipped = path.join(yt.SHIPPED, 'field-coverage-agent.mp4'), backup = fs.readFileSync(shipped);
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { fs.writeFileSync(shipped, backup); server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0], headers: res.headers }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
const A = '/api/platform/admin';

test('the console library reports "not configured" cleanly and refuses to post', async () => {
  assert.equal((await call(P, 'GET', `${A}/training-videos`)).status, 401, 'console only');
  const { cookie } = await call(P, 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' });
  const list = await call(P, 'GET', `${A}/training-videos`, null, { cookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.youtube.state, 'not_configured');
  const fc = list.data.rows.find((r) => r.key === 'field-coverage-admin');
  assert.ok(fc, 'the Field Coverage videos are in the console library');
  assert.equal(fc.youtube_url, null);
  assert.ok(fc.server_copy);
  const post = await call(P, 'POST', `${A}/training-videos/field-coverage-admin/post`, { privacy: 'unlisted' }, { cookie });
  assert.equal(post.status, 400);
  assert.match(post.data.error, /not set up/i);
  assert.equal((await call(P, 'GET', `${A}/training-videos/youtube/connect`, null, { cookie })).status, 400);
  assert.equal((await call(P, 'POST', `${A}/training-videos/field-coverage-admin/post`, { privacy: 'secret' }, { cookie })).status, 400);
});

test('posting uploads to YouTube, saves the link, and workspaces see a link instead of the file', async () => {
  setSetting('oauth_google_client_id', 'cid'); setSetting('oauth_google_client_secret', 'sec', { secret: true });
  const realFetch0 = global.fetch;
  global.fetch = async (url, init) => (String(url).includes('youtube/v3/channels') ? new Response(JSON.stringify({ items: [{ id: 'UCpersonal0000000000000a', snippet: { title: 'Personal' } }] }), { status: 200 }) : realFetch0(url, init));
  await yt.saveConnection('refresh-token', 'channel@example.test', 'test', 'access-0');
  global.fetch = realFetch0;
  const { cookie } = await call(P, 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' });
  const seen = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!/googleapis\.com/.test(u)) return realFetch(url, init);
    seen.push({ url: u, method: init.method, auth: init.headers?.Authorization });
    if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600 }), { status: 200 });
    if (u.includes('uploadType=resumable')) { seen.at(-1).meta = JSON.parse(init.body); return new Response('{}', { status: 200, headers: { location: 'https://www.googleapis.com/upload/session/abc' } }); }
    if (u.endsWith('/session/abc')) { for await (const _ of init.body) { /* drain */ } return new Response(JSON.stringify({ id: 'VID123', snippet: { channelId: 'UCbrand' } }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
  try {
    assert.equal((await call(P, 'GET', `${A}/training-videos`, null, { cookie })).data.youtube.state, 'connected');
    const r = await call(P, 'POST', `${A}/training-videos/field-coverage-agent/post`, { privacy: 'unlisted' }, { cookie });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    let row;
    for (let i = 0; i < 50; i++) { row = (await call(P, 'GET', `${A}/training-videos`, null, { cookie })).data.rows.find((x) => x.key === 'field-coverage-agent'); if (row.status !== 'posting') break; await new Promise((s) => setTimeout(s, 100)); }
    assert.equal(row.status, 'posted', row.error);
    assert.equal(row.youtube_url, 'https://www.youtube.com/watch?v=VID123');
    assert.equal(row.youtube_channel, 'UCbrand', 'the channel the video landed on is recorded');
    const init = seen.find((s) => s.meta);
    assert.equal(init.meta.status.privacyStatus, 'unlisted');
    assert.equal(init.meta.snippet.title, row.title);
    assert.equal(init.auth, 'Bearer access-1');
    assert.equal((await call(P, 'POST', `${A}/training-videos/field-coverage-agent/post`, { privacy: 'unlisted' }, { cookie })).status, 400, 'already posted');

    // a workspace library now carries the link, title and description, and serves no file for it
    const su = await call(P, 'POST', '/api/platform/signup', { accept_terms: true, slug: 'ytco', company_name: 'Yt Realty', admin_name: 'Owner', admin_email: 'owner@yt.test', admin_password: 'Tenant@12345' });
    assert.equal(su.status, 201, JSON.stringify(su.data));
    const l = await call('ytco.erp.test', 'POST', '/api/auth/login', { identifier: 'owner@yt.test', password: 'Tenant@12345' });
    const c = l.cookie;
    const lib = await call('ytco.erp.test', 'GET', '/api/training/library', null, { cookie: c });
    assert.equal(lib.status, 200, JSON.stringify(lib.data));
    const mine = lib.data.rows.find((x) => x.seed_key === 'field-coverage-agent');
    assert.equal(mine.youtube_url, 'https://www.youtube.com/watch?v=VID123');
    assert.equal(mine.title, row.title);
    const other = lib.data.rows.find((x) => x.seed_key === 'field-coverage-admin');
    assert.equal(other.youtube_url, null, 'a video not yet posted still plays from the server');
    const file = await call('ytco.erp.test', 'GET', `/api/training/library/${mine.id}/file`, null, { cookie: c });
    assert.equal(file.status, 302);
    assert.equal(file.headers.location, mine.youtube_url);
    assert.equal((await call('ytco.erp.test', 'PUT', `/api/training/library/${mine.id}`, { title: 'x' }, { cookie: c })).status, 400, 'wording is managed centrally');

    // deleting the server copy after posting
    const del = await call(P, 'DELETE', `${A}/training-videos/field-coverage-agent/copy`, null, { cookie });
    assert.equal(del.status, 200);
    assert.equal((await call(P, 'GET', `${A}/training-videos`, null, { cookie })).data.rows.find((x) => x.key === 'field-coverage-agent').server_copy, false);
    // a changed link or wording reaches the workspace the next time it opens the library
    await call(P, 'PUT', `${A}/training-videos/field-coverage-agent`, { title: 'Location sharing (updated)' }, { cookie });
    const again = await call('ytco.erp.test', 'GET', '/api/training/library', null, { cookie: c });
    assert.equal(again.data.rows.find((x) => x.seed_key === 'field-coverage-agent').title, 'Location sharing (updated)');

    // unlinking (wrong channel): the link is forgotten here and in the workspace, and the video can be posted again
    const un = await call(P, 'DELETE', `${A}/training-videos/field-coverage-agent/youtube`, null, { cookie });
    assert.equal(un.status, 200, JSON.stringify(un.data));
    assert.equal((await call(P, 'DELETE', `${A}/training-videos/field-coverage-agent/youtube`, null, { cookie })).status, 400, 'nothing left to unlink');
    const after = (await call(P, 'GET', `${A}/training-videos`, null, { cookie })).data.rows.find((x) => x.key === 'field-coverage-agent');
    assert.equal(after.youtube_url, null); assert.equal(after.status, 'ready'); assert.equal(after.youtube_channel, null);
    const gone = await call('ytco.erp.test', 'GET', '/api/training/library', null, { cookie: c });
    assert.equal(gone.data.rows.find((x) => x.seed_key === 'field-coverage-agent').youtube_url, null);
  } finally { global.fetch = realFetch; }
});

test('an expected channel blocks posting to the wrong one, and a video can be linked by hand', async () => {
  const { cookie } = await call(P, 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' });
  const st = (await call(P, 'GET', `${A}/training-videos`, null, { cookie })).data.youtube;
  assert.equal(st.channel.id, 'UCpersonal0000000000000a');
  assert.equal((await call(P, 'PUT', `${A}/training-videos/youtube/expected-channel`, { channel_id: 'nope' }, { cookie })).status, 400);
  assert.equal((await call(P, 'PUT', `${A}/training-videos/youtube/expected-channel`, { channel_id: 'UCbrand000000000000000b' }, { cookie })).status, 200);
  const blocked = await call(P, 'POST', `${A}/training-videos/vendors/post`, { privacy: 'unlisted' }, { cookie });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /not the expected/);
  assert.equal((await call(P, 'GET', `${A}/training-videos`, null, { cookie })).data.rows.find((x) => x.key === 'vendors').status, 'ready', 'nothing was started');
  // linking an upload made by hand
  assert.equal((await call(P, 'POST', `${A}/training-videos/vendors/link`, { url: 'https://example.com/x' }, { cookie })).status, 400);
  assert.equal((await call(P, 'POST', `${A}/training-videos/vendors/link`, { url: 'https://youtu.be/abcdefghijk' }, { cookie })).status, 200);
  const row = (await call(P, 'GET', `${A}/training-videos`, null, { cookie })).data.rows.find((x) => x.key === 'vendors');
  assert.equal(row.youtube_url, 'https://www.youtube.com/watch?v=abcdefghijk');
  await call(P, 'PUT', `${A}/training-videos/youtube/expected-channel`, { channel_id: '' }, { cookie });
});

test('server copies can only be deleted after the video is on YouTube', async () => {
  const { cookie } = await call(P, 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' });
  const early = await call(P, 'DELETE', `${A}/training-videos/field-coverage-admin/copy`, null, { cookie });
  assert.equal(early.status, 400);
  assert.match(early.data.error, /Post the video to YouTube first/);
  assert.equal((await call(P, 'DELETE', `${A}/training-videos/field-coverage-admin`, null, { cookie })).status, 400, 'shipped videos are not deletable');
});
