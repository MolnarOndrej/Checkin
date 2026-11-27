import * as journalData from './journal-data.js';

const storageKey = 'daytrack.timeline.v1';
const legacyStorageKey = 'checkin.timeline.v1';

function readJournal() {
  try {
    const saved = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey);
    if (saved === null) return { activities: [], days: {} };
    const journal = JSON.parse(saved);
    if (journalData.isJournal(journal)) return journal;
  } catch {
    // Corrupt data or unavailable storage should leave the original value untouched.
  }
  throw new Error('Could not read your saved journal.');
}

async function updateJournal(change, ...args) {
  const save = () => {
    const journal = readJournal();
    change(journal, ...args);
    localStorage.setItem(storageKey, JSON.stringify(journal));
    return journal;
  };

  return navigator.locks ? navigator.locks.request(storageKey, save) : save();
}

export const journalStore = {
  async load() {
    return readJournal();
  },
  createActivity(activity) {
    return updateJournal(journalData.createActivity, activity);
  },
  editActivity(activity) {
    return updateJournal(journalData.editActivity, activity);
  },
  removeActivity(activityId) {
    return updateJournal(journalData.removeActivity, activityId);
  },
  addLog(key, activityId, amount) {
    return updateJournal(journalData.addLog, key, activityId, amount);
  },
  editLog(key, activityId, amount) {
    return updateJournal(journalData.editLog, key, activityId, amount);
  },
  removeLog(key, activityId) {
    return updateJournal(journalData.removeLog, key, activityId);
  },
  subscribe(onChange) {
    window.addEventListener('storage', ({ key, storageArea }) => {
      if (storageArea === localStorage && (key === null || key === storageKey || key === legacyStorageKey)) {
        onChange();
      }
    });
  },
};
