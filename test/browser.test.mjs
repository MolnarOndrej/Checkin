import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openBrowser, startProcess } from './browser.mjs';

test('a score, note, and goal survive reload and can be marked complete', async (t) => {
  const server = startProcess(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0' },
  }, /Checkin is ready at (http:\/\/127\.0\.0\.1:\d+)\r?\n/);
  t.after(() => server.stop());
  const url = await server.ready;
  assert.notEqual(new URL(url).port, '4173');

  const page = await openBrowser(t);
  await page.navigate(url);
  const saved = await page.evaluate(() => {
    const find = (selector) => document.querySelector(selector);
    find('#details summary').click();
    const score = find('#score');
    score.value = '75';
    score.dispatchEvent(new Event('input', { bubbles: true }));
    find('#notes').value = 'Synthetic test note';
    find('#new-goal').value = 'Synthetic test goal';
    find('#add-goal').click();
    find('#entry-form button[type="submit"]').click();
    const stamp = find('[data-selected] .day-mark');
    return {
      feedback: find('#feedback').textContent,
      visibility: getComputedStyle(stamp).visibility,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
  assert.equal(saved.feedback, 'Check-in saved.');
  assert.equal(saved.visibility, saved.reducedMotion ? 'visible' : 'hidden');

  const revealedStamp = await page.evaluate(async () => {
    const stamp = document.querySelector('[data-selected] .day-mark');
    const deadline = performance.now() + 4000;
    while (getComputedStyle(stamp).visibility === 'hidden' && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { score: stamp.textContent, visibility: getComputedStyle(stamp).visibility };
  });
  assert.deepEqual(revealedStamp, { score: '75%', visibility: 'visible' });

  await page.reload();
  const readEntry = () => {
    const find = (selector) => document.querySelector(selector);
    find('#details summary').click();
    return {
      score: find('#score').valueAsNumber,
      note: find('#notes').value,
      goal: find('[aria-label="Goal text"]').value,
      done: find('[aria-label="Mark goal done"]').checked,
      daysRecorded: find('#logged-count').textContent,
      stamp: find('[data-selected] .day-mark').textContent,
    };
  };
  const entry = await page.evaluate(readEntry);
  assert.deepEqual(entry, {
    score: 75, note: 'Synthetic test note', goal: 'Synthetic test goal', done: false, daysRecorded: '1 day recorded', stamp: '75%',
  });

  await page.evaluate(() => document.querySelector('#complete').click());
  await page.reload();
  assert.deepEqual(await page.evaluate(readEntry), { ...entry, score: 100, done: true, stamp: '' });
  assert.equal(await page.evaluate(() => document.querySelector('[data-selected] .day-mark use').getAttribute('href')), '#check');
});
