import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-support-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { get, run } = await import('../src/db.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, password, portal) {
  const jar = {};
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'X-Requested-With': 'ERP', 'Content-Type': 'application/json', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  if (identifier) assert.equal((await call('POST', '/api/auth/login', { identifier, password, portal })).status, 200);
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}
const good = { name: 'Sara Khan', email: 'sara@example.com', phone: '0300 1234567', plot_no: 'B-12', category: 'Possession', subject: 'When is possession?', message: 'Please tell me when possession of my plot starts.' };

test('a website visitor can lodge a request; bad input is refused', async () => {
  const v = await client();
  assert.equal((await v.post('/api/site/support', { ...good, name: 'Sara 99' })).status, 400, 'name must be letters only');
  assert.equal((await v.post('/api/site/support', { ...good, email: 'nope' })).status, 400);
  assert.equal((await v.post('/api/site/support', { ...good, phone: '', whatsapp: '' })).status, 400, 'a phone or WhatsApp number is required');
  assert.equal((await v.post('/api/site/support', { ...good, message: 'x' })).status, 400);
  const r = await v.post('/api/site/support', good);
  assert.equal(r.status, 201);
  assert.match(r.data.reference, /^CMP-\d{4}$/);
  assert.equal((await v.post('/api/site/support', { ...good, website: 'spam' })).data.reference, undefined, 'honeypot does nothing');
});

test('a visitor tracks a request only with its reference and the contact detail they gave', async () => {
  const v = await client();
  const ref = (await v.post('/api/site/support', { ...good, subject: 'Track me' })).data.reference;
  assert.equal((await v.post('/api/site/support/track', { reference: ref, proof: '0300-0000000' })).status, 404);
  const ok = await v.post('/api/site/support/track', { reference: ref.toLowerCase(), proof: '03001234567' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.subject, 'Track me');
  assert.equal(ok.data.email, undefined, 'no personal details come back');
  assert.equal((await v.post('/api/site/support/track', { reference: ref, proof: 'SARA@example.com' })).status, 200);
});

test('staff handle a request: assign, reply, internal notes stay hidden, status changes', async () => {
  const v = await client();
  const ref = (await v.post('/api/site/support', { ...good, subject: 'Staff flow' })).data.reference;
  const a = await client('admin@expertdevelopers.pk', 'Demo@12345');
  const list = await a.get('/api/society/complaints?q=Staff');
  assert.equal(list.status, 200);
  const row = list.data.rows.find((x) => x.ref === ref);
  assert.ok(row);
  assert.equal((await a.post(`/api/society/complaints/${row.id}/reply`, { body: 'Internal: check ledger', internal: true })).status, 201);
  assert.equal((await a.post(`/api/society/complaints/${row.id}/reply`, { body: 'We are looking into it.' })).status, 201);
  assert.equal((await a.put(`/api/society/complaints/${row.id}`, { status: 'resolved', priority: 'high', assigned_to: list.data.team[0].id })).status, 200);
  assert.equal((await a.put(`/api/society/complaints/${row.id}`, { status: 'bogus' })).status, 400);
  const seen = await v.post('/api/site/support/track', { reference: ref, proof: 'sara@example.com' });
  assert.equal(seen.data.status, 'resolved', JSON.stringify(seen));
  const text = JSON.stringify(seen.data.messages);
  assert.ok(text.includes('looking into it'));
  assert.ok(!text.includes('Internal'), 'internal notes never reach the customer');
});

test('a portal customer sees and replies to only their own requests', async () => {
  const c = await client('m.ali@example.com', 'Demo@12345', true);
  const info = await c.get('/api/portal/support');
  assert.equal(info.status, 200);
  assert.ok(info.data.plots.length >= 1);
  const made = await c.post('/api/portal/support', { category: 'Ledger', subject: 'Ledger question', message: 'My ledger shows a payment twice.', sale_id: info.data.plots[0].id });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const mine = await c.get(`/api/portal/support/${made.data.id}`);
  assert.equal(mine.data.subject, 'Ledger question');
  assert.equal((await c.post(`/api/portal/support/${made.data.id}/reply`, { body: 'Any update?' })).status, 201);
  const other = await client('zainab.m@example.com', 'Demo@12345', true);
  assert.equal((await other.get(`/api/portal/support/${made.data.id}`)).status, 404);
  assert.equal((await other.post(`/api/portal/support/${made.data.id}/reply`, { body: 'hi there' })).status, 404);
  // staff see it, linked to the customer
  const a = await client('admin@expertdevelopers.pk', 'Demo@12345');
  const d = await a.get(`/api/society/complaints/${made.data.id}`);
  assert.equal(d.data.source, 'portal');
  assert.ok(d.data.contact);
  assert.equal((await c.get('/api/society/complaints')).status, 403, 'customers cannot use the staff API');
});

test('launch notices: staff publish, the website and portal show only live ones', async () => {
  const a = await client('admin@expertdevelopers.pk', 'Demo@12345');
  const mk = (b) => a.post('/api/society/launch-notices', b);
  const live = await mk({ title: 'Possession of Block C has started', kind: 'Possession', body: 'Collect your keys.', link_href: '/site/p/progress', link_label: 'Review details' });
  assert.equal(live.status, 201, JSON.stringify(live.data));
  assert.equal((await mk({ title: 'Old', ends_on: '2020-01-01' })).status, 201);
  assert.equal((await mk({ title: 'Switched off', active: 0 })).status, 201);
  assert.equal((await mk({ title: 'Quiet', show_popup: 0 })).status, 201);
  assert.equal((await mk({ title: 'Bad link', link_href: 'javascript:alert(1)' })).status, 201);
  assert.equal((await mk({ title: '' })).status, 400);
  const v = await client();
  const pop = (await v.get('/api/site/notices?popup=1')).data.data.map((n) => n.title);
  assert.ok(pop.includes('Possession of Block C has started'));
  for (const t of ['Old', 'Switched off', 'Quiet']) assert.ok(!pop.includes(t), t);
  const all = (await v.get('/api/site/notices')).data.data;
  assert.ok(all.some((n) => n.title === 'Quiet'));
  assert.equal(all.find((n) => n.title === 'Bad link').link_href, null, 'script links are dropped');
  const c = await client('m.ali@example.com', 'Demo@12345', true);
  assert.ok((await c.get('/api/portal/notices')).data.data.some((n) => n.title === 'Possession of Block C has started'));
  assert.ok(get('SELECT 1 FROM launch_notices WHERE id=?', live.data.id));
  run('SELECT 1');
});
