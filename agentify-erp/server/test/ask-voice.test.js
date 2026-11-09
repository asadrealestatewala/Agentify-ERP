import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-askvoice-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', ERP_MAIL_QUIET: '1', ERP_SECRETS_KEY: 'test-secrets-key-0123456789' });
const dbm = await import('../src/db.js');
const { companyDocs, companyMaterial } = await import('../src/services/askAi.js');
after(() => dbm.closeDbs());

test('company info: contact details and admin notes become searchable, private blocks', () => {
  dbm.setSetting('company_name', 'Skyline Homes'); dbm.setSetting('company_phone', '+92 300 1112223');
  dbm.setSetting('ask_business_notes', 'Office hours: Monday to Saturday, 10am to 7pm.\n\nRefund policy: booking money is refundable within 14 days of payment.');
  assert.equal(companyDocs().length, 3);
  const hours = companyMaterial('what are our office hours?', 'en');
  assert.ok(hours.length && /10am to 7pm/.test(hours[0].text) && hours[0].private);
  const refund = companyMaterial('is the booking money refundable?', 'en');
  assert.match(refund[0].text, /14 days/);
  assert.deepEqual(companyMaterial('how do I add a lead', 'en'), []);
});

test('typos are repaired and the menu map covers a question no guide matches', async () => {
  const { fixTypos, menuMap, material } = await import('../src/services/askAi.js');
  assert.match(fixTypos('me whastapp kesy integrate kar sakta hu'), /whatsapp/);
  assert.equal(fixTypos('zzqx blorp wibble'), 'zzqx blorp wibble');
  assert.match(menuMap(), /WhatsApp/);
  assert.ok(material('me whastapp kesy integrate kar sakta hu').length > 0, 'the misspelt word still finds the WhatsApp screen');
});

test('records: every table query is valid, matches by name, respects permissions and own-scope, and can be switched off', async () => {
  const { SOURCES, recordMaterial, overviewLine, keywords } = await import('../src/services/askRecords.js');
  for (const s of SOURCES) assert.doesNotThrow(() => dbm.all(`SELECT ${s.sel} FROM ${s.from} LIMIT 1`), s.key); // the catch inside recordMaterial must not hide a broken query
  dbm.run('PRAGMA foreign_keys = OFF');
  dbm.run("INSERT INTO contacts(full_name,phone,city,agent_id,created_at) VALUES('Zeeshan Qureshi','03001234567','Lahore',1,'2026-01-01')");
  dbm.run("INSERT INTO contacts(full_name,phone,city,agent_id,created_at) VALUES('Zeeshan Other','03007654321','Lahore',NULL,'2026-01-01')");
  const perms = (...p) => new Set(p);
  const boss = { id: 1, perms: perms('crm:view'), own_scope: 0 };
  assert.deepEqual(keywords('What is the phone number of Zeeshan?'), ['zeeshan']);
  const hit = recordMaterial('what is the phone of Zeeshan', boss);
  assert.equal(hit.length, 2); assert.ok(hit.every((h) => h.private && /Zeeshan/.test(h.text))); assert.ok(hit.some((h) => /03001234567/.test(h.text)));
  assert.ok(!/cnic/i.test(hit[0].text));
  assert.equal(recordMaterial('zeeshan', { id: 1, perms: perms('sales:view'), own_scope: 0 }).length, 0, 'no crm permission, no contacts');
  const mine = recordMaterial('zeeshan', { id: 1, perms: perms('crm:view'), own_scope: 1 });
  assert.equal(mine.length, 1); assert.match(mine[0].text, /Qureshi/);
  assert.equal(recordMaterial('zeeshan', { id: 1, portal: 1, perms: perms('crm:view') }).length, 0);
  assert.match(overviewLine(boss), /2 contacts/);
  dbm.setSetting('ask_use_records', '0');
  assert.deepEqual(recordMaterial('zeeshan', boss), []); assert.equal(overviewLine(boss), '');
  dbm.setSetting('ask_use_records', '1');
});
