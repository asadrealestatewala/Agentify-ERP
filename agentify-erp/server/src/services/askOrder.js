// The order in which Ask tries its AI engines. A ranking, not a switch: each engine has its own on/off (Groq: enable switch + key,
// Stable Horde: key, Gemini: "Allow Gemini for Ask"). An engine that is off or has no key is skipped. Engines missing from the stored
// list are appended in the default order, so older saved values keep working.
import { getSetting, setSetting } from './platformConfig.js';
import { bad } from '../util.js';

export const ENGINES = { groq: 'Groq', horde: 'Stable Horde', gemini: 'Gemini' };
export const DEFAULT_ORDER = ['groq', 'horde', 'gemini'];

export function askOrder() {
  const stored = String(getSetting('ask_provider_order') || '').split(',').map((s) => s.trim()).filter((s, i, a) => ENGINES[s] && a.indexOf(s) === i);
  return [...stored, ...DEFAULT_ORDER.filter((e) => !stored.includes(e))];
}
export function saveOrder(list, by) {
  const l = (Array.isArray(list) ? list : String(list || '').split(',')).map((s) => String(s).trim());
  if (!l.length || l.some((e) => !ENGINES[e]) || new Set(l).size !== l.length) throw bad('Choose the order of Groq, Stable Horde and Gemini');
  setSetting('ask_provider_order', l.join(','), { by });
  return askOrder();
}
