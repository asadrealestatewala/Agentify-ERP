import { Router } from 'express';
import { all, get, run } from '../db.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad, notFound, now } from '../util.js';
import { uploader } from './helpers.js';
import { allNotices, cleanComplaint, complaintDetail, createComplaint, listComplaints, noticeFields, staffReply, updateComplaint, CATEGORIES, STATUSES, NOTICE_KINDS } from '../services/societySupport.js';

/** Staff side of the housing society support center: complaints and requests, plus the launch notices shown as pop-ups. */
const r = Router();
r.use(requireStaff);
const imgUp = uploader('media', 'image', 10);

r.get('/complaints', can('customers', 'view'), asyncH((req, res) => res.json({
  ...listComplaints({ status: req.query.status, category: req.query.category, q: req.query.q, mine: req.query.mine === '1', userId: req.user.id }),
  categories: CATEGORIES, statuses: STATUSES, team: all("SELECT u.id,u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 ORDER BY u.name"),
})));
r.get('/complaints/:id(\\d+)', can('customers', 'view'), asyncH((req, res) => res.json(complaintDetail(req.params.id))));
r.post('/complaints', can('customers', 'edit'), asyncH((req, res) => {
  const d = cleanComplaint(req.body || {});
  const out = createComplaint(d, { source: 'staff', createdBy: req.user.id });
  audit(req, 'Support request logged', 'complaint', out.id, out.ref);
  res.status(201).json(out);
}));
r.put('/complaints/:id(\\d+)', can('customers', 'edit'), asyncH((req, res) => { updateComplaint(req.params.id, req.body || {}); audit(req, 'Support request updated', 'complaint', Number(req.params.id)); res.json({ ok: true }); }));
r.post('/complaints/:id(\\d+)/reply', can('customers', 'edit'), asyncH((req, res) => { staffReply(req.params.id, req.user, req.body || {}); res.status(201).json({ ok: true }); }));

r.get('/launch-notices', can('customers', 'view'), asyncH((_req, res) => res.json({ rows: allNotices(), kinds: NOTICE_KINDS })));
r.post('/launch-notices', can('customers', 'create'), imgUp.single('image'), asyncH((req, res) => {
  const d = noticeFields({ active: 1, show_popup: 1, ...req.body }, true);
  if (req.file) d.image = `media/${req.file.filename}`;
  d.created_at = now();
  const keys = Object.keys(d);
  const id = Number(run(`INSERT INTO launch_notices(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => d[k])).lastInsertRowid);
  audit(req, 'Launch notice created', 'launch_notice', id, d.title);
  res.status(201).json({ id });
}));
const saveNotice = asyncH((req, res) => {
  if (!get('SELECT 1 FROM launch_notices WHERE id=?', req.params.id)) throw notFound('Notice not found');
  const d = noticeFields(req.body || {}, false);
  if (req.file) d.image = `media/${req.file.filename}`;
  const keys = Object.keys(d);
  if (keys.length) run(`UPDATE launch_notices SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => d[k]), req.params.id);
  res.json({ ok: true });
});
r.put('/launch-notices/:id(\\d+)', can('customers', 'edit'), imgUp.single('image'), saveNotice);
r.post('/launch-notices/:id(\\d+)', can('customers', 'edit'), imgUp.single('image'), saveNotice);
r.delete('/launch-notices/:id(\\d+)', can('customers', 'delete'), asyncH((req, res) => {
  if (!get('SELECT 1 FROM launch_notices WHERE id=?', req.params.id)) throw notFound('Notice not found');
  run('DELETE FROM launch_notices WHERE id=?', req.params.id);
  res.json({ ok: true });
}));
export default r;
