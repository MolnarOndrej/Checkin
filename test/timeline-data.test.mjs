import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goalProgress, isGoal } from '../dist/measurements.js';
import {
  createActivity, dateForIndex, indexForKey, keyForIndex, removeActivity, removeValue, saveValue, shortLabel, timelineScores,
} from '../dist/timeline-data.js';

const today = indexForKey('2026-12-31');

function activity(journal, index, type = 'custom') {
  const item = { id: String(index), type, text: 'Activity ' + index, unit: type === 'custom' ? 'pages' : 'min', goals: [] };
  createActivity(journal, item);
  return item;
}

test('day indexes stay consecutive across year boundaries and use short ordinal labels', () => {
  const next = dateForIndex(today + 1);
  assert.equal(shortLabel(next), 'Jan 1st');
  assert.equal(keyForIndex(today + 1), '2027-01-01');
  for (const [day, suffix] of [[2, 'nd'], [3, 'rd'], [11, 'th'], [12, 'th'], [13, 'th'], [22, 'nd']]) {
    assert.equal(shortLabel(dateForIndex(today + day)), 'Jan ' + day + suffix);
  }
});

test('values lift their day and blanks dip gently after the first active day', () => {
  const journal = { activities: [], days: {} };
  const { id } = activity(journal, 1, 'minutes');
  const key = keyForIndex(today - 5);
  saveValue(journal, key, id, 15);
  const low = timelineScores(journal);
  assert.ok(low(today - 5, today).height > 0);
  assert.equal(low(today - 4, today).height, 0);
  assert.ok(low(today - 3, today).height < 0);
  assert.ok(low(today - 2, today).height < low(today - 3, today).height);
  assert.equal(low(today - 6, today).count, 0);
  assert.equal(low(today, today).height, 0);
  assert.equal(low(today + 1, today).height, 0);
  saveValue(journal, key, id, 90);
  const high = timelineScores(journal);
  assert.ok(high(today - 5, today).height > low(today - 5, today).height);
  removeValue(journal, key, id);
  assert.ok(!journal.days[key]);
  assert.equal(timelineScores(journal)(today - 2, today).height, 0);
});

test('standout power compares activity count with the previous seven days', () => {
  for (const usual of [1, 10]) {
    const journal = { activities: [], days: {} };
    for (let index = 0; index < usual + 6; index++) activity(journal, index);
    for (let offset = -8; offset <= 0; offset++) {
      const count = offset === 0 ? usual + 6 : usual;
      for (let index = 0; index < count; index++) saveValue(journal, keyForIndex(today + offset), String(index), 5);
    }
    const score = timelineScores(journal);
    assert.equal(score(today - 1, today).power, 0);
    assert.ok(score(today, today).power > .5);
    assert.ok(score(today, today).height > score(today - 1, today).height);
  }
});

test('removing an activity preserves historical heights and power without retaining its values', () => {
  const journal = { activities: [], days: {} };
  const a = activity(journal, 1);
  const b = activity(journal, 2);
  for (const offset of [-3, -2, 0]) saveValue(journal, keyForIndex(today + offset), a.id, 10 + offset);
  saveValue(journal, keyForIndex(today), b.id, 18);
  const before = timelineScores(journal);
  removeActivity(journal, a.id);
  const after = timelineScores(journal);
  assert.deepEqual(journal.activities, [b]);
  assert.ok(Object.values(journal.days).every((day) => !(a.id in day.values)));
  for (let offset = -8; offset <= 1; offset++) {
    assert.deepEqual(after(today + offset, today), before(today + offset, today));
  }
});

test('dormant goals can count values belonging to a stable activity ID and date window', () => {
  const journal = { activities: [], days: {} };
  const item = activity(journal, 1, 'minutes');
  for (const offset of [-2, -1, 0]) saveValue(journal, keyForIndex(today + offset), item.id, 20);
  const goal = { id: 'goal-id', metric: 'minutes', amount: 50, repeat: 'range', start: '2026-12-30', end: '2027-01-01' };
  item.goals.push(goal);
  assert.equal(isGoal(goal), true);
  assert.equal(goalProgress(journal, item, goal, new Date(2026, 11, 31, 12)), 40);
});