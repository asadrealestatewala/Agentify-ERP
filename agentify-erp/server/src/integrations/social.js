// Social posting and reports for Facebook Pages, Instagram business accounts, LinkedIn and TikTok.
// Accounts are connected with OAuth (see services/oauthApps.js); tokens are stored encrypted in the workspace database.
// Posts can be published now or scheduled; a background job publishes the ones that are due. Providers decide what an app
// may do: Meta, LinkedIn and TikTok each review apps before they allow posting for other people's accounts, so the platform
// owner's app must be approved by them first. Until then a post fails with the provider's own message, which is shown.
import { all, get, run } from '../db.js';
import { encrypt, decrypt } from '../services/platformConfig.js';
import { now } from '../util.js';

const GRAPH = 'https://graph.facebook.com/v19.0';
const jfetch = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) });
  let d = {}; try { d = await res.json(); } catch { /* none */ }
  if (!res.ok || d.error) throw new Error(d.error?.message || d.error_description || d.message || d.error?.toString?.() || `The provider answered ${res.status}`);
  return d;
};

/** What a sign-in with a provider gives access to: one entry per Page, Instagram account, profile or channel. */
export async function discoverAccounts(provider, tokens) {
  const token = tokens.access_token;
  const found = [];
  if (provider === 'meta') {
    const pages = await jfetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50&access_token=${encodeURIComponent(token)}`);
    for (const p of pages.data || []) {
      found.push({ provider: 'facebook', externalId: p.id, name: p.name, secret: { token: p.access_token }, meta: null });
      if (p.instagram_business_account) found.push({ provider: 'instagram', externalId: p.instagram_business_account.id, name: `@${p.instagram_business_account.username}`, secret: { token: p.access_token }, meta: { page_id: p.id } });
    }
  } else if (provider === 'linkedin') {
    const me = await jfetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    found.push({ provider: 'linkedin', externalId: me.sub, name: me.name || 'LinkedIn profile', secret: { token, expires_at: Date.now() + (tokens.expires_in || 5_000_000) * 1000 }, meta: null });
  } else if (provider === 'tiktok') {
    const me = await jfetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', { headers: { Authorization: `Bearer ${token}` } });
    const u = me.data?.user || {};
    found.push({ provider: 'tiktok', externalId: u.open_id || tokens.open_id, name: u.display_name || 'TikTok account', secret: { token, refresh_token: tokens.refresh_token }, meta: null });
  }
  return found;
}
/** Called after a successful OAuth sign-in for purpose "social" (inside the workspace). */
export async function onSocialConnected(provider, tokens, userId) {
  for (const a of await discoverAccounts(provider, tokens)) upsertAccount(a.provider, a.externalId, a.name, a.secret, a.meta, userId);
}
function upsertAccount(provider, externalId, name, secret, meta, userId) {
  run(`INSERT INTO social_connections(provider, external_id, name, token_enc, meta, connected_by, connected_at, status) VALUES(?,?,?,?,?,?,?, 'connected')
       ON CONFLICT(provider, external_id) DO UPDATE SET name=excluded.name, token_enc=excluded.token_enc, meta=excluded.meta, connected_by=excluded.connected_by, connected_at=excluded.connected_at, status='connected'`,
  provider, String(externalId), name, encrypt(JSON.stringify(secret)), meta ? JSON.stringify(meta) : null, userId, now());
}
export const listAccounts = () => all('SELECT id, provider, external_id, name, connected_at, status FROM social_connections ORDER BY provider, name');
export const removeAccount = (id) => { run("DELETE FROM social_posts WHERE account_id=? AND status IN ('scheduled','failed')", id); run('DELETE FROM social_connections WHERE id=?', id); };
const secretOf = (acc) => JSON.parse(decrypt(acc.token_enc));
export const isVideoUrl = (u) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(String(u || ''));
/** Instagram prepares a video before it can be published; waits for it. Tests shorten the wait. */
export const timing = { igPollMs: 5000, igMaxPolls: 36 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Publishes one post now. Returns the provider's post id. */
export async function publishToAccount(acc, post) {
  const { token } = secretOf(acc);
  if (acc.provider === 'facebook') {
    const body = new URLSearchParams({ access_token: token });
    if (isVideoUrl(post.media_url)) {
      body.set('file_url', post.media_url); body.set('description', post.message);
      const d = await jfetch(`${GRAPH}/${acc.external_id}/videos`, { method: 'POST', body });
      return d.id;
    }
    if (post.media_url) { body.set('url', post.media_url); body.set('caption', post.message); }
    else { body.set('message', post.message); if (post.link) body.set('link', post.link); }
    const d = await jfetch(`${GRAPH}/${acc.external_id}/${post.media_url ? 'photos' : 'feed'}`, { method: 'POST', body });
    return d.post_id || d.id;
  }
  if (acc.provider === 'instagram') {
    if (!post.media_url) throw new Error('Instagram posts need a picture or video. Add a media address.');
    const video = isVideoUrl(post.media_url);
    const made = await jfetch(`${GRAPH}/${acc.external_id}/media`, { method: 'POST', body: new URLSearchParams({ ...(video ? { media_type: 'REELS', video_url: post.media_url } : { image_url: post.media_url }), caption: post.message, access_token: token }) });
    if (video) {
      for (let i = 0; ; i += 1) {
        const st = await jfetch(`${GRAPH}/${made.id}?fields=status_code&access_token=${encodeURIComponent(token)}`);
        if (st.status_code === 'FINISHED') break;
        if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error('Instagram could not process the video. Check that the address is public and the video is a normal MP4.');
        if (i >= timing.igMaxPolls) throw new Error('Instagram is still preparing the video. It was not published; check the account before trying again.');
        await sleep(timing.igPollMs);
      }
    }
    const pub = await jfetch(`${GRAPH}/${acc.external_id}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: made.id, access_token: token }) });
    return pub.id;
  }
  if (acc.provider === 'linkedin') {
    if (isVideoUrl(post.media_url)) throw new Error('LinkedIn video posts are not supported yet. Post this one by hand, or remove the video address.');
    const body = { author: `urn:li:person:${acc.external_id}`, lifecycleState: 'PUBLISHED', specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: post.message }, shareMediaCategory: post.link ? 'ARTICLE' : 'NONE', ...(post.link ? { media: [{ status: 'READY', originalUrl: post.link }] } : {}) } }, visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' } };
    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.message || `LinkedIn answered ${res.status}`);
    return res.headers.get('x-restli-id') || d.id;
  }
  if (acc.provider === 'tiktok') {
    if (!post.media_url) throw new Error('TikTok posts need a video address.');
    const d = await jfetch('https://open.tiktokapis.com/v2/post/publish/video/init/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ post_info: { title: post.message.slice(0, 150), privacy_level: 'SELF_ONLY' }, source_info: { source: 'PULL_FROM_URL', video_url: post.media_url } }) });
    return d.data?.publish_id;
  }
  throw new Error('Unknown account type');
}
export function createPost({ account_id, message, media_url, link, property_id, scheduled_at }, userId) {
  const acc = get('SELECT id FROM social_connections WHERE id=?', Number(account_id));
  if (!acc) throw new Error('Choose a connected account');
  const id = Number(run('INSERT INTO social_posts(account_id, message, media_url, link, property_id, scheduled_at, status, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    acc.id, String(message).trim(), media_url || null, link || null, property_id || null, scheduled_at || null, 'scheduled', userId, now()).lastInsertRowid);
  return id;
}

/** Publishes every post that is due. Safe to call often; a failed post stays failed with the provider's message. */
export async function runDuePosts() {
  const due = all("SELECT * FROM social_posts WHERE status='scheduled' AND (scheduled_at IS NULL OR scheduled_at<=?) ORDER BY id LIMIT 20", now());
  let done = 0;
  for (const p of due) {
    const acc = get('SELECT * FROM social_connections WHERE id=?', p.account_id);
    run("UPDATE social_posts SET status='publishing' WHERE id=? AND status='scheduled'", p.id);
    try {
      const ext = await publishToAccount(acc, p);
      run("UPDATE social_posts SET status='published', external_post_id=?, published_at=?, error=NULL WHERE id=?", String(ext || ''), now(), p.id);
      done += 1;
    } catch (e) { run("UPDATE social_posts SET status='failed', error=? WHERE id=?", String(e.message).slice(0, 300), p.id); }
  }
  return done;
}

/** Refreshes likes, comments, shares and reach for recent posts (Meta; other providers do not expose them to this app type). */
export async function refreshMetrics() {
  const rows = all("SELECT p.id, p.external_post_id, a.* FROM social_posts p JOIN social_connections a ON a.id=p.account_id WHERE p.status='published' AND a.provider IN ('facebook','instagram') ORDER BY p.id DESC LIMIT 30");
  for (const r of rows) {
    try {
      const { token } = secretOf(r);
      let m = {};
      if (r.provider === 'facebook') {
        const d = await jfetch(`${GRAPH}/${r.external_post_id}?fields=likes.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(token)}`);
        const ins = await jfetch(`${GRAPH}/${r.external_post_id}/insights?metric=post_impressions,post_impressions_unique&access_token=${encodeURIComponent(token)}`).catch(() => ({ data: [] }));
        const v = (n) => ins.data?.find((x) => x.name === n)?.values?.[0]?.value ?? null;
        m = { likes: d.likes?.summary?.total_count ?? 0, comments: d.comments?.summary?.total_count ?? 0, shares: d.shares?.count ?? 0, impressions: v('post_impressions'), reach: v('post_impressions_unique') };
      } else {
        const d = await jfetch(`${GRAPH}/${r.external_post_id}?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`);
        const ins = await jfetch(`${GRAPH}/${r.external_post_id}/insights?metric=impressions,reach&access_token=${encodeURIComponent(token)}`).catch(() => ({ data: [] }));
        const v = (n) => ins.data?.find((x) => x.name === n)?.values?.[0]?.value ?? null;
        m = { likes: d.like_count ?? 0, comments: d.comments_count ?? 0, shares: null, impressions: v('impressions'), reach: v('reach') };
      }
      run(`INSERT INTO social_metrics(post_id, fetched_at, impressions, reach, likes, comments, shares, clicks) VALUES(?,?,?,?,?,?,?,NULL)
           ON CONFLICT(post_id) DO UPDATE SET fetched_at=excluded.fetched_at, impressions=excluded.impressions, reach=excluded.reach, likes=excluded.likes, comments=excluded.comments, shares=excluded.shares`, r.id, now(), m.impressions, m.reach, m.likes, m.comments, m.shares);
    } catch { /* leave the previous numbers */ }
  }
}

export function socialReport() {
  const posts = all(`SELECT p.id, p.message, p.status, p.scheduled_at, p.published_at, p.error, a.provider, a.name AS account, m.impressions, m.reach, m.likes, m.comments, m.shares
    FROM social_posts p JOIN social_connections a ON a.id=p.account_id LEFT JOIN social_metrics m ON m.post_id=p.id ORDER BY COALESCE(p.published_at, p.scheduled_at, p.created_at) DESC LIMIT 100`);
  const sum = (k) => posts.reduce((s, p) => s + (p[k] || 0), 0);
  const byProvider = {};
  for (const p of posts) { const b = (byProvider[p.provider] ||= { posts: 0, published: 0, failed: 0, likes: 0, comments: 0, impressions: 0 }); b.posts += 1; if (p.status === 'published') b.published += 1; if (p.status === 'failed') b.failed += 1; b.likes += p.likes || 0; b.comments += p.comments || 0; b.impressions += p.impressions || 0; }
  return { totals: { posts: posts.length, published: posts.filter((p) => p.status === 'published').length, scheduled: posts.filter((p) => p.status === 'scheduled').length, failed: posts.filter((p) => p.status === 'failed').length, likes: sum('likes'), comments: sum('comments'), shares: sum('shares'), impressions: sum('impressions'), reach: sum('reach') }, by_provider: byProvider, posts };
}
