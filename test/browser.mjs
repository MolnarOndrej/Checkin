import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const timeout = 10_000;

export function startProcess(command, args, options, readyPattern) {
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let timer;
  const ready = new Promise((resolve, reject) => {
    const output = ['', ''];
    const diagnostics = () => output.join('\n').trim();
    timer = setTimeout(() => reject(new Error(`Timed out starting ${command}\n${diagnostics()}`)), timeout);
    child.once('error', reject);
    child.once('close', (code) => reject(new Error(`${command} exited with code ${code}\n${diagnostics()}`)));
    for (const [index, stream] of [child.stdout, child.stderr].entries()) {
      stream.setEncoding('utf8').on('data', (chunk) => {
        output[index] = (output[index] + chunk).slice(-8192);
        const match = output[index].match(readyPattern);
        if (match) resolve(match[1]);
      });
    }
  }).finally(() => clearTimeout(timer));
  return {
    ready,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    },
  };
}

function browserExecutable() {
  const { CHECKIN_BROWSER, ProgramFiles, LOCALAPPDATA } = process.env;
  const candidates = [ProgramFiles, process.env['ProgramFiles(x86)'], LOCALAPPDATA]
    .filter(Boolean)
    .flatMap((root) => [
      join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  const executable = CHECKIN_BROWSER || candidates.find((path) => existsSync(path));
  if (!executable) throw new Error('Set CHECKIN_BROWSER to the path of an installed Chrome or Edge executable.');
  return executable;
}

export async function openBrowser(t) {
  const executable = browserExecutable();
  const temp = await realpath(tmpdir());
  const profile = await mkdtemp(join(temp, 'checkin-browser-'));
  let browser;
  let socket;
  t.after(async () => {
    try {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ id: 0, method: 'Browser.close' }));
        await once(socket, 'close', { signal: AbortSignal.timeout(2000) }).catch(() => {});
      }
    } finally {
      socket?.close();
      await browser?.stop();
      if (dirname(profile) !== temp) throw new Error(`Unexpected test profile path: ${profile}`);
      await rm(profile, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  browser = startProcess(executable, [
    '--headless', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--mute-audio', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], {}, /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)\r?\n/);
  socket = new WebSocket(await browser.ready);
  await once(socket, 'open', { signal: AbortSignal.timeout(timeout) });

  const events = new EventEmitter();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    events.emit(String(message.id ?? message.method), message);
  });

  let commandId = 0;
  async function send(method, params, sessionId) {
    const id = ++commandId;
    const reply = once(events, String(id), { signal: AbortSignal.timeout(timeout) });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
    const [{ result, error }] = await reply;
    if (error) throw new Error(`${method}: ${error.message}`);
    return result;
  }

  const { targetInfos } = await send('Target.getTargets');
  const { targetId } = targetInfos.find((target) => target.type === 'page' && target.url === 'about:blank');
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page('Page.enable');

  async function load(method, params) {
    const [, result] = await Promise.all([
      once(events, 'Page.loadEventFired', { signal: AbortSignal.timeout(timeout) }),
      page(method, params),
    ]);
    if (result?.errorText) throw new Error(`${method}: ${result.errorText}`);
  }

  return {
    navigate: (url) => load('Page.navigate', { url }),
    reload: () => load('Page.reload'),
    setReducedMotion: (value) => page('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }],
    }),
    setViewport: (width, height) => page('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    }),
    async evaluate(action) {
      const { result, exceptionDetails } = await page('Runtime.evaluate', {
        expression: `(${action})()`, returnByValue: true, awaitPromise: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
  };
}
