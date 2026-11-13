// Figures and settings for the console's AI page that concern Agentify's OWN key: cost per feature and workspace in USD and rupees,
// the price list, limits, credits, the dollar rate and the provider connections. Reads the ledger written by aiGateway.js.
import { getSetting, setSetting, audit } from './platformConfig.js';
import { bad } from '../util.js';
import { listReports, openReportCount } from './aiReports.js';
import { imageModel, videoModel, voiceFor, azureTest, azureSpeak, DEFAULT_VOICES, SAMPLE_TEXT } from './aiGateway.js';
import { hordeStatus, hordeReady, geminiAskEnabled } from './hordeGateway.js';
import { groqStatus, groqReady } from './groqGateway.js';
import { askOrder, engineErrors } from './askOrder.js';
import { freellmStatus, featureOn as freellmOn } from './freellmGateway.js';
import { config, monthStartOf, ensureTable, featuresOff, flag, killSwitchLastChange } from './aiUsage.js';
import { FEATURES, priceList, textPrices } from './aiPricing.js';
import { getRate, displayCurrency } from './fxRate.js';
import { ffmpegStatus } from './ffmpeg.js';
import { budgetUsd, videoBudgetUsd, platformDailyLimit, usesToday, creditsAllowance, creditsUsed, defaultMonthlyCredits, switchKey } from './aiGate.js';

const db = () => ensureTable();
const numSetting = (k) => { const v = getSetting(k); return v == null || v === '' ? null : Number(v); };

export const azureStatus = () => ({ key_added: !!getSetting('azure_speech_key'), key_hint: getSetting('azure_speech_key') ? `…${getSetting('azure_speech_key').slice(-4)}` : null, region: getSetting('azure_speech_region') || null });

export function saveAzure(b, by) {
  if (b.key && !/^•/.test(b.key)) {
    const key = String(b.key).trim();
    if (!/^[A-Za-z0-9]{24,100}$/.test(key)) throw bad('An Azure Speech key is letters and numbers only (32 characters is typical). Copy it from Azure portal > your Speech resource > Keys and Endpoint.');
    setSetting('azure_speech_key', key, { secret: true, by });
  }
  if ('region' in b) {
    const region = String(b.region || '').trim().toLowerCase();
    if (region && !/^[a-z0-9]{3,30}$/.test(region)) throw bad('The Azure region is a short name such as uaenorth or eastus.');
    setSetting('azure_speech_region', region || null, { by });
  }
  return azureStatus();
}
export const removeAzureKey = () => setSetting('azure_speech_key', null);

/** Which engine has been answering Ask: the last 7 days per engine and purpose, and the most recent call. Read from the ledger. */
export function askEngineActivity(now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const rows = db().prepare("SELECT provider, purpose, SUM(ok) ok, SUM(1-ok) failed, MAX(at) last_at FROM ai_usage WHERE key_owner='platform' AND feature='ask_assistant' AND at>=? GROUP BY provider, purpose ORDER BY last_at DESC").all(since);
  const last = db().prepare("SELECT provider, purpose, model, ok, at FROM ai_usage WHERE key_owner='platform' AND feature='ask_assistant' ORDER BY id DESC LIMIT 1").get() || null;
  return { days: 7, last, by_engine: rows };
}


/**
 * "Which model does what": one row per purpose with the engine and model that serve it, whether it is on, and the last call recorded in the ledger.
 * Ask chat shows the ranked chain of engines that are ready right now.
 */
export function modelMap() {
  const c = config(), g = groqStatus(), h = hordeStatus(), off = new Set(featuresOff());
  const ready = { groq: groqReady(), horde: hordeReady(), gemini: geminiAskEnabled() && !!c.key, freellmapi: freellmOn('chat') };
  const name = { groq: 'Groq', horde: 'Stable Horde', gemini: 'Gemini', freellmapi: 'FreeLLMAPI' };
  const modelOf = { groq: g.chat_model, horde: h.models.length ? h.models.join(', ') : 'chosen by the Horde', gemini: c.model, freellmapi: 'auto (FreeLLMAPI picks a free model)' };
  const chain = askOrder().filter((p) => ready[p]);
  const last = (feature, purpose = null) => db().prepare(`SELECT provider, model, ok, at FROM ai_usage WHERE key_owner='platform' AND feature=? ${purpose ? 'AND purpose=?' : ''} ORDER BY id DESC LIMIT 1`).get(...(purpose ? [feature, purpose] : [feature])) || null;
  const row = (key, purpose, engine, model, on, lastRow, note = '') => ({ key, purpose, engine, model, on: !!on, note, last: lastRow ? { at: lastRow.at, ok: !!lastRow.ok, engine: lastRow.provider, model: lastRow.model } : null });
  const askOff = off.has('ask_assistant');
  const rows = [
    row('ask_chat', 'Ask: answering questions', chain.map((p) => name[p]).join(' → ') || 'none connected', chain.length ? modelOf[chain[0]] : '—', chain.length && !askOff, last('ask_assistant', 'ask_assistant'), chain.length > 1 ? `Backups in order: ${chain.slice(1).map((p) => `${name[p]} (${modelOf[p]})`).join(', ')}` : ''),
    row('ask_image', 'Ask: questions about a picture', 'Groq', g.vision_model, ready.groq && !askOff, last('ask_assistant', 'ask_image'), ready.groq ? '' : 'Needs Groq'),
    row('ask_voice', 'Ask: speaking a question (speech to text)', ready.groq ? 'Groq' : 'Browser microphone', ready.groq ? g.stt_model : 'built into the browser', !askOff, last('ask_assistant', 'ask_voice')),
    row('ask_listen', 'Ask: Listen (read aloud)', 'Browser voice', 'built into the browser', true, null, 'Not an AI model, no cost'),
  ];
  for (const [key, f] of Object.entries(FEATURES)) {
    if (key === 'ask_assistant') continue;
    const voice = key.startsWith('video_voice');
    const azure = !!getSetting('azure_speech_key');
    const engine = voice ? 'Azure Speech' : key === 'creative_post' ? 'Gemini (images)' : key === 'creative_video' ? 'Gemini (Veo video)' : 'Gemini';
    const model = voice ? voiceFor(key.endsWith('_ur') ? 'Urdu' : 'English') : key === 'creative_post' ? imageModel() : key === 'creative_video' ? videoModel() : c.model;
    rows.push(row(key, f.label, engine, model, !off.has(switchKey(key)) && (voice ? azure : !!c.key), last(key), voice ? (azure ? '' : 'Needs an Azure Speech key') : c.key ? '' : 'Needs a Gemini key'));
  }
  rows.push(row('zernio', 'Posting to social accounts', 'Zernio', 'not an AI model', !!getSetting('zernio_api_key'), null, getSetting('zernio_api_key') ? '' : 'Uses each workspace\'s own key, or is off'));
  return rows;
}

export function overview(now = new Date()) {
  const since = monthStartOf(now), rate = getRate(), c = config();
  const pkr = (usd) => (usd == null ? null : usd * rate.rate);
  const off = new Set(featuresOff());
  const rows = db().prepare("SELECT feature, COUNT(*) uses, COALESCE(SUM(usd),0) usd, COALESCE(SUM(COALESCE(pkr, usd*?)),0) pkr, COALESCE(SUM(input_tokens),0) tin, COALESCE(SUM(output_tokens),0) tout, COALESCE(SUM(CASE WHEN unit='character' THEN units END),0) chars FROM ai_usage WHERE key_owner='platform' AND feature IS NOT NULL AND at>=? GROUP BY feature").all(rate.rate, since);
  const byF = new Map(rows.map((r) => [r.feature, r]));
  const spent = rows.reduce((a, r) => a + r.usd, 0), spentPkr = rows.reduce((a, r) => a + r.pkr, 0);
  const features = Object.entries(FEATURES).map(([key, f]) => ({ key, label: f.label, uses: byF.get(key)?.uses || 0, usd: byF.get(key)?.usd || 0, pkr: byF.get(key)?.pkr || 0, tokens_in: byF.get(key)?.tin || 0, tokens_out: byF.get(key)?.tout || 0, characters: byF.get(key)?.chars || 0, enabled: !off.has(switchKey(key)) }));
  const per = new Map(db().prepare("SELECT tenant_id, COALESCE(SUM(usd),0) usd FROM ai_usage WHERE key_owner='platform' AND tenant_id IS NOT NULL AND at>=? GROUP BY tenant_id").all(since).map((r) => [r.tenant_id, r.usd]));
  const ws = new Map(db().prepare('SELECT tenant_id, ai_enabled, platform_daily_limit FROM workspace_ai_settings').all().map((r) => [r.tenant_id, r]));
  const workspaces = db().prepare('SELECT id, name, slug, plan, status, data_deleted_at FROM tenants ORDER BY name').all().map((t) => {
    const allowance = creditsAllowance(t.id, now), used = creditsUsed(t.id, now), usd = per.get(t.id) || 0;
    return { ...t, ai_enabled: ws.get(t.id) ? !!ws.get(t.id).ai_enabled : true, usd, pkr: pkr(usd), uses_today: usesToday(t.id, now), daily_limit: platformDailyLimit(t.id), own_daily_limit: ws.get(t.id)?.platform_daily_limit ?? null,
      credits: { allowance, used, left: allowance == null ? null : Math.max(0, allowance - used) } };
  });
  const tp = textPrices();
  return {
    rate, display_currency: displayCurrency(), master: { on: !flag('ai_kill_switch'), last_change: killSwitchLastChange() }, ffmpeg: ffmpegStatus(),
    month: { spent_usd: spent, spent_pkr: spentPkr, budget_usd: budgetUsd(), video_budget_usd: videoBudgetUsd(), video_spent_usd: byF.get('creative_video')?.usd || 0 },
    features, prices: priceList(now), text_price_source: tp.source, workspaces,
    limits: { platform_daily_limit: numSetting('ai_platform_daily_limit'), platform_daily_limit_effective: platformDailyLimit(null), default_monthly_credits: defaultMonthlyCredits() },
    technical: {
      gemini: { added: !!c.key, key_hint: c.key ? `…${c.key.slice(-4)}` : null, text_model: c.model },
      azure: azureStatus(),
      stablehorde: hordeStatus(),
      groq: groqStatus(),
      freellm: freellmStatus(),
      ask_order: askOrder(),
      model_map: modelMap(),
      ask_activity: { ...askEngineActivity(now), last_errors: engineErrors() },
      models: Object.entries(FEATURES).map(([key, f]) => ({ key, label: f.label, model: key.startsWith('video_voice') ? `Azure Speech (${voiceFor(key.endsWith('_ur') ? 'Urdu' : 'English')})` : key === 'creative_post' ? `Gemini image model (${imageModel()})` : key === 'creative_video' ? `Gemini Veo (${videoModel()})` : c.model })),
    },
    reported: listReports({ handled: false, limit: 50 }), reported_open: openReportCount(),
  };
}

// ---- video voices (console): the English and Urdu voice, a connection test and a Hear it preview
export const voicesView = () => ({ selected: { English: voiceFor('English'), Urdu: voiceFor('Urdu') }, defaults: DEFAULT_VOICES, azure: azureStatus() });
export async function testAzure(by) {
  const voices = await azureTest();
  audit(by, 'ai-azure-tested', {});
  return { ok: true, voices, ...voicesView() };
}
const VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;
export function saveVoices(b, by) {
  for (const [k, slot, loc] of [['English', 'azure_voice_en', 'en-'], ['Urdu', 'azure_voice_ur', 'ur-']]) {
    if (!(k in b)) continue;
    const v = String(b[k] || '').trim();
    if (v && (!VOICE.test(v) || !v.startsWith(loc))) throw bad(`Choose a ${k} voice from the list.`);
    setSetting(slot, v || null, { by });
  }
  return voicesView();
}
/** A short sample of a voice, as base64 mp3. Counts as a platform use (voice characters) with no workspace. */
export async function previewVoice(lang, voice) {
  const l = lang === 'Urdu' ? 'Urdu' : 'English';
  const mp3 = await azureSpeak({ lang: l, text: SAMPLE_TEXT[l], voice: voice || undefined });
  return { audio: mp3.toString('base64'), mime: 'audio/mpeg' };
}
