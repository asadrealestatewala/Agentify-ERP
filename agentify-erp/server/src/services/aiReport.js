// Figures and settings for the console's AI page that concern Agentify's OWN key: cost per feature and workspace in USD and rupees,
// the price list, limits, credits, the dollar rate and the provider connections. Reads the ledger written by aiGateway.js.
import { getSetting, setSetting, audit } from './platformConfig.js';
import { bad } from '../util.js';
import { listReports, openReportCount } from './aiReports.js';
import { imageModel, videoModel, voiceFor, azureTest, azureSpeak, DEFAULT_VOICES, SAMPLE_TEXT } from './aiGateway.js';
import { config, monthStartOf, ensureTable, featuresOff } from './aiUsage.js';
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

export function overview(now = new Date()) {
  const since = monthStartOf(now), rate = getRate(), c = config();
  const pkr = (usd) => (usd == null ? null : usd * rate.rate);
  const off = new Set(featuresOff());
  const rows = db().prepare("SELECT feature, COUNT(*) uses, COALESCE(SUM(usd),0) usd FROM ai_usage WHERE key_owner='platform' AND feature IS NOT NULL AND at>=? GROUP BY feature").all(since);
  const byF = new Map(rows.map((r) => [r.feature, r]));
  const spent = rows.reduce((a, r) => a + r.usd, 0);
  const features = Object.entries(FEATURES).map(([key, f]) => ({ key, label: f.label, uses: byF.get(key)?.uses || 0, usd: byF.get(key)?.usd || 0, pkr: pkr(byF.get(key)?.usd || 0), enabled: !off.has(switchKey(key)) }));
  const per = new Map(db().prepare("SELECT tenant_id, COALESCE(SUM(usd),0) usd FROM ai_usage WHERE key_owner='platform' AND tenant_id IS NOT NULL AND at>=? GROUP BY tenant_id").all(since).map((r) => [r.tenant_id, r.usd]));
  const ws = new Map(db().prepare('SELECT tenant_id, ai_enabled, platform_daily_limit FROM workspace_ai_settings').all().map((r) => [r.tenant_id, r]));
  const workspaces = db().prepare('SELECT id, name, slug, plan FROM tenants ORDER BY name').all().map((t) => {
    const allowance = creditsAllowance(t.id, now), used = creditsUsed(t.id, now), usd = per.get(t.id) || 0;
    return { ...t, ai_enabled: ws.get(t.id) ? !!ws.get(t.id).ai_enabled : true, usd, pkr: pkr(usd), uses_today: usesToday(t.id, now), daily_limit: platformDailyLimit(t.id), own_daily_limit: ws.get(t.id)?.platform_daily_limit ?? null,
      credits: { allowance, used, left: allowance == null ? null : Math.max(0, allowance - used) } };
  });
  const tp = textPrices();
  return {
    rate, display_currency: displayCurrency(), ffmpeg: ffmpegStatus(),
    month: { spent_usd: spent, spent_pkr: pkr(spent), budget_usd: budgetUsd(), video_budget_usd: videoBudgetUsd(), video_spent_usd: byF.get('creative_video')?.usd || 0 },
    features, prices: priceList(now), text_price_source: tp.source, workspaces,
    limits: { platform_daily_limit: numSetting('ai_platform_daily_limit'), platform_daily_limit_effective: platformDailyLimit(null), default_monthly_credits: defaultMonthlyCredits() },
    technical: {
      gemini: { added: !!c.key, key_hint: c.key ? `…${c.key.slice(-4)}` : null, text_model: c.model },
      azure: azureStatus(),
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
