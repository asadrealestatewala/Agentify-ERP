// Video meetings: limits set by the platform, scheduling and invitations, the join window, the signalling room, captions,
// recordings and reminders. (The browser side, WebRTC itself, is covered by the browser test.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-meet-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_DEMO = '0';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.LOGIN_LIMIT = '1000';
process.env.SIGNUP_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { platformDb, getTenantBySlug, withTenant } = await import('../src/platform.js');
const { setRegionStatus } = await import('../src/regions/admin.js');
const { setSetting: setPlatform } = await import('../src/services/platformConfig.js');
const { msToLocal } = await import('../src/integrations/meetings.js');
const { runMeetingReminders } = await import('../src/routes/meetings.js');
const { get: dbGet, all: dbAll } = await import('../src/db.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}, raw = null) => new Promise((resolve, reject) => {
  const data = raw || (body ? JSON.stringify(body) : null);
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': raw ? 'application/octet-stream' : 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const buf = Buffer.concat(chunks); let d; try { d = JSON.parse(buf.toString()); } catch { d = buf.toString(); } resolve({ status: res.statusCode, data: d, buf, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
/** Opens the room's event stream and collects what arrives. */
const listen = (host, code, pid, token) => new Promise((resolve) => {
  const events = [];
  const req = http.request({ host: '127.0.0.1', port, path: `/api/meet/${code}/events?pid=${pid}&token=${token}`, headers: { Host: host } }, (res) => {
    res.setEncoding('utf8'); let buf = '';
    res.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^data: (.*)$/m.exec(frame); if (m) events.push(JSON.parse(m[1])); } });
    resolve({ events, close: () => req.destroy(), status: res.statusCode });
  });
  req.end();
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(25); } return false; };
const HOST = 'meet.erp.test';
const NY = 'America/New_York';

test('meetings: limits, scheduling, invitations, join window, room signalling, captions, recording, end', async () => {
  setRegionStatus(platformDb(), 'US', 'active', 'tester');
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'meet', company_name: 'Meet Realty', admin_name: 'Host Person', admin_email: 'owner@meet.test', admin_password: 'Tenant@12345', region: 'US', sub_region: 'Texas' });
  assert.equal(su.status, 201, JSON.stringify(su.data));
  const l = await call(HOST, 'POST', '/api/auth/login', { identifier: 'owner@meet.test', password: 'Tenant@12345' });
  const c = l.cookie;
  const get = (u) => call(HOST, 'GET', u, null, { cookie: c });
  const post = (u, b) => call(HOST, 'POST', u, b || {}, { cookie: c });
  const put = (u, b) => call(HOST, 'PUT', u, b || {}, { cookie: c });

  // the platform's backend limits
  setPlatform('meet_max_minutes_cap', '60'); setPlatform('meet_max_participants', '3');
  const caps = (await get('/api/meetings/settings')).data;
  assert.equal(caps.caps.max_minutes, 60); assert.equal(caps.caps.max_participants, 3);
  const nowLocal = (offsetMin) => msToLocal(Date.now() + offsetMin * 60_000, NY).slice(0, 16);
  assert.equal((await post('/api/meetings', { title: 'Too long', starts_at: nowLocal(5), max_minutes: 90 })).status, 400, 'beyond the platform limit');
  assert.equal((await post('/api/meetings', { title: 'Too short', starts_at: nowLocal(5), max_minutes: 2 })).status, 400);
  assert.equal((await post('/api/meetings', { title: '', starts_at: nowLocal(5) })).status, 400);
  assert.equal((await post('/api/meetings', { title: 'Past', starts_at: nowLocal(-600), max_minutes: 30 })).status, 400, 'in the past');
  assert.equal((await put('/api/meetings/settings', { default_minutes: 90 })).status, 400);

  // schedule one that starts now, with a contact, an email guest and a phone guest
  const cid = (await post('/api/contacts', { full_name: 'Client Carla', phone: '+1 512 555 0188', email: 'carla@example.com' })).data.id;
  const made = await post('/api/meetings', { title: 'Viewing walk-through', starts_at: nowLocal(0), max_minutes: 30, record: true, contact_id: cid, send: ['email', 'whatsapp'],
    invitees: [{ kind: 'contact', contact_id: cid }, { kind: 'email', email: 'bob@example.com', name: 'Bob' }, { kind: 'phone', phone: '+442071234567', name: 'Dan' }] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const m = made.data;
  assert.equal(m.max_minutes, 30); assert.equal(m.ends_at.slice(11, 16) > m.starts_at.slice(11, 16) || m.ends_at.slice(0, 10) > m.starts_at.slice(0, 10), true);
  assert.equal(m.invites.length, 4, 'host, contact, email and phone');
  const carla = m.invites.find((i) => i.contact_id === cid);
  assert.match(carla.link, new RegExp(`^http://meet\\.erp\\.test/meet/${m.code}\\?i=`)); assert.match(carla.whatsapp, /^https:\/\/wa\.me\/15125550188\?text=/); assert.match(decodeURIComponent(carla.whatsapp), /Viewing walk-through/);
  assert.ok(m.invites.find((i) => i.name === 'Dan').whatsapp);
  assert.equal(m.invites.find((i) => i.kind === 'user').whatsapp, null);
  assert.equal(new Set(m.invites.map((i) => i.link)).size, 4, 'each person has their own link');
  assert.equal((await call(HOST, 'GET', '/api/meetings')).status, 401, 'the list needs sign-in');

  // a far-future meeting cannot be joined yet
  const later = (await post('/api/meetings', { title: 'Next week', starts_at: msToLocal(Date.now() + 7 * 864e5, NY).slice(0, 16), max_minutes: 30 })).data;
  const li = await call(HOST, 'GET', `/api/meet/${later.code}/info`);
  assert.equal(li.data.join_open, false); assert.match(li.data.closed_reason, /opens/);
  assert.equal((await call(HOST, 'POST', `/api/meet/${later.code}/join`, { name: 'Early Bird' }, { cookie: c })).status, 403);

  // guests cannot start the meeting; the host can; then people join up to the limit
  const info = await call(HOST, 'GET', `/api/meet/${m.code}/info?i=${new URL(carla.link).searchParams.get('i')}`);
  assert.equal(info.data.join_open, true); assert.equal(info.data.name_hint, 'Client Carla'); assert.equal(info.data.record, true);
  assert.equal((await call(HOST, 'POST', `/api/meet/${m.code}/join`, { name: 'Client Carla', i: new URL(carla.link).searchParams.get('i') })).status, 403, 'the host must start it');
  const hj = await call(HOST, 'POST', `/api/meet/${m.code}/join`, {}, { cookie: c });
  assert.equal(hj.status, 200, JSON.stringify(hj.data)); assert.equal(hj.data.role, 'host'); assert.ok(hj.data.ice_servers.length); assert.equal(hj.data.recording_notice, 'This meeting is being recorded.');
  assert.ok(hj.data.hard_stop_ms > Date.now() + 25 * 60_000 && hj.data.hard_stop_ms < Date.now() + 31 * 60_000, 'ends 30 minutes after it starts');
  const hostStream = await listen(HOST, m.code, hj.data.pid, hj.data.token);
  assert.equal(hostStream.status, 200);
  const gj = await call(HOST, 'POST', `/api/meet/${m.code}/join`, { name: 'Client Carla', i: new URL(carla.link).searchParams.get('i') });
  assert.equal(gj.status, 200); assert.equal(gj.data.role, 'guest'); assert.equal(gj.data.peers.length, 1);
  assert.ok(await until(() => hostStream.events.some((e) => e.type === 'peer-joined' && e.peer.name === 'Client Carla')), 'the host is told');
  const guestStream = await listen(HOST, m.code, gj.data.pid, gj.data.token);
  const bj = await call(HOST, 'POST', `/api/meet/${m.code}/join`, { name: 'Bob' });
  assert.equal(bj.status, 200);
  assert.equal((await call(HOST, 'POST', `/api/meet/${m.code}/join`, { name: 'Fourth' })).status, 403, 'the room is full (limit 3)');
  assert.equal((await call(HOST, 'POST', `/api/meet/${m.code}/join`, { name: '' })).status, 400);

  // signalling is relayed only between people in the room, with a valid token
  const sig = (from, to, type, data) => call(HOST, 'POST', `/api/meet/${m.code}/signal`, { pid: from.pid, token: from.token, to: to?.pid, type, data });
  assert.equal((await sig(hj.data, gj.data, 'offer', { sdp: 'v=0...' })).status, 200);
  assert.ok(await until(() => guestStream.events.some((e) => e.type === 'offer' && e.from === hj.data.pid && e.data.sdp === 'v=0...')), 'the offer reaches the guest');
  assert.equal((await call(HOST, 'POST', `/api/meet/${m.code}/signal`, { pid: hj.data.pid, token: 'wrong', to: gj.data.pid, type: 'offer', data: {} })).status, 401);
  assert.equal((await sig(hj.data, gj.data, 'drop-table', {})).status, 400);
  assert.equal((await sig(gj.data, null, 'pointer', { x: 0.25, y: 0.5 })).status, 200);
  assert.ok(await until(() => hostStream.events.some((e) => e.type === 'pointer' && e.data.x === 0.25)), 'a pointer broadcast reaches everyone else');

  // live captions are shown to others and kept as the transcript
  await call(HOST, 'POST', `/api/meet/${m.code}/caption`, { pid: gj.data.pid, token: gj.data.token, text: 'I love the kitchen', final: false });
  await call(HOST, 'POST', `/api/meet/${m.code}/caption`, { pid: gj.data.pid, token: gj.data.token, text: 'I love the kitchen.', final: true });
  assert.ok(await until(() => hostStream.events.filter((e) => e.type === 'caption').length === 2));
  const tr = (await get(`/api/meetings/${m.id}/transcript`)).data;
  assert.equal(tr.lines.length, 1); assert.equal(tr.text, 'Client Carla: I love the kitchen.');

  // recording: only the host, only when the meeting has recording switched on
  assert.equal((await call(HOST, 'POST', `/api/meet/${m.code}/recording/chunk?pid=${gj.data.pid}&token=${gj.data.token}&seq=0`, null, {}, Buffer.from('x'))).status, 403, 'a guest cannot record');
  const q = `pid=${hj.data.pid}&token=${hj.data.token}`;
  assert.equal((await call(HOST, 'POST', `/api/meet/${m.code}/recording/chunk?${q}&seq=0`, null, {}, Buffer.from('WEBM-part-one-'))).status, 200);
  assert.equal((await call(HOST, 'POST', `/api/meet/${m.code}/recording/chunk?${q}&seq=1`, null, {}, Buffer.from('part-two'))).status, 200);
  const fin = await call(HOST, 'POST', `/api/meet/${m.code}/recording/finish?${q}`, { mime: 'video/webm', duration: 95 });
  assert.equal(fin.status, 201, JSON.stringify(fin.data));
  const recs = (await get('/api/meetings/recordings/all')).data;
  assert.equal(recs.length, 1); assert.equal(recs[0].title, 'Viewing walk-through'); assert.equal(recs[0].duration, 95); assert.equal(recs[0].caption_lines, 1);
  // filters: keyword (title and what was said), customer, host, date, time of day, transcript state, length
  const rf = async (qs) => (await get(`/api/meetings/recordings/all?${qs}`)).data;
  assert.equal((await rf('q=walk-through')).length, 1, 'title keyword');
  assert.equal((await rf('q=kitchen')).length, 1, 'something said in the meeting');
  assert.equal((await rf('q=garage')).length, 0);
  assert.equal((await rf('customer=carla')).length, 1, 'an invited customer');
  assert.equal((await rf('customer=nobody')).length, 0);
  assert.equal((await rf('host=zzz')).length, 0);
  const day = recs[0].created_at.slice(0, 10); const hhmm = recs[0].created_at.slice(11, 16);
  assert.equal((await rf(`from=${day}&to=${day}`)).length, 1, 'on the day');
  assert.equal((await rf('to=2000-01-01')).length, 0, 'before it existed');
  assert.equal((await rf(`time_from=${hhmm}&time_to=${hhmm}`)).length, 1, 'time of day');
  assert.equal((await rf('min_minutes=2')).length, 0, '95 seconds is under two minutes');
  assert.equal((await rf('min_minutes=1')).length, 1);
  assert.equal((await rf('transcript=ready')).length, 0); assert.equal((await rf('transcript=none')).length, 1);
  assert.equal((await rf("q=%25")).length, 0, 'a percent sign is searched for, not treated as a wildcard');
  assert.equal((await get('/api/meetings/recordings/all?from=yesterday')).status, 400);
  assert.equal((await get('/api/meetings/recordings/all?time_from=25:00')).status, 400);
  const vid = await call(HOST, 'GET', `/api/meetings/recordings/${recs[0].id}/video`, null, { cookie: c });
  assert.equal(vid.status, 200); assert.equal(vid.buf.toString(), 'WEBM-part-one-part-two');
  assert.equal((await call(HOST, 'GET', `/api/meetings/recordings/${recs[0].id}/video`)).status, 401);

  // the host ends it: everyone is told and nobody can come back
  assert.equal((await call(HOST, 'POST', `/api/meet/${m.code}/end`, { pid: gj.data.pid, token: gj.data.token })).status, 403, 'a guest cannot end it');
  assert.equal((await call(HOST, 'POST', `/api/meet/${m.code}/end`, { pid: hj.data.pid, token: hj.data.token })).status, 200);
  assert.ok(await until(() => guestStream.events.some((e) => e.type === 'ended')));
  const after = await call(HOST, 'POST', `/api/meet/${m.code}/join`, { name: 'Late' });
  assert.equal(after.status, 403); assert.match(after.data.error, /ended/);
  const past = (await get('/api/meetings?scope=past')).data;
  assert.ok(past.some((x) => x.id === m.id && x.status === 'ended' && x.recordings === 1));
  hostStream.close(); guestStream.close();

  // reschedule and cancel
  const ok = await put(`/api/meetings/${later.id}`, { starts_at: msToLocal(Date.now() + 8 * 864e5, NY).slice(0, 16), max_minutes: 45 });
  assert.equal(ok.status, 200); assert.equal(ok.data.max_minutes, 45);
  assert.equal((await put(`/api/meetings/${later.id}`, { max_minutes: 500 })).status, 400);
  assert.equal((await post(`/api/meetings/${later.id}/cancel`)).status, 200);
  assert.match((await call(HOST, 'GET', `/api/meet/${later.code}/info`)).data.closed_reason, /canceled/);
});

test('reminders: 15 minutes before, once per person, in-app for staff and email for guests', async () => {
  const l = await call(HOST, 'POST', '/api/auth/login', { identifier: 'owner@meet.test', password: 'Tenant@12345' });
  const post = (u, b) => call(HOST, 'POST', u, b || {}, { cookie: l.cookie });
  const soon = (await post('/api/meetings', { title: 'Reminder me', starts_at: msToLocal(Date.now() + 10 * 60_000, NY).slice(0, 16), max_minutes: 30, invitees: [{ kind: 'email', email: 'zed@example.com', name: 'Zed' }] })).data;
  const t = getTenantBySlug('meet');
  await withTenant(t, () => runMeetingReminders());
  await withTenant(t, () => runMeetingReminders());
  withTenant(t, () => {
    const inv = dbAll('SELECT * FROM meeting_invites WHERE meeting_id=?', soon.id);
    assert.ok(inv.every((i) => i.remind_15m_at), 'both people were reminded');
    const n = dbAll("SELECT * FROM notifications WHERE type='meeting' AND title LIKE 'Meeting in 15 minutes%'");
    assert.equal(n.length, 1, 'the host gets one in-app reminder, not two');
    assert.match(n[0].link, new RegExp(`/meet/${soon.code}`));
    assert.equal(dbGet('SELECT COUNT(*) n FROM meeting_invites WHERE meeting_id=? AND remind_24h_at IS NOT NULL', soon.id).n, 2, 'the 24-hour reminder is skipped silently when the meeting is already closer than that');
  });
});
