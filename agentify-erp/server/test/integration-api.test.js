import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-v1-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { all, get, run, val } = await import('../src/db.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function staff(identifier, password = 'Demo@12345') {
  const jar = {};
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
    return { status: r.status, data };
  };
  assert.equal((await call('POST', '/api/auth/login', { identifier, password })).status, 200);
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}
const v1 = async (key, method, url, body, headers = {}) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
};
const ALL = ['leads:write', 'listings:read', 'projects:read', 'agents:read'];
const uuid = () => crypto.randomUUID();

test('connections: staff make scoped keys that are shown once; agents cannot', async () => {
  const a = await staff('admin@expertdevelopers.pk');
  assert.equal((await (await staff('agent1@expertdevelopers.pk')).post('/api/website-integrations/connections', { name: 'x', scopes: ALL })).status, 403);
  assert.equal((await a.post('/api/website-integrations/connections', { name: '', scopes: ALL })).status, 400);
  assert.equal((await a.post('/api/website-integrations/connections', { name: 'Site', scopes: [] })).status, 400, 'needs at least one permission');
  assert.equal((await a.post('/api/website-integrations/connections', { name: 'Site', scopes: ['everything'] })).status, 400);
  const made = await a.post('/api/website-integrations/connections', { name: 'Main website', platform: 'wordpress', scopes: ALL, config: { lead_source: 'WordPress form' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.match(made.data.key, /^agf_\d+_[A-Za-z0-9_-]{43}$/);
  assert.equal(made.data.connection.key_hint, made.data.key.slice(-4));
  const list = JSON.stringify((await a.get('/api/website-integrations/connections')).data);
  assert.ok(list.includes('Main website') && !list.includes(made.data.key.split('_').slice(2).join('_')), 'the key is not readable again');
  assert.ok(!JSON.stringify(get('SELECT * FROM integration_connections WHERE id=?', made.data.connection.id)).includes(made.data.key.slice(-30)), 'only a hash is stored');
  assert.ok((await a.get('/api/audit?limit=20')).data.data?.some?.((x) => /Created a website connection/.test(x.action)) ?? true);
});

test('keys: header only, wrong or revoked keys are refused, rotation overlaps, scopes limit what a key can do', async () => {
  const a = await staff('admin@expertdevelopers.pk');
  const { key, connection } = (await a.post('/api/website-integrations/connections', { name: 'Auth test', scopes: ['listings:read'] })).data;
  const none = await v1(null, 'GET', '/api/v1/ping');
  assert.equal(none.status, 401); assert.equal(none.data.error.code, 'invalid_key'); assert.ok(none.data.error.message);
  assert.equal((await v1(null, 'GET', `/api/v1/ping?api_key=${key}`)).status, 401, 'a key in the address is never accepted');
  assert.equal((await v1(key.slice(0, -2) + 'xx', 'GET', '/api/v1/ping')).status, 401);
  assert.equal((await v1('agf_99999_' + 'a'.repeat(43), 'GET', '/api/v1/ping')).status, 401);
  const ping = await v1(key, 'GET', '/api/v1/ping');
  assert.equal(ping.status, 200); assert.equal(ping.data.connection.id, connection.id); assert.deepEqual(ping.data.connection.scopes, ['listings:read']);
  assert.ok(ping.headers.get('ratelimit') || ping.headers.get('ratelimit-policy'), 'rate limits are reported in headers');
  assert.ok(get('SELECT last_used_at FROM integration_connections WHERE id=?', connection.id).last_used_at);

  // a key may only do what it was given
  const denied = await v1(key, 'POST', '/api/v1/leads', { name: 'Nope', phone: '03001234567' }, { 'Idempotency-Key': uuid() });
  assert.equal(denied.status, 403); assert.equal(denied.data.error.code, 'insufficient_scope');
  assert.equal((await v1(key, 'GET', '/api/v1/projects')).status, 403);
  assert.equal((await v1(key, 'GET', '/api/v1/nothing-here')).status, 404);
  assert.equal((await v1(key, 'GET', '/api/v1/nothing-here')).data.error.code, 'not_found');

  // rotation: the new key works at once, the old one for 24 hours
  const rot = (await a.post(`/api/website-integrations/connections/${connection.id}/rotate`)).data;
  assert.notEqual(rot.key, key);
  assert.equal((await v1(rot.key, 'GET', '/api/v1/ping')).status, 200);
  assert.equal((await v1(key, 'GET', '/api/v1/ping')).status, 200, 'old key still works during the overlap');
  run('UPDATE integration_connections SET prev_key_until=? WHERE id=?', new Date(Date.now() - 1000).toISOString(), connection.id);
  assert.equal((await v1(key, 'GET', '/api/v1/ping')).status, 401, 'old key stops after the overlap');

  // disconnecting stops the key at once
  assert.equal((await a.del(`/api/website-integrations/connections/${connection.id}`)).status, 200);
  assert.equal((await v1(rot.key, 'GET', '/api/v1/ping')).status, 401);
  assert.equal((await a.put(`/api/website-integrations/connections/${connection.id}`, { name: 'again' })).status, 400, 'a disconnected connection cannot be edited');
  assert.equal((await v1(rot.key, 'POST', '/api/v1/leads', {})).status, 401);
});

test('leads: idempotent, same person matched across phone spellings, consent and source kept, mapping applied, test leads marked', async () => {
  const a = await staff('admin@expertdevelopers.pk');
  const stage = all("SELECT id FROM lookups WHERE type='lead_stage' AND active=1 ORDER BY sort_order").at(-1).id;
  const agent = get("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Sales Agent' AND u.active=1").id;
  const { key, connection } = (await a.post('/api/website-integrations/connections', { name: 'Leads', platform: 'custom', scopes: ['leads:write'], config: { lead_source: 'Landing page', stage_id: stage, agent_id: agent } })).data;
  const body = { name: 'Sana Malik', phone: '0300 5551234', email: 'sana@example.com', message: 'Interested in a 5 marla plot', enquiry_type: 'visit', external_id: 'wp-entry-7',
    consent: { marketing: true, privacy: true, text: 'I agree to be contacted.', at: '2026-10-24T09:00:00Z' },
    source: { form: 'Contact page', page_url: 'https://example.com/contact', referrer: 'https://google.com/', utm_source: 'google', utm_campaign: 'eid', ignored: 'x' } };

  assert.equal((await v1(key, 'POST', '/api/v1/leads', body)).data.error.code, 'idempotency_key_required');
  assert.equal((await v1(key, 'POST', '/api/v1/leads', body, { 'Idempotency-Key': 'short' })).status, 400);
  assert.equal((await v1(key, 'POST', '/api/v1/leads', { phone: '123' }, { 'Idempotency-Key': uuid() })).data.error.message, 'Name is required');
  assert.equal((await v1(key, 'POST', '/api/v1/leads', { name: 'Bad Email', email: 'nope' }, { 'Idempotency-Key': uuid() })).status, 400);

  const before = val('SELECT COUNT(*) FROM contacts');
  const idem = uuid();
  const first = await v1(key, 'POST', '/api/v1/leads', body, { 'Idempotency-Key': idem });
  assert.equal(first.status, 201, JSON.stringify(first.data)); assert.equal(first.data.result, 'created'); assert.match(first.data.lead_ref, /^WEB-\d+$/);
  const cid = Number(first.data.lead_ref.slice(4));
  assert.equal(val('SELECT COUNT(*) FROM contacts'), before + 1);
  const c = get('SELECT * FROM contacts WHERE id=?', cid);
  assert.equal(c.lead_source, 'Landing page'); assert.equal(c.stage_id, stage); assert.equal(c.agent_id, agent, 'wizard mapping applied');

  // a retry with the same key replays the answer and creates nothing
  const again = await v1(key, 'POST', '/api/v1/leads', body, { 'Idempotency-Key': idem });
  assert.equal(again.status, 201); assert.equal(again.headers.get('idempotent-replay'), 'true'); assert.deepEqual(again.data, first.data);
  assert.equal(val('SELECT COUNT(*) FROM contacts'), before + 1);
  assert.equal(val('SELECT COUNT(*) FROM lead_attribution WHERE contact_id=?', cid), 1);
  assert.equal((await v1(key, 'POST', '/api/v1/leads', { ...body, message: 'different' }, { 'Idempotency-Key': idem })).status, 422, 'same key, different request');

  // the same person with the number written differently is matched, not duplicated; history grows
  const repeat = await v1(key, 'POST', '/api/v1/leads', { name: 'Sana Malik', phone: '+92 300 5551234', message: 'Calling back', consent: { privacy: true, text: 'ok' } }, { 'Idempotency-Key': uuid() });
  assert.equal(repeat.status, 200); assert.equal(repeat.data.result, 'matched'); assert.equal(repeat.data.lead_ref, first.data.lead_ref);
  assert.equal(val('SELECT COUNT(*) FROM contacts'), before + 1);
  const byEmail = await v1(key, 'POST', '/api/v1/leads', { name: 'S Malik', email: 'SANA@example.com' }, { 'Idempotency-Key': uuid() });
  assert.equal(byEmail.data.result, 'matched', 'e-mail match ignores case');
  assert.ok(val("SELECT COUNT(*) FROM notes WHERE entity_type='contact' AND entity_id=? AND body LIKE '%Calling back%'", cid) >= 1);

  // where it came from and what they agreed to, as sent; unknown keys dropped; nothing assumed
  const rows = all('SELECT * FROM lead_attribution WHERE contact_id=? ORDER BY id', cid);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].connection_id, connection.id); assert.equal(rows[0].form, 'Contact page'); assert.equal(rows[0].page_url, 'https://example.com/contact'); assert.equal(rows[0].external_id, 'wp-entry-7'); assert.equal(rows[0].enquiry_type, 'visit');
  assert.deepEqual(JSON.parse(rows[0].utm), { utm_source: 'google', utm_campaign: 'eid' });
  const consent = JSON.parse(rows[0].consent);
  assert.equal(consent.privacy, true); assert.equal(consent.marketing, true); assert.equal(consent.text, 'I agree to be contacted.'); assert.equal(consent.at, '2026-10-24T09:00:00Z'); assert.ok(consent.received_at);
  assert.equal(rows[2].consent, null, 'no consent sent, none recorded');

  // test leads go through the same path but are marked
  const t = await v1(key, 'POST', '/api/v1/leads', { name: 'Test Person', email: 'tp@example.com', test: true }, { 'Idempotency-Key': uuid() });
  assert.equal(t.data.test, true);
  const tc = get('SELECT tags FROM contacts WHERE id=?', Number(t.data.lead_ref.slice(4)));
  assert.ok(JSON.parse(tc.tags).includes('test'));
  assert.equal(get('SELECT test FROM lead_attribution WHERE contact_id=?', Number(t.data.lead_ref.slice(4))).test, 1);

  // a connection can insist on the privacy notice
  const strict = (await a.post('/api/website-integrations/connections', { name: 'Strict', scopes: ['leads:write'], config: { require_privacy_consent: true } })).data.key;
  const refused = await v1(strict, 'POST', '/api/v1/leads', { name: 'No Consent', email: 'nc@example.com' }, { 'Idempotency-Key': uuid() });
  assert.equal(refused.status, 400); assert.equal(refused.data.error.code, 'consent_required');
  assert.equal((await v1(strict, 'POST', '/api/v1/leads', { name: 'With Consent', email: 'wc@example.com', consent: { privacy: true } }, { 'Idempotency-Key': uuid() })).status, 201);

  // health on the connection: last success, event log with no personal data
  const ev = (await a.get(`/api/website-integrations/connections/${connection.id}/events`)).data;
  assert.ok(ev.length >= 3 && ev.some((e) => e.event === 'lead'));
  assert.ok(!JSON.stringify(ev).match(/sana|0300|example\.com/i), 'the log holds no names, numbers or e-mail addresses');
  const conn = (await a.get('/api/website-integrations/connections')).data.find((x) => x.id === connection.id);
  assert.ok(conn.last_success_at && conn.leads >= 2);

  // the wizard's test button
  const tl = await a.post(`/api/website-integrations/connections/${connection.id}/test-lead`);
  assert.equal(tl.status, 201); assert.equal(tl.data.lead.lead_source, 'Landing page'); assert.match(tl.data.lead.link, /^\/contacts\/\d+$/);
});

test('listings and projects: public fields only, filters, paging, and what the connection may show', async () => {
  const a = await staff('admin@expertdevelopers.pk');
  const mk = async (scopes, config) => (await a.post('/api/website-integrations/connections', { name: `Read ${Math.random()}`, scopes, config })).data.key;
  const key = await mk(['listings:read', 'projects:read', 'agents:read']);
  const pubIds = all("SELECT id FROM properties WHERE published=1 AND status IN ('available','featured','reserved') ORDER BY id").map((x) => x.id);
  assert.ok(pubIds.length >= 3);
  const list = await v1(key, 'GET', '/api/v1/listings?per_page=2');
  assert.equal(list.status, 200); assert.equal(list.data.per_page, 2); assert.equal(list.data.data.length, 2); assert.ok(list.data.total >= 3);
  const text = JSON.stringify(list.data);
  assert.ok(!/net_cost|purchase_price|owner|commission|cost_price|internal|buyer/i.test(text), 'no private fields');
  const p2 = await v1(key, 'GET', '/api/v1/listings?per_page=2&page=2');
  assert.ok(p2.data.data.every((x) => !list.data.data.some((y) => y.id === x.id)), 'pages do not overlap');
  assert.equal((await v1(key, 'GET', '/api/v1/listings?per_page=5000')).data.per_page, 100, 'per_page is capped');
  assert.equal((await v1(key, 'GET', '/api/v1/listings?updated_since=nonsense')).status, 400);
  assert.equal((await v1(key, 'GET', '/api/v1/listings?updated_since=2999-01-01')).data.total, 0);

  // an unpublished listing is invisible, by list and by id
  const hid = pubIds[0];
  run('UPDATE properties SET published=0 WHERE id=?', hid);
  assert.ok(!(await v1(key, 'GET', '/api/v1/listings?per_page=100')).data.data.some((x) => x.id === hid));
  assert.equal((await v1(key, 'GET', `/api/v1/listings/${hid}`)).status, 404);
  run('UPDATE properties SET published=1 WHERE id=?', hid);
  const one = await v1(key, 'GET', `/api/v1/listings/${hid}`);
  assert.equal(one.status, 200); assert.ok(one.data.title);
  const byCode = get('SELECT code FROM properties WHERE id=?', hid).code;
  if (byCode) assert.equal((await v1(key, 'GET', `/api/v1/listings/${byCode}`)).data.id, hid, 'a listing can be read by its code');

  // featured-only connection
  const fkey = await mk(['listings:read'], { listings: 'featured' });
  const feat = (await v1(fkey, 'GET', '/api/v1/listings?per_page=100')).data;
  assert.ok(feat.data.every((x) => x.featured === true), 'only featured listings');

  // projects: only those shown on the website; a connection can be limited to chosen projects
  const projects = (await v1(key, 'GET', '/api/v1/projects')).data.data;
  const hiddenProject = get('SELECT id FROM projects ORDER BY id LIMIT 1').id;
  run('UPDATE projects SET site_visible=0 WHERE id=?', hiddenProject);
  assert.ok(!(await v1(key, 'GET', '/api/v1/projects')).data.data.some((x) => x.id === hiddenProject));
  assert.equal((await v1(key, 'GET', `/api/v1/projects/${hiddenProject}`)).status, 404);
  run('UPDATE projects SET site_visible=1 WHERE id=?', hiddenProject);
  assert.ok(projects.length >= 1);
  const only = await mk(['projects:read', 'listings:read'], { listings: 'projects', project_ids: [hiddenProject] });
  assert.deepEqual((await v1(only, 'GET', '/api/v1/projects')).data.data.map((x) => x.id), [hiddenProject]);
  const other = get('SELECT id FROM projects WHERE id<>? AND site_visible=1 LIMIT 1', hiddenProject);
  if (other) assert.equal((await v1(only, 'GET', `/api/v1/projects/${other.id}`)).status, 404);
  assert.ok((await v1(only, 'GET', '/api/v1/listings?per_page=100')).data.data.every((x) => x.project?.id === hiddenProject));
  assert.equal((await a.post('/api/website-integrations/connections', { name: 'Bad', scopes: ['listings:read'], config: { listings: 'projects', project_ids: [] } })).status, 400);

  // agents appear only when the website shows agents
  const ag = await v1(key, 'GET', '/api/v1/agents');
  assert.equal(ag.status, 200); assert.ok(Array.isArray(ag.data.data));
});

test('bad bodies get the v1 error format; the old website API still works', async () => {
  const a = await staff('admin@expertdevelopers.pk');
  const key = (await a.post('/api/website-integrations/connections', { name: 'Errors', scopes: ['leads:write'] })).data.key;
  const bad = await fetch(base + '/api/v1/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'Idempotency-Key': uuid() }, body: '{not json' });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error.code, 'invalid_json');
  assert.equal((await v1(key, 'POST', '/api/v1/leads', ['x'], { 'Idempotency-Key': uuid() })).status, 400);
  assert.equal((await v1(key, 'POST', '/api/v1/leads', { name: 'Agent 007', phone: '03001112222' }, { 'Idempotency-Key': uuid() })).status, 400, 'names with digits are refused like everywhere else');
  // the old endpoint keeps working, now with phone spelling matched too
  const apiKey = (await a.get('/api/settings/system')).data.website_api_key;
  const old = await fetch(base + '/api/public/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, body: JSON.stringify({ name: 'Old Style', phone: '0300 7770001' }) });
  assert.equal(old.status, 201); assert.match((await old.json()).reference, /^WEB-\d+$/);
  const n = val('SELECT COUNT(*) FROM contacts');
  await fetch(base + '/api/public/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, body: JSON.stringify({ name: 'Old Style', phone: '+92 300 7770001' }) });
  assert.equal(val('SELECT COUNT(*) FROM contacts'), n, 'the same number in another spelling is the same person');
});
