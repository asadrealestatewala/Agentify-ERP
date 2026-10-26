// One-time email codes: proof that a person can read the mailbox they typed.
//   * signup: before a workspace is created, the owner enters the 6-digit code; the server hands back a single-use proof
//   * sign-in: an optional second step after the password (Security > Email sign-in code)
// Codes are 6 digits, valid 10 minutes, burned after 5 wrong guesses, and never stored: only an HMAC of the code (keyed with
// the server secret, so a copy of the database cannot be used to read or brute-force them). Sending is rate limited
// per address (cooldown and hourly cap); callers add a per-IP limiter on top.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { platformDb } from '../platform.js';
import { secretsKey } from './platformConfig.js';
import { sendMail, layout, mailReady } from './mailer.js';
import { HttpError, bad } from '../util.js';

export const CODE_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const RESEND_SECONDS = 30;
export const MAX_PER_HOUR = 5;

const hmac = (purpose, email, tenantId, code) => crypto.createHmac('sha256', secretsKey()).update(`otp|${purpose}|${email}|${tenantId ?? ''}|${code}`).digest('hex');
const norm = (e) => String(e || '').trim().toLowerCase();
const sql = (s) => platformDb().prepare(s);
const iso = (ms) => new Date(ms).toISOString();

/** Codes can only be emailed when a mail provider is saved; without one the code steps are skipped (see callers). */
export const canEmailCodes = () => mailReady();

/** Create and email a code. Throws a 429 with a plain message when asked too often. */
export async function sendCode({ purpose, email, tenantId = null, userId = null, ip = null, heading, intro, brand = 'platform' }) {
  const e = norm(email);
  purgeOldCodes();
  const key = [purpose, e, tenantId ?? null];
  const last = sql('SELECT created_at FROM email_otps WHERE purpose=? AND email=? AND tenant_id IS ? ORDER BY id DESC LIMIT 1').get(...key);
  if (last) {
    const wait = RESEND_SECONDS - Math.floor((Date.now() - Date.parse(last.created_at.replace(' ', 'T') + 'Z')) / 1000);
    if (wait > 0) throw new HttpError(429, `Please wait ${wait} seconds before asking for another code.`);
  }
  const hour = sql("SELECT COUNT(*) n FROM email_otps WHERE purpose=? AND email=? AND tenant_id IS ? AND created_at>=datetime('now','-1 hour')").get(...key).n;
  if (hour >= MAX_PER_HOUR) throw new HttpError(429, 'Too many codes were requested for this address. Try again in an hour.');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  sql('UPDATE email_otps SET used_at=datetime(\'now\') WHERE purpose=? AND email=? AND tenant_id IS ? AND used_at IS NULL').run(...key);
  sql('INSERT INTO email_otps(purpose,email,tenant_id,user_id,code_hash,ip,expires_at) VALUES(?,?,?,?,?,?,?)').run(purpose, e, tenantId, userId, hmac(purpose, e, tenantId, code), ip, iso(Date.now() + CODE_MINUTES * 60_000));
  const mail = layout({ brand, heading, lines: [intro, `Your code is ${code.slice(0, 3)} ${code.slice(3)}`, `It works once and expires in ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email: nobody can use it without access to your inbox.`] });
  const sent = await sendMail({ type: 'verification_code', to: e, subject: `${code} is your verification code`, ...mail });
  if (!sent) throw new HttpError(503, 'We could not send the email right now. Please try again in a minute.');
  return { cooldown: RESEND_SECONDS, expires_minutes: CODE_MINUTES };
}

/** Check a code. Wrong guesses are counted; the fifth burns the code. Returns the row (now used) or throws. */
export function checkCode({ purpose, email, tenantId = null, code }) {
  const e = norm(email);
  const row = sql('SELECT * FROM email_otps WHERE purpose=? AND email=? AND tenant_id IS ? AND used_at IS NULL ORDER BY id DESC LIMIT 1').get(purpose, e, tenantId);
  const expired = 'That code has expired or was already used. Ask for a new one.';
  if (!row || Date.parse(row.expires_at) < Date.now()) throw bad(expired);
  const given = String(code || '').replace(/\s+/g, '');
  const ok = /^\d{6}$/.test(given) && crypto.timingSafeEqual(Buffer.from(hmac(purpose, e, tenantId, given)), Buffer.from(row.code_hash));
  if (!ok) {
    const n = row.attempts + 1;
    sql(n >= MAX_ATTEMPTS ? "UPDATE email_otps SET attempts=?, used_at=datetime('now') WHERE id=?" : 'UPDATE email_otps SET attempts=? WHERE id=?').run(n, row.id);
    throw bad(n >= MAX_ATTEMPTS ? 'Too many wrong codes. Ask for a new one.' : `That code is not right. ${MAX_ATTEMPTS - n} ${MAX_ATTEMPTS - n === 1 ? 'try' : 'tries'} left.`);
  }
  // a concurrent request can race to use the same code; only one wins
  if (!sql("UPDATE email_otps SET used_at=datetime('now') WHERE id=? AND used_at IS NULL").run(row.id).changes) throw bad(expired);
  return row;
}

// ---- signup proof: a signed, single-use token saying "this address was confirmed"
const proofKey = () => crypto.createHmac('sha256', secretsKey()).update('signup-email-proof').digest();
export function signupProof(email, otpId) {
  return jwt.sign({ email: norm(email), jti: String(otpId) }, proofKey(), { expiresIn: '30m', audience: 'signup-email' });
}
/** Is this a good proof for this address that has not been used yet? */
export function signupProofValid(token, email) {
  let p;
  try { p = jwt.verify(String(token || ''), proofKey(), { audience: 'signup-email' }); } catch { return false; }
  return p.email === norm(email) && !!sql("SELECT 1 FROM email_otps WHERE id=? AND purpose='signup' AND attempts>=0").get(Number(p.jti));
}
/** Use the proof up (once the workspace exists), so one confirmed address cannot be reused for another signup. */
export function consumeSignupProof(token) {
  try { const p = jwt.verify(String(token || ''), proofKey(), { audience: 'signup-email' }); sql("UPDATE email_otps SET attempts=-1 WHERE id=? AND purpose='signup'").run(Number(p.jti)); } catch { /* nothing to use up */ }
}

/** Old codes are of no use after a day; called from the housekeeping that already runs. */
export const purgeOldCodes = () => sql("DELETE FROM email_otps WHERE created_at<datetime('now','-1 day')").run().changes;
