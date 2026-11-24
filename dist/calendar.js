export function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function monthStart(date, offset = 0) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

export function dateOffset(date, offset) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}

export function weekStart(date) {
  return dateOffset(date, -((date.getDay() + 6) % 7));
}

export function goalKey({ text }) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}