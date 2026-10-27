// Console (platform staff) accounts: password rules, email invitations and the one-time first-run bootstrap.
//
// First run: with no console account at all, the server creates a one-time setup token. Its SHA-256 hash is stored in
// platform_settings and the token itself is written to <ERP_DATA_DIR>/platform-setup-token.txt (readable only by the
// server's user) or printed by `npm run platform:setup-token`. Whoever can read that file (the person who installed the
// server) opens /platform/first-run, enters the token and chooses the owner's email and password. The token works once,
// expires after 24 hours and the setup endpoint closes for good as soon as any console account exists.
// No default username or password exists anywhere.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { platformDb } from '../platform.js';
import { DATA_DIR } from '../db.js';
import { ROLES, mayManageOwners } from './platformAccess.js';
import { sendMail, layout } from './mailer.js';
import { bad, HttpError } from '../util.js';

const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INVITE_HOURS = 72;
const SETUP_HOURS = 24;
export const SETUP_TOKEN_FILE = path.join(DATA_DIR, 'platform-setup-token.txt');

/** Console passwords: 10+ characters with at least three of lower case, upper case, digits and symbols. */
export function checkPassword(pw, email = '') {
  const p = String(pw || '');
  if (p.length < 10) throw bad('Password must be at least 10 characters');
  if (p.length > 200) throw bad('Password is too long');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
  if (classes < 3) throw bad('Use at least three of: lower-case letters, capitals, digits and symbols');
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && p.toLowerCase().includes(local)) throw bad('The password must not contain your email name');
  if (/^(.)\1+$/.test(p) || /password|qwerty|123456789/i.test(p)) throw bad('That password is too easy to guess');
  return p;
}

const setting = (k) => platformDb().prepare('SELECT value FROM platform_settings WHERE key=?').get(k)?.value;
const setSetting = (k, v) => platformDb().prepare("INSERT INTO platform_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(k, v);
const delSetting = (k) => platformDb().prepare('DELETE FROM platform_settings WHERE key=?').run(k);
export const hasAdmins = () => !!platformDb().prepare('SELECT 1 FROM platform_admins LIMIT 1').get();

// ---------------------------------------------------------------- first-run bootstrap
/** Is the first-run setup open (no console account yet)? */
export const setupNeeded = () => !hasAdmins();

/** Create (or replace) the one-time setup token. Returns the plain token; only its hash is kept in the database. */
export function issueSetupToken({ writeFile = true } = {}) {
  if (hasAdmins()) throw new HttpError(409, 'The platform already has an owner. Sign in to the console instead.');
  const token = crypto.randomBytes(24).toString('base64url');
  setSetting('setup_token_hash', sha(token));
  setSetting('setup_token_expires', new Date(Date.now() + SETUP_HOURS * 3600e3).toISOString());
  if (writeFile) {
    try {
      fs.mkdirSync(path.dirname(SETUP_TOKEN_FILE), { recursive: true });
      fs.writeFileSync(SETUP_TOKEN_FILE, `${token}\n`, { mode: 0o600 });
    } catch (e) { console.error('[setup] could not write the setup token file:', e.message); }
  }
  return token;
}

/** On start-up: if no console account exists and no valid token is pending, create one and say where it is (never the token). */
export function ensureSetupToken() {
  if (hasAdmins()) { clearSetupToken(); return null; }
  const exp = setting('setup_token_expires');
  const fileOk = fs.existsSync(SETUP_TOKEN_FILE);
  if (!setting('setup_token_hash') || !exp || Date.parse(exp) < Date.now() || !fileOk) issueSetupToken();
  console.log(`[setup] No platform owner yet. Open /platform/first-run on the main domain and enter the one-time token from ${SETUP_TOKEN_FILE} (or run "npm run platform:setup-token" on the server).`);
  return SETUP_TOKEN_FILE;
}

function clearSetupToken() {
  if (setting('setup_token_hash')) { delSetting('setup_token_hash'); delSetting('setup_token_expires'); }
  try { fs.rmSync(SETUP_TOKEN_FILE, { force: true }); } catch { /* already gone */ }
}

/** Create the Platform Owner with the setup token. Works once; afterwards the endpoint is closed. */
export function completeSetup({ token, email, name, password }) {
  if (hasAdmins()) throw new HttpError(410, 'Setup is already complete. Sign in to the console.');
  const want = setting('setup_token_hash'), exp = setting('setup_token_expires');
  const got = sha(String(token || '').trim());
  const ok = want && exp && Date.parse(exp) > Date.now() && want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
  if (!ok) throw new HttpError(403, 'The setup token is not valid or has expired. Run "npm run platform:setup-token" on the server for a new one.');
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw bad('A valid email is required');
  checkPassword(password, e);
  const db = platformDb();
  db.exec('BEGIN IMMEDIATE');
  let id;
  try {
    if (db.prepare('SELECT 1 FROM platform_admins LIMIT 1').get()) throw new HttpError(410, 'Setup is already complete. Sign in to the console.');
    id = Number(db.prepare("INSERT INTO platform_admins(email,name,password_hash,role,activated_at) VALUES(?,?,?,'platform_owner',datetime('now'))")
      .run(e, String(name || '').trim().slice(0, 80) || 'Platform owner', bcrypt.hashSync(String(password), 10)).lastInsertRowid);
    db.exec('COMMIT');
  } catch (x) { db.exec('ROLLBACK'); throw x; }
  clearSetupToken();
  return { id, email: e };
}

// ---------------------------------------------------------------- invitations
/**
 * Invite a console user by email. The account exists straight away (so the role is visible) but cannot sign in until
 * the person opens the link and chooses their own password. Only the token's hash is stored; links expire after 72 hours.
 */
export async function inviteAdmin({ email, name, role = 'read_only' }, operator, origin) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw bad('A valid email is required');
  if (!ROLES[role]) throw bad(`Role must be one of: ${Object.keys(ROLES).join(', ')}`);
  if (role === 'platform_owner' && !mayManageOwners(operator)) throw new HttpError(403, 'Only a Platform Owner can grant, change or remove the Platform Owner role');
  const db = platformDb();
  const existing = db.prepare('SELECT * FROM platform_admins WHERE email=?').get(e);
  if (existing && (existing.activated_at || !existing.invite_expires_at)) throw new HttpError(409, 'A console user with this email already exists');
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + INVITE_HOURS * 3600e3).toISOString();
  // an unusable password until the invitation is accepted
  const unusable = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  let id;
  if (existing) {
    db.prepare('UPDATE platform_admins SET name=?, role=?, invite_token_hash=?, invite_expires_at=?, invited_by=?, active=1 WHERE id=?').run(String(name || existing.name).trim().slice(0, 80) || existing.name, role, sha(token), expires, operator?.email || null, existing.id);
    id = existing.id;
  } else {
    id = Number(db.prepare('INSERT INTO platform_admins(email,name,password_hash,role,invite_token_hash,invite_expires_at,invited_by) VALUES(?,?,?,?,?,?,?)')
      .run(e, String(name || '').trim().slice(0, 80) || 'Console user', unusable, role, sha(token), expires, operator?.email || null).lastInsertRowid);
  }
  const link = `${origin}/platform/accept-invite/${token}`;
  const mail = layout({ brand: 'platform', heading: 'You have been invited to the Agentify ERP console', lines: [`${operator?.name || operator?.email || 'A platform administrator'} invited you as ${ROLES[role].label}.`, `The link works once and expires in ${INVITE_HOURS} hours. You will choose your own password.`], button: { label: 'Accept invitation', url: link } });
  const sent = await sendMail({ type: 'invitation', to: e, subject: 'Your Agentify ERP console invitation', ...mail });
  // without an email provider the inviting admin is shown the link to pass on securely (it is never written to the audit log)
  return { id, email: e, role, expires_at: expires, emailed: !!sent, link: sent ? undefined : link };
}

function inviteRow(token) {
  if (!token || typeof token !== 'string') return null;
  const a = platformDb().prepare('SELECT * FROM platform_admins WHERE invite_token_hash=? AND activated_at IS NULL').get(sha(token));
  return a && a.active && Date.parse(a.invite_expires_at) > Date.now() ? a : null;
}
export function inviteInfo(token) {
  const a = inviteRow(token);
  if (!a) throw new HttpError(404, 'This invitation link is not valid or has expired. Ask for a new one.');
  return { email: a.email, name: a.name, role: ROLES[a.role]?.label || a.role };
}
export function acceptInvite({ token, name, password }) {
  const a = inviteRow(token);
  if (!a) throw new HttpError(404, 'This invitation link is not valid or has expired. Ask for a new one.');
  checkPassword(password, a.email);
  platformDb().prepare("UPDATE platform_admins SET password_hash=?, name=?, invite_token_hash=NULL, activated_at=datetime('now'), token_version=token_version+1 WHERE id=?")
    .run(bcrypt.hashSync(String(password), 10), String(name || a.name).trim().slice(0, 80) || a.name, a.id);
  return { id: a.id, email: a.email };
}

// ---------------------------------------------------------------- forgotten password
export const RESET_MINUTES = 30;
const RESET_GAP_SECONDS = 60;

/**
 * "Forgot password" on the console sign-in. Always looks the same to the caller: it never says whether the email belongs to
 * a console account. For an active, activated account it stores the hash of a fresh one-time token (30 minutes) and emails
 * the link. A new request replaces the previous link; requests for one account closer than a minute apart are ignored.
 * Two-factor sign-in is not touched: after the reset the person still needs their authenticator code.
 */
export async function requestPasswordReset(email, origin, meta = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 200) return;
  const db = platformDb();
  const a = db.prepare('SELECT * FROM platform_admins WHERE email=? AND active=1 AND invite_token_hash IS NULL').get(e);
  if (!a) return;
  if (a.reset_sent_at && Date.now() - Date.parse(`${a.reset_sent_at.replace(' ', 'T')}Z`) < RESET_GAP_SECONDS * 1000) return;
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare("UPDATE platform_admins SET reset_token_hash=?, reset_expires_at=?, reset_sent_at=datetime('now') WHERE id=?")
    .run(sha(token), new Date(Date.now() + RESET_MINUTES * 60e3).toISOString(), a.id);
  const mail = layout({ brand: 'platform', heading: 'Reset your console password', lines: [
    `Hi ${a.name}, someone asked to reset the password of your Agentify console account.`,
    `The link works once and expires in ${RESET_MINUTES} minutes. If you did not ask for this, ignore this email; your password stays as it is.`,
    ...(meta.ip ? [`Requested from IP address ${meta.ip}.`] : [])], button: { label: 'Choose a new password', url: `${origin}/platform/reset-password/${token}` } });
  await sendMail({ type: 'password_reset', to: a.email, subject: 'Reset your Agentify console password', ...mail });
}

function resetRow(token) {
  if (!token || typeof token !== 'string') return null;
  const a = platformDb().prepare('SELECT * FROM platform_admins WHERE reset_token_hash=?').get(sha(token));
  return a && a.active && Date.parse(a.reset_expires_at) > Date.now() ? a : null;
}
export function resetInfo(token) {
  const a = resetRow(token);
  if (!a) throw new HttpError(404, 'This reset link is not valid or has expired. Ask for a new one.');
  return { email: a.email };
}
/** Sets the new password, ends every session and uses up the link. Authenticator (2FA) settings stay as they are. */
export function completePasswordReset({ token, password }) {
  const a = resetRow(token);
  if (!a) throw new HttpError(404, 'This reset link is not valid or has expired. Ask for a new one.');
  checkPassword(password, a.email);
  const db = platformDb();
  db.prepare('UPDATE platform_admins SET password_hash=?, token_version=token_version+1, reset_token_hash=NULL, reset_expires_at=NULL WHERE id=?').run(bcrypt.hashSync(String(password), 10), a.id);
  db.prepare("UPDATE platform_sessions SET revoked_at=datetime('now'), revoked_by='password-reset' WHERE admin_id=? AND revoked_at IS NULL").run(a.id);
  return { id: a.id, email: a.email };
}
