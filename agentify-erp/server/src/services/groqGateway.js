// Groq (console.groq.com): fast open models over an OpenAI-style API. Used by Ask for chat answers, for questions about an attached
// picture (vision models) and for speech-to-text (Whisper), so the microphone works in every browser and the Android app.
// Platform key stored encrypted (groq_api_key), never sent to a browser. Every call passes the gatekeeper and writes one ai_usage row
// (provider 'groq'). Groq's free tier is rate limited: a 429 or any provider error becomes code provider_error so Ask moves to the next engine.
import { record } from './aiUsage.js';
import { assertPlatformAllowed } from './aiGate.js';
import { getSetting, setSetting } from './platformConfig.js';
import { askOrder, saveOrder } from './askOrder.js';
import { bad } from '../util.js';

const BASE = 'https://api.groq.com/openai/v1';
export const DEFAULTS = { chat: 'openai/gpt-oss-120b', vision: 'meta-llama/llama-4-scout-17b-16e-instruct', stt: 'whisper-large-v3-turbo' };
const MODEL_RE = /^[A-Za-z0-9._\-\/:]{2,80}$/;

export const groqKey = () => getSetting('groq_api_key');
export const groqEnabled = () => getSetting('groq_enabled') !== '0'; // on once a key is added; the console can switch it off
export const groqReady = () => !!groqKey() && groqEnabled();
const model = (kind) => { const v = getSetting(`groq_${kind}_model`); return v && MODEL_RE.test(v) ? v : DEFAULTS[kind]; };

export const groqStatus = () => ({ key_added: !!groqKey(), key_hint: groqKey() ? `…${groqKey().slice(-4)}` : null, enabled: groqEnabled(), chat_model: model('chat'), vision_model: model('vision'), stt_model: model('stt'), defaults: DEFAULTS });

export function saveGroq(b, by) {
  if (b.key && !/^•/.test(b.key)) {
    const key = String(b.key).trim();
    if (!/^gsk_[A-Za-z0-9]{20,100}$/.test(key)) throw bad('A Groq key starts with gsk_ . Copy it from console.groq.com > API Keys.');
    setSetting('groq_api_key', key, { secret: true, by });
  }
  if ('enabled' in b) setSetting('groq_enabled', b.enabled === false ? '0' : '1', { by });
  for (const k of ['chat', 'vision', 'stt']) if (`${k}_model` in b) {
    const v = String(b[`${k}_model`] || '').trim();
    if (v && !MODEL_RE.test(v)) throw bad('A model name is letters, numbers and - . _ / : only');
    setSetting(`groq_${k}_model`, v || null, { by });
  }
  if ('provider_order' in b) saveOrder(b.provider_order, by);
  return groqStatus();
}
export const removeGroqKey = () => setSetting('groq_api_key', null);

const fail = (feature, purpose, mdl, ctx, e) => {
  record({ keyOwner: 'platform', provider: 'groq', model: mdl, purpose, ok: false, tenantId: ctx.tenantId, userId: ctx.userId, feature });
  return e.status ? e : bad(`Groq could not answer right now (${e.message}).`, { code: 'provider_error' });
};
const apiError = async (res) => { const d = await res.json().catch(() => ({})); return res.status === 429 ? 'Groq is busy (rate limit)' : d?.error?.message || `Groq answered ${res.status}`; };

/** Console: does Groq accept the key? */
export async function groqTest() {
  const key = groqKey();
  if (!key) throw bad('Add the Groq key first.');
  try {
    const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401 || res.status === 403) throw new Error('Groq did not accept this key');
    if (!res.ok) throw new Error(await apiError(res));
    const d = await res.json(); return { models: (d.data || []).length };
  } catch (e) { throw bad(`Groq connection failed: ${e.message}`); }
}

/**
 * One chat answer. messages: OpenAI-style. image: optional data URL (switches to the vision model).
 * Returns the text.
 */
export async function groqChat({ feature = 'ask_assistant', purpose = 'ask_assistant', messages, image = null, tenantId = null, userId = null, maxTokens = 700, timeout = 45_000, json = false, temperature = 0.2 }) {
  const key = groqKey();
  if (!key || !groqEnabled()) throw bad('Connect Groq first (AI > Groq).');
  assertPlatformAllowed({ feature, tenantId, credits: 0 });
  const mdl = image ? model('vision') : model('chat');
  const msgs = image ? messages.map((m, i) => (i === messages.length - 1 && m.role === 'user' ? { role: 'user', content: [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: image } }] } : m)) : messages;
  let d;
  try {
    const res = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({ model: mdl, messages: msgs, temperature, max_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) }) });
    if (!res.ok) throw new Error(await apiError(res));
    d = await res.json();
  } catch (e) { throw fail(feature, purpose, mdl, { tenantId, userId }, e); }
  const text = String(d.choices?.[0]?.message?.content || '').trim();
  record({ keyOwner: 'platform', provider: 'groq', model: mdl, purpose, ok: !!text, tenantId, userId, feature, tokens: { input: d.usage?.prompt_tokens || 0, output: d.usage?.completion_tokens || 0 }, unit: 'call', units: 1, usd: 0, usdPkr: null });
  if (!text) throw bad('Groq sent back an empty answer.', { code: 'provider_error' });
  return text;
}

/** Speech to text for the Ask microphone. audio: Buffer; lang: ISO code such as en, ur, ar (optional hint). Returns the text. */
export async function groqTranscribe({ audio, mime = 'audio/webm', lang = '', tenantId = null, userId = null }) {
  const key = groqKey();
  if (!key || !groqEnabled()) throw bad('Voice needs Groq to be connected.');
  assertPlatformAllowed({ feature: 'ask_assistant', tenantId, credits: 0 });
  const mdl = model('stt');
  let text = '';
  try {
    const ext = /mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm';
    const fd = new FormData();
    fd.append('file', new Blob([audio], { type: mime }), `question.${ext}`);
    fd.append('model', mdl); fd.append('response_format', 'json'); fd.append('temperature', '0');
    if (/^[a-z]{2}$/.test(lang)) fd.append('language', lang);
    const res = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(await apiError(res));
    text = String((await res.json()).text || '').trim();
  } catch (e) { throw fail('ask_assistant', 'ask_voice', mdl, { tenantId, userId }, e); }
  record({ keyOwner: 'platform', provider: 'groq', model: mdl, purpose: 'ask_voice', ok: !!text, tenantId, userId, feature: 'ask_assistant', unit: 'call', units: 1, usd: 0, usdPkr: null });
  if (!text) throw bad('I could not hear anything. Please try again.', { code: 'no_speech' });
  return text;
}
