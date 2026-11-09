import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateOffset, dayKey, monthStart, weekStart } from '../dist/calendar.js';

test('entry keys use the local calendar date with zero-padded months and days', () => {
  assert.equal(dayKey(new Date(2024, 1, 9, 23, 59)), '2024-02-09');
  assert.equal(dayKey(new Date(2024, 1, 29)), '2024-02-29');
});

test('weeks start on Monday and count calendar days across month and year boundaries', () => {
  const monday = weekStart(new Date(2025, 0, 5, 23, 59));
  assert.equal(dayKey(monday), '2024-12-30');
  assert.equal(dayKey(dateOffset(monday, 6)), '2025-01-05');
  assert.equal(dayKey(weekStart(new Date(2025, 0, 6))), '2025-01-06');
});

test('month navigation starts on day one and crosses year boundaries in both directions', () => {
  assert.equal(dayKey(monthStart(new Date(2024, 0, 31), 1)), '2024-02-01');
  assert.equal(dayKey(monthStart(new Date(2024, 11, 31), 1)), '2025-01-01');
  assert.equal(dayKey(monthStart(new Date(2024, 0, 31), -1)), '2023-12-01');
});
