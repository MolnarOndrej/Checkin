import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startProcess } from './browser.mjs';

test('defaults to the loopback host when HOST is unset', async (t) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'HOST'),
  );
  const server = startProcess(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...env, PORT: '0' },
  }, /DayTrack is ready at http:\/\/(.+):\d+\r?\n/);
  t.after(() => server.stop());

  assert.equal(await server.ready, '127.0.0.1');
});

test('serves DayTrack when HOST is set to the container bind address', async (t) => {
  const server = startProcess(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, HOST: '0.0.0.0', PORT: '0' },
  }, /DayTrack is ready at http:\/\/0\.0\.0\.0:(\d+)\r?\n/);
  t.after(() => server.stop());

  const port = await server.ready;
  const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>DayTrack<\/title>/);
});

test('HEAD returns the same asset metadata as GET with an empty body', async (t) => {
  const server = startProcess(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
  }, /DayTrack is ready at (http:\/\/127\.0\.0\.1:\d+)\r?\n/);
  t.after(() => server.stop());
  const url = await server.ready;

  for (const [path, contentType] of [
    ['/styles.css', 'text/css; charset=utf-8'],
    ['/submitsounds.json', 'application/json'],
    ['/submitsounds/1.mp3', 'audio/mpeg'],
  ]) {
    const asset = new URL(path, url);
    const signal = AbortSignal.timeout(10_000);
    const [full, head] = await Promise.all([
      fetch(asset, { signal }),
      fetch(asset, { method: 'HEAD', signal }),
    ]);
    assert.equal(full.status, 200, path);
    assert.equal(head.status, 200, path);
    assert.equal(full.headers.get('content-type'), contentType, path);
    assert.equal(head.headers.get('content-type'), contentType, path);
    const body = await full.arrayBuffer();
    assert.ok(body.byteLength > 0, path);
    assert.equal(full.headers.get('content-length'), String(body.byteLength), path);
    assert.equal(head.headers.get('content-length'), String(body.byteLength), path);
    assert.equal(await head.text(), '', path);
  }
});
