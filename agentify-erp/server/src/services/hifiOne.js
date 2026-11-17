// Hifi One connection: Hifi One (the reseller and partner ERP) reads a short status line for every workspace, so its
// partners and sales agents see which of their clients are live, overdue or suspended. Only counts and dates leave here:
// workspace name, billing status, plan, paid-until date, active staff and last activity. No customer, lead or sale records.
// The key is made in the platform console (Integrations), shown once, and stored only as a SHA-256 hash.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { listTenants, withTenant } from '../platform.js';
import { val } from '../db.js';
import { billingState } from './plans.js';
import { getSetting, setSetting, audit } from './platformConfig.js';

const KEY = 'hifi_one_key';
export const PREFIX = 'agt_hifi_';
export const PAGE = 500;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** What the console may show: whether a key exists, its last 4 characters, who made it and when. Never the key. */
export function keyState() {
  const raw = getSetting(KEY);
  if (!raw) return { set: false };
  try { const k = JSON.parse(raw); return { set: true, hint: k.tail, by: k.by || null, created_at: k.at || null, last_read_at: getSetting(`${KEY}_read`) || null }; } catch { return { set: false }; }
}

/** Make (or replace) the key. Returns the key once; only its hash is kept. Replacing it stops the old key at once. */
export function makeKey(by) {
  const key = PREFIX + crypto.randomBytes(24).toString('base64url');
  setSetting(KEY, JSON.stringify({ hash: sha(key), tail: key.slice(-4), by: by || null, at: new Date().toISOString() }), { by });
  audit(by, 'hifi-one-key-made', null);
  return { key, ...keyState() };
}

export function removeKey(by) {
  setSetting(KEY, null, { by });
  setSetting(`${KEY}_read`, null, { by });
  audit(by, 'hifi-one-key-removed', null);
  return keyState();
}

/** Constant-time check of a Bearer key against the stored hash. */
export function keyOk(given) {
  const raw = getSetting(KEY);
  if (!raw || !given || !String(given).startsWith(PREFIX)) return false;
  let hash;
  try { hash = JSON.parse(raw).hash; } catch { return false; }
  const a = Buffer.from(sha(given), 'hex'), b = Buffer.from(String(hash || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Hifi One's five status words, from this platform's billing state. */
export function hifiStatus(state) {
  switch (state) {
    case 'active': return 'LIVE';
    case 'past_due': return 'OVERDUE';
    case 'suspended': case 'expired': return 'SUSPENDED';
    case 'canceled': return 'CANCELLED';
    default: return 'TRIAL'; // trialing, pending
  }
}

/** Workspace rows store wall-clock time in the workspace's timezone; Hifi One needs real instants. */
function toUtc(local, tz) {
  if (!local) return null;
  const asUtc = Date.parse(`${String(local).replace(' ', 'T').slice(0, 19)}Z`);
  if (!Number.isFinite(asUtc)) return null;
  const offset = Date.parse(`${new Date(asUtc).toLocaleString('sv-SE', { timeZone: tz || 'Asia/Karachi' }).replace(' ', 'T')}Z`) - asUtc;
  return new Date(asUtc - offset).toISOString();
}
const dayOnly = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);

/** One workspace's line. Counts only. */
export function workspaceLine(t) {
  const st = billingState(t);
  const line = { id: t.slug, name: t.name || t.slug, status: hifiStatus(st.status), plan: st.plan || null,
    paidUntil: st.status === 'trialing' ? dayOnly(st.trial_ends_at) : dayOnly(st.period_end), activeUsers: null, lastActivityAt: null };
  try {
    if (t.db_path && fs.existsSync(t.db_path)) {
      withTenant(t, () => {
        line.activeUsers = val('SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 AND COALESCE(u.is_demo,0)=0');
        const lastLogin = val('SELECT MAX(last_login) FROM users');
        const lastAudit = val('SELECT MAX(created_at) FROM audit_log');
        line.lastActivityAt = toUtc([lastLogin, lastAudit].filter(Boolean).sort().pop(), t.timezone);
      });
    }
  } catch { /* a workspace that cannot be opened still reports its billing status */ }
  return line;
}

/** One page of the summary, 500 workspaces at a time. Erased workspaces and the original (legacy) one are left out. */
export function summary(offset = 0) {
  const start = Math.max(0, Number.parseInt(offset, 10) || 0);
  const all = listTenants().filter((t) => !t.is_legacy && !t.data_deleted_at);
  const page = all.slice(start, start + PAGE).map(workspaceLine);
  setSetting(`${KEY}_read`, new Date().toISOString());
  return { reportedAt: new Date().toISOString(), workspaces: page, next: start + PAGE < all.length ? String(start + PAGE) : null };
}
