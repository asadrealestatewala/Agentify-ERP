// Lead conversion report (runs inside a workspace). Every figure says what it was divided by, and a lead that cannot be judged
// (it arrived before response tracking, or has no source) is counted separately instead of being guessed.
// Only people's actions count as responses: automated acknowledgements and sequence emails are reported on their own line.
import { all, get } from '../db.js';
import { jparse } from '../util.js';
import { wallToMs } from '../../../shared/visits.js';
import { workCalendar, calendarChecker } from './workCalendar.js';
import { businessMinutesBetween, bizOpts } from './leadFlow.js';

export const DEFINITIONS = {
  leads: 'Contacts created in the period (and, for an agent, assigned to that agent). Customers added without a lead stage are included.',
  tracked: 'Leads with at least one assignment record. Leads from before response tracking started are listed as "not tracked" and left out of the response figures.',
  assigned: 'Tracked leads that were given an owner.',
  accepted: 'Assigned leads their owner accepted (or took for themselves). Divided by assigned leads.',
  responded: 'Assigned leads where a person made a real two-way response: a completed outbound call in the call log, or a response recorded by staff. Automated messages, sequence emails and attempts do not count. Divided by assigned leads.',
  response_time: 'Minutes from assignment to the first human response, among leads that have one. Median and average, in calendar time and in working time.',
  sla: 'Of leads with a response target: met (human response by the deadline), missed (late or past deadline with none), still open (deadline not reached). Leads without a target are not included.',
  appointments: 'Leads with at least one appointment. Divided by tracked leads.',
  viewings: 'Leads with a completed viewing or site visit. Divided by leads with an appointment.',
  won: 'Leads now in a won stage or marked as customers. Divided by all leads in the period.',
  lost: 'Leads now in a lost stage. Divided by all leads in the period.',
};
const rate = (n, d) => ({ n, d, rate: d > 0 ? Math.round((n / d) * 1000) / 10 : null });
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const minutes = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
const stageOf = (id) => { const m = jparse(get('SELECT meta FROM lookups WHERE id=?', id)?.meta, {}); return m.kind || 'open'; };

/** `scope` = { ownerId } restricts to one agent's leads (own-scope users). */
export function conversionReport({ from, to, agentId = null, source = null, projectId = null, scope = {}, nowMs = Date.now() } = {}) {
  const tz = workCalendar().timezone;
  const toMs = to ? Date.parse(`${to}T23:59:59Z`) : nowMs, fromMs = from ? Date.parse(`${from}T00:00:00Z`) : toMs - 30 * 864e5;
  const owner = scope.ownerId || null;
  const rows = all('SELECT * FROM contacts WHERE created_at>=? AND created_at<=? ORDER BY id', new Date(fromMs - 36e5 * 36).toISOString().slice(0, 10), new Date(toMs + 36e5 * 36).toISOString().slice(0, 10) + ' 23:59:59')
    .filter((c) => { const t = wallToMs(String(c.created_at).slice(0, 19), tz); return t >= fromMs && t <= toMs; })
    .filter((c) => (!owner || c.agent_id === owner || c.created_by === owner) && (!agentId || c.agent_id === Number(agentId)) && (!source || String(c.lead_source || '') === source) && (!projectId || c.project_id === Number(projectId)));
  const stageKinds = new Map();
  const kind = (id) => { if (!stageKinds.has(id)) stageKinds.set(id, stageOf(id)); return stageKinds.get(id); };
  const biz = bizOpts();
  const t = { leads: rows.length, tracked: 0, not_tracked: 0, assigned: 0, unassigned: 0, accepted: 0, responded: 0, appts: 0, viewings: 0, won: 0, lost: 0 };
  const calMin = [], bizMin = [], sla = { met: 0, missed: 0, open: 0, none: 0 };
  const bySource = new Map(), byAgent = new Map();
  const bump = (m, key, label, f) => { if (!m.has(key)) m.set(key, { key, label, leads: 0, tracked: 0, assigned: 0, responded: 0, appointments: 0, won: 0 }); f(m.get(key)); };
  for (const c of rows) {
    const asg = all('SELECT * FROM lead_assignments WHERE contact_id=? ORDER BY id', c.id);
    const src = String(c.lead_source || '').trim() || 'Unknown';
    const appt = all('SELECT status FROM appointments WHERE contact_id=?', c.id);
    const completed = appt.some((a) => a.status === 'completed');
    const won = c.is_customer || kind(c.stage_id) === 'won', lost = !won && kind(c.stage_id) === 'lost';
    if (won) t.won++; if (lost) t.lost++;
    const owned = asg.filter((a) => a.agent_id);
    const tracked = asg.length > 0, assigned = owned.length > 0;
    const first = owned[0];
    const resp = owned.find((a) => a.first_human_response_at);
    const acc = owned.some((a) => a.accepted_at);
    if (tracked) t.tracked++; else t.not_tracked++;
    if (assigned) { t.assigned++; if (acc) t.accepted++; if (resp) t.responded++; } else if (tracked) t.unassigned++;
    if (tracked && appt.length) t.appts++;
    if (appt.length && completed) t.viewings++;
    if (resp) { calMin.push(minutes(resp.assigned_at, resp.first_human_response_at)); bizMin.push(businessMinutesBetween(Date.parse(resp.assigned_at), Date.parse(resp.first_human_response_at), { ...biz, businessOnly: true })); }
    for (const a of owned) {
      if (!a.response_due_at) { sla.none++; continue; }
      if (a.first_human_response_at) { if (Date.parse(a.first_human_response_at) <= Date.parse(a.response_due_at)) sla.met++; else sla.missed++; }
      else if (nowMs > Date.parse(a.response_due_at)) sla.missed++; else sla.open++;
    }
    bump(bySource, src, src, (r) => { r.leads++; if (tracked) r.tracked++; if (assigned) r.assigned++; if (resp) r.responded++; if (appt.length) r.appointments++; if (won) r.won++; });
    if (first) bump(byAgent, first.agent_id, get('SELECT name FROM users WHERE id=?', first.agent_id)?.name || `User ${first.agent_id}`, (r) => { r.leads++; r.assigned++; if (resp) r.responded++; if (appt.length) r.appointments++; if (won) r.won++; });
  }
  const ids = rows.map((c) => c.id);
  const inList = ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)';
  const ev = (q, ...p) => get(q, ...p, ...ids)?.n ?? 0;
  const automation = {
    automated_events: ev(`SELECT COUNT(*) n FROM lead_events WHERE automated=1 AND type='automated_message' AND contact_id IN ${inList}`),
    human_responses: ev(`SELECT COUNT(*) n FROM lead_events WHERE type='human_response' AND automated=0 AND contact_id IN ${inList}`),
    contact_attempts: ev(`SELECT COUNT(*) n FROM lead_events WHERE type='contact_attempt' AND contact_id IN ${inList}`),
    customer_replies: ev(`SELECT COUNT(*) n FROM lead_events WHERE type='customer_reply' AND contact_id IN ${inList}`),
    sequences_enrolled: ev(`SELECT COUNT(*) n FROM sequence_enrollments WHERE contact_id IN ${inList}`),
    sequences_stopped_by_reply: ev(`SELECT COUNT(*) n FROM sequence_enrollments WHERE stop_reason='customer replied' AND contact_id IN ${inList}`),
    sequences_stopped_by_booking: ev(`SELECT COUNT(*) n FROM sequence_enrollments WHERE stop_reason='appointment booked' AND contact_id IN ${inList}`),
    note: 'Automated messages are shown here only. They are never counted as a response to the customer.',
  };
  const lines = (m) => [...m.values()].sort((a, b) => b.leads - a.leads).map((r) => ({ ...r, response_rate: rate(r.responded, r.assigned), appointment_rate: rate(r.appointments, r.tracked || r.assigned || r.leads), won_rate: rate(r.won, r.leads) }));
  return {
    period: { from: new Date(fromMs).toISOString().slice(0, 10), to: new Date(toMs).toISOString().slice(0, 10), timezone: tz }, scope: owner ? 'own' : 'all',
    totals: { leads: t.leads, not_tracked: t.not_tracked, unassigned: t.unassigned, tracked: t.tracked },
    rates: { accepted: rate(t.accepted, t.assigned), responded: rate(t.responded, t.assigned), appointments: rate(t.appts, t.tracked), viewings: rate(t.viewings, t.appts), won: rate(t.won, t.leads), lost: rate(t.lost, t.leads) },
    response_time: { count: calMin.length, median_minutes: median(calMin), average_minutes: avg(calMin), median_working_minutes: median(bizMin), average_working_minutes: avg(bizMin), note: calMin.length ? null : 'No lead in this period has a recorded human response yet.' },
    sla: { ...sla, rate: rate(sla.met, sla.met + sla.missed) },
    by_source: lines(bySource), by_agent: owner ? [] : lines(byAgent), automation, definitions: DEFINITIONS,
  };
}
