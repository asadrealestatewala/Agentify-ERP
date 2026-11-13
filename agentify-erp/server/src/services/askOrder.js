// The order in which Ask tries its AI engines. A ranking, not a switch: each engine has its own on/off (Groq: enable switch + key,
// Stable Horde: key, Gemini: "Allow Gemini for Ask"). An engine that is off or has no key is skipped. Engines missing from the stored
// list are appended in the default order, so older saved values keep working.
import { getSetting, setSetting } from './platformConfig.js';
import { bad } from '../util.js';

export const ENGINES = { groq: 'Groq', horde: 'Stable Horde', gemini: 'Gemini', freellmapi: 'FreeLLMAPI' };
export const DEFAULT_ORDER = ['groq', 'horde', 'gemini', 'freellmapi'];

export function askOrder() {
  const stored = String(getSetting('ask_provider_order') || '').split(',').map((s) => s.trim()).filter((s, i, a) => ENGINES[s] && a.indexOf(s) === i);
  return [...stored, ...DEFAULT_ORDER.filter((e) => !stored.includes(e))];
}
export function saveOrder(list, by) {
  const l = (Array.isArray(list) ? list : String(list || '').split(',')).map((s) => String(s).trim());
  if (!l.length || l.some((e) => !ENGINES[e]) || new Set(l).size !== l.length) throw bad('Choose the order of Groq, Stable Horde, Gemini and FreeLLMAPI');
  setSetting('ask_provider_order', l.join(','), { by });
  return askOrder();
}

/** Console: the last reason each engine failed (cleared when it next answers), so "why was Groq skipped" has an answer. */
export function noteEngine(provider, err) {
  try { setSetting(`ask_last_error_${provider}`, err ? JSON.stringify({ at: new Date().toISOString(), message: String(err.message || err).slice(0, 200) }) : null, {}); } catch { /* cosmetic */ }
}
export const engineErrors = () => Object.fromEntries(['groq', 'horde', 'gemini', 'freellmapi'].map((p) => { let v = null; try { v = JSON.parse(getSetting(`ask_last_error_${p}`) || 'null'); } catch { /* ignore */ } return [p, v]; }));


/**
 * Console: the on/off switch of each Ask engine, honoured everywhere (an engine that is off is never called, not even as a backup).
 * b: { groq?: bool, horde?: bool, gemini?: bool } or { only: 'groq' | 'horde' | 'gemini' } to keep one engine on and switch the others off.
 * Keys are never touched: switching an engine on again only needs the same key.
 */
export function saveEngineSwitches(b, by) {
  const keys = { groq: 'groq_enabled', horde: 'stablehorde_enabled', gemini: 'ask_gemini_enabled', freellmapi: 'freellm_enabled' };
  let want = {};
  if (b.only != null) {
    if (!keys[b.only]) throw bad('Choose Groq, Stable Horde, Gemini or FreeLLMAPI.');
    want = Object.fromEntries(Object.keys(keys).map((k) => [k, k === b.only]));
  } else {
    for (const k of Object.keys(keys)) if (k in b) want[k] = !!b[k];
  }
  for (const [k, on] of Object.entries(want)) setSetting(keys[k], on ? '1' : '0', { by });
  return want;
}
