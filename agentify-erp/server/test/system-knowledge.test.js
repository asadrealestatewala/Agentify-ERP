import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, ACTIONS } from '../src/rbac.js';
import { LOOKUPS, ROLES } from '../src/seed.js';
import { SETTING_KEYS } from '../src/routes/settings.js';
import { FILE_PACKS } from '../src/regions/runtime.js';
import { systemDocs } from '../src/services/systemKnowledge.js';
import { ask } from '../src/services/assistant.js';
import { ACTION_NOTES, MODULE_NOTES, SETTING_NOTES, LOOKUP_NOTES, FLAG_NOTES } from '../../shared/systemNotes.js';
import { WORKFLOWS } from '../../shared/workflows.js';

test('system knowledge: the code gained nothing that has no plain-words note', () => {
  for (const a of ACTIONS) assert.ok(ACTION_NOTES[a], `add an ACTION_NOTES entry for ${a}`);
  for (const m of MODULES) assert.ok(MODULE_NOTES[m], `add a MODULE_NOTES entry for permission area ${m}`);
  for (const k of SETTING_KEYS) assert.ok(SETTING_NOTES[k], `add a SETTING_NOTES entry for setting ${k}`);
  for (const t of new Set(LOOKUPS.map((l) => l.type))) assert.ok(LOOKUP_NOTES[t], `add a LOOKUP_NOTES entry for pick-list ${t}`);
  for (const [code, p] of Object.entries(FILE_PACKS)) for (const f of Object.keys(p.flags || {})) assert.ok(FLAG_NOTES[f], `add a FLAG_NOTES entry for ${code} flag ${f}`);
});

test('system knowledge: no stale notes for things the code no longer has', () => {
  for (const m of Object.keys(MODULE_NOTES)) assert.ok(MODULES.includes(m), `MODULE_NOTES has removed area ${m}`);
  for (const k of Object.keys(SETTING_NOTES)) assert.ok(SETTING_KEYS.includes(k), `SETTING_NOTES has removed setting ${k}`);
  for (const t of Object.keys(LOOKUP_NOTES)) assert.ok(LOOKUPS.some((l) => l.type === t), `LOOKUP_NOTES has removed list ${t}`);
});

test('system knowledge: documents are built from roles, settings, lists, accounts, regions and workflows', () => {
  const docs = systemDocs(), ids = new Set(docs.map((d) => d.id));
  for (const r of ROLES) assert.ok(ids.has(`role-${r.name}`), r.name);
  for (const k of SETTING_KEYS) assert.ok(ids.has(`setting-${k}`), k);
  for (const code of Object.keys(FILE_PACKS)) assert.ok(ids.has(`region-${code}`), code);
  for (const w of WORKFLOWS) { assert.ok(ids.has(`wf-${w.key}`)); assert.ok(w.steps.length >= 3 && w.keywords.length > 20, w.key); }
  assert.equal(ids.size, docs.length, 'document ids are unique');
  assert.match(docs.find((d) => d.id === 'list-lead_stage').text, /Closed counts as won/);
});

test('system knowledge: Ask answers workflow, settings, roles, lists and regions questions', () => {
  const u = { id: 1, isSuper: true, perms: new Set() };
  const t = (q) => { const o = ask(q, u); assert.equal(o.intent, 'howto', q); return o.answer; };
  assert.match(t('How does a lead become a sale?'), /From lead to sale/);
  assert.match(t('how do installments work'), /Installments and payments/);
  assert.match(t('what does the receipt qr setting do'), /QR code/);
  assert.match(t('what can a Sales Agent do'), /Sales Agent role/);
  assert.match(t('what options does a Dubai workspace have'), /United Arab Emirates/);
  assert.match(t('how does payroll work'), /payroll/i);
  assert.match(t('where is the sales pipeline'), /Sales Pipeline/);
  assert.match(t('how do I add a developer'), /Developer partners/);
});

test('system knowledge: data questions still reach the data answers', () => {
  const u = { id: 1, isSuper: true, perms: new Set() };
  assert.notEqual(ask('how many leads this month', u).intent, 'howto');
  assert.notEqual(ask('what is the sales this month', u).intent, 'howto');
});
