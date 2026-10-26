// Property visits: life cycle, check-in evidence, retries, permissions and workspace isolation, plus the shared time and
// distance rules exercised with one fixture per region (US, Canada, UK, UAE, Pakistan).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-visits-'));
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

const V = await import('../../shared/visits.js');
const { createApp } = await import('../src/index.js');
const { platformDb, getTenantBySlug, withTenant } = await import('../src/platform.js');
const { setRegionStatus } = await import('../src/regions/admin.js');
const { clientConfig } = await import('../src/regions/runtime.js');
const { get: dbGet, all: dbAll, run: dbRun } = await import('../src/db.js');
const { runVisitReminders } = await import('../src/routes/appointments.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const t = Buffer.concat(chunks).toString(); let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const as = async (host, email, password) => {
  const l = await call(host, 'POST', '/api/auth/login', { identifier: email, password });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const h = { cookie: l.cookie };
  return { get: (u) => call(host, 'GET', u, null, h), post: (u, b, x = {}) => call(host, 'POST', u, b || {}, { ...h, ...x }), put: (u, b) => call(host, 'PUT', u, b || {}, h) };
};
async function workspace(slug, region, extra = {}) {
  setRegionStatus(platformDb(), region, 'active', 'tester');
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner Person', admin_email: `owner@${slug}.test`, admin_password: 'Tenant@12345', region, ...extra });
  assert.equal(su.status, 201, JSON.stringify(su.data));
  return `${slug}.erp.test`;
}
const reading = (lat, lng, extra = {}) => ({ status: 'captured', lat, lng, accuracy: 12, captured_at: new Date().toISOString(), ...extra });
let n = 0;
const key = () => `k-${Date.now()}-${++n}-abcdef`;

// ---------------------------------------------------------------- shared rules with regional fixtures
const REGIONS = [
  // [code, zone, a DST-boundary local time (or a normal one where there is no DST), its UTC instant, distance unit]
  ['US', 'America/New_York', '2026-03-08 02:30', '2026-03-08T07:30:00Z', 'mi'], // spring-forward gap: moves to 03:30 EDT
  ['CA', 'America/Vancouver', '2026-11-01 01:30', '2026-11-01T08:30:00Z', 'km'], // fall-back: first 01:30 (PDT) wins
  ['UK', 'Europe/London', '2026-10-25 01:30', '2026-10-25T00:30:00Z', 'mi'], // fall-back in London: BST first
  ['AE', 'Asia/Dubai', '2026-10-25 10:00', '2026-10-25T06:00:00Z', 'km'], // no DST, UTC+4
  ['PK', 'Asia/Karachi', '2026-10-25 10:00', '2026-10-25T05:00:00Z', 'km'], // no DST, UTC+5
];
test('time zones: wall time to UTC across DST boundaries and zones with no DST, per region', () => {
  for (const [code, tz, wall, utc] of REGIONS) {
    assert.equal(V.toUtcIso(V.wallToMs(wall, tz)), utc, `${code} ${tz} ${wall}`);
    // round trip back to the same face value, except inside the spring-forward gap (02:30 does not exist there)
    assert.equal(V.msToWall(Date.parse(utc), tz).slice(0, 16), code === 'US' ? '2026-03-08 03:30' : wall);
  }
  // one country, several zones: 10:00 in New York and 10:00 in Los Angeles are three hours apart
  assert.equal(V.wallToMs('2026-07-01 10:00', 'America/Los_Angeles') - V.wallToMs('2026-07-01 10:00', 'America/New_York'), 3 * 3600e3);
  // offsets are never fixed: the same London wall time is UTC+1 in July and UTC+0 in December
  assert.equal(V.toUtcIso(V.wallToMs('2026-07-01 09:00', 'Europe/London')), '2026-07-01T08:00:00Z');
  assert.equal(V.toUtcIso(V.wallToMs('2026-12-01 09:00', 'Europe/London')), '2026-12-01T09:00:00Z');
  assert.ok(Number.isNaN(V.wallToMs('2026-07-01 09:00', 'Mars/Olympus')));
  assert.equal(V.validTimeZone('UTC+5'), false);
});

test('distance: metres inside, each region\'s display unit outside, French/Arabic/Urdu number formats', () => {
  for (const [code, , , , unit] of REGIONS) assert.equal(clientConfig({ region: code }).distance_unit, unit, `${code} distance unit`);
  assert.ok(clientConfig({ region: 'CA' }).timezones.includes('America/Vancouver'), 'Canada offers more than one zone');
  const d = V.haversineM({ lat: 40.7484, lng: -73.9857 }, { lat: 40.7527, lng: -73.9772 }); // Empire State -> Grand Central, ~ 870 m
  assert.ok(d > 800 && d < 950, String(d));
  assert.equal(V.formatDistance(1234, { unit: 'km', locale: 'en-CA' }), '1.2 km');
  assert.equal(V.formatDistance(1234, { unit: 'km', locale: 'fr-CA' }), '1,2 km');
  assert.equal(V.formatDistance(150, { unit: 'mi', locale: 'en-US' }), '490 ft');
  assert.equal(V.formatDistance(3000, { unit: 'mi', locale: 'en-GB' }), '1.9 mi');
  assert.match(V.formatDistance(1234, { unit: 'km', locale: 'ar-AE' }), /km$/);
  assert.match(V.formatDistance(1234, { unit: 'km', locale: 'ur-PK' }), /km$/);
  // proximity depends on metres only, never on the property's area unit (Marla, sq ft, sq m stay as they are)
  assert.equal(V.proximity(50, 10, 200), 'near');
  assert.equal(V.proximity(190, 30, 200), 'near_uncertain');
  assert.equal(V.proximity(230, 50, 200), 'uncertain');
  assert.equal(V.proximity(900, 20, 200), 'far');
  assert.equal(V.proximity(NaN, 5, 200), 'unknown');
});

test('location readings: verified, stale, denied, unavailable and manual are told apart', () => {
  const t = Date.parse('2026-10-25T12:00:00Z');
  const c = (r, o = {}) => V.classifyReading(r, { serverMs: t, maxAgeS: 120, ...o });
  assert.equal(c({ status: 'captured', lat: 25.2, lng: 55.27, accuracy: 9, captured_at: '2026-10-25T11:59:30Z' }).location_status, 'verified');
  assert.equal(c({ status: 'captured', lat: 25.2, lng: 55.27, accuracy: 9, captured_at: '2026-10-25T11:40:00Z' }).location_status, 'stale', 'too old on arrival');
  assert.equal(c({ status: 'captured', lat: 25.2, lng: 55.27, accuracy: 9, captured_at: '2026-10-25T12:10:00Z' }).location_status, 'stale', 'device clock ahead');
  assert.equal(c({ status: 'captured', lat: 25.2, lng: 55.27 }).location_status, 'stale', 'no capture time');
  assert.equal(c({ status: 'captured', lat: 0, lng: 0, captured_at: '2026-10-25T11:59:30Z' }).location_status, 'unavailable', 'null island is not a reading');
  assert.deepEqual(c({ status: 'denied', lat: 1, lng: 1 }), { location_status: 'denied' }, 'no coordinates kept with a denial');
  assert.ok(c({ status: 'manual', reason: 'GPS off in basement' }).error, 'manual needs the workspace to allow it');
  assert.ok(c({ status: 'manual', reason: '' }, { manualAllowed: true }).error, 'manual needs a reason');
  assert.deepEqual(c({ status: 'manual', reason: 'GPS off in basement', lat: 1, lng: 1 }, { manualAllowed: true }), { location_status: 'manual', manual_reason: 'GPS off in basement' });
  assert.ok(c({}).error);
});

test('transitions: only the allowed moves', () => {
  assert.ok(V.canMove('scheduled', 'in_progress')); assert.ok(V.canMove('in_progress', 'completed')); assert.ok(V.canMove('in_progress', 'no_show'));
  assert.ok(!V.canMove('scheduled', 'completed')); assert.ok(!V.canMove('completed', 'canceled')); assert.ok(!V.canMove('canceled', 'in_progress'));
  assert.equal(V.normState('cancelled'), 'canceled');
});

// ---------------------------------------------------------------- the API, end to end
test('visits: schedule, retry safely, check in with location, check out with outcome and one follow-up task', async () => {
  const host = await workspace('visit-us', 'US', { sub_region: 'Texas' });
  const owner = await as(host, 'owner@visit-us.test', 'Tenant@12345');
  const roles = (await owner.get('/api/settings/roles')).data;
  const agentRole = (roles.items || roles).find((r) => r.name === 'Sales Agent');
  for (const [who, nm] of [['agent1', 'Alex Agent'], ['agent2', 'Sam Agent']]) { const u = await owner.post('/api/settings/users', { name: nm, email: `${who}@visit-us.test`, password: 'Agent@12345', role_id: agentRole.id }); assert.equal(u.status, 201, JSON.stringify(u.data)); }
  const agent = await as(host, 'agent1@visit-us.test', 'Agent@12345');
  const other = await as(host, 'agent2@visit-us.test', 'Agent@12345');
  const t = getTenantBySlug('visit-us');
  let propId, contactId, agentId, otherId;
  withTenant(t, () => {
    agentId = dbGet("SELECT id FROM users WHERE email='agent1@visit-us.test'").id; otherId = dbGet("SELECT id FROM users WHERE email='agent2@visit-us.test'").id;
    propId = Number(dbRun("INSERT INTO properties(title, status, lat, lng, area_size, unit, created_at) VALUES('Maple House','available',30.2672,-97.7431,1850,'sqft',datetime('now'))").lastInsertRowid);
    contactId = Number(dbRun("INSERT INTO contacts(full_name, agent_id, created_at) VALUES('Pat Buyer', ?, datetime('now'))", agentId).lastInsertRowid);
  });

  // manager books the visit for the agent, in Chicago time (the property's zone), not the workspace's New York zone
  const k1 = key();
  const body = { title: 'Viewing: Maple House', kind: 'viewing', property_id: propId, contact_id: contactId, agent_id: agentId, starts_at: '2026-11-01T01:30', timezone: 'America/Chicago', notes: 'Bring keys', client_key: k1 };
  const made = await owner.post('/api/appointments', body);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.user_id, agentId); assert.equal(made.data.tz, 'America/Chicago'); assert.equal(made.data.starts_utc, '2026-11-01T06:30:00Z', 'first 01:30 on fall-back night (CDT)');
  assert.equal(made.data.ends_at, '2026-11-01 01:30:00', 'one hour later is 01:30 CST: same wall time, later instant');
  assert.equal(made.data.ends_utc, '2026-11-01T07:30:00Z');
  const again = await owner.post('/api/appointments', body);
  assert.equal(again.status, 200); assert.equal(again.data.id, made.data.id); assert.equal(again.data.replayed, true);
  withTenant(t, () => assert.equal(dbGet('SELECT COUNT(*) n FROM appointments').n, 1, 'a retried booking creates nothing new'));
  assert.equal((await owner.post('/api/appointments', { ...body, client_key: key(), timezone: 'Nowhere/Land' })).status, 400);

  // agents: their own visits only; cannot book for others
  assert.equal((await agent.get('/api/appointments')).data.items.length, 1);
  assert.equal((await other.get('/api/appointments')).data.items.length, 0);
  assert.equal((await other.get(`/api/appointments/${made.data.id}`)).status, 403);
  assert.equal((await other.post('/api/appointments', { title: 'x', starts_at: '2026-11-03T10:00', agent_id: agentId })).status, 403);
  assert.equal((await other.post('/api/appointments', { title: 'x', starts_at: '2026-11-03T10:00', contact_id: contactId })).status, 403, 'not their contact');
  assert.equal((await agent.get(`/api/appointments?property_id=${propId}`)).data.items.length, 1);

  // nobody but the assigned agent records evidence; the manager cannot check in on their behalf
  const id = made.data.id;
  assert.equal((await owner.post(`/api/appointments/${id}/check-in`, { location: reading(30.2672, -97.7431), client_key: key() })).status, 403);
  assert.equal((await other.post(`/api/appointments/${id}/check-in`, { location: reading(30.2672, -97.7431), client_key: key() })).status, 403);
  assert.equal((await agent.post(`/api/appointments/${id}/check-out`, { location: { status: 'denied' }, outcome: 'interested', client_key: key() })).status, 409, 'not checked in yet');

  const ck = key();
  const inn = await agent.post(`/api/appointments/${id}/check-in`, { location: reading(30.2680, -97.7431), client_key: ck });
  assert.equal(inn.status, 200, JSON.stringify(inn.data)); assert.equal(inn.data.status, 'in_progress'); assert.match(inn.data.checked_in_at, /Z$/);
  const re = await agent.post(`/api/appointments/${id}/check-in`, { location: reading(30.2680, -97.7431), client_key: ck });
  assert.equal(re.status, 200); assert.equal(re.data.replayed, true);
  assert.equal((await agent.post(`/api/appointments/${id}/check-in`, { location: reading(30.2680, -97.7431), client_key: key() })).status, 409, 'a second, different check-in is refused');
  const det = (await agent.get(`/api/appointments/${id}`)).data;
  assert.equal(det.checks.length, 1);
  assert.equal(det.checks[0].location_status, 'verified'); assert.equal(det.checks[0].proximity, 'near'); assert.ok(det.checks[0].distance_m > 50 && det.checks[0].distance_m < 120, String(det.checks[0].distance_m));
  assert.equal(det.checks[0].accuracy_m, 12); assert.match(det.checks[0].server_at, /Z$/);

  // check-out: permission denied is recorded as such, the outcome and one follow-up task are kept, retries add nothing
  const ok = key();
  const out = { location: { status: 'denied' }, outcome: 'second_visit', outcome_notes: 'Wants to bring partner', followup: { title: 'Book second viewing', due_date: '2026-11-04' }, client_key: ok };
  const done = await agent.post(`/api/appointments/${id}/check-out`, out);
  assert.equal(done.status, 200, JSON.stringify(done.data)); assert.equal(done.data.status, 'completed'); assert.equal(done.data.outcome, 'second_visit');
  assert.equal((await agent.post(`/api/appointments/${id}/check-out`, out)).data.replayed, true);
  assert.equal((await agent.post(`/api/appointments/${id}/check-out`, { ...out, client_key: key() })).status, 409);
  withTenant(t, () => {
    assert.equal(dbGet("SELECT COUNT(*) n FROM tasks WHERE title='Book second viewing'").n, 1, 'exactly one follow-up task');
    const task = dbGet("SELECT * FROM tasks WHERE title='Book second viewing'");
    assert.equal(task.assigned_to, agentId); assert.equal(task.entity_type, 'contact'); assert.equal(task.entity_id, contactId);
    assert.equal(dbGet('SELECT followup_date FROM contacts WHERE id=?', contactId).followup_date, '2026-11-04');
    const outCheck = dbGet("SELECT * FROM visit_checks WHERE kind='check_out'");
    assert.equal(outCheck.location_status, 'denied'); assert.equal(outCheck.lat, null); assert.equal(outCheck.proximity, 'unknown');
    assert.ok(dbAll("SELECT action FROM audit_log WHERE entity='appointment'").map((x) => x.action).includes('Completed visit'));
  });
  assert.equal((await agent.post(`/api/appointments/${id}/cancel`)).status, 409, 'a completed visit stays completed');

  // manual exception: off by default, labelled when the workspace allows it; stale readings are not "verified"
  const v2 = (await owner.post('/api/appointments', { title: 'Second look', property_id: propId, agent_id: agentId, starts_at: '2026-11-05T10:00', client_key: key() })).data;
  assert.equal((await agent.post(`/api/appointments/${v2.id}/check-in`, { location: { status: 'manual', reason: 'Phone GPS broken' }, client_key: key() })).status, 400);
  assert.equal((await agent.put('/api/appointments/visit-settings', { manual_exception: true })).status, 403, 'agents cannot change the settings');
  assert.equal((await owner.put('/api/appointments/visit-settings', { manual_exception: true, proximity_m: 100 })).data.manual_exception, true);
  assert.equal((await agent.post(`/api/appointments/${v2.id}/check-in`, { location: { status: 'manual', reason: 'Phone GPS broken' }, client_key: key() })).status, 200);
  const v3 = (await owner.post('/api/appointments', { title: 'Third look', property_id: propId, agent_id: agentId, starts_at: '2026-11-06T10:00', client_key: key() })).data;
  await agent.post(`/api/appointments/${v3.id}/check-in`, { location: reading(30.30, -97.74, { captured_at: new Date(Date.now() - 3600e3).toISOString() }), client_key: key() });
  const c3 = (await agent.get(`/api/appointments/${v3.id}`)).data.checks[0];
  assert.equal(c3.location_status, 'stale'); assert.equal(c3.distance_m, null, 'no distance from a stale reading');
  // no-show from in progress, and repeating it is harmless
  assert.equal((await agent.post(`/api/appointments/${v3.id}/no-show`, { note: 'Buyer did not come' })).data.status, 'no_show');
  assert.equal((await agent.post(`/api/appointments/${v3.id}/no-show`)).data.replayed, true);
  assert.equal((await agent.put(`/api/appointments/${v3.id}`, { title: 'Changed' })).status, 409, 'closed visits are not edited');
  assert.ok((await agent.get('/api/appointments?status=no_show')).data.items.every((x) => x.status === 'no_show'));

  // reminders: once per visit and start time, however often the job runs; retention clears coordinates only
  const soon = (await owner.post('/api/appointments', { title: 'Soon visit', property_id: propId, agent_id: agentId, starts_at: V.msToWall(Date.now() + 30 * 60e3, 'America/New_York').slice(0, 16), client_key: key() })).data;
  withTenant(t, () => {
    runVisitReminders(); runVisitReminders();
    assert.equal(dbGet("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND title LIKE 'Coming up: Soon visit'", agentId).n, 1);
    runVisitReminders(Date.parse(soon.starts_utc) + 45 * 60e3); runVisitReminders(Date.parse(soon.starts_utc) + 50 * 60e3);
    assert.equal(dbGet("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND title LIKE 'Not checked in: Soon visit'", agentId).n, 1);
    dbRun("UPDATE settings SET value='30' WHERE key='visit_retention_days'"); dbRun("INSERT OR IGNORE INTO settings(key,value) VALUES('visit_retention_days','30')");
    runVisitReminders(Date.now() + 31 * 86400e3);
    assert.equal(dbGet('SELECT COUNT(*) n FROM visit_checks WHERE lat IS NOT NULL').n, 0);
    assert.ok(dbGet('SELECT COUNT(*) n FROM visit_checks').n >= 3, 'the check records themselves stay');
  });
  assert.ok(otherId);
});

test('visits: workspaces are separate (another workspace\'s sign-in is refused, its visits are not listed)', async () => {
  const hostUk = await workspace('visit-uk', 'UK');
  const uk = await as(hostUk, 'owner@visit-uk.test', 'Tenant@12345');
  const made = await uk.post('/api/appointments', { title: 'London viewing', starts_at: '2026-10-25T01:30', client_key: key() });
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.equal(made.data.tz, 'Europe/London'); assert.equal(made.data.starts_utc, '2026-10-25T00:30:00Z');
  const us = await as('visit-us.erp.test', 'owner@visit-us.test', 'Tenant@12345');
  assert.ok(!(await us.get('/api/appointments')).data.items.some((x) => x.title === 'London viewing'));
  // the UK cookie on the US workspace is not a session there
  const l = await call(hostUk, 'POST', '/api/auth/login', { identifier: 'owner@visit-uk.test', password: 'Tenant@12345' });
  assert.equal((await call('visit-us.erp.test', 'GET', '/api/appointments', null, { cookie: l.cookie })).status, 401);
  // the same request key in two workspaces makes two visits, one each
  const k = key();
  assert.equal((await uk.post('/api/appointments', { title: 'Shared key', starts_at: '2026-11-10T10:00', client_key: k })).status, 201);
  assert.equal((await us.post('/api/appointments', { title: 'Shared key', starts_at: '2026-11-10T10:00', client_key: k })).status, 201);
});

test('visits: UAE, Canada and Pakistan workspaces keep their own zone and distance unit', async () => {
  for (const [slug, region, extra, wall, utc] of [['visit-ae', 'AE', {}, '2026-11-02T10:00', '2026-11-02T06:00:00Z'], ['visit-ca', 'CA', {}, '2026-11-01T01:30', '2026-11-01T05:30:00Z'], ['visit-pk', 'PK', {}, '2026-11-02T10:00', '2026-11-02T05:00:00Z']]) {
    const host = await workspace(slug, region, extra);
    const o = await as(host, `owner@${slug}.test`, 'Tenant@12345');
    const a = await o.post('/api/appointments', { title: `${region} visit`, starts_at: wall, client_key: key() });
    assert.equal(a.status, 201, JSON.stringify(a.data)); assert.equal(a.data.starts_utc, utc, `${region} ${wall}`);
    const reg = (await o.get('/api/auth/region')).data;
    assert.equal((reg.config || reg).distance_unit, region === 'US' || region === 'UK' ? 'mi' : 'km');
  }
});
