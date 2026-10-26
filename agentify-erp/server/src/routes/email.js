// Workspace e-mail: allowance, sender domains and addresses, history, suppressions and consent. Staff only; changes need the
// settings permission. Provider credentials never appear here; platform and other workspaces' data cannot be reached.
import { Router } from 'express';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad, HttpError } from '../util.js';
import { get } from '../db.js';
import { currentTenant } from '../context.js';
import { allowanceSummary, historyFor, statusCounts, enqueue, warnThresholds, cancelQueued } from '../services/tenantEmail.js';
import { submitDomain, checkDomain, removeDomain, listDomains, addSender, updateSender, removeSender, listSenders } from '../services/emailSenders.js';
import { recordConsent, suppress, unsuppress, latestConsent, suppressionsFor, lc, isAddress } from '../services/emailConsent.js';
import { inboundDomain } from '../services/emailInbound.js';
import { all } from '../db.js';
import { activationStatus } from '../services/activation.js';
import { platformDb } from '../platform.js';

const r = Router();
r.use(requireStaff);
const tenant = () => currentTenant();

/** Everything the Email settings page shows. */
r.get('/overview', can('settings', 'view'), asyncH((_req, res) => {
  const t = tenant();
  const a = allowanceSummary(t);
  const senders = listSenders(t.id);
  res.json({ allowance: a, domains: listDomains(t.id), senders, status_counts: statusCounts(t.id),
    reply_detection: { configured: !!inboundDomain(), note: inboundDomain() ? 'Replies to follow-up emails are detected automatically.' : 'Automatic reply detection is not set up on this server. Pause a follow-up or log a reply by hand from the contact.' },
    can_send: senders.some((s) => s.can_send) && a.send_state.ok });
}));

r.post('/domains', can('settings', 'edit'), asyncH(async (req, res) => {
  const d = await submitDomain(tenant(), req.body?.domain, req.user.email);
  audit(req, 'Sending domain added', 'email', d.id, d.domain);
  res.status(201).json(d);
}));
r.post('/domains/:id(\\d+)/check', can('settings', 'edit'), asyncH(async (req, res) => res.json(await checkDomain(tenant(), req.params.id))));
r.delete('/domains/:id(\\d+)', can('settings', 'edit'), asyncH(async (req, res) => { await removeDomain(tenant(), req.params.id); audit(req, 'Sending domain removed', 'email', Number(req.params.id)); res.json({ ok: true }); }));

r.post('/senders', can('settings', 'edit'), asyncH((req, res) => {
  const id = addSender(tenant(), req.body || {}, req.user.email);
  audit(req, 'Sender address added', 'email', id);
  res.status(201).json(listSenders(tenant().id).find((s) => s.id === id));
}));
r.put('/senders/:id(\\d+)', can('settings', 'edit'), asyncH((req, res) => { updateSender(tenant(), req.params.id, req.body || {}); audit(req, 'Sender address updated', 'email', Number(req.params.id)); res.json({ ok: true }); }));
r.delete('/senders/:id(\\d+)', can('settings', 'edit'), asyncH((req, res) => { removeSender(tenant(), req.params.id); audit(req, 'Sender address removed', 'email', Number(req.params.id)); res.json({ ok: true }); }));

/** The persistent activation checklist, worked out from real data (not page visits). */
r.get('/activation', asyncH((req, res) => res.json(activationStatus(tenant()))));
/** The owner may switch Agentify's onboarding tips off; account, security and billing mail is not affected. */
r.put('/preferences', can('settings', 'edit'), asyncH((req, res) => {
  const t = tenant();
  const prefs = (() => { try { return JSON.parse(t.email_prefs || '{}') || {}; } catch { return {}; } })();
  if (req.body?.onboarding_emails !== undefined) prefs.onboarding = !!req.body.onboarding_emails;
  platformDb().prepare("UPDATE tenants SET email_prefs=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(prefs), t.id);
  res.json({ onboarding_emails: prefs.onboarding !== false });
}));
r.get('/preferences', (req, res) => { const p = (() => { try { return JSON.parse(tenant().email_prefs || '{}') || {}; } catch { return {}; } })(); res.json({ onboarding_emails: p.onboarding !== false }); });

r.get('/history', can('settings', 'view'), asyncH((req, res) => res.json(historyFor(tenant().id, req.query))));

/** A test message to the signed-in user's own address, through the real queue (counts as operational mail). */
r.post('/test', can('settings', 'edit'), asyncH((req, res) => {
  const q = enqueue({ tenant: tenant(), category: 'operational', to: req.user.email, subject: 'Test email from your workspace', heading: 'Your sender is working', lines: ['This test message was sent from your workspace through the queue.'], idemKey: `test:${req.user.id}:${Date.now()}`, refKind: 'test' });
  warnThresholds(tenant(), 'operational');
  res.status(201).json(q);
}));

// ---- suppressions and consent (this workspace only)
r.get('/suppressions', can('settings', 'view'), (_req, res) => res.json(all('SELECT id,email_lc email,scope,reason,source,created_at FROM email_suppressions WHERE removed_at IS NULL ORDER BY id DESC LIMIT 500')));
r.post('/suppressions', can('settings', 'edit'), asyncH((req, res) => {
  const e = lc(req.body?.email);
  if (!isAddress(e)) throw bad('Enter a valid email address');
  const scope = req.body?.scope === 'all' ? 'all' : 'marketing';
  if (req.body?.remove) unsuppress(e, scope, req.user.id); else { suppress(e, { scope, reason: 'manual', source: req.user.email }); cancelQueued(tenant().id, e, scope, 'suppressed'); }
  audit(req, req.body?.remove ? 'Suppression removed' : 'Address suppressed', 'email', null, `${e} (${scope})`);
  res.json({ ok: true, suppressions: suppressionsFor(e) });
}));
r.get('/consent', can('crm', 'view'), asyncH((req, res) => {
  const e = lc(req.query.email);
  const c = get('SELECT id FROM contacts WHERE lower(email)=?', e);
  res.json({ email: e, consent: latestConsent(e), suppressions: suppressionsFor(e), contact_id: c?.id || null, history: all('SELECT status,source,policy_version,text,created_at FROM email_consents WHERE email_lc=? ORDER BY id DESC LIMIT 20', e) });
}));
r.post('/consent', can('crm', 'edit'), asyncH((req, res) => {
  const b = req.body || {};
  recordConsent({ email: b.email, contactId: b.contact_id || null, status: b.status, source: b.source || 'staff_entry', text: b.text, actorId: req.user.id });
  if (b.status === 'withdrawn') cancelQueued(tenant().id, lc(b.email), 'marketing', 'suppressed');
  audit(req, `Marketing consent ${b.status}`, 'email', null, lc(b.email));
  res.status(201).json({ consent: latestConsent(b.email) });
}));

export default r;
