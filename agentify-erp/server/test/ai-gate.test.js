import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-aigate-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345' });

const gate = await import('../src/services/aiGate.js');
const gw = await import('../src/services/aiGateway.js');
const aiu = await import('../src/services/aiUsage.js');
const fx = await import('../src/services/fxRate.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const { platformDb } = await import('../src/platform.js');

const realFetch = globalThis.fetch; let fetched = 0;
before(() => { globalThis.fetch = async (url) => { fetched += 1; if (String(url).includes(':generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 } }), { status: 200 }); throw new Error('no'); }; });
after(() => { globalThis.fetch = realFetch; });

const code = (fn) => { try { fn(); return null; } catch (e) { return e.extra?.code ?? e.code ?? e.message; } };
let T;
const reset = () => { for (const k of ['ai_kill_switch', 'ai_features_off', 'ai_budget_usd_month', 'ai_budget_month', 'ai_video_budget_usd_month', 'ai_platform_daily_limit', 'ai_default_monthly_credits']) setSetting(k, null); platformDb().exec('DELETE FROM ai_usage; DELETE FROM workspace_ai_settings; DELETE FROM ai_tenant_credits'); };

test('checks run in order: master, feature, workspace, daily, budget, video, credits', () => {
  aiu.ensureTable();
  const db = platformDb();
  db.prepare("INSERT INTO tenants(slug, name, plan, db_file, upload_dir, subscription_status, owner_email) VALUES('gate','Gate','growth','x.db','x','active','o@gate.test')").run();
  T = db.prepare("SELECT id FROM tenants WHERE slug='gate'").get().id;
  reset();
  const ok = (extra = {}) => code(() => gate.assertPlatformAllowed({ feature: 'creative_post', tenantId: T, ...extra }));
  assert.equal(ok(), null);
  setSetting('ai_kill_switch', '1'); assert.equal(ok(), 'ai_off'); reset();
  setSetting('ai_features_off', JSON.stringify(['creative_post'])); assert.equal(ok(), 'feature_off');
  assert.equal(code(() => gate.assertPlatformAllowed({ feature: 'brand_story', tenantId: T })), null, 'other features still work'); reset();
  aiu.saveWorkspaceAi(T, { ai_enabled: false }, 't'); assert.equal(ok(), 'tenant_off'); reset();
  // daily limit: default 300, per-workspace override, counts platform uses only, resets with the day
  aiu.saveWorkspaceAi(T, { platform_daily_limit: 2 }, 't');
  const ins = db.prepare("INSERT INTO ai_usage(at,key_owner,provider,purpose,tenant_id,feature,usd,ok) VALUES(?,?,?,?,?,?,?,1)");
  ins.run(new Date().toISOString(), 'tenant', 'gemini', 'x', T, null, null); // own-key call does not count
  ins.run(new Date().toISOString(), 'platform', 'gemini', 'x', T, 'creative_post', 0.01);
  assert.equal(ok(), null);
  ins.run(new Date().toISOString(), 'platform', 'gemini', 'x', T, 'creative_post', 0.01);
  assert.equal(ok(), 'daily_limit');
  assert.equal(ok({ now: new Date(Date.now() + 86400_000) }), null, 'resets tomorrow');
  assert.equal(gate.platformDailyLimit(null), 300); reset();
  // monthly budget stops everyone, the console (no workspace) too
  setSetting('ai_budget_usd_month', '0.05');
  ins.run(new Date().toISOString(), 'platform', 'gemini', 'x', T, 'creative_post', 0.05);
  assert.equal(ok(), 'budget_reached');
  assert.equal(code(() => gate.assertPlatformAllowed({ feature: 'content_draft' })), 'budget_reached');
  assert.equal(ok({ now: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 2)) }), null, 'new month'); reset();
  // video budget is separate: images still work when it is used up
  setSetting('ai_video_budget_usd_month', '1');
  ins.run(new Date().toISOString(), 'platform', 'gemini', 'x', T, 'creative_video', 1);
  assert.equal(code(() => gate.assertPlatformAllowed({ feature: 'creative_video', tenantId: T })), 'video_budget_reached');
  assert.equal(ok(), null); reset();
  // credits
  assert.equal(ok({ credits: 5 }), null, 'no allowance set = no credit limit yet');
  gate.setCredits(T, { monthly_credits: 10 }, 't');
  assert.equal(ok({ credits: 5 }), null);
  platformDb().prepare("INSERT INTO ai_usage(at,key_owner,provider,purpose,tenant_id,feature,credits,ok) VALUES(?,?,?,?,?,?,?,1)").run(new Date().toISOString(), 'platform', 'gemini', 'x', T, 'creative_post', 8);
  assert.equal(gate.creditsLeft(T), 2);
  assert.equal(ok({ credits: 5 }), 'no_credits');
  gate.setCredits(T, { add_topup: 20 }, 't');
  assert.equal(gate.creditsLeft(T), 22); assert.equal(ok({ credits: 5 }), null);
  assert.throws(() => gate.setCredits(T, { add_topup: -1 }, 't'), /whole number/);
  reset();
});

test('the gateway refuses before calling Google and records credits when a call is made', async () => {
  reset();
  setSetting('platform_gemini_key', 'AIza' + 'x'.repeat(35), { secret: true });
  fx.saveFxSettings({ live: false, manual_rate: 300 }, 't');
  setSetting('ai_kill_switch', '1');
  fetched = 0;
  await assert.rejects(gw.geminiGenerate({ feature: 'ask_assistant', tenantId: T, body: {} }), /switched off for everyone/);
  assert.equal(fetched, 0, 'nothing was sent to Google');
  assert.equal(platformDb().prepare('SELECT COUNT(*) n FROM ai_usage').get().n, 0, 'a refusal is not logged as usage');
  reset();
  gate.setCredits(T, { monthly_credits: 3 }, 't');
  await gw.geminiGenerate({ feature: 'brand_story', tenantId: T, credits: 2, body: {} });
  assert.equal(gate.creditsLeft(T), 1);
  await assert.rejects(gw.geminiGenerate({ feature: 'brand_story', tenantId: T, credits: 2, body: {} }), /credits/);
  // the controls API values validate
  assert.throws(() => aiu.saveControls({ budget_usd_month: -1 }, 't'), /US dollars/);
  aiu.saveControls({ budget_usd_month: 25, video_budget_usd_month: 10, platform_daily_limit: 300 }, 't');
  assert.equal(gate.budgetUsd(), 25); assert.equal(gate.videoBudgetUsd(), 10);
  reset();
});

test('a suspended or cancelled workspace is refused by the gate', () => {
  const db = platformDb();
  reset();
  const ok = () => code(() => gate.assertPlatformAllowed({ feature: 'creative_post', tenantId: T }));
  assert.equal(ok(), null);
  db.prepare("UPDATE tenants SET status='cancelled' WHERE id=?").run(T);
  assert.equal(ok(), 'tenant_inactive');
  assert.ok(code(() => aiu.assertAiAllowed(T)), 'own-key path refuses too');
  db.prepare("UPDATE tenants SET status='active' WHERE id=?").run(T);
  assert.equal(ok(), null);
});
