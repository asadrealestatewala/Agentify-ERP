// Auto-posting for Agentify's own content calendar (Super Admin console > Content calendar).
//
// Safety rules, all enforced here and tested:
//  * Nothing is posted unless a person approved THAT post ("Auto-post this"), and the platform-wide switch is on (off by default).
//  * Approval belongs to the exact content and time. Editing the text, media, link or channel, rescheduling, unscheduling or
//    canceling the post takes the approval away; it must be given again.
//  * A post marked as on hold (for example "DO NOT POST" pending a partner's consent) can never be approved or auto-posted.
//  * A failure stops auto-posting for that post and records the provider's message. It is never retried automatically, so a
//    post cannot go out twice. A post whose time was missed by hours (server down) is not posted late on its own.
//  * Accounts are connected with the platform's own OAuth apps (Integrations > Facebook/Instagram, LinkedIn, TikTok); tokens
//    are stored encrypted in the platform database.
import { platformDb } from '../platform.js';
import { encrypt } from './platformConfig.js';
import { getSetting, setSetting } from './platformConfig.js';
import { discoverAccounts, publishToAccount } from '../integrations/social.js';
import { getPost, getLimits, problems, listPosts, CHANNELS } from './contentCalendar.js';
import { bad } from '../util.js';

/** Calendar channel -> the connection type that can publish it. Other channels stay manual. */
export const AUTO_CHANNELS = { facebook: 'facebook', instagram: 'instagram', linkedin: 'linkedin', tiktok: 'tiktok' };
/** The OAuth app each connection type comes from. */
export const APP_OF = { facebook: 'meta', instagram: 'meta', linkedin: 'linkedin', tiktok: 'tiktok' };
export const LATE_LIMIT_MS = 6 * 3600_000;
const SWITCH = 'content_autopost_enabled';
const PICK = 'content_autopost_accounts';

const SCHEMA = `CREATE TABLE IF NOT EXISTS content_connections(
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, external_id TEXT NOT NULL, name TEXT, token_enc TEXT NOT NULL, meta TEXT,
  connected_by TEXT, connected_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'connected', UNIQUE(provider, external_id));`;
let ready = false;
const db = () => {
  const d = platformDb();
  if (!ready) { listPosts(); d.exec(SCHEMA); ready = true; } // listPosts makes sure content_posts (and its auto-post columns) exist
  return d;
};
export const resetForTests = () => { ready = false; };

export const isOnHold = (p) => /DO NOT POST|ON HOLD/i.test(`${p.title || ''}\n${p.notes || ''}`);
export const autoEnabled = () => getSetting(SWITCH) === '1';
export function setAutoEnabled(on, by) { setSetting(SWITCH, on ? '1' : '0', { by }); return autoEnabled(); }

// ---- connected accounts
export const listConnections = () => db().prepare('SELECT id, provider, external_id, name, connected_by, connected_at, status FROM content_connections ORDER BY provider, name').all();
export function saveConnections(found, by) {
  const ins = db().prepare(`INSERT INTO content_connections(provider, external_id, name, token_enc, meta, connected_by, status) VALUES(?,?,?,?,?,?, 'connected')
    ON CONFLICT(provider, external_id) DO UPDATE SET name=excluded.name, token_enc=excluded.token_enc, meta=excluded.meta, connected_by=excluded.connected_by, connected_at=datetime('now'), status='connected'`);
  for (const a of found) ins.run(a.provider, String(a.externalId), a.name, encrypt(JSON.stringify(a.secret)), a.meta ? JSON.stringify(a.meta) : null, by || null);
  return found.length;
}
/** After the OAuth sign-in: finds the Pages / profiles the person manages and keeps them. */
export async function connectFromOAuth(oauthProvider, tokens, by) {
  const found = await discoverAccounts(oauthProvider, tokens);
  if (!found.length) throw new Error('That sign-in has no Pages, Instagram accounts or profiles to post to.');
  return saveConnections(found, by);
}
export function removeConnection(id) {
  db().prepare('DELETE FROM content_connections WHERE id=?').run(Number(id));
  const pick = picks(); let changed = false;
  for (const [k, v] of Object.entries(pick)) if (v === Number(id)) { delete pick[k]; changed = true; }
  if (changed) setSetting(PICK, JSON.stringify(pick));
  // posts that relied on it lose their approval
  db().prepare("UPDATE content_posts SET auto_post=0, auto_error='The account used for auto-posting was disconnected. Connect it again and approve the post again.' WHERE auto_post=1 AND auto_state IS NULL AND status='scheduled' AND channel NOT IN (SELECT provider FROM content_connections)").run();
}
function picks() { try { return JSON.parse(getSetting(PICK) || '{}'); } catch { return {}; } }
export function chooseAccount(channel, id) {
  const c = db().prepare('SELECT * FROM content_connections WHERE id=?').get(Number(id));
  if (!c || c.provider !== AUTO_CHANNELS[channel]) throw bad('Choose a connected account for that channel');
  const p = picks(); p[channel] = c.id; setSetting(PICK, JSON.stringify(p));
}
/** The account a channel posts to: the one chosen on the page, else the first connected. */
export function accountFor(channel) {
  const type = AUTO_CHANNELS[channel];
  if (!type) return null;
  const chosen = picks()[channel];
  const rows = db().prepare("SELECT * FROM content_connections WHERE provider=? AND status='connected' ORDER BY id").all(type);
  return rows.find((r) => r.id === chosen) || rows[0] || null;
}

/** What the page shows: the switch, each app's state, the accounts, and which account each channel will use. */
export function autopostStatus(appConfigured = () => false) {
  const accounts = listConnections();
  const use = {};
  for (const c of Object.keys(AUTO_CHANNELS)) use[c] = accountFor(c)?.id || null;
  const waiting = db().prepare("SELECT COUNT(*) n FROM content_posts WHERE auto_post=1 AND status='scheduled' AND auto_state IS NULL").get().n;
  return { enabled: autoEnabled(), channels: Object.keys(AUTO_CHANNELS), accounts, use, waiting, apps: Object.fromEntries([...new Set(Object.values(APP_OF))].map((a) => [a, appConfigured(a)])), late_limit_hours: LATE_LIMIT_MS / 3600_000 };
}

// ---- approval
/** Everything that stops this post from being approved, in plain words; empty when it can be. */
export function approvalProblems(p) {
  const out = [];
  if (isOnHold(p)) out.push('This post is on hold (it says DO NOT POST or ON HOLD). Remove the hold from the notes and title first, once it is cleared.');
  if (!AUTO_CHANNELS[p.channel]) out.push(`${CHANNELS[p.channel] || p.channel} cannot be posted automatically. Post it by hand and use Mark as posted.`);
  else if (!accountFor(p.channel)) out.push(`Connect a ${CHANNELS[p.channel]} account first.`);
  if (p.status !== 'scheduled' || !p.scheduled_at) out.push('Schedule the post first. The approval is for that exact time.');
  if ((p.channel === 'instagram' || p.channel === 'tiktok') && !p.media_url) out.push(`${CHANNELS[p.channel]} posts need an image or video address.`);
  if (p.channel === 'tiktok' && p.media_url && !/\.(mp4|mov|webm)(\?|#|$)/i.test(p.media_url)) out.push('TikTok posts need a video address.');
  if (p.channel === 'linkedin' && /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(p.media_url || '')) out.push('LinkedIn video posts are not supported yet. Post this one by hand.');
  if (!p.body && !p.media_url) out.push('The post has no text or media.');
  return out;
}
export function setAutoPost(id, enabled, by) {
  const p = getPost(id);
  if (!enabled) {
    if (p.auto_state === 'publishing') throw bad('This post is being published right now.');
    db().prepare("UPDATE content_posts SET auto_post=0, auto_by=NULL, auto_at=NULL WHERE id=?").run(p.id);
    return getPost(id);
  }
  const why = approvalProblems(p);
  if (why.length) throw bad(why.join(' '));
  db().prepare("UPDATE content_posts SET auto_post=1, auto_by=?, auto_at=datetime('now'), auto_error=NULL, auto_state=NULL WHERE id=?").run(by || null, p.id);
  return getPost(id);
}

// ---- the job
const postUrl = (channel, ref) => {
  const r = String(ref || '');
  if (!r) return null;
  if (channel === 'facebook') return `https://www.facebook.com/${r}`;
  if (channel === 'linkedin') return `https://www.linkedin.com/feed/update/${encodeURIComponent(r)}`;
  return null; // Instagram and TikTok do not return a public address
};
/**
 * Publishes the approved posts that are due. `publish` is replaceable for tests. Returns what happened, never throws for one post.
 */
export async function runDueAutoposts({ now = new Date(), publish = publishToAccount } = {}) {
  const d = db();
  const out = { posted: [], failed: [], skipped_off: false };
  // an interrupted publish: the outcome is unknown, so never try again on its own
  d.prepare("UPDATE content_posts SET auto_post=0, auto_state=NULL, auto_error='The server restarted while this was being published, so it is not known whether it went out. Check the channel, then use Mark as posted or reschedule.' WHERE auto_state='publishing' AND (auto_started_at IS NULL OR auto_started_at < ?)")
    .run(new Date(now.getTime() - 15 * 60_000).toISOString());
  if (!autoEnabled()) { out.skipped_off = true; return out; }
  const due = d.prepare("SELECT id FROM content_posts WHERE auto_post=1 AND status='scheduled' AND auto_state IS NULL AND scheduled_at<=? ORDER BY scheduled_at, id LIMIT 10").all(now.toISOString());
  for (const { id } of due) {
    const p = getPost(id);
    const stop = (msg) => { d.prepare("UPDATE content_posts SET auto_post=0, auto_state=NULL, auto_error=?, updated_at=datetime('now') WHERE id=?").run(String(msg).slice(0, 400), id); out.failed.push({ id, error: msg }); };
    if (isOnHold(p)) { stop('This post is on hold, so it was not posted.'); continue; }
    if (now.getTime() - new Date(p.scheduled_at).getTime() > LATE_LIMIT_MS) { stop(`Its time passed more than ${LATE_LIMIT_MS / 3600_000} hours ago, so it was not posted on its own. Reschedule it or post it by hand.`); continue; }
    const acc = accountFor(p.channel);
    if (!acc) { stop(`No ${CHANNELS[p.channel] || p.channel} account is connected.`); continue; }
    const claimed = d.prepare("UPDATE content_posts SET auto_state='publishing', auto_started_at=? WHERE id=? AND auto_post=1 AND auto_state IS NULL AND status='scheduled'").run(now.toISOString(), id);
    if (!claimed.changes) continue;
    try {
      const ref = await publish(acc, { message: p.body || p.title, media_url: p.media_url, link: p.link });
      d.prepare("UPDATE content_posts SET status='posted', posted_at=?, post_url=?, posted_by='auto-post', auto_state='done', auto_error=NULL, updated_at=datetime('now') WHERE id=?").run(new Date().toISOString(), postUrl(p.channel, ref), id);
      out.posted.push({ id, ref });
    } catch (e) { stop(e.message || 'The channel refused the post.'); }
  }
  return out;
}

/** Used by the schedule check: would this approved post still pass the limits at its time? (shown to the person approving) */
export function limitWarnings(p) {
  if (!p.scheduled_at) return [];
  return problems(listPosts(), getLimits(), { at: new Date(p.scheduled_at), channel: p.channel, exclude: p.id });
}
