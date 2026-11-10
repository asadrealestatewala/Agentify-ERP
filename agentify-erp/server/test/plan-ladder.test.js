import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The 7-tier Pakistan ladder: seeded hidden, 6-month and yearly prices, feature gates enforced by the billing guard, the on/off switch, add-ons and AI top-up packs, lead scoring.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-ladder-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', ERP_MAIL_QUIET: '1', ERP_SECRETS_KEY: 'test-secrets-key-0123456789', BILLING_PROVIDER: 'manual' });

const { platformDb, createTenant, getTenantBySlug, withTenant } = await import('../src/platform.js');
const { PLANS, billingState, planCatalog, billingGuard, blockedFeature, intervalMonths } = await import('../src/services/plans.js');
const { switchLadder, ladderInfo, initPlans } = await import('../src/services/plansStore.js');
const { LADDER_IDS, periodPrices } = await import('../src/services/planLadder.js');
const { quote } = await import('../src/services/commerce.js');
const { approveSubmission } = await import('../src/services/billing.js');
const { creditsAllowance } = await import('../src/services/aiGate.js');
const { scoreLead, leadScores, followUpQueue, scheduleFollowUp } = await import('../src/services/leadScoring.js');
const { run, get } = await import('../src/db.js');
const db = platformDb();
after(async () => { (await import('../src/db.js')).closeDbs(); });

const mk = (slug, plan) => {
  createTenant({ slug, name: slug, adminName: 'Owner', adminEmail: `o@${slug}.test`, adminPassword: 'Secret@12345', region: 'PK' });
  db.prepare("UPDATE tenants SET plan=?, subscription_status='active', current_period_end='2999-01-01', billing_interval='month' WHERE slug=?").run(plan, slug);
  return getTenantBySlug(slug);
};
/** Run the billing guard for one request; returns the error it passed on, or null when the request goes through. */
const guard = (tenant, method, p) => { let err = null; billingGuard({ tenant, method, path: p, headers: {} }, {}, (e) => { err = e || null; }); return err; };

test('the 7 ladder plans are seeded hidden, with the agreed prices, seats and the 10% / 20% period discounts', () => {
  assert.deepEqual(LADDER_IDS, ['lad_agent_plus', 'lad_agency_starter', 'lad_agency_growth', 'lad_agency_pro', 'lad_developer', 'lad_enterprise']);
  assert.deepEqual(LADDER_IDS.map((id) => PLANS[id].price.PKR.month), [1500, 5000, 12000, 18000, 35000, 85000]);
  assert.deepEqual(LADDER_IDS.map((id) => PLANS[id].seats), [2, 5, 10, 15, 40, null]);
  for (const id of LADDER_IDS) {
    const p = PLANS[id].price.PKR;
    assert.equal(p.half, Math.round(p.month * 6 * 0.9), `${id} 6 months = 10% off`);
    assert.equal(p.year, Math.round(p.month * 12 * 0.8), `${id} yearly = 20% off`);
    assert.equal(PLANS[id].visible, false, `${id} hidden`);
  }
  assert.deepEqual(periodPrices(1500), { month: 1500, half: 8100, year: 14400 });
  assert.equal(PLANS.lad_developer.product, 'bundle');
  assert.equal(PLANS.lad_enterprise.api_access, true);
  assert.ok(!planCatalog().some((p) => p.id.startsWith('lad_')), 'nothing is on the public catalog until the owner switches it on');
  assert.ok(PLANS.starter.visible && PLANS.growth.visible, 'old plans untouched');
});

test('the ladder adds each feature at its tier and never takes one away', () => {
  const on = (id) => Object.entries(PLANS[id].allowances.flags).filter(([, v]) => v).map(([k]) => k);
  const need = {
    lad_agent_plus: ['installments', 'receipts', 'whatsapp'], lad_agency_starter: ['vouchers', 'reports', 'website', 'hrm'],
    lad_agency_growth: ['visual_website', 'custom_domain', 'property_visits', 'field_location', 'tenant_email', 'ai'], lad_agency_pro: ['social_posting', 'lead_scoring'],
    lad_developer: ['developer_portal', 'plot_rebate', 'project_inventory', 'assisted_migration'], lad_enterprise: ['mls_feeds', 'branches', 'white_label', 'dedicated_database', 'enforce_2fa', 'priority_support'],
  };
  let have = new Set();
  for (const id of LADDER_IDS) {
    for (const f of need[id]) have.add(f);
    const flags = new Set(on(id).filter((k) => !['content_calendar', 'bulk_generator', 'brand_kit', 'listing_to_post', 'priority_queue'].includes(k)));
    assert.deepEqual([...flags].sort(), [...have].sort(), id);
  }
  assert.equal(PLANS.lad_agency_growth.allowances.credits.PKR, 150, 'the first AI quota is small');
  assert.ok(PLANS.lad_agency_pro.allowances.credits.PKR > PLANS.lad_agency_growth.allowances.credits.PKR);
  assert.equal(PLANS.lad_agent_plus.allowances.credits.PKR, 0);
});

test('the billing guard enforces the tier: 402 feature_not_in_plan below it, through at and above it', () => {
  const plus = mk('lplus', 'lad_agent_plus'), growth = mk('lgrowth', 'lad_agency_growth'), pro = mk('lpro', 'lad_agency_pro'), dev = mk('ldev', 'lad_developer'), old = mk('lold', 'growth');
  const code = (t, m, p) => guard(t, m, p)?.extra?.code ?? 'ok';
  assert.equal(code(plus, 'GET', '/hrm/employees'), 'feature_not_in_plan', 'HRM starts at Agency Starter');
  assert.equal(code(plus, 'GET', '/integrations/oauth/meta/start'), 'feature_not_in_plan', 'Meta connection starts at Agency Pro');
  assert.equal(code(pro, 'GET', '/integrations/oauth/meta/start'), 'ok');
  assert.equal(code(plus, 'GET', '/contacts'), 'ok', 'basic CRM and listings are in every tier');
  assert.equal(code(plus, 'GET', '/properties'), 'ok');
  assert.equal(code(plus, 'GET', '/installments'), 'ok');
  assert.equal(code(plus, 'POST', '/receipts/record'), 'ok');
  assert.equal(code(plus, 'GET', '/whatsapp/threads'), 'ok');
  assert.equal(code(plus, 'GET', '/accounting/expenses'), 'feature_not_in_plan');
  assert.equal(code(plus, 'GET', '/reports'), 'feature_not_in_plan');
  assert.equal(code(plus, 'GET', '/site-admin/pages'), 'feature_not_in_plan');
  assert.equal(code(plus, 'POST', '/creative/story'), 'feature_not_in_plan');
  assert.equal(code(growth, 'GET', '/accounting/expenses'), 'ok');
  assert.equal(code(growth, 'GET', '/site-admin/themes'), 'ok');
  assert.equal(code(growth, 'PUT', '/integrations/domain'), 'ok');
  assert.equal(code(growth, 'POST', '/creative/story'), 'ok');
  assert.equal(code(growth, 'POST', '/appointments/12/check-in'), 'ok');
  assert.equal(code(plus, 'POST', '/appointments/12/check-in'), 'feature_not_in_plan');
  assert.equal(code(plus, 'GET', '/appointments'), 'ok', 'appointments themselves are ordinary CRM');
  assert.equal(code(growth, 'GET', '/content/posting/accounts'), 'feature_not_in_plan');
  assert.equal(code(growth, 'GET', '/leadflow/scores'), 'feature_not_in_plan');
  assert.equal(code(growth, 'GET', '/leadflow/rules'), 'ok', 'routing and sequences stay in every tier');
  assert.equal(code(pro, 'GET', '/leadflow/scores'), 'ok');
  assert.equal(code(pro, 'GET', '/leadflow/followups'), 'ok');
  assert.equal(code(pro, 'GET', '/content/posting/accounts'), 'ok');
  assert.equal(code(pro, 'GET', '/developers'), 'feature_not_in_plan');
  assert.equal(code(pro, 'POST', '/projects'), 'feature_not_in_plan');
  assert.equal(code(pro, 'GET', '/projects'), 'ok', 'reading projects (dropdowns elsewhere) still works');
  assert.equal(code(dev, 'GET', '/developers'), 'ok');
  assert.equal(code(dev, 'GET', '/developers/3/plot-rebates'), 'ok');
  assert.equal(code(dev, 'POST', '/projects'), 'ok');
  assert.equal(code(dev, 'GET', '/integrations/portals'), 'feature_not_in_plan', 'MLS and portal feeds are Enterprise');
  assert.equal(code(old, 'GET', '/installments'), 'ok', 'plans that never set a flag keep everything');
  assert.equal(code(old, 'GET', '/leadflow/scores'), 'ok');
  assert.deepEqual(blockedFeature(null, '/installments'), null);
  const t = guard(plus, 'GET', '/hrm/employees');
  assert.equal(t.status, 402); assert.match(t.message, /HRM is not included in your plan/);
});

test('quotes: 6-month and yearly prices, extra users, and AI top-up packs are one-time and not part of the recurring price', () => {
  const t = mk('lquote', 'lad_agency_starter');
  assert.equal(intervalMonths('half'), 6);
  assert.equal(quote(t, { plan: 'lad_agency_growth', interval: 'half', currency: 'PKR' }).total, 64800);
  assert.equal(quote(t, { plan: 'lad_agency_growth', interval: 'year', currency: 'PKR' }).total, 115200);
  assert.throws(() => quote(t, { plan: 'lad_agency_growth', interval: 'weekly', currency: 'PKR' }), /Interval/);
  const q = quote(t, { plan: 'lad_agent_plus', interval: 'half', currency: 'PKR', addons: [{ id: 'extra_user', quantity: 3 }] });
  assert.equal(q.total, 8100 + 3 * 3780);
  assert.equal(quote(t, { plan: 'lad_agent_plus', interval: 'month', currency: 'PKR', addons: [{ id: 'extra_user', quantity: 1 }] }).total, 1500 + 700);
  const tp = quote(t, { plan: 'lad_agent_plus', interval: 'year', currency: 'PKR', addons: [{ id: 'ai_topup_100', quantity: 1 }] });
  assert.equal(tp.total, 14400 + 3000);
  assert.equal(tp.list_amount, 14400, 'the top-up is not recurring');
  assert.equal(tp.setup_fee, 3000, 'it is carried as a one-time amount so reports do not count it as monthly revenue');
});

test('approving a 6-month payment extends 6 months, an extra user raises the seat limit, and a top-up pack adds credits once', async () => {
  const t = mk('lpay', 'lad_agency_growth');
  db.prepare("UPDATE tenants SET subscription_status='expired', current_period_end='2020-01-01' WHERE id=?").run(t.id);
  const q = quote(t, { plan: 'lad_agency_growth', interval: 'half', currency: 'PKR', addons: [{ id: 'extra_user', quantity: 2 }, { id: 'ai_topup_300', quantity: 1 }] });
  const before = creditsAllowance(t.id);
  const sid = Number(db.prepare('INSERT INTO payment_submissions(tenant_id,plan,interval,method,amount,currency,reference,submitted_by,coupon_code,discount_amount,setup_fee,addons,list_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(t.id, 'lad_agency_growth', 'half', 'bank', q.total, 'PKR', 'HBL-LADDER-1', 'o@lpay.test', null, 0, q.setup_fee, JSON.stringify(q.addons), q.list_amount).lastInsertRowid);
  const out = await approveSubmission(sid, 'ok');
  const today = new Date(); const want = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 6, today.getUTCDate()));
  assert.ok(Math.abs(Date.parse(out.current_period_end) - want.getTime()) <= 3 * 864e5, `period end ${out.current_period_end}`);
  assert.equal(out.billing_interval, 'half');
  assert.equal(out.price_amount, 64800 + 2 * 3780, 'recurring price excludes the one-time pack');
  assert.equal(billingState(getTenantBySlug('lpay')).limits.seats, 12);
  assert.equal(creditsAllowance(t.id), before + 300);
  assert.ok(!db.prepare("SELECT 1 FROM tenant_addons WHERE tenant_id=? AND addon_id='ai_topup_300'").get(t.id), 'no recurring add-on is left for a one-time pack');
});

test('switching the ladder on puts the 6 plans on sale and old ones off sale; switching off restores the previous sale page', () => {
  const was = planCatalog().map((p) => p.id).sort();
  assert.equal(ladderInfo().on, false);
  switchLadder(true, 'test');
  assert.equal(ladderInfo().on, true);
  assert.deepEqual(planCatalog().map((p) => p.id).sort(), [...LADDER_IDS].sort());
  assert.equal(PLANS.growth.active, false, 'old plans stop selling; subscribers keep them');
  assert.ok(billingState(getTenantBySlug('lold')).limits.name, 'an existing subscriber still resolves their plan');
  switchLadder(true, 'test');
  switchLadder(false, 'test');
  assert.deepEqual(planCatalog().map((p) => p.id).sort(), was, 'twice on then off restores exactly');
});

test('lead scoring: hot beats cold, reasons are given, and the follow-up queue lists overdue, due today and gone-quiet leads most urgent first', () => {
  const today = '2026-11-06';
  const hot = scoreLead({ phone: '0300', email: 'a@b.c', budget: 5e6, pref_location: 'DHA', priority: 'High', property_id: 3, agent_id: 1, stage_name: 'Interested', stage_meta: '{"kind":"open"}', last_activity_at: '2026-11-05T10:00:00Z', acts30: 6, created_at: '2026-10-01' }, today);
  const cold = scoreLead({ stage_name: 'Non Contacted', stage_meta: '{"kind":"new"}', last_activity_at: '2026-08-01T10:00:00Z', created_at: '2026-08-01', acts30: 0 }, today);
  assert.equal(hot.band, 'hot'); assert.equal(cold.band, 'cold');
  assert.ok(hot.score > 80 && cold.score < 10, `${hot.score} ${cold.score}`);
  assert.ok(hot.reasons.includes('Budget known'));

  const t = mk('lscore', 'lad_agency_pro');
  withTenant(t, () => {
    const stage = (v) => get("SELECT id FROM lookups WHERE type='lead_stage' AND value=?", v).id;
    const add = (name, stg, last, follow) => Number(run('INSERT INTO contacts(full_name,phone,stage_id,budget,last_activity_at,followup_date,created_by,created_at) VALUES(?,?,?,?,?,?,1,?)', name, '0300111', stage(stg), 4e6, last, follow, '2026-10-01T00:00:00Z').lastInsertRowid);
    const a = add('Overdue Olivia', 'Interested', '2026-11-05T00:00:00Z', '2026-11-01');
    run("INSERT INTO tasks(entity_type,entity_id,title,due_date,created_by,created_at) VALUES('contact',?,'Follow up','2026-11-01',1,?)", a, '2026-10-30');
    const b = add('Today Tariq', 'Contacted', '2026-11-05T00:00:00Z', '2026-11-06');
    run("INSERT INTO tasks(entity_type,entity_id,title,due_date,created_by,created_at) VALUES('contact',?,'Follow up','2026-11-06',1,?)", b, '2026-10-30');
    add('Quiet Qasim', 'Interested', '2026-10-25T00:00:00Z', null);
    add('Lost Laila', 'Not Interested', '2026-10-25T00:00:00Z', '2026-11-01');
    const q = followUpQueue({ today });
    assert.deepEqual(q.items.map((i) => [i.full_name, i.kind]), [['Overdue Olivia', 'overdue'], ['Today Tariq', 'due_today'], ['Quiet Qasim', 'gone_quiet']]);
    assert.deepEqual(q.counts, { overdue: 1, due_today: 1, gone_quiet: 1 });
    assert.ok(!q.items.some((i) => i.full_name === 'Lost Laila'), 'lost leads never nag');
    const s = leadScores({ today });
    assert.equal(s.total, 3); assert.equal(s.leads[0].full_name, 'Overdue Olivia');
    const r = scheduleFollowUp({ id: b, agent_id: null }, { due_date: '2026-11-10', title: 'Call about the plot' }, { id: 1 });
    assert.equal(r.ok, true);
    assert.throws(() => scheduleFollowUp({ id: b }, { due_date: 'soon' }, { id: 1 }), /follow-up date/);
  });
});

test('the old Solo Agent plan is retired: hidden, and its workspaces move to Agent Plus (v1.89 migration)', () => {
  db.prepare("INSERT OR IGNORE INTO plans(id,name,product,seats,sort_order) VALUES('lad_solo_agent','Solo Agent','real_estate',1,99)").run();
  const t = mk('lsolo2', 'lad_solo_agent');
  db.prepare("DELETE FROM platform_settings WHERE key='seeded_ladder_v2'").run();
  initPlans(db);
  assert.equal(db.prepare("SELECT plan FROM tenants WHERE slug='lsolo2'").get().plan, 'lad_agent_plus');
  assert.equal(db.prepare("SELECT visible, active FROM plans WHERE id='lad_solo_agent'").get().visible, 0);
  assert.equal(t.slug, 'lsolo2');
});

test('USA: the ladder carries USD prices, USD wording, USD add-ons and currency-specific card slots', async () => {
  const { planCatalog: catalog } = await import('../src/services/plans.js');
  const { priceSlots } = await import('../src/services/platformConfig.js');
  const stripe = await import('../src/services/stripe.js');
  assert.deepEqual(LADDER_IDS.map((id) => PLANS[id].price.USD.month), [29, 79, 149, 249, 449, 999]);
  for (const id of LADDER_IDS) {
    const u = PLANS[id].price.USD;
    assert.equal(u.half, Math.round(u.month * 6 * 0.9));
    assert.equal(u.year, Math.round(u.month * 12 * 0.8));
    assert.ok(PLANS[id].regional.USD.features.length, `${id} has USD wording`);
    assert.ok(!/PKR|rupee|plot rebate/i.test(JSON.stringify(PLANS[id].regional.USD)), `${id} USD wording has no Pakistan terms`);
  }
  assert.match(PLANS.lad_enterprise.regional.USD.description, /\$999/);
  // seats and limits are shared, so a USD buyer gets exactly the same plan
  assert.deepEqual(catalog(null, null, 'USD').filter((p) => p.id.startsWith('lad_')).map((p) => p.id), []); // hidden until switched on
  switchLadder(true, 'test');
  const usd = catalog(null, null, 'USD').map((p) => p.id);
  assert.ok(LADDER_IDS.every((id) => usd.includes(id)), 'all six ladder plans are offered to a USD buyer');
  assert.ok(!catalog(null, null, 'GBP').some((p) => p.id.startsWith('lad_')), 'no GBP price, so not offered in GBP');
  assert.ok(catalog(null, null, 'PKR').some((p) => p.id === 'lad_agent_plus'));
  assert.ok(catalog(null, null, 'USD').find((p) => p.id === 'lad_agent_plus').regional.USD.features.some((f) => /Twilio/.test(f)));
  // add-ons
  const addons = Object.fromEntries(db.prepare('SELECT id, price FROM addons').all().map((a) => [a.id, JSON.parse(a.price)]));
  assert.equal(addons.extra_user.USD.month, 12);
  assert.equal(addons.ai_topup_300.USD.month, 39);
  assert.equal(addons.extra_user.PKR.month, 700, 'PKR add-on prices untouched');
  // a US quote
  const q = quote({ id: 1, plan: 'trial' }, { plan: 'lad_agency_growth', interval: 'year', currency: 'USD' });
  assert.equal(q.total, PLANS.lad_agency_growth.price.USD.year);
  // Stripe: each ladder plan needs its own USD price slot, and a USD card never falls back to the PKR price
  assert.ok(priceSlots().includes('lad_agency_growth_month_usd') && priceSlots().includes('lad_agency_growth_year_usd'));
  assert.ok(!priceSlots().includes('lad_agency_growth_half_usd'));
  assert.equal(stripe.priceId('lad_agency_growth', 'month', 'USD'), null);
  switchLadder(false, 'test');
});

test('UAE: the ladder carries AED prices, AED wording, AED add-ons and AED card slots', async () => {
  const { planCatalog: catalog } = await import('../src/services/plans.js');
  const { priceSlots } = await import('../src/services/platformConfig.js');
  const stripe = await import('../src/services/stripe.js');
  assert.deepEqual(LADDER_IDS.map((id) => PLANS[id].price.AED.month), [99, 299, 549, 899, 1649, 3699]);
  for (const id of LADDER_IDS) {
    const a = PLANS[id].price.AED;
    assert.equal(a.half, Math.round(a.month * 6 * 0.9));
    assert.equal(a.year, Math.round(a.month * 12 * 0.8));
    assert.ok(PLANS[id].regional.AED.features.length, `${id} has AED wording`);
    assert.ok(PLANS[id].regional.USD, `${id} keeps its USD wording`);
    assert.ok(!/PKR|rupee|plot rebate|installment|Twilio|\$/i.test(JSON.stringify(PLANS[id].regional.AED)), `${id} AED wording has no Pakistan or US terms`);
  }
  assert.match(PLANS.lad_enterprise.regional.AED.description, /AED 3,699/);
  switchLadder(true, 'test');
  assert.ok(LADDER_IDS.every((id) => catalog(null, null, 'AED').map((p) => p.id).includes(id)), 'all six ladder plans are offered to an AED buyer');
  const addons = Object.fromEntries(db.prepare('SELECT id, price FROM addons').all().map((a) => [a.id, JSON.parse(a.price)]));
  assert.equal(addons.extra_user.AED.month, 45);
  assert.equal(addons.ai_topup_300.AED.month, 145);
  assert.equal(addons.extra_user.USD.month, 12, 'USD add-on prices untouched');
  const q = quote({ id: 1, plan: 'trial' }, { plan: 'lad_agency_growth', interval: 'year', currency: 'AED' });
  assert.equal(q.total, PLANS.lad_agency_growth.price.AED.year);
  assert.ok(priceSlots().includes('lad_agency_growth_month_aed') && priceSlots().includes('lad_agency_growth_year_aed'));
  assert.equal(stripe.priceId('lad_agency_growth', 'month', 'AED'), null, 'an AED card never falls back to the PKR price');
  switchLadder(false, 'test');
});
