import { stopSharing } from '../services/fieldLocation.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { all, get, run, getSetting, currentDb } from '../db.js';
import { signToken, signMfaToken, readMfaToken, loadUser, requireAuth } from '../rbac.js';
import { encrypt, decrypt } from '../services/platformConfig.js';
import { newSecret, verifyCode, otpauthUrl, qrDataUrl, newRecoveryCodes, useRecoveryCode } from '../services/totp.js';
import { audit } from '../audit.js';
import { asyncH, bad, HttpError, now } from '../util.js';
import { clientConfig } from '../regions/runtime.js';
import { PROVIDERS as OAUTH, authorizeUrl, redirectUri, signState, configuredProviders } from '../services/oauthApps.js';
import { redeemLoginCode } from '../services/oauthFlow.js';
import { currentTenant } from '../context.js';
import { liveConfig } from '../services/siteRelease.js';
import { staffLoginPath } from '../services/staffLogin.js';
import { requestPasswordReset, resetPassword, inviteInfo, acceptInvite, sendVerification, verifyEmail } from '../services/accessLinks.js';

const r = Router();
const loginLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.LOGIN_LIMIT) || 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Try again in a minute.' } });

const linkLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.LOGIN_LIMIT) || 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a minute.' } });

export const sessionPayload = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, portal: !!u.portal, own_scope: !!u.own_scope, isSuper: u.isSuper,
  contact_id: u.contact_id, vendor_id: u.vendor_id || null, email_verified: u.email_verified !== 0, totp_enabled: !!u.totp_enabled, perms: u.isSuper ? ['*'] : [...u.perms],
});

r.post('/login', loginLimiter, asyncH((req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) throw bad('Email/phone and password are required');
  const id = String(identifier).trim();
  const row = get('SELECT * FROM users WHERE (lower(email)=lower(?) OR phone=?) AND active=1', id, id);
  if (!row || !bcrypt.compareSync(String(password), row.password_hash)) {
    audit(req, 'Failed login', 'user', null, id);
    throw new HttpError(401, 'Invalid credentials');
  }
  const u = loadUser(row.id);
  if (req.body.portal && !u.portal) throw new HttpError(403, 'Use the staff login for this account');
  if (!req.body.portal && u.portal) throw new HttpError(403, 'Customers and vendors must use their portal login');
  if (u.totp_enabled) return res.json({ mfa_required: true, mfa_token: signMfaToken(u) });
  finishLogin(req, res, u);
}));

function finishLogin(req, res, u) {
  run('UPDATE users SET last_login=? WHERE id=?', now(), u.id);
  req.user = u;
  audit(req, 'Login', 'user', u.id, u.email);
  res.cookie('erp_token', signToken(u), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600 * 1000 });
  res.json(sessionPayload(u));
}

/** Second step of sign-in: an authenticator code, or one of the one-time recovery codes. */
r.post('/login/mfa', loginLimiter, asyncH((req, res) => {
  const uid = readMfaToken(req.body?.mfa_token);
  const row = uid && get('SELECT * FROM users WHERE id=? AND active=1 AND totp_enabled=1', uid);
  if (!row) throw new HttpError(401, 'This sign-in expired. Enter your password again.');
  const code = String(req.body?.code || '').trim();
  const step = verifyCode(decrypt(row.totp_secret), code, row.totp_last_step);
  if (step) run('UPDATE users SET totp_last_step=? WHERE id=?', step, row.id);
  else {
    const left = useRecoveryCode(JSON.parse(row.recovery_codes || '[]'), code);
    if (!left) { audit(req, 'Failed 2FA code', 'user', null, row.email); throw new HttpError(401, 'That code is not right'); }
    run('UPDATE users SET recovery_codes=? WHERE id=?', JSON.stringify(left), row.id);
    audit(req, 'Signed in with a recovery code', 'user', row.id, row.email);
  }
  finishLogin(req, res, loadUser(row.id));
}));

// ---- email confirmation
r.post('/verify-email', linkLimiter, asyncH((req, res) => { verifyEmail(req.body?.token); res.json({ ok: true }); }));
r.post('/resend-verification', requireAuth, linkLimiter, asyncH(async (req, res) => {
  await sendVerification(req, req.user.id);
  res.json({ ok: true });
}));

// ---- two-factor authentication (authenticator app) for staff accounts
const issuer = () => getSetting('company_name', '') || 'Agentify ERP';
r.get('/2fa', requireAuth, (req, res) => res.json({ enabled: !!req.user.totp_enabled, recovery_left: req.user.totp_enabled ? JSON.parse(get('SELECT recovery_codes FROM users WHERE id=?', req.user.id).recovery_codes || '[]').length : 0 }));
r.post('/2fa/setup', requireAuth, asyncH(async (req, res) => {
  if (req.user.portal) throw bad('Two-factor sign-in is for staff accounts');
  if (req.user.totp_enabled) throw bad('Two-factor sign-in is already on. Turn it off first to set it up again.');
  const secret = newSecret();
  run('UPDATE users SET totp_secret=?, totp_last_step=0 WHERE id=?', encrypt(secret), req.user.id);
  const url = otpauthUrl(secret, req.user.email, issuer());
  res.json({ secret, otpauth: url, qr: await qrDataUrl(url) });
}));
r.post('/2fa/enable', requireAuth, loginLimiter, asyncH((req, res) => {
  const row = get('SELECT totp_secret, totp_enabled FROM users WHERE id=?', req.user.id);
  if (row.totp_enabled) throw bad('Two-factor sign-in is already on');
  if (!row.totp_secret) throw bad('Start the setup first');
  const step = verifyCode(decrypt(row.totp_secret), req.body?.code);
  if (!step) throw bad('That code is not right. Check the time on your phone and try the next code.');
  const rc = newRecoveryCodes();
  run('UPDATE users SET totp_enabled=1, totp_last_step=?, recovery_codes=? WHERE id=?', step, JSON.stringify(rc.hashes), req.user.id);
  audit(req, 'Turned on two-factor sign-in', 'user', req.user.id);
  res.json({ ok: true, recovery_codes: rc.codes });
}));
r.post('/2fa/disable', requireAuth, loginLimiter, asyncH((req, res) => {
  const row = get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!row.totp_enabled) return res.json({ ok: true });
  if (!bcrypt.compareSync(String(req.body?.password || ''), row.password_hash)) throw new HttpError(403, 'Password is incorrect');
  const code = String(req.body?.code || '').trim();
  if (!verifyCode(decrypt(row.totp_secret), code, row.totp_last_step) && !useRecoveryCode(JSON.parse(row.recovery_codes || '[]'), code)) throw new HttpError(403, 'That code is not right');
  run('UPDATE users SET totp_enabled=0, totp_secret=NULL, recovery_codes=NULL WHERE id=?', req.user.id);
  audit(req, 'Turned off two-factor sign-in', 'user', req.user.id);
  res.json({ ok: true });
}));


/** Forgot password: always answers the same way so it cannot be used to find out who has an account. */
r.post('/forgot-password', linkLimiter, asyncH(async (req, res) => {
  await requestPasswordReset(req, req.body?.email);
  res.json({ ok: true });
}));
r.post('/reset-password', linkLimiter, asyncH((req, res) => {
  const uid = resetPassword(req.body?.token, req.body?.password);
  audit(Object.assign(Object.create(req), { user: { id: uid, name: 'User', role: 'self-service' } }), 'Password reset by email link', 'user', uid);
  res.json({ ok: true });
}));

/** Staff invitation: show who invited you, then accept by choosing a password (signs you in). */
r.get('/invite/:token', linkLimiter, (req, res) => res.json(inviteInfo(req.params.token)));
r.post('/invite/accept', linkLimiter, asyncH((req, res) => {
  const id = acceptInvite(req.body?.token, { name: req.body?.name, password: req.body?.password }, req.tenant);
  const u = loadUser(id);
  req.user = u;
  audit(req, 'Accepted invitation', 'user', u.id, u.email);
  res.cookie('erp_token', signToken(u), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600 * 1000 });
  res.status(201).json(sessionPayload(u));
}));

r.post('/logout', requireAuth, asyncH((req, res) => {
  audit(req, 'Logout', 'user', req.user.id);
  stopSharing(req.user.id); // signing out always ends location sharing
  res.clearCookie('erp_token');
  res.json({ ok: true });
}));

/** Public: the workspace's display name, so sign-in pages and the portals show the right company. */
/**
 * Demo sign-in shortcuts for this workspace: only the accounts that really exist here, are flagged as demo data and still
 * use the published demo password. Never offered in production.
 */
const demoCache = new WeakMap();
function demoLogins() {
  if (process.env.NODE_ENV === 'production') return [];
  const key = currentDb();
  const cached = demoCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.list;
  const list = all("SELECT u.email, r.name role, u.password_hash FROM users u JOIN roles r ON r.id=u.role_id WHERE u.is_demo=1 AND u.active=1 AND r.portal=0 AND u.email IS NOT NULL ORDER BY u.id")
    .filter((u) => bcrypt.compareSync('Demo@12345', u.password_hash)).map((u) => ({ role: u.role, email: u.email }));
  demoCache.set(key, { at: Date.now(), list });
  return list;
}
// region settings of this workspace (formats, units, terms, flags); the browser applies them before it renders any amount
r.get('/region', (_req, res) => res.json(clientConfig(currentTenant())));
r.get('/brand', (_req, res) => {
  const workspace = !!currentTenant();
  let logo = '';
  if (workspace) { try { logo = liveConfig().brand?.logo || ''; } catch { /* no website yet */ } }
  res.json({ name: getSetting('company_name', '') || 'Agentify ERP', demo_logins: demoLogins(), ...(ssoList().length ? { sso: ssoList() } : {}),
    // a company's own sign-in page: its brand and the unlisted staff link, never the product's marketing
    ...(workspace ? { workspace: true, logo, staff_path: staffLoginPath() } : {}) });
});

const ssoList = () => configuredProviders().filter((p) => ['google', 'apple'].includes(p));
// Sign in with Google / Apple: existing staff accounts only (no account is created here), and two-step sign-in still applies.
r.get('/sso/:provider/start', asyncH((req, res) => {
  const p = req.params.provider;
  if (!['google', 'apple'].includes(p) || !currentTenant()) throw bad('Unknown sign-in method');
  const state = signState({ purpose: 'login', tid: currentTenant().id, origin: `${req.protocol}://${req.get('host')}` });
  res.redirect(303, authorizeUrl(p, 'login', { state, redirect: redirectUri(p, req) }));
}));
r.post('/sso/exchange', loginLimiter, asyncH((req, res) => {
  const row = redeemLoginCode(req.body?.code, currentTenant()?.id);
  if (!row) throw new HttpError(401, 'This sign-in expired. Try again.');
  const u = loadUser(row.user_id);
  if (!u || u.portal) throw new HttpError(401, 'This account cannot sign in this way.');
  if (u.totp_enabled) return res.json({ mfa_required: true, mfa_token: signMfaToken(u) });
  audit(req, row.provider === 'signup' ? 'Signed in after creating the workspace' : 'Signed in with ' + row.provider, 'user', u.id, u.email);
  finishLogin(req, res, u);
}));

r.get('/me', requireAuth, (req, res) => res.json(sessionPayload(req.user)));

r.post('/change-password', requireAuth, asyncH((req, res) => {
  const { current, next } = req.body || {};
  const row = get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!bcrypt.compareSync(String(current || ''), row.password_hash)) throw bad('Current password is incorrect');
  if (!next || String(next).length < 8) throw bad('New password must be at least 8 characters');
  run('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?', bcrypt.hashSync(String(next), 10), req.user.id);
  audit(req, 'Changed password', 'user', req.user.id);
  const u = loadUser(req.user.id);
  res.cookie('erp_token', signToken(u), { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
  res.json({ ok: true });
}));

export default r;
