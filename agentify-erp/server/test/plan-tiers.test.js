import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Content tiers: plan caps (credits per country, posts, reel length), the margin view (fees, tax, commission, flags) and the launch offer (on/off, then normal price).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-tiers-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', ERP_MAIL_QUIET: '1', ERP_SECRETS_KEY: 'test-secrets-key-0123456789', BILLING_PROVIDER: 'manual' });

const { platformDb, createTenant, getTenantBySlug } = await import('../src/platform.js');
const { PLANS, billingState, planCatalog } = await import('../src/services/plans.js');
const { savePlan, cleanAllowances, listPlans } = await import('../src/services/plansStore.js');
const { creditsAllowance, setCredits } = await import('../src/services/aiGate.js');
const { quote } = await import('../src/services/commerce.js');
const { getOffer, saveOffer, publicOffer, activeOffer, offerFor } = await import('../src/services/launchOffer.js');
const { marginReport, saveMarginSettings, getMarginSettings } = await import('../src/services/planMargin.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const db = platformDb();
after(async () => { (await import('../src/db.js')).closeDbs(); });

const mk = (slug, region, plan = 'tier2') => {
  createTenant({ slug, name: slug, adminName: 'Owner', adminEmail: `o@${slug}.test`, adminPassword: 'Secret@12345', region });
  db.prepare("UPDATE tenants SET plan=?, subscription_status='active', current_period_end='2999-01-01' WHERE slug=?").run(plan, slug);
  return getTenantBySlug(slug);
};
const pay = (tenantId, createdAt) => db.prepare("INSERT INTO invoices(tenant_id,provider_invoice_id,amount,currency,status,created_at) VALUES(?,?,?,?,'paid',?)").run(tenantId, `inv-${Math.random()}`, 1, 'PKR', createdAt);

test('the three tiers are seeded once as hidden plans with prices in four currencies and email caps', () => {
  for (const id of ['tier1', 'tier2', 'tier3']) {
    const p = PLANS[id];
    assert.ok(p, id);
    assert.equal(p.visible, false);
    for (const cur of ['PKR', 'USD', 'GBP', 'CAD']) { assert.ok(p.price[cur].month > 0 && p.price[cur].year > 0, `${id} ${cur}`); }
    assert.ok(p.email_limits.marketing.monthly > 0);
  }
  assert.equal(PLANS.tier2.price.PKR.month, 9500);
  assert.equal(PLANS.tier3.price.GBP.month, 119);
  assert.equal(PLANS.tier1.allowances.reel_seconds, 8);
  assert.ok(!planCatalog().some((p) => p.id.startsWith('tier')), 'hidden plans are not on the public catalog');
  assert.ok(PLANS.starter && PLANS.growth, 'existing plans are untouched');
});

test('plan caps: credits come from the plan in the workspace currency, an own override wins, other plans stay uncapped', () => {
  const pk = mk('pkshop', 'PK'), us = mk('usshop', 'US'), old = mk('oldshop', 'PK', 'growth');
  assert.equal(billingState(pk).limits.credits, 400);
  assert.equal(billingState(us).limits.credits, 900);
  assert.equal(billingState(pk).limits.posts_per_day, 6);
  assert.equal(billingState(pk).limits.reel_seconds, 16);
  assert.equal(billingState(pk).limits.flags.bulk_generator, true);
  assert.equal(creditsAllowance(pk.id), 400);
  assert.equal(creditsAllowance(us.id), 900);
  setCredits(pk.id, { monthly_credits: 50 }, 'test');
  assert.equal(creditsAllowance(pk.id), 50, 'a workspace override still wins');
  assert.equal(billingState(old).limits.credits, null);
  assert.equal(billingState(old).limits.posts_per_day, null, 'existing plans have no new caps');
  assert.equal(creditsAllowance(old.id), null);
});

test('allowances are validated and editable per tier', () => {
  assert.throws(() => cleanAllowances({ reel_seconds: 20 }), /8, 16 or 24/);
  assert.throws(() => cleanAllowances({ posts_per_day: 50, posts_per_month: 10 }), /per day/);
  assert.throws(() => cleanAllowances({ credits: { EUR: 5 } }), /unknown currency/);
  const out = savePlan('tier1', { allowances: { credits: { PKR: 150, USD: 320 }, posts_per_day: 3, posts_per_month: 40, reel_seconds: 8, flags: { brand_kit: true } } }, 'test');
  assert.equal(out.plan.allowances.credits.PKR, 150);
  assert.equal(PLANS.tier1.allowances.posts_per_day, 3);
  assert.equal(PLANS.tier1.allowances.flags.brand_kit, true);
  savePlan('tier1', { price: { GBP: { month: 20 } } }, 'test');
  assert.equal(PLANS.tier1.price.GBP.month, 20);
  assert.ok(listPlans().find((p) => p.id === 'tier1').allowances);
});

test('margin view: fees, tax and the commission estimate are subtracted, red and orange flags', () => {
  saveMarginSettings({ paying_tenants: 25, typical_use_pct: 40, commission_pct: 4.5, payment_fee_pct: 3, target_multiple: 2 }, 'test');
  const rep = marginReport();
  const row = rep.rows.find((r) => r.plan === 'tier2' && r.currency === 'USD' && r.kind === 'month');
  assert.ok(row.cost_full > row.cost_typical);
  assert.equal(row.fees, Math.round(59 * 0.03 * 100) / 100);
  assert.equal(row.commission, Math.round(59 * 0.045 * 100) / 100);
  assert.equal(row.fixed, 1.2);
  assert.equal(row.tax, 0);
  const uk = rep.rows.find((r) => r.plan === 'tier2' && r.currency === 'GBP' && r.kind === 'month');
  assert.ok(uk.tax > 0, 'UK VAT default is subtracted');
  assert.equal(rep.fixed_per_tenant[10], 3);
  // commission off and no fees raises profit
  const before = row.profit_full;
  const rep2 = marginReport(saveMarginSettings({ commission_pct: 0, payment_fee_pct: 0 }, 'test'));
  assert.ok(rep2.rows.find((r) => r.plan === 'tier2' && r.currency === 'USD' && r.kind === 'month').profit_full > before);
  saveMarginSettings({ commission_pct: 4.5, payment_fee_pct: 3 }, 'test');
  // a very high target turns healthy rows orange; a price below cost turns red
  assert.ok(marginReport(saveMarginSettings({ target_multiple: 10 }, 'test')).rows.some((r) => r.flag === 'orange'));
  saveMarginSettings({ target_multiple: 2 }, 'test');
  savePlan('tier3', { price: { USD: { month: 20 } } }, 'test');
  assert.equal(marginReport().rows.find((r) => r.plan === 'tier3' && r.currency === 'USD' && r.kind === 'month').flag, 'red');
  savePlan('tier3', { price: { USD: { month: 149 } } }, 'test');
  assert.ok(marginReport().rows.some((r) => r.kind === 'year'));
  assert.throws(() => saveMarginSettings({ target_multiple: 0 }, 'test'), /target multiple/);
});

test('launch offer: off by default, no discount; on gives the launch price for the offer months, then the normal price', () => {
  const t = mk('newbie', 'PK', 'trial');
  db.prepare("UPDATE tenants SET subscription_status='trialing' WHERE id=?").run(t.id);
  assert.equal(publicOffer().on, false);
  assert.equal(quote(t, { plan: 'tier1', interval: 'month', currency: 'PKR' }).total, 3500, 'off: normal price');
  assert.throws(() => saveOffer({ on: true, countries: { PKR: { percent: 0 } } }, 'test'), /at least one country/);
  saveOffer({ on: true }, 'test');
  const pub = publicOffer();
  assert.equal(pub.on, true);
  assert.equal(pub.countries.PKR.percent, 30);
  assert.match(pub.countries.PKR.banner, /30% off for your first 3 months/);
  assert.equal(pub.countries.USD, undefined, 'only countries with an offer appear');
  assert.equal(pub.spots_left, null);
  const q1 = quote(t, { plan: 'tier1', interval: 'month', currency: 'PKR' });
  assert.equal(q1.total, 2450);
  assert.ok(q1.lines.some((l) => l.kind === 'launch_offer'));
  assert.equal(quote(t, { plan: 'tier1', interval: 'year', currency: 'PKR' }).total, 35700, 'yearly has no launch discount');
  assert.equal(quote(t, { plan: 'starter', interval: 'month', currency: 'PKR' }).total, PLANS.starter.price.PKR.month, 'older plans are not part of the offer');
  // three paid months at the launch price, then the normal price from month 4
  const started = getOffer().started_at;
  pay(t.id, started); assert.equal(quote(t, { plan: 'tier1', interval: 'month', currency: 'PKR' }).lines.find((l) => l.kind === 'launch_offer').label.includes('month 2 of 3'), true);
  pay(t.id, started); pay(t.id, started);
  assert.equal(quote(t, { plan: 'tier1', interval: 'month', currency: 'PKR' }).total, 3500, 'month 4 is the normal price');
  // switch off: the discount and the banner disappear together
  saveOffer({ on: false }, 'test');
  assert.equal(publicOffer().on, false);
  assert.equal(offerFor('PKR'), null);
});

test('launch offer: existing subscribers keep their price; end date and founding spots end it truthfully', () => {
  db.prepare('DELETE FROM invoices').run(); // earlier test's customer
  saveOffer({ on: true, ends_at: null, spots: null }, 'test');
  const old = mk('veteran', 'PK', 'tier1');
  pay(old.id, '2000-01-01 00:00:00'); // paid before the offer started
  assert.equal(quote(old, { plan: 'tier1', interval: 'month', currency: 'PKR' }).total, 3500);
  // end date in the past ends the offer
  saveOffer({ ends_at: new Date(Date.now() + 3600e3).toISOString(), show_countdown: true }, 'test');
  assert.ok(publicOffer().ends_at, 'countdown shown only when switched on');
  setSetting('launch_offer', JSON.stringify({ ...getOffer(), ends_at: new Date(Date.now() - 1000).toISOString() }));
  assert.equal(activeOffer(), null);
  assert.equal(publicOffer().on, false);
  assert.throws(() => saveOffer({ show_countdown: true, ends_at: null }, 'test'), /end date/);
  // founding spots: when they are all taken the offer stops
  saveOffer({ ends_at: null, show_countdown: false, spots: 1, show_spots: true }, 'test');
  assert.equal(publicOffer().spots_left, 1);
  const first = mk('founder', 'PK', 'tier1');
  pay(first.id, getOffer().started_at);
  assert.equal(publicOffer().on, false, 'no spots left');
  assert.equal(getMarginSettings().target_multiple, 2);
});

test('plan caps reach the checks: reel length and the posting caps follow the workspace plan', async () => {
  const { withTenant } = await import('../src/platform.js');
  const { options, quote: reelQuote, planReelSeconds } = await import('../src/services/creativeJobs.js');
  const { postsUsage } = await import('../src/services/socialCalendar.js');
  savePlan('tier1', { allowances: { credits: { PKR: 120 }, posts_per_day: 2, posts_per_month: 30, reel_seconds: 8 } }, 'test');
  const small = mk('smallshop', 'US', 'tier1'), pro = mk('proshop', 'US', 'tier3'), old = mk('plainshop', 'US', 'growth');
  withTenant(small, () => {
    assert.equal(planReelSeconds(), 8);
    assert.deepEqual(options().lengths.filter((l) => l > 8), [], 'no longer reel offered');
    assert.equal(reelQuote({ seconds: 24, script: '' }).seconds, 8, 'a longer length falls back to the plan length');
    const u = postsUsage();
    assert.equal(u.per_day, 2); assert.equal(u.per_month, 30); assert.equal(u.today, 0);
  });
  withTenant(pro, () => { assert.equal(planReelSeconds(), 24); assert.equal(postsUsage().per_day, 15); });
  withTenant(old, () => { assert.equal(planReelSeconds(), null); assert.equal(postsUsage().per_day, null, 'older plans have no plan cap'); });
});

test('the public marketing data carries the offer only while it is truthfully on', async () => {
  const { createApp } = await import('../src/index.js');
  const http = await import('node:http');
  const server = createApp().listen(0);
  const get = () => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/platform/marketing', headers: { Host: 'erp.test' } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(JSON.parse(t))); });
    req.on('error', reject); req.end();
  });
  try {
    saveOffer({ on: false }, 'test');
    assert.equal((await get()).offer.on, false);
    saveOffer({ on: true, ends_at: null, spots: null, show_spots: false }, 'test');
    const m = await get();
    assert.equal(m.offer.on, true);
    assert.equal(m.offer.countries.PKR.percent, 30);
    assert.ok(!JSON.stringify(m.offer).includes('started_at'), 'no internal fields on the public page');
    assert.ok(m.plans.every((p) => !p.id.startsWith('tier')), 'hidden tiers are not shown until switched on');
    savePlan('tier1', { visible: true }, 'test');
    const m2 = await get();
    const t1 = m2.plans.find((p) => p.id === 'tier1');
    assert.ok(t1 && t1.launch_offer === true, 'a visible tier appears with its offer flag');
    savePlan('tier1', { visible: false }, 'test');
  } finally { server.close(); }
});
