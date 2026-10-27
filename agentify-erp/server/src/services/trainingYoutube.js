// The console's training-video library and posting to YouTube.
//
// Videos are not served from this server to workspaces. The Super Admin posts each video to the platform's YouTube
// channel (YouTube Data API, using the same Google OAuth client as "Continue with Google"); the link, title and
// description saved here are what every workspace shows in its own Training videos page. Server copies are then only a
// fallback the Super Admin can delete.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { platformDb } from '../platform.js';
import { DATA_DIR } from '../db.js';
import { getSetting, setSetting } from './platformConfig.js';
import { appCreds, refreshAccessToken } from './oauthApps.js';
import { bad, notFound } from '../util.js';

export const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
export const SHIPPED = path.join(ASSETS, 'training');
export const UPLOADS = path.join(DATA_DIR, 'console-training');
export const PRIVACY = ['unlisted', 'public', 'private'];
export const CATEGORIES = ['System overview', 'Administration', 'Sales & CRM', 'Properties & projects', 'Accounting', 'Land & investors', 'HR & payroll', 'Website & marketing', 'Portals', 'Other'];
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const TOKEN_KEY = 'youtube_refresh_token', WHO_KEY = 'youtube_account', CH_ID_KEY = 'youtube_channel_id', CH_TITLE_KEY = 'youtube_channel_title', EXPECT_KEY = 'youtube_expected_channel', REV_KEY = 'training_rev';
const posting = new Set();
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const db = () => platformDb();

export function manifest() {
  try { return JSON.parse(fs.readFileSync(path.join(SHIPPED, 'manifest.json'), 'utf8')); } catch { return []; }
}
const shippedFile = (key) => ['mp4', 'webm'].map((e) => `@assets/training/${key}.${e}`).find((f) => fs.existsSync(path.join(ASSETS, f.slice(8))));
/** Absolute path of a record's server copy, or null when there is none (never posted-and-removed, never missing). */
export function fileOf(row) {
  if (!row?.file || row.file_removed) return null;
  const f = row.file.startsWith('@assets/') ? path.join(ASSETS, row.file.slice(8)) : path.join(DATA_DIR, row.file);
  return (f.startsWith(ASSETS) || f.startsWith(UPLOADS)) && fs.existsSync(f) ? f : null;
}

/** Bumped on every change, so workspaces know to re-read the library the next time they open it. */
export const revision = () => Number(getSetting(REV_KEY)) || 0;
const bump = () => setSetting(REV_KEY, String(revision() + 1));

/** The shipped videos become console records the first time the library is opened; later edits in the console are kept. */
function sync() {
  const ins = db().prepare('INSERT OR IGNORE INTO training_posts(key,title,description,category,roles,sort_order,seconds,file,size,mime) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const it of manifest()) {
    const file = shippedFile(it.key); if (!file) continue;
    const abs = path.join(ASSETS, file.slice(8));
    ins.run(it.key, it.title, it.description || '', CATEGORIES.includes(it.category) ? it.category : 'Other', JSON.stringify(it.roles || []), it.order ?? 100, it.seconds ?? null, file, fs.statSync(abs).size, file.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
  }
}

const present = (r) => ({ key: r.key, title: r.title, description: r.description, category: r.category, roles: JSON.parse(r.roles || '[]'), seconds: r.seconds, size: r.size, privacy: r.privacy,
  status: r.status, error: r.error, youtube_url: r.youtube_url, posted_at: r.posted_at, posted_by: r.posted_by, youtube_channel: r.youtube_channel, server_copy: !!fileOf(r), uploaded: !r.file?.startsWith('@assets/') });
export function listVideos() {
  sync();
  // a restart in the middle of an upload leaves 'posting' behind
  for (const r of db().prepare("SELECT key FROM training_posts WHERE status='posting'").all()) if (!posting.has(r.key)) db().prepare("UPDATE training_posts SET status='failed', error='The upload was interrupted. Post it again.' WHERE key=?").run(r.key);
  return db().prepare('SELECT * FROM training_posts ORDER BY sort_order, created_at, key').all().map(present);
}
/** Role names the console can offer (the ones the shipped videos already use, plus the administrators). */
export const roleNames = () => [...new Set([...manifest().flatMap((m) => m.roles || []), 'Super Admin', 'Admin'])].sort();

export const rowOf = (key) => { const r = db().prepare('SELECT * FROM training_posts WHERE key=?').get(String(key)); if (!r) throw notFound('Video not found'); return r; };
const cleanRoles = (v) => { const ok = new Set(roleNames()); return [...new Set((Array.isArray(v) ? v : []).map((x) => String(x)).filter((x) => ok.has(x)))]; };

export function addUpload(file, body, by) {
  const title = str(body.title, 100);
  if (!title) { fs.rmSync(file.path, { force: true }); throw bad('Give the video a title'); }
  const key = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let roles = body.roles; if (typeof roles === 'string') { try { roles = JSON.parse(roles); } catch { roles = []; } }
  db().prepare('INSERT INTO training_posts(key,title,description,category,roles,sort_order,seconds,file,size,mime,posted_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(key, title, str(body.description, 600), CATEGORIES.includes(body.category) ? body.category : 'Other', JSON.stringify(cleanRoles(roles)), 200, Math.round(Number(body.seconds)) || null, `console-training/${path.basename(file.path)}`, file.size, file.mimetype, by || null);
  bump();
  return key;
}
export function updateVideo(key, body) {
  const r = rowOf(key);
  const roles = body.roles === undefined ? r.roles : JSON.stringify(cleanRoles(body.roles));
  const title = str(body.title ?? r.title, 100); if (!title) throw bad('Give the video a title');
  db().prepare("UPDATE training_posts SET title=?, description=?, category=?, roles=?, updated_at=datetime('now') WHERE key=?")
    .run(title, str(body.description ?? r.description, 600), CATEGORIES.includes(body.category) ? body.category : r.category, roles, r.key);
  bump();
}
export function removeCopy(key) {
  const r = rowOf(key);
  if (!r.youtube_url) throw bad('Post the video to YouTube first. Until then the server copy is the only copy.');
  const f = fileOf(r); if (f) fs.rmSync(f, { force: true });
  db().prepare('UPDATE training_posts SET file_removed=1 WHERE key=?').run(r.key); bump();
}
export function deleteVideo(key) {
  const r = rowOf(key);
  if (r.status === 'posting') throw bad('This video is being posted right now. Try again in a minute.');
  if (r.file?.startsWith('@assets/')) throw bad('Videos shipped with the system cannot be deleted. After posting, use "Delete server copy".');
  const f = fileOf(r); if (f) fs.rmSync(f, { force: true });
  db().prepare('DELETE FROM training_posts WHERE key=?').run(r.key); bump();
}
/**
 * Forget the YouTube link (the video was deleted on YouTube or went to the wrong channel) so it can be posted again.
 * The video on YouTube is not touched: the upload permission cannot delete it. A shipped video's file is usable again;
 * a console upload has no server copy left and must be uploaded again.
 */
export function unlink(key) {
  const r = rowOf(key);
  if (r.status === 'posting') throw bad('This video is being posted right now. Try again in a minute.');
  if (!r.youtube_url) throw bad('This video is not linked to YouTube.');
  db().prepare("UPDATE training_posts SET youtube_id=NULL, youtube_url=NULL, youtube_channel=NULL, posted_at=NULL, status='ready', error=NULL, file_removed=0, updated_at=datetime('now') WHERE key=?").run(r.key);
  bump();
  return { server_copy: !!fileOf(rowOf(key)) };
}
/** The posted videos every workspace shows (a link, never the file). */
export function postedVideos() {
  return db().prepare("SELECT * FROM training_posts WHERE youtube_url IS NOT NULL AND youtube_url<>'' ORDER BY sort_order, created_at").all()
    .map((r) => ({ key: r.key, title: r.title, description: r.description, category: r.category, roles: JSON.parse(r.roles || '[]'), seconds: r.seconds, order: r.sort_order, youtube_url: r.youtube_url }));
}

// ---- the YouTube connection
export const googleReady = () => !!appCreds('google');
export function youtubeStatus() {
  const connected = !!getSetting(TOKEN_KEY);
  return { state: !googleReady() ? 'not_configured' : connected ? 'connected' : 'not_connected', account: connected ? getSetting(WHO_KEY) : null,
    channel: connected ? { id: getSetting(CH_ID_KEY) || null, title: getSetting(CH_TITLE_KEY) || null } : null, expected_channel: getSetting(EXPECT_KEY) || '',
    redirect_path: '/api/platform/oauth/google/callback' };
}
/** Which channel will uploads land on? Asked right after the connection is made (needs the read-only YouTube permission). */
async function lookupChannel(accessToken) {
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${accessToken}` } });
    const d = await r.json().catch(() => ({}));
    const c = d.items?.[0];
    return c ? { id: c.id, title: c.snippet?.title || '' } : null;
  } catch { return null; }
}
export async function saveConnection(refreshToken, account, by, accessToken) {
  if (!refreshToken) throw bad('Google did not return a long-lived permission. Remove Agentify ERP from your Google account permissions and connect again.');
  const ch = accessToken ? await lookupChannel(accessToken) : null;
  setSetting(TOKEN_KEY, refreshToken, { secret: true, by }); setSetting(WHO_KEY, account || '', { by });
  setSetting(CH_ID_KEY, ch?.id || null); setSetting(CH_TITLE_KEY, ch?.title || null);
}
export function disconnect() { for (const k of [TOKEN_KEY, WHO_KEY, CH_ID_KEY, CH_TITLE_KEY]) setSetting(k, null); }
/** Optional safety: refuse to post unless the connected channel is this one (e.g. UC...). Empty turns the check off. */
export function setExpectedChannel(id, by) {
  const v = String(id || '').trim();
  if (v && !/^UC[\w-]{20,24}$/.test(v)) throw bad('A channel ID looks like UCZ7dBMnkt2tstp1KN1znPWg (YouTube Studio > Settings > Channel > Advanced settings).');
  setSetting(EXPECT_KEY, v || null, { by });
}
/** Use a video that was uploaded by hand in YouTube Studio (for example to a channel the API cannot reach). */
export function linkExisting(key, url, by) {
  const r = rowOf(key);
  if (r.status === 'posting') throw bad('This video is being posted right now. Try again in a minute.');
  const m = String(url || '').trim().match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?![\w-])/);
  if (!m) throw bad('Paste a YouTube video link, like https://www.youtube.com/watch?v=XXXXXXXXXXX');
  db().prepare("UPDATE training_posts SET status='posted', youtube_id=?, youtube_url=?, youtube_channel=NULL, posted_at=datetime('now'), posted_by=?, error=NULL WHERE key=?").run(m[1], `https://www.youtube.com/watch?v=${m[1]}`, by || null, r.key);
  bump();
}

const friendly = (status, data) => {
  const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || '';
  const msg = data?.error?.message || '';
  if (/quotaExceeded|rateLimitExceeded/i.test(reason)) return 'YouTube\'s daily upload quota for this project is used up. It resets at midnight Pacific time; try again then, or ask Google for more quota.';
  if (/uploadLimitExceeded/i.test(reason)) return 'This YouTube channel has reached its upload limit for now. Try again later.';
  if (/youtubeSignupRequired|unauthorized_client/i.test(reason + msg)) return 'The Google account has no YouTube channel yet. Create one at youtube.com and connect again.';
  if (/accessNotConfigured|has not been used|disabled/i.test(reason + msg)) return 'The YouTube Data API v3 is not switched on in the Google Cloud project. Enable it under APIs & Services > Library.';
  if (/invalid_grant/i.test(reason + msg)) return 'Google no longer accepts the saved YouTube connection (it was revoked or expired). Connect YouTube again.';
  if (status === 401 || status === 403) return `YouTube refused the upload: ${msg || reason || status}`;
  return `YouTube answered ${status}${msg ? `: ${msg}` : ''}`;
};

/** Starts the upload and returns at once; the console polls the list. Never throws once started: a failure is saved on the record. */
export function startPost(key, { privacy = 'unlisted' } = {}, by = null, deps = {}) {
  const r = rowOf(key);
  if (!PRIVACY.includes(privacy)) throw bad('Visibility is unlisted, public or private');
  const st = youtubeStatus();
  if (st.state === 'not_configured') throw bad('YouTube is not set up yet. Add the Google client ID and secret first (Integrations > Google).');
  if (st.state === 'not_connected') throw bad('Connect the YouTube channel first.');
  if (r.youtube_url) throw bad('This video is already on YouTube.');
  if (st.expected_channel) {
    if (!st.channel?.id) throw bad('YouTube must be connected again before the channel can be checked against the expected channel.');
    if (st.channel.id !== st.expected_channel) throw bad(`The connected YouTube channel is ${st.channel.title || st.channel.id} (${st.channel.id}), not the expected ${st.expected_channel}. Nothing was posted. Connect the right Google account, or use "Link a YouTube video".`);
  }
  if (r.status === 'posting' || posting.has(r.key)) throw bad('This video is already being posted.');
  const file = fileOf(r); if (!file) throw bad('The video file is missing on the server, so it cannot be posted.');
  db().prepare("UPDATE training_posts SET status='posting', error=NULL, privacy=? WHERE key=?").run(privacy, r.key);
  posting.add(r.key);
  const done = (fn) => { posting.delete(r.key); fn(); bump(); };
  const job = upload(r, file, privacy, deps).then(
    ({ id, channelId }) => done(() => {
      db().prepare("UPDATE training_posts SET status='posted', youtube_id=?, youtube_url=?, youtube_channel=?, posted_at=datetime('now'), posted_by=?, error=NULL WHERE key=?").run(id, `https://www.youtube.com/watch?v=${id}`, channelId || null, by, r.key);
      // a copy uploaded to the console has no other use; the files shipped with the system are kept until deleted on purpose
      if (!r.file.startsWith('@assets/')) { fs.rmSync(file, { force: true }); db().prepare('UPDATE training_posts SET file_removed=1 WHERE key=?').run(r.key); }
    }),
    (e) => done(() => db().prepare("UPDATE training_posts SET status='failed', error=? WHERE key=?").run(String(e.message || e).slice(0, 400), r.key)));
  return job;
}

async function upload(r, file, privacy, { fetchFn = fetch } = {}) {
  let access;
  try { access = (await refreshAccessToken('google', getSetting(TOKEN_KEY))).access_token; } catch (e) { throw new Error(friendly(400, { error: { message: String(e.message) } })); }
  const meta = { snippet: { title: r.title.replace(/[<>]/g, '').slice(0, 100), description: String(r.description || '').replace(/[<>]/g, '').slice(0, 5000), categoryId: '27' }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } };
  const size = fs.statSync(file).size, mime = r.mime || 'video/mp4';
  const init = await fetchFn(`${YT_UPLOAD}?uploadType=resumable&part=snippet,status`, { method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': mime }, body: JSON.stringify(meta) });
  if (!init.ok) throw new Error(friendly(init.status, await init.json().catch(() => ({}))));
  const url = init.headers.get('location'); if (!url) throw new Error('YouTube did not give an upload address');
  const res = await fetchFn(url, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(size) }, body: Readable.toWeb(fs.createReadStream(file)), duplex: 'half' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error(friendly(res.status, data));
  return { id: data.id, channelId: data.snippet?.channelId };
}
