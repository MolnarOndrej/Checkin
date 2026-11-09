import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayKey, monthStart } from '../dist/calendar.js';

test('entry keys use the local calendar date with zero-padded months and days', () => {
  assert.equal(dayKey(new Date(2024, 1, 9, 23, 59)), '2024-02-09');
  assert.equal(dayKey(new Date(2024, 1, 29)), '2024-02-29');
});

test('month navigation starts on day one and crosses year boundaries in both directions', () => {
  assert.equal(dayKey(monthStart(new Date(2024, 0, 31), 1)), '2024-02-01');
  assert.equal(dayKey(monthStart(new Date(2024, 11, 31), 1)), '2025-01-01');
  assert.equal(dayKey(monthStart(new Date(2024, 0, 31), -1)), '2023-12-01');
});
