import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openBrowser, startProcess } from './browser.mjs';

async function openCheckin(t) {
  const server = startProcess(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0' },
  }, /Checkin is ready at (http:\/\/127\.0\.0\.1:\d+)\r?\n/);
  t.after(() => server.stop());
  const url = await server.ready;
  assert.notEqual(new URL(url).port, '4173');
  const page = await openBrowser(t);
  await page.navigate(url);
  return page;
}

test('ambient effects run at different rhythms without moving the landscape', async (t) => {
  const page = await openCheckin(t);
  await page.setReducedMotion('no-preference');
  const animated = await page.evaluate(() => {
    const effects = [
      ['body', '::before', .05, .95],
      ['body', '::after', .05, .95],
      ['.moon-halo', null, .05, .95],
      ['.sky-star', null, .1, .5],
      ['.sky-meteor', null, .5, .93],
      ['.firefly', null, .05, .3],
      ['.calendar-card', '::before', .05, .55],
    ];
    const animations = document.getAnimations();
    return {
      landscapeAnimations: [...document.querySelectorAll('.hero, .hero-scene, .hero-scene svg, .hero-scene use')]
        .map((element) => getComputedStyle(element).animationName),
      effects: effects.map(([selector, pseudo, dimAt, brightAt]) => {
        const element = document.querySelector(selector);
        const style = () => getComputedStyle(element, pseudo);
        const animation = animations.find(({ animationName }) => animationName === style().animationName);
        const { delay, duration, iterations } = animation.effect.getTiming();
        animation.pause();
        // Sample an even-numbered cycle after any negative start delay.
        animation.currentTime = delay + duration * (2 + dimAt);
        const dim = Number(style().opacity);
        const start = style().transform;
        animation.currentTime = delay + duration * (2 + brightAt);
        return {
          duration, repeats: iterations === Infinity, brightens: Number(style().opacity) - dim > .45,
          moves: style().transform !== start,
          interceptsClicks: Boolean(pseudo) && style().pointerEvents !== 'none',
        };
      }),
    };
  });
  assert.deepEqual(animated.landscapeAnimations, ['none', 'none', 'none', 'none']);
  assert.equal(new Set(animated.effects.map(({ duration }) => duration)).size, animated.effects.length);
  assert.ok(animated.effects.every(({ repeats, brightens, interceptsClicks }) => repeats && brightens && !interceptsClicks));
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

test('partial work counts without a daily score and survives reload', async (t) => {
  const page = await openCheckin(t);
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

test('the check-in stays focused while pinned goals remain available in the shared picker', async (t) => {
  const page = await openCheckin(t);
  await page.setViewport(1280, 900);
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
    const layout = {
      unchangedOffset: saveOffset() === initialOffset,
      formCount: panel.querySelectorAll('form').length,
      submitCount: panel.querySelectorAll('[type="submit"]').length,
      goalsSeparate: Boolean(find('.goals-card #pin-form')),
      weekByCalendar: Boolean(find('.calendar-card #week-goals')),
      detailsCollapsed: !find('#details').open,
      options: Array.from(find('#new-goal').list.options, ({ value }) => value),
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
    },
  });

  await page.reload();
  const reloaded = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const guitar = find('[aria-label="Plan or pickup note for Guitar"]').closest('article');
    const writing = find('[aria-label="Plan or pickup note for Writing"]').closest('article');
    return {
      guitarPlan: guitar.querySelector('[data-plan] span').textContent,
      fallback: guitar.querySelector('[data-fallback] span').textContent,
      pickup: guitar.querySelector('[data-pickup] span').textContent,
      writingPlan: writing.querySelector('[data-plan] span').textContent,
      writingPickup: writing.querySelector('[data-pickup] span').textContent,
      workMark: find('[data-selected]').dataset.status,
    };
  });
  assert.deepEqual(reloaded, {
    guitarPlan: 'After dinner, play the chorus.', fallback: 'If I get home late, play it once.',
    pickup: 'Start at bar 9.', writingPlan: 'After coffee, draft a paragraph.',
    writingPickup: 'Continue the opening paragraph.', workMark: 'work',
  });

  await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('[aria-label="Mark plan done for Guitar"]').click();
    find('[aria-label="Plan or pickup note for Writing"]').click();
    find('#goal-plan').value = 'After lunch, draft a paragraph.';
    find('#goal-editor button[type="submit"]').click();
    find('[aria-label="Plan or pickup note for Guitar"]').click();
    find('#unpin-goal').click();
  });
  await page.reload();
  const changes = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const unpinned = !find('[aria-label="Plan or pickup note for Guitar"]')
      && !Array.from(find('#goal-options').options).some(({ value }) => value === 'Guitar');
    const rescheduled = find('[data-plan] span').textContent;
    find('#pin-name').value = 'Guitar';
    find('#pin-form button').click();
    const guitar = find('[aria-label="Plan or pickup note for Guitar"]').closest('article');
    find('[aria-label="Plan or pickup note for Writing"]').click();
    find('#dismiss-goal-plan').click();
    return {
      unpinned, rescheduled,
      guitarPlanHidden: guitar.querySelector('[data-plan]').hidden,
      guitarFallbackHidden: guitar.querySelector('[data-fallback]').hidden,
      pickup: guitar.querySelector('[data-pickup] span').textContent,
      writingPlanHidden: find('[aria-label="Plan or pickup note for Writing"]').closest('article').querySelector('[data-plan]').hidden,
    };
  });
  assert.deepEqual(changes, {
    unpinned: true, rescheduled: 'After lunch, draft a paragraph.', guitarPlanHidden: true,
    guitarFallbackHidden: true, pickup: 'Start at bar 9.', writingPlanHidden: true,
  });
});
