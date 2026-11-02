# AI gateway, usage ledger and pricing (Stage 1)

* **One door.** `server/src/services/aiGateway.js` is the only code that calls Gemini with Agentify's own (platform) key. It reads the encrypted key from `platform_settings`, calls Google, and writes one `ai_usage` row. Keys never reach the browser or the logs. Calls made with a workspace's own key still use `integrations/ai.js` and keep their current limits (the workspace pays).
* **Ledger.** `ai_usage` gained nullable columns: `feature, user_id, unit, units, usd, usd_pkr, pkr` (added in `services/aiUsage.js`, `db()`; old rows stay valid). Index `idx_ai_usage_feature(feature, at)`. New table `ai_prices(feature, override_usd, updated_by, updated_at)`.
* **Price list.** `services/aiPricing.js`. Order: manual pin, else average of the last 92 days of platform usage once a feature has 10+ successful calls, else a built-in default (USD). Text calls are costed from tokens (owner-entered prices when set in USD, else Gemini 2.5 Flash defaults 0.30 / 2.50 per million).
* **Rupees.** `services/fxRate.js`: live USD to PKR from open.er-api.com (refreshed in the background at most once a day, stored in `fx_rates` with source `live`), a manual override, and a flagged fallback of 280. PKR is display only; providers bill in USD.
* **Not yet (Stage 2+):** the gatekeeper at `gate()` in the gateway (switches, daily limit 300, budgets, video cap, credits), image/video/Azure calls, console screens.

## Stage 2: the gatekeeper (`services/aiGate.js`)
Runs inside the gateway before every platform-key call, in this order (refusal codes in brackets):
1. master kill switch `ai_kill_switch` [`ai_off`]; 2. feature switch from `ai_features_off` [`feature_off`] (both voices share `video_voice`);
3. workspace switch `workspace_ai_settings.ai_enabled` [`tenant_off`]; 4. daily uses per workspace, default 300, override `workspace_ai_settings.platform_daily_limit`, default setting `ai_platform_daily_limit`, resets at midnight UTC [`daily_limit`];
5. monthly budget in USD, setting `ai_budget_usd_month` (falls back to `ai_budget_month` when its label is USD); unset = no cap [`budget_reached`];
6. video budget `ai_video_budget_usd_month` [`video_budget_reached`] and Creative Studio credits (`ai_tenant_credits`: monthly allowance or `ai_default_monthly_credits`, plus this month's top-up; used credits are summed from `ai_usage.credits`) [`no_credits`].
Refusals are not logged as usage. The call that crosses a budget completes; the next is refused. Workspaces using their own key are governed only by `assertAiAllowed` as before. Console calls (no workspace) skip the workspace checks. New columns: `ai_usage.credits`, `workspace_ai_settings.platform_daily_limit`; new table `ai_tenant_credits`. Values are saved through the existing `PUT /api/platform/ai/controls` (`budget_usd_month`, `video_budget_usd_month`, `platform_daily_limit`, `default_monthly_credits`) and `PUT /api/platform/ai/workspaces/:id` (`platform_daily_limit`).
