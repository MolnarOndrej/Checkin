import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startProcess } from './browser.mjs';

test('the container listen address serves Checkin on a separate test port', async (t) => {
  const server = startProcess(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, CHECKIN_HOST: '0.0.0.0', PORT: '0' },
  }, /Checkin is ready at http:\/\/0\.0\.0\.0:(\d+)\r?\n/);
  t.after(() => server.stop());

  const port = await server.ready;
  assert.notEqual(port, '4173');
  const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Checkin<\/title>/);
});
