// Developer partner management for company staff (/api/developers). Permission module: developers.
// The developers' own portal is a separate router with its own session scoping.
import { Router } from 'express';
import { all, get, run, insert, update } from '../db.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad, notFound, now } from '../util.js';
import { AGREEMENT_FIELDS, checkAgreement, createDeveloperPortalUser, developerSummary, listDevelopers, toSqft } from '../services/developers.js';

const r = Router();
r.use(requireStaff);
const DEV_COLS = ['name', 'company', 'phone', 'email', 'ntn', 'address', 'bank_details', 'notes', 'status'];
const dev = (id) => get('SELECT * FROM developers WHERE id=?', id) || (() => { throw notFound('Developer not found'); })();
const agreementOf = (devId, id) => get('SELECT * FROM developer_agreements WHERE id=? AND developer_id=?', id, devId) || (() => { throw notFound('Agreement not found'); })();

r.get('/', can('developers', 'view'), (_req, res) => res.json(listDevelopers()));

r.post('/', can('developers', 'create'), asyncH((req, res) => {
  const d = req.body || {};
  if (!String(d.name || '').trim()) throw bad('Enter the developer’s name');
  const id = insert('developers', { ...d, name: String(d.name).trim(), status: 'active', created_by: req.user.id, created_at: now() }, [...DEV_COLS, 'created_by', 'created_at']);
  audit(req, 'Added developer', 'developer', id, d.name);
  res.status(201).json({ id });
}));

r.get('/:id', can('developers', 'view'), asyncH((req, res) => {
  const d = dev(req.params.id);
  res.json({
    ...d, ...developerSummary(d.id),
    agreements: all('SELECT a.*, p.name project_name FROM developer_agreements a LEFT JOIN projects p ON p.id=a.project_id WHERE a.developer_id=? ORDER BY a.id DESC', d.id),
    has_portal_login: !!get('SELECT 1 FROM users WHERE developer_id=? AND active=1', d.id),
  });
}));

r.put('/:id', can('developers', 'edit'), asyncH((req, res) => {
  const d = dev(req.params.id);
  const body = { ...req.body };
  if (body.name !== undefined && !String(body.name).trim()) throw bad('Enter the developer’s name');
  if (body.status !== undefined && !['active', 'inactive'].includes(body.status)) throw bad('Status must be active or inactive');
  update('developers', d.id, body, DEV_COLS);
  audit(req, 'Edited developer', 'developer', d.id, d.name);
  res.json({ ok: true });
}));

r.post('/:id/portal-login', can('developers', 'edit'), asyncH((req, res) => {
  const d = dev(req.params.id);
  const out = createDeveloperPortalUser(d.id, req.body?.password);
  audit(req, out.created ? 'Created developer portal login' : 'Reset developer portal password', 'developer', d.id, d.name);
  res.status(out.created ? 201 : 200).json(out);
}));

// ---------------------------------------------------------------- agreements
r.post('/:id/agreements', can('developers', 'create'), asyncH((req, res) => {
  const d = dev(req.params.id);
  const a = checkAgreement(req.body || {}, null);
  const id = insert('developer_agreements', { ...a, developer_id: d.id, created_by: req.user.id, created_at: now() }, [...AGREEMENT_FIELDS, 'developer_id', 'created_by', 'created_at']);
  audit(req, 'Added developer agreement', 'developer', d.id, `${d.name}: ${a.title}`);
  res.status(201).json({ id });
}));

r.put('/:id/agreements/:aid', can('developers', 'edit'), asyncH((req, res) => {
  const d = dev(req.params.id), ag = agreementOf(d.id, req.params.aid);
  update('developer_agreements', ag.id, checkAgreement(req.body || {}, ag), AGREEMENT_FIELDS);
  audit(req, 'Edited developer agreement', 'developer', d.id, `${d.name}: ${ag.title} (existing bookings keep the terms they were made under)`);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- the developer's plots and files
r.get('/:id/plots', can('developers', 'view'), asyncH((req, res) => {
  const d = dev(req.params.id);
  const rows = all(`SELECT p.id, p.code, p.title, p.plot_no, p.block, p.property_type, p.area_size, p.unit, p.net_price, p.status, p.registration_no, p.agreement_id,
    s.id sale_id, s.booking_id, s.file_state, c.full_name customer_name FROM properties p
    LEFT JOIN sales s ON s.property_id=p.id AND s.status='confirmed' LEFT JOIN contacts c ON c.id=s.contact_id
    WHERE p.developer_id=? ORDER BY p.id DESC`, d.id);
  res.json(rows.map((p) => ({ ...p, area_sqft: toSqft(p.area_size, p.unit) })));
}));

export default r;
