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

test('ambient light changes without animating the landscape on load', async (t) => {
  const page = await openCheckin(t);
  await page.setReducedMotion('no-preference');
  const animated = await page.evaluate(() => {
    const glow = () => getComputedStyle(document.body, '::before');
    const halo = document.querySelector('.moon-halo');
    const star = document.querySelector('.sky-star');
    function sample(animation, readStyle, fraction) {
      animation.pause();
      const { delay, duration } = animation.effect.getTiming();
      // Sample a full cycle after the negative start delay.
      animation.currentTime = delay + duration * (2 + fraction);
      const { opacity, transform } = readStyle();
      return { opacity: Number(opacity), transform };
    }
    const wash = document.getAnimations().find(({ animationName }) => animationName === glow().animationName);
    const [moonlight] = halo.getAnimations();
    const [twinkle] = star.getAnimations();
    const dimWash = sample(wash, glow, .05);
    const brightWash = sample(wash, glow, .95);
    const dimHalo = sample(moonlight, () => getComputedStyle(halo), .05);
    const brightHalo = sample(moonlight, () => getComputedStyle(halo), .95);
    const dimStar = sample(twinkle, () => getComputedStyle(star), .1);
    const brightStar = sample(twinkle, () => getComputedStyle(star), .5);
    return {
      bannerAnimations: [...document.querySelectorAll('.hero, .hero-scene, .hero-scene svg')]
        .map((element) => getComputedStyle(element).animationName),
      lightingStaysInPlace: [dimWash, brightWash, dimHalo, brightHalo, dimStar, brightStar]
        .every(({ transform }) => transform === 'none'),
      washBrightens: brightWash.opacity - dimWash.opacity > .5,
      haloBrightens: brightHalo.opacity - dimHalo.opacity > .5,
      starBrightens: brightStar.opacity - dimStar.opacity > .5,
      glowIgnoresClicks: glow().pointerEvents === 'none',
    };
  });
  assert.deepEqual(animated, {
    bannerAnimations: ['none', 'none', 'none'], lightingStaysInPlace: true,
    washBrightens: true, haloBrightens: true, starBrightens: true, glowIgnoresClicks: true,
  });

  await page.setReducedMotion('reduce');
  assert.deepEqual(await page.evaluate(() => {
    const glow = getComputedStyle(document.body, '::before');
    const halo = getComputedStyle(document.querySelector('.moon-halo'));
    const star = getComputedStyle(document.querySelector('.sky-star'));
    return {
      animations: [glow, halo, star].map(({ animationName }) => animationName),
      visible: [glow, halo, star].every(({ opacity }) => Number(opacity) > 0),
    };
  }), { animations: ['none', 'none', 'none'], visible: true });
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
    feedback: 'You put 20 min into “Guitar”. Check-in saved.',
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
      hasScore: find('#has-score').checked,
      summary: find('#journal-copy').textContent,
      week: find('#week-goals').textContent,
    };
    find('#save').click();
    return { ...state, feedback: find('#feedback').textContent, glowed: Boolean(find('.trail-glow')) };
  });
  assert.deepEqual(reloaded, {
    progress: 'worked', minutes: 20, hasScore: false, summary: 'You put 20 min into “Guitar”.',
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

  await page.evaluate(() => document.querySelector('#complete').click());
  await page.reload();
  assert.deepEqual(await page.evaluate(readEntry), {
    ...entry, score: 100, writing: 'done', week: ['Guitar · 1 day', 'Writing · 1 day'],
  });
});

test('an older check-in plan still loads and can be edited after logging new work', async (t) => {
  const page = await openCheckin(t);
  await page.evaluate(() => {
    const today = new Date();
    const past = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 10);
    const month = String(past.getMonth() + 1).padStart(2, '0');
    const day = String(past.getDate()).padStart(2, '0');
    localStorage.setItem(`checkin.day.${past.getFullYear()}-${month}-${day}`, JSON.stringify({
      score: null, notes: '', goals: [{ text: 'Writing', done: false, worked: true }],
      nextPlan: 'After coffee, write for 15 minutes with music.',
    }));
  });
  await page.reload();
  const backdated = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const reminder = find('#plan-preview').textContent;
    const suggestion = find('#recent-goals option').value;
    const emptyWeek = find('#week-empty').textContent;
    find('#edit-plan').click();
    const editingDay = find('#day-tag').textContent;
    const editingPlan = document.activeElement.id;
    const week = find('#week-goals').textContent;
    find('#next-plan').value = 'After coffee, outline the next chapter.';
    find('#next-time button[type="submit"]').click();
    find('#today').click();
    find('#new-goal').value = suggestion;
    find('#save').click();
    return { reminder, suggestion, emptyWeek, editingDay, editingPlan, week, updated: find('#plan-preview').textContent };
  });
  assert.deepEqual(backdated, {
    reminder: 'After coffee, write for 15 minutes with music.', suggestion: 'Writing',
    emptyWeek: 'No goal work logged this week.', editingDay: 'PAST DAY', editingPlan: 'next-plan',
    week: 'Writing · 1 day', updated: 'After coffee, outline the next chapter.',
  });
});

test('pinned goals keep separate plans and notes and stage work without duplicates', async (t) => {
  const page = await openCheckin(t);
  const staged = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
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
    find('[aria-label="Worked on Writing"]').click();
    find('[aria-label="Worked on Writing"]').click();
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
    return { ...beforeSave, feedback: find('#feedback').textContent, pickupFocus };
  });
  assert.deepEqual(staged, {
    rows: 1, progress: 'worked', workMark: null, feedback: 'You made time for “Writing”. Check-in saved.',
    pickupFocus: 'goal-pickup',
  });

  await page.reload();
  const reloaded = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const guitar = find('[aria-label="Worked on Guitar"]').closest('article');
    const writing = find('[aria-label="Worked on Writing"]').closest('article');
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
    const unpinned = !find('[aria-label="Worked on Guitar"]');
    const rescheduled = find('[data-plan] span').textContent;
    find('#pin-name').value = 'Guitar';
    find('#pin-form button').click();
    const guitar = find('[aria-label="Worked on Guitar"]').closest('article');
    find('[aria-label="Plan or pickup note for Writing"]').click();
    find('#dismiss-goal-plan').click();
    return {
      unpinned, rescheduled,
      guitarPlanHidden: guitar.querySelector('[data-plan]').hidden,
      guitarFallbackHidden: guitar.querySelector('[data-fallback]').hidden,
      pickup: guitar.querySelector('[data-pickup] span').textContent,
      writingPlanHidden: find('[aria-label="Worked on Writing"]').closest('article').querySelector('[data-plan]').hidden,
    };
  });
  assert.deepEqual(changes, {
    unpinned: true, rescheduled: 'After lunch, draft a paragraph.', guitarPlanHidden: true,
    guitarFallbackHidden: true, pickup: 'Start at bar 9.', writingPlanHidden: true,
  });
});
