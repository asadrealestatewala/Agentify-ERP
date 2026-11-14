// The training course (25 lessons x English/Urdu/Arabic, plus one full-course video per language) as ready-made YouTube drafts in the
// content calendar. The MP4s ship with the app (server/assets/promo/training, served at /promo-media/training/<file>). Each draft carries the
// YouTube title, description and chapters: the manager downloads the video, uploads it in YouTube Studio, then deletes the draft. Nothing is posted or scheduled.
import { listPosts, createPost } from './contentCalendar.js';
import { TRAINING } from './trainingDraftsData.js';
import { getSetting, setSetting } from './platformConfig.js';

export const TRAINING_FILE_NAMES = TRAINING.map((t) => `training/${t.file}`);
const SITE = 'https://agentifyerp.co';
const ADDED_KEY = 'content_training_added';
/** True once the drafts were added. Remembered as a setting, so deleting them after upload never brings the button back. */
export function trainingAdded() {
  if (getSetting(ADDED_KEY)) return true;
  const titles = new Set(TRAINING.map((t) => t.title));
  if (listPosts().some((p) => titles.has(p.title))) { setSetting(ADDED_KEY, new Date().toISOString()); return true; }
  return false;
}

/** Adds one YouTube draft per training video. Runs once: afterwards it adds nothing, even if drafts were deleted. */
export function addTrainingDrafts(baseUrl, by) {
  if (trainingAdded()) return { added: [], skipped: TRAINING.map((t) => t.title), already: true };
  const have = new Set(listPosts().map((p) => p.title));
  const added = [], skipped = [];
  for (const t of TRAINING) {
    if (have.has(t.title)) { skipped.push(t.title); continue; }
    const notes = `YouTube title: ${t.yt}. File: ${t.file}. Suggested day: ${t.plan}. Download the video, upload it in YouTube Studio with this title and text, then delete this draft.`.slice(0, 1000);
    added.push(createPost({ title: t.title, body: t.body, channel: 'youtube', media_url: `${baseUrl}/promo-media/training/${t.file}`, link: SITE, notes }, by));
  }
  setSetting(ADDED_KEY, new Date().toISOString(), { by });
  return { added, skipped };
}
