// Lead conversion API (mounted at /api/leadflow): routing rules and agent availability, response targets, accepting and
// responding to leads, duplicate review, follow-up sequences and the conversion report. Staff only. Contact-level actions
// follow the CRM's own access rule (an own-scope agent reaches only their leads); settings need the settings permission.
import { Router } from 'express';
import { can, requireStaff, ownerId, hasPerm } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad, forbidden, notFound } from '../util.js';
import { all, get } from '../db.js';
import { currentTenant } from '../context.js';
import { assertContactAccess } from './crm.js';
import {
  slaSettings, saveSla, listRules, saveRule, deleteRule, getProfile, saveProfile, contactFlow, acceptLead, logAttempt, logHumanResponse, assignManually, defaultOwner,
} from '../services/leadFlow.js';
import { listReviews, dismissReview, mergeContacts, mergeHistory } from '../services/leadDedupe.js';
import {
  listSequences, getSequence, saveSequence, setSequenceStatus, deleteSequence, createFromTemplate, enroll, enrollmentsFor, pauseEnrollment, resumeEnrollment, cancelEnrollment,
  pauseContact, customerReplied, previewSequence, sendTest, sequenceLog,
} from '../services/sequences.js';
import { sequenceTemplates, TEMPLATE_LANGUAGES } from '../../../shared/sequenceTemplates.js';
import { conversionReport } from '../services/conversion.js';
import { inboundDomain } from '../services/emailInbound.js';
import { listSenders } from '../services/emailSenders.js';
import { setSetting } from '../db.js';

const r = Router();
r.use(requireStaff);
const id = (req) => Number(req.params.id);
const contactOf = (req) => { const c = get('SELECT * FROM contacts WHERE id=?', id(req)); if (!c) throw notFound('Contact not found'); assertContactAccess(req, c); return c; };

// ---- settings: response targets, routing rules, agent availability
r.get('/settings', can('crm', 'view'), asyncH((_req, res) => {
  const staff = all("SELECT u.id, u.name, r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 ORDER BY u.name").map((u) => ({ ...u, profile: getProfile(u.id) }));
  res.json({ sla: slaSettings(), rules: listRules(), staff, default_owner_id: defaultOwner(), senders: listSenders(currentTenant().id) });
}));
r.put('/sla', can('settings', 'edit'), asyncH((req, res) => { const s = saveSla(req.body || {}); audit(req, 'Lead response targets updated', 'settings', null, s.enabled ? 'on' : 'off'); res.json(s); }));
r.put('/default-owner', can('settings', 'edit'), asyncH((req, res) => {
  const v = req.body?.user_id ? Number(req.body.user_id) : null;
  if (v && !get('SELECT 1 FROM users WHERE id=? AND active=1', v)) throw bad('Choose an active user');
  setSetting('lead_default_owner', v ? String(v) : ''); audit(req, 'Default lead owner updated', 'settings', null, String(v || 'none')); res.json({ user_id: v });
}));
r.post('/rules', can('settings', 'edit'), asyncH((req, res) => { const x = saveRule(null, req.body || {}, req.user.id); audit(req, 'Lead routing rule created', 'settings', x.id, x.name); res.status(201).json(x); }));
r.put('/rules/:id(\\d+)', can('settings', 'edit'), asyncH((req, res) => { const x = saveRule(id(req), req.body || {}, req.user.id); audit(req, 'Lead routing rule updated', 'settings', x.id, x.name); res.json(x); }));
r.delete('/rules/:id(\\d+)', can('settings', 'edit'), asyncH((req, res) => { deleteRule(id(req)); audit(req, 'Lead routing rule deleted', 'settings', id(req)); res.json({ ok: true }); }));
r.put('/agents/:id(\\d+)', asyncH((req, res) => {
  // an agent may switch their own availability; everything else about routing needs settings edit
  const own = id(req) === req.user.id;
  const keys = Object.keys(req.body || {});
  if (!(own && keys.every((k) => k === 'available')) && !hasPerm(req.user, 'settings', 'edit')) throw forbidden();
  res.json(saveProfile(id(req), req.body || {}));
}));

// ---- one lead: assignment history, accept, attempts, responses
r.get('/contacts/:id(\\d+)/flow', can('crm', 'view'), asyncH((req, res) => { contactOf(req); res.json({ ...contactFlow(id(req)), sequences: enrollmentsFor(id(req)), merges: mergeHistory(id(req)),
  reply_detection: { configured: !!inboundDomain() } }); }));
r.post('/contacts/:id(\\d+)/accept', can('crm', 'edit'), asyncH((req, res) => { contactOf(req); res.json(acceptLead(id(req), req.user)); }));
r.post('/contacts/:id(\\d+)/attempt', can('crm', 'edit'), asyncH((req, res) => { contactOf(req); logAttempt(id(req), req.user, req.body || {}); res.json({ ok: true }); }));
r.post('/contacts/:id(\\d+)/response', can('crm', 'edit'), asyncH((req, res) => { contactOf(req); logHumanResponse(id(req), req.user, { ...(req.body || {}), evidence: 'manual_log' }); res.json({ ok: true }); }));
r.post('/contacts/:id(\\d+)/reply', can('crm', 'edit'), asyncH((req, res) => { contactOf(req); customerReplied(id(req), { evidence: 'manual_log', detail: String(req.body?.note || '').slice(0, 200), user: req.user }); res.json({ ok: true }); }));
r.post('/contacts/:id(\\d+)/pause-sequences', can('crm', 'edit'), asyncH((req, res) => { contactOf(req); res.json({ paused: pauseContact(id(req), req.user) }); }));
r.post('/contacts/:id(\\d+)/assign', can('crm', 'edit'), asyncH((req, res) => {
  if (ownerId(req)) throw forbidden('Only a manager can assign leads');
  contactOf(req);
  const agent = req.body?.agent_id ? Number(req.body.agent_id) : null;
  if (agent && !get('SELECT 1 FROM users WHERE id=? AND active=1', agent)) throw bad('Choose an active user');
  assignManually(id(req), agent, req.user, String(req.body?.reason || 'Assigned by a manager').slice(0, 200));
  audit(req, 'Lead assigned', 'contact', id(req), String(agent || 'unassigned')); res.json(contactFlow(id(req)));
}));
// leads waiting for a person to pick an owner (manual rules, or no eligible agent and no fallback)
r.get('/queue', can('crm', 'view'), asyncH((req, res) => {
  if (ownerId(req)) return res.json([]);
  res.json(all(`SELECT c.id, c.full_name, c.phone, c.email, c.lead_source, c.created_at, a.reason, a.assigned_at FROM lead_assignments a JOIN contacts c ON c.id=a.contact_id
    WHERE a.agent_id IS NULL AND a.ended_at IS NULL ORDER BY a.id LIMIT 200`));
}));

// ---- duplicates
r.get('/duplicates', can('crm', 'view'), asyncH((req, res) => res.json(ownerId(req) ? [] : listReviews(req.query.status === 'all' ? 'pending' : String(req.query.status || 'pending')))));
r.post('/duplicates/:id(\\d+)/dismiss', can('crm', 'edit'), asyncH((req, res) => { if (ownerId(req)) throw forbidden(); dismissReview(id(req), req.user); res.json({ ok: true }); }));
r.post('/duplicates/:id(\\d+)/merge', can('crm', 'delete'), asyncH((req, res) => {
  if (ownerId(req)) throw forbidden('Only a manager can merge contacts');
  const d = get('SELECT * FROM duplicate_reviews WHERE id=?', id(req));
  if (!d) throw notFound('Review not found');
  const keep = Number(req.body?.keep_id);
  if (![d.contact_id, d.candidate_id].includes(keep)) throw bad('Choose which of the two contacts to keep');
  const other = keep === d.contact_id ? d.candidate_id : d.contact_id;
  const out = mergeContacts(keep, other, req.user);
  audit(req, 'Contacts merged', 'contact', keep, `#${other} into #${keep}`);
  res.json(out);
}));

// ---- sequences
r.get('/sequences', can('crm', 'view'), asyncH((_req, res) => res.json({ sequences: listSequences(), languages: TEMPLATE_LANGUAGES, reply_detection: { configured: !!inboundDomain() } })));
r.get('/sequences/templates', can('crm', 'view'), asyncH((req, res) => res.json(sequenceTemplates(String(req.query.lang || 'en')))));
r.post('/sequences', can('settings', 'edit'), asyncH((req, res) => { const s = saveSequence(null, req.body || {}, req.user); audit(req, 'Sequence created', 'sequence', s.id, s.name); res.status(201).json(s); }));
r.post('/sequences/from-template', can('settings', 'edit'), asyncH((req, res) => { const s = createFromTemplate(String(req.body?.template || ''), String(req.body?.lang || 'en'), req.user); audit(req, 'Sequence created from template', 'sequence', s.id, s.name); res.status(201).json(s); }));
r.post('/sequences/preview', can('crm', 'view'), asyncH((req, res) => { if (req.body?.contact_id) { const c = get('SELECT * FROM contacts WHERE id=?', Number(req.body.contact_id)); assertContactAccess(req, c); } res.json(previewSequence(req.body?.config, req.body?.contact_id ? Number(req.body.contact_id) : null)); }));
r.get('/sequences/:id(\\d+)', can('crm', 'view'), asyncH((req, res) => res.json(getSequence(id(req)))));
r.put('/sequences/:id(\\d+)', can('settings', 'edit'), asyncH((req, res) => { const s = saveSequence(id(req), req.body || {}, req.user); audit(req, 'Sequence updated', 'sequence', s.id, `${s.name} v${s.current_version}`); res.json(s); }));
r.post('/sequences/:id(\\d+)/status', can('settings', 'edit'), asyncH((req, res) => { const s = setSequenceStatus(id(req), String(req.body?.status || '')); audit(req, 'Sequence status changed', 'sequence', s.id, `${s.name}: ${s.status}`); res.json(s); }));
r.delete('/sequences/:id(\\d+)', can('settings', 'edit'), asyncH((req, res) => { deleteSequence(id(req)); audit(req, 'Sequence deleted', 'sequence', id(req)); res.json({ ok: true }); }));
r.post('/sequences/:id(\\d+)/test', can('settings', 'edit'), asyncH((req, res) => res.json(sendTest(id(req), Number(req.body?.step ?? 0), req.user))));
r.post('/sequences/:id(\\d+)/enroll', can('crm', 'edit'), asyncH((req, res) => { const c = get('SELECT * FROM contacts WHERE id=?', Number(req.body?.contact_id)); assertContactAccess(req, c); res.json(enroll(id(req), c.id, { ref: 'manual', user: req.user })); }));
r.get('/enrollments/:id(\\d+)/log', can('crm', 'view'), asyncH((req, res) => { const e = get('SELECT contact_id FROM sequence_enrollments WHERE id=?', id(req)); if (!e) throw notFound('Not found'); assertContactAccess(req, get('SELECT * FROM contacts WHERE id=?', e.contact_id)); res.json(sequenceLog(id(req))); }));
const enrollAct = (fn) => asyncH((req, res) => { const e = get('SELECT contact_id FROM sequence_enrollments WHERE id=?', id(req)); if (!e) throw notFound('Not found'); assertContactAccess(req, get('SELECT * FROM contacts WHERE id=?', e.contact_id)); fn(id(req), req.user); res.json({ ok: true }); });
r.post('/enrollments/:id(\\d+)/pause', can('crm', 'edit'), enrollAct(pauseEnrollment));
r.post('/enrollments/:id(\\d+)/resume', can('crm', 'edit'), enrollAct(resumeEnrollment));
r.post('/enrollments/:id(\\d+)/cancel', can('crm', 'edit'), enrollAct(cancelEnrollment));

// ---- conversion report (own-scope agents see only their own leads)
r.get('/conversion', can('crm', 'view'), asyncH((req, res) => {
  const q = req.query, date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  res.json(conversionReport({ from: date(q.from), to: date(q.to), agentId: q.agent ? Number(q.agent) : null, source: q.source ? String(q.source) : null, projectId: q.project ? Number(q.project) : null, scope: { ownerId: ownerId(req) } }));
}));

export default r;
