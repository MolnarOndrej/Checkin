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
    return {
      dots: document.querySelectorAll('.day').length, y: Math.round(stage.top + stage.height / 2),
      above: Math.round(stage.top - 18), below: Math.round(stage.bottom + 26),
    };
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
  await page.swipe(250, 46, before.above);
  await settle(page);
  assert.equal(await page.evaluate(() => document.querySelector('.day[tabindex="0"]').dataset.date), '2027-01-04');
  await page.swipe(46, 250, before.below);
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
      find('[aria-label="New activity"]')?.click();
      find('dialog input').value = name;
      if (unit) {
        find('dialog select').value = 'custom';
        find('dialog select').dispatchEvent(new Event('change'));
        find('dialog input[placeholder]').value = unit;
      }
      find('dialog [type="submit"]').click();
      await window.waitForCheckin(() => find('[aria-label="Remove ' + name + '"]'));
    };
    const manage = find('#manage');
    manage.focus();
    manage.click();
    const firstActivity = {
      modal: find('dialog').matches(':modal'),
      title: find('#dialog-title').innerText,
      nameFocused: document.activeElement === find('dialog input'),
    };
    find('dialog .actions [type="button"]').click();
    const managerCancel = { closed: !find('dialog').open, focusRestored: document.activeElement === manage };
    manage.click();
    await window.createCheckinActivity('Read', 'pages');
    await window.createCheckinActivity('Stretch');
    const activityRows = [...document.querySelectorAll('dialog .activity-row')].map((row) => row.innerText.trim());
    find('#close-dialog').click();
    find('[aria-current="date"]').click();
    const logToggle = () => find('[aria-label="Log activity"]');
    const logForm = () => find('#day-content form');
    const emptyToday = {
      visible: logForm()?.checkVisibility(),
      expanded: logToggle().getAttribute('aria-expanded'),
      activity: logForm()?.querySelector('select').selectedOptions[0].text,
    };
    logForm().querySelector('.actions [type="button"]').click();
    const logCancel = { closed: !logForm(), focused: document.activeElement === logToggle() };
    logToggle().click();
    window.logCheckinValue = async (name, amount) => {
      if (!logForm()) logToggle().click();
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
    const today = find('[aria-current="date"]');
    today.previousElementSibling.click();
    const emptyPast = logForm()?.checkVisibility();
    await window.logCheckinValue('Read', 12);
    await window.logCheckinValue('Stretch', 25);
    today.click();
    find('.log-row').click();
    find('dialog input').value = '100';
    find('dialog [type="submit"]').click();
    await window.waitForCheckin(() => !find('dialog').open);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      firstActivity, managerCancel, emptyToday, logCancel, emptyPast,
      activityRows, value, controls, afterCancel, originalY, beforeEdit,
      afterEdit: find('[aria-current="date"]').getBoundingClientRect().top,
      graphColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      viewport: { width: innerWidth, scrollWidth: document.documentElement.scrollWidth },
    };
  });
  assert.deepEqual(created.firstActivity, { modal: true, title: 'Add activity', nameFocused: true });
  assert.deepEqual(created.managerCancel, { closed: true, focusRestored: true });
  assert.deepEqual(created.emptyToday, { visible: true, expanded: 'true', activity: 'Choose an activity' });
  assert.deepEqual(created.logCancel, { closed: true, focused: true });
  assert.equal(created.emptyPast, true);
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
    const find = (selector) => document.querySelector(selector);
    find('[aria-current="date"]').click();
    const formInitiallyClosed = !find('#day-content form');
    find('[aria-label="Log activity"]').click();
    const note = find('#day-content .inline-note');
    const add = find('#day-content .activity-shortcut');
    return {
      formInitiallyClosed,
      values: [...document.querySelectorAll('.log-value')].map((value) => value.textContent),
      message: note.innerText,
      addText: add.innerText,
      addFocused: document.activeElement === add,
    };
  });
  assert.equal(persisted.formInitiallyClosed, true);
  assert.deepEqual(persisted.values, ['100 pages', '20 min']);
  assert.equal(persisted.message, 'All activities are logged for this day.');
  assert.equal(persisted.addText, 'Add activity');
  assert.equal(persisted.addFocused, true);

  const manager = await page.evaluate(() => {
    document.querySelector('#day-content .activity-shortcut').click();
    return {
      open: document.querySelector('dialog').matches(':modal'),
      title: document.querySelector('#dialog-title').innerText,
      activities: [...document.querySelectorAll('dialog .activity-name')].map((name) => name.innerText),
    };
  });
  assert.deepEqual(manager, { open: true, title: 'Activities', activities: ['Read', 'Stretch'] });

  const removed = await page.evaluate(async () => {
    const find = (selector) => document.querySelector(selector);
    const today = find('[aria-current="date"]');
    const yesterday = today.previousElementSibling;
    const olderDay = yesterday.previousElementSibling;
    const positions = () => [olderDay, yesterday, today].map((day) => day.getBoundingClientRect().top);
    const before = positions();
    const remaining = () => [...document.querySelectorAll('.log-value')].map((value) => value.textContent);
    const choose = (text) => [...document.querySelectorAll('dialog .actions button')].find((button) => button.textContent === text);
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
    const afterRemoveActivity = positions();
    const surviving = remaining();
    yesterday.click();
    const pastLogs = remaining();
    find('.log-row').click();
    choose('Delete').click();
    for (let tries = 0; find('dialog').open; tries++) {
      if (tries === 90) throw new Error('Log removal did not finish');
      await nextFrame();
    }
    await nextFrame();
    const formAfterDelete = find('#day-content form')?.checkVisibility();
    return { before, afterRemoveActivity, surviving, pastLogs, afterRemoveLog: positions(), remaining: remaining(), confirmation, formAfterDelete };
  });
  assert.equal(removed.confirmation, 'Remove Read?');
  assert.deepEqual(removed.afterRemoveActivity, removed.before);
  assert.deepEqual(removed.surviving, ['20 min']);
  assert.deepEqual(removed.pastLogs, ['25 min']);
  assert.ok(removed.afterRemoveLog[1] > removed.afterRemoveActivity[1]);
  assert.equal(removed.afterRemoveLog[0], removed.afterRemoveActivity[0]);
  assert.equal(removed.afterRemoveLog[2], removed.afterRemoveActivity[2]);
  assert.deepEqual(removed.remaining, []);
  assert.equal(removed.formAfterDelete, true);

  await page.reload();
  await settle(page);
  const finalState = await page.evaluate(() => {
    const today = document.querySelector('[aria-current="date"]');
    const yesterday = today.previousElementSibling;
    const heights = [yesterday.previousElementSibling, yesterday, today].map((day) => day.getBoundingClientRect().top);
    yesterday.click();
    const pastLogs = document.querySelectorAll('.log-row').length;
    today.click();
    const todayLogs = [...document.querySelectorAll('.log-value')].map((value) => value.textContent);
    document.querySelector('#manage').click();
    return {
      heights, pastLogs, todayLogs,
      activities: [...document.querySelectorAll('dialog .activity-name')].map((row) => row.textContent),
    };
  });
  assert.deepEqual(finalState.heights, removed.afterRemoveLog);
  assert.equal(finalState.pastLogs, 0);
  assert.deepEqual(finalState.todayLogs, ['20 min']);
  assert.deepEqual(finalState.activities, ['Stretch']);
});

test('an empty day offers Add activity directly and opens logging with the new activity selected', async (t) => {
  const page = await openCheckin(t);
  await page.setViewport(320, 640);
  await page.setReducedMotion('reduce');
  await settle(page);

  const flow = await page.evaluate(async () => {
    const find = (selector) => document.querySelector(selector);
    const bounds = (control) => {
      const { left, right, height } = control.getBoundingClientRect();
      return { left, right, height };
    };
    const waitFor = async (condition) => {
      for (let attempt = 0; !condition(); attempt++) {
        if (attempt === 90) throw new Error('Checkin update did not finish');
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    };
    const add = () => find('#day-content .activity-shortcut');
    const editor = find('dialog');
    find('[aria-current="date"]').click();
    const empty = {
      label: add().innerText,
      visible: add().checkVisibility(),
      logToggle: Boolean(find('[aria-label="Log activity"]')),
    };
    add().focus();
    add().click();
    const title = find('#dialog-title').innerText;
    const nameFocused = document.activeElement === find('dialog input');
    find('dialog .actions [type="button"]').click();
    const returned = !editor.open && document.activeElement === add();

    add().click();
    find('dialog input').value = 'Hike';
    const measure = find('dialog select');
    measure.value = 'custom';
    measure.dispatchEvent(new Event('change'));
    const unitInput = find('dialog input[placeholder]');
    unitInput.value = 'km';
    const activityFields = [find('dialog input'), measure, unitInput].map(bounds);
    const titleLeft = find('#dialog-title').getBoundingClientRect().left;
    find('dialog [type="submit"]').click();
    await waitFor(() => !editor.open);

    const picker = find('#day-content select');
    const valueField = find('#day-content .amount-group');
    const amount = valueField.querySelector('input');
    const log = {
      activity: picker.selectedOptions[0].text,
      unit: valueField.querySelector('.unit').innerText,
      amountFocused: document.activeElement === amount,
      fields: [picker, valueField].map(bounds),
      viewport: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
    };
    amount.value = '2.5';
    find('#day-content [type="submit"]').click();
    await waitFor(() => Boolean(find('.log-value')));
    find('[aria-label="Log activity"]').click();
    const message = find('#day-content .inline-note').getBoundingClientRect();
    const shortcut = add().getBoundingClientRect();
    const allLogged = {
      label: add().innerText,
      underline: getComputedStyle(add()).textDecorationLine,
      hasIcon: Boolean(add().querySelector('svg')),
      besideMessage: shortcut.left >= message.right
        && Math.abs(shortcut.top + shortcut.height / 2 - (message.top + message.height / 2)) < 1,
      fitsDrawer: shortcut.right <= find('#day-content').getBoundingClientRect().right,
    };
    return { empty, title, nameFocused, returned, activityFields, titleLeft, log, allLogged };
  });
  assert.deepEqual(flow.empty, { label: 'Add activity', visible: true, logToggle: false });
  assert.equal(flow.title, 'Add activity');
  assert.equal(flow.nameFocused, true);
  assert.equal(flow.returned, true);
  assert.deepEqual(flow.activityFields, Array(3).fill(flow.activityFields[0]));
  assert.equal(flow.titleLeft, flow.activityFields[0].left);
  assert.equal(flow.log.activity, 'Hike');
  assert.equal(flow.log.unit, 'km');
  assert.equal(flow.log.amountFocused, true);
  assert.deepEqual(flow.log.fields[0], flow.log.fields[1]);
  assert.equal(flow.log.viewport.scrollWidth, flow.log.viewport.width);
  assert.deepEqual(flow.allLogged, {
    label: flow.empty.label, underline: 'underline', hasIcon: false, besideMessage: true, fitsDrawer: true,
  });

  await page.reload();
  await settle(page);
  const logs = await page.evaluate(() => {
    document.querySelector('[aria-current="date"]').click();
    return [...document.querySelectorAll('.log-row')].map((row) => row.innerText.trim());
  });
  assert.deepEqual(logs, ['Hike\n2.5 km']);
});

test('the logging shortcut preselects the last activity created through it', async (t) => {
  const page = await openCheckin(t);
  await page.setViewport(390, 844);
  await page.setReducedMotion('reduce');
  await settle(page);
  await page.evaluate(() => {
    const date = document.querySelector('[aria-current="date"]').dataset.date;
    localStorage.setItem('checkin.timeline.v1', JSON.stringify({
      activities: [{ id: 'walk', text: 'Walk', type: 'minutes', unit: 'min', goals: [] }],
      days: { [date]: { values: { walk: { amount: 30, effort: .29 } } } },
    }));
  });
  await page.reload();
  await settle(page);

  const preselection = await page.evaluate(async () => {
    const find = (selector) => document.querySelector(selector);
    const selectedActivity = () => find('#day-content select').selectedOptions[0].text;
    async function addActivity(name, unit) {
      find('[aria-label="New activity"]').click();
      find('dialog input').value = name;
      if (unit) {
        const measure = find('dialog select');
        measure.value = 'custom';
        measure.dispatchEvent(new Event('change'));
        find('dialog input[placeholder]').value = unit;
      }
      find('dialog [type="submit"]').click();
      for (let attempt = 0; !find('[aria-label="Edit ' + name + '"]'); attempt++) {
        if (attempt === 90) throw new Error('Activity did not save');
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    find('[aria-current="date"]').click();
    find('[aria-label="Log activity"]').click();
    find('#day-content .activity-shortcut').click();
    await addActivity('Stretch');
    const first = selectedActivity();
    await addActivity('Read', 'pages');
    find('#close-dialog').click();
    const last = selectedActivity();
    const amount = find('#day-content input');
    const unit = find('#day-content .amount-group .unit').innerText;
    const amountVisible = amount.getClientRects().length > 0 && !amount.disabled;
    amount.value = '12';
    find('#day-content [type="submit"]').click();
    for (let attempt = 0; find('#day-content form'); attempt++) {
      if (attempt === 90) throw new Error('Log did not save');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    find('[aria-label="Log activity"]').click();
    return { first, last, unit, amountVisible, next: selectedActivity() };
  });
  assert.deepEqual(preselection, {
    first: 'Stretch', last: 'Read', unit: 'pages', amountVisible: true, next: 'Choose an activity',
  });

  await page.reload();
  await settle(page);
  const logs = await page.evaluate(() => {
    document.querySelector('[aria-current="date"]').click();
    return [...document.querySelectorAll('.log-row')].map((row) => row.innerText.trim());
  });
  assert.deepEqual(logs, ['Walk\n30 min', 'Read\n12 pages']);
});

test('the day drawer and all dialogs share a width from phones to 4K', async (t) => {
  const page = await openCheckin(t);
  await page.setReducedMotion('reduce');
  await settle(page);
  await page.evaluate(() => {
    const date = document.querySelector('[aria-current="date"]').dataset.date;
    localStorage.setItem('checkin.timeline.v1', JSON.stringify({
      activities: [{ id: 'walk', text: 'Walk', type: 'minutes', unit: 'min', goals: [] }],
      days: { [date]: { values: { walk: { amount: 30, effort: .29 } } } },
    }));
  });
  await page.reload();

  const titles = ['Activities', 'Add activity', 'Edit activity', 'Remove Walk?', 'Walk'];
  const viewports = [
    { width: 3840, height: 2160, panelWidth: 340 },
    { width: 1440, height: 900, panelWidth: 340 },
    { width: 500, height: 844, panelWidth: 340 },
    { width: 320, height: 640, panelWidth: 292 },
  ];
  for (const { width, height, panelWidth } of viewports) {
    await page.setViewport(width, height);
    await settle(page);
    const layout = await page.evaluate(() => {
      const find = (selector) => document.querySelector(selector);
      const measure = () => [find('#dialog-title').innerText, find('dialog[open]').getBoundingClientRect().width];
      const cancel = () => find('dialog .actions [type="button"]').click();

      find('#manage').click();
      const results = [measure()];
      for (const label of ['New activity', 'Edit Walk', 'Remove Walk']) {
        find(`[aria-label="${label}"]`).click();
        results.push(measure());
        cancel();
      }
      find('#close-dialog').click();
      find('[aria-current="date"]').click();
      const drawerWidth = find('#day-drawer').getBoundingClientRect().width;
      find('.log-row').click();
      results.push(measure());
      find('#close-dialog').click();
      find('#close-day').click();
      return { dialogs: results, drawerWidth };
    });
    assert.deepEqual(layout, {
      dialogs: titles.map((title) => [title, panelWidth]),
      drawerWidth: panelWidth,
    });
  }
});

test('an activity edit keeps old logs and the open log editor leaves room to swipe on mobile', async (t) => {
  const page = await openCheckin(t);
  await page.setViewport(390, 844);
  await page.setReducedMotion('reduce');
  await settle(page);
  const today = await page.evaluate(() => {
    const date = document.querySelector('[aria-current="date"]').dataset.date;
    localStorage.setItem('checkin.timeline.v1', JSON.stringify({
      activities: [{ id: 'walk', text: 'Walk', type: 'minutes', unit: 'min', goals: [] }],
      days: { [date]: { values: { walk: { amount: 30, effort: .29 } } } },
    }));
    return date;
  });
  await page.reload();
  await settle(page);
  const positions = await page.evaluate(async () => {
    const find = (selector) => document.querySelector(selector);
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    find('#manage').click();
    const edit = find('[aria-label="Edit Walk"]');
    const order = edit.nextElementSibling.getAttribute('aria-label');
    edit.click();
    const title = find('#dialog-title').textContent;
    const fields = [find('dialog input').value, find('dialog select').value];
    find('dialog input').value = 'Morning walk';
    find('dialog select').value = 'custom';
    find('dialog select').dispatchEvent(new Event('change'));
    find('dialog input[placeholder]').value = 'km';
    find('dialog [type="submit"]').click();
    for (let attempt = 0; !find('[aria-label="Edit Morning walk"]'); attempt++) {
      if (attempt === 90) throw new Error('Activity edit did not save');
      await frame();
    }
    find('#close-dialog').click();
    find('[aria-current="date"]').click();
    find('.log-row').click();
    find('dialog input').value = '42';
    const stage = find('#timeline').getBoundingClientRect();
    const drawer = find('#day-drawer').getBoundingClientRect();
    const editor = find('dialog').getBoundingClientRect();
    return {
      order, title, fields, stageHeight: stage.height, overlap: stage.bottom - drawer.top,
      stageSwipeY: Math.round(stage.top + stage.height * .44), editorSwipeY: Math.round(editor.top + 18),
      modeless: !find('dialog').matches(':modal'), unit: find('dialog .unit').textContent,
    };
  });
  assert.equal(positions.order, 'Remove Walk');
  assert.equal(positions.title, 'Edit activity');
  assert.deepEqual(positions.fields, ['Walk', 'minutes']);
  assert.ok(positions.stageHeight > 520 && positions.overlap >= 110);
  assert.equal(positions.modeless, true);
  assert.equal(positions.unit, 'min');

  await page.swipe(320, 65, positions.stageSwipeY);
  await settle(page);
  const centerAfterSwipe = await page.evaluate(() => document.querySelector('.day[tabindex="0"]').dataset.date);
  assert.notEqual(centerAfterSwipe, today);
  await page.swipe(280, 105, positions.editorSwipeY);
  await settle(page);
  const afterEditorSwipe = await page.evaluate(() => ({
    centered: document.querySelector('.day[tabindex="0"]').dataset.date,
    draft: document.querySelector('dialog[open] input').value,
  }));
  assert.deepEqual(afterEditorSwipe, { centered: centerAfterSwipe, draft: '42' });

  await page.swipe(6, 320, positions.editorSwipeY);
  await settle(page);
  const nextSwipe = await page.evaluate(() => ({
    centered: document.querySelector('.day[tabindex="0"]').dataset.date,
    draft: document.querySelector('dialog[open] input').value,
  }));
  assert.notEqual(nextSwipe.centered, centerAfterSwipe);
  assert.equal(nextSwipe.draft, '42');

  await page.evaluate(async () => {
    document.querySelector('dialog [type="submit"]').click();
    for (let attempt = 0; document.querySelector('dialog').open; attempt++) {
      if (attempt === 90) throw new Error('Log edit did not save');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
  await page.reload();
  await settle(page);
  const reopened = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const today = find('[aria-current="date"]');
    today.click();
    const log = find('.log-row').innerText.trim();
    today.previousElementSibling.click();
    const picker = find('#day-content select');
    picker.selectedIndex = 1;
    picker.dispatchEvent(new Event('change'));
    return { log, newUnit: find('#day-content .unit').textContent };
  });
  assert.equal(reopened.log, 'Morning walk\n42 min');
  assert.equal(reopened.newUnit, 'km');
});

test('random effects can follow, leave, pulse, and recolor the graph, or land on the busiest day', async (t) => {
  const page = await openCheckin(t, () => {
    let time = 1000;
    const frame = requestAnimationFrame;
    window.requestAnimationFrame = (callback) => frame(() => callback(time));
    performance.now = () => time;
    const interval = window.setInterval;
    window.setInterval = (callback, delay) => {
      if (delay !== 5000) return interval(callback, delay);
      window.traverse = (kind, rolls = []) => {
        const random = Math.random;
        let index = -1;
        Math.random = () => (++index === 0 ? (kind + .2) / 9 : rolls[index - 1] ?? (index === 1 ? .99 : .5));
        try {
          callback();
        } finally {
          Math.random = random;
        }
      };
    };
    window.advanceCheckin = (duration) => { time += duration; };
  });
  await settle(page);
  const colorSteps = await page.evaluate(async () => {
    const accent = () => document.documentElement.style.getPropertyValue('--accent');
    const result = [accent()];
    for (const step of [120, 3000, 3000]) {
      window.advanceCheckin(step);
      await new Promise((resolve) => setTimeout(resolve, 100));
      result.push(accent());
    }
    return result.map((color) => parseInt(color.slice(3, 5), 16));
  });
  assert.ok(Math.abs(colorSteps[1] - colorSteps[0]) <= 3);
  assert.ok(colorSteps[1] > colorSteps[2] && colorSteps[2] > colorSteps[3]);

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
      window.traverse(index);
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

  const playful = await page.evaluate(async () => {
    const canvas = document.querySelector('#graph');
    const context = canvas.getContext('2d');
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const height = canvas.clientHeight;
    const spacing = canvas.clientWidth / 21;
    const baseline = height * .56;
    const reach = 19.5;
    const progressAt = (offset) => (offset / reach + 1) / 2;
    const sample = (offset, y) => {
      const x = Math.round(canvas.clientWidth / 2 + offset * spacing);
      const data = context.getImageData(x - 2, Math.round(y) - 2, 5, 5).data;
      return Math.max(...data.filter((_, index) => index % 4 === 3));
    };
    async function play(kind, duration, progress, points, rolls) {
      window.traverse(kind, rolls);
      window.advanceCheckin(duration * progress);
      await frame();
      const visible = points.map(([offset, y]) => sample(offset, y));
      window.advanceCheckin(5000 - duration * progress);
      return visible;
    }
    const fall = .62;
    const launchDay = 4;
    const exit = .45;
    const pulseEdges = [-.5, .5].map((offset) => [offset, baseline]);
    const pulseDots = [-1, 1].map((offset) => [offset, baseline - 9]);
    const splitExit = 1.08 + (reach - 1.08) * ((.82 - .68) / (1 - .68)) ** 1.55;
    await frame();
    return {
      pulseBase: [...pulseEdges, ...pulseDots].map(([offset, y]) => sample(offset, y)),
      below: await play(3, 3850, progressAt(-2.5), [[-2.5, baseline + height * .31]]),
      above: await play(3, 3850, progressAt(2.5), [[2.5, baseline - height * .31]]),
      launch: await play(4, 3950, .34 * fall, [[launchDay + .6 * Math.sin(Math.PI * fall), height * (-.14 + .7 * fall ** 1.24)]], [.99, .69]),
      launchExit: await play(4, 3950, .34 + .66 * exit, [[launchDay + (-reach - launchDay) * exit ** 1.45, baseline]], [.99, .69]),
      pause: await play(5, 4100, .56, [...pulseEdges, ...pulseDots]),
      splitExit: await play(5, 4100, .82, [[-splitExit, baseline], [splitExit, baseline]]),
      hop: await play(6, 3900, progressAt(-1.5), [[-1.5, baseline + height * .27]]),
      braid: await play(7, 3900, progressAt(-3), [[-3, baseline + height * .21], [-3, baseline - height * .29]]),
    };
  });
  for (const effect of ['below', 'above', 'launch', 'launchExit', 'splitExit', 'hop', 'braid']) {
    assert.ok(playful[effect].every((opacity) => opacity > 140), JSON.stringify({ effect, playful }));
  }
  assert.ok(playful.pause.every((opacity, index) => opacity > playful.pulseBase[index] + 15), JSON.stringify(playful));

  const wake = await page.evaluate(async () => {
    const canvas = document.querySelector('#graph');
    const context = canvas.getContext('2d');
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const sample = (offset) => {
      const x = Math.round(canvas.clientWidth * (.5 + offset / 21));
      return Array.from(context.getImageData(x, Math.floor(canvas.clientHeight * .56), 1, 1).data);
    };
    const duration = 3300 * .6;
    async function play(chance) {
      window.traverse(0, [chance, .95]);
      window.advanceCheckin(duration);
      await frame();
      const result = [-2, -2.35, 8].map(sample);
      window.advanceCheckin(-duration);
      return result;
    }
    const plain = await play(.3);
    const colored = await play(.29);
    const spark = document.documentElement.style.getPropertyValue('--spark');
    return { plain, colored, spark: [1, 3, 5].map((from) => parseInt(spark.slice(from, from + 2), 16)) };
  });
  const colorDistance = (rgba) => wake.spark.reduce((total, channel, index) => total + Math.abs(rgba[index] - channel), 0);
  for (const index of [0, 1]) {
    assert.ok(colorDistance(wake.colored[index]) < colorDistance(wake.plain[index]), JSON.stringify(wake));
    assert.ok(wake.colored[index][3] > wake.plain[index][3] + 12, JSON.stringify(wake));
  }
  assert.deepEqual(wake.colored[2], wake.plain[2]);

  const visits = await page.evaluate(async () => {
    const drawer = document.querySelector('#day-drawer');
    const glow = document.querySelector('#drawer-glow');
    const overlay = glow.getContext('2d');
    const graph = document.querySelector('#graph');
    const graphContext = graph.getContext('2d');
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    document.querySelector('[aria-current="date"]').click();
    await new Promise((resolve) => setTimeout(resolve, 260));
    const box = drawer.getBoundingClientRect();
    const center = (box.left + box.right) / 2;
    const sides = [box.left - 5, box.right + 5];
    const middle = (box.top + box.bottom) / 2;
    const alpha = (context, x, y) => {
      const rgba = context.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
      return Math.max(...rgba.filter((_, index) => index % 4 === 3));
    };

    async function trace(kind, chance) {
      window.traverse(kind, [.99, chance]);
      let completed = false;
      let appeared = false;
      let continued = false;
      let enteredFrom = null;
      for (let time = 60; time <= 4900; time += 60) {
        window.advanceCheckin(60);
        await frame();
        if (glow.hidden) {
          if (appeared) {
            const direction = kind === 0 ? 1 : -1;
            const y = graph.clientHeight * .56;
            for (let offset = 3; offset <= 9; offset += .25) {
              const x = graph.clientWidth * (.5 + direction * offset / 21);
              continued ||= alpha(graphContext, x, y) > 231;
            }
          }
          continue;
        }
        appeared = true;
        const arrival = sides.map((x) => alpha(overlay, x, box.top + 14));
        if (enteredFrom === null && Math.max(...arrival) > 48) enteredFrom = arrival[0] > arrival[1] ? 'left' : 'right';
        const edges = [[sides[0], middle], [sides[1], middle], [center, box.top - 5], [center, box.bottom + 5]];
        completed ||= edges.every(([x, y]) => alpha(overlay, x, y) > 74);
      }
      return { appeared, completed, continued, enteredFrom };
    }
    return {
      rejected: await trace(0, .4),
      forward: await trace(0, .399),
      reverse: await trace(1, .399),
    };
  });
  assert.equal(visits.rejected.appeared, false);
  assert.deepEqual(visits.forward, { appeared: true, completed: true, continued: true, enteredFrom: 'left' });
  assert.deepEqual(visits.reverse, { appeared: true, completed: true, continued: true, enteredFrom: 'right' });

  const handoffs = await page.evaluate(async () => {
    const graph = document.querySelector('#graph');
    const glow = document.querySelector('#drawer-glow');
    const drawer = document.querySelector('#day-drawer').getBoundingClientRect();
    const graphContext = graph.getContext('2d');
    const glowContext = glow.getContext('2d');
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const baseline = Math.floor(graph.clientHeight * .56);
    const x = 100;
    const width = Math.floor(drawer.left) - x - 55;

    function graphTrail(ribbon) {
      const { data } = graphContext.getImageData(x, 0, width, graph.height);
      let total = 0;
      for (let y = 0; y < graph.height; y += 3) {
        if (ribbon ? Math.abs(y - baseline) <= 26 : Math.abs(y - baseline) > 5) continue;
        for (let column = 0; column < width; column += 3) total += data[(y * width + column) * 4 + 3];
      }
      return total;
    }

    function loopTrail() {
      if (glow.hidden) return 0;
      const { data } = glowContext.getImageData(0, 0, glow.width, glow.height);
      let total = 0;
      for (let y = 0; y < glow.height; y += 4) {
        for (let x = 0; x < glow.width; x += 4) total += data[(y * glow.width + x) * 4 + 3];
      }
      return total;
    }

    async function step(time) {
      window.advanceCheckin(time);
      await frame();
    }

    async function handoff(kind, rolls) {
      await step(5000);
      const ribbon = kind === 3;
      const idle = graphTrail(ribbon);
      window.traverse(kind, rolls);
      let before = idle;
      for (let turn = 0; turn < 120 && glow.hidden; turn++) {
        await step(20);
        if (glow.hidden) before = Math.max(before, graphTrail(ribbon));
      }
      if (glow.hidden) throw new Error('Drawer Loop did not begin');
      const during = graphTrail(ribbon);
      await step(1625);
      const after = graphTrail(ribbon);
      const returningTail = loopTrail();
      await step(115);
      const fadingTail = loopTrail();
      await step(180);
      return { idle, before, during, after, returningTail, fadingTail, loopCleared: glow.hidden };
    }
    return [await handoff(0, [.29, .8, .399]), await handoff(3, [.99, .399])];
  });
  for (const effect of handoffs) {
    assert.ok(effect.before > effect.idle + 100, JSON.stringify(effect));
    assert.equal(effect.during, effect.idle);
    assert.equal(effect.after, effect.idle);
    assert.ok(effect.returningTail > effect.fadingTail && effect.fadingTail > 0, JSON.stringify(effect));
    assert.equal(effect.loopCleared, true);
  }

  const companions = await page.evaluate(async () => {
    const graph = document.querySelector('#graph');
    const glow = document.querySelector('#drawer-glow');
    const context = graph.getContext('2d');
    const { clientWidth: width, clientHeight: height } = graph;
    const baseline = height * .56;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const samples = [.65, .72];

    async function trace(kind, travelDuration, offsetFor, yFor) {
      const tipOpacity = (progress) => {
        const offset = offsetFor(progress);
        const x = width * (.5 + offset / 21);
        const y = yFor(offset);
        const { data } = context.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5);
        return Math.max(...data.filter((_, index) => index % 4 === 3));
      };
      window.advanceCheckin(5000);
      await frame();
      const idle = samples.map(tipOpacity);
      window.traverse(kind, [.99, .399]);
      let previous = 0;
      const moving = [];
      for (const progress of samples) {
        window.advanceCheckin(travelDuration * (progress - previous));
        await frame();
        moving.push({ looping: !glow.hidden, opacity: tipOpacity(progress) });
        previous = progress;
      }
      return { idle, moving };
    }

    const offset = (progress) => 39 * (progress - .5);
    return {
      crossing: await trace(2, 3020, (progress) => -offset(progress), () => baseline),
      ribbons: await trace(7, 3300, offset, (day) => baseline + height * .29 * Math.sin(day * Math.PI / 6)),
    };
  });
  for (const [name, { idle, moving }] of Object.entries(companions)) {
    for (const [index, { looping, opacity }] of moving.entries()) {
      assert.ok(looping && opacity > idle[index] + 35, JSON.stringify({ name, idle, moving }));
    }
  }

  const eligible = await page.evaluate(async () => {
    const glow = document.querySelector('#drawer-glow');
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const visited = [];
    for (let kind = 2; kind < 9; kind++) {
      const rolls = kind === 4 || kind === 8 ? [.99, .5, .399] : [.99, .399];
      window.traverse(kind, rolls);
      let seen = false;
      for (let time = 0; time < 4800 && !seen; time += 200) {
        window.advanceCheckin(200);
        await frame();
        seen = !glow.hidden;
      }
      visited.push(seen);
    }
    document.querySelector('#close-day').click();
    window.advanceCheckin(100);
    await frame();
    return { visited, hiddenAfterClose: glow.hidden };
  });
  assert.ok(eligible.visited.every(Boolean), JSON.stringify(eligible));
  assert.equal(eligible.hiddenAfterClose, true);

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

  const editorVisited = await page.evaluate(async () => {
    const find = (selector) => document.querySelector(selector);
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    find('[aria-current="date"]').click();
    find('.log-row').click();
    await new Promise((resolve) => setTimeout(resolve, 220));
    const box = find('dialog[open]').getBoundingClientRect();
    const glow = find('#drawer-glow');
    const context = glow.getContext('2d');
    const x = Math.round((box.left + box.right) / 2);
    const y = Math.round(box.bottom + 5);
    window.traverse(1, [.99, .399]);
    let bottomLit = false;
    for (let time = 0; time < 4500 && !bottomLit; time += 100) {
      window.advanceCheckin(100);
      await frame();
      if (glow.hidden) continue;
      const pixels = context.getImageData(x - 2, y - 2, 5, 5).data;
      bottomLit = pixels.some((alpha, index) => index % 4 === 3 && alpha > 65);
    }
    find('#close-dialog').click();
    find('#close-day').click();
    return bottomLit;
  });
  assert.equal(editorVisited, true);

  const landing = await page.evaluate(async () => {
    const canvas = document.querySelector('#graph');
    const context = canvas.getContext('2d');
    const stage = canvas.getBoundingClientRect();
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const best = document.querySelector('[aria-current="date"]').previousElementSibling.getBoundingClientRect();
    const x = best.left + best.width / 2;
    const nodeY = best.top - stage.top + 21;
    const height = canvas.clientHeight;
    const size = Math.min(32, height * .048);
    const roomAbove = Math.min(height * .27, nodeY - height * .07);
    const hover = nodeY + (roomAbove < height * .19 ? height * .27 : -roomAbove);
    const sample = (x, y) => {
      const data = context.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
      return Math.max(...data.filter((_, index) => index % 4 === 3));
    };
    let progress = 0;
    async function go(to) {
      window.advanceCheckin(4400 * (to - progress));
      progress = to;
      await frame();
    }
    window.traverse(8, [.99, .65]);
    const entryX = canvas.clientWidth * (.5 + 19.5 / 21);
    const entryY = -.14 * height;
    const alongFlight = (progress) => {
      const position = 1 - (1 - progress / .33) ** 1.6;
      return sample(entryX + (x - entryX) * position, entryY + (hover - entryY) * position);
    };
    const trailContrast = (fraction) => {
      const y = hover + (nodeY - hover) * fraction;
      return sample(x, y) - sample(x + 12, y);
    };
    await go(.18);
    const incoming = alongFlight(.18);
    const trail = alongFlight(.13);
    await go(.34);
    const small = sample(x + size * .72, hover);
    const hovering = sample(x, hover);
    await go(.49);
    const expanded = sample(x + size * .72, hover);
    const hoverTrail = alongFlight(.26);
    await go(.595);
    const dropping = sample(x, (hover + nodeY) / 2);
    const descendingHalo = sample(x + size * .72, (hover + nodeY) / 2);
    const descendingTrail = trailContrast(.23);
    await go(.715);
    const landingTrail = trailContrast(.74);
    await go(.82);
    const exitOffset = -1 + 20.5 * (.12 / .3) ** 1.28;
    const leaving = sample(canvas.clientWidth * (.5 + exitOffset / 21), height * .56);
    await go(1.2);
    progress = 0;
    window.traverse(8, [.99, hover < nodeY ? .44 : .31, .45]);
    await go(.56);
    const reversingTrail = trailContrast(.12);
    await go(1.2);
    return { incoming, trail, small, hovering, expanded, hoverTrail, dropping, descendingHalo, descendingTrail, landingTrail, leaving, reversingTrail };
  });
  assert.ok(landing.trail > 35, JSON.stringify(landing));
  for (const phase of ['hoverTrail', 'descendingTrail', 'landingTrail', 'reversingTrail']) {
    assert.ok(landing[phase] > 30, JSON.stringify(landing));
  }
  assert.ok(landing.expanded > landing.small + 35, JSON.stringify(landing));
  assert.ok(landing.descendingHalo > landing.small + 20, JSON.stringify(landing));
  for (const phase of ['incoming', 'hovering', 'dropping', 'leaving']) {
    assert.ok(landing[phase] > 165, JSON.stringify(landing));
  }

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

test('Beacon Landing bloom fades before the upper and lower graph edges', async (t) => {
  const page = await openCheckin(t);
  const cases = await page.evaluate(async () => {
    const { paintGraph } = await import('/graph.js');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const colors = { accent: '#9bfae2', secondary: '#aaa1ff', spark: '#efbaf4' };

    function sample(width, height, nodeFraction, side, progress) {
      canvas.width = width;
      canvas.height = height;
      const x = width / 2;
      const nodeY = height * nodeFraction;
      const pointAt = (index) => ({ index, x: x + index * 61, y: nodeY, count: 0, power: 0 });
      const wave = {
        kind: 'beacon-landing', anchor: 0, side, direction: 1, to: 20,
        entry: { day: -20, y: 0 }, started: 0, duration: 4400,
      };
      paintGraph(canvas, {
        width, height, ratio: 1, points: [-1, 0, 1].map(pointAt), pointAt, colors,
        today: 100, baseline: height * .56, spacing: 61, wave, now: progress * wave.duration,
        drawerGlow: {},
      });

      const alpha = (column, row) => context.getImageData(column, row, 1, 1).data[3];
      const core = context.getImageData(x, 0, 1, height).data;
      let center = 0;
      for (let row = 1; row < height; row++) {
        if (core[row * 4 + 3] > core[center * 4 + 3]) center = row;
      }
      return {
        lift: (center - nodeY) * side,
        core: alpha(x, center),
        halo: alpha(x + Math.round(height * .085), center),
        top: alpha(x, Math.floor(height * .05)),
        bottom: alpha(x, Math.ceil(height * .96)),
      };
    }

    return [[1440, 648], [390, 330]].map(([width, height]) => ({
      width,
      above: sample(width, height, .28, -1, .49),
      below: sample(width, height, .72, 1, .49),
      descendingFromBelow: sample(width, height, .127, 1, .66),
    }));
  });

  for (const result of cases) {
    for (const bloom of [result.above, result.below]) {
      assert.ok(bloom.lift > 20 && bloom.core > 200 && bloom.halo > 35, JSON.stringify(result));
    }
    assert.ok(result.descendingFromBelow.core > 200, JSON.stringify(result));
    for (const bloom of [result.above, result.below, result.descendingFromBelow]) {
      assert.equal(bloom.top + bloom.bottom, 0, JSON.stringify(result));
    }
  }
});
