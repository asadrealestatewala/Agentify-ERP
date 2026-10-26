// Lead routing, assignment records and response targets (runs inside a workspace).
//
// * Routing: configurable rules pick an agent for a NEW lead (manual queue, round robin, or weighted round robin) among agents
//   who are eligible by team, project, city, availability and capacity. Nothing here ever moves an existing lead: enabling a rule
//   affects only leads that arrive afterwards, and a matched existing contact keeps its owner unless someone with authority
//   reassigns it explicitly. Choosing an agent and recording the assignment happen in one transaction (callers wrap in tx()).
// * Events are separate facts: assigned, accepted, contact attempt, human response. An automated acknowledgement or a sequence
//   email is stored with automated=1 and can never satisfy a response target; a phone call counts only when the call log shows
//   a completed outbound call by the assigned agent, and a manual log is labelled as manual.
// * Response targets use the workspace working calendar (weekend, holidays, hours, IANA timezone). Escalation is one-way and
//   idempotent: reminders and manager alerts fire once per assignment, an optional reassignment is capped, and everything stops
//   as soon as the target is met or the lead closes.
import { all, get, run, tx, getSetting, setSetting } from '../db.js';
import { activity, notify } from '../audit.js';
import { bad, jparse, forbidden, notFound, tenantTz } from '../util.js';
import { calendarChecker, workCalendar } from './workCalendar.js';
import { addBusinessMinutes, businessMinutesBetween } from './businessTime.js';
import { nextAgent } from './leads.js';
import { toUtcIso } from '../../../shared/visits.js';

export const utc = (ms = Date.now()) => toUtcIso(ms);
const ms = (iso) => Date.parse(iso);

// ---------------------------------------------------------------- settings
export const SLA_DEFAULTS = { enabled: false, accept_minutes: 30, first_response_minutes: 60, business_hours_only: true, remind_at_percent: 50, escalate_to_manager: true, reassign_after_minutes: null, max_reassignments: 2 };
export function slaSettings() { return { ...SLA_DEFAULTS, ...(jparse(getSetting('lead_sla'), {}) || {}) }; }
export function saveSla(b) {
  const cur = slaSettings(), out = { ...cur };
  const mins = (k, label, allowNull) => {
    if (b[k] === undefined) return;
    if (b[k] === null || b[k] === '') { if (!allowNull) throw bad(`${label} is required`); out[k] = null; return; }
    const n = Math.trunc(Number(b[k]));
    if (!(n >= 1 && n <= 60 * 24 * 14)) throw bad(`${label} must be from 1 minute to 14 days`);
    out[k] = n;
  };
  if (b.enabled !== undefined) out.enabled = !!b.enabled;
  mins('accept_minutes', 'Acceptance deadline', true); mins('first_response_minutes', 'First response target', false); mins('reassign_after_minutes', 'Reassign after', true);
  if (b.business_hours_only !== undefined) out.business_hours_only = !!b.business_hours_only;
  if (b.escalate_to_manager !== undefined) out.escalate_to_manager = !!b.escalate_to_manager;
  if (b.remind_at_percent !== undefined) { const n = Math.trunc(Number(b.remind_at_percent)); if (!(n >= 10 && n <= 95)) throw bad('Reminder point is 10 to 95 percent of the deadline'); out.remind_at_percent = n; }
  if (b.max_reassignments !== undefined) { const n = Math.trunc(Number(b.max_reassignments)); if (!(n >= 0 && n <= 5)) throw bad('Automatic reassignments: 0 to 5'); out.max_reassignments = n; }
  setSetting('lead_sla', JSON.stringify(out));
  return out;
}
const bizOpts = () => { const c = workCalendar(); return { tz: c.timezone || tenantTz(), isWorking: calendarChecker(), start: c.work_start, end: c.work_end }; };
/** Deadlines for an assignment made at `atMs` (UTC ISO strings, or null when targets are off). */
export function deadlinesFor(atMs, sla = slaSettings()) {
  if (!sla.enabled) return { accept_due_at: null, response_due_at: null };
  const o = { ...bizOpts(), businessOnly: sla.business_hours_only };
  return { accept_due_at: sla.accept_minutes ? utc(addBusinessMinutes(atMs, sla.accept_minutes, o)) : null, response_due_at: sla.first_response_minutes ? utc(addBusinessMinutes(atMs, sla.first_response_minutes, o)) : null };
}

// ---------------------------------------------------------------- stages
const stageKind = (stageId) => { const m = jparse(get('SELECT meta FROM lookups WHERE id=?', stageId)?.meta, {}); return m.kind || 'open'; };
export const isClosedStage = (stageId) => !!stageId && ['won', 'lost'].includes(stageKind(stageId));
export const leadIsOpen = (c) => !!c && !c.is_customer && !isClosedStage(c.stage_id);
const openCount = (agentId) => all('SELECT stage_id FROM contacts WHERE agent_id=? AND is_customer=0', agentId).filter((c) => !isClosedStage(c.stage_id)).length;

// ---------------------------------------------------------------- profiles and rules
const lcList = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
export const getProfile = (userId) => { const p = get('SELECT * FROM agent_routing_profiles WHERE user_id=?', userId); return p ? { ...p, available: !!p.available, projects: jparse(p.projects, []), cities: jparse(p.cities, []) } : { user_id: userId, available: true, team: null, projects: [], cities: [], max_open: null, weight: 1 }; };
export function saveProfile(userId, b) {
  if (!get('SELECT 1 FROM users WHERE id=? AND active=1', userId)) throw notFound('User not found');
  const cur = getProfile(userId);
  const n = (v, lo, hi, label) => { if (v === null || v === '' || v === undefined) return null; const x = Math.trunc(Number(v)); if (!(x >= lo && x <= hi)) throw bad(`${label} must be ${lo} to ${hi}`); return x; };
  const next = { available: b.available === undefined ? cur.available : !!b.available, team: b.team === undefined ? cur.team : (String(b.team || '').trim().slice(0, 60) || null),
    projects: b.projects === undefined ? cur.projects : (b.projects || []).map(Number).filter(Boolean), cities: b.cities === undefined ? cur.cities : (b.cities || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 30),
    max_open: b.max_open === undefined ? cur.max_open : n(b.max_open, 1, 5000, 'Open lead limit'), weight: b.weight === undefined ? cur.weight : n(b.weight, 1, 20, 'Weight') ?? 1 };
  run(`INSERT INTO agent_routing_profiles(user_id,available,team,projects,cities,max_open,weight,updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET available=excluded.available, team=excluded.team, projects=excluded.projects, cities=excluded.cities, max_open=excluded.max_open, weight=excluded.weight, updated_at=excluded.updated_at`,
  userId, next.available ? 1 : 0, next.team, JSON.stringify(next.projects), JSON.stringify(next.cities), next.max_open, next.weight, utc());
  return getProfile(userId);
}

const ruleView = (r) => ({ ...r, active: !!r.active, match: jparse(r.match, {}), agent_ids: jparse(r.agent_ids, []) });
export const listRules = () => all('SELECT * FROM lead_routing_rules ORDER BY priority, id').map(ruleView);
export function saveRule(id, b, userId) {
  const name = String(b.name || '').trim();
  if (!name || name.length > 80) throw bad('Give the rule a name (up to 80 characters)');
  const mode = ['manual', 'round_robin', 'weighted'].includes(b.mode) ? b.mode : 'round_robin';
  const match = {};
  for (const k of ['sources', 'property_types', 'cities']) { const l = (b.match?.[k] || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 30); if (l.length) match[k] = l; }
  const pr = (b.match?.projects || []).map(Number).filter(Boolean); if (pr.length) match.projects = pr;
  const agents = (b.agent_ids || []).map((a) => (typeof a === 'object' ? { id: Number(a.id), weight: Math.min(20, Math.max(1, Math.trunc(Number(a.weight)) || 1)) } : { id: Number(a), weight: 1 })).filter((a) => a.id);
  if (mode !== 'manual' && !agents.length) throw bad('Choose at least one agent for this rule');
  for (const a of agents) if (!get("SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1 AND r.portal=0", a.id)) throw bad('One of the chosen agents is not an active staff member');
  const fb = b.fallback_agent_id ? Number(b.fallback_agent_id) : null;
  if (fb && !get('SELECT 1 FROM users WHERE id=? AND active=1', fb)) throw bad('The fallback owner is not an active user');
  const vals = [name, b.active === false ? 0 : 1, Math.trunc(Number(b.priority)) || 100, mode, JSON.stringify(match), JSON.stringify(agents), String(b.team || '').trim().slice(0, 60) || null, fb];
  if (id) { if (!get('SELECT 1 FROM lead_routing_rules WHERE id=?', id)) throw notFound('Rule not found'); run("UPDATE lead_routing_rules SET name=?,active=?,priority=?,mode=?,match=?,agent_ids=?,team=?,fallback_agent_id=?,updated_at=datetime('now') WHERE id=?", ...vals, id); return ruleView(get('SELECT * FROM lead_routing_rules WHERE id=?', id)); }
  const nid = Number(run('INSERT INTO lead_routing_rules(name,active,priority,mode,match,agent_ids,team,fallback_agent_id,created_by) VALUES(?,?,?,?,?,?,?,?,?)', ...vals, userId ?? null).lastInsertRowid);
  return ruleView(get('SELECT * FROM lead_routing_rules WHERE id=?', nid));
}
export const deleteRule = (id) => { run('DELETE FROM lead_routing_rules WHERE id=?', id); run('DELETE FROM lead_routing_state WHERE rule_id=?', id); };

const inList = (list, v) => !list?.length || (v != null && list.map((x) => String(x).toLowerCase()).includes(String(v).toLowerCase()));
/** Does a rule's match block fit this lead? An empty block matches every lead. */
export function ruleMatches(rule, c) {
  const m = rule.match || {};
  if (m.sources?.length && !inList(m.sources, c.lead_source)) return false;
  if (m.projects?.length && !(c.project_id && m.projects.map(Number).includes(Number(c.project_id)))) return false;
  if (m.property_types?.length && !inList(m.property_types, c.property_type)) return false;
  if (m.cities?.length && !inList(m.cities, c.city) && !inList(m.cities, c.pref_location)) return false;
  return true;
}
/** Eligible among the rule's agents: active, available, on the team, covering the project/city, under their capacity. */
export function eligibleAgents(rule, c, exclude = []) {
  const out = [];
  for (const a of rule.agent_ids) {
    if (exclude.includes(a.id)) continue;
    if (!get("SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1 AND r.portal=0", a.id)) continue;
    const p = getProfile(a.id);
    if (!p.available) continue;
    if (rule.team && String(p.team || '').toLowerCase() !== rule.team.toLowerCase()) continue;
    if (p.projects.length && !(c.project_id && p.projects.map(Number).includes(Number(c.project_id)))) continue;
    if (lcList(p.cities).length && !(lcList(p.cities).includes(String(c.city || '').toLowerCase()) || lcList(p.cities).includes(String(c.pref_location || '').toLowerCase()))) continue;
    if (p.max_open && openCount(a.id) >= p.max_open) continue;
    out.push({ id: a.id, weight: Math.max(1, a.weight * 1 || 1) });
  }
  return out.sort((x, y) => x.id - y.id);
}

const state = (ruleId) => { const s = get('SELECT * FROM lead_routing_state WHERE rule_id=?', ruleId); return { last: s?.last_agent_id ?? 0, weights: jparse(s?.weights, {}) }; };
const saveState = (ruleId, last, weights) => run('INSERT INTO lead_routing_state(rule_id,last_agent_id,weights) VALUES(?,?,?) ON CONFLICT(rule_id) DO UPDATE SET last_agent_id=excluded.last_agent_id, weights=excluded.weights', ruleId, last, JSON.stringify(weights || {}));

const managerId = () => get("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Sales Manager' AND u.active=1 ORDER BY u.id LIMIT 1")?.id ?? null;
export const defaultOwner = () => { const id = Number(getSetting('lead_default_owner', 0)) || null; return id && get('SELECT 1 FROM users WHERE id=? AND active=1', id) ? id : null; };

/**
 * Pick the owner for a new lead. Returns { agentId|null, ruleId|null, kind, reason }.
 * Call inside tx() together with recordAssignment so two simultaneous leads cannot both read the same round-robin position.
 */
export function chooseAgent(c, { exclude = [] } = {}) {
  const rules = all('SELECT * FROM lead_routing_rules WHERE active=1 ORDER BY priority, id').map(ruleView);
  if (!rules.length) { const id = nextAgent(); return { agentId: id, ruleId: null, kind: 'auto', reason: id ? 'Round robin among sales agents (no routing rules set)' : 'No sales agent available' }; }
  const rule = rules.find((r) => ruleMatches(r, c));
  if (!rule) { const d = defaultOwner(); if (d) return { agentId: d, ruleId: null, kind: 'fallback', reason: 'No routing rule matched; default owner' }; const id = nextAgent(); return { agentId: id, ruleId: null, kind: 'auto', reason: 'No routing rule matched; round robin among sales agents' }; }
  if (rule.mode === 'manual') return { agentId: null, ruleId: rule.id, kind: 'manual_queue', reason: `Rule "${rule.name}": waiting for manual assignment` };
  const pool = eligibleAgents(rule, c, exclude);
  if (!pool.length) {
    const fb = [rule.fallback_agent_id, defaultOwner(), managerId()].find((id) => id && !exclude.includes(id) && get('SELECT 1 FROM users WHERE id=? AND active=1', id));
    return { agentId: fb ?? null, ruleId: rule.id, kind: 'fallback', reason: `Rule "${rule.name}": no eligible agent${fb ? '; assigned to the fallback owner' : ' and no fallback owner set'}` };
  }
  const st = state(rule.id);
  let pick;
  if (rule.mode === 'weighted') {
    const w = {}; let total = 0;
    for (const a of pool) { w[a.id] = (st.weights[a.id] || 0) + a.weight; total += a.weight; }
    pick = pool.reduce((best, a) => (w[a.id] > w[best.id] ? a : best), pool[0]);
    w[pick.id] -= total;
    saveState(rule.id, pick.id, w);
  } else {
    pick = pool.find((a) => a.id > st.last) || pool[0];
    saveState(rule.id, pick.id, {});
  }
  return { agentId: pick.id, ruleId: rule.id, kind: 'auto', reason: `Rule "${rule.name}": ${rule.mode === 'weighted' ? 'weighted' : ''} round robin` .replace('  ', ' ') };
}

// ---------------------------------------------------------------- assignment records and events
export function addEvent(contactId, type, { assignmentId = null, actorId = null, automated = false, channel = null, evidence = null, detail = null, dedupe = null, atMs } = {}) {
  const r = run('INSERT OR IGNORE INTO lead_events(contact_id,assignment_id,type,actor_id,automated,channel,evidence,detail,dedupe,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    contactId, assignmentId, type, actorId, automated ? 1 : 0, channel, evidence, detail ? String(detail).slice(0, 500) : null, dedupe, utc(atMs));
  return r.changes ? Number(r.lastInsertRowid) : null;
}
export const currentAssignment = (contactId) => get('SELECT * FROM lead_assignments WHERE contact_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1', contactId) || null;

/** Write the assignment (and move the contact) with its reason, rule, actor and time. Idempotent for the same owner. */
export function recordAssignment(contactId, pick, { kind, actor = null, atMs = Date.now(), quiet = false } = {}) {
  return tx(() => {
    const cur = currentAssignment(contactId);
    const agentId = pick.agentId ?? null;
    if (cur && cur.agent_id === agentId && kind !== 'reassign_auto') return cur.id;
    if (cur) run('UPDATE lead_assignments SET ended_at=?, end_reason=? WHERE id=?', utc(atMs), kind === 'manual' ? 'manually reassigned' : 'reassigned', cur.id);
    const d = agentId ? deadlinesFor(atMs) : { accept_due_at: null, response_due_at: null };
    // someone who takes a lead for themselves has accepted it by doing so
    const self = !!agentId && actor?.id === agentId;
    const id = Number(run('INSERT INTO lead_assignments(contact_id,agent_id,rule_id,kind,reason,actor_id,assigned_at,accept_due_at,response_due_at,accepted_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      contactId, agentId, pick.ruleId ?? null, pick.kind || kind || 'auto', String(pick.reason || '').slice(0, 300), actor?.id ?? null, utc(atMs), self ? null : d.accept_due_at, d.response_due_at, self ? utc(atMs) : null).lastInsertRowid);
    run('UPDATE contacts SET agent_id=? WHERE id=?', agentId, contactId);
    addEvent(contactId, agentId ? 'assigned' : 'unassigned', { assignmentId: id, actorId: actor?.id ?? null, automated: !actor, detail: pick.reason, atMs });
    if (quiet) return id;
    if (agentId) {
      const name = get('SELECT full_name FROM contacts WHERE id=?', contactId)?.full_name;
      activity(contactId, actor, 'Contact assigned', { field: 'Sales agent', next: get('SELECT name FROM users WHERE id=?', agentId)?.name, detail: pick.reason });
      if (agentId !== actor?.id) notify(agentId, 'lead', 'New lead assigned', `${name || 'A lead'} was assigned to you. ${d.accept_due_at ? 'Please accept it.' : ''}`.trim(), `/contacts/${contactId}`, { dedupe: `lead-assigned-${id}` });
    } else {
      const m = managerId();
      notify(m, 'lead', 'Lead waiting for an owner', pick.reason || 'No owner could be chosen', `/contacts/${contactId}`, { dedupe: `lead-unassigned-${id}` });
    }
    return id;
  });
}

function myOpenAssignment(contactId, user) {
  const a = currentAssignment(contactId);
  if (!a || a.agent_id !== user.id) throw forbidden('This lead is not assigned to you');
  return a;
}
export function acceptLead(contactId, user, atMs = Date.now()) {
  const a = myOpenAssignment(contactId, user);
  if (a.accepted_at) return { ...a, replayed: true };
  run('UPDATE lead_assignments SET accepted_at=? WHERE id=?', utc(atMs), a.id);
  addEvent(contactId, 'accepted', { assignmentId: a.id, actorId: user.id, atMs });
  activity(contactId, user, 'Lead accepted');
  return get('SELECT * FROM lead_assignments WHERE id=?', a.id);
}
const CHANNELS = ['phone', 'email', 'sms', 'in_person', 'other'];
/** An attempt (dialled, left a voicemail, sent a message). It is NOT a response. */
export function logAttempt(contactId, user, { channel = 'phone', note } = {}, atMs = Date.now()) {
  if (!CHANNELS.includes(channel)) throw bad('Choose how you tried to reach the customer');
  const a = currentAssignment(contactId);
  addEvent(contactId, 'contact_attempt', { assignmentId: a?.id ?? null, actorId: user.id, channel, evidence: 'manual_log', detail: note, atMs });
  activity(contactId, user, 'Contact attempt logged', { detail: `${channel.replace('_', ' ')}${note ? ` · ${String(note).slice(0, 120)}` : ''} (manual record)` });
}
/** A real two-way human response by staff (spoke to them, replied personally). Manual records are labelled as such. */
export function logHumanResponse(contactId, user, { channel = 'phone', note, evidence = 'manual_log' } = {}, atMs = Date.now()) {
  if (!CHANNELS.includes(channel)) throw bad('Choose how you responded');
  const a = currentAssignment(contactId);
  addEvent(contactId, 'human_response', { assignmentId: a?.id ?? null, actorId: user?.id ?? null, channel, evidence, detail: note, atMs });
  if (a && !a.first_human_response_at) run('UPDATE lead_assignments SET first_human_response_at=?, accepted_at=COALESCE(accepted_at,?) WHERE id=?', utc(atMs), utc(atMs), a.id);
  if (user) activity(contactId, user, 'Customer responded to by staff', { detail: `${channel.replace('_', ' ')}${evidence === 'manual_log' ? ' (manual record)' : ''}${note ? ` · ${String(note).slice(0, 120)}` : ''}` });
}
/** An automated message (acknowledgement, sequence email). Recorded, never counted as a human response. */
export const recordAutomated = (contactId, detail, dedupe, atMs) => addEvent(contactId, 'automated_message', { automated: true, channel: 'email', evidence: 'system', detail, dedupe, atMs });

/**
 * Completed outbound calls by the assigned agent are provider-side evidence of a human response. Imported idempotently
 * (one event per call id) so repeated runs never double count.
 */
export function syncCallEvidence() {
  let n = 0;
  for (const a of all('SELECT * FROM lead_assignments WHERE ended_at IS NULL AND first_human_response_at IS NULL AND agent_id IS NOT NULL')) {
    const call = get("SELECT id, started_at FROM calls WHERE contact_id=? AND user_id=? AND direction='outbound' AND status='completed' AND COALESCE(duration,0)>0 ORDER BY id LIMIT 1", a.contact_id, a.agent_id);
    if (!call) continue;
    const at = Date.parse(`${String(call.started_at).replace(' ', 'T')}Z`);
    if (Number.isFinite(at) && at < ms(a.assigned_at)) continue;
    if (addEvent(a.contact_id, 'human_response', { assignmentId: a.id, actorId: a.agent_id, channel: 'phone', evidence: 'call_log', detail: `Call ${call.id}`, dedupe: `call:${call.id}` })) { run('UPDATE lead_assignments SET first_human_response_at=?, accepted_at=COALESCE(accepted_at,?) WHERE id=?', utc(), utc(), a.id); n++; }
  }
  return n;
}

// ---------------------------------------------------------------- manual assignment and ownership
/** Explicit assignment by a person with authority. Used by the contact editor and by bulk assign. */
export function assignManually(contactId, agentId, user, reason = 'Assigned manually') {
  const c = get('SELECT id, agent_id FROM contacts WHERE id=?', contactId);
  if (!c) throw notFound('Contact not found');
  return recordAssignment(contactId, { agentId: agentId || null, ruleId: null, kind: 'manual', reason }, { kind: 'manual', actor: user });
}

// ---------------------------------------------------------------- escalation job
const dueMs = (iso) => (iso ? ms(iso) : null);
/**
 * One pass for this workspace: import call evidence, then for every open assignment past a target send the reminder once,
 * alert the manager once, and (if switched on, and capped) reassign once. A satisfied target stops all of it.
 */
export function runLeadSla(nowMs = Date.now()) {
  const sla = slaSettings();
  const out = { reminded: 0, escalated: 0, reassigned: 0 };
  syncCallEvidence();
  if (!sla.enabled) return out;
  for (const a of all('SELECT * FROM lead_assignments WHERE ended_at IS NULL AND agent_id IS NOT NULL')) {
    const c = get('SELECT * FROM contacts WHERE id=?', a.contact_id);
    if (!c) continue;
    if (!leadIsOpen(c)) { run('UPDATE lead_assignments SET ended_at=?, end_reason=? WHERE id=?', utc(nowMs), 'lead closed', a.id); continue; }
    const targets = [];
    if (!a.accepted_at && a.accept_due_at) targets.push({ kind: 'accept', due: dueMs(a.accept_due_at), label: 'accept' });
    if (!a.first_human_response_at && a.response_due_at) targets.push({ kind: 'response', due: dueMs(a.response_due_at), label: 'respond to' });
    for (const t of targets) {
      const startMs = ms(a.assigned_at), span = t.due - startMs;
      const remindAt = startMs + span * (sla.remind_at_percent / 100);
      const name = c.full_name;
      if (nowMs >= remindAt && nowMs < t.due && addEvent(c.id, 'reminder', { assignmentId: a.id, automated: true, detail: `${t.kind} reminder`, dedupe: `rem:${a.id}:${t.kind}`, atMs: nowMs })) {
        notify(a.agent_id, 'lead', `Reminder: ${t.label} ${name}`, 'This lead is close to its response deadline.', `/contacts/${c.id}`, { dedupe: `lead-rem-${a.id}-${t.kind}` }); out.reminded += 1;
      }
      if (nowMs >= t.due) {
        if (sla.escalate_to_manager && addEvent(c.id, 'escalated', { assignmentId: a.id, automated: true, detail: `${t.kind} deadline passed`, dedupe: `esc:${a.id}:${t.kind}`, atMs: nowMs })) {
          const m = managerId();
          notify([m, a.agent_id], 'lead', `Overdue: ${name}`, `The ${t.kind === 'accept' ? 'acceptance' : 'first response'} deadline has passed.`, `/contacts/${c.id}`, { dedupe: `lead-esc-${a.id}-${t.kind}` }); out.escalated += 1;
        }
        const reassignAt = sla.reassign_after_minutes ? t.due + sla.reassign_after_minutes * 60_000 : null;
        if (reassignAt && nowMs >= reassignAt) {
          const prior = all("SELECT COUNT(*) n FROM lead_assignments WHERE contact_id=? AND end_reason='escalation reassignment'", c.id)[0].n;
          if (prior < sla.max_reassignments) {
            const tried = all('SELECT DISTINCT agent_id FROM lead_assignments WHERE contact_id=? AND agent_id IS NOT NULL', c.id).map((r) => r.agent_id);
            const pick = chooseAgent(c, { exclude: tried });
            if (pick.agentId && !tried.includes(pick.agentId)) {
              run("UPDATE lead_assignments SET ended_at=?, end_reason='escalation reassignment' WHERE id=?", utc(nowMs), a.id);
              recordAssignment(c.id, { ...pick, kind: 'escalation', reason: `Reassigned after the ${t.kind === 'accept' ? 'acceptance' : 'response'} deadline passed. ${pick.reason}` }, { kind: 'reassign_auto', atMs: nowMs });
              out.reassigned += 1;
            }
          }
        }
        break; // one target per assignment per pass
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- read models
export function contactFlow(contactId) {
  const cur = currentAssignment(contactId);
  return { assignment: cur, history: all('SELECT a.*, u.name agent_name, r.name rule_name FROM lead_assignments a LEFT JOIN users u ON u.id=a.agent_id LEFT JOIN lead_routing_rules r ON r.id=a.rule_id WHERE a.contact_id=? ORDER BY a.id DESC', contactId),
    events: all('SELECT e.*, u.name actor_name FROM lead_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.contact_id=? ORDER BY e.id DESC LIMIT 100', contactId).map((e) => ({ ...e, automated: !!e.automated })), sla: slaSettings() };
}
export { businessMinutesBetween, bizOpts };
