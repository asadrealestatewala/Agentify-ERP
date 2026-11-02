// The one door to Agentify's OWN Gemini key (platform key). Every platform AI call goes through here so nothing can skip
// metering: it picks the stored key (never sent to a browser), makes the call, and writes one ai_usage row with the units
// used and the cost in US dollars and rupees (rupees at the rate in force at that moment).
// Calls made with a workspace's own key still go through integrations/ai.js and keep their own limits (they are not Agentify cost).
// The gatekeeper (aiGate.js) runs first on every call; Stages 4-5 add image, video and voice here.
import { config, record, tokensOf } from './aiUsage.js';
import { costUsd } from './aiPricing.js';
import { assertPlatformAllowed } from './aiGate.js';
import { getRate, refreshIfStale } from './fxRate.js';
import { bad } from '../util.js';
import { getSetting } from './platformConfig.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';


/**
 * One Gemini generateContent call with the platform key.
 * feature: a key of FEATURES in aiPricing.js. purpose: legacy label kept in the ledger. body: the request JSON. Returns Google's response.
 */
export async function geminiGenerate({ feature, purpose, body, tenantId = null, userId = null, admin = null, credits = 0, model, timeout = 60_000 }) {
  const c = config();
  if (!c.key) throw bad('Connect Gemini first (AI > AI settings).');
  assertPlatformAllowed({ feature, tenantId, credits });
  refreshIfStale();
  const m = model || c.model;
  const fx = getRate().rate;
  let d;
  try {
    const res = await fetch(`${GEMINI}/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': c.key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout), body: JSON.stringify(body) });
    d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error?.message || `Google answered ${res.status}`);
  } catch (e) {
    record({ keyOwner: 'platform', provider: 'gemini', model: m, purpose: purpose || feature, ok: false, admin, tenantId, userId, feature, credits: 0 });
    throw e.status ? e : bad(`The AI service could not answer right now (${e.message}). Please try again in a moment.`, { code: 'provider_error' });
  }
  const tokens = tokensOf('gemini', d);
  record({ keyOwner: 'platform', provider: 'gemini', model: m, purpose: purpose || feature, tokens, admin, tenantId, userId, feature, credits: credits || null,
    unit: 'call', units: 1, usd: tokens ? costUsd({ feature, tokens }) : costUsd({ feature, unit: 'call', units: 1 }), usdPkr: fx });
  return d;
}

export const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
export const imageModel = () => getSetting('creative_image_model') || DEFAULT_IMAGE_MODEL;
export const ASPECTS = { square: '1:1', portrait: '4:5', story: '9:16' };

/**
 * One image from Gemini's image model (Nano Banana) with the platform key. Metered as one image at the feature's price.
 * Returns { mime, data (base64) }. A prompt or result Google blocks for safety gives a plain-words error (and still counts as a use).
 */
export async function geminiImage({ feature = 'creative_post', prompt, aspect = 'square', tenantId = null, userId = null, credits = 0, timeout = 90_000 }) {
  const c = config();
  if (!c.key) throw bad('Image creation is not available yet. Please try again later.');
  assertPlatformAllowed({ feature, tenantId, credits });
  refreshIfStale();
  const m = imageModel(), fx = getRate().rate;
  let d;
  try {
    const res = await fetch(`${GEMINI}/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': c.key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: String(prompt) }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ASPECTS[aspect] || '1:1' } } }) });
    d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error?.message || `Google answered ${res.status}`);
  } catch (e) {
    record({ keyOwner: 'platform', provider: 'gemini', model: m, purpose: feature, ok: false, tenantId, userId, feature });
    throw bad(`The image could not be created: ${e.message}`);
  }
  const part = (d.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  const blocked = d.promptFeedback?.blockReason || /SAFETY|PROHIBITED|BLOCK/i.test(d.candidates?.[0]?.finishReason || '');
  // a safety block is still a request Google handled, so it counts toward the daily limit but is not charged to the workspace
  record({ keyOwner: 'platform', provider: 'gemini', model: m, purpose: feature, ok: !!part, tenantId, userId, feature, unit: 'image', units: part ? 1 : 0, usd: part ? costUsd({ feature, unit: 'image', units: 1 }) : 0, usdPkr: fx, credits: part ? credits || null : null });
  if (!part) throw bad(blocked ? 'The image model did not accept this request. Please describe the post differently.' : 'No image came back. Please try again.', { code: blocked ? 'blocked' : 'no_image' });
  return { mime: part.inlineData.mimeType || 'image/png', data: part.inlineData.data };
}
