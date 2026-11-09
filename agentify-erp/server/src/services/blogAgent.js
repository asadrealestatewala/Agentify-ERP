// The blog agent (Super Admin console > Blog agent). Each day it proposes topics for the Agentify blog, researches them on the web
// (Tavily), writes original articles with the platform Gemini key, checks them and saves them as DRAFTS in the console. A person
// approves each one before it appears on /blog (unless auto-publish is switched on, which is off by default). A hard daily cap applies.
// It never copies other sites: sources are read for facts only and the prompt forbids invented figures, names and quotes.
import { geminiGenerate } from './aiGateway.js';
import { groqChat, groqReady } from './groqGateway.js';
import { config as geminiConfig } from './aiUsage.js';
import { getSetting, setSetting } from './platformConfig.js';
import { topQueries } from './searchConsole.js';
import { allPosts, parseBody, words } from './blog.js';
import { store, invalidate, toPost } from './blogStore.js';
import { bad, notFound } from '../util.js';
import { platformDb } from '../platform.js';
import { BRAND, DOMAIN, BRAND_RULES, FORBIDDEN_CLAIMS, BRAND_FAQ, closingFor } from './brandFacts.js';

export const HARD_MAX_PER_DAY = 10;
export const DEFAULTS = { cap: 5, focus: 'Real estate agencies, property dealers, developers and construction contractors in Pakistan (and general real-estate software buyers); practical how-to and buying-guide topics', min_words: 600 };
const TAGS = ['Real estate', 'Construction', 'Sales', 'Business', 'Pakistan', 'Software'];

// ---- settings
const flag = (k, d = false) => { const v = getSetting(k); return v == null || v === '' ? d : v === '1'; };
export const ENGINES = ['gemini', 'groq'];
const engineChoice = () => { const v = getSetting('blog_agent_engine'); return ENGINES.includes(v) ? v : 'gemini'; };
export function settings() {
  const cap = Number(getSetting('blog_agent_cap')); const tav = getSetting('tavily_api_key'); const uns = getSetting('unsplash_access_key');
  return { enabled: flag('blog_agent_enabled'), auto_publish: flag('blog_agent_auto_publish'), cap: Number.isInteger(cap) && cap >= 1 ? Math.min(cap, HARD_MAX_PER_DAY) : DEFAULTS.cap,
    focus: getSetting('blog_agent_focus') || DEFAULTS.focus, engine: engineChoice(), engines: { gemini: !!geminiConfig().key, groq: groqReady() }, tavily: { set: !!tav, hint: tav ? `…${tav.slice(-4)}` : null }, unsplash: { set: !!uns, hint: uns ? `…${uns.slice(-4)}` : null } };
}
export function saveSettings(b = {}, by = null) {
  if (b.enabled != null) setSetting('blog_agent_enabled', b.enabled ? '1' : '0', { by });
  if (b.auto_publish != null) setSetting('blog_agent_auto_publish', b.auto_publish ? '1' : '0', { by });
  if (b.cap != null) { const n = Number(b.cap); if (!Number.isInteger(n) || n < 1 || n > HARD_MAX_PER_DAY) throw bad(`Articles per day must be a whole number from 1 to ${HARD_MAX_PER_DAY}`); setSetting('blog_agent_cap', String(n), { by }); }
  if (b.engine != null) { if (!ENGINES.includes(b.engine)) throw bad('Choose Gemini or Groq as the writing engine'); setSetting('blog_agent_engine', b.engine, { by }); }
  if (b.focus != null) { const f = String(b.focus).trim(); if (f.length > 600) throw bad('The topic focus is too long (600 characters at most)'); setSetting('blog_agent_focus', f, { by }); }
  for (const [field, key] of [['tavily_key', 'tavily_api_key'], ['unsplash_key', 'unsplash_access_key']]) {
    if (b[field] === undefined) continue;
    const v = String(b[field] || '').trim();
    if (v && !/^[A-Za-z0-9_\-]{12,200}$/.test(v)) throw bad('That key does not look right. Paste only the key, with no spaces.');
    setSetting(key, v, { secret: true, by });
  }
  return settings();
}

// ---- helpers
const slugify = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const toks = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
export const similarity = (a, b) => { const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
const startOfDay = () => new Date().toISOString().slice(0, 10);
export const madeToday = () => store().prepare("SELECT COUNT(*) n FROM blog_agent_posts WHERE substr(created_at,1,10)=? AND status!='rejected'").get(startOfDay()).n;
const existingTitles = () => [...allPosts().map((p) => p.title), ...store().prepare('SELECT title FROM blog_agent_posts').all().map((r) => r.title)];
const jsonOf = (d) => { const t = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''); try { return JSON.parse(t.match(/[\[{][\s\S]*[\]}]/)?.[0] || ''); } catch { return null; } };
const asGemini = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const viaGemini = (system, prompt, max) => geminiGenerate({ feature: 'blog_agent', purpose: 'blog_agent', body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: max, temperature: 0.7 } }, timeout: 120_000 });
const groqCall = (system, prompt, max, json) => groqChat({ feature: 'blog_agent', purpose: 'blog_agent', messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], maxTokens: Math.min(max, 8000), timeout: 120_000, json, temperature: 0.7 });
/** Groq's strict JSON mode refuses a whole answer when one quote is unescaped ("Failed to generate JSON"). Then ask again without it; jsonOf() reads the JSON out of the text. */
const viaGroq = async (system, prompt, max) => {
  try { return asGemini(await groqCall(system, prompt, max, true)); }
  catch (e) { if (!/Failed to generate JSON|json_validate|failed_generation/i.test(String(e.message))) throw e; }
  return asGemini(await groqCall(`${system}\nReturn ONLY the JSON object, no other text, and escape any double quote inside a string.`, prompt, max, false));
};
/** One JSON-answering model call on the chosen engine; if it fails, the other engine is tried when it is connected. */
async function gem(system, prompt, max) {
  const first = engineChoice(); const order = first === 'groq' ? [['groq', viaGroq], ['gemini', viaGemini]] : [['gemini', viaGemini], ['groq', viaGroq]];
  const ready = { gemini: !!geminiConfig().key, groq: groqReady() };
  let lastErr;
  for (const [name, fn] of order) {
    if (!ready[name]) continue;
    try { return await fn(system, prompt, max); } catch (e) { lastErr = e; if (e.extra?.code && e.extra.code !== 'provider_error') throw e; }
  }
  throw lastErr || bad('Connect Gemini or Groq in the console AI settings first.');
}

// ---- web research (Tavily). Sources are used for facts only.
export async function searchWeb(query, key = getSetting('tavily_api_key')) {
  if (!key) throw bad('Add a Tavily API key in the Blog agent settings first.');
  const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw bad(`Web search failed (${res.status}). Check the Tavily key and plan.`);
  return (d.results || []).filter((r) => r.url && r.content).map((r) => ({ title: String(r.title || '').slice(0, 160), url: r.url, snippet: String(r.content).slice(0, 900) }));
}

// ---- optional photo (Unsplash), same credit rules as the built-in articles
async function findPhoto(query) {
  const key = getSetting('unsplash_access_key'); if (!key) return null;
  try {
    const res = await fetch(`https://api.unsplash.com/search/photos?per_page=1&orientation=landscape&query=${encodeURIComponent(query)}`, { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(15_000) });
    const p = (await res.json())?.results?.[0]; if (!res.ok || !p?.urls?.raw) return null;
    return { raw: p.urls.raw, name: p.user?.name || 'Unsplash photographer', profile: `${p.user?.links?.html}?utm_source=agentify_erp&utm_medium=referral`, page: `${p.links?.html}?utm_source=agentify_erp&utm_medium=referral` };
  } catch { return null; }
}

// ---- steps
const TOPIC_SYSTEM = `You are the SEO editor of the ${BRAND} blog (CRM and ERP for real estate and construction companies, mainly for Pakistan). Propose blog topics people actually search for. Each topic has a "kind": "guide" (a useful how-to or checklist for the audience; ${BRAND} may appear naturally) or "brand" (an article about ${BRAND} itself: what it is, a use case for one role such as sales manager, accountant or site engineer, a feature explained, how to move from Excel to ${BRAND}, or an honest comparison of ${BRAND} with an approach such as spreadsheets, a generic CRM or portal-bundled tools; never name competitor products). Brand topic titles must contain "${BRAND}". Reply with JSON only: {"topics": [{"topic": "working title", "kind": "guide" | "brand", "keyword": "main search phrase", "query": "web search query to research it"}]}.`;
/** n topics, of which `brandN` are about the product itself (brand and comparison articles). */
export async function proposeTopics(n, focus, brandN = 0) {
  const have = existingTitles().slice(-150).join('\n');
  const real = await topQueries();
  const d = await gem(TOPIC_SYSTEM, `Focus: ${focus}\nPropose ${n + 4} NEW topics, at least ${Math.min(n, brandN) + 1} of kind "brand" and the rest "guide". Do not repeat or closely overlap these existing articles:\n${have}${real.length ? `\nReal searches that already bring visitors to the site (use them as inspiration for related topics, do not copy blindly): ${real.join('; ')}` : ''}`, 2000);
  const raw = jsonOf(d); const arr = Array.isArray(raw) ? raw : raw?.topics; if (!Array.isArray(arr)) return [];
  const titles = existingTitles();
  const ok = arr.filter((t) => t?.topic && t?.query && !titles.some((x) => similarity(x, t.topic) > 0.5)).map((t) => ({ ...t, kind: t.kind === 'brand' ? 'brand' : 'guide' }));
  const brand = ok.filter((t) => t.kind === 'brand').slice(0, brandN), guide = ok.filter((t) => t.kind === 'guide').slice(0, n - brand.length);
  return [...brand, ...guide].slice(0, n);
}

const WRITE_SYSTEM = `You write original blog articles for Agentify ERP, a CRM and ERP for real estate and construction companies. Rules: use ONLY facts supported by the supplied source snippets or plain common knowledge; never invent statistics, prices, laws, quotes, customer names or awards; if a figure is uncertain, say it varies and tell the reader to check. Do not copy sentences from the sources; write in your own words. Be practical, specific and honest, not salesy. ${BRAND_RULES} Name \"${BRAND}\" in full (never just \"the software\") about 3 to 5 times in the article, naturally: in the introduction, where a point is illustrated by what the product does, and in a closing next step that points to ${DOMAIN}. For an article of kind \"brand\", put \"${BRAND}\" in the title and the description, explain the product honestly using only the facts above, and say when it is not the right choice. For a guide, the useful advice comes first and the product is one example of how to do it. Write in clear English. Reply with JSON only: {"title": "...", "description": "70-160 characters for search results", "tag": one of ${JSON.stringify(TAGS)}, "keyword": "main search phrase", "tags": ["#hashtag", ...up to 4], "body": ["line", ...], "faq": [["question","answer"], ...3 items]}. "body" lines: a line starting with "# " is a heading, a line starting with "* " is a bullet, any other line is a paragraph. Use 4-6 headings and at least ${DEFAULTS.min_words} words.`;

/** Checks an article must pass before it reaches the review queue. Returns a list of problems (empty = passed). */
const brandMentions = (t) => (String(t).match(/agentify erp|agentifyerp/gi) || []).length;
export function checkArticle(a, others = existingTitles(), kind = 'guide') {
  const out = [];
  const body = parseBody(a.body || []);
  const w = words(body);
  if (w < DEFAULTS.min_words) out.push(`Too short (${w} words, at least ${DEFAULTS.min_words})`);
  if (body.filter((b) => b.h).length < 3) out.push('Needs at least 3 headings');
  if (!a.title || a.title.length < 20 || a.title.length > 110) out.push('Title should be 20-110 characters');
  if (!a.description || a.description.length < 60 || a.description.length > 175) out.push('Description should be 60-175 characters');
  if (others.some((t) => similarity(t, a.title) > 0.6)) out.push('Too close to an existing article');
  const text = (a.body || []).join(' ');
  if (/as an ai|language model|lorem ipsum|\[(?:source|link|insert)/i.test(text)) out.push('Contains AI boilerplate or placeholders');
  if (/\b(?:guaranteed|100% safe|get rich)\b/i.test(text)) out.push('Contains risky claims');
  const all = `${a.title} ${a.description} ${text} ${JSON.stringify(a.faq || [])}`;
  if (FORBIDDEN_CLAIMS.test(all)) out.push('Makes a ranking, award, customer-count, uptime or similar claim we cannot back up');
  if (brandMentions(text) < 2) out.push(`Mentions ${BRAND} fewer than 2 times`);
  if (kind === 'brand' && !/agentify erp/i.test(a.title || '')) out.push(`A brand article needs "${BRAND}" in the title`);
  if (kind === 'brand' && brandMentions(text) < 4) out.push(`A brand article should name ${BRAND} at least 4 times`);
  return { problems: out, words: w };
}

export async function writeArticle(t, sources) {
  const src = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.snippet}`).join('\n\n');
  const prompt = `Topic: ${t.topic}\nMain keyword: ${t.keyword || t.topic}\n\nSource snippets (facts only, do not copy):\n${src || '(no sources found, write only well-known general guidance)'}`;
  for (let attempt = 0; attempt < 2; attempt += 1) { // a model sometimes returns broken JSON; one more try is cheap
    const a = jsonOf(await gem(WRITE_SYSTEM, prompt, 6000));
    if (a && Array.isArray(a.body) && a.title) return a;
  }
  throw bad('The AI did not return a usable article twice in a row');
}

/** Adds what a draft is missing about the product: a closing line when the body barely names it, and the "What is Agentify ERP?" FAQ answer. Facts come from brandFacts.js only. */
export function ensureBrand(a) {
  const out = { ...a, body: [...(a.body || [])], faq: [...(a.faq || [])] };
  if (brandMentions(out.body.join(' ')) < 2) out.body.push(`# How ${BRAND} fits in`, closingFor(out.tag, 'x'));
  if (!out.faq.some(([q, an]) => brandMentions(`${q} ${an}`))) out.faq.push(BRAND_FAQ);
  return out;
}

/** Make one article for a topic and save it as a draft (or publish it when auto-publish is on and every check passed). */
export async function makeOne(t, { auto = false } = {}) {
  const sources = await searchWeb(t.query);
  const a = ensureBrand(await writeArticle(t, sources));
  const kind = t.kind === 'brand' ? 'brand' : 'guide';
  const chk = checkArticle(a, existingTitles(), kind);
  let slug = slugify(a.title || t.topic); if (!slug) throw bad('No usable title');
  if (store().prepare('SELECT 1 FROM blog_agent_posts WHERE slug=?').get(slug) || allPosts().some((p) => p.slug === slug)) slug = `${slug.slice(0, 70)}-${Date.now().toString(36).slice(-4)}`;
  const blocks = parseBody(a.body);
  const photo = (await findPhoto(a.keyword || t.keyword || a.title))
    || (await findPhoto(/construction|boq|contractor|site/i.test(`${a.title} ${a.keyword}`) ? 'construction site' : 'real estate office'));
  if (!photo && getSetting('unsplash_access_key')) chk.problems.push('No Unsplash photo found (check the Unsplash key and its hourly limit); the article shows the default cover.');
  const passed = chk.problems.length === 0;
  const status = auto && passed ? 'published' : 'draft';
  const faq = (Array.isArray(a.faq) ? a.faq : []).filter((x) => Array.isArray(x) && x[0] && x[1]).slice(0, 4).map(([q, an]) => [String(q).slice(0, 200), String(an).slice(0, 700)]);
  const info = store().prepare(`INSERT INTO blog_agent_posts(slug,title,description,tag,keyword,body,faq,tags,related,sources,photo,read_min,status,checks,kind,published_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${status === 'published' ? "datetime('now')" : 'NULL'})`)
    .run(slug, String(a.title).slice(0, 140), String(a.description || '').slice(0, 200), TAGS.includes(a.tag) ? a.tag : 'Real estate', String(a.keyword || t.keyword || '').slice(0, 80), JSON.stringify(blocks), JSON.stringify(faq),
      JSON.stringify((a.tags || []).slice(0, 4).map((x) => String(x).slice(0, 30))), JSON.stringify([]), JSON.stringify(sources.map(({ title, url }) => ({ title, url }))), photo ? JSON.stringify(photo) : null,
      Math.max(2, Math.round(chk.words / 200)), status, JSON.stringify(chk.problems), kind);
  invalidate();
  return { id: Number(info.lastInsertRowid), slug, status, kind, problems: chk.problems };
}

/** Give articles that have no photo yet one (rejected drafts excluded), a few per call to stay inside Unsplash's hourly limit. */
export async function fillMissingPhotos(max = 8) {
  if (!getSetting('unsplash_access_key')) return { filled: 0 };
  const rows = store().prepare("SELECT id,title,keyword FROM blog_agent_posts WHERE photo IS NULL AND status IN ('draft','published') ORDER BY id DESC LIMIT ?").all(max);
  let filled = 0;
  for (const r of rows) {
    const ph = (await findPhoto(r.keyword || r.title)) || (await findPhoto(/construction|boq|contractor|site/i.test(`${r.title} ${r.keyword}`) ? 'construction site' : 'real estate office'));
    if (!ph) break; // key invalid or hourly limit reached: try again next hour
    store().prepare('UPDATE blog_agent_posts SET photo=? WHERE id=?').run(JSON.stringify(ph), r.id); filled++;
  }
  if (filled) invalidate();
  return { filled };
}

let running = false;
/** Top up today's drafts to the daily cap. Safe to call often: it stops at the cap and never runs twice at once. */
export async function runBlogAgent({ force = false, by = null } = {}) {
  const s = settings();
  if (!force && !s.enabled) return { skipped: 'The blog agent is switched off.' };
  if (!s.tavily.set) return { skipped: 'Add a Tavily API key first.' };
  if (running) return { skipped: 'A run is already in progress.' };
  running = true;
  const res = { made: [], errors: [] };
  try {
    const left = s.cap - madeToday();
    if (left <= 0) return { ...res, skipped: `Today's limit of ${s.cap} is reached.` };
    const brandToday = store().prepare("SELECT COUNT(*) n FROM blog_agent_posts WHERE substr(created_at,1,10)=? AND kind='brand' AND status!='rejected'").get(startOfDay()).n;
    const brandN = Math.min(left, Math.max(0, Math.ceil(s.cap / 3) - brandToday)); // about a third of each day's articles are about the product itself
    const topics = await proposeTopics(left, s.focus, brandN);
    for (const t of topics) {
      if (madeToday() >= s.cap) break;
      try { res.made.push(await makeOne(t, { auto: s.auto_publish })); } catch (e) { res.errors.push(`${t.topic}: ${e.message}`); if (e.extra?.code) break; }
    }
    return res;
  } finally { running = false; runAlert(res); syncReviewAlert(); }
}

// ---- alerts in the console bell
/** One standing alert while drafts wait for review (cleared when none are left), and one alert per run. Alerts only; nothing is posted anywhere. */
export function syncReviewAlert() {
  try {
    const n = store().prepare("SELECT COUNT(*) n FROM blog_agent_posts WHERE status='draft'").get().n;
    const d = platformDb();
    if (n > 0) d.prepare("INSERT INTO platform_notifications(kind,severity,title,body,link,dedupe) VALUES('blog_review','info',?,?,'/platform/blog-agent','blog-review') ON CONFLICT(dedupe) DO UPDATE SET resolved_at=NULL, title=excluded.title, body=excluded.body")
      .run(`${n} blog draft${n === 1 ? '' : 's'} to review`, 'Open the Blog agent, read each article, then approve or reject it.');
    else d.prepare("UPDATE platform_notifications SET resolved_at=datetime('now') WHERE dedupe='blog-review' AND resolved_at IS NULL").run();
  } catch { /* an alert must never break the agent */ }
}
function runAlert(res) {
  try {
    const made = res.made.length, live = res.made.filter((m) => m.status === 'published').length;
    if (!made && !res.errors.length) return;
    const title = made ? `Blog agent wrote ${made} article${made === 1 ? '' : 's'}${live ? `, ${live} published automatically` : ' for your review'}` : 'Blog agent could not write articles';
    const body = [res.errors.length ? `${res.errors.length} failed: ${res.errors[0]}`.slice(0, 300) : '', live ? 'Published articles are on /blog now; open the agent to unpublish any you do not want.' : ''].filter(Boolean).join(' ') || null;
    platformDb().prepare("INSERT INTO platform_notifications(kind,severity,title,body,link,dedupe) VALUES('blog_run',?,?,?,'/platform/blog-agent',?) ON CONFLICT(dedupe) DO NOTHING")
      .run(live || (res.errors.length && !made) ? 'warning' : 'info', title, body, `blog-run:${new Date().toISOString()}`);
  } catch { /* ignore */ }
}

// ---- review queue
const COLS = 'id,slug,title,description,tag,keyword,kind,status,checks,read_min,created_at,published_at,reviewed_by,sources';
export const listDrafts = () => store().prepare(`SELECT ${COLS} FROM blog_agent_posts ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, id DESC LIMIT 300`).all()
  .map((r) => ({ ...r, checks: JSON.parse(r.checks || '[]'), sources: JSON.parse(r.sources || '[]') }));
export function getDraft(id) {
  const r = store().prepare('SELECT * FROM blog_agent_posts WHERE id=?').get(Number(id)); if (!r) throw notFound('Article not found');
  return { ...r, body: JSON.parse(r.body), faq: JSON.parse(r.faq || '[]'), checks: JSON.parse(r.checks || '[]'), sources: JSON.parse(r.sources || '[]'),
    text: JSON.parse(r.body).map((b) => (b.h ? `# ${b.h}` : b.ul ? b.ul.map((x) => `* ${x}`).join('\n') : b.p)).join('\n') };
}
export function editDraft(id, b = {}) {
  const r = getDraft(id); const sets = [], vals = [];
  if (b.title != null) { const t = String(b.title).trim(); if (t.length < 10 || t.length > 140) throw bad('The title must be 10-140 characters'); sets.push('title=?'); vals.push(t); }
  if (b.description != null) { const t = String(b.description).trim(); if (t.length < 40 || t.length > 200) throw bad('The description must be 40-200 characters'); sets.push('description=?'); vals.push(t); }
  if (b.text != null) { const lines = String(b.text).split('\n').map((l) => l.trim()).filter(Boolean); const blocks = parseBody(lines); if (!blocks.length) throw bad('The article body cannot be empty'); sets.push('body=?', 'read_min=?'); vals.push(JSON.stringify(blocks), Math.max(2, Math.round(words(blocks) / 200))); }
  if (!sets.length) return r;
  store().prepare(`UPDATE blog_agent_posts SET ${sets.join(',')}, updated_at=datetime('now') WHERE id=?`).run(...vals, r.id); invalidate();
  return getDraft(id);
}
export function decide(id, action, by) {
  const r = getDraft(id);
  if (action === 'publish') {
    store().prepare("UPDATE blog_agent_posts SET status='published', published_at=COALESCE(published_at, datetime('now')), reviewed_by=?, updated_at=datetime('now') WHERE id=?").run(by, r.id);
  } else if (action === 'unpublish') store().prepare("UPDATE blog_agent_posts SET status='draft', reviewed_by=?, updated_at=datetime('now') WHERE id=?").run(by, r.id);
  else if (action === 'reject') store().prepare("UPDATE blog_agent_posts SET status='rejected', reviewed_by=?, updated_at=datetime('now') WHERE id=?").run(by, r.id);
  else throw bad('Unknown action');
  invalidate(); syncReviewAlert();
  return getDraft(id);
}
export function removeDraft(id) { const r = getDraft(id); if (r.status === 'published') throw bad('Unpublish the article first.'); store().prepare('DELETE FROM blog_agent_posts WHERE id=?').run(r.id); invalidate(); syncReviewAlert(); }
export const overview = () => ({ settings: settings(), made_today: madeToday(), hard_max: HARD_MAX_PER_DAY, posts: listDrafts() });
export { toPost };
