// Capture UI layout fix (2026-09-27): screenshots + layout measurements of gesture-training.html
// Step 1 and every state of the full-screen recording mode, at 1024x600 and 1280x720, with a
// fake camera fed from a signing clip (fake-camera.mjs).
//
// For each state it saves docs/reports/img/capture-ui-<W>x<H>-<n>-<state>.png and checks:
//   - no scrollbar: documentElement / body / #gcMode scroll sizes fit the viewport, and Step 1's
//     #leftStep1 does not overflow;
//   - every visible button is >= 44x44 (overlay bottom-bar buttons >= 56 tall);
//   - no overlap between the overlay's top-bar parts (chip, title, Cancel).
// The Saving state is made visible long enough to capture by delaying the save requests in the
// page (1.5 s each); the error state is a forced failure of save 2 (a fake 500), then Cancel,
// which keeps the one saved sample - the test label is deleted at the end.
//
// Run (Apache + MariaDB up): node tests/video-capture/screenshots.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './cdp.mjs';
import { buildY4m } from './fake-camera.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const IMG_DIR = path.join(REPO_ROOT, 'docs', 'reports', 'img');
const PAGE_URL = 'http://localhost/SKR/gesture-training.html';
const SAVE_URL = 'http://localhost/SKR/php/api/save_gesture.php';
const LABEL = 'zz_capture_ui_shots';
const SIZES = [[1024, 600], [1280, 720]];
// Optional filters: SHOTS_SIZES="1024x600" runs only that size; SHOTS_ONLY="ready,error-save-failed"
// rewrites only those images (every check still runs for every state).
const ONLY_SIZES = process.env.SHOTS_SIZES ? process.env.SHOTS_SIZES.split(',') : null;
const ONLY_SHOTS = process.env.SHOTS_ONLY ? process.env.SHOTS_ONLY.split(',') : null;
// Fixed file numbers per state (Ready was added later as 02b, so earlier files keep their names).
const SHOT_NUMBER = { 'step1-form': '01', 'starting-camera': '02', ready: '02b', rest: '03', 'sign-2-of-3': '04',
  review: '05', processing: '06', saving: '07', 'error-save-failed': '08' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, cond, detail) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// In-page instrumentation: delayed saves (so Saving can be captured) and one forced failure.
const PAGE_HELPERS = `
(() => {
  window.__shots = { failRep: 0, delayMs: 1500 };
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (url, opts) {
    if (opts && opts.method === 'POST' && String(url).includes('save_gesture.php') && opts.body && opts.body.includes('"formatVersion":3')) {
      await new Promise((r) => setTimeout(r, window.__shots.delayMs));
      const rep = JSON.parse(opts.body).repIndex;
      if (rep === window.__shots.failRep) {
        return new Response(JSON.stringify({ success: false, error: 'Forced failure for the screenshot run' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return origFetch(url, opts);
  };
  window.__shots.measure = function () {
    const vw = innerWidth, vh = innerHeight;
    const de = document.documentElement, body = document.body, mode = document.getElementById('gcMode');
    const left = document.getElementById('leftStep1');
    const vis = (e) => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0;
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    const overlayOpen = !mode.hidden;
    // Step 1: its own controls (the page nav above it is outside this change).
    const scope = overlayOpen ? mode : document.getElementById('leftStep1');
    const buttons = [...scope.querySelectorAll('button')].filter(vis).map((b) => ({ id: b.id || b.textContent.trim().slice(0, 24), ...r(b), bottomBar: !!b.closest('.gc-bottom') }));
    const small = buttons.filter((b) => b.w < 44 || b.h < 44 || (b.bottomBar && b.h < 56));
    const offscreen = buttons.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > vw + 0.5 || b.y + b.h > vh + 0.5);
    const scroll = {
      doc: [de.scrollWidth, de.scrollHeight], body: [body.scrollWidth, body.scrollHeight],
      mode: overlayOpen ? [mode.scrollWidth, mode.scrollHeight, mode.clientWidth, mode.clientHeight] : null,
      left: left && vis(left) ? [left.scrollHeight, left.clientHeight, left.scrollWidth, left.clientWidth] : null,
    };
    const noScroll = de.scrollWidth <= vw && de.scrollHeight <= vh && body.scrollWidth <= vw && body.scrollHeight <= vh &&
      (!scroll.mode || (scroll.mode[0] <= scroll.mode[2] && scroll.mode[1] <= scroll.mode[3])) &&
      (!scroll.left || (scroll.left[0] <= scroll.left[1] && scroll.left[2] <= scroll.left[3]));
    let overlaps = [];
    if (overlayOpen) {
      const parts = ['gcChip', 'gcTitle', 'gcCancel'].map((id) => document.getElementById(id)).filter(vis).map((e) => ({ id: e.id, ...r(e) }));
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push(a.id + '/' + b.id);
      }
    }
    const video = overlayOpen ? [...mode.querySelectorAll('video')].filter(vis).map((v) => ({ id: v.id, ...r(v), fit: getComputedStyle(v).objectFit })) : [];
    const media = overlayOpen ? r(document.getElementById('gcStage')) : null;
    return { vw, vh, state: mode.getAttribute('data-state'), noScroll, scroll, small, offscreen, overlaps, video, media,
      title: overlayOpen ? document.getElementById('gcTitle').innerText.replace(/\\s+/g, ' ').trim() : null };
  };
  return true;
})()`;

async function runSize(width, height, y4m) {
  console.log(`\n=== ${width}x${height} ===`);
  const chrome = await launchChrome({
    width, height,
    extraArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`],
  });
  try {
    const ev = (expr) => chrome.evaluate(expr);
    const waitFor = async (expr, timeoutMs, stepMs = 50) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) { if (await ev(expr)) return Date.now() - t0; await sleep(stepMs); }
      return -1;
    };
    const state = `document.getElementById('gcMode').getAttribute('data-state')`;
    const shot = async (name) => {
      const m = await ev(`window.__shots.measure()`);
      const file = `capture-ui-${width}x${height}-${SHOT_NUMBER[name]}-${name}.png`;
      if (!ONLY_SHOTS || ONLY_SHOTS.includes(name)) {
        const r = await chrome.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(path.join(IMG_DIR, file), Buffer.from(r.result.data, 'base64'));
      }
      console.log(`  [${name}] ${file} state=${m.state} title=${JSON.stringify(m.title)} media=${JSON.stringify(m.media)} video=${JSON.stringify(m.video)}`);
      check(`${width}x${height} ${name}: no scrollbar`, m.noScroll, JSON.stringify(m.scroll));
      check(`${width}x${height} ${name}: buttons >= 44x44 (bottom bar >= 56 tall), none off-screen`, m.small.length === 0 && m.offscreen.length === 0, JSON.stringify(m.small.concat(m.offscreen)));
      check(`${width}x${height} ${name}: top bar parts do not overlap`, m.overlaps.length === 0, JSON.stringify(m.overlaps));
      return m;
    };

    await chrome.navigate(PAGE_URL);
    await waitFor(`!!(window.GestureDataRecorder && window.GestureCaptureUI && typeof trVerifyPin === 'function')`, 15000);
    await ev(`pinInput = '2026'; trVerifyPin(); true`);
    await sleep(400);
    await ev(`showStepContent(1); true`);
    await sleep(800);
    await ev(PAGE_HELPERS);
    await ev(`(() => { const i = document.getElementById('gestureLabelInput'); i.value = ${JSON.stringify(LABEL)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await waitFor(`!/^0 gestures/.test(document.getElementById('datasetCount').textContent)`, 20000, 200);
    await waitFor(`getComputedStyle(document.getElementById('sk-toast')).opacity === '0'`, 10000, 200); // no toast over the form
    await sleep(300);

    const form = await shot('step1-form');
    const pills = await ev(`[...document.querySelectorAll('.tr-nav button, .tr-nav a')].map((b) => { const r = b.getBoundingClientRect(); return (b.id || b.textContent.trim()) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); })`);
    console.log('  (not part of this change) page nav controls:', JSON.stringify(pills));
    const camOffscreen = await ev(`(() => { const b = document.querySelector('#trContentWrap .tr-right-panel').getBoundingClientRect(); return b.right <= 0 || b.bottom <= 0; })()`);
    check(`${width}x${height} Step 1: camera panel not on screen`, camOffscreen);
    const camOffAtForm = await ev(`!document.getElementById('videoFeed').srcObject`);
    check(`${width}x${height} Step 1: camera not started before the overlay opens`, camOffAtForm);

    // Starting camera: capture right after opening, before the first live result.
    await ev(`document.getElementById('startGestureDataBtn').click(); true`);
    await waitFor(`${state} === 'starting'`, 3000, 20);
    const starting = await shot('starting-camera');
    const startBtn = await ev(`({ d: document.getElementById('gcStart').disabled, t: document.getElementById('gcStart').textContent })`);
    check(`${width}x${height} Starting camera: START disabled with "Starting camera…"`, starting.state === 'starting' && startBtn.d && startBtn.t === 'Starting camera…', JSON.stringify(startBtn));
    const readyMs = await waitFor(`${state} === 'ready'`, 60000, 100);
    check(`${width}x${height} START enabled once camera + detector are ready`, readyMs >= 0 && (await ev(`!document.getElementById('gcStart').disabled`)), `${readyMs} ms`);
    await sleep(2500); // the fake camera's black lead-in: capture Ready with the signer on screen
    const ready = await shot('ready');
    check(`${width}x${height} Ready: title READY, bottom bar START only`, ready.title === 'READY' &&
      (await ev(`[...document.querySelectorAll('#gcActions button')].filter((b) => !b.hidden).map((b) => b.id).join(',')`)) === 'gcStart', ready.title);

    await ev(`document.getElementById('gcStart').click(); true`);
    await waitFor(`${state} === 'recording' && document.getElementById('gcPrompt').textContent === 'REST'`, 8000);
    await shot('rest');
    const s2 = await waitFor(`document.getElementById('gcPrompt').textContent === 'SIGN 2 of 3' && document.getElementById('gcHand').classList.contains('on')`, 60000, 30);
    if (s2 < 0) await waitFor(`document.getElementById('gcPrompt').textContent === 'SIGN 2 of 3'`, 30000, 30);
    await shot('sign-2-of-3');
    const rev = await waitFor(`${state} === 'review'`, 60000, 100);
    check(`${width}x${height} reached Review`, rev >= 0);
    // The recording starts with the fake camera's black lead-in; capture once the signer is on screen.
    await sleep(2600);
    const review = await shot('review');
    check(`${width}x${height} Review title`, review.title === 'REVIEW · 3 signs found', review.title);

    await ev(`window.__shots.failRep = 0; document.getElementById('gcSave').click(); true`);
    await waitFor(`${state} === 'processing' && /PROCESSING [1-9]/.test(document.getElementById('gcMsg').textContent)`, 20000, 30);
    const proc = await shot('processing');
    check(`${width}x${height} Processing title`, /^PROCESSING \d+%$/.test(proc.title || ''), proc.title);
    await waitFor(`${state} === 'saving'`, 60000, 30);
    const saving = await shot('saving');
    check(`${width}x${height} Saving: title + Cancel hidden`, /^SAVING [1-3] of 3$/.test(saving.title || '') && (await ev(`document.getElementById('gcCancel').hidden`)), saving.title);
    await waitFor(`${state} === 'closed'`, 60000, 100);

    // Error state: record again, force save 2 to fail.
    await ev(`document.getElementById('startGestureDataBtn').click(); true`);
    await waitFor(`${state} === 'ready'`, 60000, 100);
    await ev(`document.getElementById('gcStart').click(); true`);
    await waitFor(`${state} === 'review'`, 90000, 100);
    await ev(`window.__shots.failRep = 2; document.getElementById('gcSave').click(); true`);
    await waitFor(`${state} === 'error'`, 90000, 100);
    await sleep(300);
    const err = await shot('error-save-failed');
    const errBtns = await ev(`({ retry: !document.getElementById('gcRetrySave').hidden, topCancel: !document.getElementById('gcCancel').hidden,
      bottom: [...document.querySelectorAll('#gcActions button')].filter((b) => !b.hidden).map((b) => b.id) })`);
    check(`${width}x${height} error: message + Retry save only in the bottom bar, Cancel top-right`, /^Saved 1 of 3\. Sign 2 was not saved:/.test(err.title || '') && errBtns.retry && errBtns.topCancel && JSON.stringify(errBtns.bottom) === '["gcRetrySave"]', JSON.stringify({ t: err.title, errBtns }));
    await ev(`document.getElementById('gcCancel').click(); true`);
    await waitFor(`${state} === 'closed'`, 30000, 100);
    const camAfter = await ev(`({ src: !!document.getElementById('videoFeed').srcObject, badge: document.getElementById('camBadge').textContent.trim() })`);
    check(`${width}x${height} closing the overlay stops the camera it started`, !camAfter.src && /Camera Off/.test(camAfter.badge), JSON.stringify(camAfter));

    const errs = chrome.getConsoleErrors ? chrome.getConsoleErrors() : [];
    const exc = chrome.getExceptions ? chrome.getExceptions() : [];
    check(`${width}x${height} 0 console errors / exceptions`, errs.length === 0 && exc.length === 0, JSON.stringify({ errs, exc }).slice(0, 400));
  } finally {
    await chrome.close();
  }
}

async function cleanup() {
  const res = await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_gesture', label: LABEL }) });
  console.log('  cleanup delete_gesture:', res.status);
}

(async () => {
  mkdirSync(IMG_DIR, { recursive: true });
  const tmpDir = mkdtempSync(path.join(__dirname, '.tmp-shots-'));
  try {
    const y4m = buildY4m(tmpDir);
    for (const [w, h] of SIZES) if (!ONLY_SIZES || ONLY_SIZES.includes(`${w}x${h}`)) await runSize(w, h, y4m);
  } catch (e) {
    failures++;
    console.log('  FAIL  run threw:', e && e.stack ? e.stack : e);
  } finally {
    await cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
