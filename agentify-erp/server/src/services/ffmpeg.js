// ffmpeg helper for Creative Studio reels: joins 8-second Veo clips into 16 or 24 second reels and puts a voice track inside the video,
// so the person gets one finished MP4. ffmpeg is optional: when it is missing, reels fall back to a single 8-second clip with the
// voice-over as a separate file, and nothing else breaks. Everything runs with an argument list (no shell) inside a private temp folder.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BIN = () => process.env.ERP_FFMPEG || 'ffmpeg';
const PROBE = () => process.env.ERP_FFPROBE || 'ffprobe';
export const CLIP_SECONDS = 8;
export const MAX_CLIPS = 3;

let state = { checked: false, ok: false, version: null };
/** Ask the system once (and again on demand) whether ffmpeg and ffprobe run. Safe to call at startup; never throws. */
export async function checkFfmpeg() {
  try {
    const { stdout } = await run(BIN(), ['-version'], { timeout: 10_000 });
    await run(PROBE(), ['-version'], { timeout: 10_000 });
    state = { checked: true, ok: true, version: String(stdout).split('\n')[0].slice(0, 80) };
  } catch { state = { checked: true, ok: false, version: null }; }
  return ffmpegStatus();
}
export const ffmpegAvailable = () => state.ok;
/** Longest reel this server can make: 24 seconds with ffmpeg, a single 8-second clip without it. */
export const maxReelSeconds = () => (state.ok ? CLIP_SECONDS * MAX_CLIPS : CLIP_SECONDS);
export const ffmpegStatus = () => ({
  available: state.ok, checked: state.checked, version: state.version, max_seconds: maxReelSeconds(),
  message: state.ok ? null : 'ffmpeg is not installed on the server, so reels are limited to 8 seconds and the voice-over plays as a separate file.',
});

async function inTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-reel-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Length in seconds of an audio or video buffer, or null when it cannot be read. */
export async function probeSeconds(buf, ext = '.bin') {
  if (!state.ok) return null;
  return inTemp(async (dir) => {
    const f = path.join(dir, `in${ext}`); fs.writeFileSync(f, buf);
    try {
      const { stdout } = await run(PROBE(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f], { timeout: 20_000 });
      const n = Number(String(stdout).trim()); return Number.isFinite(n) ? n : null;
    } catch { return null; }
  });
}

/**
 * Build the finished reel as an MP4 Buffer.
 *  clips  - Buffer[] (one per 8-second Veo clip)
 *  voice  - Buffer (mp3) laid over the whole reel, replacing the clips' own sound; omit to keep each clip's own sound (Veo speech)
 */
export async function buildReel({ clips, voice = null }) {
  if (!state.ok) throw new Error('ffmpeg is not available');
  if (!clips?.length || clips.length > MAX_CLIPS) throw new Error('Unexpected number of clips');
  return inTemp(async (dir) => {
    const args = ['-y', '-v', 'error'];
    clips.forEach((c, i) => { fs.writeFileSync(path.join(dir, `c${i}.mp4`), c); args.push('-i', path.join(dir, `c${i}.mp4`)); });
    let voiceIdx = -1;
    if (voice) { fs.writeFileSync(path.join(dir, 'voice.mp3'), voice); args.push('-i', path.join(dir, 'voice.mp3')); voiceIdx = clips.length; }
    const n = clips.length;
    const vf = clips.map((_, i) => `[${i}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v${i}]`);
    const keepOwnSound = !voice;
    const af = keepOwnSound ? clips.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`) : [];
    const join = keepOwnSound
      ? `${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[v][a]`
      : `${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[v]`;
    args.push('-filter_complex', [...vf, ...af, join].join(';'), '-map', '[v]');
    if (keepOwnSound) args.push('-map', '[a]');
    else args.push('-map', `${voiceIdx}:a`, '-af', 'apad', '-shortest'); // pad a short voice with silence, cut one that runs long
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(dir, 'out.mp4'));
    try { await run(BIN(), args, { timeout: 240_000, maxBuffer: 4 * 1024 * 1024 }); }
    catch (e) { throw new Error(`ffmpeg could not finish the reel (${String(e.stderr || e.message).split('\n')[0].slice(0, 160)})`); }
    const out = fs.readFileSync(path.join(dir, 'out.mp4'));
    if (out.length < 1000) throw new Error('ffmpeg produced an empty file');
    return out;
  });
}
