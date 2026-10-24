import { Router } from 'express';
import { customerSearchClause, findDuplicateContacts } from '../services/customers.js';
import { all, get, run, tx, insert, update } from '../db.js';
import { can, ownerId, requireStaff, hasPerm } from '../rbac.js';
import { audit, activity, notify, userName } from '../audit.js';
import { buildWhere } from '../filters.js';
import { sendTable } from './helpers.js';
import { asyncH, bad, forbidden, notFound, jparse, now, today, int, required, region } from '../util.js';
import { saleSummary } from '../services/sales.js';
import { attributionFor } from '../services/leads.js';
import { customerLedger } from '../services/payments.js';
import { progressSql } from '../services/schedule.js';

const r = Router();

const COLS = ['first_name', 'last_name', 'full_name', 'father_name', 'cnic', 'dob', 'gender', 'phone', 'alt_phone', 'whatsapp', 'email',
  'country', 'province', 'city', 'area', 'address', 'company', 'lead_source', 'stage_id', 'lead_type', 'agent_id', 'manager_id', 'tags',
  'priority', 'project_id', 'property_id', 'budget', 'pref_location', 'property_type', 'followup_date', 'custom'];

const BASE = `SELECT c.*, st.value stage, st.color stage_color, ag.name agent_name, mg.name manager_name, pr.name project_name, pp.title property_title,
  (SELECT COUNT(*) FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed') sales_count
  FROM contacts c LEFT JOIN lookups st ON st.id=c.stage_id LEFT JOIN users ag ON ag.id=c.agent_id LEFT JOIN users mg ON mg.id=c.manager_id
  LEFT JOIN projects pr ON pr.id=c.project_id LEFT JOIN properties pp ON pp.id=c.property_id`;

export const CONTACT_FIELDS = {
  stage: 'c.stage_id', source: 'c.lead_source', agent: 'c.agent_id', manager: 'c.manager_id', project: 'c.project_id', property: 'c.property_id',
  city: 'c.city', budget: 'c.budget', created: 'date(c.created_at)', last_activity: 'date(c.last_activity_at)', followup: 'c.followup_date',
  tags: 'c.tags', customer_type: 'c.lead_type', is_customer: 'c.is_customer', property_type: 'c.property_type', priority: 'c.priority',
  payment_status: `(CASE WHEN EXISTS(SELECT 1 FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.contact_id=c.id AND s.status='confirmed' AND i.status<>'paid' AND i.due_date<date('now','+5 hours')) THEN 'overdue'
    WHEN EXISTS(SELECT 1 FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed' AND s.paid_amount<s.net_price) THEN 'current'
    WHEN EXISTS(SELECT 1 FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed') THEN 'paid' ELSE 'none' END)`,
};
const SORTS = { name: 'c.full_name', phone: 'c.phone', email: 'c.email', created: 'c.created_at', activity: 'c.last_activity_at', followup: 'c.followup_date',
  stage: 'st.sort_order', agent: 'ag.name', company: 'c.company', source: 'c.lead_source', budget: 'c.budget' };

function visibility(req) {
  const o = ownerId(req);
  return o ? { sql: '(c.agent_id=? OR c.created_by=?)', params: [o, o] } : { sql: '1=1', params: [] };
}
function assertContactAccess(req, c) {
  if (!c) throw notFound('Contact not found');
  const o = ownerId(req);
  if (o && c.agent_id !== o && c.created_by !== o) throw forbidden('This contact is not assigned to you');
}

function listContacts(req) {
  const q = req.query;
  const where = [], params = [];
  const v = visibility(req); where.push(v.sql); params.push(...v.params);
  if (q.q) {
    const sc = customerSearchClause(q.q);
    where.push(`(${sc.sql} OR c.company LIKE ?)`);
    params.push(...sc.params, `%${q.q}%`);
  }
  let rules = [], logic = 'AND';
  if (q.smart_list) {
    const sl = get('SELECT * FROM smart_lists WHERE id=?', q.smart_list);
    if (!sl) throw notFound('Smart list not found');
    if (sl.owner_id !== req.user.id && !sl.shared) throw forbidden();
    rules = jparse(sl.rules, []); logic = sl.logic;
  } else if (q.filters) {
    const f = jparse(q.filters, {}); rules = f.rules || []; logic = f.logic || 'AND';
  }
  const w = buildWhere(CONTACT_FIELDS, logic, rules); where.push(w.sql); params.push(...w.params);
  if (q.type === 'lead') where.push('c.is_customer=0');
  if (q.type === 'customer') where.push('c.is_customer=1');
  const sort = SORTS[q.sort] || 'c.created_at';
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  return { where: where.join(' AND '), params, order: `${sort} ${dir}, c.id DESC` };
}

r.get('/contacts', can('crm', 'view'), asyncH(async (req, res) => {
  const { where, params, order } = listContacts(req);
  const exporting = ['csv', 'xlsx', 'pdf'].includes(req.query.format);
  const limit = exporting ? 100000 : Math.min(Number(req.query.limit) || 25, 500);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const total = get(`SELECT COUNT(*) n FROM (${BASE} WHERE ${where})`, ...params).n;
  const rows = all(`${BASE} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit)
    .map((c) => ({ ...c, tags: jparse(c.tags, []), custom: jparse(c.custom, {}) }));
  if (exporting) {
    if (!hasPerm(req.user, 'crm', 'export')) throw forbidden('You do not have permission to export');
    audit(req, 'Exported contacts', 'contact', null, `${rows.length} rows`);
    return sendTable(res, req.query.format, 'contacts', [
      ['full_name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['company', 'Company'], ['lead_source', 'Source'], ['stage', 'Stage'],
      ['agent_name', 'Agent'], ['created_at', 'Created'], ['followup_date', 'Follow-up'], ['city', 'City'], ['budget', 'Budget'],
    ].map(([key, label]) => ({ key, label })), rows);
  }
  res.json({ rows, total, page, limit });
}));

r.get('/contacts/duplicates', can('crm', 'view'), asyncH((req, res) => {
  const { phone, email, cnic, alt_phone, whatsapp, exclude } = req.query;
  const o = ownerId(req);
  res.json(findDuplicateContacts({ phone, email, cnic, alt_phone, whatsapp }, Number(exclude) || 0).map((c) => {
    const mine = !o || c.agent_id === o || c.created_by === o;
    // an agent learns that the person is already registered, but not whose lead it is or their details
    return mine ? { id: c.id, full_name: c.full_name, phone: c.phone, email: c.email, customer_code: c.customer_code, mine: true } : { id: null, full_name: null, mine: false };
  }));
}));

function normalise(data, req, existing) {
  const d = { ...data };
  if (d.tags !== undefined && typeof d.tags !== 'string') d.tags = JSON.stringify(d.tags || []);
  if (d.custom !== undefined && typeof d.custom !== 'string') d.custom = JSON.stringify(d.custom || {});
  for (const k of ['budget', 'stage_id', 'agent_id', 'manager_id', 'project_id', 'property_id']) {
    if (d[k] === '') d[k] = null;
    else if (d[k] !== undefined && d[k] !== null) d[k] = Number(d[k]);
  }
  for (const k of ['followup_date', 'dob', 'email', 'cnic', 'phone', 'alt_phone', 'whatsapp']) if (d[k] === '') d[k] = null;
  if (d.first_name !== undefined || d.last_name !== undefined || d.full_name !== undefined) {
    const fn = d.first_name ?? existing?.first_name ?? '', ln = d.last_name ?? existing?.last_name ?? '';
    if (!d.full_name) d.full_name = `${fn} ${ln}`.trim();
  }
  if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) throw bad('Email address is not valid');
  // the CNIC format is Pakistan's; other regions keep identity numbers in the encrypted identity store
  if (d.cnic && region().config.region === 'PK' && !/^\d{5}-?\d{7}-?\d$/.test(d.cnic)) throw bad('CNIC must look like 12345-1234567-1');
  if (d.phone && !/^[+\d][\d\s\-()]{6,19}$/.test(d.phone)) throw bad('Phone number is not valid');
  if (d.followup_date && !/^\d{4}-\d{2}-\d{2}$/.test(d.followup_date)) throw bad('Follow-up date must be YYYY-MM-DD');
  if (d.budget != null && d.budget < 0) throw bad('Budget cannot be negative');
  return d;
}

r.post('/contacts', can('crm', 'create'), asyncH((req, res) => {
  const d = normalise(req.body, req);
  required(d, 'full_name');
  if (!d.phone && !d.alt_phone && !d.whatsapp && !d.email) throw bad('Add a phone number, WhatsApp number or email so the lead can be contacted');
  const o = ownerId(req);
  const dup = findDuplicateContacts(d)[0];
  if (dup) {
    const mine = !o || dup.agent_id === o || dup.created_by === o;
    if (!mine) throw bad('This phone / email / CNIC is already registered with another agent. Ask your sales manager.', { duplicate_hidden: true }); // never overridable by an agent
    if (!req.body.force) throw bad(`A contact with the same phone/email/CNIC already exists: ${dup.full_name}`, { duplicate_id: dup.id });
  }
  if (req.user.own_scope) { d.agent_id = req.user.id; delete d.manager_id; }
  if (!d.stage_id) d.stage_id = get(`SELECT id FROM lookups WHERE type='lead_stage' AND active=1 ORDER BY sort_order LIMIT 1`)?.id;
  if (!d.manager_id) d.manager_id = get(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Sales Manager' AND u.active=1 LIMIT 1`)?.id ?? null;
  d.created_by = req.user.id; d.created_at = now(); d.last_activity_at = now();
  const id = tx(() => {
    const cid = insert('contacts', d, [...COLS, 'created_by', 'created_at', 'last_activity_at']);
    activity(cid, req.user, 'Lead created', { detail: d.lead_source ? `Source: ${d.lead_source}` : null });
    if (d.agent_id) {
      activity(cid, req.user, 'Contact assigned', { field: 'Sales agent', next: userName(d.agent_id) });
      if (d.agent_id !== req.user.id) notify(d.agent_id, 'lead', 'New lead assigned', `${d.full_name} was assigned to you`, `/contacts/${cid}`);
    }
    if (req.user.own_scope) notify(d.manager_id, 'lead', 'New lead from agent', `${req.user.name} added ${d.full_name}`, `/contacts/${cid}`);
    if (d.followup_date) run(`INSERT INTO tasks(entity_type,entity_id,title,due_date,assigned_to,created_by,created_at) VALUES('contact',?,?,?,?,?,?)`, cid, 'Follow up', d.followup_date, d.agent_id ?? req.user.id, req.user.id, now());
    audit(req, 'Created lead', 'contact', cid, d.full_name);
    return cid;
  });
  res.status(201).json(get(`${BASE} WHERE c.id=?`, id));
}));

const LABELS = { stage_id: 'Lead stage', agent_id: 'Sales agent', manager_id: 'Sales manager', followup_date: 'Follow-up date', priority: 'Priority',
  project_id: 'Interested project', property_id: 'Interested property', budget: 'Budget', lead_source: 'Lead source', phone: 'Phone', email: 'Email' };
const display = (k, v) => {
  if (v == null || v === '') return null;
  if (k === 'stage_id') return get('SELECT value FROM lookups WHERE id=?', v)?.value;
  if (k === 'agent_id' || k === 'manager_id') return userName(v);
  if (k === 'project_id') return get('SELECT name FROM projects WHERE id=?', v)?.name;
  if (k === 'property_id') return get('SELECT title FROM properties WHERE id=?', v)?.title;
  return String(v);
};

export function updateContact(id, body, req) {
  const existing = get('SELECT * FROM contacts WHERE id=?', id);
  assertContactAccess(req, existing);
  const d = normalise(body, req, existing);
  if (req.user.own_scope) { delete d.agent_id; delete d.manager_id; }
  // changing a phone / e-mail / CNIC must not make this contact a duplicate of another one
  const ID_KEYS = ['phone', 'alt_phone', 'whatsapp', 'email', 'cnic'];
  const changed = Object.fromEntries(ID_KEYS.filter((k) => d[k] !== undefined && String(d[k] || '') !== String(existing[k] || '')).map((k) => [k, d[k]]));
  if (Object.keys(changed).length) {
    const dup = findDuplicateContacts(changed, id)[0];
    if (dup) {
      const o = ownerId(req), mine = !o || dup.agent_id === o || dup.created_by === o;
      if (!mine) throw bad('This phone / email / CNIC is already registered with another agent. Ask your sales manager.', { duplicate_hidden: true });
      if (!body.force) throw bad(`Another contact already uses this phone/email/CNIC: ${dup.full_name}`, { duplicate_id: dup.id });
    }
  }
  const after = { ...existing, ...d };
  if ((existing.phone || existing.alt_phone || existing.whatsapp || existing.email) && !after.phone && !after.alt_phone && !after.whatsapp && !after.email) throw bad('A lead needs at least a phone number, WhatsApp number or email');
  d.updated_at = now();
  tx(() => {
    update('contacts', id, d, [...COLS, 'updated_at']);
    for (const k of Object.keys(LABELS)) {
      if (d[k] === undefined) continue;
      const prev = existing[k] ?? null, next = d[k] ?? null;
      if (String(prev ?? '') === String(next ?? '')) continue;
      const action = k === 'stage_id' ? 'Lead stage changed' : k === 'agent_id' ? (prev ? 'Sales agent changed' : 'Contact assigned')
        : k === 'followup_date' ? 'Follow-up scheduled' : `${LABELS[k]} updated`;
      activity(id, req.user, action, { field: LABELS[k], prev: display(k, prev), next: display(k, next) });
      if (k === 'agent_id' && next) notify(next, 'lead', 'Lead assigned to you', existing.full_name, `/contacts/${id}`);
      if (k === 'stage_id') audit(req, 'Lead stage changed', 'contact', id, `${existing.full_name}: ${display(k, prev)} → ${display(k, next)}`);
    }
    if (d.followup_date && d.followup_date !== existing.followup_date) {
      run(`INSERT INTO tasks(entity_type,entity_id,title,due_date,assigned_to,created_by,created_at) VALUES('contact',?,?,?,?,?,?)`, id, 'Follow up', d.followup_date, existing.agent_id ?? req.user.id, req.user.id, now());
    }
  });
  return get(`${BASE} WHERE c.id=?`, id);
}
r.put('/contacts/:id(\\d+)', can('crm', 'edit'), asyncH((req, res) => res.json(updateContact(Number(req.params.id), req.body, req))));

r.delete('/contacts/:id(\\d+)', can('crm', 'delete'), asyncH((req, res) => {
  const c = get('SELECT * FROM contacts WHERE id=?', req.params.id);
  assertContactAccess(req, c);
  if (get('SELECT 1 FROM sales WHERE contact_id=?', c.id) || get('SELECT 1 FROM receipts WHERE contact_id=?', c.id)) throw bad('This contact has sales/receipts and cannot be deleted');
  tx(() => {
    for (const t of ['activities', 'notes', 'tasks']) run(`DELETE FROM ${t} WHERE ${t === 'activities' ? 'contact_id' : "entity_type='contact' AND entity_id"}=?`, c.id);
    run('DELETE FROM contacts WHERE id=?', c.id);
  });
  audit(req, 'Deleted contact', 'contact', c.id, c.full_name);
  res.json({ ok: true });
}));

r.post('/contacts/bulk', can('crm', 'edit'), asyncH((req, res) => {
  const { ids, action, value } = req.body;
  if (!Array.isArray(ids) || !ids.length) throw bad('Select at least one contact');
  let n = 0;
  tx(() => {
    for (const id of ids) {
      const c = get('SELECT * FROM contacts WHERE id=?', id);
      assertContactAccess(req, c);
      if (action === 'stage') { updateContact(id, { stage_id: value }, req); n++; }
      else if (action === 'assign') {
        if (req.user.own_scope) throw forbidden();
        updateContact(id, { agent_id: value }, req); n++;
      } else if (action === 'add_tag' || action === 'remove_tag') {
        const tags = new Set(jparse(c.tags, []));
        if (action === 'add_tag') tags.add(String(value)); else tags.delete(String(value));
        run('UPDATE contacts SET tags=? WHERE id=?', JSON.stringify([...tags]), id);
        activity(id, req.user, `Tag ${action === 'add_tag' ? 'added' : 'removed'}`, { next: String(value) }); n++;
      } else if (action === 'delete') {
        if (!hasPerm(req.user, 'crm', 'delete')) throw forbidden();
        if (get('SELECT 1 FROM sales WHERE contact_id=?', id)) continue;
        run('DELETE FROM activities WHERE contact_id=?', id); run('DELETE FROM contacts WHERE id=?', id); n++;
      } else throw bad('Unknown bulk action');
    }
  });
  audit(req, `Bulk ${action}`, 'contact', null, `${n} contacts`);
  res.json({ updated: n });
}));

r.post('/contacts/import', can('crm', 'create'), asyncH((req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows) || !rows.length) throw bad('No rows to import');
  if (rows.length > 5000) throw bad('Import is limited to 5000 rows at a time');
  const stage = get(`SELECT id FROM lookups WHERE type='lead_stage' AND active=1 ORDER BY sort_order LIMIT 1`)?.id;
  const mgr = get(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Sales Manager' AND u.active=1 LIMIT 1`)?.id ?? null;
  let created = 0, skipped = 0; const errors = [];
  tx(() => {
    rows.forEach((row, i) => {
      try {
        const d = normalise({ ...row }, req);
        if (!d.full_name) { skipped++; return; }
        if (d.phone && get('SELECT 1 FROM contacts WHERE phone=?', d.phone)) { skipped++; return; }
        if (d.email && get('SELECT 1 FROM contacts WHERE email=?', d.email)) { skipped++; return; }
        d.stage_id = d.stage_id || stage; d.manager_id = d.manager_id || mgr; d.created_by = req.user.id; d.created_at = now(); d.last_activity_at = now();
        if (req.user.own_scope) d.agent_id = req.user.id;
        const id = insert('contacts', d, [...COLS, 'created_by', 'created_at', 'last_activity_at']);
        activity(id, req.user, 'Lead created', { detail: 'Imported' });
        created++;
      } catch (e) { errors.push(`Row ${i + 1}: ${e.message}`); skipped++; }
    });
  });
  audit(req, 'Imported contacts', 'contact', null, `${created} created, ${skipped} skipped`);
  res.json({ created, skipped, errors: errors.slice(0, 20) });
}));

/** The full customer / lead workspace — one call, everything linked. */
r.get('/contacts/:id(\\d+)/workspace', can('crm', 'view'), asyncH((req, res) => {
  const id = Number(req.params.id);
  const c = get(`${BASE} WHERE c.id=?`, id);
  assertContactAccess(req, c);
  c.tags = jparse(c.tags, []); c.custom = jparse(c.custom, {});
  const finance = hasPerm(req.user, 'payments', 'view') || hasPerm(req.user, 'accounting', 'view');
  const confirmed = (list) => list.filter((s) => s.status === 'confirmed');
  const salesRows = all('SELECT id FROM sales WHERE contact_id=? ORDER BY id DESC', id).map((s) => saleSummary(s.id));
  const out = {
    contact: c,
    activities: all('SELECT * FROM activities WHERE contact_id=? ORDER BY id DESC LIMIT 300', id),
    notes: all('SELECT n.*, u.name user_name FROM notes n LEFT JOIN users u ON u.id=n.user_id WHERE entity_type=? AND entity_id=? ORDER BY n.id DESC', 'contact', id),
    tasks: all(`SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE entity_type='contact' AND entity_id=? ORDER BY (status='done'), due_date`, id),
    documents: all('SELECT d.*, u.name uploaded_by_name FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE entity_type=? AND entity_id=? ORDER BY d.id DESC', 'contact', id),
    attribution: attributionFor(id).map(({ connection_id, ...a }) => a), // where website enquiries came from and what the visitor agreed to
    sales: salesRows,
    projects: all(`SELECT DISTINCT pr.id, pr.name, pr.code, pr.dev_status FROM projects pr JOIN sales s ON s.project_id=pr.id WHERE s.contact_id=? AND s.status='confirmed'`, id),
    interests: all(`SELECT p.id, p.title, p.status, p.net_price FROM properties p WHERE p.id=?`, c.property_id ?? 0),
  };
  out.totals = {
    purchase_value: confirmed(salesRows).reduce((a, s) => a + s.net_price, 0),
    paid: confirmed(salesRows).reduce((a, s) => a + s.paid_amount, 0),
    outstanding: confirmed(salesRows).reduce((a, s) => a + s.outstanding, 0),
    overdue: confirmed(salesRows).reduce((a, s) => a + s.overdue_amount, 0),
  };
  if (finance) {
    out.receipts = all(`SELECT r.*, (SELECT GROUP_CONCAT(s2.sale_no, ' + ') FROM receipt_sales rs JOIN sales s2 ON s2.id=rs.sale_id WHERE rs.receipt_id=r.id) sale_no FROM receipts r WHERE r.contact_id=? ORDER BY r.date DESC, r.id DESC`, id);
    out.ledger = customerLedger(id);
  }
  out.development = all(`SELECT pr.id project_id, pr.name project_name, pr.dev_status,
      ${progressSql('pr.id')} progress FROM projects pr WHERE pr.id IN (SELECT project_id FROM sales WHERE contact_id=? AND status='confirmed')`, id);
  out.appointments = all(`SELECT t.* FROM tasks t WHERE entity_type='contact' AND entity_id=? AND status='open' AND (title LIKE '%visit%' OR title LIKE '%meeting%' OR title LIKE '%appointment%') ORDER BY due_date`, id);
  res.json(out);
}));

// ---- Notes
r.get('/notes', can('crm', 'view'), asyncH((req, res) => {
  const v = visibility(req);
  const where = [v.sql], params = [...v.params];
  if (req.query.q) { where.push('(n.body LIKE ? OR c.full_name LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const limit = Math.min(Number(req.query.limit) || 30, 200), page = Math.max(Number(req.query.page) || 1, 1);
  const from = `FROM notes n JOIN contacts c ON c.id=n.entity_id AND n.entity_type='contact' LEFT JOIN users u ON u.id=n.user_id WHERE ${where.join(' AND ')}`;
  res.json({
    rows: all(`SELECT n.*, u.name user_name, c.full_name contact_name ${from} ORDER BY n.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit),
    total: get(`SELECT COUNT(*) n ${from}`, ...params).n, page, limit,
  });
}));
r.post('/notes', can('crm', 'edit'), asyncH((req, res) => {
  const { entity_type = 'contact', entity_id, body } = req.body;
  if (!entity_id || !body?.trim()) throw bad('Note text is required');
  if (entity_type === 'contact') assertContactAccess(req, get('SELECT * FROM contacts WHERE id=?', entity_id));
  const rr = run('INSERT INTO notes(entity_type,entity_id,body,user_id,created_at) VALUES(?,?,?,?,?)', entity_type, entity_id, body.trim(), req.user.id, now());
  if (entity_type === 'contact') activity(entity_id, req.user, 'Note added', { detail: body.trim().slice(0, 140) });
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));
r.delete('/notes/:id(\\d+)', can('crm', 'edit'), asyncH((req, res) => {
  const n = get('SELECT * FROM notes WHERE id=?', req.params.id);
  if (!n) throw notFound();
  if (n.user_id !== req.user.id && !hasPerm(req.user, 'crm', 'delete')) throw forbidden();
  run('DELETE FROM notes WHERE id=?', n.id);
  audit(req, 'Deleted note', 'note', n.id);
  res.json({ ok: true });
}));

// ---- Tasks
function syncFollowup(contactId) {
  const next = get(`SELECT MIN(due_date) d FROM tasks WHERE entity_type='contact' AND entity_id=? AND status='open'`, contactId)?.d ?? null;
  run('UPDATE contacts SET followup_date=? WHERE id=?', next, contactId);
}
r.get('/tasks', can('crm', 'view'), asyncH((req, res) => {
  const where = ['1=1'], params = [];
  if (ownerId(req) || req.query.mine) { where.push('(t.assigned_to=? OR t.created_by=?)'); params.push(req.user.id, req.user.id); }
  if (req.query.status) { where.push('t.status=?'); params.push(req.query.status); }
  if (req.query.due === 'today') { where.push('t.due_date=?'); params.push(today()); }
  if (req.query.due === 'overdue') { where.push("t.due_date<? AND t.status='open'"); params.push(today()); }
  res.json(all(`SELECT t.*, u.name assignee, c.full_name contact_name FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to
    LEFT JOIN contacts c ON (t.entity_type='contact' AND c.id=t.entity_id) WHERE ${where.join(' AND ')} ORDER BY (t.status='done'), t.due_date LIMIT 500`, ...params));
}));
r.post('/tasks', can('crm', 'create'), asyncH((req, res) => {
  const { entity_type = 'contact', entity_id, title, due_date, assigned_to, priority } = req.body;
  if (!title?.trim()) throw bad('Task title is required');
  if (entity_type === 'contact' && entity_id) assertContactAccess(req, get('SELECT * FROM contacts WHERE id=?', entity_id));
  const rr = run('INSERT INTO tasks(entity_type,entity_id,title,due_date,assigned_to,priority,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
    entity_type, entity_id ?? null, title.trim(), due_date || null, assigned_to || req.user.id, priority || 'Medium', req.user.id, now());
  if (entity_type === 'contact' && entity_id) { activity(entity_id, req.user, 'Task created', { detail: `${title}${due_date ? ' — due ' + due_date : ''}` }); syncFollowup(entity_id); }
  if (assigned_to && assigned_to !== req.user.id) notify(assigned_to, 'task', 'Task assigned', title, entity_id ? `/contacts/${entity_id}` : '/tasks');
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));
r.put('/tasks/:id(\\d+)', can('crm', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM tasks WHERE id=?', req.params.id);
  if (!t) throw notFound();
  const o = ownerId(req);
  if (o && t.assigned_to !== o && t.created_by !== o) throw forbidden();
  const { status, title, due_date, priority } = req.body;
  if (title !== undefined || due_date !== undefined || priority !== undefined) {
    run('UPDATE tasks SET title=COALESCE(?,title), due_date=COALESCE(?,due_date), priority=COALESCE(?,priority) WHERE id=?', title ?? null, due_date ?? null, priority ?? null, t.id);
  }
  if (status && status !== t.status) {
    run('UPDATE tasks SET status=?, completed_at=? WHERE id=?', status, status === 'done' ? now() : null, t.id);
    if (t.entity_type === 'contact' && t.entity_id) {
      activity(t.entity_id, req.user, status === 'done' ? (/follow/i.test(t.title) ? 'Follow-up completed' : 'Task completed') : 'Task reopened', { detail: t.title });
    }
  }
  if (t.entity_type === 'contact' && t.entity_id) syncFollowup(t.entity_id);
  res.json({ ok: true });
}));
r.delete('/tasks/:id(\\d+)', can('crm', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM tasks WHERE id=?', req.params.id);
  if (!t) throw notFound();
  run('DELETE FROM tasks WHERE id=?', t.id);
  if (t.entity_type === 'contact' && t.entity_id) syncFollowup(t.entity_id);
  res.json({ ok: true });
}));

// ---- Pipeline
r.get('/pipeline', can('crm', 'view'), asyncH((req, res) => {
  const stages = all(`SELECT id,value,color,meta FROM lookups WHERE type='lead_stage' AND active=1 ORDER BY sort_order,id`);
  const v = visibility(req);
  const where = [v.sql], params = [...v.params];
  if (req.query.agent) { where.push('c.agent_id=?'); params.push(req.query.agent); }
  if (req.query.q) { where.push('(c.full_name LIKE ? OR c.phone LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const cards = all(`${BASE} WHERE ${where.join(' AND ')} ORDER BY c.last_activity_at DESC LIMIT 1500`, ...params)
    .map((c) => ({ id: c.id, full_name: c.full_name, phone: c.phone, stage_id: c.stage_id, project_name: c.project_name, property_title: c.property_title,
      budget: c.budget, agent_name: c.agent_name, followup_date: c.followup_date, last_activity_at: c.last_activity_at, is_customer: c.is_customer, priority: c.priority }));
  res.json({ stages: stages.map((s) => ({ ...s, meta: jparse(s.meta, {}) })), cards });
}));
r.put('/pipeline/move', can('crm', 'edit'), asyncH((req, res) => {
  const { contact_id, stage_id } = req.body;
  if (!get("SELECT 1 FROM lookups WHERE id=? AND type='lead_stage'", stage_id)) throw bad('Invalid stage');
  res.json(updateContact(Number(contact_id), { stage_id }, req));
}));

// ---- Smart lists
const sl = (row) => ({ ...row, rules: jparse(row.rules, []) });
r.get('/smart-lists', can('crm', 'view'), asyncH((req, res) => {
  res.json(all('SELECT * FROM smart_lists WHERE owner_id=? OR shared=1 ORDER BY is_default DESC, name', req.user.id).map(sl));
}));
r.post('/smart-lists', can('crm', 'create'), asyncH((req, res) => {
  const { name, logic = 'AND', rules = [], shared = false } = req.body;
  if (!name?.trim()) throw bad('Name is required');
  buildWhere(CONTACT_FIELDS, logic, rules); // validates fields/operators
  const rr = run('INSERT INTO smart_lists(name,logic,rules,owner_id,shared,created_at) VALUES(?,?,?,?,?,?)', name.trim(), logic === 'OR' ? 'OR' : 'AND', JSON.stringify(rules), req.user.id, shared ? 1 : 0, now());
  audit(req, 'Created smart list', 'smart_list', rr.lastInsertRowid, name);
  res.status(201).json(sl(get('SELECT * FROM smart_lists WHERE id=?', rr.lastInsertRowid)));
}));
function ownList(req) {
  const l = get('SELECT * FROM smart_lists WHERE id=?', req.params.id);
  if (!l) throw notFound();
  if (l.owner_id !== req.user.id && !req.user.isSuper && !hasPerm(req.user, 'crm', 'approve')) throw forbidden('Only the owner can change this smart list');
  return l;
}
r.put('/smart-lists/:id(\\d+)', can('crm', 'edit'), asyncH((req, res) => {
  const l = ownList(req);
  const { name, logic, rules, shared, is_default } = req.body;
  if (rules) buildWhere(CONTACT_FIELDS, logic || l.logic, rules);
  tx(() => {
    if (is_default) run('UPDATE smart_lists SET is_default=0');
    run(`UPDATE smart_lists SET name=COALESCE(?,name), logic=COALESCE(?,logic), rules=COALESCE(?,rules), shared=COALESCE(?,shared), is_default=COALESCE(?,is_default) WHERE id=?`,
      name ?? null, logic ?? null, rules ? JSON.stringify(rules) : null, shared === undefined ? null : shared ? 1 : 0, is_default === undefined ? null : is_default ? 1 : 0, l.id);
  });
  audit(req, 'Edited smart list', 'smart_list', l.id, name || l.name);
  res.json(sl(get('SELECT * FROM smart_lists WHERE id=?', l.id)));
}));
r.post('/smart-lists/:id(\\d+)/duplicate', can('crm', 'create'), asyncH((req, res) => {
  const l = get('SELECT * FROM smart_lists WHERE id=?', req.params.id);
  if (!l || (l.owner_id !== req.user.id && !l.shared)) throw notFound();
  const rr = run('INSERT INTO smart_lists(name,logic,rules,owner_id,shared,created_at) VALUES(?,?,?,?,0,?)', `${l.name} (copy)`, l.logic, l.rules, req.user.id, now());
  res.status(201).json(sl(get('SELECT * FROM smart_lists WHERE id=?', rr.lastInsertRowid)));
}));
r.delete('/smart-lists/:id(\\d+)', can('crm', 'edit'), asyncH((req, res) => {
  const l = ownList(req);
  run('DELETE FROM smart_lists WHERE id=?', l.id);
  audit(req, 'Deleted smart list', 'smart_list', l.id, l.name);
  res.json({ ok: true });
}));

// ---- Reserve property for a contact (from the workspace)
r.post('/contacts/:id(\\d+)/reserve-property', can('crm', 'edit'), asyncH((req, res) => {
  const c = get('SELECT * FROM contacts WHERE id=?', req.params.id);
  assertContactAccess(req, c);
  const p = get('SELECT * FROM properties WHERE id=?', req.body.property_id);
  if (!p) throw notFound('Property not found');
  if (!['available', 'featured'].includes(p.status)) throw bad(`Only available properties can be reserved (current: ${p.status})`);
  run("UPDATE properties SET status='reserved', reserved_contact_id=?, updated_at=? WHERE id=?", c.id, now(), p.id);
  activity(c.id, req.user, 'Property reserved', { detail: p.title, entityType: 'property', entityId: p.id });
  audit(req, 'Property status', 'property', p.id, `${p.title}: ${p.status} → reserved for ${c.full_name}`);
  res.json({ ok: true });
}));
r.post('/contacts/:id(\\d+)/view-property', can('crm', 'edit'), asyncH((req, res) => {
  const c = get('SELECT * FROM contacts WHERE id=?', req.params.id);
  assertContactAccess(req, c);
  const p = get('SELECT id,title FROM properties WHERE id=?', req.body.property_id);
  if (!p) throw notFound('Property not found');
  update('contacts', c.id, { property_id: p.id }, ['property_id']);
  activity(c.id, req.user, 'Property viewed', { detail: p.title, entityType: 'property', entityId: p.id });
  res.json({ ok: true });
}));

export default r;
