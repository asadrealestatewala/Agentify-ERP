import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-v1h-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { all, get, run, val } = await import('../src/db.js');
const { runDueDeliveries } = await import('../src/services/webhooksOut.js');

const RECEIVER = 'https://93.184.216.34/erp-hook'; // a literal public address: no DNS lookup is needed
let server, base, receiver = { status: 200, calls: [] };
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith('https://93.184.216.34/')) return realFetch(url, opts);
    receiver.calls.push({ url: String(url), headers: opts.headers, body: opts.body, redirect: opts.redirect });
    return new Response('', { status: receiver.status });
  };
  server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); });
}));
after(() => { globalThis.fetch = realFetch; server.close(); });

async function staff(identifier, password = 'Demo@12345') {
  const jar = {};
  const call = async (method, url, body) => {
    const r = await realFetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
    return { status: r.status, data };
  };
  assert.equal((await call('POST', '/api/auth/login', { identifier, password })).status, 200);
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}
const v1 = async (key, method, url, body, headers = {}) => {
  const r = await realFetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (n) => { for (let i = 0; i < 40 && receiver.calls.length < n; i++) await sleep(25); };
const uuid = () => crypto.randomUUID();

test('webhooks: subscribe over the API, signed deliveries for listings, projects and leads, no personal data in lead events', async () => {
  const a = await staff('admin@expertdevelopers.pk');
  const key = (await a.post('/api/website-integrations/connections', { name: 'Hooks', scopes: ['webhooks:manage', 'leads:write'] })).data.key;
  const noScope = (await a.post('/api/website-integrations/connections', { name: 'No hooks', scopes: ['listings:read'] })).data.key;
  assert.equal((await v1(noScope, 'GET', '/api/v1/webhooks')).status, 403);

  // only real public https addresses
  assert.equal((await v1(key, 'POST', '/api/v1/webhooks', { url: 'http://93.184.216.34/h' })).status, 400, 'https only');
  assert.equal((await v1(key, 'POST', '/api/v1/webhooks', { url: 'https://10.0.0.5/h' })).status, 400, 'no private addresses');
  assert.equal((await v1(key, 'POST', '/api/v1/webhooks', { url: 'https://127.0.0.1/h' })).status, 400);
  assert.equal((await v1(key, 'POST', '/api/v1/webhooks', { url: RECEIVER, events: ['nonsense'] })).status, 400);
  const sub = await v1(key, 'POST', '/api/v1/webhooks', { url: RECEIVER, events: ['listing.published', 'listing.updated', 'listing.unpublished', 'project.updated', 'lead.created'] });
  assert.equal(sub.status, 201, JSON.stringify(sub.data)); assert.match(sub.data.secret, /^whsec_[0-9a-f]{48}$/);
  const listed = await v1(key, 'GET', '/api/v1/webhooks');
  assert.equal(listed.data.data.length, 1); assert.ok(!JSON.stringify(listed.data).includes(sub.data.secret), 'the secret is shown once');
  assert.ok(!JSON.stringify(get('SELECT * FROM webhook_subscriptions WHERE id=?', sub.data.id)).includes(sub.data.secret), 'stored encrypted');

  // a listing is taken off the website, put back, and featured
  const p = get("SELECT id FROM properties WHERE published=1 AND status='available' ORDER BY id LIMIT 1").id;
  receiver.calls = [];
  assert.equal((await a.post(`/api/properties/${p}/unpublish`)).status, 200);
  await settle(1);
  const un = receiver.calls.at(-1);
  const body = JSON.parse(un.body);
  assert.equal(body.type, 'listing.unpublished'); assert.deepEqual(body.data, { listing: { id: p } }, 'nothing but the id of a listing that is no longer public');
  // signature a receiver can verify, stable event id, no redirects followed
  const [, t, v] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(un.headers['Agentify-Signature']);
  assert.equal(v, crypto.createHmac('sha256', sub.data.secret).update(`${t}.${un.body}`).digest('hex'));
  assert.ok(Math.abs(Date.now() / 1000 - Number(t)) < 60);
  assert.equal(un.headers['Agentify-Event-Id'], body.id); assert.equal(un.headers['X-Agentify-Event'], 'listing.unpublished'); assert.equal(un.headers['Agentify-Delivery-Attempt'], '1');
  assert.equal(un.redirect, 'manual'); assert.ok(!JSON.stringify(un.headers).includes('agf_'), 'no key is ever sent');
  receiver.calls = [];
  assert.equal((await a.post(`/api/properties/${p}/publish`)).status, 200);
  await settle(1);
  const pub = JSON.parse(receiver.calls.at(-1).body);
  assert.equal(pub.type, 'listing.published'); assert.equal(pub.data.listing.id, p); assert.ok(pub.data.listing.title);
  assert.ok(!/net_cost|purchase|owner|commission|buyer/i.test(JSON.stringify(pub)), 'public fields only');
  receiver.calls = [];
  assert.equal((await a.post(`/api/properties/${p}/feature`)).status, 200);
  await settle(1);
  assert.equal(JSON.parse(receiver.calls.at(-1).body).type, 'listing.updated');

  // a project shown on the website changes
  const proj = get('SELECT id FROM projects WHERE site_visible=1 LIMIT 1').id;
  receiver.calls = [];
  const cur = (await a.get(`/api/projects/${proj}`)).data;
  assert.equal((await a.put(`/api/projects/${proj}`, { ...cur, description: 'Updated description for webhook test' })).status, 200);
  await settle(1);
  const pj = JSON.parse(receiver.calls.at(-1).body);
  assert.equal(pj.type, 'project.updated'); assert.equal(pj.data.project.id, proj);

  // a new lead: the reference, never the person's details
  receiver.calls = [];
  const lead = await v1(key, 'POST', '/api/v1/leads', { name: 'Hamza Raza', email: 'hamza@example.com', phone: '03001239876', message: 'secret details' }, { 'Idempotency-Key': uuid() });
  assert.equal(lead.status, 201);
  await settle(1);
  const lb = receiver.calls.at(-1).body;
  assert.equal(JSON.parse(lb).type, 'lead.created'); assert.equal(JSON.parse(lb).data.lead_ref, lead.data.lead_ref);
  assert.ok(!/hamza|example\.com|0300|secret/i.test(lb), 'no personal details in the event');
  receiver.calls = [];
  await v1(key, 'POST', '/api/v1/leads', { name: 'Hamza Raza', email: 'hamza@example.com' }, { 'Idempotency-Key': uuid() });
  await sleep(150);
  assert.equal(receiver.calls.length, 0, 'a repeat enquiry from a known person is not a new lead');

  // unsubscribing stops events
  assert.equal((await v1(key, 'DELETE', `/api/v1/webhooks/${sub.data.id}`)).status, 204);
  receiver.calls = [];
  await a.post(`/api/properties/${p}/unpublish`); await a.post(`/api/properties/${p}/publish`);
  await sleep(150);
  assert.equal(receiver.calls.length, 0);
  assert.equal((await v1(key, 'DELETE', `/api/v1/webhooks/${sub.data.id}`)).status, 404);
});

test('webhooks: failed deliveries are retried on a schedule, can be retried by hand, and a 410 ends the subscription', async () => {
  const a = await staff('admin@expertdevelopers.pk');
  const made = (await a.post('/api/website-integrations/connections', { name: 'Retry hooks', scopes: ['webhooks:manage', 'leads:write'] })).data;
  const sub = (await v1(made.key, 'POST', '/api/v1/webhooks', { url: RECEIVER, events: ['lead.created'] })).data;
  receiver.status = 500; receiver.calls = [];
  await v1(made.key, 'POST', '/api/v1/leads', { name: 'Retry Person', email: 'retry@example.com' }, { 'Idempotency-Key': uuid() });
  await settle(1);
  await sleep(60);
  let d = get('SELECT * FROM webhook_deliveries WHERE subscription_id=?', sub.id);
  assert.equal(d.status, 'pending'); assert.equal(d.attempts, 1); assert.equal(d.last_status, 500);
  const wait = new Date(d.next_attempt_at) - Date.now();
  assert.ok(wait > 30_000 && wait < 90_000, 'first retry after about a minute');
  const firstEventId = JSON.parse(d.payload).id;

  // each retry is later than the one before; the event id never changes
  const gaps = [];
  for (let i = 0; i < 5; i++) {
    run('UPDATE webhook_deliveries SET next_attempt_at=? WHERE id=?', new Date(Date.now() - 1000).toISOString(), d.id);
    await runDueDeliveries();
    d = get('SELECT * FROM webhook_deliveries WHERE id=?', d.id);
    if (d.next_attempt_at) gaps.push(new Date(d.next_attempt_at) - Date.now());
  }
  assert.equal(d.attempts, 6); assert.equal(d.status, 'failed'); assert.equal(d.next_attempt_at, null);
  assert.ok(gaps.every((g, i) => i === 0 || g > gaps[i - 1]), `retry gaps grow: ${gaps.map((g) => Math.round(g / 60000))} min`);
  assert.ok(receiver.calls.every((c) => JSON.parse(c.body).id === firstEventId && c.headers['Agentify-Event-Id'] === firstEventId));
  assert.ok((await a.get(`/api/website-integrations/connections/${made.connection.id}/events`)).data.some((e) => e.event === 'webhook' && e.outcome === 'error'));

  // the health view lists it, and Retry sends it again
  const health = (await a.get(`/api/website-integrations/connections/${made.connection.id}/webhooks`)).data;
  assert.equal(health.deliveries[0].status, 'failed'); assert.equal(health.subscriptions.length, 1);
  receiver.status = 200;
  const retry = await a.post(`/api/website-integrations/connections/${made.connection.id}/deliveries/${d.id}/retry`);
  assert.equal(retry.status, 200); assert.equal(retry.data.ok, true);
  assert.equal(get('SELECT status FROM webhook_deliveries WHERE id=?', d.id).status, 'delivered');
  assert.equal((await a.post(`/api/website-integrations/connections/${made.connection.id}/deliveries/${d.id}/retry`)).status, 404, 'only failed deliveries can be retried');

  // a redirect is not followed, so it counts as a failure; 410 Gone ends the subscription
  receiver.status = 302; receiver.calls = [];
  await v1(made.key, 'POST', '/api/v1/leads', { name: 'Redirect Person', email: 'redir@example.com' }, { 'Idempotency-Key': uuid() });
  await settle(1); await sleep(60);
  assert.equal(all('SELECT status FROM webhook_deliveries WHERE subscription_id=? ORDER BY id DESC', sub.id)[0].status, 'pending');
  receiver.status = 410;
  await v1(made.key, 'POST', '/api/v1/leads', { name: 'Gone Person', email: 'gone@example.com' }, { 'Idempotency-Key': uuid() });
  await settle(3); await sleep(80);
  assert.equal(get('SELECT active FROM webhook_subscriptions WHERE id=?', sub.id).active, 0, '410 Gone unsubscribes');
  receiver.status = 200;
});

test('hosted forms: publishable key, origin allow-list, framing only by listed sites, same answer for new and known people', async () => {
  const a = await staff('admin@expertdevelopers.pk');
  const conn = (await a.post('/api/website-integrations/connections', { name: 'Embed site', platform: 'custom', scopes: ['leads:write'], config: { lead_source: 'Embedded form' } })).data.connection;
  assert.equal((await a.post(`/api/website-integrations/connections/${conn.id}/forms`, { name: '' })).status, 400);
  assert.equal((await a.post(`/api/website-integrations/connections/${conn.id}/forms`, { name: 'Bad', origins: ['http://example.com'] })).status, 400, 'https only');
  assert.equal((await a.post(`/api/website-integrations/connections/${conn.id}/forms`, { name: 'Bad', origins: ['not a url'] })).status, 400);
  const made = await a.post(`/api/website-integrations/connections/${conn.id}/forms`, { name: 'Contact page', title: 'Talk to us <b>', origins: ['https://www.example.com/some/path', 'https://shop.example.com'], consent_text: 'I agree to be contacted & accept the <privacy> notice.' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const f = made.data;
  assert.match(f.form_key, /^pk_[A-Za-z0-9_-]{24}$/); assert.deepEqual(f.origins, ['https://www.example.com', 'https://shop.example.com'], 'reduced to origins');
  assert.ok(f.snippets.script.includes(`data-form="${f.form_key}"`) && f.snippets.script.includes('/embed/agentify-form.js') && f.snippets.iframe.includes(`/embed/form/${f.form_key}`));

  // the hosted page: escaped text, framing only by the listed sites, no inline script
  const page = await realFetch(`${base}/embed/form/${f.form_key}?p=${encodeURIComponent('https://www.example.com/contact')}&r=javascript:alert(1)`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/www\.example\.com https:\/\/shop\.example\.com/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), null);
  assert.ok(html.includes('Talk to us &lt;b&gt;') && html.includes('&amp; accept the &lt;privacy&gt; notice.') && !html.includes('<privacy>'));
  assert.ok(html.includes('value="https://www.example.com/contact"') && !html.includes('javascript:alert'), 'only http(s) addresses are kept');
  assert.ok(!/<script>(?!\s*<\/script>)/.test(html.replace('<script src="/embed/form.js"></script>', '')), 'no inline script');
  assert.equal((await realFetch(`${base}/embed/form/pk_nonexistentkeynonexistent`)).status, 404);
  const loader = await realFetch(`${base}/embed/agentify-form.js`);
  assert.match(loader.headers.get('content-type'), /javascript/); assert.ok((await loader.text()).includes('/embed/form/'));
  assert.equal((await realFetch(`${base}/embed/form.js`)).status, 200);

  // browser submissions
  const submit = (origin, body, key = f.form_key) => realFetch(`${base}/api/v1/forms/${key}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  const pre = await realFetch(`${base}/api/v1/forms/${f.form_key}/submit`, { method: 'OPTIONS', headers: { Origin: 'https://www.example.com', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://www.example.com');
  assert.equal((await realFetch(`${base}/api/v1/forms/${f.form_key}/submit`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 403);
  const person = { name: 'Browser Visitor', email: 'visitor@example.com', phone: '03005550123', message: 'Hello from the form', consent: { privacy: true, text: f.consent_text }, source: { page_url: 'https://www.example.com/contact', utm_source: 'newsletter' } };
  const bad = await submit('https://evil.example', person);
  assert.equal(bad.status, 403); assert.equal((await bad.json()).error.code, 'origin_not_allowed');
  assert.equal((await submit(null, person)).status, 403, 'no Origin header, no submission');
  const n = val('SELECT COUNT(*) FROM contacts');
  const ok = await submit('https://www.example.com', { ...person, test: true, external_id: 'spoof' });
  assert.equal(ok.status, 201); assert.deepEqual(await ok.json(), { ok: true });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://www.example.com');
  assert.equal(val('SELECT COUNT(*) FROM contacts'), n + 1);
  const c = get("SELECT * FROM contacts WHERE email='visitor@example.com'");
  assert.equal(c.lead_source, 'Embedded form'); assert.ok(!JSON.parse(c.tags).includes('test'), 'a browser cannot mark itself as a test');
  const at = get('SELECT * FROM lead_attribution WHERE contact_id=?', c.id);
  assert.equal(at.form, 'Contact page'); assert.equal(at.external_id, null); assert.equal(JSON.parse(at.consent).privacy, true);
  // known person: same answer, nothing created
  const again = await submit('https://shop.example.com', { ...person, message: 'Second message' });
  assert.equal(again.status, 201); assert.deepEqual(await again.json(), { ok: true });
  assert.equal(val('SELECT COUNT(*) FROM contacts'), n + 1);
  // the hosted page posts from the workspace's own address
  assert.equal((await submit(base, { ...person, email: 'self@example.com', phone: '' })).status, 201);
  // consent is required because the form shows a consent text
  const noConsent = await submit('https://www.example.com', { name: 'No Consent', email: 'nc2@example.com' });
  assert.equal(noConsent.status, 400); assert.equal((await noConsent.json()).error.code, 'consent_required');
  // honeypot: looks successful, creates nothing
  const hp = val('SELECT COUNT(*) FROM contacts');
  assert.equal((await submit('https://www.example.com', { ...person, email: 'bot@example.com', website: 'http://spam.example' })).status, 201);
  assert.equal(val('SELECT COUNT(*) FROM contacts'), hp);

  // switched off or disconnected: gone
  assert.equal((await a.del(`/api/website-integrations/connections/${conn.id}/forms/${f.id}`)).status, 200);
  assert.equal((await submit('https://www.example.com', person)).status, 404);
  assert.equal((await realFetch(`${base}/embed/form/${f.form_key}`)).status, 404);
});

test('hosted forms: submissions are rate limited per form and address, and a disconnected connection stops its forms', async () => {
  const a = await staff('admin@expertdevelopers.pk');
  const conn = (await a.post('/api/website-integrations/connections', { name: 'Limit site', scopes: ['leads:write'] })).data.connection;
  const f = (await a.post(`/api/website-integrations/connections/${conn.id}/forms`, { name: 'Limited', origins: ['https://limit.example.com'] })).data;
  const submit = (i) => realFetch(`${base}/api/v1/forms/${f.form_key}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://limit.example.com' }, body: JSON.stringify({ name: 'Limit Person', email: `limit${i}@example.com` }) });
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await submit(i)).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(201)); assert.equal(codes[8], 429);
  const limited = await submit(99);
  assert.equal((await limited.json()).error.code, 'rate_limited');
  assert.equal((await a.del(`/api/website-integrations/connections/${conn.id}`)).status, 200);
  const g = await realFetch(`${base}/embed/form/${f.form_key}`);
  assert.equal(g.status, 404, 'the form of a disconnected connection is gone');
});
