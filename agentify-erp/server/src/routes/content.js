import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, uploadDir } from '../db.js';
import { can, hasPerm, requireStaff } from '../rbac.js';
import { audit, notify } from '../audit.js';
import { asyncH, bad, forbidden, jparse, notFound, now, today } from '../util.js';
import { uploader, storedPath } from './helpers.js';
import { sendStored, removeRef } from '../services/storage.js';

/**
 * Social-media content calendar. Staff plan posts (type, caption, platforms, date/time) and attach the creative.
 * Publishing: the app cannot log in to a platform for you — "Post" opens the platform (or the phone's share sheet) with the
 * creative and caption ready, then the post is ticked off per platform. Optional API credentials are stored per platform for
 * integrations that need them (see /accounts).
 */
const r = Router();
r.use(requireStaff);

export const POST_TYPES = ['story', 'reel', 'static', 'carousel', 'video', 'live'];
export const PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok', 'snapchat', 'linkedin', 'x', 'pinterest', 'whatsapp'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

const present = (p) => {
  if (!p) return p;
  const posted = jparse(p.posted, {});
  const platforms = jparse(p.platforms, []);
  return { ...p, platforms, posted, day: DAYS[new Date(`${p.post_date}T00:00:00Z`).getUTCDay()], has_creative: !!p.creative_path, creative_path: undefined,
    creative_kind: (p.creative_mime || '').startsWith('video') ? 'video' : p.creative_path ? 'image' : null, done: platforms.length > 0 && platforms.every((x) => posted[x]) };
};
const SELECT = 'SELECT c.*, u.name assignee, b.name author FROM content_posts c LEFT JOIN users u ON u.id=c.assigned_to LEFT JOIN users b ON b.id=c.created_by';
const mayEdit = (req, p) => hasPerm(req.user, 'content', 'approve') || p.created_by === req.user.id || p.assigned_to === req.user.id;

r.get('/meta', can('content', 'view'), (_req, res) => res.json({ post_types: POST_TYPES, platforms: PLATFORMS, users: all("SELECT u.id,u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 ORDER BY u.name") }));

r.get('/posts', can('content', 'view'), asyncH((req, res) => {
  const q = req.query, where = ['1=1'], params = [];
  if (isDate(q.from)) { where.push('c.post_date>=?'); params.push(q.from); }
  if (isDate(q.to)) { where.push('c.post_date<=?'); params.push(q.to); }
  if (q.status) { where.push('c.status=?'); params.push(q.status); }
  if (q.post_type) { where.push('c.post_type=?'); params.push(q.post_type); }
  if (q.assigned_to) { where.push('c.assigned_to=?'); params.push(q.assigned_to); }
  if (q.platform) { where.push('c.platforms LIKE ?'); params.push(`%"${q.platform}"%`); }
  if (q.q) { where.push('(c.title LIKE ? OR c.caption LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  res.json(all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY c.post_date, c.post_time, c.id LIMIT 1000`, ...params).map(present));
}));

function clean(b, existing) {
  const d = {};
  if (b.title !== undefined) { d.title = String(b.title).trim(); if (!d.title) throw bad('Give the post a title'); }
  if (b.post_type !== undefined) { if (!POST_TYPES.includes(b.post_type)) throw bad(`Post type must be one of ${POST_TYPES.join(', ')}`); d.post_type = b.post_type; }
  if (b.caption !== undefined) d.caption = b.caption;
  if (b.platforms !== undefined) {
    const pl = [].concat(b.platforms || []).filter(Boolean);
    if (pl.some((x) => !PLATFORMS.includes(x))) throw bad('Unknown platform');
    d.platforms = JSON.stringify([...new Set(pl)]);
  }
  if (b.post_date !== undefined) { if (!isDate(b.post_date)) throw bad('Choose the posting date'); d.post_date = b.post_date; }
  if (b.post_time !== undefined) { if (b.post_time && !/^\d{1,2}:\d{2}$/.test(b.post_time)) throw bad('Time must look like 18:30'); d.post_time = b.post_time || null; }
  if (b.status !== undefined) { if (!['idea', 'planned', 'ready', 'posted'].includes(b.status)) throw bad('Invalid status'); d.status = b.status; }
  if (b.assigned_to !== undefined) d.assigned_to = b.assigned_to || null;
  if (b.notes !== undefined) d.notes = b.notes;
  return d;
}
r.post('/posts', can('content', 'create'), asyncH((req, res) => {
  const d = clean({ post_type: 'static', status: 'planned', platforms: [], ...req.body });
  if (!d.title) throw bad('Give the post a title');
  if (!d.post_date) throw bad('Choose the posting date');
  const id = Number(run(`INSERT INTO content_posts(title,post_type,caption,platforms,post_date,post_time,status,assigned_to,created_by,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    d.title, d.post_type, d.caption ?? null, d.platforms ?? '[]', d.post_date, d.post_time ?? null, d.status, d.assigned_to ?? req.user.id, req.user.id, d.notes ?? null, now(), now()).lastInsertRowid);
  if (d.assigned_to && d.assigned_to !== req.user.id) notify(d.assigned_to, 'content', 'Content assigned to you', `${d.title} — ${d.post_date}`, '/content');
  audit(req, 'Content planned', 'content', id, d.title);
  res.status(201).json(present(get(`${SELECT} WHERE c.id=?`, id)));
}));
r.put('/posts/:id(\\d+)', can('content', 'edit'), asyncH((req, res) => {
  const p = get('SELECT * FROM content_posts WHERE id=?', req.params.id);
  if (!p) throw notFound();
  if (!mayEdit(req, p)) throw forbidden('You can only edit your own content');
  const d = clean(req.body);
  d.updated_at = now();
  const keys = Object.keys(d);
  run(`UPDATE content_posts SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => d[k]), p.id);
  if (d.assigned_to && d.assigned_to !== p.assigned_to && d.assigned_to !== req.user.id) notify(d.assigned_to, 'content', 'Content assigned to you', `${p.title} — ${d.post_date || p.post_date}`, '/content');
  res.json(present(get(`${SELECT} WHERE c.id=?`, p.id)));
}));
r.delete('/posts/:id(\\d+)', can('content', 'edit'), asyncH((req, res) => {
  const p = get('SELECT * FROM content_posts WHERE id=?', req.params.id);
  if (!p) throw notFound();
  if (!mayEdit(req, p)) throw forbidden('You can only delete your own content');
  if (p.creative_path) removeRef(p.creative_path).catch(() => {});
  run('DELETE FROM content_posts WHERE id=?', p.id);
  res.json({ ok: true });
}));

// ---- creative (image / video) — private; served only through these authenticated endpoints
const creativeUp = uploader('content', 'media', 200, { module: 'content' });
r.post('/posts/:id(\\d+)/creative', can('content', 'edit'), creativeUp.single('creative'), asyncH((req, res) => {
  const p = get('SELECT * FROM content_posts WHERE id=?', req.params.id);
  if (!p) throw notFound();
  if (!mayEdit(req, p)) throw forbidden();
  if (!req.file) throw bad('Choose an image or video');
  if (p.creative_path) removeRef(p.creative_path).catch(() => {});
  run("UPDATE content_posts SET creative_path=?, creative_name=?, creative_mime=?, status=CASE WHEN status IN ('idea','planned') THEN 'ready' ELSE status END, updated_at=? WHERE id=?",
    storedPath(req.file, 'content'), req.file.originalname, req.file.mimetype, now(), p.id);
  res.json(present(get(`${SELECT} WHERE c.id=?`, p.id)));
}));
r.delete('/posts/:id(\\d+)/creative', can('content', 'edit'), asyncH((req, res) => {
  const p = get('SELECT * FROM content_posts WHERE id=?', req.params.id);
  if (!p) throw notFound();
  if (!mayEdit(req, p)) throw forbidden();
  if (p.creative_path) removeRef(p.creative_path).catch(() => {});
  run('UPDATE content_posts SET creative_path=NULL, creative_name=NULL, creative_mime=NULL, updated_at=? WHERE id=?', now(), p.id);
  res.json({ ok: true });
}));
r.get('/posts/:id(\\d+)/creative', can('content', 'view'), asyncH(async (req, res) => {
  const p = get('SELECT * FROM content_posts WHERE id=?', req.params.id);
  if (!p?.creative_path) throw notFound('No creative attached');
  await sendStored(req, res, p.creative_path, { mime: p.creative_mime, name: p.creative_name || 'creative', download: !!req.query.download });
}));

/** Tick a platform as posted (or undo). The post becomes "posted" once every chosen platform is done. */
r.post('/posts/:id(\\d+)/posted', can('content', 'edit'), asyncH((req, res) => {
  const p = get('SELECT * FROM content_posts WHERE id=?', req.params.id);
  if (!p) throw notFound();
  if (!mayEdit(req, p)) throw forbidden();
  const platforms = jparse(p.platforms, []);
  const { platform, posted = true } = req.body;
  if (!platforms.includes(platform)) throw bad('That platform is not selected for this post');
  const map = jparse(p.posted, {});
  if (posted) map[platform] = now(); else delete map[platform];
  const all_done = platforms.length > 0 && platforms.every((x) => map[x]);
  run('UPDATE content_posts SET posted=?, status=?, updated_at=? WHERE id=?', JSON.stringify(map), all_done ? 'posted' : (p.status === 'posted' ? 'ready' : p.status), now(), p.id);
  audit(req, posted ? 'Content posted' : 'Content un-posted', 'content', p.id, `${p.title} → ${platform}`);
  res.json(present(get(`${SELECT} WHERE c.id=?`, p.id)));
}));

// ---- platform accounts / API credentials (managers). Secrets are never sent back to the browser.
const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');
r.get('/accounts', can('content', 'view'), asyncH((req, res) => {
  const rows = all('SELECT * FROM social_accounts').map((a) => ({ id: a.id, platform: a.platform, handle: a.handle, profile_url: a.profile_url, client_id: a.client_id, client_secret_set: !!a.client_secret, access_token_hint: mask(a.access_token), connected: !!a.access_token, notes: a.notes }));
  res.json(PLATFORMS.map((pl) => rows.find((x) => x.platform === pl) || { platform: pl, handle: '', profile_url: '', connected: false }));
}));
r.put('/accounts/:platform', can('content', 'approve'), asyncH((req, res) => {
  const platform = req.params.platform;
  if (!PLATFORMS.includes(platform)) throw notFound('Unknown platform');
  const b = req.body, cur = get('SELECT * FROM social_accounts WHERE platform=?', platform);
  const val = (k) => (b[k] === undefined || b[k] === '__keep__' ? cur?.[k] ?? null : b[k] || null);
  if (cur) run('UPDATE social_accounts SET handle=?, profile_url=?, client_id=?, client_secret=?, access_token=?, notes=?, updated_at=? WHERE id=?', val('handle'), val('profile_url'), val('client_id'), val('client_secret'), val('access_token'), val('notes'), now(), cur.id);
  else run('INSERT INTO social_accounts(platform,handle,profile_url,client_id,client_secret,access_token,notes,updated_at) VALUES(?,?,?,?,?,?,?,?)', platform, val('handle'), val('profile_url'), val('client_id'), val('client_secret'), val('access_token'), val('notes'), now());
  audit(req, 'Social account updated', 'social_account', platform, b.handle || platform);
  res.json({ ok: true });
}));

/** Tell people about content due today that is still not posted (called by the daily job). */
export function contentReminders() {
  let n = 0;
  for (const p of all("SELECT id,title,assigned_to,post_time FROM content_posts WHERE post_date=? AND status<>'posted' AND assigned_to IS NOT NULL", today())) {
    notify(p.assigned_to, 'content', 'Content due today', `${p.title}${p.post_time ? ` at ${p.post_time}` : ''}`, '/content', { dedupe: `content-${p.id}-${today()}` });
    n++;
  }
  return n;
}

export default r;
