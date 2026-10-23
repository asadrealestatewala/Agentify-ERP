// Customer reviews for the public website. Anyone can submit one (with their consent and, optionally, a photo of themselves or their team),
// but nothing is shown until a console user approves it, so only real, reviewed words reach the page. Photos are small images kept in the
// platform database and served by this app (never from a third-party address).
import { platformDb } from '../platform.js';
import { bad, HttpError } from '../util.js';

const pdb = () => platformDb();
export const REVIEWS_SCHEMA = `
CREATE TABLE IF NOT EXISTS site_reviews(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, company TEXT, country TEXT, rating INTEGER, quote TEXT NOT NULL, email TEXT NOT NULL,
  photo BLOB, photo_type TEXT, consent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  decided_by TEXT, decided_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_site_reviews ON site_reviews(status, created_at);
`;
let ready = false;
const ensure = () => { if (!ready) { pdb().exec(REVIEWS_SCHEMA); ready = true; } };
const str = (v, max, label) => { const s = String(v ?? '').trim(); if (s.length > max) throw bad(`${label} is too long (max ${max} characters)`); return s; };
const PHOTO = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
export const MAX_PHOTO_BYTES = 60 * 1024;

/** Validate and normalise a review from a public form (shared with each workspace's own website). Throws a readable 400. */
export function cleanReview(b) {
  if (!b.consent) throw bad('Please confirm that you agree to your review and name being shown on the website');
  const name = str(b.name, 80, 'Name');
  if (name.length < 2) throw bad('Please enter your name');
  const quote = str(b.quote, 600, 'Review');
  if (quote.length < 20) throw bad('Please write at least a sentence or two (20 characters or more)');
  if (/https?:\/\/|www\./i.test(quote)) throw bad('Please leave links out of your review');
  const email = str(b.email, 160, 'Email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Please enter a valid email address (it is never shown)');
  const rating = b.rating === undefined || b.rating === '' ? null : Number(b.rating);
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw bad('Choose a rating from 1 to 5 stars');
  const country = /^[A-Za-z]{2}$/.test(String(b.country || '').trim()) ? String(b.country).trim().toUpperCase() : null;
  let photo = null, photoType = null;
  if (b.photo) {
    const m = PHOTO.exec(String(b.photo));
    if (!m) throw bad('The photo must be a PNG, JPG or WebP image');
    photo = Buffer.from(m[2], 'base64');
    if (photo.length > MAX_PHOTO_BYTES) throw bad('The photo is too large. Choose a smaller one.');
    const sig = photo.subarray(0, 12).toString('latin1');
    const okSig = (m[1] === 'image/png' && photo[0] === 0x89 && sig.slice(1, 4) === 'PNG') || (m[1] === 'image/jpeg' && photo[0] === 0xff && photo[1] === 0xd8) || (m[1] === 'image/webp' && sig.startsWith('RIFF') && sig.slice(8, 12) === 'WEBP');
    if (!okSig) throw bad('That file is not a valid image');
    photoType = m[1];
  }
  return { name, role: str(b.role, 80, 'Role') || null, company: str(b.company, 120, 'Company') || null, country, rating, quote, email, photo, photoType };
}

/** A review from the public form. Stored as pending; the visitor is told it is reviewed before it appears. */
export function submitReview(b) {
  ensure();
  const c = cleanReview(b);
  const { name, email, quote, rating, country, photo, photoType } = c;
  // the same person cannot flood the queue
  const dup = pdb().prepare("SELECT COUNT(*) n FROM site_reviews WHERE email=? AND status='pending'").get(email).n;
  if (dup >= 2) throw bad('You already have reviews waiting for approval. Thank you.');
  const id = Number(pdb().prepare('INSERT INTO site_reviews(name,role,company,country,rating,quote,email,photo,photo_type,consent) VALUES(?,?,?,?,?,?,?,?,?,1)')
    .run(name, c.role, c.company, country, rating, quote, email, photo, photoType).lastInsertRowid);
  return { id, name };
}

const view = (r) => ({ id: r.id, name: r.name, role: r.role, company: r.company, country: r.country, rating: r.rating, quote: r.quote, email: r.email, status: r.status, has_photo: !!r.has_photo, decided_by: r.decided_by, decided_at: r.decided_at, created_at: r.created_at });
const COLS = 'id,name,role,company,country,rating,quote,email,status,decided_by,decided_at,created_at, (photo IS NOT NULL) has_photo';
export function listReviews({ status } = {}) {
  ensure();
  const ok = ['pending', 'approved', 'rejected'].includes(status);
  const counts = Object.fromEntries(pdb().prepare('SELECT status, COUNT(*) n FROM site_reviews GROUP BY status').all().map((x) => [x.status, x.n]));
  return { counts: { pending: 0, approved: 0, rejected: 0, ...counts }, rows: pdb().prepare(`SELECT ${COLS} FROM site_reviews ${ok ? 'WHERE status=?' : ''} ORDER BY id DESC LIMIT 300`).all(...(ok ? [status] : [])).map(view) };
}
export function decideReview(id, status, by) {
  ensure();
  if (!['approved', 'rejected', 'pending'].includes(status)) throw bad('Unknown decision');
  const r = pdb().prepare('SELECT id FROM site_reviews WHERE id=?').get(Number(id));
  if (!r) throw new HttpError(404, 'Review not found');
  pdb().prepare("UPDATE site_reviews SET status=?, decided_by=?, decided_at=datetime('now') WHERE id=?").run(status, by, r.id);
  return view(pdb().prepare(`SELECT ${COLS} FROM site_reviews WHERE id=?`).get(r.id));
}
export function deleteReview(id) {
  ensure();
  if (!pdb().prepare('DELETE FROM site_reviews WHERE id=?').run(Number(id)).changes) throw new HttpError(404, 'Review not found');
}
/** What the public site may show: approved reviews only, newest first, with no e-mail address. */
export function publicReviews() {
  ensure();
  return pdb().prepare(`SELECT ${COLS} FROM site_reviews WHERE status='approved' ORDER BY decided_at DESC, id DESC LIMIT 24`).all()
    .map((r) => ({ id: r.id, name: r.name, role: r.role, company: r.company, country: r.country, rating: r.rating, quote: r.quote, photo: r.has_photo ? `/api/platform/reviews/${r.id}/photo` : null }));
}
/** The photo of an approved review (the console may also preview pending ones). */
export function reviewPhoto(id, { any = false } = {}) {
  ensure();
  const r = pdb().prepare(`SELECT photo, photo_type FROM site_reviews WHERE id=? ${any ? '' : "AND status='approved'"}`).get(Number(id));
  if (!r?.photo) throw new HttpError(404, 'Not found');
  return { buffer: r.photo, type: r.photo_type };
}
