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
    throw e;
  }
  const tokens = tokensOf('gemini', d);
  record({ keyOwner: 'platform', provider: 'gemini', model: m, purpose: purpose || feature, tokens, admin, tenantId, userId, feature, credits: credits || null,
    unit: 'call', units: 1, usd: tokens ? costUsd({ feature, tokens }) : costUsd({ feature, unit: 'call', units: 1 }), usdPkr: fx });
  return d;
}
