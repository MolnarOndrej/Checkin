import { dateLabel, dayKey, monthStart, renderCalendar } from './calendar.js';
import { celebrate, playOpening } from './celebration.js';

const byId = (id) => document.getElementById(id);
const grid = byId('calendar');
const details = byId('details');
const form = byId('entry-form');
const hasScore = byId('has-score');
const score = byId('score');
const range = byId('score-range');
const notes = byId('notes');
const newGoal = byId('new-goal');
const goalList = byId('goal-list');
const feedback = byId('feedback');
const complete = byId('complete');
const sound = byId('sound');
const entryPrefix = 'checkin.day.';
const soundKey = 'checkin.sound';
const cachedEntries = new Map();
let today = new Date();
let selected = today;
let month = monthStart(today);
let muted = false;

function entryFor(key) {
  try {
    const entry = JSON.parse(localStorage.getItem(entryPrefix + key));
    if (entry) cachedEntries.set(key, entry);
    else cachedEntries.delete(key);
  } catch {
    // Keep this visit usable if browser storage is blocked.
  }
  return cachedEntries.get(key);
}

function announce(message = '', error = false) {
  feedback.textContent = message;
  feedback.toggleAttribute('data-error', error);
}

function updateCalendar() {
  const logged = renderCalendar({ grid, title: byId('calendar-title'), month, today, selected, entryFor });
  byId('next').disabled = month >= monthStart(today);
  byId('logged-count').textContent = `${logged} ${logged === 1 ? 'day' : 'days'} recorded`;
  byId('progress-copy').textContent = month.getTime() === monthStart(today).getTime()
    ? 'On the trail this month' : 'On the trail that month';
}

function updateSummary(entry) {
  const isToday = dayKey(selected) === dayKey(today);
  const tag = byId('day-tag');
  tag.textContent = isToday ? 'TODAY' : 'PAST DAY';
  byId('selected-date').textContent = dateLabel(selected);
  const title = byId('journal-title');
  const copy = byId('journal-copy');
  if (entry?.score === 100) {
    title.textContent = 'Quest complete!';
    copy.textContent = 'You gave this day everything you set out to do.';
  } else if (entry?.score != null) {
    title.textContent = `${entry.score}% complete`;
    copy.textContent = 'You took a moment to check in. That counts.';
  } else if (entry) {
    title.textContent = 'Day remembered.';
    copy.textContent = 'Your details are saved. You can add a score anytime.';
  } else {
    title.textContent = 'How did it go?';
    copy.textContent = 'Mark the win or take a moment to reflect.';
  }
}

function addGoalRow({ text, done }) {
  const row = document.createElement('div');
  row.className = 'goal-row';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = done;
  checkbox.setAttribute('aria-label', 'Mark goal done');
  const label = document.createElement('input');
  label.type = 'text';
  label.maxLength = 140;
  label.value = text;
  label.setAttribute('aria-label', 'Goal text');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove goal');
  remove.addEventListener('click', () => {
    row.remove();
    newGoal.focus();
  });
  row.append(checkbox, label, remove);
  goalList.append(row);
}

function commitNewGoal() {
  const text = newGoal.value.trim();
  if (!text) return;
  addGoalRow({ text, done: false });
  newGoal.value = '';
}

function readGoals(allDone) {
  commitNewGoal();
  return Array.from(goalList.children, (row) => {
    const [checkbox, text] = row.querySelectorAll('input');
    return { text: text.value.trim(), done: allDone || checkbox.checked };
  }).filter((goal) => goal.text);
}

function loadForm(entry) {
  hasScore.checked = entry?.score != null;
  score.value = range.value = entry?.score ?? 80;
  notes.value = entry?.notes ?? '';
  newGoal.value = '';
  goalList.replaceChildren();
  entry?.goals.forEach(addGoalRow);
}

function viewDate(date, focusCalendar = false) {
  today = new Date();
  selected = date;
  month = monthStart(date);
  details.open = false;
  const entry = entryFor(dayKey(date));
  loadForm(entry);
  updateSummary(entry);
  updateCalendar();
  announce();
  if (focusCalendar) grid.querySelector('[data-selected]')?.focus();
}

function saveEntry(percentage, allDone, source) {
  const origin = source.getBoundingClientRect();
  const key = dayKey(selected);
  const previous = entryFor(key);
  const entry = {
    score: percentage,
    notes: notes.value.trim(),
    goals: readGoals(allDone),
  };
  const hasContent = percentage !== null || entry.notes || entry.goals.length;
  if (!hasContent && !previous) {
    announce('Add a score, a goal, or a note to save this day.', true);
    return;
  }
  try {
    if (hasContent) localStorage.setItem(entryPrefix + key, JSON.stringify(entry));
    else localStorage.removeItem(entryPrefix + key);
  } catch {
    announce('Checkin could not save to this browser. Your edits are still here.', true);
    return;
  }
  updateSummary(hasContent ? entry : undefined);
  updateCalendar();
  loadForm(hasContent ? entry : undefined);
  details.open = false;
  if (source !== complete) details.querySelector('summary').focus();
  announce(hasContent ? 'Check-in saved.' : 'Check-in cleared.');
  if (percentage !== null && previous?.score !== percentage) {
    const stamp = grid.querySelector('[data-selected] .day-mark');
    stamp?.classList.add('day-mark-pending');
    celebrate(origin, percentage, muted, () => stamp?.classList.remove('day-mark-pending'));
  }
}

function navigateMonth(offset, button) {
  const target = monthStart(month, offset);
  const now = new Date();
  if (target > monthStart(now)) return;
  viewDate(target.getTime() === monthStart(now).getTime() ? now : target);
  if (button.disabled) byId('today').focus();
}

function updateSound() {
  sound.setAttribute('aria-pressed', String(!muted));
  sound.querySelector('use').setAttribute('href', muted ? '#sound-off' : '#sound-on');
  sound.querySelector('span').textContent = muted ? 'Sound off' : 'Sound on';
}

try { muted = localStorage.getItem(soundKey) === 'off'; } catch {}
updateSound();
sound.addEventListener('click', () => {
  muted = !muted;
  updateSound();
  try { localStorage.setItem(soundKey, muted ? 'off' : 'on'); } catch {}
});

grid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-day]');
  if (button && !button.hasAttribute('data-selected')) {
    viewDate(new Date(month.getFullYear(), month.getMonth(), Number(button.dataset.day)), true);
  }
});
byId('previous').addEventListener('click', (event) => navigateMonth(-1, event.currentTarget));
byId('next').addEventListener('click', (event) => navigateMonth(1, event.currentTarget));
byId('today').addEventListener('click', () => {
  const now = new Date();
  if (dayKey(selected) !== dayKey(now)) viewDate(now);
});

range.addEventListener('input', () => {
  score.value = range.value;
  hasScore.checked = true;
});
score.addEventListener('input', () => {
  hasScore.checked = true;
  if (score.value !== '' && score.validity.valid) range.value = score.value;
});
byId('add-goal').addEventListener('click', () => {
  commitNewGoal();
  newGoal.focus();
});
newGoal.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    commitNewGoal();
  }
});
complete.addEventListener('click', () => saveEntry(100, true, complete));
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (hasScore.checked && (score.value === '' || !score.validity.valid)) {
    announce('Enter a score from 0 to 100, or uncheck Include a score.', true);
    score.focus();
    return;
  }
  saveEntry(hasScore.checked ? score.valueAsNumber : null, false, event.submitter ?? complete);
});

viewDate(today);
playOpening();
