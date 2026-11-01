// "Report this AI answer" from inside a workspace (mounted at /api/ai-flags). Any signed-in staff member can report.
import { Router } from 'express';
import { asyncH } from '../util.js';
import { requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { currentTenant } from '../context.js';
import { report } from '../services/aiFlags.js';

const r = Router();
r.use(requireStaff);
r.post('/', asyncH((req, res) => {
  const out = report(currentTenant()?.id || null, req.user?.email || null, req.body || {});
  audit(req, 'Reported an AI answer', 'ai', out.id, String(req.body?.feature || '').slice(0, 60));
  res.status(201).json({ ok: true });
}));
export default r;
