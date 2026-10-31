import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { get, all, DATA_DIR } from './db.js';
import { HttpError, forbidden } from './util.js';
import { currentTenant } from './context.js';

export const MODULES = ['dashboard', 'crm', 'sales', 'commissions', 'properties', 'projects', 'customers', 'payments', 'accounting',
  'vendors', 'hrm', 'reports', 'settings', 'documents', 'website', 'content', 'listings', 'seo', 'construction', 'developers'];
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'print'];

function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(DATA_DIR, '.jwt-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'));
  return fs.readFileSync(f, 'utf8');
}
const SECRET = secret();

/** The token is bound to the tenant that issued it (`tid`), so it is useless on any other workspace. */
export const signToken = (user) => jwt.sign({ uid: user.id, tv: user.token_version, tid: currentTenant()?.id ?? null }, SECRET, { expiresIn: '12h' });

/** Short-lived proof that the password step passed, for accounts that still owe a 2FA code. It is not a session: it carries no `tv`. */
export const signMfaToken = (user) => jwt.sign({ uid: user.id, tid: currentTenant()?.id ?? null }, SECRET, { expiresIn: '5m', audience: 'mfa' });
/** Between the password and the emailed code at sign-in (services/emailOtp.js). */
export const signOtpToken = (user) => jwt.sign({ uid: user.id, tid: currentTenant()?.id ?? null }, SECRET, { expiresIn: '15m', audience: 'login-otp' });
export function readOtpToken(tok) {
  try { const p = jwt.verify(String(tok || ''), SECRET, { audience: 'login-otp' }); return p.tid === (currentTenant()?.id ?? null) ? p.uid : null; } catch { return null; }
}
export function readMfaToken(tok) {
  try { const p = jwt.verify(String(tok || ''), SECRET, { audience: 'mfa' }); return p.tid === (currentTenant()?.id ?? null) ? p.uid : null; } catch { return null; }
}

export function loadUser(id) {
  const u = get(`SELECT u.id,u.name,u.email,u.phone,u.role_id,u.contact_id,u.vendor_id,u.developer_id,u.active,u.token_version,u.email_verified,u.totp_enabled,
    r.name role, r.own_scope, r.portal FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`, id);
  if (!u) return null;
  u.perms = new Set(all('SELECT module,action FROM role_permissions WHERE role_id=?', u.role_id).map((p) => `${p.module}:${p.action}`));
  u.isSuper = u.role === 'Super Admin';
  return u;
}

/** Populate req.user from cookie or Bearer token. */
export function authenticate(req, _res, next) {
  const hdr = req.headers.authorization;
  const tok = (hdr && hdr.startsWith('Bearer ') ? hdr.slice(7) : null) || req.cookies?.erp_token;
  if (tok) {
    try {
      const p = jwt.verify(tok, SECRET);
      if ((p.tid ?? null) !== (currentTenant()?.id ?? null)) throw new Error('token belongs to another workspace');
      const u = loadUser(p.uid);
      if (u && u.active && u.token_version === p.tv) req.user = u;
    } catch { /* invalid token => anonymous */ }
  }
  next();
}

/** CSRF guard for cookie-authenticated state-changing requests. */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers.authorization || req.path.startsWith('/public/') || req.path === '/payment-feed') return next(); // key-authenticated webhook, no cookies
  if (req.headers['x-requested-with'] !== 'ERP') return next(new HttpError(403, 'CSRF check failed'));
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  next();
}
export function requireStaff(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (req.user.portal) return next(forbidden('Customer accounts cannot access the ERP'));
  next();
}
export function requirePortal(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (!req.user.portal || !req.user.contact_id) return next(forbidden('Portal access only'));
  next();
}

/** Vendor portal accounts: a portal login that is tied to one vendor record (never to a customer). */
export function requireVendor(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (!req.user.portal || !req.user.vendor_id) return next(forbidden('Vendor portal access only'));
  next();
}

/** Developer partner portal accounts: a portal login tied to one developer record. The developer id always comes from the session. */
export function requireDeveloper(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (!req.user.portal || !req.user.developer_id) return next(forbidden('Developer portal access only'));
  next();
}

export const hasPerm = (user, module, action) => !!user && !user.portal && (user.isSuper || user.perms.has(`${module}:${action}`));

export const can = (module, action = 'view') => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (!hasPerm(req.user, module, action)) return next(forbidden(`You do not have permission to ${action} ${module}`));
  next();
};

/** Row restriction for roles with own_scope (sales agents). Returns agent user id or null for unrestricted. */
export const ownerId = (req) => (req.user.own_scope ? req.user.id : null);
