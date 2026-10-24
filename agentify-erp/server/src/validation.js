import { bad } from './util.js';

// A person's name: letters (any language), spaces and . ' ’ - , only, with at least one letter. No digits or symbols.
const NAME_RE = /^(?=.*\p{L})[\p{L}\p{M}][\p{L}\p{M}\s.'’\-,]*$/u;
// local@domain.tld: no spaces, no double dots, the domain needs a dot and an alphabetic ending
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export const isPersonName = (v) => typeof v === 'string' && v.trim().length <= 100 && NAME_RE.test(v.trim());
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && !v.includes('..') && EMAIL_RE.test(v.trim());

// keys that always hold a person's name
const NAME_KEYS = new Set(['full_name', 'first_name', 'last_name', 'father_name', 'customer_name', 'agent_name', 'contact_name', 'owner_name',
  'client_name', 'employee_name', 'admin_name', 'candidate', 'spouse_name', 'guardian_name', 'nominee_name', 'emergency_contact_name']);
// `name` is only a person on these routes (elsewhere it is a project, plan, lookup, ...)
const PERSON_NAME_PATHS = /^\/(settings\/(users|invites)|hrm\/employees|auth\/invite\/accept|staff\/me\/profile|agents)(\/|$)/;

const label = (k) => k.replace(/_/g, ' ');

function walk(node, path, depth) {
  if (!node || typeof node !== 'object' || depth > 3) return;
  if (Array.isArray(node)) { for (const n of node.slice(0, 200)) walk(n, path, depth + 1); return; }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') {
      const val = v.trim();
      if (!val) continue;
      if (k === 'email' || k.endsWith('_email')) {
        if (!isEmail(val)) throw bad('Please enter a valid email address, like name@example.com');
      } else if (NAME_KEYS.has(k) || (k === 'name' && depth === 0 && PERSON_NAME_PATHS.test(path))) {
        if (!isPersonName(val)) throw bad(`Please enter a valid ${k === 'name' ? 'name' : label(k)}: letters only, no numbers or symbols`);
      }
    } else if (v && typeof v === 'object') walk(v, path, depth + 1);
  }
}

/** Rejects saves that carry an invalid email address or a name containing digits/symbols, whichever screen or API sent them. */
export function validateInput(req, _res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  try { walk(req.body, req.path, 0); next(); } catch (e) { next(e); }
}
