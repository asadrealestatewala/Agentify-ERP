import { all, get, run, tx } from '../db.js';
import { bad, now } from '../util.js';
import { audit, notify } from '../audit.js';
import { fireWebhook } from './website.js';
import { publish } from './events.js';

/** Everyone who should hear about a listing waiting for review: Listing Managers and anyone else who can approve properties. */
export function reviewerIds() {
  return all(`SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN role_permissions p ON p.role_id=r.id
    WHERE u.active=1 AND r.portal=0 AND (r.name='Super Admin' OR (p.module='listings' AND p.action='approve'))`).map((x) => x.id);
}
export const notifyReviewers = (title, body, link) => notify(reviewerIds(), 'listing', title, body, link);

/** The person the agent-facing messages go to: whoever listed it. */
const ownerOf = (p) => p.agent_id || p.created_by;

/**
 * Listing Manager approval = approve + publish + feature in one step: the property goes live on the website and is featured.
 * Sold or reserved properties are published but keep their status.
 */
export function approveProperty(id, req) {
  const p = get('SELECT * FROM properties WHERE id=?', id);
  if (!p) throw bad('Property not found');
  if (p.review_state !== 'review') throw bad('This property is not waiting for approval');
  if (p.status === 'sold' || p.status === 'cancelled') throw bad(`A ${p.status} property cannot be listed`);
  if (!p.title || !(p.net_price > 0)) throw bad('The listing needs a title and a price before it can go live — send it back to the agent');
  tx(() => {
    run(`UPDATE properties SET review_state='published', published=1, status=CASE WHEN status IN ('draft','on_hold','available') THEN 'featured' ELSE status END, review_note=NULL, review_by=?, reviewed_at=?, updated_at=? WHERE id=?`, req.user.id, now(), now(), id);
  });
  audit(req, 'Listing approved & featured', 'property', id, `${p.title} (listed by ${ownerOf(p)})`);
  if (ownerOf(p) && ownerOf(p) !== req.user.id) notify(ownerOf(p), 'listing', 'Your listing is live and featured', `${p.title} was approved by ${req.user.name} and is now featured on the website`, `/properties/${id}`);
  fireWebhook(id, 'property.published'); fireWebhook(id, 'property.featured');
}

export function rejectProperty(id, note, req) {
  const p = get('SELECT * FROM properties WHERE id=?', id);
  if (!p) throw bad('Property not found');
  if (p.review_state !== 'review') throw bad('This property is not waiting for approval');
  const why = String(note || '').trim();
  if (!why) throw bad('Tell the agent what to fix — a reason is required');
  run("UPDATE properties SET review_state='draft', published=0, review_note=?, review_by=?, reviewed_at=?, updated_at=? WHERE id=?", why.slice(0, 600), req.user.id, now(), now(), id);
  audit(req, 'Listing sent back', 'property', id, `${p.title}: ${why}`);
  if (ownerOf(p)) notify(ownerOf(p), 'listing', 'Listing sent back for changes', `${p.title}: ${why}`, `/properties/${id}`);
}

/** An agent asks for a project to be shown on the website. */
export function requestProject(id, req) {
  const p = get('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw bad('Project not found');
  if (p.site_visible) throw bad('This project is already on the website');
  if (p.site_state === 'requested') throw bad('This project is already waiting for approval');
  run("UPDATE projects SET site_state='requested', site_requested_by=?, site_requested_at=?, site_note=NULL WHERE id=?", req.user.id, now(), id);
  audit(req, 'Requested website listing', 'project', id, p.name);
  notifyReviewers('Project awaiting website approval', `${p.name} — requested by ${req.user.name}`, '/listings/approvals');
}
export function approveProject(id, req) {
  const p = get('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw bad('Project not found');
  if (p.site_state !== 'requested') throw bad('This project is not waiting for approval');
  run("UPDATE projects SET site_visible=1, site_featured=1, site_state='approved', site_note=NULL WHERE id=?", id);
  publish('project', id);
  audit(req, 'Project approved for website', 'project', id, p.name);
  if (p.site_requested_by && p.site_requested_by !== req.user.id) notify(p.site_requested_by, 'listing', 'Your project is live and featured', `${p.name} is now featured on the website`, `/projects/${id}`);
}
export function rejectProject(id, note, req) {
  const p = get('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw bad('Project not found');
  if (p.site_state !== 'requested') throw bad('This project is not waiting for approval');
  const why = String(note || '').trim();
  if (!why) throw bad('Tell the agent what to fix — a reason is required');
  run("UPDATE projects SET site_state='rejected', site_note=? WHERE id=?", why.slice(0, 600), id);
  audit(req, 'Project website request declined', 'project', id, `${p.name}: ${why}`);
  if (p.site_requested_by) notify(p.site_requested_by, 'listing', 'Project listing sent back', `${p.name}: ${why}`, `/projects/${id}`);
}
