const storageKey = 'checkin.timeline.v1';

export function readJournal() {
  const saved = localStorage.getItem(storageKey);
  return saved ? JSON.parse(saved) : { activities: [], days: {} };
}

export async function updateJournal(change) {
  const save = () => {
    const journal = readJournal();
    change(journal);
    localStorage.setItem(storageKey, JSON.stringify(journal));
    return journal;
  };

  return navigator.locks ? navigator.locks.request(storageKey, save) : save();
}

export function watchJournal(onChange) {
  window.addEventListener('storage', ({ key }) => {
    if (key === storageKey || key === null) onChange(readJournal());
  });
}