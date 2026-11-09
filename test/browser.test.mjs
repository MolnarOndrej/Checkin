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

test('the Goals panel fades and slides in with the check-in on refresh', async (t) => {
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
    return ['.journal-card', '.goals-card'].map((selector) => {
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
    const panel = document.querySelector('.goals-card');
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

test('the Moonlit Trail heading shows a new two-line motto every five minutes', async (t) => {
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
    suggestion: 'Writing', emptyWeek: 'No goal work logged this week.',
    draft: { sameDay: true, notes: 'Draft for today', work: 'worked', week: 'No goal work logged this week.' },
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

test('the check-in stays focused while pinned goals remain available in the shared picker', async (t) => {
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
      find('#goal-plan').value = plan;
      find('#goal-fallback').value = fallback;
      find('#goal-pickup').value = pickup;
      find('#goal-editor button[type="submit"]').click();
    }
    pinWithPlan('Guitar', 'After dinner, play the chorus.', 'If I get home late, play it once.', 'Start at bar 9.');
    pinWithPlan('Writing', 'After coffee, draft a paragraph.');
    const sidebar = find('.goals-card').getBoundingClientRect();
    const journal = panel.getBoundingClientRect();
    const [first, second] = find('#pinned-list').children;
    const layout = {
      unchangedOffset: saveOffset() === initialOffset,
      formCount: panel.querySelectorAll('form').length,
      submitCount: panel.querySelectorAll('[type="submit"]').length,
      goalsSeparate: Boolean(find('.goals-card #pin-form')),
      weekByCalendar: Boolean(find('.calendar-card #week-goals')),
      detailsCollapsed: !find('#details').open,
      options: Array.from(find('#new-goal').list.options, ({ value }) => value),
      sidebar: sidebar.left >= journal.right && Math.abs(sidebar.top - journal.top) < 1,
      vertical: second.offsetTop > first.offsetTop,
      firstRow: first.textContent.trim(),
      rowButtons: first.querySelectorAll('button').length,
      planIcon: first.querySelector('button svg use').getAttribute('href'),
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
    find('#goal-pickup').value = 'Continue the opening paragraph.';
    find('#goal-editor button[type="submit"]').click();
    return { ...beforeSave, layout, feedback: find('#feedback').textContent, pickupFocus };
  });
  assert.deepEqual(staged, {
    rows: 1, progress: 'worked', workMark: null, feedback: 'Next step and note saved.',
    pickupFocus: 'goal-pickup',
    layout: {
      unchangedOffset: true, formCount: 1, submitCount: 1, goalsSeparate: true, weekByCalendar: true,
      detailsCollapsed: true, options: ['Guitar', 'Writing'],
      sidebar: true, vertical: true, firstRow: 'Guitar', rowButtons: 1, planIcon: '#pen',
    },
  });

  await page.reload();
  const reloaded = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('[aria-label="Plan or pickup note for Guitar"]').click();
    const guitar = {
      guitarPlan: find('#goal-plan').value,
      fallback: find('#goal-fallback').value,
      pickup: find('#goal-pickup').value,
      dialogOpen: find('#goal-editor').matches(':modal'),
    };
    find('#cancel-goal-edit').click();
    find('[aria-label="Plan or pickup note for Writing"]').click();
    return {
      ...guitar,
      writingPlan: find('#goal-plan').value,
      writingPickup: find('#goal-pickup').value,
      workMark: find('[data-selected]').dataset.status,
    };
  });
  assert.deepEqual(reloaded, {
    guitarPlan: 'After dinner, play the chorus.', fallback: 'If I get home late, play it once.',
    pickup: 'Start at bar 9.', dialogOpen: true, writingPlan: 'After coffee, draft a paragraph.',
    writingPickup: 'Continue the opening paragraph.', workMark: 'work',
  });

  await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('#cancel-goal-edit').click();
    find('[aria-label="Plan or pickup note for Guitar"]').click();
    find('#complete-goal-plan').click();
    find('[aria-label="Plan or pickup note for Writing"]').click();
    find('#goal-plan').value = 'After lunch, draft a paragraph.';
    find('#goal-editor button[type="submit"]').click();
    find('[aria-label="Plan or pickup note for Guitar"]').click();
    find('#unpin-goal').click();
  });
  await page.reload();
  const changes = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const openGoal = (name) => find(`[aria-label="Plan or pickup note for ${name}"]`).click();
    const unpinned = !find('[aria-label="Plan or pickup note for Guitar"]')
      && !Array.from(find('#goal-options').options).some(({ value }) => value === 'Guitar');
    openGoal('Writing');
    const rescheduled = find('#goal-plan').value;
    find('#dismiss-goal-plan').click();
    openGoal('Writing');
    const writingPlan = find('#goal-plan').value;
    find('#cancel-goal-edit').click();
    find('#pin-name').value = 'Guitar';
    find('#pin-form button').click();
    openGoal('Guitar');
    return {
      unpinned, rescheduled, writingPlan,
      guitarPlan: find('#goal-plan').value,
      guitarFallback: find('#goal-fallback').value,
      pickup: find('#goal-pickup').value,
      completeHidden: find('#complete-goal-plan').hidden,
    };
  });
  assert.deepEqual(changes, {
    unpinned: true, rescheduled: 'After lunch, draft a paragraph.', writingPlan: '', guitarPlan: '',
    guitarFallback: '', pickup: 'Start at bar 9.', completeHidden: true,
  });

  await page.evaluate(() => document.querySelector('#cancel-goal-edit').click());
  await page.setViewport(360, 800);
  assert.equal(await page.evaluate(() => {
    const journal = document.querySelector('.journal-card').getBoundingClientRect();
    const sidebar = document.querySelector('.goals-card').getBoundingClientRect();
    return sidebar.top >= journal.bottom && sidebar.left === journal.left && sidebar.right === journal.right;
  }), true);
});
