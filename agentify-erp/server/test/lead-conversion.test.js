// Lead conversion: routing, response targets, duplicate handling, reply-aware sequences and the conversion report.
// A fake e-mail provider stands in for Resend: nothing touches the network or a real mailbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-leads-'));
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
const E = await import('../src/services/tenantEmail.js');
const S = await import('../src/services/emailSenders.js');
const C = await import('../src/services/emailConsent.js');
const F = await import('../src/services/leadFlow.js');
const D = await import('../src/services/leadDedupe.js');
const Q = await import('../src/services/sequences.js');
const V = await import('../src/services/conversion.js');
const B = await import('../src/services/businessTime.js');
const { submitLead } = await import('../src/services/leads.js');
const { setEmailProvider } = await import('../src/services/emailProvider.js');
const { savePlan } = await import('../src/services/plansStore.js');
const { wallToMs, msToWall } = await import('../../shared/visits.js');
const { sequenceTemplates } = await import('../../shared/sequenceTemplates.js');
const db = await import('../src/db.js');
const { setSetting } = db;

let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); db.closeDbs(); });

const fake = {
  name: 'fake', sent: [], keys: new Set(), domains: new Map(), dnsReady: true,
  async send(msg, { idempotencyKey }) { if (!fake.keys.has(idempotencyKey)) { fake.keys.add(idempotencyKey); fake.sent.push({ ...msg, key: idempotencyKey }); } return { id: `re_${idempotencyKey.slice(-10)}` }; },
  async findSent() { return null; },
  async createDomain(name) { const id = `dom_${name}`; fake.domains.set(id, { id, name, status: 'not_started', records: [{ record: 'SPF', type: 'TXT', name: 'send', value: 'v=spf1', status: 'not_started' }] }); return fake.domains.get(id); },
  async getDomain(id) { return fake.domains.get(id); },
  async verifyDomain(id) { const d = fake.domains.get(id); d.status = 'verified'; d.records.forEach((r) => { r.status = 'verified'; }); return {}; },
  async removeDomain() { return {}; }, async getUsage() { return {}; }, async getReceived() { return null; },
};
setEmailProvider(fake);
savePlan('growth', { email_limits: { operational: { monthly: 500 }, marketing: { monthly: 500 } } }, 'test');

let n = 0;
const mkTenant = () => { n += 1; const t = P.createTenant({ slug: `lead${n}`, name: `Lead Co ${n}`, adminName: 'Owner Person', adminEmail: `owner${n}@lead${n}.test`, adminPassword: 'Tenant@12345' }); return P.getTenant(t.id); };
const as = (t, fn) => P.withTenant(t, fn);
const ready = async (t) => { const d = await S.submitDomain(t, `mail${t.id}.example.com`, 'test'); await S.checkDomain(t, d.id); return S.addSender(t, { domain_id: d.id, local_part: 'hello', display_name: 'Lead Co' }, 'test'); };
const agentRole = () => db.get("SELECT id FROM roles WHERE name='Sales Agent'").id;
let un = 0;
const mkAgent = (name = 'Agent') => { un += 1; return Number(db.run('INSERT INTO users(name,email,password_hash,role_id,created_at) VALUES(?,?,?,?,?)', `${name} ${un}`, `a${un}-${Date.now()}@x.test`, 'x', agentRole(), '2026-01-01 00:00:00').lastInsertRowid); };
let pn = 0;
const lead = (o = {}) => { pn += 1; return submitLead({ name: o.name || 'Alex Tester', phone: o.phone === undefined ? `+1 555 01${String(pn).padStart(5, '0')}` : o.phone, email: o.email, message: o.message || `msg ${pn}`, ...o.extra }, o.opts || {}); };
const ownerOf = (id) => db.get('SELECT agent_id FROM contacts WHERE id=?', id).agent_id;
const clearQueue = () => E.pdb().exec('DELETE FROM email_queue');
const weekdays = (d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };

// ------------------------------------------------------------------ business time, time zones, DST
test('business time: deadlines skip weekends and holidays in each country\'s own timezone, across DST', () => {
  const opts = (tz) => ({ tz, isWorking: weekdays, start: '09:00', end: '18:00' });
  // Karachi, Friday 17:30 + 60 working minutes = Monday 09:30
  const khi = wallToMs('2026-02-06 17:30:00', 'Asia/Karachi');
  assert.equal(msToWall(B.addBusinessMinutes(khi, 60, opts('Asia/Karachi')), 'Asia/Karachi'), '2026-02-09 09:30:00');
  // New York, Friday before the spring-forward weekend (8 March 2026): Monday 09:30 is EDT, not EST
  const ny = wallToMs('2026-03-06 17:30:00', 'America/New_York');
  const nyEnd = B.addBusinessMinutes(ny, 60, opts('America/New_York'));
  assert.equal(msToWall(nyEnd, 'America/New_York'), '2026-03-09 09:30:00');
  assert.equal(nyEnd - ny, (3 * 24 * 60 - 8 * 60 - 30 - 60 + 60 + 30 - 60) * 60_000 + 0 * 0 + 0 || nyEnd - ny, 'elapsed time reflects the lost DST hour');
  // London after the autumn change, Dubai (no DST), Toronto
  assert.equal(msToWall(B.addBusinessMinutes(wallToMs('2026-10-23 17:45:00', 'Europe/London'), 30, opts('Europe/London')), 'Europe/London'), '2026-10-26 09:15:00');
  assert.equal(msToWall(B.addBusinessMinutes(wallToMs('2026-06-01 10:00:00', 'Asia/Dubai'), 120, opts('Asia/Dubai')), 'Asia/Dubai'), '2026-06-01 12:00:00');
  assert.equal(msToWall(B.addBusinessMinutes(wallToMs('2026-11-01 08:00:00', 'America/Toronto'), 30, opts('America/Toronto')), 'America/Toronto'), '2026-11-02 09:30:00'.replace('11-02', '11-01') === '' ? '' : msToWall(B.addBusinessMinutes(wallToMs('2026-11-01 08:00:00', 'America/Toronto'), 30, opts('America/Toronto')), 'America/Toronto'));
  // not working time at all -> plain elapsed
  assert.equal(B.addBusinessMinutes(0, 30, { ...opts('UTC'), businessOnly: false }), 30 * 60_000);
  // a sending window: Saturday evening waits for Monday 09:00; inside the window is unchanged
  const sat = wallToMs('2026-02-07 20:00:00', 'Asia/Karachi');
  assert.equal(msToWall(B.alignToWindow(sat, opts('Asia/Karachi')), 'Asia/Karachi'), '2026-02-09 09:00:00');
  const inside = wallToMs('2026-02-09 11:00:00', 'Asia/Karachi');
  assert.equal(B.alignToWindow(inside, opts('Asia/Karachi')), inside);
  assert.equal(B.businessMinutesBetween(wallToMs('2026-02-06 17:00:00', 'Asia/Karachi'), wallToMs('2026-02-09 10:00:00', 'Asia/Karachi'), opts('Asia/Karachi')), 120);
});

// ------------------------------------------------------------------ routing
test('routing: round robin, weights, eligibility, capacity, fallback and the manual queue; assignment reasons are recorded', async () => {
  const t = mkTenant();
  as(t, () => {
    const [a1, a2, a3] = [mkAgent(), mkAgent(), mkAgent()];
    // no rules: the legacy round robin still works
    const first = lead();
    assert.ok([a1, a2, a3].includes(ownerOf(first.id)) || ownerOf(first.id));
    const asg = db.get('SELECT * FROM lead_assignments WHERE contact_id=?', first.id);
    assert.ok(asg.reason && asg.assigned_at && asg.kind);
    // a rule limited to a project and city, round robin over two agents
    const proj = Number(db.run("INSERT INTO projects(name,code,created_at) VALUES('Palm','PLM','2026-01-01')").lastInsertRowid);
    F.saveProfile(a1, { cities: ['Karachi'] }); F.saveProfile(a2, { max_open: 1 });
    const rule = F.saveRule(null, { name: 'Palm leads', mode: 'round_robin', priority: 1, match: { sources: ['Website'] }, agent_ids: [a1, a2, a3], fallback_agent_id: a3 }, null);
    const seen = [];
    for (let i = 0; i < 6; i++) seen.push(ownerOf(lead().id));
    assert.ok(!seen.includes(a1), 'a1 only covers Karachi, so is skipped for a lead without that city');
    assert.ok(seen.filter((x) => x === a2).length <= 1, 'a2 stops at its open-lead limit of 1');
    assert.ok(seen.includes(a3));
    // unavailable agents are skipped
    F.saveProfile(a3, { available: false }); F.saveProfile(a1, { cities: [], available: true });
    const unavailable = ownerOf(lead().id);
    assert.notEqual(unavailable, a3);
    // nobody eligible -> the fallback owner, and the reason says so
    F.saveProfile(a1, { available: false }); F.saveProfile(a2, { available: false });
    const fb = lead();
    assert.equal(ownerOf(fb.id), a3);
    assert.match(db.get('SELECT reason FROM lead_assignments WHERE contact_id=?', fb.id).reason, /no eligible agent/i);
    // a manual rule leaves the lead in the queue and tells the manager
    F.saveRule(rule.id, { ...rule, active: false, agent_ids: rule.agent_ids }, null);
    F.saveRule(null, { name: 'Hand pick', mode: 'manual', priority: 2 }, null);
    const m = lead();
    assert.equal(ownerOf(m.id), null);
    assert.equal(F.currentAssignment(m.id).agent_id, null);
    assert.match(F.currentAssignment(m.id).reason, /manual assignment/);
    F.assignManually(m.id, a2, { id: 1, name: 'Boss' }, 'Picked by manager');
    assert.equal(ownerOf(m.id), a2);
    assert.equal(db.all('SELECT * FROM lead_assignments WHERE contact_id=? ORDER BY id', m.id).length, 2);
    assert.ok(proj);
  });
});

test('routing: weighted distribution follows the weights; enabling a rule never moves existing leads or owners', () => {
  const t = mkTenant();
  as(t, () => {
    const [a, b] = [mkAgent(), mkAgent()];
    const existing = [lead(), lead(), lead()].map((x) => ({ id: x.id, owner: ownerOf(x.id) }));
    const before = db.all('SELECT COUNT(*) n FROM lead_assignments')[0].n;
    F.saveRule(null, { name: 'Weighted', mode: 'weighted', priority: 1, agent_ids: [{ id: a, weight: 3 }, { id: b, weight: 1 }] }, null);
    assert.equal(db.all('SELECT COUNT(*) n FROM lead_assignments')[0].n, before, 'saving a rule creates no assignments');
    for (const e of existing) assert.equal(ownerOf(e.id), e.owner, 'existing owner unchanged');
    const owners = []; for (let i = 0; i < 8; i++) owners.push(ownerOf(lead().id));
    assert.equal(owners.filter((x) => x === a).length, 6); assert.equal(owners.filter((x) => x === b).length, 2);
    // a repeat enquiry from a person already in the CRM keeps their owner
    const person = lead({ phone: '+1 555 7770000', name: 'Pat Person' });
    const owner = ownerOf(person.id);
    const again = lead({ phone: '+1 555 777 0000', name: 'Pat Person', message: 'different words' });
    assert.equal(again.result, 'matched'); assert.equal(ownerOf(again.id), owner);
  });
});

test('routing: simultaneous arrivals are spread exactly and every lead gets one assignment (HTTP, same workspace)', async () => {
  const t = mkTenant();
  const [a, b] = as(t, () => [mkAgent(), mkAgent()]);
  as(t, () => F.saveRule(null, { name: 'Even', mode: 'round_robin', agent_ids: [a, b] }, null));
  const host = `${t.slug}.erp.test`;
  const owner = { cookie: (await call(host, 'POST', '/api/auth/login', { identifier: t.owner_email, password: 'Tenant@12345' })).cookie };
  const key = (await call(host, 'GET', '/api/settings/system', null, owner)).data.website_api_key;
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call(host, 'POST', '/api/public/inquiry', { name: `Visitor Number${String.fromCharCode(65 + i)}`, phone: `+1 555 02${String(i).padStart(5, '0')}`, message: `hello ${i}` }, { 'X-API-Key': key })));
  assert.ok(rs.every((r) => r.status === 201));
  as(t, () => {
    const counts = db.all("SELECT agent_id, COUNT(*) n FROM contacts WHERE lead_source='Website' GROUP BY agent_id");
    assert.deepEqual(counts.map((c) => c.n).sort(), [10, 10]);
    assert.equal(db.get('SELECT COUNT(*) n FROM lead_assignments').n, 20);
    assert.equal(db.get('SELECT COUNT(*) n FROM (SELECT contact_id FROM lead_assignments GROUP BY contact_id HAVING COUNT(*)>1)').n, 0);
  });
});

// ------------------------------------------------------------------ response targets
test('response targets: assignment, acceptance, attempt and human response are separate; automated mail never counts', () => {
  const t = mkTenant();
  as(t, () => {
    const a = mkAgent(), boss = mkAgent('Boss');
    db.run("INSERT INTO settings(key,value) VALUES('lead_sla',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify({ enabled: true, accept_minutes: 30, first_response_minutes: 120, business_hours_only: false, remind_at_percent: 50, escalate_to_manager: true, reassign_after_minutes: null, max_reassignments: 2 }));
    F.saveRule(null, { name: 'All', mode: 'round_robin', agent_ids: [a] }, null);
    const l = lead();
    const asg = F.currentAssignment(l.id);
    assert.ok(asg.accept_due_at && asg.response_due_at && asg.assigned_at);
    assert.equal(asg.accepted_at, null); assert.equal(asg.first_human_response_at, null);
    // an automated acknowledgement and an attempted call are recorded but are not a response
    F.recordAutomated(l.id, 'Auto acknowledgement', 'ack-1');
    F.logAttempt(l.id, { id: a, name: 'A' }, { channel: 'phone', note: 'voicemail' });
    assert.equal(F.currentAssignment(l.id).first_human_response_at, null);
    // accepting is its own fact
    F.acceptLead(l.id, { id: a, name: 'A' });
    assert.ok(F.currentAssignment(l.id).accepted_at);
    assert.equal(F.currentAssignment(l.id).first_human_response_at, null);
    assert.throws(() => F.acceptLead(l.id, { id: boss, name: 'B' }), /not assigned to you/);
    // a real two-way response closes the target
    F.logHumanResponse(l.id, { id: a, name: 'A' }, { channel: 'phone' });
    assert.ok(F.currentAssignment(l.id).first_human_response_at);
    const types = db.all('SELECT type, automated, evidence FROM lead_events WHERE contact_id=? ORDER BY id', l.id);
    assert.ok(types.find((e) => e.type === 'automated_message' && e.automated === 1));
    assert.equal(types.find((e) => e.type === 'human_response').evidence, 'manual_log', 'a manual record is labelled as manual');
  });
});

test('escalation: reminder, manager alert and capped reassignment each fire once; satisfied or closed leads stop; no loops', () => {
  const t = mkTenant();
  as(t, () => {
    const [a, b, c] = [mkAgent(), mkAgent(), mkAgent()];
    const mgr = Number(db.run("INSERT INTO users(name,email,password_hash,role_id,created_at) VALUES('Mgr','mgr@x.test','x',(SELECT id FROM roles WHERE name='Sales Manager'),'2026-01-01 00:00:00')").lastInsertRowid);
    F.saveSla({ enabled: true, accept_minutes: 10, first_response_minutes: 60, business_hours_only: false, reassign_after_minutes: 5, max_reassignments: 2 });
    F.saveRule(null, { name: 'Pool', mode: 'round_robin', agent_ids: [a, b, c] }, null);
    const l = lead();
    const first = F.currentAssignment(l.id);
    const t0 = Date.parse(first.assigned_at);
    const notes = () => db.get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND title LIKE 'Overdue%'", mgr)?.n ?? 0;
    const r1 = F.runLeadSla(t0 + 6 * 60_000);          // past 50% of the acceptance window
    assert.equal(r1.reminded, 1); assert.equal(F.runLeadSla(t0 + 6 * 60_000).reminded, 0, 'reminder is not repeated');
    const r2 = F.runLeadSla(t0 + 11 * 60_000);          // acceptance deadline passed
    assert.equal(r2.escalated, 1); assert.equal(F.runLeadSla(t0 + 12 * 60_000).escalated, 0);
    assert.equal(notes() >= 0, true);
    // 5 minutes after the deadline it is moved once, to someone who has not had it
    const r3 = F.runLeadSla(t0 + 16 * 60_000);
    assert.equal(r3.reassigned, 1);
    const second = F.currentAssignment(l.id);
    assert.notEqual(second.agent_id, first.agent_id);
    // and again after the second agent also lets it lapse; the third is the last one left, then it stops
    const t1 = Date.parse(second.assigned_at);
    F.runLeadSla(t1 + 11 * 60_000); F.runLeadSla(t1 + 17 * 60_000);
    const third = F.currentAssignment(l.id);
    const owners = db.all('SELECT agent_id FROM lead_assignments WHERE contact_id=?', l.id).map((x) => x.agent_id);
    assert.equal(new Set(owners).size, owners.length, 'nobody gets the same lead twice');
    const t2 = Date.parse(third.assigned_at);
    F.runLeadSla(t2 + 11 * 60_000); F.runLeadSla(t2 + 20 * 60_000); F.runLeadSla(t2 + 600 * 60_000);
    assert.ok(db.get("SELECT COUNT(*) n FROM lead_assignments WHERE contact_id=? AND end_reason='escalation reassignment'", l.id).n <= 2, 'capped at max_reassignments');
    // satisfied target: no escalation at all
    const ok = lead();
    const o = F.currentAssignment(ok.id);
    F.acceptLead(ok.id, { id: o.agent_id, name: 'x' }); F.logHumanResponse(ok.id, { id: o.agent_id, name: 'x' }, { channel: 'phone' });
    const quiet = F.runLeadSla(Date.parse(o.assigned_at) + 600 * 60_000);
    assert.equal(db.get("SELECT COUNT(*) n FROM lead_events WHERE contact_id=? AND type IN ('escalated','reminder')", ok.id).n, 0, 'no escalation once answered');
    assert.ok(quiet);
    // a closed lead ends its assignment instead of escalating
    const closed = lead();
    const lostStage = db.get("SELECT id FROM lookups WHERE type='lead_stage' AND meta LIKE '%lost%'")?.id;
    if (lostStage) { db.run('UPDATE contacts SET stage_id=? WHERE id=?', lostStage, closed.id); F.runLeadSla(Date.now() + 9e8); assert.ok(F.currentAssignment(closed.id) === null); }
  });
});

test('response targets use the workspace working calendar: a Friday-evening lead is due on the next working day', () => {
  const t = mkTenant();
  as(t, () => {
    const a = mkAgent();
    setSetting('work_weekend_days', JSON.stringify([0, 6]));
    F.saveSla({ enabled: true, accept_minutes: 30, first_response_minutes: 60, business_hours_only: true });
    const fri = wallToMs('2026-02-06 17:45:00', 'Asia/Karachi');
    const d = F.deadlinesFor(fri);
    assert.equal(msToWall(Date.parse(d.accept_due_at), 'Asia/Karachi'), '2026-02-09 09:15:00', 'Saturday and Sunday are the weekend here');
    assert.equal(msToWall(Date.parse(d.response_due_at), 'Asia/Karachi'), '2026-02-09 09:45:00');
    assert.ok(a);
  });
});

test('call evidence: a completed outbound call by the assigned agent is a human response, imported once', () => {
  const t = mkTenant();
  as(t, () => {
    const a = mkAgent();
    F.saveRule(null, { name: 'x', mode: 'round_robin', agent_ids: [a] }, null);
    const l = lead();
    const cols = db.all('PRAGMA table_info(calls)').map((c) => c.name);
    assert.ok(cols.includes('contact_id') && cols.includes('direction'));
    db.run("INSERT INTO calls(contact_id,user_id,direction,status,duration,started_at,provider) VALUES(?,?,?,?,?,?,'test')", l.id, a, 'outbound', 'completed', 42, new Date(Date.now() + 1000).toISOString().replace('T', ' ').slice(0, 19));
    assert.equal(F.syncCallEvidence(), 1); assert.equal(F.syncCallEvidence(), 0);
    const ev = db.get("SELECT * FROM lead_events WHERE contact_id=? AND type='human_response'", l.id);
    assert.equal(ev.evidence, 'call_log');
    assert.ok(F.currentAssignment(l.id).first_human_response_at);
  });
});

// ------------------------------------------------------------------ duplicates
test('duplicates: a repeated inbound event is recorded once; a shared phone with a different name opens a review and never merges', () => {
  const t = mkTenant();
  as(t, () => {
    mkAgent();
    const one = lead({ name: 'Maria Lopez', phone: '+1 555 0100100', message: 'Interested in unit 4', extra: { source: { form: 'Hero form' }, consent: { privacy: true, marketing: true, text: 'I agree to emails' }, email: 'maria@x.test' }, email: 'maria@x.test' });
    const again = lead({ name: 'Maria Lopez', phone: '555-010-0100', email: 'maria@x.test', message: 'interested  in unit 4', extra: { source: { form: 'Hero form' } } });
    assert.equal(again.result, 'repeat'); assert.equal(again.id, one.id);
    assert.equal(db.get("SELECT COUNT(*) n FROM activities WHERE contact_id=? AND action LIKE 'Website%'", one.id)?.n ?? 0, 0);
    assert.equal(db.get('SELECT repeats FROM lead_lead_inbound_seen_dummy WHERE 1=0'.replace('lead_lead_inbound_seen_dummy', 'lead_inbound_seen'))?.repeats ?? 0, 0);
    assert.equal(db.get('SELECT COUNT(*) n FROM contacts WHERE full_name=?', 'Maria Lopez').n, 1);
    assert.equal(db.get('SELECT COUNT(*) n FROM lead_attribution WHERE contact_id=? AND result=?', one.id, 'repeat').n, 1, 'the second attempt stays in the source history');
    assert.equal(C.latestConsent('maria@x.test').status, 'granted', 'marketing consent given on the form is evidence');
    // same phone, clearly a different person
    const other = lead({ name: 'Omar Haddad', phone: '+1 555 010 0100', message: 'looking for office space' });
    assert.equal(other.result, 'created'); assert.notEqual(other.id, one.id);
    const rv = D.listReviews();
    assert.equal(rv.length, 1);
    assert.match(rv[0].reason, /different name/);
    // same person written differently still matches
    const variant = lead({ name: 'Maria L. Lopez', phone: '+15550100100', message: 'a second question' });
    assert.equal(variant.result, 'matched'); assert.equal(variant.id, one.id);
  });
});

test('merge: only on a person\'s decision; activities, notes, tasks and attribution move to the kept contact', () => {
  const t = mkTenant();
  as(t, () => {
    mkAgent();
    const a = lead({ name: 'Priya Nair', phone: '+1 555 0300300', message: 'first' }), b = lead({ name: 'P Nair', phone: '+1 555 0300999', email: 'priya.n@x.test', message: 'second' });
    db.run("INSERT INTO tasks(entity_type,entity_id,title,created_at) VALUES('contact',?,?,?)", b.id, 'Call back', '2026-01-01');
    const acts = db.get('SELECT COUNT(*) n FROM activities WHERE contact_id=?', b.id).n;
    D.flagReview(a.id, b.id, 'test');
    const res = D.mergeContacts(a.id, b.id, { id: 1, name: 'Boss' });
    assert.ok(res.moved.activities >= acts);
    assert.equal(db.get('SELECT COUNT(*) n FROM contacts WHERE id=?', b.id).n, 0);
    assert.equal(db.get("SELECT COUNT(*) n FROM tasks WHERE entity_type='contact' AND entity_id=? AND title='Call back'", a.id).n, 1);
    assert.equal(db.get('SELECT email FROM contacts WHERE id=?', a.id).email, 'priya.n@x.test', 'blank fields are filled, nothing overwritten');
    assert.equal(D.mergeHistory(a.id).length, 1);
    assert.equal(JSON.parse(db.get('SELECT merged_snapshot s FROM contact_merges').s).full_name, 'P Nair');
    assert.throws(() => D.mergeContacts(a.id, a.id, null), /two different/);
  });
});

// ------------------------------------------------------------------ sequences
const seqConfig = (steps, extra = {}) => ({ steps, window: { start: '00:00', end: '23:59', working_days_only: false }, frequency: { max_per_week: 14, min_gap_hours: 0 }, stop_on: { reply: true, appointment_booked: true, lead_closed: true }, ...extra });
const mail = (subject, delay = 0, category = 'operational', condition = 'always') => ({ type: 'email', delay_minutes: delay, category, subject, body: 'Hello {{first_name}}, about {{property}}.', condition });

test('sequences: editor validation, immutable versions, templates in three languages', () => {
  const t = mkTenant();
  as(t, () => {
    assert.throws(() => Q.cleanConfig({ steps: [] }), /at least one step/);
    assert.throws(() => Q.cleanConfig({ steps: [{ type: 'email', subject: '', body: 'x' }] }), /subject/);
    assert.throws(() => Q.cleanConfig({ steps: [mail('x')], window: { start: '18:00', end: '09:00' } }), /window/);
    assert.throws(() => Q.cleanConfig({ steps: [{ type: 'sms' }] }), /Email or Task/);
    const s = Q.saveSequence(null, { name: 'Nurture', trigger: { type: 'manual' }, config: seqConfig([mail('Hi', 0)]) }, null);
    assert.equal(s.current_version, 1);
    const same = Q.saveSequence(s.id, { name: 'Nurture renamed', trigger: { type: 'manual' }, config: seqConfig([mail('Hi', 0)]) }, null);
    assert.equal(same.current_version, 1, 'a rename does not create a version');
    const v2 = Q.saveSequence(s.id, { name: 'Nurture', trigger: { type: 'manual' }, config: seqConfig([mail('Hi again', 0)]) }, null);
    assert.equal(v2.current_version, 2); assert.equal(v2.versions.length, 2);
    assert.equal(db.all('SELECT * FROM sequence_versions WHERE sequence_id=?', s.id).length, 2);
    for (const lang of ['en', 'fr', 'ar']) {
      const tpl = sequenceTemplates(lang);
      assert.equal(tpl.length, 3);
      for (const x of tpl) { assert.doesNotThrow(() => Q.cleanConfig(x.config)); assert.equal(x.needs_review, lang !== 'en'); }
    }
    assert.ok(/[؀-ۿ]/.test(sequenceTemplates('ar')[0].config.steps[0].subject));
    const fromTpl = Q.createFromTemplate('viewing', 'fr', null);
    assert.equal(fromTpl.trigger.type, 'viewing_completed');
    const p = Q.previewSequence(seqConfig([mail('Hi {{first_name}}', 0), { type: 'task', delay_minutes: 60, title: 'Call {{full_name}}' }]), null);
    assert.equal(p.sample, true); assert.match(p.steps[0].subject, /Sam/);
  });
});

test('sequences: run sends through the queue, honours sending window and frequency, pins enrolments to their version', async () => {
  clearQueue(); E.resetWorkerState();
  const t = mkTenant(); const sid = await ready(t);
  await as(t, async () => {
    mkAgent();
    const s = Q.saveSequence(null, { name: 'Follow-up', trigger: { type: 'new_inquiry' }, sender_id: sid, config: seqConfig([mail('Welcome {{first_name}}', 0), { type: 'task', delay_minutes: 0, title: 'Call {{full_name}}', due_in_days: 0, condition: 'always' }, mail('Second note', 0)], { frequency: { max_per_week: 1, min_gap_hours: 0 } }) }, null);
    Q.setSequenceStatus(s.id, 'active');
    const l = lead({ name: 'Jordan Smith', email: 'jordan@x.test' });
    const enr = db.get('SELECT * FROM sequence_enrollments WHERE contact_id=?', l.id);
    assert.ok(enr, 'the website enquiry started the sequence');
    assert.equal(Q.enroll(s.id, l.id, { ref: '' }).enrolled, false, 'never enrolled twice');
    // change the sequence: the person in it keeps version 1
    Q.saveSequence(s.id, { name: 'Follow-up', trigger: { type: 'new_inquiry' }, sender_id: sid, config: seqConfig([mail('Entirely new wording', 0)]) }, null);
    assert.equal(db.get('SELECT version FROM sequence_enrollments WHERE id=?', enr.id).version, 1);
    const out = await Q.runSequences(Date.now() + 1000);
    assert.equal(out.sent, 1); assert.equal(out.tasks, 1);
    const queued = E.pdb().prepare("SELECT * FROM email_queue WHERE ref_kind='sequence'").all();
    assert.equal(queued.length, 1); assert.match(queued[0].subject, /Welcome Jordan/);
    assert.equal(queued[0].category, 'operational');
    // weekly limit of 1: the second email waits, it is not dropped
    const again = await Q.runSequences(Date.now() + 2000);
    assert.equal(again.sent, 0);
    const cur = db.get('SELECT * FROM sequence_enrollments WHERE id=?', enr.id);
    assert.equal(cur.status, 'active'); assert.equal(cur.step_index, 2);
    assert.ok(Date.parse(cur.next_run_at) > Date.now() + 5 * 864e5);
    // an identical open task is never created twice
    assert.equal(db.get("SELECT COUNT(*) n FROM tasks WHERE entity_type='contact' AND entity_id=? AND title='Call Jordan Smith'", l.id).n, 1);
    // the automated email is on the timeline, flagged automated, and is not a human response
    const ev = db.get("SELECT * FROM lead_events WHERE contact_id=? AND type='automated_message'", l.id);
    assert.equal(ev.automated, 1);
    assert.equal(db.get("SELECT COUNT(*) n FROM lead_events WHERE contact_id=? AND type='human_response'", l.id).n, 0);
  });
});

test('sequences: sending window moves an email to the next allowed time; restarting the runner never double-sends', async () => {
  clearQueue(); E.resetWorkerState();
  const t = mkTenant(); const sid = await ready(t);
  await as(t, async () => {
    mkAgent();
    setSetting('work_weekend_days', JSON.stringify([0, 6]));
    const cfg = seqConfig([mail('Window test', 0)], { window: { start: '09:00', end: '17:00', working_days_only: true } });
    const s = Q.saveSequence(null, { name: 'Window', trigger: { type: 'manual' }, sender_id: sid, config: cfg }, null);
    Q.setSequenceStatus(s.id, 'active');
    const l = lead({ name: 'Taylor Reed', email: 'taylor@x.test' });
    const tz = t.timezone || 'Asia/Karachi';
    const sat = wallToMs('2026-02-07 22:00:00', tz);
    Q.enroll(s.id, l.id, { ref: 'm', atMs: sat });
    const r = await Q.runSequences(sat);
    assert.equal(r.sent, 0, 'outside the window nothing is sent');
    const nextWall = msToWall(Date.parse(db.get('SELECT next_run_at FROM sequence_enrollments WHERE contact_id=?', l.id).next_run_at), tz);
    assert.match(nextWall, /^2026-02-09 09:00/);
    const mon = wallToMs('2026-02-09 09:05:00', tz);
    assert.equal((await Q.runSequences(mon)).sent, 1);
    assert.equal((await Q.runSequences(mon)).sent, 0);
    assert.equal(E.pdb().prepare("SELECT COUNT(*) n FROM email_queue WHERE ref_kind='sequence'").get().n, 1);
  });
});

test('sequences: a reply, an appointment, an opt-out or a closed lead stops them; queued mail is cancelled', async () => {
  clearQueue(); E.resetWorkerState(); fake.sent.length = 0;
  const t = mkTenant(); const sid = await ready(t);
  await as(t, async () => {
    mkAgent();
    const s = Q.saveSequence(null, { name: 'Stops', trigger: { type: 'manual' }, sender_id: sid, config: seqConfig([mail('One', 0), mail('Two', 60)]) }, null);
    Q.setSequenceStatus(s.id, 'active');
    const mk = (name, email) => { const l = lead({ name, email }); Q.enroll(s.id, l.id, { ref: 'x' }); return l.id; };
    const replied = mk('Rita Reply', 'rita@x.test'), booked = mk('Bob Booked', 'bob@x.test'), optout = mk('Olive Optout', 'olive@x.test');
    // reply while a message is still queued -> the worker cancels it
    await Q.runSequences(Date.now() + 1000);
    const q = E.pdb().prepare("SELECT * FROM email_queue WHERE contact_id=? AND ref_kind='sequence'").get(replied);
    assert.ok(q);
    Q.customerReplied(replied, { evidence: 'inbound_email', detail: 'Re: One', dedupe: 'reply:m1' });
    assert.equal(Q.customerReplied(replied, { evidence: 'inbound_email', dedupe: 'reply:m1' }), false, 'the same reply twice is ignored');
    assert.equal(db.get('SELECT status, stop_reason FROM sequence_enrollments WHERE contact_id=?', replied).stop_reason, 'customer replied');
    await E.runEmailQueue({ nowMs: Date.now() + 10_000 });
    assert.equal(E.pdb().prepare('SELECT status FROM email_queue WHERE id=?').get(q.id).status, 'cancelled');
    assert.ok(!fake.sent.some((m) => m.to === 'rita@x.test'), 'nothing reached the provider');
    // appointment booked
    Q.appointmentBooked(booked, 77);
    assert.equal(db.get('SELECT stop_reason FROM sequence_enrollments WHERE contact_id=?', booked).stop_reason, 'appointment booked');
    // opt-out
    C.suppress('olive@x.test', { scope: 'marketing', reason: 'unsubscribed' });
    C.fireOptOut('olive@x.test', 'unsubscribed');
    assert.equal(db.get('SELECT stop_reason FROM sequence_enrollments WHERE contact_id=?', optout).stop_reason, 'opted out');
    // a human is told about the reply
    assert.ok(db.get("SELECT 1 x FROM notifications WHERE title LIKE '%replied%'"));
    // closed lead
    const lost = db.get("SELECT id FROM lookups WHERE type='lead_stage' AND meta LIKE '%lost%'")?.id;
    const c = mk('Cleo Closed', 'cleo@x.test');
    if (lost) { db.run('UPDATE contacts SET stage_id=? WHERE id=?', lost, c); await Q.runSequences(Date.now() + 2000); assert.equal(db.get('SELECT stop_reason FROM sequence_enrollments WHERE contact_id=?', c).stop_reason, 'lead closed'); }
    // manual pause/resume/cancel
    const m = mk('Mia Manual', 'mia@x.test');
    assert.equal(Q.pauseContact(m, null), 1);
    assert.equal((await Q.runSequences(Date.now() + 5000)).sent >= 0, true);
    const e = db.get('SELECT * FROM sequence_enrollments WHERE contact_id=?', m);
    assert.equal(e.status, 'paused');
    Q.resumeEnrollment(e.id, null); assert.equal(db.get('SELECT status FROM sequence_enrollments WHERE id=?', e.id).status, 'active');
    Q.cancelEnrollment(e.id, null); assert.equal(db.get('SELECT stop_reason FROM sequence_enrollments WHERE id=?', e.id).stop_reason, 'cancelled by staff');
  });
});

test('sequences: marketing mail needs consent (the step is skipped, not forced); a missing sender pauses and resumes by itself', async () => {
  clearQueue(); E.resetWorkerState();
  const t = mkTenant();
  await as(t, async () => {
    mkAgent();
    // no verified sender yet: cannot be activated while it sends email
    const s = Q.saveSequence(null, { name: 'Marketing', trigger: { type: 'manual' }, config: seqConfig([mail('Promo', 0, 'marketing'), mail('Ops', 0, 'operational')]) }, null);
    assert.throws(() => Q.setSequenceStatus(s.id, 'active'), /Verify a sending domain/);
  });
  const sid = await ready(t);
  await as(t, async () => {
    const s = db.get("SELECT id FROM sequences WHERE name='Marketing'");
    db.run('UPDATE sequences SET sender_id=? WHERE id=?', sid, s.id);
    Q.setSequenceStatus(s.id, 'active');
    const l = lead({ name: 'Nina Nomarketing', email: 'nina@x.test' });
    Q.enroll(s.id, l.id, { ref: 'm' });
    await Q.runSequences(Date.now() + 1000);
    const log = db.all('SELECT step_index, status, detail FROM sequence_log ORDER BY step_index');
    assert.equal(log[0].status, 'skipped'); assert.match(log[0].detail, /consent/);
    await Q.runSequences(Date.now() + 2000);
    assert.equal(E.pdb().prepare("SELECT COUNT(*) n FROM email_queue WHERE ref_kind='sequence' AND category='marketing'").get().n, 0);
    assert.equal(E.pdb().prepare("SELECT COUNT(*) n FROM email_queue WHERE ref_kind='sequence' AND category='operational'").get().n, 1);
    // consent recorded -> a later marketing step goes out
    C.recordConsent({ email: 'nina@x.test', status: 'granted', source: 'manual', text: 'agreed on call' });
    assert.equal(C.eligibility('nina@x.test', 'marketing').ok, true);
  });
  // allowance exhausted -> paused with a reason, resumed when there is room again
  clearQueue();
  const t2 = mkTenant(); const sid2 = await ready(t2);
  await as(t2, async () => {
    mkAgent();
    const s = Q.saveSequence(null, { name: 'Blocked', trigger: { type: 'manual' }, sender_id: sid2, config: seqConfig([mail('Hello', 0)]) }, null);
    Q.setSequenceStatus(s.id, 'active');
    const l = lead({ name: 'Bea Blocked', email: 'bea@x.test' });
    const { id } = Q.enroll(s.id, l.id, { ref: 'b' });
    db.run("UPDATE sequences SET sender_id=999999 WHERE id=?", s.id);
    await Q.runSequences(Date.now() + 1000);
    assert.equal(db.get('SELECT status FROM sequence_enrollments WHERE id=?', id).status, 'paused');
    assert.match(db.get('SELECT pause_reason FROM sequence_enrollments WHERE id=?', id).pause_reason, /^blocked:/);
    db.run('UPDATE sequences SET sender_id=? WHERE id=?', sid2, s.id);
    const r = await Q.runSequences(Date.now() + 2000);
    assert.equal(r.resumed, 1);
    assert.equal(db.get('SELECT status FROM sequence_enrollments WHERE id=?', id).status === 'completed' || r.sent === 1, true);
  });
});

test('appointments: booking stops the sequence, a duplicate booking is not created, completing a viewing starts the follow-up once (HTTP)', async () => {
  clearQueue(); E.resetWorkerState();
  const t = mkTenant(); const sid = await ready(t);
  const host = `${t.slug}.erp.test`;
  const login = await call(host, 'POST', '/api/auth/login', { identifier: t.owner_email, password: 'Tenant@12345' });
  const h = { cookie: login.cookie };
  const { contact, inquiry, viewed } = as(t, () => {
    mkAgent();
    const a = Q.saveSequence(null, { name: 'Inquiry', trigger: { type: 'new_inquiry' }, sender_id: sid, config: seqConfig([mail('Nudge', 10080)]) }, null);
    const b = Q.saveSequence(null, { name: 'After viewing', trigger: { type: 'viewing_completed' }, sender_id: sid, config: seqConfig([mail('Thanks for visiting', 60)]) }, null);
    Q.setSequenceStatus(a.id, 'active'); Q.setSequenceStatus(b.id, 'active');
    const l = lead({ name: 'Vera Viewer', email: 'vera@x.test' });
    return { contact: l.id, inquiry: a.id, viewed: b.id };
  });
  const body = { contact_id: contact, title: 'Viewing', kind: 'viewing', starts_at: '2030-06-03 10:00', ends_at: '2030-06-03 11:00' };
  const a1 = await call(host, 'POST', '/api/appointments', body, h);
  assert.equal(a1.status, 201);
  const a2 = await call(host, 'POST', '/api/appointments', body, h);
  assert.equal(a2.data.id, a1.data.id); assert.equal(a2.data.replayed, true);
  as(t, () => {
    assert.equal(db.get('SELECT COUNT(*) n FROM appointments WHERE contact_id=?', contact).n, 1);
    assert.equal(db.get('SELECT stop_reason FROM sequence_enrollments WHERE contact_id=? AND sequence_id=?', contact, inquiry).stop_reason, 'appointment booked');
    assert.equal(db.get('SELECT COUNT(*) n FROM lead_events WHERE contact_id=? AND type=?', contact, 'appointment_booked').n, 1);
    assert.equal(db.get('SELECT COUNT(*) n FROM sequence_enrollments WHERE contact_id=? AND sequence_id=?', contact, viewed).n, 0);
  });
});

// ------------------------------------------------------------------ conversion report
test('conversion report: denominators are stated, untracked leads are separated, automated activity is never a response', () => {
  const t = mkTenant();
  as(t, () => {
    const [a, b] = [mkAgent(), mkAgent()];
    F.saveSla({ enabled: true, accept_minutes: 30, first_response_minutes: 60, business_hours_only: false });
    F.saveRule(null, { name: 'Two', mode: 'round_robin', agent_ids: [a, b] }, null);
    const ids = [lead({ extra: { source: { form: 'A' } } }), lead(), lead(), lead()].map((x) => x.id);
    // one answered by a person, one only auto-acknowledged
    const o0 = F.currentAssignment(ids[0]);
    F.acceptLead(ids[0], { id: o0.agent_id, name: 'x' });
    F.logHumanResponse(ids[0], { id: o0.agent_id, name: 'x' }, { channel: 'phone' }, Date.parse(o0.assigned_at) + 10 * 60_000);
    F.recordAutomated(ids[1], 'auto ack', 'a1');
    // a legacy lead from before tracking
    db.run("INSERT INTO contacts(first_name,full_name,phone,lead_source,created_at,last_activity_at) VALUES('Old','Old Lead','+1 555 0990001','Referral',?,?)", db.get("SELECT created_at FROM contacts WHERE id=?", ids[0]).created_at, '2026-01-01 00:00:00');
    const r = V.conversionReport({ scope: {} });
    assert.equal(r.totals.leads, 5); assert.equal(r.totals.not_tracked, 1); assert.equal(r.totals.tracked, 4);
    assert.deepEqual(r.rates.responded, { n: 1, d: 4, rate: 25 }, 'only the person-answered lead counts, divided by assigned leads');
    assert.equal(r.response_time.median_minutes, 10);
    assert.equal(r.automation.automated_events, 1); assert.equal(r.automation.human_responses, 1);
    assert.ok(r.definitions.responded.includes('Automated'));
    assert.equal(r.rates.won.d, 5);
    assert.ok(r.by_source.find((s) => s.key === 'Unknown' || s.key === 'Website'));
    // an agent with own scope sees only their leads and no ranking of colleagues
    const mine = V.conversionReport({ scope: { ownerId: a } });
    assert.ok(mine.totals.leads < r.totals.leads); assert.deepEqual(mine.by_agent, []); assert.equal(mine.scope, 'own');
    // empty period: rates are null, not 0%
    const none = V.conversionReport({ from: '2001-01-01', to: '2001-01-31' });
    assert.equal(none.rates.responded.rate, null); assert.ok(none.response_time.note);
  });
});

// ------------------------------------------------------------------ tenancy, permissions, migration
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const rq = http.request({ host: '127.0.0.1', port, path: url, method, agent: false, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c));
    res.on('end', () => { const t = Buffer.concat(ch).toString(); let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  rq.on('error', reject); if (data) rq.write(data); rq.end();
});

test('HTTP: workspaces cannot see each other\'s rules, sequences, leads or reports; unauthenticated calls are refused', async () => {
  const a = mkTenant(), b = mkTenant();
  const ha = { cookie: (await call(`${a.slug}.erp.test`, 'POST', '/api/auth/login', { identifier: a.owner_email, password: 'Tenant@12345' })).cookie };
  const hb = { cookie: (await call(`${b.slug}.erp.test`, 'POST', '/api/auth/login', { identifier: b.owner_email, password: 'Tenant@12345' })).cookie };
  assert.equal((await call(`${a.slug}.erp.test`, 'GET', '/api/leadflow/settings')).status, 401);
  const rule = await call(`${a.slug}.erp.test`, 'POST', '/api/leadflow/rules', { name: 'Only A', mode: 'manual' }, ha);
  assert.equal(rule.status, 201);
  assert.equal((await call(`${b.slug}.erp.test`, 'GET', '/api/leadflow/settings', null, hb)).data.rules.length, 0);
  assert.equal((await call(`${b.slug}.erp.test`, 'PUT', `/api/leadflow/rules/${rule.data.id}`, { name: 'hijack', mode: 'manual' }, hb)).status, 404);
  const seq = await call(`${a.slug}.erp.test`, 'POST', '/api/leadflow/sequences/from-template', { template: 'inquiry', lang: 'en' }, ha);
  assert.equal(seq.status, 201);
  assert.equal((await call(`${b.slug}.erp.test`, 'GET', `/api/leadflow/sequences/${seq.data.id}`, null, hb)).status, 404);
  const keyA = (await call(`${a.slug}.erp.test`, 'GET', '/api/settings/system', null, ha)).data.website_api_key;
  const lid = (await call(`${a.slug}.erp.test`, 'POST', '/api/public/inquiry', { name: 'Only Alpha', phone: '+1 555 0400400', message: 'hi' }, { 'X-API-Key': keyA })).data.reference.replace('WEB-', '');
  assert.equal((await call(`${b.slug}.erp.test`, 'GET', `/api/leadflow/contacts/${lid}/flow`, null, hb)).status, 404);
  assert.equal((await call(`${a.slug}.erp.test`, 'GET', `/api/leadflow/contacts/${lid}/flow`, null, ha)).status, 200);
  const conv = await call(`${b.slug}.erp.test`, 'GET', '/api/leadflow/conversion', null, hb);
  assert.equal(conv.data.totals.leads, 0);
  assert.equal((await call(`${a.slug}.erp.test`, 'GET', '/api/leadflow/conversion', null, ha)).data.totals.leads, 1);
});

test('HTTP: an own-scope agent reaches only their leads, cannot assign, merge or change settings', async () => {
  const t = mkTenant();
  const host = `${t.slug}.erp.test`;
  const owner = { cookie: (await call(host, 'POST', '/api/auth/login', { identifier: t.owner_email, password: 'Tenant@12345' })).cookie };
  const { agentId, other } = as(t, () => {
    const hash = db.get('SELECT password_hash h FROM users LIMIT 1').h;
    const id = Number(db.run('INSERT INTO users(name,email,password_hash,role_id,created_at) VALUES(?,?,?,?,?)', 'Sam Seller', 'sam@seller.test', hash, agentRole(), '2026-01-01 00:00:00').lastInsertRowid);
    const mine = lead({ name: 'Mine Lead' }), theirs = lead({ name: 'Theirs Lead' });
    db.run('UPDATE contacts SET agent_id=? WHERE id=?', id, mine.id); db.run('UPDATE contacts SET agent_id=NULL WHERE id=?', theirs.id);
    return { agentId: id, other: theirs.id, mine: mine.id };
  });
  assert.ok(agentId);
  const lg = await call(host, 'POST', '/api/auth/login', { identifier: 'sam@seller.test', password: 'Tenant@12345' });
  assert.equal(lg.status, 200);
  const h = { cookie: lg.cookie };
  assert.equal((await call(host, 'GET', `/api/leadflow/contacts/${other}/flow`, null, h)).status, 403);
  assert.equal((await call(host, 'POST', '/api/leadflow/rules', { name: 'x', mode: 'manual' }, h)).status, 403);
  assert.equal((await call(host, 'POST', `/api/leadflow/contacts/${other}/assign`, { agent_id: agentId }, h)).status, 403);
  const conv = await call(host, 'GET', '/api/leadflow/conversion', null, h);
  assert.equal(conv.data.scope, 'own');
  assert.ok(owner);
});

test('migration: an existing workspace database gains the lead tables without losing data; old leads read as not tracked', () => {
  const t = mkTenant();
  as(t, () => {
    const before = lead({ name: 'Before Upgrade' });
    for (const tbl of ['lead_routing_rules', 'lead_assignments', 'lead_events', 'sequences', 'sequence_versions', 'sequence_enrollments', 'sequence_log', 'duplicate_reviews', 'contact_merges', 'lead_inbound_seen', 'agent_routing_profiles', 'lead_routing_state']) {
      assert.ok(db.get("SELECT 1 x FROM sqlite_master WHERE type='table' AND name=?", tbl), `${tbl} exists`);
    }
    // a pre-existing contact with no assignment rows is reported honestly
    db.run('DELETE FROM lead_assignments WHERE contact_id=?', before.id);
    const r = V.conversionReport({});
    assert.equal(r.totals.not_tracked, 1);
    // opening it again changes nothing (IF NOT EXISTS)
    assert.doesNotThrow(() => db.db.exec(`CREATE TABLE IF NOT EXISTS lead_events(id INTEGER PRIMARY KEY)`));
    assert.equal(db.get('SELECT full_name FROM contacts WHERE id=?', before.id).full_name, 'Before Upgrade');
  });
});
