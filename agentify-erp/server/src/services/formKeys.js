// Publishable form keys: a key that can only submit one enquiry form, so it can sit in a web page without exposing anything.
// It works from the origins on its allow-list (CORS) and, when shown in an iframe, only on those sites (frame-ancestors).
import crypto from 'node:crypto';
import { all, get, run } from '../db.js';
import { HttpError, bad, jparse, now } from '../util.js';

export const cleanOrigins = (list) => {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    let u; try { u = new URL(String(raw).trim()); } catch { throw bad(`"${raw}" is not a web address. Use the form https://www.example.com`); }
    const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw bad(`${u.origin} must start with https://`);
    if (u.username || u.password) throw bad('Addresses with credentials are not allowed');
    if (!out.includes(u.origin)) out.push(u.origin);
  }
  if (out.length > 20) throw bad('At most 20 websites per form');
  return out;
};
const text = (v, max) => String(v ?? '').trim().slice(0, max) || null;
const view = (r) => r && ({ id: r.id, connection_id: r.connection_id, form_key: r.form_key, name: r.name, origins: jparse(r.origins, []), title: r.title, consent_text: r.consent_text, button: r.button, active: !!r.active, created_at: r.created_at, last_used_at: r.last_used_at });

export const listForms = (connectionId) => all('SELECT * FROM form_keys WHERE connection_id=? AND active=1 ORDER BY id DESC', connectionId).map(view);
export function createForm(connectionId, b) {
  const name = text(b.name, 80);
  if (!name) throw bad('Give the form a name, for example "Contact page"');
  const key = `pk_${crypto.randomBytes(18).toString('base64url')}`;
  const id = Number(run('INSERT INTO form_keys(connection_id,form_key,name,origins,title,consent_text,button,created_at) VALUES(?,?,?,?,?,?,?,?)', connectionId, key, name, JSON.stringify(cleanOrigins(b.origins)), text(b.title, 120), text(b.consent_text, 600), text(b.button, 40), now()).lastInsertRowid);
  return view(get('SELECT * FROM form_keys WHERE id=?', id));
}
export function updateForm(connectionId, id, b) {
  const r = get('SELECT * FROM form_keys WHERE id=? AND connection_id=? AND active=1', id, connectionId);
  if (!r) throw new HttpError(404, 'Form not found');
  run('UPDATE form_keys SET name=?, origins=?, title=?, consent_text=?, button=? WHERE id=?', b.name === undefined ? r.name : text(b.name, 80) || r.name,
    b.origins === undefined ? r.origins : JSON.stringify(cleanOrigins(b.origins)), b.title === undefined ? r.title : text(b.title, 120), b.consent_text === undefined ? r.consent_text : text(b.consent_text, 600), b.button === undefined ? r.button : text(b.button, 40), id);
  return view(get('SELECT * FROM form_keys WHERE id=?', id));
}
export function removeForm(connectionId, id) {
  if (!run('UPDATE form_keys SET active=0 WHERE id=? AND connection_id=? AND active=1', id, connectionId).changes) throw new HttpError(404, 'Form not found');
}

/** The form behind a publishable key, with its connection, or null when the key is unknown, revoked or its connection is disconnected. */
export function formByKey(key) {
  if (!/^pk_[A-Za-z0-9_-]{20,40}$/.test(String(key))) return null;
  const f = get("SELECT f.* FROM form_keys f JOIN integration_connections c ON c.id=f.connection_id WHERE f.form_key=? AND f.active=1 AND c.status='active'", key);
  return f ? view(f) : null;
}
export const markUsed = (id) => run('UPDATE form_keys SET last_used_at=? WHERE id=?', now(), id);
/** May a page on this origin submit the form? Its own allow-list, or the workspace's own address (the hosted form). */
export const originAllowed = (form, origin, selfOrigin) => !!origin && (origin === selfOrigin || form.origins.includes(origin));
