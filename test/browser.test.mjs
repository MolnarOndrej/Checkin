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

test('a backdated plan survives a gap and a note, then gives way to new work', async (t) => {
  const page = await openCheckin(t);
  const backdated = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const today = new Date();
    const past = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 10);
    if (past.getMonth() !== today.getMonth()) find('#previous').click();
    find(`[data-day="${past.getDate()}"]`).click();
    find('#new-goal').value = 'Writing';
    find('#next-time summary').click();
    find('#next-plan').value = 'After coffee, write for 15 minutes with music.';
    find('#next-time button[type="submit"]').click();
    const savedDay = find('#day-tag').textContent;
    const week = find('#week-goals').textContent;
    find('#today').click();
    find('#details summary').click();
    find('#notes').value = 'Rest day';
    find('#details button[type="submit"]').click();
    return { savedDay, week, todayMark: find('[data-selected]').dataset.status };
  });
  assert.deepEqual(backdated, { savedDay: 'PAST DAY', week: 'Writing · 1 day', todayMark: 'note' });

  await page.reload();
  const carried = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    const reminder = find('#plan-preview').textContent;
    const suggestion = find('#recent-goals option').value;
    const emptyWeek = find('#week-empty').textContent;
    find('#edit-plan').click();
    const editingDay = find('#day-tag').textContent;
    const editingPlan = document.activeElement.id;
    find('#today').click();
    find('#new-goal').value = suggestion;
    find('#save').click();
    return { reminder, suggestion, emptyWeek, editingDay, editingPlan, planHidden: find('#plan-reminder').hidden };
  });
  assert.deepEqual(carried, {
    reminder: 'After coffee, write for 15 minutes with music.', suggestion: 'Writing',
    emptyWeek: 'No goal work logged this week.', editingDay: 'PAST DAY', editingPlan: 'next-plan', planHidden: true,
  });
});
