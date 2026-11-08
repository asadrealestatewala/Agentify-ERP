// Articles written by the blog agent and published from the console. They live in the platform database (the built-in
// articles ship as data files in blog.js) and join the public blog, the sitemap and article pages once published.
import { platformDb } from '../platform.js';

const SCHEMA = `CREATE TABLE IF NOT EXISTS blog_agent_posts(
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, tag TEXT, keyword TEXT,
  body TEXT NOT NULL, faq TEXT, tags TEXT, related TEXT, sources TEXT, photo TEXT, read_min INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'draft', checks TEXT, cost_usd REAL, language TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), published_at TEXT, reviewed_by TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_blog_agent_status ON blog_agent_posts(status, created_at);`;
let ready = false;
export const store = () => { const d = platformDb(); if (!ready) { d.exec(SCHEMA); ready = true; } return d; };
export const resetStoreCache = () => { ready = false; cache = null; };

const j = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
/** Row as the blog renders it (same shape as the built-in articles). */
export const toPost = (r) => ({ slug: r.slug, title: r.title, description: r.description, keyword: r.keyword || undefined, tag: r.tag || 'Real estate', tags: j(r.tags, []),
  faq: j(r.faq, []), related: j(r.related, []), body: j(r.body, []), date: (r.published_at || r.created_at || '').slice(0, 10), read: r.read_min, photo: j(r.photo, null), agent: true });

let cache = null;
/** Published agent articles, newest first. Cached until something is published, unpublished or edited. */
export function publishedPosts() {
  if (cache) return cache;
  try { cache = store().prepare("SELECT * FROM blog_agent_posts WHERE status='published' ORDER BY published_at DESC").all().map(toPost); } catch { return []; }
  return cache;
}
export const invalidate = () => { cache = null; };
