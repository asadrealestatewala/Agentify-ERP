// Who may use the platform admin console / operator API. Two ways in:
//   * a signed-in platform admin (cookie session, created from PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD on first start)
//   * the bearer token ERP_PLATFORM_ADMIN_TOKEN, for scripts
// Platform admins are a separate set of accounts from any workspace's users, and the console is only reachable on the
// platform's own domain, never on a customer's workspace address.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { platformDb, isMultiTenant, BASE_DOMAIN } from '../platform.js';
import { secretsKey, encrypt, decrypt } from './platformConfig.js';
import { newSecret, verifyCode, otpauthUrl, qrDataUrl, newRecoveryCodes, useRecoveryCode } from './totp.js';
import { HttpError, bad } from '../util.js';
import { setMfaRule } from './platformAccess.js';
import { checkPassword, ensureSetupToken } from './platformStaff.js';
import { sendMail, layout } from './mailer.js';

const SESSION_HOURS = 8;
const setting = (k) => platformDb().prepare('SELECT value FROM platform_settings WHERE key=?').get(k)?.value;
/** "Require two-factor for every console user" (Security settings). */
export const mfaRequired = () => setting('require_2fa') === '1';
setMfaRule(mfaRequired);

/** Every sign-in attempt is kept (never the password). Repeated failures and sign-ins from a new IP raise an alert. */
function recordLogin(a, email, outcome, meta = {}) {
  const db = platformDb();
  const e = String(email || '').trim().toLowerCase().slice(0, 200);
  db.prepare('INSERT INTO platform_logins(admin_id,email,outcome,ip,user_agent) VALUES(?,?,?,?,?)').run(a?.id ?? null, e, outcome, meta.ip || null, meta.ua || null);
  const alert = (dedupe, severity, title, body) => db.prepare("INSERT INTO platform_notifications(kind,severity,title,body,link,dedupe) VALUES('security',?,?,?,'/platform/security/logins',?) ON CONFLICT(dedupe) DO NOTHING").run(severity, title, body, dedupe);
  if (outcome !== 'success') {
    const n = db.prepare("SELECT COUNT(*) n FROM platform_logins WHERE email=? AND outcome<>'success' AND created_at>=datetime('now','-15 minutes')").get(e).n;
    if (n >= 5) alert(`login-fail:${e}:${new Date().toISOString().slice(0, 13)}`, 'critical', `${n} failed console sign-ins for ${e}`, `Last from ${meta.ip || 'unknown IP'} in the past 15 minutes`);
  } else if (meta.ip && db.prepare("SELECT 1 FROM platform_logins WHERE admin_id=? AND outcome='success' AND id<(SELECT MAX(id) FROM platform_logins) LIMIT 1").get(a.id)
    && !db.prepare("SELECT 1 FROM platform_logins WHERE admin_id=? AND outcome='success' AND ip=? AND id<(SELECT MAX(id) FROM platform_logins) LIMIT 1").get(a.id, meta.ip)) {
    alert(`new-ip:${a.id}:${meta.ip}`, 'warning', `${a.email} signed in from a new IP address`, `${meta.ip} · ${String(meta.ua || '').slice(0, 80)}`);
    // the console user hears about it too, by email, so a stolen password does not go unnoticed
    sendMail({ type: 'login_alert', to: a.email, subject: 'New sign-in to the Agentify console', ...layout({ brand: 'platform', heading: 'New sign-in to your console account',
      lines: [`Hi ${a.name}, your console account was just signed in from an address we have not seen before.`, `IP address: ${meta.ip}`, `Browser: ${String(meta.ua || 'unknown').slice(0, 120)}`, 'If this was not you, change your password in Security straight away and sign out other sessions.'] }) }).catch(() => {});
  }
}

export const COOKIE = 'platform_token';
const jwtSecret = () => crypto.createHmac('sha256', secretsKey()).update('platform-session').digest();

/**
 * First console account. Preferred: the one-time setup token (services/platformStaff.js, /platform/first-run).
 * Kept for existing deployments and automated tests: PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD create the Platform
 * Owner once when no console account exists; remove them from the environment afterwards.
 */
export function ensureFirstAdmin() {
  const email = process.env.PLATFORM_ADMIN_EMAIL, pw = process.env.PLATFORM_ADMIN_PASSWORD;
  const db = platformDb();
  if (db.prepare('SELECT 1 FROM platform_admins LIMIT 1').get()) return;
  if (email && pw) {
    if (pw.length < 10) { console.error('PLATFORM_ADMIN_PASSWORD must be at least 10 characters; no platform admin was created'); }
    else {
      db.prepare("INSERT INTO platform_admins(email,name,password_hash,role,activated_at) VALUES(?,?,?,'platform_owner',datetime('now'))").run(email.toLowerCase(), process.env.PLATFORM_ADMIN_NAME || 'Platform owner', bcrypt.hashSync(pw, 10));
      if (process.env.NODE_ENV !== 'test') console.warn('[setup] Platform Owner created from PLATFORM_ADMIN_EMAIL/PASSWORD. Remove these variables now and change the password in the console.');
      return;
    }
  }
  ensureSetupToken();
}

/** The console lives on the platform domain only (or anywhere in single-tenant mode). */
export function onPlatformHost(req) {
  if (!isMultiTenant()) return true;
  const h = String(req.hostname || '').toLowerCase();
  return h === BASE_DOMAIN || h === `www.${BASE_DOMAIN}`;
}

export function login(email, password, meta = {}) {
  const a = platformDb().prepare('SELECT * FROM platform_admins WHERE email=?').get(String(email || '').trim());
  // compare even when the account does not exist so timing does not reveal which emails are admins
  const ok = bcrypt.compareSync(String(password || ''), a?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!a || !ok || !a.active) { recordLogin(a, email, !a || !ok ? 'bad_password' : 'account_disabled', meta); throw new HttpError(401, 'Invalid credentials'); }
  if (a.totp_enabled) return { mfa_token: jwt.sign({ aid: a.id }, jwtSecret(), { expiresIn: '5m', audience: 'platform-mfa' }) };
  return issueSession(a, meta);
}

function issueSession(a, meta = {}) {
  const db = platformDb();
  const sid = crypto.randomBytes(18).toString('base64url');
  db.prepare("INSERT INTO platform_sessions(id,admin_id,ip,user_agent,expires_at) VALUES(?,?,?,?,datetime('now',?))").run(sid, a.id, meta.ip || null, meta.ua || null, `+${SESSION_HOURS} hours`);
  db.prepare("UPDATE platform_admins SET last_login=datetime('now') WHERE id=?").run(a.id);
  recordLogin(a, a.email, 'success', meta);
  return { admin: { id: a.id, email: a.email, name: a.name }, token: jwt.sign({ aid: a.id, tv: a.token_version, sid, aud: 'platform' }, jwtSecret(), { expiresIn: `${SESSION_HOURS}h` }) };
}

/** Second sign-in step: authenticator code or a one-time recovery code. */
export function loginMfa(mfaToken, code, meta = {}) {
  let aid;
  try { aid = jwt.verify(String(mfaToken || ''), jwtSecret(), { audience: 'platform-mfa' }).aid; } catch { throw new HttpError(401, 'This sign-in expired. Enter your password again.'); }
  const db = platformDb();
  const a = db.prepare('SELECT * FROM platform_admins WHERE id=? AND totp_enabled=1').get(aid);
  if (!a) throw new HttpError(401, 'This sign-in expired. Enter your password again.');
  const c = String(code || '').trim();
  const step = verifyCode(decrypt(a.totp_secret), c, a.totp_last_step);
  if (step) db.prepare('UPDATE platform_admins SET totp_last_step=? WHERE id=?').run(step, a.id);
  else {
    const left = useRecoveryCode(JSON.parse(a.recovery_codes || '[]'), c);
    if (!left) { recordLogin(a, a.email, 'mfa_failed', meta); throw new HttpError(401, 'That code is not right'); }
    db.prepare('UPDATE platform_admins SET recovery_codes=? WHERE id=?').run(JSON.stringify(left), a.id);
  }
  return issueSession(a, meta);
}

export const twofaStatus = (id) => { const a = platformDb().prepare('SELECT totp_enabled, recovery_codes FROM platform_admins WHERE id=?').get(id); return { enabled: !!a.totp_enabled, recovery_left: a.totp_enabled ? JSON.parse(a.recovery_codes || '[]').length : 0 }; };
export async function twofaSetup(admin) {
  const a = platformDb().prepare('SELECT totp_enabled FROM platform_admins WHERE id=?').get(admin.id);
  if (a.totp_enabled) throw bad('Two-factor sign-in is already on. Turn it off first to set it up again.');
  const secret = newSecret();
  platformDb().prepare('UPDATE platform_admins SET totp_secret=?, totp_last_step=0 WHERE id=?').run(encrypt(secret), admin.id);
  const url = otpauthUrl(secret, admin.email, 'Agentify ERP platform');
  return { secret, otpauth: url, qr: await qrDataUrl(url) };
}
export function twofaEnable(id, code) {
  const a = platformDb().prepare('SELECT * FROM platform_admins WHERE id=?').get(id);
  if (a.totp_enabled) throw bad('Two-factor sign-in is already on');
  if (!a.totp_secret) throw bad('Start the setup first');
  const step = verifyCode(decrypt(a.totp_secret), code);
  if (!step) throw bad('That code is not right. Check the time on your phone and try the next code.');
  const rc = newRecoveryCodes();
  platformDb().prepare('UPDATE platform_admins SET totp_enabled=1, totp_last_step=?, recovery_codes=? WHERE id=?').run(step, JSON.stringify(rc.hashes), id);
  return rc.codes;
}
export function twofaDisable(id, password, code) {
  const a = platformDb().prepare('SELECT * FROM platform_admins WHERE id=?').get(id);
  if (!a.totp_enabled) return;
  if (!bcrypt.compareSync(String(password || ''), a.password_hash)) throw new HttpError(403, 'Password is incorrect');
  const c = String(code || '').trim();
  if (!verifyCode(decrypt(a.totp_secret), c, a.totp_last_step) && !useRecoveryCode(JSON.parse(a.recovery_codes || '[]'), c)) throw new HttpError(403, 'That code is not right');
  platformDb().prepare('UPDATE platform_admins SET totp_enabled=0, totp_secret=NULL, recovery_codes=NULL WHERE id=?').run(id);
}

export function changePassword(adminId, current, next, meta = {}) {
  const a = platformDb().prepare('SELECT * FROM platform_admins WHERE id=?').get(adminId);
  if (!bcrypt.compareSync(String(current || ''), a.password_hash)) throw bad('Current password is incorrect');
  checkPassword(next, a.email);
  platformDb().prepare('UPDATE platform_admins SET password_hash=?, token_version=token_version+1 WHERE id=?').run(bcrypt.hashSync(String(next), 10), a.id);
  platformDb().prepare("UPDATE platform_sessions SET revoked_at=datetime('now'), revoked_by='password-change' WHERE admin_id=? AND revoked_at IS NULL").run(a.id);
  return issueSession(platformDb().prepare('SELECT * FROM platform_admins WHERE id=?').get(a.id), meta);
}

function sessionAdmin(req) {
  const tok = req.cookies?.[COOKIE];
  if (!tok) return null;
  try {
    const p = jwt.verify(tok, jwtSecret(), { audience: 'platform' });
    const db = platformDb();
    const a = db.prepare('SELECT id,email,name,token_version,role,active,totp_enabled FROM platform_admins WHERE id=?').get(p.aid);
    if (!a || !a.active || a.token_version !== p.tv || !p.sid) return null;
    // a tracked session: revoked or expired sessions stop working at once
    const sess = db.prepare("SELECT id, last_seen FROM platform_sessions WHERE id=? AND admin_id=? AND revoked_at IS NULL AND expires_at>datetime('now')").get(p.sid, a.id);
    if (!sess) return null;
    if (Date.now() - Date.parse(`${sess.last_seen.replace(' ', 'T')}Z`) > 60_000) db.prepare("UPDATE platform_sessions SET last_seen=datetime('now') WHERE id=?").run(sess.id);
    return { ...a, sid: sess.id };
  } catch { return null; }
}

/** Sets req.operator = { email, via }. 404 on a workspace address, 401 without credentials. */
export function requireOperator(req, _res, next) {
  if (!onPlatformHost(req)) return next(new HttpError(404, 'Not found'));
  const want = process.env.ERP_PLATFORM_ADMIN_TOKEN;
  const got = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (want && got) {
    const a = Buffer.from(got), b = Buffer.from(want);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) { req.operator = { email: 'api-token', via: 'token', role: 'super_admin' }; return next(); }
  }
  const admin = sessionAdmin(req);
  if (!admin) return next(new HttpError(401, 'Platform admin sign-in required'));
  // cookie sessions are subject to the same CSRF rule as the rest of the app
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'ERP') return next(new HttpError(403, 'CSRF check failed'));
  req.operator = { id: admin.id, email: admin.email, name: admin.name, via: 'session', role: admin.role, totp_enabled: !!admin.totp_enabled, sid: admin.sid };
  next();
}

// ---------------------------------------------------------------- sessions and sign-in history
export const loginMeta = (req) => ({ ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 200) });
export function endSession(sid, by = 'logout') {
  if (sid) platformDb().prepare("UPDATE platform_sessions SET revoked_at=datetime('now'), revoked_by=? WHERE id=? AND revoked_at IS NULL").run(by, sid);
}
/** Open sessions (all admins, or one). Session ids are never sent to the browser in full. */
export function listSessions(adminId = null) {
  const rows = platformDb().prepare(`SELECT s.id, s.admin_id, a.email, a.name, s.ip, s.user_agent, s.created_at, s.last_seen, s.expires_at FROM platform_sessions s JOIN platform_admins a ON a.id=s.admin_id
    WHERE s.revoked_at IS NULL AND s.expires_at>datetime('now') ${adminId ? 'AND s.admin_id=?' : ''} ORDER BY s.last_seen DESC`).all(...(adminId ? [adminId] : []));
  return rows.map((r) => ({ ...r, id: undefined, ref: r.id.slice(0, 8) }));
}
/** Revoke by the short reference shown in the console. Returns how many sessions ended. */
export function revokeSession(ref, { adminId = null, by } = {}) {
  const r = String(ref || '');
  if (r.length < 8) throw bad('Unknown session');
  return platformDb().prepare(`UPDATE platform_sessions SET revoked_at=datetime('now'), revoked_by=? WHERE substr(id,1,8)=? AND revoked_at IS NULL ${adminId ? 'AND admin_id=?' : ''}`).run(by || 'admin', r.slice(0, 8), ...(adminId ? [adminId] : [])).changes;
}
export function revokeAllFor(adminId, { exceptSid = null, by } = {}) {
  return platformDb().prepare("UPDATE platform_sessions SET revoked_at=datetime('now'), revoked_by=? WHERE admin_id=? AND revoked_at IS NULL AND id<>?").run(by || 'admin', adminId, exceptSid || '').changes;
}
export function loginHistory({ email, outcome, page = 0, per = 50 } = {}) {
  const where = [], args = [];
  if (email) { where.push('email LIKE ?'); args.push(`%${String(email).toLowerCase()}%`); }
  if (outcome === 'failed') where.push("outcome<>'success'"); else if (outcome === 'success') where.push("outcome='success'");
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const n = Math.min(200, Math.max(1, Number(per) || 50)), p = Math.max(0, Number(page) || 0);
  return { total: platformDb().prepare(`SELECT COUNT(*) n FROM platform_logins ${w}`).get(...args).n, rows: platformDb().prepare(`SELECT * FROM platform_logins ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, n, p * n) };
}
