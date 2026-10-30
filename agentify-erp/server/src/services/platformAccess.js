// Roles and permissions for super admin console users, and the request context the audit log records.
// Roles are fixed here (not editable in the UI) so a mistake in the console can never lock everyone out or widen access.
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError } from '../util.js';

export const PERMISSIONS = {
  'dashboard.view': 'See the dashboard, alerts and search',
  'finance.view': 'See revenue figures (MRR, ARR, collections, refunds) and financial reports',
  'analytics.view': 'See website analytics and conversion reports',
  'workspaces.view': 'See workspaces, their users and activity',
  'workspaces.create': 'Create workspaces',
  'workspaces.edit': 'Edit workspace profile, owner, notes and limits',
  'trials.manage': 'Extend, shorten, end or revoke free trials and activate workspaces by hand',
  'workspaces.suspend': 'Suspend, cancel or reactivate workspaces',
  'workspaces.support': 'Help workspace users sign in (reset links, 2FA, confirmations)',
  'workspaces.export': 'Export workspace and transaction lists',
  'billing.view': 'See payments, invoices, plans and subscription history',
  'billing.manage': 'Approve or record payments, refunds and change subscriptions',
  'billing.configure': 'Edit plans, prices, add-ons, coupons, Stripe keys and payment accounts',
  'content.manage': 'Edit the public website content, legal pages, announcements and release notes',
  'integrations.manage': 'Configure and test integrations (email, analytics, payments)',
  'system.view': 'See system health, setup, backups and errors',
  'system.manage': 'Run backups, switch maintenance mode and change platform settings',
  'audit.view': 'See the audit log, sign-in history and sessions',
  'regions.manage': 'Turn regions on or off, edit region packs, flags, rules and exchange rates',
  'regions.support': 'See regions, rules and exchange rates (read-only)',
  'admins.manage': 'Invite, change and remove console users and security rules',
  'content.calendar': 'Plan, schedule and record Agentify marketing posts in the Content calendar',
  'library.manage': 'Add, edit and retire items in the shared template library and see which workspaces replaced them',
  'mailbox.manage': 'Read, send and delete company e-mail (Mailbox) and see the sent log',
};
const ALL = Object.keys(PERMISSIONS);
const VIEW = ['dashboard.view', 'finance.view', 'workspaces.view', 'billing.view', 'system.view', 'regions.support'];
/**
 * Fixed roles (least privilege: give people the smallest role that fits). Platform Owner and Super Admin can do
 * everything; only a Platform Owner can make or remove another Platform Owner.
 */
export const ROLES = {
  platform_owner: { label: 'Platform Owner', perms: ALL },
  super_admin: { label: 'Super Admin', perms: ALL },
  platform_admin: { label: 'Platform Administrator', perms: ALL.filter((p) => p !== 'admins.manage' && p !== 'mailbox.manage') },
  billing_manager: { label: 'Billing Manager', perms: [...VIEW, 'billing.manage', 'trials.manage', 'workspaces.export'] },
  finance_admin: { label: 'Finance Administrator', perms: [...VIEW, 'billing.manage', 'billing.configure', 'trials.manage', 'workspaces.export'] },
  support_manager: { label: 'Support Manager', perms: ['dashboard.view', 'workspaces.view', 'billing.view', 'system.view', 'workspaces.create', 'workspaces.edit', 'trials.manage', 'workspaces.support'] },
  customer_success: { label: 'Customer Success Manager', perms: [...VIEW, 'workspaces.create', 'workspaces.edit', 'trials.manage', 'workspaces.support', 'workspaces.export'] },
  technical_admin: { label: 'Technical Administrator', perms: [...VIEW, 'system.manage', 'integrations.manage', 'workspaces.support', 'audit.view'] },
  security_auditor: { label: 'Security Auditor', perms: [...VIEW, 'audit.view', 'workspaces.export'] },
  analytics_viewer: { label: 'Analytics Viewer', perms: ['dashboard.view', 'finance.view', 'analytics.view'] },
  social_media_manager: { label: 'Social Media Manager', perms: ['content.calendar'] },
  read_only: { label: 'Read-Only Analyst', perms: VIEW },
};
/** Roles that hold every permission; at least one active account with one of them must always remain. */
export const TOP_ROLES = ['platform_owner', 'super_admin'];
export const permsOf = (role) => ROLES[role]?.perms || [];
export const can = (operator, perm) => operator?.via === 'token' || permsOf(operator?.role).includes(perm);
export const isOwner = (operator) => operator?.via === 'token' || operator?.role === 'platform_owner';
/** Who may grant or remove the Platform Owner role: an owner, or (on installs that have no owner yet, e.g. upgraded ones) a Super Admin. */
let ownerCount = () => 1;
export const setOwnerCounter = (fn) => { ownerCount = fn; };
export const mayManageOwners = (operator) => isOwner(operator) || (operator?.role === 'super_admin' && ownerCount() === 0);

// ---------------------------------------------------------------- request context for the audit log
export const auditCtx = new AsyncLocalStorage();
/** Express middleware: gives every console request an id (also sent back as X-Request-Id) and remembers who/where for audit rows. */
export function auditContext(req, res, next) {
  const rid = crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', rid);
  auditCtx.run({ rid, ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 200), req }, next);
}

let mfaRequired = () => false;
/** platformAuth registers how to read the "require two-factor" rule (kept there to avoid an import cycle). */
export const setMfaRule = (fn) => { mfaRequired = fn; };
/** What an admin without two-factor may still do while two-factor is required: see themselves and set it up. */
const MFA_EXEMPT = new Set(['self']);

/** Route guard: the signed-in admin's role must include `perm`. Denials are written to the audit log. */
export const need = (perm) => (req, _res, next) => {
  const op = req.operator;
  if (op?.via === 'session' && !MFA_EXEMPT.has(perm) && mfaRequired() && !op.totp_enabled) {
    return next(new HttpError(403, 'Two-factor sign-in is required for console users. Set it up under Security first.', { code: 'mfa_required' }));
  }
  if (perm === 'self' || can(op, perm)) return next();
  denied(op, perm, req);
  next(new HttpError(403, 'Your role does not allow this', { code: 'forbidden', permission: perm }));
};
let deniedHook = () => {};
export const onDenied = (fn) => { deniedHook = fn; };
const denied = (op, perm, req) => { try { deniedHook(op, perm, req); } catch { /* never block the response on logging */ } };
