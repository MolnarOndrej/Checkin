import { dateOffset, dayKey, goalKey, weekStart } from './calendar.js';
import { setDialogTitle } from './dialog-title.js';
import {
  formatAmount, formatDate, formatQuantity, goalIncludes, goalProgress, goalsOverlap, goalUnit, goalWindow,
  isGoal, isMeasurement, metersForUnit, unitKey,
} from './measurements.js';

const byId = (id) => document.getElementById(id);
const todayKey = () => dayKey(new Date());
const goalLabel = (goal) => formatQuantity(goal.amount, goalUnit(goal));

function show(feedback, message, error = false) {
  feedback.textContent = message;
  feedback.toggleAttribute('data-error', error);
}

export function renderGoals(activities, date, entriesBetween, openGoalSettings) {
  const key = dayKey(date);
  const today = todayKey();
  const list = byId('activity-goals-list');
  const items = [];
  for (const activity of activities) {
    const goals = activity.goals ?? [];
    const current = goals.find((goal) => goalIncludes(goal, key));
    const upcoming = key === today && goals.filter((goal) => goal.start > today && !goal.stoppedOn)
      .sort((first, second) => first.start.localeCompare(second.start))[0];
    const goal = current ?? upcoming;
    if (!goal) continue;

    const item = document.createElement('li');
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'text-button';
    name.textContent = activity.text;
    name.setAttribute('aria-label', `Goal settings for ${activity.text}`);
    name.setAttribute('aria-haspopup', 'dialog');
    name.addEventListener('click', () => openGoalSettings(activity.text, name));
    const value = document.createElement('strong');
    const period = document.createElement('small');
    item.append(name, value);
    if (current) {
      const { start, end } = goalWindow(goal, date);
      const total = goalProgress(entriesBetween(start, end < today ? end : today), goalKey(activity), goal);
      value.textContent = `${formatAmount(total)} / ${goalLabel(goal)}`;
      const progress = document.createElement('progress');
      progress.max = goal.amount;
      progress.value = total;
      progress.setAttribute('aria-label', `${activity.text} goal progress`);
      progress.setAttribute('aria-valuetext', value.textContent);
      item.append(progress);
      period.textContent = `${formatDate(start)} – ${formatDate(end)}`;
    } else {
      value.textContent = goalLabel(goal);
      period.textContent = `Starts ${formatDate(goal.start)}`;
    }
    item.append(period);
    items.push(item);
  }
  list.replaceChildren(...items);
  byId('activity-goals-empty').hidden = items.length > 0;
}

export function setupTracking({ getActivity, saveActivity }) {
  const dialog = byId('activity-settings');
  const measurementForm = byId('measurement-form');
  const mode = byId('measurement-mode');
  const unit = byId('measurement-unit');
  const factor = byId('measurement-factor');
  const minutes = byId('measurement-minutes');
  const measurementFeedback = byId('measurement-feedback');
  let activityName;
  let opener;
  let factorUnit;

  function updateMeasurementFields() {
    const custom = mode.value === 'custom';
    const standardDistance = metersForUnit(unit.value) !== undefined;
    byId('measurement-custom').hidden = unit.disabled = !custom;
    byId('measurement-factor-field').hidden = standardDistance;
    factor.disabled = !custom || standardDistance;
    unit.required = custom;
  }

  mode.addEventListener('change', updateMeasurementFields);
  unit.addEventListener('input', () => {
    const current = unitKey(unit.value);
    if (current !== factorUnit) factor.value = '';
    factorUnit = current;
    updateMeasurementFields();
  });
  byId('close-activity-settings').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const replacement = Array.from(document.querySelectorAll('#pinned-list [data-tracking]'))
      .find((button) => button.getAttribute('aria-label') === opener?.getAttribute('aria-label'));
    (opener?.isConnected ? opener : replacement ?? byId('new-goal')).focus();
  });

  measurementForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let measurement;
    if (mode.value === 'custom') {
      measurement = { unit: unit.value.trim(), trackMinutes: minutes.checked };
      if (!factor.disabled && factor.value !== '') measurement.metersPerUnit = factor.valueAsNumber;
      if (!isMeasurement(measurement)) {
        show(measurementFeedback, 'Enter a unit and a positive distance per unit, or leave distance blank.', true);
        return;
      }
    }
    if (saveActivity(activityName, { measurement }, measurementFeedback)) {
      show(measurementFeedback, 'Activity settings saved.');
    }
  });

  return function openTracking(text, trigger) {
    activityName = text;
    opener = trigger;
    const measurement = getActivity(text)?.measurement;
    setDialogTitle(byId('activity-settings-title'), `Activity settings for ${text}`);
    mode.value = measurement ? 'custom' : 'minutes';
    unit.value = measurement?.unit ?? '';
    factorUnit = unitKey(unit.value);
    factor.value = measurement?.metersPerUnit ?? '';
    minutes.checked = measurement?.trackMinutes ?? true;
    show(measurementFeedback, '');
    updateMeasurementFields();
    dialog.showModal();
  };
}

export function setupGoalSettings({ getActivity, saveActivity, activityNames, selectedDate }) {
  const dialog = byId('goal-settings');
  const addGoal = byId('open-goal-settings');
  const activity = byId('goal-activity');
  const details = byId('new-activity-goal');
  const summary = details.querySelector('summary');
  const goalForm = byId('activity-goal-form');
  const metric = byId('activity-goal-metric');
  const amount = byId('activity-goal-amount');
  const goalUnitInput = byId('activity-goal-unit');
  const repeat = byId('activity-goal-repeat');
  const start = byId('activity-goal-start');
  const end = byId('activity-goal-end');
  const goalFeedback = byId('activity-goal-feedback');
  let opener;

  function updateGoalFields() {
    const custom = metric.value === 'amount';
    const days = metric.value === 'days';
    const range = repeat.value === 'range';
    const selectedWeek = repeat.value === 'week';
    amount.step = days ? '1' : 'any';
    amount.max = days && !range ? '7' : '1000000000';
    byId('activity-goal-amount-label').textContent = days ? 'Days' : custom ? 'Amount' : 'Minutes';
    byId('activity-goal-unit-field').hidden = goalUnitInput.disabled = !custom;
    goalUnitInput.required = custom;
    byId('activity-goal-start-field').hidden = start.disabled = selectedWeek;
    byId('activity-goal-end-field').hidden = end.disabled = !range;
    end.required = range;
    end.min = start.value;
    const metricHint = days
      ? 'Each day you work on this activity counts once, even without a measurement.'
      : custom && metersForUnit(goalUnitInput.value)
        ? 'Distance goals also count laps or other units with a saved distance.'
        : 'Only check-ins with a matching measurement count.';
    const monday = weekStart(selectedDate());
    byId('activity-goal-hint').textContent = selectedWeek
      ? `${formatDate(dayKey(monday))} – ${formatDate(dayKey(dateOffset(monday, 6)))}. ${metricHint}`
      : metricHint;
  }

  function renderGoalList() {
    const today = todayKey();
    const activityName = activity.value.trim();
    const goals = getActivity(activityName)?.goals ?? [];
    const list = byId('tracking-goals-list');
    list.replaceChildren(...goals.filter((goal) => !goal.stoppedOn && (!goal.end || goal.end >= today))
      .map((goal) => {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = goalLabel(goal);
        const schedule = document.createElement('small');
        schedule.textContent = goal.end
          ? `${formatDate(goal.start)} – ${formatDate(goal.end)}`
          : `Every week from ${formatDate(goal.start)}`;
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'text-button';
        stop.textContent = goal.start > today ? 'Cancel scheduled goal' : 'End before today';
        stop.addEventListener('click', () => {
          const latest = getActivity(activityName)?.goals ?? [];
          const active = latest.find(({ id }) => id === goal.id);
          if (!active || active.stoppedOn) {
            renderGoalList();
            return;
          }
          const updated = latest.map((saved) => saved.id === goal.id ? { ...saved, stoppedOn: todayKey() } : saved);
          if (saveActivity(activityName, { goals: updated }, goalFeedback)) {
            renderGoalList();
            summary.focus();
            show(goalFeedback, goal.start > today ? 'Scheduled goal canceled.' : 'Goal ended. Past progress is saved.');
          }
        });
        item.append(title, schedule, stop);
        return item;
      }));
  }

  function updateGoalActivity() {
    goalUnitInput.value = getActivity(activity.value)?.measurement?.unit ?? '';
    show(goalFeedback, '');
    updateGoalFields();
    renderGoalList();
  }

  activity.addEventListener('input', updateGoalActivity);
  activity.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || details.open) return;
    event.preventDefault();
    details.open = true;
    metric.focus();
  });
  metric.addEventListener('change', updateGoalFields);
  goalUnitInput.addEventListener('input', updateGoalFields);
  repeat.addEventListener('change', updateGoalFields);
  start.addEventListener('change', updateGoalFields);
  addGoal.addEventListener('click', () => openGoalSettings('', addGoal));
  byId('close-goal-settings').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const replacement = Array.from(document.querySelectorAll('#activity-goals-list button'))
      .find((button) => button.getAttribute('aria-label') === opener?.getAttribute('aria-label'));
    (opener?.isConnected ? opener : replacement ?? addGoal).focus();
  });

  goalForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const activityName = activity.value.trim();
    if (!activityName) {
      show(goalFeedback, 'Choose or enter an activity for this goal.', true);
      activity.focus();
      return;
    }
    const goal = {
      id: crypto.randomUUID(),
      metric: metric.value,
      amount: amount.valueAsNumber,
      start: start.value,
      repeat: repeat.value,
    };
    if (!goalUnitInput.disabled) goal.unit = goalUnitInput.value.trim();
    if (!end.disabled) goal.end = end.value;
    if (repeat.value === 'week') {
      const monday = weekStart(selectedDate());
      goal.repeat = 'range';
      goal.start = dayKey(monday);
      goal.end = dayKey(dateOffset(monday, 6));
    }
    if (!isGoal(goal)) {
      show(goalFeedback, 'Enter a positive goal amount, a unit if needed, and a valid schedule.', true);
      return;
    }
    const existing = getActivity(activityName)?.goals ?? [];
    if (existing.some((saved) => goalsOverlap(saved, goal))) {
      show(goalFeedback, 'This activity already has a goal in that period. Choose different dates or end the existing goal.', true);
      return;
    }
    if (saveActivity(activityName, { goals: [...existing, goal] }, goalFeedback)) {
      renderGoalList();
      amount.value = '';
      details.open = false;
      summary.focus();
      show(goalFeedback, 'Goal created.');
    }
  });

  function openGoalSettings(text, trigger) {
    opener = trigger;
    goalForm.reset();
    activity.value = text;
    start.value = dayKey(selectedDate());
    details.open = !text;
    const options = new Map(activityNames().filter(Boolean).map((name) => [goalKey({ text: name }), name]));
    byId('goal-activity-options').replaceChildren(...Array.from(options.values()).sort().map((name) => new Option(name)));
    updateGoalActivity();
    dialog.showModal();
  }

  return openGoalSettings;
}
