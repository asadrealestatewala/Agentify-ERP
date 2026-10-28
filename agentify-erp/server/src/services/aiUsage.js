// AI usage ledger and the platform's own Gemini connection (Super Admin console > AI usage & credits).
// Every model call that reports token counts is recorded: calls made with Agentify's own key ("platform") and calls made with a
// workspace's own key ("tenant", paid for by that workspace, shown for information only). Money figures are ESTIMATES from the
// per-million-token prices the owner enters; there are no built-in prices, because provider pricing changes and differs by model.
// Gemini has no balance endpoint, so "credits left" is the owner's monthly budget minus the estimated spend recorded here.
import { platformDb } from '../platform.js';
import { getSetting, setSetting } from './platformConfig.js';
import { currentTenant } from '../context.js';
import { bad } from '../util.js';
import { AI_PROVIDERS, testAi, setUsageSink } from '../integrations/ai.js';

const SCHEMA = `CREATE TABLE IF NOT EXISTS ai_usage(
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, key_owner TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, purpose TEXT NOT NULL,
  tenant_id INTEGER, plan TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, admin TEXT);
CREATE INDEX IF NOT EXISTS idx_ai_usage_at ON ai_usage(at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant ON ai_usage(tenant_id, at);`;
let ready = false;
const db = () => { const d = platformDb(); if (!ready) { d.exec(SCHEMA); ready = true; } return d; };

/** Token counts out of a provider response; null when it reports none. */
export function tokensOf(provider, d) {
  if (provider === 'anthropic' && d?.usage) return { input: d.usage.input_tokens || 0, output: d.usage.output_tokens || 0 };
  if (provider === 'gemini' && d?.usageMetadata) return { input: d.usageMetadata.promptTokenCount || 0, output: (d.usageMetadata.candidatesTokenCount || 0) + (d.usageMetadata.thoughtsTokenCount || 0) };
  if (d?.usage && (provider === 'openai' || provider === 'custom')) return { input: d.usage.prompt_tokens || 0, output: d.usage.completion_tokens || 0 };
  return null;
}
export function record({ keyOwner, provider, model, purpose, tenantId = null, tokens, ok = true, admin = null }) {
  try {
    const t = tenantId ? db().prepare('SELECT plan FROM tenants WHERE id=?').get(tenantId) : null;
    db().prepare('INSERT INTO ai_usage(at, key_owner, provider, model, purpose, tenant_id, plan, input_tokens, output_tokens, ok, admin) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(new Date().toISOString(), keyOwner, provider, model || null, purpose, tenantId, t?.plan || null, tokens?.input || 0, tokens?.output || 0, ok ? 1 : 0, admin);
  } catch { /* metering must never break the feature it measures */ }
}
// calls made inside a workspace with the workspace's own key
setUsageSink(({ provider, model, d, purpose }) => { const tokens = tokensOf(provider, d); if (tokens) record({ keyOwner: 'tenant', provider, model, purpose: purpose || 'workspace_ai', tenantId: currentTenant()?.id || null, tokens }); });

// ---- platform Gemini connection and budget
const num = (k) => { const v = getSetting(k); return v == null || v === '' ? null : Number(v); };
export function config() {
  return { key: getSetting('platform_gemini_key'), model: getSetting('platform_gemini_model') || AI_PROVIDERS.gemini.default_model,
    budget: num('ai_budget_month'), price_in: num('ai_price_in_per_m'), price_out: num('ai_price_out_per_m'), currency: getSetting('ai_money_label') || 'USD', draft_cap: num('ai_draft_daily_cap') ?? 20 };
}
export function settingsView() {
  const c = config();
  return { connected: !!c.key, key_hint: c.key ? `…${c.key.slice(-4)}` : null, model: c.model, budget_month: c.budget, price_in_per_m: c.price_in, price_out_per_m: c.price_out, currency: c.currency, draft_daily_cap: c.draft_cap, provider_label: AI_PROVIDERS.gemini.label };
}
const money = (v, label, max = 1e7) => { if (v === '' || v == null) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > max) throw bad(`${label} must be a number of zero or more`); return n; };
export async function saveSettings(b, by) {
  if (b.api_key && !/^•/.test(b.api_key)) {
    const key = String(b.api_key).trim();
    try { await testAi('gemini', key); } catch (e) { throw bad(`Google did not accept this key: ${e.message}`); }
    setSetting('platform_gemini_key', key, { secret: true, by });
  }
  const model = String(b.model || '').trim().slice(0, 80);
  if (b.model !== undefined) setSetting('platform_gemini_model', model || null, { by });
  const set = (k, v) => setSetting(k, v == null ? null : String(v), { by });
  if ('budget_month' in b) set('ai_budget_month', money(b.budget_month, 'Monthly budget'));
  if ('price_in_per_m' in b) set('ai_price_in_per_m', money(b.price_in_per_m, 'Input price', 100000));
  if ('price_out_per_m' in b) set('ai_price_out_per_m', money(b.price_out_per_m, 'Output price', 100000));
  if ('currency' in b) set('ai_money_label', String(b.currency || '').trim().slice(0, 6) || null);
  if ('draft_daily_cap' in b) { const n = Number(b.draft_daily_cap); if (!Number.isInteger(n) || n < 0 || n > 1000) throw bad('Daily AI draft limit must be a whole number from 0 to 1000'); set('ai_draft_daily_cap', n); }
  return settingsView();
}
export const disconnect = () => setSetting('platform_gemini_key', null);

// ---- reporting
const cost = (inp, out, c) => (c.price_in == null || c.price_out == null ? null : (inp / 1e6) * c.price_in + (out / 1e6) * c.price_out);
const monthStart = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
export function platformMonth(now = new Date()) {
  const c = config();
  const r = db().prepare("SELECT COUNT(*) calls, COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o FROM ai_usage WHERE key_owner='platform' AND at>=?").get(monthStart(now));
  const spent = cost(r.i, r.o, c);
  return { calls: r.calls, input_tokens: r.i, output_tokens: r.o, spent, budget: c.budget, left: c.budget != null && spent != null ? Math.max(0, c.budget - spent) : null, over: c.budget != null && spent != null && spent >= c.budget };
}
export function report(now = new Date()) {
  const c = config();
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const rows = (sql, ...a) => db().prepare(sql).all(...a);
  const withCost = (r) => ({ ...r, est_cost: r.key_owner === 'tenant' ? null : cost(r.input_tokens, r.output_tokens, c) });
  const agg = 'COUNT(*) calls, COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(output_tokens),0) output_tokens';
  const owners = Object.fromEntries(rows(`SELECT key_owner, ${agg} FROM ai_usage WHERE at>=? GROUP BY key_owner`, since).map((r) => [r.key_owner, withCost(r)]));
  const byTenant = rows(`SELECT u.key_owner, u.tenant_id, t.name, t.slug, t.plan AS current_plan, COUNT(u.id) calls, COALESCE(SUM(u.input_tokens),0) input_tokens, COALESCE(SUM(u.output_tokens),0) output_tokens
    FROM ai_usage u LEFT JOIN tenants t ON t.id=u.tenant_id WHERE u.at>=? GROUP BY u.key_owner, u.tenant_id ORDER BY (COALESCE(SUM(u.input_tokens),0)+COALESCE(SUM(u.output_tokens),0)) DESC LIMIT 200`, since).map(withCost);
  const byPlan = rows(`SELECT key_owner, COALESCE(plan,'(none)') plan, COUNT(DISTINCT tenant_id) tenants, ${agg} FROM ai_usage WHERE at>=? GROUP BY key_owner, COALESCE(plan,'(none)') ORDER BY (input_tokens+output_tokens) DESC`, since).map(withCost);
  const byPurpose = rows(`SELECT key_owner, purpose, ${agg} FROM ai_usage WHERE at>=? GROUP BY key_owner, purpose ORDER BY (input_tokens+output_tokens) DESC`, since).map(withCost);
  const daily = rows(`SELECT substr(at,1,10) day, key_owner, COALESCE(SUM(input_tokens+output_tokens),0) tokens FROM ai_usage WHERE at>=? GROUP BY day, key_owner ORDER BY day`, since);
  return { period_days: 30, settings: settingsView(), month: platformMonth(now), owners, by_tenant: byTenant, by_plan: byPlan, by_purpose: byPurpose, daily,
    notes: { estimate: c.price_in == null || c.price_out == null ? 'Enter the provider prices per million tokens in AI settings to see estimated cost and credits left.' : 'Costs are estimates from the prices you entered, not the provider invoice.', tenant_keys: 'Calls made with a workspace\'s own AI key are paid by that workspace and are not Agentify cost.' } };
}

// ---- the platform's own Gemini call (post drafts)
const draftsToday = (now = new Date()) => db().prepare("SELECT COUNT(*) n FROM ai_usage WHERE key_owner='platform' AND purpose='content_draft' AND at>=?").get(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()).n;
export const aiStatus = () => { const c = config(); return { connected: !!c.key, drafts_left_today: c.key ? Math.max(0, c.draft_cap - draftsToday()) : 0, daily_cap: c.draft_cap }; };

const SYSTEM = 'You write short social media posts for Agentify ERP, a CRM and ERP for real estate and construction companies. Use only the facts in the brief. Never invent statistics, customer names, testimonials, prices, awards, partnerships, deadlines or features. No hashtags unless asked. Reply with JSON only: {"title": "short internal title", "body": "the post text"}.';
export async function draftPost({ channel, topic, tone, language }, admin) {
  const c = config();
  if (!c.key) throw bad('Connect Gemini first (AI usage & credits > AI settings).');
  const t = String(topic || '').trim();
  if (t.length < 10) throw bad('Describe what the post should say in at least a sentence.');
  if (t.length > 1500) throw bad('The brief is too long (1500 characters at most)');
  if (draftsToday() >= c.draft_cap) throw bad(`The daily limit of ${c.draft_cap} AI drafts is used. Try again tomorrow or ask a Super Admin to raise it.`);
  const m = platformMonth();
  if (m.over) throw bad('This month\'s AI budget is used up. A Super Admin can raise it under AI settings.');
  const prompt = `Channel: ${String(channel || 'social').slice(0, 30)}\nTone: ${String(tone || 'clear and friendly').slice(0, 60)}\nLanguage: ${String(language || 'English').slice(0, 40)}\nBrief: ${t}`;
  let d;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': c.key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1200 } }) });
    d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error?.message || `Google answered ${res.status}`);
  } catch (e) { record({ keyOwner: 'platform', provider: 'gemini', model: c.model, purpose: 'content_draft', ok: false, admin }); throw bad(`Gemini could not write the draft: ${e.message}`); }
  record({ keyOwner: 'platform', provider: 'gemini', model: c.model, purpose: 'content_draft', tokens: tokensOf('gemini', d), admin });
  const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  let out; try { out = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || ''); } catch { out = null; }
  if (!out?.body) throw bad('Gemini did not return a usable draft. Try again with a clearer brief.');
  return { title: String(out.title || t).slice(0, 140), body: String(out.body).slice(0, 3000) };
}
