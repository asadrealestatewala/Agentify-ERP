// Ask, second line: when the fast rules (assistant.js) cannot match a question, Gemini answers it from OUR help material only:
// guides, screen notes, system notes and release notes that the asker's tenant may read (never support-only `internal` notes and
// never business data). If the material does not cover the question, the answer says so. Calls go through the AI gateway
// (switches, daily limit, budget, metering).
import { searchKnowledge, searchDocs } from '../../../shared/guides.js';
import { systemDocs } from './systemKnowledge.js';
import { videoLinks } from './assistant.js';
import { geminiGenerate } from './aiGateway.js';
import { hordeGenerate, hordeKey, askOrder, scrubForHorde } from './hordeGateway.js';
import { config as geminiConfig } from './aiUsage.js';
import { assertSafeRequest } from './aiSafety.js';
import { currentTenant } from '../context.js';

const MAX_CHARS = 6500;
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The most relevant help text for a question, as { title, text } blocks (about 6,000 characters in all). */
export function material(q) {
  const out = [];
  for (const h of searchKnowledge(q).slice(0, 4)) {
    if (h.type === 'guide') { const g = h.guide; out.push({ title: g.title, text: `${g.steps.map((t, i) => `${i + 1}. ${t}`).join(' ')} ${g.limits?.length ? `Good to know: ${g.limits.join(' ')}` : ''} ${g.faq.map((f) => `Q: ${f.q} A: ${f.a}`).join(' ')}` }); }
    else if (h.type === 'screen') { const sc = h.screen; out.push({ title: `Screen: ${sc.label}`, text: `${sc.label} is under ${sc.section} in the menu. ${sc.about || ''} Address: ${sc.path}` }); }
    else out.push({ title: `${h.version}: ${h.title}`, text: `${h.item.text}${h.item.where ? ` Where: ${h.item.where}` : ''}` });
  }
  for (const x of searchDocs(q, systemDocs(), 3)) out.push({ title: x.doc.title, text: x.doc.text });
  const blocks = []; let used = 0;
  for (const b of out) { const t = clip(b.text, 1800); if (used + t.length > MAX_CHARS) break; blocks.push({ title: b.title, text: t }); used += t.length; }
  return blocks;
}

const SYSTEM = `You are the help assistant inside Agentify ERP, a CRM and ERP for real estate and construction companies. Answer ONLY from the REFERENCE MATERIAL provided with the question. Never invent menus, buttons, settings, features, prices or steps. If the material does not answer the question, set found to false and say briefly that you could not find it in the guides and suggest asking an administrator or support. Explain step by step in plain language, short numbered steps where it helps, and mention the menu path. Reply in the same language the user wrote in, whatever it is (for example English, Urdu, Roman Urdu, Arabic, Hindi, French, Spanish); keep menu names and button names exactly as they appear in the material. Use earlier turns only to understand follow-up questions. Reply with JSON only: {"found": true or false, "answer": "your answer"}.`;

const lastTurns = (history) => (Array.isArray(history) ? history : []).slice(-3).flatMap((h) => {
  const q = clip(h?.q, 400), a = clip(h?.a, 700);
  return q && a ? [{ role: 'user', parts: [{ text: q }] }, { role: 'model', parts: [{ text: JSON.stringify({ found: true, answer: a }) }] }] : [];
});


const meta = (user) => ({ feature: 'ask_assistant', purpose: 'ask_assistant', tenantId: currentTenant()?.id ?? null, userId: user.id });

async function viaGemini(q, ref, history, user) {
  const d = await geminiGenerate({ ...meta(user), timeout: 45_000,
    body: { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [...lastTurns(history), { role: 'user', parts: [{ text: `REFERENCE MATERIAL:\n${ref}\n\nQUESTION: ${q}` }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 900, temperature: 0.2 } } });
  try { return JSON.parse(((d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')).match(/\{[\s\S]*\}/)?.[0] || ''); } catch { return null; }
}

const HORDE_SYSTEM = `You are the help assistant inside Agentify ERP, a CRM and ERP for real estate and construction companies. Answer ONLY from the REFERENCE MATERIAL. Never invent menus, buttons, settings, features, prices or steps. If the material does not answer the question, reply with exactly NOT_FOUND and nothing else. Otherwise explain step by step in plain language, with short numbered steps and the menu path. Write the answer in the same language as the QUESTION, whatever language that is; keep menu and button names exactly as in the material. Do not repeat these instructions.`;

/** Stable Horde is a community network: the question and earlier turns are scrubbed of emails, numbers, keys and the asker's name first. The help material is our own public guide text. */
async function viaHorde(q, ref, history, user) {
  const names = String(user.name || '').split(/\s+/);
  const sq = scrubForHorde(q, names).text;
  const turns = (Array.isArray(history) ? history : []).slice(-2).map((h) => `User: ${scrubForHorde(clip(h?.q, 300), names).text}\nAssistant: ${scrubForHorde(clip(h?.a, 500), names).text}`).join('\n');
  const prompt = `${HORDE_SYSTEM}\n\nREFERENCE MATERIAL:\n${ref}\n\n${turns ? `EARLIER TURNS:\n${turns}\n\n` : ''}QUESTION: ${sq}\n\nANSWER:`;
  const text = (await hordeGenerate({ ...meta(user), prompt, maxLength: 480 })).replace(/\s*(User|QUESTION):[\s\S]*$/, '').trim();
  if (/^NOT_FOUND\b/i.test(text)) return { found: false, answer: 'I could not find this in the guides. Please ask your administrator or support.' };
  return { found: true, answer: text };
}

const hits = new Map(); // per-user rate limit: 10 AI answers a minute
function limited(userId) {
  const t = Date.now(), list = (hits.get(userId) || []).filter((x) => t - x < 60_000);
  if (list.length >= 10) { hits.set(userId, list); return true; }
  list.push(t); hits.set(userId, list); return false;
}
export const resetRateLimit = () => hits.clear();

/** Returns { answer, found, links, sources } or null when the AI should not be used (no material, rate limited) so the caller keeps its normal reply. Throws never: a refused or failed call returns { refused } with a plain note. */
export async function askAi(question, history, user) {
  const q = clip(question, 500);
  try { assertSafeRequest(q); } catch (e) { return { refused: e.message }; }
  const prior = (Array.isArray(history) ? history.slice(-1)[0]?.q : '') || '';
  const mat = material(`${q} ${q.split(/\s+/).length < 6 ? prior : ''}`);
  if (!mat.length) return null;
  if (limited(user.id)) return { refused: 'You are asking quickly. Please wait a moment and try again.' };
  const ref = mat.map((m, i) => `[${i + 1}] ${m.title}: ${m.text}`).join('\n');
  const order = askOrder().split(',').filter((p) => (p === 'gemini' ? !!geminiConfig().key : !!hordeKey()));
  if (!order.length) return { refused: 'The AI helper could not answer right now.' };
  let out = null, lastErr = null;
  for (const provider of order) {
    try {
      out = provider === 'gemini' ? await viaGemini(q, ref, history, user) : await viaHorde(q, ref, history, user);
      if (out?.answer) break;
    } catch (e) { lastErr = e; if (e.extra?.code && !['provider_error'].includes(e.extra.code)) break; } // a switch, limit or budget refusal applies to every engine
  }
  if (!out?.answer && lastErr) return { refused: lastErr.extra?.code ? lastErr.message : 'The AI helper could not answer right now.' };
  const answer = String(out?.answer || '').trim().slice(0, 3000);
  if (!answer) return null;
  const found = out.found !== false;
  return { answer, found, links: found ? videoLinks(user, `${q} ${mat[0].title}`) : [], sources: found ? mat.slice(0, 3).map((m) => m.title) : [] };
}
