import { bad } from './util.js';

// A person's name: letters (any language), spaces and . ' ’ - , only, with at least one letter. No digits or symbols.
const NAME_RE = /^(?=.*\p{L})[\p{L}\p{M}][\p{L}\p{M}\s.'’\-,]*$/u;
// local@domain.tld: no spaces, no double dots, the domain needs a dot and an alphabetic ending
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export const isPersonName = (v) => typeof v === 'string' && v.trim().length <= 100 && NAME_RE.test(v.trim());
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && !v.includes('..') && EMAIL_RE.test(v.trim());

// passwords that are tried first by anyone guessing; compared without case, spaces or a trailing ! . ?
const COMMON_PASSWORDS = new Set(('password password1 password12 password123 password1234 passw0rd 12345678 123456789 1234567890 123123123 11111111 00000000 '
  + '87654321 12341234 qwerty123 qwertyuiop qwerty12 asdfghjk asdf1234 abc12345 abcd1234 admin123 admin1234 administrator welcome1 welcome123 letmein1 '
  + 'iloveyou iloveyou1 pakistan pakistan1 pakistan123 karachi123 lahore123 islamabad sunshine princess football baseball superman trustno1 '
  + 'changeme changeme1 default1 test1234 testing1 agentify agentify1 agentify123 agentifyerp').split(' '));

/** Why a new password is not acceptable, or null when it is fine. At least 8 characters, not a well-known password, not the e-mail or name. */
export function passwordProblem(password, { email = '', name = '', label = 'Password' } = {}) {
  const p = String(password ?? '');
  if (p.length < 8) return `${label} must be at least 8 characters`;
  if (p.length > 200) return `${label} can be at most 200 characters`;
  const plain = p.toLowerCase().replace(/\s+/g, '').replace(/[!.?]+$/, '');
  if (COMMON_PASSWORDS.has(plain) || /^(.)\1+$/.test(plain)) return `${label} is too easy to guess. Choose something less common.`;
  const mail = String(email || '').trim().toLowerCase();
  if (mail && (plain === mail || plain === mail.split('@')[0])) return `${label} must not be your e-mail address`;
  const nm = String(name || '').toLowerCase().replace(/\s+/g, '');
  if (nm.length >= 4 && plain === nm) return `${label} must not be your name`;
  return null;
}

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
