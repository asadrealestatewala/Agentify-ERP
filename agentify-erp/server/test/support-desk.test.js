// In-app support desk: a workspace user raises a ticket, the console answers it, tickets never cross workspaces,
// attachments are checked, the console permission is required and notification e-mails are in the chosen language.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-support-'));
Object.assign(process.env, {
  ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'root@agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual', PLATFORM_SUPPORT_EMAIL: 'help@agentify.test',
});
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY', 'MAIL_FROM']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { outbox } = await import('../src/services/mailer.js');
const { ROLES, permsOf } = await import('../src/services/platformAccess.js');
const { SUPPORT_TEXT, DEFAULT_SLA, supportLangs, nativeLang, ticketNo } = await import('../../shared/supportDesk.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, agent: false, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, raw: t, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0], headers: res.headers }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test', ADMIN = '/api/platform/admin';
const signup = (slug, email, extra = {}) => call(P, 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', ...extra });
async function login(host, identifier) {
  const l = await call(host, 'POST', '/api/auth/login', { identifier, password: 'Tenant@12345' });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const c = l.cookie;
  return { c, me: l.data, host, get: (u, h) => call(host, 'GET', u, null, { cookie: c, ...h }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }), put: (u, b) => call(host, 'PUT', u, b, { cookie: c }) };
}
const opSignIn = async (email, password) => (await call(P, 'POST', `${ADMIN}/login`, { email, password })).cookie;
const op = (cookie) => ({
  get: (u) => call(P, 'GET', `${ADMIN}${u}`, null, { cookie }),
  post: (u, b) => call(P, 'POST', `${ADMIN}${u}`, b || {}, { cookie }),
  put: (u, b) => call(P, 'PUT', `${ADMIN}${u}`, b, { cookie }),
});
const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(40, 7)]).toString('base64')}`;
let pk, ae, owner, ticket;

test('every language has the same keys as English and each country offers its own language', () => {
  const en = Object.keys(SUPPORT_TEXT.en).sort();
  for (const l of ['ur', 'ar', 'fr']) {
    assert.deepEqual(Object.keys(SUPPORT_TEXT[l]).sort(), en, `${l} has different keys`);
    for (const k of en) assert.ok(String(SUPPORT_TEXT[l][k]).trim().length, `${l}.${k} is empty`);
    // a translation must not be left as the English text
    assert.ok(SUPPORT_TEXT[l].title !== SUPPORT_TEXT.en.title, `${l} title not translated`);
  }
  assert.deepEqual(supportLangs('PK'), ['en', 'ur']);
  assert.deepEqual(supportLangs('AE'), ['en', 'ar']);
  assert.deepEqual(supportLangs('CA'), ['en', 'fr']);
  assert.deepEqual(supportLangs('UK'), ['en']);
  assert.equal(nativeLang('US'), 'en');
  assert.equal(ticketNo(7), 'T-1007');
});

test('a workspace user raises a ticket in their own language and is e-mailed in it', async () => {
  assert.equal((await signup('pkhomes', 'owner@pk.test', { region: 'PK', currency: 'PKR', timezone: 'Asia/Karachi' })).status, 201);
  assert.equal((await signup('dxbhomes', 'owner@dxb.test', { region: 'AE', currency: 'AED', timezone: 'Asia/Dubai' })).status, 201);
  pk = await login('pkhomes.erp.test', 'owner@pk.test');
  ae = await login('dxbhomes.erp.test', 'owner@dxb.test');

  const cfg = await pk.get('/api/support/config');
  assert.equal(cfg.status, 200);
  assert.deepEqual(cfg.data.languages, ['en', 'ur']);
  assert.equal(cfg.data.native, 'ur');
  assert.deepEqual((await ae.get('/api/support/config')).data.languages, ['en', 'ar']);

  outbox.length = 0;
  const made = await pk.post('/api/support/tickets', { subject: 'Receipt print is blank', category: 'problem', priority: 'high', lang: 'ur', body: 'The receipt voucher prints an empty page from the Receipts screen.', files: [{ name: 'shot.png', data: PNG }] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  ticket = made.data;
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.lang, 'ur');
  assert.equal(ticket.no, 'T-1001');
  // the first-reply clock follows the high-priority target
  assert.equal(Math.round((Date.parse(ticket.sla.first_due) - Date.parse(ticket.created_at)) / 60000), DEFAULT_SLA.high[0]);

  const toCustomer = outbox.find((m) => m.to === 'owner@pk.test');
  assert.ok(toCustomer, 'the customer is e-mailed');
  assert.ok(toCustomer.subject.includes('T-1001'));
  assert.ok(toCustomer.subject.includes('ٹکٹ'), 'the subject is in Urdu');
  assert.ok(toCustomer.html.includes('dir="rtl"'), 'Urdu mail reads right to left');
  const toTeam = outbox.find((m) => m.to === 'help@agentify.test');
  assert.ok(toTeam && toTeam.subject.includes('New ticket'), 'the support team is alerted');

  const list = await pk.get('/api/support/tickets');
  assert.equal(list.data.length, 1);
  const one = await pk.get(`/api/support/tickets/${ticket.id}`);
  assert.equal(one.data.messages.length, 1);
  assert.equal(one.data.messages[0].author_type, 'customer');
  assert.equal(one.data.messages[0].files.length, 1);
  const file = await pk.get(`/api/support/tickets/${ticket.id}/files/${one.data.messages[0].files[0].id}`);
  assert.equal(file.status, 200);
  assert.match(file.headers['content-type'], /image\/png/);
});

test('bad input, bad attachments and another workspace are all refused', async () => {
  assert.equal((await pk.post('/api/support/tickets', { subject: 'x', body: 'too short' })).status, 400);
  assert.equal((await pk.post('/api/support/tickets', { subject: 'Valid subject', body: 'This is long enough to be a body.', files: [{ name: 'a.exe', data: 'data:application/x-msdownload;base64,QQ==' }] })).status, 400);
  // a PNG name with PDF content, and a file that is simply too big
  assert.equal((await pk.post('/api/support/tickets', { subject: 'Valid subject', body: 'This is long enough to be a body.', files: [{ name: 'a.png', data: 'data:image/png;base64,QUJD' }] })).status, 400);
  assert.equal((await pk.post('/api/support/tickets', { subject: 'Valid subject', body: 'This is long enough to be a body.', files: [{ name: 'big.png', data: `data:image/png;base64,${Buffer.alloc(500 * 1024, 1).toString('base64')}` }] })).status, 400);
  // a language the region does not offer falls back to English
  const fr = await pk.post('/api/support/tickets', { subject: 'Language fallback', body: 'Pakistan does not offer French, so this stays English.', lang: 'fr' });
  assert.equal(fr.data.lang, 'en');

  // the other workspace sees none of it, by list or by id
  assert.equal((await ae.get('/api/support/tickets')).data.length, 0);
  assert.equal((await ae.get(`/api/support/tickets/${ticket.id}`)).status, 404);
  assert.equal((await ae.post(`/api/support/tickets/${ticket.id}/reply`, { body: 'Let me in' })).status, 404);
  assert.equal((await ae.get(`/api/support/tickets/${ticket.id}/files/1`)).status, 404);
  // and a signed-out visitor sees nothing
  assert.equal((await call('pkhomes.erp.test', 'GET', '/api/support/tickets')).status, 401);
});

test('a workspace user sees only their own tickets; the workspace Super Admin sees them all', async () => {
  const roles = await pk.get('/api/settings/roles');
  const agentRole = roles.data.find((x) => /agent/i.test(x.name)) || roles.data.find((x) => !x.portal && x.name !== 'Super Admin');
  const users = await pk.post('/api/settings/users', { name: 'Agent Ali', email: 'ali@pk.test', password: 'Tenant@12345', role_id: agentRole.id });
  assert.ok([200, 201].includes(users.status), JSON.stringify(users.data));
  const ali = await login('pkhomes.erp.test', 'ali@pk.test');
  const own = await ali.post('/api/support/tickets', { subject: 'Cannot open my leads', body: 'My leads list is empty after I signed in this morning.' });
  assert.equal(own.status, 201);
  const mine = await ali.get('/api/support/tickets');
  assert.deepEqual(mine.data.map((t) => t.id), [own.data.id], 'an agent sees only their own ticket');
  assert.equal((await ali.get(`/api/support/tickets/${ticket.id}`)).status, 404);
  const all = await pk.get('/api/support/tickets');
  assert.ok(all.data.length >= 3 && all.data.some((t) => t.id === own.data.id), 'the workspace Super Admin sees every ticket');
});

test('only roles with support.manage reach the console desk', async () => {
  for (const role of ['platform_owner', 'super_admin', 'platform_admin', 'support_manager', 'customer_success', 'technical_admin']) assert.ok(permsOf(role).includes('support.manage'), role);
  for (const role of ['read_only', 'analytics_viewer', 'social_media_manager', 'security_auditor', 'billing_manager']) assert.ok(!permsOf(role).includes('support.manage'), role);
  assert.ok(Object.keys(ROLES).length > 5);
  owner = op(await opSignIn('root@agentify.test', 'Console@12345'));
  const routes = [['GET', '/support/tickets'], ['GET', '/support/settings'], ['GET', `/support/tickets/${ticket.id}`], ['POST', `/support/tickets/${ticket.id}/reply`, { body: 'hi' }], ['PUT', `/support/tickets/${ticket.id}`, { priority: 'low' }], ['PUT', '/support/settings', {}]];
  for (const [m, u] of routes) assert.equal((await call(P, m, `${ADMIN}${u}`, null)).status, 401, `${m} ${u} without a session`);
  assert.equal((await owner.post('/admins', { email: 'analyst@agentify.test', name: 'Analyst', role: 'read_only', password: 'Cobalt#Harbor2031' })).status, 201);
  const analyst = op(await opSignIn('analyst@agentify.test', 'Cobalt#Harbor2031'));
  for (const [m, u, b] of routes) {
    const res = m === 'GET' ? await analyst.get(u) : m === 'PUT' ? await analyst.put(u, b) : await analyst.post(u, b);
    assert.equal(res.status, 403, `read_only ${m} ${u}`);
  }
});

test('the console replies, keeps internal notes private and e-mails the customer in their language', async () => {
  const queue = await owner.get('/support/tickets');
  assert.equal(queue.status, 200);
  assert.ok(queue.data.counts.open >= 3);
  assert.ok(queue.data.rows.some((t) => t.workspace.slug === 'pkhomes' && t.workspace.region === 'PK'));
  assert.ok(queue.data.rows.some((t) => t.unread_staff));

  const note = await owner.post(`/support/tickets/${ticket.id}/reply`, { body: 'Looks like the receipt template is missing a logo.', internal: true });
  assert.equal(note.status, 201);
  assert.equal(note.data.ticket.status, 'open', 'an internal note does not change the status');
  assert.equal(note.data.ticket.first_response_at, null, 'an internal note is not a first reply');
  assert.equal((await pk.get(`/api/support/tickets/${ticket.id}`)).data.messages.length, 1, 'the customer never sees the note');

  outbox.length = 0;
  const reply = await owner.post(`/support/tickets/${ticket.id}/reply`, { body: 'Please try again now; we fixed the template.', status: 'pending' });
  assert.equal(reply.status, 201);
  assert.equal(reply.data.ticket.status, 'pending');
  assert.ok(reply.data.ticket.first_response_at, 'the first-reply clock stops');
  assert.equal(reply.data.ticket.sla.first_state, 'met');
  assert.equal(reply.data.ticket.assignee, 'root@agentify.test');
  const mail = outbox.find((m) => m.to === 'owner@pk.test');
  assert.ok(mail && mail.subject.includes('ٹکٹ'), 'the reply mail is in Urdu');

  const seen = await pk.get(`/api/support/tickets/${ticket.id}`);
  assert.equal(seen.data.messages.length, 2);
  assert.ok(seen.data.messages.every((m) => m.internal === false));

  // the customer replies: the ticket wakes up and the team is told
  outbox.length = 0;
  const back = await pk.post(`/api/support/tickets/${ticket.id}/reply`, { body: 'Still blank, here is another screenshot.', files: [{ name: 'again.png', data: PNG }] });
  assert.equal(back.status, 201);
  assert.equal(back.data.ticket.status, 'open');
  assert.ok(outbox.some((m) => m.to === 'help@agentify.test' && m.subject.includes('Customer replied')));

  // solved from the console e-mails the customer and shows on their side
  const solved = await owner.put(`/support/tickets/${ticket.id}`, { status: 'solved' });
  assert.equal(solved.data.ticket.status, 'solved');
  assert.ok(solved.data.ticket.solved_at);
  assert.equal((await pk.get(`/api/support/tickets/${ticket.id}`)).data.ticket.status, 'solved');
  // and the customer can reopen it
  assert.equal((await pk.post(`/api/support/tickets/${ticket.id}/status`, { status: 'open' })).data.ticket.status, 'open');
  // closed is final for the customer
  assert.equal((await owner.put(`/support/tickets/${ticket.id}`, { status: 'closed' })).data.ticket.status, 'closed');
  assert.equal((await pk.post(`/api/support/tickets/${ticket.id}/reply`, { body: 'one more thing' })).status, 400);
});

test('reply targets are editable and refuse impossible numbers', async () => {
  assert.deepEqual((await owner.get('/support/settings')).data.sla.urgent, DEFAULT_SLA.urgent);
  assert.equal((await owner.put('/support/settings', { sla: { ...DEFAULT_SLA, urgent: [1, 10] }, notify_email: 'desk@agentify.test' })).status, 400);
  assert.equal((await owner.put('/support/settings', { sla: { ...DEFAULT_SLA, urgent: [120, 60] }, notify_email: 'desk@agentify.test' })).status, 400);
  assert.equal((await owner.put('/support/settings', { sla: DEFAULT_SLA, notify_email: 'not-an-address' })).status, 400);
  const ok = await owner.put('/support/settings', { sla: { ...DEFAULT_SLA, urgent: [30, 240] }, notify_email: 'desk@agentify.test' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.sla.urgent, [30, 240]);
  assert.equal(ok.data.notify_email, 'desk@agentify.test');
  // a new urgent ticket uses the new target, and the alert goes to the new address
  outbox.length = 0;
  const t = await ae.post('/api/support/tickets', { subject: 'Cannot add a payment', category: 'problem', priority: 'urgent', lang: 'ar', body: 'The payment screen will not save anything today.' });
  assert.equal(Math.round((Date.parse(t.data.sla.first_due) - Date.parse(t.data.created_at)) / 60000), 30);
  assert.ok(outbox.some((m) => m.to === 'desk@agentify.test'));
  const arMail = outbox.find((m) => m.to === 'owner@dxb.test');
  assert.ok(arMail && arMail.html.includes('dir="rtl"') && arMail.subject.includes('التذكرة'), 'the Arabic mail reads right to left');
  // the console can search and filter the queue
  const found = await owner.get('/support/tickets?status=open&priority=urgent&q=payment');
  assert.ok(found.data.rows.length >= 1 && found.data.rows.every((x) => x.priority === 'urgent'));
});

test('too many new tickets in an hour are refused', async () => {
  const fresh = await login('dxbhomes.erp.test', 'owner@dxb.test');
  let last = { status: 201 };
  for (let i = 0; i < 6 && last.status === 201; i += 1) last = await fresh.post('/api/support/tickets', { subject: `Question ${i}`, body: 'This is a long enough message to be accepted by the desk.' });
  assert.equal(last.status, 400, 'the sixth ticket in an hour is refused');
});
