// AI price list: what one use of each feature costs, in US dollars. Defaults are conservative published-price estimates for
// Gemini/Azure; once a feature has enough real platform usage the average of the last 3 months replaces the default.
// The owner can also pin a price by hand (ai_prices.override_usd), which always wins.
import { getSetting } from './platformConfig.js';
import { ensureTable } from './aiUsage.js';
import { bad } from '../util.js';

/** unit = what `units` counts in ai_usage; per = the human label for one priced use. */
export const FEATURES = {
  ask_assistant: { label: 'Ask assistant', unit: 'call', per: 'one question', usd: 0.002 },
  creative_post: { label: 'Creative posts', unit: 'image', per: 'one post image', usd: 0.04 },
  creative_video: { label: 'Creative videos', unit: 'video_second', per: 'one second of video', usd: 0.4 },
  video_voice_en: { label: 'Video voice (English)', unit: 'character', per: '1,000 characters', usd: 0.016, scale: 1000 },
  video_voice_ur: { label: 'Video voice (Urdu)', unit: 'character', per: '1,000 characters', usd: 0.016, scale: 1000 },
  brand_story: { label: 'Brand stories', unit: 'call', per: 'one brand story', usd: 0.01 },
  translation: { label: 'Translation', unit: 'call', per: 'one translation', usd: 0.003 },
  content_draft: { label: 'Agentify post drafts', unit: 'call', per: 'one draft', usd: 0.003 },
};
export const MIN_SAMPLE = 10;
const TEXT_DEFAULT = { in: 0.3, out: 2.5 }; // Gemini 2.5 Flash, USD per million tokens

/** Gemini text price per million tokens: the owner's entered prices when set, else the defaults. */
export function textPrices() {
  const n = (k) => { const v = getSetting(k); return v == null || v === '' ? null : Number(v); };
  const usdLabel = (getSetting('ai_money_label') || 'USD').toUpperCase() === 'USD';
  const i = n('ai_price_in_per_m'), o = n('ai_price_out_per_m');
  return usdLabel && i != null && o != null ? { in: i, out: o, source: 'owner' } : { ...TEXT_DEFAULT, source: 'default' };
}

const db = () => ensureTable();
const overrides = () => new Map(db().prepare('SELECT feature, override_usd FROM ai_prices WHERE override_usd IS NOT NULL').all().map((r) => [r.feature, r.override_usd]));

/** USD per priced use for a feature: { usd, source: 'override' | 'average' | 'default', sample }. */
export function unitPrice(feature, now = new Date()) {
  const f = FEATURES[feature]; if (!f) return null;
  const ov = overrides().get(feature);
  if (ov != null) return { usd: ov, source: 'override', sample: 0 };
  const since = new Date(now.getTime() - 92 * 86400_000).toISOString();
  const r = db().prepare("SELECT COUNT(*) calls, COALESCE(SUM(usd),0) usd, COALESCE(SUM(units),0) units FROM ai_usage WHERE key_owner='platform' AND ok=1 AND feature=? AND usd IS NOT NULL AND at>=?").get(feature, since);
  if (r.calls >= MIN_SAMPLE) {
    const per = f.unit === 'call' ? r.usd / r.calls : r.units > 0 ? (r.usd / r.units) * (f.scale || 1) : null;
    if (per != null && per > 0) return { usd: per, source: 'average', sample: r.calls };
  }
  return { usd: f.usd, source: 'default', sample: r.calls };
}
export const priceList = (now) => Object.entries(FEATURES).map(([key, f]) => ({ key, label: f.label, per: f.per, ...unitPrice(key, now) }));

/** Cost in USD of a metered call, from tokens (text) or units (image, video second, character). Uses the feature's current price. */
export function costUsd({ feature, unit = 'call', units = 0, tokens }) {
  if (tokens) { const p = textPrices(); return (tokens.input / 1e6) * p.in + (tokens.output / 1e6) * p.out; }
  const f = FEATURES[feature]; if (!f) return null;
  const price = unitPrice(feature).usd;
  if (unit === 'call') return price;
  return (price / (f.scale || 1)) * units;
}

export function setOverride(feature, value, by) {
  if (!FEATURES[feature]) throw bad('Unknown AI feature');
  let v = null;
  if (value !== '' && value != null) { v = Number(value); if (!Number.isFinite(v) || v < 0 || v > 1000) throw bad('The price must be a number of US dollars from 0 to 1000'); }
  db().prepare(`INSERT INTO ai_prices(feature, override_usd, updated_by, updated_at) VALUES(?,?,?,datetime('now'))
    ON CONFLICT(feature) DO UPDATE SET override_usd=excluded.override_usd, updated_by=excluded.updated_by, updated_at=datetime('now')`).run(feature, v, by || null);
  return priceList();
}
