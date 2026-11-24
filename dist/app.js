import { formatQuantity, maxAmount } from './measurements.js';
import { readJournal, updateJournal, watchJournal } from './journal-storage.js';
import {
  createActivity, dateForIndex, editActivity, fullLabel, keyForIndex, removeActivity, removeValue, saveValue, timelineScores, todayIndex,
} from './timeline-data.js';
import { createTimeline } from './timeline.js';

const byId = (id) => document.getElementById(id);
const stage = byId('timeline');
const drawer = byId('day-drawer');
const dayContent = byId('day-content');
const dialog = byId('dialog');
const dialogContent = byId('dialog-content');
const manage = byId('manage');
const announcement = byId('announcement');

let journal = readJournal();
let selected = null;
let addingLog = false;
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

async function persist(change, error, { pulse, after = () => {} } = {}) {
  if (saving) return;
  saving = true;
  const originatingDialog = dialogVersion;
  error.hidden = true;
  try {
    journal = await updateJournal(change);
    timeline.setScores(timelineScores(journal), pulse);
    after(originatingDialog === dialogVersion);
  } catch (failure) {
    error.textContent = failure.message || 'Could not save. Try again.';
    error.hidden = false;
  } finally {
    saving = false;
  }
}

function showManager(focusId, focusRemove = false) {
  const list = element('div', 'activity-list');
  const add = plusButton('New activity', () => showActivityForm());
  const firstRow = element('div', 'add-row');
  firstRow.append(add);
  list.append(firstRow);
  let focus = add;
  for (const activity of journal.activities) {
    const row = element('div', 'activity-row');
    const edit = iconButton('pencil', 'Edit ' + activity.text, () => showActivityForm(activity));
    const remove = iconButton('bin', 'Remove ' + activity.text, () => confirmRemoval(activity));
    row.append(element('span', 'activity-name', activity.text), element('span', 'unit', activity.unit), edit, remove);
    list.append(row);
    if (focusId === activity.id) focus = focusRemove ? remove : edit;
  }
  setDialog('Activities', list, focus);
}

function showActivityForm(existing) {
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
      unit: kind.value === 'minutes' ? 'min' : unit.value.trim(), goals: [],
    };
    const saveActivity = existing ? editActivity : createActivity;
    persist((state) => saveActivity(state, activity), message, {
      after: (sameDialog) => {
        if (dialog.open && sameDialog) showManager(existing?.id);
        renderDay();
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
  actions.append(button('Cancel', 'text-button', () => showManager(existing?.id)), submitButton('Save'));
  form.append(labelled('Name', name), labelled('Measure in', kind), custom, error, actions);
  setDialog(existing ? 'Edit activity' : 'New activity', form, name);
}

function confirmRemoval(activity) {
  const { form, error } = makeForm((message) => {
    persist((state) => removeActivity(state, activity.id), message, {
      after: (sameDialog) => {
        if (dialog.open && sameDialog) showManager();
        renderDay();
        announcement.textContent = activity.text + ' removed.';
      },
    });
  });
  const cancel = button('Cancel', 'text-button', () => showManager(activity.id, true));
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

function finishLog(index, activity, amount, message) {
  const date = keyForIndex(index);
  const change = amount === undefined
    ? (state) => removeValue(state, date, activity.id)
    : (state) => saveValue(state, date, activity.id, amount);
  persist(change, message, {
    pulse: amount === undefined ? undefined : index,
    after: (sameDialog) => {
      if (sameDialog && dialog.open) closeDialog();
      addingLog = false;
      renderDay();
      if (selected === index && !dialog.open) {
        const row = [...dayContent.querySelectorAll('[data-activity]')].find((item) => item.dataset.activity === activity.id);
        (row ?? dayContent.querySelector('.add-button'))?.focus({ preventScroll: true });
      }
      announcement.textContent = activity.text + (amount === undefined ? ' removed from this day.' : ' saved.');
    },
  });
}

function addLogForm(index, values) {
  const available = journal.activities.filter(({ id }) => !values[id]);
  if (!available.length) {
    if (!journal.activities.length) return button('Create an activity', 'text-button create-shortcut', () => showActivityForm());
    return element('p', 'inline-note', 'All activities are logged for this day.');
  }

  const picker = makeSelect(available.map(({ id, text }) => [id, text]), 'Choose an activity');
  const amount = amountField();
  const { label, suffix } = valueLabel(amount);
  const { form, error } = makeForm((message) => {
    const activity = available.find(({ id }) => id === picker.value);
    finishLog(index, activity, amount.valueAsNumber, message);
  });
  const actions = element('div', 'actions');
  const save = submitButton('Save');
  actions.append(button('Cancel', 'text-button', () => {
    addingLog = false;
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
  drawer.hidden = selected === null;
  if (selected === null) return;
  const index = selected;
  const date = keyForIndex(index);
  byId('selected-date').textContent = fullLabel(dateForIndex(index));
  const values = journal.days[date]?.values ?? {};
  const content = document.createDocumentFragment();

  if (index <= todayIndex()) {
    const addRow = element('div', 'add-row');
    const add = plusButton('Log activity', () => {
      addingLog = !addingLog;
      renderDay();
      const focus = addingLog ? dayContent.querySelector('select, .create-shortcut') : null;
      (focus ?? dayContent.querySelector('.add-button'))?.focus({ preventScroll: true });
    });
    add.setAttribute('aria-expanded', String(addingLog));
    addRow.append(add);
    content.append(addRow);
    if (addingLog) content.append(addLogForm(index, values));
  } else {
    content.append(element('p', 'inline-note', 'Upcoming'));
  }
  for (const activity of journal.activities) {
    const value = values[activity.id];
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
  onSelect(index) {
    if (index !== selected) {
      addingLog = false;
      if (dialog.open && dialog.classList.contains('log-dialog')) closeDialog();
    }
    selected = index;
    renderDay();
  },
});

timeline.setScores(timelineScores(journal));
manage.addEventListener('click', () => showManager());
byId('close-day').addEventListener('click', timeline.closeSelected);
watchJournal((updated) => {
  journal = updated;
  timeline.setScores(timelineScores(journal));
  renderDay();
});
