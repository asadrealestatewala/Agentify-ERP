// Privacy tools for one person (a contact): export everything held about them, or erase their personal details.
// Financial records (sales, receipts, vouchers) are kept because accounting and tax law usually requires it, but they are
// detached from the person's identity. What a region's law requires is a legal-review item (see docs/multi-region).
import fs from 'node:fs';
import { removeRef } from '../services/storage.js';
import path from 'node:path';
import { Router } from 'express';
import { all, get, run, uploadDir } from '../db.js';
import { audit } from '../audit.js';
import { asyncH, bad, notFound, forbidden, now } from '../util.js';
import { listIdentities } from './identity.js';

const r = Router();
const adminOnly = (req, _res, next) => (req.user?.isSuper ? next() : next(forbidden('Only an administrator can export or erase personal data')));
const exists = (t) => !!get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", t);
const rows = (t, col, id) => (exists(t) ? all(`SELECT * FROM ${t} WHERE ${col}=?`, id) : []);

export function exportPerson(contactId) {
  const contact = get('SELECT * FROM contacts WHERE id=?', contactId);
  if (!contact) return null;
  const documents = rows('documents', 'entity_id', contactId).filter((d) => d.entity_type === 'contact');
  return {
    exported_at: now(), contact,
    activities: rows('activities', 'contact_id', contactId),
    notes: rows('notes', 'entity_id', contactId).filter((n) => n.entity_type === 'contact'),
    tasks: rows('tasks', 'entity_id', contactId).filter((t) => t.entity_type === 'contact'),
    documents: documents.map(({ id, name, category, mime, size, created_at }) => ({ id, name, category, mime, size, created_at })),
    sales: rows('sales', 'contact_id', contactId),
    receipts: rows('receipts', 'contact_id', contactId),
    portal_account: rows('users', 'contact_id', contactId).map(({ id, name, email, phone, created_at }) => ({ id, name, email, phone, created_at })),
    identity_numbers: listIdentities(contactId),
    region_fields: rows('region_ext_values', 'entity_id', contactId).filter((v) => v.entity === 'contact'),
    mortgage_profile: rows('mortgage_profiles', 'contact_id', contactId),
    mortgage_applications: rows('mortgage_applications', 'contact_id', contactId),
  };
}

export function erasePerson(req, contactId, reason) {
  const c = get('SELECT id, full_name FROM contacts WHERE id=?', contactId);
  if (!c) return null;
  const files = rows('documents', 'entity_id', contactId).filter((d) => d.entity_type === 'contact');
  for (const d of files) removeRef(d.path).catch(() => {}); // bucket object or legacy local file; already gone is fine
  run("DELETE FROM documents WHERE entity_type='contact' AND entity_id=?", contactId);
  run("DELETE FROM notes WHERE entity_type='contact' AND entity_id=?", contactId);
  run("DELETE FROM tasks WHERE entity_type='contact' AND entity_id=?", contactId);
  run('UPDATE activities SET detail=NULL, prev_value=NULL, new_value=NULL WHERE contact_id=?', contactId);
  if (exists('identity_documents')) run('DELETE FROM identity_documents WHERE contact_id=?', contactId);
  if (exists('region_ext_values')) run("DELETE FROM region_ext_values WHERE entity='contact' AND entity_id=?", contactId);
  if (exists('mortgage_profiles')) run('DELETE FROM mortgage_profiles WHERE contact_id=?', contactId);
  if (exists('mortgage_applications')) run('UPDATE mortgage_applications SET notes=NULL WHERE contact_id=?', contactId);
  run("UPDATE users SET active=0, name='Erased user', email=NULL, phone=NULL, password_hash='!' , token_version=token_version+1 WHERE contact_id=?", contactId);
  run(`UPDATE contacts SET first_name=NULL, last_name=NULL, full_name=?, father_name=NULL, cnic=NULL, dob=NULL, gender=NULL, phone=NULL, alt_phone=NULL, whatsapp=NULL, email=NULL,
       address=NULL, company=NULL, tags=NULL, custom=NULL WHERE id=?`, `Erased contact #${contactId}`, contactId);
  audit(req, 'Erased personal data', 'contact', contactId, { reason: reason || null, files_removed: files.length });
  return { erased: true, files_removed: files.length, kept: 'sales, receipts and accounting entries (detached from the person)' };
}

r.get('/contact/:id/export', adminOnly, asyncH((req, res) => {
  const out = exportPerson(Number(req.params.id));
  if (!out) throw notFound('Contact not found');
  audit(req, 'Exported personal data', 'contact', Number(req.params.id));
  res.setHeader('Content-Disposition', `attachment; filename="contact-${Number(req.params.id)}-export.json"`);
  res.json(out);
}));
r.post('/contact/:id/erase', adminOnly, asyncH((req, res) => {
  if (req.body?.confirm !== `ERASE ${Number(req.params.id)}`) throw bad(`Type ERASE ${Number(req.params.id)} to confirm. This cannot be undone.`);
  const out = erasePerson(req, Number(req.params.id), String(req.body?.reason || '').slice(0, 300));
  if (!out) throw notFound('Contact not found');
  res.json(out);
}));
export default r;
