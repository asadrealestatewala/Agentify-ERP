import { Router } from 'express';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad } from '../util.js';
import {
  myStatus, acceptNotice, withdrawConsent, startForeground, stopSharing, submitLocation, reportLocationError, setAvailability,
  setServiceArea, routeFor, teamList, teamScope, fieldSettings, saveFieldSettings, _forbiddenUnlessVisible,
} from '../services/fieldLocation.js';

/**
 * Field-agent location sharing and coverage. Every "me" route acts on req.user only: there is no way to submit or change
 * someone else's location. Team routes are limited to the caller's reporting line (or everyone for HR).
 */
const r = Router();
r.use(requireStaff);

r.get('/me', asyncH((req, res) => res.json({ ...myStatus(req.user.id), can_view_team: (() => { const sc = teamScope(req.user); return sc.all || sc.ids.length > 0; })() })));

r.post('/me/consent', asyncH((req, res) => {
  const c = acceptNotice(req.user.id, req.body.notice_version);
  audit(req, 'Location notice accepted', 'user', req.user.id, `notice v${c.notice_version}`);
  res.json(myStatus(req.user.id));
}));
r.delete('/me/consent', asyncH((req, res) => {
  withdrawConsent(req.user.id);
  audit(req, 'Location sharing withdrawn (location deleted)', 'user', req.user.id);
  res.json(myStatus(req.user.id));
}));

r.post('/me/sharing', asyncH((req, res) => {
  if (req.body.mode === 'off') { stopSharing(req.user.id); return res.json(myStatus(req.user.id)); }
  if (req.body.mode !== 'foreground') throw bad('mode must be "foreground" or "off"');
  const started = startForeground(req.user.id);
  audit(req, 'Location sharing started (while app is open)', 'user', req.user.id);
  res.json({ ...myStatus(req.user.id), ...started });
}));

r.post('/me/location', asyncH((req, res) => res.json(submitLocation(req.user.id, req.body))));
r.post('/me/location-error', asyncH((req, res) => res.json(reportLocationError(req.user.id, req.body.code))));
r.put('/me/availability', asyncH((req, res) => res.json(setAvailability(req.user.id, req.body.availability))));

r.get('/team', asyncH((req, res) => res.json(teamList(req.user))));
/** Assigned service area is an HR field (hrm:edit), and only for someone the editor can see. */
r.put('/team/:userId(\\d+)/area', can('hrm', 'edit'), asyncH((req, res) => {
  _forbiddenUnlessVisible(req.user, req.params.userId);
  const out = setServiceArea(Number(req.params.userId), req.body.service_area);
  audit(req, 'Service area updated', 'user', req.params.userId, out.service_area || '(cleared)');
  res.json(out);
}));

/** Replay data for one person: GET /team/:userId/route?from=ISO&to=ISO (max 3 days). Viewing a route is logged. */
r.get('/team/:userId(\\d+)/route', asyncH((req, res) => {
  const out = routeFor(req.user, req.params.userId, req.query.from, req.query.to);
  if (out.enabled) audit(req, 'Field route viewed', 'user', req.params.userId, `${out.count} points`);
  res.json(out);
}));

r.get('/settings', can('settings', 'view'), (_req, res) => res.json(fieldSettings()));
r.put('/settings', can('settings', 'edit'), asyncH((req, res) => {
  const before = fieldSettings();
  const s = saveFieldSettings(req.body);
  audit(req, 'Location sharing settings updated', 'settings', 'field_location',
    { enabled: s.enabled, route_history: s.route_history, foreground_allowed: s.foreground_allowed, retention_days: s.retention_days, notice_version: s.notice_version, notice_changed: s.notice_version !== before.notice_version });
  res.json(s);
}));

export default r;
