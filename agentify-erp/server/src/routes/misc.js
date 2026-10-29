import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, uploadDir } from '../db.js';
import { can, hasPerm, ownerId, requireStaff, requireAuth } from '../rbac.js';
import { audit } from '../audit.js';
import { uploader, storedPath, discardUploads } from './helpers.js';
import { sendStored, removeRef } from '../services/storage.js';
import { asyncH, bad, forbidden, notFound, now, moneyText } from '../util.js';

const r = Router();

// ---------------- Notifications (any logged-in user)
r.get('/notifications', requireAuth, (req, res) => {
  res.json({
    rows: req.query.type ? all('SELECT * FROM notifications WHERE user_id=? AND type=? ORDER BY id DESC LIMIT ?', req.user.id, String(req.query.type), Math.min(Number(req.query.limit) || 50, 200)) : all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?', req.user.id, Math.min(Number(req.query.limit) || 50, 200)),
    unread: get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', req.user.id).n,
  });
});
r.post('/notifications/read', requireAuth, (req, res) => {
  if (req.body.id) run('UPDATE notifications SET read=1 WHERE id=? AND user_id=?', req.body.id, req.user.id);
  else run('UPDATE notifications SET read=1 WHERE user_id=?', req.user.id);
  res.json({ ok: true });
});

// ---------------- Audit log
r.get('/audit', requireStaff, can('settings', 'view'), asyncH((req, res) => {
  const q = req.query, where = ['1=1'], params = [];
  if (q.q) { where.push('(user_name LIKE ? OR action LIKE ? OR detail LIKE ? OR entity_id LIKE ?)'); params.push(...Array(4).fill(`%${q.q}%`)); }
  if (q.entity) { where.push('entity=?'); params.push(q.entity); }
  if (q.user_id) { where.push('user_id=?'); params.push(q.user_id); }
  if (q.from) { where.push('date(created_at)>=?'); params.push(q.from); }
  if (q.to) { where.push('date(created_at)<=?'); params.push(q.to); }
  const limit = Math.min(Number(q.limit) || 50, 500), page = Math.max(Number(q.page) || 1, 1);
  const total = get(`SELECT COUNT(*) n FROM audit_log WHERE ${where.join(' AND ')}`, ...params).n;
  res.json({ rows: all(`SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit), total, page, limit });
}));

// ---------------- Global search
r.get('/search', requireStaff, asyncH((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json([]);
  const like = `%${q}%`, out = [];
  const own = ownerId(req);
  const add = (type, rows, f) => rows.forEach((x) => out.push({ type, ...f(x) }));
  if (hasPerm(req.user, 'crm', 'view')) {
    add('Contact', all(`SELECT id,full_name,phone,email,is_customer,customer_code FROM contacts WHERE (full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR cnic LIKE ? OR customer_code LIKE ?) ${own ? 'AND (agent_id=' + own + ' OR created_by=' + own + ')' : ''} LIMIT 8`, like, like, like, like, like),
      (x) => ({ id: x.id, title: x.full_name, subtitle: [x.customer_code, x.phone, x.email].filter(Boolean).join(' · '), link: `/contacts/${x.id}`, badge: x.is_customer ? 'Customer' : 'Lead' }));
  }
  if (hasPerm(req.user, 'properties', 'view')) {
    add('Property', all(`SELECT p.id,p.title,p.plot_no,p.status,p.registration_no,p.file_no,p.file_status,pr.name project FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id WHERE (p.title LIKE ? OR p.plot_no LIKE ? OR p.code LIKE ? OR p.registration_no LIKE ? OR p.file_no LIKE ?) ${own ? "AND p.status IN ('available','featured','reserved')" : ''} LIMIT 8`, like, like, like, like, like),
      (x) => ({ id: x.id, title: x.title, subtitle: [x.registration_no, x.project, x.plot_no && `Plot ${x.plot_no}`, x.file_status && `File ${x.file_status}`].filter(Boolean).join(' · '), link: `/properties/${x.id}`, badge: x.status }));
  }
  if (hasPerm(req.user, 'projects', 'view')) {
    add('Project', all('SELECT id,name,code,location FROM projects WHERE name LIKE ? OR code LIKE ? LIMIT 5', like, like), (x) => ({ id: x.id, title: x.name, subtitle: `${x.code} · ${x.location || ''}`, link: `/projects/${x.id}` }));
  }
  if (hasPerm(req.user, 'sales', 'view') && !own) {
    add('Sale', all(`SELECT s.id,s.sale_no,c.full_name,COALESCE(s.title,p.title) title FROM sales s JOIN contacts c ON c.id=s.contact_id LEFT JOIN properties p ON p.id=s.property_id WHERE s.sale_no LIKE ? OR p.plot_no LIKE ? OR s.title LIKE ? LIMIT 5`, like, like, like),
      (x) => ({ id: x.id, title: `${x.sale_no} — ${x.title}`, subtitle: x.full_name, link: `/sales/${x.id}`, badge: 'Ledger' }));
  }
  if (hasPerm(req.user, 'payments', 'view')) {
    add('Receipt', all(`SELECT r.id,r.receipt_no,r.amount,r.txn_id,c.full_name FROM receipts r JOIN contacts c ON c.id=r.contact_id WHERE r.receipt_no LIKE ? OR r.txn_id LIKE ? OR r.reference_no LIKE ? OR r.cheque_no LIKE ? LIMIT 5`, like, like, like, like),
      (x) => ({ id: x.id, title: x.receipt_no, subtitle: `${x.full_name} · ${moneyText(x.amount)}${x.txn_id ? ' · ' + x.txn_id : ''}`, link: `/receipts/${x.id}` }));
  }
  if (hasPerm(req.user, 'vendors', 'view')) {
    add('Vendor', all('SELECT id,name,company,category FROM vendors WHERE name LIKE ? OR company LIKE ? LIMIT 5', like, like), (x) => ({ id: x.id, title: x.name, subtitle: x.category || x.company, link: `/vendors/${x.id}` }));
  }
  if (hasPerm(req.user, 'accounting', 'view')) {
    add('Expense', all(`SELECT id,voucher_no,description,amount FROM expense_vouchers WHERE voucher_no LIKE ? OR description LIKE ? OR reference_no LIKE ? LIMIT 5`, like, like, like),
      (x) => ({ id: x.id, title: x.voucher_no, subtitle: `${x.description || ''} · ${moneyText(x.amount)}`, link: `/expenses/${x.id}` }));
  }
  if (hasPerm(req.user, 'hrm', 'view')) {
    add('Employee', all('SELECT id,name,emp_code,designation FROM employees WHERE name LIKE ? OR emp_code LIKE ? OR cnic LIKE ? LIMIT 5', like, like, like), (x) => ({ id: x.id, title: x.name, subtitle: `${x.emp_code} · ${x.designation || ''}`, link: `/hrm/employees/${x.id}` }));
  }
  res.json(out);
}));

// ---------------- Documents
const ENTITY_MODULE = { con_report: 'construction', purchase_order: 'construction', subcontract: 'construction', estimate: 'construction', contact: 'crm', customer: 'customers', property: 'properties', project: 'projects', employee: 'hrm', vendor: 'vendors', tender: 'vendors', bid: 'vendors', receipt: 'payments', expense: 'accounting', sale: 'sales' };
function docAccess(req, entityType, entityId, action) {
  const mod = ENTITY_MODULE[entityType];
  if (!mod) throw bad('Unsupported document target');
  if (!hasPerm(req.user, mod, action)) throw forbidden(`You do not have permission to ${action} ${entityType} documents`);
  if (ownerId(req) && entityType === 'contact') {
    const c = get('SELECT agent_id,created_by FROM contacts WHERE id=?', entityId);
    if (!c || (c.agent_id !== req.user.id && c.created_by !== req.user.id)) throw forbidden();
  }
  if (ownerId(req) && !['contact', 'property'].includes(entityType)) throw forbidden();
}
const docUp = uploader('documents', 'documents', 25, { module: 'documents' });
r.get('/documents', requireStaff, asyncH((req, res) => {
  const { entity_type, entity_id } = req.query;
  docAccess(req, entity_type, entity_id, 'view');
  res.json(all('SELECT d.*, u.name uploaded_by_name FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE entity_type=? AND entity_id=? ORDER BY d.id DESC', entity_type, entity_id));
}));
r.post('/documents', requireStaff, docUp.array('files', 10), asyncH((req, res) => {
  const { entity_type, entity_id, category } = req.body;
  try { docAccess(req, entity_type, entity_id, 'edit'); } catch (e) {
    discardUploads(req);
    throw e;
  }
  const ids = (req.files || []).map((f) => Number(run(`INSERT INTO documents(entity_type,entity_id,category,name,path,mime,size,portal_visible,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    entity_type, entity_id, category || 'Other', f.originalname.slice(0, 200), storedPath(f, 'documents'), f.mimetype, f.size, req.body.portal_visible === '1' ? 1 : 0, req.user.id, now()).lastInsertRowid));
  audit(req, 'Uploaded document', entity_type, entity_id, `${ids.length} file(s) — ${category || 'Other'}`);
  res.status(201).json({ ids });
}));
r.get('/documents/:id(\\d+)/file', requireStaff, asyncH(async (req, res) => {
  const d = get('SELECT * FROM documents WHERE id=?', req.params.id);
  if (!d) throw notFound();
  docAccess(req, d.entity_type, d.entity_id, 'view');
  await sendStored(req, res, d.path, { mime: d.mime, name: d.name, download: !!req.query.download });
}));
r.delete('/documents/:id(\\d+)', requireStaff, asyncH((req, res) => {
  const d = get('SELECT * FROM documents WHERE id=?', req.params.id);
  if (!d) throw notFound();
  docAccess(req, d.entity_type, d.entity_id, 'delete');
  run('DELETE FROM documents WHERE id=?', d.id);
  removeRef(d.path).catch(() => {});
  audit(req, 'Deleted document', d.entity_type, d.entity_id, d.name);
  res.json({ ok: true });
}));
r.put('/documents/:id(\\d+)', requireStaff, asyncH((req, res) => {
  const d = get('SELECT * FROM documents WHERE id=?', req.params.id);
  if (!d) throw notFound();
  docAccess(req, d.entity_type, d.entity_id, 'edit');
  run('UPDATE documents SET portal_visible=COALESCE(?,portal_visible), category=COALESCE(?,category) WHERE id=?', req.body.portal_visible === undefined ? null : req.body.portal_visible ? 1 : 0, req.body.category ?? null, d.id);
  res.json({ ok: true });
}));

export default r;
