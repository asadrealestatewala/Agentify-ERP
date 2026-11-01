import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-route-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { get, all } = await import('../src/db.js');
const { purgeFieldLocations, fieldSettings, metres, noticeWithRoute, DEFAULT_NOTICE, submitLocation } = await import('../src/services/fieldLocation.js');
const D = await import('../src/services/directions.js');

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
const at = (minAgo) => new Date(Date.now() - minAgo * 60_000).toISOString();
const win = () => `from=${encodeURIComponent(at(600))}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`;

test('notice sentence follows the route history setting', () => {
  assert.ok(DEFAULT_NOTICE.includes('No route history is kept.'));
  const on = noticeWithRoute(DEFAULT_NOTICE, true);
  assert.ok(!on.includes('No route history is kept.') && on.includes('kept as a route'));
  assert.equal(noticeWithRoute(on, false), DEFAULT_NOTICE);
  assert.ok(noticeWithRoute('A custom notice that is long enough to count as one.', true).includes('kept as a route'));
});

test('no route is stored while route history is off; turning it on asks everyone to agree again', async () => {
  const admin = await client('admin.demo@expertdevelopers.pk');
  const agent = await client('agent1@expertdevelopers.pk');
  const before = (await admin.get('/api/field/settings')).data;
  assert.equal(before.route_history, false);
  assert.equal((await admin.put('/api/field/settings', { enabled: true })).status, 200);
  await agent.post('/api/field/me/consent', { notice_version: (await admin.get('/api/field/settings')).data.notice_version });
  assert.equal((await agent.post('/api/field/me/location', { lat: 33.6, lng: 73.06, accuracy: 10, captured_at: at(1) })).status, 200);
  assert.equal(all('SELECT * FROM field_points').length, 0, 'nothing kept while off');

  const on = await admin.put('/api/field/settings', { route_history: true });
  assert.equal(on.status, 200);
  assert.equal(on.data.route_history, true);
  assert.equal(on.data.notice_version, before.notice_version + 1);
  assert.ok(on.data.notice.includes('kept as a route'));
  const blocked = await agent.post('/api/field/me/location', { lat: 33.61, lng: 73.07, accuracy: 10, captured_at: at(0) });
  assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'consent_required');
});

test('route points are stored, thinned, replayed to the manager and deleted with consent or retention', async () => {
  const admin = await client('admin.demo@expertdevelopers.pk');
  const agent = await client('agent2@expertdevelopers.pk');
  const v = (await admin.get('/api/field/settings')).data.notice_version;
  await agent.post('/api/field/me/consent', { notice_version: v });
  const uid = agent.me.id;
  const send = (lat, lng, min) => agent.post('/api/field/me/location', { lat, lng, accuracy: 12, captured_at: at(min) });
  assert.equal((await send(33.6000, 73.0600, 9)).status, 200);
  assert.equal((await send(33.6000, 73.06001, 8)).status, 200); // moved ~1 m in 1 minute: not added
  assert.equal((await send(33.6100, 73.0600, 6)).status, 200);
  assert.equal((await send(33.6200, 73.0600, 3)).status, 200);
  assert.equal(all('SELECT * FROM field_points WHERE user_id=?', uid).length, 3);

  const r = await admin.get(`/api/field/team/${uid}/route?${win()}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.enabled, true); assert.equal(r.data.count, 3);
  assert.ok(r.data.distance_m > 2000 && r.data.distance_m < 2400, `distance ${r.data.distance_m}`);
  assert.ok(r.data.points[0].captured_at < r.data.points[2].captured_at);
  assert.ok(all("SELECT id FROM audit_log WHERE action='Field route viewed'").length >= 1);

  assert.equal((await admin.get(`/api/field/team/${uid}/route?from=nope&to=nope`)).status, 400);
  const wide = await admin.get(`/api/field/team/${uid}/route?from=${encodeURIComponent(at(60 * 24 * 5))}&to=${encodeURIComponent(at(0))}`);
  assert.equal(wide.status, 400);
  // an employee cannot read a colleague's route
  const other = await client('agent1@expertdevelopers.pk');
  assert.equal((await other.get(`/api/field/team/${uid}/route?${win()}`)).status, 403);

  const s = fieldSettings();
  const out = purgeFieldLocations(Date.now() + (s.retention_days + 1) * 864e5);
  assert.ok(out.points >= 3);
  assert.equal(all('SELECT * FROM field_points').length, 0);

  await send(33.6, 73.06, 1);
  assert.equal(all('SELECT * FROM field_points WHERE user_id=?', uid).length, 1);
  assert.equal((await agent.del('/api/field/me/consent')).status, 200);
  assert.equal(all('SELECT * FROM field_points WHERE user_id=?', uid).length, 0, 'withdrawing consent deletes the route');
});

test('turning route history off deletes saved routes', async () => {
  const admin = await client('admin.demo@expertdevelopers.pk');
  const agent = await client('agent2@expertdevelopers.pk');
  await agent.post('/api/field/me/consent', { notice_version: (await admin.get('/api/field/settings')).data.notice_version });
  await agent.post('/api/field/me/location', { lat: 33.7, lng: 73.1, accuracy: 10, captured_at: at(0) });
  assert.ok(all('SELECT * FROM field_points').length >= 1);
  const off = await admin.put('/api/field/settings', { route_history: false });
  assert.equal(off.data.route_history, false);
  assert.ok(!off.data.notice.includes('kept as a route'));
  assert.equal(all('SELECT * FROM field_points').length, 0);
  const r = await admin.get(`/api/field/team/${agent.me.id}/route?${win()}`);
  assert.equal(r.data.enabled, false);
});

test('haversine', () => { assert.ok(Math.abs(metres(0, 0, 0, 1) - 111195) < 200); });

// ---------------- directions ----------------
const osrmJson = { code: 'Ok', routes: [{ distance: 1234.4, duration: 301, geometry: { coordinates: [[73.06, 33.6], [73.07, 33.61], [73.08, 33.62]] }, legs: [{ steps: [
  { distance: 600, duration: 100, name: 'Jinnah Avenue', maneuver: { type: 'depart', bearing_after: 90, location: [73.06, 33.6] } },
  { distance: 600, duration: 150, name: 'Kashmir Highway', maneuver: { type: 'turn', modifier: 'left', location: [73.07, 33.61] } },
  { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', modifier: 'right', location: [73.08, 33.62] } },
] }] }] };

test('OSRM answers become one simple shape with readable steps', () => {
  D._clearDirectionsCache();
  const r = D.fromOsrm(osrmJson, 'driving');
  assert.equal(r.distance_m, 1234); assert.equal(r.duration_s, 301);
  assert.deepEqual(r.steps.map((s) => s.text), ['Head east on Jinnah Avenue', 'Turn left onto Kashmir Highway', 'Arrive, your destination is on the right']);
  assert.deepEqual(r.geometry[0], [73.06, 33.6]);
  assert.throws(() => D.fromOsrm({ code: 'NoRoute' }, 'driving'), D.NoRoute);
});

test('Valhalla polyline decoding and answer shape', () => {
  // encode helper (polyline, 6 decimals)
  const enc = (pts) => { let pl = 0; let pg = 0; let o = ''; const e = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { o += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } o += String.fromCharCode(v + 63); }; for (const [lng, lat] of pts) { const a = Math.round(lat * 1e6); const b = Math.round(lng * 1e6); e(a - pl); e(b - pg); pl = a; pg = b; } return o; };
  const pts = [[73.06, 33.6], [73.0712, 33.6123]];
  assert.deepEqual(D.decodePolyline6(enc(pts)), pts);
  const r = D.fromValhalla({ trip: { status: 0, summary: { length: 1.5, time: 200 }, legs: [{ shape: enc(pts), maneuvers: [{ instruction: 'Drive east.', length: 1.5, time: 200, begin_shape_index: 0 }] }] } }, 'driving');
  assert.equal(r.distance_m, 1500); assert.equal(r.steps[0].text, 'Drive east');
});

test('falls back to Valhalla when OSRM is down, caches, and reports no route', async () => {
  D._clearDirectionsCache();
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/route/v1/')) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ trip: { status: 0, summary: { length: 2, time: 100 }, legs: [{ shape: '_p~iF~ps|U_ulLnnqC', maneuvers: [{ instruction: 'Go', length: 2, time: 100, begin_shape_index: 0 }] }] } }) };
  };
  const a = await D.directions({ lat: 33.6, lng: 73.06 }, { lat: 33.7, lng: 73.1 }, 'walking', { fetchFn });
  assert.equal(a.provider, 'valhalla'); assert.equal(a.profile, 'walking');
  assert.ok(calls[0].includes('routed-foot'));
  const n = calls.length;
  await D.directions({ lat: 33.6, lng: 73.06 }, { lat: 33.7, lng: 73.1 }, 'walking', { fetchFn });
  assert.equal(calls.length, n, 'second call comes from the cache');
  const none = async () => ({ ok: false, status: 400, json: async () => ({ code: 'NoRoute' }) });
  await assert.rejects(D.directions({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, 'driving', { fetchFn: none }), D.NoRoute);
  const down = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(D.directions({ lat: 5, lng: 5 }, { lat: 6, lng: 6 }, 'driving', { fetchFn: down }), /not available/);
});

test('directions API checks its input and needs a staff sign-in', async () => {
  const agent = await client('agent1@expertdevelopers.pk');
  assert.equal((await agent.get('/api/directions?from=abc&to=33.6,73.0')).status, 400);
  assert.equal((await agent.get('/api/directions?from=33.6,73.0&to=0,0')).status, 400);
  assert.equal((await agent.get('/api/directions?from=33.6,73.0&to=33.7,73.1&mode=flying')).status, 400);
  const anon = await fetch(base + '/api/directions?from=33.6,73.0&to=33.7,73.1');
  assert.equal(anon.status, 401);
});
