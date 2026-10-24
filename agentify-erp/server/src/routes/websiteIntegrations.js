// Settings > Website Integrations (staff): make a connection for a website or plugin, see its health, rotate or disconnect it.
// The key it issues is for the Integration API (routes/integrationApi.js) and is shown once.
import { Router } from 'express';
import { all, get } from '../db.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, notFound } from '../util.js';
import { PRESETS } from '../services/presets.js';
import { PLATFORMS, SCOPES, createConnection, events, getConnection, listConnections, record, revokeConnection, rotateKey, updateConnection } from '../services/connections.js';
import { submitLead } from '../services/leads.js';
import { ENQUIRY_TYPES } from './integrationApi.js';
import { createForm, listForms, removeForm, updateForm } from '../services/formKeys.js';
import { EVENTS, deliveries, listSubscriptions, removeSubscription, retryDelivery } from '../services/webhooksOut.js';

const r = Router();
r.use(requireStaff);

const need = (req) => { const c = getConnection(Number(req.params.id)); if (!c) throw notFound('Connection not found'); return c; };
const counts = () => Object.fromEntries(all('SELECT connection_id id, COUNT(*) n FROM lead_attribution WHERE test=0 AND connection_id IS NOT NULL GROUP BY connection_id').map((x) => [x.id, x.n]));

r.get('/meta', can('website', 'view'), (_req, res) => res.json({
  scopes: Object.entries(SCOPES).map(([key, label]) => ({ key, label })), platforms: PLATFORMS, presets: PRESETS, enquiry_types: ENQUIRY_TYPES,
  stages: all("SELECT id, value name FROM lookups WHERE type='lead_stage' AND active=1 ORDER BY sort_order"),
  agents: all("SELECT u.id, u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.name IN ('Sales Agent','Sales Manager') ORDER BY u.name"),
  projects: all('SELECT id, name FROM projects WHERE site_visible=1 ORDER BY name'),
  api_base: '/api/v1',
}));

r.get('/connections', can('website', 'view'), (_req, res) => { const n = counts(); res.json(listConnections().map((c) => ({ ...c, leads: n[c.id] || 0 }))); });

r.post('/connections', can('website', 'edit'), asyncH((req, res) => {
  const out = createConnection(req.body || {}, req.user.id);
  audit(req, 'Created a website connection', 'website_connection', out.connection.id, `${out.connection.name} (${out.connection.platform})`);
  res.status(201).json(out);
}));
r.put('/connections/:id(\\d+)', can('website', 'edit'), asyncH((req, res) => {
  need(req);
  const c = updateConnection(Number(req.params.id), req.body || {});
  audit(req, 'Changed a website connection', 'website_connection', c.id, c.name);
  res.json(c);
}));
r.post('/connections/:id(\\d+)/rotate', can('website', 'edit'), asyncH((req, res) => {
  need(req);
  const out = rotateKey(Number(req.params.id));
  audit(req, 'Rotated a website connection key', 'website_connection', out.connection.id, out.connection.name);
  res.json(out);
}));
r.delete('/connections/:id(\\d+)', can('website', 'delete'), asyncH((req, res) => {
  need(req);
  const c = revokeConnection(Number(req.params.id));
  audit(req, 'Disconnected a website connection', 'website_connection', c.id, c.name);
  res.json(c);
}));
r.get('/connections/:id(\\d+)/events', can('website', 'view'), (req, res) => { need(req); res.json(events(Number(req.params.id), 50)); });

/** "Send a test submission": goes through exactly the path a real enquiry takes, marked as test data. */
r.post('/connections/:id(\\d+)/test-lead', can('website', 'edit'), asyncH((req, res) => {
  const c = need(req);
  if (c.status !== 'active') throw notFound('This connection is disconnected');
  const out = submitLead({ name: 'Test Lead', email: 'test.lead@example.com', phone: '', message: 'Test submission from Settings > Website Integrations. Safe to delete.', enquiry_type: 'inquiry', source: { form: 'Connection test' } }, { kind: 'inquiry', connection: c, test: true });
  record(c.id, 'test_lead', 'success', out.result);
  const lead = get('SELECT c.id, c.full_name, c.lead_source, st.value stage, u.name agent FROM contacts c LEFT JOIN lookups st ON st.id=c.stage_id LEFT JOIN users u ON u.id=c.agent_id WHERE c.id=?', out.id);
  audit(req, 'Sent a test lead through a website connection', 'website_connection', c.id, `contact ${out.id}`);
  res.status(201).json({ result: out.result, lead: { ...lead, link: `/contacts/${lead.id}` } });
}));

// ---- hosted forms (publishable keys) and the snippets to put them on a website
const origin = (req) => `${req.protocol}://${req.get('host')}`;
const withSnippets = (req, f) => ({ ...f, snippets: {
  url: `${origin(req)}/embed/form/${f.form_key}`,
  script: `<script src="${origin(req)}/embed/agentify-form.js" data-form="${f.form_key}"></script>`,
  iframe: `<iframe src="${origin(req)}/embed/form/${f.form_key}" title="${f.title || f.name}" style="width:100%;border:0;min-height:460px" loading="lazy"></iframe>`,
} });
r.get('/connections/:id(\\d+)/forms', can('website', 'view'), (req, res) => { need(req); res.json(listForms(Number(req.params.id)).map((f) => withSnippets(req, f))); });
r.post('/connections/:id(\\d+)/forms', can('website', 'edit'), asyncH((req, res) => {
  const c = need(req);
  const f = createForm(c.id, req.body || {});
  audit(req, 'Created a hosted form', 'website_connection', c.id, f.name);
  res.status(201).json(withSnippets(req, f));
}));
r.put('/connections/:id(\\d+)/forms/:fid(\\d+)', can('website', 'edit'), asyncH((req, res) => {
  need(req);
  const f = updateForm(Number(req.params.id), Number(req.params.fid), req.body || {});
  audit(req, 'Changed a hosted form', 'website_connection', Number(req.params.id), f.name);
  res.json(withSnippets(req, f));
}));
r.delete('/connections/:id(\\d+)/forms/:fid(\\d+)', can('website', 'delete'), asyncH((req, res) => {
  need(req);
  removeForm(Number(req.params.id), Number(req.params.fid));
  audit(req, 'Switched off a hosted form', 'website_connection', Number(req.params.id), `form ${req.params.fid}`);
  res.json({ ok: true });
}));

// ---- webhook health: subscriptions, recent deliveries, retry of failed ones
r.get('/connections/:id(\\d+)/webhooks', can('website', 'view'), (req, res) => {
  need(req);
  res.json({ events: EVENTS, subscriptions: listSubscriptions(Number(req.params.id)), deliveries: deliveries(Number(req.params.id)) });
});
r.delete('/connections/:id(\\d+)/webhooks/:sid(\\d+)', can('website', 'edit'), asyncH((req, res) => {
  need(req);
  removeSubscription(Number(req.params.id), Number(req.params.sid));
  audit(req, 'Removed a webhook subscription', 'website_connection', Number(req.params.id), `subscription ${req.params.sid}`);
  res.json({ ok: true });
}));
r.post('/connections/:id(\\d+)/deliveries/:did(\\d+)/retry', can('website', 'edit'), asyncH(async (req, res) => {
  need(req);
  const ok = await retryDelivery(Number(req.params.id), Number(req.params.did));
  res.json({ ok: !!ok });
}));

export default r;
