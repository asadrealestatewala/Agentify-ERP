// Twilio connection, the "Call next" queue, click-to-call, signed web hooks and do-not-call, with Twilio itself mocked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-dialer-'));
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
const { platformDb } = await import('../src/platform.js');
const { setRegionStatus } = await import('../src/regions/admin.js');
const { twilioSignature } = await import('../src/integrations/twilio.js');
let server, port;
const realFetch = globalThis.fetch;
const twilioCalls = [];
const SID = `AC${'a'.repeat(32)}`;
before(() => new Promise((res) => {
  // Twilio is mocked; every other request (to this test server) goes through
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.includes('api.twilio.com')) return realFetch(url, opts);
    twilioCalls.push({ url: u, method: opts.method, body: opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : null, auth: opts.headers?.Authorization });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('IncomingPhoneNumbers')) return json({ incoming_phone_numbers: u.includes('%2B14155550100') ? [{ sid: 'PN1', capabilities: { voice: true, sms: true } }] : [] });
    if (u.endsWith(`/Accounts/${SID}.json`)) return json({ status: 'active', friendly_name: 'Lone Star', type: 'Full' });
    if (u.endsWith('/Calls.json')) return json({ sid: 'CA1', status: 'queued' }, 201);
    if (u.endsWith('/Messages.json')) return json({ sid: 'SM1', status: 'queued' }, 201);
    return json({ message: 'not found' }, 404);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}, form = false) => new Promise((resolve, reject) => {
  const data = body ? (form ? new URLSearchParams(body).toString() : JSON.stringify(body)) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const HOST = 'dial.erp.test';

test('dialer: connect Twilio, rank who to call, start a call, handle signed hooks, honour do-not-call', async () => {
  setRegionStatus(platformDb(), 'US', 'active', 'tester');
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'dial', company_name: 'Dial Realty', admin_name: 'Owner', admin_email: 'owner@dial.test', admin_password: 'Tenant@12345', region: 'US', sub_region: 'Texas' });
  assert.equal(su.status, 201, JSON.stringify(su.data));
  const l = await call(HOST, 'POST', '/api/auth/login', { identifier: 'owner@dial.test', password: 'Tenant@12345' });
  const c = l.cookie;
  const get = (u) => call(HOST, 'GET', u, null, { cookie: c });
  const post = (u, b) => call(HOST, 'POST', u, b || {}, { cookie: c });
  const put = (u, b) => call(HOST, 'PUT', u, b || {}, { cookie: c });

  // the hub lists what this country can connect
  const hub = (await get('/api/integrations')).data;
  const ids = hub.items.map((i) => i.id);
  assert.ok(ids.includes('twilio') && ids.includes('google_calendar') && ids.includes('domain'));
  assert.ok(!ids.includes('voice_http'), 'the Pakistani voice provider is not offered in the US');
  assert.equal(hub.items.find((i) => i.id === 'twilio').status, 'not_connected');

  // calling is refused until Twilio is connected
  const early = await post('/api/contacts', { full_name: 'Old Lead', phone: '+1 415 555 0111', followup_date: '2020-01-01', priority: 'High' });
  assert.equal(early.status, 201);
  assert.equal((await post('/api/integrations/calls', { contact_id: early.data.id, agent_number: '+14155550199' })).status, 400);

  // bad details are rejected before any request; good ones are tested against Twilio
  assert.equal((await put('/api/integrations/twilio', { account_sid: 'nope', auth_token: 'x'.repeat(32), phone_number: '+14155550100' })).status, 400);
  assert.equal((await put('/api/integrations/twilio', { account_sid: SID, auth_token: 't'.repeat(32), phone_number: '+14155550999' })).status, 400, 'a number that is not on the account');
  const ok = await put('/api/integrations/twilio', { account_sid: SID, auth_token: 't'.repeat(32), phone_number: '+14155550100' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.match(twilioCalls.find((x) => x.url.endsWith(`${SID}.json`)).auth, /^Basic /);
  const after = (await get('/api/integrations')).data.items.find((i) => i.id === 'twilio');
  assert.equal(after.status, 'connected');
  assert.equal(JSON.stringify(after).includes('t'.repeat(32)), false, 'the Auth Token is never sent back');

  // "Call next": the long-overdue high-priority lead comes first, with the reason
  await post('/api/contacts', { full_name: 'Fresh Lead', phone: '+1 415 555 0122' });
  const q = (await get('/api/integrations/dialer/queue')).data;
  assert.equal(q.voice, 'twilio');
  assert.equal(q.queue[0].name, 'Old Lead');
  assert.match(q.queue[0].reason, /Follow-up was due/);
  assert.ok(q.queue.some((x) => x.name === 'Fresh Lead' && /New lead/.test(x.reason)));

  // start a call: Twilio rings the agent first and is given our signed web hook
  assert.equal((await post('/api/integrations/calls', { contact_id: early.data.id })).status, 400, 'needs the agent phone');
  const started = await post('/api/integrations/calls', { contact_id: early.data.id, agent_number: '+1 (415) 555-0199' });
  assert.equal(started.status, 201, JSON.stringify(started.data));
  const callId = started.data.id;
  const tw = twilioCalls.find((x) => x.url.endsWith('/Calls.json'));
  assert.equal(tw.body.To, '+14155550199'); assert.equal(tw.body.From, '+14155550100');
  assert.equal(tw.body.Url, `http://${HOST}/api/hooks/twilio/bridge?call=${callId}`);

  // the hooks only answer to Twilio's signature
  const bridgePath = `/api/hooks/twilio/bridge?call=${callId}`;
  assert.equal((await call(HOST, 'POST', bridgePath, { CallSid: 'CA1' }, {}, true)).status, 403, 'unsigned request');
  const params = { CallSid: 'CA1', CallStatus: 'in-progress' };
  const sig = twilioSignature('t'.repeat(32), `http://${HOST}${bridgePath}`, params);
  const tw1 = await call(HOST, 'POST', bridgePath, params, { 'X-Twilio-Signature': sig }, true);
  assert.equal(tw1.status, 200); assert.match(tw1.data, /<Number>\+14155550111<\/Number>/); assert.match(tw1.data, /callerId="\+14155550100"/);
  const stPath = `/api/hooks/twilio/status?call=${callId}`;
  const stParams = { CallStatus: 'completed', CallDuration: '42' };
  assert.equal((await call(HOST, 'POST', stPath, stParams, { 'X-Twilio-Signature': twilioSignature('t'.repeat(32), `http://${HOST}${stPath}`, stParams) }, true)).status, 204);
  const log = (await get(`/api/integrations/calls?contact_id=${early.data.id}`)).data;
  assert.equal(log[0].status, 'completed'); assert.equal(log[0].duration, 42);

  // an outcome schedules the next follow-up; do-not-call removes the person from the queue and blocks dialling and texting
  const cb = await post(`/api/integrations/calls/${callId}/outcome`, { outcome: 'callback', notes: 'Call after 5pm' });
  assert.equal(cb.status, 200); assert.ok(cb.data.followup_date);
  assert.equal((await post(`/api/integrations/calls/${callId}/outcome`, { outcome: 'made_up' })).status, 400);
  assert.equal((await post(`/api/integrations/calls/${callId}/outcome`, { outcome: 'do_not_call' })).status, 200);
  assert.equal((await get('/api/integrations/dialer/queue')).data.queue.some((x) => x.name === 'Old Lead'), false);
  assert.equal((await post('/api/integrations/calls', { contact_id: early.data.id, agent_number: '+14155550199' })).status, 400);
  assert.equal((await post('/api/integrations/sms', { contact_id: early.data.id, body: 'Hello' })).status, 400);

  // text a different contact
  const fresh = (await get('/api/contacts')).data;
  const freshId = (Array.isArray(fresh) ? fresh : fresh.items || fresh.rows).find((x) => x.full_name === 'Fresh Lead').id;
  assert.equal((await post('/api/integrations/sms', { contact_id: freshId, body: 'Hi, are you still looking?' })).status, 201);
  assert.equal(twilioCalls.find((x) => x.url.endsWith('/Messages.json')).body.To, '+14155550122');

  // disconnecting removes the details
  assert.equal((await call(HOST, 'DELETE', '/api/integrations/twilio', null, { cookie: c })).status, 200);
  assert.equal((await get('/api/integrations/dialer/queue')).data.voice, null);
});

test('custom domain: DNS records are shown, verification needs both records, then the domain serves the workspace', async () => {
  const { resolver } = await import('../src/integrations/domains.js');
  const l = await call(HOST, 'POST', '/api/auth/login', { identifier: 'owner@dial.test', password: 'Tenant@12345' });
  const c = l.cookie;
  const get = (u) => call(HOST, 'GET', u, null, { cookie: c });
  const put = (u, b) => call(HOST, 'PUT', u, b || {}, { cookie: c });
  const post = (u, b) => call(HOST, 'POST', u, b || {}, { cookie: c });

  assert.equal((await put('/api/integrations/domain', { domain: 'dial.erp.test' })).status, 400, 'our own domain is refused');
  assert.equal((await put('/api/integrations/domain', { domain: 'not a domain' })).status, 400);
  const added = await put('/api/integrations/domain', { domain: 'https://www.dialrealty.com/' });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  const rec = added.data.current;
  assert.equal(rec.domain, 'www.dialrealty.com'); assert.equal(rec.status, 'pending');
  const txt = rec.records.find((x) => x.type === 'TXT'), cname = rec.records.find((x) => x.type === 'CNAME');
  assert.equal(txt.name, '_agentify-challenge.www.dialrealty.com'); assert.equal(cname.value, 'dial.erp.test');

  // nothing in DNS yet
  resolver.txt = async () => { throw new Error('ENOTFOUND'); }; resolver.cname = async () => { throw new Error('ENOTFOUND'); }; resolver.a = async () => { throw new Error('ENOTFOUND'); };
  const no1 = await post('/api/integrations/domain/verify');
  assert.equal(no1.status, 400); assert.match(no1.data.error, /TXT record/);
  // TXT right, but the domain does not point to us
  resolver.txt = async () => [[txt.value]];
  const no2 = await post('/api/integrations/domain/verify');
  assert.equal(no2.status, 400); assert.match(no2.data.error, /does not point/);
  assert.equal((await call('www.dialrealty.com', 'GET', '/api/auth/brand')).status, 404, 'not served before it is verified');
  // both records present
  resolver.cname = async () => ['dial.erp.test.'];
  const yes = await post('/api/integrations/domain/verify');
  assert.equal(yes.status, 200, JSON.stringify(yes.data)); assert.equal(yes.data.current.status, 'verified');
  // the connected domain serves the website only; signing in stays on the workspace address
  const site = await call('www.dialrealty.com', 'GET', '/api/site/bootstrap');
  assert.equal(site.status, 200, JSON.stringify(site.data)); assert.equal(site.data.workspace_url, 'https://dial.erp.test');
  const erp = await call('www.dialrealty.com', 'GET', '/api/auth/brand');
  assert.equal(erp.status, 404); assert.match(erp.data.error, /dial\.erp\.test/);
  assert.equal((await call('dial.erp.test', 'GET', '/api/auth/brand')).data.name, 'Dial Realty', 'the workspace address still has the sign-in');
  // another workspace cannot take it, and the web server may now issue a certificate for it
  assert.equal((await call('erp.test', 'GET', '/api/platform/domain-check?domain=www.dialrealty.com')).status, 200);
  assert.equal((await call('erp.test', 'GET', '/api/platform/domain-check?domain=evil.example.com')).status, 404);
  assert.equal((await call('erp.test', 'GET', '/api/platform/domain-check?domain=dial.erp.test')).status, 200);
  assert.equal((await call('erp.test', 'GET', '/api/platform/domain-check?domain=nobody-here.erp.test')).status, 404, 'no certificate for a workspace that does not exist');
  // removing it stops serving it
  assert.equal((await call(HOST, 'DELETE', '/api/integrations/domain', null, { cookie: c })).status, 200);
  assert.equal((await call('www.dialrealty.com', 'GET', '/api/site/bootstrap')).status, 404);
});
