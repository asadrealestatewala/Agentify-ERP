// Same rules as the server (server/src/validation.js): the server is the final check, these give instant feedback.
const NAME_RE = /^(?=.*\p{L})[\p{L}\p{M}][\p{L}\p{M}\s.'’\-,]*$/u;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export const isPersonName = (v) => NAME_RE.test(String(v).trim()) && String(v).trim().length <= 100;
export const isEmail = (v) => { const s = String(v).trim(); return s.length <= 254 && !s.includes('..') && EMAIL_RE.test(s); };

const NAME_KEYS = new Set(['full_name', 'first_name', 'last_name', 'father_name', 'customer_name', 'agent_name', 'contact_name', 'owner_name',
  'client_name', 'employee_name', 'admin_name', 'candidate', 'spouse_name', 'guardian_name', 'nominee_name', 'emergency_contact_name']);

/** Returns an error message for a field, or '' when it is fine (empty values are left to the "required" check). */
export function checkField(key, value, { person = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  if (key === 'email' || key.endsWith('_email')) return isEmail(value) ? '' : 'Enter a valid email address, like name@example.com';
  if (NAME_KEYS.has(key) || (person && key === 'name')) return isPersonName(value) ? '' : 'Use letters only: no numbers or symbols in a name';
  return '';
}
