// Developer partner portal (/api/developer): a developer sees only their own files, and only the allow-listed fields of
// toDeveloperFile(). The developer id comes from the session, never from the request.
import { Router } from 'express';
import { get, all } from '../db.js';
import { requireDeveloper } from '../rbac.js';
import { asyncH, notFound } from '../util.js';
import { developerFiles, toDeveloperFile } from '../services/developers.js';

const r = Router();
r.use(requireDeveloper);
const mine = (req) => req.user.developer_id;

r.get('/dashboard', asyncH((req, res) => {
  const d = get('SELECT id, name, company FROM developers WHERE id=?', mine(req));
  const files = developerFiles(mine(req)).filter((s) => s.status === 'confirmed');
  res.json({
    developer: d,
    files: files.length, plots_available: get("SELECT COUNT(*) n FROM properties WHERE developer_id=? AND status IN ('available','featured')", mine(req)).n,
    contract_value: files.reduce((a, s) => a + s.net_price, 0), collected: files.reduce((a, s) => a + s.paid_amount, 0),
    outstanding: files.reduce((a, s) => a + (s.net_price - s.paid_amount), 0),
    held_by_company: files.filter((s) => s.holder === 'company').length,
  });
}));

r.get('/files', asyncH((req, res) => res.json(developerFiles(mine(req)).map((s) => toDeveloperFile(s)))));

r.get('/files/:id(\\d+)', asyncH((req, res) => {
  const s = get('SELECT * FROM sales WHERE id=? AND developer_id=?', req.params.id, mine(req));
  if (!s) throw notFound('File not found');
  res.json(toDeveloperFile(s, { detail: true }));
}));

r.get('/plots', asyncH((req, res) => {
  res.json(all("SELECT id, title, plot_no, block, property_type, area_size, unit, net_price, status FROM properties WHERE developer_id=? ORDER BY id DESC", mine(req)));
}));

export default r;
