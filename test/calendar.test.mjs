import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayKey, isDayKey } from '../dist/calendar.js';

test('entry keys use the local calendar date with zero-padded months and days', () => {
  assert.equal(dayKey(new Date(2024, 1, 9, 23, 59)), '2024-02-09');
  assert.equal(dayKey(new Date(2024, 1, 29)), '2024-02-29');
});

test('journal day keys accept real calendar dates in YYYY-MM-DD form', () => {
  assert.equal(isDayKey('2024-02-29'), true);
  for (const key of ['2025-02-29', '2024-2-29', '2024-13-01', '2024-02-29T00:00:00Z', null]) {
    assert.equal(isDayKey(key), false);
  }
});
