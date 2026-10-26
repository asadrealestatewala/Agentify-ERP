// Tenant e-mail: allowances and ledger, sender domains, queue worker, webhooks, consent/unsubscribe, reply detection and
// activation. A fake provider stands in for Resend: nothing here touches the network or a real mailbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-email-'));
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

const L = await import('../src/services/emailLimits.js');
const { createApp } = await import('../src/index.js');
const P = await import('../src/platform.js');
const E = await import('../src/services/tenantEmail.js');
const S = await import('../src/services/emailSenders.js');
const C = await import('../src/services/emailConsent.js');
const In = await import('../src/services/emailInbound.js');
const A = await import('../src/services/activation.js');
const { setEmailProvider } = await import('../src/services/emailProvider.js');
const { savePlan } = await import('../src/services/plansStore.js');
const { outbox } = await import('../src/services/mailer.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const db = await import('../src/db.js');

let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); db.closeDbs(); });

// ---- fake provider
const fake = {
  name: 'fake', sent: [], keys: new Set(), mode: [], domains: new Map(), received: {},
  async send(msg, { idempotencyKey }) {
    const m = fake.mode.shift() || 'ok';
    if (m === 'rate') throw Object.assign(new Error('slow down'), { kind: 'rate_limited', retryAfterSec: 30 });
    if (m === 'definitive') throw Object.assign(new Error('invalid'), { kind: 'definitive' });
    if (m === 'transient') throw Object.assign(new Error('503'), { kind: 'transient' });
    const dup = fake.keys.has(idempotencyKey);
    fake.keys.add(idempotencyKey);
    if (!dup) fake.sent.push({ ...msg, key: idempotencyKey });
    if (m === 'ambiguous') throw Object.assign(new Error('timeout'), { kind: 'ambiguous' });
    return { id: `re_${idempotencyKey.slice(-10)}` };
  },
  async findSent({ to, subject }) { const hit = fake.sent.find((s) => s.to === to && s.subject === subject); return hit ? { id: `re_${hit.key.slice(-10)}` } : null; },
  async createDomain(name) { const id = `dom_${name}`; fake.domains.set(id, { id, name, status: 'not_started', records: [{ record: 'SPF', type: 'TXT', name: 'send', value: 'v=spf1', status: 'not_started' }] }); return fake.domains.get(id); },
  async getDomain(id) { return fake.domains.get(id); },
  async verifyDomain(id) { const d = fake.domains.get(id); if (fake.dnsReady) { d.status = 'verified'; d.records.forEach((r) => { r.status = 'verified'; }); } return {}; },
  async removeDomain() { return {}; },
  async getUsage() { return { emails: { monthly: { used: 5, limit: 3000 } } }; },
  async getReceived(id) { return fake.received[id]; },
};
setEmailProvider(fake);

let n = 0;
const mkTenant = (over = {}) => {
  n += 1;
  const t = P.createTenant({ slug: `acme${n}`, name: `Acme ${n}`, adminName: 'Owner Person', adminEmail: `owner${n}@acme${n}.test`, adminPassword: 'Tenant@12345', ...over });
  return P.getTenant(t.id);
};
const tenantFresh = (t) => P.getTenant(t.id);
const setLimits = (limits) => savePlan('growth', { email_limits: limits }, 'test');
const readyTenant = async (t, domain = `mail${t.id}.example.com`) => {
  fake.dnsReady = true;
  const d = await S.submitDomain(t, domain, 'test');
  await S.checkDomain(t, d.id);
  const sid = S.addSender(t, { domain_id: d.id, local_part: 'hello', display_name: 'Acme Homes' }, 'test');
  return { domain: d, sid };
};
const as = (t, fn) => P.withTenant(t, fn);
const send = (t, o = {}) => as(t, () => E.enqueue({ tenant: tenantFresh(t), category: 'operational', to: o.to || 'cust@x.test', subject: 'Hi', text: 'hello', ...o }));
const clearQueue = () => E.pdb().exec('DELETE FROM email_queue');
const row = (id) => E.pdb().prepare('SELECT * FROM email_queue WHERE id=?').get(id);

test('limits: validation, merge order, periods and thresholds', () => {
  assert.throws(() => L.cleanEmailLimits({ marketing: { monthly: 10, daily: 20 } }), /daily limit cannot exceed/);
  assert.throws(() => L.cleanEmailLimits({ marketing: { monthly: -1 } }));
  assert.deepEqual(L.cleanEmailLimits({ marketing: { monthly: 100 }, thresholds: [90, 70, 100, 70] }).thresholds, [70, 90, 100]);
  const m = L.resolveLimits({ marketing: { monthly: 5, daily: null } }, { marketing: { monthly: 9, daily: 2 } }, { hard_stop: false });
  assert.equal(m.marketing.monthly, 9); assert.equal(m.hard_stop, false);
  // 31 January anchor: February period starts on the 28th (clipped), never skips a month
  assert.equal(L.periodFor('2026-01-31', Date.parse('2026-02-27T12:00:00Z')).start, '2026-01-31');
  assert.equal(L.periodFor('2026-01-31', Date.parse('2026-02-28T00:00:00Z')).start, '2026-02-28');
  assert.equal(L.periodFor('2026-01-31', Date.parse('2026-03-30T23:59:59Z')).start, '2026-02-28');
  assert.equal(L.periodFor('2026-01-31', Date.parse('2026-03-31T00:00:00Z')).start, '2026-03-31');
  assert.equal(L.periodFor('2026-01-15', Date.parse('2027-01-14T00:00:00Z')).end, '2027-01-15');
  assert.deepEqual(L.reachedThresholds(7, 10), [70]);
  assert.deepEqual(L.reachedThresholds(10, 10), [70, 90, 100]);
});

test('migration: an older plans table gains email_limits and tenants gain email_prefs', () => {
  const pdb = P.platformDb();
  pdb.exec('ALTER TABLE plans DROP COLUMN email_limits');
  pdb.exec('ALTER TABLE tenants DROP COLUMN email_prefs');
  P.closePlatformDb();
  const pdb2 = P.platformDb();
  assert.ok(pdb2.prepare('PRAGMA table_info(plans)').all().some((c) => c.name === 'email_limits'));
  assert.ok(pdb2.prepare('PRAGMA table_info(tenants)').all().some((c) => c.name === 'email_prefs'));
});

test('sender domains: a domain already at the provider is adopted when pending and refused when already verified', async () => {
  const t = mkTenant();
  fake.domains.set('dom_old', { id: 'dom_old', name: 'earlier-added.com', status: 'pending', records: [{ record: 'SPF', type: 'TXT', name: 'send', value: 'v=spf1', status: 'not_started' }] });
  fake.domains.set('dom_ver', { id: 'dom_ver', name: 'proven-elsewhere.com', status: 'verified', records: [] });
  fake.listDomains = async () => ({ data: [...fake.domains.values()] });
  try {
    const before = fake.domains.size;
    const d = await S.submitDomain(t, 'Earlier-Added.com', 'test');
    assert.equal(d.status, 'pending'); assert.equal(fake.domains.size, before, 'no second domain created at the provider');
    await assert.rejects(() => S.submitDomain(t, 'proven-elsewhere.com', 'test'), /Ask Agentify support/);
  } finally { delete fake.listDomains; }
});

test('sender domains: only verified, tenant-owned senders can send', async () => {
  const a = mkTenant(), b = mkTenant();
  setLimits({ operational: { monthly: 100 }, marketing: { monthly: 100 } });
  fake.dnsReady = false;
  assert.throws(() => S.normalizeSendingDomain('gmail.com'), /Free mailbox/);
  assert.throws(() => S.normalizeSendingDomain('foo.erp.test'), /belong to the platform/);
  const d = await S.submitDomain(a, 'Acme-Homes.com', 'test');
  assert.equal(d.status, 'pending'); assert.ok(d.records.length);
  await assert.rejects(() => S.submitDomain(b, 'acme-homes.com', 'test'), /another workspace/);
  const sid = S.addSender(a, { domain_id: d.id, local_part: 'hello', display_name: 'Acme' }, 'test');
  assert.throws(() => send(a, { senderId: sid }), /verified sender/);
  const pending = await S.checkDomain(a, d.id);
  assert.match(pending.error, /DNS is not ready/);
  fake.dnsReady = true;
  assert.equal((await S.checkDomain(a, d.id)).status, 'verified');
  assert.ok(send(a, { senderId: sid }).id);
  // b cannot use a's sender or manage a's domain
  assert.throws(() => send(b, { senderId: sid }), /verified sender/);
  await assert.rejects(() => S.checkDomain(b, d.id), /not found/);
  assert.throws(() => S.addSender(b, { domain_id: d.id, local_part: 'x' }, 't'), /one of your sending domains/);
  assert.throws(() => S.addSender(a, { domain_id: d.id, local_part: 'x', display_name: 'Bad <name>' }, 't'), /plain text/);
});

test('quota: concurrent reservations never exceed the allowance; duplicates are not charged twice', async () => {
  setLimits({ operational: { monthly: 5 }, marketing: { monthly: 5 } });
  const t = mkTenant(); await readyTenant(t);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => Promise.resolve().then(() => { try { return send(t, { idemKey: `k${i}`, to: `u${i}@x.test` }); } catch (e) { return { err: e.code }; } })));
  assert.equal(results.filter((r) => r.id).length, 5);
  assert.ok(results.filter((r) => r.err).every((r) => r.err === 'quota_exhausted'));
  const again = send.bind(null, t);
  assert.throws(() => again({ idemKey: 'new', to: 'z@x.test' }), (e) => e.code === 'quota_exhausted');
  const dup = again({ idemKey: 'k0', to: 'u0@x.test' });
  assert.equal(dup.duplicate, true);
  const s = E.allowanceSummary(tenantFresh(t));
  assert.equal(s.categories.operational.used, 5); assert.equal(s.categories.operational.remaining, 0); assert.equal(s.categories.operational.state, 'exhausted');
  // a top-up adds capacity for this period only
  E.grantTopup(t.id, 'operational', 2, 'goodwill', 'admin');
  assert.ok(again({ idemKey: 'after-topup', to: 'q@x.test' }).id);
});

test('quota: daily limit, not-configured, soft mode and service mail never blocked', async () => {
  setLimits({ operational: { monthly: 100, daily: 2 }, marketing: null });
  const t = mkTenant(); await readyTenant(t);
  send(t, { idemKey: 'd1' }); send(t, { idemKey: 'd2' });
  assert.throws(() => send(t, { idemKey: 'd3' }), (e) => e.code === 'daily_limit');
  // marketing has no allowance configured -> paused with an explanation, nothing reserved
  as(t, () => C.recordConsent({ email: 'm@x.test', status: 'granted', source: 'test' }));
  assert.throws(() => send(t, { category: 'marketing', to: 'm@x.test', idemKey: 'm1' }), (e) => e.code === 'not_configured');
  assert.equal(E.allowanceSummary(tenantFresh(t)).categories.marketing.state, 'not_configured');
  // platform service mail still goes out
  const before = outbox.length;
  const { sendMail } = await import('../src/services/mailer.js');
  await sendMail({ to: 'o@x.test', subject: 'Reset your password', text: 'x', type: 'password_reset' });
  assert.equal(outbox.length, before + 1);
  setLimits({ operational: { monthly: 1 }, marketing: { monthly: 1 }, hard_stop: false });
  const t2 = mkTenant(); await readyTenant(t2);
  send(t2, { idemKey: 's1' }); assert.ok(send(t2, { idemKey: 's2' }).id, 'soft mode allows overage');
});

test('quota: plan change and period boundaries do not reset consumed usage', async () => {
  setLimits({ operational: { monthly: 5 }, marketing: { monthly: 5 } });
  const t = mkTenant(); await readyTenant(t);
  P.platformDb().prepare("UPDATE tenants SET created_at='2026-01-31 10:00:00' WHERE id=?").run(t.id);
  const feb = Date.parse('2026-02-10T10:00:00Z'), mar = Date.parse('2026-03-02T10:00:00Z');
  for (let i = 0; i < 3; i++) as(t, () => E.enqueue({ tenant: tenantFresh(t), category: 'operational', to: `a${i}@x.test`, subject: 's', text: 't', idemKey: `p${i}`, nowMs: feb }));
  // upgrade: raise the plan allowance in the same period -> remaining grows, used stays
  setLimits({ operational: { monthly: 10 }, marketing: { monthly: 5 } });
  let s = E.allowanceSummary(tenantFresh(t), feb);
  assert.equal(s.categories.operational.used, 3); assert.equal(s.categories.operational.remaining, 7);
  // downgrade below what is used: blocked, nothing refunded or reset
  setLimits({ operational: { monthly: 2 }, marketing: { monthly: 5 } });
  s = E.allowanceSummary(tenantFresh(t), feb);
  assert.equal(s.categories.operational.used, 3); assert.equal(s.categories.operational.state, 'exhausted');
  // the next period (28 Feb anchor clipped -> still Feb 28..Mar 31) starts fresh only when it really rolls over
  assert.equal(E.allowanceSummary(tenantFresh(t), mar).categories.operational.used, 0);
  assert.equal(E.allowanceSummary(tenantFresh(t), Date.parse('2026-02-27T23:59:59Z')).categories.operational.used, 3);
  // switching to an annual subscription keeps the same anchor
  P.platformDb().prepare("UPDATE tenants SET billing_interval='year', subscription_status='active', plan='growth' WHERE id=?").run(t.id);
  assert.equal(E.allowanceSummary(tenantFresh(t), feb).period.start, '2026-01-31');
  setLimits({ operational: { monthly: 100, daily: null }, marketing: { monthly: 100 } });
});

test('worker: sends, commits quota, releases on definitive failure, retries transient errors with backoff', async () => {
  setLimits({ operational: { monthly: 50 }, marketing: { monthly: 50 } });
  E.resetWorkerState(); clearQueue();
  const t = mkTenant(); await readyTenant(t);
  const ok = send(t, { idemKey: 'w1', to: 'ok@x.test' }), bad = send(t, { idemKey: 'w2', to: 'bad@x.test' }), flaky = send(t, { idemKey: 'w3', to: 'flaky@x.test' });
  fake.mode = ['ok', 'definitive', 'transient'];
  await E.runEmailQueue();
  assert.equal(row(ok.id).status, 'accepted'); assert.equal(row(ok.id).quota_state, 'committed'); assert.equal(row(ok.id).html_body, null);
  assert.equal(row(bad.id).status, 'failed'); assert.equal(row(bad.id).quota_state, 'released');
  assert.equal(row(flaky.id).status, 'queued'); assert.equal(row(flaky.id).attempts, 1); assert.equal(row(flaky.id).quota_state, 'reserved');
  assert.equal(E.allowanceSummary(tenantFresh(t)).categories.operational.used, 2, 'released quota is free again');
  await E.runEmailQueue({ nowMs: Date.now() + 2 * 60_000 });
  assert.equal(row(flaky.id).status, 'accepted');
});

test('worker: ambiguous timeout is reconciled before any retry; no duplicate send, no double charge', async () => {
  E.resetWorkerState(); clearQueue(); fake.sent.length = 0; fake.keys.clear();
  const t = mkTenant(); await readyTenant(t);
  const m = send(t, { idemKey: 'amb1', to: 'amb@x.test', subject: 'Unique ambiguous subject' });
  fake.mode = ['ambiguous'];
  await E.runEmailQueue();
  assert.equal(row(m.id).status, 'ambiguous'); assert.equal(row(m.id).quota_state, 'reserved');
  await E.runEmailQueue({ nowMs: Date.now() + 3 * 60_000 });
  assert.equal(row(m.id).status, 'accepted'); assert.equal(row(m.id).quota_state, 'committed');
  assert.equal(fake.sent.filter((s) => s.to === 'amb@x.test').length, 1, 'exactly one copy reached the provider');
  assert.equal(E.allowanceSummary(tenantFresh(t)).categories.operational.used, 1);
});

test('worker: provider rate limit pauses all sending; tenants are served fairly', async () => {
  E.resetWorkerState(); clearQueue(); fake.sent.length = 0; fake.keys.clear();
  const big = mkTenant(), small = mkTenant(); await readyTenant(big); await readyTenant(small);
  for (let i = 0; i < 30; i++) send(big, { idemKey: `b${i}`, to: `b${i}@x.test` });
  const s1 = send(small, { idemKey: 's1', to: 's1@x.test' });
  await E.runEmailQueue({ perTenant: 5, max: 8 });
  assert.equal(row(s1.id).status, 'accepted', 'a small workspace is not starved behind a big one');
  assert.equal(E.pdb().prepare("SELECT COUNT(*) n FROM email_queue WHERE tenant_id=? AND status='accepted'").get(big.id).n, 5);
  fake.mode = ['rate'];
  const r = await E.runEmailQueue();
  const again = await E.runEmailQueue();
  assert.equal(again.paused, true);
  E.resetWorkerState();
});

test('consent: marketing needs consent; unsubscribe while queued stops the send and frees quota; other workspaces unaffected', async () => {
  E.resetWorkerState(); clearQueue(); fake.sent.length = 0; fake.keys.clear();
  const a = mkTenant(), b = mkTenant(); await readyTenant(a); await readyTenant(b);
  assert.throws(() => send(a, { category: 'marketing', to: 'p@x.test', idemKey: 'c0' }), (e) => e.code === 'no_consent');
  for (const t of [a, b]) as(t, () => C.recordConsent({ email: 'p@x.test', status: 'granted', source: 'web_form', text: 'I agree' }));
  const qa = send(a, { category: 'marketing', to: 'p@x.test', idemKey: 'c1', heading: 'Hello', lines: ['Offer'], text: undefined, subject: 'Offer' });
  const qb = send(b, { category: 'marketing', to: 'p@x.test', idemKey: 'c1', heading: 'Hello', lines: ['Offer'], text: undefined, subject: 'Offer' });
  const full = row(qa.id);
  assert.match(full.html_body, /Unsubscribe/); assert.match(full.headers, /List-Unsubscribe-Post/);
  // the unsubscribe link arrives through the public endpoint of workspace a
  const token = as(a, () => C.unsubscribeToken('p@x.test'));
  const host = `${a.slug}.erp.test`;
  const post = await new Promise((resolve) => { const rq = http.request({ host: '127.0.0.1', port, path: `/api/unsubscribe/${token}`, method: 'POST', headers: { Host: host, 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); rq.end('List-Unsubscribe=One-Click'); });
  assert.equal(post, 200);
  assert.equal(row(qa.id).status, 'suppressed'); assert.equal(row(qa.id).quota_state, 'released');
  await E.runEmailQueue();
  assert.equal(row(qb.id).status, 'accepted', 'workspace b still holds its own consent');
  assert.equal(fake.sent.filter((s) => s.to === 'p@x.test').length, 1);
  assert.throws(() => send(a, { category: 'marketing', to: 'p@x.test', idemKey: 'c2' }), (e) => e.code === 'opted_out');
  // a token issued for a cannot unsubscribe anyone on b
  const cross = await new Promise((resolve) => { const rq = http.request({ host: '127.0.0.1', port, path: `/api/unsubscribe/${token}`, method: 'POST', headers: { Host: `${b.slug}.erp.test`, 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); rq.end(''); });
  assert.equal(cross, 400);
  // consent evidence is kept
  const ev = as(a, () => db.all('SELECT status, source FROM email_consents WHERE email_lc=? ORDER BY id', 'p@x.test'));
  assert.deepEqual(ev.map((e) => e.status), ['granted', 'withdrawn']);
  // importing a contact does not create consent
  as(a, () => db.run("INSERT INTO contacts(full_name,email,created_at) VALUES('Imported','imp@x.test',datetime('now'))"));
  assert.throws(() => send(a, { category: 'marketing', to: 'imp@x.test', idemKey: 'c3' }), (e) => e.code === 'no_consent');
});

test('webhooks: workspace comes from our record; duplicates and out-of-order events; bounce suppresses only that workspace', async () => {
  E.resetWorkerState();
  const a = mkTenant(), b = mkTenant(); await readyTenant(a); await readyTenant(b);
  const qa = send(a, { idemKey: 'e1', to: 'bounce@x.test' }); send(b, { idemKey: 'e1', to: 'bounce@x.test' });
  await E.runEmailQueue();
  const pid = row(qa.id).provider_id;
  // delivered arrives, then an older "sent" is replayed: status does not go backwards
  E.applyProviderEvent(pid, 'email.delivered', '2026-01-01T10:00:02Z');
  E.applyProviderEvent(pid, 'email.sent', '2026-01-01T10:00:01Z');
  E.applyProviderEvent(pid, 'email.delivered', '2026-01-01T10:00:02Z');
  assert.equal(row(qa.id).status, 'delivered');
  assert.equal(JSON.parse(row(qa.id).events).filter((e) => e.type === 'email.delivered').length, 1);
  // an event for a message we have not recorded yet is parked, then applied once the id is known
  E.applyProviderEvent('re_future', 'email.delivered', '2026-01-01T10:00:09Z');
  assert.equal(E.pdb().prepare("SELECT COUNT(*) n FROM email_unmatched_events WHERE provider_id='re_future'").get().n, 1);
  // a hard bounce suppresses the address in workspace a only; the message stays charged
  E.applyProviderEvent(pid, 'email.bounced', '2026-01-01T10:00:05Z', { bounce_type: 'Permanent' });
  assert.equal(row(qa.id).status, 'bounced'); assert.equal(row(qa.id).quota_state, 'committed');
  assert.equal(as(a, () => C.eligibility('bounce@x.test', 'operational').ok), false);
  assert.equal(as(b, () => C.eligibility('bounce@x.test', 'operational').ok), true);
  // a transient (soft) bounce does not suppress
  const q2 = send(a, { idemKey: 'e2', to: 'soft@x.test' }); await E.runEmailQueue();
  E.applyProviderEvent(row(q2.id).provider_id, 'email.bounced', '2026-01-01T11:00:00Z', { bounce_type: 'Transient' });
  assert.equal(as(a, () => C.eligibility('soft@x.test', 'operational').ok), true);
  // a complaint withdraws marketing but not operational mail
  as(a, () => C.recordConsent({ email: 'cmp@x.test', status: 'granted', source: 'test' }));
  const q3 = send(a, { category: 'marketing', idemKey: 'e3', to: 'cmp@x.test', subject: 'M', text: 'm' }); await E.runEmailQueue();
  E.applyProviderEvent(row(q3.id).provider_id, 'email.complained', '2026-01-01T12:00:00Z');
  assert.equal(as(a, () => C.eligibility('cmp@x.test', 'marketing').ok), false);
  assert.equal(as(a, () => C.eligibility('cmp@x.test', 'operational').ok), true);
});

const sign = (secret, id, ts, body) => `v1,${crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')}`;
test('webhook endpoint: signature required, duplicate event ids ignored', async () => {
  const secret = `whsec_${crypto.randomBytes(24).toString('base64')}`;
  setSetting('resend_webhook_secret', secret, { secret: true });
  E.resetWorkerState();
  const t = mkTenant(); await readyTenant(t);
  const q = send(t, { idemKey: 'h1', to: 'hook@x.test' }); await E.runEmailQueue();
  const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-02-01T00:00:00Z', data: { email_id: row(q.id).provider_id } });
  const post = (headers) => new Promise((resolve) => { const rq = http.request({ host: '127.0.0.1', port, path: '/api/platform/webhooks/resend', method: 'POST', headers: { Host: 'erp.test', 'Content-Type': 'application/json', ...headers } }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d || '{}') })); }); rq.end(body); });
  const ts = String(Math.floor(Date.now() / 1000));
  assert.equal((await post({ 'svix-id': 'm1', 'svix-timestamp': ts, 'svix-signature': 'v1,AAAA' })).status, 401);
  const good = { 'svix-id': 'evt_1', 'svix-timestamp': ts, 'svix-signature': sign(secret, 'evt_1', ts, body) };
  assert.equal((await post(good)).status, 200);
  assert.equal(row(q.id).status, 'delivered');
  assert.equal((await post(good)).data.duplicate, true);
});

test('provider capacity: marketing yields to service mail', async () => {
  E.resetWorkerState();
  setSetting('email_provider_limits', JSON.stringify({ daily: 1000, monthly: 100000, reserve_for_service: 995 }));
  const t = mkTenant(); await readyTenant(t);
  as(t, () => C.recordConsent({ email: 'cap@x.test', status: 'granted', source: 'test' }));
  const m = send(t, { category: 'marketing', idemKey: 'cap1', to: 'cap@x.test' });
  const o = send(t, { idemKey: 'cap2', to: 'cap2@x.test' });
  await E.runEmailQueue();
  assert.equal(row(m.id).status, 'queued'); assert.match(row(m.id).last_error, /provider_capacity/);
  assert.equal(row(o.id).status, 'accepted');
  setSetting('email_provider_limits', '');
});

test('paused states: suspended or expired workspaces cannot send; queued mail is stopped and quota released', async () => {
  E.resetWorkerState();
  const t = mkTenant(); await readyTenant(t);
  const q = send(t, { idemKey: 'x1' });
  P.platformDb().prepare("UPDATE tenants SET subscription_status='expired' WHERE id=?").run(t.id);
  assert.throws(() => send(t, { idemKey: 'x2' }), (e) => e.code === 'paused');
  await E.runEmailQueue();
  assert.equal(row(q.id).status, 'cancelled'); assert.equal(row(q.id).quota_state, 'released');
  assert.match(E.allowanceSummary(tenantFresh(t)).categories.operational.message, /subscription is not active/);
});

test('reply detection: signed address, sender check, auto-replies ignored, duplicates ignored', async () => {
  E.resetWorkerState();
  setSetting('inbound_reply_domain', 'reply.erp.test');
  const t = mkTenant(); await readyTenant(t);
  const seen = []; In.onReply((r) => seen.push(r));
  const q = send(t, { idemKey: 'r1', to: 'lead@x.test', trackReplies: true, refKind: 'test_seq', refId: '9' });
  assert.equal(q.reply_tracked, true);
  const addr = row(q.id).reply_to;
  assert.match(addr, /^reply\+\d+\.[\w-]{12}@reply\.erp\.test$/);
  assert.equal(In.parseReplyAddress(addr.replace(/\.[\w-]{12}@/, '.AAAAAAAAAAAA@')), null, 'forged token rejected');
  fake.received = {
    m_auto: { from: 'lead@x.test', subject: 'Automatic reply: away', headers: { 'Auto-Submitted': 'auto-replied' } },
    m_other: { from: 'stranger@y.test', subject: 'Re: hi', headers: {} },
    m_real: { from: 'Lead <lead@x.test>', subject: 'Re: hi', headers: {} },
  };
  assert.equal((await In.handleInbound('m_auto', { to: [addr] })).kind, 'auto');
  assert.equal((await In.handleInbound('m_other', { to: [addr] })).kind, 'unmatched_sender');
  assert.equal(seen.length, 0);
  assert.equal((await In.handleInbound('m_real', { to: [addr] })).kind, 'reply');
  assert.equal((await In.handleInbound('m_real', { to: [addr] })).duplicate, true);
  assert.equal(seen.length, 1); assert.equal(seen[0].tenant.id, t.id); assert.equal(seen[0].row.ref_id, '9');
  assert.equal((await In.handleInbound('m_x', { to: ['someone@else.test'] })).handled, false);
  setSetting('inbound_reply_domain', '');
});

test('activation: steps come from real data, persist, and onboarding mail respects skips, window, cap and opt-out', async () => {
  const t = mkTenant();
  const st0 = as(t, () => A.activationStatus(t));
  assert.equal(st0.steps.find((s) => s.id === 'first_lead').done, false);
  assert.equal(st0.steps.find((s) => s.id === 'activate_sequence').applicable === false || st0.steps.find((s) => s.id === 'activate_sequence').applicable === true, true);
  as(t, () => db.run("INSERT INTO contacts(full_name,phone,created_at) VALUES('Real Lead','+923001234567',datetime('now'))"));
  as(t, () => db.run("INSERT INTO tasks(entity_type,entity_id,title,due_date,created_at) VALUES('contact',1,'Follow up','2026-12-01',datetime('now'))"));
  const st1 = as(t, () => A.activationStatus(t));
  assert.equal(st1.steps.find((s) => s.id === 'first_lead').done, true);
  assert.equal(st1.steps.find((s) => s.id === 'first_followup').done, true);
  // persistence: deleting the lead later does not un-complete the step
  as(t, () => db.run('DELETE FROM contacts'));
  assert.equal(as(t, () => A.activationStatus(t)).steps.find((s) => s.id === 'first_lead').done, true);
  // pure planner
  const cfg = A.onboardingConfig();
  const created = Date.parse('2026-03-01T00:00:00Z');
  const base = { tenant: { created_at: '2026-03-01 00:00:00', timezone: 'Asia/Karachi', subscription_status: 'trialing', plan: 'trial' }, config: cfg, sent: new Set(['welcome']), recentCount: 0, ownerVerified: true };
  const open = { steps: [{ id: 'first_lead', applicable: true, done: false, label: 'x' }, { id: 'first_followup', applicable: true, done: false }, { id: 'activate_sequence', applicable: true, done: false }], done: 0, total: 3, next: { label: 'x', hint: 'h', link: '/' } };
  const day1 = created + 86400e3 + 5 * 3600e3 + 6 * 3600e3; // 05:00 UTC+1d = 10:00 Karachi... inside 9-18
  const at = (h) => Date.parse(`2026-03-02T${String(h).padStart(2, '0')}:00:00Z`);
  assert.equal(A.nextOnboardingMail({ ...base, nowMs: at(5), status: open }).kind, 'day1'); // 10:00 Karachi
  assert.equal(A.nextOnboardingMail({ ...base, nowMs: at(1), status: open }), null, '06:00 Karachi is outside sending hours');
  assert.equal(A.nextOnboardingMail({ ...base, nowMs: at(5), status: open, recentCount: 3 }), null, 'weekly cap');
  assert.equal(A.nextOnboardingMail({ ...base, nowMs: at(5), status: open, tenant: { ...base.tenant, email_prefs: '{"onboarding":false}' } }), null, 'owner opted out');
  const done = { ...open, steps: open.steps.map((s) => ({ ...s, done: true })), done: 3, next: null };
  const skipped = A.nextOnboardingMail({ ...base, nowMs: at(5), status: done });
  assert.equal(skipped.kind, null); assert.equal(skipped.skips[0].skip, 'nothing_to_do');
  // paid: conversion-style mails stop, activation states the actual package and ignores hours
  const paid = A.nextOnboardingMail({ ...base, tenant: { ...base.tenant, subscription_status: 'active', plan: 'growth' }, nowMs: at(1), status: open });
  assert.equal(paid.kind, 'paid_activation');
  // an overdue message is dropped, not sent late
  const late = A.nextOnboardingMail({ ...base, nowMs: Date.parse('2026-03-05T05:00:00Z'), status: open });
  assert.ok(late.skips.some((s) => s.ref === 'day1' && s.skip === 'stale'));
});

test('activation job sends one onboarding mail per workspace and never repeats it', async () => {
  const t = mkTenant();
  P.platformDb().prepare("UPDATE tenants SET created_at='2026-03-01 00:00:00' WHERE id=?").run(t.id);
  const nowMs = Date.parse('2026-03-02T05:00:00Z');
  const before = outbox.filter((m) => m.type === 'onboarding').length;
  const r1 = await A.runActivation({ nowMs });
  const mine = outbox.filter((m) => m.type === 'onboarding' && m.to === t.owner_email);
  assert.ok(r1.sent >= 1);
  assert.equal(mine.length, 1); assert.match(mine[0].subject, /verified|next setup step/);
  await A.runActivation({ nowMs });
  await A.runActivation({ nowMs });
  const subjects = outbox.filter((m) => m.type === 'onboarding' && m.to === t.owner_email).map((m) => m.subject);
  assert.equal(new Set(subjects).size, subjects.length, 'no mail is sent twice');
  assert.ok(subjects.length <= 2, 'one mail per pass, and day 1 only after the welcome');
  void before;
});

test('threshold warnings fire once per level and period', async () => {
  setLimits({ operational: { monthly: 10 }, marketing: { monthly: 10 } });
  const t = mkTenant(); await readyTenant(t);
  for (let i = 0; i < 7; i++) send(t, { idemKey: `th${i}`, to: `t${i}@x.test` });
  assert.deepEqual(E.warnThresholds(tenantFresh(t), 'operational'), [70]);
  assert.deepEqual(E.warnThresholds(tenantFresh(t), 'operational'), []);
  for (let i = 7; i < 10; i++) send(t, { idemKey: `th${i}`, to: `t${i}@x.test` });
  assert.deepEqual(E.warnThresholds(tenantFresh(t), 'operational'), [90, 100]);
});

test('tenant routes: staff see their own allowance; console summary hides tenant secrets; cross-tenant ids are refused', async () => {
  const t = mkTenant(); await readyTenant(t);
  const summary = E.platformSummary();
  assert.ok(summary.provider && summary.queue && summary.health);
  assert.ok(!JSON.stringify(summary).includes('resend_api_key'));
  const sync = await E.syncProviderUsage();
  assert.equal(sync.ok, true);
  assert.ok(E.platformSummary().provider.usage.at);
  assert.throws(() => E.grantTopup(t.id, 'service', 5, '', 'a'), /operational or marketing/);
  assert.throws(() => E.adminRelease(999999, 'a'), /not found/);
});

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const rq = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c));
    res.on('end', () => { const t = Buffer.concat(ch).toString(); let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  rq.on('error', reject); if (data) rq.write(data); rq.end();
});
test('HTTP: staff routes are workspace-scoped and authenticated; the console routes need an operator', async () => {
  const a = mkTenant(), b = mkTenant();
  const login = await call(`${a.slug}.erp.test`, 'POST', '/api/auth/login', { identifier: a.owner_email, password: 'Tenant@12345' });
  assert.equal(login.status, 200);
  const h = { cookie: login.cookie };
  assert.equal((await call(`${a.slug}.erp.test`, 'GET', '/api/email/overview', null, {})).status, 401);
  const ov = await call(`${a.slug}.erp.test`, 'GET', '/api/email/overview', null, h);
  assert.equal(ov.status, 200);
  assert.ok(ov.data.allowance && Array.isArray(ov.data.senders));
  assert.ok(!JSON.stringify(ov.data).match(/api_key|resend_|re_[A-Za-z0-9]{10}/));
  // the same cookie on another workspace does not work
  assert.equal((await call(`${b.slug}.erp.test`, 'GET', '/api/email/overview', null, h)).status, 401);
  // checklist and sender domain flow over HTTP
  fake.dnsReady = true;
  const d = await call(`${a.slug}.erp.test`, 'POST', '/api/email/domains', { domain: 'http-test-mail.com' }, h);
  assert.equal(d.status, 201);
  assert.equal((await call(`${a.slug}.erp.test`, 'POST', `/api/email/domains/${d.data.id}/check`, {}, h)).data.verified, true);
  assert.equal((await call(`${b.slug}.erp.test`, 'POST', `/api/email/domains/${d.data.id}/check`, {}, { cookie: (await call(`${b.slug}.erp.test`, 'POST', '/api/auth/login', { identifier: b.owner_email, password: 'Tenant@12345' })).cookie })).status, 404);
  const act = await call(`${a.slug}.erp.test`, 'GET', '/api/email/activation', null, h);
  assert.equal(act.status, 200); assert.ok(act.data.steps.length >= 6);
  assert.equal((await call('erp.test', 'GET', '/api/platform/admin/email/summary', null, {})).status, 401);
});
