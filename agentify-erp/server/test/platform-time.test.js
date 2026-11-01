import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay, PLATFORM_TZ } from '../src/services/platformTime.js';

test('a late-evening UTC payment is dated on the platform-local day, not the UTC day', () => {
  // 2026-11-01 21:30 UTC is already 2026-11-02 02:30 in Karachi (UTC+5), so the payment belongs to the 2nd.
  if (PLATFORM_TZ === 'Asia/Karachi') {
    assert.equal(localDay('2026-11-01 21:30:00'), '2026-11-02');
    assert.equal(localDay('2026-11-01T21:30:00.000Z'), '2026-11-02');
    assert.equal(localDay('2026-11-01 10:00:00'), '2026-11-01');
  }
});

test('date-only values pass through and junk does not throw', () => {
  assert.equal(localDay('2026-11-01'), '2026-11-01');
  assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(localDay('not a date'), 'not a date');
});
