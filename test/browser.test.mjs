import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openBrowser, startProcess } from './browser.mjs';

async function openCheckin(t, beforeLoad) {
  const server = startProcess(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0' },
  }, /Checkin is ready at (http:\/\/127\.0\.0\.1:\d+)\r?\n/);
  t.after(() => server.stop());
  const url = await server.ready;
  assert.notEqual(new URL(url).port, '4173');
  const page = await openBrowser(t);
  if (beforeLoad) await page.beforeLoad(beforeLoad);
  await page.setViewport(1440, 900);
  await page.navigate(url);
  return page;
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('today starts centered with 21 dated dots, and year labels and touch swipes work on a phone', async (t) => {
  const page = await openCheckin(t, () => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(2026, 11, 31, 12);
      }
    };
  });
  await page.setReducedMotion('reduce');
  await settle(page);
  const desktop = await page.evaluate(() => {
    const days = [...document.querySelectorAll('.day')];
    const today = document.querySelector('[aria-current="date"]');
    const bounds = today.getBoundingClientRect();
    return {
      count: days.length, today: today.textContent, center: bounds.left + bounds.width / 2,
      first: days[0].textContent, last: days.at(-1).textContent,
      years: [...document.querySelectorAll('.year')].filter((year) => Number(year.style.opacity) > 0)
        .map((year) => [year.textContent, year.getBoundingClientRect().left]),
    };
  });
  assert.equal(desktop.count, 21);
  assert.equal(desktop.center, 720);
  assert.equal(desktop.first, 'Dec 21st');
  assert.equal(desktop.today, 'Dec 31st');
  assert.equal(desktop.last, 'Jan 10th');
  assert.deepEqual(desktop.years.map(([year]) => year), ['2026', '2027']);
  assert.ok(desktop.years[0][1] < desktop.years[1][1]);

  await page.setViewport(390, 844);
  await settle(page);
  const before = await page.evaluate(() => {
    const stage = document.querySelector('#timeline').getBoundingClientRect();
    return { dots: document.querySelectorAll('.day').length, y: Math.round(stage.top + stage.height / 2) };
  });
  assert.ok(before.dots >= 5 && before.dots <= 9);
  await page.swipe(320, 65, before.y);
  await settle(page);
  const swiped = await page.evaluate(() => ({
    centered: document.querySelector('.day[tabindex="0"]').dataset.date,
    todayShortcut: !document.querySelector('#back-today').hidden,
    drawerClosed: document.querySelector('#day-drawer').hidden,
  }));
  assert.equal(swiped.centered, '2027-01-05');
  assert.equal(swiped.todayShortcut, true);
  assert.equal(swiped.drawerClosed, true);
  await page.evaluate(() => document.querySelector('.day[tabindex="0"]').click());
  assert.equal(await page.evaluate(() => document.querySelector('#day-content').innerText.trim()), 'Upcoming');
  await page.evaluate(() => document.querySelector('#back-today').click());
  await settle(page);
  assert.equal(await page.evaluate(() => document.querySelector('.day[tabindex="0"]').dataset.date), '2026-12-31');
});

test('activities can be managed, logged, edited, deleted and reloaded on a phone', async (t) => {
  const page = await openCheckin(t);
  await page.setViewport(390, 844);
  await page.setReducedMotion('reduce');
  await settle(page);
  const created = await page.evaluate(async () => {
    const find = (selector) => document.querySelector(selector);
    window.waitForCheckin = async (test) => {
      for (let round = 0; round < 90; round++) {
        if (test()) return;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      throw new Error('Checkin update did not finish');
    };
    window.createCheckinActivity = async (name, unit) => {
      find('[aria-label="New activity"]').click();
      find('dialog input').value = name;
      if (unit) {
        find('dialog select').value = 'custom';
        find('dialog select').dispatchEvent(new Event('change'));
        find('dialog input[placeholder]').value = unit;
      }
      find('dialog [type="submit"]').click();
      await window.waitForCheckin(() => find('[aria-label="Remove ' + name + '"]'));
    };
    find('#manage').click();
    await window.createCheckinActivity('Read', 'pages');
    await window.createCheckinActivity('Stretch');
    const activityRows = [...document.querySelectorAll('dialog .activity-row')].map((row) => row.innerText.trim());
    find('#close-dialog').click();
    find('[aria-current="date"]').click();
    window.logCheckinValue = async (name, amount) => {
      find('[aria-label="Log activity"]').click();
      const picker = find('#day-content select');
      picker.value = [...picker.options].find((option) => option.text === name).value;
      picker.dispatchEvent(new Event('change'));
      find('#day-content input').value = amount;
      find('#day-content [type="submit"]').click();
      await window.waitForCheckin(() => !find('#day-content form'));
    };
    const originalY = find('[aria-current="date"]').getBoundingClientRect().top;
    await window.logCheckinValue('Read', 4.5);
    await window.logCheckinValue('Stretch', 20);
    const value = find('.log-value').textContent;
    find('.log-row').click();
    const controls = [...document.querySelectorAll('dialog .actions button')].map((control) => control.textContent);
    find('dialog input').value = '100';
    [...document.querySelectorAll('dialog .actions button')].find((control) => control.textContent === 'Cancel').click();
    const afterCancel = find('.log-value').textContent;
    const beforeEdit = find('[aria-current="date"]').getBoundingClientRect().top;
    find('.log-row').click();
    find('dialog input').value = '100';
    find('dialog [type="submit"]').click();
    await window.waitForCheckin(() => !find('dialog').open);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      activityRows, value, controls, afterCancel, originalY, beforeEdit,
      afterEdit: find('[aria-current="date"]').getBoundingClientRect().top,
      graphColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      viewport: { width: innerWidth, scrollWidth: document.documentElement.scrollWidth },
    };
  });
  assert.deepEqual(created.activityRows, ['Read\npages', 'Stretch\nmin']);
  assert.equal(created.value, '4.5 pages');
  assert.deepEqual(created.controls, ['Delete', 'Cancel', 'Save']);
  assert.equal(created.afterCancel, created.value);
  assert.ok(created.beforeEdit < created.originalY);
  assert.ok(created.afterEdit < created.beforeEdit);
  assert.notEqual(created.graphColor, 'rgb(155, 250, 226)');
  assert.equal(created.viewport.width, created.viewport.scrollWidth);

  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => {
    document.querySelector('[aria-current="date"]').click();
    return [...document.querySelectorAll('.log-value')].map((value) => value.textContent);
  });
  assert.deepEqual(persisted, ['100 pages', '20 min']);

  const removed = await page.evaluate(async () => {
    const find = (selector) => document.querySelector(selector);
    const centerY = () => find('[aria-current="date"]').getBoundingClientRect().top;
    const before = centerY();
    const remaining = () => [...document.querySelectorAll('.log-value')].map((value) => value.textContent);
    const choose = (text) => [...document.querySelectorAll('dialog .actions button')].find((button) => button.textContent === text);
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    find('#manage').click();
    find('[aria-label="Remove Read"]').click();
    const confirmation = find('#dialog-title').textContent;
    assertOnCancel();
    function assertOnCancel() {
      choose('Cancel').click();
      if (!find('[aria-label="Remove Read"]')) throw new Error('Cancel removed the activity');
    }
    find('[aria-label="Remove Read"]').click();
    choose('Remove').click();
    for (let tries = 0; find('#dialog-title').textContent !== 'Activities'; tries++) {
      if (tries === 90) throw new Error('Activity removal did not finish');
      await nextFrame();
    }
    find('#close-dialog').click();
    await nextFrame();
    const afterRemoveActivity = centerY();
    const surviving = remaining();
    find('.log-row').click();
    choose('Delete').click();
    for (let tries = 0; find('dialog').open; tries++) {
      if (tries === 90) throw new Error('Log removal did not finish');
      await nextFrame();
    }
    await nextFrame();
    return { before, afterRemoveActivity, surviving, afterRemoveLog: centerY(), remaining: remaining(), confirmation };
  });
  assert.equal(removed.confirmation, 'Remove Read?');
  assert.equal(removed.afterRemoveActivity, removed.before);
  assert.deepEqual(removed.surviving, ['20 min']);
  assert.ok(removed.afterRemoveLog > removed.afterRemoveActivity);
  assert.deepEqual(removed.remaining, []);

  await page.reload();
  await settle(page);
  const finalState = await page.evaluate(() => {
    const day = document.querySelector('[aria-current="date"]');
    day.click();
    document.querySelector('#manage').click();
    return {
      height: day.getBoundingClientRect().top,
      logs: document.querySelectorAll('.log-row').length,
      activities: [...document.querySelectorAll('dialog .activity-name')].map((row) => row.textContent),
    };
  });
  assert.equal(finalState.height, removed.afterRemoveLog);
  assert.equal(finalState.logs, 0);
  assert.deepEqual(finalState.activities, ['Stretch']);
});

test('five-second traversals light edges between dots in both directions and then together', async (t) => {
  const page = await openCheckin(t, () => {
    let time = 1000;
    const frame = requestAnimationFrame;
    window.requestAnimationFrame = (callback) => frame(() => callback(time));
    performance.now = () => time;
    const interval = window.setInterval;
    window.setInterval = (callback, delay) => {
      if (delay !== 5000) return interval(callback, delay);
      window.traverse = callback;
    };
    window.advanceCheckin = (duration) => { time += duration; };
  });
  await settle(page);
  const alpha = await page.evaluate(async () => {
    const canvas = document.querySelector('#graph');
    const context = canvas.getContext('2d');
    const width = canvas.clientWidth;
    const spacing = width / 21;
    const reach = 21 / 2 + 9;
    const progress = .335;
    const offset = reach * (1 - 2 * progress);
    const positions = [width / 2 - offset * spacing, width / 2 + offset * spacing];
    const sample = () => positions.map((x) => context.getImageData(Math.round(x), Math.floor(canvas.clientHeight * .56), 1, 1).data[3]);
    const results = [sample()];
    for (let index = 0; index < 3; index++) {
      window.traverse();
      window.advanceCheckin(3300 * progress);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      results.push(sample());
      window.advanceCheckin(5000 - 3300 * progress);
    }
    return results;
  });
  assert.ok(alpha[1][0] > alpha[0][0] + 40);
  assert.ok(Math.abs(alpha[1][1] - alpha[0][1]) <= 2);
  assert.ok(Math.abs(alpha[2][0] - alpha[0][0]) <= 2);
  assert.ok(alpha[2][1] > alpha[0][1] + 40);
  assert.ok(alpha[3][0] > alpha[0][0] + 40);
  assert.ok(alpha[3][1] > alpha[0][1] + 40);

  await page.evaluate(() => {
    const today = document.querySelector('[aria-current="date"]').dataset.date;
    const toDateKey = (offset) => new Date(Date.parse(today) + offset * 86_400_000).toISOString().slice(0, 10);
    const activities = Array.from({ length: 5 }, (_, index) => ({
      id: String(index), text: 'Activity ' + index, type: 'minutes', unit: 'min', goals: [],
    }));
    const value = { amount: 30, effort: .2896 };
    const days = {};
    for (let offset = -8; offset <= 0; offset++) {
      const active = offset === -1 ? activities : activities.slice(0, 1);
      days[toDateKey(offset)] = { values: Object.fromEntries(active.map(({ id }) => [id, value])) };
    }
    localStorage.setItem('checkin.timeline.v1', JSON.stringify({ activities, days }));
  });
  await page.reload();
  await settle(page);
  const still = await page.evaluate(() => {
    const canvas = document.querySelector('#graph');
    const context = canvas.getContext('2d');
    const stage = canvas.getBoundingClientRect();
    const activeDays = [...document.querySelectorAll('.day[data-work]')];
    const sampleAbove = (day) => {
      const box = day.getBoundingClientRect();
      return context.getImageData(Math.round(box.left + box.width / 2), Math.round(box.top - stage.top + 13), 1, 1).data[3];
    };
    return [sampleAbove(activeDays.at(-3)), sampleAbove(activeDays.at(-2))];
  });
  assert.ok(still[1] > still[0] + 15);

  const ripple = await page.evaluate(async () => {
    const find = (selector) => document.querySelector(selector);
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const canvas = find('#graph');
    const context = canvas.getContext('2d');
    const stage = canvas.getBoundingClientRect();
    const today = find('[aria-current="date"]');
    const sample = () => {
      const neighbours = [today.previousElementSibling, today.nextElementSibling];
      return neighbours.reduce((sum, day) => {
        const box = day.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2);
        const y = Math.round(box.top - stage.top + 21);
        const rgba = context.getImageData(x - 2, y - 5, 5, 11).data;
        return sum + rgba.reduce((total, value, index) => total + (index % 4 === 3 ? value : 0), 0);
      }, 0);
    };
    today.click();
    await frame();
    const before = sample();
    find('.log-row').click();
    find('dialog [type="submit"]').click();
    for (let tries = 0; find('dialog').open; tries++) {
      if (tries === 90) throw new Error('Log save did not finish');
      await frame();
    }
    window.advanceCheckin(140);
    await frame();
    return { before, after: sample() };
  });
  assert.ok(ripple.after > ripple.before + 100);
});
