// Check for Task 5 (video-based gesture capture): the full-screen recording mode
// (js/gesture-capture-ui.js, #gcMode in gesture-training.html) and the removal of the old
// live-capture path.
//
// Drives gesture-training.html over headless Chrome via CDP at exactly 1024x600, with Chrome's
// fake camera fed from a y4m file built with the repo-root ffmpeg.exe from
// assets/signs/en/hello.webm (black, clip, black, clip, black, clip, black; letterboxed to
// 320x240, 30 fps) in a temporary folder under tests/video-capture/ that is deleted at the end.
// Nothing is written under assets/.
//
// Verifies, at 1024x600:
//   - form: "Record 3 samples" is one full-width button >= 44 px tall; the empty-label and
//     camera-off toasts; no Finish Capture / Landmark-frames card / preview panel left;
//   - pressing g / G does nothing (no overlay, no MediaRecorder, no prompt()) and no
//     "Press G" text appears anywhere;
//   - Ready, Countdown, Recording, Review, Processing, a save-failure error state and the
//     camera-stopped error state: documentElement.scrollWidth === 1024, every visible button
//     >= 44x44 (>= 56 tall in Review/Processing/errors), no overlap between prompt, dots, hand
//     indicator, REC and Cancel;
//   - Cancel is hidden for the whole time the 3 saves run and visible otherwise;
//   - a forced failure of save #2 shows "Saved 1 of 3. Sign 2 was not saved: ...", and
//     "Retry save" re-sends only reps 2 and 3;
//   - no save request carries video_base64 / video_path; each carries formatVersion 3;
//   - Cancel during Processing aborts (no save request, overlay closed, live loop resumes);
//   - (fix round 1) the sample line's frame number equals the sum of the saved samples' frames;
//     Done and Cancel-after-hard-save-failure both invalidate the caches once and run
//     reloadDataset once; Cancel after a hard failure toasts "N of 3 samples saved for ...";
//     a real track stop() during Recording ends in the camera-stopped error, never Review;
//     the countdown-to-recording time is 2800-3600 ms;
//   - (fix round 2) with the live loop paused right after the countdown, the hand-tracking
//     watchdog shows "Hand tracking is not ready. Please try again." within 5-7 s, sends no
//     request, and Redo returns to Ready;
//   - 0 console errors / uncaught exceptions;
//   - the test label (zz_video_capture_t5) is deleted afterwards (delete_gesture);
//   - Train AI (Step 2) still completes after the removals.
//
// (Overlap is checked pairwise between every visible one of: prompt, dots, hand indicator, REC,
// hint, Cancel, chip, message, progress bar and the action-button column.)
//
// Run (Apache + MariaDB up): node tests/video-capture/capture-ui-check.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FFMPEG = path.join(REPO_ROOT, 'ffmpeg.exe');
const CLIP = path.join(REPO_ROOT, 'assets', 'signs', 'en', 'hello.webm');
const PAGE_URL = 'http://localhost/SKR/gesture-training.html';
const SAVE_URL = 'http://localhost/SKR/php/api/save_gesture.php';
const LABEL = 'zz_video_capture_t5';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}${detail ? ' - ' + detail : ''}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`);
  }
}

function buildY4m(dir) {
  const out = path.join(dir, 'fake-cam.y4m');
  const lb = 'scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p';
  const black = (d) => `color=c=black:s=320x240:r=30:d=${d},format=yuv420p,setsar=1`;
  const filter = [
    `${black(2)}[b0]`,
    `[0:v]${lb},split=3[c1][c2][c3]`,
    `${black(2)}[b1]`,
    `${black(2)}[b2]`,
    `${black(3)}[b3]`,
    '[b0][c1][b1][c2][b2][c3][b3]concat=n=7:v=1:a=0[out]',
  ].join(';');
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', CLIP, '-filter_complex', filter, '-map', '[out]', '-pix_fmt', 'yuv420p', out]);
  return out;
}

// In-page helpers, installed once after navigation.
const PAGE_HELPERS = `
(function () {
  window.__t5 = { mr: 0, prompts: 0, bodies: [], saveCalls: [], cancelDuringSaving: [], states: [] };
  const OrigMR = window.MediaRecorder;
  window.MediaRecorder = function (s, o) { window.__t5.mr++; return new OrigMR(s, o); };
  window.MediaRecorder.prototype = OrigMR.prototype;
  window.MediaRecorder.isTypeSupported = OrigMR.isTypeSupported.bind(OrigMR);
  window.prompt = function () { window.__t5.prompts++; return null; };
  const origFetch = window.fetch;
  window.fetch = function (url, init) {
    if (init && init.method === 'POST' && typeof init.body === 'string') {
      try {
        const b = JSON.parse(init.body);
        window.__t5.bodies.push({ url: String(url), keys: Object.keys(b), formatVersion: b.formatVersion,
          repIndex: b.repIndex, frames: Array.isArray(b.frames) ? b.frames.length : null,
          hasVideo: 'video_base64' in b || 'video_path' in b, source: b.source });
      } catch (e) {}
    }
    return origFetch.apply(this, arguments);
  };
  // Record every data-state transition and whether Cancel was hidden in it.
  const root = document.getElementById('gcMode');
  const cancel = document.getElementById('gcCancel');
  const log = () => {
    const st = root.getAttribute('data-state');
    const last = window.__t5.states[window.__t5.states.length - 1];
    const entry = st + (cancel.hidden ? ':cancel-hidden' : ':cancel-visible');
    if (last !== entry) window.__t5.states.push(entry);
  };
  new MutationObserver(log).observe(root, { attributes: true, subtree: true, attributeFilter: ['data-state', 'hidden'] });
  window.__t5.measure = function (minBtnH) {
    const vis = (e) => e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
      && !e.closest('[hidden]');
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
    const buttons = Array.from(document.querySelectorAll('#gcMode button')).filter(vis)
      .map((b) => ({ id: b.id, text: b.textContent.trim(), disabled: b.disabled, ...r(b) }));
    const ids = ['gcPrompt', 'gcDots', 'gcHand', 'gcRec', 'gcHint', 'gcCancel', 'gcChip', 'gcMsg', 'gcProgress', 'gcActions'];
    const boxes = {};
    ids.forEach((id) => { const e = document.getElementById(id); if (vis(e)) boxes[id] = e.getBoundingClientRect(); });
    const overlaps = [];
    const keys = Object.keys(boxes);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = boxes[keys[i]], b = boxes[keys[j]];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(keys[i] + '/' + keys[j]);
    }
    const stage = r(document.getElementById('gcStage'));
    const small = buttons.filter((b) => b.w < 44 || b.h < Math.max(44, minBtnH || 0));
    const mode = r(document.getElementById('gcMode'));
    return {
      state: document.getElementById('gcMode').getAttribute('data-state'),
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      mode, stage, buttons, small, overlaps, measured: keys,
      prompt: vis(document.getElementById('gcPrompt')) ? document.getElementById('gcPrompt').textContent : null,
      msg: vis(document.getElementById('gcMsg')) ? document.getElementById('gcMsg').textContent : null,
      hand: vis(document.getElementById('gcHand')) ? document.getElementById('gcHandText').textContent : null,
      chip: document.getElementById('gcChip').textContent,
    };
  };
  // Log every toast: the page's async dataset load can overwrite #sk-toast within ms, so
  // precondition toasts are asserted from this log rather than the element's current text.
  window.__t5.toasts = [];
  const origToast = window.showToast;
  window.showToast = function (m) { window.__t5.toasts.push(String(m)); return origToast.apply(this, arguments); };
  window.__t5.handResults = 0;
  GestureDataRecorder.onHandResults(() => { window.__t5.handResults++; });
  // saveGestureSample wrapper: logs every call; window.__t5.shouldFail(repIndex, n) forces a failure
  // with window.__t5.failMessage. savedFrames sums the frames of calls that reached the network.
  window.__t5.shouldFail = null;
  window.__t5.failMessage = 'forced test failure';
  window.__t5.savedFrames = 0;
  const origSave = GestureDataRecorder.saveGestureSample;
  let nSave = 0;
  GestureDataRecorder.saveGestureSample = function (label, frames, lang, vb, vp, cat, meta) {
    nSave++;
    const repIndex = meta && meta.repIndex;
    window.__t5.saveCalls.push({ n: nSave, repIndex, vb, vp, frames: frames.length });
    if (window.__t5.shouldFail && window.__t5.shouldFail(repIndex, nSave)) return Promise.reject(new Error(window.__t5.failMessage));
    return origSave.apply(this, arguments).then((res) => { window.__t5.savedFrames += frames.length; return res; });
  };
  // Count the post-save steps.
  window.__t5.reloads = 0;
  const origReload = window.reloadDataset;
  window.reloadDataset = function () { window.__t5.reloads++; return origReload.apply(this, arguments); };
  window.__t5.removeModel = [];
  if (window.tf && tf.io && tf.io.removeModel) {
    const origRemove = tf.io.removeModel.bind(tf.io);
    tf.io.removeModel = function (key) { window.__t5.removeModel.push(key); return origRemove(key); };
  }
  window.__t5.line = () => {
    const t = document.getElementById('sampleCountLine').textContent;
    const m = t.match(/(\\d+) samples? saved \\((\\d+) frames\\)/);
    return { text: t, samples: m ? +m[1] : null, frames: m ? +m[2] : null };
  };
})();
true;
`;

async function main() {
  const tmpDir = mkdtempSync(path.join(__dirname, '.tmp-capture-ui-'));
  let chrome = null;
  const assetsBefore = readdirSync(path.join(REPO_ROOT, 'assets', 'signs', 'en')).filter((f) => f.startsWith('zz'));
  try {
    const y4m = buildY4m(tmpDir);
    console.log(`fake camera file: ${statSync(y4m).size} bytes`);
    chrome = await launchChrome({
      extraArgs: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-video-capture=${y4m}`,
      ],
    });
    const ev = (expr) => chrome.evaluate(expr);
    const waitFor = async (expr, timeoutMs, stepMs = 100) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (await ev(expr)) return Date.now() - t0;
        await sleep(stepMs);
      }
      return -1;
    };
    const state = () => ev(`document.getElementById('gcMode').getAttribute('data-state')`);
    const toast = () => ev(`document.getElementById('sk-toast').textContent`);
    // START is disabled until the overlay's camera + first hand result are ready (capture UI
    // layout fix): wait for Ready before pressing it.
    const click = async (id) => {
      if (id === 'gcStart') await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'ready'`, 60000, 50);
      return ev(`document.getElementById(${JSON.stringify(id)}).click(); true`);
    };
    const setLabel = (v) => ev(`(() => { const i = document.getElementById('signTextEn'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

    await chrome.navigate(PAGE_URL);
    await waitFor(`!!(window.GestureDataRecorder && window.GestureCaptureUI && window.GestureCaptureCore && window.VideoLandmarks && typeof trVerifyPin === 'function')`, 15000);
    await ev(`pinInput = '2026'; trVerifyPin(); true`);
    await sleep(400);
    await ev(`showStepContent(1); true`);
    await sleep(800);
    await ev(PAGE_HELPERS);

    console.log('--- form (Step 1) ---');
    const form = await ev(`(() => {
      const b = document.getElementById('startGestureDataBtn').getBoundingClientRect();
      const card = document.getElementById('startGestureDataBtn').parentElement.getBoundingClientRect(); // its Step 1 column
      return { text: document.getElementById('startGestureDataBtn').textContent, w: b.width, h: b.height, cardW: card.width,
        stop: !!document.getElementById('stopGestureDataBtn'), lm: !!document.getElementById('gestureDataStatus'),
        preview: !!document.getElementById('step1PreviewControls'), countdown: !!document.getElementById('countdownOverlay'),
        scrollWidth: document.documentElement.scrollWidth,
        api: ['startRecording','stopRecording','confirmAndSave','discardCapture'].filter(k => k in GestureDataRecorder) };
    })()`);
    check('Record button text', form.text === 'Record 3 samples', JSON.stringify(form.text));
    check('Record button spans its column and is >= 44 px tall', form.h >= 44 && Math.abs(form.w - form.cardW) < 1, `${form.w}x${form.h} (column width ${form.cardW})`);
    check('Finish Capture / Landmark frames / preview panel / countdown overlay removed', !form.stop && !form.lm && !form.preview && !form.countdown);
    check('old GestureDataRecorder capture exports removed', form.api.length === 0, JSON.stringify(form.api));
    check('form scrollWidth === 1024', form.scrollWidth === 1024, String(form.scrollWidth));

    await setLabel('');
    await ev(`window.__t5.toasts.length = 0; true`);
    await click('startGestureDataBtn');
    await sleep(150);
    const t1 = await ev(`window.__t5.toasts.join(' | ')`);
    check('empty label -> toast', t1.split(' | ').includes('Enter the English text first.'), JSON.stringify(t1));
    await setLabel(LABEL);
    await ev(`window.__t5.toasts.length = 0; true`);
    await click('startGestureDataBtn');
    await sleep(150);
    const t2 = await ev(`window.__t5.toasts.join(' | ')`);
    // Camera off: the overlay opens in "Starting camera", starts the camera itself, and enables
    // START once the first live hand result arrives; Cancel stops the camera it started.
    const st0 = await ev(`({ s: document.getElementById('gcMode').getAttribute('data-state'), d: document.getElementById('gcStart').disabled, t: document.getElementById('gcStart').textContent })`);
    check('camera off -> overlay opens in Starting camera, START disabled', st0.s === 'starting' && st0.d && st0.t === 'Starting camera…' && !t2.includes('enable the camera'), JSON.stringify({ st0, t2 }));
    const rdy0 = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'ready' && !document.getElementById('gcStart').disabled && document.getElementById('gcStart').textContent === 'START'`, 60000, 100);
    check('camera started by the overlay -> Ready, START enabled', rdy0 >= 0, `${rdy0} ms`);
    await click('gcCancel');
    await sleep(300);
    const off0 = await ev(`({ s: document.getElementById('gcMode').getAttribute('data-state'), src: !!document.getElementById('videoFeed').srcObject, badge: document.getElementById('camBadge').textContent.trim() })`);
    check('Cancel -> closed and the overlay-started camera is stopped', off0.s === 'closed' && !off0.src && /Camera Off/.test(off0.badge), JSON.stringify(off0));

    console.log('--- camera ---');
    await click('enableCamBtn');
    const camMs = await waitFor(`window.__t5.handResults > 5`, 60000, 200);
    check('camera enabled and live hand results flowing', camMs >= 0, `${camMs} ms`);
    await sleep(3200); // let the "Camera started" toast expire before the G-key check

    console.log('--- G key ---');
    await ev(`document.activeElement && document.activeElement.blur(); true`);
    for (const key of ['g', 'G']) {
      const code = 'KeyG';
      await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key, windowsVirtualKeyCode: 71, modifiers: key === 'G' ? 8 : 0 });
      await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: 71, modifiers: key === 'G' ? 8 : 0 });
    }
    await sleep(1500);
    const g = await ev(`({ state: document.getElementById('gcMode').getAttribute('data-state'), mr: window.__t5.mr, prompts: window.__t5.prompts,
      pressG: /Press\\s*"?G/i.test(document.body.innerText + ' ' + document.getElementById('sk-toast').textContent), toast: document.getElementById('sk-toast').textContent,
      toastOpacity: document.getElementById('sk-toast').style.opacity })`);
    check('g/G: no overlay, no MediaRecorder, no prompt()', g.state === 'closed' && g.mr === 0 && g.prompts === 0, JSON.stringify(g));
    check('no "Press G" text anywhere', !g.pressG);

    console.log('--- recording mode, run 1 (full flow with forced save #2 failure + retry) ---');
    await setLabel(LABEL);
    await ev(`document.querySelector('input[name="gestureCategory"][value="word"]').checked = true; true`);
    await click('startGestureDataBtn');
    await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'ready'`, 60000, 50);
    const ready = await ev(`window.__t5.measure(44)`);
    console.log('  Ready:', JSON.stringify(ready));
    check('Ready: state', ready.state === 'ready');
    check('Ready: chip text', ready.chip === `${LABEL} · ESL · Word`, ready.chip);
    check('Ready: overlay covers 1024x600', ready.mode.w === 1024 && ready.mode.h === 600, JSON.stringify(ready.mode));
    check('Ready: media row spans the full width, below the top bar', ready.stage.w === 1024 && ready.stage.h > 300 && ready.stage.y > 0, JSON.stringify(ready.stage));
    check('Ready: scrollWidth 1024', ready.scrollWidth === 1024, String(ready.scrollWidth));
    check('Ready: buttons >= 44x44', ready.small.length === 0, JSON.stringify(ready.buttons));
    check('Ready: no overlaps', ready.overlaps.length === 0, JSON.stringify(ready.overlaps));

    await click('gcStart');
    await sleep(300);
    const cd = await ev(`({ m: window.__t5.measure(44), n: document.getElementById('gcCountdown').textContent })`);
    check('Countdown: shows 3, scrollWidth 1024, no small buttons', cd.n === '3' && cd.m.scrollWidth === 1024 && cd.m.small.length === 0, JSON.stringify({ n: cd.n, sw: cd.m.scrollWidth }));
    const recMs = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'recording'`, 5000, 50);
    check('Recording starts after 3,2,1 (2800-3600 ms from START)', recMs >= 0 && 300 + recMs >= 2800 && 300 + recMs <= 3600, `${300 + recMs} ms after START`);
    await sleep(1200);
    const recording = await ev(`window.__t5.measure(44)`);
    console.log('  Recording:', JSON.stringify(recording));
    check('Recording: scrollWidth 1024', recording.scrollWidth === 1024, String(recording.scrollWidth));
    check('Recording: buttons >= 44x44', recording.small.length === 0, JSON.stringify(recording.buttons));
    check('Recording: prompt/dots/hand/REC/Cancel all measured, no overlaps',
      ['gcPrompt', 'gcDots', 'gcHand', 'gcRec', 'gcCancel'].every((k) => recording.measured.includes(k)) && recording.overlaps.length === 0,
      JSON.stringify({ measured: recording.measured, overlaps: recording.overlaps }));
    check('Recording: prompt text', /^(REST|SIGN [123] of 3)$/.test(recording.prompt), recording.prompt);
    check('MediaRecorder created once', (await ev('window.__t5.mr')) === 1);

    // Sample prompt text while recording to see the REST -> SIGN n of 3 progression.
    const prompts = new Set();
    const tRev = Date.now();
    while (Date.now() - tRev < 120000) {
      const s = await ev(`[document.getElementById('gcMode').getAttribute('data-state'), document.getElementById('gcPrompt').textContent, document.getElementById('gcHandText').textContent]`);
      if (s[0] !== 'recording') break;
      prompts.add(s[1] + ' / ' + s[2]);
      await sleep(150);
    }
    console.log('  prompts seen:', JSON.stringify([...prompts]));
    const review = await ev(`window.__t5.measure(56)`);
    console.log('  Review:', JSON.stringify(review));
    check('Review reached', review.state === 'review', `${Date.now() - tRev} ms of guidance`);
    check('Review: "3 signs found", Save enabled', review.msg === 'REVIEW · 3 signs found' && review.buttons.some((b) => b.id === 'gcSave' && !b.disabled), review.msg);
    check('Review: scrollWidth 1024', review.scrollWidth === 1024, String(review.scrollWidth));
    check('Review: buttons >= 56 tall and >= 44 wide', review.small.length === 0, JSON.stringify(review.buttons));
    check('Review: Save / Redo / Cancel visible', ['gcSave', 'gcRedo', 'gcCancel'].every((id) => review.buttons.some((b) => b.id === id)));
    check('Review: no overlaps', review.overlaps.length === 0, JSON.stringify(review.overlaps));
    const reviewVideo = await ev(`(() => { const v = document.getElementById('gcReview'); return { src: v.getAttribute('src'), loop: v.loop, muted: v.muted, paused: v.paused, transform: getComputedStyle(v).transform }; })()`);
    check('Review video: blob URL, muted, loop, playing, mirrored', /^blob:/.test(reviewVideo.src) && reviewVideo.loop && reviewVideo.muted && !reviewVideo.paused && reviewVideo.transform.startsWith('matrix(-1'), JSON.stringify(reviewVideo));

    // Force the 2nd save call to fail once (first attempt of rep 2).
    await ev(`window.__t5.shouldFail = (rep, n) => n === 2; localStorage.setItem('sining_kamay_labels_ESL', 'x'); true`);
    await click('gcSave');
    const procMs = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'processing' && /PROCESSING [1-9]/.test(document.getElementById('gcMsg').textContent)`, 20000, 50);
    const processing = await ev(`window.__t5.measure(56)`);
    console.log('  Processing:', JSON.stringify(processing));
    check('Processing: progress text', procMs >= 0 && /^PROCESSING \d+%$/.test(processing.msg || ''), processing.msg);
    check('Processing: scrollWidth 1024', processing.scrollWidth === 1024, String(processing.scrollWidth));
    check('Processing: Cancel visible, buttons >= 56 tall', processing.buttons.some((b) => b.id === 'gcCancel') && processing.small.length === 0, JSON.stringify(processing.buttons));
    check('Processing: no overlaps', processing.overlaps.length === 0, JSON.stringify(processing.overlaps));

    const errMs = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'error'`, 180000, 100);
    const saveErr = await ev(`window.__t5.measure(56)`);
    console.log('  Save-failure error:', JSON.stringify(saveErr));
    check('save #2 failure -> exact message', saveErr.msg === 'Saved 1 of 3. Sign 2 was not saved: forced test failure.', `${saveErr.msg} (${errMs} ms)`);
    check('save failure: Retry save + Cancel visible, >= 56 tall, scrollWidth 1024',
      saveErr.buttons.some((b) => b.id === 'gcRetrySave') && saveErr.buttons.some((b) => b.id === 'gcCancel') && saveErr.small.length === 0 && saveErr.scrollWidth === 1024,
      JSON.stringify(saveErr.buttons));
    check('save failure: no overlaps', saveErr.overlaps.length === 0, JSON.stringify(saveErr.overlaps));
    const saveErrBottom = await ev(`[...document.querySelectorAll('#gcActions button')].filter((b) => !b.hidden).map((b) => b.id).join(',')`);
    check('save failure: bottom bar is Retry save only (Cancel only top-right)', saveErrBottom === 'gcRetrySave', saveErrBottom);

    await ev(`window.__t5.shouldFail = null; true`);
    await click('gcRetrySave');
    const doneMs = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'closed'`, 60000, 100);
    check('Retry save -> all saved, overlay closed', doneMs >= 0, `${doneMs} ms`);
    await sleep(200);
    const done = await ev(`({ toast: document.getElementById('sk-toast').textContent, line: document.getElementById('sampleCountLine').textContent,
      btn: document.getElementById('startGestureDataBtn').textContent, calls: window.__t5.saveCalls, bodies: window.__t5.bodies.filter(b => /save_gesture/.test(b.url)),
      line2: window.__t5.line(), savedFrames: window.__t5.savedFrames, reloads: window.__t5.reloads, removeModel: window.__t5.removeModel,
      labelsKey: localStorage.getItem('sining_kamay_labels_ESL'),
      states: window.__t5.states, reviewSrc: document.getElementById('gcReview').getAttribute('src'), liveSrc: !!document.getElementById('gcLive').srcObject })`);
    console.log('  saveCalls:', JSON.stringify(done.calls));
    console.log('  state log:', JSON.stringify(done.states));
    check('Done toast', done.toast === `3 samples saved for “${LABEL}”.`, done.toast);
    check('sample line: 3 samples, frames === sum of the 3 saved samples, Train AI note',
      done.line2.samples === 3 && done.line2.frames === done.savedFrames && /Run Train AI/.test(done.line), `${done.line} (saved frames sum ${done.savedFrames})`);
    check('Done: caches invalidated once, reloadDataset once',
      done.reloads === 1 && JSON.stringify(done.removeModel) === '["indexeddb://sining-kamay-model-ESL"]' && done.labelsKey === null,
      JSON.stringify({ reloads: done.reloads, removeModel: done.removeModel, labelsKey: done.labelsKey }));
    check('save calls: rep 1, rep 2 (failed), rep 2, rep 3; no video args',
      JSON.stringify(done.calls.map((c) => c.repIndex)) === '[1,2,2,3]' && done.calls.every((c) => c.vb === null && c.vp === null), JSON.stringify(done.calls.map((c) => c.repIndex)));
    const posts = done.bodies;
    check('3 POSTs sent, none with video, all formatVersion 3 / source video-live',
      posts.length === 3 && posts.every((b) => !b.hasVideo && b.formatVersion === 3 && b.source === 'video-live'), JSON.stringify(posts));
    const savingEntries = done.states.filter((s) => s.startsWith('saving') || s.startsWith('finishing'));
    check('Cancel hidden during every saving/finishing state', savingEntries.length > 0 && savingEntries.every((s) => s.endsWith('cancel-hidden')), JSON.stringify(savingEntries));
    check('discard: review src cleared, live srcObject released', done.reviewSrc === null && !done.liveSrc, JSON.stringify({ reviewSrc: done.reviewSrc, liveSrc: done.liveSrc }));

    console.log('--- run 2: camera-stopped error state ---');
    await click('startGestureDataBtn');
    await sleep(500);
    await click('gcStart');
    await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'recording'`, 6000, 50);
    await sleep(800);
    await ev(`document.getElementById('videoFeed').srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended')); true`);
    await sleep(300);
    const camErr = await ev(`window.__t5.measure(56)`);
    console.log('  Camera-stopped error:', JSON.stringify(camErr));
    check('camera-stopped: exact message', camErr.msg === 'The camera stopped. Please try again.', camErr.msg);
    check('camera-stopped: Redo + Cancel, >= 56 tall, scrollWidth 1024, no overlaps',
      camErr.buttons.some((b) => b.id === 'gcRedo') && camErr.buttons.some((b) => b.id === 'gcCancel') && camErr.small.length === 0 && camErr.scrollWidth === 1024 && camErr.overlaps.length === 0,
      JSON.stringify(camErr.buttons));
    const camErrBottom = await ev(`[...document.querySelectorAll('#gcActions button')].filter((b) => !b.hidden).map((b) => b.id).join(',')`);
    check('camera-stopped: bottom bar is Redo only (Cancel only top-right)', camErrBottom === 'gcRedo', camErrBottom);
    await click('gcRedo');
    check('Redo -> Ready', (await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'ready'`, 60000, 50)) >= 0);
    await click('gcCancel');
    await sleep(200);
    check('Cancel -> closed', (await state()) === 'closed');

    console.log('--- run 2b: hand-tracking watchdog (live loop paused when recording starts) ---');
    {
      const posts0 = await ev(`window.__t5.bodies.length`);
      await click('startGestureDataBtn');
      await sleep(500);
      await click('gcStart');
      await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'recording'`, 6000, 20);
      await ev(`GestureDataRecorder.pauseHandLoop(); true`);
      const t0 = Date.now();
      const wdMs = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'error'`, 10000, 50);
      const elapsed = Date.now() - t0;
      const wd = await ev(`window.__t5.measure(56)`);
      console.log('  Watchdog error:', JSON.stringify(wd));
      check('watchdog: exact error within 5-7 s of pausing the live loop',
        wdMs >= 0 && wd.msg === 'Hand tracking is not ready. Please try again.' && elapsed >= 4500 && elapsed <= 7000, `${wd.msg} after ${elapsed} ms`);
      check('watchdog: Redo + Cancel, >= 56 tall, scrollWidth 1024, no overlaps',
        wd.buttons.some((b) => b.id === 'gcRedo') && wd.buttons.some((b) => b.id === 'gcCancel') && wd.small.length === 0 && wd.scrollWidth === 1024 && wd.overlaps.length === 0,
        JSON.stringify(wd.buttons));
      check('watchdog: no request sent', (await ev(`window.__t5.bodies.length`)) === posts0);
      // Redo goes back through "Starting camera", which resumes the live loop the test paused, so
      // hand results flow again and Ready is reached without the test resuming anything.
      await click('gcRedo');
      check('watchdog: Redo -> Ready (the app resumed the live loop)', (await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'ready'`, 60000, 50)) >= 0);
      const hr0 = await ev(`window.__t5.handResults`);
      await sleep(1500);
      const hr1 = await ev(`window.__t5.handResults`);
      check('watchdog: live loop resumed and results flow again', hr1 > hr0, `${hr0} -> ${hr1}`);
      await click('gcCancel');
      await sleep(200);
      check('watchdog: Cancel -> closed', (await state()) === 'closed');
    }

    console.log('--- run 3: Cancel during Processing ---');
    const postsBefore = await ev(`window.__t5.bodies.length`);
    await click('startGestureDataBtn');
    await sleep(500);
    await click('gcStart');
    const rev3 = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'review'`, 120000, 150);
    check('run 3 reached Review', rev3 >= 0, `${rev3} ms`);
    await click('gcSave');
    await waitFor(`/PROCESSING [1-9]/.test(document.getElementById('gcMsg').textContent)`, 20000, 50);
    await click('gcCancel');
    await sleep(300);
    const hrBefore = await ev(`window.__t5.handResults`);
    await sleep(1500);
    const after3 = await ev(`({ state: document.getElementById('gcMode').getAttribute('data-state'), posts: window.__t5.bodies.length, hr: window.__t5.handResults })`);
    check('Cancel during Processing: closed, no save request, live loop resumed',
      after3.state === 'closed' && after3.posts === postsBefore && after3.hr > hrBefore, JSON.stringify({ ...after3, hrBefore }));

    console.log('--- run 4: hard save failure on saves 2 and 3, then Cancel ---');
    await ev(`window.__t5.shouldFail = (rep) => rep >= 2; window.__t5.failMessage = 'forced test failure.'; localStorage.setItem('sining_kamay_labels_ESL', 'x'); true`);
    const before4 = await ev(`({ reloads: window.__t5.reloads, removes: window.__t5.removeModel.length, calls: window.__t5.saveCalls.length })`);
    await click('startGestureDataBtn');
    await sleep(500);
    await click('gcStart');
    const rev4 = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'review'`, 120000, 150);
    check('run 4 reached Review', rev4 >= 0, `${rev4} ms`);
    await click('gcSave');
    await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'error'`, 180000, 100);
    const err4 = await ev(`window.__t5.measure(56)`);
    check('hard failure message (no double period)', err4.msg === 'Saved 1 of 3. Sign 2 was not saved: forced test failure.', err4.msg);
    await click('gcCancel');
    const closed4 = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'closed'`, 30000, 100);
    await sleep(200);
    const after4 = await ev(`({ toast: document.getElementById('sk-toast').textContent, line: window.__t5.line(), savedFrames: window.__t5.savedFrames,
      reloads: window.__t5.reloads, removes: window.__t5.removeModel.length, labelsKey: localStorage.getItem('sining_kamay_labels_ESL'),
      calls: window.__t5.saveCalls.slice(${before4.calls}).map(c => c.repIndex), states: window.__t5.states.slice(-3) })`);
    console.log('  after Cancel:', JSON.stringify(after4));
    check('Cancel after hard failure closes', closed4 >= 0, `${closed4} ms`);
    check('Cancel after hard failure: toast "1 of 3 samples saved"', after4.toast === `1 of 3 samples saved for “${LABEL}”.`, after4.toast);
    check('Cancel after hard failure: caches invalidated + reloadDataset ran once',
      after4.reloads === before4.reloads + 1 && after4.removes === before4.removes + 1 && after4.labelsKey === null,
      JSON.stringify({ before4, reloads: after4.reloads, removes: after4.removes, labelsKey: after4.labelsKey }));
    check('Cancel after hard failure: sample line 4 samples, frames === sum of all saved samples',
      after4.line.samples === 4 && after4.line.frames === after4.savedFrames, `${after4.line.text} (saved frames sum ${after4.savedFrames})`);
    check('run 4 save calls: rep 1 then rep 2 (failed), rep 3 never attempted', JSON.stringify(after4.calls) === '[1,2]', JSON.stringify(after4.calls));
    await ev(`window.__t5.shouldFail = null; true`);

    console.log('--- run 5: real track end during Recording ---');
    await click('startGestureDataBtn');
    await sleep(500);
    await click('gcStart');
    await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'recording'`, 6000, 50);
    await sleep(1500);
    await ev(`document.getElementById('videoFeed').srcObject.getVideoTracks()[0].stop(); true`);
    const err5ms = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') !== 'recording'`, 10000, 50);
    const err5 = await ev(`window.__t5.measure(56)`);
    check('real track stop -> camera-stopped error, never Review', err5.state === 'error' && err5.msg === 'The camera stopped. Please try again.', `${err5.state} / ${err5.msg} (${err5ms} ms)`);
    await click('gcCancel');
    await sleep(200);
    await click('startGestureDataBtn');
    const restartMs = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'ready'`, 60000, 100);
    check('Record with a stopped camera -> the overlay starts the camera again and reaches Ready', restartMs >= 0, `${restartMs} ms`);
    await click('gcCancel');
    await sleep(300);
    check('Cancel -> the restarted (overlay-owned) camera is stopped', await ev(`!document.getElementById('videoFeed').srcObject`));
  } finally {
    try {
      console.log('--- cleanup ---');
      const r = await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_gesture', label: LABEL }) });
      const j = await r.json();
      check('test label deleted', j.success === true, j.message);
      const ds = await (await fetch(SAVE_URL + '?no_sync=1')).json();
      check('test label absent from dataset', !(ds.gestures && ds.gestures[LABEL]));
      const assetsAfter = readdirSync(path.join(REPO_ROOT, 'assets', 'signs', 'en')).filter((f) => f.startsWith('zz'));
      check('nothing written under assets/signs/en', JSON.stringify(assetsAfter) === JSON.stringify(assetsBefore), JSON.stringify(assetsAfter));
    } catch (e) {
      failures++;
      console.log('  FAIL  cleanup: ' + e.message);
    }

    if (chrome) {
      try {
        console.log('--- Train AI (Step 2) ---');
        await chrome.evaluate(`window.reloadDataset().then(() => true)`);
        await chrome.evaluate(`trClickPill(2); showStepContent(2); document.getElementById('trainBtn').click(); true`);
        const t0 = Date.now();
        let label = '';
        while (Date.now() - t0 < 300000) {
          label = await chrome.evaluate(`document.getElementById('epochLabel').textContent`);
          if (/^(Complete!|Up to date)/.test(label)) break;
          await sleep(500);
        }
        check('Train AI completes', /^(Complete!|Up to date)/.test(label), `${label} (${Date.now() - t0} ms)`);
      } catch (e) {
        failures++;
        console.log('  FAIL  Train AI: ' + e.message);
      }
      const errors = chrome.getConsoleErrors();
      const exceptions = chrome.getExceptions();
      check('0 console errors', errors.length === 0, JSON.stringify(errors).slice(0, 800));
      check('0 uncaught exceptions', exceptions.length === 0, JSON.stringify(exceptions).slice(0, 800));
      await chrome.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
