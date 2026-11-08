// Picks a free Unsplash photo for every blog article and saves the credits in server/src/content/blog-photos.json.
//   UNSPLASH_ACCESS_KEY=... node scripts/fetch-blog-photos.mjs
// Follows the Unsplash API guidelines: photos are hot-linked from images.unsplash.com, the download endpoint is called for each
// photo that is used, and the photographer and Unsplash are credited (with utm links) on the article.
// The demo tier allows 50 requests an hour; the script waits when the limit gets close, and can be re-run (it skips finished articles).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOG_POSTS } from '../server/src/services/blog.js';

const KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!KEY) { console.error('Set UNSPLASH_ACCESS_KEY'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'server', 'src', 'content', 'blog-photos.json');
const CACHE = process.env.PHOTO_CACHE || path.join(root, '.photo-search-cache.json');
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UTM = 'utm_source=agentify_erp&utm_medium=referral';

const QUERIES = {
  home: 'modern house exterior', keys: 'real estate agent house keys', city: 'apartment buildings city', deal: 'business handshake contract',
  office: 'team laptop office meeting', site: 'construction site workers', plan: 'architect blueprints plans', crane: 'construction crane building',
  brick: 'bricks cement building materials', calc: 'calculator documents accounting',
};
const GROUPS = [
  [/construction-accounting|construction-(management|project|daily|labour|store|vendor|erp|purchase|client|boq|cash)|boq|labour|grey-structure|purchase-orders|erp-for-small/, ['site', 'plan', 'crane', 'brick']],
  [/receipt|accounting|tax|commission|cash|ledger|reports|installment|instalment|payment/, ['calc', 'deal']],
  [/lead|whatsapp|marketing|website|listing|crm|dealer|visit|multi-branch|best-real|start-real/, ['office', 'keys', 'deal']],
];
const groupOf = (slug) => (GROUPS.find(([re]) => re.test(slug)) || [null, ['home', 'city', 'keys']])[1];

async function api(url) {
  for (;;) {
    const r = await fetch(url, { headers: { Authorization: `Client-ID ${KEY}`, 'Accept-Version': 'v1' } });
    const left = Number(r.headers.get('x-ratelimit-remaining'));
    if (r.status === 403 || r.status === 429 || (Number.isFinite(left) && left <= 2 && r.ok)) {
      console.log(`rate limit close (remaining ${left}); waiting 10 minutes`); await sleep(10 * 60 * 1000);
      if (!r.ok) continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r;
  }
}
async function results(q) {
  if (cache[q]) return cache[q];
  const r = await api(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(QUERIES[q])}&per_page=30&orientation=landscape&content_filter=high`);
  cache[q] = (await r.json()).results.map((p) => ({ id: p.id, w: p.width, h: p.height, raw: p.urls.raw, alt: p.alt_description || p.description || '', name: p.user.name, profile: p.user.links.html, page: p.links.html, dl: p.links.download_location, likes: p.likes }));
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`searched "${QUERIES[q]}": ${cache[q].length}`);
  return cache[q];
}

const used = new Set(Object.values(out).map((o) => o.id));
let n = 0;
for (const p of BLOG_POSTS) {
  if (out[p.slug]) continue;
  const g = groupOf(p.slug);
  const qk = g[n % g.length]; n++;
  const list = (await results(qk)).filter((x) => !used.has(x.id) && x.w >= 3000 && x.w / x.h > 1.3);
  const pick = list[0];
  if (!pick) { console.log('no photo for', p.slug); continue; }
  await api(pick.dl); // tells Unsplash the photo is used
  used.add(pick.id);
  out[p.slug] = { id: pick.id, raw: pick.raw, alt: pick.alt, name: pick.name, profile: `${pick.profile}?${UTM}`, page: `${pick.page}?${UTM}`, query: QUERIES[qk] };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`${p.slug} <- ${pick.id} (${pick.name}) [${QUERIES[qk]}]`);
  await sleep(4000);
}
console.log('done', Object.keys(out).length, 'of', BLOG_POSTS.length);
