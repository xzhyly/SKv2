// Reusable minimal CDP driver, based on .git/sdd/cdp.mjs (Step 1 spike). Launches headless
// Chrome with the same flags used to measure Step 1 (autoplay allowed, media not suspended in
// the background), sets a 1024x600 viewport (the kiosk's touchscreen size), navigates to a
// page, and lets a caller `evaluate()` awaited expressions in that page - returning
// JSON-serializable values via Runtime.evaluate's returnByValue. Also collects console
// messages (Runtime.consoleAPICalled) and uncaught exceptions (Runtime.exceptionThrown) so a
// check can assert "0 console errors" without MediaPipe's own info/warning logs tripping it.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function launchChrome({ port = 9333, width = 1024, height = 600 } = {}) {
  const profileDir = mkdtempSync(join(tmpdir(), 'vc-cdp-'));
  const proc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-media-suspend',
      '--disable-renderer-backgrounding',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!targets) {
    proc.kill();
    rmSync(profileDir, { recursive: true, force: true });
    throw new Error('Chrome did not open its CDP endpoint in time');
  }

  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));

  let id = 0;
  const pending = new Map();
  const consoleMessages = []; // { type, text }
  const exceptions = []; // string

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const args = (m.params.args || []).map((a) => (a.value !== undefined ? a.value : a.description));
      consoleMessages.push({ type: m.params.type, text: args.join(' ') });
    } else if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(JSON.stringify(m.params.exceptionDetails).slice(0, 500));
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  async function navigate(url) {
    await send('Page.navigate', { url });
    await sleep(1500);
  }

  await navigate('about:blank');

  async function evaluate(expression, { awaitPromise = true, timeoutMs = 600000 } = {}) {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (r.result.exceptionDetails) {
      const detail = r.result.exceptionDetails;
      const message =
        (detail.exception && (detail.exception.description || detail.exception.value)) ||
        detail.text ||
        JSON.stringify(detail);
      throw new Error(`page evaluate failed: ${message}`);
    }
    return r.result.result.value;
  }

  function getConsoleErrors() {
    return consoleMessages.filter((m) => m.type === 'error');
  }

  function getExceptions() {
    return exceptions.slice();
  }

  async function close() {
    try {
      ws.close();
    } catch {}
    proc.kill();
    // Give Windows a moment to release file handles before removing the profile dir.
    await sleep(300);
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }

  return { navigate, evaluate, getConsoleErrors, getExceptions, close, proc };
}
