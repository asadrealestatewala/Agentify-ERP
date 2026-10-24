import { Router } from 'express';
import { all, get, run, tx, insert, update } from '../db.js';
import { can, hasPerm, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { crud, uploader } from './helpers.js';
import { asyncH, bad, notFound, jparse, now, today, int } from '../util.js';
import { projectFinancials } from '../services/projectFinance.js';
import { scheduleFor, progressSql } from '../services/schedule.js';
import { publish } from '../services/events.js';

const r = Router();

const PCOLS = ['code', 'name', 'location', 'developer', 'description', 'total_land_area', 'land_unit', 'total_units', 'total_value', 'dev_status',
  'manager_id', 'start_date', 'expected_completion', 'is_development', 'kind', 'budget', 'site_visible', 'created_at'];

const pc = Router();
crud(pc, {
  table: 'projects', module: 'projects', cols: PCOLS, search: ['projects.name', 'projects.code', 'projects.location'], filters: ['is_development', 'dev_status', 'kind'], label: 'project',
  required: ['code', 'name'], orderBy: 'projects.name',
  select: `SELECT projects.*, u.name manager_name,
    (SELECT COUNT(*) FROM properties WHERE project_id=projects.id AND status<>'cancelled') units,
    (SELECT COUNT(*) FROM properties WHERE project_id=projects.id AND status='sold') units_sold,
    (SELECT COUNT(*) FROM properties WHERE project_id=projects.id AND status IN ('available','featured')) units_available,
    ${progressSql('projects.id')} progress,
    (SELECT COUNT(*) FROM sales WHERE project_id=projects.id AND kind='construction' AND status='confirmed') contracts
    FROM projects LEFT JOIN users u ON u.id=projects.manager_id`,
  before: (d, req, existing) => {
    if (d.code && get('SELECT 1 FROM projects WHERE code=? AND id<>?', d.code, existing?.id ?? 0)) throw bad('Project code already exists');
    for (const k of ['total_units', 'total_value', 'budget']) if (d[k] === '') d[k] = null;
    if (d.manager_id === '') d.manager_id = null;
  },
  after: (id) => publish('project', id),
  canDelete: (p) => { if (get('SELECT 1 FROM properties WHERE project_id=?', p.id)) throw bad('Project has units and cannot be deleted'); },
});
r.use('/projects', pc);

/** Project workspace: units, customers, finances, vendors, progress, docs — all linked. */
r.get('/projects/:id(\\d+)/workspace', can('projects', 'view'), asyncH((req, res) => {
  const id = Number(req.params.id);
  const project = get(`SELECT p.*, u.name manager_name FROM projects p LEFT JOIN users u ON u.id=p.manager_id WHERE p.id=?`, id);
  if (!project) throw notFound();
  const out = {
    project,
    units: all(`SELECT p.id,p.code,p.title,p.block,p.plot_no,p.property_type,p.area_size,p.unit,p.net_price,p.status,
      (SELECT c.full_name FROM sales s JOIN contacts c ON c.id=s.contact_id WHERE s.property_id=p.id AND s.status='confirmed') customer,
      (SELECT s.id FROM sales s WHERE s.property_id=p.id AND s.status='confirmed') sale_id FROM properties p WHERE p.project_id=? ORDER BY p.block, p.plot_no`, id),
    dev_items: all('SELECT * FROM dev_items WHERE project_id=? ORDER BY sort_order,id', id),
    dev_updates: all('SELECT * FROM dev_updates WHERE project_id=? ORDER BY update_date DESC, id DESC', id).map((u) => ({ ...u, videos: jparse(u.videos, []),
      media: all("SELECT * FROM media WHERE entity_type='dev_update' AND entity_id=? ORDER BY sort_order,id", u.id) })),
    documents: all('SELECT * FROM documents WHERE entity_type=? AND entity_id=? ORDER BY id DESC', 'project', id),
    media: all("SELECT * FROM media WHERE entity_type='project' AND entity_id=? ORDER BY sort_order,id", id),
    schedule: scheduleFor(id, { scope: 'project' }),
    contracts: all(`SELECT s.id,s.sale_no,s.title,s.net_price,s.paid_amount,c.full_name customer,c.id contact_id,pp.title plot FROM sales s JOIN contacts c ON c.id=s.contact_id LEFT JOIN properties pp ON pp.id=s.property_id WHERE s.project_id=? AND s.kind='construction' AND s.status='confirmed' ORDER BY s.id DESC`, id),
  };
  if (hasPerm(req.user, 'accounting', 'view') || hasPerm(req.user, 'reports', 'view') || req.user.isSuper) {
    out.financials = projectFinancials(id);
    out.customers = all(`SELECT c.id,c.full_name,c.phone,s.sale_no,s.net_price,s.paid_amount,s.kind,s.id sale_id,COALESCE(s.title,p.title) title FROM sales s JOIN contacts c ON c.id=s.contact_id LEFT JOIN properties p ON p.id=s.property_id
      WHERE s.project_id=? AND s.status='confirmed' ORDER BY s.id DESC`, id);
    out.receipts = all(`SELECT r.id,r.receipt_no,r.date,r.amount,r.payment_type,c.full_name FROM receipts r JOIN contacts c ON c.id=r.contact_id WHERE r.project_id=? AND r.status='valid' ORDER BY r.date DESC, r.id DESC LIMIT 50`, id);
    out.expenses = all(`SELECT e.id,e.voucher_no,e.date,e.amount,e.status,e.description,a.name account,v.name vendor FROM expense_vouchers e JOIN accounts a ON a.id=e.expense_account_id
      LEFT JOIN vendors v ON v.id=e.vendor_id WHERE e.project_id=? ORDER BY e.date DESC, e.id DESC LIMIT 50`, id);
    out.vendors = all(`SELECT v.id,v.name,SUM(e.amount) billed,SUM(e.paid_amount) paid FROM expense_vouchers e JOIN vendors v ON v.id=e.vendor_id
      WHERE e.project_id=? AND e.status IN ('approved','partial','paid') GROUP BY v.id`, id);
  }
  res.json(out);
}));

// ---- Development items & updates (project managers)
r.post('/projects/:id(\\d+)/dev-items', can('projects', 'edit'), asyncH((req, res) => {
  const { name, progress = 0 } = req.body;
  if (!name?.trim()) throw bad('Name is required');
  const max = get('SELECT COALESCE(MAX(sort_order),0) m FROM dev_items WHERE project_id=?', req.params.id).m;
  run('INSERT INTO dev_items(project_id,name,progress,sort_order) VALUES(?,?,?,?)', req.params.id, name.trim(), Math.max(0, Math.min(100, int(progress))), max + 1);
  audit(req, 'Added development item', 'project', req.params.id, name);
  res.status(201).json({ ok: true });
}));
r.put('/dev-items/:id(\\d+)', can('projects', 'edit'), asyncH((req, res) => {
  const it = get('SELECT * FROM dev_items WHERE id=?', req.params.id);
  if (!it) throw notFound();
  const progress = req.body.progress === undefined ? it.progress : Math.max(0, Math.min(100, int(req.body.progress)));
  run('UPDATE dev_items SET name=COALESCE(?,name), progress=? WHERE id=?', req.body.name ?? null, progress, it.id);
  audit(req, 'Updated development progress', 'project', it.project_id, `${it.name}: ${it.progress}% → ${progress}%`);
  res.json({ ok: true });
}));
r.delete('/dev-items/:id(\\d+)', can('projects', 'edit'), asyncH((req, res) => {
  run('DELETE FROM dev_items WHERE id=?', req.params.id);
  res.json({ ok: true });
}));

const mediaUp = uploader('media', 'media', 100);
r.post('/projects/:id(\\d+)/updates', can('projects', 'create'), mediaUp.array('files', 20), asyncH((req, res) => {
  const p = get('SELECT * FROM projects WHERE id=?', req.params.id);
  if (!p) throw notFound();
  const { title, description, progress, kind, update_date } = req.body;
  if (!title?.trim()) throw bad('Title is required');
  const pr = progress === undefined || progress === '' ? null : Math.max(0, Math.min(100, int(progress)));
  const videos = jparse(req.body.videos, []);
  const id = tx(() => {
    const uid = Number(run(`INSERT INTO dev_updates(project_id,update_date,title,kind,progress,description,videos,published,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      p.id, update_date || today(), title.trim(), kind || 'Progress', pr, description ?? null, JSON.stringify(videos), 1, req.user.id, now()).lastInsertRowid);
    (req.files || []).forEach((f, i) => run('INSERT INTO media(entity_type,entity_id,kind,path,caption,sort_order,created_at) VALUES(?,?,?,?,?,?,?)',
      'dev_update', uid, f.mimetype.startsWith('video') ? 'video' : f.mimetype === 'application/pdf' ? 'report' : 'image', `media/${f.filename}`, f.originalname.slice(0, 120), i + 1, now()));
    return uid;
  });
  // customers who bought in this project get a notification
  const buyers = all(`SELECT DISTINCT u.id FROM users u JOIN sales s ON s.contact_id=u.contact_id WHERE s.project_id=? AND s.status='confirmed'`, p.id);
  for (const b of buyers) run(`INSERT INTO notifications(user_id,type,title,body,link,read,created_at) VALUES(?,?,?,?,?,0,?)`, b.id, 'development', 'Development update published', `${p.name}: ${title}`, '/portal', now());
  audit(req, 'Published development update', 'project', p.id, title);
  res.status(201).json({ id });
}));
r.delete('/updates/:id(\\d+)', can('projects', 'delete'), asyncH((req, res) => {
  tx(() => { run("DELETE FROM media WHERE entity_type='dev_update' AND entity_id=?", req.params.id); run('DELETE FROM dev_updates WHERE id=?', req.params.id); });
  res.json({ ok: true });
}));
r.get('/dev-updates', can('projects', 'view'), asyncH((req, res) => {
  res.json(all(`SELECT d.*, p.name project_name FROM dev_updates d JOIN projects p ON p.id=d.project_id ORDER BY d.update_date DESC, d.id DESC LIMIT 200`)
    .map((u) => ({ ...u, videos: jparse(u.videos, []), media: all("SELECT * FROM media WHERE entity_type='dev_update' AND entity_id=?", u.id) })));
}));

// ---- Project media (images)
r.post('/projects/:id(\\d+)/media', can('projects', 'edit'), mediaUp.array('files', 20), asyncH((req, res) => {
  const p = get('SELECT id FROM projects WHERE id=?', req.params.id);
  if (!p) throw notFound();
  (req.files || []).forEach((f, i) => run('INSERT INTO media(entity_type,entity_id,kind,path,caption,sort_order,created_at) VALUES(?,?,?,?,?,?,?)', 'project', p.id, 'gallery', `media/${f.filename}`, f.originalname.slice(0, 120), i + 1, now()));
  res.status(201).json({ ok: true });
}));

// ---- Schedule (Primavera-style): tasks with planned start/finish, auto performance and delay forecast
const TASK_COLS = ['sale_id', 'parent_id', 'name', 'planned_start', 'planned_end', 'actual_start', 'actual_end', 'weight', 'predecessor_id', 'notes', 'client_visible', 'sort_order'];
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
function cleanTask(body, projectId, existing) {
  const d = { ...body };
  for (const k of ['sale_id', 'parent_id', 'predecessor_id']) if (d[k] === '' || d[k] === 'project') d[k] = null;
  for (const k of ['actual_start', 'actual_end']) if (d[k] === '') d[k] = null;
  const ps = d.planned_start ?? existing?.planned_start, pe = d.planned_end ?? existing?.planned_end;
  if (!String(d.name ?? existing?.name ?? '').trim()) throw bad('Task name is required');
  if (!isDate(ps) || !isDate(pe)) throw bad('Planned start and finish dates are required');
  if (pe < ps) throw bad('Planned finish cannot be before planned start');
  delete d.progress; // completion is calculated from the dates — never typed in
  if (d.weight !== undefined) { d.weight = Number(d.weight) || 1; if (d.weight <= 0) throw bad('Weight must be positive'); }
  if (d.client_visible !== undefined) d.client_visible = d.client_visible ? 1 : 0;
  if (d.sale_id && !get('SELECT 1 FROM sales WHERE id=? AND project_id=?', d.sale_id, projectId)) throw bad('That contract does not belong to this project');
  for (const k of ['parent_id', 'predecessor_id']) {
    if (d[k]) {
      const o = get('SELECT * FROM project_tasks WHERE id=? AND project_id=?', d[k], projectId);
      if (!o) throw bad(`${k === 'parent_id' ? 'Group' : 'Predecessor'} task not found in this project`);
      if (existing && o.id === existing.id) throw bad('A task cannot depend on itself');
    }
  }
  if (d.actual_end) d.progress = 100;
  return d;
}

/** The activity library grows by itself: any new activity name becomes selectable next time. */
function addToLibrary(name) {
  const n = String(name || '').trim();
  if (n && !get("SELECT 1 FROM lookups WHERE type='construction_activity' AND lower(value)=lower(?)", n)) {
    run("INSERT INTO lookups(type,value,sort_order) VALUES('construction_activity',?,?)", n, (get("SELECT COALESCE(MAX(sort_order),0) m FROM lookups WHERE type='construction_activity'").m) + 1);
  }
}

r.get('/projects/:id(\\d+)/schedule', can('projects', 'view'), asyncH((req, res) => {
  const id = Number(req.params.id);
  const project = get('SELECT id,name,kind FROM projects WHERE id=?', id);
  if (!project) throw notFound();
  const scope = req.query.scope && req.query.scope !== 'all' ? req.query.scope : undefined;
  const pj = get('SELECT start_date, expected_completion FROM projects WHERE id=?', id);
  const t0 = today();
  const timeline = pj.start_date && pj.expected_completion ? (() => { const d = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000); const total = Math.max(1, d(pj.start_date, pj.expected_completion)); const el = Math.min(total, Math.max(0, d(pj.start_date, t0))); return { commencement: pj.start_date, deadline: pj.expected_completion, total_days: total, elapsed_days: el, remaining_days: d(t0, pj.expected_completion), time_pct: Math.round((el / total) * 100) }; })() : null;
  res.json({ project, timeline, ...scheduleFor(id, { scope }),
    contracts: all(`SELECT s.id,s.sale_no,s.title,c.full_name customer FROM sales s JOIN contacts c ON c.id=s.contact_id WHERE s.project_id=? AND s.kind='construction' AND s.status='confirmed'`, id) });
}));
r.post('/projects/:id(\\d+)/tasks', can('projects', 'create'), asyncH((req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT 1 FROM projects WHERE id=?', id)) throw notFound();
  const d = cleanTask(req.body, id, null);
  const max = get('SELECT COALESCE(MAX(sort_order),0) m FROM project_tasks WHERE project_id=?', id).m;
  const tid = insert('project_tasks', { ...d, project_id: id, sort_order: d.sort_order ?? max + 1, created_by: req.user.id, created_at: now() }, [...TASK_COLS, 'progress', 'project_id', 'created_by', 'created_at']);
  addToLibrary(d.name);
  audit(req, 'Added schedule task', 'project', id, d.name);
  res.status(201).json({ id: tid });
}));
r.put('/project-tasks/:id(\\d+)', can('projects', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM project_tasks WHERE id=?', req.params.id);
  if (!t) throw notFound();
  const d = cleanTask(req.body, t.project_id, t);
  update('project_tasks', t.id, { ...d, updated_at: now(), delay_notified: 0 }, [...TASK_COLS, 'progress', 'updated_at', 'delay_notified']);
  audit(req, 'Edited schedule activity', 'project', t.project_id, t.name);
  res.json({ ok: true });
}));
/** Confirm an activity is finished (this is the only way to reach 100% before its due date). */
r.post('/project-tasks/:id(\\d+)/complete', can('projects', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM project_tasks WHERE id=?', req.params.id);
  if (!t) throw notFound();
  const date = req.body.date || today();
  if (!isDate(date)) throw bad('Completion date must be YYYY-MM-DD');
  if (date < t.planned_start) throw bad('An activity cannot be completed before its start date');
  run('UPDATE project_tasks SET actual_end=?, progress=100, actual_start=COALESCE(actual_start, planned_start), updated_at=?, delay_notified=1 WHERE id=?', date, now(), t.id);
  audit(req, 'Completed schedule activity', 'project', t.project_id, `${t.name} on ${date}`);
  res.json({ ok: true });
}));
r.post('/project-tasks/:id(\\d+)/reopen', can('projects', 'edit'), asyncH((req, res) => {
  const t = get('SELECT * FROM project_tasks WHERE id=?', req.params.id);
  if (!t) throw notFound();
  run('UPDATE project_tasks SET actual_end=NULL, progress=0, updated_at=?, delay_notified=0 WHERE id=?', now(), t.id);
  audit(req, 'Reopened schedule activity', 'project', t.project_id, t.name);
  res.json({ ok: true });
}));
/**
 * Quick plan. Each activity gets a number of DAYS and starts the day after the previous one. An activity may carry
 * sub-activities (each with its own days); a parent without days spans its sub-activities. If some activities have no days
 * the remaining days of the commencement→deadline window are shared between them (by weight). Everything stays editable.
 */
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;
r.post('/projects/:id(\\d+)/tasks/plan', can('projects', 'create'), asyncH((req, res) => {
  const id = Number(req.params.id);
  const pj = get('SELECT * FROM projects WHERE id=?', id);
  if (!pj) throw notFound();
  const { items, sale_id } = req.body;
  const start = req.body.start || pj.start_date;
  if (!isDate(start)) throw bad('Set the commencement date (in the project or in this form)');
  if (!Array.isArray(items) || !items.length) throw bad('Choose at least one activity');
  if (sale_id && !get('SELECT 1 FROM sales WHERE id=? AND project_id=?', sale_id, id)) throw bad('That contract does not belong to this project');
  const dn = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 ? n : 0; };
  const own = (it) => dn(it.days) || (Array.isArray(it.subs) ? it.subs.reduce((t, x) => t + dn(x.days), 0) : 0);
  const fixed = items.reduce((t, it) => t + own(it), 0);
  const open = items.filter((it) => !own(it));
  let spare = 0;
  if (open.length) {
    const end = req.body.end || pj.expected_completion;
    if (!isDate(end) || end < start) throw bad('Enter the number of days for every activity, or set a deadline to share the remaining days');
    const total = Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
    spare = total - fixed;
    if (spare < open.length) throw bad(`The deadline leaves only ${Math.max(0, spare)} day(s) for ${open.length} activity(ies) with no days — extend the deadline or enter their days`);
  }
  const wsum = open.reduce((t, it) => t + Math.max(0.1, Number(it.weight) || 1), 0);
  let given = 0, openLeft = open.length;
  let cursor = Date.parse(start), prev = null, made = 0;
  tx(() => {
    const max = get('SELECT COALESCE(MAX(sort_order),0) m FROM project_tasks WHERE project_id=?', id).m;
    items.forEach((it, i) => {
      if (!String(it.name || '').trim()) throw bad('Every activity needs a name');
      let days = own(it);
      if (!days) { openLeft--; days = openLeft === 0 ? spare - given : Math.max(1, Math.round((spare * Math.max(0.1, Number(it.weight) || 1)) / wsum)); given += days; }
      const w = Math.max(0.1, Number(it.weight) || 1);
      const ps = iso(cursor), pe = iso(cursor + (days - 1) * DAY);
      const tid = Number(run('INSERT INTO project_tasks(project_id,sale_id,name,planned_start,planned_end,progress,weight,predecessor_id,client_visible,sort_order,created_by,created_at) VALUES(?,?,?,?,?,0,?,?,1,?,?,?)',
        id, sale_id || null, String(it.name).trim(), ps, pe, w, prev, max + (i + 1) * 100, req.user.id, now()).lastInsertRowid);
      addToLibrary(it.name);
      made++;
      let sc = cursor, sprev = null;
      (it.subs || []).filter((x) => String(x.name || '').trim()).forEach((sub, j) => {
        const sd = dn(sub.days) || 1;
        const ss = iso(sc), se = iso(Math.min(sc + (sd - 1) * DAY, Date.parse(pe)));
        if (sc > Date.parse(pe)) throw bad(`Sub-activities of "${it.name}" need more days than the activity has`);
        sprev = Number(run('INSERT INTO project_tasks(project_id,sale_id,parent_id,name,planned_start,planned_end,progress,weight,predecessor_id,client_visible,sort_order,created_by,created_at) VALUES(?,?,?,?,?,?,0,1,?,1,?,?,?)',
          id, sale_id || null, tid, String(sub.name).trim(), ss, se, sprev, max + (i + 1) * 100 + j + 1, req.user.id, now()).lastInsertRowid);
        addToLibrary(sub.name); made++;
        sc += sd * DAY;
      });
      prev = tid;
      cursor += days * DAY;
    });
  });
  audit(req, 'Planned schedule', 'project', id, `${made} activities from ${start}`);
  res.json({ created: made, start, end: iso(cursor - DAY) });
}));

r.delete('/project-tasks/:id(\\d+)', can('projects', 'delete'), asyncH((req, res) => {
  const t = get('SELECT * FROM project_tasks WHERE id=?', req.params.id);
  if (!t) throw notFound();
  tx(() => {
    run('UPDATE project_tasks SET parent_id=NULL WHERE parent_id=?', t.id);
    run('UPDATE project_tasks SET predecessor_id=NULL WHERE predecessor_id=?', t.id);
    run('DELETE FROM project_tasks WHERE id=?', t.id);
  });
  audit(req, 'Deleted schedule task', 'project', t.project_id, t.name);
  res.json({ ok: true });
}));
/** Copy a schedule (project-level or another contract's) into a customer's contract, shifting dates to a new start. */
r.post('/projects/:id(\\d+)/tasks/copy', can('projects', 'create'), asyncH((req, res) => {
  const id = Number(req.params.id);
  const { from_sale_id, to_sale_id, start_date } = req.body;
  if (!to_sale_id || !isDate(start_date)) throw bad('Choose the target contract and a start date');
  const src = all(`SELECT * FROM project_tasks WHERE project_id=? AND ${from_sale_id ? 'sale_id=?' : 'sale_id IS NULL'} ORDER BY sort_order,id`, ...(from_sale_id ? [id, from_sale_id] : [id]));
  if (!src.length) throw bad('There are no tasks to copy');
  if (!get('SELECT 1 FROM sales WHERE id=? AND project_id=?', to_sale_id, id)) throw bad('That contract does not belong to this project');
  const base = src.map((t) => t.planned_start).sort()[0];
  const shift = Math.round((Date.parse(start_date) - Date.parse(base)) / 86400000);
  const add = (d) => new Date(Date.parse(d) + shift * 86400000).toISOString().slice(0, 10);
  const ids = new Map();
  tx(() => {
    for (const t of src) {
      const nid = Number(run('INSERT INTO project_tasks(project_id,sale_id,name,planned_start,planned_end,progress,weight,notes,client_visible,sort_order,created_by,created_at) VALUES(?,?,?,?,?,0,?,?,?,?,?,?)',
        id, to_sale_id, t.name, add(t.planned_start), add(t.planned_end), t.weight, t.notes, t.client_visible, t.sort_order, req.user.id, now()).lastInsertRowid);
      ids.set(t.id, nid);
    }
    for (const t of src) run('UPDATE project_tasks SET parent_id=?, predecessor_id=? WHERE id=?', t.parent_id ? ids.get(t.parent_id) ?? null : null, t.predecessor_id ? ids.get(t.predecessor_id) ?? null : null, ids.get(t.id));
  });
  audit(req, 'Copied schedule', 'project', id, `${src.length} tasks to contract ${to_sale_id}`);
  res.json({ copied: src.length });
}));

export default r;
