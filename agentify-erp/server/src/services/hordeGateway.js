// Stable Horde (AI Horde, aihorde.net): a community text network that can answer Ask when Gemini is off, out of budget or failing.
// The key is a platform key (console > AI > Technical details), stored encrypted, never sent to a browser. Every call passes the
// gatekeeper first and writes one ai_usage row (provider 'stablehorde', cost 0 USD because the Horde is paid in kudos, not money).
// PRIVACY: the Horde is run by volunteers and prompts may be seen by workers. Callers send only help-guide text and a scrubbed question
// (scrubForHorde removes emails, phone numbers, long numbers, keys, links with query strings and names of the person asking).
import { record } from './aiUsage.js';
import { assertPlatformAllowed } from './aiGate.js';
import { getSetting, setSetting } from './platformConfig.js';
import { bad } from '../util.js';
import { askOrder, saveOrder } from './askOrder.js';

const BASE = 'https://aihorde.net/api/v2';
const HEADERS = (key) => ({ apikey: key, 'Content-Type': 'application/json', 'Client-Agent': 'AgentifyERP:1:support' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const hordeKey = () => getSetting('stablehorde_api_key');
export const hordeModels = () => String(getSetting('stablehorde_models') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
export const hordeStatus = () => ({ key_added: !!hordeKey(), key_hint: hordeKey() ? `…${hordeKey().slice(-4)}` : null, models: hordeModels(), trusted_only: getSetting('stablehorde_trusted') !== '0', provider_order: askOrder().join(','), gemini_enabled: geminiAskEnabled() });

/** Gemini as an Ask engine is OFF until the console switches it on (setting ask_gemini_enabled = '1'). While off it is never called, whatever the order says. */
export const geminiAskEnabled = () => getSetting('ask_gemini_enabled') === '1';

const MODEL_RE = /^[A-Za-z0-9._\-\/: ]{2,80}$/;
export function saveHorde(b, by) {
  if (b.key && !/^•/.test(b.key)) {
    const key = String(b.key).trim();
    if (!/^[A-Za-z0-9_\-]{10,80}$/.test(key)) throw bad('A Stable Horde key is letters, numbers, dashes and underscores. Copy it from aihorde.net > Register / your account.');
    setSetting('stablehorde_api_key', key, { secret: true, by });
  }
  if ('models' in b) {
    const list = String(b.models || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > 5 || list.some((m) => !MODEL_RE.test(m))) throw bad('Name up to 5 models, separated by commas (leave empty to let the Horde choose).');
    setSetting('stablehorde_models', list.join(',') || null, { by });
  }
  if ('trusted_only' in b) setSetting('stablehorde_trusted', b.trusted_only === false ? '0' : '1', { by });
  if ('gemini_enabled' in b) setSetting('ask_gemini_enabled', b.gemini_enabled === true ? '1' : '0', { by });
  if ('provider_order' in b) saveOrder(b.provider_order, by);
  return hordeStatus();
}
export const removeHordeKey = () => setSetting('stablehorde_api_key', null);

/** Console: does the Horde accept the key? Returns the account name and kudos. */
export async function hordeTest() {
  const key = hordeKey();
  if (!key) throw bad('Add the Stable Horde key first.');
  let d;
  try {
    const res = await fetch(`${BASE}/find_user`, { headers: HEADERS(key), signal: AbortSignal.timeout(20_000) });
    d = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error('The Horde did not accept this key');
    if (!res.ok) throw new Error(d?.message || `The Horde answered ${res.status}`);
  } catch (e) { throw bad(`Stable Horde connection failed: ${e.message}`); }
  return { username: d.username || null, kudos: d.kudos ?? null, trusted: !!d.trusted };
}

/** Remove what must never leave Agentify from text going to the Horde. Returns { text, removed } (removed = how many items were masked). */
export function scrubForHorde(input, names = []) {
  let removed = 0;
  const sub = (re, to) => { s = s.replace(re, () => { removed += 1; return to; }); };
  let s = String(input || '');
  sub(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  sub(/\bhttps?:\/\/[^\s]*[?#][^\s]*/gi, '[link]');
  sub(/\b(?:sk|pk|AIza|ghp|xox[bp]|Bearer)[-_ ]?[A-Za-z0-9_\-]{16,}\b/g, '[key]');
  sub(/\b[A-Za-z0-9+/_-]{32,}\b/g, '[key]');
  sub(/\+?\d[\d\s().-]{8,}\d/g, '[number]');
  sub(/\b\d{9,}\b/g, '[number]');
  for (const n of names) if (n && String(n).trim().length >= 3) sub(new RegExp(String(n).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[name]');
  return { text: s, removed };
}

/**
 * One text answer from the Horde. prompt: the full prompt (instructions + material + question). Returns the text.
 * Slow by nature (a queue of volunteer workers): polls up to `timeout` ms, then cancels and fails with a plain note.
 */
export async function hordeGenerate({ feature, purpose, prompt, tenantId = null, userId = null, maxLength = 500, timeout = 75_000 }) {
  const key = hordeKey();
  if (!key) throw bad('Connect Stable Horde first (AI > Technical details).');
  assertPlatformAllowed({ feature, tenantId, credits: 0 });
  const models = hordeModels();
  const body = { prompt: String(prompt).slice(0, 12_000), params: { max_length: maxLength, max_context_length: 3072, temperature: 0.3, top_p: 0.85, rep_pen: 1.1, n: 1 }, trusted_workers: getSetting('stablehorde_trusted') !== '0', slow_workers: true, ...(models.length ? { models } : {}) };
  let id, text = '', model = models[0] || 'auto';
  try {
    const sub = await fetch(`${BASE}/generate/text/async`, { method: 'POST', headers: HEADERS(key), body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const sd = await sub.json().catch(() => ({}));
    if (!sub.ok || !sd.id) throw new Error(sd?.message || `The Horde answered ${sub.status}`);
    id = sd.id;
    const end = Date.now() + timeout;
    for (;;) {
      await sleep(Number(process.env.HORDE_POLL_MS) || 3000);
      const st = await fetch(`${BASE}/generate/text/status/${encodeURIComponent(id)}`, { headers: HEADERS(key), signal: AbortSignal.timeout(20_000) });
      const d = await st.json().catch(() => ({}));
      if (!st.ok) throw new Error(d?.message || `The Horde answered ${st.status}`);
      if (d.faulted) throw new Error('The Horde could not finish the job');
      if (d.done) { const g = (d.generations || [])[0]; text = String(g?.text || '').trim(); model = g?.model || model; break; }
      if (Date.now() > end) throw new Error('the Horde queue is busy');
    }
  } catch (e) {
    if (id) fetch(`${BASE}/generate/text/status/${encodeURIComponent(id)}`, { method: 'DELETE', headers: HEADERS(key), signal: AbortSignal.timeout(10_000) }).catch(() => {});
    record({ keyOwner: 'platform', provider: 'stablehorde', model, purpose: purpose || feature, ok: false, tenantId, userId, feature });
    throw e.status ? e : bad(`The community AI could not answer right now (${e.message}).`, { code: 'provider_error' });
  }
  // the Horde reports no token counts: estimate from length so the ledger shows volume (cost stays 0, it is paid in kudos)
  record({ keyOwner: 'platform', provider: 'stablehorde', model, purpose: purpose || feature, ok: !!text, tenantId, userId, feature,
    tokens: { input: Math.ceil(body.prompt.length / 4), output: Math.ceil(text.length / 4) }, unit: 'call', units: 1, usd: 0, usdPkr: null });
  if (!text) throw bad('The community AI sent back an empty answer.', { code: 'provider_error' });
  return text;
}
