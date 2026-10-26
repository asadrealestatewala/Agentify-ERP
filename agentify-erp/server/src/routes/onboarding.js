// Employee onboarding checklists (mounted at /api/hrm/onboarding, so the HR plan module gates it like the rest of HR).
// HR (hrm permissions) manages templates and starts onboarding; managers see their direct reports; every staff login
// sees its own onboarding and the items assigned to it. Access is always worked out on the server from req.user.
import { Router } from 'express';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH } from '../util.js';
import { workCalendar, saveWorkCalendar } from '../services/workCalendar.js';
import {
  CATEGORIES, ASSIGNEES, CRITERIA, ensureStarterTemplate, listTemplates, getTemplate, saveTemplate, deleteTemplate, startOnboarding,
  cancelOnboarding, onboardingDetail, listOnboardings, myOnboarding, itemAction,
} from '../services/onboarding.js';

const r = Router();
r.use(requireStaff);

r.get('/meta', (_req, res) => res.json({ categories: CATEGORIES, assignees: ASSIGNEES, criteria: CRITERIA, calendar: workCalendar() }));

// ---- working calendar (weekend, hours) used for due dates and reminders; holidays live in HR → Holidays
r.get('/calendar', can('hrm', 'view'), (_req, res) => res.json(workCalendar()));
r.put('/calendar', can('hrm', 'approve'), asyncH((req, res) => {
  const c = saveWorkCalendar(req.body || {});
  audit(req, 'Working calendar updated', 'settings', null, `weekend ${c.weekend.join(',')} · ${c.work_start}-${c.work_end}`);
  res.json(c);
}));

// ---- templates
r.get('/templates', can('hrm', 'view'), asyncH((req, res) => { ensureStarterTemplate(req.user.id); res.json(listTemplates()); }));
r.get('/templates/:id(\\d+)', can('hrm', 'view'), asyncH((req, res) => res.json(getTemplate(Number(req.params.id)))));
r.post('/templates', can('hrm', 'edit'), asyncH((req, res) => res.status(201).json(saveTemplate(null, req.body || {}, req))));
r.put('/templates/:id(\\d+)', can('hrm', 'edit'), asyncH((req, res) => res.json(saveTemplate(Number(req.params.id), req.body || {}, req))));
r.delete('/templates/:id(\\d+)', can('hrm', 'edit'), asyncH((req, res) => { deleteTemplate(Number(req.params.id), req); res.json({ ok: true }); }));

// ---- onboardings
r.get('/', asyncH((req, res) => res.json(listOnboardings(req.user, { scope: req.query.scope, filter: req.query.filter || 'open' }))));
r.get('/me', asyncH((req, res) => res.json(myOnboarding(req.user))));
r.post('/', can('hrm', 'edit'), asyncH((req, res) => {
  const out = startOnboarding({ ...(req.body || {}), idempotency_key: req.get('Idempotency-Key') || req.body?.idempotency_key }, req);
  res.status(out.replayed ? 200 : 201).json(out);
}));
r.get('/:id(\\d+)', asyncH((req, res) => res.json(onboardingDetail(Number(req.params.id), req.user))));
r.post('/:id(\\d+)/cancel', can('hrm', 'edit'), asyncH((req, res) => { cancelOnboarding(Number(req.params.id), req.body?.reason, req); res.json({ ok: true }); }));
r.post('/items/:id(\\d+)/action', asyncH((req, res) => res.json(itemAction(Number(req.params.id), req.body || {}, req))));

export default r;
