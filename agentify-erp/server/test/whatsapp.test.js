// WhatsApp inbox: entitlement and limits, webhook security and idempotency, opt-out, the 24-hour window, throttling, tenancy and
// permissions. A fake gateway stands in for Botlinkd: nothing touches the network and no real message is ever sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-wa-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_DEMO = '0';
process.env.ERP_MAIL_QUIET = '1';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const P = await import('../src/platform.js');
const W = await import('../src/services/whatsapp.js');
const L = await import('../src/services/whatsappLimits.js');
const A = await import('../src/services/whatsappAccess.js');
const B = await import('../src/integrations/botlinkd.js');
const Int = await import('../src/services/integrations.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const Q = await import('../src/services/whatsappQr.js');
const G = await import('../src/integrations/qrGateway.js');
const db = await import('../src/db.js');

let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); db.closeDbs(); });

const fake = { sent: [], tpl: [], fail: null, async sendTemplate(m) { if (fake.fail) throw B.classifyError(fake.fail, 400); fake.tpl.push(m); return { ref: `wamid_t${fake.tpl.length}` }; }, async sendText(m) { if (fake.fail) throw B.classifyError(fake.fail, 400); fake.sent.push(m); return { ref: `wamid_${fake.sent.length}` }; } };
B.setWhatsappProvider(fake);

let n = 0;
const mkTenant = () => { n += 1; const t = P.createTenant({ slug: `wa${n}`, name: `WA Co ${n}`, adminName: 'Owner Person', adminEmail: `owner${n}@wa${n}.test`, adminPassword: 'Tenant@12345' }); return P.getTenant(t.id); };
const as = (t, fn) => P.withTenant(t, fn);
const call = (host, method, url, body, headers = {}, raw = null) => new Promise((resolve, reject) => {
  const data = raw ?? (body ? JSON.stringify(body) : null);
  const rq = http.request({ host: '127.0.0.1', port, path: url, method, agent: false, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c));
    res.on('end', () => { const t = Buffer.concat(ch).toString(); let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  rq.on('error', reject); if (data) rq.write(data); rq.end();
});
const login = async (t) => ({ cookie: (await call(`${t.slug}.erp.test`, 'POST', '/api/auth/login', { identifier: t.owner_email, password: 'Tenant@12345' })).cookie });
const inbound = (waId, text, id) => ({ event: 'message.received', event_id: id, occurred_at: new Date().toISOString(), data: { message: { type: 'text', text }, sender: { wa_id: waId, name: 'Customer' }, platform: { uuid: 'p1' } } });
const staff = (t) => as(t, () => ({ id: db.get('SELECT id FROM users ORDER BY id LIMIT 1').id, name: 'Owner Person', role: 'Admin' }));
const turnOn = () => { setSetting('whatsapp_enabled', '1'); setSetting('whatsapp_default_limits', JSON.stringify({ enabled: true, monthly: 1000, daily: 200 })); };
const turnOff = () => { setSetting('whatsapp_enabled', null); setSetting('whatsapp_default_limits', null); };
const connect = (t, extra = {}) => as(t, () => W.saveConnection(staff(t), { appkey: 'APPKEY12345', authkey: 'AUTHKEY12345', number: '447700900123', ...extra }));
const hook = (t, cfg, payload, { sign = null } = {}) => {
  const raw = JSON.stringify(payload);
  return call(`${t.slug}.erp.test`, 'POST', `/api/hooks/whatsapp/${cfg.webhook_token}`, null, sign ? { 'X-Signature': `sha256=${B.signBody(sign, raw)}` } : {}, raw);
};
const cfgOf = (t) => as(t, async () => (await import('../src/integrations/store.js')).integrationConfig('botlinkd'));

test('limits: input is validated and layers merge key by key; nothing is on by default', () => {
  assert.equal(L.cleanWhatsappLimits(''), null);
  assert.deepEqual(L.cleanWhatsappLimits({ enabled: 1, monthly: '500', daily: 50 }), { enabled: true, monthly: 500, daily: 50 });
  assert.throws(() => L.cleanWhatsappLimits({ monthly: 10, daily: 20 }), /daily limit cannot exceed/);
  assert.throws(() => L.cleanWhatsappLimits({ monthly: -1 }));
  assert.equal(L.mergeWhatsappLimits().enabled, false);
  assert.deepEqual(L.mergeWhatsappLimits({ enabled: true, monthly: 100 }, { daily: 10 }, { monthly: 300 }), { enabled: true, monthly: 300, daily: 10 });
});

test('signature: HMAC-SHA256 over the exact bytes, hex or base64, with or without the sha256= prefix; wrong or missing fails', () => {
  const raw = '{"a":1}', sec = 'topsecret99';
  const hex = B.signBody(sec, raw);
  assert.ok(B.verifySignature(sec, raw, { 'x-signature': hex }));
  assert.ok(B.verifySignature(sec, raw, { 'x-botlinkd-signature': `sha256=${hex}` }));
  assert.ok(B.verifySignature(sec, raw, { 'x-webhook-signature': Buffer.from(hex, 'hex').toString('base64') }));
  assert.ok(!B.verifySignature(sec, '{"a":2}', { 'x-signature': hex }));
  assert.ok(!B.verifySignature('other-secret', raw, { 'x-signature': hex }));
  assert.ok(!B.verifySignature(sec, raw, {}));
  assert.ok(!B.verifySignature('', raw, { 'x-signature': hex }));
  assert.equal(B.cleanNumber('+44 7544 440352'), '447544440352');
  assert.equal(B.cleanNumber('0123'), null);
});

test('entitlement: off until the platform switch AND a plan/default/override layer enable it; the workspace override wins', () => {
  const t = mkTenant();
  turnOff();
  assert.equal(A.whatsappAccess(t).reason, 'platform_off');
  setSetting('whatsapp_enabled', '1');
  assert.equal(A.whatsappAccess(t).reason, 'not_in_plan');
  setSetting('whatsapp_default_limits', JSON.stringify({ enabled: true, monthly: 100, daily: 10 }));
  assert.equal(A.whatsappAccess(t).enabled, true);
  assert.equal(A.whatsappAccess(t).daily, 10);
  P.platformDb().prepare('UPDATE tenants SET entitlements=? WHERE id=?').run(JSON.stringify({ whatsapp: { enabled: false } }), t.id);
  assert.equal(A.whatsappAccess(P.getTenant(t.id)).reason, 'not_in_plan');
  turnOn();
});

test('connection: keys are stored encrypted, never returned, validated; the webhook address is stable until rotated', () => {
  turnOn();
  const t = mkTenant();
  assert.throws(() => connect(t, { appkey: 'a b' }), /App key looks wrong/);
  assert.throws(() => connect(t, { number: '12' }), /international form/);
  connect(t);
  as(t, () => {
    const v = W.connectionView('https://x.erp.test');
    assert.equal(v.state, 'configured');
    assert.match(v.webhook_url, /^https:\/\/x\.erp\.test\/api\/hooks\/whatsapp\/[0-9a-f]{48}$/);
    assert.ok(!JSON.stringify(v).includes('APPKEY12345') && !JSON.stringify(v).includes('AUTHKEY12345'), 'keys never leave the server');
    assert.equal(v.keys.appkey, '••••2345');
    const raw = db.get("SELECT config_enc FROM tenant_integrations WHERE provider='botlinkd'").config_enc;
    assert.ok(raw.startsWith('v1:') && !raw.includes('APPKEY'));
    const before = v.webhook_url;
    W.saveConnection(staff(t), { appkey: 'NEWAPPKEY999' });
    assert.equal(W.connectionView('https://x.erp.test').webhook_url, before);
    W.rotateWebhookToken(staff(t));
    assert.notEqual(W.connectionView('https://x.erp.test').webhook_url, before);
  });
});

test('webhook: secret path token required, signature enforced when a signing secret is saved, repeats are ignored, unknown events acknowledged', async () => {
  turnOn();
  const t = mkTenant();
  connect(t, { signing_secret: 'signing-secret-1' });
  const cfg = await cfgOf(t);
  const host = `${t.slug}.erp.test`;
  assert.equal((await call(host, 'POST', '/api/hooks/whatsapp/not-the-token', inbound('923001112233', 'hi', 'e1'))).status, 404);
  assert.equal((await hook(t, cfg, inbound('923001112233', 'hi', 'e1'))).status, 401, 'no signature');
  assert.equal((await hook(t, cfg, inbound('923001112233', 'hi', 'e1'), { sign: 'wrong-secret-xx' })).status, 401, 'wrong signature');
  assert.equal((await hook(t, cfg, inbound('923001112233', 'hi there', 'e1'), { sign: 'signing-secret-1' })).status, 200);
  assert.equal((await hook(t, cfg, inbound('923001112233', 'hi there', 'e1'), { sign: 'signing-secret-1' })).status, 200, 'repeat delivery');
  assert.equal((await hook(t, cfg, { event: 'message.status', data: {} }, { sign: 'signing-secret-1' })).status, 200);
  assert.equal((await hook(t, cfg, inbound('12', 'x', 'e2'), { sign: 'signing-secret-1' })).status, 400, 'bad sender id');
  as(t, () => {
    assert.equal(db.get('SELECT COUNT(*) n FROM wa_messages').n, 1);
    assert.equal(db.get('SELECT unread FROM wa_threads').unread, 1);
    assert.equal(W.connectionView('').state, 'connected', 'a verified inbound message proves the webhook path');
  });
  // another workspace's token never works on this workspace's host
  const t2 = mkTenant(); connect(t2);
  assert.equal((await call(host, 'POST', `/api/hooks/whatsapp/${(await cfgOf(t2)).webhook_token}`, inbound('923001112233', 'x', 'e9'))).status, 404);
});

test('webhook: without a signing secret the path token alone is accepted; a workspace without the entitlement stores nothing', async () => {
  turnOn();
  const t = mkTenant(); connect(t);
  const cfg = await cfgOf(t);
  assert.equal((await hook(t, cfg, inbound('923004445566', 'hello', 'a1'))).status, 200);
  as(t, () => assert.equal(db.get('SELECT COUNT(*) n FROM wa_messages').n, 1));
  P.platformDb().prepare('UPDATE tenants SET entitlements=? WHERE id=?').run(JSON.stringify({ whatsapp: { enabled: false } }), t.id);
  assert.equal((await hook(t, cfg, inbound('923004445566', 'again', 'a2'))).status, 200);
  as(t, () => assert.equal(db.get('SELECT COUNT(*) n FROM wa_messages').n, 1));
});

test('inbox: a known contact is matched by number and keeps its owner; replies go out one-to-one inside the 24-hour window and are logged', async () => {
  turnOn(); fake.sent.length = 0;
  const t = mkTenant(); connect(t);
  const cfg = await cfgOf(t);
  const { cid, agent } = as(t, () => {
    const agent = db.get("SELECT id FROM users ORDER BY id LIMIT 1").id;
    const cid = Number(db.run("INSERT INTO contacts(full_name,phone,agent_id,created_at) VALUES('Known Buyer','0300-1112233',?,datetime('now'))", agent).lastInsertRowid);
    return { cid, agent };
  });
  await hook(t, cfg, inbound('03001112233'.replace(/^0/, '92'), 'Is the plot available?', 'k1'));
  await as(t, async () => {
    const th = db.get('SELECT * FROM wa_threads');
    assert.equal(th.contact_id, cid); assert.equal(th.assigned_to, agent);
    const u = staff(t);
    const m = await W.sendReply(u, th.id, '  Yes, it is available.  ');
    assert.equal(m.status, 'sent');
    assert.deepEqual(fake.sent[0], { appkey: 'APPKEY12345', authkey: 'AUTHKEY12345', to: '923001112233', message: 'Yes, it is available.' });
    assert.ok(db.get("SELECT 1 FROM activities WHERE contact_id=? AND action='WhatsApp message sent'", cid));
    assert.equal(W.threadRow(th.id).unread, 0);
    await assert.rejects(() => W.sendReply(u, th.id, ''), /Type a message/);
    await assert.rejects(() => W.sendReply(u, th.id, 'x'.repeat(1001)), /under 1000/);
    // window closed
    db.run('UPDATE wa_threads SET last_inbound_at=? WHERE id=?', new Date(Date.now() - 25 * 3600_000).toISOString(), th.id);
    await assert.rejects(() => W.sendReply(u, th.id, 'late'), /24-hour reply window is closed/);
    assert.equal(fake.sent.length, 1);
  });
});

test('opt-out: STOP blocks sending until START or a staff decision with a reason; no automatic reply is ever sent', async () => {
  turnOn(); fake.sent.length = 0;
  const t = mkTenant(); connect(t);
  const cfg = await cfgOf(t);
  await hook(t, cfg, inbound('923007778899', 'STOP', 's1'));
  await as(t, async () => {
    const th = db.get('SELECT * FROM wa_threads'); const u = staff(t);
    assert.ok(W.withWindow(W.threadRow(th.id)).opted_out);
    await assert.rejects(() => W.sendReply(u, th.id, 'hello'), /asked not to be messaged/);
    W.setOptOut(u, W.threadRow(th.id), false, 'Customer phoned and asked us to write again');
    assert.equal(W.withWindow(W.threadRow(th.id)).can_reply, true);
    assert.throws(() => W.setOptOut(u, W.threadRow(th.id), false, ''), /why/);
  });
  assert.equal(fake.sent.length, 0, 'nothing was sent automatically');
  await hook(t, cfg, inbound('923007778899', 'please stop', 's2')); // not an opt-out keyword on its own line? it is a sentence, so it stays a normal message
  await hook(t, cfg, inbound('923007778899', 'Stop.', 's3'));
  await hook(t, cfg, inbound('923007778899', 'START', 's4'));
  as(t, () => assert.ok(!W.withWindow(W.threadRow(db.get('SELECT id FROM wa_threads').id)).opted_out));
});

test('limits and throttle: per-person minute cap, daily and monthly caps stop sends; failed sends are recorded, explained and not retried', async () => {
  turnOn(); fake.sent.length = 0;
  const t = mkTenant(); connect(t);
  const cfg = await cfgOf(t);
  await hook(t, cfg, inbound('923001230000', 'hello', 'l1'));
  await as(t, async () => {
    const th = db.get('SELECT * FROM wa_threads'); const u = staff(t);
    fake.fail = 'Authentication failed';
    await assert.rejects(() => W.sendReply(u, th.id, 'a'), /did not accept the keys/);
    assert.equal(db.get("SELECT status FROM wa_messages WHERE direction='out'").status, 'failed');
    assert.equal(W.connectionView('').state, 'error');
    assert.equal(fake.sent.length, 0);
    fake.fail = null;
    db.run("DELETE FROM wa_messages WHERE direction='out'");
    for (let i = 0; i < W.PER_USER_PER_MINUTE; i++) await W.sendReply(u, th.id, `m${i}`);
    await assert.rejects(() => W.sendReply(u, th.id, 'one more'), /too fast/);
    assert.equal(fake.sent.length, W.PER_USER_PER_MINUTE);
  });
  // a small daily cap on the workspace
  P.platformDb().prepare('UPDATE tenants SET entitlements=? WHERE id=?').run(JSON.stringify({ whatsapp: { enabled: true, monthly: 100, daily: 2 } }), t.id);
  await as(P.getTenant(t.id), async () => {
    const th = db.get('SELECT * FROM wa_threads');
    db.run("DELETE FROM wa_messages WHERE direction='out'");
    const u = staff(t);
    await W.sendReply(u, th.id, 'one'); await W.sendReply(u, th.id, 'two');
    await assert.rejects(() => W.sendReply(u, th.id, 'three'), /daily WhatsApp limit/);
  });
});

test('console: keys are encrypted and masked, the test sends one message only to the number typed, and WhatsApp stays off until switched on', async () => {
  fake.sent.length = 0;
  turnOff();
  await Int.configure('botlinkd', { appkey: 'PLATAPPKEY123', authkey: 'PLATAUTHKEY123', platform_id: '447544440352', enabled: true, default_limits: { enabled: false, monthly: 500, daily: 50 } }, 'op@test');
  const item = Int.registry().find((i) => i.id === 'botlinkd');
  assert.equal(item.configured, true);
  assert.ok(!JSON.stringify(item).includes('PLATAPPKEY123') && !JSON.stringify(item).includes('PLATAUTHKEY123'));
  assert.equal(item.settings.appkey.hint, '…Y123');
  assert.equal(item.settings.platform_id, '447544440352');
  assert.equal((await Int.test('botlinkd', 'op@test', {})).ok, false, 'a number is required');
  assert.equal(fake.sent.length, 0);
  const ok = await Int.test('botlinkd', 'op@test', { number: '+44 7700 900123' });
  assert.equal(ok.ok, true);
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0].to, '447700900123');
  assert.equal(fake.sent[0].appkey, 'PLATAPPKEY123');
  await assert.rejects(() => Int.configure('botlinkd', { appkey: 'bad key' }, 'op@test'), /looks wrong/);
  await assert.rejects(() => Int.configure('botlinkd', { default_limits: { monthly: 5, daily: 9 } }, 'op@test'), /cannot exceed/);
  const t = mkTenant();
  assert.equal(A.whatsappAccess(t).enabled, false, 'switching the platform on does not give a workspace access');
  await Int.disconnect('botlinkd', 'op@test');
  assert.equal(Int.registry().find((i) => i.id === 'botlinkd').configured, false);
  turnOn();
});

test('HTTP: staff routes need permissions, an own-scope agent sees only their conversations and cannot reassign, workspaces never see each other', async () => {
  turnOn();
  const a = mkTenant(), b = mkTenant();
  connect(a); connect(b);
  const ha = await login(a), hb = await login(b);
  const host = `${a.slug}.erp.test`;
  assert.equal((await call(host, 'GET', '/api/whatsapp/threads')).status, 401);
  const cfg = await cfgOf(a);
  await hook(a, cfg, inbound('923001110001', 'one', 'h1'));
  await hook(a, cfg, inbound('923001110002', 'two', 'h2'));
  const list = await call(host, 'GET', '/api/whatsapp/threads', null, ha);
  assert.equal(list.status, 200); assert.equal(list.data.length, 2);
  assert.equal((await call(`${b.slug}.erp.test`, 'GET', '/api/whatsapp/threads', null, hb)).data.length, 0);
  assert.equal((await call(`${b.slug}.erp.test`, 'GET', `/api/whatsapp/threads/${list.data[0].id}`, null, hb)).status, 404, 'other workspace has no such thread');
  const full = await call(host, 'GET', '/api/whatsapp/connection', null, ha);
  assert.match(full.data.webhook_url, /\/api\/hooks\/whatsapp\//);
  assert.ok(!JSON.stringify(full.data).includes('APPKEY'));
  // an own-scope agent
  const role = as(a, () => db.get("SELECT id FROM roles WHERE name='Sales Agent'").id);
  const agentId = as(a, () => {
    const hash = db.get('SELECT password_hash h FROM users LIMIT 1').h;
    const id = Number(db.run('INSERT INTO users(name,email,password_hash,role_id,created_at) VALUES(?,?,?,?,?)', 'Sam Seller', 'sam@wa.test', hash, role, '2026-01-01 00:00:00').lastInsertRowid);
    const mine = list.data.find((x) => x.wa_id === '923001110001').id;
    db.run('UPDATE wa_threads SET assigned_to=? WHERE id=?', id, mine);
    return id;
  });
  const lg = await call(host, 'POST', '/api/auth/login', { identifier: 'sam@wa.test', password: 'Tenant@12345' });
  const hs = { cookie: lg.cookie };
  const mineList = await call(host, 'GET', '/api/whatsapp/threads', null, hs);
  assert.equal(mineList.data.length, 1);
  const theirs = list.data.find((x) => x.wa_id === '923001110002').id;
  assert.equal((await call(host, 'GET', `/api/whatsapp/threads/${theirs}`, null, hs)).status, 403);
  assert.equal((await call(host, 'PUT', `/api/whatsapp/threads/${mineList.data[0].id}`, { assigned_to: null }, hs)).status, 403);
  assert.equal((await call(host, 'PUT', '/api/whatsapp/connection', { appkey: 'HACKEDKEY1234' }, hs)).status, 403, 'agents cannot change the connection');
  assert.equal((await call(host, 'GET', '/api/whatsapp/connection', null, hs)).data.webhook_url, null, 'the secret address is for settings editors only');
  // create a lead from a conversation
  const created = await call(host, 'POST', `/api/whatsapp/threads/${theirs}/create-lead`, { name: 'Zainab Khan' }, ha);
  assert.equal(created.status, 201);
  assert.ok(created.data.contact_id);
  assert.equal(as(a, () => db.get('SELECT lead_source s FROM contacts WHERE id=?', created.data.contact_id).s), 'WhatsApp');
  assert.equal((await call(host, 'POST', `/api/whatsapp/threads/${theirs}/create-lead`, { name: 'Zainab Khan' }, ha)).status, 400, 'already linked');
  void agentId;
});

// ------------------------------------------------------------------ optional QR mode (unofficial, opt-in)
const gw = { created: [], deleted: [], sent: [], status: 'qr', qr: 'data:image/png;base64,iVBORw0KGgo=', number: '447700900555', fail: false,
  async health() { return {}; },
  async createSession(x) { if (gw.fail) throw B.classifyError('boom', 500); gw.created.push(x); return {}; },
  async getSession() { return { status: gw.status, qr_image: gw.qr, number: gw.number }; },
  async deleteSession(id) { gw.deleted.push(id); return {}; },
  async sendText(m) { gw.sent.push(m); return { ref: `gw_${gw.sent.length}` }; } };
G.setQrGateway(gw);
const qrPlatform = (on) => { setSetting('whatsapp_qr_enabled', on ? '1' : null); setSetting('whatsapp_qr_gateway_url', on ? 'https://gw.example.test' : null); setSetting('whatsapp_qr_gateway_token', on ? 'gatewaytoken-123456' : null, { secret: true }); };

test('QR mode: unavailable until the platform AND the workspace switch it on with a ticked risk acknowledgement', async () => {
  turnOn(); qrPlatform(false);
  const t = mkTenant();
  as(t, () => { assert.equal(Q.qrView().allowed, false); assert.throws(() => Q.enableQr(staff(t), { acknowledge: true }), /not switched on for this platform/); });
  qrPlatform(true);
  as(t, () => {
    assert.equal(Q.qrView().allowed, true);
    assert.equal(Q.qrView().active, false, 'allowed is not active');
    assert.throws(() => Q.enableQr(staff(t), {}), /Tick the box/);
    assert.throws(() => Q.enableQr(staff(t), { acknowledge: 'yes' }), /Tick the box/);
    assert.match(Q.qrView().risk_text, /ban/);
    Q.enableQr(staff(t), { acknowledge: true });
    assert.equal(Q.qrView().accepted, true);
    assert.equal(W.connectionView('').mode, 'cloud', 'still the official mode until a session is started');
  });
});

test('QR mode: session, QR image, linked number, inbound over the signed webhook and one-to-one replies through the gateway only', async () => {
  turnOn(); qrPlatform(true); gw.created.length = 0; gw.sent.length = 0; fake.sent.length = 0; gw.status = 'qr';
  const t = mkTenant();
  await as(t, async () => {
    const u = staff(t);
    Q.enableQr(u, { acknowledge: true });
    await Q.startQr(u, 'https://w.erp.test');
    assert.equal(gw.created.length, 1);
    assert.match(gw.created[0].webhookUrl, /^https:\/\/w\.erp\.test\/api\/hooks\/whatsapp\/[0-9a-f]{48}$/);
    assert.ok(gw.created[0].secret.length >= 32);
    let s = await Q.qrStatus(); assert.equal(s.state, 'qr'); assert.ok(s.qr_image.startsWith('data:image/png'));
    gw.qr = 'javascript:alert(1)'; assert.equal((await Q.qrStatus()).qr_image, null, 'only PNG/JPEG data images are shown');
    gw.status = 'connected'; s = await Q.qrStatus(); assert.equal(s.state, 'connected'); assert.equal(s.number, '447700900555');
    const v = W.connectionView('');
    assert.equal(v.mode, 'qr'); assert.equal(v.state, 'connected');
    assert.ok(!JSON.stringify(v).includes(gw.created[0].secret), 'the session secret never leaves the server');
  });
  const cfg = as(t, () => Q.qrConfig());
  const hook2 = (payload, secret) => { const raw = JSON.stringify(payload); return call(`${t.slug}.erp.test`, 'POST', `/api/hooks/whatsapp/${cfg.webhook_token}`, null, secret ? { 'X-Signature': B.signBody(secret, raw) } : {}, raw); };
  assert.equal((await hook2(inbound('923005550001', 'hello', 'q1'))).status, 401, 'the QR webhook is always signed');
  assert.equal((await hook2(inbound('923005550001', 'hello', 'q1'), cfg.signing_secret)).status, 200);
  await as(t, async () => {
    const th = db.get('SELECT * FROM wa_threads');
    await W.sendReply(staff(t), th.id, 'Thanks for writing');
    assert.equal(gw.sent.length, 1); assert.equal(gw.sent[0].to, '923005550001');
    assert.equal(fake.sent.length, 0, 'nothing went through Botlinkd');
    db.run('UPDATE wa_threads SET last_inbound_at=? WHERE id=?', new Date(Date.now() - 30 * 3600_000).toISOString(), th.id);
    await assert.rejects(() => W.sendReply(staff(t), th.id, 'late'), /24-hour/, 'the same reply window applies in QR mode');
    gw.status = 'disconnected'; await Q.qrStatus();
    db.run('UPDATE wa_threads SET last_inbound_at=? WHERE id=?', new Date().toISOString(), th.id);
    await assert.rejects(() => W.sendReply(staff(t), th.id, 'x'), /not linked right now/);
    await Q.disconnectQr(staff(t), { forget: true });
    assert.deepEqual(gw.deleted, [cfg.session_id]);
    assert.equal(Q.qrView().accepted, false); assert.equal(W.connectionView('').mode, 'cloud');
  });
  assert.equal((await hook2(inbound('923005550001', 'again', 'q2'), cfg.signing_secret)).status, 404, 'the old address stops working');
});

test('QR mode: a failing gateway is reported, the console stores its token encrypted and tests with a health check only, agents cannot switch it on', async () => {
  turnOn(); qrPlatform(false);
  await Int.configure('whatsapp_qr', { gateway_url: 'https://gw.example.test/', token: 'gatewaytoken-123456', enabled: true }, 'op@test');
  const item = Int.registry().find((i) => i.id === 'whatsapp_qr');
  assert.equal(item.configured, true); assert.ok(!JSON.stringify(item).includes('gatewaytoken-123456'));
  assert.equal((await Int.test('whatsapp_qr', 'op@test', {})).ok, true);
  await assert.rejects(() => Int.configure('whatsapp_qr', { gateway_url: 'http://insecure.test' }, 'op@test'), /https/);
  const t = mkTenant();
  gw.fail = true;
  await as(t, async () => { Q.enableQr(staff(t), { acknowledge: true }); await assert.rejects(() => Q.startQr(staff(t), 'https://w.erp.test'), /could not start a session/); });
  gw.fail = false;
  const host = `${t.slug}.erp.test`;
  const role = as(t, () => db.get("SELECT id FROM roles WHERE name='Sales Agent'").id);
  as(t, () => { const hash = db.get('SELECT password_hash h FROM users LIMIT 1').h; db.run('INSERT INTO users(name,email,password_hash,role_id,created_at) VALUES(?,?,?,?,?)', 'Sam Seller', 'sam@qr.test', hash, role, '2026-01-01 00:00:00'); });
  const lg = await call(host, 'POST', '/api/auth/login', { identifier: 'sam@qr.test', password: 'Tenant@12345' });
  assert.equal((await call(host, 'POST', '/api/whatsapp/qr/enable', { acknowledge: true }, { cookie: lg.cookie })).status, 403);
  assert.equal((await call(host, 'GET', '/api/whatsapp/qr/status', null, { cookie: lg.cookie })).status, 403);
  assert.equal((await call(host, 'GET', '/api/whatsapp/qr/status', null, await login(t))).status, 200);
  qrPlatform(true);
});

const TPLS = [{ name: 'viewing_reminder', language: 'en', params: ['Customer name', 'Time'], preview: 'Hello {{1}}, your viewing is at {{2}}.', approved: true }, { name: 'draft_offer', language: 'en', params: [], approved: false }];

test('templates: the console test sends an approved template, and a closed-window error is explained as "keys work, template needed"', async () => {
  fake.sent.length = 0; fake.tpl.length = 0; turnOff();
  await Int.configure('botlinkd', { appkey: 'PLATAPPKEY123', authkey: 'PLATAUTHKEY123' }, 'op@test');
  fake.fail = 'The customer service window is closed. Send an approved template to continue.';
  const r1 = await Int.test('botlinkd', 'op@test', { number: '447700900123' });
  assert.equal(r1.ok, false);
  assert.match(r1.detail, /accepted the keys/); assert.match(r1.detail, /approved template name/);
  fake.fail = null;
  await assert.rejects(() => Int.configure('botlinkd', { test_template: 'Bad Name!' }, 'op@test'), /lower-case/);
  await Int.configure('botlinkd', { test_template: 'hello_world', test_language: 'en_US', test_params: 'Asad | #1001' }, 'op@test');
  assert.equal(Int.registry().find((i) => i.id === 'botlinkd').settings.test_template, 'hello_world');
  const r2 = await Int.test('botlinkd', 'op@test', { number: '447700900123' });
  assert.equal(r2.ok, true);
  assert.equal(fake.sent.length, 0, 'no plain text when a template is saved');
  assert.deepEqual(fake.tpl[0], { appkey: 'PLATAPPKEY123', authkey: 'PLATAUTHKEY123', to: '447700900123', template: 'hello_world', language: 'en_US', params: ['Asad', '#1001'] });
  assert.equal(B.classifyError('The customer service window is closed.', 400).kind, 'window');
  await Int.disconnect('botlinkd', 'op@test');
  turnOn();
});

test('templates: saved list is validated; only approved ones send, with every value, to one person, through the same guards', async () => {
  turnOn(); fake.sent.length = 0; fake.tpl.length = 0;
  const t = mkTenant(); connect(t);
  await as(t, async () => {
    const u = staff(t);
    assert.throws(() => W.saveTemplates(u, [{ name: 'Bad Name', language: 'en' }]), /lower-case/);
    assert.throws(() => W.saveTemplates(u, [{ name: 'a', language: 'en' }, { name: 'a', language: 'en' }]), /listed twice/);
    W.saveTemplates(u, TPLS);
    assert.equal(W.connectionView('https://x').templates.length, 2);
    assert.ok(W.connectionView('https://x').keys, 'saving templates keeps the keys');
    // a number never written to: needs consent, an approved template and all values
    await assert.rejects(() => W.sendTemplateMessage(u, { number: '447700900555', template: 'viewing_reminder', values: ['Sam', '5pm'] }), /agreed to receive/);
    await assert.rejects(() => W.sendTemplateMessage(u, { number: '447700900555', template: 'viewing_reminder', values: ['Sam'], consent: true }), /Fill in all 2/);
    await assert.rejects(() => W.sendTemplateMessage(u, { number: '447700900555', template: 'draft_offer', values: [], consent: true }), /not marked as approved/);
    await assert.rejects(() => W.sendTemplateMessage(u, { number: '447700900555', template: 'nope', values: [], consent: true }), /saved templates/);
    assert.equal(fake.tpl.length, 0);
    const m = await W.sendTemplateMessage(u, { number: '+44 7700 900555', template: 'viewing_reminder', values: ['Sam', '5pm'], consent: true });
    assert.equal(m.status, 'sent'); assert.equal(m.type, 'template'); assert.equal(m.body, 'Hello Sam, your viewing is at 5pm.');
    assert.deepEqual(fake.tpl[0], { appkey: 'APPKEY12345', authkey: 'AUTHKEY12345', to: '447700900555', template: 'viewing_reminder', language: 'en', params: ['Sam', '5pm'] });
    assert.ok(db.get('SELECT 1 FROM wa_threads WHERE wa_id=?', '447700900555'));
    // the window stays closed after a template, so a free-text reply is still refused
    await assert.rejects(() => W.sendReply(u, m.thread_id, 'hi'), /24-hour reply window is closed/);
    // a failing first send leaves no empty conversation behind
    fake.fail = 'Template unavailable';
    await assert.rejects(() => W.sendTemplateMessage(u, { number: '447700900666', template: 'viewing_reminder', values: ['A', 'B'], consent: true }), /did not accept this template/);
    fake.fail = null;
    assert.equal(db.get('SELECT 1 FROM wa_threads WHERE wa_id=?', '447700900666'), undefined);
    // opted-out numbers are blocked
    db.run("INSERT INTO wa_optouts(wa_id,reason,source,created_at) VALUES('447700900777','stop','customer_message',datetime('now'))");
    await assert.rejects(() => W.sendTemplateMessage(u, { number: '447700900777', template: 'viewing_reminder', values: ['A', 'B'], consent: true }), /asked not to be messaged/);
  });
});
