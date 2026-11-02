import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CHANGELOG } from '../../shared/changelog.js';
import { GUIDES, searchKnowledge } from '../../shared/guides.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../assets/training/manifest.json', import.meta.url), 'utf8')).map((m) => m.key);
const bad = /super\s*admin|console|platform|agentify administrator|resend|botlinkd/i;

test('guides: every changelog guide key exists and every guide is well formed', () => {
  for (const r of CHANGELOG) for (const it of r.items) if (it.guide) assert.ok(GUIDES[it.guide], `${r.version} points at missing guide ${it.guide}`);
  for (const [k, g] of Object.entries(GUIDES)) {
    assert.match(g.since, /^v\d+\.\d+$/, k);
    assert.ok(g.title && g.who && g.steps.length >= 2 && g.keywords.length, k);
    if (g.video) assert.ok(manifest.includes(g.video), `${k}: unknown training video ${g.video}`);
    for (const f of g.faq) assert.ok(f.q && f.a, k);
  }
});

test('guides: tenant text never mentions platform administration (internal notes may)', () => {
  for (const [k, g] of Object.entries(GUIDES)) {
    const text = [g.title, g.who, g.module, ...g.steps, ...g.limits, ...g.faq.flatMap((f) => [f.q, f.a])].join(' ');
    assert.ok(!bad.test(text), `${k} tenant text mentions platform admin`);
  }
});

test('guides: search finds the right guide and hides internal notes from tenants', () => {
  assert.equal(searchKnowledge('how do I add a developer plot')[0].key, 'developer-partners');
  assert.equal(searchKnowledge('where is the navigate button for directions')[0].key, 'maps-navigate');
  assert.equal(searchKnowledge('how many leads this month').length, 0);
  assert.equal(searchKnowledge('MapTiler LocationIQ keys').length, 0);
  assert.ok(searchKnowledge('MapTiler LocationIQ keys', { platform: true }).length > 0);
});
