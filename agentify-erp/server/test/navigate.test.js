import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navLinks, validPoint, isApplePlatform } from '../../shared/navigate.js';

test('Navigate links carry the exact coordinates and need no key', () => {
  const n = navLinks(33.554, 73.024, { label: 'Plot 5 & 6', nav: { userAgent: 'Mozilla/5.0 (Linux; Android 13)' } });
  assert.equal(n.primary, 'google');
  assert.equal(n.google, 'https://www.google.com/maps/dir/?api=1&destination=33.554000,73.024000&travelmode=driving');
  assert.match(n.apple, /^https:\/\/maps\.apple\.com\/\?daddr=33\.554000,73\.024000&dirflg=d&q=Plot%205%20%26%206$/);
  assert.ok(!/key=/.test(n.google + n.apple));
});

test('Apple devices (including iPadOS posing as a Mac) get Apple Maps first', () => {
  assert.equal(navLinks(1, 2, { nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } }).primary, 'apple');
  assert.equal(isApplePlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' }), true);
  assert.equal(isApplePlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32' }), false);
});

test('unusable coordinates give no link at all', () => {
  for (const [a, b] of [['', ''], [null, 5], ['x', 1], [91, 0], [0, 181], [0, 0]]) assert.equal(navLinks(a, b), null, `${a},${b}`);
  assert.equal(validPoint('33.5', '73.0'), true, 'numeric strings from the database are fine');
});
