import { goalKey } from './calendar.js';

const prefix = 'checkin.pinned.';

export function setupPinnedGoals(stageGoal) {
  const list = document.getElementById('pinned-list');
  const template = document.getElementById('pinned-goal-card');
  const pinName = document.getElementById('pin-name');
  const pinFeedback = document.getElementById('pin-feedback');
  const dialog = document.getElementById('goal-editor');
  const editorFeedback = document.getElementById('goal-editor-feedback');
  const plan = document.getElementById('goal-plan');
  const fallback = document.getElementById('goal-fallback');
  const pickup = document.getElementById('goal-pickup');
  const dismiss = document.getElementById('dismiss-goal-plan');
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
      feedback.textContent = 'Checkin could not save this goal in your browser.';
      return null;
    }
  }

  function openEditor(key, goal, focusPickup = false) {
    editingKey = key;
    editingPickup = focusPickup;
    document.getElementById('goal-editor-title').textContent = goal.text;
    plan.value = goal.plan ?? '';
    fallback.value = goal.fallback ?? '';
    pickup.value = goal.pickup ?? '';
    dismiss.hidden = !goal.plan;
    editorFeedback.textContent = '';
    dialog.showModal();
    if (focusPickup) pickup.focus();
  }

  function renderCard(key, goal) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector('h4').textContent = goal.text;
    for (const field of ['plan', 'fallback', 'pickup']) {
      const line = card.querySelector(`[data-${field}]`);
      line.hidden = !goal[field];
      line.querySelector('span').textContent = goal[field] ?? '';
    }

    const stage = card.querySelector('[data-stage]');
    stage.setAttribute('aria-label', `Worked on ${goal.text}`);
    stage.addEventListener('click', () => stageGoal(goal.text).focus());

    const edit = card.querySelector('[data-edit]');
    edit.setAttribute('aria-label', `Plan or pickup note for ${goal.text}`);
    edit.addEventListener('click', () => openEditor(key, goal));
    editButtons.set(key, edit);

    const done = card.querySelector('[data-done]');
    done.hidden = !goal.plan;
    done.setAttribute('aria-label', `Mark plan done for ${goal.text}`);
    done.addEventListener('click', () => {
      if (!saveGoal(key, { plan: '', fallback: '' }, pinFeedback)) return;
      render();
      pinFeedback.textContent = `Plan marked done for ${goal.text}.`;
      (editButtons.get(key) ?? pinName).focus();
    });
    return card;
  }

  function render() {
    const goals = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const goal = readGoal(key);
        if (goal?.pinned) goals.push([key, goal]);
      }
    } catch {
      pinFeedback.textContent = 'Checkin could not read your pinned goals.';
    }
    goals.sort(([, first], [, second]) => first.text.localeCompare(second.text));
    pinned = new Map(goals);
    editButtons.clear();
    list.replaceChildren(...goals.map(([key, goal]) => renderCard(key, goal)));
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
    pinFeedback.textContent = message;
    dialog.close();
  }

  document.getElementById('goal-editor-form').addEventListener('submit', (event) => {
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
  dismiss.addEventListener('click', () => {
    finishEdit({ plan: '', fallback: '' }, 'Plan dismissed.');
  });
  document.getElementById('unpin-goal').addEventListener('click', () => {
    finishEdit({ pinned: false }, 'Goal unpinned.');
  });
  document.getElementById('cancel-goal-edit').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const suggestion = editingPickup ? suggestionButtons.get(editingKey) : null;
    (suggestion ?? editButtons.get(editingKey) ?? pinName).focus();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith(prefix)) render();
  });
  render();
  return (goals = []) => {
    recentlyLogged = goals.map((goal) => prefix + goalKey(goal));
    renderPickupSuggestions();
  };
}
