// Platform admin console API (mounted at /api/platform/admin). Sign-in, payment settings (Stripe keys, local payment accounts).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, bad, HttpError } from '../util.js';
import { platformDb, BASE_DOMAIN, isMultiTenant, getTenant } from '../platform.js';
import { listAddons, saveAddon, setTenantAddon, listCoupons, saveCoupon, recordRefund, quote } from '../services/commerce.js';
import { runLifecycle } from '../services/lifecycle.js';
import { finance } from '../services/finance.js';
import { retentionDays, setRetentionDays, eligibleForDeletion, retentionState, deleteWorkspaceData } from '../services/retention.js';
import { listAnnouncements, saveAnnouncement, setAnnouncementStatus } from '../services/announcements.js';
import { versionInfo } from '../services/version.js';
import { registry as integrationRegistry, configure as configureIntegration, test as testIntegration, disconnect as disconnectIntegration } from '../services/integrations.js';
import { marketingContent, saveMarketing, listLegal, legalDoc, saveLegal, publishLegal, listDemoRequests, updateDemoRequest } from '../services/marketing.js';
import { analyticsReport } from '../services/analytics.js';
import { resolveRange, utcStart, addDays, buckets, keyExpr } from '../services/platformMetrics.js';
import { COOKIE, login, loginMfa, changePassword, requireOperator, onPlatformHost, twofaStatus, twofaSetup, twofaEnable, twofaDisable,
  loginMeta, endSession, listSessions, revokeSession, revokeAllFor, loginHistory, mfaRequired } from '../services/platformAuth.js';
import { ROLES, PERMISSIONS, TOP_ROLES, permsOf, can, need, auditContext, onDenied } from '../services/platformAccess.js';
import { getSwitches, setSwitches, listRules as listEmailRules, addRule as addEmailRule, removeRule as removeEmailRule, checkEmail } from '../services/disposableEmail.js';
import { getMaintenance, setMaintenance, recentErrors } from '../services/maintenance.js';
import { getAppConfig, saveAppConfig } from '../services/appConfig.js';
import { reportList, runReport, exportReport, savedViews, saveView, deleteView, reconcile } from '../services/platformReports.js';
import { stripeView, saveStripe, stripeConfig, STRIPE_MODES, audit, getSetting, setSetting } from '../services/platformConfig.js';
import { testConnection } from '../services/stripe.js';
import { platformGatewayList, savePlatformGateway, setPlatformGatewayEnabled, removePlatformGateway, platformCheckouts } from '../services/platformGateways.js';
import { LOCAL_METHODS } from '../services/billing.js';
import { runBackup, listBackups, backupDir } from '../services/backup.js';
import { dashboard, health, listNotifications, markRead, search, generateNotifications } from '../services/platformMetrics.js';
import { overview, tenantSummaries, tenantDetail, createWorkspace, extendTrial, trialAction, extendGrace, remindOwner, setOwner, userAction, setupChecklist, listAdmins, addAdmin, removeAdmin,
  updateAdmin, changeStatus, updateProfile, setEntitlements, listNotes, addNote, recordManualPayment, resendOnboarding, transactions } from '../services/platformTenants.js';
import { listPlans, savePlan, savePlanSettings } from '../services/plansStore.js';
import { PLAN_SETTINGS, MODULES, PRODUCTS } from '../services/plans.js';
import { setSubscription } from '../services/billing.js';
import { caps as meetingCaps } from '../integrations/meetings.js';
import { listRegions, setRegionStatus, setRegionFlag, saveRule, reviewRule, listRules, ruleAudit, saveFx, listFx } from '../regions/admin.js';
import { subscriptionHistory } from '../services/subscriptions.js';
import mailboxRoutes from './platformMailbox.js';
import { sendProof } from '../services/billingStatements.js';
import { billingAddress, billingFrom, listReceipts, resendReceipt } from '../services/billingMail.js';
import { listInboxes, createInbox, resendConfigured } from '../services/mailbox.js';
import emailRoutes from './platformEmail.js';
import { whatsappAccess } from '../services/whatsappAccess.js';
import { cleanWhatsappLimits } from '../services/whatsappLimits.js';
import { listReviews, decideReview, deleteReview, reviewPhoto } from '../services/reviews.js';
import { setupNeeded, completeSetup, inviteAdmin, inviteInfo, acceptInvite, requestPasswordReset, resetInfo, completePasswordReset } from '../services/platformStaff.js';
import * as cal from '../services/contentCalendar.js';
import * as aiu from '../services/aiUsage.js';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { authorizeUrl, signState, mainOrigin, redirectUri } from '../services/oauthApps.js';
import * as training from '../services/trainingYoutube.js';
import { freeSitesConfig, saveFreeSites, checkFreeSitesDns } from '../services/freeSites.js';

const r = Router();
// every console request gets a request id and its IP / browser recorded with any audit row it writes
r.use(auditContext);
onDenied((op, perm, req) => audit(op?.email || 'unknown', 'permission-denied', { permission: perm, path: `${req.method} ${req.baseUrl}${req.path}` }, { outcome: 'denied' }));
const limiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.LOGIN_LIMIT) || 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a minute.' } });
const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600 * 1000 };

r.post('/login', limiter, asyncH((req, res) => {
  if (!onPlatformHost(req)) throw new HttpError(404, 'Not found');
  if (req.headers['x-requested-with'] !== 'ERP') throw new HttpError(403, 'CSRF check failed');
  const out = login(req.body?.email, req.body?.password, loginMeta(req));
  if (out.mfa_token) return res.json({ mfa_required: true, mfa_token: out.mfa_token });
  res.cookie(COOKIE, out.token, cookieOpts);
  audit(out.admin.email, 'login');
  res.json(out.admin);
}));
r.post('/login/mfa', limiter, asyncH((req, res) => {
  if (!onPlatformHost(req)) throw new HttpError(404, 'Not found');
  if (req.headers['x-requested-with'] !== 'ERP') throw new HttpError(403, 'CSRF check failed');
  const { admin, token } = loginMfa(req.body?.mfa_token, req.body?.code, loginMeta(req));
  res.cookie(COOKIE, token, cookieOpts);
  audit(admin.email, 'login (2fa)');
  res.json(admin);
}));
// ---- First-run owner setup (open only while no console account exists) and console invitations
const platformOnly = (req, write = false) => {
  if (!onPlatformHost(req)) throw new HttpError(404, 'Not found');
  if (write && req.headers['x-requested-with'] !== 'ERP') throw new HttpError(403, 'CSRF check failed');
};
r.get('/setup/status', (req, res) => { platformOnly(req); res.json({ needed: setupNeeded() }); });
r.post('/setup', limiter, asyncH((req, res) => {
  platformOnly(req, true);
  const out = completeSetup(req.body || {});
  audit(out.email, 'platform-owner-created', { via: 'setup-token' });
  res.status(201).json({ ok: true, email: out.email });
}));
r.get('/invite/:token', limiter, asyncH((req, res) => { platformOnly(req); res.json(inviteInfo(req.params.token)); }));
r.post('/invite/accept', limiter, asyncH((req, res) => {
  platformOnly(req, true);
  const out = acceptInvite(req.body || {});
  audit(out.email, 'invitation-accepted');
  res.json({ ok: true, email: out.email });
}));
// Forgotten password: the same answer whether or not the email is a console account; a stricter limit than sign-in
const resetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: Number(process.env.RESET_LIMIT) || 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many reset requests. Try again later.' } });
r.post('/password/forgot', resetLimiter, asyncH((req, res) => {
  platformOnly(req, true);
  // fire and forget so the response time does not tell an existing account from an unknown one
  requestPasswordReset(req.body?.email, mainOrigin(req), loginMeta(req)).catch(() => {});
  res.json({ ok: true });
}));
r.get('/password/reset/:token', limiter, asyncH((req, res) => { platformOnly(req); res.json(resetInfo(req.params.token)); }));
r.post('/password/reset', limiter, asyncH((req, res) => {
  platformOnly(req, true);
  const out = completePasswordReset(req.body || {});
  audit(out.email, 'password-reset', { via: 'email-link' });
  res.json({ ok: true });
}));
const adminOnly = (req) => { if (req.operator.via !== 'session') throw bad('Sign in as an admin to manage two-factor sign-in'); };
r.get('/2fa', requireOperator, need('self'), (req, res) => { adminOnly(req); res.json(twofaStatus(req.operator.id)); });
r.post('/2fa/setup', requireOperator, need('self'), limiter, asyncH(async (req, res) => { adminOnly(req); res.json(await twofaSetup(req.operator)); }));
r.post('/2fa/enable', requireOperator, need('self'), limiter, asyncH((req, res) => { adminOnly(req); const codes = twofaEnable(req.operator.id, req.body?.code); audit(req.operator.email, '2fa-enabled'); res.json({ ok: true, recovery_codes: codes }); }));
r.post('/2fa/disable', requireOperator, need('self'), limiter, asyncH((req, res) => { adminOnly(req); twofaDisable(req.operator.id, req.body?.password, req.body?.code); audit(req.operator.email, '2fa-disabled'); res.json({ ok: true }); }));
r.post('/logout', requireOperator, need('self'), (req, res) => { endSession(req.operator.sid); audit(req.operator.email, 'logout'); res.clearCookie(COOKIE); res.json({ ok: true }); });
r.get('/me', requireOperator, need('self'), (req, res) => {
  const role = req.operator.via === 'token' ? 'super_admin' : req.operator.role;
  res.json({ id: req.operator.id ?? null, email: req.operator.email, name: req.operator.name || null, via: req.operator.via, base_domain: BASE_DOMAIN || null, multi_tenant: isMultiTenant(),
    role, role_label: ROLES[role]?.label || role, permissions: permsOf(role), totp_enabled: !!req.operator.totp_enabled, mfa_required: mfaRequired(),
    mfa_setup_needed: req.operator.via === 'session' && mfaRequired() && !req.operator.totp_enabled, maintenance: getMaintenance().on });
});
r.post('/change-password', requireOperator, need('self'), limiter, asyncH((req, res) => {
  if (req.operator.via !== 'session') throw bad('Sign in as an admin to change a password');
  const { token } = changePassword(req.operator.id, req.body?.current, req.body?.next, loginMeta(req));
  res.cookie(COOKIE, token, cookieOpts); audit(req.operator.email, 'password-changed'); res.json({ ok: true });
}));

// ---- Stripe
const webhookUrl = (req) => `${req.protocol}://${req.get('host')}/api/platform/billing/webhook/stripe`;
r.get('/settings/stripe', requireOperator, need('billing.configure'), (req, res) => res.json({ ...stripeView(), webhook_url: webhookUrl(req) }));
r.put('/settings/stripe', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const out = saveStripe(req.body || {}, req.operator.email);
  if (out.errors.length) throw bad(out.errors.join('. '), { errors: out.errors });
  res.json({ ...stripeView(), webhook_url: webhookUrl(req) });
}));
/** Read-only call to Stripe with the saved secret key for that mode, so a wrong key is found before a customer pays. */
r.post('/settings/stripe/test', requireOperator, need('billing.configure'), asyncH(async (req, res) => {
  const mode = STRIPE_MODES.includes(req.body?.mode) ? req.body.mode : stripeConfig().mode;
  const out = await testConnection(stripeConfig().modes[mode].secret_key);
  if (out.ok && out.livemode !== (mode === 'live')) return res.json({ ok: false, error: `This key is a ${out.livemode ? 'live' : 'test'} key but is saved as ${mode}` });
  res.json({ mode, ...out });
}));

// ---- Other online gateways for plan payments (PayPal, Tap, ...). Keys are write-only; Stripe subscriptions have their own tab above.
const gwOrigin = (req) => `${req.protocol}://${req.get('host')}`;
r.get('/settings/gateways', requireOperator, need('billing.configure'), (req, res) => res.json({ gateways: platformGatewayList(gwOrigin(req)), payments: platformCheckouts() }));
r.put('/settings/gateways/:id', requireOperator, need('billing.configure'), asyncH(async (req, res) => { await savePlatformGateway(req.params.id, req.body || {}, req.operator.email); res.json({ gateways: platformGatewayList(gwOrigin(req)), payments: platformCheckouts() }); }));
r.post('/settings/gateways/:id/enabled', requireOperator, need('billing.configure'), asyncH((req, res) => { setPlatformGatewayEnabled(req.params.id, !!req.body?.enabled, req.operator.email); res.json({ gateways: platformGatewayList(gwOrigin(req)), payments: platformCheckouts() }); }));
r.delete('/settings/gateways/:id', requireOperator, need('billing.configure'), asyncH((req, res) => { removePlatformGateway(req.params.id, req.operator.email); res.json({ gateways: platformGatewayList(gwOrigin(req)), payments: platformCheckouts() }); }));

// ---- Local payment accounts (Raast, Easypaisa, JazzCash, SadaPay, NayaPay, bank)
const accountView = (a) => ({ id: a.id, method: a.method, label: LOCAL_METHODS[a.method] || a.method, account: a.account, account_name: a.account_name, note: a.note, active: !!a.active, sort_order: a.sort_order });
const cleanAccount = (b, partial = false) => {
  const out = {};
  if (!partial || b.method !== undefined) { if (!LOCAL_METHODS[b.method]) throw bad(`Method must be one of: ${Object.keys(LOCAL_METHODS).join(', ')}`); out.method = b.method; }
  if (!partial || b.account !== undefined) { const a = String(b.account || '').trim(); if (a.length < 3 || a.length > 60) throw bad('Account number / ID is required (3 to 60 characters)'); out.account = a; }
  if (b.account_name !== undefined) out.account_name = String(b.account_name || '').trim().slice(0, 80) || null;
  if (b.note !== undefined) out.note = String(b.note || '').trim().slice(0, 200) || null;
  if (b.active !== undefined) out.active = b.active ? 1 : 0;
  if (b.sort_order !== undefined) out.sort_order = Math.trunc(Number(b.sort_order)) || 0;
  return out;
};
r.get('/payment-accounts', requireOperator, need('billing.view'), (_req, res) => res.json({ methods: LOCAL_METHODS, accounts: platformDb().prepare('SELECT * FROM payment_accounts ORDER BY sort_order, id').all().map(accountView) }));
r.post('/payment-accounts', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const c = cleanAccount(req.body || {});
  const id = Number(platformDb().prepare('INSERT INTO payment_accounts(method,account,account_name,note,active,sort_order) VALUES(?,?,?,?,?,?)').run(c.method, c.account, c.account_name ?? null, c.note ?? null, c.active ?? 1, c.sort_order ?? 0).lastInsertRowid);
  audit(req.operator.email, 'payment-account-added', { id, method: c.method });
  res.status(201).json(accountView(platformDb().prepare('SELECT * FROM payment_accounts WHERE id=?').get(id)));
}));
r.put('/payment-accounts/:id', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const cur = platformDb().prepare('SELECT * FROM payment_accounts WHERE id=?').get(Number(req.params.id));
  if (!cur) throw new HttpError(404, 'Account not found');
  const c = cleanAccount(req.body || {}, true);
  const keys = Object.keys(c);
  if (keys.length) platformDb().prepare(`UPDATE payment_accounts SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => c[k]), cur.id);
  audit(req.operator.email, 'payment-account-edited', { id: cur.id, fields: keys });
  res.json(accountView(platformDb().prepare('SELECT * FROM payment_accounts WHERE id=?').get(cur.id)));
}));
r.delete('/payment-accounts/:id', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const n = platformDb().prepare('DELETE FROM payment_accounts WHERE id=?').run(Number(req.params.id)).changes;
  if (!n) throw new HttpError(404, 'Account not found');
  audit(req.operator.email, 'payment-account-deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---- Backups
r.get('/backups', requireOperator, need('system.view'), (_req, res) => res.json({ dir: backupDir(), backups: listBackups(), keep: Number(process.env.BACKUP_KEEP) || 14, every_hours: Number(process.env.BACKUP_EVERY_HOURS) || 24, enabled: process.env.BACKUP_ENABLED !== '0', uploads: process.env.BACKUP_UPLOADS === '1' }));
r.post('/backups/run', requireOperator, need('system.manage'), limiter, asyncH((req, res) => { const out = runBackup(); audit(req.operator.email, 'backup-run', { name: out.name }); res.json(out); }));
r.get('/audit', requireOperator, need('audit.view'), (_req, res) => res.json(platformDb().prepare('SELECT * FROM platform_audit ORDER BY id DESC LIMIT 100').all()));

// ---- Free websites: the separate domain they are served from, the signup switch, and a DNS check
r.get('/free-sites', requireOperator, need('system.view'), (_req, res) => res.json(freeSitesConfig()));
r.put('/free-sites', requireOperator, need('system.manage'), asyncH((req, res) => {
  const before = freeSitesConfig();
  const out = saveFreeSites({ domain: req.body?.domain, open: req.body?.open === true }, req.operator.email);
  audit(req.operator.email, 'free-sites-settings', { domain: out.domain || null, open: out.open, previous_domain: before.domain || null });
  res.json(out);
}));
r.post('/free-sites/check-dns', requireOperator, need('system.view'), limiter, asyncH(async (_req, res) => res.json(await checkFreeSitesDns())));

// ---- Super admin: overview, workspace progress, expiry and sign-in help
r.get('/overview', requireOperator, need('dashboard.view'), (req, res) => res.json(overview(req, req.operator)));
r.get('/workspaces', requireOperator, need('workspaces.view'), (req, res) => res.json(tenantSummaries(req)));
r.post('/workspaces', requireOperator, need('workspaces.create'), asyncH((req, res) => {
  const t = createWorkspace(req.body || {}, req);
  audit(req.operator.email, 'workspace-created', { slug: t.slug });
  res.status(201).json(t);
}));
r.get('/workspaces/:id', requireOperator, need('workspaces.view'), asyncH((req, res) => res.json(tenantDetail(req.params.id, req))));
r.post('/workspaces/:id/trial', requireOperator, need('trials.manage'), asyncH((req, res) => {
  const action = req.body?.action || 'extend';
  const t = trialAction(req.params.id, { ...(req.body || {}), action }, req.operator.email);
  audit(req.operator.email, action === 'extend' ? 'trial-extended' : `trial-${action}`, { slug: t.slug, until: t.trial_ends_at, status: t.subscription_status, reason: req.body?.reason });
  res.json(tenantDetail(t.id, req));
}));
r.post('/workspaces/:id/grace', requireOperator, need('billing.manage'), asyncH((req, res) => {
  const t = extendGrace(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'grace-extended', { slug: t.slug, until: t.grace_until, reason: req.body?.reason });
  res.json(tenantDetail(t.id, req));
}));
r.post('/workspaces/:id/remind', requireOperator, need('workspaces.edit'), limiter, asyncH(async (req, res) => {
  const out = await remindOwner(req.params.id, req);
  audit(req.operator.email, 'reminder-sent', { tenant: Number(req.params.id) });
  res.json(out);
}));
r.post('/workspaces/:id/owner', requireOperator, need('workspaces.edit'), asyncH((req, res) => {
  const t = setOwner(req.params.id, req.body?.email);
  audit(req.operator.email, 'owner-changed', { slug: t.slug, owner: t.owner_email });
  res.json(tenantDetail(t.id, req));
}));
r.post('/workspaces/:id/users/:uid/:action', requireOperator, need('workspaces.support'), limiter, asyncH(async (req, res) => {
  const out = await userAction(req.params.id, req.params.uid, req.params.action, req.body || {}, req);
  // the reset link itself is never written to the audit log
  audit(req.operator.email, `support:${req.params.action}`, { tenant: Number(req.params.id), user: Number(req.params.uid) });
  res.json(out);
}));
// ---- Workspace lifecycle, profile, limits, notes and payments
r.post('/workspaces/:id/status', requireOperator, need('workspaces.suspend'), asyncH((req, res) => {
  const t = changeStatus(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, `workspace-${t.status}`, { slug: t.slug, reason: req.body?.reason || null });
  res.json(tenantDetail(t.id, req));
}));
r.post('/workspaces/:id/subscription', requireOperator, need('billing.manage'), asyncH((req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) throw bad('A reason is required for changing a subscription by hand');
  const before = tenantDetail(req.params.id, req);
  const t = setSubscription(Number(req.params.id), req.body || {}, { actor: req.operator.email, reason });
  audit(req.operator.email, 'subscription-set', { slug: t.slug, from: { plan: before.plan, status: before.subscription_status, period_end: before.current_period_end }, to: { plan: t.plan, status: t.subscription_status, period_end: t.current_period_end }, reason });
  res.json(tenantDetail(t.id, req));
}));
r.patch('/workspaces/:id', requireOperator, need('workspaces.edit'), asyncH((req, res) => {
  const { tenant, changed } = updateProfile(req.params.id, req.body || {});
  if (changed.length) audit(req.operator.email, 'workspace-edited', { slug: tenant.slug, fields: changed });
  res.json(tenantDetail(tenant.id, req));
}));
r.put('/workspaces/:id/entitlements', requireOperator, need('billing.manage'), asyncH((req, res) => {
  const t = setEntitlements(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'entitlements-set', { slug: t.slug, to: t.entitlements ? JSON.parse(t.entitlements) : null, reason: req.body?.reason });
  res.json(tenantDetail(t.id, req));
}));
r.get('/workspaces/:id/notes', requireOperator, need('workspaces.view'), asyncH((req, res) => res.json(listNotes(req.params.id))));
r.post('/workspaces/:id/notes', requireOperator, need('workspaces.edit'), asyncH((req, res) => {
  const out = addNote(req.params.id, req.body?.body, req.operator.email, !!req.body?.pinned);
  audit(req.operator.email, 'note-added', { tenant: Number(req.params.id) });
  res.status(201).json(out);
}));
r.post('/workspaces/:id/payments', requireOperator, need('billing.manage'), limiter, asyncH(async (req, res) => {
  const out = await recordManualPayment(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'payment-recorded', { tenant: Number(req.params.id), payment: out.id, amount: req.body?.amount, currency: req.body?.currency, method: req.body?.method });
  res.status(201).json(tenantDetail(out.tenant.id, req));
}));
r.post('/workspaces/:id/onboarding-email', requireOperator, need('workspaces.support'), limiter, asyncH(async (req, res) => {
  const out = await resendOnboarding(req.params.id, req);
  audit(req.operator.email, 'onboarding-email', { tenant: Number(req.params.id) });
  res.json(out);
}));

// ---- Plans, subscriptions and money
r.get('/plans', requireOperator, need('billing.view'), (_req, res) => res.json({ plans: listPlans(), settings: { ...PLAN_SETTINGS }, modules: MODULES, products: PRODUCTS }));
r.put('/plans/:id', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const out = savePlan(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, out.changes.created ? 'plan-created' : 'plan-edited', { plan: out.plan.id, ...out.changes });
  res.json(out.plan);
}));
r.put('/plan-settings', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const out = savePlanSettings(req.body || {}, req.operator.email);
  audit(req.operator.email, 'plan-settings', out);
  res.json(out);
}));
// ---- Add-ons, coupons, refunds and the lifecycle job
r.get('/addons', requireOperator, need('billing.view'), (_req, res) => res.json(listAddons()));
r.put('/addons/:id', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const out = saveAddon(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'addon-saved', { id: out.id, price: out.price, entitlements: out.entitlements, active: out.active });
  res.json(out);
}));
r.post('/workspaces/:id/addons', requireOperator, need('billing.manage'), asyncH((req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) throw bad('A reason is required for changing add-ons by hand');
  const t = tenantDetail(req.params.id, req);
  if (t.is_legacy) throw bad('The original workspace is not billed');
  const out = setTenantAddon(t.id, { ...(req.body || {}), reason }, req.operator.email);
  audit(req.operator.email, 'addon-changed', { slug: t.slug, addon: req.body?.addon_id, active: req.body?.active !== false, quantity: req.body?.quantity, reason });
  res.json(out);
}));
r.get('/coupons', requireOperator, need('billing.view'), (_req, res) => res.json(listCoupons()));
r.put('/coupons/:code', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const out = saveCoupon(req.params.code, req.body || {}, req.operator.email);
  audit(req.operator.email, 'coupon-saved', { code: out.code, percent_off: out.percent_off, amount_off: out.amount_off, active: out.active });
  res.json(out);
}));
r.post('/workspaces/:id/refunds', requireOperator, need('billing.manage'), limiter, asyncH((req, res) => {
  const out = recordRefund(req.params.id, { invoice_id: req.body?.invoice_id, amount: req.body?.amount, reason: req.body?.reason, reference: req.body?.reference, provider: 'manual' }, req.operator.email);
  audit(req.operator.email, 'refund-recorded', { tenant: Number(req.params.id), invoice: out.invoice_id, amount: out.amount, currency: out.currency, reason: req.body?.reason });
  res.status(201).json(out);
}));
r.post('/quote', requireOperator, need('billing.view'), asyncH((req, res) => {
  const b = req.body || {};
  const t = b.tenant_id ? tenantDetail(b.tenant_id, req) : null;
  res.json(quote(t && !t.is_legacy ? getTenant(t.id) : null, { plan: b.plan, interval: b.interval, currency: b.currency, coupon: b.coupon, addons: b.addons }));
}));
// ---- Public website content, legal documents, demo requests and website analytics
r.get('/marketing', requireOperator, need('content.manage'), (_req, res) => res.json({ content: marketingContent(), legal: listLegal() }));
r.put('/marketing', requireOperator, need('content.manage'), asyncH((req, res) => {
  const out = saveMarketing(req.body || {}, req.operator.email);
  audit(req.operator.email, 'website-content-saved', { fields: Object.keys(req.body || {}) });
  res.json({ content: out, legal: listLegal() });
}));
r.get('/legal/:slug', requireOperator, need('content.manage'), asyncH((req, res) => res.json(legalDoc(req.params.slug))));
r.put('/legal/:slug', requireOperator, need('content.manage'), asyncH((req, res) => {
  const out = saveLegal(req.params.slug, req.body || {}, req.operator.email);
  audit(req.operator.email, 'legal-draft-saved', { doc: out.slug });
  res.json(out);
}));
r.post('/legal/:slug/publish', requireOperator, need('content.manage'), asyncH((req, res) => {
  const out = publishLegal(req.params.slug, req.body || {}, req.operator.email);
  audit(req.operator.email, 'legal-published', { doc: out.slug, version: out.version, reviewed_by: out.reviewed_by });
  res.json(out);
}));
// ---- Customer reviews sent from the website: approve before they appear, reject, or delete
r.get('/reviews', requireOperator, need('content.manage'), (req, res) => res.json(listReviews({ status: req.query.status })));
r.get('/reviews/:id/photo', requireOperator, need('content.manage'), asyncH((req, res) => {
  const p = reviewPhoto(req.params.id, { any: true });
  res.set({ 'Content-Type': p.type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' }).send(p.buffer);
}));
r.post('/reviews/:id/:decision(approve|reject|reset)', requireOperator, need('content.manage'), asyncH((req, res) => {
  const status = { approve: 'approved', reject: 'rejected', reset: 'pending' }[req.params.decision];
  const out = decideReview(req.params.id, status, req.operator.email);
  audit(req.operator.email, `review-${status}`, { id: out.id, name: out.name });
  res.json(out);
}));
r.delete('/reviews/:id', requireOperator, need('content.manage'), asyncH((req, res) => {
  deleteReview(req.params.id);
  audit(req.operator.email, 'review-deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
}));
r.get('/demo-requests', requireOperator, need('workspaces.view'), (req, res) => res.json(listDemoRequests({ status: req.query.status })));
r.patch('/demo-requests/:id', requireOperator, need('workspaces.edit'), asyncH((req, res) => {
  const out = updateDemoRequest(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'demo-request-updated', { id: out.id, status: out.status });
  res.json(out);
}));
r.get('/analytics', requireOperator, need('analytics.view'), asyncH((req, res) => {
  const range = resolveRange(req.query);
  const report = analyticsReport({ from: utcStart(range.from), to: utcStart(addDays(range.to, 1)), buckets: buckets(range), keyExpr: (c) => keyExpr(c, range) });
  res.json({ range, ...report, ga4: { configured: !!getSetting('ga4_measurement_id') } });
}));
// ---- Regions: availability, flags, legal rules (reviewed before use), exchange rates
const regionErr = (fn) => { try { return fn(); } catch (e) { throw bad(e.message); } };
r.get('/regions', requireOperator, need('regions.support'), (_req, res) => res.json({ regions: listRegions(platformDb()), fx: listFx(platformDb()) }));
r.get('/regions/:code/rules', requireOperator, need('regions.support'), (req, res) => res.json({ rules: listRules(platformDb(), req.params.code), audit: ruleAudit(platformDb(), req.params.code) }));
r.post('/regions/:code/status', requireOperator, need('regions.manage'), asyncH((req, res) => {
  regionErr(() => setRegionStatus(platformDb(), req.params.code, req.body?.status, req.operator.email));
  audit(req.operator.email, 'region-status', { region: req.params.code, status: req.body?.status });
  res.json({ regions: listRegions(platformDb()) });
}));
r.post('/regions/:code/flags', requireOperator, need('regions.manage'), asyncH((req, res) => {
  regionErr(() => setRegionFlag(platformDb(), req.params.code, String(req.body?.flag || ''), !!req.body?.enabled, req.operator.email));
  audit(req.operator.email, 'region-flag', { region: req.params.code, flag: req.body?.flag, enabled: !!req.body?.enabled });
  res.json({ regions: listRegions(platformDb()) });
}));
r.post('/regions/:code/rules', requireOperator, need('regions.manage'), asyncH((req, res) => {
  const id = regionErr(() => saveRule(platformDb(), { ...(req.body || {}), region: req.params.code }, req.operator.email));
  audit(req.operator.email, 'region-rule-created', { region: req.params.code, id });
  res.status(201).json({ id });
}));
r.post('/regions/rules/:id/review', requireOperator, need('regions.manage'), asyncH((req, res) => {
  regionErr(() => reviewRule(platformDb(), Number(req.params.id), req.operator.email));
  audit(req.operator.email, 'region-rule-reviewed', { id: Number(req.params.id) });
  res.json({ ok: true });
}));
r.post('/fx', requireOperator, need('regions.manage'), asyncH((req, res) => {
  regionErr(() => saveFx(platformDb(), req.body || {}, req.operator.email));
  audit(req.operator.email, 'fx-rate-set', { base: req.body?.base, quote: req.body?.quote });
  res.status(201).json({ fx: listFx(platformDb()) });
}));
// ---- Meetings: the limits no workspace can go beyond
r.get('/meetings-settings', requireOperator, need('system.view'), (_req, res) => res.json(meetingCaps()));
r.put('/meetings-settings', requireOperator, need('system.manage'), asyncH((req, res) => {
  const b = req.body || {}; const num = (v, lo, hi, name) => { const n = Math.round(Number(v)); if (!(n >= lo && n <= hi)) throw bad(`${name} must be between ${lo} and ${hi}.`); return String(n); };
  if (b.max_minutes !== undefined) setSetting('meet_max_minutes_cap', num(b.max_minutes, 5, 600, 'Longest meeting (minutes)'));
  if (b.max_participants !== undefined) setSetting('meet_max_participants', num(b.max_participants, 2, 25, 'People per meeting'));
  if (b.early_join_minutes !== undefined) setSetting('meet_early_join_minutes', num(b.early_join_minutes, 0, 120, 'Early join (minutes)'));
  if (b.max_advance_days !== undefined) setSetting('meet_max_advance_days', num(b.max_advance_days, 1, 730, 'Days ahead'));
  if (b.enabled !== undefined) setSetting('meet_enabled', b.enabled ? '1' : '0');
  if (b.recording !== undefined) setSetting('meet_recording', b.recording ? '1' : '0');
  audit(req.operator.email, 'meetings-limits', { ...b });
  res.json(meetingCaps());
}));
// ---- Mailbox: read, reply and send company e-mail, the sent log and its settings (Platform Owner and Super Admin only)
// ---- Billing mail: the billing@ sender, its inbox in the Mailbox, and the receipts sent for recorded payments
r.get('/payments/:id/proof', requireOperator, need('billing.view'), (req, res) => sendProof(res, req.params.id));
r.get('/billing-mail', requireOperator, need('billing.view'), asyncH(async (req, res) => {
  let inbox = null, inboxError = null;
  if (resendConfigured() && can(req.operator, 'mailbox.manage')) {
    try { inbox = (await listInboxes({ fresh: true })).find((i) => String(i.email_address).toLowerCase() === billingAddress()) || null; } catch (e) { inboxError = e.message; }
  }
  const receipts = listReceipts({ limit: 100 });
  res.json({ address: billingAddress(), from: billingFrom(), resend_ready: resendConfigured(), can_open_mailbox: can(req.operator, 'mailbox.manage'), inbox: inbox ? { id: inbox.id, email: inbox.email_address } : null, inbox_error: inboxError, receipts });
}));
r.post('/billing-mail/inbox', requireOperator, need('mailbox.manage'), limiter, asyncH(async (req, res) => {
  const out = await createInbox({ email: billingAddress(), name: 'Agentify ERP – Billing', from_name: 'Agentify ERP Billing' });
  audit(req.operator.email, 'billing-inbox-created', { address: out.email });
  res.status(201).json(out);
}));
r.post('/billing-mail/receipts/:id/resend', requireOperator, need('billing.manage'), limiter, asyncH(async (req, res) => {
  const out = await resendReceipt(req.params.id);
  if (!out.found) throw new HttpError(404, 'Receipt not found');
  audit(req.operator.email, 'receipt-resent', { receipt: Number(req.params.id), sent: out.sent });
  res.json(out);
}));
r.use('/mailbox', requireOperator, need('mailbox.manage'), mailboxRoutes);
r.use('/email', requireOperator, emailRoutes);
// ---- Announcements and release notes, integrations, running version
r.get('/announcements', requireOperator, need('dashboard.view'), (_req, res) => res.json({ items: listAnnouncements(), version: versionInfo() }));
r.post('/announcements', requireOperator, need('content.manage'), asyncH((req, res) => {
  const out = saveAnnouncement(null, req.body || {}, req.operator.email);
  audit(req.operator.email, 'announcement-created', { id: out.id, title: out.title });
  res.status(201).json(out);
}));
r.put('/announcements/:id', requireOperator, need('content.manage'), asyncH((req, res) => {
  const out = saveAnnouncement(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'announcement-edited', { id: out.id });
  res.json(out);
}));
r.post('/announcements/:id/:action(publish|retire|draft)', requireOperator, need('content.manage'), asyncH((req, res) => {
  const out = setAnnouncementStatus(req.params.id, req.params.action);
  audit(req.operator.email, `announcement-${req.params.action}`, { id: out.id, title: out.title, audience: out.audience, publish_at: out.publish_at });
  res.json(out);
}));
r.get('/version', requireOperator, need('dashboard.view'), (_req, res) => res.json(versionInfo()));
r.get('/integrations', requireOperator, need('system.view'), (_req, res) => res.json(integrationRegistry()));
r.put('/integrations/:id', requireOperator, need('integrations.manage'), asyncH(async (req, res) => {
  const out = await configureIntegration(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'integration-configured', { integration: req.params.id });
  res.json(out);
}));
r.post('/integrations/:id/test', requireOperator, need('integrations.manage'), limiter, asyncH(async (req, res) => {
  const out = await testIntegration(req.params.id, req.operator.email, { to: req.operator.email.includes('@') ? req.operator.email : req.body?.to, number: req.body?.number });
  audit(req.operator.email, 'integration-tested', { integration: req.params.id, ok: out.ok }, { outcome: out.ok ? 'success' : 'failed' });
  res.json(out);
}));
// ---- WhatsApp entitlement per workspace (the plan editor and the platform default are set elsewhere)
r.get('/whatsapp/tenants/:id(\\d+)', requireOperator, need('workspaces.view'), (req, res) => {
  const t = getTenant(Number(req.params.id));
  if (!t) throw new HttpError(404, 'Workspace not found');
  res.json({ override: (() => { try { return JSON.parse(t.entitlements || '{}').whatsapp || null; } catch { return null; } })(), effective: whatsappAccess(t) });
});
r.put('/whatsapp/tenants/:id(\\d+)', requireOperator, need('workspaces.edit'), asyncH((req, res) => {
  const t = getTenant(Number(req.params.id));
  if (!t) throw new HttpError(404, 'Workspace not found');
  const lim = cleanWhatsappLimits(req.body?.limits);
  const ent = (() => { try { return JSON.parse(t.entitlements || '{}') || {}; } catch { return {}; } })();
  if (lim) ent.whatsapp = lim; else delete ent.whatsapp;
  platformDb().prepare("UPDATE tenants SET entitlements=?, updated_at=datetime('now') WHERE id=?").run(Object.keys(ent).length ? JSON.stringify(ent) : null, t.id);
  audit(req.operator.email, 'whatsapp-limits-override', { slug: t.slug, cleared: !lim, enabled: lim?.enabled });
  res.json({ override: lim, effective: whatsappAccess(getTenant(t.id)) });
}));
r.delete('/integrations/:id', requireOperator, need('integrations.manage'), asyncH(async (req, res) => {
  const out = await disconnectIntegration(req.params.id, req.operator.email);
  audit(req.operator.email, 'integration-disconnected', { integration: req.params.id });
  res.json(out);
}));
// ---- Data retention and deletion (never automatic)
r.get('/retention', requireOperator, need('workspaces.view'), (_req, res) => res.json({ retention_days: retentionDays(), eligible: eligibleForDeletion().map((t) => ({ id: t.id, slug: t.slug, name: t.name, ...retentionState(t) })) }));
r.put('/retention', requireOperator, need('system.manage'), asyncH((req, res) => {
  const days = setRetentionDays(req.body?.retention_days, req.operator.email);
  audit(req.operator.email, 'retention-policy', { retention_days: days });
  res.json({ retention_days: days });
}));
r.post('/workspaces/:id/delete-data', requireOperator, need('workspaces.suspend'), limiter, asyncH((req, res) => {
  if (!TOP_ROLES.includes(req.operator.role) && req.operator.via !== 'token') throw new HttpError(403, 'Only a Platform Owner or Super Admin can delete workspace data');
  const out = deleteWorkspaceData(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'workspace-data-deleted', { slug: out.slug, reason: req.body?.reason, owner_request: !!req.body?.owner_request, archive: out.archive });
  res.json(out);
}));
r.post('/lifecycle/run', requireOperator, need('system.manage'), limiter, asyncH(async (req, res) => {
  const out = await runLifecycle();
  audit(req.operator.email, 'lifecycle-run', out);
  res.json(out);
}));
r.get('/subscriptions/history', requireOperator, need('billing.view'), (req, res) => res.json(subscriptionHistory({ tenantId: req.query.tenant, limit: Number(req.query.per) || 100, offset: (Number(req.query.page) || 0) * (Number(req.query.per) || 100) })));
r.get('/transactions', requireOperator, need('billing.view'), (req, res) => res.json(transactions(req.query)));

r.get('/setup', requireOperator, need('system.view'), (req, res) => res.json(setupChecklist(req.operator)));

// ---- Dashboard, health, notifications, search
r.get('/dashboard', requireOperator, need('dashboard.view'), asyncH((req, res) => {
  const out = dashboard(req.query, req);
  // roles without financial reporting see counts and activity, never money
  if (!can(req.operator, 'finance.view')) {
    for (const k of ['mrr', 'arr', 'payments_received']) if (out.kpis[k]) out.kpis[k] = { hidden: true };
    out.charts.revenue = []; out.charts.top_workspaces = []; out.charts.recent_transactions = [];
  }
  if (!can(req.operator, 'workspaces.view')) { out.charts.top_workspaces = []; out.charts.recent_transactions = []; out.charts.recent_activity = []; }
  res.json(out);
}));
/** Revenue & subscriptions: MRR/ARR, invoiced vs collected, refunds, net, recognised revenue, movement; filterable. */
r.get('/finance', requireOperator, need('finance.view'), asyncH((req, res) => res.json(finance(req.query))));
r.get('/finance/export', requireOperator, need('finance.view'), need('workspaces.export'), asyncH(async (req, res) => {
  const f = finance(req.query);
  const rows = [];
  for (const [metric, byCur] of Object.entries(f.money)) for (const [currency, amount] of Object.entries(byCur)) rows.push({ section: 'Money', metric, currency, value: amount, definition: f.definitions[metric] || '' });
  for (const [k, v] of Object.entries({ ...f.counts, failed_payments: f.failed_payments, ...f.movement })) rows.push({ section: 'Counts', metric: k, currency: '', value: v ?? '', definition: '' });
  for (const p of f.by_plan) for (const [currency, amount] of Object.entries(p.mrr)) rows.push({ section: 'MRR by plan', metric: `${p.name} (${p.plan}), ${p.subscribers} subscribers`, currency, value: amount, definition: '' });
  const rep = { id: 'revenue-summary', title: 'Revenue & subscriptions', range: f.range, rows, columns: [['section', 'Section'], ['metric', 'Metric'], ['currency', 'Currency'], ['value', 'Value'], ['definition', 'Definition']] };
  const file = await exportReport(rep, String(req.query.format || 'csv'));
  audit(req.operator.email, 'report-exported', { report: rep.id, format: req.query.format || 'csv', filters: f.filters, from: f.range.from, to: f.range.to });
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.body);
}));
r.get('/health', requireOperator, need('system.view'), (_req, res) => res.json(health()));
r.get('/notifications', requireOperator, need('dashboard.view'), asyncH((req, res) => { generateNotifications(req); res.json(listNotifications(req.operator.id, { all: req.query.all === '1' })); }));
r.post('/notifications/read', requireOperator, need('dashboard.view'), asyncH((req, res) => res.json({ marked: markRead(req.operator.id, req.body?.ids) })));
r.get('/search', requireOperator, need('dashboard.view'), (req, res) => res.json(search(req.query.q)));

// ---- Audit log search (append-only; this API can only read it)
r.get('/audit/search', requireOperator, need('audit.view'), (req, res) => {
  const q = req.query, where = [], args = [];
  if (q.admin) { where.push('admin LIKE ?'); args.push(`%${q.admin}%`); }
  if (q.action) { where.push('action LIKE ?'); args.push(`%${q.action}%`); }
  if (q.target) { where.push('target LIKE ?'); args.push(`%${q.target}%`); }
  if (q.outcome) { where.push('outcome=?'); args.push(String(q.outcome)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { where.push('created_at>=?'); args.push(`${q.from} 00:00:00`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { where.push('created_at<=?'); args.push(`${q.to} 23:59:59`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const per = Math.min(500, Math.max(1, Number(q.per) || 50)), page = Math.max(0, Number(q.page) || 0);
  const db = platformDb();
  res.json({ total: db.prepare(`SELECT COUNT(*) n FROM platform_audit ${w}`).get(...args).n, page, per, rows: db.prepare(`SELECT * FROM platform_audit ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, per, page * per) });
});

// ---- Sessions and sign-in history
r.get('/sessions', requireOperator, need('self'), (req, res) => {
  const all = req.query.all === '1' && can(req.operator, 'admins.manage');
  const rows = listSessions(all ? null : req.operator.id).map((s) => ({ ...s, current: !!req.operator.sid && req.operator.sid.startsWith(s.ref) }));
  res.json({ all, rows });
});
r.delete('/sessions/:ref', requireOperator, need('self'), asyncH((req, res) => {
  const any = can(req.operator, 'admins.manage');
  const n = revokeSession(req.params.ref, { adminId: any ? null : req.operator.id, by: req.operator.email });
  if (!n) throw new HttpError(404, 'Session not found');
  audit(req.operator.email, 'session-revoked', { session: req.params.ref.slice(0, 8) });
  res.json({ ok: true });
}));
r.post('/sessions/revoke-others', requireOperator, need('self'), asyncH((req, res) => {
  const n = revokeAllFor(req.operator.id, { exceptSid: req.operator.sid, by: req.operator.email });
  audit(req.operator.email, 'sessions-revoked', { count: n });
  res.json({ revoked: n });
}));
r.get('/logins', requireOperator, need('audit.view'), (req, res) => res.json(loginHistory(req.query)));
r.get('/security-settings', requireOperator, need('admins.manage'), (_req, res) => res.json({ require_2fa: mfaRequired() }));
r.put('/security-settings', requireOperator, need('admins.manage'), asyncH((req, res) => {
  const on = !!req.body?.require_2fa;
  if (on && req.operator.via === 'session' && !req.operator.totp_enabled) throw bad('Turn on two-factor sign-in for your own account first');
  platformDb().prepare("INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES('require_2fa',?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(on ? '1' : '0', req.operator.email);
  audit(req.operator.email, on ? 'require-2fa-on' : 'require-2fa-off');
  res.json({ require_2fa: mfaRequired() });
}));

// ---- Email safety: refuse throw-away addresses and require a code at signup (services/disposableEmail.js, emailOtp.js)
r.get('/email-safety', requireOperator, need('system.view'), (_req, res) => res.json({ ...getSwitches(), ...listEmailRules() }));
r.put('/email-safety', requireOperator, need('system.manage'), asyncH((req, res) => {
  const out = setSwitches(req.body || {}, req.operator.email);
  audit(req.operator.email, 'email-safety-switches', out);
  res.json({ ...out, ...listEmailRules() });
}));
r.post('/email-safety/rules', requireOperator, need('system.manage'), asyncH((req, res) => {
  const domain = addEmailRule(req.body || {}, req.operator.email);
  audit(req.operator.email, 'email-domain-rule', { domain, action: req.body?.action });
  res.status(201).json({ ...listEmailRules(), domain });
}));
r.delete('/email-safety/rules/:domain', requireOperator, need('system.manage'), asyncH((req, res) => {
  if (!removeEmailRule(req.params.domain)) throw new HttpError(404, 'That domain is not in your list');
  audit(req.operator.email, 'email-domain-rule-removed', { domain: req.params.domain });
  res.json(listEmailRules());
}));
/** "Would this address be accepted at signup?" for support staff and for trying a domain before adding it. */
r.post('/email-safety/check', requireOperator, need('system.view'), asyncH(async (req, res) => res.json(await checkEmail(req.body?.email))));

// ---- Maintenance mode and recent errors
r.get('/maintenance', requireOperator, need('system.view'), (_req, res) => res.json(getMaintenance()));
r.put('/maintenance', requireOperator, need('system.manage'), asyncH((req, res) => {
  const out = setMaintenance(req.body || {}, req.operator.email);
  audit(req.operator.email, out.on ? 'maintenance-on' : 'maintenance-off', { reason: req.body?.reason || null });
  res.json(out);
}));
// ---- Mobile app remote configuration (colours, title, update notice)
r.get('/app-config', requireOperator, need('system.view'), (_req, res) => res.json(getAppConfig()));
r.put('/app-config', requireOperator, need('system.manage'), asyncH((req, res) => {
  const out = saveAppConfig(req.body || {}, req.operator.email);
  audit(req.operator.email, 'app-config-saved', { min: out.update.min, latest: out.update.latest });
  res.json(out);
}));
// ---- Training videos: the console library and posting to YouTube (services/trainingYoutube.js)
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => fs.mkdir(training.UPLOADS, { recursive: true }, (e) => cb(e, training.UPLOADS)),
    filename: (_r, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: 500 * 1024 * 1024, files: 1, fields: 12 },
  fileFilter: (_r, f, cb) => (['.mp4', '.webm', '.mov'].includes(path.extname(f.originalname).toLowerCase()) && /^video\//.test(f.mimetype) ? cb(null, true) : cb(bad('Choose a video file (MP4, WebM or MOV)'))),
});
// ---- Content calendar (Agentify's own marketing posts); the Social Media Manager role works only here
r.get('/content', requireOperator, need('content.calendar'), (_req, res) => res.json({ ...cal.overview(), can_edit_limits: can(_req.operator, 'system.manage'), ai: aiu.aiStatus() }));
r.post('/content/posts', requireOperator, need('content.calendar'), asyncH((req, res) => { const p = cal.createPost(req.body || {}, req.operator.email); audit(req.operator.email, 'content-post-created', { id: p.id, channel: p.channel }); res.status(201).json(p); }));
r.put('/content/posts/:id', requireOperator, need('content.calendar'), asyncH((req, res) => { const p = cal.updatePost(req.params.id, req.body || {}, req.operator.email); audit(req.operator.email, 'content-post-edited', { id: p.id }); res.json(p); }));
r.post('/content/posts/:id/schedule', requireOperator, need('content.calendar'), asyncH((req, res) => {
  const p = cal.schedulePost(req.params.id, req.body?.scheduled_at, req.operator.email, { override: !!req.body?.override && can(req.operator, 'system.manage') });
  audit(req.operator.email, 'content-post-scheduled', { id: p.id, at: p.scheduled_at }); res.json(p);
}));
r.post('/content/posts/:id/unschedule', requireOperator, need('content.calendar'), asyncH((req, res) => { res.json(cal.unschedulePost(req.params.id)); }));
r.post('/content/posts/:id/posted', requireOperator, need('content.calendar'), asyncH((req, res) => {
  const out = cal.markPosted(req.params.id, req.body || {}, req.operator.email, { override: false });
  audit(req.operator.email, 'content-post-recorded-posted', { id: out.post.id, channel: out.post.channel }); res.json(out);
}));
r.post('/content/posts/:id/cancel', requireOperator, need('content.calendar'), asyncH((req, res) => { const p = cal.cancelPost(req.params.id); audit(req.operator.email, 'content-post-canceled', { id: p.id }); res.json(p); }));
r.delete('/content/posts/:id', requireOperator, need('content.calendar'), asyncH((req, res) => { cal.deletePost(req.params.id); audit(req.operator.email, 'content-post-deleted', { id: Number(req.params.id) }); res.json({ ok: true }); }));
r.post('/content/ai-draft', requireOperator, need('content.calendar'), asyncH(async (req, res) => {
  const b = req.body || {};
  if (!cal.CHANNELS[b.channel]) throw bad('Choose a channel');
  const d = await aiu.draftPost({ channel: cal.CHANNELS[b.channel], topic: b.topic, tone: b.tone, language: b.language }, req.operator.email);
  const post = cal.createPost({ title: d.title, body: d.body, channel: b.channel, source: 'ai' }, req.operator.email);
  audit(req.operator.email, 'content-ai-draft', { id: post.id, channel: post.channel }); res.status(201).json(post);
}));
// ---- AI usage and credits (Agentify's own Gemini connection, and what workspaces use)
r.get('/ai/usage', requireOperator, need('finance.view'), (_req, res) => res.json(aiu.report()));
r.get('/ai/settings', requireOperator, need('integrations.manage'), (_req, res) => res.json(aiu.settingsView()));
r.put('/ai/settings', requireOperator, need('integrations.manage'), asyncH(async (req, res) => { const v = await aiu.saveSettings(req.body || {}, req.operator.email); audit(req.operator.email, 'ai-settings-changed', { key_changed: !!req.body?.api_key && !/^•/.test(req.body.api_key) }); res.json(v); }));
r.delete('/ai/settings/key', requireOperator, need('integrations.manage'), (req, res) => { aiu.disconnect(); audit(req.operator.email, 'ai-key-removed', {}); res.json(aiu.settingsView()); });
r.put('/content/limits', requireOperator, need('system.manage'), asyncH((req, res) => { const l = cal.saveLimits(req.body || {}, req.operator.email); audit(req.operator.email, 'content-limits-changed', l); res.json(l); }));

r.get('/training-videos', requireOperator, need('system.view'), (_req, res) => res.json({ youtube: training.youtubeStatus(), rows: training.listVideos(), roles: training.roleNames(), categories: training.CATEGORIES, privacy: training.PRIVACY }));
r.get('/training-videos/youtube/connect', requireOperator, need('system.manage'), asyncH((req, res) => {
  if (training.youtubeStatus().state === 'not_configured') throw bad('Add the Google client ID and secret first (Integrations > Google).');
  const state = signState({ purpose: 'youtube', origin: mainOrigin(req), by: req.operator.email });
  res.json({ url: authorizeUrl('google', 'youtube', { state, redirect: redirectUri('google', req) }) });
}));
r.delete('/training-videos/youtube', requireOperator, need('system.manage'), (req, res) => { training.disconnect(); audit(req.operator.email, 'youtube-disconnected', {}); res.json({ ok: true }); });
r.post('/training-videos', requireOperator, need('system.manage'), videoUpload.single('file'), asyncH((req, res) => {
  if (!req.file) throw bad('Choose a video file (MP4, WebM or MOV)');
  const key = training.addUpload(req.file, req.body || {}, req.operator.email);
  audit(req.operator.email, 'training-video-added', { id: key });
  res.status(201).json({ key });
}));
r.put('/training-videos/:key', requireOperator, need('system.manage'), asyncH((req, res) => { training.updateVideo(req.params.key, req.body || {}); audit(req.operator.email, 'training-video-edited', { id: req.params.key }); res.json({ ok: true }); }));
r.post('/training-videos/:key/post', requireOperator, need('system.manage'), asyncH((req, res) => {
  training.startPost(req.params.key, { privacy: req.body?.privacy || 'unlisted' }, req.operator.email);
  audit(req.operator.email, 'training-video-posting', { id: req.params.key, privacy: req.body?.privacy || 'unlisted' });
  res.status(202).json({ ok: true });
}));
r.put('/training-videos/youtube/expected-channel', requireOperator, need('system.manage'), asyncH((req, res) => { training.setExpectedChannel(req.body?.channel_id, req.operator.email); audit(req.operator.email, 'youtube-expected-channel-set', {}); res.json({ ok: true }); }));
r.get('/training-videos/:key/file', requireOperator, need('system.manage'), asyncH((req, res) => {
  const f = training.fileOf(training.rowOf(req.params.key));
  if (!f) return res.status(404).json({ error: 'There is no server copy of this video' });
  audit(req.operator.email, 'training-video-downloaded', { id: req.params.key });
  res.download(f, `${req.params.key}${path.extname(f)}`);
}));
r.post('/training-videos/:key/link', requireOperator, need('system.manage'), asyncH((req, res) => { training.linkExisting(req.params.key, req.body?.url, req.operator.email); audit(req.operator.email, 'training-video-linked', { id: req.params.key }); res.json({ ok: true }); }));
r.delete('/training-videos/:key/youtube', requireOperator, need('system.manage'), asyncH((req, res) => { const out = training.unlink(req.params.key); audit(req.operator.email, 'training-video-unlinked', { id: req.params.key }); res.json({ ok: true, ...out }); }));
r.delete('/training-videos/:key/copy', requireOperator, need('system.manage'), asyncH((req, res) => { training.removeCopy(req.params.key); audit(req.operator.email, 'training-video-copy-deleted', { id: req.params.key }); res.json({ ok: true }); }));
r.delete('/training-videos/:key', requireOperator, need('system.manage'), asyncH((req, res) => { training.deleteVideo(req.params.key); audit(req.operator.email, 'training-video-deleted', { id: req.params.key }); res.json({ ok: true }); }));
r.get('/errors', requireOperator, need('system.view'), (_req, res) => res.json(recentErrors()));

// ---- Reports, exports and reconciliation
const canFn = (req) => (perm) => can(req.operator, perm);
r.get('/reports', requireOperator, need('self'), (req, res) => res.json({ reports: reportList(canFn(req)), can_export: can(req.operator, 'workspaces.export') }));
r.get('/reports/views', requireOperator, need('self'), (req, res) => res.json(savedViews(req.operator.id)));
r.post('/reports/views', requireOperator, need('self'), asyncH((req, res) => res.json(saveView(req.operator.id, req.body || {}))));
r.delete('/reports/views/:name', requireOperator, need('self'), (req, res) => res.json(deleteView(req.operator.id, req.params.name)));
r.get('/reports/:id', requireOperator, need('self'), asyncH((req, res) => res.json(runReport(req.params.id, req.query, req, canFn(req)))));
r.get('/reports/:id/export', requireOperator, need('workspaces.export'), asyncH(async (req, res) => {
  const rep = runReport(req.params.id, req.query, req, canFn(req));
  const file = await exportReport(rep, String(req.query.format || 'csv'));
  audit(req.operator.email, 'report-exported', { report: rep.id, format: req.query.format || 'csv', rows: rep.rows.length, from: rep.range.from, to: rep.range.to });
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.body);
}));
r.get('/reconciliation', requireOperator, need('billing.view'), (_req, res) => res.json(reconcile()));

// ---- Super admin accounts
r.get('/admins', requireOperator, need('admins.manage'), (req, res) => res.json({ me: req.operator.id ?? null, admins: listAdmins(), roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, { label: v.label, perms: v.perms }])), permissions: PERMISSIONS }));
r.patch('/admins/:id', requireOperator, need('admins.manage'), asyncH((req, res) => {
  adminOnly(req);
  const out = updateAdmin(req.params.id, req.body || {}, req.operator.id, req.operator);
  if (out.changed.length) audit(req.operator.email, 'admin-changed', { email: out.admin.email, from: out.before, to: { role: out.admin.role, active: out.admin.active }, reason: req.body?.reason });
  res.json(out.admin);
}));
r.post('/admins', requireOperator, need('admins.manage'), limiter, asyncH(async (req, res) => {
  adminOnly(req);
  // without a password the person is invited by email and chooses their own (recommended); with one, the account is ready at once
  if (!req.body?.password) {
    const inv = await inviteAdmin(req.body || {}, req.operator, `${req.protocol}://${req.get('host')}`);
    audit(req.operator.email, 'admin-invited', { email: inv.email, role: inv.role, emailed: inv.emailed });
    return res.status(201).json(inv);
  }
  const a = addAdmin(req.body || {}, req.operator);
  audit(req.operator.email, 'admin-added', { email: a.email, role: a.role });
  res.status(201).json(a);
}));
r.delete('/admins/:id', requireOperator, need('admins.manage'), asyncH((req, res) => {
  adminOnly(req);
  const gone = removeAdmin(req.params.id, req.operator.id, req.operator);
  audit(req.operator.email, 'admin-removed', { email: gone.email, id: gone.id });
  res.json({ ok: true });
}));

export default r;
