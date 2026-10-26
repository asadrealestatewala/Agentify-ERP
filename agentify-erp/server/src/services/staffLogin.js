import { getSetting } from '../db.js';
import { bad } from '../util.js';

/** The unlisted address staff sign in from (the public website never links to it). /login keeps working. */
export const DEFAULT_STAFF_PATH = 'staff';
const RESERVED = new Set(['login', 'logout', 'signup', 'site', 'api', 'portal', 'vendor', 'forgot-password', 'reset-password', 'invite', 'uploads', 'assets', 'platform', 'sitemap.xml', 'robots.txt', 'downloads', 'manifest.json']);

export const staffLoginPath = () => getSetting('staff_login_path', '') || DEFAULT_STAFF_PATH;

/** Validates a path typed in Settings; returns the clean value (empty = back to the default). */
export function cleanStaffPath(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/^\/+/, '');
  if (!s) return '';
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s)) throw bad('The staff sign-in link must be 3 to 40 letters, numbers or hyphens');
  if (RESERVED.has(s)) throw bad('That address is already used by the app. Choose another one');
  return s;
}
