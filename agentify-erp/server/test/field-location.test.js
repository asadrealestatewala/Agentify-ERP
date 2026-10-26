import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-field-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { get } = await import('../src/db.js');
const { purgeFieldLocations, freshnessOf, fieldSettings } = await import('../src/services/fieldLocation.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, password = 'Demo@12345') {
  const jar = {};
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const l = await call('POST', '/api/auth/login', { identifier, password });
  assert.equal(l.status, 200, `login failed for ${identifier}`);
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), me: l.data };
}

const reading = (extra = {}) => ({ lat: 33.6007, lng: 73.0679, accuracy: 18, captured_at: new Date().toISOString(), ...extra });
const uidOf = (email) => get('SELECT id FROM users WHERE email=?', email).id;

test('off until an admin enables it and the employee accepts the current notice', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  const me = await agent.get('/api/field/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.settings.enabled, false, 'disabled by default for every workspace');
  assert.equal(me.data.status.sharing, 'off');
  let r = await agent.post('/api/field/me/location', reading());
  assert.equal(r.status, 403); assert.equal(r.data.code, 'field_location_disabled');

  assert.equal((await agent.put('/api/field/settings', { enabled: true })).status, 403, 'an agent cannot enable it');
  const admin = await client('admin.demo@expertdevelopers.pk');
  const s = await admin.put('/api/field/settings', { enabled: true });
  assert.equal(s.status, 200); assert.equal(s.data.enabled, true);
  assert.equal(s.data.retention_days, 30);

  r = await agent.post('/api/field/me/location', reading());
  assert.equal(r.status, 403); assert.equal(r.data.code, 'consent_required', 'device permission alone is not enough');
  assert.equal((await agent.post('/api/field/me/consent', { notice_version: 99 })).status, 409, 'must accept the version shown');
  const ok = await agent.post('/api/field/me/consent', { notice_version: s.data.notice_version });
  assert.equal(ok.status, 200); assert.equal(ok.data.consent.accepted, true);
  assert.ok(get("SELECT 1 FROM audit_log WHERE action='Location notice accepted'"), 'consent is audited');
});

test('one-time share stores only the latest reading, with capture time and accuracy', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  const t1 = new Date(Date.now() - 60_000).toISOString();
  let r = await agent.post('/api/field/me/location', reading({ captured_at: t1 }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status.location.captured_at, t1);
  assert.equal(r.data.status.location.accuracy_m, 18);
  assert.equal(r.data.status.freshness, 'fresh');
  assert.ok(r.data.status.location.received_at >= t1, 'server receive time is recorded separately');
  r = await agent.post('/api/field/me/location', reading({ lat: 33.7, captured_at: new Date().toISOString() }));
  assert.equal(r.data.status.location.lat, 33.7);
  const uid = uidOf('agent1@expertdevelopers.pk');
  assert.equal(get('SELECT COUNT(*) n FROM field_agents WHERE user_id=?', uid).n, 1, 'no route history: one row per employee');
  // a delayed retry of the older reading never overwrites the newer one
  r = await agent.post('/api/field/me/location', reading({ lat: 10, captured_at: t1 }));
  assert.equal(r.status, 200); assert.equal(r.data.ignored, 'older_than_current');
  assert.equal(get('SELECT lat FROM field_agents WHERE user_id=?', uid).lat, 33.7);
});

test('bad, future and stale readings are refused', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  assert.equal((await agent.post('/api/field/me/location', reading({ lat: 95 }))).status, 400);
  assert.equal((await agent.post('/api/field/me/location', reading({ lat: 0, lng: 0 }))).status, 400);
  assert.equal((await agent.post('/api/field/me/location', reading({ accuracy: null }))).status, 400);
  assert.equal((await agent.post('/api/field/me/location', reading({ captured_at: undefined }))).status, 400);
  assert.equal((await agent.post('/api/field/me/location', reading({ captured_at: new Date(Date.now() + 10 * 60_000).toISOString() }))).status, 400);
  const old = await agent.post('/api/field/me/location', reading({ captured_at: new Date(Date.now() - 45 * 60_000).toISOString() }));
  assert.equal(old.status, 422); assert.equal(old.data.code, 'reading_too_old');
});

test('staff submit only their own location; another sign-in\'s reading is refused', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  const other = uidOf('agent2@expertdevelopers.pk');
  const r = await agent.post('/api/field/me/location', reading({ uid: other, user_id: other }));
  assert.equal(r.status, 409); assert.equal(r.data.code, 'session_mismatch');
  assert.equal(get('SELECT lat FROM field_agents WHERE user_id=?', other)?.lat ?? null, null, 'nothing written for the other employee');
  assert.equal((await agent.put(`/api/field/team/${other}/area`, { service_area: 'X' })).status, 403);
});

test('denied/unavailable location is recorded apart from real readings', async () => {
  const agent = await client('agent2@expertdevelopers.pk');
  const admin = await client('admin.demo@expertdevelopers.pk');
  const v = (await admin.get('/api/field/settings')).data.notice_version;
  await agent.post('/api/field/me/consent', { notice_version: v });
  assert.equal((await agent.post('/api/field/me/location-error', { code: 'bogus' })).status, 400);
  const r = await agent.post('/api/field/me/location-error', { code: 'denied' });
  assert.equal(r.status, 200);
  const st = (await agent.get('/api/field/me')).data.status;
  assert.equal(st.last_error, 'denied');
  assert.equal(st.location, null, 'a denial is never shown as a location');
  assert.equal(st.freshness, 'none');
});

test('foreground sharing: session bound, Stop ends it, late pings are refused, logout ends it', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  const start = await agent.post('/api/field/me/sharing', { mode: 'foreground' });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.equal(start.data.status.sharing, 'foreground');
  const session = start.data.session;
  assert.match(session, /^[A-Za-z0-9_-]{16,64}$/);
  const uid = agent.me.id;
  let r = await agent.post('/api/field/me/location', reading({ mode: 'foreground', session, uid }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await agent.post('/api/field/me/location', reading({ mode: 'foreground', session: 'x'.repeat(24), uid }));
  assert.equal(r.status, 409, 'a ping from another session is refused');
  await agent.post('/api/field/me/sharing', { mode: 'off' });
  assert.equal((await agent.get('/api/field/me')).data.status.sharing, 'off');
  r = await agent.post('/api/field/me/location', reading({ mode: 'foreground', session, uid }));
  assert.equal(r.status, 409); assert.equal(r.data.code, 'sharing_stopped');

  const again = await agent.post('/api/field/me/sharing', { mode: 'foreground' });
  assert.notEqual(again.data.session, session, 'every start gets a new session');
  assert.equal((await agent.post('/api/auth/logout')).status, 200);
  assert.equal(get('SELECT sharing FROM field_agents WHERE user_id=?', uid).sharing, 'off', 'logout ends sharing');
  const back = await client('agent1@expertdevelopers.pk');
  r = await back.post('/api/field/me/location', reading({ mode: 'foreground', session: again.data.session, uid }));
  assert.equal(r.status, 409, 'an old session is never replayed after signing in again');
});

test('availability is separate from location freshness', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  assert.equal((await agent.put('/api/field/me/availability', { availability: 'flying' })).status, 400);
  const r = await agent.put('/api/field/me/availability', { availability: 'busy' });
  assert.equal(r.status, 200);
  const st = (await agent.get('/api/field/me')).data.status;
  assert.equal(st.availability, 'busy');
  assert.equal(st.freshness, 'fresh', 'changing availability does not touch the reading');
  const s = fieldSettings();
  const longAgo = new Date(Date.now() - (s.stale_minutes + 5) * 60_000).toISOString();
  assert.equal(freshnessOf(longAgo, s).freshness, 'stale');
  assert.equal(freshnessOf(new Date(Date.now() - (s.fresh_minutes + 1) * 60_000).toISOString(), s).freshness, 'recent');
  assert.equal(freshnessOf(null, s).freshness, 'none');
});

test('managers see only their reporting line; HR sees everyone; agents see nobody', async () => {
  const sm = await client('salesmanager@expertdevelopers.pk');
  const team = await sm.get('/api/field/team');
  assert.equal(team.status, 200);
  assert.equal(team.data.scope, 'reports');
  const names = team.data.agents.map((a) => a.user_id);
  assert.ok(names.includes(uidOf('agent1@expertdevelopers.pk')));
  assert.ok(!names.includes(uidOf('hr@expertdevelopers.pk')), 'not outside the reporting line');
  assert.ok(!names.includes(sm.me.id), 'not themselves');
  const a1 = team.data.agents.find((a) => a.user_id === uidOf('agent1@expertdevelopers.pk'));
  assert.equal(a1.availability, 'busy'); assert.ok(a1.location); assert.equal(a1.consent, 'accepted');
  assert.ok(['fresh', 'recent', 'stale'].includes(a1.freshness));

  const agent = await client('agent2@expertdevelopers.pk');
  const none = await agent.get('/api/field/team');
  assert.equal(none.data.scope, 'none'); assert.equal(none.data.agents.length, 0);
  assert.equal((await agent.get('/api/field/me')).data.can_view_team, false);

  const hr = await client('hr@expertdevelopers.pk');
  const all = await hr.get('/api/field/team');
  assert.equal(all.data.scope, 'all');
  assert.ok(all.data.agents.length > names.length);
  assert.ok(all.data.agents.every((a) => a.role !== 'Customer'), 'no portal accounts');
  const area = await hr.put(`/api/field/team/${uidOf('agent1@expertdevelopers.pk')}/area`, { service_area: 'Bahria Town Phase 7' });
  assert.equal(area.status, 200);
  assert.equal((await sm.get('/api/field/team')).data.agents.find((x) => x.user_id === uidOf('agent1@expertdevelopers.pk')).service_area, 'Bahria Town Phase 7');
  assert.equal((await sm.put(`/api/field/team/${uidOf('agent1@expertdevelopers.pk')}/area`, { service_area: 'Y' })).status, 403, 'needs hrm:edit');
});

test('changing the notice requires re-acceptance; withdrawing deletes the location', async () => {
  const admin = await client('admin.demo@expertdevelopers.pk');
  assert.equal((await admin.put('/api/field/settings', { notice: 'too short' })).status, 400);
  const s = await admin.put('/api/field/settings', { notice: 'Updated notice: your manager sees your last shared location, its time and accuracy, only when you share.' });
  assert.equal(s.status, 200);
  const agent = await client('agent1@expertdevelopers.pk');
  const me = (await agent.get('/api/field/me')).data;
  assert.equal(me.consent.accepted, false); assert.equal(me.consent.needs_reaccept, true);
  assert.equal((await agent.post('/api/field/me/location', reading())).data.code, 'consent_required');
  await agent.post('/api/field/me/consent', { notice_version: s.data.notice_version });
  const w = await agent.del('/api/field/me/consent');
  assert.equal(w.status, 200);
  assert.equal(w.data.status.location, null);
  assert.equal(w.data.status.availability, 'busy', 'availability is kept');
  assert.equal(get('SELECT lat FROM field_agents WHERE user_id=?', agent.me.id).lat, null);
});

test('retention clean-up deletes old readings and ends quiet sessions', async () => {
  const agent = await client('agent2@expertdevelopers.pk');
  const admin = await client('admin.demo@expertdevelopers.pk');
  await agent.post('/api/field/me/consent', { notice_version: (await admin.get('/api/field/settings')).data.notice_version });
  assert.equal((await agent.post('/api/field/me/location', reading())).status, 200);
  await agent.post('/api/field/me/sharing', { mode: 'foreground' });
  const uid = agent.me.id;
  const s = fieldSettings();
  let out = purgeFieldLocations();
  assert.equal(get('SELECT sharing FROM field_agents WHERE user_id=?', uid).sharing, 'foreground', 'an active session is left alone');
  out = purgeFieldLocations(Date.now() + (s.retention_days + 1) * 864e5);
  assert.ok(out.purged >= 1); assert.ok(out.ended >= 1);
  const row = get('SELECT * FROM field_agents WHERE user_id=?', uid);
  assert.equal(row.lat, null); assert.equal(row.sharing, 'off');
  assert.equal((await admin.put('/api/field/settings', { retention_days: 0 })).status, 400);
  assert.equal((await admin.put('/api/field/settings', { fresh_minutes: 30, stale_minutes: 20 })).status, 400);
});

test('turning the feature off stops everyone sharing', async () => {
  const agent = await client('agent2@expertdevelopers.pk');
  await agent.post('/api/field/me/sharing', { mode: 'foreground' });
  const admin = await client('admin.demo@expertdevelopers.pk');
  await admin.put('/api/field/settings', { enabled: false });
  assert.equal(get("SELECT COUNT(*) n FROM field_agents WHERE sharing<>'off'").n, 0);
});
