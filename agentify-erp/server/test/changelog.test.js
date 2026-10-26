import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGELOG, APP_VERSION } from '../../shared/changelog.js';

const key = (v) => v.slice(1).split('.').map(Number);

test('changelog: versions are vMAJOR.MINOR, unique and newest first', () => {
  const seen = new Set();
  for (const r of CHANGELOG) {
    assert.match(r.version, /^v\d+\.\d+$/);
    assert.ok(!seen.has(r.version), `duplicate ${r.version}`);
    seen.add(r.version);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.title && r.items.length, `${r.version} needs a title and items`);
    for (const it of r.items) assert.ok(it.text.length > 10);
  }
  for (let i = 1; i < CHANGELOG.length; i++) {
    const [a, b] = [key(CHANGELOG[i - 1].version), key(CHANGELOG[i].version)];
    assert.ok(a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]), 'entries must be newest first');
  }
  assert.equal(APP_VERSION, CHANGELOG[0].version);
});

test('changelog: package versions match the app version', () => {
  const want = APP_VERSION.slice(1) + '.0';
  for (const f of ['../package.json', '../../client/package.json']) {
    assert.equal(JSON.parse(readFileSync(new URL(f, import.meta.url))).version, want, f);
  }
});
