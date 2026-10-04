// Start-up timing for gesture-training.html's recording mode (capture UI owner follow-up,
// 2026-09-27): how long "Starting camera…" takes before START is enabled, on the first and the
// second open, plus a check that the page-load MediaPipe warm-up does not slow Steps 2-4.
//
// Scenario (fake camera fed from a signing clip, fake-camera.mjs, 1024x600):
//   1. load the page, pass the PIN, open Step 1, wait for the dataset count, then 2 s idle
//      (an operator typing the gesture name);
//   2. open the recording mode -> ms until START is enabled (first open); Cancel;
//   3. open again -> ms until START is enabled (second open); Cancel;
//   4. Step 2: Train AI -> ms until "Complete!/Up to date";
//   5. Step 3: Enable Camera -> ms until live hand results flow; then 10 s of Predict, counting
//      polls that show a predicted word;
//   6. console errors / uncaught exceptions over the whole run.
// Prints one JSON line of results. Creates no samples (Cancel before recording).
//
// Run (Apache + MariaDB up): node tests/video-capture/startup-check.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './cdp.mjs';
import { buildY4m } from './fake-camera.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(path.join(__dirname, '.tmp-startup-'));
let chrome = null;
const out = {};
try {
  const y4m = buildY4m(tmp);
  chrome = await launchChrome({
    extraArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`],
  });
  const ev = (e) => chrome.evaluate(e);
  const waitFor = async (expr, timeoutMs, stepMs = 25) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { if (await ev(expr)) return Date.now() - t0; await sleep(stepMs); }
    return -1;
  };
  const state = `document.getElementById('gcMode').getAttribute('data-state')`;

  const tNav = Date.now();
  await chrome.navigate('http://localhost/SKR/gesture-training.html');
  await waitFor(`typeof trVerifyPin === 'function' && !!window.GestureCaptureUI`, 20000, 50);
  await ev(`pinInput = '2026'; trVerifyPin(); showStepContent(1); true`);
  const dsMs = await waitFor(`!/^0 gestures/.test(document.getElementById('datasetCount').textContent)`, 60000, 50);
  out.datasetLoadedMsAfterNavigate = dsMs < 0 ? -1 : Date.now() - tNav;
  await ev(`(() => { const i = document.getElementById('signTextEn'); i.value = 'zz_startup_check'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(2000);
  // Page-load warm-up (window.handTrackingWarmUp -> { ok, ms }; absent before the owner follow-up).
  await ev(`window.__warmDone = false; if (window.handTrackingWarmUp) window.handTrackingWarmUp.then(() => { window.__warmDone = true; }); true`);
  await sleep(50);
  out.warmUpDoneBeforeFirstOpen = await ev(`window.__warmDone`);

  for (const which of ['firstOpen', 'secondOpen']) {
    await ev(`window.__t0 = performance.now(); document.getElementById('startGestureDataBtn').click(); true`);
    const ok = await waitFor(`${state} === 'ready' && !document.getElementById('gcStart').disabled`, 90000);
    out[which + 'StartEnabledMs'] = ok < 0 ? -1 : Math.round(await ev(`performance.now() - window.__t0`));
    out[which + 'State'] = await ev(state);
    await ev(`document.getElementById('gcCancel').click(); true`);
    await waitFor(`${state} === 'closed'`, 10000);
    await sleep(1000);
  }

  out.warmUp = await ev(`window.handTrackingWarmUp || null`);
  await ev(`trClickPill(2); showStepContent(2); window.__t0 = performance.now(); document.getElementById('trainBtn').click(); true`);
  await waitFor(`/^(Complete!|Up to date)/.test(document.getElementById('epochLabel').textContent)`, 300000, 100);
  out.trainMs = Math.round(await ev(`performance.now() - window.__t0`));
  out.trainLabel = await ev(`document.getElementById('epochLabel').textContent`);

  await ev(`trGoToStep(3); showStepContent(3); true`);
  await sleep(600);
  await ev(`window.__hr = 0; GestureDataRecorder.onHandResults(() => { window.__hr++; }); window.__t0 = performance.now(); document.getElementById('enableCamBtn').click(); true`);
  await waitFor(`window.__hr > 0`, 60000);
  out.step3CameraToFirstResultMs = Math.round(await ev(`performance.now() - window.__t0`));
  let polls = 0, predicted = 0;
  const t1 = Date.now();
  while (Date.now() - t1 < 10000) {
    const v = await ev(`document.getElementById('livePredResult').textContent`);
    polls++; if (v && v !== '—') predicted++;
    await sleep(250);
  }
  out.step3PredictPolls = polls;
  out.step3PollsWithAWord = predicted;
  out.consoleErrors = chrome.getConsoleErrors();
  out.exceptions = chrome.getExceptions();
} catch (e) {
  out.error = e && e.stack ? e.stack : String(e);
} finally {
  if (chrome) await chrome.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
console.log(JSON.stringify(out));
process.exit(out.error ? 1 : 0);
