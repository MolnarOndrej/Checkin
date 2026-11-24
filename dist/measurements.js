import { dateOffset, dayKey, goalKey, weekStart } from './calendar.js';

const numberFormat = new Intl.NumberFormat('en', { maximumSignificantDigits: 9 });
const distanceUnits = new Map([
  ['m', 1], ['meter', 1], ['meters', 1], ['metre', 1], ['metres', 1],
  ['km', 1000], ['kilometer', 1000], ['kilometers', 1000], ['kilometre', 1000], ['kilometres', 1000],
  ['mi', 1609.344], ['mile', 1609.344], ['miles', 1609.344],
]);
const singularUnits = new Map([
  ['days', 'day'], ['laps', 'lap'], ['sets', 'set'], ['reps', 'rep'], ['pages', 'page'],
  ['meters', 'meter'], ['metres', 'metre'], ['kilometers', 'kilometer'], ['kilometres', 'kilometre'], ['miles', 'mile'],
]);

export const maxAmount = 1_000_000_000;
const unitKey = (unit) => goalKey({ text: unit });
export const isUnit = (value) => typeof value === 'string' && value.length <= 32 && Boolean(unitKey(value));
export const isFactor = (value) => Number.isFinite(value) && value > 0 && value <= maxAmount;

export function formatQuantity(amount, unit) {
  const singular = amount === 1 && singularUnits.get(unitKey(unit));
  return `${numberFormat.format(amount)} ${singular || unit}`;
}

function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isGoal(goal) {
  return goal && typeof goal.id === 'string'
    && ['days', 'amount', 'minutes'].includes(goal.metric)
    && isFactor(goal.amount)
    && (goal.metric !== 'days' || (Number.isInteger(goal.amount) && (goal.repeat !== 'weekly' || goal.amount <= 7)))
    && (goal.metric === 'amount' ? isUnit(goal.unit) : goal.unit === undefined)
    && isDateKey(goal.start)
    && (goal.repeat === 'weekly' ? goal.end === undefined : goal.repeat === 'range' && isDateKey(goal.end) && goal.end >= goal.start)
    && (goal.stoppedOn === undefined || isDateKey(goal.stoppedOn));
}

export function goalIncludes(goal, key) {
  return key >= goal.start && (!goal.end || key <= goal.end) && (!goal.stoppedOn || key < goal.stoppedOn);
}

export function goalsOverlap(first, second) {
  const start = first.start > second.start ? first.start : second.start;
  return goalIncludes(first, start) && goalIncludes(second, start);
}

export function goalWindow(goal, date) {
  let { start, end } = goal;
  if (goal.repeat === 'weekly') {
    const monday = weekStart(date);
    const mondayKey = dayKey(monday);
    if (mondayKey > start) start = mondayKey;
    end = dayKey(dateOffset(monday, 6));
  }
  if (goal.stoppedOn && goal.stoppedOn <= end) {
    end = dayKey(dateOffset(new Date(goal.stoppedOn + 'T12:00:00'), -1));
  }
  return { start, end };
}

function amountFor(activity, goal, value) {
  if (goal.metric === 'days') return 1;
  if (goal.metric === 'minutes') return activity.type === 'minutes' ? value.amount : 0;
  if (activity.type !== 'custom') return 0;
  const source = unitKey(activity.unit);
  const target = unitKey(goal.unit);
  if (source === target) return value.amount;
  const sourceFactor = distanceUnits.get(source);
  const targetFactor = distanceUnits.get(target);
  return sourceFactor && targetFactor ? value.amount * sourceFactor / targetFactor : 0;
}

export function goalProgress(journal, activity, goal, date) {
  const { start, end } = goalWindow(goal, date);
  let total = 0;
  for (const [key, day] of Object.entries(journal.days)) {
    const value = day.values[activity.id];
    if (value && key >= start && key <= end) total += amountFor(activity, goal, value);
  }
  return total;
}