import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-aigw-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345' });

const gw = await import('../src/services/aiGateway.js');
const pricing = await import('../src/services/aiPricing.js');
const fx = await import('../src/services/fxRate.js');
const aiu = await import('../src/services/aiUsage.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const { platformDb } = await import('../src/platform.js');

const realFetch = globalThis.fetch; let calls = [];
before(() => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push(u);
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 281.5 } }), { status: 200 });
    if (u.includes(':generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 } }), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  };
});
after(() => { globalThis.fetch = realFetch; });

test('ai_usage gains the metering columns and old rows stay valid', () => {
  aiu.ensureTable();
  const cols = platformDb().prepare('PRAGMA table_info(ai_usage)').all().map((c) => c.name);
  for (const c of ['feature', 'user_id', 'unit', 'units', 'usd', 'usd_pkr', 'pkr']) assert.ok(cols.includes(c), c);
  aiu.record({ keyOwner: 'tenant', provider: 'gemini', purpose: 'old', tokens: { input: 5, output: 5 } });
  assert.equal(platformDb().prepare("SELECT usd FROM ai_usage WHERE purpose='old'").get().usd, null);
});

test('the gateway needs a key, then meters a call in dollars and rupees', async () => {
  await assert.rejects(gw.geminiGenerate({ feature: 'content_draft', body: {} }), /Connect Gemini/);
  setSetting('platform_gemini_key', 'AIza' + 'x'.repeat(35), { secret: true });
  fx.saveFxSettings({ live: false, manual_rate: 300 }, 'test');
  await gw.geminiGenerate({ feature: 'ask_assistant', purpose: 'ask', tenantId: null, userId: 7, body: { contents: [] } });
  const r = platformDb().prepare("SELECT * FROM ai_usage WHERE feature='ask_assistant'").get();
  assert.equal(r.key_owner, 'platform'); assert.equal(r.user_id, 7); assert.equal(r.unit, 'call');
  const expected = (1000 / 1e6) * 0.3 + (500 / 1e6) * 2.5;
  assert.ok(Math.abs(r.usd - expected) < 1e-9);
  assert.equal(r.usd_pkr, 300); assert.ok(Math.abs(r.pkr - expected * 300) < 1e-9);
  assert.ok(!JSON.stringify(r).includes('AIza'), 'the key is never recorded');
});

test('price list: defaults, then the 3-month average, then a manual pin', () => {
  assert.equal(pricing.unitPrice('creative_post').source, 'default');
  const ins = platformDb().prepare("INSERT INTO ai_usage(at,key_owner,provider,purpose,feature,unit,units,usd,ok) VALUES(?,?,?,?,?,?,?,?,1)");
  for (let i = 0; i < 12; i += 1) ins.run(new Date().toISOString(), 'platform', 'gemini', 'x', 'creative_post', 'image', 2, 0.1);
  const avg = pricing.unitPrice('creative_post');
  assert.equal(avg.source, 'average'); assert.ok(Math.abs(avg.usd - 0.05) < 1e-9);
  pricing.setOverride('creative_post', 0.07, 'test');
  assert.equal(pricing.unitPrice('creative_post').usd, 0.07);
  pricing.setOverride('creative_post', '', 'test');
  assert.equal(pricing.unitPrice('creative_post').source, 'average');
  assert.throws(() => pricing.setOverride('creative_post', -1), /number of US dollars/);
  assert.ok(Math.abs(pricing.costUsd({ feature: 'creative_video', unit: 'video_second', units: 8 }) - 3.2) < 1e-9);
});

test('USD to PKR rate: live, manual override, fallback, and bad input', async () => {
  fx.saveFxSettings({ live: true, manual_rate: '' }, 'test');
  assert.equal(fx.getRate().source, 'fallback');
  assert.equal(await fx.refreshLive(), 281.5);
  const live = fx.getRate(); assert.equal(live.source, 'live'); assert.equal(live.rate, 281.5); assert.ok(live.updated_at);
  fx.saveFxSettings({ live: false, manual_rate: 290 }, 'test');
  assert.equal(fx.getRate().rate, 290); assert.equal(fx.getRate().source, 'manual');
  assert.throws(() => fx.saveFxSettings({ manual_rate: -5 }, "test"), /rupees/);
});
