import { derivedMeasurementSummary, formatAmount, isFactor, metersForUnit } from './measurements.js';

export function createActivityRow(activity, { saved, getActivity, openTracking, onRemove }) {
  const row = document.getElementById('activity-row-template').content.firstElementChild.cloneNode(true);
  const name = row.querySelector('.activity-input');
  const status = row.querySelector('select');
  const amount = row.querySelector('[data-amount]');
  const minutes = row.querySelector('[data-minutes]');
  const factor = row.querySelector('[data-factor]');
  const distance = row.querySelector('.daily-distance');
  const preview = row.querySelector('.daily-metrics');
  const tracking = row.querySelector('[data-tracking]');
  let measurement;
  let edited = saved;

  name.value = activity.text;
  status.value = activity.done ? 'done' : activity.worked ? 'worked' : 'open';
  minutes.value = activity.minutes ?? '';
  amount.value = activity.measurement?.amount ?? '';

  function readMeasurement() {
    if (!measurement) return undefined;
    const result = { unit: measurement.unit, trackMinutes: measurement.trackMinutes };
    if (amount.value !== '') result.amount = amount.valueAsNumber;
    if (!factor.disabled && isFactor(factor.valueAsNumber)) result.metersPerUnit = factor.valueAsNumber;
    return result;
  }

  function readMinutes() {
    return minutes.disabled || minutes.value === '' ? undefined : minutes.valueAsNumber;
  }

  function updatePreview() {
    const current = readMeasurement();
    const duration = readMinutes();
    const summary = derivedMeasurementSummary(current, duration);
    preview.textContent = summary;
    preview.hidden = !summary;
    distance.querySelector('[data-distance-label]').textContent = current?.metersPerUnit === undefined
      ? 'Distance per unit'
      : `Distance per unit · ${formatAmount(current.metersPerUnit)} m`;
  }

  function updateLabels() {
    const text = name.value.trim();
    status.setAttribute('aria-label', `Progress for ${text || 'activity'}`);
    minutes.setAttribute('aria-label', `Optional minutes for ${text || 'activity'}`);
    amount.setAttribute('aria-label', `Optional ${measurement?.unit ?? 'amount'} for ${text || 'activity'}`);
    tracking.disabled = !text;
    tracking.setAttribute('aria-label', `Tracking and goals for ${text || 'activity'}`);
  }

  function setMeasurement(value) {
    measurement = value;
    row.classList.toggle('time-only', !value);
    amount.disabled = row.querySelector('[data-amount-field]').hidden = !value;
    minutes.disabled = row.querySelector('[data-minutes-field]').hidden = value?.trackMinutes === false && !minutes.value;
    factor.disabled = distance.hidden = !value || metersForUnit(value.unit) !== undefined;
    factor.value = value?.metersPerUnit ?? '';
    row.querySelector('[data-unit]').textContent = value?.unit ?? '';
    row.querySelector('.daily-measures').classList.toggle('single-measure', amount.disabled || minutes.disabled);
    updateLabels();
    updatePreview();
  }

  function refreshMeasurement() {
    if (!edited && !amount.value && !minutes.value && !factor.validity.badInput) {
      setMeasurement(getActivity(name.value)?.measurement);
    }
  }

  if (saved) setMeasurement(activity.measurement);
  else refreshMeasurement();

  name.addEventListener('input', updateLabels);
  name.addEventListener('change', refreshMeasurement);
  tracking.addEventListener('click', () => openTracking(name.value.trim(), tracking));
  row.querySelector('[data-remove]').addEventListener('click', () => {
    row.remove();
    onRemove();
  });
  status.addEventListener('change', () => {
    if (status.value === 'open') {
      amount.value = '';
      minutes.value = '';
      updatePreview();
    }
  });
  for (const field of [amount, minutes, factor]) {
    field.addEventListener('input', () => {
      edited = true;
      if (field !== factor && field.value !== '' && status.value === 'open') status.value = 'worked';
      updatePreview();
    });
  }

  return {
    row,
    status,
    refreshMeasurement,
    validate() {
      const invalid = row.querySelector('input[type="number"]:invalid');
      if (invalid === factor || (!factor.disabled && factor.value !== '' && !isFactor(factor.valueAsNumber))) {
        distance.open = true;
        return { field: factor, message: 'Enter a positive distance per unit, or leave it blank.' };
      }
      if (invalid === amount) return { field: amount, message: 'Enter an amount from 0 to 1 billion, or leave it blank.' };
      if (invalid === minutes) return { field: minutes, message: 'Enter whole minutes from 1 to 1440, or leave minutes blank.' };
      return null;
    },
    read() {
      const result = { text: name.value.trim(), done: status.value === 'done' };
      if (!result.done && status.value === 'worked') result.worked = true;
      const duration = readMinutes();
      if (duration !== undefined) result.minutes = duration;
      const current = readMeasurement();
      if (current) result.measurement = current;
      return result;
    },
  };
}
