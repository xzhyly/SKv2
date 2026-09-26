// Task 6 (video-based gesture capture): formal end-to-end proof with a fake camera fed from a
// signing video. Exercises the whole gesture-training.html Step 1 flow built by Tasks 1-5 -
// Record 3 samples -> START -> 3-2-1 -> REST/SIGN n of 3 guidance driven by real hand-presence
// detection on a pre-recorded clip -> auto-stop -> Review "3 signs found" -> Save -> Processing
// (MediaPipe over the recorded video, via extractVideoLandmarks) -> 3 sequential v3-format saves
// -> overlay closes - then Redo, Cancel (at Review and during Processing), Train AI mixing the
// new label with the existing 120-gesture dataset, and Step 3 Predict, all under the fake
// camera. Changes no product code; this file and README.md are the only things committed.
//
// Fake-camera file: built once with the repo-root ffmpeg.exe into a temp folder under
// tests/video-capture/ (deleted at the end, nothing under assets/ is touched): 320x240, 30fps,
// .y4m - 2s black, assets/signs/en/hello.webm letterboxed, 1.5s black, the clip, 1.5s black, the
// clip, 3s black (three reps for the segmenter to find).
//
// DB verification uses the live sining_kamay_db via php/connect.php (tests/categorization/db.mjs
// pattern), never a mock. Network-level proof that no request ever carries video_base64/
// video_path uses the CDP Network domain directly (cdp.mjs's enableNetwork()/getNetworkRequests()
// added for this task), independent of the in-page fetch wrapper used for readability elsewhere.
//
// Run (Apache + MariaDB up): node tests/video-capture/e2e.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './cdp.mjs';
import { query } from '../categorization/db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FFMPEG = path.join(REPO_ROOT, 'ffmpeg.exe');
const CLIP = path.join(REPO_ROOT, 'assets', 'signs', 'en', 'hello.webm');
const PAGE_URL = 'http://localhost/SKR/gesture-training.html';
const SAVE_URL = 'http://localhost/SKR/php/api/save_gesture.php';
const LABEL = 'zz_video_capture_e2e';
const LABEL_DIR = path.join(REPO_ROOT, 'saved_gestures', LABEL);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}${detail ? ' - ' + detail : ''}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`);
  }
}

// Task 6's exact recipe: 2s black, clip letterboxed, 1.5s black, clip, 1.5s black, clip, 3s black.
function buildY4m(dir) {
  const out = path.join(dir, 'fake-cam.y4m');
  const lb =
    'scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p';
  const black = (d) => `color=c=black:s=320x240:r=30:d=${d},format=yuv420p,setsar=1`;
  const filter = [
    `${black(2)}[b0]`,
    `[0:v]${lb},split=3[c1][c2][c3]`,
    `${black(1.5)}[b1]`,
    `${black(1.5)}[b2]`,
    `${black(3)}[b3]`,
    '[b0][c1][b1][c2][b2][c3][b3]concat=n=7:v=1:a=0[out]',
  ].join(';');
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', CLIP,
    '-filter_complex', filter,
    '-map', '[out]',
    '-pix_fmt', 'yuv420p',
    out,
  ]);
  return out;
}

function listSignsDir() {
  const dir = path.join(REPO_ROOT, 'assets', 'signs');
  const out = [];
  const walk = (d, rel) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = statSync(p);
      const r = rel ? `${rel}/${name}` : name;
      if (st.isDirectory()) walk(p, r);
      else out.push({ path: r, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  walk(dir, '');
  return out;
}

function listLabelDir() {
  if (!existsSync(LABEL_DIR)) return null;
  return readdirSync(LABEL_DIR)
    .sort()
    .map((f) => ({ name: f, size: statSync(path.join(LABEL_DIR, f)).size }));
}

// In-page helpers, installed once after navigation. Kept intentionally close to
// capture-ui-check.mjs's PAGE_HELPERS (same DOM/state contract) but adds: per-transition
// timestamps (for the processing/recording duration measurements) and a prompt+hand-presence log
// with timestamps for the segmenter-event narrative the brief asks for.
const PAGE_HELPERS = `
(function () {
  window.__e2e = { mr: 0, prompts: 0, bodies: [], saveCalls: [], states: [], guidance: [], t0: Date.now() };
  const OrigMR = window.MediaRecorder;
  window.MediaRecorder = function (s, o) { window.__e2e.mr++; return new OrigMR(s, o); };
  window.MediaRecorder.prototype = OrigMR.prototype;
  window.MediaRecorder.isTypeSupported = OrigMR.isTypeSupported.bind(OrigMR);
  window.prompt = function () { window.__e2e.prompts++; return null; };
  const origFetch = window.fetch;
  window.fetch = function (url, init) {
    if (init && init.method === 'POST' && typeof init.body === 'string') {
      try {
        const b = JSON.parse(init.body);
        window.__e2e.bodies.push({ url: String(url), keys: Object.keys(b), formatVersion: b.formatVersion,
          repIndex: b.repIndex, frames: Array.isArray(b.frames) ? b.frames.length : null,
          hasVideo: 'video_base64' in b || 'video_path' in b, source: b.source,
          videoWidth: b.videoWidth, videoHeight: b.videoHeight, fps: b.fps, input: b.input });
      } catch (e) {}
    }
    return origFetch.apply(this, arguments);
  };
  const root = document.getElementById('gcMode');
  const cancel = document.getElementById('gcCancel');
  const log = () => {
    const st = root.getAttribute('data-state');
    const last = window.__e2e.states[window.__e2e.states.length - 1];
    const entry = { t: Date.now() - window.__e2e.t0, state: st, cancelHidden: cancel.hidden };
    if (!last || last.state !== st || last.cancelHidden !== entry.cancelHidden) window.__e2e.states.push(entry);
  };
  new MutationObserver(log).observe(root, { attributes: true, subtree: true, attributeFilter: ['data-state', 'hidden'] });
  window.__e2e.handResults = 0;
  GestureDataRecorder.onHandResults(() => { window.__e2e.handResults++; });
  // Prompt + hand-presence narrative with timestamps, sampled on a light poll from Node (see
  // pollGuidance below) rather than per-frame, to keep the in-page log small.
  window.__e2e.measure = function (minBtnH) {
    const vis = (e) => e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
      && !e.closest('[hidden]');
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
    const buttons = Array.from(document.querySelectorAll('#gcMode button')).filter(vis)
      .map((b) => ({ id: b.id, text: b.textContent.trim(), disabled: b.disabled, ...r(b) }));
    const small = buttons.filter((b) => b.w < 44 || b.h < Math.max(44, minBtnH || 0));
    return {
      state: document.getElementById('gcMode').getAttribute('data-state'),
      scrollWidth: document.documentElement.scrollWidth,
      buttons, small,
      prompt: vis(document.getElementById('gcPrompt')) ? document.getElementById('gcPrompt').textContent : null,
      msg: vis(document.getElementById('gcMsg')) ? document.getElementById('gcMsg').textContent : null,
      hand: vis(document.getElementById('gcHand')) ? document.getElementById('gcHandText').textContent : null,
      chip: document.getElementById('gcChip').textContent,
    };
  };
  window.__e2e.savedFrames = 0;
  const origSave = GestureDataRecorder.saveGestureSample;
  GestureDataRecorder.saveGestureSample = function (label, frames, lang, vb, vp, cat, meta) {
    window.__e2e.saveCalls.push({ repIndex: meta && meta.repIndex, frames: frames.length, vb, vp });
    return origSave.apply(this, arguments).then((res) => { window.__e2e.savedFrames += frames.length; return res; });
  };
})();
true;
`;

async function main() {
  const tmpDir = mkdtempSync(path.join(__dirname, '.tmp-e2e-'));
  let chrome = null;
  const signsBefore = listSignsDir();
  const labelDirBefore = listLabelDir();
  check('label sample folder absent before the run', labelDirBefore === null, JSON.stringify(labelDirBefore));

  try {
    console.log('--- building fake-camera file ---');
    const y4m = buildY4m(tmpDir);
    const y4mSize = statSync(y4m).size;
    console.log(`  fake camera file: ${y4mSize} bytes`);

    chrome = await launchChrome({
      extraArgs: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-video-capture=${y4m}`,
      ],
    });
    await chrome.enableNetwork();
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
    const click = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click(); true`);
    const setLabel = (v) =>
      ev(
        `(() => { const i = document.getElementById('gestureLabelInput'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
      );

    await chrome.navigate(PAGE_URL);
    await waitFor(
      `!!(window.GestureDataRecorder && window.GestureCaptureUI && window.GestureCaptureCore && window.VideoLandmarks && typeof trVerifyPin === 'function')`,
      15000
    );
    await ev(`pinInput = '2026'; trVerifyPin(); true`);
    await sleep(400);
    await ev(`showStepContent(1); true`);
    await sleep(800);
    await ev(PAGE_HELPERS);

    console.log('--- camera + label ---');
    await click('enableCamBtn');
    const camMs = await waitFor(`window.__e2e.handResults > 5`, 60000, 200);
    check('camera enabled, live hand results flowing', camMs >= 0, `${camMs} ms`);
    await sleep(3200); // let the "Camera started" toast expire before the G-key check

    await setLabel(LABEL);
    await ev(
      `document.querySelector('input[name="gestureDatasetType"][value="ESL"]').checked = true;
       document.querySelector('input[name="gestureCategory"][value="word"]').checked = true; true`
    );

    console.log('--- G key does nothing ---');
    await ev(`document.activeElement && document.activeElement.blur(); true`);
    for (const key of ['g', 'G']) {
      const code = 'KeyG';
      await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key, windowsVirtualKeyCode: 71, modifiers: key === 'G' ? 8 : 0 });
      await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: 71, modifiers: key === 'G' ? 8 : 0 });
    }
    await sleep(1200);
    const g = await ev(`({ state: document.getElementById('gcMode').getAttribute('data-state'), mr: window.__e2e.mr,
      pressG: /Press\\s*"?G/i.test(document.body.innerText + ' ' + document.getElementById('sk-toast').textContent) })`);
    check('pressing g/G does nothing (no overlay opened)', g.state === 'closed' && g.mr === 0);
    check('no "Press G" toast/text anywhere', !g.pressG);

    console.log('=== RUN 1: full record -> save flow ===');
    await click('startGestureDataBtn');
    await sleep(500);
    check('Ready reached', (await state()) === 'ready');
    const chip = await ev(`document.getElementById('gcChip').textContent`);
    check('chip shows label/ESL/Word', chip === `${LABEL} · ESL · Word`, chip);

    await click('gcStart');
    const recMs = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'recording'`, 6000, 50);
    check('Countdown -> Recording within ~3s', recMs >= 0, `${recMs} ms`);

    // Poll the prompt/hand text with timestamps until Review, logging the segmenter's guidance
    // narrative as it advances by hand presence, exactly as a live recording would.
    const narrative = [];
    const tRecStart = Date.now();
    while (Date.now() - tRecStart < 60000) {
      const s = await ev(`({ st: document.getElementById('gcMode').getAttribute('data-state'), p: document.getElementById('gcPrompt').textContent, h: document.getElementById('gcHandText') ? document.getElementById('gcHandText').textContent : null })`);
      if (s.st !== 'recording') break;
      const last = narrative[narrative.length - 1];
      const entry = `${s.p} / ${s.h}`;
      if (!last || last.entry !== entry) narrative.push({ tMs: Date.now() - tRecStart, entry });
      await sleep(120);
    }
    const recordingDurationMs = Date.now() - tRecStart;
    console.log('  prompt/hand narrative (timestamps ms from recording start):');
    narrative.forEach((n) => console.log(`    +${n.tMs}ms  ${n.entry}`));
    console.log(`  recording auto-stopped after ${recordingDurationMs} ms`);

    const review = await ev(`window.__e2e.measure(56)`);
    check('Review reached with "3 signs found"', review.state === 'review' && review.msg === '3 signs found', JSON.stringify(review.msg));

    // Save -> Processing -> 3 saves -> closed. Measure processing wall time from the
    // states log (covers extraction + segmentation, which run synchronously back to back).
    const postsBefore0 = await ev(`window.__e2e.bodies.length`);
    await click('gcSave');
    await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'processing'`, 5000, 30);
    const closedMs = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'closed'`, 60000, 50);
    check('Save -> Processing -> 3 saves -> overlay closes', closedMs >= 0, `${closedMs} ms total`);

    const run1 = await ev(`({ states: window.__e2e.states, bodies: window.__e2e.bodies, saveCalls: window.__e2e.saveCalls,
      toast: document.getElementById('sk-toast').textContent, savedFrames: window.__e2e.savedFrames })`);
    const procEntry = run1.states.find((s) => s.state === 'processing');
    const savingEntry = run1.states.find((s) => s.state === 'saving');
    const processingMs = procEntry && savingEntry ? savingEntry.t - procEntry.t : null;
    console.log(`  processing time (extraction + segmentation) for this recording: ${processingMs} ms`);
    check('processing time measured', Number.isFinite(processingMs), `${processingMs} ms`);
    check('Done toast for 3 samples', run1.toast === `3 samples saved for “${LABEL}”.`, run1.toast);

    const newPosts = run1.bodies.slice(postsBefore0);
    check('exactly 3 save POSTs sent', newPosts.length === 3, JSON.stringify(newPosts.map((p) => p.repIndex)));
    check('each save: formatVersion 3, source video-live, fps 15, videoWidth/Height + input present, no video fields',
      newPosts.every((p) => p.formatVersion === 3 && p.source === 'video-live' && p.fps === 15 &&
        Number.isFinite(p.videoWidth) && Number.isFinite(p.videoHeight) && p.input && !p.hasVideo),
      JSON.stringify(newPosts));
    check('repIndex 1,2,3 in order', JSON.stringify(newPosts.map((p) => p.repIndex)) === '[1,2,3]', JSON.stringify(newPosts.map((p) => p.repIndex)));
    console.log('  per-rep frame counts (as sent):', JSON.stringify(newPosts.map((p) => p.frames)));

    console.log('--- CDP Network-level proof: no request ever carried video_base64/video_path ---');
    const netReqs = chrome.getNetworkRequests();
    const saveReqs = netReqs.filter((r) => /save_gesture\.php/.test(r.url) && r.method === 'POST');
    const withVideoField = [];
    for (const r of saveReqs) {
      let body = r.postData;
      if (body === null && r.hasPostData) {
        try { body = await chrome.getRequestPostData(r.requestId); } catch (e) { body = null; }
      }
      if (body && /video_base64|video_path/.test(body)) withVideoField.push(r.url);
    }
    check('CDP-level: 0 of ' + saveReqs.length + ' save requests carry video_base64/video_path', withVideoField.length === 0, JSON.stringify(withVideoField));
    check('CDP-level: 0 of ' + netReqs.length + ' requests in the whole run carry video_base64/video_path',
      netReqs.every((r) => !(r.postData && /video_base64|video_path/.test(r.postData))));

    console.log('--- saved_gestures files on disk ---');
    const files = existsSync(LABEL_DIR) ? readdirSync(LABEL_DIR).filter((f) => /^sample_.*\.json$/.test(f)) : [];
    check('exactly 3 sample_*.json files saved', files.length === 3, JSON.stringify(files));
    const parsed = files.map((f) => {
      const full = path.join(LABEL_DIR, f);
      const size = statSync(full).size;
      const json = JSON.parse(readFileSync(full, 'utf8'));
      return { file: f, size, json };
    });
    parsed.sort((a, b) => a.json.repIndex - b.json.repIndex);
    for (const { file, size, json } of parsed) {
      const frames = json.frames || [];
      const decimalPlaces = (v) => {
        const s = String(v);
        if (/e/i.test(s)) return 99;
        const dot = s.indexOf('.');
        return dot < 0 ? 0 : s.length - dot - 1;
      };
      const roundedOk = frames.every((fr) =>
        (fr.hands || []).every((h) =>
          (h.landmarks || []).every((pt) => [pt.x, pt.y, pt.z].every((v) => decimalPlaces(v) <= 4)) && decimalPlaces(h.score) <= 3
        )
      );
      console.log(`  ${file}: repIndex=${json.repIndex} frames=${frames.length} size=${size} bytes`);
      check(`${file}: formatVersion 3 / source video-live / fps 15`, json.formatVersion === 3 && json.source === 'video-live' && json.fps === 15);
      check(`${file}: videoWidth/Height + input present`, Number.isFinite(json.videoWidth) && Number.isFinite(json.videoHeight) && json.input && Number.isFinite(json.input.width));
      check(`${file}: coordinates rounded (x/y/z to 4dp, score to 3dp)`, roundedOk);
    }
    check('repIndex values are exactly 1, 2, 3', JSON.stringify(parsed.map((p) => p.json.repIndex)) === '[1,2,3]', JSON.stringify(parsed.map((p) => p.json.repIndex)));
    if (parsed.length) {
      console.log(`  size of one saved sample on disk: ${parsed[0].size} bytes (repIndex ${parsed[0].json.repIndex}, ${parsed[0].json.frames.length} frames)`);
    }

    console.log('--- gesture_recordings DB rows ---');
    const rows = query(
      `SELECT gr.id, gr.frame_count, gr.sample_path FROM gesture_recordings gr
       JOIN gestures g ON gr.gesture_id = g.id
       WHERE g.label = '${LABEL}' AND g.sign_language = 'ESL'
       ORDER BY gr.id`
    );
    console.log('  rows:', JSON.stringify(rows));
    check('3 gesture_recordings rows for the label', rows.length === 3, JSON.stringify(rows));

    console.log('--- assets/signs/ listing unchanged after run 1 ---');
    const signsAfterRun1 = listSignsDir();
    check('assets/signs/ listing identical before/after run 1', JSON.stringify(signsAfterRun1) === JSON.stringify(signsBefore));

    console.log('=== RUN 2: Redo path ===');
    const postsBeforeRun2 = (await ev(`window.__e2e.bodies.length`));
    await click('startGestureDataBtn');
    await sleep(500);
    await click('gcStart');
    const rev2 = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'review'`, 60000, 100);
    check('run 2 reached Review', rev2 >= 0, `${rev2} ms`);
    await click('gcRedo');
    await sleep(300);
    const afterRedo = await ev(`({ state: document.getElementById('gcMode').getAttribute('data-state'), posts: window.__e2e.bodies.length })`);
    check('Redo -> back to Ready, no request sent', afterRedo.state === 'ready' && afterRedo.posts === postsBeforeRun2, JSON.stringify(afterRedo));
    await click('gcCancel');
    await sleep(200);
    check('run 2: Cancel from Ready closes with no request', (await state()) === 'closed');

    console.log('=== RUN 3: Cancel path (before/during recording) ===');
    const labelDirBeforeRun3 = listLabelDir();
    const postsBeforeRun3 = await ev(`window.__e2e.bodies.length`);
    await click('startGestureDataBtn');
    await sleep(400);
    await click('gcCancel');
    await sleep(200);
    const afterCancelReady = await ev(`({ state: document.getElementById('gcMode').getAttribute('data-state'), posts: window.__e2e.bodies.length })`);
    check('Cancel at Ready: overlay closed, no request sent', afterCancelReady.state === 'closed' && afterCancelReady.posts === postsBeforeRun3, JSON.stringify(afterCancelReady));

    await click('startGestureDataBtn');
    await sleep(400);
    await click('gcStart');
    await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'recording'`, 6000, 50);
    await sleep(700);
    await click('gcCancel');
    await sleep(300);
    const afterCancelRec = await ev(`({ state: document.getElementById('gcMode').getAttribute('data-state'), posts: window.__e2e.bodies.length })`);
    check('Cancel during Recording: overlay closed, no request sent', afterCancelRec.state === 'closed' && afterCancelRec.posts === postsBeforeRun3, JSON.stringify(afterCancelRec));

    const labelDirAfterRun3 = listLabelDir();
    check('label folder listing identical (no new files) after Redo/Cancel runs',
      JSON.stringify(labelDirAfterRun3) === JSON.stringify(labelDirBeforeRun3), JSON.stringify({ before: labelDirBeforeRun3, after: labelDirAfterRun3 }));

    console.log('=== RUN 4: Cancel during Processing ===');
    const postsBeforeRun4 = await ev(`window.__e2e.bodies.length`);
    const labelDirBeforeRun4 = listLabelDir();
    await click('startGestureDataBtn');
    await sleep(400);
    await click('gcStart');
    const rev4 = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'review'`, 60000, 100);
    check('run 4 reached Review', rev4 >= 0, `${rev4} ms`);
    await click('gcSave');
    await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'processing'`, 5000, 30);
    await sleep(150);
    await click('gcCancel');
    const closed4 = await waitFor(`document.getElementById('gcMode').getAttribute('data-state') === 'closed'`, 30000, 50);
    check('Cancel during Processing: overlay closes', closed4 >= 0, `${closed4} ms`);
    await sleep(300);
    const after4 = await ev(`({ posts: window.__e2e.bodies.length, hr: window.__e2e.handResults })`);
    check('Cancel during Processing: no save request sent', after4.posts === postsBeforeRun4, JSON.stringify(after4));
    const labelDirAfterRun4 = listLabelDir();
    check('label folder listing identical after Cancel-during-Processing', JSON.stringify(labelDirAfterRun4) === JSON.stringify(labelDirBeforeRun4));
    const hrBefore4 = await ev(`window.__e2e.handResults`);
    await sleep(1500);
    const hrAfter4 = await ev(`window.__e2e.handResults`);
    check('live loop resumed after Cancel during Processing', hrAfter4 > hrBefore4, `${hrBefore4} -> ${hrAfter4}`);

    const signsAfterAllRuns = listSignsDir();
    check('assets/signs/ listing identical after Redo/Cancel runs', JSON.stringify(signsAfterAllRuns) === JSON.stringify(signsBefore));

    console.log('=== Train AI (Step 2): old samples still load and mix with the new label ===');
    await ev(`window.reloadDataset().then(() => true)`);
    await ev(`trClickPill(2); showStepContent(2); document.getElementById('trainBtn').click(); true`);
    let epochLabel = '';
    const t0Train = Date.now();
    while (Date.now() - t0Train < 300000) {
      epochLabel = await ev(`document.getElementById('epochLabel').textContent`);
      if (/^(Complete!|Up to date)/.test(epochLabel)) break;
      await sleep(500);
    }
    check('Train AI completes', /^(Complete!|Up to date)/.test(epochLabel), `${epochLabel} (${Date.now() - t0Train} ms)`);
    const trainRows = await ev(`(typeof trainData !== 'undefined' && trainData['${LABEL}']) ? trainData['${LABEL}'].length : -1`);
    console.log(`  trainData['${LABEL}'].length = ${trainRows}`);
    check('trainData includes the new label, <= 90 rows (3 x 30 max)', trainRows > 0 && trainRows <= 90, `${trainRows} rows`);

    console.log('=== Predict (Step 3), fake camera, ~5s, no errors ===');
    await ev(`trGoToStep(3); showStepContent(3); true`);
    await sleep(600);
    const predBefore = await ev(`document.getElementById('predLabel') ? document.getElementById('predLabel').textContent : null`);
    await sleep(5000);
    const predAfter = await ev(`({ predLabel: document.getElementById('predLabel') ? document.getElementById('predLabel').textContent : null,
      livePredResult: document.getElementById('livePredResult') ? document.getElementById('livePredResult').textContent : null })`);
    console.log(`  predLabel before: ${JSON.stringify(predBefore)}  after 5s: ${JSON.stringify(predAfter)}`);
    check('Predict ran for ~5s producing output (predLabel/livePredResult populated)',
      !!predAfter.predLabel && !!predAfter.livePredResult, JSON.stringify(predAfter));

    console.log('--- console errors / exceptions ---');
    const errors = chrome.getConsoleErrors();
    const exceptions = chrome.getExceptions();
    check('0 console errors (MediaPipe info/warning logs excluded - they are console.info/warn, not console.error)', errors.length === 0, JSON.stringify(errors).slice(0, 1000));
    check('0 uncaught exceptions', exceptions.length === 0, JSON.stringify(exceptions).slice(0, 1000));
  } finally {
    console.log('=== cleanup ===');
    try {
      const r = await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_gesture', label: LABEL }) });
      const j = await r.json();
      check('delete_gesture succeeded', j.success === true, j.message);
    } catch (e) {
      failures++;
      console.log('  FAIL  delete_gesture request: ' + e.message);
    }
    check('label folder gone from disk', !existsSync(LABEL_DIR), LABEL_DIR);
    const rowsAfter = query(
      `SELECT gr.id FROM gesture_recordings gr JOIN gestures g ON gr.gesture_id = g.id WHERE g.label = '${LABEL}' AND g.sign_language = 'ESL'`
    );
    check('gesture_recordings rows gone from DB', rowsAfter.length === 0, JSON.stringify(rowsAfter));
    const gestureRowAfter = query(`SELECT id FROM gestures WHERE label = '${LABEL}' AND sign_language = 'ESL'`);
    check('gestures row gone from DB', gestureRowAfter.length === 0, JSON.stringify(gestureRowAfter));

    const signsFinal = listSignsDir();
    check('assets/signs/ listing identical before/after the whole run', JSON.stringify(signsFinal) === JSON.stringify(signsBefore));

    if (chrome) {
      const errors = chrome.getConsoleErrors();
      const exceptions = chrome.getExceptions();
      console.log(`  final console error count: ${errors.length}, exception count: ${exceptions.length}`);
      await chrome.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
    console.log('  temp folder removed:', tmpDir);
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('CHECK CRASHED:', e);
  process.exitCode = 1;
});
