// Creative Studio (workspace side): brand profile, brand story writer and static post creator, all through Agentify's AI gateway
// (metering, switches, daily limit, budget and per-workspace credits). Generated images are only stored when the user saves one, in the
// workspace's own storage folder, so they count toward its file quota and stay separate from other workspaces.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, getSetting, uploadDir } from '../db.js';
import { currentTenant } from '../context.js';
import { bad, notFound, now } from '../util.js';
import { geminiGenerate, geminiImage, ASPECTS, imageModel, REEL_SECONDS } from './aiGateway.js';
import { azureStatus } from './aiReport.js';
import { assertSafeRequest } from './aiSafety.js';
import { creditsAllowance, creditsLeft, assertPlatformAllowed, switchKey } from './aiGate.js';
import { config, flag, featuresOff, ensureTable } from './aiUsage.js';
import { putFile, storageEnabled } from './storage.js';
import { assertStorageAvailable } from './plans.js';

/** Credits one use costs a workspace. */
export const CREDIT_COST = { brand_story: 1, creative_post: 3 };
export const REEL_CREDITS = { per_second: 8, voice_per_100_chars: 1 };
export const SIZES = { square: { label: 'Square (1:1)', hint: 'Feed post' }, portrait: { label: 'Portrait (4:5)', hint: 'Feed post, more room' }, story: { label: 'Story (9:16)', hint: 'Story or reel cover' } };
export const LANGUAGES = ['English', 'Roman Urdu', 'Urdu'];
export const BRAND_PLATFORMS = ['Instagram', 'Facebook Page', 'LinkedIn company page', 'LinkedIn profile'];
export const BRAND_LANGUAGES = ['English', 'Roman Urdu', 'Urdu'];
export const BRAND_TONES = ['Friendly', 'Professional', 'Warm', 'Playful', 'Calm', 'Bold'];
export const POSTS_PER_WEEK = [3, 5];
const pick = (v, allowed, max = 99) => (Array.isArray(v) ? [...new Set(v)].filter((x) => allowed.includes(x)).slice(0, max) : []);
const list = (t) => { try { const a = JSON.parse(t || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const COLOR = /^#[0-9a-fA-F]{6}$/;
const voiceReady = () => { const a = azureStatus(); return !!(a.key_added && a.region); };
const tenantId = () => currentTenant()?.id ?? null;

const clean = (v, n) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null; };
export function brand() {
  const b = get('SELECT * FROM creative_brand WHERE id=1');
  // first use: start from what the workspace already set in Branding so nothing is typed twice
  return b ? { ...b, platforms: list(b.platforms), languages: list(b.languages), tone_tags: list(b.tone_tags), saved: true } : { brand_name: getSetting('company_name', '') || '', logo: getSetting('brand_logo', '') || null, primary_color: getSetting('brand_color', '') || '#0e7c6b', secondary_color: null, tone: 'Friendly and professional', business_type: '', about: '', language: 'English', audience: '', website: '', city: '', platforms: [], languages: [], posts_per_week: null, tone_tags: [], saved: false };
}
export function saveBrand(b, userId) {
  const d = { brand_name: clean(b.brand_name, 80), tone: clean(b.tone, 120), business_type: clean(b.business_type, 80), about: clean(b.about, 600), primary_color: clean(b.primary_color, 7), secondary_color: clean(b.secondary_color, 7), language: LANGUAGES.includes(b.language) ? b.language : 'English' };
  // wizard fields: only overwritten when sent, so older clients never wipe them
  const prevW = get('SELECT audience, website, city, platforms, languages, posts_per_week, tone_tags FROM creative_brand WHERE id=1') || {};
  const w = {
    audience: 'audience' in b ? clean(b.audience, 200) : prevW.audience || null, website: 'website' in b ? clean(b.website, 200) : prevW.website || null, city: 'city' in b ? clean(b.city, 80) : prevW.city || null,
    platforms: 'platforms' in b ? JSON.stringify(pick(b.platforms, BRAND_PLATFORMS)) : prevW.platforms || '[]', languages: 'languages' in b ? JSON.stringify(pick(b.languages, BRAND_LANGUAGES)) : prevW.languages || '[]',
    posts_per_week: 'posts_per_week' in b ? (POSTS_PER_WEEK.includes(Number(b.posts_per_week)) ? Number(b.posts_per_week) : null) : prevW.posts_per_week ?? null,
    tone_tags: 'tone_tags' in b ? JSON.stringify(pick(b.tone_tags, BRAND_TONES, 4)) : prevW.tone_tags || '[]' };
  if (!d.brand_name) throw bad('Enter your brand name');
  for (const k of ['primary_color', 'secondary_color']) if (d[k] && !COLOR.test(d[k])) throw bad('Colors look like #0e7c6b');
  const prev = get('SELECT logo FROM creative_brand WHERE id=1');
  const logo = 'logo' in b ? clean(b.logo, 300) : (prev ? prev.logo : getSetting('brand_logo', '') || null);
  run(`INSERT INTO creative_brand(id, brand_name, logo, primary_color, secondary_color, tone, business_type, about, language, audience, website, city, platforms, languages, posts_per_week, tone_tags, updated_by, updated_at) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET brand_name=excluded.brand_name, logo=excluded.logo, primary_color=excluded.primary_color, secondary_color=excluded.secondary_color, tone=excluded.tone, business_type=excluded.business_type, about=excluded.about, language=excluded.language, audience=excluded.audience, website=excluded.website, city=excluded.city, platforms=excluded.platforms, languages=excluded.languages, posts_per_week=excluded.posts_per_week, tone_tags=excluded.tone_tags, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
  d.brand_name, logo, d.primary_color, d.secondary_color, d.tone, d.business_type, d.about, d.language, w.audience, w.website, w.city, w.platforms, w.languages, w.posts_per_week, w.tone_tags, userId || null, now());
  return { ...brand(), saved: true };
}
const brandLines = (b) => [`Brand name: ${b.brand_name}`, b.business_type && `Business: ${b.business_type}`, b.about && `About: ${b.about}`, b.tone && `Tone of voice: ${b.tone}`, b.tone_tags?.length && `Tone words: ${b.tone_tags.join(', ')}`, b.audience && `Customers: ${b.audience}`, b.city && `Location: ${b.city}`, b.languages?.length && `Audience languages: ${b.languages.join(', ')}`, b.primary_color && `Brand colors: ${[b.primary_color, b.secondary_color].filter(Boolean).join(', ')}`].filter(Boolean).join('\n');

/** What the page needs to decide whether to show the module: AI on for this workspace, a key added, credits left. */
export function status() {
  ensureTable();
  const id = tenantId();
  const ws = id ? ensureTable().prepare('SELECT ai_enabled FROM workspace_ai_settings WHERE tenant_id=?').get(id) : null;
  const off = flag('ai_kill_switch') || (ws && !ws.ai_enabled);
  const left = id ? creditsLeft(id) : null;
  const featuresOn = Object.fromEntries(Object.keys(CREDIT_COST).map((f) => [f, !featuresOff().includes(switchKey(f))]));
  const reason = off ? 'AI is switched off for your workspace.' : !config().key ? 'Creative Studio is not available yet.' : left === 0 ? 'You have used all your credits for this month. Ask support to top up.' : null;
  return { available: !reason, reason, credits: { allowance: id ? creditsAllowance(id) : null, left }, costs: { ...CREDIT_COST, video_second: REEL_CREDITS.per_second, voice_per_100: REEL_CREDITS.voice_per_100_chars }, reel_seconds: REEL_SECONDS, voice_ready: voiceReady(), features: { ...featuresOn, creative_video: !featuresOff().includes('creative_video') }, sizes: SIZES, languages: LANGUAGES, brand_options: { platforms: BRAND_PLATFORMS, languages: BRAND_LANGUAGES, tones: BRAND_TONES, posts_per_week: POSTS_PER_WEEK }, storage: storageEnabled() ? 'cloud' : 'local', image_model: imageModel() };
}

function parseJson(text) { try { return JSON.parse(String(text).match(/\{[\s\S]*\}/)?.[0] || ''); } catch { return null; } }

const STORY_SYSTEM = 'You write brand stories and social media captions for small businesses. Use ONLY the facts in the brand profile and brief. Never invent statistics, awards, customer names, testimonials, prices, partnerships or promises. Write in the requested language. "Roman Urdu" means Urdu written in Latin letters the way people text it in Pakistan (for example "Aap ka ghar, aap ki pasand"), never in Arabic script. Reply with JSON only: {"title": "short title", "story": "the brand story, 120-220 words, plain paragraphs", "captions": ["caption 1", "caption 2", "caption 3"]}. Captions are one or two sentences each.';
export async function writeStory({ language, focus }, user) {
  const b = brand();
  if (!b.saved) throw bad('Save your brand profile first so the story matches your brand.');
  const lang = LANGUAGES.includes(language) ? language : b.language || 'English';
  const brief = clean(focus, 500);
  assertSafeRequest(brief, b.about);
  const d = await geminiGenerate({ feature: 'brand_story', purpose: 'brand_story', tenantId: tenantId(), userId: user?.id, credits: CREDIT_COST.brand_story,
    body: { systemInstruction: { parts: [{ text: STORY_SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: `${brandLines(b)}\nLanguage: ${lang}\nFocus of this story: ${brief || 'who we are and why customers trust us'}` }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1500 } } });
  const out = parseJson((d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
  if (!out?.story) throw bad('The story could not be written this time. Please try again.');
  const captions = (Array.isArray(out.captions) ? out.captions : []).map((c) => String(c).slice(0, 400)).slice(0, 5);
  const text = `${String(out.story).slice(0, 4000)}\n\n${captions.map((c) => `• ${c}`).join('\n')}`;
  const id = Number(run('INSERT INTO creative_items(kind,title,prompt,language,body,credits,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)', 'story', clean(out.title, 140) || 'Brand story', brief, lang, text, CREDIT_COST.brand_story, user?.id || null, now()).lastInsertRowid);
  return { id, title: clean(out.title, 140) || 'Brand story', story: String(out.story).slice(0, 4000), captions, language: lang, credits_used: CREDIT_COST.brand_story, credits_left: creditsLeft(tenantId()) };
}

/** A few image options for a post. Not stored until the user saves one. Each image costs credits; a failed one costs none. */
export async function makePosts({ description, size, count = 2, language }, user) {
  const desc = clean(description, 600);
  if (!desc || desc.length < 8) throw bad('Describe the post in a sentence or two.');
  if (!ASPECTS[size]) throw bad('Choose a post size.');
  const n = Math.min(3, Math.max(1, Number(count) || 2));
  const b = brand();
  assertSafeRequest(desc);
  const prompt = `Create a polished social media image for a business. ${brandLines(b)}\nSubject: ${desc}\nUse the brand colors as the main palette. Clean professional composition, no watermark, no distorted text. ${language === 'Urdu' ? 'If any text appears in the image it must be correct Urdu.' : language === 'Roman Urdu' ? 'If any text appears in the image it must be short Roman Urdu (Urdu in Latin letters), spelled consistently.' : 'If any text appears in the image keep it short and spelled correctly.'}`;
  const options = []; let lastErr = null;
  for (let i = 0; i < n; i += 1) {
    try { const img = await geminiImage({ feature: 'creative_post', prompt: `${prompt}\nVariation ${i + 1}: use a different composition.`, aspect: size, tenantId: tenantId(), userId: user?.id, credits: CREDIT_COST.creative_post }); options.push({ mime: img.mime, data: img.data }); }
    catch (e) { lastErr = e; if (['daily_limit', 'no_credits', 'budget_reached', 'ai_off', 'feature_off', 'tenant_off'].includes(e.extra?.code)) break; }
  }
  if (!options.length) throw lastErr || bad('No image came back. Please try again.');
  return { options, size, credits_used: options.length * CREDIT_COST.creative_post, credits_left: creditsLeft(tenantId()), partial: options.length < n ? (lastErr?.message || 'Some options could not be created.') : null };
}

/** Keep generated bytes in the workspace's own storage (object storage when configured, else its local media folder). Checks the file quota first. */
export async function storeBytes(buf, mime, ext) {
  const t = currentTenant();
  if (t) assertStorageAvailable(t, buf.length);
  const name = `${crypto.randomBytes(12).toString('hex')}${ext}`;
  if (storageEnabled()) return (await putFile(buf, { module: 'creative', filename: name, mime, size: buf.length })).ref;
  const dir = path.join(uploadDir(), 'media'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), buf);
  return `media/${name}`;
}
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
function sniff(buf) { if (buf.length > 8 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png'; if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'; if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp'; return null; }
/** Save one chosen image to the workspace's storage. The bytes are checked to be a real image, never trusted from the client's label. */
export async function saveImage({ data, title, prompt, size }, user) {
  const buf = Buffer.from(String(data || ''), 'base64');
  const mime = sniff(buf);
  if (!mime || buf.length > 8 * 1024 * 1024) throw bad('That is not a usable image.');
  const ref = await storeBytes(buf, mime, EXT[mime]);
  const id = Number(run('INSERT INTO creative_items(kind,title,prompt,size,file_ref,mime,size_bytes,credits,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', 'post', clean(title, 140) || 'Post image', clean(prompt, 600), ASPECTS[size] ? size : null, ref, mime, buf.length, 0, user?.id || null, now()).lastInsertRowid);
  return { id };
}
export const listItems = () => all('SELECT id, kind, title, prompt, size, language, body, mime, size_bytes, credits, created_at, (file_ref IS NOT NULL) has_file FROM creative_items ORDER BY id DESC LIMIT 100');
export const getItem = (id) => { const r = get('SELECT * FROM creative_items WHERE id=?', Number(id)); if (!r) throw notFound(); return r; };
export function removeItem(id) { const r = getItem(id); run('DELETE FROM creative_items WHERE id=?', r.id); return r; }
