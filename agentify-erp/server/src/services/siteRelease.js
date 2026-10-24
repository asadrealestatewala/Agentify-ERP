// Draft versus live for the company website. The editor saves to site_config and site_pages (the draft); visitors only
// ever see a release: a frozen copy of the theme and every page, made when someone presses Publish. Restoring an older
// release makes a new release with its content, so the history only grows and every step can be undone.
// A workspace that has never published gets its first release from the current draft the first time the site is read,
// so a site that was live before releases existed stays exactly as it was.
import crypto from 'node:crypto';
import { all, get, run, tx, getSetting, setSetting } from '../db.js';
import { HttpError, jparse, now } from '../util.js';
import { defaultConfig } from './siteDefaults.js';

// tables: site_releases, site_preview_links (schema.js)

const KEEP = 60; // releases kept per workspace (the live one is never removed)
const PREVIEW_DAYS = 7;
const PAGE_COLS = 'slug,title,sections,published,show_in_menu,sort_order,seo_title,seo_desc';

/** Saved configuration with the defaults filled in. `rates` is a user-defined list: replaced whole so deleted grades stay deleted. */
export function mergeConfig(saved) {
  const merge = (a, b) => (Array.isArray(b) || typeof b !== 'object' || b === null ? (b ?? a) : Object.fromEntries([...new Set([...Object.keys(a || {}), ...Object.keys(b)])].map((k) => [k, k in b ? (k !== 'rates' && typeof a?.[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], b[k]) : b[k]) : a[k]])));
  return merge(defaultConfig(), saved || {});
}

const draftPages = () => all(`SELECT ${PAGE_COLS} FROM site_pages ORDER BY sort_order, id`).map((p) => ({ ...p, sections: jparse(p.sections, []) }));
const draftState = () => ({ config: jparse(getSetting('site_config'), {}), pages: draftPages() });
const rowToRelease = (r) => (r ? { id: r.id, label: r.label, restored_from: r.restored_from, published_by: r.published_by, published_at: r.published_at, config: jparse(r.config, {}), pages: jparse(r.pages, []) } : null);

export const isOffline = () => getSetting('site_offline', '') === '1';

function insertRelease({ config, pages }, { label, userId = null, restoredFrom = null }) {
  const id = Number(run('INSERT INTO site_releases(config,pages,label,restored_from,published_by,published_at) VALUES(?,?,?,?,?,?)',
    JSON.stringify(config || {}), JSON.stringify(pages || []), String(label || '').slice(0, 120) || null, restoredFrom, userId, now()).lastInsertRowid);
  setSetting('site_live_release', String(id));
  run('DELETE FROM site_releases WHERE id NOT IN (SELECT id FROM site_releases ORDER BY id DESC LIMIT ?) AND id<>?', KEEP, id);
  return id;
}

/** The release visitors see (made from the draft on first use, see above). */
export function liveRelease() {
  const id = Number(getSetting('site_live_release', 0));
  let r = id ? get('SELECT * FROM site_releases WHERE id=?', id) : null;
  if (!r) {
    const newId = tx(() => insertRelease(draftState(), { label: 'First release (the website as it was)' }));
    r = get('SELECT * FROM site_releases WHERE id=?', newId);
  }
  return rowToRelease(r);
}

/** What the public site serves: the live release, or the draft for a valid preview link. */
export function publicSite({ preview = false } = {}) {
  if (preview) { const d = draftState(); return { config: mergeConfig(d.config), pages: d.pages, preview: true, offline: false }; }
  const live = liveRelease();
  return { config: mergeConfig(live.config), pages: live.pages, preview: false, offline: isOffline(), release: live.id };
}
export const liveConfig = () => mergeConfig(liveRelease().config);
export const livePages = () => liveRelease().pages.filter((p) => p.published);

/** Publish the draft as a new release and bring the site online. */
export function publishDraft(userId, label) {
  return tx(() => {
    const id = insertRelease(draftState(), { label: label || 'Published', userId });
    setSetting('site_offline', '');
    return id;
  });
}

/** Rollback: the chosen release's content becomes live again (as a new release). The draft is not touched. */
export function restoreRelease(releaseId, userId) {
  const old = rowToRelease(get('SELECT * FROM site_releases WHERE id=?', releaseId));
  if (!old) throw new HttpError(404, 'That version of the website no longer exists');
  return tx(() => {
    const id = insertRelease(old, { label: `Restored the version of ${old.published_at.slice(0, 16)}`, userId, restoredFrom: old.id });
    setSetting('site_offline', '');
    return id;
  });
}

export function setOffline(offline) {
  liveRelease(); // a site taken offline and brought back must come back as it was, not as the draft
  setSetting('site_offline', offline ? '1' : '');
}

/** Would publishing change what visitors see? (compared on content, not on save times; hidden pages are not seen) */
export function draftDiffers() {
  const live = liveRelease();
  const d = draftState();
  const shown = (pages) => JSON.stringify(pages.filter((p) => p.published));
  return JSON.stringify(mergeConfig(d.config)) !== JSON.stringify(mergeConfig(live.config)) || shown(d.pages) !== shown(live.pages);
}

export function releaseList() {
  const liveId = liveRelease().id;
  return all(`SELECT r.id, r.label, r.restored_from, r.published_at, u.name by_name, json_array_length(r.pages) pages FROM site_releases r LEFT JOIN users u ON u.id=r.published_by ORDER BY r.id DESC`)
    .map((r) => ({ ...r, live: r.id === liveId }));
}

/**
 * Throw away unpublished edits: the draft becomes the live release again. Pages are matched by address; each one that changes
 * keeps its old layout in its version history first. Pages added since the last publish are kept but hidden.
 */
export function discardDraft(userId) {
  const live = liveRelease();
  return tx(() => {
    setSetting('site_config', JSON.stringify(live.config || {}));
    const bySlug = new Map(live.pages.map((p) => [p.slug, p]));
    for (const cur of all('SELECT * FROM site_pages')) {
      const want = bySlug.get(cur.slug);
      const sections = want ? JSON.stringify(want.sections) : cur.sections;
      if (want && cur.sections !== sections) run('INSERT INTO site_page_versions(page_id,title,sections,label,user_id,created_at) VALUES(?,?,?,?,?,?)', cur.id, cur.title, cur.sections, 'Before discarding unpublished changes', userId, now());
      if (want) run('UPDATE site_pages SET title=?,sections=?,published=?,show_in_menu=?,sort_order=?,seo_title=?,seo_desc=?,updated_at=? WHERE id=?', want.title, sections, want.published ? 1 : 0, want.show_in_menu ? 1 : 0, want.sort_order, want.seo_title ?? null, want.seo_desc ?? null, now(), cur.id);
      else run('UPDATE site_pages SET published=0, show_in_menu=0, updated_at=? WHERE id=?', now(), cur.id);
      bySlug.delete(cur.slug);
    }
    for (const p of bySlug.values()) run('INSERT INTO site_pages(slug,title,sections,published,show_in_menu,sort_order,seo_title,seo_desc,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', p.slug, p.title, JSON.stringify(p.sections), p.published ? 1 : 0, p.show_in_menu ? 1 : 0, p.sort_order, p.seo_title ?? null, p.seo_desc ?? null, now());
  });
}

// ---- preview links: anyone with the link sees the unpublished draft for a week (search engines are told not to index it)
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const plusDays = (d) => new Date(Date.now() + d * 864e5).toISOString();

export function createPreviewLink(userId) {
  const token = crypto.randomBytes(24).toString('base64url');
  run("DELETE FROM site_preview_links WHERE expires_at < ?", new Date().toISOString());
  run('INSERT INTO site_preview_links(token_hash,created_by,created_at,expires_at) VALUES(?,?,?,?)', hash(token), userId, now(), plusDays(PREVIEW_DAYS));
  return { token, expires_at: plusDays(PREVIEW_DAYS) };
}
export function validPreview(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return false;
  return !!get('SELECT 1 FROM site_preview_links WHERE token_hash=? AND expires_at > ?', hash(t), new Date().toISOString());
}
export const revokePreviewLinks = () => run('DELETE FROM site_preview_links');

