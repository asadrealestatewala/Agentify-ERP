// The 40 Instagram reels (vertical 9:16, Urdu/English/Arabic voiceover) as ready-made content calendar posts. The MP4s ship with
// the app (server/assets/promo/reels) and are served publicly at /promo-media/reels/<file>. Each reel becomes a draft that is
// then scheduled at its planned time when the posting limits allow it. Nothing is posted: the social media manager publishes
// each one on Instagram and records it, and can delete it from the calendar with one tap afterwards.
import { listPosts, createPost, schedulePost, getPost } from './contentCalendar.js';
import { REELS } from './reelDraftsData.js';
import { getSetting, setSetting } from './platformConfig.js';

export const REEL_FILE_NAMES = REELS.map((r) => `reels/${r.file}`);
const SITE = 'https://agentifyerp.co';

const ADDED_KEY = 'content_reels_added';
/** True once the reels were added. Remembered as a setting, so deleting reels after they are posted never brings the button
 *  (or the reels) back. Workspaces that added them before this flag existed are recognised by any reel title still listed. */
export function reelsAdded() {
  if (getSetting(ADDED_KEY)) return true;
  const titles = new Set(REELS.map((r) => r.title));
  if (listPosts().some((p) => titles.has(p.title))) { setSetting(ADDED_KEY, new Date().toISOString()); return true; }
  return false;
}

/** Adds one Instagram draft per reel and schedules it for its planned time. It runs once: after that it adds nothing, even if reels were deleted.
 *  A reel whose planned time is in the past or breaks the posting limits stays a draft, with the reason in `unscheduled`. */
export function addReelDrafts(baseUrl, by) {
  if (reelsAdded()) return { added: [], skipped: REELS.map((r) => r.title), unscheduled: [], already: true };
  const have = new Set(listPosts().map((p) => p.title));
  const added = [], skipped = [], unscheduled = [];
  for (const r of REELS) {
    if (have.has(r.title)) { skipped.push(r.title); continue; }
    const post = createPost({ title: r.title, body: r.body, channel: 'instagram', media_url: `${baseUrl}/promo-media/reels/${r.file}`, link: SITE, notes: r.notes }, by);
    try { schedulePost(post.id, r.at, by); } catch (e) { unscheduled.push({ title: r.title, reason: e.message }); }
    added.push(getPost(post.id));
  }
  setSetting(ADDED_KEY, new Date().toISOString(), { by });
  return { added, skipped, unscheduled };
}
