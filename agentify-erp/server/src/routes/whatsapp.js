// WhatsApp inbox and connection for the signed-in workspace. Staff only. Viewing needs CRM view, replying and handling
// conversations needs CRM edit, the connection needs Settings edit. Roles limited to their own records see only their own
// conversations. Keys are never returned; the platform and other workspaces cannot be reached from here.
import { Router } from 'express';
import { can, requireStaff, ownerId } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad } from '../util.js';
import { all } from '../db.js';
import * as W from '../services/whatsapp.js';

const r = Router();
r.use(requireStaff);
const baseUrl = (req) => `${process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol}://${req.get('host')}`;

r.get('/connection', can('crm', 'view'), (req, res) => {
  const v = W.connectionView(baseUrl(req));
  // the secret webhook address is for people who can change settings only
  if (!req.user.isSuper && !req.user.perms?.has('settings:edit')) v.webhook_url = null;
  res.json(v);
});
r.put('/connection', can('settings', 'edit'), asyncH((req, res) => {
  W.saveConnection(req.user, req.body || {});
  audit(req, 'WhatsApp connection saved', 'whatsapp', null, 'Botlinkd keys updated');
  res.json(W.connectionView(baseUrl(req)));
}));
r.delete('/connection', can('settings', 'edit'), asyncH((req, res) => { W.removeConnection(req.user); audit(req, 'WhatsApp disconnected', 'whatsapp'); res.json({ ok: true }); }));
r.post('/connection/rotate-webhook', can('settings', 'edit'), asyncH((req, res) => { W.rotateWebhookToken(req.user); audit(req, 'WhatsApp webhook address changed', 'whatsapp'); res.json(W.connectionView(baseUrl(req))); }));
r.post('/connection/test', can('settings', 'edit'), asyncH(async (req, res) => { const out = await W.sendTest(req.user, req.body?.to); audit(req, 'WhatsApp test message sent', 'whatsapp'); res.json(out); }));

r.get('/people', can('crm', 'view'), (_req, res) => res.json(all("SELECT u.id,u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 ORDER BY u.name")));
r.get('/threads', can('crm', 'view'), asyncH((req, res) => res.json(W.listThreads({ mineOnly: ownerId(req), status: req.query.status || 'open', filter: req.query.filter || '', q: req.query.q || '' }))));
r.get('/threads/:id(\\d+)', can('crm', 'view'), asyncH((req, res) => {
  const t = W.visibleThread(Number(req.params.id), ownerId(req));
  res.json({ thread: W.withWindow(t), messages: W.messagesOf(t.id) });
}));
r.post('/threads/:id(\\d+)/read', can('crm', 'view'), asyncH((req, res) => { const t = W.visibleThread(Number(req.params.id), ownerId(req)); W.markRead(t.id); res.json({ ok: true }); }));
r.post('/threads/:id(\\d+)/messages', can('crm', 'edit'), asyncH(async (req, res) => {
  const t = W.visibleThread(Number(req.params.id), ownerId(req));
  const m = await W.sendReply(req.user, t.id, req.body?.body);
  res.status(201).json(m);
}));
r.put('/threads/:id(\\d+)', can('crm', 'edit'), asyncH((req, res) => {
  const t = W.visibleThread(Number(req.params.id), ownerId(req));
  W.updateThread(req.user, t, req.body || {}, ownerId(req));
  audit(req, 'WhatsApp conversation updated', 'whatsapp', t.id, Object.keys(req.body || {}).join(', '));
  res.json({ thread: W.withWindow(W.threadRow(t.id)) });
}));
r.post('/threads/:id(\\d+)/opt-out', can('crm', 'edit'), asyncH((req, res) => {
  const t = W.visibleThread(Number(req.params.id), ownerId(req));
  W.setOptOut(req.user, t, req.body?.opt_out !== false, req.body?.reason);
  audit(req, req.body?.opt_out === false ? 'WhatsApp messaging allowed again' : 'WhatsApp opt-out recorded', 'whatsapp', t.id);
  res.json({ thread: W.withWindow(W.threadRow(t.id)) });
}));
r.post('/threads/:id(\\d+)/create-lead', can('crm', 'create'), asyncH((req, res) => {
  const t = W.visibleThread(Number(req.params.id), ownerId(req));
  const name = String(req.body?.name || '').trim();
  if (!name) throw bad('Enter the name of the person');
  const out = W.createLeadFromThread(req.user, t, name);
  audit(req, 'Lead created from WhatsApp', 'whatsapp', t.id, `contact ${out.contact_id}`);
  res.status(201).json({ ...out, thread: W.withWindow(W.threadRow(t.id)) });
}));

export default r;
