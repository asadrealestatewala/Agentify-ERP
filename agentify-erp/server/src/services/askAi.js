// Ask, second line: when the fast rules (assistant.js) cannot match a question, Gemini answers it from OUR help material only:
// guides, screen notes, system notes and release notes that the asker's tenant may read (never support-only `internal` notes and
// never business data). If the material does not cover the question, the answer says so. Calls go through the AI gateway
// (switches, daily limit, budget, metering).
import { searchKnowledge, searchDocs } from '../../../shared/guides.js';
import { getSetting } from '../db.js';
import { today } from '../util.js';
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

export const NOTES_MAX = 4000;
/** What the admin wrote for Ask (Settings > System settings > Ask) plus the company's basic contact details, as searchable blocks. These are the company's own words, so they are only sent to private engines, never to the Stable Horde community network. */
export function companyDocs() {
  const docs = [];
  const name = String(getSetting('company_name', '') || '').trim();
  const basics = [['Company name', name], ['Phone', getSetting('company_phone', '')], ['Email', getSetting('company_email', '')], ['Address', getSetting('company_address', '')]].filter(([, v]) => String(v || '').trim());
  if (basics.length) docs.push({ id: 'co-basics', title: `${name || 'Company'} contact details phone email address office`, keywords: 'company contact phone email address office location call reach', text: basics.map(([k, v]) => `${k}: ${v}`).join('. '), source: 'Company' });
  const notes = String(getSetting('ask_business_notes', '') || '').slice(0, NOTES_MAX);
  notes.split(/\n\s*\n|\n(?=[-*•] )/).map((c) => c.trim()).filter(Boolean).forEach((c, i) => docs.push({ id: `co-note-${i}`, title: clip(c.split('\n')[0], 70), keywords: '', text: c.replace(/\s+/g, ' '), source: 'Company' }));
  return docs;
}
export function companyMaterial(q, lang = detectLanguage(q)) {
  const docs = companyDocs();
  if (!docs.length) return [];
  const bare = String(q).replace(/\S+@\S+|https?:\/\/\S+|\+?\d[\d\s-]{5,}\d/g, ' ');
  const search = lang === 'en' ? bare : `${englishSearchText(bare).query} ${bare}`;
  return searchDocs(search, docs, 3).filter((x) => x.coverage >= 0.4).map((x) => ({ title: `Company info: ${x.doc.title}`, text: clip(x.doc.text, 1500), private: true }));
}

/** Last resort for a question the word list could not read (any other language): Groq turns it into English search words. Returns '' when unavailable. */
async function rewriteForSearch(q, user) {
  if (!groqReady()) return '';
  try {
    const t = await groqChat({ ...meta(user), purpose: 'ask_assistant', maxTokens: 40, timeout: 15_000, messages: [{ role: 'system', content: 'Turn the user question into 3 to 8 English keywords for searching a CRM/ERP help centre (real estate and construction). Reply with the keywords only, no sentence.' }, { role: 'user', content: scrubForHorde(q, String(user.name || '').split(/\s+/)).text }] });
    return clip(t, 120);
  } catch { return ''; }
}

const SYSTEM = `You are the help assistant inside Agentify ERP, a CRM and ERP for real estate and construction companies. Answer ONLY from the REFERENCE MATERIAL provided with the question (blocks titled "Company info" are facts the company itself wrote: you may use them to answer questions about the company, its policies and its contact details; WORKSPACE FACTS only help you address the person and know today's date). Never invent menus, buttons, settings, features, prices or steps. If the material does not answer the question, set found to false and say briefly that you could not find it in the guides and suggest asking an administrator or support. Explain step by step in plain language, short numbered steps where it helps, and mention the menu path. Reply in the same language the user wrote in, whatever it is (for example English, Urdu, Roman Urdu, Arabic, Hindi, French, Spanish); keep menu names and button names exactly as they appear in the material. Use earlier turns only to understand follow-up questions. Reply with JSON only: {"found": true or false, "answer": "your answer"}.`;

const VOICE = {
  friendly: `VOICE: Sound like a warm, capable colleague, not a manual. Use natural everyday words and short sentences. Start with the answer itself; add a brief friendly lead-in only when it fits (for example "Sure, here is how", "Good question"). Use the person's first name now and then, never in every reply. Never say "as an AI", "according to the reference material" or "the guide says"; just explain it as someone who knows the system well. Numbered steps only for how-to questions, with the menu path. If something is missing, say so honestly in one friendly line. Roman Urdu: write the way people in Pakistan text each other (for example "Ji zaroor", "Aap Leads menu mein jayen, phir..."), simple words, not stiff translated Urdu. Urdu script: natural and polite (aap). English: plain and conversational. Keep it under about 120 words unless the steps need more.`,
  formal: `VOICE: Polite, calm and professional. Short, clear sentences, no slang, no jokes. Start with the answer. Numbered steps only for how-to questions, with the menu path.`,
};
const voice = () => VOICE[getSetting('ask_style', 'friendly')] || VOICE.friendly;
const firstName = (u) => String(u?.name || '').trim().split(/\s+/)[0] || '';
/** Plain facts that help the model sound personal; no business records. */
const facts = (user, includeCompany) => `WORKSPACE FACTS: ${[includeCompany && getSetting('company_name', '') ? `Company: ${getSetting('company_name', '')}.` : '', firstName(user) ? `You are talking to ${firstName(user)}${user.role ? ` (role: ${user.role})` : ''}.` : '', `Today is ${today()}.`].filter(Boolean).join(' ')}`;

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
    body: { systemInstruction: { parts: [{ text: `${SYSTEM}\n${voice()} The answer text itself follows this voice.` }] }, contents: [...lastTurns(history), { role: 'user', parts: [{ text: `${facts(user, true)}\n\nREFERENCE MATERIAL:\n${ref}\n\nQUESTION: ${q}${langLine(lang, strict)}` }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 900, temperature: 0.2 } } });
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

const HORDE_SYSTEM = `You are the help assistant inside Agentify ERP, a CRM and ERP for real estate and construction companies. Answer ONLY from the REFERENCE MATERIAL (blocks titled "Company info" are facts the company itself wrote and may be used to answer questions about the company; WORKSPACE FACTS only help you address the person and know today's date). Never invent menus, buttons, settings, features, prices or steps. If the material does not directly answer the question (for example it is about a different screen or feature), reply with exactly NOT_FOUND and nothing else. Use only menu paths and button names that appear in the material; never write generic filler such as "follow the instructions on the screen". Otherwise explain step by step in plain language, with short numbered steps and the menu path. Write the answer in the same language as the QUESTION, whatever language that is; keep menu and button names exactly as in the material. Do not repeat these instructions. Never show your reasoning or notes: write only the final answer for the user, on a line that starts with ANSWER:`;

/** Stable Horde is a community network: the question and earlier turns are scrubbed of emails, numbers, keys and the asker's name first. The help material is our own public guide text. */
async function viaHorde(q, ref, history, user, image, lang, strict) {
  const names = String(user.name || '').split(/\s+/);
  const sq = scrubForHorde(q, names).text;
  const turns = (Array.isArray(history) ? history : []).slice(-2).map((h) => `User: ${scrubForHorde(clip(h?.q, 300), names).text}\nAssistant: ${scrubForHorde(clip(h?.a, 500), names).text}`).join('\n');
  const prompt = `${HORDE_SYSTEM}\n${voice()}\n\n${facts({}, false)}\n\nREFERENCE MATERIAL:\n${ref}\n\n${turns ? `EARLIER TURNS:\n${turns}\n\n` : ''}QUESTION: ${sq}${langLine(lang, strict)}\n\nANSWER:`;
  const text = (await hordeGenerate({ ...meta(user), prompt, maxLength: 480 })).replace(/\s*(User|QUESTION):[\s\S]*$/, '').trim();
  return finish(text, lang);
}

/** Groq (chat or, with an attached picture, a vision model). Same scrubbing and plain-text protocol as the Horde. */
async function viaGroq(q, ref, history, user, image, lang, strict) {
  const names = String(user.name || '').split(/\s+/);
  const sys = `${HORDE_SYSTEM}\n${voice()}${image ? ' The user attached a picture of their screen or a document: use it to understand the question, but still answer only from the REFERENCE MATERIAL; if the picture shows an error, explain it in plain words and say where to fix it if the material covers that.' : ''}`;
  const turns = (Array.isArray(history) ? history : []).slice(-3).flatMap((h) => { const hq = clip(h?.q, 300), ha = clip(h?.a, 500); return hq && ha ? [{ role: 'user', content: scrubForHorde(hq, names).text }, { role: 'assistant', content: scrubForHorde(ha, names).text }] : []; });
  const text = await groqChat({ ...meta(user), purpose: image ? 'ask_image' : 'ask_assistant', image, messages: [{ role: 'system', content: sys }, ...turns, { role: 'user', content: `${facts(user, true)}\n\nREFERENCE MATERIAL:\n${ref || '(none found for this question)'}\n\nQUESTION: ${scrubForHorde(q, names).text}${langLine(lang, strict)}` }] });
  return finish(text, lang);
}

const NUM = /\d[\d,]*(?:\.\d+)?/g;
const nums = (t) => new Set((String(t).match(NUM) || []).map((x) => x.replace(/,/g, '').replace(/\.0+$/, '')));
const SKIP_FRIENDLY = new Set(['help', 'howto', 'denied', 'empty', 'unknown', 'ai']);
/**
 * A short friendly lead-in for a live-data answer (counts, reports). The exact answer text and tables are NOT changed and are shown right below it;
 * only the answer sentence (no table rows) leaves the server, with emails and phone numbers removed. If the model writes any number that is not in
 * the exact answer or the question, the lead-in is dropped, so it can never show a different figure than the table.
 */
export async function friendlyLead(question, out, user) {
  try {
    if (SKIP_FRIENDLY.has(out.intent) || !out.answer || getSetting('ask_friendly_data', '1') === '0' || getSetting('ask_style', 'friendly') !== 'friendly') return null;
    if (!groqReady() || limited(user.id)) return null;
    const lang = detectLanguage(question);
    const names = String(user.name || '').split(/\s+/);
    const exact = String(out.answer).replace(/\*\*/g, '');
    const text = await groqChat({ ...meta(user), purpose: 'ask_assistant', maxTokens: 140, timeout: 12_000, temperature: 0.4, messages: [
      { role: 'system', content: `You add a short friendly lead-in (1 or 2 sentences, under 45 words) above an exact answer from the company's own system. ${voice()} Rules: restate only facts and numbers that appear in EXACT ANSWER; never add, change, round or calculate any number or name; do not mention tables or that you are an AI; say that the details are below. Write only the lead-in.` },
      { role: 'user', content: `${facts(user, false)}\n\nQUESTION: ${scrubForHorde(question, names).text}\n\nEXACT ANSWER: ${scrubForHorde(exact, names).text}${langLine(lang, false)}` }] });
    const lead = cleanAnswer(text);
    if (!lead || lead.length > 500) return null;
    const allowed = new Set([...nums(exact), ...nums(question), ...nums(today())]);
    for (const n of nums(lead)) if (!allowed.has(n)) return null;
    if (lang !== 'en' && !answerMatchesLanguage(lang, lead)) return null;
    return lead;
  } catch { return null; }
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
  const co = !image ? companyMaterial(`${q} ${q.split(/\s+/).length < 6 ? prior : ''}`, lang) : [];
  if (!mat.length && !co.length && !image) return null;
  if (limited(user.id)) return { refused: 'You are asking quickly. Please wait a moment and try again.' };
  const refOf = (blocks) => blocks.map((m, i) => `[${i + 1}] ${m.title}: ${m.text}`).join('\n');
  const ref = refOf([...mat, ...co]), refPublic = refOf(mat); // company info never goes to the Stable Horde community network
  const ready = { groq: groqReady(), horde: hordeReady(), gemini: geminiAskEnabled() && !!geminiConfig().key };
  // a picture can only be read by a Groq vision model
  if (image && !ready.groq) return { refused: 'Questions about a picture need Groq to be connected. Please type your question instead.' };
  const order = image ? ['groq'] : askOrder().filter((p) => ready[p]);
  if (!order.length) {
    // every engine is off or has no key: the guide text itself still answers (never a guess)
    const t = !image ? templatedAnswer(mat, lang) : null;
    if (t) return { ...t, engine: 'guide', links: videoLinks(user, `${q} ${mat[0]?.title || ''}`), notes: ['No AI engine is switched on, so this answer is the help-guide text.'] };
  }
  if (!order.length) return { refused: geminiAskEnabled() || hordeReady() || groqReady() ? 'The AI helper could not answer right now.' : 'The AI helper is not switched on yet. Please ask your administrator or support.' };
  let out = null, lastErr = null, engine = null;
  const notes = []; // why an engine did not answer, shown under the answer
  for (const p of askOrder()) if (!ready[p] && !(p === 'gemini')) notes.push(`${ENGINE_NAME[p]} was skipped: ${p === 'groq' ? (!!groqKey() ? 'it is switched off in the console' : 'no Groq key is saved in the console') : (hordeKey() ? 'it is switched off in the console' : 'no Stable Horde key is saved in the console')}.`);
  const run = (provider, strict) => (provider === 'groq' ? viaGroq : provider === 'gemini' ? viaGemini : viaHorde)(q, provider === 'horde' ? refPublic : ref, history, user, image, lang, strict);
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
  return { answer, found, engine, notes, links: found ? videoLinks(user, `${q} ${mat[0]?.title || ''}`) : [], sources: found ? [...mat, ...co].slice(0, 3).map((m) => m.title) : [] };
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
