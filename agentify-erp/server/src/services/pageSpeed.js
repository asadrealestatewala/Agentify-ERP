// Google PageSpeed Insights for the Blog agent page: speed, SEO, accessibility and best-practice scores (0 to 100) for the blog pages.
import { getSetting, setSetting } from './platformConfig.js';
import { allPosts } from './blog.js';
import { siteUrl } from './searchConsole.js';

const bad = (m) => Object.assign(new Error(m), { status: 400 });
const cache = new Map();
export const origin = () => { try { const u = new URL(siteUrl()); return u.origin; } catch { return 'https://agentifyerp.co'; } };
export const status = () => { const k = getSetting('pagespeed_api_key'); return { set: !!k, hint: k ? `…${k.slice(-4)}` : null }; };
export function saveKey(key, by = null) {
  const v = String(key || '').trim();
  if (v && !/^[A-Za-z0-9_\-]{20,80}$/.test(v)) throw bad('That key does not look right. Paste only the key, with no spaces.');
  setSetting('pagespeed_api_key', v, { secret: true, by }); cache.clear(); return status();
}
/** Pages worth checking: the blog index and the newest articles. */
export const pages = () => [{ url: `${origin()}/blog`, label: 'Blog index' }, ...[...allPosts()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12).map((p) => ({ url: `${origin()}/blog/${p.slug}`, label: p.title }))];

export async function check(url, { fresh = false } = {}) {
  let u; try { u = new URL(url); } catch { throw bad('Choose a page to check.'); }
  if (u.origin !== origin()) throw bad('Only pages of your own website can be checked.');
  const hit = cache.get(u.href); if (!fresh && hit && hit.at > Date.now() - 6 * 3600_000) return hit.data;
  const q = new URLSearchParams({ url: u.href, strategy: 'mobile' });
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) q.append('category', c);
  const key = getSetting('pagespeed_api_key'); if (key) q.set('key', key);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(90_000) });
  const d = await res.json().catch(() => ({}));
  if (res.status === 429) throw bad('PageSpeed limit reached. Add or check the PageSpeed API key, or try again later.');
  if (!res.ok) throw bad(`PageSpeed error (${d.error?.message || res.status})`);
  const c = d.lighthouseResult?.categories || {}; const sc = (k) => (c[k]?.score == null ? null : Math.round(c[k].score * 100));
  const a = d.lighthouseResult?.audits || {};
  const data = { url: u.href, at: new Date().toISOString(), strategy: 'mobile', scores: { speed: sc('performance'), seo: sc('seo'), accessibility: sc('accessibility'), best_practices: sc('best-practices') },
    metrics: { lcp: a['largest-contentful-paint']?.displayValue || null, cls: a['cumulative-layout-shift']?.displayValue || null, tbt: a['total-blocking-time']?.displayValue || null },
    fixes: Object.entries(a).filter(([id, x]) => x.score != null && x.score < 0.9 && x.title && ['seo', 'accessibility', 'best-practices'].some((g) => (c[g]?.auditRefs || []).some((r) => r.id === id))).slice(0, 6).map(([, x]) => x.title) };
  cache.set(u.href, { at: Date.now(), data }); return data;
}
