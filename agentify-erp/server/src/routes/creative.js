import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad } from '../util.js';
import { uploadDir } from '../db.js';
import { currentTenant } from '../context.js';
import { sendStored, isStoredRef, removeRef } from '../services/storage.js';
import * as cs from '../services/creativeStudio.js';
import * as jobs from '../services/creativeJobs.js';
import { createReport } from '../services/aiReports.js';

/** Creative Studio: brand profile, brand stories and post images. Uses the Content permission. */
const r = Router();
r.use(requireStaff);

r.get('/status', can('content', 'view'), (_req, res) => res.json({ ...cs.status(), reels: jobs.options() }));
r.get('/brand', can('content', 'view'), (_req, res) => res.json(cs.brand()));
r.put('/brand', can('content', 'edit'), asyncH((req, res) => { const b = cs.saveBrand(req.body || {}, req.user.id); audit(req, 'Creative brand profile saved', 'creative', 1, b.brand_name); res.json(b); }));
r.post('/story', can('content', 'create'), asyncH(async (req, res) => { const out = await cs.writeStory(req.body || {}, req.user); audit(req, 'Brand story written', 'creative', out.id, out.title); res.status(201).json(out); }));
r.post('/posts', can('content', 'create'), asyncH(async (req, res) => { const out = await cs.makePosts(req.body || {}, req.user); audit(req, 'Post images created', 'creative', null, `${out.options.length} images`); res.json(out); }));
r.post('/items', can('content', 'create'), asyncH(async (req, res) => { const out = await cs.saveImage(req.body || {}, req.user); audit(req, 'Creative image saved', 'creative', out.id, null); res.status(201).json(out); }));
r.get('/items', can('content', 'view'), (_req, res) => res.json(cs.listItems()));
r.get('/items/:id(\\d+)/file', can('content', 'view'), asyncH(async (req, res) => {
  const it = cs.getItem(req.params.id);
  if (!it.file_ref) throw bad('This item has no file');
  const name = `creative-${it.id}${path.extname(it.file_ref) || '.png'}`;
  if (isStoredRef(it.file_ref)) return sendStored(req, res, it.file_ref, { mime: it.mime, name, download: !!req.query.download });
  const f = path.resolve(uploadDir(), it.file_ref);
  if (!f.startsWith(path.resolve(uploadDir()) + path.sep) || !fs.existsSync(f)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Type', it.mime || 'image/png');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  return res.sendFile(f);
}));
r.delete('/items/:id(\\d+)', can('content', 'delete'), asyncH(async (req, res) => {
  const it = cs.removeItem(req.params.id);
  if (it.file_ref) { if (isStoredRef(it.file_ref)) await removeRef(it.file_ref).catch(() => {}); else fs.rm(path.resolve(uploadDir(), it.file_ref), { force: true }, () => {}); }
  audit(req, 'Creative item deleted', 'creative', it.id, it.title); res.json({ ok: true });
}));
// ---- video reels (8 seconds, vertical) with an optional voice-over; made in the background
r.post('/reels/quote', can('content', 'view'), (req, res) => res.json(jobs.quote(req.body || {})));
r.post('/reels', can('content', 'create'), asyncH(async (req, res) => { const out = await jobs.startReel(req.body || {}, req.user); audit(req, 'Reel started', 'creative', out.id, `${out.credits_used} credits`); res.status(201).json(out); }));
r.post('/reels/voice-preview', can('content', 'create'), asyncH(async (req, res) => res.json(await jobs.previewVoice(req.body || {}, req.user))));
r.get('/reels', can('content', 'view'), (_req, res) => res.json(jobs.listJobs()));
const sendFileRef = async (req, res, ref, mime, name) => {
  if (!ref) return res.status(404).json({ error: 'No file' });
  if (isStoredRef(ref)) return sendStored(req, res, ref, { mime, name, download: !!req.query.download });
  const f = path.resolve(uploadDir(), ref);
  if (!f.startsWith(path.resolve(uploadDir()) + path.sep) || !fs.existsSync(f)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Type', mime);
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  return res.sendFile(f);
};
r.get('/reels/:id(\\d+)/video', can('content', 'view'), asyncH((req, res) => { const j = jobs.getJob(req.params.id); return sendFileRef(req, res, j.video_ref, 'video/mp4', `reel-${j.id}.mp4`); }));
r.get('/reels/:id(\\d+)/voice', can('content', 'view'), asyncH((req, res) => { const j = jobs.getJob(req.params.id); return sendFileRef(req, res, j.audio_ref, 'audio/mpeg', `reel-${j.id}-voice.mp3`); }));
r.delete('/reels/:id(\\d+)', can('content', 'delete'), asyncH((req, res) => {
  const out = jobs.removeJob(req.params.id);
  for (const ref of out.local) fs.rm(path.resolve(uploadDir(), ref), { force: true }, () => {});
  audit(req, 'Reel deleted', 'creative', Number(req.params.id), null); res.json({ ok: true });
}));
/** Flag a result as wrong, unsafe or poor; Agentify reviews these. */
r.post('/report', can('content', 'view'), asyncH((req, res) => {
  const b = req.body || {};
  if (!['brand_story', 'creative_post', 'creative_video', 'ask_assistant'].includes(b.feature)) throw bad('Nothing to report');
  const t = currentTenant();
  const out = createReport({ tenantId: t?.id ?? null, tenantName: t?.name ?? null, userName: req.user.name, feature: b.feature, prompt: b.prompt, output: b.output, note: b.note });
  audit(req, 'AI result reported', 'creative', out.id, b.feature); res.status(201).json(out);
}));
export default r;
