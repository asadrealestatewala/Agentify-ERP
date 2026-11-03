// Creative Studio video reels: one to three Gemini Veo clips (8 seconds each, vertical), finished into ONE MP4 with ffmpeg. Two voice paths,
// chosen per reel: "speech" (Veo speaks the quoted line itself) and "script" (the person's exact script is read by Azure and ffmpeg lays
// it over the video). Veo takes minutes, so a job row is saved at once and a background tick (every 20 s, see index.js) checks Google,
// builds the file, stores it in the workspace's own storage, and notifies the person who asked. Credits are taken when the job starts and
// given back if it fails. Without ffmpeg a reel is a single 8-second clip with the voice as a separate file, as before.
import crypto from 'node:crypto';
import { all, get, run } from '../db.js';
import { currentTenant } from '../context.js';
import { bad, notFound, now } from '../util.js';
import { notify } from '../audit.js';
import { getTenant, withTenant } from '../platform.js';
import { veoStart, veoStatus, veoDownload, azureSpeak, refundCredits, voiceFor, REEL_SECONDS, voiceLimit } from './aiGateway.js';
import { assertSafeRequest } from './aiSafety.js';
import { creditsLeft } from './aiGate.js';
import { ensureTable } from './aiUsage.js';
import { storeBytes, brand, REEL_CREDITS, LANGUAGES } from './creativeStudio.js';
import { removeRef, isStoredRef, readRefBytes } from './storage.js';
import { ffmpegAvailable, ffmpegStatus, buildReel, probeSeconds, maxReelSeconds, CLIP_SECONDS } from './ffmpeg.js';

export const MAX_ACTIVE = 2;
export const TIMEOUT_MS = 25 * 60 * 1000;
export const LENGTHS = [8, 16, 24];
export const VOICE_PATHS = ['script', 'speech'];
const clean = (v, n) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null; };
const tid = () => currentTenant()?.id ?? null;

/** What the reel creator needs to draw its options: which lengths and voice paths this server can do. */
export const options = () => ({ lengths: LENGTHS.filter((l) => l <= maxReelSeconds()), voice_paths: VOICE_PATHS, ffmpeg: ffmpegStatus(), clip_seconds: CLIP_SECONDS });

const secondsOf = (v) => { const n = Number(v) || REEL_SECONDS; if (!LENGTHS.includes(n)) throw bad('A reel can be 8, 16 or 24 seconds long.'); if (n > maxReelSeconds()) throw bad(ffmpegStatus().message || 'That length is not available right now.', { code: 'ffmpeg_missing' }); return n; };

export function quote({ script, seconds, voice_path } = {}) {
  const sec = LENGTHS.includes(Number(seconds)) && Number(seconds) <= maxReelSeconds() ? Number(seconds) : REEL_SECONDS;
  const path_ = VOICE_PATHS.includes(voice_path) ? voice_path : 'script';
  const chars = String(script || '').trim().length;
  const video = sec * REEL_CREDITS.per_second;
  // only the exact-script path is billed per voice character; when Veo speaks, the sound is part of the video price
  const voice = path_ === 'script' && chars ? Math.max(1, Math.ceil(chars / 100) * REEL_CREDITS.voice_per_100_chars) : 0;
  return { seconds: sec, clips: sec / CLIP_SECONDS, video, voice, total: video + voice, chars, max_chars: voiceLimit(sec), voice_path: path_, ...options() };
}

// A voice the person already heard (and paid the voice credits for) is kept for 30 minutes, so starting the reel does not charge or synthesise it twice.
const heard = new Map(); const HEARD_MS = 30 * 60 * 1000;
const heardKey = (lang, voice, text) => `${tid()}|${lang}|${voice}|${crypto.createHash('sha1').update(text).digest('hex')}`;
const pruneHeard = () => { const t = Date.now(); for (const [k, v] of heard) if (t - v.at > HEARD_MS) heard.delete(k); };

/** Let the person listen to their exact script before the reel is started. Costs the voice credits once; starting the reel then reuses it. */
export async function previewVoice({ script, language, seconds }, user) {
  const sec = secondsOf(seconds); const limit = voiceLimit(sec);
  const text = clean(script, limit);
  if (!text) throw bad('Type the voice-over first.');
  if (String(script).trim().length > limit) throw bad(`The voice can be at most ${limit} characters for a ${sec}-second reel.`);
  const lang = LANGUAGES.includes(language) ? language : 'English';
  assertSafeRequest(text);
  pruneHeard();
  const voice = voiceFor(lang), key = heardKey(lang, voice, text);
  let h = heard.get(key); let charged = 0;
  if (!h) {
    charged = quote({ script: text, seconds: sec, voice_path: 'script' }).voice;
    const left = creditsLeft(tid());
    if (left != null && left < charged) throw bad(`Hearing the voice needs ${charged} credits but your workspace has ${left} left this month.`, { code: 'no_credits', needed: charged, left });
    const mp3 = await azureSpeak({ lang, text, voice, tenantId: tid(), userId: user?.id, credits: charged, maxChars: limit });
    h = { mp3, at: Date.now(), credits: charged, seconds: await probeSeconds(mp3, '.mp3') }; heard.set(key, h);
  }
  return { audio: h.mp3.toString('base64'), mime: 'audio/mpeg', credits: charged, voice_seconds: h.seconds == null ? null : Math.round(h.seconds * 10) / 10, fits: h.seconds == null ? null : h.seconds <= sec + 0.5, reel_seconds: sec, credits_left: creditsLeft(tid()) };
}

const parseClips = (job) => { try { const c = JSON.parse(job.clips || 'null'); if (Array.isArray(c) && c.length) return c; } catch { /* old row */ } return [{ operation: job.operation }]; };

const fail = (job, message) => {
  run("UPDATE creative_jobs SET status='failed', error=?, finished_at=? WHERE id=?", message, now(), job.id);
  refundCredits({ tenantId: tid(), userId: job.created_by, credits: job.credits, feature: 'creative_video', note: 'reel failed' });
  if (job.created_by) notify(job.created_by, 'creative', 'Your reel could not be made', `${message} Your credits were returned.`, '/creative?tab=reels');
};

const splitSentences = (text) => String(text).match(/[^.!?۔؟\n]+[.!?۔؟]?/g)?.map((x) => x.trim()).filter(Boolean) || [String(text)];
/** Share the spoken lines out over n clips, keeping sentences whole. */
export function shareLines(text, n) {
  const parts = splitSentences(text); const out = Array.from({ length: n }, () => []);
  parts.forEach((p, i) => out[Math.min(n - 1, Math.floor((i * n) / parts.length))].push(p));
  return out.map((a) => a.join(' ').trim());
}

function clipPrompt({ desc, scene, n, i, b, voicePath, line, lang, hasVoice }) {
  const brandLine = `${b.brand_name ? `\nFor the brand "${b.brand_name}"${b.business_type ? `, a ${b.business_type}` : ''}.` : ''}${b.primary_color ? ` Use ${b.primary_color} as an accent color.` : ''}`;
  const part = n > 1 ? `\nThis is part ${i + 1} of ${n} of one continuous reel. Keep the same look, setting, lighting and people throughout.${scene ? ` In this part: ${scene}` : ''}` : (scene ? `\n${scene}` : '');
  let sound;
  if (voicePath === 'speech') sound = line ? `\nA person on screen or a narrator says, in ${lang}, exactly: "${line}". Clear natural speech, no music.` : '\nNo spoken dialogue and no music in this part.';
  else sound = `\nNo on-screen text, no logos${hasVoice ? ', and no spoken dialogue (a voice-over is added separately)' : ''}.`;
  return `A vertical social media reel clip, ${REEL_SECONDS} seconds, cinematic and polished. Subject: ${desc}${brandLine}${part}${voicePath === 'speech' ? '\nNo on-screen text, no logos.' : ''}${sound}`;
}

/** Start a reel. accept_cost must equal the credits the person was shown, so a changed price never surprises them. */
export async function startReel({ description, script, language, accept_cost, seconds, voice_path, scenes }, user) {
  const desc = clean(description, 600);
  if (!desc || desc.length < 10) throw bad('Describe the reel in a sentence or two.');
  const sec = secondsOf(seconds);
  const n = sec / CLIP_SECONDS;
  const vp = VOICE_PATHS.includes(voice_path) ? voice_path : 'script';
  const limit = voiceLimit(sec);
  const text = clean(script, limit);
  if (String(script || '').trim().length > limit) throw bad(`The voice can be at most ${limit} characters for a ${sec}-second reel.`);
  const sceneList = Array.isArray(scenes) ? scenes.slice(0, n).map((x) => clean(x, 300)) : [];
  const lang = LANGUAGES.includes(language) ? language : 'English';
  assertSafeRequest(desc, text, ...sceneList.filter(Boolean));
  const q = quote({ script: text, seconds: sec, voice_path: vp });
  if (Number(accept_cost) !== q.total) throw bad(`Please confirm the cost first: this reel uses ${q.total} credits.`, { code: 'cost_changed', credits: q.total });
  const preheard = text && vp === 'script' ? heard.get(heardKey(lang, voiceFor(lang), text)) : null;
  const left = creditsLeft(tid());
  const needed = preheard && Date.now() - preheard.at <= HEARD_MS ? q.total - q.voice : q.total; // the voice credits were taken when they listened
  if (left != null && left < needed) throw bad(`This reel needs ${q.total} credits but your workspace has ${left} left this month. Ask support to top up.`, { code: 'no_credits', needed: q.total, left });
  if (get("SELECT COUNT(*) n FROM creative_jobs WHERE status='video'").n >= MAX_ACTIVE) throw bad(`You already have ${MAX_ACTIVE} reels being made. Wait for one to finish.`, { code: 'too_many' });

  let audioRef = null, voiceName = null, voiceCharged = 0;
  if (text && vp === 'script') {
    voiceName = voiceFor(lang);
    const reuse = preheard && Date.now() - preheard.at <= HEARD_MS ? preheard : null;
    if (reuse) heard.delete(heardKey(lang, voiceName, text));
    const mp3 = reuse ? reuse.mp3 : await azureSpeak({ lang, text, voice: voiceName, tenantId: tid(), userId: user?.id, credits: q.voice, maxChars: limit });
    voiceCharged = q.voice;
    // the voice must fit inside the reel; tell the person now, before any video is paid for
    const len = await probeSeconds(mp3, '.mp3');
    if (len != null && len > sec + 0.5) {
      refundCredits({ tenantId: tid(), userId: user?.id, credits: q.voice, feature: lang === 'Urdu' ? 'video_voice_ur' : 'video_voice_en', note: 'voice too long' });
      throw bad(`The voice takes about ${Math.ceil(len)} seconds to read, which is longer than the ${sec}-second reel. Shorten the script or choose a longer reel.`, { code: 'voice_too_long', voice_seconds: Math.ceil(len) });
    }
    audioRef = await storeBytes(mp3, 'audio/mpeg', '.mp3');
  }
  const b = brand();
  const lines = text && vp === 'speech' ? shareLines(text, n) : [];
  const ops = [];
  try {
    for (let i = 0; i < n; i++) {
      const prompt = clipPrompt({ desc, scene: sceneList[i], n, i, b, voicePath: vp, line: lines[i], lang, hasVoice: !!text });
      const started = await veoStart({ prompt, tenantId: tid(), userId: user?.id, credits: REEL_SECONDS * REEL_CREDITS.per_second });
      ops.push({ operation: started.operation });
    }
  } catch (e) {
    // clips already started cannot be stopped; the person is not charged for a reel that never began
    refundCredits({ tenantId: tid(), userId: user?.id, credits: ops.length * REEL_SECONDS * REEL_CREDITS.per_second, feature: 'creative_video', note: 'reel not started' });
    if (audioRef) { refundCredits({ tenantId: tid(), userId: user?.id, credits: voiceCharged, feature: lang === 'Urdu' ? 'video_voice_ur' : 'video_voice_en', note: 'reel not started' }); removeFile(audioRef); }
    throw e;
  }
  const id = Number(run('INSERT INTO creative_jobs(kind,status,title,prompt,script,language,voice,seconds,operation,credits,audio_ref,created_by,created_at,voice_path,clips,scenes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    'reel', 'video', desc.slice(0, 80), desc, text, text ? lang : null, voiceName, sec, ops[0].operation, q.total, audioRef, user?.id || null, now(), vp, JSON.stringify(ops), JSON.stringify(sceneList.filter(Boolean))).lastInsertRowid);
  return { id, status: 'video', seconds: sec, credits_used: q.total, credits_left: creditsLeft(tid()) };
}

const readRef = (ref) => readRefBytes(ref);

function removeFile(ref) { if (!ref) return; if (isStoredRef(ref)) removeRef(ref).catch(() => {}); }

/** Look at every running reel of the current workspace once. Called inside the workspace's context. */
export async function checkJobs() {
  for (const job of all("SELECT * FROM creative_jobs WHERE status='video'")) {
    try {
      if (Date.now() - Date.parse(job.created_at) > TIMEOUT_MS) { fail(job, 'The video took too long to make.'); continue; }
      const clips = parseClips(job);
      let failed = null;
      for (const c of clips) {
        if (c.uri || failed) continue;
        const s = await veoStatus(c.operation);
        if (!s.done) continue;
        if (s.error) failed = 'The video service could not make this reel.';
        else if (!s.uri) failed = s.filtered ? 'The video model did not accept this request. Please describe the reel differently.' : 'No video came back.';
        else c.uri = s.uri;
      }
      if (failed) { fail(job, failed); continue; }
      run('UPDATE creative_jobs SET clips=? WHERE id=?', JSON.stringify(clips), job.id);
      if (!clips.every((c) => c.uri)) continue;
      await finish(job, clips);
    } catch (e) { console.error('[creative-jobs]', job.id, e.message); }
  }
}

/** All clips are ready: download them, make the one finished file, store it. */
async function finish(job, clips) {
  let bufs;
  try { bufs = []; for (const c of clips) bufs.push(await veoDownload(c.uri)); } catch (e) { return fail(job, 'The finished video could not be downloaded. Please try again.'); }
  const speech = job.voice_path === 'speech';
  let out = null, note = null, keepVoice = true;
  const wantsVoice = !speech && !!job.audio_ref;
  if (bufs.length === 1 && !wantsVoice) out = bufs[0]; // a single clip needs no ffmpeg (Veo's own sound stays when it speaks)
  else if (ffmpegAvailable()) {
    try {
      const voice = wantsVoice ? await readRef(job.audio_ref) : null;
      out = await buildReel({ clips: bufs, voice });
      keepVoice = false;
    } catch (e) {
      console.error('[creative-jobs] merge', job.id, e.message);
      if (bufs.length === 1) { out = bufs[0]; note = 'The voice could not be put inside the video, so it comes as a separate file.'; }
      else return fail(job, 'The clips could not be joined into one reel.');
    }
  } else if (bufs.length === 1) { out = bufs[0]; note = 'The voice comes as a separate file because video merging is not available.'; }
  else return fail(job, 'Video joining is not available right now.');
  let ref;
  try { ref = await storeBytes(out, 'video/mp4', '.mp4'); } catch (e) { return fail(job, e.message || 'The video could not be saved.'); }
  if (!keepVoice && job.audio_ref) { removeFile(job.audio_ref); }
  run("UPDATE creative_jobs SET status='done', video_ref=?, video_mime='video/mp4', size_bytes=?, finished_at=?, note=?, audio_ref=? WHERE id=?", ref, out.length, now(), note, keepVoice ? job.audio_ref : null, job.id);
  if (job.created_by) notify(job.created_by, 'creative', 'Your reel is ready', job.title || 'Creative Studio', '/creative?tab=reels');
}

/** Platform-wide tick: only workspaces that started a video in the last 40 minutes are opened. */
export async function runReelJobs() {
  const since = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  const ids = ensureTable().prepare("SELECT DISTINCT tenant_id FROM ai_usage WHERE purpose='creative_video' AND ok=1 AND tenant_id IS NOT NULL AND at>=?").all(since).map((r) => r.tenant_id);
  for (const id of ids) { const t = getTenant(id); if (t && t.status === 'active') await withTenant(t, () => checkJobs()); }
}

const PUBLIC = 'id, kind, status, title, prompt, script, language, voice, seconds, voice_path, note, credits, error, created_at, finished_at, (video_ref IS NOT NULL) has_video, (audio_ref IS NOT NULL) has_audio, size_bytes';
export const listJobs = () => all(`SELECT ${PUBLIC} FROM creative_jobs ORDER BY id DESC LIMIT 50`);
export const getJob = (id) => { const j = get('SELECT * FROM creative_jobs WHERE id=?', Number(id)); if (!j) throw notFound(); return j; };
export function removeJob(id) {
  const j = getJob(id);
  if (j.status === 'video') throw bad('This reel is still being made.');
  run('DELETE FROM creative_jobs WHERE id=?', j.id); removeFile(j.video_ref); removeFile(j.audio_ref);
  return { local: [j.video_ref, j.audio_ref].filter((r) => r && !isStoredRef(r)) };
}
