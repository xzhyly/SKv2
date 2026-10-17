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

// SK_CHROME: another Chrome/Chromium binary (accounts-quiz phase: the cloud session's Chromium).
const CHROME_PATH = process.env.SK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Accounts-quiz phase: the admin pages send anyone who is not a logged-in admin to the dashboard.
// navigate() logs this Chrome in as an admin (php/auth.php) the first time it opens one of them,
// so every check that drives an admin page keeps working. SK_TEST_ADMIN_USER / SK_TEST_ADMIN_PASS
// override the seeded admin / admin123.
const ADMIN_PAGE_RE = /\/(gesture-training|reports|bulk-import|avatar-clips|diagnostic|users)\.html(\?|#|$)/;

// extraArgs: additional Chrome command-line flags (e.g. the fake-camera flags used by
// capture-ui-check.mjs).
export async function launchChrome({ port = 9333, width = 1024, height = 600, extraArgs = [] } = {}) {
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
      ...extraArgs,
      // SK_CHROME_ARGS: extra flags from the environment (e.g. "--no-sandbox" for Chromium run as root).
      ...(process.env.SK_CHROME_ARGS ? process.env.SK_CHROME_ARGS.split(' ').filter(Boolean) : []),
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
  // Network.requestWillBeSent log, only populated once a caller calls enableNetwork() (Task 6's
  // e2e.mjs uses this to independently confirm no request ever carries video_base64/video_path,
  // at the CDP level rather than via a page-side fetch wrapper). Left empty and unused by any
  // existing check, so this is a no-op for callers that never enable it.
  const networkRequests = []; // { requestId, method, url, postData, hasPostData }

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
    } else if (m.method === 'Network.requestWillBeSent') {
      const req = m.params.request || {};
      networkRequests.push({
        requestId: m.params.requestId,
        method: req.method,
        url: req.url,
        postData: req.postData !== undefined ? req.postData : null,
        hasPostData: !!req.hasPostData,
      });
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

  let adminSession = false;
  async function ensureAdminSession(url) {
    const base = url.replace(/[^/]*$/, '');
    const res = await fetch(base + 'php/auth.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'login',
        username: process.env.SK_TEST_ADMIN_USER || 'admin',
        password: process.env.SK_TEST_ADMIN_PASS || 'admin123',
      }),
    });
    const cookie = (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''])
      .map((c) => /^SKSESSID=([^;]+)/.exec(c)).find(Boolean);
    if (!res.ok || !cookie) {
      throw new Error(`admin login for ${url} failed (HTTP ${res.status}); set SK_TEST_ADMIN_USER / SK_TEST_ADMIN_PASS`);
    }
    await send('Network.setCookie', { name: 'SKSESSID', value: cookie[1], url: base, path: '/', httpOnly: true });
    adminSession = true;
  }

  async function navigate(url) {
    if (!adminSession && ADMIN_PAGE_RE.test(url)) await ensureAdminSession(url);
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

  // Opt-in: enables the CDP Network domain so networkRequests starts filling and
  // getNetworkRequests()/getRequestPostData() become meaningful. No effect on existing callers
  // that never invoke it.
  async function enableNetwork() {
    await send('Network.enable');
  }

  function getNetworkRequests() {
    return networkRequests.slice();
  }

  // For a request whose postData was too large to inline on requestWillBeSent (hasPostData true,
  // postData null), fetch it explicitly. Returns null if unavailable (e.g. request already
  // evicted from Chrome's buffer).
  async function getRequestPostData(requestId) {
    const r = await send('Network.getRequestPostData', { requestId });
    return r.result && r.result.postData !== undefined ? r.result.postData : null;
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

  return {
    navigate,
    evaluate,
    send,
    getConsoleErrors,
    getExceptions,
    close,
    proc,
    enableNetwork,
    getNetworkRequests,
    getRequestPostData,
  };
}
