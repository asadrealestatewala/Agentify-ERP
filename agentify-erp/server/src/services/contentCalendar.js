// Agentify's own marketing content calendar (Super Admin console > Content calendar). Posts are planned and tracked here by
// the social media manager; "posted" means the manager published it on the channel and recorded it. Nothing here calls a
// social network. Posting limits (per day, per channel, gap between posts, hours) come from one editable setting, and the
// "next time we can post" answer is computed from the same rules the schedule check uses.
import { platformDb } from '../platform.js';
import { getSetting, setSetting } from './platformConfig.js';
import { bad, notFound, HttpError } from '../util.js';

export const CHANNELS = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok', x: 'X', youtube: 'YouTube', whatsapp: 'WhatsApp', blog: 'Blog', other: 'Other' };
export const STATUSES = ['draft', 'scheduled', 'posted', 'canceled'];
/** Starting values only; the owner changes them to match what each network allows and what the team can handle. */
export const DEFAULT_LIMITS = { per_day: 5, per_channel_per_day: 2, min_gap_minutes: 60, window_start: '08:00', window_end: '22:00', timezone: 'UTC' };

const SCHEMA = `CREATE TABLE IF NOT EXISTS content_posts(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT, channel TEXT NOT NULL DEFAULT 'other', media_url TEXT, link TEXT,
  status TEXT NOT NULL DEFAULT 'draft', scheduled_at TEXT, posted_at TEXT, post_url TEXT, source TEXT NOT NULL DEFAULT 'manual', notes TEXT,
  created_by TEXT, posted_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_content_posts_status ON content_posts(status, scheduled_at);`;
// Auto-posting approval lives on the post itself (see contentAutopost.js): auto_post is 1 only while a person's approval stands.
const AUTO_COLS = [['auto_post', 'INTEGER NOT NULL DEFAULT 0'], ['auto_by', 'TEXT'], ['auto_at', 'TEXT'], ['auto_error', 'TEXT'], ['auto_state', 'TEXT'], ['auto_started_at', 'TEXT']];
let ready = false;
const db = () => {
  const d = platformDb();
  if (!ready) {
    d.exec(SCHEMA);
    const have = new Set(d.prepare('PRAGMA table_info(content_posts)').all().map((c) => c.name));
    for (const [c, t] of AUTO_COLS) if (!have.has(c)) d.exec(`ALTER TABLE content_posts ADD COLUMN ${c} ${t}`);
    ready = true;
  }
  return d;
};
export const resetCalendarForTests = () => { ready = false; };
/** Takes a person's auto-post approval away. Called whenever what was approved (content, channel or time) changes. */
const revoke = (id) => db().prepare('UPDATE content_posts SET auto_post=0, auto_by=NULL, auto_at=NULL WHERE id=? AND auto_post=1 AND auto_state IS NULL').run(Number(id));

// ---- limits
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const mins = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export function cleanLimits(b = {}) {
  const num = (v, min, max, label) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number from ${min} to ${max}`); return n; };
  const out = {
    per_day: num(b.per_day, 1, 100, 'Posts per day'), per_channel_per_day: num(b.per_channel_per_day, 1, 100, 'Posts per channel per day'),
    min_gap_minutes: num(b.min_gap_minutes, 0, 1440, 'Gap between posts on a channel'),
    window_start: String(b.window_start || ''), window_end: String(b.window_end || ''), timezone: String(b.timezone || ''),
  };
  if (!HHMM.test(out.window_start) || !HHMM.test(out.window_end)) throw bad('Posting hours must look like 08:00');
  if (mins(out.window_end) <= mins(out.window_start)) throw bad('The posting window must end after it starts');
  try { new Intl.DateTimeFormat('en', { timeZone: out.timezone }); } catch { throw bad('Choose a valid time zone, for example UTC or Europe/London'); }
  return out;
}
export function getLimits() {
  try { return { ...DEFAULT_LIMITS, ...cleanLimits({ ...DEFAULT_LIMITS, ...JSON.parse(getSetting('content_limits') || '{}') }) }; } catch { return { ...DEFAULT_LIMITS }; }
}
export function saveLimits(body, by) { const l = cleanLimits(body); setSetting('content_limits', JSON.stringify(l), { by }); return l; }

// ---- time helpers (pure)
const fmtCache = new Map();
function local(date, tz) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); fmtCache.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const counted = (p) => p.status === 'scheduled' || p.status === 'posted';
const when = (p) => (p.status === 'posted' ? p.posted_at : p.scheduled_at);

/**
 * Why a post cannot go out at `at` (a Date), or [] when it can. `posts` are the existing rows; `exclude` is the row being
 * edited. Pure, so the same rules drive the schedule check, the posted check and the next-slot search.
 */
export function problems(posts, limits, { at, channel, exclude = null }) {
  const L = local(at, limits.timezone);
  const out = [];
  if (L.minutes < mins(limits.window_start) || L.minutes >= mins(limits.window_end)) out.push(`Posting hours are ${limits.window_start} to ${limits.window_end} (${limits.timezone})`);
  let day = 0, ch = 0, gap = false;
  for (const p of posts) {
    if (p.id === exclude || !counted(p) || !when(p)) continue;
    const t = new Date(when(p));
    if (local(t, limits.timezone).day !== L.day) { /* other day: still matters for the gap */ } else { day += 1; if (p.channel === channel) ch += 1; }
    if (p.channel === channel && Math.abs(t - at) < limits.min_gap_minutes * 60_000) gap = true;
  }
  if (day >= limits.per_day) out.push(`The limit of ${limits.per_day} posts a day is reached for that day`);
  if (ch >= limits.per_channel_per_day) out.push(`The limit of ${limits.per_channel_per_day} posts a day on ${CHANNELS[channel] || channel} is reached for that day`);
  if (gap) out.push(`Posts on ${CHANNELS[channel] || channel} need ${limits.min_gap_minutes} minutes between them`);
  return out;
}

/** The earliest 5-minute slot at or after `after` that passes every rule, looking up to 14 days ahead; null when there is none. */
export function nextSlot(posts, limits, { channel, after = new Date(), exclude = null }) {
  const step = 5 * 60_000;
  let t = Math.ceil(after.getTime() / step) * step;
  for (let i = 0; i < 14 * 288; i += 1, t += step) if (!problems(posts, limits, { at: new Date(t), channel, exclude }).length) return new Date(t).toISOString();
  return null;
}

// ---- rows
const COLS = 'id, title, body, channel, media_url, link, status, scheduled_at, posted_at, post_url, source, notes, created_by, posted_by, created_at, updated_at, auto_post, auto_by, auto_at, auto_error, auto_state';
export const listPosts = () => db().prepare(`SELECT ${COLS} FROM content_posts ORDER BY COALESCE(posted_at, scheduled_at, created_at) DESC LIMIT 1000`).all();
export const getPost = (id) => db().prepare(`SELECT ${COLS} FROM content_posts WHERE id=?`).get(Number(id)) || (() => { throw notFound('Post not found'); })();

const text = (v, max, label, required) => { const s = String(v ?? '').trim(); if (required && !s) throw bad(`${label} is required`); if (s.length > max) throw bad(`${label} is too long (${max} characters at most)`); return s || null; };
const url = (v, label) => { const s = text(v, 500, label); if (s && !/^https?:\/\/\S+$/i.test(s)) throw bad(`${label} must start with http:// or https://`); return s; };
const iso = (v, label) => { const d = new Date(v); if (!v || Number.isNaN(d.getTime())) throw bad(`Choose a valid ${label}`); return d.toISOString(); };
function fields(b, partial = false) {
  const f = {};
  if (!partial || b.title !== undefined) f.title = text(b.title, 140, 'Title', true);
  if (!partial || b.body !== undefined) f.body = text(b.body, 3000, 'Post text');
  if (!partial || b.channel !== undefined) { if (!CHANNELS[b.channel]) throw bad('Choose a channel'); f.channel = b.channel; }
  if (!partial || b.media_url !== undefined) f.media_url = url(b.media_url, 'Image or video address');
  if (!partial || b.link !== undefined) f.link = url(b.link, 'Link');
  if (!partial || b.notes !== undefined) f.notes = text(b.notes, 1000, 'Notes');
  return f;
}

/** Checks a time against the limits and throws a message that names the next free slot. */
function assertAllowed(post, at, by, { override }) {
  const limits = getLimits();
  const others = listPosts();
  const why = problems(others, limits, { at, channel: post.channel, exclude: post.id });
  if (!why.length || override) return why;
  const next = nextSlot(others, limits, { channel: post.channel, after: at, exclude: post.id });
  throw new HttpError(409, `${why.join('. ')}.${next ? ` The next free time is ${new Date(next).toLocaleString('en-GB', { timeZone: limits.timezone, dateStyle: 'medium', timeStyle: 'short' })} (${limits.timezone}).` : ''}`, { next_slot: next });
}

export function createPost(b, by) {
  const f = fields(b);
  const source = b.source === 'ai' ? 'ai' : 'manual';
  const id = Number(db().prepare('INSERT INTO content_posts(title, body, channel, media_url, link, notes, source, created_by, status) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(f.title, f.body, f.channel, f.media_url, f.link, f.notes, source, by, 'draft').lastInsertRowid);
  if (b.scheduled_at) schedulePost(id, b.scheduled_at, by, { override: !!b.override });
  return getPost(id);
}
export function updatePost(id, b, by) {
  const p = getPost(id);
  if (p.status === 'posted') throw bad('A post that went out cannot be edited. Duplicate it instead.');
  const f = { ...fields(b, true) };
  const keys = Object.keys(f);
  if (keys.some((k) => f[k] !== (p[k] ?? null))) revoke(p.id); // new content needs a new approval
  if (keys.length) db().prepare(`UPDATE content_posts SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => f[k]), p.id);
  // a changed channel can break the limits of an already scheduled time
  if (p.status === 'scheduled' && f.channel && f.channel !== p.channel) assertAllowed({ ...p, ...f }, new Date(p.scheduled_at), by, {});
  return getPost(id);
}
export function schedulePost(id, at, by, { override = false } = {}) {
  const p = getPost(id);
  if (p.status === 'posted') throw bad('That post already went out.');
  const when_ = new Date(iso(at, 'time'));
  if (when_ < new Date(Date.now() - 60_000)) throw bad('Choose a time in the future');
  assertAllowed(p, when_, by, { override });
  if (p.scheduled_at !== when_.toISOString()) revoke(p.id); // a new time needs a new approval
  db().prepare("UPDATE content_posts SET status='scheduled', scheduled_at=?, updated_at=datetime('now') WHERE id=?").run(when_.toISOString(), p.id);
  return getPost(id);
}
export function unschedulePost(id) { const p = getPost(id); if (p.status !== 'scheduled') throw bad('Only a scheduled post can go back to draft'); revoke(p.id); db().prepare("UPDATE content_posts SET status='draft', scheduled_at=NULL, updated_at=datetime('now') WHERE id=?").run(p.id); return getPost(id); }
/** Records that the manager published the post on the channel. Counts against the limits like a scheduled post. */
export function markPosted(id, b, by, { override = false } = {}) {
  const p = getPost(id);
  if (p.status === 'posted') throw bad('Already recorded as posted.');
  const at = b.posted_at ? new Date(iso(b.posted_at, 'posting time')) : new Date();
  if (at > new Date(Date.now() + 5 * 60_000)) throw bad('A post cannot be recorded as posted in the future. Schedule it instead.');
  const post_url = url(b.post_url, 'Post address');
  // the limits apply to what we choose to publish; a post that is already out is recorded even when it breaks them
  const why = problems(listPosts(), getLimits(), { at, channel: p.channel, exclude: p.id });
  db().prepare("UPDATE content_posts SET status='posted', posted_at=?, post_url=?, posted_by=?, updated_at=datetime('now') WHERE id=?").run(at.toISOString(), post_url, by, p.id);
  return { post: getPost(id), warnings: override ? [] : why };
}
export function cancelPost(id) { const p = getPost(id); if (p.status === 'posted') throw bad('A post that went out cannot be canceled.'); revoke(p.id); db().prepare("UPDATE content_posts SET status='canceled', updated_at=datetime('now') WHERE id=?").run(p.id); return getPost(id); }
export function deletePost(id) { const p = getPost(id); if (p.status === 'posted' || p.status === 'scheduled') throw bad('Cancel the post first. Posted items are kept as a record.'); db().prepare('DELETE FROM content_posts WHERE id=?').run(p.id); }

/** Everything the calendar page needs in one answer. */
export function overview(now = new Date()) {
  const posts = listPosts();
  const limits = getLimits();
  const today = local(now, limits.timezone).day;
  const used = posts.filter((p) => counted(p) && when(p) && local(new Date(when(p)), limits.timezone).day === today);
  const monthStart = today.slice(0, 7);
  const byChannel = {};
  for (const c of Object.keys(CHANNELS)) byChannel[c] = nextSlot(posts, limits, { channel: c, after: now });
  return {
    posts, limits, channels: CHANNELS,
    today: { date: today, used: used.length, left: Math.max(0, limits.per_day - used.length) },
    next_slot: byChannel, // per channel; the page shows the earliest as "next post can go out"
    counts: {
      not_posted: posts.filter((p) => p.status === 'draft' || p.status === 'scheduled').length,
      scheduled: posts.filter((p) => p.status === 'scheduled').length,
      overdue: posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduled_at) < now).length,
      posted: posts.filter((p) => p.status === 'posted').length,
      posted_this_month: posts.filter((p) => p.status === 'posted' && local(new Date(p.posted_at), limits.timezone).day.startsWith(monthStart)).length,
    },
  };
}
