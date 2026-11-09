import { dayKey, goalKey } from './calendar.js';
import { isAmount, isDateKey, isGoal, isMeasurement } from './measurements.js';
import { showFeedback } from './feedback.js';

export const entryPrefix = 'checkin.day.';
export const pinnedGoalPrefix = 'checkin.pinned.';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isIntegerIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const optionalText = (value) => value === undefined || typeof value === 'string';
const countLabel = (count, name) => `${count} ${name}${count === 1 ? '' : 's'}`;

function isDayEntry(value) {
  return isRecord(value)
    && (value.score == null || isIntegerIn(value.score, 0, 100))
    && optionalText(value.notes)
    && optionalText(value.nextPlan)
    && Array.isArray(value.goals)
    && value.goals.every((goal) => isRecord(goal) && typeof goal.text === 'string'
      && typeof goal.done === 'boolean'
      && (goal.worked === undefined || typeof goal.worked === 'boolean')
      && (goal.minutes === undefined || isIntegerIn(goal.minutes, 1, 1440))
      && (goal.measurement === undefined || (isRecord(goal.measurement) && isMeasurement(goal.measurement)
        && (goal.measurement.amount === undefined || isAmount(goal.measurement.amount)))));
}

function isValidRecord(key, value) {
  if (key.startsWith(entryPrefix)) {
    return isDateKey(key.slice(entryPrefix.length)) && isDayEntry(value);
  }
  return key.startsWith(pinnedGoalPrefix)
    && isRecord(value) && typeof value.text === 'string' && Boolean(goalKey(value))
    && key === pinnedGoalPrefix + goalKey(value)
    && typeof value.pinned === 'boolean'
    && optionalText(value.plan) && optionalText(value.fallback) && optionalText(value.pickup)
    && (value.measurement === undefined || (isRecord(value.measurement) && isMeasurement(value.measurement)))
    && (value.goals === undefined || (Array.isArray(value.goals) && value.goals.every(isGoal)));
}

function parseBackup(text) {
  const backup = JSON.parse(text);
  if (!isRecord(backup) || backup.format !== 'checkin' || backup.version !== 1 || !isRecord(backup.records)) {
    throw new Error('Unsupported backup format');
  }
  const records = Object.entries(backup.records);
  if (!records.every(([key, value]) => isValidRecord(key, value))) {
    throw new Error('Invalid Checkin data');
  }
  return records.map(([key, value]) => [key, JSON.stringify(value)]);
}

function downloadBackup() {
  const records = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(entryPrefix) && !key?.startsWith(pinnedGoalPrefix)) continue;
    const saved = localStorage.getItem(key);
    if (saved === null) continue;
    const value = JSON.parse(saved);
    if (!isValidRecord(key, value)) throw new Error('Invalid Checkin data');
    records[key] = value;
  }
  const data = JSON.stringify({ format: 'checkin', version: 1, records }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `checkin-backup-${dayKey(new Date())}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function restoreRecords(records) {
  const added = new Map();
  try {
    for (const [key, value] of records) {
      if (localStorage.getItem(key) !== null) continue;
      localStorage.setItem(key, value);
      added.set(key, value);
    }
  } catch (error) {
    for (const [key, value] of added) {
      if (localStorage.getItem(key) === value) localStorage.removeItem(key);
    }
    throw error;
  }
  return added;
}

export function setupBackup({ canRestore, onRestore }) {
  const dialog = document.getElementById('backup-dialog');
  const file = document.getElementById('backup-file');
  const restore = document.getElementById('restore-backup');
  const feedback = document.getElementById('backup-feedback');
  const downloadFeedback = document.getElementById('download-feedback');
  let records = [];
  let selection = 0;

  function show(message, error) {
    showFeedback(feedback, message, error);
  }

  document.getElementById('open-backup').addEventListener('click', () => {
    selection++;
    file.value = '';
    records = [];
    restore.hidden = true;
    showFeedback(downloadFeedback);
    show('');
    dialog.showModal();
  });
  document.getElementById('close-backup').addEventListener('click', () => dialog.close());
  document.getElementById('download-backup').addEventListener('click', () => {
    try {
      downloadBackup();
      showFeedback(downloadFeedback, 'Backup download started.');
    } catch {
      showFeedback(downloadFeedback, 'Checkin could not export the saved data from this browser.', true);
    }
  });

  file.addEventListener('change', async () => {
    const currentSelection = ++selection;
    const chosen = file.files[0];
    records = [];
    restore.hidden = true;
    show('');
    if (!chosen) return;
    try {
      const parsed = parseBackup(await chosen.text());
      if (currentSelection !== selection || !dialog.open) return;
      records = parsed.filter(([key]) => localStorage.getItem(key) === null);
      const days = records.filter(([key]) => key.startsWith(entryPrefix)).length;
      const skipped = parsed.length - records.length;
      const ready = `${countLabel(days, 'check-in')} and ${countLabel(records.length - days, 'activity record')} ready to restore.`;
      show(`${ready} This browser already has ${countLabel(skipped, 'record')} from the backup.`);
      restore.hidden = records.length === 0;
    } catch {
      if (currentSelection === selection && dialog.open) {
        show('Checkin could not read this backup. Choose a valid Checkin backup file.', true);
      }
    }
  });

  restore.addEventListener('click', () => {
    let added;
    try {
      const missing = records.filter(([key]) => localStorage.getItem(key) === null);
      if (!canRestore(missing)) {
        show('Save your current check-in edits before restoring this date.', true);
        return;
      }
      added = restoreRecords(missing);
    } catch {
      show('Checkin could not restore the backup. Check browser storage and try again.', true);
      return;
    }
    restore.hidden = true;
    file.value = '';
    records = [];
    file.focus();
    show(added.size ? `Restored ${countLabel(added.size, 'record')}.` : 'All of these records are already in this browser.');
    if (added.size) onRestore(added);
  });
}
