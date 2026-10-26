// Consent evidence, suppression and unsubscribe tokens for tenant e-mail. Everything here runs inside a workspace
// (tenant database); nothing reads or writes another workspace's records.
//
// Rules: marketing mail needs a 'granted' consent record (latest row wins) and no live suppression. Operational mail needs
// no marketing consent but is still blocked by an 'all' suppression (hard bounce). Importing a contact never grants consent.
// This is a technical control; whether it satisfies a country's law is for the business and its lawyer to decide.
import crypto from 'node:crypto';
import { all, get, run, getSetting } from '../db.js';
import { currentTenant } from '../context.js';
import { secretsKey } from './platformConfig.js';
import { bad } from '../util.js';

export const lc = (e) => String(e || '').trim().toLowerCase();
export const isAddress = (e) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/.test(String(e || '').trim()) && String(e).length <= 254;
export const policyVersion = () => getSetting('email_policy_version', '') || '';

const optOutHooks = [];
/** Other modules (sequences) register to stop work when an address opts out or is suppressed. */
export const onOptOut = (fn) => { optOutHooks.push(fn); };
export const fireOptOut = (email, why) => { for (const h of optOutHooks) { try { h(email, why); } catch (e) { console.error('[email opt-out hook]', e.message); } } };

export function recordConsent({ email, contactId = null, status, source, purpose = 'marketing', text = null, senderId = null, actorId = null }) {
  const e = lc(email);
  if (!isAddress(e)) throw bad('That email address is not valid');
  if (!['granted', 'withdrawn'].includes(status)) throw bad('Consent status must be granted or withdrawn');
  if (!String(source || '').trim()) throw bad('Say where this consent came from (source)');
  run('INSERT INTO email_consents(email_lc,contact_id,purpose,status,source,policy_version,text,sender_id,actor_id) VALUES(?,?,?,?,?,?,?,?,?)', e, contactId, purpose, status, String(source).slice(0, 80), policyVersion() || null, text ? String(text).slice(0, 600) : null, senderId, actorId);
  // granting again after an unsubscribe lifts a marketing suppression that came from that unsubscribe, not one from a complaint or bounce
  if (status === 'granted') run("UPDATE email_suppressions SET removed_at=datetime('now'), removed_by=? WHERE email_lc=? AND scope='marketing' AND reason='unsubscribed' AND removed_at IS NULL", actorId, e);
  if (status === 'withdrawn') fireOptOut(e, 'consent_withdrawn');
}

export const latestConsent = (email, purpose = 'marketing') => get('SELECT * FROM email_consents WHERE email_lc=? AND purpose=? ORDER BY id DESC LIMIT 1', lc(email), purpose) || null;

export function suppress(email, { scope = 'marketing', reason, source = null, detail = null }) {
  const e = lc(email);
  if (!isAddress(e)) return false;
  const r = run('INSERT OR IGNORE INTO email_suppressions(email_lc,scope,reason,source,detail) VALUES(?,?,?,?,?)', e, scope, reason, source, detail ? String(detail).slice(0, 300) : null);
  // an 'all' suppression also covers promotional mail
  fireOptOut(e, reason);
  return r.changes > 0;
}
export function unsuppress(email, scope, actorId) {
  run("UPDATE email_suppressions SET removed_at=datetime('now'), removed_by=? WHERE email_lc=? AND scope=? AND removed_at IS NULL", actorId, lc(email), scope);
}
export const suppressionsFor = (email) => all('SELECT scope,reason,source,created_at FROM email_suppressions WHERE email_lc=? AND removed_at IS NULL', lc(email));

/** Can this address be mailed in this category right now? { ok, reason }. Pure reads of this workspace's records. */
export function eligibility(email, category) {
  const e = lc(email);
  if (!isAddress(e)) return { ok: false, reason: 'invalid_address' };
  const sup = suppressionsFor(e);
  if (sup.some((s) => s.scope === 'all')) return { ok: false, reason: 'suppressed' };
  if (category === 'marketing') {
    if (sup.some((s) => s.scope === 'marketing')) return { ok: false, reason: 'opted_out' };
    if (latestConsent(e)?.status !== 'granted') return { ok: false, reason: 'no_consent' };
  }
  return { ok: true };
}

// ---- unsubscribe tokens: signed, bound to the workspace and the address; no database lookup needed to verify
const sign = (payload) => crypto.createHmac('sha256', secretsKey()).update(`unsub:${payload}`).digest('base64url').slice(0, 22);
export function unsubscribeToken(email) {
  const t = currentTenant();
  const payload = Buffer.from(JSON.stringify({ t: t?.id ?? 0, e: lc(email) })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
/** The address a token unsubscribes, only when it was issued for the workspace handling this request. */
export function readUnsubscribeToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = sign(payload);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return p.t === (currentTenant()?.id ?? 0) && isAddress(p.e) ? p.e : null;
  } catch { return null; }
}

/** The public unsubscribe page/URL for an address in the current workspace. */
export function unsubscribeUrl(email, baseUrl) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/api/public/email/unsubscribe/${unsubscribeToken(email)}`;
}

/** Apply an opt-out: suppression, withdrawn consent, evidence. Idempotent. The queue is cleaned by tenantEmail.cancelFor. */
export function applyUnsubscribe(email, source = 'unsubscribe_link') {
  const e = lc(email);
  suppress(e, { scope: 'marketing', reason: 'unsubscribed', source });
  if (latestConsent(e)?.status !== 'withdrawn') run('INSERT INTO email_consents(email_lc,purpose,status,source,policy_version) VALUES(?,?,?,?,?)', e, 'marketing', 'withdrawn', source, policyVersion() || null);
  return e;
}
