// FreeLLMAPI (a self-hosted OpenAI-compatible router over free AI tiers) as an EXTRA provider, never a replacement.
// Runs on the same server, bound to localhost. Settings: .env (FREELLMAPI_BASE_URL, FREELLMAPI_API_KEY, FREELLMAPI_ENABLED) with the
// console able to override them (the key is saved encrypted and never returned). Every call passes the gatekeeper and writes one
// ai_usage row (provider 'freellmapi', model = the X-Routed-Via header, cost 0).
//
// PRIVACY CHOKE POINT: every caller must say whether the request carries workspace data (`tenantData`). If it does, the call is refused
// unless (a) the master emergency switch is not pulled and (b) THIS workspace's own switch is on. One request carries one workspace only.
import { record } from './aiUsage.js';
import { ensureTable } from './aiUsage.js';
import { assertPlatformAllowed } from './aiGate.js';
import { getSetting, setSetting, audit as platformAudit } from './platformConfig.js';
import { getRate } from './fxRate.js';
import { bad } from '../util.js';

export const FEATURES = { chat: 'Chat answers (backup and help questions)', images: 'Image generation', video: 'Short video generation', speech: 'Speech (backup voice)' };
export const DEFAULT_BASE = 'http://localhost:3001/v1';
export const TIMEOUTS = { chat: 30_000, images: 90_000, speech: 45_000, video: 300_000 };
export const WARNING = 'Free AI providers may store or use this data for training. Only enable for tenants who have agreed.';
const FRIENDLY = 'The extra AI helper is busy or not available right now. Please try again in a moment.';

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const baseOk = (u) => /^https?:\/\/[^\s/]+(:\d+)?(\/[A-Za-z0-9._~\-\/]*)?$/.test(String(u || ''));

export const freellmKey = () => getSetting('freellm_api_key') || process.env.FREELLMAPI_API_KEY || '';
export const freellmBase = () => { const v = String(getSetting('freellm_base_url') || process.env.FREELLMAPI_BASE_URL || DEFAULT_BASE).trim().replace(/\/+$/, ''); return baseOk(v) ? v : DEFAULT_BASE; };
/** Console switch wins once it has been saved; until then FREELLMAPI_ENABLED in .env decides (default off). */
export const freellmEnabled = () => { const s = getSetting('freellm_enabled'); return s == null || s === '' ? truthy(process.env.FREELLMAPI_ENABLED) : s === '1'; };
export const freellmReady = () => freellmEnabled() && !!freellmKey();
export const featureOn = (f) => freellmReady() && getSetting(`freellm_f_${f}`) !== '0';

// ---- the per-workspace "Allow workspace data through FreeLLMAPI" switch (default OFF everywhere)
const COLS = [['freellm_tenant_data', 'INTEGER NOT NULL DEFAULT 0'], ['freellm_tenant_data_by', 'TEXT'], ['freellm_tenant_data_at', 'TEXT']];
let colsReady = false;
function wsDb() {
  const d = ensureTable();
  if (!colsReady) {
    const have = new Set(d.prepare('PRAGMA table_info(workspace_ai_settings)').all().map((c) => c.name));
    for (const [c, def] of COLS) if (!have.has(c)) d.exec(`ALTER TABLE workspace_ai_settings ADD COLUMN ${c} ${def}`);
    colsReady = true;
  }
  return d;
}
/** Master emergency switch: when pulled, no workspace's data reaches FreeLLMAPI whatever its own switch says. */
export const tenantDataMasterOff = () => getSetting('freellm_tenant_data_off') === '1';
export function tenantDataAllowed(tenantId) {
  if (!tenantId || !freellmEnabled() || tenantDataMasterOff()) return false;
  return wsDb().prepare('SELECT freellm_tenant_data f FROM workspace_ai_settings WHERE tenant_id=?').get(Number(tenantId))?.f === 1;
}
/** What a workspace admin (and the console tenant page) may see. */
export function tenantDataStatus(tenantId) {
  const r = tenantId ? wsDb().prepare('SELECT freellm_tenant_data f, freellm_tenant_data_by by, freellm_tenant_data_at at FROM workspace_ai_settings WHERE tenant_id=?').get(Number(tenantId)) : null;
  const on = r?.f === 1;
  return { on, effective: on && freellmEnabled() && !tenantDataMasterOff(), master_off: tenantDataMasterOff(), by: on ? r.by : null, at: on ? r.at : null, warning: WARNING };
}
export function setTenantData(tenantId, { on, confirm }, by) {
  const id = Number(tenantId);
  if (!ensureTable().prepare('SELECT 1 FROM tenants WHERE id=?').get(id)) throw bad('Workspace not found');
  if (on && confirm !== true) throw bad(`Tick the confirm box first. ${WARNING}`, { code: 'confirm_required' });
  const was = tenantDataStatus(id).on;
  wsDb().prepare(`INSERT INTO workspace_ai_settings(tenant_id, freellm_tenant_data, freellm_tenant_data_by, freellm_tenant_data_at, updated_by, updated_at) VALUES(?,?,?,datetime('now'),?,datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET freellm_tenant_data=excluded.freellm_tenant_data, freellm_tenant_data_by=excluded.freellm_tenant_data_by, freellm_tenant_data_at=excluded.freellm_tenant_data_at`)
    .run(id, on ? 1 : 0, by || null, by || null);
  platformAudit(by, on ? 'freellm-tenant-data-on' : 'freellm-tenant-data-off', { tenant: id, was, confirmed: !!on });
  return tenantDataStatus(id);
}

/** Console: every workspace with its switch, who set it and when (for the per-workspace list). */
export function workspaceList() {
  const d = wsDb();
  return d.prepare("SELECT t.id, t.name, t.slug, COALESCE(w.freellm_tenant_data,0) AS on_, w.freellm_tenant_data_by AS by_, w.freellm_tenant_data_at AS at_ FROM tenants t LEFT JOIN workspace_ai_settings w ON w.tenant_id=t.id ORDER BY t.name").all()
    .map((r) => ({ id: r.id, name: r.name, slug: r.slug, on: r.on_ === 1, by: r.on_ === 1 ? r.by_ : null, at: r.on_ === 1 ? r.at_ : null }));
}

// ---- console settings
export function freellmStatus() {
  const key = freellmKey();
  return {
    enabled: freellmEnabled(), ready: freellmReady(), key_added: !!key, key_hint: key ? `…${key.slice(-4)}` : null, key_from: getSetting('freellm_api_key') ? 'console' : key ? 'env' : null,
    base_url: freellmBase(), features: Object.fromEntries(Object.keys(FEATURES).map((f) => [f, getSetting(`freellm_f_${f}`) !== '0'])), feature_labels: FEATURES,
    tenant_data_master_off: tenantDataMasterOff(), tenants_with_data_on: wsDb().prepare('SELECT COUNT(*) n FROM workspace_ai_settings WHERE freellm_tenant_data=1').get().n, warning: WARNING,
  };
}
export function saveFreellm(b, by) {
  if (b.key && !/^•/.test(b.key)) {
    const key = String(b.key).trim();
    if (!/^[A-Za-z0-9_\-]{12,200}$/.test(key)) throw bad('The FreeLLMAPI key is letters, numbers, dashes and underscores (it looks like freellmapi-…). Copy it from the FreeLLMAPI dashboard.');
    setSetting('freellm_api_key', key, { secret: true, by });
  }
  if ('base_url' in b) {
    const u = String(b.base_url || '').trim().replace(/\/+$/, '');
    if (u && !baseOk(u)) throw bad('The address should look like http://localhost:3001/v1');
    setSetting('freellm_base_url', u || null, { by });
  }
  if ('enabled' in b) setSetting('freellm_enabled', b.enabled ? '1' : '0', { by });
  for (const f of Object.keys(FEATURES)) if (b.features && f in b.features) setSetting(`freellm_f_${f}`, b.features[f] ? '1' : '0', { by });
  if ('tenant_data_master_off' in b) setSetting('freellm_tenant_data_off', b.tenant_data_master_off ? '1' : '0', { by });
  return freellmStatus();
}
export const removeFreellmKey = () => setSetting('freellm_api_key', null);

// ---- the calls
async function call({ path, feature, kind, body, tenantId, userId, purpose, tenantData, binary = false, timeout }) {
  if (!featureOn(kind)) throw bad(FRIENDLY, { code: 'provider_error' });
  if (tenantData && !tenantDataAllowed(tenantId)) throw bad('This request holds workspace data, which is not allowed to leave through the extra AI helper.', { code: 'freellm_data_blocked' });
  assertPlatformAllowed({ feature, tenantId, credits: 0 });
  const t0 = Date.now();
  let res, routed = null, out;
  try {
    res = await fetch(`${freellmBase()}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${freellmKey()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout || TIMEOUTS[kind]) });
    routed = res.headers.get('x-routed-via') || res.headers.get('x-model') || null;
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error?.message || `status ${res.status}`); }
    out = binary ? { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' } : await res.json();
  } catch (e) {
    record({ keyOwner: 'platform', provider: 'freellmapi', model: routed, purpose: purpose || feature, ok: false, tenantId, userId, feature, unit: 'call', units: 1, usd: 0, usdPkr: null });
    throw bad(FRIENDLY, { code: 'provider_error', detail: String(e.message).slice(0, 160), ms: Date.now() - t0 });
  }
  record({ keyOwner: 'platform', provider: 'freellmapi', model: routed || body.model || 'auto', purpose: purpose || feature, tenantId, userId, feature, unit: 'call', units: 1, usd: 0, usdPkr: getRate().rate,
    tokens: out?.usage ? { input: out.usage.prompt_tokens || 0, output: out.usage.completion_tokens || 0 } : null });
  return { out, routed };
}

/** One chat answer. tenantData: true when the messages hold anything from a workspace's records or notes. Returns the text. */
export async function freellmChat({ messages, feature = 'ask_assistant', purpose = 'ask_assistant', tenantId = null, userId = null, tenantData = false, maxTokens = 700, temperature = 0.2, timeout }) {
  const { out } = await call({ path: '/chat/completions', feature, kind: 'chat', tenantId, userId, purpose, tenantData, timeout, body: { model: 'auto', messages, max_tokens: maxTokens, temperature } });
  const text = String(out?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw bad(FRIENDLY, { code: 'provider_error' });
  return text;
}
/** One image: { mime, data (base64) }. Prompts must not hold workspace data (tenantData is always false here). */
export async function freellmImage({ prompt, feature = 'creative_post', tenantId = null, userId = null, size = '1024x1024' }) {
  const { out } = await call({ path: '/images/generations', feature, kind: 'images', tenantId, userId, purpose: 'freellm_image', tenantData: false, body: { model: 'auto', prompt: String(prompt).slice(0, 1500), n: 1, size, response_format: 'b64_json' } });
  const item = out?.data?.[0];
  let data = item?.b64_json;
  if (!data && /^https?:\/\//.test(item?.url || '')) {
    const r = await fetch(item.url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (r?.ok) data = Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  if (!data) throw bad(FRIENDLY, { code: 'no_image' });
  return { mime: 'image/png', data };
}
/** One short video as an mp4 Buffer (the router answers with binary data; it can take minutes). */
export async function freellmVideo({ prompt, seconds = 6, feature = 'creative_video', tenantId = null, userId = null }) {
  const { out, routed } = await call({ path: '/videos/generations', feature, kind: 'video', tenantId, userId, purpose: 'freellm_video', tenantData: false, binary: true, body: { model: 'auto', prompt: String(prompt).slice(0, 1500), duration: seconds } });
  if (!out.buf || out.buf.length < 1000) throw bad(FRIENDLY, { code: 'no_video' });
  return { buf: out.buf, routed };
}
/** Backup voice: an audio Buffer. Azure stays the main voice; callers use this only when Azure fails. */
export async function freellmSpeech({ text, voice = 'alloy', feature = 'video_voice_en', tenantId = null, userId = null }) {
  const { out } = await call({ path: '/audio/speech', feature, kind: 'speech', tenantId, userId, purpose: 'freellm_speech', tenantData: false, binary: true, body: { model: 'auto', input: String(text).slice(0, 600), voice } });
  if (!out.buf || out.buf.length < 200) throw bad(FRIENDLY, { code: 'provider_error' });
  return out.buf;
}

/** Console: does the router answer? Lists how many models it knows. Never throws raw errors. */
export async function freellmTest() {
  if (!freellmKey()) throw bad('Add the FreeLLMAPI key first.');
  const t0 = Date.now();
  try {
    const res = await fetch(`${freellmBase()}/models`, { headers: { Authorization: `Bearer ${freellmKey()}` }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) throw new Error('FreeLLMAPI did not accept this key');
    if (!res.ok) throw new Error(`FreeLLMAPI answered ${res.status}`);
    const d = await res.json();
    return { ok: true, models: (d.data || []).length, ms: Date.now() - t0 };
  } catch (e) { throw bad(`FreeLLMAPI connection failed: ${e.message}. Check it is running and the address is right.`); }
}
