import { dayKey } from './calendar.js';

const dayMilliseconds = 86_400_000;

export function todayIndex() {
  return indexForKey(dayKey(new Date()));
}

export function indexForKey(key) {
  return Date.parse(key) / dayMilliseconds;
}

export function dateForIndex(index) {
  return new Date(index * dayMilliseconds);
}

export function keyForIndex(index) {
  return dateForIndex(index).toISOString().slice(0, 10);
}

const shortMonth = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'UTC' });

export function shortLabel(date) {
  const day = date.getUTCDate();
  const suffix = day >= 11 && day <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th';
  return `${shortMonth.format(date)} ${day}${suffix}`;
}

export const fullLabel = (date) => fullDate.format(date);

export function timelineScores(journal) {
  const totals = new Map(Object.entries(journal?.days ?? {}).map(([key, day]) => {
    const values = Object.values(day.values);
    const count = values.length + (day.retired?.count ?? 0);
    const effort = values.reduce((sum, value) => sum + value.effort, day.retired?.effort ?? 0);
    return [indexForKey(key), { count, effort }];
  }));
  const active = [...totals.keys()].filter((index) => totals.get(index).count).sort((a, b) => a - b);

  function lastActiveBefore(index) {
    let low = 0;
    let high = active.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (active[mid] < index) low = mid + 1;
      else high = mid;
    }
    return active[low - 1];
  }

  return (index, today) => {
    if (index > today) return { height: 0, power: 0, count: 0 };
    const total = totals.get(index);
    if (!total?.count) {
      const previous = lastActiveBefore(index);
      const gap = index < today && previous !== undefined ? index - previous - 1 : 0;
      return { height: gap ? -0.33 * gap / (gap + 3) : 0, power: 0, count: 0 };
    }

    let pastCount = 0;
    for (let offset = 1; offset <= 7; offset++) pastCount += totals.get(index - offset)?.count ?? 0;
    const average = pastCount / 7;
    const excess = Math.max(0, total.count - average);
    const strength = 0.82 * total.count + 1.6 * total.effort;
    return {
      height: strength / (strength + 3.6),
      power: Math.min(1.45, Math.log1p(excess) / (2 * Math.sqrt(1 + average / 6))),
      count: total.count,
    };
  };
}
