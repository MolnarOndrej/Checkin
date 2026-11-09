export const entryPrefix = 'checkin.day.';
export const activityPrefix = 'checkin.pinned.';

const cachedEntries = new Map();

function* storageKeys() {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key !== null) yield key;
  }
}

export function entryFor(date) {
  try {
    const entry = JSON.parse(localStorage.getItem(entryPrefix + date));
    if (entry) cachedEntries.set(date, entry);
    else cachedEntries.delete(date);
  } catch {
    // Keep this visit usable if browser storage is blocked.
  }
  return cachedEntries.get(date);
}

export function entryDates() {
  const dates = new Set(cachedEntries.keys());
  try {
    for (const key of storageKeys()) {
      if (key.startsWith(entryPrefix)) dates.add(key.slice(entryPrefix.length));
    }
  } catch {}
  return dates;
}

export function entriesBetween(start, end) {
  return Array.from(entryDates())
    .filter((date) => date >= start && date <= end)
    .map(entryFor)
    .filter(Boolean);
}

export function saveDay(date, entry) {
  const key = entryPrefix + date;
  if (entry === undefined) {
    localStorage.removeItem(key);
    cachedEntries.delete(date);
  } else {
    localStorage.setItem(key, JSON.stringify(entry));
    cachedEntries.set(date, entry);
  }
}

export function readActivity(name) {
  return JSON.parse(localStorage.getItem(activityPrefix + name));
}

export function* activityRecords() {
  for (const key of storageKeys()) {
    if (!key.startsWith(activityPrefix)) continue;
    const name = key.slice(activityPrefix.length);
    const activity = readActivity(name);
    if (activity) yield [name, activity];
  }
}

export function updateActivity(name, fields, defaults) {
  const activity = { ...defaults, ...readActivity(name), ...fields };
  localStorage.setItem(activityPrefix + name, JSON.stringify(activity));
  return activity;
}

export function* backupRecords() {
  for (const key of storageKeys()) {
    if (!key.startsWith(entryPrefix) && !key.startsWith(activityPrefix)) continue;
    const saved = localStorage.getItem(key);
    if (saved !== null) yield [key, JSON.parse(saved)];
  }
}

export function missingRecords(records) {
  return records.filter(([key]) => localStorage.getItem(key) === null);
}

export function restoreRecords(records) {
  const added = new Map();
  try {
    for (const [key, record] of records) {
      if (localStorage.getItem(key) !== null) continue;
      const value = JSON.stringify(record);
      localStorage.setItem(key, value);
      added.set(key, value);
    }
  } catch (error) {
    for (const [key, value] of added) {
      if (localStorage.getItem(key) === value) localStorage.removeItem(key);
    }
    throw error;
  }
  return new Set(added.keys());
}
