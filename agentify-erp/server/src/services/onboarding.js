// Employee onboarding checklists: reusable templates, one onboarding per employee started from a template (items are
// copied, so later template edits never change a running onboarding), item states with evidence and reasons, and
// reminders that reuse work tasks and the notification bell. Every database belongs to one workspace, so tenant
// isolation comes from the connection; who may see or change what inside the workspace is decided here.
import { all, get, run, tx, getSetting, setSetting } from '../db.js';
import { hasPerm } from '../rbac.js';
import { audit, notify } from '../audit.js';
import { bad, forbidden, notFound, now, today } from '../util.js';
import { employeeOf, managerUserId } from './hr.js';
import { addWorkingDays, calendarChecker, inWorkingHours } from './workCalendar.js';

export const CATEGORIES = ['profile', 'documents', 'policies', 'accounts', 'equipment', 'training', 'manager_review', 'other'];
export const ASSIGNEES = ['employee', 'manager', 'hr', 'user'];
/** How an item is shown to be done. Evidence is a reference to an existing record, never a copy of it. */
export const CRITERIA = ['manual', 'note', 'document', 'asset', 'profile', 'acknowledgement'];
export const ITEM_STATUS = ['pending', 'in_progress', 'completed', 'waived'];
const PROFILE_FIELDS = ['phone', 'email', 'address', 'emergency_contact', 'dob', 'photo'];
const DONE = new Set(['completed', 'waived']);

const utc = () => new Date().toISOString();
const str = (v, max = 2000) => (v == null ? '' : String(v).trim().slice(0, max));

// ------------------------------------------------------------------ access
const isHr = (user, action = 'view') => hasPerm(user, 'hrm', action);
/** The employee row of the login, without the e-mail auto-link side effect when it is not needed. */
const myEmployee = (user) => employeeOf(user);

/** What this login may do with one onboarding. */
export function accessTo(user, onb, emp = get('SELECT * FROM employees WHERE id=?', onb.employee_id)) {
  const hr = isHr(user, 'view');
  const manager = !!emp && managerUserId(emp) === user.id;
  const self = !!emp?.user_id && emp.user_id === user.id;
  const assignee = !!get('SELECT 1 FROM onboarding_items WHERE onboarding_id=? AND assignee_user_id=?', onb.id, user.id);
  return { hr, manager, self, assignee, any: hr || manager || self || assignee };
}

function loadOnboarding(id, user) {
  const onb = get('SELECT * FROM onboardings WHERE id=?', id);
  if (!onb) throw notFound('Onboarding not found');
  const emp = get('SELECT * FROM employees WHERE id=?', onb.employee_id);
  const acc = accessTo(user, onb, emp);
  if (!acc.any) throw notFound('Onboarding not found'); // do not reveal other people's onboarding
  return { onb, emp, acc };
}

// ------------------------------------------------------------------ templates
const cleanItem = (it, i) => {
  const title = str(it.title, 200);
  if (!title) throw bad(`Item ${i + 1} needs a title`);
  const category = CATEGORIES.includes(it.category) ? it.category : 'other';
  const assignee_type = ASSIGNEES.includes(it.assignee_type) ? it.assignee_type : 'hr';
  const criteria = CRITERIA.includes(it.criteria) ? it.criteria : 'manual';
  const offset = Number(it.due_offset_days ?? 0);
  if (!Number.isInteger(offset) || offset < -60 || offset > 250) throw bad(`Item ${i + 1}: due offset must be a whole number of working days between -60 and 250`);
  let assignee_user_id = it.assignee_user_id ? Number(it.assignee_user_id) : null;
  if (assignee_type === 'user' && !assignee_user_id) throw bad(`Item ${i + 1}: choose the person responsible`);
  if (assignee_user_id && !get('SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1 AND r.portal=0', assignee_user_id)) throw bad(`Item ${i + 1}: that person is not an active staff login`);
  if (!['user', 'hr'].includes(assignee_type)) assignee_user_id = null;
  let criteria_ref = str(it.criteria_ref, 200) || null;
  if (criteria === 'profile' && criteria_ref) {
    const fields = criteria_ref.split(',').map((s) => s.trim()).filter(Boolean);
    if (fields.some((f) => !PROFILE_FIELDS.includes(f))) throw bad(`Item ${i + 1}: profile fields can be ${PROFILE_FIELDS.join(', ')}`);
    criteria_ref = fields.join(',');
  }
  if (criteria === 'acknowledgement' && assignee_type !== 'employee') throw bad(`Item ${i + 1}: only the employee can acknowledge a policy, so assign it to the employee`);
  return { sort_order: i, category, title, description: str(it.description) || null, required: it.required === false || it.required === 0 ? 0 : 1,
    assignee_type, assignee_user_id, due_offset_days: offset, criteria, criteria_ref };
};

const TCOLS = ['sort_order', 'category', 'title', 'description', 'required', 'assignee_type', 'assignee_user_id', 'due_offset_days', 'criteria', 'criteria_ref'];
function writeItems(templateId, items) {
  run('DELETE FROM onboarding_template_items WHERE template_id=?', templateId);
  for (const it of items) run(`INSERT INTO onboarding_template_items(template_id,${TCOLS.join(',')}) VALUES(?,${TCOLS.map(() => '?').join(',')})`, templateId, ...TCOLS.map((c) => it[c]));
}

/**
 * A neutral starter template so a new workspace is not empty. No national ID or tax number is named: the workspace
 * edits the document items to what its own policy and local law require.
 */
const STARTER = [
  { category: 'profile', title: 'Complete personal profile (phone, address, emergency contact)', assignee_type: 'employee', due_offset_days: 0, criteria: 'profile', criteria_ref: 'phone,address,emergency_contact' },
  { category: 'documents', title: 'Upload signed employment contract', assignee_type: 'hr', due_offset_days: 0, criteria: 'document', criteria_ref: 'Contract' },
  { category: 'documents', title: 'Collect identity / right-to-work documents required by company policy', assignee_type: 'hr', due_offset_days: 2, criteria: 'document', description: 'Which documents are needed depends on your country and policy. Edit this item to match.' },
  { category: 'policies', title: 'Read and acknowledge the employee handbook and code of conduct', assignee_type: 'employee', due_offset_days: 2, criteria: 'acknowledgement' },
  { category: 'accounts', title: 'Set up ERP login and work e-mail', assignee_type: 'hr', due_offset_days: -1, criteria: 'note', description: 'Record what was set up. Starting onboarding never changes anyone\'s role or permissions.' },
  { category: 'equipment', title: 'Issue laptop / phone from the asset library', assignee_type: 'hr', due_offset_days: 0, criteria: 'asset', required: false },
  { category: 'training', title: 'Complete induction training', assignee_type: 'employee', due_offset_days: 5, criteria: 'manual' },
  { category: 'manager_review', title: 'First-week check-in with manager', assignee_type: 'manager', due_offset_days: 5, criteria: 'note' },
  { category: 'manager_review', title: 'End of probation review', assignee_type: 'manager', due_offset_days: 60, criteria: 'note', required: false },
];
export function ensureStarterTemplate(userId = null) {
  if (getSetting('onboarding_seeded') || get('SELECT 1 FROM onboarding_templates')) return;
  tx(() => {
    const id = Number(run('INSERT INTO onboarding_templates(name,description,created_by,created_at) VALUES(?,?,?,?)', 'Standard onboarding',
      'Starter checklist. Edit the items to match your own policies and local requirements.', userId, utc()).lastInsertRowid);
    writeItems(id, STARTER.map(cleanItem));
    setSetting('onboarding_seeded', '1');
  });
}

export function listTemplates() {
  return all(`SELECT t.*, (SELECT COUNT(*) FROM onboarding_template_items i WHERE i.template_id=t.id) items,
    (SELECT COUNT(*) FROM onboardings o WHERE o.template_id=t.id) used FROM onboarding_templates t ORDER BY t.active DESC, t.name`);
}
export function getTemplate(id) {
  const t = get('SELECT * FROM onboarding_templates WHERE id=?', id);
  if (!t) throw notFound('Template not found');
  return { ...t, items: all('SELECT * FROM onboarding_template_items WHERE template_id=? ORDER BY sort_order, id', id) };
}
export function saveTemplate(id, body, req) {
  const name = str(body.name, 120);
  if (!name) throw bad('Template name is required');
  const items = (Array.isArray(body.items) ? body.items : []).map(cleanItem);
  if (!items.length) throw bad('Add at least one checklist item');
  if (items.length > 100) throw bad('A template can have at most 100 items');
  return tx(() => {
    let tid = id;
    if (tid) {
      if (!get('SELECT 1 FROM onboarding_templates WHERE id=?', tid)) throw notFound('Template not found');
      run('UPDATE onboarding_templates SET name=?, description=?, active=?, updated_at=? WHERE id=?', name, str(body.description) || null, body.active === false || body.active === 0 ? 0 : 1, utc(), tid);
    } else tid = Number(run('INSERT INTO onboarding_templates(name,description,created_by,created_at) VALUES(?,?,?,?)', name, str(body.description) || null, req.user.id, utc()).lastInsertRowid);
    writeItems(tid, items);
    audit(req, id ? 'Onboarding template updated' : 'Onboarding template created', 'onboarding_template', tid, `${name} (${items.length} items)`);
    return getTemplate(tid);
  });
}
export function deleteTemplate(id, req) {
  const t = get('SELECT * FROM onboarding_templates WHERE id=?', id);
  if (!t) throw notFound('Template not found');
  // running onboardings keep their own copy, so a used template is only switched off (kept for the record)
  if (get('SELECT 1 FROM onboardings WHERE template_id=?', id)) run('UPDATE onboarding_templates SET active=0, updated_at=? WHERE id=?', utc(), id);
  else run('DELETE FROM onboarding_templates WHERE id=?', id);
  audit(req, 'Onboarding template removed', 'onboarding_template', id, t.name);
}

// ------------------------------------------------------------------ starting an onboarding
function resolveAssignee(item, emp, starterId) {
  if (item.assignee_type === 'employee') return emp.user_id || null;
  if (item.assignee_type === 'manager') return managerUserId(emp);
  if (item.assignee_type === 'hr') return item.assignee_user_id || starterId;
  return item.assignee_user_id || null;
}

/**
 * Start an onboarding from a template. A retry with the same idempotency key returns the first result; an employee
 * can have only one open onboarding at a time (enforced by a unique index as well as here).
 */
export function startOnboarding(body, req) {
  const key = str(body.idempotency_key, 100) || null;
  if (key) {
    const prior = get('SELECT * FROM onboardings WHERE idem_key=?', key);
    if (prior) {
      if (prior.employee_id !== Number(body.employee_id)) throw bad('This request key was already used for another employee');
      return { id: prior.id, replayed: true };
    }
  }
  const emp = get('SELECT * FROM employees WHERE id=?', Number(body.employee_id));
  if (!emp) throw bad('Employee not found');
  if (emp.status === 'inactive') throw bad('This employee is inactive');
  const open = get("SELECT id FROM onboardings WHERE employee_id=? AND status IN ('pending','in_progress')", emp.id);
  if (open) throw bad(`${emp.name} already has an onboarding in progress`, { onboarding_id: open.id });
  const tpl = getTemplate(Number(body.template_id));
  if (!tpl.active) throw bad('That template is switched off');
  const joining = str(body.joining_date, 10) || emp.hire_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joining || '')) throw bad('Set the joining date (or the employee\'s recruitment date) first');
  const isWorking = calendarChecker();
  const created = [];
  const id = tx(() => {
    const oid = Number(run('INSERT INTO onboardings(employee_id,template_id,template_name,joining_date,status,idem_key,started_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
      emp.id, tpl.id, tpl.name, joining, 'pending', key, req.user.id, utc()).lastInsertRowid);
    for (const it of tpl.items) {
      const assignee = resolveAssignee(it, emp, req.user.id);
      const due = addWorkingDays(joining, it.due_offset_days, isWorking);
      const iid = Number(run(`INSERT INTO onboarding_items(onboarding_id,template_item_id,sort_order,category,title,description,required,assignee_type,assignee_user_id,due_offset_days,due_date,criteria,criteria_ref,status,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`, oid, it.id, it.sort_order, it.category, it.title, it.description, it.required, it.assignee_type, assignee, it.due_offset_days, due, it.criteria, it.criteria_ref, utc()).lastInsertRowid);
      if (assignee) {
        const tid = Number(run('INSERT INTO work_tasks(title,description,priority,due_date,status,assigned_to,assigned_by,created_at,onboarding_item_id) VALUES(?,?,?,?,?,?,?,?,?)',
          `Onboarding: ${it.title}`.slice(0, 250), `${emp.name} (${emp.emp_code || 'employee'}) · ${tpl.name}${it.description ? `\n${it.description}` : ''}`, it.required ? 'High' : 'Medium', due, 'todo', assignee, req.user.id, now(), iid).lastInsertRowid);
        run('UPDATE onboarding_items SET work_task_id=? WHERE id=?', tid, iid);
        created.push({ iid, assignee, title: it.title, due });
      }
    }
    return oid;
  });
  for (const c of created) if (c.assignee !== req.user.id) notify(c.assignee, 'onboarding', `Onboarding task: ${emp.name}`, `${c.title} — due ${c.due}`, '/my/onboarding', { dedupe: `onb-assign-${c.iid}` });
  audit(req, 'Onboarding started', 'onboarding', id, `${emp.name} · ${tpl.name} · joining ${joining}`);
  return { id, replayed: false };
}

export function cancelOnboarding(id, reason, req) {
  const onb = get('SELECT * FROM onboardings WHERE id=?', id);
  if (!onb) throw notFound('Onboarding not found');
  if (!['pending', 'in_progress'].includes(onb.status)) throw bad('Only an open onboarding can be cancelled');
  if (!str(reason)) throw bad('Give a reason for cancelling');
  tx(() => {
    run("UPDATE onboardings SET status='cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=? WHERE id=?", utc(), req.user.id, str(reason), id);
    run("DELETE FROM work_tasks WHERE status<>'done' AND onboarding_item_id IN (SELECT id FROM onboarding_items WHERE onboarding_id=?)", id);
  });
  audit(req, 'Onboarding cancelled', 'onboarding', id, str(reason));
}

// ------------------------------------------------------------------ progress
/** Progress comes only from the items' actual states: required items done (completed or waived) out of required items. */
export function progressOf(items, t = today()) {
  const req = items.filter((i) => i.required);
  const done = req.filter((i) => DONE.has(i.status)).length;
  const counts = Object.fromEntries(ITEM_STATUS.map((s) => [s, items.filter((i) => i.status === s).length]));
  const overdue = items.filter((i) => !DONE.has(i.status) && i.due_date && i.due_date < t).length;
  return { required: req.length, required_done: done, percent: req.length ? Math.round((done / req.length) * 100) : 100, counts, total: items.length, overdue };
}
function refreshStatus(oid) {
  const onb = get('SELECT * FROM onboardings WHERE id=?', oid);
  if (!onb || onb.status === 'cancelled') return onb;
  const items = all('SELECT status, required FROM onboarding_items WHERE onboarding_id=?', oid);
  const p = progressOf(items);
  const touched = items.some((i) => i.status !== 'pending');
  const status = p.required_done === p.required && items.every((i) => !i.required || DONE.has(i.status)) ? 'completed' : touched ? 'in_progress' : 'pending';
  if (status !== onb.status) run('UPDATE onboardings SET status=?, completed_at=? WHERE id=?', status, status === 'completed' ? utc() : null, oid);
  return { ...onb, status, became_complete: status === 'completed' && onb.status !== 'completed' };
}

// ------------------------------------------------------------------ item actions
function checkEvidence(item, emp, body, user) {
  const ref = body.evidence_ref == null ? null : String(body.evidence_ref);
  const note = str(body.note) || null;
  switch (item.criteria) {
    case 'note':
      if (!note) throw bad('Add a short note saying what was done');
      return { evidence_type: 'note', evidence_ref: null, evidence_note: note };
    case 'document': {
      const doc = ref && get("SELECT * FROM documents WHERE id=? AND entity_type='employee' AND entity_id=?", Number(ref), emp.id);
      if (!doc) throw bad('Choose one of this employee\'s uploaded documents as evidence (upload it under the employee\'s Documents first)');
      if (item.criteria_ref && String(doc.category || '').toLowerCase() !== item.criteria_ref.toLowerCase()) throw bad(`The document must be in the "${item.criteria_ref}" category`);
      return { evidence_type: 'document', evidence_ref: String(doc.id), evidence_note: note };
    }
    case 'asset': {
      const a = ref && get("SELECT * FROM assets WHERE id=? AND employee_id=? AND status='assigned'", Number(ref), emp.id);
      if (!a) throw bad('Choose an asset that is assigned to this employee in the asset library');
      if (item.criteria_ref && String(a.category || '').toLowerCase() !== item.criteria_ref.toLowerCase()) throw bad(`The asset must be in the "${item.criteria_ref}" category`);
      return { evidence_type: 'asset', evidence_ref: String(a.id), evidence_note: note };
    }
    case 'profile': {
      const fields = (item.criteria_ref || 'phone,address,emergency_contact').split(',').filter(Boolean);
      const fresh = get('SELECT * FROM employees WHERE id=?', emp.id);
      const missing = fields.filter((f) => !str(fresh[f]));
      if (missing.length) throw bad(`The profile still needs: ${missing.map((f) => f.replace('_', ' ')).join(', ')}`, { missing });
      return { evidence_type: 'profile', evidence_ref: fields.join(','), evidence_note: note };
    }
    case 'acknowledgement':
      if (!emp.user_id || emp.user_id !== user.id) throw forbidden('Only the employee can acknowledge this');
      return { evidence_type: 'acknowledgement', evidence_ref: ref ? str(ref, 200) : null, evidence_note: note || 'Acknowledged by the employee' };
    default:
      return { evidence_type: note ? 'note' : null, evidence_ref: ref ? str(ref, 200) : null, evidence_note: note };
  }
}

/** May this login complete (or start) this item? The assignee, HR editors, and the manager for manager items. */
function mayWork(user, item, acc) {
  if (item.criteria === 'acknowledgement') return acc.self;
  if (item.assignee_user_id === user.id) return true;
  if (isHr(user, 'edit')) return true;
  return acc.manager && item.assignee_type === 'manager';
}

const syncTask = (item, status) => {
  if (!item.work_task_id) return;
  const ts = now();
  if (status === 'done') run("UPDATE work_tasks SET status='done', completed_at=COALESCE(completed_at,?) WHERE id=?", ts, item.work_task_id);
  else if (status === 'in_progress') run("UPDATE work_tasks SET status='in_progress', started_at=COALESCE(started_at,?) WHERE id=? AND status<>'done'", ts, item.work_task_id);
  else run("UPDATE work_tasks SET status='todo', completed_at=NULL WHERE id=?", item.work_task_id);
};

/**
 * start | complete | waive | reopen. Repeating the same action on an item already in that state changes nothing and
 * returns `unchanged`, so a retried request is harmless.
 */
export function itemAction(itemId, body, req) {
  const item = get('SELECT * FROM onboarding_items WHERE id=?', itemId);
  if (!item) throw notFound('Checklist item not found');
  const { onb, emp, acc } = loadOnboarding(item.onboarding_id, req.user);
  if (onb.status === 'cancelled') throw bad('This onboarding was cancelled');
  const action = body.action;
  const user = req.user;
  const ts = utc();
  const target = { start: 'in_progress', complete: 'completed', waive: 'waived', reopen: 'pending' }[action];
  if (!target) throw bad('Unknown action');
  if (item.status === target && action !== 'reopen') return { item, unchanged: true, onboarding: onb };
  let patch, reason = null, evidence = null;
  if (action === 'start') {
    if (!mayWork(user, item, acc)) throw forbidden('This item is not yours to work on');
    if (DONE.has(item.status)) throw bad('Reopen the item first');
    patch = { status: 'in_progress', started_at: item.started_at || ts };
  } else if (action === 'complete') {
    if (!mayWork(user, item, acc)) throw forbidden('This item is not yours to complete');
    if (item.status === 'waived') throw bad('Reopen the item first');
    const ev = checkEvidence(item, emp, body, user);
    evidence = ev;
    patch = { status: 'completed', ...ev, completed_by: user.id, completed_at: ts, started_at: item.started_at || ts };
  } else if (action === 'waive') {
    if (!isHr(user, 'approve')) throw forbidden('Only HR approvers can waive a checklist item');
    reason = str(body.reason, 500);
    if (!reason) throw bad('Give a reason for waiving this item');
    if (item.status === 'completed') throw bad('A completed item cannot be waived; reopen it first');
    patch = { status: 'waived', waived_by: user.id, waived_at: ts, waive_reason: reason };
  } else {
    if (!DONE.has(item.status)) return { item, unchanged: true, onboarding: onb };
    if (!(isHr(user, 'edit') || (acc.manager && item.assignee_type === 'manager'))) throw forbidden('Only HR or the employee\'s manager can reopen an item');
    reason = str(body.reason, 500);
    if (!reason) throw bad('Give a reason for reopening this item');
    patch = { status: 'pending', reopened_by: user.id, reopened_at: ts, reopen_reason: reason, completed_by: null, completed_at: null, waived_by: null, waived_at: null, waive_reason: null };
  }
  const keys = Object.keys(patch);
  let after;
  tx(() => {
    // the WHERE on the old status makes two racing requests resolve to one change
    const r = run(`UPDATE onboarding_items SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=? AND status=?`, ...keys.map((k) => patch[k]), ts, item.id, item.status);
    if (!r.changes) throw bad('This item was changed by someone else just now; refresh and try again');
    run('INSERT INTO onboarding_item_events(item_id,onboarding_id,user_id,action,from_status,to_status,reason,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      item.id, onb.id, user.id, action, item.status, patch.status, reason, evidence ? JSON.stringify(evidence) : null, ts);
    syncTask(item, DONE.has(patch.status) ? 'done' : patch.status === 'in_progress' ? 'in_progress' : 'todo');
    after = refreshStatus(onb.id);
  });
  audit(req, `Onboarding item ${action === 'complete' ? 'completed' : action === 'waive' ? 'waived' : action === 'reopen' ? 'reopened' : 'started'}`, 'onboarding', onb.id, `${emp.name}: ${item.title}${reason ? ` — ${reason}` : ''}`);
  if (after?.became_complete) {
    const to = [...hrApprovers(), managerUserId(emp)].filter((x) => x && x !== user.id);
    notify(to, 'onboarding', 'Onboarding complete', `${emp.name} has finished onboarding (${onb.template_name})`, `/hrm/onboarding/${onb.id}`, { dedupe: `onb-done-${onb.id}-${after.status}-${ts.slice(0, 19)}` });
  }
  return { item: get('SELECT * FROM onboarding_items WHERE id=?', item.id), onboarding: after };
}

/** A work task created for a checklist item was moved on My Tasks: keep the item in step without skipping evidence. */
export function syncFromTask(task, status, req) {
  const item = get('SELECT * FROM onboarding_items WHERE id=?', task.onboarding_item_id);
  if (!item) return;
  if (status === 'done') {
    if (!['manual'].includes(item.criteria)) throw bad('This task is part of an onboarding checklist and needs evidence. Complete it from My Space → My onboarding.');
    itemAction(item.id, { action: 'complete' }, req);
  } else if (status === 'in_progress' && item.status === 'pending') itemAction(item.id, { action: 'start' }, req);
  else if (task.status === 'done' && status !== 'done' && DONE.has(item.status)) throw bad('Reopen this item from the onboarding checklist (a reason is recorded).');
}

const hrApprovers = () => all(`SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN role_permissions p ON p.role_id=r.id AND p.module='hrm' AND p.action='edit'
  WHERE u.active=1 AND r.portal=0 AND (r.name='Super Admin' OR p.role_id IS NOT NULL)`).map((r) => r.id);

// ------------------------------------------------------------------ reading
const ITEM_SELECT = `SELECT i.*, u.name assignee_name, c.name completed_by_name, w.name waived_by_name, ro.name reopened_by_name,
  d.name evidence_document, d.category evidence_document_category, a.asset_no evidence_asset_no, a.name evidence_asset
  FROM onboarding_items i LEFT JOIN users u ON u.id=i.assignee_user_id LEFT JOIN users c ON c.id=i.completed_by LEFT JOIN users w ON w.id=i.waived_by
  LEFT JOIN users ro ON ro.id=i.reopened_by
  LEFT JOIN documents d ON i.evidence_type='document' AND d.id=CAST(i.evidence_ref AS INTEGER)
  LEFT JOIN assets a ON i.evidence_type='asset' AND a.id=CAST(i.evidence_ref AS INTEGER)`;

export function onboardingDetail(id, user) {
  const { onb, emp, acc } = loadOnboarding(id, user);
  const t = today();
  let items = all(`${ITEM_SELECT} WHERE i.onboarding_id=? ORDER BY i.sort_order, i.id`, onb.id);
  const progress = progressOf(items, t);
  // someone who only has one item assigned (e.g. IT) sees their own items, not the whole checklist
  const full = acc.hr || acc.manager || acc.self;
  if (!full) items = items.filter((i) => i.assignee_user_id === user.id);
  const withPerms = items.map((i) => ({ ...i, overdue: !DONE.has(i.status) && !!i.due_date && i.due_date < t,
    can: { work: !DONE.has(i.status) && onb.status !== 'cancelled' && mayWork(user, i, acc), waive: !DONE.has(i.status) && onb.status !== 'cancelled' && isHr(user, 'approve'),
      reopen: DONE.has(i.status) && onb.status !== 'cancelled' && (isHr(user, 'edit') || (acc.manager && i.assignee_type === 'manager')) } }));
  // evidence to pick from: the employee's own uploads and assigned assets (references, never copies). Someone with only
  // an assigned item sees just the document categories their items ask for.
  const cats = full ? null : [...new Set(items.filter((i) => i.criteria === 'document' && i.criteria_ref).map((i) => i.criteria_ref.toLowerCase()))];
  const evidence = {
    documents: all("SELECT id,name,category,created_at FROM documents WHERE entity_type='employee' AND entity_id=? ORDER BY id DESC", emp.id).filter((d) => !cats || cats.includes(String(d.category || '').toLowerCase())),
    assets: all("SELECT id,asset_no,name,category FROM assets WHERE employee_id=? AND status='assigned' ORDER BY id DESC", emp.id),
  };
  return {
    onboarding: { ...onb, started_by_name: get('SELECT name FROM users WHERE id=?', onb.started_by)?.name || null },
    employee: { id: emp.id, name: emp.name, emp_code: emp.emp_code, department: emp.department, designation: emp.designation, hire_date: emp.hire_date, photo: emp.photo, has_login: !!emp.user_id },
    progress, items: withPerms, evidence, scope: acc,
    can: { cancel: isHr(user, 'edit') && ['pending', 'in_progress'].includes(onb.status) },
    events: full ? all('SELECT e.*, u.name user_name, i.title item_title FROM onboarding_item_events e LEFT JOIN users u ON u.id=e.user_id LEFT JOIN onboarding_items i ON i.id=e.item_id WHERE e.onboarding_id=? ORDER BY e.id DESC LIMIT 200', onb.id) : [],
  };
}

/** HR sees every onboarding; a manager sees their direct reports'. `filter`: open | overdue | completed | all. */
export function listOnboardings(user, { scope = 'auto', filter = 'open' } = {}) {
  const where = [], params = [];
  const hr = isHr(user, 'view');
  if (scope === 'team' || !hr) {
    const mine = myEmployee(user);
    if (!mine) return { rows: [], scope: 'team' };
    where.push('e.manager_id=?'); params.push(mine.id);
  }
  if (filter === 'open' || filter === 'overdue') where.push("o.status IN ('pending','in_progress')");
  else if (filter === 'completed') where.push("o.status='completed'");
  else if (filter === 'cancelled') where.push("o.status='cancelled'");
  const t = today();
  const rows = all(`SELECT o.*, e.name employee_name, e.emp_code, e.department, e.designation,
      (SELECT COUNT(*) FROM onboarding_items i WHERE i.onboarding_id=o.id AND i.required=1) req_total,
      (SELECT COUNT(*) FROM onboarding_items i WHERE i.onboarding_id=o.id AND i.required=1 AND i.status IN ('completed','waived')) req_done,
      (SELECT COUNT(*) FROM onboarding_items i WHERE i.onboarding_id=o.id AND i.status NOT IN ('completed','waived') AND i.due_date<?) overdue,
      (SELECT MIN(i.due_date) FROM onboarding_items i WHERE i.onboarding_id=o.id AND i.status NOT IN ('completed','waived')) next_due
    FROM onboardings o JOIN employees e ON e.id=o.employee_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (o.status IN ('pending','in_progress')) DESC, o.joining_date DESC, o.id DESC LIMIT 500`, t, ...params)
    .map((o) => ({ ...o, percent: o.req_total ? Math.round((o.req_done / o.req_total) * 100) : 100 }));
  return { rows: filter === 'overdue' ? rows.filter((o) => o.overdue > 0) : rows, scope: scope === 'team' || !hr ? 'team' : 'all' };
}

/** The login's own onboarding (as the new employee) plus items other people's onboardings have assigned to it. */
export function myOnboarding(user) {
  const e = myEmployee(user);
  const own = e ? get("SELECT id FROM onboardings WHERE employee_id=? AND status<>'cancelled' ORDER BY id DESC", e.id) : null;
  const t = today();
  const assigned = all(`SELECT i.id, i.title, i.category, i.status, i.due_date, i.required, i.criteria, i.onboarding_id, e.name employee_name
    FROM onboarding_items i JOIN onboardings o ON o.id=i.onboarding_id JOIN employees e ON e.id=o.employee_id
    WHERE i.assignee_user_id=? AND o.status IN ('pending','in_progress') AND (e.user_id IS NULL OR e.user_id<>?) ORDER BY i.due_date, i.id`, user.id, user.id)
    .map((i) => ({ ...i, overdue: !DONE.has(i.status) && !!i.due_date && i.due_date < t }));
  return { own: own ? onboardingDetail(own.id, user) : null, assigned };
}

// ------------------------------------------------------------------ reminders
/**
 * Once a working day, after the working day has started (workspace timezone, weekends and holidays from the working
 * calendar): overdue checklists are reported to HR editors and the manager — on the first overdue day and then weekly.
 * Each notice carries a dedupe key, so restarts and repeated runs never send it twice. Assignees already get the
 * daily due/overdue notice of their linked work task.
 */
export function runOnboardingReminders({ force = false } = {}) {
  const t = today();
  if (!force && (getSetting('onboarding_reminders_last_run') === t || !inWorkingHours())) return { skipped: true };
  let n = 0;
  const hr = hrApprovers();
  for (const o of all(`SELECT o.id, o.employee_id, o.template_name, e.name, (SELECT MIN(due_date) FROM onboarding_items i WHERE i.onboarding_id=o.id AND i.status NOT IN ('completed','waived') AND i.due_date<?) oldest,
      (SELECT COUNT(*) FROM onboarding_items i WHERE i.onboarding_id=o.id AND i.status NOT IN ('completed','waived') AND i.due_date<?) late
    FROM onboardings o JOIN employees e ON e.id=o.employee_id WHERE o.status IN ('pending','in_progress')`, t, t)) {
    if (!o.late) continue;
    const days = Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${o.oldest}T00:00:00Z`)) / 86400000);
    if (!(days === 1 || days % 7 === 0 || !get('SELECT last_overdue_notice FROM onboardings WHERE id=?', o.id)?.last_overdue_notice)) continue;
    const emp = get('SELECT * FROM employees WHERE id=?', o.employee_id);
    notify([...hr, managerUserId(emp)], 'onboarding', 'Onboarding overdue', `${o.name}: ${o.late} checklist item(s) overdue (oldest due ${o.oldest})`, `/hrm/onboarding/${o.id}`, { dedupe: `onb-overdue-${o.id}-${t}` });
    run('UPDATE onboardings SET last_overdue_notice=? WHERE id=?', t, o.id);
    n++;
  }
  setSetting('onboarding_reminders_last_run', t);
  return { sent: n };
}
