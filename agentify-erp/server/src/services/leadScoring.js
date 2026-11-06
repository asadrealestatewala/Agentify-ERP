// Lead scoring and the follow-up reminder queue (Agency Pro and above). Scores are computed from what the CRM already holds, on demand, so there is no
// extra table to keep in step: nothing is stored and a score always reflects today's data. The score is a guide for who to call first, not a promise.
//
// Points (max 100): recency of the last activity 0-30, stage 0-20, how complete the lead is 0-20 (phone, email, budget, what they want),
// activity in the last 30 days 0-15, priority 0-5, a linked property or project 0-5, an agent who owns it 0-5.
import { all, get, run } from '../db.js';
import { now, bad } from '../util.js';

const BANDS = [['hot', 65], ['warm', 40], ['cold', 0]];
export const bandOf = (score) => BANDS.find(([, min]) => score >= min)[0];
const days = (iso, today) => (iso ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)) / 864e5)) : null);
const parse = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

/** Score one lead row (contacts joined with its stage lookup and 30-day activity count). Returns { score, band, reasons }. */
export function scoreLead(c, today = new Date().toISOString().slice(0, 10)) {
  const reasons = []; let score = 0;
  const idle = days(c.last_activity_at || c.created_at, today);
  const rec = idle == null ? 0 : idle <= 2 ? 30 : idle <= 7 ? 22 : idle <= 14 ? 12 : idle <= 30 ? 5 : 0;
  score += rec; if (rec >= 22) reasons.push('Active in the last week'); else if (rec === 0) reasons.push('No activity for over a month');
  const kind = parse(c.stage_meta).kind;
  const name = String(c.stage_name || '').toLowerCase();
  const st = /negotiat|booking|token|visit|viewing/.test(name) ? 20 : /interest|qualif/.test(name) ? 20 : /follow/.test(name) ? 12 : kind === 'open' ? 8 : 2;
  score += st; if (st >= 20) reasons.push(`Stage: ${c.stage_name}`);
  let fill = 0;
  if (c.phone || c.whatsapp) fill += 6;
  if (c.email) fill += 4;
  if (c.budget) { fill += 6; reasons.push('Budget known'); }
  if (c.pref_location || c.property_type) fill += 4;
  score += fill;
  const act = Math.min(15, (c.acts30 || 0) * 3);
  score += act; if (act >= 9) reasons.push('Several touches this month');
  if (c.priority === 'High') { score += 5; reasons.push('High priority'); }
  if (c.property_id || c.project_id) { score += 5; reasons.push('Asked about a specific property or project'); }
  if (c.agent_id) score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, band: bandOf(score), reasons: reasons.slice(0, 4) };
}

const BASE = `SELECT c.id, c.full_name, c.phone, c.whatsapp, c.email, c.budget, c.pref_location, c.property_type, c.priority, c.property_id, c.project_id, c.agent_id, c.followup_date, c.last_activity_at, c.created_at,
  l.value stage_name, l.meta stage_meta, u.name agent_name,
  (SELECT COUNT(*) FROM activities a WHERE a.contact_id=c.id AND a.created_at >= ?) acts30
  FROM contacts c LEFT JOIN lookups l ON l.id=c.stage_id LEFT JOIN users u ON u.id=c.agent_id
  WHERE c.is_customer=0 AND COALESCE(c.is_demo,0)=0 AND COALESCE(json_extract(l.meta,'$.kind'),'open') NOT IN ('lost','won')`;

function openLeads(scope, today) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 864e5).toISOString();
  return all(`${BASE}${scope.ownerId ? ' AND c.agent_id=?' : ''} LIMIT 5000`, since, ...(scope.ownerId ? [scope.ownerId] : []));
}

/** Open leads with a score, best first. `band` filters to hot, warm or cold. */
export function leadScores({ ownerId = null, band = null, limit = 100, today = new Date().toISOString().slice(0, 10) } = {}) {
  const rows = openLeads({ ownerId }, today).map((c) => ({ id: c.id, full_name: c.full_name, phone: c.phone, stage: c.stage_name, agent_name: c.agent_name, budget: c.budget, followup_date: c.followup_date, last_activity_at: c.last_activity_at, ...scoreLead(c, today) }));
  const counts = { hot: 0, warm: 0, cold: 0 };
  for (const r of rows) counts[r.band]++;
  const list = rows.filter((r) => !band || r.band === band).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, Math.min(500, Math.max(1, limit)));
  return { counts, total: rows.length, leads: list };
}

/**
 * The follow-up reminder queue: leads whose follow-up is due or overdue, and warm or hot leads that have gone quiet with nothing scheduled.
 * Most urgent first (longest overdue, then highest score).
 */
export function followUpQueue({ ownerId = null, limit = 200, quietDays = 5, today = new Date().toISOString().slice(0, 10) } = {}) {
  const items = [];
  for (const c of openLeads({ ownerId }, today)) {
    const s = scoreLead(c, today);
    const nextTask = get("SELECT MIN(due_date) d FROM tasks WHERE entity_type='contact' AND entity_id=? AND status='open'", c.id)?.d || null;
    const due = nextTask || c.followup_date || null;
    const idle = days(c.last_activity_at || c.created_at, today);
    const base = { id: c.id, full_name: c.full_name, phone: c.phone, stage: c.stage_name, agent_name: c.agent_name, score: s.score, band: s.band, followup_date: due, idle_days: idle };
    if (due && due <= today) { const late = days(due, today); items.push({ ...base, kind: late > 0 ? 'overdue' : 'due_today', days_late: late, reason: late > 0 ? `Follow-up was due ${late} day${late === 1 ? '' : 's'} ago` : 'Follow-up due today' }); }
    else if (!due && s.band !== 'cold' && idle != null && idle >= quietDays) items.push({ ...base, kind: 'gone_quiet', days_late: 0, reason: `${s.band === 'hot' ? 'Hot' : 'Warm'} lead with no activity for ${idle} days and no follow-up set` });
  }
  const rank = { overdue: 0, due_today: 1, gone_quiet: 2 };
  items.sort((a, b) => rank[a.kind] - rank[b.kind] || b.days_late - a.days_late || b.score - a.score || a.id - b.id);
  return { counts: { overdue: items.filter((i) => i.kind === 'overdue').length, due_today: items.filter((i) => i.kind === 'due_today').length, gone_quiet: items.filter((i) => i.kind === 'gone_quiet').length }, items: items.slice(0, Math.min(500, Math.max(1, limit))) };
}

/** Put a follow-up on the lead's calendar (a task, the same as the CRM's own "Follow up"). */
export function scheduleFollowUp(contact, { due_date, title }, user) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due_date || ''))) throw bad('Choose a follow-up date');
  const t = String(title || 'Follow up').trim().slice(0, 120) || 'Follow up';
  run("INSERT INTO tasks(entity_type,entity_id,title,due_date,assigned_to,created_by,created_at) VALUES('contact',?,?,?,?,?,?)", contact.id, t, due_date, contact.agent_id ?? user.id, user.id, now());
  const next = get("SELECT MIN(due_date) d FROM tasks WHERE entity_type='contact' AND entity_id=? AND status='open'", contact.id)?.d ?? null;
  run('UPDATE contacts SET followup_date=? WHERE id=?', next, contact.id);
  return { ok: true, followup_date: next };
}
