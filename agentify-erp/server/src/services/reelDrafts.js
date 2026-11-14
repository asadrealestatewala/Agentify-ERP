// Ready-made Instagram reels (vertical 9:16, Urdu/English/Arabic voiceover) as content calendar posts. The MP4s ship with the app
// (server/assets/promo/reels) and are served publicly at /promo-media/reels/<file>. Each set (the first 40, then 50 more) is added
// with its own button: every reel becomes a draft that is scheduled at its planned time when the posting limits allow it. Nothing
// is posted: the social media manager publishes each one on Instagram and records it, and can delete it with one tap afterwards.
import { listPosts, createPost, schedulePost, getPost } from './contentCalendar.js';
import { REELS } from './reelDraftsData.js';
import { REELS_2 } from './reelDraftsData2.js';
import { getSetting, setSetting } from './platformConfig.js';

/** Each set is added once. `key` remembers that, so deleting reels after they are posted never brings the button (or the reels) back. */
export const REEL_SETS = {
  first: { reels: REELS, key: 'content_reels_added' },
  second: { reels: REELS_2, key: 'content_reels2_added' },
};
export const REEL_FILE_NAMES = Object.values(REEL_SETS).flatMap((s) => s.reels.map((r) => `reels/${r.file}`));
const SITE = 'https://agentifyerp.co';

/** True once this set was added. Installs that added it before the flag existed are recognised by any of its titles still listed. */
export function reelsAdded(set = 'first') {
  const { reels, key } = REEL_SETS[set];
  if (getSetting(key)) return true;
  const titles = new Set(reels.map((r) => r.title));
  if (listPosts().some((p) => titles.has(p.title))) { setSetting(key, new Date().toISOString()); return true; }
  return false;
}

/** Adds one Instagram draft per reel of the set and schedules it for its planned time. It runs once: after that it adds nothing,
 *  even if reels were deleted. A reel whose planned time is in the past or breaks the posting limits stays a draft, with the reason in `unscheduled`. */
export function addReelDrafts(baseUrl, by, set = 'first') {
  const { reels, key } = REEL_SETS[set];
  if (reelsAdded(set)) return { added: [], skipped: reels.map((r) => r.title), unscheduled: [], already: true };
  const have = new Set(listPosts().map((p) => p.title));
  const added = [], skipped = [], unscheduled = [];
  for (const r of reels) {
    if (have.has(r.title)) { skipped.push(r.title); continue; }
    const post = createPost({ title: r.title, body: r.body, channel: 'instagram', media_url: `${baseUrl}/promo-media/reels/${r.file}`, link: SITE, notes: r.notes }, by);
    try { schedulePost(post.id, r.at, by); } catch (e) { unscheduled.push({ title: r.title, reason: e.message }); }
    added.push(getPost(post.id));
  }
  setSetting(key, new Date().toISOString(), { by });
  return { added, skipped, unscheduled };
}
