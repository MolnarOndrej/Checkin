const monthFormat = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'full' });
const svgNamespace = 'http://www.w3.org/2000/svg';

export function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function monthStart(date, offset = 0) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

export function dateLabel(date) {
  return dateFormat.format(date);
}

function statusLabel(entry) {
  if (!entry) return 'open';
  if (entry.score === null) return 'details only';
  return `${entry.score}% complete`;
}

export function renderCalendar({ grid, title, month, today, selected, entryFor }) {
  title.textContent = monthFormat.format(month);
  const todayKey = dayKey(today);
  const selectedKey = dayKey(selected);
  const offset = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.max(35, Math.ceil((offset + days) / 7) * 7);
  const fragment = document.createDocumentFragment();
  const recordedDays = [];

  for (let index = 0; index < cells; index++) {
    const number = index - offset + 1;
    if (number < 1 || number > days) {
      const spacer = document.createElement('span');
      spacer.setAttribute('aria-hidden', 'true');
      fragment.append(spacer);
      continue;
    }
    const date = new Date(month.getFullYear(), month.getMonth(), number);
    const key = dayKey(date);
    const entry = entryFor(key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.dataset.day = number;
    button.disabled = key > todayKey;
    button.setAttribute('aria-label', `${dateLabel(date)}, ${button.disabled ? 'upcoming' : statusLabel(entry)}`);
    button.setAttribute('aria-pressed', String(key === selectedKey));
    if (key === selectedKey) button.dataset.selected = '';
    if (key === todayKey) {
      button.dataset.today = '';
      button.setAttribute('aria-current', 'date');
    }
    const label = document.createElement('span');
    label.className = 'day-number';
    label.textContent = number;
    button.append(label);

    if (entry) {
      recordedDays.push(number);
      const mark = document.createElement('span');
      mark.className = 'day-mark';
      mark.setAttribute('aria-hidden', 'true');
      if (entry.score === 100) {
        button.dataset.status = 'full';
        const check = document.createElementNS(svgNamespace, 'svg');
        check.setAttribute('class', 'icon');
        check.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS(svgNamespace, 'use');
        path.setAttribute('href', '#check');
        check.append(path);
        mark.append(check);
      } else if (entry.score !== null) {
        button.dataset.status = 'partial';
        mark.textContent = `${entry.score}%`;
      } else {
        button.dataset.status = 'note';
        mark.textContent = '◆';
      }
      button.append(mark);
    }
    fragment.append(button);
  }
  grid.replaceChildren(fragment);
  return recordedDays;
}
