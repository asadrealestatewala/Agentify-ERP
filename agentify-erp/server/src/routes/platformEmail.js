// Super Admin console: tenant e-mail overview. Provider health and usage, platform-wide and per-workspace consumption, delivery
// health, queue failures, per-workspace allowances and top-ups, and the onboarding-mail schedule. Mounted behind requireOperator.
// Tenant users never reach these routes; provider credentials are never returned.
import { Router } from 'express';
import { need } from '../services/platformAccess.js';
import { asyncH, bad, HttpError } from '../util.js';
import { audit, getSetting, setSetting } from '../services/platformConfig.js';
import { getTenant, platformDb } from '../platform.js';
import { platformSummary, syncProviderUsage, allowanceSummary, historyFor, grantTopup, adminRelease, statusCounts } from '../services/tenantEmail.js';
import { cleanEmailLimits } from '../services/emailLimits.js';
import { listSenders, listDomains } from '../services/emailSenders.js';
import { onboardingConfig, saveOnboardingConfig } from '../services/activation.js';
import { inboundDomain } from '../services/emailInbound.js';
import { connectionStatus, testConnection, registerWebhook } from '../services/resendConnection.js';
import { sendMail, layout } from '../services/mailer.js';

const r = Router();
const who = (req) => req.operator.email;
const json = (k) => { try { return JSON.parse(getSetting(k) || 'null'); } catch { return null; } };

r.get('/summary', need('system.view'), (_req, res) => res.json({ ...platformSummary(), settings: { default_limits: json('email_default_limits'), provider_limits: json('email_provider_limits'), inbound_reply_domain: inboundDomain() }, onboarding: onboardingConfig() }));
// ---- Resend connection: status, per-capability test, webhook registration, one test email to the signed-in operator
const baseUrl = (req) => `${process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol}://${req.get('host')}`;
r.get('/resend', need('system.view'), (req, res) => res.json(connectionStatus(baseUrl(req))));
r.post('/resend/test', need('integrations.manage'), asyncH(async (req, res) => { const out = await testConnection(who(req)); audit(who(req), 'resend-connection-test', { ok: out.ok }); res.json(out); }));
r.post('/resend/webhook', need('integrations.manage'), asyncH(async (req, res) => { const out = await registerWebhook(baseUrl(req), who(req)); audit(who(req), 'resend-webhook-registered', { created: out.created }); res.json(out); }));
/** The only real send in this panel, and only to the operator's own address, on an explicit click. */
r.post('/resend/test-email', need('integrations.manage'), asyncH(async (req, res) => {
  const to = req.operator.email;
  await sendMail({ type: 'test', to, subject: 'Agentify ERP: Resend connection test', ...layout({ brand: 'platform', heading: 'Resend connection test', lines: ['This message was sent from the Super Admin console to check that your Resend connection delivers. No action is needed.'] }) });
  audit(who(req), 'resend-test-email', {});
  res.json({ ok: true, to });
}));
r.post('/sync-usage', need('integrations.manage'), asyncH(async (req, res) => { const out = await syncProviderUsage(); audit(who(req), 'email-usage-sync', { ok: out.ok }); res.json(out); }));

r.put('/settings', need('integrations.manage'), asyncH((req, res) => {
  const b = req.body || {};
  if (b.default_limits !== undefined) setSetting('email_default_limits', b.default_limits ? JSON.stringify(cleanEmailLimits(b.default_limits)) : '', { by: who(req) });
  if (b.provider_limits !== undefined) {
    const p = b.provider_limits || {};
    const n = (v, l) => { if (v === null || v === undefined || v === '') return null; const x = Math.trunc(Number(v)); if (!(x >= 0)) throw bad(`${l} must be a whole number`); return x; };
    setSetting('email_provider_limits', b.provider_limits ? JSON.stringify({ monthly: n(p.monthly, 'Monthly provider limit'), daily: n(p.daily, 'Daily provider limit'), reserve_for_service: n(p.reserve_for_service, 'Service reserve') || 0 }) : '', { by: who(req) });
  }
  if (b.commercial !== undefined) {
    const c = b.commercial || {};
    setSetting('email_provider_commercial', b.commercial ? JSON.stringify({ package_name: String(c.package_name || '').slice(0, 80), monthly_cost: c.monthly_cost === '' || c.monthly_cost == null ? null : Number(c.monthly_cost), currency: String(c.currency || '').slice(0, 5), notes: String(c.notes || '').slice(0, 300) }) : '', { by: who(req) });
  }
  if (b.inbound_reply_domain !== undefined) {
    const d = String(b.inbound_reply_domain || '').trim().toLowerCase();
    if (d && !/^(?!-)[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw bad('Enter the domain that receives replies, such as reply.agentifyerp.co');
    setSetting('inbound_reply_domain', d, { by: who(req) });
  }
  audit(who(req), 'email-settings-updated', { keys: Object.keys(b) });
  res.json({ ok: true });
}));

r.get('/tenants/:id(\\d+)', need('workspaces.view'), (req, res) => {
  const t = getTenant(Number(req.params.id));
  if (!t) throw new HttpError(404, 'Workspace not found');
  res.json({ allowance: allowanceSummary(t), override: (() => { try { return JSON.parse(t.entitlements || '{}').email || null; } catch { return null; } })(), domains: listDomains(t.id), senders: listSenders(t.id), counts: statusCounts(t.id), history: historyFor(t.id, { limit: 30 }) });
});
r.put('/tenants/:id(\\d+)/limits', need('workspaces.edit'), asyncH((req, res) => {
  const t = getTenant(Number(req.params.id));
  if (!t) throw new HttpError(404, 'Workspace not found');
  const lim = cleanEmailLimits(req.body?.limits);
  const ent = (() => { try { return JSON.parse(t.entitlements || '{}') || {}; } catch { return {}; } })();
  if (lim) ent.email = lim; else delete ent.email;
  platformDb().prepare("UPDATE tenants SET entitlements=?, updated_at=datetime('now') WHERE id=?").run(Object.keys(ent).length ? JSON.stringify(ent) : null, t.id);
  audit(who(req), 'email-limits-override', { slug: t.slug, cleared: !lim });
  res.json({ allowance: allowanceSummary(getTenant(t.id)) });
}));
r.post('/tenants/:id(\\d+)/topup', need('billing.manage'), asyncH((req, res) => {
  const out = grantTopup(Number(req.params.id), req.body?.category, req.body?.amount, req.body?.note, who(req));
  audit(who(req), 'email-topup', { workspace: Number(req.params.id), category: req.body?.category, amount: Number(req.body?.amount) });
  res.status(201).json(out);
}));
r.post('/queue/:id(\\d+)/release', need('system.manage'), asyncH((req, res) => { const row = adminRelease(Number(req.params.id), who(req)); audit(who(req), 'email-quota-released', { id: row.id }); res.json({ id: row.id, status: row.status, quota_state: row.quota_state }); }));

r.get('/onboarding', need('system.view'), (_req, res) => res.json(onboardingConfig()));
r.put('/onboarding', need('system.manage'), asyncH((req, res) => { const c = saveOnboardingConfig(req.body || {}, who(req)); audit(who(req), 'onboarding-email-config', {}); res.json(c); }));

export default r;
