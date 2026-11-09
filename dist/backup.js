import { dayKey, goalKey } from './calendar.js';
import { isAmount, isDateKey, isGoal, isMeasurement } from './measurements.js';
import { showFeedback } from './feedback.js';
import { activityPrefix, backupRecords, entryPrefix, missingRecords, restoreRecords } from './journal-storage.js';

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
  return key.startsWith(activityPrefix)
    && isRecord(value) && typeof value.text === 'string' && Boolean(goalKey(value))
    && key === activityPrefix + goalKey(value)
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
  return records;
}

function downloadBackup() {
  const records = {};
  for (const [key, value] of backupRecords()) {
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

export function setupBackup({ canRestore, onRestore }) {
  const dialog = document.getElementById('backup-dialog');
  const file = document.getElementById('backup-file');
  const restore = document.getElementById('restore-backup');
  const feedback = document.getElementById('backup-feedback');
  const downloadFeedback = document.getElementById('download-feedback');
  const status = document.getElementById('backup-status');
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
    showFeedback(status);
    showFeedback(downloadFeedback);
    show('');
    dialog.showModal();
  });
  document.getElementById('close-backup').addEventListener('click', () => dialog.close());
  document.getElementById('download-backup').addEventListener('click', () => {
    try {
      downloadBackup();
    } catch {
      showFeedback(downloadFeedback, 'Checkin could not export the saved data from this browser.', true);
      return;
    }
    dialog.close();
    showFeedback(status, 'Backup download started.');
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
      records = missingRecords(parsed);
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
      const missing = missingRecords(records);
      if (!canRestore(missing)) {
        show('Save your current check-in edits before restoring this date.', true);
        return;
      }
      added = restoreRecords(missing);
    } catch {
      show('Checkin could not restore the backup. Check browser storage and try again.', true);
      return;
    }
    if (added.size) onRestore(added);
    dialog.close();
    showFeedback(status, added.size ? `Restored ${countLabel(added.size, 'record')}.` : 'All of these records are already in this browser.');
  });
}
