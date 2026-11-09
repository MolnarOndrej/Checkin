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
  await page.navigate(url);
  return page;
}

function captureRotations() {
  Math.random = () => .99;
  const ticks = window.rotationTicks = new Map();
  window.setInterval = (callback, delay) => {
    ticks.set(delay, callback);
    return delay;
  };
  window.clearInterval = (delay) => ticks.delete(delay);
}

test('backup restores missing check-ins and goal plans without overwriting saved records', async (t) => {
  const page = await openCheckin(t);
  const exported = await page.evaluate(async () => {
    const { dayKey } = await import('/calendar.js');
    const today = `checkin.day.${dayKey(new Date())}`;
    const older = 'checkin.day.2025-01-02';
    const records = {
      [today]: {
        score: 80, notes: 'Evening reflection', nextPlan: 'Start after dinner',
        goals: [
          { text: 'Guitar', done: false, worked: true, minutes: 20 },
          { text: 'Writing', done: true, measurement: { unit: 'pages', amount: 0, trackMinutes: false } },
        ],
      },
      [older]: { score: null, notes: 'Older reflection', goals: [] },
      'checkin.pinned.guitar': {
        text: 'Guitar', pinned: true, plan: 'Practice the chorus', fallback: 'Play it once', pickup: 'Bar 9',
      },
      'checkin.pinned.reading': {
        text: 'Reading', pinned: false, pickup: 'Page 23', measurement: { unit: 'pages', trackMinutes: false },
        goals: [{ id: 'reading-2025', metric: 'amount', amount: 50, unit: 'pages', repeat: 'range', start: '2025-01-01', end: '2025-01-31' }],
      },
    };
    for (const [key, value] of Object.entries(records)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('unrelated', 'keep me');

    const find = (selector) => document.querySelector(selector);
    find('#open-backup').click();
    const click = HTMLAnchorElement.prototype.click;
    let download;
    HTMLAnchorElement.prototype.click = function () {
      download = { filename: this.download, response: fetch(this.href) };
    };
    try {
      find('#download-backup').click();
    } finally {
      HTMLAnchorElement.prototype.click = click;
    }
    const { filename, response } = download;
    const backup = window.testBackup = await (await response).text();
    window.chooseBackup = (contents) => new Promise((resolve) => {
      const feedback = find('#backup-feedback');
      const observer = new MutationObserver(() => {
        if (!feedback.textContent) return;
        observer.disconnect();
        resolve({ message: feedback.textContent, canRestore: !find('#restore-backup').hidden });
      });
      observer.observe(feedback, { childList: true });
      const transfer = new DataTransfer();
      transfer.items.add(new File([contents], filename, { type: 'application/json' }));
      const input = find('#backup-file');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    });
    for (const key of Object.keys(records)) localStorage.removeItem(key);
    localStorage.setItem(older, JSON.stringify({ score: null, notes: 'Keep this reflection', goals: [] }));
    return { filename, today, records, backup: JSON.parse(backup) };
  });
  assert.equal(exported.filename, `${exported.today.replace('checkin.day.', 'checkin-backup-')}.json`);
  assert.deepEqual(exported.backup, { format: 'checkin', version: 1, records: exported.records });

  assert.deepEqual(await page.evaluate(() => {
    const invalid = JSON.parse(window.testBackup);
    invalid.records['checkin.day.2025-02-30'] = { goals: [] };
    return window.chooseBackup(JSON.stringify(invalid));
  }), { message: 'Checkin could not read this backup. Choose a valid Checkin backup file.', canRestore: false });
  assert.deepEqual(await page.evaluate(() => window.chooseBackup(window.testBackup)), {
    message: '1 check-in and 2 activity records ready to restore. This browser already has 1 record from the backup.',
    canRestore: true,
  });

  const attempted = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const keys = () => Object.keys(localStorage).filter((key) => key.startsWith('checkin.day.') || key.startsWith('checkin.pinned.'));
    const before = keys();
    find('#notes').value = 'Unsaved reflection';
    find('#restore-backup').click();
    const blockedDraft = find('#backup-feedback').textContent;
    const draft = find('#notes').value;
    find('#notes').value = '';

    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'checkin.pinned.guitar') throw new DOMException('Storage is full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
    try {
      find('#restore-backup').click();
    } finally {
      Storage.prototype.setItem = setItem;
    }
    return { before, after: keys(), blockedDraft, draft, failure: find('#backup-feedback').textContent };
  });
  assert.deepEqual(attempted, {
    before: ['checkin.day.2025-01-02'], after: ['checkin.day.2025-01-02'],
    blockedDraft: 'Save your current check-in edits before restoring this date.',
    draft: 'Unsaved reflection', failure: 'Checkin could not restore the backup. Check browser storage and try again.',
  });

  assert.deepEqual(await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('#restore-backup').click();
    return {
      message: find('#backup-feedback').textContent,
      note: find('#notes').value,
      week: find('#week-goals').textContent,
      goals: find('#pinned-list').textContent.trim(),
    };
  }), { message: 'Restored 3 records.', note: 'Evening reflection', week: 'Guitar · 1 dayWriting · 1 day', goals: 'Guitar' });

  await page.reload();
  assert.deepEqual(await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('#edit-plan').click();
    const previousPlan = find('#next-plan').value;
    find('#cancel-plan-edit').click();
    find('[data-edit]').click();
    return {
      previousPlan, note: find('#notes').value, score: find('#score').valueAsNumber,
      minutes: find('[aria-label="Optional minutes for Guitar"]').valueAsNumber,
      writing: find('[aria-label="Progress for Writing"]').value,
      pages: find('[aria-label="Optional pages for Writing"]').valueAsNumber,
      plan: find('#activity-plan').value, fallback: find('#activity-fallback').value, pickup: find('#activity-pickup').value,
      unpinned: JSON.parse(localStorage.getItem('checkin.pinned.reading')),
      existing: JSON.parse(localStorage.getItem('checkin.day.2025-01-02')).notes,
      unrelated: localStorage.getItem('unrelated'),
    };
  }), {
    previousPlan: 'Start after dinner', note: 'Evening reflection', score: 80, minutes: 20, writing: 'done', pages: 0,
    plan: 'Practice the chorus', fallback: 'Play it once', pickup: 'Bar 9',
    unpinned: exported.records['checkin.pinned.reading'],
    existing: 'Keep this reflection', unrelated: 'keep me',
  });
});

test('the Activities panel fades and slides in with the check-in on refresh', async (t) => {
  const page = await openCheckin(t, () => {
    document.addEventListener('DOMContentLoaded', () => {
      for (const animation of document.getAnimations()) {
        if (animation.animationName === 'enter') {
          animation.pause();
          animation.currentTime = 0;
        }
      }
    });
  });
  await page.setReducedMotion('no-preference');
  await page.reload();
  assert.deepEqual(await page.evaluate(() => {
    return ['.journal-card', '.activities-card'].map((selector) => {
      const panel = document.querySelector(selector);
      const animation = panel.getAnimations().find(({ animationName }) => animationName === 'enter');
      const { delay, duration } = animation.effect.getTiming();
      const sample = () => {
        const { opacity, transform } = getComputedStyle(panel);
        return { opacity: Number(opacity), y: new DOMMatrix(transform === 'none' ? undefined : transform).m42 };
      };
      const start = sample();
      animation.currentTime = delay + duration;
      return { delay, duration, start, end: sample() };
    });
  }), Array(2).fill({ delay: 240, duration: 750, start: { opacity: 0, y: 12 }, end: { opacity: 1, y: 0 } }));

  await page.setReducedMotion('reduce');
  await page.reload();
  assert.deepEqual(await page.evaluate(() => {
    const panel = document.querySelector('.activities-card');
    const { opacity, transform } = getComputedStyle(panel);
    return { opacity, transform, animations: panel.getAnimations().length };
  }), { opacity: '1', transform: 'none', animations: 0 });
});

test('ambient effects run at different rhythms without moving the landscape', async (t) => {
  const page = await openCheckin(t);
  await page.setReducedMotion('no-preference');
  const animated = await page.evaluate(() => {
    const effects = [
      ['body', '::before', .05, .95],
      ['body', '::after', .05, .95],
      ['.moon-halo', null, .05, .95, 'moon'],
      ['.sky-star', null, .1, .5, 'stars'],
      ['.sky-meteor', null, .05, .2, 'meteor'],
      ['.firefly', null, .05, .3, 'fireflies'],
      ['.calendar-card', '::before', .05, .55],
    ];
    const scene = document.querySelector('.hero-scene');
    return {
      landscapeAnimations: [...document.querySelectorAll('.hero, .hero-scene, .hero-scene svg, .hero-scene use')]
        .map((element) => getComputedStyle(element).animationName),
      effects: effects.map(([selector, pseudo, dimAt, brightAt, effect]) => {
        if (effect) scene.dataset.ambient = effect;
        const element = document.querySelector(selector);
        const style = () => getComputedStyle(element, pseudo);
        const animation = document.getAnimations().find(({ animationName }) => animationName === style().animationName);
        const { delay, duration, iterations } = animation.effect.getTiming();
        animation.pause();
        // Sample an even-numbered cycle after any negative start delay.
        const cycleStart = delay + (iterations === Infinity ? 2 * duration : 0);
        animation.currentTime = cycleStart + duration * dimAt;
        const dim = Number(style().opacity);
        const start = style().transform;
        animation.currentTime = cycleStart + duration * brightAt;
        return {
          duration, expectedIterations: iterations === (effect === 'meteor' ? 1 : Infinity),
          brightens: Number(style().opacity) - dim > .45,
          moves: style().transform !== start,
          interceptsClicks: Boolean(pseudo) && style().pointerEvents !== 'none',
        };
      }),
    };
  });
  assert.deepEqual(animated.landscapeAnimations, ['none', 'none', 'none', 'none']);
  assert.equal(new Set(animated.effects.map(({ duration }) => duration)).size, animated.effects.length);
  assert.ok(animated.effects.every(({ expectedIterations, brightens, interceptsClicks }) => expectedIterations && brightens && !interceptsClicks));
  assert.deepEqual(animated.effects.map(({ moves }) => moves), [true, true, false, false, true, true, true]);

  await page.setReducedMotion('reduce');
  assert.deepEqual(await page.evaluate(() => {
    return {
      running: document.getAnimations().length,
      haloVisible: Number(getComputedStyle(document.querySelector('.moon-halo')).opacity) > 0,
      meteorHidden: Number(getComputedStyle(document.querySelector('.sky-meteor')).opacity) === 0,
    };
  }), { running: 0, haloVisible: true, meteorHidden: true });
});

test('moonlit trail rotates through random effects and the river flows downstream when selected', async (t) => {
  const page = await openCheckin(t, captureRotations);
  assert.deepEqual(await page.evaluate(() => {
    const ambientTick = window.rotationTicks.get(12_000);
    const scene = document.querySelector('.hero-scene');
    const ripple = scene.querySelector('.river-current path');
    const animation = ripple.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const start = Number.parseFloat(getComputedStyle(ripple).strokeDashoffset);
    animation.currentTime = 4_000;
    const moving = Number.parseFloat(getComputedStyle(ripple).strokeDashoffset) < start;
    const visible = Number(getComputedStyle(ripple).opacity) > .5;
    const effects = [scene.dataset.ambient];
    Math.random = () => .99;
    ambientTick();
    effects.push(scene.dataset.ambient);
    const hidden = Number(getComputedStyle(ripple).opacity) === 0 && ripple.getAnimations().length === 0;
    for (const draw of [.6, 0, 0, .99]) {
      Math.random = () => draw;
      ambientTick();
      effects.push(scene.dataset.ambient);
    }
    return { effects, moving, visible, hidden };
  }), {
    effects: ['river', 'fireflies', 'meteor', 'moon', 'stars', 'river'],
    moving: true, visible: true, hidden: true,
  });

  await page.setReducedMotion('reduce');
  assert.deepEqual(await page.evaluate(async () => {
    const scene = document.querySelector('.hero-scene');
    for (let frame = 0; frame < 60 && scene.hasAttribute('data-ambient'); frame++) {
      await new Promise(requestAnimationFrame);
    }
    return {
      rotating: window.rotationTicks.has(12_000),
      selected: scene.hasAttribute('data-ambient'),
      rippleVisible: Number(getComputedStyle(scene.querySelector('.river-current path')).opacity) > 0,
    };
  }), { rotating: false, selected: false, rippleVisible: false });
});

test('Moonlit Trail fireflies hold their position and brightness between turns', async (t) => {
  const page = await openCheckin(t, captureRotations);
  await page.setReducedMotion('no-preference');
  await page.reload();
  const result = await page.evaluate(async () => {
    const tick = window.rotationTicks.get(12_000);
    const fireflies = [...document.querySelectorAll('.firefly')];
    const frame = () => new Promise(requestAnimationFrame);
    const sample = () => fireflies.map((firefly) => {
      const { transform, opacity } = getComputedStyle(firefly);
      return { transform, opacity };
    });

    const idle = sample();
    await frame();
    const stillIdle = sample();
    tick(); // River to fireflies.
    const started = sample();
    await frame();
    await frame();
    const flying = sample();
    tick(); // Fireflies to river.
    const stopped = sample();
    await frame();
    await frame();
    const holding = sample();
    tick(); // River back to fireflies.
    const resumed = sample();
    await frame();
    await frame();
    return { idle, stillIdle, started, flying, stopped, holding, resumed, movingAgain: sample() };
  });
  assert.deepEqual(result.stillIdle, result.idle);
  assert.deepEqual(result.started, result.idle);
  assert.notDeepEqual(result.flying, result.started);
  assert.deepEqual(result.stopped, result.flying);
  assert.deepEqual(result.holding, result.stopped);
  assert.deepEqual(result.resumed, result.holding);
  assert.notDeepEqual(result.movingAgain, result.resumed);
});

test('the Moonlit Trail motto rotates on the timer and stays the same on refresh', async (t) => {
  const page = await openCheckin(t, captureRotations);
  await page.setViewport(320, 800);
  const result = await page.evaluate(() => {
    const title = document.querySelector('#page-title');
    const lines = [...title.querySelectorAll('span, em')];
    const heroRight = title.closest('.hero').getBoundingClientRect().right;
    const readTitle = () => lines.map((line) => line.textContent).join(' ');
    const first = readTitle();
    const ambientTick = window.rotationTicks.get(12_000);
    for (let tick = 0; tick < 24; tick++) ambientTick();
    const afterAmbientTicks = readTitle();
    const mottoTick = window.rotationTicks.get(300_000);
    const mottos = [];
    for (let tick = 0; tick < 10; tick++) {
      mottos.push({
        text: readTitle(),
        fits: lines.every((line) => line.getClientRects().length === 1
          && line.getBoundingClientRect().right <= heroRight),
      });
      mottoTick();
    }
    return { first, afterAmbientTicks, mottos, afterCycle: readTitle() };
  });
  assert.equal(result.first, 'Let effort lead.');
  assert.equal(result.afterAmbientTicks, result.first);
  assert.equal(result.mottos[1].text, 'The way forward.');
  assert.equal(new Set(result.mottos.map(({ text }) => text)).size, 10);
  assert.deepEqual(result.mottos.filter(({ fits }) => !fits), []);
  assert.equal(result.afterCycle, result.first);

  await page.evaluate(() => window.rotationTicks.get(300_000)());
  await page.reload();
  const readMotto = () => document.querySelector('#page-title').textContent;
  assert.equal(await page.evaluate(readMotto), 'The way forward.');
  await page.evaluate(() => window.rotationTicks.get(300_000)());
  assert.equal(await page.evaluate(readMotto), 'One step at a time.');
  await page.reload();
  assert.equal(await page.evaluate(readMotto), 'One step at a time.');

  const url = await page.evaluate(() => location.href);
  await page.navigate('about:blank');
  await page.navigate(url);
  assert.equal(await page.evaluate(readMotto), result.first);
});

test('partial work counts without a daily score and survives reload', async (t) => {
  const page = await openCheckin(t);
  const layout = await page.evaluate(() => ({
    hasHeader: Boolean(document.querySelector('.shell > header, #sound')),
    hasFooter: Boolean(document.querySelector('.shell > footer')),
    heroTop: document.querySelector('.hero').getBoundingClientRect().top,
  }));
  assert.equal(layout.hasHeader, false);
  assert.equal(layout.hasFooter, false);
  assert.ok(layout.heroTop > 0 && layout.heroTop <= 24);

  const saved = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('#new-goal').value = 'Guitar';
    find('#add-goal').click();
    const minutes = find('[aria-label="Optional minutes for Guitar"]');
    minutes.value = '0';
    find('#save').click();
    const validation = find('#feedback').textContent;
    minutes.value = '20';
    find('#save').click();
    return {
      validation,
      feedback: find('#feedback').textContent,
      workMark: find('[data-selected]').dataset.status,
      week: find('#week-goals').textContent,
      glowed: Boolean(find('#trail-waypoints .trail-glow')),
    };
  });
  assert.deepEqual(saved, {
    validation: 'Enter whole minutes from 1 to 1440, or leave minutes blank.',
    feedback: 'Check-in saved.',
    workMark: 'work',
    week: 'Guitar · 1 day',
    glowed: true,
  });

  await page.reload();
  const reloaded = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const state = {
      progress: find('[aria-label="Progress for Guitar"]').value,
      minutes: find('[aria-label="Optional minutes for Guitar"]').valueAsNumber,
      score: find('#score').value,
      summary: find('#journal-copy').textContent,
      week: find('#week-goals').textContent,
    };
    find('#save').click();
    return { ...state, feedback: find('#feedback').textContent, glowed: Boolean(find('.trail-glow')) };
  });
  assert.deepEqual(reloaded, {
    progress: 'worked', minutes: 20, score: '', summary: 'You put 20 min into “Guitar”.',
    week: 'Guitar · 1 day', feedback: 'Check-in saved.', glowed: false,
  });
});

test('daily lap lengths and durations persist while a distance goal spans a change of unit', async (t) => {
  const page = await openCheckin(t, () => {
    const fixed = new Date(2026, 10, 11, 12).getTime();
    window.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
  });
  const saved = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const set = (selector, value) => {
      const field = find(selector);
      field.value = value;
      field.dispatchEvent(new Event('input'));
      field.dispatchEvent(new Event('change'));
    };
    const click = (selector) => find(selector).click();
    const progress = () => find('#activity-goals-list strong').textContent;
    const addRunning = () => {
      set('#new-goal', 'Running');
      click('#add-goal');
    };
    set('#pin-name', 'Running');
    click('#pin-form button');
    click('#pinned-list [data-tracking]');
    set('#measurement-mode', 'custom');
    set('#measurement-unit', 'laps');
    set('#measurement-factor', '400');
    click('#measurement-form button');
    const activitySettings = find('#activity-settings');
    const settingsCopy = {
      hasGoalControls: /\bgoals?\b/i.test(activitySettings.textContent),
      saveLabel: find('#measurement-form button').textContent,
    };
    click('#close-activity-settings');
    click('#open-goal-settings');
    const goalOptions = Array.from(find('#goal-activity-options').options, ({ value }) => value);
    set('#goal-activity', 'Running');
    set('#activity-goal-metric', 'amount');
    const defaultGoalUnit = find('#activity-goal-unit').value;
    set('#activity-goal-amount', '2');
    set('#activity-goal-unit', 'km');
    set('#activity-goal-repeat', 'range');
    set('#activity-goal-start', '2026-11-09');
    set('#activity-goal-end', '2026-11-11');
    click('#activity-goal-form button');
    click('#close-goal-settings');

    click('[data-day="9"]');
    addRunning();
    set('[data-amount]', '1');
    set('[data-minutes]', '5');
    const preview = find('.daily-metrics').textContent;
    click('#save');
    const firstProgress = progress();

    click('[data-day="10"]');
    addRunning();
    set('[data-amount]', '2');
    set('[data-minutes]', '10');
    click('.daily-distance summary');
    set('[data-factor]', '500');
    click('#save');
    const secondProgress = progress();

    click('#pinned-list [data-tracking]');
    set('#measurement-unit', 'km');
    click('#measurement-form button');
    click('#close-activity-settings');
    click('#today');
    addRunning();
    set('[data-amount]', '0.6');
    click('#save');
    return { settingsCopy, goalOptions, defaultGoalUnit, preview, firstProgress, secondProgress, completed: progress() };
  });
  assert.deepEqual(saved, {
    settingsCopy: { hasGoalControls: false, saveLabel: 'Save activity settings' },
    goalOptions: ['Running'], defaultGoalUnit: 'laps', preview: '400 m · 12:30 min/km', firstProgress: '0.4 / 2 km',
    secondProgress: '1.4 / 2 km', completed: '2 / 2 km',
  });

  await page.reload();
  const reloaded = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const today = find('#journal-copy').textContent;
    find('[data-day="9"]').click();
    const first = find('#journal-copy').textContent;
    const factor = find('[data-factor]').valueAsNumber;
    find('[data-day="10"]').click();
    return {
      today, first, factor, second: find('#journal-copy').textContent,
      secondFactor: find('[data-factor]').valueAsNumber,
      completed: find('#activity-goals-list strong').textContent,
    };
  });
  assert.deepEqual(reloaded, {
    today: 'Running · 0.6 km', first: 'Running · 1 lap · 5 min · 400 m · 12:30 min/km', factor: 400,
    second: 'Running · 2 laps · 10 min · 1 km · 10:00 min/km', secondFactor: 500, completed: '2 / 2 km',
  });
  await page.setViewport(360, 720);
  assert.deepEqual(await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('#activity-goals-list button').click();
    find('#goal-activity').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    const dialog = find('#goal-settings');
    const rect = dialog.getBoundingClientRect();
    return {
      withinViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
      fitsWidth: dialog.scrollWidth === dialog.clientWidth,
      visible: dialog.matches(':modal'),
      editing: document.activeElement.id === 'activity-goal-metric',
    };
  }), { withinViewport: true, fitsWidth: true, visible: true, editing: true });
});

test('a weekly days goal counts a check-in with no amount and preserves progress when replaced', async (t) => {
  const page = await openCheckin(t, () => {
    const fixed = new Date(2026, 10, 11, 12).getTime();
    window.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
  });
  const result = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const click = (selector) => find(selector).click();
    const progress = () => find('#activity-goals-list strong').textContent;
    click('[data-day="9"]');
    find('#new-goal').value = 'Strength';
    click('#add-goal');
    click('#open-goal-settings');
    find('#goal-activity').value = 'Strength';
    find('#goal-activity').dispatchEvent(new Event('input'));
    find('#activity-goal-amount').value = '3';
    click('#activity-goal-form button');
    click('#close-goal-settings');
    click('#save');
    const first = progress();
    click('#today');
    click('#activity-goals-list button');
    click('#new-activity-goal summary');
    find('#activity-goal-amount').value = '2';
    click('#activity-goal-form button');
    const overlap = find('#activity-goal-feedback').textContent;
    click('#tracking-goals-list button');
    click('#activity-goal-form button');
    click('#close-goal-settings');
    const replacement = progress();
    click('[data-day="9"]');
    const historical = progress();

    find('#new-goal').value = 'Reading';
    click('#add-goal');
    click('#open-goal-settings');
    find('#goal-activity').value = 'Reading';
    find('#goal-activity').dispatchEvent(new Event('input'));
    find('#activity-goal-repeat').value = 'week';
    find('#activity-goal-repeat').dispatchEvent(new Event('change'));
    find('#activity-goal-amount').value = '3';
    click('#activity-goal-form button');
    click('#close-goal-settings');
    return {
      first, overlap, replacement, historical,
      oneWeek: Array.from(document.querySelectorAll('#activity-goals-list small'), (item) => item.textContent),
    };
  });
  assert.deepEqual(result, {
    first: '1 / 3 days',
    overlap: 'This activity already has a goal in that period. Choose different dates or end the existing goal.',
    replacement: '0 / 2 days', historical: '1 / 3 days',
    oneWeek: ['Nov 9, 2026 – Nov 15, 2026', 'Nov 9, 2026 – Nov 10, 2026'],
  });
});

test('legacy scores, notes, and checklist entries load and can still be edited', async (t) => {
  const page = await openCheckin(t);
  await page.evaluate(() => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    localStorage.setItem(`checkin.day.${today.getFullYear()}-${month}-${day}`, JSON.stringify({
      score: 75, notes: 'Synthetic test note',
      goals: [{ text: 'Guitar', done: true }, { text: 'Writing', done: false }],
    }));
  });
  await page.reload();
  const readEntry = () => {
    const find = (selector) => document.querySelector(selector);
    find('#details summary').click();
    return {
      score: find('#score').valueAsNumber,
      note: find('#notes').value,
      guitar: find('[aria-label="Progress for Guitar"]').value,
      writing: find('[aria-label="Progress for Writing"]').value,
      week: Array.from(document.querySelectorAll('#week-goals li'), (item) => item.textContent),
    };
  };
  const entry = await page.evaluate(readEntry);
  assert.deepEqual(entry, {
    score: 75, note: 'Synthetic test note', guitar: 'done', writing: 'open', week: ['Guitar · 1 day'],
  });

  const staged = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('#complete').click();
    return {
      score: find('#score').valueAsNumber,
      writing: find('[aria-label="Progress for Writing"]').value,
      week: find('#week-goals').textContent,
      focus: document.activeElement.id,
    };
  });
  assert.deepEqual(staged, { score: 100, writing: 'done', week: 'Guitar · 1 day', focus: 'save' });
  await page.evaluate(() => document.querySelector('#save').click());
  await page.reload();
  assert.deepEqual(await page.evaluate(readEntry), {
    ...entry, score: 100, writing: 'done', week: ['Guitar · 1 day', 'Writing · 1 day'],
  });
});

test('an optional score can be saved as zero or cleared from a narrow check-in', async (t) => {
  const page = await openCheckin(t);
  await page.setViewport(360, 800);
  assert.deepEqual(await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const save = find('#save');
    const { left, right } = save.getBoundingClientRect();
    const score = find('#score');
    score.value = '101';
    save.click();
    const error = find('#feedback').textContent;
    const scoreFocused = document.activeElement === score && find('#details').open;
    score.value = '0';
    save.click();
    return { fits: left >= 0 && right <= innerWidth, error, scoreFocused, mark: find('[data-selected] .day-mark').textContent };
  }), {
    fits: true, error: 'Enter a whole score from 0 to 100, or leave it blank.', scoreFocused: true,
    mark: '0%',
  });

  await page.reload();
  assert.deepEqual(await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const score = find('#score');
    const reloaded = score.value;
    find('#details summary').click();
    score.value = '';
    find('#save').click();
    return { reloaded, feedback: find('#feedback').textContent, mark: find('[data-selected]').dataset.status ?? null };
  }), { reloaded: '0', feedback: 'Check-in cleared.', mark: null });
});

test('an older plan can be edited without leaving the selected date or losing its draft', async (t) => {
  const page = await openCheckin(t);
  await page.evaluate(() => {
    const today = new Date();
    const past = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 10);
    const month = String(past.getMonth() + 1).padStart(2, '0');
    const day = String(past.getDate()).padStart(2, '0');
    localStorage.setItem(`checkin.day.${past.getFullYear()}-${month}-${day}`, JSON.stringify({
      score: 40, notes: 'Older note', goals: [{ text: 'Writing', done: false, worked: true }],
      nextPlan: 'After coffee, write for 15 minutes with music.',
    }));
  });
  await page.reload();
  const backdated = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const previousDay = find('#selected-date').textContent;
    const suggestion = find('#goal-options option').value;
    const emptyWeek = find('#week-empty').textContent;
    find('#new-goal').value = suggestion;
    find('#add-goal').click();
    find('#details summary').click();
    find('#notes').value = 'Draft for today';
    find('#edit-plan').click();
    const initial = {
      reminder: find('#next-plan').value,
      modal: find('#plan-editor').matches(':modal'),
      earlierDate: find('#plan-date').textContent !== previousDay,
      focus: document.activeElement.id,
    };
    find('#next-plan').value = 'After coffee, outline the next chapter.';
    find('#plan-editor button[type="submit"]').click();
    const draft = {
      sameDay: find('#selected-date').textContent === previousDay,
      notes: find('#notes').value,
      work: find('[aria-label="Progress for Writing"]').value,
      week: find('#week-empty').textContent,
    };
    find('#save').click();
    return { initial, suggestion, emptyWeek, draft };
  });
  assert.deepEqual(backdated, {
    initial: {
      reminder: 'After coffee, write for 15 minutes with music.', modal: true, earlierDate: true, focus: 'next-plan',
    },
    suggestion: 'Writing', emptyWeek: 'No activity logged this week.',
    draft: { sameDay: true, notes: 'Draft for today', work: 'worked', week: 'No activity logged this week.' },
  });
  await page.reload();
  assert.deepEqual(await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const notes = find('#notes').value;
    find('#edit-plan').click();
    const plan = find('#next-plan').value;
    const date = find('#plan-date').textContent;
    find('#next-plan').value = 'Discard this draft';
    find('#cancel-plan-edit').click();
    const day = new Date(date);
    if (day.getMonth() !== new Date().getMonth()) find('#previous').click();
    find(`[data-day="${day.getDate()}"]`).click();
    find('#edit-plan').click();
    const previousPlan = find('#next-plan').value;
    find('#cancel-plan-edit').click();
    return {
      notes, plan, previousPlan, previousNotes: find('#notes').value, previousScore: find('#score').valueAsNumber,
      previousWork: find('[aria-label="Progress for Writing"]').value,
    };
  }), {
    notes: 'Draft for today', plan: 'After coffee, outline the next chapter.',
    previousPlan: 'After coffee, outline the next chapter.', previousNotes: 'Older note',
    previousScore: 40, previousWork: 'worked',
  });
});

test('all modals show a single heading that names the dialog', async (t) => {
  const page = await openCheckin(t);
  await page.evaluate(async () => {
    const { dayKey } = await import('/calendar.js');
    localStorage.setItem(`checkin.day.${dayKey(new Date())}`, JSON.stringify({
      score: null, notes: '', goals: [], nextPlan: 'Saved plan',
    }));
    localStorage.setItem('checkin.pinned.guitar', JSON.stringify({ text: 'Guitar', pinned: true }));
  });
  await page.reload();

  const titles = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    return [
      '#edit-plan',
      '#pinned-list [data-edit]',
      '#pinned-list [data-tracking]',
      '#open-goal-settings',
      '#open-backup',
    ].map((trigger) => {
      find(trigger).click();
      const dialog = find('dialog:modal');
      if (!dialog) throw new Error(`No modal opened from ${trigger}`);
      const header = dialog.querySelector('.dialog-header');
      const heading = header.querySelector('h2');
      const title = header.innerText.trim();
      const label = document.getElementById(dialog.getAttribute('aria-labelledby'));
      header.querySelector('button').click();
      return { title, namedByHeading: label === heading };
    });
  });
  assert.deepEqual(titles, [
    'Previous plan', 'Activity plan for Guitar', 'Activity settings for Guitar', 'Goal settings', 'Backup & restore',
  ].map((title) => ({ title, namedByHeading: true })));
});

test('both editors dismiss via their centered close icon or backdrop and discard drafts', async (t) => {
  const page = await openCheckin(t);
  await page.setViewport(360, 800);
  await page.evaluate(() => {
    const today = new Date();
    const date = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
      .map((part) => String(part).padStart(2, '0')).join('-');
    localStorage.setItem(`checkin.day.${date}`, JSON.stringify({
      score: null, notes: '', goals: [], nextPlan: 'Saved plan',
    }));
    localStorage.setItem('checkin.pinned.guitar', JSON.stringify({ text: 'Guitar', pinned: true, plan: 'Saved plan' }));
  });
  await page.reload();

  const openEditors = [
    () => document.querySelector('#edit-plan').click(),
    () => document.querySelector('[aria-label="Plan or pickup note for Guitar"]').click(),
  ];
  const readPlan = () => document.querySelector('dialog[open] textarea').value;
  const modalIsOpen = () => Boolean(document.querySelector('dialog:modal'));

  for (const open of openEditors) {
    await page.evaluate(open);
    const { centered, closeX, closeY, insideX, insideY } = await page.evaluate(() => {
      const dialog = document.querySelector('dialog:modal');
      const button = dialog.querySelector('.dialog-header button');
      const dialogBox = dialog.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      const iconBox = button.querySelector('svg').getBoundingClientRect();
      const closeX = buttonBox.x + buttonBox.width / 2;
      const closeY = buttonBox.y + buttonBox.height / 2;
      dialog.querySelector('textarea').value = 'Discard via backdrop';
      return {
        centered: Math.abs(closeX - iconBox.x - iconBox.width / 2) < 1
          && Math.abs(closeY - iconBox.y - iconBox.height / 2) < 1,
        closeX, closeY, insideX: dialogBox.left + 8, insideY: dialogBox.top + dialogBox.height / 2,
      };
    });
    assert.ok(centered);
    await page.clickAt(insideX, insideY);
    assert.equal(await page.evaluate(modalIsOpen), true);
    await page.clickAt(2, 2);
    assert.equal(await page.evaluate(modalIsOpen), false);

    await page.evaluate(open);
    assert.equal(await page.evaluate(readPlan), 'Saved plan');
    await page.evaluate(() => { document.querySelector('dialog[open] textarea').value = 'Discard via close button'; });
    await page.clickAt(closeX, closeY);
    assert.equal(await page.evaluate(modalIsOpen), false);

    await page.reload();
    await page.evaluate(open);
    assert.equal(await page.evaluate(readPlan), 'Saved plan');
    await page.clickAt(2, 2);
  }
});

test('pinned activities remain in the shared picker while time-bound goals have their own panel', async (t) => {
  const page = await openCheckin(t);
  await page.setViewport(1280, 900);
  await page.setReducedMotion('reduce');
  const staged = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const panel = find('.journal-card');
    const saveOffset = () => find('#save').offsetTop;
    const initialOffset = saveOffset();
    function pinWithPlan(text, plan, fallback = '', pickup = '') {
      find('#pin-name').value = text;
      find('#pin-form button').click();
      find(`[aria-label="Plan or pickup note for ${text}"]`).click();
      find('#activity-plan').value = plan;
      find('#activity-fallback').value = fallback;
      find('#activity-pickup').value = pickup;
      find('#activity-editor button[type="submit"]').click();
    }
    pinWithPlan('Guitar', 'After dinner, play the chorus.', 'If I get home late, play it once.', 'Start at bar 9.');
    pinWithPlan('Writing', 'After coffee, draft a paragraph.');
    const sidebar = find('.activities-card').getBoundingClientRect();
    const journal = panel.getBoundingClientRect();
    const [first, second] = find('#pinned-list').children;
    const layout = {
      unchangedOffset: saveOffset() === initialOffset,
      formCount: panel.querySelectorAll('form').length,
      submitCount: panel.querySelectorAll('[type="submit"]').length,
      activitiesSeparate: Boolean(find('.activities-card #pin-form')),
      goalsSeparate: Boolean(find('.activities-card + .activity-goals-card #activity-goals-title')),
      weekByCalendar: Boolean(find('.calendar-card #week-goals')),
      calendarStartsWithMonth: Boolean(find('.calendar-card > :first-child #calendar-title')?.innerText.trim()),
      detailsCollapsed: !find('#details').open,
      options: Array.from(find('#new-goal').list.options, ({ value }) => value),
      sidebar: sidebar.left >= journal.right && Math.abs(sidebar.top - journal.top) < 1,
      vertical: second.offsetTop > first.offsetTop,
      firstRow: first.textContent.trim(),
      rowButtons: first.querySelectorAll('button').length,
      planIcon: first.querySelector('[data-edit] use').getAttribute('href'),
      trackingIcon: first.querySelector('[data-tracking] use').getAttribute('href'),
      trackingLabel: first.querySelector('[data-tracking]').getAttribute('aria-label'),
    };
    find('#new-goal').value = layout.options[1];
    find('#add-goal').click();
    find('#new-goal').value = 'writing';
    find('#add-goal').click();
    const beforeSave = {
      rows: find('#goal-list').childElementCount,
      progress: find('[aria-label="Progress for Writing"]').value,
      workMark: find('[data-selected]').dataset.status ?? null,
    };
    find('#save').click();
    const shortcut = find('#pickup-suggestions button');
    shortcut.click();
    const pickupFocus = document.activeElement.id;
    find('#activity-pickup').value = 'Continue the opening paragraph.';
    find('#activity-editor button[type="submit"]').click();
    return { ...beforeSave, layout, feedback: find('#feedback').textContent, pickupFocus };
  });
  assert.deepEqual(staged, {
    rows: 1, progress: 'worked', workMark: null, feedback: 'Next step and note saved.',
    pickupFocus: 'activity-pickup',
    layout: {
      unchangedOffset: true, formCount: 1, submitCount: 1, activitiesSeparate: true, goalsSeparate: true, weekByCalendar: true,
      calendarStartsWithMonth: true,
      detailsCollapsed: true, options: ['Guitar', 'Writing'],
      sidebar: true, vertical: true, firstRow: 'Guitar', rowButtons: 2, planIcon: '#pen', trackingIcon: '#tracking-icon',
      trackingLabel: 'Activity settings for Guitar',
    },
  });

  await page.reload();
  const reloaded = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('[aria-label="Plan or pickup note for Guitar"]').click();
    const guitar = {
      guitarPlan: find('#activity-plan').value,
      fallback: find('#activity-fallback').value,
      pickup: find('#activity-pickup').value,
      dialogOpen: find('#activity-editor').matches(':modal'),
      dialogTitle: document.getElementById(find('#activity-editor').getAttribute('aria-labelledby')).textContent,
    };
    find('#cancel-activity-edit').click();
    find('[aria-label="Plan or pickup note for Writing"]').click();
    return {
      ...guitar,
      writingPlan: find('#activity-plan').value,
      writingPickup: find('#activity-pickup').value,
      workMark: find('[data-selected]').dataset.status,
    };
  });
  assert.deepEqual(reloaded, {
    guitarPlan: 'After dinner, play the chorus.', fallback: 'If I get home late, play it once.',
    pickup: 'Start at bar 9.', dialogOpen: true, dialogTitle: 'Activity plan for Guitar',
    writingPlan: 'After coffee, draft a paragraph.',
    writingPickup: 'Continue the opening paragraph.', workMark: 'work',
  });

  await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('#cancel-activity-edit').click();
    find('[aria-label="Plan or pickup note for Guitar"]').click();
    find('#complete-activity-plan').click();
    find('[aria-label="Plan or pickup note for Writing"]').click();
    find('#activity-plan').value = 'After lunch, draft a paragraph.';
    find('#activity-editor button[type="submit"]').click();
    find('[aria-label="Plan or pickup note for Guitar"]').click();
    find('#unpin-activity').click();
  });
  await page.reload();
  const changes = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const openGoal = (name) => find(`[aria-label="Plan or pickup note for ${name}"]`).click();
    const unpinned = !find('[aria-label="Plan or pickup note for Guitar"]')
      && !Array.from(find('#goal-options').options).some(({ value }) => value === 'Guitar');
    openGoal('Writing');
    const rescheduled = find('#activity-plan').value;
    find('#dismiss-activity-plan').click();
    openGoal('Writing');
    const writingPlan = find('#activity-plan').value;
    find('#cancel-activity-edit').click();
    find('#pin-name').value = 'Guitar';
    find('#pin-form button').click();
    openGoal('Guitar');
    return {
      unpinned, rescheduled, writingPlan,
      guitarPlan: find('#activity-plan').value,
      guitarFallback: find('#activity-fallback').value,
      pickup: find('#activity-pickup').value,
      completeHidden: find('#complete-activity-plan').hidden,
    };
  });
  assert.deepEqual(changes, {
    unpinned: true, rescheduled: 'After lunch, draft a paragraph.', writingPlan: '', guitarPlan: '',
    guitarFallback: '', pickup: 'Start at bar 9.', completeHidden: true,
  });

  await page.evaluate(() => document.querySelector('#cancel-activity-edit').click());
  await page.setViewport(360, 800);
  assert.equal(await page.evaluate(() => {
    const journal = document.querySelector('.journal-card').getBoundingClientRect();
    const sidebar = document.querySelector('.activities-card').getBoundingClientRect();
    return sidebar.top >= journal.bottom && sidebar.left === journal.left && sidebar.right === journal.right;
  }), true);
});
