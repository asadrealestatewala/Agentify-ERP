// Ask, second line: when the fast rules (assistant.js) cannot match a question, Gemini answers it from OUR help material only:
// guides, screen notes, system notes and release notes that the asker's tenant may read (never support-only `internal` notes and
// never business data). If the material does not cover the question, the answer says so. Calls go through the AI gateway
// (switches, daily limit, budget, metering).
import { searchKnowledge, searchDocs } from '../../../shared/guides.js';
import { systemDocs } from './systemKnowledge.js';
import { videoLinks } from './assistant.js';
import { geminiGenerate } from './aiGateway.js';
import { hordeGenerate, hordeKey, hordeReady, hordeEnabled, geminiAskEnabled, scrubForHorde } from './hordeGateway.js';
import { askOrder, noteEngine } from './askOrder.js';
import { groqChat, groqReady, groqKey } from './groqGateway.js';
import { config as geminiConfig, ensureTable } from './aiUsage.js';
import { assertSafeRequest } from './aiSafety.js';
import { currentTenant } from '../context.js';
import { bad } from '../util.js';
import { detectLanguage, languageName, englishSearchText, answerMatchesLanguage } from '../../../shared/help/askTerms.js';

const MAX_CHARS = 6500;
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The most relevant help text for a question, as { title, text } blocks (about 6,000 characters in all). Roman Urdu / Urdu questions are searched by their English meaning. Only text that really covers the question is returned. */
export function material(q, lang = detectLanguage(q)) {
  const bare = String(q).replace(/\S+@\S+|https?:\/\/\S+|\+?\d[\d\s-]{5,}\d/g, ' '); // addresses and numbers say nothing about the topic
  const search = lang === 'en' ? bare : `${englishSearchText(bare).query} ${bare}`;
  let hits = searchKnowledge(search).slice(0, 8);
  // drop weak matches: a hit must cover at least a fifth of the meaningful words and be near the best hit's coverage
  const cov = hits.filter((h) => h.coverage != null).map((h) => h.coverage);
  const best = cov.length ? Math.max(...cov) : 0;
  hits = hits.filter((h) => h.coverage == null ? (!cov.length || best >= 0.5) : h.coverage >= Math.max(0.2, best - 0.2)).slice(0, 4);
  const out = [];
  for (const h of hits) {
    if (h.type === 'guide') { const g = h.guide; out.push({ title: g.title, steps: g.steps, limits: g.limits || [], text: `${g.steps.map((t, i) => `${i + 1}. ${t}`).join(' ')} ${g.limits?.length ? `Good to know: ${g.limits.join(' ')}` : ''} ${g.faq.map((f) => `Q: ${f.q} A: ${f.a}`).join(' ')}` }); }
    else if (h.type === 'screen') { const sc = h.screen; out.push({ title: `Screen: ${sc.label}`, menu: `${sc.section} > ${sc.label}`, about: sc.about || '', text: `${sc.label} is under ${sc.section} in the menu (Menu path: ${sc.section} > ${sc.label}). ${sc.about || ''} Address: ${sc.path}` }); }
    else out.push({ title: `${h.version}: ${h.title}`, text: `${h.item.text}${h.item.where ? ` Where: ${h.item.where}` : ''}` });
  }
  for (const x of searchDocs(search, systemDocs(), 3)) if (x.coverage >= 0.5) out.push({ title: x.doc.title, text: x.doc.text });
  const blocks = []; let used = 0;
  for (const b of out) { const t = clip(b.text, 1800); if (used + t.length > MAX_CHARS) break; blocks.push({ ...b, text: t }); used += t.length; }
  return blocks;
}

/** Last resort for a question the word list could not read (any other language): Groq turns it into English search words. Returns '' when unavailable. */
async function rewriteForSearch(q, user) {
  if (!groqReady()) return '';
  try {
    const t = await groqChat({ ...meta(user), purpose: 'ask_assistant', maxTokens: 40, timeout: 15_000, messages: [{ role: 'system', content: 'Turn the user question into 3 to 8 English keywords for searching a CRM/ERP help centre (real estate and construction). Reply with the keywords only, no sentence.' }, { role: 'user', content: scrubForHorde(q, String(user.name || '').split(/\s+/)).text }] });
    return clip(t, 120);
  } catch { return ''; }
}

const SYSTEM = `You are the help assistant inside Agentify ERP, a CRM and ERP for real estate and construction companies. Answer ONLY from the REFERENCE MATERIAL provided with the question. Never invent menus, buttons, settings, features, prices or steps. If the material does not answer the question, set found to false and say briefly that you could not find it in the guides and suggest asking an administrator or support. Explain step by step in plain language, short numbered steps where it helps, and mention the menu path. Reply in the same language the user wrote in, whatever it is (for example English, Urdu, Roman Urdu, Arabic, Hindi, French, Spanish); keep menu names and button names exactly as they appear in the material. Use earlier turns only to understand follow-up questions. Reply with JSON only: {"found": true or false, "answer": "your answer"}.`;

const langLine = (lang, strict) => lang === 'en' ? '' : `\nREPLY LANGUAGE: write the whole answer in ${languageName(lang)}${strict ? '. Your previous answer was not in that language. Do NOT answer in English. Only menu names and button names stay in English' : ''}.`;
const CANNED = { 'roman-urdu': 'Mujhe yeh guides mein nahi mila. Meharbani karke menu mein dekhein ya apne administrator ya support se poochein.', urdu: 'مجھے یہ گائیڈز میں نہیں ملا۔ براہ کرم مینو میں دیکھیں یا اپنے ایڈمنسٹریٹر یا سپورٹ سے پوچھیں۔' };
const notFound = (lang) => ({ found: false, answer: CANNED[lang] || 'I could not find this in the guides. Please ask your administrator or support.' });


/** Reasoning models sometimes print their thinking ("We need to answer in Roman Urdu. Need use only the reference...") instead of an answer. */
const THINK = /<think>[\s\S]*?<\/think>/gi;
const REASONING = /^(we need|we must|we should|we can|need to|need use|need answer|let'?s |let me |okay,? |ok,? |first,? |the user (asks|wants|is asking|question)|user (asks|wants|question)|i need to|i should|i must|hmm|so the|thinking|analysis)|\b(reference material|the material|need use only|must only answer|earlier assistant|user'?s question|we must only|but material|but "add" not)\b/i;
/** The answer text, or null when the engine sent its reasoning (or nothing usable). A line "ANSWER:" lets the model separate the two. */
export function cleanAnswer(raw) {
  let t = String(raw || '').replace(THINK, ' ').trim();
  const m = [...t.matchAll(/(?:^|\n)\s*(?:final\s+)?answer\s*:\s*/gi)].pop();
  if (m) t = t.slice(m.index + m[0].length).trim();
  t = t.replace(/^(?:ANSWER|JAWAB)\s*:\s*/i, '').trim();
  if (t.length < 8) return null;
  if (REASONING.test(t.slice(0, 400))) return null;
  return t;
}

const TEMPLATE_INTRO = {
  en: { menu: (m) => `Open ${m} in the menu.`, steps: 'Steps from our help guide:', note: 'This is the help-guide text, shown as written.' },
  'roman-urdu': { menu: (m) => `Menu mein ${m} kholen.`, steps: 'Help guide ke steps (English mein):', note: 'Yeh help guide ka matan hai, jaisa likha hai waisa dikhaya gaya hai.' },
  urdu: { menu: (m) => `مینو میں ${m} کھولیں۔`, steps: 'ہیلپ گائیڈ کے اقدامات (انگریزی میں):', note: 'یہ ہیلپ گائیڈ کا متن ہے۔' },
};
/** A plain answer built only from the matched help text: menu path and the guide's own steps. No AI involved, so it is never invented. */
export function templatedAnswer(mat, lang) {
  const t = TEMPLATE_INTRO[lang] || TEMPLATE_INTRO.en;
  const top = mat[0] || {}; // only the best match: a weaker second hit would send people to the wrong screen
  const g = top.steps?.length ? top : null, sc = top.menu ? top : null;
  const lines = [];
  if (sc) lines.push(t.menu(sc.menu));
  if (g) { lines.push(`${t.steps} ${g.title}`); g.steps.slice(0, 6).forEach((x, i) => lines.push(`${i + 1}. ${x}`)); }
  else if (sc?.about) lines.push(sc.about);
  if (!lines.length) return null;
  lines.push(t.note);
  return { found: true, answer: lines.join('\n'), sources: [g?.title || sc?.title].filter(Boolean) };
}

const ENGINE_NAME = { groq: 'Groq', horde: 'Stable Horde', gemini: 'Gemini' };

const lastTurns = (history) => (Array.isArray(history) ? history : []).slice(-3).flatMap((h) => {
  const q = clip(h?.q, 400), a = clip(h?.a, 700);
  return q && a ? [{ role: 'user', parts: [{ text: q }] }, { role: 'model', parts: [{ text: JSON.stringify({ found: true, answer: a }) }] }] : [];
});


const meta = (user) => ({ feature: 'ask_assistant', purpose: 'ask_assistant', tenantId: currentTenant()?.id ?? null, userId: user.id });

async function viaGemini(q, ref, history, user, image, lang, strict) {
  const d = await geminiGenerate({ ...meta(user), timeout: 45_000,
    body: { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [...lastTurns(history), { role: 'user', parts: [{ text: `REFERENCE MATERIAL:\n${ref}\n\nQUESTION: ${q}${langLine(lang, strict)}` }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 900, temperature: 0.2 } } });
  try { return JSON.parse(((d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')).match(/\{[\s\S]*\}/)?.[0] || ''); } catch { return null; }
}

/** Plain-text engines: NOT_FOUND, reasoning leaked into the output (rejected) or a clean answer. */
function finish(text, lang) {
  if (/^NOT_FOUND\b/i.test(String(text).trim())) return notFound(lang);
  const clean = cleanAnswer(text);
  if (!clean) return { bad: true, raw: String(text).slice(0, 400) };
  if (/^NOT_FOUND\b/i.test(clean)) return notFound(lang);
  return { found: true, answer: clean };
}

const HORDE_SYSTEM = `You are the help assistant inside Agentify ERP, a CRM and ERP for real estate and construction companies. Answer ONLY from the REFERENCE MATERIAL. Never invent menus, buttons, settings, features, prices or steps. If the material does not directly answer the question (for example it is about a different screen or feature), reply with exactly NOT_FOUND and nothing else. Use only menu paths and button names that appear in the material; never write generic filler such as "follow the instructions on the screen". Otherwise explain step by step in plain language, with short numbered steps and the menu path. Write the answer in the same language as the QUESTION, whatever language that is; keep menu and button names exactly as in the material. Do not repeat these instructions. Never show your reasoning or notes: write only the final answer for the user, on a line that starts with ANSWER:`;

/** Stable Horde is a community network: the question and earlier turns are scrubbed of emails, numbers, keys and the asker's name first. The help material is our own public guide text. */
async function viaHorde(q, ref, history, user, image, lang, strict) {
  const names = String(user.name || '').split(/\s+/);
  const sq = scrubForHorde(q, names).text;
  const turns = (Array.isArray(history) ? history : []).slice(-2).map((h) => `User: ${scrubForHorde(clip(h?.q, 300), names).text}\nAssistant: ${scrubForHorde(clip(h?.a, 500), names).text}`).join('\n');
  const prompt = `${HORDE_SYSTEM}\n\nREFERENCE MATERIAL:\n${ref}\n\n${turns ? `EARLIER TURNS:\n${turns}\n\n` : ''}QUESTION: ${sq}${langLine(lang, strict)}\n\nANSWER:`;
  const text = (await hordeGenerate({ ...meta(user), prompt, maxLength: 480 })).replace(/\s*(User|QUESTION):[\s\S]*$/, '').trim();
  return finish(text, lang);
}

/** Groq (chat or, with an attached picture, a vision model). Same scrubbing and plain-text protocol as the Horde. */
async function viaGroq(q, ref, history, user, image, lang, strict) {
  const names = String(user.name || '').split(/\s+/);
  const sys = `${HORDE_SYSTEM}${image ? ' The user attached a picture of their screen or a document: use it to understand the question, but still answer only from the REFERENCE MATERIAL; if the picture shows an error, explain it in plain words and say where to fix it if the material covers that.' : ''}`;
  const turns = (Array.isArray(history) ? history : []).slice(-3).flatMap((h) => { const hq = clip(h?.q, 300), ha = clip(h?.a, 500); return hq && ha ? [{ role: 'user', content: scrubForHorde(hq, names).text }, { role: 'assistant', content: scrubForHorde(ha, names).text }] : []; });
  const text = await groqChat({ ...meta(user), purpose: image ? 'ask_image' : 'ask_assistant', image, messages: [{ role: 'system', content: sys }, ...turns, { role: 'user', content: `REFERENCE MATERIAL:\n${ref || '(none found for this question)'}\n\nQUESTION: ${scrubForHorde(q, names).text}${langLine(lang, strict)}` }] });
  return finish(text, lang);
}

const hits = new Map(); // per-user rate limit: 10 AI answers a minute
export function limited(userId) {
  const t = Date.now(), list = (hits.get(userId) || []).filter((x) => t - x < 60_000);
  if (list.length >= 10) { hits.set(userId, list); return true; }
  list.push(t); hits.set(userId, list); return false;
}
export const resetRateLimit = () => hits.clear();

/** Returns { answer, found, links, sources } or null when the AI should not be used (no material, rate limited) so the caller keeps its normal reply. Throws never: a refused or failed call returns { refused } with a plain note. */
export async function askAi(question, history, user, image = null) {
  const q = clip(question, 500);
  try { assertSafeRequest(q); } catch (e) { return { refused: e.message }; }
  const lang = detectLanguage(q);
  const prior = (Array.isArray(history) ? history.slice(-1)[0]?.q : '') || '';
  let mat = material(`${q} ${q.split(/\s+/).length < 6 ? prior : ''}`, lang);
  if (!mat.length && !image && !limited(user.id)) { // the word list could not read it: ask Groq for English keywords once (counts toward the rate limit)
    const kw = await rewriteForSearch(q, user);
    if (kw) mat = material(kw, 'en');
  }
  if (!mat.length && !image) return null;
  if (limited(user.id)) return { refused: 'You are asking quickly. Please wait a moment and try again.' };
  const ref = mat.map((m, i) => `[${i + 1}] ${m.title}: ${m.text}`).join('\n');
  const ready = { groq: groqReady(), horde: hordeReady(), gemini: geminiAskEnabled() && !!geminiConfig().key };
  // a picture can only be read by a Groq vision model
  if (image && !ready.groq) return { refused: 'Questions about a picture need Groq to be connected. Please type your question instead.' };
  const order = image ? ['groq'] : askOrder().filter((p) => ready[p]);
  if (!order.length) return { refused: geminiAskEnabled() || hordeReady() || groqReady() ? 'The AI helper could not answer right now.' : 'The AI helper is not switched on yet. Please ask your administrator or support.' };
  let out = null, lastErr = null, engine = null;
  const notes = []; // why an engine did not answer, shown under the answer
  for (const p of askOrder()) if (!ready[p] && !(p === 'gemini')) notes.push(`${ENGINE_NAME[p]} was skipped: ${p === 'groq' ? (!!groqKey() ? 'it is switched off in the console' : 'no Groq key is saved in the console') : (hordeKey() ? 'it is switched off in the console' : 'no Stable Horde key is saved in the console')}.`);
  const run = (provider, strict) => (provider === 'groq' ? viaGroq : provider === 'gemini' ? viaGemini : viaHorde)(q, ref, history, user, image, lang, strict);
  for (const provider of order) {
    try {
      out = await run(provider, false);
      // asked in Urdu / Roman Urdu / Arabic / Hindi but answered in English: one stricter retry on the same engine
      if (out?.answer && out.found !== false && !answerMatchesLanguage(lang, out.answer)) { const again = await run(provider, true).catch(() => null); if (again?.answer && answerMatchesLanguage(lang, again.answer)) out = again; }
      if (out?.answer) { engine = provider; noteEngine(provider, null); break; }
      if (out?.bad) { noteEngine(provider, new Error('it printed its reasoning instead of an answer')); notes.push(`${ENGINE_NAME[provider]} gave an unusable reply, so it was not shown.`); out = null; }
    } catch (e) { lastErr = e; noteEngine(provider, e); notes.push(`${ENGINE_NAME[provider]} failed: ${String(e.message).slice(0, 120)}`); if (e.extra?.code && !['provider_error'].includes(e.extra.code)) break; } // a switch, limit or budget refusal applies to every engine
  }
  // no engine produced a good answer (busy, failed, or only reasoning): answer from the guide text itself, never from a guess
  if (!out?.answer) {
    const refusal = lastErr?.extra?.code && lastErr.extra.code !== 'provider_error';
    const t = !refusal && !image ? templatedAnswer(mat, lang) : null;
    if (t) return { ...t, engine: 'guide', links: videoLinks(user, `${q} ${mat[0]?.title || ''}`), notes };
    if (lastErr) return { refused: refusal ? lastErr.message : 'The AI helper could not answer right now.' };
    return null;
  }
  const answer = String(out?.answer || '').trim().slice(0, 3000);
  if (!answer) return null;
  const found = out.found !== false;
  return { answer, found, engine, notes, links: found ? videoLinks(user, `${q} ${mat[0]?.title || ''}`) : [], sources: found ? mat.slice(0, 3).map((m) => m.title) : [] };
}

const SAMPLE_Q = 'How do I add an appointment?';
/**
 * Console: send one sample question to ONE engine only (no fallback, no rate limit) and report what came back: the answer, the model the ledger
 * recorded, how long it took and the error. Goes through the same gateways as real questions, so switches, ledger and scrubbing all apply.
 */
export async function testAskEngine(engine) {
  if (!['groq', 'horde', 'gemini'].includes(engine)) throw bad('Choose Groq, Stable Horde or Gemini.');
  const out = { engine, name: ENGINE_NAME[engine], question: SAMPLE_Q, ok: false, answer: null, model: null, ms: null, error: null, note: null };
  const keyed = { groq: groqReady(), horde: hordeReady(), gemini: !!geminiConfig().key }[engine];
  if (!keyed) { out.error = engine === 'groq' ? (groqKey() ? 'Groq is switched off ("Use Groq in Ask" is unticked).' : 'No Groq key is saved yet.') : engine === 'horde' ? (hordeKey() && !hordeEnabled() ? 'Stable Horde is switched off.' : 'No Stable Horde key is saved yet.') : 'No Gemini key is saved yet.'; return out; }
  if (engine === 'gemini' && !geminiAskEnabled()) out.note = 'Gemini is switched off for Ask ("Allow Gemini for Ask"), so real questions never reach it. This test calls it anyway.';
  const mat = material(SAMPLE_Q, 'en');
  const ref = mat.map((m, i) => `[${i + 1}] ${m.title}: ${m.text}`).join('\n');
  const user = { id: null, name: 'Console test' };
  const provider = engine === 'horde' ? 'stablehorde' : engine;
  const before = ensureTable().prepare('SELECT COALESCE(MAX(id),0) n FROM ai_usage').get().n;
  const t0 = Date.now();
  try {
    const r = await (engine === 'groq' ? viaGroq : engine === 'gemini' ? viaGemini : viaHorde)(SAMPLE_Q, ref, [], user, null, 'en', false);
    out.ms = Date.now() - t0;
    if (r?.bad) out.error = `It printed its reasoning instead of an answer: "${r.raw}"`;
    else if (r?.answer) { out.ok = true; out.answer = String(r.answer).slice(0, 1500); }
    else out.error = 'It sent back no answer.';
  } catch (e) { out.ms = Date.now() - t0; out.error = String(e.message || e).slice(0, 300); }
  out.model = ensureTable().prepare("SELECT model FROM ai_usage WHERE key_owner='platform' AND provider=? AND id>? ORDER BY id DESC LIMIT 1").get(provider, before)?.model || null;
  noteEngine(engine, out.ok ? null : new Error(out.error));
  return out;
}
