// Appointments (viewings, site visits, calls, meetings). Each is optionally linked to a contact and a property, and is
// added to the owner's Google Calendar when they have connected it.
//
// Property visits are appointments with a life cycle: scheduled -> in progress (check-in) -> completed (check-out with an
// outcome), or canceled / no-show. Check-in and check-out keep the server's UTC time and, when the agent's device shared
// one, the location reading with its capture time and accuracy. A reading is evidence only: it never proves presence.
// Times and distances follow shared/visits.js; docs/property-visits.md explains the rules.
import { Router } from 'express';
import { all, get, run, tx, getSetting, setSetting } from '../db.js';
import { audit, activity, notify } from '../audit.js';
import { asyncH, bad, notFound, forbidden, now, HttpError } from '../util.js';
import { can, hasPerm } from '../rbac.js';
import { currentRegion } from '../regions/runtime.js';
import { syncAppointment, calendarConnected } from '../integrations/googleCalendar.js';
import { assertContactAccess, syncFollowup } from './crm.js';
import {
  TRANSITIONS, OUTCOMES, VISIT_DEFAULTS, canMove, normState, validTimeZone, wallToMs, msToWall, toUtcIso, zoneLabel, haversineM, validCoord, proximity, classifyReading,
} from '../../../shared/visits.js';

const r = Router();
const KINDS = ['viewing', 'site_visit', 'meeting', 'call', 'signing', 'other'];
const STAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const norm = (s) => String(s).replace('T', ' ').padEnd(19, ':00').slice(0, 19);
const conflict = (msg, extra) => new HttpError(409, msg, extra);
const workspaceTz = () => currentRegion().config.timezone;
const tzOf = (a) => (a?.timezone && validTimeZone(a.timezone) ? a.timezone : workspaceTz());

// ---- workspace settings for visits (Settings are per workspace; nothing here is per country)
const SETTING_KEYS = { proximity_m: 'visit_proximity_m', max_fix_age_s: 'visit_max_fix_age_s', manual_exception: 'visit_manual_exception', retention_days: 'visit_retention_days', location_notice: 'visit_location_notice' };
export function visitSettings() {
  const n = (k, def, lo, hi) => { const v = Number(getSetting(SETTING_KEYS[k], def)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def; };
  return {
    proximity_m: n('proximity_m', VISIT_DEFAULTS.proximity_m, 25, 5000),
    max_fix_age_s: n('max_fix_age_s', VISIT_DEFAULTS.max_fix_age_s, 15, 3600),
    manual_exception: getSetting(SETTING_KEYS.manual_exception, VISIT_DEFAULTS.manual_exception ? '1' : '0') === '1',
    retention_days: n('retention_days', VISIT_DEFAULTS.retention_days, 0, 3650),
    // shown to the agent before the device asks for location; the business writes its own (no legal claims here)
    location_notice: getSetting(SETTING_KEYS.location_notice, '') || '',
  };
}

function clean(b, existing = {}) {
  const starts = b.starts_at ?? existing.starts_at;
  let ends = b.ends_at ?? existing.ends_at;
  if (!starts || !STAMP.test(String(starts))) throw bad('Choose a start date and time.');
  const tzIn = b.timezone !== undefined ? (String(b.timezone || '').trim() || null) : existing.timezone ?? null;
  if (tzIn && !validTimeZone(tzIn)) throw bad('Choose a valid time zone.');
  const tz = tzIn || workspaceTz();
  const s = norm(starts);
  const startMs = wallToMs(s, tz);
  if (!Number.isFinite(startMs)) throw bad('Choose a start date and time.');
  // a moved start keeps the old length unless a new end was given
  if (b.starts_at !== undefined && b.ends_at === undefined && existing.starts_at) ends = null;
  let endMs;
  if (!ends) endMs = startMs + 3600e3;
  else {
    if (!STAMP.test(String(ends))) throw bad('The end time is not valid.');
    endMs = wallToMs(norm(ends), tz);
    // an end inside the repeated hour of a fall-back night means its second occurrence when the first is too early
    if (endMs <= startMs) endMs = wallToMs(norm(ends), tz, { later: true });
  }
  if (!(endMs > startMs)) throw bad('The appointment must end after it starts.');
  const kind = b.kind ?? existing.kind ?? 'viewing';
  if (!KINDS.includes(kind)) throw bad('Choose a kind of appointment.');
  const title = String(b.title ?? existing.title ?? '').trim();
  if (!title) throw bad('Give the appointment a title.');
  return {
    title: title.slice(0, 160), kind, starts_at: msToWall(startMs, tz), ends_at: msToWall(endMs, tz), timezone: tzIn, starts_utc: toUtcIso(startMs), ends_utc: toUtcIso(endMs),
    location: String(b.location ?? existing.location ?? '').slice(0, 200) || null, notes: String(b.notes ?? existing.notes ?? '').slice(0, 1000) || null,
  };
}
const isManager = (req) => !req.user.own_scope;
const mineOr403 = (req, a) => { if (req.user.own_scope && a.user_id !== req.user.id) throw forbidden('This appointment belongs to someone else'); };
const load = (id) => { const a = get('SELECT * FROM appointments WHERE id=?', Number(id)); if (!a) throw notFound('Appointment not found'); return a; };
const keyOf = (req, b) => {
  const k = String(req.get('Idempotency-Key') || b.client_key || '').trim();
  if (k && !/^[\w.:-]{8,80}$/.test(k)) throw bad('The request key is not valid.');
  return k || null;
};

/** Who the visit is for. Managers may book any active staff member; agents with their own scope book themselves. */
function agentFor(req, b, existing) {
  const want = b.agent_id ?? b.user_id;
  if (want === undefined || want === null || want === '') return existing?.user_id ?? req.user.id;
  const id = Number(want);
  if (id === req.user.id) return id;
  if (!isManager(req) || !hasPerm(req.user, 'crm', 'edit')) throw forbidden('You can only schedule visits for yourself');
  if (!get('SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1 AND r.portal=0', id)) throw bad('Choose an active staff member as the agent.');
  return id;
}
function checkLinks(req, b) {
  const contactId = b.contact_id ? Number(b.contact_id) : null;
  const propertyId = b.property_id ? Number(b.property_id) : null;
  if (contactId) assertContactAccess(req, get('SELECT * FROM contacts WHERE id=?', contactId));
  if (propertyId) {
    const p = get('SELECT id, status, created_by, agent_id FROM properties WHERE id=?', propertyId);
    if (!p) throw notFound('Property not found');
    if (req.user.own_scope && !['available', 'featured', 'reserved'].includes(p.status) && p.created_by !== req.user.id && p.agent_id !== req.user.id) throw forbidden('This property is not available to you');
  }
  return { contactId, propertyId };
}

const LIST_SQL = `SELECT a.*, c.full_name AS contact_name, p.title AS property_title, p.lat AS property_lat, p.lng AS property_lng, u.name AS user_name
  FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id LEFT JOIN properties p ON p.id=a.property_id LEFT JOIN users u ON u.id=a.user_id`;
/** What every screen gets: the zone the visit is fixed in, its label at that moment, and the UTC instants. */
function view(a) {
  if (!a) return a;
  const tz = tzOf(a);
  const startMs = a.starts_utc ? Date.parse(a.starts_utc) : wallToMs(a.starts_at, tz);
  const endMs = a.ends_utc ? Date.parse(a.ends_utc) : wallToMs(a.ends_at, tz);
  return { ...a, status: normState(a.status), tz, tz_label: zoneLabel(tz, startMs), starts_utc: a.starts_utc || (Number.isFinite(startMs) ? toUtcIso(startMs) : null), ends_utc: a.ends_utc || (Number.isFinite(endMs) ? toUtcIso(endMs) : null),
    has_property_location: validCoord(Number(a.property_lat), Number(a.property_lng)), next: TRANSITIONS[normState(a.status)] || [] };
}
const one = (id) => view(get(`${LIST_SQL} WHERE a.id=?`, id));

r.get('/', can('crm', 'view'), (req, res) => {
  const where = []; const params = [];
  if (req.user.own_scope) { where.push('a.user_id=?'); params.push(req.user.id); }
  else if (req.query.mine === '1') { where.push('a.user_id=?'); params.push(req.user.id); }
  else if (req.query.agent_id) { where.push('a.user_id=?'); params.push(Number(req.query.agent_id)); }
  if (req.query.from) { where.push('a.starts_at>=?'); params.push(`${req.query.from} 00:00:00`); }
  if (req.query.to) { where.push('a.starts_at<=?'); params.push(`${req.query.to} 23:59:59`); }
  if (req.query.contact_id) { where.push('a.contact_id=?'); params.push(Number(req.query.contact_id)); }
  if (req.query.property_id) { where.push('a.property_id=?'); params.push(Number(req.query.property_id)); }
  if (req.query.status) { const st = String(req.query.status).split(',').map(normState).filter((s) => TRANSITIONS[s]); if (st.length) { where.push(`a.status IN (${st.map(() => '?').join(',')})`); params.push(...st); } }
  const rows = all(`${LIST_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.starts_at LIMIT 300`, ...params);
  res.json({ calendar_connected: calendarConnected(req.user.id), timezone: workspaceTz(), settings: visitSettings(), items: rows.map(view) });
});

/** People a visit can be assigned to: every active staff member for managers, only yourself for own-scope agents. */
r.get('/agents', can('crm', 'view'), (req, res) => {
  if (req.user.own_scope) return res.json([{ id: req.user.id, name: req.user.name }]);
  res.json(all('SELECT u.id, u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 ORDER BY u.name'));
});
r.get('/visit-settings', can('crm', 'view'), (_req, res) => res.json(visitSettings()));
r.put('/visit-settings', can('settings', 'edit'), (req, res) => {
  const b = req.body || {};
  for (const k of ['proximity_m', 'max_fix_age_s', 'retention_days']) if (b[k] !== undefined) { const v = Number(b[k]); if (!Number.isFinite(v) || v < 0) throw bad(`${k.replace(/_/g, ' ')} must be a number.`); setSetting(SETTING_KEYS[k], Math.round(v)); }
  if (b.manual_exception !== undefined) setSetting(SETTING_KEYS.manual_exception, b.manual_exception ? '1' : '0');
  if (b.location_notice !== undefined) setSetting(SETTING_KEYS.location_notice, String(b.location_notice || '').slice(0, 1500));
  audit(req, 'Updated visit settings', 'settings', null, Object.keys(b).join(', '));
  res.json(visitSettings());
});

r.get('/:id(\\d+)', can('crm', 'view'), (req, res) => {
  const a = load(req.params.id);
  mineOr403(req, a);
  const checks = all('SELECT id, kind, user_id, server_at, location_status, lat, lng, accuracy_m, captured_at, distance_m, proximity, radius_m, manual_reason FROM visit_checks WHERE appointment_id=? ORDER BY id', a.id);
  const task = a.followup_task_id ? get('SELECT id, title, due_date, status, assigned_to FROM tasks WHERE id=?', a.followup_task_id) : null;
  res.json({ ...one(a.id), checks, followup_task: task, settings: visitSettings() });
});

r.post('/', can('crm', 'edit'), asyncH(async (req, res) => {
  const b = req.body || {};
  const key = keyOf(req, b);
  // a retried request (same key from the same person) returns the visit it already created
  if (key) { const prev = get('SELECT id FROM appointments WHERE created_by=? AND client_key=?', req.user.id, key); if (prev) return res.status(200).json({ ...one(prev.id), replayed: true }); }
  const c = clean(b);
  const { contactId, propertyId } = checkLinks(req, b);
  const agent = agentFor(req, b);
  const id = Number(run(`INSERT INTO appointments(contact_id, property_id, user_id, title, kind, starts_at, ends_at, timezone, starts_utc, ends_utc, location, notes, client_key, created_by, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, contactId, propertyId, agent, c.title, c.kind, c.starts_at, c.ends_at, c.timezone, c.starts_utc, c.ends_utc, c.location, c.notes, key, req.user.id, now()).lastInsertRowid);
  audit(req, 'Created appointment', 'appointment', id, c.title);
  if (contactId) activity(contactId, req.user, 'Appointment scheduled', { detail: `${c.title} · ${c.starts_at} ${tzOf(c)}`, entityType: 'appointment', entityId: id });
  if (agent !== req.user.id) notify(agent, 'appointment', 'Visit scheduled for you', `${c.title} · ${c.starts_at} (${tzOf(c)})`, '/appointments', { dedupe: `appt-assigned-${id}-${agent}` });
  await syncAppointment(id);
  res.status(201).json(one(id));
}));

r.put('/:id(\\d+)', can('crm', 'edit'), asyncH(async (req, res) => {
  const a = load(req.params.id);
  mineOr403(req, a);
  if (normState(a.status) !== 'scheduled') throw conflict('Only a scheduled appointment can be changed.');
  const b = req.body || {};
  const c = clean(b, a);
  const links = checkLinks(req, { contact_id: b.contact_id !== undefined ? b.contact_id : a.contact_id, property_id: b.property_id !== undefined ? b.property_id : a.property_id });
  const agent = agentFor(req, b, a);
  run('UPDATE appointments SET title=?, kind=?, starts_at=?, ends_at=?, timezone=?, starts_utc=?, ends_utc=?, location=?, notes=?, contact_id=?, property_id=?, user_id=? WHERE id=?',
    c.title, c.kind, c.starts_at, c.ends_at, c.timezone, c.starts_utc, c.ends_utc, c.location, c.notes, links.contactId, links.propertyId, agent, a.id);
  if (agent !== a.user_id && agent !== req.user.id) notify(agent, 'appointment', 'Visit assigned to you', `${c.title} · ${c.starts_at} (${tzOf(c)})`, '/appointments', { dedupe: `appt-assigned-${a.id}-${agent}` });
  audit(req, 'Updated appointment', 'appointment', a.id, c.title);
  await syncAppointment(a.id);
  res.json(one(a.id));
}));

// ---- life cycle
/** The location part of a check-in/out: classified on the server, distance in metres when both points are known. */
function evidence(a, reading) {
  const s = visitSettings();
  const serverMs = Date.now();
  const c = classifyReading(reading, { serverMs, maxAgeS: s.max_fix_age_s, manualAllowed: s.manual_exception });
  if (c.error) throw bad(c.error);
  const p = a.property_id ? get('SELECT lat, lng FROM properties WHERE id=?', a.property_id) : null;
  let distance = null;
  if (c.location_status === 'verified' && p && validCoord(Number(p.lat), Number(p.lng))) distance = Math.round(haversineM({ lat: c.lat, lng: c.lng }, { lat: Number(p.lat), lng: Number(p.lng) }));
  return { ...c, server_at: toUtcIso(serverMs), distance_m: distance, proximity: distance == null ? 'unknown' : proximity(distance, c.accuracy_m, s.proximity_m), radius_m: s.proximity_m };
}
function recordCheck(req, a, kind, ev, key) {
  run(`INSERT INTO visit_checks(appointment_id, user_id, kind, server_at, location_status, lat, lng, accuracy_m, captured_at, distance_m, proximity, radius_m, manual_reason, client_key, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, a.id, req.user.id, kind, ev.server_at, ev.location_status, ev.lat ?? null, ev.lng ?? null, ev.accuracy_m ?? null, ev.captured_at ?? null,
  ev.distance_m, ev.proximity, ev.radius_m, ev.manual_reason ?? null, key, now());
}
const LOC_TEXT = { verified: 'location captured', stale: 'location reading delivered late', denied: 'location permission denied', unavailable: 'location unavailable', manual: 'manual exception' };
/** Only the agent the visit is assigned to records evidence, from their own sign-in. */
function assertAgent(req, a) { if (a.user_id !== req.user.id) throw forbidden('Only the agent assigned to this visit can check in or out.'); }
/** A retried check-in/out (same key) answers with the visit as it now stands instead of failing or recording twice. */
const replay = (req, key) => (key ? get('SELECT appointment_id FROM visit_checks WHERE user_id=? AND client_key=?', req.user.id, key) : null);

r.post('/:id(\\d+)/check-in', can('crm', 'edit'), asyncH(async (req, res) => {
  const b = req.body || {};
  const a = load(req.params.id);
  assertAgent(req, a);
  const key = keyOf(req, b);
  const prev = replay(req, key);
  if (prev) { if (prev.appointment_id !== a.id) throw conflict('This request key was used for another visit.'); return res.json({ ...one(a.id), replayed: true }); }
  if (!canMove(normState(a.status), 'in_progress')) throw conflict(normState(a.status) === 'in_progress' ? 'You are already checked in to this visit.' : 'This visit can no longer be checked in.');
  if (a.kind === 'call') throw bad('Calls have no check-in.');
  const ev = evidence(a, b.location);
  tx(() => {
    recordCheck(req, a, 'check_in', ev, key);
    run("UPDATE appointments SET status='in_progress', checked_in_at=?, status_by=?, status_at=? WHERE id=?", ev.server_at, req.user.id, ev.server_at, a.id);
  });
  audit(req, 'Checked in to visit', 'appointment', a.id, `${a.title} · ${LOC_TEXT[ev.location_status]}${ev.distance_m != null ? ` · ${ev.distance_m} m` : ''}`);
  if (a.contact_id) activity(a.contact_id, req.user, 'Visit started', { detail: `${a.title} · ${LOC_TEXT[ev.location_status]}`, entityType: 'appointment', entityId: a.id });
  res.json(one(a.id));
}));

r.post('/:id(\\d+)/check-out', can('crm', 'edit'), asyncH(async (req, res) => {
  const b = req.body || {};
  const a = load(req.params.id);
  assertAgent(req, a);
  const key = keyOf(req, b);
  const prev = replay(req, key);
  if (prev) { if (prev.appointment_id !== a.id) throw conflict('This request key was used for another visit.'); return res.json({ ...one(a.id), replayed: true }); }
  if (!canMove(normState(a.status), 'completed')) throw conflict(normState(a.status) === 'completed' ? 'This visit is already completed.' : 'Check in before checking out.');
  if (!OUTCOMES.includes(b.outcome)) throw bad('Choose the outcome of the visit.');
  const f = b.followup && String(b.followup.title || '').trim() ? b.followup : null;
  if (f && f.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(f.due_date))) throw bad('The follow-up date is not valid.');
  const ev = evidence(a, b.location);
  let taskId = a.followup_task_id || null;
  tx(() => {
    recordCheck(req, a, 'check_out', ev, key);
    // at most one follow-up task per visit, however often the request is retried
    if (f && !taskId) {
      taskId = Number(run('INSERT INTO tasks(entity_type,entity_id,title,due_date,assigned_to,priority,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
        a.contact_id ? 'contact' : 'property', a.contact_id || a.property_id || null, String(f.title).trim().slice(0, 160), f.due_date || null, a.user_id, ['Low', 'Medium', 'High'].includes(f.priority) ? f.priority : 'Medium', req.user.id, now()).lastInsertRowid);
    }
    run("UPDATE appointments SET status='completed', checked_out_at=?, outcome=?, outcome_notes=?, followup_task_id=?, status_by=?, status_at=? WHERE id=?",
      ev.server_at, b.outcome, String(b.outcome_notes || '').slice(0, 2000) || null, taskId, req.user.id, ev.server_at, a.id);
  });
  if (taskId && a.contact_id) syncFollowup(a.contact_id);
  audit(req, 'Completed visit', 'appointment', a.id, `${a.title} · ${b.outcome} · ${LOC_TEXT[ev.location_status]}`);
  if (a.contact_id) activity(a.contact_id, req.user, 'Visit completed', { detail: `${a.title} · ${b.outcome.replace(/_/g, ' ')}${f ? ` · follow-up: ${f.title}` : ''}`, entityType: 'appointment', entityId: a.id });
  await syncAppointment(a.id);
  res.json(one(a.id));
}));

/** Cancel / no-show: the agent, or a manager with edit rights. Repeating the same move is harmless. */
function closeAs(to, label) {
  return asyncH(async (req, res) => {
    const a = load(req.params.id);
    mineOr403(req, a);
    const from = normState(a.status);
    if (from === to) return res.json({ ...one(a.id), replayed: true });
    if (!canMove(from, to)) throw conflict(`A ${from.replace('_', ' ')} visit cannot be marked ${label}.`);
    const note = String(req.body?.note || '').trim().slice(0, 500) || null;
    run('UPDATE appointments SET status=?, status_note=?, status_by=?, status_at=? WHERE id=?', to, note, req.user.id, toUtcIso(Date.now()), a.id);
    audit(req, to === 'canceled' ? 'Canceled appointment' : 'Marked visit no-show', 'appointment', a.id, [a.title, note].filter(Boolean).join(' · '));
    if (a.contact_id) activity(a.contact_id, req.user, to === 'canceled' ? 'Appointment canceled' : 'Visit no-show', { detail: a.title, entityType: 'appointment', entityId: a.id });
    await syncAppointment(a.id);
    res.json(one(a.id));
  });
}
r.post('/:id(\\d+)/cancel', can('crm', 'edit'), closeAs('canceled', 'canceled'));
r.post('/:id(\\d+)/no-show', can('crm', 'edit'), closeAs('no_show', 'no-show'));

// ---- reminders (run every few minutes for each workspace; notifications are de-duplicated)
export function runVisitReminders(nowMs = Date.now()) {
  let n = 0;
  const tz = workspaceTz();
  // a day either side of now in wall-clock terms covers every zone; the exact instant is checked below
  const rows = all("SELECT * FROM appointments WHERE status='scheduled' AND starts_at>=? AND starts_at<=?", msToWall(nowMs - 2 * 86400e3, tz), msToWall(nowMs + 2 * 86400e3, tz));
  for (const a0 of rows) {
    const a = view(a0);
    const start = Date.parse(a.starts_utc);
    if (!Number.isFinite(start)) continue;
    const when = `${a.starts_at.slice(0, 16)} (${a.tz_label})`;
    if (start > nowMs && start - nowMs <= 3600e3) { notify(a.user_id, 'appointment', `Coming up: ${a.title}`, when, '/appointments', { dedupe: `appt-soon-${a.id}-${a.starts_utc}` }); n++; }
    if (a.property_id && a.kind !== 'call' && nowMs - start >= 30 * 60e3 && nowMs - start <= 24 * 3600e3) { notify(a.user_id, 'appointment', `Not checked in: ${a.title}`, `${when}. Check in, or mark it canceled or no-show.`, '/appointments', { dedupe: `visit-late-${a.id}-${a.starts_utc}` }); n++; }
  }
  // configurable retention: coordinates go, the rest of the visit record stays
  const days = visitSettings().retention_days;
  if (days > 0) run('UPDATE visit_checks SET lat=NULL, lng=NULL, accuracy_m=NULL WHERE lat IS NOT NULL AND server_at<?', toUtcIso(nowMs - days * 86400e3));
  return { sent: n };
}

export default r;
