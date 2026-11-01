// The shared template library as a workspace sees it (mounted at /api/library). Items are read-only here; "Use my own version"
// saves this workspace's text and only this workspace sees it. The library itself is edited in the platform console.
import { Router } from 'express';
import { asyncH, notFound } from '../util.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { currentTenant } from '../context.js';
import { effectiveFor, brochureLayoutFor, setOverride, clearOverride, LIBRARY_TYPES } from '../services/sharedLibrary.js';

const r = Router();
r.use(requireStaff);
const tenantId = () => {
  const t = currentTenant();
  if (!t) throw notFound('Library not available');
  return t.id;
};

r.get('/', can('crm', 'view'), asyncH((_req, res) => res.json({ types: LIBRARY_TYPES, items: effectiveFor(tenantId()) })));
r.get('/brochure', can('crm', 'view'), asyncH((_req, res) => res.json(brochureLayoutFor(tenantId()))));
r.put('/:id/override', can('settings', 'edit'), asyncH((req, res) => {
  const item = setOverride(tenantId(), req.params.id, req.body?.content, req.user?.email || null);
  audit(req, 'Used own version of a shared template', 'library', item.id, item.title);
  res.json(item);
}));
r.delete('/:id/override', can('settings', 'edit'), asyncH((req, res) => {
  const item = clearOverride(tenantId(), req.params.id);
  if (item) audit(req, 'Went back to the shared version of a template', 'library', item.id, item.title);
  res.json(item || { ok: true });
}));

export default r;
