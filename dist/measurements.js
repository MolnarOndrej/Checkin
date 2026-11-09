import { dateOffset, dayKey, goalHasWork, goalKey, weekStart } from './calendar.js';

const numberFormat = new Intl.NumberFormat('en', { maximumSignificantDigits: 9 });
const shortDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
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
export const formatAmount = (amount) => numberFormat.format(amount);
export const formatDate = (key) => shortDate.format(new Date(key + 'T12:00:00'));
export const unitKey = (unit) => goalKey({ text: unit });
export const metersForUnit = (unit) => distanceUnits.get(unitKey(unit));
export const isAmount = (value) => Number.isFinite(value) && value >= 0 && value <= maxAmount;
export const isUnit = (value) => typeof value === 'string' && value.length <= 32 && Boolean(unitKey(value));
export const isFactor = (value) => isAmount(value) && value > 0;

export function formatQuantity(amount, unit) {
  const singular = amount === 1 && singularUnits.get(unit);
  return `${formatAmount(amount)} ${singular || unit}`;
}

export function isDateKey(value) {
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

export function isMeasurement(value) {
  return value && isUnit(value.unit)
    && typeof value.trackMinutes === 'boolean'
    && (value.metersPerUnit === undefined || isFactor(value.metersPerUnit));
}

export function distanceOf(measurement) {
  if (measurement?.amount === undefined) return undefined;
  const factor = metersForUnit(measurement.unit) ?? measurement.metersPerUnit;
  return factor === undefined ? undefined : measurement.amount * factor;
}

export function measurementSummary(measurement, minutes) {
  const pieces = [];
  if (measurement?.amount !== undefined) pieces.push(formatQuantity(measurement.amount, measurement.unit));
  if (minutes !== undefined) pieces.push(`${formatAmount(minutes)} min`);
  const derived = derivedMeasurementSummary(measurement, minutes);
  if (derived) pieces.push(derived);
  return pieces.join(' · ');
}

export function derivedMeasurementSummary(measurement, minutes) {
  const meters = distanceOf(measurement);
  if (meters === undefined) return '';
  const pieces = [];
  if (!metersForUnit(measurement.unit)) {
    pieces.push(meters < 1000 ? `${formatAmount(meters)} m` : `${formatAmount(meters / 1000)} km`);
  }
  if (minutes && meters > 0) {
    const seconds = Math.round(minutes * 60_000 / meters);
    if (Number.isSafeInteger(seconds)) {
      pieces.push(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min/km`);
    }
  }
  return pieces.join(' · ');
}

export function goalUnit(goal) {
  if (goal.metric === 'days') return 'days';
  if (goal.metric === 'minutes') return 'min';
  return goal.unit;
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

function amountFor(activity, goal) {
  if (goal.metric === 'minutes') return activity.minutes ?? 0;
  const measurement = activity.measurement;
  if (measurement?.amount === undefined) return 0;
  const factor = metersForUnit(goal.unit);
  if (factor) return (distanceOf(measurement) ?? 0) / factor;
  return unitKey(measurement.unit) === unitKey(goal.unit) ? measurement.amount : 0;
}

export function goalProgress(entries, activityKey, goal) {
  let total = 0;
  for (const entry of entries) {
    const matching = entry.goals.filter((activity) => goalHasWork(activity) && goalKey(activity) === activityKey);
    if (goal.metric === 'days') total += Number(matching.length > 0);
    else for (const activity of matching) total += amountFor(activity, goal);
  }
  return total;
}
