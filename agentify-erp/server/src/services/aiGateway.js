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

// ---- video (Gemini Veo): a long-running job. Charged when it starts; a failed job is refunded by the caller with refundCredits().
export const DEFAULT_VIDEO_MODEL = 'veo-3.0-fast-generate-001';
export const videoModel = () => getSetting('creative_video_model') || DEFAULT_VIDEO_MODEL;
export const REEL_SECONDS = 8; // one Veo clip; longer reels need clips stitched together (not built)
const OP_RE = /^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+$/;
const keyHeaders = (key) => ({ 'x-goog-api-key': key, 'Content-Type': 'application/json' });

export async function veoStart({ prompt, tenantId = null, userId = null, credits = 0 }) {
  const c = config();
  if (!c.key) throw bad('Video creation is not available yet. Please try again later.');
  assertPlatformAllowed({ feature: 'creative_video', tenantId, credits });
  refreshIfStale();
  const m = videoModel(), fx = getRate().rate;
  let d;
  try {
    const res = await fetch(`${GEMINI}/models/${encodeURIComponent(m)}:predictLongRunning`, { method: 'POST', headers: keyHeaders(c.key), signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ instances: [{ prompt: String(prompt) }], parameters: { aspectRatio: '9:16', durationSeconds: REEL_SECONDS } }) });
    d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error?.message || `Google answered ${res.status}`);
    if (!OP_RE.test(String(d.name || ''))) throw new Error('Google did not return a job');
  } catch (e) {
    record({ keyOwner: 'platform', provider: 'gemini', model: m, purpose: 'creative_video', ok: false, tenantId, userId, feature: 'creative_video' });
    throw bad(`The video could not be started (${e.message}). Please try again in a moment.`, { code: 'provider_error' });
  }
  record({ keyOwner: 'platform', provider: 'gemini', model: m, purpose: 'creative_video', tenantId, userId, feature: 'creative_video', unit: 'video_second', units: REEL_SECONDS,
    usd: costUsd({ feature: 'creative_video', unit: 'video_second', units: REEL_SECONDS }), usdPkr: fx, credits: credits || null });
  return { operation: d.name, model: m };
}

/** One look at a running video job: { done, error, uri, filtered }. */
export async function veoStatus(operation) {
  const c = config();
  if (!c.key || !OP_RE.test(String(operation))) throw new Error('Video job is not available');
  const res = await fetch(`${GEMINI}/${operation}`, { headers: keyHeaders(c.key), signal: AbortSignal.timeout(30_000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error?.message || `Google answered ${res.status}`);
  const r = d.response?.generateVideoResponse;
  return { done: !!d.done, error: d.error?.message || null, uri: r?.generatedSamples?.[0]?.video?.uri || null, filtered: (r?.raiMediaFilteredReasons || [])[0] || null };
}
export async function veoDownload(uri) {
  const c = config();
  if (!c.key || !String(uri).startsWith('https://generativelanguage.googleapis.com/')) throw new Error('Unexpected video address');
  const res = await fetch(uri, { headers: { 'x-goog-api-key': c.key }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Google answered ${res.status} for the video file`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000 || buf.length > 150 * 1024 * 1024) throw new Error('The video file was not usable');
  return buf;
}

/** Put credits back after a failed job: a negative-credit row, so monthly credit totals stay correct without editing history. */
export function refundCredits({ tenantId, userId = null, credits, feature, note = 'refund' }) {
  if (!(credits > 0)) return;
  record({ keyOwner: 'platform', provider: 'gemini', purpose: 'refund', tenantId, userId, feature, credits: -credits, usd: 0, usdPkr: getRate().rate, unit: note });
}

// ---- voice (Azure Speech): English and Urdu narration, charged per character
const VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;
export const DEFAULT_VOICES = { English: 'en-US-JennyNeural', Urdu: 'ur-PK-UzmaNeural' };
export const voiceFor = (lang) => { const v = getSetting(lang === 'Urdu' ? 'azure_voice_ur' : 'azure_voice_en'); return VOICE_RE.test(v || '') ? v : DEFAULT_VOICES[lang === 'Urdu' ? 'Urdu' : 'English']; };
export const SAMPLE_TEXT = { English: 'Welcome to Agentify ERP. This is how your video voice will sound.', Urdu: 'ایجنٹیفائی ای آر پی میں خوش آمدید۔ آپ کی ویڈیو کی آواز کچھ ایسی ہوگی۔' };
const azure = () => ({ key: getSetting('azure_speech_key'), region: getSetting('azure_speech_region') });
const esc = (t) => String(t).replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
export const MAX_VOICE_CHARS = 600;

/** Speech as an mp3 Buffer. text up to 600 characters. Metered per character as video_voice_en / video_voice_ur. */
export async function azureSpeak({ lang, text, voice, tenantId = null, userId = null, credits = 0 }) {
  const { key, region } = azure();
  if (!key || !region) throw bad('Voice-overs are not available yet. Please try again later.');
  const t = String(text || '').trim();
  if (!t) throw bad('There is no text to speak.');
  if (t.length > MAX_VOICE_CHARS) throw bad(`The voice-over can be at most ${MAX_VOICE_CHARS} characters.`);
  const feature = lang === 'Urdu' ? 'video_voice_ur' : 'video_voice_en';
  assertPlatformAllowed({ feature, tenantId, credits });
  refreshIfStale();
  const v = voice && VOICE_RE.test(voice) ? voice : voiceFor(lang), fx = getRate().rate;
  let buf;
  try {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST', signal: AbortSignal.timeout(45_000), body: `<speak version='1.0' xml:lang='${v.split('-').slice(0, 2).join('-')}' xmlns='http://www.w3.org/2001/10/synthesis'><voice name='${v}'>${esc(t)}</voice></speak>`,
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'AgentifyERP' } });
    if (!res.ok) throw new Error(`Azure answered ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) throw new Error('empty audio');
  } catch (e) {
    record({ keyOwner: 'platform', provider: 'azure', model: v, purpose: feature, ok: false, tenantId, userId, feature });
    throw bad(`The voice could not be made (${e.message}). Please try again in a moment.`, { code: 'provider_error' });
  }
  record({ keyOwner: 'platform', provider: 'azure', model: v, purpose: feature, tenantId, userId, feature, unit: 'character', units: t.length, usd: costUsd({ feature, unit: 'character', units: t.length }), usdPkr: fx, credits: credits || null });
  return buf;
}

/** Console: does Azure accept the key and region? Also returns the voices it offers for English and Urdu. */
export async function azureTest(keyOverride, regionOverride) {
  const key = keyOverride || azure().key, region = regionOverride || azure().region;
  if (!key || !region) throw bad('Add the Azure key and region first.');
  if (!/^[a-z0-9]{3,30}$/.test(region)) throw bad('The Azure region is a short name such as uaenorth or eastus.');
  let voices;
  try {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { 'Ocp-Apim-Subscription-Key': key }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401 || res.status === 403) throw new Error('Azure did not accept this key for this region');
    if (!res.ok) throw new Error(`Azure answered ${res.status}`);
    voices = await res.json();
  } catch (e) { throw bad(`Azure connection failed: ${e.message}`); }
  const pick = (loc) => (Array.isArray(voices) ? voices : []).filter((x) => String(x.Locale || '').startsWith(loc) && /Neural/.test(x.ShortName || '')).map((x) => ({ name: x.ShortName, label: `${x.LocalName || x.ShortName} (${x.Locale}, ${x.Gender})` }));
  return { English: pick('en-'), Urdu: pick('ur-') };
}
