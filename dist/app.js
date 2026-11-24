import { formatQuantity, maxAmount } from './measurements.js';
import { logFor } from './journal-data.js';
import { journalStore } from './journal-storage.js';
import { playSubmitSound, unlockSubmitAudio } from './submit-sound.js';
import { dateForIndex, fullLabel, keyForIndex, timelineScores, todayIndex } from './timeline-data.js';
import { createTimeline } from './timeline.js';

const byId = (id) => document.getElementById(id);
const stage = byId('timeline');
const drawer = byId('day-drawer');
const dayContent = byId('day-content');
const dialog = byId('dialog');
const dialogContent = byId('dialog-content');
const manage = byId('manage');
const journalError = byId('journal-error');
const announcement = byId('announcement');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let journal;
let selected = null;
// Undefined uses the day's default. Null keeps the form collapsed.
let logDraft;
let saving = false;
let opener;
let dialogVersion = 0;

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '#icon-' + name);
  svg.append(use);
  return svg;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, action) {
  const control = element('button', className, text);
  control.type = 'button';
  if (action) control.addEventListener('click', action);
  return control;
}

function iconButton(name, label, action) {
  const control = button(undefined, 'icon-button quiet', action);
  control.append(icon(name));
  control.setAttribute('aria-label', label);
  control.title = label;
  return control;
}

function labelled(text, control) {
  const label = element('label', 'field');
  label.append(element('span', 'field-label', text), control);
  return label;
}

function makeSelect(options, placeholder) {
  const select = element('select');
  if (placeholder) {
    const empty = new Option(placeholder, '', true, true);
    empty.disabled = true;
    select.append(empty);
  }
  for (const [value, label] of options) select.append(new Option(label, value));
  select.required = true;
  return select;
}

function submitButton(text) {
  const submit = button(text, 'primary');
  submit.type = 'submit';
  return submit;
}

function makeForm(onSubmit) {
  const form = element('form', 'editor');
  const error = element('p', 'form-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit(error);
  });
  return { form, error };
}

function plusButton(label, action) {
  const plus = iconButton('plus', label, action);
  plus.classList.add('add-button');
  return plus;
}

function activityPrompt(action, message) {
  const prompt = element('div', 'activity-prompt');
  const style = message ? 'activity-link' : 'text-button activity-button';
  const add = button('Add activity', 'activity-shortcut ' + style, action);
  add.setAttribute('aria-haspopup', 'dialog');
  if (message) prompt.append(element('p', 'inline-note', message));
  else add.prepend(icon('plus'));
  prompt.append(add);
  return prompt;
}

function setDialog(title, body, focus, logging = false) {
  dialogVersion++;
  const modal = !logging;
  if (dialog.open && dialog.matches(':modal') !== modal) dialog.close();
  dialog.classList.toggle('log-dialog', logging);
  byId('dialog-title').textContent = title;
  dialogContent.replaceChildren(body);
  if (!dialog.open) {
    opener = document.activeElement;
    if (modal) dialog.showModal();
    else dialog.show();
  }
  (focus ?? dialogContent.querySelector('button, input'))?.focus({ preventScroll: true });
}

function closeDialog() {
  dialogVersion++;
  dialog.close();
}

byId('close-dialog').addEventListener('click', closeDialog);
dialog.addEventListener('click', (event) => {
  if (event.target === dialog && dialog.matches(':modal')) closeDialog();
});
dialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && dialog.classList.contains('log-dialog')) closeDialog();
});
dialog.addEventListener('close', () => {
  if (!dialog.open && opener?.isConnected && dialog.contains(document.activeElement)) {
    opener.focus({ preventScroll: true });
  }
});

function setJournal(updated, updateTimeline = true) {
  journal = updated;
  manage.disabled = !journal;
  journalError.hidden = Boolean(journal);
  if (updateTimeline) timeline.setScores(timelineScores(journal));
}

async function refreshJournal() {
  let updated;
  try {
    updated = await journalStore.load();
  } catch {
    if (dialog.open) closeDialog();
  }
  setJournal(updated);
  renderDay();
}

async function showLogFeedback(index, updated) {
  const progressAt = await playSubmitSound();
  function show(now) {
    if (!reducedMotion.matches && progressAt?.(now) < 0) {
      requestAnimationFrame(show);
      return;
    }
    if (journal === updated) timeline.setScores(timelineScores(updated));
    timeline.pulse(index, progressAt);
  }
  show(performance.now());
}

async function persist(write, error, { pulse, sound = false, after } = {}) {
  if (!journal || saving) return;
  saving = true;
  const originatingDialog = dialogVersion;
  const syncFeedback = sound && !reducedMotion.matches;
  error.hidden = true;
  if (sound) unlockSubmitAudio();
  try {
    const updated = await write();
    setJournal(updated, !syncFeedback);
    if (syncFeedback) void showLogFeedback(pulse, updated);
    else if (sound) void playSubmitSound();
    else if (pulse !== undefined) timeline.pulse(pulse);
    after?.(originatingDialog === dialogVersion);
  } catch (failure) {
    error.textContent = failure.message || 'Could not save. Try again.';
    error.hidden = false;
  } finally {
    saving = false;
  }
}

function showManager({ focusId, focusRemove = false, draft } = {}) {
  const list = element('div', 'activity-list');
  const add = plusButton('New activity', () => showActivityForm({ draft }));
  const firstRow = element('div', 'add-row');
  firstRow.append(add);
  list.append(firstRow);
  let focus = add;
  for (const activity of journal.activities) {
    const row = element('div', 'activity-row');
    const edit = iconButton('pencil', 'Edit ' + activity.text, () => showActivityForm({ existing: activity, draft }));
    const remove = iconButton('bin', 'Remove ' + activity.text, () => confirmRemoval(activity, draft));
    row.append(element('span', 'activity-name', activity.text), element('span', 'unit', activity.unit), edit, remove);
    list.append(row);
    if (focusId === activity.id) focus = focusRemove ? remove : edit;
  }
  setDialog('Activities', list, focus);
}

function showActivityForm({ existing, draft, returnToLog = false, closeOnCancel = returnToLog }) {
  const name = element('input');
  name.required = true;
  name.maxLength = 60;
  name.autocomplete = 'off';
  const kind = makeSelect([['minutes', 'Minutes'], ['custom', 'Custom unit']]);
  const unit = element('input');
  unit.placeholder = 'e.g. pages';
  unit.maxLength = 24;
  unit.autocomplete = 'off';
  if (existing) {
    name.value = existing.text;
    kind.value = existing.type;
    if (existing.type === 'custom') unit.value = existing.unit;
  }
  const custom = labelled('Unit', unit);

  const { form, error } = makeForm((message) => {
    const activity = {
      id: existing?.id ?? crypto.randomUUID(), text: name.value.trim(), type: kind.value,
      unit: kind.value === 'minutes' ? 'min' : unit.value.trim(),
    };
    const write = () => existing ? journalStore.editActivity(activity) : journalStore.createActivity(activity);
    persist(write, message, {
      after: (sameDialog) => {
        if (!existing && draft) draft.preselectedActivityId = activity.id;
        const resumeLogging = dialog.open && sameDialog && returnToLog;
        if (resumeLogging) {
          logDraft = { preselectedActivityId: activity.id };
          closeDialog();
        } else if (dialog.open && sameDialog) {
          showManager({ focusId: existing?.id, draft });
        }
        renderDay();
        if (resumeLogging) dayContent.querySelector('.inline-editor input')?.focus();
        announcement.textContent = activity.text + (existing ? ' updated.' : ' added.');
      },
    });
  });

  function updateUnit() {
    const customUnit = kind.value === 'custom';
    custom.hidden = !customUnit;
    unit.disabled = !customUnit;
    unit.required = customUnit;
  }
  kind.addEventListener('change', updateUnit);
  updateUnit();
  const actions = element('div', 'actions');
  const cancel = closeOnCancel ? closeDialog : () => showManager({ focusId: existing?.id, draft });
  actions.append(button('Cancel', 'text-button', cancel), submitButton('Save'));
  form.append(labelled('Name', name), labelled('Measure in', kind), custom, error, actions);
  setDialog(existing ? 'Edit activity' : 'Add activity', form, name);
}

function confirmRemoval(activity, draft) {
  const { form, error } = makeForm((message) => {
    persist(() => journalStore.removeActivity(activity.id), message, {
      after: (sameDialog) => {
        if (dialog.open && sameDialog) showManager({ draft });
        renderDay();
        announcement.textContent = activity.text + ' removed.';
      },
    });
  });
  const cancel = button('Cancel', 'text-button', () => showManager({ focusId: activity.id, focusRemove: true, draft }));
  const actions = element('div', 'actions');
  const remove = submitButton('Remove');
  remove.classList.add('danger');
  actions.append(cancel, remove);
  form.append(element('p', 'confirmation', 'This removes the activity and all of its logs. Past dots keep their positions.'), error, actions);
  setDialog('Remove ' + activity.text + '?', form, cancel);
}

function amountField() {
  const amount = element('input');
  amount.type = 'number';
  amount.step = 'any';
  amount.min = '0';
  amount.max = String(maxAmount);
  amount.inputMode = 'decimal';
  amount.required = true;
  return amount;
}

function valueLabel(amount, unit) {
  const label = labelled('Value', amount);
  const group = element('span', 'amount-group');
  const suffix = element('span', 'unit', unit);
  label.append(group);
  group.append(amount, suffix);
  return { label, suffix };
}

function finishLog(index, activity, amount, message, { added = false } = {}) {
  const date = keyForIndex(index);
  const write = () => {
    if (amount === undefined) return journalStore.removeLog(date, activity.id);
    if (added) return journalStore.addLog(date, activity.id, amount);
    return journalStore.editLog(date, activity.id, amount);
  };
  persist(write, message, {
    pulse: amount === undefined ? undefined : index,
    sound: added,
    after: (sameDialog) => {
      if (sameDialog && dialog.open) closeDialog();
      if (selected === index) logDraft = undefined;
      renderDay();
      if (selected === index && !dialog.open) {
        const row = [...dayContent.querySelectorAll('[data-activity]')].find((item) => item.dataset.activity === activity.id);
        (row ?? dayContent.querySelector('.add-button'))?.focus({ preventScroll: true });
      }
      announcement.textContent = activity.text + (amount === undefined ? ' removed from this day.' : ' saved.');
    },
  });
}

function addLogForm(index, values, draft) {
  const available = journal.activities.filter(({ id }) => !logFor(values, id));
  if (!available.length) {
    return activityPrompt(() => showManager({ draft }), 'All activities are logged for this day.');
  }

  const picker = makeSelect(available.map(({ id, text }) => [id, text]), 'Choose an activity');
  if (available.length === 1) picker.value = available[0].id;
  else if (available.some(({ id }) => id === draft.preselectedActivityId)) picker.value = draft.preselectedActivityId;
  const amount = amountField();
  const { label, suffix } = valueLabel(amount);
  const { form, error } = makeForm((message) => {
    const activity = available.find(({ id }) => id === picker.value);
    finishLog(index, activity, amount.valueAsNumber, message, { added: true });
  });
  const actions = element('div', 'actions');
  const save = submitButton('Save');
  actions.append(button('Cancel', 'text-button', () => {
    logDraft = null;
    renderDay();
    dayContent.querySelector('.add-button')?.focus({ preventScroll: true });
  }), save);
  function updateActivity() {
    const activity = available.find(({ id }) => id === picker.value);
    label.hidden = !activity;
    amount.disabled = !activity;
    save.disabled = !activity;
    suffix.textContent = activity?.unit ?? '';
  }
  picker.addEventListener('change', updateActivity);
  updateActivity();
  form.classList.add('inline-editor');
  form.append(labelled('Activity', picker), label, error, actions);
  return form;
}

function editLog(index, activity, value) {
  const amount = amountField();
  amount.value = String(value.amount);
  const { form, error } = makeForm((message) => finishLog(index, activity, amount.valueAsNumber, message));
  const remove = button('Delete', 'text-button danger log-delete', () => finishLog(index, activity, undefined, error));
  const actions = element('div', 'actions');
  actions.append(remove, button('Cancel', 'text-button', closeDialog), submitButton('Save'));
  form.append(valueLabel(amount, value.unit ?? activity.unit).label, error, actions);
  setDialog(activity.text, form, amount, true);
}

function renderDay() {
  drawer.hidden = selected === null || !journal;
  if (drawer.hidden) return;
  const index = selected;
  const date = keyForIndex(index);
  byId('selected-date').textContent = fullLabel(dateForIndex(index));
  const values = journal.days[date]?.values ?? {};
  const content = document.createDocumentFragment();

  if (index > todayIndex()) {
    content.append(element('p', 'inline-note', 'Upcoming'));
  } else if (!journal.activities.length) {
    content.append(activityPrompt(() => showActivityForm({ returnToLog: true })));
  } else {
    const draft = logDraft === undefined && Object.keys(values).length === 0 ? {} : logDraft;
    const addRow = element('div', 'add-row');
    const add = plusButton('Log activity', () => {
      logDraft = draft ? null : {};
      renderDay();
      const focus = logDraft ? dayContent.querySelector('select, .activity-shortcut') : null;
      (focus ?? dayContent.querySelector('.add-button'))?.focus({ preventScroll: true });
    });
    add.setAttribute('aria-expanded', String(Boolean(draft)));
    addRow.append(add);
    content.append(addRow);
    if (draft) content.append(addLogForm(index, values, draft));
  }
  for (const activity of journal.activities) {
    const value = logFor(values, activity.id);
    if (!value) continue;
    const row = button(undefined, 'log-row', () => editLog(index, activity, value));
    row.dataset.activity = activity.id;
    row.append(element('span', 'activity-name', activity.text), element('span', 'log-value', formatQuantity(value.amount, value.unit ?? activity.unit)), icon('arrow'));
    content.append(row);
  }
  dayContent.replaceChildren(content);
}

const timeline = createTimeline({
  stage, canvas: byId('graph'), days: byId('days'), yearLabels: byId('year-labels'), backToday: byId('back-today'),
  drawer, dialog, drawerGlow: byId('drawer-glow'),
  onSelect(index) {
    if (index !== selected) {
      logDraft = undefined;
      if (dialog.open && dialog.classList.contains('log-dialog')) closeDialog();
    }
    selected = index;
    renderDay();
  },
});

manage.addEventListener('click', () => {
  if (journal.activities.length) showManager();
  else showActivityForm({ closeOnCancel: true });
});
byId('close-day').addEventListener('click', timeline.closeSelected);
byId('retry-journal').addEventListener('click', async () => {
  await refreshJournal();
  if (journal) manage.focus({ preventScroll: true });
});
journalStore.subscribe(refreshJournal);
void refreshJournal();
