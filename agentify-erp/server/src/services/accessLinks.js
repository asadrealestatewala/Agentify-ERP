// One-time links for staff invitations and password resets. The token is shown once (in the email / to the inviting admin);
// only its SHA-256 hash is stored, so a copy of the database cannot be used to take over an account.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { all, get, run, tx, getSetting } from '../db.js';
import { now, bad, HttpError } from '../util.js';
import { sendMail, layout } from './mailer.js';
import { assertSeatAvailable } from './plans.js';
import { assertEmailAllowed } from './disposableEmail.js';

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const INVITE_DAYS = 7;
export const RESET_HOURS = 2;

const originOf = (req) => `${req.protocol}://${req.get('host')}`;
const company = () => getSetting('company_name', 'your company');

function issue(kind, fields, ttlMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = Number(run('INSERT INTO auth_tokens(kind,token_hash,user_id,email,name,role_id,invited_by,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    kind, hash(token), fields.userId ?? null, fields.email ?? null, fields.name ?? null, fields.roleId ?? null, fields.invitedBy ?? null,
    new Date(Date.now() + ttlMs).toISOString(), now()).lastInsertRowid);
  return { id, token };
}

/** The unused, unexpired token row, or null. Expired and used links look exactly like unknown ones. */
function lookup(kind, token) {
  if (!token || typeof token !== 'string') return null;
  const row = get('SELECT * FROM auth_tokens WHERE kind=? AND token_hash=? AND used_at IS NULL', kind, hash(token));
  return row && new Date(row.expires_at).getTime() > Date.now() ? row : null;
}

// ---- invitations
export async function createInvite(req, { email, name, roleId }) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('A valid email address is required');
  if (get('SELECT 1 FROM users WHERE lower(email)=?', e)) throw bad('A user with this email already exists');
  await assertEmailAllowed(e);
  if (!get('SELECT email_verified FROM users WHERE id=?', req.user.id)?.email_verified) throw bad('Confirm your own email address before inviting people (check your inbox, or resend the link from the banner)');
  assertSeatAvailable(req.tenant);
  // a fresh invite replaces any earlier pending one for the same address
  run("UPDATE auth_tokens SET used_at=? WHERE kind='invite' AND lower(email)=? AND used_at IS NULL", now(), e);
  const { id, token } = issue('invite', { email: e, name: String(name || '').trim() || null, roleId, invitedBy: req.user.id }, INVITE_DAYS * 864e5);
  const link = `${originOf(req)}/invite/${token}`;
  const role = get('SELECT name FROM roles WHERE id=?', roleId)?.name;
  const mail = layout({ heading: `Join ${company()} on the ERP`, lines: [`${req.user.name} invited you to ${company()} as ${role}.`, `This link works once and expires in ${INVITE_DAYS} days.`], button: { label: 'Accept invitation', url: link } });
  const sent = await sendMail({ type: 'invitation', to: e, subject: `${req.user.name} invited you to ${company()}`, ...mail });
  return { id, link, email_sent: sent, expires_in_days: INVITE_DAYS };
}

export function inviteInfo(token) {
  const t = lookup('invite', token);
  if (!t) throw new HttpError(404, 'This invitation is invalid or has expired. Ask your admin for a new one.');
  return { email: t.email, name: t.name, role: get('SELECT name FROM roles WHERE id=?', t.role_id)?.name, company: company() };
}

/** Create the user from an invitation. The caller signs them in. Returns the new user id. */
export function acceptInvite(token, { name, password }, tenant) {
  if (String(password || '').length < 8) throw bad('Password must be at least 8 characters');
  return tx(() => {
    const t = lookup('invite', token);
    if (!t) throw new HttpError(404, 'This invitation is invalid or has expired. Ask your admin for a new one.');
    if (get('SELECT 1 FROM users WHERE lower(email)=lower(?)', t.email)) throw bad('A user with this email already exists');
    assertSeatAvailable(tenant, { includeInvites: false }); // this invitation's own seat is already reserved
    const role = get('SELECT * FROM roles WHERE id=?', t.role_id);
    if (!role) throw bad('The role for this invitation no longer exists. Ask your admin for a new invitation.');
    const displayName = String(name || t.name || '').trim() || t.email.split('@')[0];
    const id = Number(run('INSERT INTO users(name,email,password_hash,role_id,created_at) VALUES(?,?,?,?,?)', displayName, t.email, bcrypt.hashSync(String(password), 10), t.role_id, now()).lastInsertRowid);
    run('UPDATE auth_tokens SET used_at=? WHERE id=?', now(), t.id);
    return id;
  });
}

// ---- password reset
/** Always resolves quietly: the response never reveals whether an address has an account. */
export async function requestPasswordReset(req, email) {
  const e = String(email || '').trim().toLowerCase();
  const u = e ? get('SELECT id,name FROM users WHERE lower(email)=? AND active=1', e) : null;
  if (!u) return;
  run("UPDATE auth_tokens SET used_at=? WHERE kind='reset' AND user_id=? AND used_at IS NULL", now(), u.id);
  const { token } = issue('reset', { userId: u.id, email: e }, RESET_HOURS * 3600e3);
  const mail = layout({ heading: 'Reset your password', lines: [`Hi ${u.name}, we received a request to reset your ${company()} password.`, `This link works once and expires in ${RESET_HOURS} hours. If you did not ask for it, ignore this email.`],
    button: { label: 'Choose a new password', url: `${originOf(req)}/reset-password/${token}` } });
  await sendMail({ type: 'password_reset', to: e, subject: 'Reset your password', ...mail });
}

/** Reset link created by a platform super admin for a user who is locked out. Earlier reset links stop working. */
export function adminResetLink(userId, email, hours = 24) {
  run("UPDATE auth_tokens SET used_at=? WHERE kind='reset' AND user_id=? AND used_at IS NULL", now(), userId);
  return issue('reset', { userId, email }, hours * 3600e3).token;
}

export function resetPassword(token, password) {
  if (String(password || '').length < 8) throw bad('New password must be at least 8 characters');
  return tx(() => {
    const t = lookup('reset', token);
    if (!t) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.');
    // signing out everywhere: bumping token_version invalidates every session issued before the reset
    run('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?', bcrypt.hashSync(String(password), 10), t.user_id);
    run('UPDATE auth_tokens SET used_at=? WHERE id=?', now(), t.id);
    return t.user_id;
  });
}

export const pendingInvites = () => all(`SELECT t.id,t.email,t.name,r.name role,t.expires_at,t.created_at,u.name invited_by FROM auth_tokens t
  LEFT JOIN roles r ON r.id=t.role_id LEFT JOIN users u ON u.id=t.invited_by WHERE t.kind='invite' AND t.used_at IS NULL AND t.expires_at>? ORDER BY t.id DESC`, new Date().toISOString());
export const revokeInvite = (id) => run("UPDATE auth_tokens SET used_at=? WHERE id=? AND kind='invite' AND used_at IS NULL", now(), id).changes > 0;

// ---- email confirmation (the workspace owner confirms the address they signed up with)
export const VERIFY_DAYS = 3;
/** A fresh confirmation token for the user (earlier ones stop working). The signup welcome email carries it directly. */
export function issueVerification(userId) {
  run('UPDATE verify_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL', now(), userId);
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO verify_tokens(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)', userId, hash(token), new Date(Date.now() + VERIFY_DAYS * 864e5).toISOString(), now());
  return token;
}
export async function sendVerification(req, userId, origin = originOf(req)) {
  const u = get('SELECT id,name,email FROM users WHERE id=?', userId);
  if (!u?.email) return false;
  const token = issueVerification(u.id);
  const mail = layout({ heading: 'Confirm your email address', lines: [`Hi ${u.name}, please confirm this address for ${company()}.`, `This link works once and expires in ${VERIFY_DAYS} days.`], button: { label: 'Confirm email', url: `${origin}/verify-email/${token}` } });
  return sendMail({ type: 'verification', to: u.email, subject: 'Confirm your email address', ...mail });
}
export function verifyEmail(token) {
  return tx(() => {
    const t = typeof token === 'string' ? get('SELECT * FROM verify_tokens WHERE token_hash=? AND used_at IS NULL', hash(token)) : null;
    if (!t || new Date(t.expires_at).getTime() < Date.now()) throw new HttpError(400, 'This confirmation link is invalid or has expired. Sign in and ask for a new one.');
    run('UPDATE users SET email_verified=1 WHERE id=?', t.user_id);
    run('UPDATE verify_tokens SET used_at=? WHERE id=?', now(), t.id);
    return t.user_id;
  });
}
