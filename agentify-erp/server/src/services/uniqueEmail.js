// One email, one account. Inside a workspace every login lives in `users`, so an email can belong to exactly one login (and so one role);
// the people records that carry an email (employees, vendors, developers) must not repeat an address either, and must not use the
// address of a login that belongs to someone else. Matching ignores case and surrounding spaces.
import { all, get } from '../db.js';
import { bad } from '../util.js';

export const EMAIL_EXISTS = 'This email already exists. One email can belong to only one account, so use a different email address, or edit the existing account instead.';

/** The comparable form of an email: trimmed and lower-cased ('' when empty). */
export const normEmail = (e) => String(e ?? '').trim().toLowerCase();

const taken = () => bad(EMAIL_EXISTS, { code: 'email_exists', field: 'email' });

/** The login that already uses this email (not `exceptUserId`), or null. */
export function userWithEmail(email, exceptUserId = 0) {
  const e = normEmail(email);
  if (!e) return null;
  return get('SELECT u.id, u.name, u.role_id, u.contact_id, u.vendor_id, u.developer_id, r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(trim(u.email))=? AND u.id<>? LIMIT 1', e, Number(exceptUserId) || 0) || null;
}

/** Refuse an email that another login already uses. Empty emails pass (a login without an email uses a phone number). */
export function assertUserEmailFree(email, exceptUserId = 0) {
  if (userWithEmail(email, exceptUserId)) throw taken();
}

const TABLES = { employees: 'employee', vendors: 'vendor', developers: 'developer' };
const LINK = { employees: 'user_id', vendors: 'vendor_id', developers: 'developer_id' };

/**
 * Refuse a people-record email (employee, vendor, developer) that another record of the same kind already has, or that belongs to a login of
 * a different person. A staff login with the same address as an employee is the same person (that is how HR links them), so it is allowed;
 * any other login (customer, vendor, developer, or a staff login already linked to a different employee) is not.
 * `existing` is the saved row when editing, so a record never conflicts with itself or with its own login.
 */
export function assertRecordEmailFree(table, email, existing = null) {
  if (!TABLES[table]) throw new Error(`Unknown table ${table}`);
  const e = normEmail(email);
  if (!e) return;
  if (get(`SELECT 1 FROM ${table} WHERE lower(trim(email))=? AND id<>? LIMIT 1`, e, existing?.id ?? 0)) throw taken();
  // the login that belongs to this record (if any) is the same person, never a conflict
  let ownUserId = 0;
  if (existing) ownUserId = table === 'employees' ? Number(existing.user_id) || 0 : get(`SELECT id FROM users WHERE ${LINK[table]}=?`, existing.id)?.id || 0;
  const u = userWithEmail(e, ownUserId);
  if (!u) return;
  if (table === 'employees') {
    // an unlinked staff login is the person's own login-to-be; anything else belongs to someone else
    const staffLogin = !u.contact_id && !u.vendor_id && !u.developer_id && !get('SELECT portal FROM roles WHERE id=?', u.role_id)?.portal;
    if (staffLogin && !get('SELECT 1 FROM employees WHERE user_id=? AND id<>?', u.id, existing?.id ?? 0)) return;
  }
  throw taken();
}

/** Every email that more than one login (or more than one record of a kind) uses, for support to review. Nothing is changed or deleted. */
export function duplicateEmailReport() {
  const out = [];
  for (const [table, label] of [['users', 'login'], ...Object.entries(TABLES)]) {
    const rows = all(`SELECT lower(trim(email)) email, COUNT(*) n, GROUP_CONCAT(id) ids FROM ${table} WHERE email IS NOT NULL AND trim(email)<>'' GROUP BY lower(trim(email)) HAVING COUNT(*)>1 ORDER BY email`);
    for (const r of rows) out.push({ kind: label, email: r.email, count: r.n, ids: String(r.ids).split(',').map(Number) });
  }
  return out;
}
