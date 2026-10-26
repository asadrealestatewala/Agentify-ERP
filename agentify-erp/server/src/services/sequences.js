// Reply-aware follow-up sequences (runs inside a workspace).
//
// A sequence is a trigger plus ordered steps (email or task). Each save that changes the steps creates a new immutable version;
// people already enrolled stay on the version they started with. A runner moves enrolments forward one step at a time:
//   * email steps go through the tenant e-mail queue (sender, consent, suppression, allowance and idempotency all apply);
//   * task steps create one CRM task for the lead's owner, never a second identical open one;
//   * every step honours the sending window in the workspace timezone, working days and the weekly / gap limits.
// An enrolment stops when the customer replies, an appointment is booked, they opt out, the lead closes or someone cancels it.
// It pauses (and resumes by itself) when there is no verified sender or no allowance left. Replies are recognised from inbound
// e-mail when the server has an inbound domain; without one staff pause or log the reply by hand. Opens and clicks are never used.
import { all, get, run, tx } from '../db.js';
import { activity, notify } from '../audit.js';
import { bad, notFound, forbidden, jparse, now } from '../util.js';
import { currentTenant } from '../context.js';
import { calendarChecker, workCalendar } from './workCalendar.js';
import { alignToWindow } from './businessTime.js';
import { enqueue, registerSendGuard, sendState } from './tenantEmail.js';
import { activeSenderFor } from './emailSenders.js';
import { onOptOut } from './emailConsent.js';
import { onReply } from './emailInbound.js';
import { addEvent, recordAutomated, leadIsOpen, utc } from './leadFlow.js';
import { sequenceTemplates } from '../../../shared/sequenceTemplates.js';

const TRIGGERS = ['manual', 'new_inquiry', 'viewing_booked', 'viewing_completed'];
const CONDITIONS = ['always', 'no_reply', 'no_human_response', 'stage_open'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_STEPS = 12, MAX_DELAY = 60 * 24 * 365;

/** Validate and normalise a version's configuration. Throws a plain message for the editor. */
export function cleanConfig(c = {}) {
  const steps = (Array.isArray(c.steps) ? c.steps : []).map((s, i) => {
    const n = i + 1;
    const delay = Math.trunc(Number(s.delay_minutes ?? 0));
    if (!(delay >= 0 && delay <= MAX_DELAY)) throw bad(`Step ${n}: the wait must be between 0 minutes and 365 days`);
    const condition = CONDITIONS.includes(s.condition) ? s.condition : 'always';
    if (s.type === 'email') {
      const subject = String(s.subject || '').trim(), body = String(s.body || '').trim();
      if (!subject || subject.length > 200) throw bad(`Step ${n}: write a subject (up to 200 characters)`);
      if (!body || body.length > 5000) throw bad(`Step ${n}: write the message (up to 5000 characters)`);
      return { type: 'email', delay_minutes: delay, category: s.category === 'marketing' ? 'marketing' : 'operational', subject, body, condition };
    }
    if (s.type === 'task') {
      const title = String(s.title || '').trim();
      if (!title || title.length > 160) throw bad(`Step ${n}: give the task a title (up to 160 characters)`);
      const due = Math.trunc(Number(s.due_in_days ?? 0));
      if (!(due >= 0 && due <= 90)) throw bad(`Step ${n}: the task due date is 0 to 90 days after it is created`);
      return { type: 'task', delay_minutes: delay, title, due_in_days: due, condition };
    }
    throw bad(`Step ${n}: choose Email or Task`);
  });
  if (!steps.length) throw bad('Add at least one step');
  if (steps.length > MAX_STEPS) throw bad(`A sequence can have up to ${MAX_STEPS} steps`);
  const w = c.window || {};
  const window = { start: HHMM.test(w.start || '') ? w.start : '09:00', end: HHMM.test(w.end || '') ? w.end : '18:00', working_days_only: w.working_days_only !== false };
  if (window.end <= window.start) throw bad('The sending window must end after it starts');
  const f = c.frequency || {};
  const maxWeek = Math.trunc(Number(f.max_per_week ?? 3)), gap = Math.trunc(Number(f.min_gap_hours ?? 24));
  if (!(maxWeek >= 1 && maxWeek <= 14)) throw bad('Emails per week: 1 to 14');
  if (!(gap >= 0 && gap <= 168)) throw bad('Gap between emails: 0 to 168 hours');
  const so = c.stop_on || {};
  return { steps, window, frequency: { max_per_week: maxWeek, min_gap_hours: gap }, stop_on: { reply: so.reply !== false, appointment_booked: so.appointment_booked !== false, lead_closed: so.lead_closed !== false } };
}
export function cleanTrigger(t = {}) {
  const type = TRIGGERS.includes(t.type) ? t.type : 'manual';
  const sources = (t.sources || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
  return { type, ...(sources.length ? { sources } : {}) };
}

/** {{variables}} in a template; unknown ones become empty so nothing odd reaches a customer. */
export function renderTemplate(tpl, vars) { return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? '')); }
export function varsFor(contact) {
  const prop = contact.property_id ? get('SELECT title FROM properties WHERE id=?', contact.property_id) : null;
  const project = contact.project_id ? get('SELECT name FROM projects WHERE id=?', contact.project_id) : null;
  const agent = contact.agent_id ? get('SELECT name FROM users WHERE id=?', contact.agent_id) : null;
  const first = String(contact.first_name || contact.full_name || '').split(' ')[0] || '';
  return { first_name: first, full_name: contact.full_name || '', agent_name: agent?.name || '', company: currentTenant()?.name || '', property: prop?.title || project?.name || 'the property', project: project?.name || '' };
}

// ---------------------------------------------------------------- CRUD and versions
const view = (s) => s && ({ ...s, trigger: jparse(s.trigger, { type: 'manual' }) });
export const listSequences = () => all('SELECT * FROM sequences ORDER BY id DESC').map((s) => ({ ...view(s),
  config: jparse(get('SELECT config FROM sequence_versions WHERE sequence_id=? AND version=?', s.id, s.current_version)?.config, null),
  enrolled: get("SELECT COUNT(*) n FROM sequence_enrollments WHERE sequence_id=? AND status IN ('active','paused')", s.id).n,
  completed: get("SELECT COUNT(*) n FROM sequence_enrollments WHERE sequence_id=? AND status='completed'", s.id).n,
  stopped: get("SELECT COUNT(*) n FROM sequence_enrollments WHERE sequence_id=? AND status='stopped'", s.id).n }));
export function getSequence(id) {
  const s = get('SELECT * FROM sequences WHERE id=?', id);
  if (!s) throw notFound('Sequence not found');
  return { ...view(s), config: jparse(get('SELECT config FROM sequence_versions WHERE sequence_id=? AND version=?', id, s.current_version)?.config, null),
    versions: all('SELECT version, created_at, created_by FROM sequence_versions WHERE sequence_id=? ORDER BY version DESC', id) };
}
function checkSender(senderId) {
  if (senderId == null || senderId === '') return null;
  const t = currentTenant();
  if (!activeSenderFor(t.id, Number(senderId))) throw bad('That sender is not verified yet. Verify a sending domain and address first.');
  return Number(senderId);
}
export function saveSequence(id, b, user) {
  const name = String(b.name || '').trim();
  if (!name || name.length > 80) throw bad('Give the sequence a name (up to 80 characters)');
  const trigger = cleanTrigger(b.trigger), config = cleanConfig(b.config), sender = checkSender(b.sender_id);
  return tx(() => {
    if (!id) {
      const nid = Number(run('INSERT INTO sequences(name,status,trigger,sender_id,current_version,template,created_by) VALUES(?,?,?,?,1,?,?)', name, 'draft', JSON.stringify(trigger), sender, b.template || null, user?.id ?? null).lastInsertRowid);
      run('INSERT INTO sequence_versions(sequence_id,version,config,created_by) VALUES(?,?,?,?)', nid, 1, JSON.stringify(config), user?.id ?? null);
      return getSequence(nid);
    }
    const s = get('SELECT * FROM sequences WHERE id=?', id);
    if (!s) throw notFound('Sequence not found');
    const cur = get('SELECT config FROM sequence_versions WHERE sequence_id=? AND version=?', id, s.current_version)?.config;
    let version = s.current_version;
    if (cur !== JSON.stringify(config)) { version += 1; run('INSERT INTO sequence_versions(sequence_id,version,config,created_by) VALUES(?,?,?,?)', id, version, JSON.stringify(config), user?.id ?? null); }
    run("UPDATE sequences SET name=?, trigger=?, sender_id=?, current_version=?, updated_at=datetime('now') WHERE id=?", name, JSON.stringify(trigger), sender, version, id);
    return getSequence(id);
  });
}
export function createFromTemplate(templateId, lang, user) {
  const t = sequenceTemplates(lang).find((x) => x.id === templateId);
  if (!t) throw notFound('Template not found');
  return saveSequence(null, { name: t.name, trigger: t.trigger, config: t.config, template: `${t.id}:${t.language}` }, user);
}
export function setSequenceStatus(id, status) {
  if (!['active', 'paused', 'draft'].includes(status)) throw bad('Unknown status');
  const s = get('SELECT * FROM sequences WHERE id=?', id);
  if (!s) throw notFound('Sequence not found');
  if (status === 'active') {
    const cfg = jparse(get('SELECT config FROM sequence_versions WHERE sequence_id=? AND version=?', id, s.current_version)?.config, null);
    if (cfg?.steps.some((x) => x.type === 'email') && !activeSenderFor(currentTenant().id, s.sender_id)) throw bad('Verify a sending domain and address before activating a sequence that sends email.', { code: 'sender_not_verified' });
  }
  run("UPDATE sequences SET status=?, updated_at=datetime('now') WHERE id=?", status, id);
  return getSequence(id);
}
export function deleteSequence(id) {
  if (get("SELECT 1 FROM sequence_enrollments WHERE sequence_id=? AND status IN ('active','paused')", id)) throw bad('Cancel or finish the people in this sequence first, or pause it instead.');
  run('DELETE FROM sequences WHERE id=?', id);
}

// ---------------------------------------------------------------- windows and timing
function windowOpts(cfg) {
  const c = workCalendar(), base = calendarChecker();
  return { tz: c.timezone, isWorking: cfg.window.working_days_only ? base : () => true, start: cfg.window.start, end: cfg.window.end };
}
/** When an email step may actually go out: the first moment at or after `atMs` inside the sending window. */
export const sendTimeFor = (atMs, cfg) => alignToWindow(atMs, windowOpts(cfg));

// ---------------------------------------------------------------- enrolment
const cfgOf = (seqId, version) => jparse(get('SELECT config FROM sequence_versions WHERE sequence_id=? AND version=?', seqId, version)?.config, null);
/** Enrol one lead. Safe to call again: the same (sequence, lead, ref) never enrols twice. */
export function enroll(sequenceId, contactId, { ref = '', user = null, atMs = Date.now() } = {}) {
  const s = get('SELECT * FROM sequences WHERE id=?', sequenceId);
  if (!s) throw notFound('Sequence not found');
  if (s.status !== 'active') throw bad('Activate the sequence before enrolling people');
  const c = get('SELECT * FROM contacts WHERE id=?', contactId);
  if (!c) throw notFound('Contact not found');
  const cfg = cfgOf(s.id, s.current_version);
  const first = cfg.steps[0];
  const r = run('INSERT OR IGNORE INTO sequence_enrollments(sequence_id,version,contact_id,ref,status,step_index,next_run_at,started_at,enrolled_by) VALUES(?,?,?,?,?,0,?,?,?)',
    s.id, s.current_version, contactId, String(ref), 'active', utc(atMs + first.delay_minutes * 60_000), utc(atMs), user?.id ?? null);
  if (!r.changes) return { enrolled: false, id: get('SELECT id FROM sequence_enrollments WHERE sequence_id=? AND contact_id=? AND ref=?', s.id, contactId, String(ref)).id };
  const id = Number(r.lastInsertRowid);
  addEvent(contactId, 'sequence_enrolled', { automated: !user, actorId: user?.id ?? null, detail: s.name, dedupe: `enr:${id}` });
  activity(contactId, user, 'Added to follow-up sequence', { detail: s.name });
  return { enrolled: true, id };
}
/** Start every active sequence whose trigger fits this event. Used by the website intake and the appointments. */
export function triggerSequences(type, contactId, { ref = '', atMs = Date.now() } = {}) {
  const c = get('SELECT * FROM contacts WHERE id=?', contactId);
  if (!c) return [];
  const out = [];
  for (const s of all("SELECT * FROM sequences WHERE status='active'")) {
    const t = jparse(s.trigger, {});
    if (t.type !== type) continue;
    if (t.sources?.length && !t.sources.map((x) => x.toLowerCase()).includes(String(c.lead_source || '').toLowerCase())) continue;
    try { const r = enroll(s.id, contactId, { ref, atMs }); if (r.enrolled) out.push(s.id); } catch (e) { console.error('[sequence trigger]', e.message); }
  }
  return out;
}

// ---------------------------------------------------------------- stopping, pausing
const stopRow = (e, reason, atMs = Date.now()) => {
  run("UPDATE sequence_enrollments SET status='stopped', stop_reason=?, ended_at=?, next_run_at=NULL WHERE id=? AND status IN ('active','paused')", reason, utc(atMs), e.id);
  addEvent(e.contact_id, 'sequence_stopped', { automated: true, detail: `${get('SELECT name FROM sequences WHERE id=?', e.sequence_id)?.name}: ${reason}`, dedupe: `stop:${e.id}`, atMs });
};
export function stopContact(contactId, reason, { only } = {}) {
  let n = 0;
  for (const e of all("SELECT * FROM sequence_enrollments WHERE contact_id=? AND status IN ('active','paused')", contactId)) {
    const cfg = cfgOf(e.sequence_id, e.version);
    if (only && !only(e, cfg)) continue;
    stopRow(e, reason); n++;
  }
  return n;
}
export function cancelEnrollment(id, user) {
  const e = get('SELECT * FROM sequence_enrollments WHERE id=?', id);
  if (!e) throw notFound('Enrolment not found');
  stopRow(e, 'cancelled by staff'); activity(e.contact_id, user, 'Follow-up sequence cancelled');
}
export function pauseEnrollment(id, user, reason = 'paused by staff') {
  const e = get('SELECT * FROM sequence_enrollments WHERE id=?', id);
  if (!e) throw notFound('Enrolment not found');
  run("UPDATE sequence_enrollments SET status='paused', pause_reason=? WHERE id=? AND status='active'", reason, id);
  activity(e.contact_id, user, 'Follow-up sequence paused');
}
export function resumeEnrollment(id, user, atMs = Date.now()) {
  const e = get('SELECT * FROM sequence_enrollments WHERE id=?', id);
  if (!e) throw notFound('Enrolment not found');
  if (e.status !== 'paused') throw bad('Only a paused sequence can be resumed');
  run("UPDATE sequence_enrollments SET status='active', pause_reason=NULL, next_run_at=? WHERE id=?", utc(atMs), id);
  activity(e.contact_id, user, 'Follow-up sequence resumed');
}
export function pauseContact(contactId, user) { let n = 0; for (const e of all("SELECT id FROM sequence_enrollments WHERE contact_id=? AND status='active'", contactId)) { pauseEnrollment(e.id, user); n++; } return n; }

/** The customer replied, learned from inbound mail or recorded by hand. Stops sequences that stop on reply. */
export function customerReplied(contactId, { evidence, detail, user = null, dedupe = null, atMs = Date.now() } = {}) {
  const c = get('SELECT * FROM contacts WHERE id=?', contactId);
  if (!c) return false;
  const logged = addEvent(contactId, 'customer_reply', { channel: 'email', evidence, detail, actorId: user?.id ?? null, dedupe, atMs });
  if (dedupe && !logged) return false; // the same message twice
  const n = stopContact(contactId, 'customer replied', { only: (_e, cfg) => cfg?.stop_on?.reply });
  if (c.agent_id) notify(c.agent_id, 'lead', `${c.full_name} replied`, 'A customer replied to a follow-up email. Please respond personally.', `/contacts/${contactId}`, { dedupe: dedupe ? `reply-${dedupe}` : undefined });
  if (user) activity(contactId, user, 'Customer reply recorded', { detail: 'Recorded by hand' });
  return n > 0 || !!logged;
}
/** An appointment was booked for this lead: stop sequences that stop on booking (except the one that belongs to the booking). */
export function appointmentBooked(contactId, apptId) {
  addEvent(contactId, 'appointment_booked', { automated: false, detail: `Appointment ${apptId}`, dedupe: `appt:${apptId}` });
  return stopContact(contactId, 'appointment booked', { only: (e, cfg) => cfg?.stop_on?.appointment_booked && e.ref !== `appt:${apptId}` });
}

// ---------------------------------------------------------------- runner
const emailsSince = (contactId, sinceIso) => all("SELECT l.created_at FROM sequence_log l JOIN sequence_enrollments e ON e.id=l.enrollment_id WHERE e.contact_id=? AND l.kind='email' AND l.status='queued' AND l.created_at>=? ORDER BY l.created_at DESC", contactId, sinceIso);
function conditionHolds(cond, e, c) {
  if (cond === 'no_reply') return !get("SELECT 1 FROM lead_events WHERE contact_id=? AND type='customer_reply' AND created_at>=?", c.id, e.started_at);
  if (cond === 'no_human_response') return !get("SELECT 1 FROM lead_events WHERE contact_id=? AND type='human_response' AND automated=0 AND created_at>=?", c.id, e.started_at);
  if (cond === 'stage_open') return leadIsOpen(c);
  return true;
}
const blocked = (e, why) => run("UPDATE sequence_enrollments SET status='paused', pause_reason=? WHERE id=?", `blocked:${why}`, e.id);

/** One pass for this workspace. Idempotent: a step already logged is never done twice. */
export async function runSequences(nowMs = Date.now()) {
  const out = { sent: 0, tasks: 0, stopped: 0, completed: 0, paused: 0, resumed: 0, skipped: 0 };
  const tenant = currentTenant();
  // paused only because something was missing: resume as soon as it is back
  for (const e of all("SELECT e.*, s.sender_id FROM sequence_enrollments e JOIN sequences s ON s.id=e.sequence_id WHERE e.status='paused' AND e.pause_reason LIKE 'blocked:%'")) {
    const ok = tenant && sendState(tenant).ok && activeSenderFor(tenant.id, e.sender_id);
    if (ok) { run("UPDATE sequence_enrollments SET status='active', pause_reason=NULL, next_run_at=? WHERE id=?", utc(nowMs), e.id); out.resumed++; }
  }
  const due = all("SELECT e.* FROM sequence_enrollments e JOIN sequences s ON s.id=e.sequence_id WHERE e.status='active' AND s.status='active' AND e.next_run_at<=? ORDER BY e.next_run_at, e.id LIMIT 200", utc(nowMs));
  for (const first of due) {
    // steps with no wait between them run in the same pass (a few at most); anything else waits for its time
    let e = first;
    for (let i = 0; i < 6 && e; i++) {
      try { await step(e, tenant, nowMs, out); } catch (err) { console.error(`[sequence ${e.id}]`, err.message); break; }
      e = get("SELECT * FROM sequence_enrollments WHERE id=? AND status='active' AND next_run_at<=?", first.id, utc(nowMs));
    }
  }
  return out;
}
async function step(e, tenant, nowMs, out) {
  const seq = get('SELECT * FROM sequences WHERE id=?', e.sequence_id);
  const cfg = cfgOf(e.sequence_id, e.version);
  const c = get('SELECT * FROM contacts WHERE id=?', e.contact_id);
  if (!c || !cfg) { stopRow(e, 'lead no longer exists', nowMs); out.stopped++; return; }
  if (cfg.stop_on.lead_closed && !leadIsOpen(c)) { stopRow(e, 'lead closed', nowMs); out.stopped++; return; }
  if (cfg.stop_on.reply && get("SELECT 1 FROM lead_events WHERE contact_id=? AND type='customer_reply' AND created_at>=?", c.id, e.started_at)) { stopRow(e, 'customer replied', nowMs); out.stopped++; return; }
  const st = cfg.steps[e.step_index];
  if (!st) { run("UPDATE sequence_enrollments SET status='completed', ended_at=?, next_run_at=NULL WHERE id=?", utc(nowMs), e.id); out.completed++; return; }
  const advance = (status, kind, detail) => tx(() => {
    run('INSERT OR IGNORE INTO sequence_log(enrollment_id,step_index,kind,status,detail,created_at) VALUES(?,?,?,?,?,?)', e.id, e.step_index, kind, status, detail || null, utc(nowMs));
    const nextIdx = e.step_index + 1, nx = cfg.steps[nextIdx];
    if (!nx) { run("UPDATE sequence_enrollments SET step_index=?, status='completed', ended_at=?, next_run_at=NULL WHERE id=?", nextIdx, utc(nowMs), e.id); out.completed++; }
    else run('UPDATE sequence_enrollments SET step_index=?, next_run_at=? WHERE id=?', nextIdx, utc(nowMs + nx.delay_minutes * 60_000), e.id);
  });
  if (!conditionHolds(st.condition, e, c)) { advance('skipped', st.type, `condition "${st.condition}" not met`); out.skipped++; return; }
  if (st.type === 'task') {
    const title = renderTemplate(st.title, varsFor(c));
    const assignee = c.agent_id || null;
    // never a second identical open task for the same lead (the follow-up, a viewing task, or an earlier run)
    if (!get("SELECT 1 FROM tasks WHERE entity_type='contact' AND entity_id=? AND title=? AND status='open'", c.id, title)) {
      const due = new Date(nowMs + st.due_in_days * 864e5).toISOString().slice(0, 10);
      run("INSERT INTO tasks(entity_type,entity_id,title,due_date,assigned_to,created_by,created_at) VALUES('contact',?,?,?,?,NULL,?)", c.id, title, due, assignee, now());
      if (assignee) notify(assignee, 'task', 'Follow-up task', title, `/contacts/${c.id}`, { dedupe: `seq-task-${e.id}-${e.step_index}` });
      out.tasks++; advance('done', 'task', title);
    } else { advance('skipped', 'task', 'an identical open task already exists'); out.skipped++; }
    return;
  }
  // email step: first the sending window, then the frequency limits, then the queue
  const at = sendTimeFor(nowMs, cfg);
  if (at > nowMs) { run('UPDATE sequence_enrollments SET next_run_at=? WHERE id=?', utc(at), e.id); return; }
  const addr = String(c.email || '').trim();
  if (!addr) { advance('skipped', 'email', 'no email address'); out.skipped++; return; }
  const recent = emailsSince(c.id, utc(nowMs - 7 * 864e5));
  if (recent.length >= cfg.frequency.max_per_week) { run('UPDATE sequence_enrollments SET next_run_at=? WHERE id=?', utc(Date.parse(recent[recent.length - 1].created_at) + 7 * 864e5), e.id); return; }
  if (recent.length && nowMs - Date.parse(recent[0].created_at) < cfg.frequency.min_gap_hours * 3600e3) { run('UPDATE sequence_enrollments SET next_run_at=? WHERE id=?', utc(Date.parse(recent[0].created_at) + cfg.frequency.min_gap_hours * 3600e3), e.id); return; }
  const vars = varsFor(c);
  const subject = renderTemplate(st.subject, vars).slice(0, 300);
  const paragraphs = renderTemplate(st.body, vars).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  try {
    enqueue({ tenant, category: st.category, to: addr, subject, heading: subject, lines: paragraphs, senderId: seq.sender_id, contactId: c.id, idemKey: `seq:${e.id}:${e.step_index}`, refKind: 'sequence', refId: `${e.id}:${e.step_index}`, trackReplies: true, nowMs });
  } catch (err) {
    if (['paused', 'sender_not_verified', 'quota_exhausted', 'daily_limit', 'not_configured'].includes(err.code)) { blocked(e, err.code); out.paused++; return; }
    if (['opted_out', 'suppressed'].includes(err.code)) { stopRow(e, err.code === 'opted_out' ? 'opted out' : 'address suppressed', nowMs); out.stopped++; return; }
    if (err.code === 'no_consent' || err.code === 'invalid_address') { advance('skipped', 'email', err.code === 'no_consent' ? 'no marketing consent on record' : 'invalid address'); out.skipped++; return; }
    throw err;
  }
  advance('queued', 'email', subject); out.sent++;
  recordAutomated(c.id, `Sequence email: ${subject}`, `seqmail:${e.id}:${e.step_index}`, nowMs);
  activity(c.id, null, 'Follow-up email queued', { detail: subject });
}

// ---------------------------------------------------------------- hooks (registered once)
registerSendGuard('sequence', (row) => {
  const id = Number(String(row.ref_id || '').split(':')[0]);
  const e = id ? get('SELECT * FROM sequence_enrollments WHERE id=?', id) : null;
  if (!e) return null;
  if (e.status !== 'active') return { cancel: `sequence ${e.status === 'stopped' ? `stopped (${e.stop_reason})` : e.status}` };
  if (get("SELECT 1 FROM lead_events WHERE contact_id=? AND type='customer_reply' AND created_at>=?", e.contact_id, e.started_at) && cfgOf(e.sequence_id, e.version)?.stop_on?.reply) return { cancel: 'customer replied' };
  return null;
});
onReply(({ row, emailId, subject }) => {
  if (row.ref_kind !== 'sequence' || !row.contact_id) return;
  customerReplied(row.contact_id, { evidence: 'inbound_email', detail: String(subject || '').slice(0, 200), dedupe: `reply:${emailId}` });
});
onOptOut((email) => {
  for (const c of all('SELECT id FROM contacts WHERE lower(email)=lower(?)', email)) stopContact(c.id, 'opted out');
});

// ---------------------------------------------------------------- preview and test
/** What a lead would receive and when, without sending anything. */
export function previewSequence(config, contactId, atMs = Date.now()) {
  const cfg = cleanConfig(config);
  const c = contactId ? get('SELECT * FROM contacts WHERE id=?', contactId) : null;
  const vars = c ? varsFor(c) : { first_name: 'Sam', full_name: 'Sam Example', agent_name: 'Your agent', company: currentTenant()?.name || 'Your company', property: 'Sample property', project: 'Sample project' };
  let t = atMs; const last = { email: null };
  return { sample: !c, timezone: workCalendar().timezone, steps: cfg.steps.map((s, i) => {
    t += s.delay_minutes * 60_000;
    if (s.type === 'task') return { index: i, type: 'task', condition: s.condition, at: utc(t), title: renderTemplate(s.title, vars) };
    let when = sendTimeFor(t, cfg);
    if (last.email) { const minGap = last.email + cfg.frequency.min_gap_hours * 3600e3; if (when < minGap) when = sendTimeFor(minGap, cfg); }
    last.email = when; t = Math.max(t, when);
    return { index: i, type: 'email', category: s.category, condition: s.condition, at: utc(when), subject: renderTemplate(s.subject, vars), body: renderTemplate(s.body, vars) };
  }) };
}
/** Send one step to the signed-in user's own address, to see the real email. It counts against the allowance. */
export function sendTest(sequenceId, stepIndex, user) {
  const s = getSequence(sequenceId);
  const st = s.config.steps[stepIndex];
  if (!st || st.type !== 'email') throw bad('Choose an email step');
  if (!user?.email) throw forbidden('Your account has no email address to send the test to');
  const vars = { ...varsFor({ full_name: user.name, first_name: String(user.name || '').split(' ')[0] }), property: 'Sample property' };
  const subject = `[Test] ${renderTemplate(st.subject, vars)}`.slice(0, 300);
  return enqueue({ tenant: currentTenant(), category: 'operational', to: user.email, subject, heading: subject, lines: renderTemplate(st.body, vars).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean), senderId: s.sender_id, idemKey: `seqtest:${sequenceId}:${stepIndex}:${Date.now()}`, refKind: 'sequence_test', refId: String(sequenceId) });
}

export const enrollmentsFor = (contactId) => all('SELECT e.*, s.name sequence_name FROM sequence_enrollments e JOIN sequences s ON s.id=e.sequence_id WHERE e.contact_id=? ORDER BY e.id DESC', contactId);
export const sequenceLog = (enrollmentId) => all('SELECT * FROM sequence_log WHERE enrollment_id=? ORDER BY step_index', enrollmentId);
