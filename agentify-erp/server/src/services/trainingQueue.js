// Automatic YouTube upload queue for the shipped training course (3 full-course videos, then 25 lessons in English, Urdu and Arabic).
// The videos already live on the server (server/assets/promo/training), so nothing is downloaded or re-uploaded by hand: a timer posts
// them one at a time to the connected YouTube channel, up to a daily limit that fits Google's default quota (about 1,600 units per
// upload, 10,000 a day). After each upload the thumbnail is set and the video is added to its language playlist; both are best effort
// and never undo the upload. Starts switched OFF; the Super Admin turns it on in Console > System > Training videos.
import fs from 'node:fs';
import path from 'node:path';
import { platformDb } from '../platform.js';
import { getSetting, setSetting } from './platformConfig.js';
import { ASSETS, PRIVACY, upload, friendly, accessToken, assertReadyToPost, youtubeStatus } from './trainingYoutube.js';
import { TRAINING } from './trainingDraftsData.js';
import { bad } from '../util.js';

export const DIR = path.join(ASSETS, 'promo', 'training');
const THUMBS = path.join(DIR, 'thumbs');
const K = { on: 'yt_queue_on', limit: 'yt_queue_limit', privacy: 'yt_queue_privacy', pause: 'yt_queue_pause_until', note: 'yt_queue_note' };
const MAX_ATTEMPTS = 3;
export const PLAYLISTS = { en: 'Agentify ERP Training (English)', ur: 'ایجنٹیفائی ای آر پی تربیت (اردو)', ar: 'تدريب أجنتيفاي ERP (العربية)' };
const db = () => platformDb();
let running = false;

const langOf = (file) => (file.match(/-(en|ur|ar)\.mp4$/) || [])[1] || 'en';
/** Full courses first, then the lessons of English, Urdu and Arabic one language at a time, each in lesson order. */
const order = () => [...TRAINING].sort((a, b) => {
  const full = (t) => (t.file.includes('full-course') ? 0 : 1), lang = (t) => ['en', 'ur', 'ar'].indexOf(langOf(t.file));
  return full(a) - full(b) || lang(a) - lang(b) || a.no - b.no;
});

function ensureTable() {
  db().exec(`CREATE TABLE IF NOT EXISTS youtube_queue(file TEXT PRIMARY KEY, pos INTEGER NOT NULL, lang TEXT, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0, error TEXT, youtube_id TEXT, youtube_url TEXT, posted_at TEXT, posted_day TEXT, thumb TEXT, playlist TEXT, playlist_note TEXT)`);
}
/** Puts every shipped training video in the queue once; resets uploads that a restart interrupted. */
export function seed() {
  ensureTable();
  const ins = db().prepare('INSERT OR IGNORE INTO youtube_queue(file,pos,lang,title,description) VALUES(?,?,?,?,?)');
  order().forEach((t, i) => { if (fs.existsSync(path.join(DIR, t.file))) ins.run(t.file, i + 1, langOf(t.file), t.yt, t.body); });
  db().prepare("UPDATE youtube_queue SET status='queued', error='The upload was interrupted. It will be tried again.' WHERE status='posting'").run();
}

const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // Google's quota resets at midnight Pacific time
export function settings() {
  const limit = Math.min(10, Math.max(1, Math.round(Number(getSetting(K.limit))) || 6));
  const privacy = PRIVACY.includes(getSetting(K.privacy)) ? getSetting(K.privacy) : 'unlisted';
  return { on: getSetting(K.on) === '1', limit, privacy, paused_until: getSetting(K.pause) || null, note: getSetting(K.note) || '' };
}
export function saveSettings(body, by) {
  if (body.limit !== undefined) { const n = Math.round(Number(body.limit)); if (!(n >= 1 && n <= 10)) throw bad('The daily limit is between 1 and 10 uploads'); setSetting(K.limit, String(n), { by }); }
  if (body.privacy !== undefined) { if (!PRIVACY.includes(body.privacy)) throw bad('Visibility is unlisted, public or private'); setSetting(K.privacy, body.privacy, { by }); }
  if (body.on !== undefined) {
    if (body.on) { try { assertReadyToPost(); } catch (e) { throw bad(e.message); } }
    setSetting(K.on, body.on ? '1' : '0', { by }); setSetting(K.pause, null); setSetting(K.note, null);
  }
}
export function view() {
  seed();
  const rows = db().prepare('SELECT file,pos,lang,title,status,attempts,error,youtube_url,posted_at,thumb,playlist,playlist_note FROM youtube_queue ORDER BY pos').all();
  const n = (s) => rows.filter((r) => r.status === s).length;
  return { settings: settings(), today: db().prepare('SELECT COUNT(*) c FROM youtube_queue WHERE posted_day=?').get(day()).c, counts: { queued: n('queued'), posting: n('posting'), posted: n('posted'), failed: n('failed') },
    youtube: youtubeStatus(), playlists: PLAYLISTS, rows };
}
export function retry(file) {
  const r = db().prepare('SELECT status FROM youtube_queue WHERE file=?').get(String(file));
  if (!r) throw bad('Video not found');
  if (r.status !== 'failed') throw bad('Only a failed upload can be retried.');
  db().prepare("UPDATE youtube_queue SET status='queued', attempts=0, error=NULL WHERE file=?").run(file);
}

const quotaError = (m) => /quota|upload limit/i.test(m);
const pacificMidnightPlus = () => new Date(Date.now() + 6 * 3600e3).toISOString(); // a quota stop is retried after a few hours

async function yt(method, url, token, body, fetchFn = fetch, headers = {}) {
  const r = await fetchFn(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}), ...headers }, body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(friendly(r.status, d));
  return d;
}
async function setThumbnail(id, file, token, fetchFn) {
  const f = path.join(THUMBS, file.replace(/\.mp4$/, '.jpg'));
  if (!fs.existsSync(f)) return 'none';
  await yt('POST', `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}&uploadType=media`, token, fs.readFileSync(f), fetchFn, { 'Content-Type': 'image/jpeg' });
  return 'set';
}
async function playlistId(lang, token, privacy, fetchFn) {
  const key = `yt_playlist_${lang}`; const saved = getSetting(key); if (saved) return saved;
  const list = await yt('GET', 'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50', token, null, fetchFn);
  let id = list.items?.find((p) => p.snippet?.title === PLAYLISTS[lang])?.id;
  if (!id) id = (await yt('POST', 'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', token, JSON.stringify({ snippet: { title: PLAYLISTS[lang], description: 'Agentify ERP step-by-step training videos.' }, status: { privacyStatus: privacy === 'private' ? 'private' : 'public' } }), fetchFn)).id;
  setSetting(key, id); return id;
}
async function addToPlaylist(row, token, privacy, fetchFn) {
  const pl = await playlistId(row.lang, token, privacy, fetchFn);
  await yt('POST', 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', token, JSON.stringify({ snippet: { playlistId: pl, resourceId: { kind: 'youtube#video', videoId: row.youtube_id } } }), fetchFn);
  return pl;
}
const needsReconnect = (m) => /insufficient|scope|permission/i.test(m) ? 'Reconnect YouTube once (Connect YouTube) to allow playlists.' : m;

/** Posts the next queued video when allowed. Returns what happened, for the console button and the tests. */
export async function tick({ force = false, fetchFn = fetch, uploadFn = upload, tokenFn = accessToken } = {}) {
  if (running) return { state: 'busy' };
  seed();
  const s = settings();
  if (!s.on && !force) return { state: 'off' };
  running = true;
  try {
    if (s.paused_until && s.paused_until > new Date().toISOString()) return { state: 'paused', until: s.paused_until };
    try { assertReadyToPost(); } catch (e) { setSetting(K.note, e.message); return { state: 'not-ready', note: e.message }; }
    const done = db().prepare('SELECT COUNT(*) c FROM youtube_queue WHERE posted_day=?').get(day()).c;
    if (done >= s.limit) return { state: 'limit', done };
    const row = db().prepare("SELECT * FROM youtube_queue WHERE status='queued' ORDER BY pos LIMIT 1").get();
    if (!row) { await finishExtras(s, fetchFn, tokenFn); return { state: 'empty' }; }
    db().prepare("UPDATE youtube_queue SET status='posting', error=NULL WHERE file=?").run(row.file);
    try {
      const { id } = await uploadFn({ title: row.title, description: row.description, mime: 'video/mp4' }, path.join(DIR, row.file), s.privacy, { fetchFn });
      db().prepare("UPDATE youtube_queue SET status='posted', youtube_id=?, youtube_url=?, posted_at=datetime('now'), posted_day=?, error=NULL WHERE file=?").run(id, `https://www.youtube.com/watch?v=${id}`, day(), row.file);
      setSetting(K.note, null);
    } catch (e) {
      const m = String(e.message || e).slice(0, 400);
      if (quotaError(m)) { db().prepare("UPDATE youtube_queue SET status='queued', error=? WHERE file=?").run(m, row.file); setSetting(K.pause, pacificMidnightPlus()); setSetting(K.note, m); return { state: 'quota', error: m }; }
      const attempts = row.attempts + 1;
      db().prepare('UPDATE youtube_queue SET status=?, attempts=?, error=? WHERE file=?').run(attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', attempts, m, row.file);
      return { state: 'failed', error: m };
    }
    await finishExtras(s, fetchFn, tokenFn);
    return { state: 'posted', file: row.file };
  } finally { running = false; }
}
/** Thumbnails and playlists for videos that are on YouTube; a refusal is written next to the video and tried again later. */
async function finishExtras(s, fetchFn, tokenFn) {
  const rows = db().prepare("SELECT * FROM youtube_queue WHERE status='posted' AND (thumb IS NULL OR thumb='error' OR playlist IS NULL) ORDER BY pos").all();
  if (!rows.length) return;
  let token; try { token = await tokenFn(); } catch { return; }
  let thumbsBlocked = false, listsBlocked = false;
  for (const r of rows) {
    if (!r.thumb || r.thumb === 'error') {
      if (!thumbsBlocked) {
        try { db().prepare('UPDATE youtube_queue SET thumb=? WHERE file=?').run(await setThumbnail(r.youtube_id, r.file, token, fetchFn), r.file); }
        catch (e) { thumbsBlocked = true; db().prepare("UPDATE youtube_queue SET thumb='error', playlist_note=? WHERE file=?").run(`Thumbnail: ${String(e.message).slice(0, 200)} (YouTube allows custom thumbnails only on verified channels)`, r.file); }
      }
    }
    if (!r.playlist && !listsBlocked) {
      try { db().prepare("UPDATE youtube_queue SET playlist=?, playlist_note=CASE WHEN thumb='error' THEN playlist_note ELSE NULL END WHERE file=?").run(await addToPlaylist(r, token, s.privacy, fetchFn), r.file); }
      catch (e) { listsBlocked = true; db().prepare('UPDATE youtube_queue SET playlist_note=? WHERE file=?').run(needsReconnect(String(e.message).slice(0, 200)), r.file); }
    }
    if (thumbsBlocked && listsBlocked) break;
  }
}
