import { isDayKey } from './calendar.js';
import { isAmount, isUnit, normalizeLabel } from './measurements.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isActivityType = (value) => value === 'minutes' || value === 'custom';
const isEffort = (value) => Number.isFinite(value) && value >= 0;

function isActivity(activity) {
  return isRecord(activity) && typeof activity.id === 'string' && Boolean(activity.id)
    && typeof activity.text === 'string' && Boolean(normalizeLabel(activity.text))
    && isActivityType(activity.type) && isUnit(activity.unit);
}

function isLog(value) {
  return isRecord(value) && isAmount(value.amount) && isEffort(value.effort)
    && (value.type == null || isActivityType(value.type))
    && (value.unit == null || isUnit(value.unit));
}

function isDay(day) {
  if (!isRecord(day) || !isRecord(day.values) || !Object.values(day.values).every(isLog)) return false;
  const { retired } = day;
  return retired == null || (isRecord(retired) && Number.isSafeInteger(retired.count)
    && retired.count >= 0 && isEffort(retired.effort));
}

export function isJournal(journal) {
  return isRecord(journal) && Array.isArray(journal.activities) && journal.activities.every(isActivity)
    && isRecord(journal.days) && Object.entries(journal.days).every(([key, day]) => isDayKey(key) && isDay(day));
}

export function logFor(values, activityId) {
  return values && Object.hasOwn(values, activityId) ? values[activityId] : undefined;
}

function validateActivity(journal, activity, current) {
  if (!isActivity(activity)) throw new Error('Enter a name and a valid unit.');
  const name = normalizeLabel(activity.text);
  const others = journal.activities.filter((existing) => existing !== current);
  if (others.some((existing) => normalizeLabel(existing.text) === name)) {
    throw new Error('An activity with this name already exists.');
  }
  if (others.some(({ id }) => id === activity.id)) throw new Error('This activity already exists.');
}

export function createActivity(journal, activity) {
  validateActivity(journal, activity);
  journal.activities.push(activity);
}

export function editActivity(journal, details) {
  const activity = journal.activities.find(({ id }) => id === details.id);
  if (!activity) throw new Error('This activity was removed.');
  validateActivity(journal, details, activity);

  if (activity.unit !== details.unit || activity.type !== details.type) {
    for (const day of Object.values(journal.days)) {
      const value = logFor(day.values, activity.id);
      if (!value) continue;
      value.type ??= activity.type;
      value.unit ??= activity.unit;
    }
  }
  Object.assign(activity, { text: details.text, type: details.type, unit: details.unit });
}

function effortFor(amount, type) {
  const effort = Math.log1p(amount / (type === 'minutes' ? 30 : 1));
  return effort / (effort + 1.7);
}

function validateDay(key) {
  if (!isDayKey(key)) throw new Error('Choose a valid day.');
}

function writeLog(journal, key, activityId, amount, editing) {
  validateDay(key);
  const activity = journal.activities.find(({ id }) => id === activityId);
  if (!activity) throw new Error('This activity was removed. Close the editor to refresh the list.');
  if (!isAmount(amount)) throw new Error('Enter a value greater than zero.');

  const previous = logFor(journal.days[key]?.values, activityId);
  if (editing && !previous) throw new Error('This log was removed.');
  if (!editing && previous) throw new Error('This activity already has a log for this day.');

  const day = journal.days[key] ??= { values: {} };
  const type = previous?.type ?? activity.type;
  const unit = previous?.unit ?? activity.unit;
  const value = { ...previous, amount, type, unit, effort: effortFor(amount, type) };
  day.values = { ...day.values, [activityId]: value };
}

export function addLog(journal, key, activityId, amount) {
  writeLog(journal, key, activityId, amount, false);
}

export function editLog(journal, key, activityId, amount) {
  writeLog(journal, key, activityId, amount, true);
}

export function removeLog(journal, key, activityId) {
  validateDay(key);
  const day = journal.days[key];
  if (!day) return;
  delete day.values[activityId];
  if (!day.retired && Object.keys(day.values).length === 0) delete journal.days[key];
}

export function removeActivity(journal, activityId) {
  journal.activities = journal.activities.filter(({ id }) => id !== activityId);
  for (const day of Object.values(journal.days)) {
    const value = logFor(day.values, activityId);
    if (!value) continue;
    // Keep only the anonymous contribution to the historical graph.
    const retired = day.retired ??= { count: 0, effort: 0 };
    retired.count += 1;
    retired.effort += value.effort;
    delete day.values[activityId];
  }
}
