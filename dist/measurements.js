const numberFormat = new Intl.NumberFormat('en', { maximumSignificantDigits: 9 });
const singularUnits = new Map([
  ['days', 'day'], ['laps', 'lap'], ['sets', 'set'], ['reps', 'rep'], ['pages', 'page'],
  ['meters', 'meter'], ['metres', 'metre'], ['kilometers', 'kilometer'], ['kilometres', 'kilometre'], ['miles', 'mile'],
]);

export const maxAmount = 1_000_000_000;
export const normalizeLabel = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();
export const isUnit = (value) => typeof value === 'string' && value.length <= 32 && Boolean(normalizeLabel(value));
export const isAmount = (value) => Number.isFinite(value) && value > 0 && value <= maxAmount;

export function formatQuantity(amount, unit) {
  const singular = amount === 1 && singularUnits.get(normalizeLabel(unit));
  return `${numberFormat.format(amount)} ${singular || unit}`;
}
