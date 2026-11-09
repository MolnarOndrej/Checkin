import { goalKey } from './calendar.js';
import { pinnedGoalPrefix as prefix } from './backup.js';
import { setDialogTitle } from './dialog-title.js';

export function setupPinnedGoals(updateActivities, announcePickup, openTracking) {
  const list = document.getElementById('pinned-list');
  const template = document.getElementById('pinned-activity-card');
  const pinName = document.getElementById('pin-name');
  const pinFeedback = document.getElementById('pin-feedback');
  const dialog = document.getElementById('activity-editor');
  const editorFeedback = document.getElementById('activity-editor-feedback');
  const plan = document.getElementById('activity-plan');
  const fallback = document.getElementById('activity-fallback');
  const pickup = document.getElementById('activity-pickup');
  const complete = document.getElementById('complete-activity-plan');
  const dismiss = document.getElementById('dismiss-activity-plan');
  const suggestions = document.getElementById('pickup-suggestions');
  const suggestionButtons = new Map();
  const editButtons = new Map();
  let pinned = new Map();
  let recentlyLogged = [];
  let editingKey;
  let editingPickup = false;

  function readGoal(key) {
    return JSON.parse(localStorage.getItem(key));
  }

  function saveGoal(key, fields, feedback) {
    try {
      const goal = { ...readGoal(key), ...fields };
      localStorage.setItem(key, JSON.stringify(goal));
      return goal;
    } catch {
      feedback.textContent = 'Checkin could not save this activity in your browser.';
      return null;
    }
  }

  function openEditor(key, goal, focusPickup = false) {
    editingKey = key;
    editingPickup = focusPickup;
    setDialogTitle(document.getElementById('activity-editor-title'), `Activity plan for ${goal.text}`);
    plan.value = goal.plan ?? '';
    fallback.value = goal.fallback ?? '';
    pickup.value = goal.pickup ?? '';
    complete.hidden = dismiss.hidden = !goal.plan;
    editorFeedback.textContent = '';
    dialog.showModal();
    if (focusPickup) pickup.focus();
  }

  function renderRow(key, goal) {
    const row = template.content.firstElementChild.cloneNode(true);
    row.querySelector('span').textContent = goal.text;
    const tracking = row.querySelector('[data-tracking]');
    tracking.setAttribute('aria-label', `Activity settings for ${goal.text}`);
    tracking.addEventListener('click', () => openTracking(goal.text, tracking));
    const edit = row.querySelector('[data-edit]');
    edit.addEventListener('click', () => openEditor(key, goal));
    editButtons.set(key, edit);
    return row;
  }

  function render() {
    const goals = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const goal = readGoal(key);
        if (goal) goals.push([key, goal]);
      }
    } catch {
      pinFeedback.textContent = 'Checkin could not read your activities.';
    }
    goals.sort(([, first], [, second]) => first.text.localeCompare(second.text));
    pinned = new Map(goals.filter(([, goal]) => goal.pinned));
    editButtons.clear();
    list.replaceChildren(...Array.from(pinned, ([key, goal]) => renderRow(key, goal)));
    updateActivities(goals.map(([, goal]) => goal));
    renderPickupSuggestions();
  }

  function renderPickupSuggestions() {
    suggestionButtons.clear();
    for (const key of recentlyLogged) {
      const goal = pinned.get(key);
      if (!goal) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'save-button';
      button.textContent = `Leave a pickup note for ${goal.text}`;
      button.addEventListener('click', () => openEditor(key, goal, true));
      suggestionButtons.set(key, button);
    }
    suggestions.replaceChildren(...suggestionButtons.values());
    suggestions.hidden = !suggestionButtons.size;
  }

  document.getElementById('pin-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = pinName.value.trim();
    if (!text) return pinName.focus();
    const key = prefix + goalKey({ text });
    const goal = saveGoal(key, { text, pinned: true }, pinFeedback);
    if (!goal) return;
    pinName.value = '';
    render();
    pinFeedback.textContent = `${text} is pinned.`;
    (editButtons.get(key) ?? pinName).focus();
  });

  function finishEdit(fields, message) {
    if (!saveGoal(editingKey, fields, editorFeedback)) return;
    render();
    if (editingPickup) announcePickup(message);
    else pinFeedback.textContent = message;
    dialog.close();
  }

  document.getElementById('activity-editor-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const nextStep = plan.value.trim();
    const backup = fallback.value.trim();
    if (backup && !nextStep) {
      editorFeedback.textContent = 'Add a next step for this fallback, or leave both blank.';
      plan.focus();
      return;
    }
    finishEdit({ plan: nextStep, fallback: backup, pickup: pickup.value.trim() }, 'Next step and note saved.');
  });
  complete.addEventListener('click', () => {
    finishEdit({ plan: '', fallback: '' }, 'Plan marked done.');
  });
  dismiss.addEventListener('click', () => {
    finishEdit({ plan: '', fallback: '' }, 'Plan dismissed.');
  });
  document.getElementById('unpin-activity').addEventListener('click', () => {
    finishEdit({ pinned: false }, 'Activity unpinned.');
  });
  document.getElementById('cancel-activity-edit').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const target = editingPickup
      ? suggestionButtons.get(editingKey) ?? document.getElementById('save')
      : editButtons.get(editingKey) ?? pinName;
    target.focus();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith(prefix)) render();
  });
  render();
  function suggestPickup(goals = []) {
    recentlyLogged = goals.map((goal) => prefix + goalKey(goal));
    renderPickupSuggestions();
  }
  function getActivity(text) {
    try { return readGoal(prefix + goalKey({ text })); } catch { return null; }
  }

  function saveActivity(text, fields, feedback) {
    const key = prefix + goalKey({ text });
    const current = getActivity(text);
    const saved = saveGoal(key, { text: current?.text ?? text, pinned: current?.pinned ?? false, ...fields }, feedback);
    if (saved) render();
    return saved;
  }

  return { suggestPickup, refreshGoals: render, getActivity, saveActivity };
}
