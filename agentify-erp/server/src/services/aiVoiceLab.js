// Console "Voice test lab": try one line in a language that tenants do NOT get yet (Punjabi) before it is offered.
// Platform-only and charged to Agentify (no workspace). Path B (exact script) needs only the voice, because the Veo video does not depend on
// the language, so it is tested by listening to the Azure voice. Path A (Veo speaks) needs a real 8-second Veo clip, so it asks for a cost
// confirmation first. Nothing is saved: results come back to the browser once and are not stored.
import { bad } from '../util.js';
import { azureVoicesFor, azureSpeak, veoStart, veoStatus, veoDownload, REEL_SECONDS } from './aiGateway.js';
import { assertSafeRequest } from './aiSafety.js';
import { costUsd } from './aiPricing.js';
import { getRate } from './fxRate.js';
import { REEL_CREDITS } from './creativeStudio.js';

const LANGS = { punjabi: { prefix: 'pa-', name: 'Punjabi' } };
const lang = (k) => LANGS[k] || (() => { throw bad('Unknown test language'); })();
const line = (t) => { const s = String(t || '').trim(); if (s.length < 3 || s.length > 200) throw bad('Type one short line, up to 200 characters.'); assertSafeRequest(s); return s; };

export async function voices(key = 'punjabi') {
  const l = lang(key);
  const list = await azureVoicesFor(l.prefix);
  return { language: l.name, voices: list, note: list.length ? null : `Azure offers no ${l.name} neural voice for your region, so the exact-script path is not possible for ${l.name} yet.` };
}

/** Path B test: the Azure voice reading one line, as base64 mp3. */
export async function speakLine({ language = 'punjabi', text, voice }) {
  const l = lang(language); const t = line(text);
  if (!voice || !String(voice).toLowerCase().startsWith(l.prefix)) throw bad(`Choose a ${l.name} voice from the list.`);
  const mp3 = await azureSpeak({ lang: 'English', text: t, voice }); // metered as a platform voice use
  return { audio: mp3.toString('base64'), mime: 'audio/mpeg' };
}

/** What a Veo-speaks test costs, in the display currency. */
export function clipCost() {
  const usd = costUsd({ feature: 'creative_video', unit: 'video_second', units: REEL_SECONDS });
  return { seconds: REEL_SECONDS, usd, pkr: usd == null ? null : usd * getRate().rate, credits_equivalent: REEL_SECONDS * REEL_CREDITS.per_second };
}

/** Path A test: start one 8-second Veo clip where the person speaks the line. Requires accept === true. */
export async function startClip({ language = 'punjabi', text, accept }) {
  const l = lang(language); const t = line(text);
  if (accept !== true) throw bad('Confirm the cost first.', { code: 'cost_not_accepted', ...clipCost() });
  const prompt = `A vertical social media clip, ${REEL_SECONDS} seconds. A person looks at the camera and says, in ${l.name}, exactly: "${t}". Clear natural speech, no music, no on-screen text.`;
  const started = await veoStart({ prompt, tenantId: null, userId: null, credits: 0 });
  return { operation: started.operation };
}
export async function clipStatus(operation) {
  const s = await veoStatus(operation);
  if (!s.done) return { done: false };
  if (s.error || !s.uri) return { done: true, error: s.filtered ? 'The video model did not accept this line.' : 'No video came back.' };
  const buf = await veoDownload(s.uri);
  if (buf.length > 25 * 1024 * 1024) return { done: true, error: 'The test clip was too large to show here.' };
  return { done: true, video: buf.toString('base64'), mime: 'video/mp4' };
}
