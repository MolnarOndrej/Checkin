import { dateLabel, dateOffset, dayKey, goalHasWork, monthStart, renderCalendar, weekStart } from './calendar.js';
import { celebrate, playOpening } from './celebration.js';

const byId = (id) => document.getElementById(id);
const grid = byId('calendar');
const trailRoute = byId('trail-route');
const trailWaypoints = byId('trail-waypoints');
const trailLength = trailRoute.getTotalLength();
const details = byId('details');
const nextTime = byId('next-time');
const nextPlan = byId('next-plan');
const form = byId('entry-form');
const hasScore = byId('has-score');
const score = byId('score');
const range = byId('score-range');
const notes = byId('notes');
const newGoal = byId('new-goal');
const goalList = byId('goal-list');
const feedback = byId('feedback');
const complete = byId('complete');
const save = byId('save');
const sound = byId('sound');
const entryPrefix = 'checkin.day.';
const soundKey = 'checkin.sound';
const cachedEntries = new Map();
let today = new Date();
let selected = today;
let month = monthStart(today);
let muted = false;
let displayedPlanKey;

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

function goalKey({ text }) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function updateCalendar(glow = false) {
  const workDays = renderCalendar({ grid, title: byId('calendar-title'), month, today, selected, entryFor });
  updateTrail(workDays, glow);
  byId('next').disabled = month >= monthStart(today);
}

function updateTrail(workDays, glow) {
  const lights = workDays.map((day) => {
    // Keep each date at the same spot in shorter months.
    const progress = (day - 1) / 30;
    const point = trailRoute.getPointAtLength(trailLength * progress);
    const light = document.createElementNS(trailRoute.namespaceURI, 'circle');
    light.setAttribute('cx', point.x);
    light.setAttribute('cy', point.y);
    light.setAttribute('r', 2.6 - progress);
    if (glow && day === selected.getDate()) light.classList.add('trail-glow');
    return light;
  });
  trailWaypoints.replaceChildren(...lights);
}

function updateWeek() {
  const start = weekStart(selected);
  const totals = new Map();
  for (let offset = 0; offset < 7; offset++) {
    const key = dayKey(dateOffset(start, offset));
    if (key > dayKey(today)) break;
    const worked = entryFor(key)?.goals.filter(goalHasWork) ?? [];
    const dailyGoals = new Map(worked.map((goal) => [goalKey(goal), goal.text]));
    for (const [name, text] of dailyGoals) {
      totals.set(name, { text, days: (totals.get(name)?.days ?? 0) + 1 });
    }
  }
  byId('week-title').textContent = dayKey(start) === dayKey(weekStart(today))
    ? 'This week on the trail' : 'That week on the trail';
  byId('week-empty').hidden = totals.size > 0;
  byId('week-goals').replaceChildren(...Array.from(totals.values(), ({ text, days }) => {
    const item = document.createElement('li');
    item.textContent = `${text} · ${days} ${days === 1 ? 'day' : 'days'}`;
    return item;
  }));
}

function updatePlanAndSuggestions(entry) {
  const key = dayKey(selected);
  const keys = new Set(cachedEntries.keys());
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const storageKey = localStorage.key(index);
      if (storageKey?.startsWith(entryPrefix)) keys.add(storageKey.slice(entryPrefix.length));
    }
  } catch {}

  const suggestions = new Map();
  let plan = entry?.nextPlan;
  displayedPlanKey = plan ? key : null;
  // A newer day of work closes the prior plan, while a gap or note-only day keeps it visible.
  let lookForPlan = key === dayKey(today) && !plan && !entry?.goals.some(goalHasWork);
  for (const previousKey of Array.from(keys).sort().reverse()) {
    if (previousKey >= key) continue;
    const previous = entryFor(previousKey);
    if (!previous) continue;
    if (lookForPlan && (previous.nextPlan || previous.goals.some(goalHasWork))) {
      plan = previous.nextPlan;
      displayedPlanKey = plan ? previousKey : null;
      lookForPlan = false;
    }
    for (const goal of previous.goals) {
      if (suggestions.size === 20) break;
      if (!suggestions.has(goalKey(goal))) suggestions.set(goalKey(goal), goal.text);
    }
    if (suggestions.size === 20 && !lookForPlan) break;
  }
  byId('recent-goals').replaceChildren(...Array.from(suggestions.values(), (text) => new Option(text)));
  byId('plan-reminder').hidden = !plan;
  byId('plan-preview').textContent = plan ?? '';
}

function updateSummary(entry) {
  const isToday = dayKey(selected) === dayKey(today);
  const tag = byId('day-tag');
  tag.textContent = isToday ? 'TODAY' : 'PAST DAY';
  byId('selected-date').textContent = dateLabel(selected);
  const title = byId('journal-title');
  const copy = byId('journal-copy');
  const worked = entry?.goals.filter(goalHasWork) ?? [];
  if (worked.length) {
    title.textContent = 'Work logged.';
    copy.textContent = describeWork(worked);
  } else if (entry?.score != null) {
    title.textContent = 'Day remembered.';
    copy.textContent = `Daily score: ${entry.score}%.`;
  } else if (entry) {
    title.textContent = 'Day remembered.';
    copy.textContent = 'Your check-in is saved.';
  } else {
    title.textContent = 'How did it go?';
    copy.textContent = 'Record the time or effort you put into your goals.';
  }
}

function describeWork(goals) {
  if (goals.length === 1) {
    const { text, minutes } = goals[0];
    return minutes ? `You put ${minutes} min into “${text}”.` : `You made time for “${text}”.`;
  }
  return `You made time for ${goals.length} goals.`;
}

function addGoalRow({ text, done, worked, minutes }) {
  const row = document.createElement('div');
  row.className = 'goal-row';
  const label = document.createElement('input');
  label.type = 'text';
  label.maxLength = 140;
  label.value = text;
  label.setAttribute('aria-label', 'Goal text');
  const status = document.createElement('select');
  status.append(new Option('No work logged', 'open'), new Option('Worked on it', 'worked'), new Option('Done', 'done'));
  status.value = done ? 'done' : worked ? 'worked' : 'open';
  const duration = document.createElement('input');
  duration.type = 'number';
  duration.min = '1';
  duration.max = '1440';
  duration.step = '1';
  duration.placeholder = 'Min';
  duration.value = minutes ?? '';
  const updateLabels = () => {
    const goal = label.value.trim() || 'goal';
    status.setAttribute('aria-label', `Progress for ${goal}`);
    duration.setAttribute('aria-label', `Optional minutes for ${goal}`);
  };
  updateLabels();
  label.addEventListener('input', updateLabels);
  status.addEventListener('change', () => {
    if (status.value === 'open') duration.value = '';
  });
  duration.addEventListener('input', () => {
    if (duration.value && status.value === 'open') status.value = 'worked';
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove goal');
  remove.addEventListener('click', () => {
    row.remove();
    newGoal.focus();
  });
  row.append(label, remove, status, duration);
  goalList.append(row);
  return status;
}

function commitNewGoal() {
  const text = newGoal.value.trim();
  if (!text) return;
  const status = addGoalRow({ text, worked: true });
  newGoal.value = '';
  return status;
}

function readGoals(allDone) {
  return Array.from(goalList.children, (row) => {
    const [text, duration] = row.querySelectorAll('input');
    const status = row.querySelector('select').value;
    const goal = { text: text.value.trim(), done: allDone || status === 'done' };
    if (!goal.done && status === 'worked') goal.worked = true;
    if (duration.value) goal.minutes = duration.valueAsNumber;
    return goal;
  }).filter((goal) => goal.text);
}

function loadForm(entry) {
  hasScore.checked = entry?.score != null;
  score.value = range.value = entry?.score ?? 80;
  notes.value = entry?.notes ?? '';
  nextPlan.value = entry?.nextPlan ?? '';
  newGoal.value = '';
  goalList.replaceChildren();
  entry?.goals.forEach(addGoalRow);
}

function viewDate(date, focusCalendar = false) {
  today = new Date();
  selected = date;
  month = monthStart(date);
  details.open = false;
  nextTime.open = false;
  const entry = entryFor(dayKey(date));
  loadForm(entry);
  updateSummary(entry);
  updateCalendar();
  updateWeek();
  updatePlanAndSuggestions(entry);
  announce();
  if (focusCalendar) grid.querySelector('[data-selected]')?.focus();
}

function saveEntry(percentage, allDone, source) {
  commitNewGoal();
  const invalidDuration = goalList.querySelector('input[type="number"]:invalid');
  if (invalidDuration) {
    announce('Enter whole minutes from 1 to 1440, or leave minutes blank.', true);
    invalidDuration.focus();
    return;
  }
  const origin = source.getBoundingClientRect();
  const key = dayKey(selected);
  const previous = entryFor(key);
  const entry = {
    score: percentage,
    notes: notes.value.trim(),
    goals: readGoals(allDone),
  };
  if (nextPlan.value.trim()) entry.nextPlan = nextPlan.value.trim();
  const hasContent = percentage !== null || entry.notes || entry.goals.length || entry.nextPlan;
  if (!hasContent && !previous) {
    announce('Add a goal, a note, a score, or a plan to save this day.', true);
    return;
  }
  try {
    if (hasContent) localStorage.setItem(entryPrefix + key, JSON.stringify(entry));
    else localStorage.removeItem(entryPrefix + key);
  } catch {
    announce('Checkin could not save to this browser. Your edits are still here.', true);
    return;
  }
  const previouslyWorked = new Set(previous?.goals.filter(goalHasWork).map(goalKey));
  const newWork = new Map(entry.goals.filter(goalHasWork).map((goal) => [goalKey(goal), goal]));
  for (const name of previouslyWorked) newWork.delete(name);
  const savedEntry = hasContent ? entry : undefined;
  updateSummary(savedEntry);
  updateCalendar(newWork.size > 0);
  updateWeek();
  updatePlanAndSuggestions(savedEntry);
  loadForm(savedEntry);
  if (newWork.size) {
    announce(`${describeWork(Array.from(newWork.values()))} Check-in saved.`);
    celebrate(origin, muted);
  } else {
    announce(hasContent ? 'Check-in saved.' : 'Check-in cleared.');
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
byId('add-goal').addEventListener('click', () => (commitNewGoal() ?? newGoal).focus());
newGoal.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    commitNewGoal()?.focus();
  }
});
complete.addEventListener('click', () => saveEntry(100, true, complete));
byId('edit-plan').addEventListener('click', () => {
  if (displayedPlanKey !== dayKey(selected)) {
    const [year, month, day] = displayedPlanKey.split('-').map(Number);
    viewDate(new Date(year, month - 1, day));
  }
  nextTime.open = true;
  nextPlan.focus();
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (hasScore.checked && (score.value === '' || !score.validity.valid)) {
    announce('Enter a score from 0 to 100, or uncheck Include a score.', true);
    details.open = true;
    score.focus();
    return;
  }
  saveEntry(hasScore.checked ? score.valueAsNumber : null, false, event.submitter ?? save);
});

viewDate(today);
playOpening();
