// Duplicate handling for inbound leads (runs inside a workspace).
// * The same enquiry arriving twice (double click, retry, two forms firing) is recorded once: a fingerprint of the person,
//   the form and the message is kept for a day and a repeat only counts up.
// * A shared phone or e-mail is NOT proof of the same person. When the names disagree the new enquiry becomes its own contact
//   and a review is opened, so a person decides; nothing is ever merged automatically.
// * Merging by a person moves every record to the kept contact (notes, activities, tasks, calls, appointments, attribution,
//   lead history, sequence enrolments) and keeps a snapshot of the merged contact so the action can be audited.
import crypto from 'node:crypto';
import { all, get, run, tx, db } from '../db.js';
import { activity } from '../audit.js';
import { bad, notFound, jparse } from '../util.js';
import { utc } from './leadFlow.js';

const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}]+/u).filter((w) => w.length > 1);
/** Do two names plausibly belong to one person? Shared word, an initial, or one name inside the other. */
export function namesCompatible(a, b) {
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return true; // nothing to compare: do not block the match
  if (x.some((w) => y.includes(w))) return true;
  const sx = x.join(''), sy = y.join('');
  if (sx.includes(sy) || sy.includes(sx)) return true;
  return x.some((w) => y.some((v) => (w.length === 1 || v.length === 1) && w[0] === v[0]));
}

/** One fingerprint per (person key, form, message) so a retry or double submit is recognised. */
export function inboundFingerprint({ phone, email, form, message, external_id }) {
  const digits = String(phone || '').replace(/\D/g, '');
  const who = digits.length >= 7 ? digits.slice(-10) : String(email || '').trim().toLowerCase();
  const body = external_id ? `ext:${external_id}` : String(message || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 500);
  return crypto.createHash('sha256').update(`${who}|${form || ''}|${body}`).digest('hex').slice(0, 32);
}
/** Is this a repeat inside the window? Records the first sight, counts a repeat. */
export function seenInbound(fp, contactId, { windowMs = 24 * 3600e3, atMs = Date.now() } = {}) {
  const row = get('SELECT * FROM lead_inbound_seen WHERE fingerprint=?', fp);
  if (row && atMs - Date.parse(row.first_at) < windowMs) { run('UPDATE lead_inbound_seen SET repeats=repeats+1 WHERE fingerprint=?', fp); return { contactId: row.contact_id }; }
  run('INSERT INTO lead_inbound_seen(fingerprint,contact_id,first_at,repeats) VALUES(?,?,?,0) ON CONFLICT(fingerprint) DO UPDATE SET contact_id=excluded.contact_id, first_at=excluded.first_at, repeats=0', fp, contactId ?? null, utc(atMs));
  run('DELETE FROM lead_inbound_seen WHERE first_at<?', utc(atMs - 7 * 24 * 3600e3));
  return null;
}
export const attachSeen = (fp, contactId) => run('UPDATE lead_inbound_seen SET contact_id=? WHERE fingerprint=?', contactId, fp);

export function flagReview(contactId, candidateId, reason) {
  if (contactId === candidateId) return null;
  const a = Math.min(contactId, candidateId), b = Math.max(contactId, candidateId);
  const r = run('INSERT OR IGNORE INTO duplicate_reviews(contact_id,candidate_id,reason,created_at) VALUES(?,?,?,?)', a, b, String(reason).slice(0, 200), utc());
  return r.changes ? Number(r.lastInsertRowid) : null;
}
export const listReviews = (status = 'pending') => all('SELECT d.*, a.full_name a_name, a.phone a_phone, a.email a_email, a.agent_id a_agent, b.full_name b_name, b.phone b_phone, b.email b_email, b.agent_id b_agent FROM duplicate_reviews d JOIN contacts a ON a.id=d.contact_id JOIN contacts b ON b.id=d.candidate_id WHERE d.status=? ORDER BY d.id DESC LIMIT 200', status);
export function dismissReview(id, user) {
  const r = get('SELECT * FROM duplicate_reviews WHERE id=?', id);
  if (!r) throw notFound('Review not found');
  run("UPDATE duplicate_reviews SET status='dismissed', decided_by=?, decided_at=? WHERE id=?", user?.id ?? null, utc(), id);
}

const columns = (t) => all(`PRAGMA table_info(${t})`).map((c) => c.name);
const tables = () => all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
/** Merge `mergedId` into `keptId` (explicit, by a person). Returns the counts moved per table. */
export function mergeContacts(keptId, mergedId, user) {
  if (keptId === mergedId) throw bad('Choose two different contacts');
  const kept = get('SELECT * FROM contacts WHERE id=?', keptId), gone = get('SELECT * FROM contacts WHERE id=?', mergedId);
  if (!kept || !gone) throw notFound('Contact not found');
  return tx(() => {
    const moved = {};
    for (const t of tables()) {
      if (t === 'contacts') continue;
      const cols = columns(t);
      if (cols.includes('contact_id')) { const r = db.prepare(`UPDATE OR IGNORE ${t} SET contact_id=? WHERE contact_id=?`).run(keptId, mergedId); if (r.changes) moved[t] = r.changes; }
      if (cols.includes('entity_type') && cols.includes('entity_id')) { const r = db.prepare(`UPDATE OR IGNORE ${t} SET entity_id=? WHERE entity_type='contact' AND entity_id=?`).run(keptId, mergedId); if (r.changes) moved[`${t}`] = (moved[t] || 0) + r.changes; }
    }
    // rows that would collide with a unique key stay on the merged contact: drop them with it
    run('DELETE FROM sequence_enrollments WHERE contact_id=?', mergedId);
    run('DELETE FROM duplicate_reviews WHERE contact_id=? OR candidate_id=?', mergedId, mergedId);
    run("UPDATE lead_inbound_seen SET contact_id=? WHERE contact_id=?", keptId, mergedId);
    // fill gaps on the kept contact; never overwrite what it already has
    const fill = {};
    for (const k of ['phone', 'alt_phone', 'whatsapp', 'email', 'cnic', 'city', 'address', 'lead_source']) if (!kept[k] && gone[k]) fill[k] = gone[k];
    if (Object.keys(fill).length) db.prepare(`UPDATE contacts SET ${Object.keys(fill).map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...Object.values(fill), keptId);
    run('INSERT INTO contact_merges(kept_id,merged_id,merged_snapshot,moved,actor_id,created_at) VALUES(?,?,?,?,?,?)', keptId, mergedId, JSON.stringify(gone), JSON.stringify(moved), user?.id ?? null, utc());
    run('DELETE FROM contacts WHERE id=?', mergedId);
    activity(keptId, user, 'Contacts merged', { detail: `${gone.full_name} (#${mergedId}) was merged into this contact. Their history was kept.` });
    return { kept_id: keptId, moved };
  });
}
export const mergeHistory = (contactId) => all('SELECT id,kept_id,merged_id,actor_id,created_at,moved FROM contact_merges WHERE kept_id=? ORDER BY id DESC', contactId).map((m) => ({ ...m, moved: jparse(m.moved, {}) }));
