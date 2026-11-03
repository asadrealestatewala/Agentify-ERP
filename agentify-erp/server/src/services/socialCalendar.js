// Content calendar with approval, posted through Zernio (see services/zernio.js). A post moves through
//   draft > waiting approval > approved > scheduled > posted        (or failed, with a reason and a Retry)
// Only a person with the Content "approve" permission can approve; the approver and time are kept on the post. We hold the schedule:
// a tick every minute sends the due, approved posts to Zernio. Caps (per platform account per 24 hours, and the workspace's plan limits)
// never drop a post: it stays Scheduled with a message and goes out when the limit allows.
// Workspaces that are not switched on for Zernio posting keep the manual "tick it off" flow untouched.
import { all, get, run } from '../db.js';
import { currentTenant } from '../context.js';
import { bad, forbidden, jparse, notFound, now } from '../util.js';
import { notify } from '../audit.js';
import { hasPerm } from '../rbac.js';
import { getSetting as platformGet, setSetting as platformSet } from './platformConfig.js';
import { readRefBytes } from './storage.js';
import * as z from './zernio.js';
import { billingState } from './plans.js';

export const STAGES = ['draft', 'pending_approval', 'approved', 'scheduled', 'posted', 'failed'];
export const STAGE_LABEL = { draft: 'Draft', pending_approval: 'Waiting approval', approved: 'Approved', scheduled: 'Scheduled', posted: 'Posted', failed: 'Failed' };
/** Starting caps per platform account in any rolling 24 hours. Instagram 25 is the figure asked for; Zernio's own page says 100, so it is a setting. */
export const DEFAULT_CAPS = { instagram: 25 };
const UNREACHABLE_GIVE_UP_HOURS = 6;
const tid = () => currentTenant()?.id ?? null;

// ---- switches (platform settings)
export const listedWorkspaces = () => { try { return JSON.parse(platformGet('zernio_workspaces') || '[]').map(Number); } catch { return []; } };
export const setListedWorkspaces = (ids, by) => platformSet('zernio_workspaces', JSON.stringify([...new Set(ids.map(Number).filter(Number.isFinite))]), { by });
export const getCaps = () => { try { return { ...DEFAULT_CAPS, ...JSON.parse(platformGet('zernio_caps') || '{}') }; } catch { return { ...DEFAULT_CAPS }; } };
export function saveCaps(b, by) {
  const out = {};
  for (const p of Object.keys(z.PLATFORMS)) {
    const v = b?.[p]; if (v === '' || v == null) continue;
    const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1000) throw bad(`${z.PLATFORMS[p]} limit must be a whole number from 1 to 1000, or empty for no limit`);
    out[p] = n;
  }
  platformSet('zernio_caps', JSON.stringify(out), { by }); return { ...out };
}
/** Is Zernio posting switched on for the current workspace, and is a key available for it? */
export function postingState() {
  const listed = listedWorkspaces().includes(Number(tid()));
  const key_ready = !!z.keyFor();
  return { listed, key_ready, enabled: listed && key_ready, mode: z.mode(), platforms: z.PLATFORMS, caps: getCaps() };
}
const requireEnabled = () => { const s = postingState(); if (!s.listed) throw bad('Posting through the calendar is not switched on for your workspace.', { code: 'posting_off' }); if (!s.key_ready) throw bad('Posting is not set up yet. Ask your administrator to connect it.', { code: 'zernio_no_key' }); return s; };

// ---- accounts
export const listConnected = () => all("SELECT account_id, platform, name, username, status, connected_at FROM zernio_accounts WHERE status='connected' ORDER BY platform, name");
export async function syncAccounts() {
  requireEnabled();
  const live = await z.listAccounts(); const seen = new Set();
  for (const a of live) {
    seen.add(a.account_id);
    run(`INSERT INTO zernio_accounts(account_id,platform,name,username,status,connected_at,updated_at) VALUES(?,?,?,?, 'connected', ?,?)
      ON CONFLICT(account_id) DO UPDATE SET platform=excluded.platform, name=excluded.name, username=excluded.username, status='connected', updated_at=excluded.updated_at`, a.account_id, a.platform, a.name, a.username, now(), now());
  }
  for (const r of all("SELECT account_id FROM zernio_accounts WHERE status='connected'")) if (!seen.has(r.account_id)) run("UPDATE zernio_accounts SET status='disconnected', updated_at=? WHERE account_id=?", now(), r.account_id);
  return listConnected();
}
export async function disconnectAccount(accountId) {
  requireEnabled();
  if (!get('SELECT 1 FROM zernio_accounts WHERE account_id=?', accountId)) throw notFound();
  await z.removeAccount(accountId); run("UPDATE zernio_accounts SET status='disconnected', updated_at=? WHERE account_id=?", now(), accountId);
}

// ---- stage rules
const accountIds = (p) => jparse(p.account_ids, []);
const timeOf = (p) => { const m = /^(\d{1,2}):(\d{2})$/.exec(p.post_time || ''); return m ? `${m[1].padStart(2, '0')}:${m[2]}:00` : null; };
export const dueAt = (p) => (timeOf(p) ? `${p.post_date} ${timeOf(p)}` : null);
/** approved <-> scheduled depends only on whether the post has a time and at least one connected account. */
export function settle(p) {
  const ready = accountIds(p).length > 0 && !!timeOf(p);
  const stage = p.stage === 'approved' && ready ? 'scheduled' : p.stage === 'scheduled' && !ready ? 'approved' : p.stage;
  if (stage !== p.stage) run('UPDATE content_posts SET stage=?, updated_at=? WHERE id=?', stage, now(), p.id);
  return stage;
}
const load = (id) => { const p = get('SELECT * FROM content_posts WHERE id=?', Number(id)); if (!p) throw notFound(); return p; };
const hasMedia = (p) => !!(p.creative_path || p.source_kind);
const legacyStatus = (stage) => (stage === 'posted' ? 'posted' : stage === 'draft' ? 'planned' : 'ready');
const setStage = (p, stage, extra = {}) => {
  const d = { stage, status: legacyStatus(stage), updated_at: now(), ...extra }; const k = Object.keys(d);
  run(`UPDATE content_posts SET ${k.map((x) => `${x}=?`).join(',')} WHERE id=?`, ...k.map((x) => d[x]), p.id);
};

export function submit(id, user) {
  const p = load(id);
  if (!['draft', 'failed'].includes(p.stage)) throw bad('Only a draft can be sent for approval.');
  if (!(p.caption || '').trim() && !hasMedia(p)) throw bad('Add a caption or a picture or video first.');
  setStage(p, 'pending_approval', { submitted_by: user.id, submitted_at: now(), reject_note: null, fail_reason: null, blocked_reason: null });
  notifyApprovers(p, user);
  return load(p.id);
}
function notifyApprovers(p, user) {
  const ids = all("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 AND u.id<>?", user.id).map((x) => x.id).filter((uid) => { try { return hasPerm({ id: uid, ...rolePerms(uid) }, 'content', 'approve'); } catch { return false; } });
  if (ids.length) notify(ids, 'content', 'A post is waiting for your approval', p.title, '/content');
}
const rolePerms = (uid) => { const r = get('SELECT r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?', uid); return { role: r?.role, isSuper: r?.role === 'Super Admin', perms: new Set(all('SELECT rp.module,rp.action FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id WHERE u.id=?', uid).map((x) => `${x.module}:${x.action}`)) }; };

export function approve(id, user) {
  if (!hasPerm(user, 'content', 'approve')) throw forbidden('Only a person with approval rights can approve posts.');
  const p = load(id);
  if (!['pending_approval', 'draft', 'failed'].includes(p.stage)) throw bad('This post is not waiting for approval.');
  if (!(p.caption || '').trim() && !hasMedia(p)) throw bad('Add a caption or a picture or video first.');
  setStage(p, 'approved', { approved_by: user.id, approved_at: now(), reject_note: null, fail_reason: null, blocked_reason: null });
  const stage = settle(load(p.id));
  if (p.created_by && p.created_by !== user.id) notify(p.created_by, 'content', 'Your post was approved', p.title, '/content');
  return { ...load(p.id), stage };
}
export function reject(id, note, user) {
  if (!hasPerm(user, 'content', 'approve')) throw forbidden('Only a person with approval rights can send posts back.');
  const p = load(id);
  if (!['pending_approval', 'approved', 'scheduled'].includes(p.stage)) throw bad('This post cannot be sent back now.');
  setStage(p, 'draft', { approved_by: null, approved_at: null, reject_note: String(note || '').slice(0, 300) || null });
  if (p.submitted_by && p.submitted_by !== user.id) notify(p.submitted_by, 'content', 'A post was sent back', `${p.title}${note ? `: ${String(note).slice(0, 120)}` : ''}`, '/content');
  return load(p.id);
}
/** Called after a post is edited: changed words, media or accounts need a fresh approval; moving the date or time does not. */
export function afterEdit(before, after, changed) {
  if (!['approved', 'scheduled'].includes(before.stage)) return after.stage;
  if (changed.some((k) => ['title', 'caption', 'account_ids', 'creative'].includes(k))) { setStage(after, 'pending_approval', { approved_by: null, approved_at: null, blocked_reason: null }); return 'pending_approval'; }
  return settle(load(after.id));
}

// ---- Studio > calendar
export function fromStudio({ kind, id, caption }, user) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let title, post_type, source_kind, text = String(caption || '').trim();
  if (kind === 'reel') {
    const j = get("SELECT id,title,script FROM creative_jobs WHERE id=? AND status='done' AND video_ref IS NOT NULL", Number(id)); if (!j) throw bad('That reel is not ready yet.');
    title = j.title || 'Reel'; post_type = 'reel'; source_kind = 'reel'; text = text || '';
  } else {
    const it = get('SELECT id,kind,title,body,file_ref FROM creative_items WHERE id=?', Number(id)); if (!it) throw notFound();
    title = it.title || 'Creative'; post_type = 'static'; source_kind = it.file_ref ? 'item' : 'story'; text = text || String(it.body || '').slice(0, 2000);
  }
  const rid = Number(run(`INSERT INTO content_posts(title,post_type,caption,platforms,post_date,status,stage,source_kind,source_id,created_by,assigned_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    String(title).slice(0, 140), post_type, text || null, '[]', tomorrow, 'planned', 'draft', source_kind, Number(id), user.id, user.id, now(), now()).lastInsertRowid);
  return load(rid);
}
/** The file a post will publish: its own upload, or the Studio creation it came from. */
function mediaOf(p) {
  if (p.creative_path) return { ref: p.creative_path, mime: p.creative_mime || 'application/octet-stream', name: p.creative_name || 'creative' };
  if (p.source_kind === 'item') { const it = get('SELECT file_ref,mime FROM creative_items WHERE id=?', p.source_id); if (it?.file_ref) return { ref: it.file_ref, mime: it.mime || 'image/png', name: `post-${p.id}.${(it.mime || 'image/png').split('/')[1] || 'png'}` }; }
  if (p.source_kind === 'reel') { const j = get('SELECT video_ref FROM creative_jobs WHERE id=?', p.source_id); if (j?.video_ref) return { ref: j.video_ref, mime: 'video/mp4', name: `reel-${p.id}.mp4` }; }
  return null;
}

// ---- caps
const rolling24 = (accountId, nowMs = Date.now()) => {
  const since = nowMs - 24 * 3600 * 1000; let n = 0;
  for (const r of all("SELECT results FROM content_posts WHERE results LIKE ? AND last_attempt_at IS NOT NULL", `%${accountId}%`)) { const e = jparse(r.results, {})[accountId]; if (e?.at && Date.parse(e.at) >= since && ['published', 'publishing'].includes(e.status)) n += 1; }
  return n;
};
function planCaps() { try { const l = billingState(currentTenant()).limits || {}; return { per_day: l.posts_per_day ?? null, per_month: l.posts_per_month ?? null }; } catch { return { per_day: null, per_month: null }; } }
/** Posts this workspace published through Zernio on a day (YYYY-MM-DD) or in a month (YYYY-MM), in workspace time. */
const countPublished = (prefix) => all("SELECT posted FROM content_posts WHERE stage='posted'").filter((r) => Object.values(jparse(r.posted, {})).some((t) => String(t).startsWith(prefix))).length;
/** What the plan's posting caps look like right now, for the plan card: posts made today / this month against the caps. */
export function postsUsage() { const pc = planCaps(), day = now().slice(0, 10); return { per_day: pc.per_day, per_month: pc.per_month, today: countPublished(day), month: countPublished(day.slice(0, 7)) }; }
/** A reason the post cannot go out right now, or null. */
export function capReason(p, accounts) {
  const caps = getCaps();
  for (const a of accounts) { const cap = caps[a.platform]; if (cap && rolling24(a.account_id) >= cap) return `${z.PLATFORMS[a.platform]} allows ${cap} posts in 24 hours for ${a.name || 'this account'}. This post stays in the calendar and goes out when the limit allows.`; }
  const pc = planCaps(); const day = now().slice(0, 10);
  if (pc.per_day != null && countPublished(day) >= pc.per_day) return `Your plan allows ${pc.per_day} posts a day. This post stays in the calendar and goes out tomorrow.`;
  if (pc.per_month != null && countPublished(day.slice(0, 7)) >= pc.per_month) return `Your plan allows ${pc.per_month} posts a month. This post stays in the calendar until next month or until you upgrade.`;
  return null;
}

// ---- publishing
const inFlight = new Set();
const isoNow = () => new Date().toISOString();
const okStatus = (s) => /^(published|success|completed|posted)$/i.test(s || '');
const badStatus = (s) => /^(failed|error|rejected|cancelled|canceled)$/i.test(s || '');

/** Send one approved, due post to Zernio. */
async function publishOne(p) {
  const wanted = accountIds(p);
  const accounts = all(`SELECT * FROM zernio_accounts WHERE status='connected' AND account_id IN (${wanted.map(() => '?').join(',') || "''"})`, ...wanted);
  const prev = jparse(p.results, {});
  const todo = accounts.filter((a) => prev[a.account_id]?.status !== 'published');
  if (!todo.length) { return setFailed(p, 'None of the chosen accounts is connected any more. Connect an account and press Retry.'); }
  const media = mediaOf(p);
  if (todo.some((a) => a.platform === 'instagram') && !media) return setFailed(p, 'Instagram posts need a picture or video. Add one and press Retry.');
  const blocked = capReason(p, todo);
  if (blocked) { run('UPDATE content_posts SET blocked_reason=?, updated_at=? WHERE id=?', blocked, now(), p.id); return; }
  const content = (p.caption || p.title || '').trim();
  const started = isoNow();
  try {
    const items = [];
    if (media) { const buf = await readRefBytes(media.ref); items.push({ url: await z.uploadMedia(buf, { filename: media.name, contentType: media.mime }), type: media.mime.startsWith('video') ? 'video' : 'image' }); }
    const out = await z.publishNow({ content, media: items, accounts: todo, idKey: `erp-t${tid()}-p${p.id}-a${p.attempts || 0}` });
    const results = { ...prev }; for (const a of todo) results[a.account_id] = { status: 'publishing', at: started, platform: a.platform };
    run('UPDATE content_posts SET zernio_post_id=?, results=?, last_attempt_at=?, blocked_reason=NULL, fail_reason=NULL, updated_at=? WHERE id=?', out.id, JSON.stringify(results), started, now(), p.id);
    await refreshOne(load(p.id), out);
  } catch (e) {
    if (e.code === 'zernio_unreachable' || e.code === 'zernio_rate') {
      // both clocks are workspace wall-clock strings, so their difference is real elapsed time
      const late = Date.parse(`${now().replace(' ', 'T')}Z`) - Date.parse(`${dueAt(p).replace(' ', 'T')}Z`) > UNREACHABLE_GIVE_UP_HOURS * 3600 * 1000;
      if (!late) { run('UPDATE content_posts SET blocked_reason=?, updated_at=? WHERE id=?', `${e.message} It will be tried again.`, now(), p.id); return; }
    }
    setFailed(p, e.message || 'The post could not be sent.');
  }
}
function setFailed(p, reason) {
  setStage(p, 'failed', { fail_reason: String(reason).slice(0, 400), blocked_reason: null, attempts: (p.attempts || 0) + 1, last_attempt_at: isoNow() });
  if (p.created_by) notify(p.created_by, 'content', 'A post could not be published', `${p.title}: ${String(reason).slice(0, 140)}`, '/content');
}

/** Read Zernio's answer for a post and move it to Posted or Failed (or leave it while Zernio is still working). */
export async function refreshOne(p, known) {
  if (!p.zernio_post_id) return p;
  const info = known && known.platforms?.length ? known : await z.getPost(p.zernio_post_id);
  const results = jparse(p.results, {}); const posted = jparse(p.posted, {}); const errors = [];
  for (const pl of info.platforms || []) {
    const id = String(pl.accountId?._id || pl.accountId || pl.account?._id || ''); if (!results[id]) continue;
    const st = String(pl.status || ''); const url = pl.platformPostUrl || pl.url || null;
    if (okStatus(st)) { results[id] = { ...results[id], status: 'published', url, at: results[id].at }; posted[results[id].platform] = now(); }
    else if (badStatus(st)) { results[id] = { ...results[id], status: 'failed', error: String(pl.error || pl.errorMessage || 'The platform refused this post').slice(0, 300) }; errors.push(`${z.PLATFORMS[results[id].platform] || results[id].platform}: ${results[id].error}`); }
  }
  // when Zernio gives no per-account detail, its overall status decides for every account still in flight
  if (!(info.platforms || []).length) for (const id of Object.keys(results)) if (results[id].status === 'publishing') {
    if (okStatus(info.status)) { results[id].status = 'published'; posted[results[id].platform] = now(); } else if (badStatus(info.status)) { results[id].status = 'failed'; results[id].error = 'The platform refused this post'; errors.push(results[id].error); }
  }
  const vals = Object.values(results);
  const wanted = accountIds(p);
  const done = wanted.every((a) => results[a]?.status === 'published');
  const anyBad = vals.some((v) => v.status === 'failed');
  const active = vals.some((v) => v.status === 'publishing');
  const base = { results: JSON.stringify(results), posted: JSON.stringify(posted) };
  if (done) { setStage(p, 'posted', { ...base, fail_reason: null, blocked_reason: null }); if (p.created_by) notify(p.created_by, 'content', 'Your post is published', p.title, '/content'); }
  else if (anyBad && !active) { run('UPDATE content_posts SET results=?, posted=? WHERE id=?', base.results, base.posted, p.id); setFailed(load(p.id), errors.join(' | ') || 'The platform refused this post.'); }
  else run('UPDATE content_posts SET results=?, posted=? WHERE id=?', base.results, base.posted, p.id);
  return load(p.id);
}

/** Tick, once a minute per workspace: send what is due, and look again at posts Zernio is still working on. */
export async function runDue() {
  if (!postingState().enabled) return 0;
  let n = 0;
  const waiting = all("SELECT * FROM content_posts WHERE stage='scheduled' AND zernio_post_id IS NOT NULL LIMIT 20");
  for (const p of waiting) { if (inFlight.has(p.id)) continue; inFlight.add(p.id); try { await refreshOne(p); } catch (e) { console.error('[zernio] refresh', p.id, e.message); } finally { inFlight.delete(p.id); } }
  const stamp = now();
  const due = all("SELECT * FROM content_posts WHERE stage='scheduled' AND zernio_post_id IS NULL AND post_date<=? ORDER BY post_date, post_time LIMIT 10", stamp.slice(0, 10)).filter((p) => dueAt(p) && dueAt(p) <= stamp);
  for (const p of due) { if (inFlight.has(p.id)) continue; inFlight.add(p.id); try { await publishOne(p); n += 1; } catch (e) { console.error('[zernio] publish', p.id, e.message); } finally { inFlight.delete(p.id); } }
  return n;
}

/** Try a failed post again: only the accounts that did not succeed are sent. */
export async function retry(id, user) {
  requireEnabled();
  const p = load(id);
  if (p.stage !== 'failed') throw bad('Only a failed post can be retried.');
  if (!p.approved_by && !hasPerm(user, 'content', 'approve')) throw forbidden('This post was never approved. Ask an approver to approve it.');
  const results = jparse(p.results, {}); for (const k of Object.keys(results)) if (results[k].status !== 'published') delete results[k];
  setStage(p, 'scheduled', { results: JSON.stringify(results), zernio_post_id: null, fail_reason: null, blocked_reason: null, post_date: p.post_date < now().slice(0, 10) ? now().slice(0, 10) : p.post_date, post_time: p.post_time || now().slice(11, 16) });
  const fresh = load(p.id);
  inFlight.add(p.id); try { await publishOne({ ...fresh }); } finally { inFlight.delete(p.id); }
  return load(p.id);
}

/** A Zernio event names a workspace through profiles[].externalId; the post is then re-read from Zernio, never trusted from the payload. */
export async function applyEvent(ev) {
  const ext = (ev.profiles || []).map((x) => x.externalId).find((x) => /^tenant-\d+$/.test(String(x)));
  return ext ? Number(ext.slice(7)) : null;
}
export async function refreshForEvent(ev) {
  const postId = ev.post?._id || ev.post?.id || ev.postId || null;
  if (postId) { const p = get('SELECT * FROM content_posts WHERE zernio_post_id=?', String(postId)); if (p && p.stage === 'scheduled') await refreshOne(p); }
  if (/^account\./.test(String(ev.event || ''))) await syncAccounts().catch(() => {});
}
