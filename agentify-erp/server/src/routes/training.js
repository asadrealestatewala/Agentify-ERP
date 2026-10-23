// Training videos inside every workspace. The ready-made videos ship with the system (server/assets/training, listed in
// manifest.json) and are placed in each workspace's library the first time it is opened, given to the roles named in the
// manifest. After that the workspace's administrators decide who gets what with Assign; that choice is never overridden.
// Each employee sees only the videos assigned to their role; Super Admin and the Admin role see all and can manage them.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, getSetting, setSetting, uploadDir } from '../db.js';
import { uploader } from './helpers.js';
import { hasPerm } from '../rbac.js';
import { HttpError, asyncH, bad, forbidden, notFound, now } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
const authed = (req, _res, next) => (req.user && !req.user.portal ? next() : next(new HttpError(401, 'Authentication required')));
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const CATEGORIES = ['System overview', 'Administration', 'Sales & CRM', 'Properties & projects', 'Accounting', 'Land & investors', 'HR & payroll', 'Website & marketing', 'Portals', 'Other'];
const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const SHIPPED = path.join(ASSETS, 'training');

/** Put the shipped videos in this workspace's library (once per manifest version); never touches assignments the administrators changed. */
function ensureLibrary() {
  let items = [], stamp;
  try { const f = path.join(SHIPPED, 'manifest.json'); items = JSON.parse(fs.readFileSync(f, 'utf8')); stamp = `${fs.statSync(f).mtimeMs}:${items.length}`; } catch { return; }
  if (getSetting('training_manifest') === stamp) return;
  items.forEach((it) => {
    const file = ['mp4', 'webm'].map((e) => path.join(SHIPPED, `${it.key}.${e}`)).find((f) => fs.existsSync(f));
    if (!file) return;
    const ext = path.extname(file), mime = ext === '.mp4' ? 'video/mp4' : 'video/webm';
    let v = get('SELECT id FROM training_library WHERE seed_key=?', it.key);
    if (v) run('UPDATE training_library SET path=?, mime=?, size=?, seconds=? WHERE id=?', `@assets/training/${it.key}${ext}`, mime, fs.statSync(file).size, it.seconds, v.id);
    else v = { id: Number(run('INSERT INTO training_library(title,description,category,path,mime,size,seconds,seed_key,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      it.title, it.description, it.category, `@assets/training/${it.key}${ext}`, mime, fs.statSync(file).size, it.seconds, it.key, it.order ?? 100, now()).lastInsertRowid) };
    if (getSetting(`training_assigned_${it.key}`) == null) {
      for (const name of it.roles || []) { const role = get('SELECT id FROM roles WHERE name=?', name); if (role) run('INSERT OR IGNORE INTO training_assignments(video_id, role_id) VALUES(?,?)', v.id, role.id); }
      setSetting(`training_assigned_${it.key}`, '1');
    }
  });
  setSetting('training_manifest', stamp);
}

const up = uploader('training', 'media', 300);
/** Shipped videos live in server/assets (path '@assets/...'); uploaded ones live in the workspace's own uploads folder. */
const abs = (v) => (v.path.startsWith('@assets/') ? path.join(ASSETS, v.path.slice(8)) : path.join(uploadDir(), v.path));
const fileOf = (v) => { const f = abs(v); if (!(f.startsWith(uploadDir()) || f.startsWith(ASSETS)) || !fs.existsSync(f)) throw notFound('The video file is missing'); return f; };
const slug = (t) => String(t).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'video';
const seesAll = (u) => !!u.isSuper || u.role === 'Admin';
const manages = (u) => seesAll(u) && !u.portal;
const visible = (u) => (seesAll(u) ? all('SELECT * FROM training_library ORDER BY sort_order, id')
  : all('SELECT l.* FROM training_library l JOIN training_assignments a ON a.video_id=l.id WHERE a.role_id=? ORDER BY l.sort_order, l.id', u.role_id));
const mayWatch = (u, id) => visible(u).find((v) => v.id === Number(id));
const manager = (req, _res, next) => (manages(req.user) ? next() : next(forbidden('Only administrators can manage training videos')));
const rolesOf = (id) => all('SELECT r.id, r.name FROM training_assignments a JOIN roles r ON r.id=a.role_id WHERE a.video_id=? ORDER BY r.portal, r.name', id);
function setAssignments(videoId, roleIds) {
  const ids = [...new Set((Array.isArray(roleIds) ? roleIds : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  for (const id of ids) if (!get('SELECT 1 FROM roles WHERE id=?', id)) throw bad('One of the roles does not exist');
  run('DELETE FROM training_assignments WHERE video_id=?', videoId);
  for (const id of ids) run('INSERT INTO training_assignments(video_id, role_id) VALUES(?,?)', videoId, id);
  return ids.length;
}

r.get('/library', authed, asyncH((req, res) => {
  ensureLibrary();
  const mgr = manages(req.user);
  const rows = visible(req.user).map((v) => ({ id: v.id, title: v.title, description: v.description, category: v.category, mime: v.mime, size: v.size, seconds: v.seconds, created_at: v.created_at, seed_key: v.seed_key, ...(mgr ? { roles: rolesOf(v.id) } : {}) }));
  res.json({ categories: CATEGORIES, rows, can: { manage: mgr, all: seesAll(req.user) }, ...(mgr ? { roles: all('SELECT id, name, portal FROM roles ORDER BY portal, name') } : {}) });
}));
r.post('/library', authed, manager, up.single('file'), asyncH((req, res) => {
  const f = req.file; if (!f) throw bad('Choose a video file (MP4, WebM or MOV)');
  const title = str(req.body.title, 120);
  if (!title) { fs.rm(f.path, { force: true }, () => {}); throw bad('Give the video a title'); }
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Other';
  const id = Number(run('INSERT INTO training_library(title,description,category,path,mime,size,seconds,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    title, str(req.body.description, 600), category, `training/${f.filename}`, f.mimetype, f.size, Math.round(Number(req.body.seconds)) || null, req.user.id, now()).lastInsertRowid);
  let roleIds = []; try { roleIds = JSON.parse(req.body.role_ids || '[]'); } catch { /* none */ }
  const n = setAssignments(id, roleIds);
  audit(req, 'Added a training video to the library', 'training', id, `${title} (assigned to ${n} role${n === 1 ? '' : 's'})`);
  res.status(201).json({ id });
}));
r.get('/library/:id(\\d+)/file', authed, asyncH((req, res) => {
  const v = mayWatch(req.user, req.params.id); if (!v) throw notFound('Video not found');
  const f = fileOf(v), ext = path.extname(v.path);
  res.setHeader('Content-Type', v.mime || 'video/mp4'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(slug(v.title) + ext)}`);
  if (req.query.download) audit(req, 'Downloaded a training video', 'training', v.id, v.title);
  res.sendFile(f); // answers Range requests, so playback starts at once and can be seeked
}));
r.put('/library/:id(\\d+)/assign', authed, manager, asyncH((req, res) => {
  const v = get('SELECT * FROM training_library WHERE id=?', req.params.id); if (!v) throw notFound('Video not found');
  const n = setAssignments(v.id, req.body?.role_ids);
  audit(req, 'Assigned a training video', 'training', v.id, `${v.title}: ${rolesOf(v.id).map((x) => x.name).join(', ') || 'nobody'}`);
  res.json({ ok: true, roles: n });
}));
r.put('/library/:id(\\d+)', authed, manager, asyncH((req, res) => {
  const v = get('SELECT * FROM training_library WHERE id=?', req.params.id); if (!v) throw notFound('Video not found');
  const title = str(req.body.title ?? v.title, 120); if (!title) throw bad('Give the video a title');
  run('UPDATE training_library SET title=?, description=?, category=? WHERE id=?', title, str(req.body.description ?? v.description, 600), CATEGORIES.includes(req.body.category) ? req.body.category : v.category, v.id);
  audit(req, 'Edited a training video', 'training', v.id, title); res.json({ ok: true });
}));
r.delete('/library/:id(\\d+)', authed, manager, asyncH((req, res) => {
  const v = get('SELECT * FROM training_library WHERE id=?', req.params.id); if (!v) throw notFound('Video not found');
  run('DELETE FROM training_assignments WHERE video_id=?', v.id); run('DELETE FROM training_library WHERE id=?', v.id);
  if (!v.seed_key) fs.rm(path.join(uploadDir(), v.path), { force: true }, () => {});
  audit(req, 'Deleted a training video', 'training', v.id, v.title); res.json({ ok: true });
}));
export default r;
