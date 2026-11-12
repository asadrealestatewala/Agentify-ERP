import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-region-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'r.db');
delete process.env.ERP_BASE_DOMAIN;

const { platformDb } = await import('../src/platform.js');
const admin = await import('../src/regions/admin.js');
const { selectableRegions } = await import('../src/regions/index.js');
const { regionFor } = await import('../src/regions/runtime.js');
const { openDb, run, get, all } = await import('../src/db.js');
const { als } = await import('../src/context.js');
const identity = await import('../src/regions/identity.js');

test('every country is selectable by default and the console can still close one', () => {
  const pdb = platformDb();
  assert.deepEqual([...selectableRegions(pdb).keys()].sort(), ['AE', 'CA', 'PK', 'UK', 'US']);
  assert.equal(regionFor({ region: 'US', money_scale: 2 }).config.pack_version, 4);
  admin.setRegionStatus(pdb, 'US', 'draft', 'tester');
  assert.deepEqual([...selectableRegions(pdb).keys()].sort(), ['AE', 'CA', 'PK', 'UK']);
  admin.setRegionStatus(pdb, 'US', 'active', 'tester');
  assert.deepEqual([...selectableRegions(pdb).keys()].sort(), ['AE', 'CA', 'PK', 'UK', 'US']);
  assert.throws(() => admin.setRegionStatus(pdb, 'PK', 'draft', 'tester'), /stays active/);
});

test('flags change what a workspace sees and are audited', () => {
  const pdb = platformDb();
  admin.setRegionFlag(pdb, 'US', 'mortgage', true, 'tester');
  assert.equal(regionFor({ region: 'US', money_scale: 2 }).config.flags.mortgage, true);
  assert.equal(regionFor({ region: 'US', money_scale: 2, flags: JSON.stringify({ mortgage: false }) }).config.flags.mortgage, false);
  const row = pdb.prepare("SELECT action FROM region_rule_audit WHERE action='flag:mortgage'").get();
  assert.ok(row);
  assert.throws(() => admin.setRegionFlag(pdb, 'US', 'Bad Flag!', true, 'tester'), /Invalid flag/);
});

test('rules are versioned, start unreviewed, and reviewing is recorded', () => {
  const pdb = platformDb();
  const a = admin.saveRule(pdb, { region: 'US', kind: 'fee', key: 'transfer', effective_from: '2026-01-01', value: { rate_bp: 100 } }, 'tester');
  const b = admin.saveRule(pdb, { region: 'US', kind: 'fee', key: 'transfer', effective_from: '2027-01-01', value: { rate_bp: 120 } }, 'tester');
  const rows = admin.listRules(pdb, 'US');
  assert.deepEqual(rows.map((r) => r.version), [2, 1]);
  assert.ok(rows.every((r) => r.needs_legal_review === 1));
  admin.reviewRule(pdb, a, 'lawyer');
  assert.equal(admin.listRules(pdb, 'US').find((r) => r.id === a).needs_legal_review, 0);
  assert.equal(admin.listRules(pdb, 'US').find((r) => r.id === b).needs_legal_review, 1);
  assert.throws(() => admin.saveRule(pdb, { region: 'US', kind: 'fee', key: 'x', effective_from: 'soon', value: 1 }, 't'), /YYYY-MM-DD/);
  assert.ok(admin.ruleAudit(pdb, 'US').length >= 3);
});

test('exchange rates are stored as integers', () => {
  const pdb = platformDb();
  admin.saveFx(pdb, { base: 'USD', quote: 'PKR', rate: 278.4567, as_of: '2026-06-15' }, 'tester');
  const fx = admin.listFx(pdb).find((x) => x.quote === 'PKR');
  assert.equal(fx.rate_ppm, 278456700);
  assert.throws(() => admin.saveFx(pdb, { base: 'USD', quote: 'USD', rate: 1 }, 't'), /different/);
});

test('identity numbers are encrypted, masked, validated by region, and reveals are audited', async () => {
  const db = openDb(path.join(dir, 'tenant.db'));
  const tenant = { id: 99, slug: 'us-test', region: 'US', money_scale: 2, timezone: 'America/New_York', currency: 'USD' };
  const req = { user: { id: 1, name: 'Admin', role: 'admin' }, ip: '127.0.0.1' };
  als.run({ tenant, db }, () => {
    assert.throws(() => identity.saveIdentity(req, 1, '12345'), /valid/);
    const out = identity.saveIdentity(req, 1, '123-45-6789');
    assert.equal(out.masked, '•••• 6789');
    const raw = get('SELECT number_enc FROM identity_documents WHERE contact_id=1').number_enc;
    assert.ok(!raw.includes('123456789'));
    assert.equal(identity.maskedIdentity(1).masked, '•••• 6789');
    assert.equal(identity.revealIdentity(req, 1), '123456789');
    assert.ok(get("SELECT 1 FROM audit_log WHERE action='Revealed identity number'"));
  });
});

test('a workspace can be created in an active region and takes its currency, units and formats', async () => {
  const { createTenant, getTenant } = await import('../src/platform.js');
  const pdb = platformDb();
  admin.setRegionStatus(pdb, 'US', 'draft', 'tester');
  assert.throws(() => createTenant({ slug: 'us-early', name: 'Early', adminName: 'A', adminEmail: 'a@b.co', adminPassword: 'Lone#Star2026', region: 'US' }), /not available/);
  admin.setRegionStatus(pdb, 'US', 'active', 'tester');
  assert.throws(() => createTenant({ slug: 'us-bad', name: 'Bad', adminName: 'A', adminEmail: 'a@b.co', adminPassword: 'Lone#Star2026', region: 'US', sub_region: 'Atlantis' }), /valid state/i);
  const t = createTenant({ slug: 'us-ok', name: 'Lone Star Realty', adminName: 'A', adminEmail: 'owner@lonestar.test', adminPassword: 'Lone#Star2026', region: 'US', sub_region: 'Texas' });
  const row = getTenant(t.id);
  assert.equal(row.region, 'US'); assert.equal(row.currency, 'USD'); assert.equal(row.money_scale, 2); assert.equal(row.timezone, 'America/New_York'); assert.equal(row.sub_region, 'Texas');
  assert.equal(regionFor(row).money.format(123456), '$1,234.56');
  const pk = createTenant({ slug: 'pk-ok', name: 'Karachi Homes', adminName: 'A', adminEmail: 'owner@khi.test', adminPassword: 'Lone#Star2026' });
  assert.equal(getTenant(pk.id).money_scale, 0); assert.equal(getTenant(pk.id).currency, 'PKR');
});

test('demo data for another region uses its own currency, names and units, and no Pakistani text', async () => {
  const { createTenant } = await import('../src/platform.js');
  const { withTenant } = await import('../src/platform.js');
  admin.setRegionStatus(platformDb(), 'UK', 'active', 'tester');
  const t = createTenant({ slug: 'uk-demo', name: 'Thames Estates', adminName: 'A', adminEmail: 'owner@thames.test', adminPassword: 'Lone#Star2026', region: 'UK', sub_region: 'England', demo: true });
  withTenant(t, () => {
    const props = all('SELECT title, total_price, unit FROM properties');
    assert.ok(props.length >= 3);
    assert.ok(props.every((p) => p.unit === 'Sq Ft' && p.total_price > 1000000));
    const contacts = all('SELECT country, phone FROM contacts');
    assert.ok(contacts.length >= 4 && contacts.every((c) => c.country === 'United Kingdom' && c.phone.startsWith('+44')));
    assert.equal(JSON.stringify([props, contacts]).includes('Pakistan'), false);
    assert.equal(all('SELECT id FROM sales').length, 2, 'two sample sales with schedules');
    assert.ok(all('SELECT id FROM receipts').length >= 1, 'and a payment');
  });
});

test('marketing countries: every country is listed, only active ones are open, and plans have local-currency prices', async () => {
  const { listCountries } = await import('../src/regions/index.js');
  const { listPlans } = await import('../src/services/plansStore.js');
  const pdb = platformDb();
  admin.setRegionStatus(pdb, 'CA', 'draft', 'tester');
  const cs = listCountries(pdb);
  assert.deepEqual(cs.map((c) => c.code), ['US', 'UK', 'AE', 'PK', 'CA']);
  assert.equal(cs.find((c) => c.code === 'PK').open, true);
  assert.equal(cs.find((c) => c.code === 'CA').open, false);
  assert.equal(cs.find((c) => c.code === 'UK').config.calculators.purchase_costs, 'sdlt');
  assert.ok(cs.find((c) => c.code === 'US').copy.hero_title);
  const starter = listPlans().find((p) => p.id === 'starter');
  for (const cur of ['USD', 'GBP', 'AED', 'PKR']) assert.ok(starter.price[cur]?.month > 0, `starter has a ${cur} monthly price`);
});
