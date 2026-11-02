// Creative Studio video reels: a Gemini Veo job (8 seconds, vertical) with an optional Azure voice-over. Veo takes minutes, so a job row
// is saved at once and a background tick (every 20 s, see index.js) checks Google, stores the finished file in the workspace's own
// storage, and notifies the person who asked. Credits are taken when the job starts and given back if it fails.
import { all, get, run } from '../db.js';
import { currentTenant } from '../context.js';
import { bad, notFound, now } from '../util.js';
import { notify } from '../audit.js';
import { getTenant, withTenant } from '../platform.js';
import { veoStart, veoStatus, veoDownload, azureSpeak, refundCredits, voiceFor, REEL_SECONDS, MAX_VOICE_CHARS } from './aiGateway.js';
import { assertSafeRequest } from './aiSafety.js';
import { creditsLeft } from './aiGate.js';
import { ensureTable } from './aiUsage.js';
import { storeBytes, brand, REEL_CREDITS, LANGUAGES } from './creativeStudio.js';
import { removeRef, isStoredRef } from './storage.js';

export const MAX_ACTIVE = 2;
export const TIMEOUT_MS = 25 * 60 * 1000;
const clean = (v, n) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null; };
const tid = () => currentTenant()?.id ?? null;

export function quote({ script } = {}) {
  const chars = String(script || '').trim().length;
  const video = REEL_SECONDS * REEL_CREDITS.per_second;
  const voice = chars ? Math.max(1, Math.ceil(chars / 100) * REEL_CREDITS.voice_per_100_chars) : 0;
  return { seconds: REEL_SECONDS, video, voice, total: video + voice, chars };
}

const fail = (job, message) => {
  run("UPDATE creative_jobs SET status='failed', error=?, finished_at=? WHERE id=?", message, now(), job.id);
  refundCredits({ tenantId: tid(), userId: job.created_by, credits: job.credits, feature: 'creative_video', note: 'reel failed' });
  if (job.created_by) notify(job.created_by, 'creative', 'Your reel could not be made', `${message} Your credits were returned.`, '/creative?tab=reels');
};

/** Start a reel. accept_cost must equal the credits the person was shown, so a changed price never surprises them. */
export async function startReel({ description, script, language, accept_cost }, user) {
  const desc = clean(description, 600);
  if (!desc || desc.length < 10) throw bad('Describe the reel in a sentence or two.');
  const text = clean(script, MAX_VOICE_CHARS);
  if (String(script || '').trim().length > MAX_VOICE_CHARS) throw bad(`The voice-over can be at most ${MAX_VOICE_CHARS} characters.`);
  const lang = LANGUAGES.includes(language) ? language : 'English';
  assertSafeRequest(desc, text);
  const q = quote({ script: text });
  if (Number(accept_cost) !== q.total) throw bad(`Please confirm the cost first: this reel uses ${q.total} credits.`, { code: 'cost_changed', credits: q.total });
  const left = creditsLeft(tid());
  if (left != null && left < q.total) throw bad(`This reel needs ${q.total} credits but your workspace has ${left} left this month. Ask support to top up.`, { code: 'no_credits', needed: q.total, left });
  if (get("SELECT COUNT(*) n FROM creative_jobs WHERE status='video'").n >= MAX_ACTIVE) throw bad(`You already have ${MAX_ACTIVE} reels being made. Wait for one to finish.`, { code: 'too_many' });

  let audioRef = null, voiceName = null;
  if (text) {
    voiceName = voiceFor(lang);
    const mp3 = await azureSpeak({ lang, text, voice: voiceName, tenantId: tid(), userId: user?.id, credits: q.voice });
    audioRef = await storeBytes(mp3, 'audio/mpeg', '.mp3');
  }
  const b = brand();
  const prompt = `A vertical social media reel, ${REEL_SECONDS} seconds, cinematic and polished. Subject: ${desc}${b.brand_name ? `\nFor the brand "${b.brand_name}"${b.business_type ? `, a ${b.business_type}` : ''}.` : ''}${b.primary_color ? ` Use ${b.primary_color} as an accent color.` : ''}\nNo on-screen text, no logos${text ? ', and no spoken dialogue (a voice-over is added separately)' : ''}.`;
  let started;
  try { started = await veoStart({ prompt, tenantId: tid(), userId: user?.id, credits: q.video }); }
  catch (e) {
    if (audioRef) { refundCredits({ tenantId: tid(), userId: user?.id, credits: q.voice, feature: lang === 'Urdu' ? 'video_voice_ur' : 'video_voice_en', note: 'reel not started' }); removeFile(audioRef); }
    throw e;
  }
  const id = Number(run('INSERT INTO creative_jobs(kind,status,title,prompt,script,language,voice,seconds,operation,credits,audio_ref,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    'reel', 'video', desc.slice(0, 80), desc, text, text ? lang : null, voiceName, REEL_SECONDS, started.operation, q.total, audioRef, user?.id || null, now()).lastInsertRowid);
  return { id, status: 'video', credits_used: q.total, credits_left: creditsLeft(tid()) };
}

function removeFile(ref) { if (!ref) return; if (isStoredRef(ref)) removeRef(ref).catch(() => {}); }

/** Look at every running reel of the current workspace once. Called inside the workspace's context. */
export async function checkJobs() {
  for (const job of all("SELECT * FROM creative_jobs WHERE status='video'")) {
    try {
      if (Date.now() - Date.parse(job.created_at) > TIMEOUT_MS) { fail(job, 'The video took too long to make.'); continue; }
      const s = await veoStatus(job.operation);
      if (!s.done) continue;
      if (s.error) { fail(job, 'The video service could not make this reel.'); continue; }
      if (!s.uri) { fail(job, s.filtered ? 'The video model did not accept this request. Please describe the reel differently.' : 'No video came back.'); continue; }
      const buf = await veoDownload(s.uri);
      let ref;
      try { ref = await storeBytes(buf, 'video/mp4', '.mp4'); } catch (e) { fail(job, e.message || 'The video could not be saved.'); continue; }
      run("UPDATE creative_jobs SET status='done', video_ref=?, video_mime='video/mp4', size_bytes=?, finished_at=? WHERE id=?", ref, buf.length, now(), job.id);
      if (job.created_by) notify(job.created_by, 'creative', 'Your reel is ready', job.title || 'Creative Studio', '/creative?tab=reels');
    } catch (e) { console.error('[creative-jobs]', job.id, e.message); }
  }
}

/** Platform-wide tick: only workspaces that started a video in the last 40 minutes are opened. */
export async function runReelJobs() {
  const since = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  const ids = ensureTable().prepare("SELECT DISTINCT tenant_id FROM ai_usage WHERE purpose='creative_video' AND ok=1 AND tenant_id IS NOT NULL AND at>=?").all(since).map((r) => r.tenant_id);
  for (const id of ids) { const t = getTenant(id); if (t && t.status === 'active') await withTenant(t, () => checkJobs()); }
}

const PUBLIC = 'id, kind, status, title, prompt, script, language, voice, seconds, credits, error, created_at, finished_at, (video_ref IS NOT NULL) has_video, (audio_ref IS NOT NULL) has_audio, size_bytes';
export const listJobs = () => all(`SELECT ${PUBLIC} FROM creative_jobs ORDER BY id DESC LIMIT 50`);
export const getJob = (id) => { const j = get('SELECT * FROM creative_jobs WHERE id=?', Number(id)); if (!j) throw notFound(); return j; };
export function removeJob(id) {
  const j = getJob(id);
  if (j.status === 'video') throw bad('This reel is still being made.');
  run('DELETE FROM creative_jobs WHERE id=?', j.id); removeFile(j.video_ref); removeFile(j.audio_ref);
  return { local: [j.video_ref, j.audio_ref].filter((r) => r && !isStoredRef(r)) };
}
