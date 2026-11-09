import { dateLabel, dateOffset, dayKey, goalHasWork, goalKey, monthStart, renderCalendar, weekStart } from './calendar.js';
import { celebrate, playOpening } from './celebration.js';
import { setupPinnedGoals } from './pinned-goals.js';
import { entryPrefix, setupBackup } from './backup.js';

const byId = (id) => document.getElementById(id);
const grid = byId('calendar');
const trailRoute = byId('trail-route');
const trailWaypoints = byId('trail-waypoints');
const trailLength = trailRoute.getTotalLength();
const details = byId('details');
const editPlan = byId('edit-plan');
const planEditor = byId('plan-editor');
const planFeedback = byId('plan-feedback');
const nextPlan = byId('next-plan');
const form = byId('entry-form');
const score = byId('score');
const notes = byId('notes');
const newGoal = byId('new-goal');
const goalList = byId('goal-list');
const feedback = byId('feedback');
const complete = byId('complete');
const save = byId('save');
const cachedEntries = new Map();
let today = new Date();
let selected = today;
let month = monthStart(today);
let muted = false;
let displayedPlanKey;
let editingPlanKey;
let pinnedNames = [];
let loadedDraft;

function setupAmbientEffects() {
  const scene = document.querySelector('.hero-scene');
  const effects = ['moon', 'stars', 'meteor', 'fireflies', 'river'];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let timer;

  function pickEffect() {
    const choices = effects.filter((effect) => effect !== scene.dataset.ambient);
    scene.dataset.ambient = choices[Math.floor(Math.random() * choices.length)];
  }

  function updateMotion() {
    clearInterval(timer);
    if (reducedMotion.matches) {
      delete scene.dataset.ambient;
      return;
    }
    pickEffect();
    timer = setInterval(pickEffect, 12_000);
  }

  reducedMotion.addEventListener('change', updateMotion);
  updateMotion();
}

function setupTrailMottos() {
  const title = byId('page-title');
  const firstLine = title.querySelector('span');
  const secondLine = title.querySelector('em');
  const mottos = [
    [firstLine.textContent, secondLine.textContent],
    ['One step', 'at a time.'],
    ['Steps', 'add up.'],
    ['Build', 'slowly.'],
    ['Begin', 'again.'],
    ['Keep', 'at it.'],
    ['Move', 'gently.'],
    ['Today', 'counts.'],
    ['Stay', 'steady.'],
    ['Let effort', 'lead.'],
  ];
  const storageKey = 'checkin.motto';
  let index;
  if (performance.getEntriesByType('navigation')[0]?.type === 'reload') {
    try {
      index = Number(sessionStorage.getItem(storageKey) ?? NaN);
    } catch {}
  }
  if (!Number.isInteger(index) || index < 0 || index >= mottos.length) {
    index = Math.floor(Math.random() * mottos.length);
  }

  function showMotto() {
    const [first, second] = mottos[index];
    firstLine.textContent = first;
    secondLine.textContent = second;
    try { sessionStorage.setItem(storageKey, String(index)); } catch {}
  }

  showMotto();
  setInterval(() => {
    index = (index + 1) % mottos.length;
    showMotto();
  }, 5 * 60 * 1000);
}

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

function updateGoalOptions() {
  const options = new Map(pinnedNames.map((text) => [goalKey({ text }), new Option(text)]));
  for (const option of byId('recent-goals').options) {
    const name = goalKey({ text: option.value });
    if (!options.has(name)) options.set(name, new Option(option.value));
  }
  byId('goal-options').replaceChildren(...options.values());
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
  displayedPlanKey = entry?.nextPlan ? key : null;
  let lookForPlan = key === dayKey(today) && !displayedPlanKey;
  for (const previousKey of Array.from(keys).sort().reverse()) {
    if (previousKey >= key) continue;
    const previous = entryFor(previousKey);
    if (!previous) continue;
    if (lookForPlan && previous.nextPlan) {
      displayedPlanKey = previousKey;
      lookForPlan = false;
    }
    for (const goal of previous.goals) {
      if (suggestions.size === 20) break;
      if (!suggestions.has(goalKey(goal))) suggestions.set(goalKey(goal), goal.text);
    }
    if (suggestions.size === 20 && !lookForPlan) break;
  }
  byId('recent-goals').replaceChildren(...Array.from(suggestions.values(), (text) => new Option(text)));
  updateGoalOptions();
  editPlan.hidden = !displayedPlanKey;
}

function updateSummary(entry) {
  const isToday = dayKey(selected) === dayKey(today);
  const tag = byId('day-tag');
  tag.textContent = isToday ? 'TODAY' : 'PAST DAY';
  byId('selected-date').textContent = dateLabel(selected);
  const copy = byId('journal-copy');
  const worked = entry?.goals.filter(goalHasWork) ?? [];
  copy.textContent = worked.length ? describeWork(worked) : '';
  if (entry?.score != null) {
    copy.textContent += `${worked.length ? ' ' : ''}Daily score: ${entry.score}%.`;
  }
  copy.hidden = !copy.textContent;
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
  const status = stageGoal(text);
  newGoal.value = '';
  return status;
}

function stageGoal(text) {
  const name = goalKey({ text });
  const existing = Array.from(goalList.querySelectorAll('input[type="text"]'))
    .find((input) => goalKey({ text: input.value }) === name);
  if (!existing) return addGoalRow({ text, worked: true });
  const status = existing.closest('.goal-row').querySelector('select');
  if (status.value === 'open') status.value = 'worked';
  return status;
}

function readGoals() {
  return Array.from(goalList.children, (row) => {
    const [text, duration] = row.querySelectorAll('input');
    const status = row.querySelector('select').value;
    const goal = { text: text.value.trim(), done: status === 'done' };
    if (!goal.done && status === 'worked') goal.worked = true;
    if (duration.value) goal.minutes = duration.valueAsNumber;
    return goal;
  }).filter((goal) => goal.text);
}

function draftState() {
  return JSON.stringify(Array.from(form.querySelectorAll('input, select, textarea'),
    (field) => [field.value, field.validity.badInput]));
}

function loadForm(entry) {
  score.value = entry?.score ?? '';
  notes.value = entry?.notes ?? '';
  newGoal.value = '';
  goalList.replaceChildren();
  entry?.goals.forEach(addGoalRow);
  loadedDraft = draftState();
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
  updateWeek();
  updatePlanAndSuggestions(entry);
  suggestPickup();
  announce();
  if (focusCalendar) grid.querySelector('[data-selected]')?.focus();
}

function hasEntryContent(entry) {
  return entry.score != null || entry.notes || entry.goals.length || entry.nextPlan;
}

function persistEntry(key, entry) {
  if (hasEntryContent(entry)) localStorage.setItem(entryPrefix + key, JSON.stringify(entry));
  else localStorage.removeItem(entryPrefix + key);
}

function saveEntry(percentage) {
  commitNewGoal();
  const invalidDuration = goalList.querySelector('input[type="number"]:invalid');
  if (invalidDuration) {
    announce('Enter whole minutes from 1 to 1440, or leave minutes blank.', true);
    invalidDuration.focus();
    return;
  }
  const origin = save.getBoundingClientRect();
  const key = dayKey(selected);
  const previous = entryFor(key);
  const entry = {
    score: percentage,
    notes: notes.value.trim(),
    goals: readGoals(),
  };
  if (previous?.nextPlan) entry.nextPlan = previous.nextPlan;
  const hasContent = hasEntryContent(entry);
  if (!hasContent && !previous) {
    announce('Add a goal, a note, or a score to save this day.', true);
    return;
  }
  try {
    persistEntry(key, entry);
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
  const loggedGoals = Array.from(newWork.values());
  suggestPickup(loggedGoals);
  announce(hasContent ? 'Check-in saved.' : 'Check-in cleared.');
  if (newWork.size) celebrate(origin, muted);
}

function navigateMonth(offset, button) {
  const target = monthStart(month, offset);
  const now = new Date();
  if (target > monthStart(now)) return;
  viewDate(target.getTime() === monthStart(now).getTime() ? now : target);
  if (button.disabled) byId('today').focus();
}

try { muted = localStorage.getItem('checkin.sound') === 'off'; } catch {}

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

byId('add-goal').addEventListener('click', () => (commitNewGoal() ?? newGoal).focus());
newGoal.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    commitNewGoal()?.focus();
  }
});
complete.addEventListener('click', () => {
  commitNewGoal();
  for (const status of goalList.querySelectorAll('select')) status.value = 'done';
  score.value = '100';
  announce('Ready to save with a score of 100%.');
  save.focus();
});
editPlan.addEventListener('click', () => {
  editingPlanKey = displayedPlanKey;
  const [year, month, day] = editingPlanKey.split('-').map(Number);
  byId('plan-date').textContent = dateLabel(new Date(year, month - 1, day));
  nextPlan.value = entryFor(editingPlanKey)?.nextPlan ?? '';
  planFeedback.textContent = '';
  planEditor.showModal();
});
byId('cancel-plan-edit').addEventListener('click', () => planEditor.close());
byId('plan-editor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const entry = { ...(entryFor(editingPlanKey) ?? { score: null, notes: '', goals: [] }) };
  const plan = nextPlan.value.trim();
  if (plan) entry.nextPlan = plan;
  else delete entry.nextPlan;
  try {
    persistEntry(editingPlanKey, entry);
  } catch {
    planFeedback.textContent = 'Checkin could not save this plan. Your edits are still here.';
    return;
  }
  updateCalendar();
  updatePlanAndSuggestions(entryFor(dayKey(selected)));
  planEditor.close();
  (editPlan.hidden ? save : editPlan).focus();
  announce(plan ? 'Plan saved.' : 'Plan cleared.');
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!score.validity.valid) {
    announce('Enter a whole score from 0 to 100, or leave it blank.', true);
    details.open = true;
    score.focus();
    return;
  }
  saveEntry(score.value === '' ? null : score.valueAsNumber);
});

const { suggestPickup, refreshGoals } = setupPinnedGoals((names) => {
  pinnedNames = names;
  updateGoalOptions();
}, announce);
viewDate(today);
setupBackup({
  canRestore: (records) => !records.some(([key]) => key === entryPrefix + dayKey(selected))
    || draftState() === loadedDraft,
  onRestore: (added) => {
    const key = dayKey(selected);
    const entry = entryFor(key);
    if (added.has(entryPrefix + key)) loadForm(entry);
    refreshGoals();
    updateSummary(entry);
    updateCalendar();
    updateWeek();
    updatePlanAndSuggestions(entry);
  },
});
setupAmbientEffects();
setupTrailMottos();
playOpening();
