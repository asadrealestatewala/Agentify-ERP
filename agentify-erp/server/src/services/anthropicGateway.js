// Claude (Anthropic) with Agentify's OWN key: the platform key is set in the Super Admin console (AI), stored encrypted
// (anthropic_api_key) and never sent to a browser. Used by the website editor's "Edit with AI". Every call passes the gatekeeper
// (aiGate.js: switches, daily limit, budget, workspace credits) and writes one ai_usage row (provider 'anthropic') with the
// tokens used and the cost in US dollars and rupees, so it shows up in Cost & profit like every other platform AI call.
import { record, tokensOf } from './aiUsage.js';
import { assertPlatformAllowed } from './aiGate.js';
import { getRate, refreshIfStale } from './fxRate.js';
import { getSetting, setSetting } from './platformConfig.js';
import { bad } from '../util.js';

const API = 'https://api.anthropic.com/v1';
/** Quick edits use the faster model; a full redesign uses the stronger one. The console can pin other model ids. */
export const DEFAULT_MODELS = { edit: 'claude-sonnet-5-5', redesign: 'claude-opus-5-5' };
/** US dollars per million tokens (published prices, 2026-11). Unknown models are billed at the stronger model's price so cost is never under-counted. */
export const PRICES = { 'claude-sonnet-5-5': { in: 2, out: 10 }, 'claude-opus-5-5': { in: 4, out: 20 }, 'claude-haiku-5-5': { in: 0.1, out: 0.5 } };
const MODEL_RE = /^claude-[a-z0-9.-]{2,60}$/;

export const anthropicKey = () => getSetting('anthropic_api_key');
export const anthropicEnabled = () => getSetting('anthropic_enabled') !== '0'; // on once a key is added; the console can switch it off
export const anthropicReady = () => !!anthropicKey() && anthropicEnabled();
export const modelFor = (kind) => { const v = getSetting(`anthropic_${kind}_model`); return v && MODEL_RE.test(v) ? v : DEFAULT_MODELS[kind]; };
export const tokenCostUsd = (model, t) => { const p = PRICES[model] || PRICES['claude-opus-5-5']; return ((t?.input || 0) / 1e6) * p.in + ((t?.output || 0) / 1e6) * p.out; };

export const anthropicStatus = () => ({ key_added: !!anthropicKey(), key_hint: anthropicKey() ? `…${anthropicKey().slice(-4)}` : null, enabled: anthropicEnabled(), edit_model: modelFor('edit'), redesign_model: modelFor('redesign'), defaults: DEFAULT_MODELS });

export function saveAnthropic(b, by) {
  if (b.key && !/^•/.test(b.key)) {
    const key = String(b.key).trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) throw bad('An Anthropic key starts with sk-ant- . Copy it from console.anthropic.com > API keys.');
    setSetting('anthropic_api_key', key, { secret: true, by });
  }
  if ('enabled' in b) setSetting('anthropic_enabled', b.enabled === false ? '0' : '1', { by });
  for (const k of ['edit', 'redesign']) if (`${k}_model` in b) {
    const v = String(b[`${k}_model`] || '').trim();
    if (v && !MODEL_RE.test(v)) throw bad('A Claude model id looks like claude-sonnet-5-5');
    setSetting(`anthropic_${k}_model`, v || null, { by });
  }
  return anthropicStatus();
}
export const removeAnthropicKey = () => setSetting('anthropic_api_key', null);

/** Console: does Anthropic accept the key? */
export async function anthropicTest() {
  const key = anthropicKey();
  if (!key) throw bad('Add the Anthropic key first.');
  try {
    const res = await fetch(`${API}/models?limit=50`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401 || res.status === 403) throw new Error('Anthropic did not accept this key');
    if (!res.ok) throw new Error(`Anthropic answered ${res.status}`);
    const d = await res.json();
    return { models: (d.data || []).length };
  } catch (e) { throw bad(`Anthropic connection failed: ${e.message}`); }
}

/**
 * One Claude answer. system: text. messages: Anthropic-style [{ role, content }] (content may hold image blocks).
 * effort: low | medium | high. Returns { text, tokens, model }. A refusal, a cut-off answer or a provider error becomes a plain-words error;
 * a call the gatekeeper refuses is not logged. The raw key and the raw provider error never reach the workspace.
 */
export async function claudeMessage({ feature = 'website_ai', purpose = 'website_ai', kind = 'edit', system, messages, maxTokens = 6000, effort = 'low', tenantId = null, userId = null, credits = 0, timeout = 150_000 }) {
  const key = anthropicKey();
  if (!key || !anthropicEnabled()) throw bad('The AI website editor is not available yet. Please try again later.', { code: 'provider_off' });
  assertPlatformAllowed({ feature, tenantId, credits });
  refreshIfStale();
  const model = modelFor(kind), fx = getRate().rate;
  let d;
  try {
    const res = await fetch(`${API}/messages`, { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, output_config: { effort } }) });
    d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 429 || res.status === 529 ? 'Claude is busy right now' : d?.error?.message || `Anthropic answered ${res.status}`);
  } catch (e) {
    record({ keyOwner: 'platform', provider: 'anthropic', model, purpose, ok: false, tenantId, userId, feature });
    throw bad(`The AI could not answer right now (${String(e.message).slice(0, 160)}). Please try again in a moment.`, { code: 'provider_error' });
  }
  const tokens = tokensOf('anthropic', d);
  const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const refused = d.stop_reason === 'refusal';
  // a refusal or an empty answer was still handled by the provider: it counts toward the daily limit but is not charged to the workspace
  record({ keyOwner: 'platform', provider: 'anthropic', model, purpose, ok: !!text && !refused, tenantId, userId, feature, tokens, unit: 'call', units: 1, usd: tokens ? tokenCostUsd(model, tokens) : null, usdPkr: fx, credits: text && !refused ? credits || null : null });
  if (refused) throw bad('The AI could not help with that request. Please describe the change differently.', { code: 'blocked' });
  if (d.stop_reason === 'max_tokens') throw bad('That change is too big for one go. Please ask for a smaller change, for example one section at a time.', { code: 'too_long' });
  if (!text) throw bad('No answer came back. Please try again.', { code: 'no_answer' });
  return { text, tokens, model };
}
