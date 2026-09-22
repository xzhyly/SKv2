# Gesture training — multi-sample recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recording several samples of one word obvious in Step 1 of `gesture-training.html`, and stop `save_gesture.php` re-running the ffmpeg transcode for samples that will not keep their video.

**Architecture:** Server: `save_gesture.php` decides, from data it already holds (the label's `sample_*.json` count and the on-disk `<label>.mp4`/`.webm`), whether a transcode is needed, and reports what it did in the response. Client: `gesture-training-ui.js` keeps a per-(sign set, label) sample tally fed by the response and by `renderSavedDataset()`, and renders it in Step 1. The post-save reload path (`reloadDataset()`) is changed to share one un-synced fetch between its two consumers instead of each running its own full synced fetch. Landmark saving, `trainModel()`, `mergeSavedGestureSamples()`, `knnPredict()` and `cosineSimilarity()` are not touched (Task 5 gives `mergeSavedGestureSamples`/`renderSavedDataset` an optional pre-fetched-data parameter; their own bodies and every no-arg call site keep today's behaviour).

**Tech Stack:** Vanilla JS (no build step), PHP 8 on XAMPP/Apache, MySQL/MariaDB, vendored `ffmpeg.exe`. Test tooling: Node ≥ 18 (`node:test`, no packages), `php-cgi.exe`, the Claude built-in browser.

## Spec and evidence

Spec: `docs/superpowers/specs/2026-09-22-gesture-training-multi-sample-design.md`. Decisions log: `docs/system/DECISIONS.md` (section "gesture-training multi-sample phase"). Every number below was measured on the dev machine (AMD Ryzen 5 2400G, 4C/8T, 3.6 GHz max) unless marked **Pi-only**; a dev number is a baseline, not the Pi's number.

## Global Constraints

*(Handed to every reviewer verbatim.)*

- The 4-step wizard (Add Data / Train AI / Predict / Translate) keeps its current shape and step order. No new step, no removed step.
- `trainModel()`, `mergeSavedGestureSamples()`, `knnPredict()`, `cosineSimilarity()` are not touched — this phase changes how samples get *in*, not how they're scored.
- Landmark data (the actual training signal) saves on every sample, every time, unchanged — only the video transcode is what gets skipped for samples 2+ of an existing label. Never skip saving landmark frames.
- `reports.html` and `gesture-training.html`'s sibling pages (`sign-to-text.html`, `talk.html`, etc.) are not touched by this phase.
- The fallback path (ffmpeg missing → raw `.webm` save, `save_gesture.php` ~line 543) keeps working — whatever transcode-skip logic is added must not assume ffmpeg always ran.
- Backwards compatible with existing saved gestures — a word saved before this phase shipped (already has a `<label>.mp4`) must be treated as "already has a video," not re-transcoded on its next new sample.
- Also standing (CLAUDE.md): offline only, no build step, no framework, 1024×600 is the screen to test against, PHP never touches the live translation path.
- Accuracy: every number reported is cited `file:line` or measured with the method stated. Never estimate.

## Findings that shape this plan (all verified, cited)

1. **k-NN pools frames, not samples.** `trainData[label]` is one 126-float vector per *frame*, from all takes of the label (`js/gesture-data.js:648-666`, `js/gesture-training-ui.js:372-378`). `knnPredict` scores a label as the mean of its top `min(5, N)` cosine similarities, taking `max(raw, mirrored)` per frame (`js/gesture-training-ui.js:301-312`). There is no per-take voting and no normalisation for pool size.
   - One take already fills K=5 (a live take has 1–30 frames: `FRAME_MIN=1`, capture stops at `FRAME_TARGET=30`, `gesture-data.js:2-4,453,467`; `FRAME_MAX=40` never triggers). Frames within one take are ~90 ms apart (`frameIntervalMs`, `gesture-data.js:20`), so its top-5 are near-duplicates.
   - **5 takes is the smallest count at which each of the 5 neighbours *can* come from a different take.** That is the code-derived reason for the soft target of 5. The spec's "8" has no basis in the code.
   - A larger pool raises the expected top-5 mean (order-statistic property), so a word with many more takes than the others is favoured. Direction follows from the code; **magnitude not measured.**
   - Existing data (measured, 210 sample files): 208 of 209 label folders have exactly 1 sample; frames/sample min 2, median 14, max 45.
2. **Later takes do reach the model, by an accident of implementation.** `trainModel()` only adds labels missing from the cached label list (`gesture-training-ui.js:493-522`), but `confirmAndSave` deletes `sining_kamay_labels_<lang>` after every save (`gesture-data.js:566`), so the next Train rebuilds every label from the reloaded `trainData`. That `localStorage.removeItem` is load-bearing for this phase and must stay. Consequence: after a save, Step 3 silently keeps using the *old in-memory* model until Train is pressed again (`trClickPill` gates only on `modelTrained`, `gesture-training-ui.js:932-935`), so Step 1 should say so.
3. **The `.mp4` the transcode writes is not what `talk.html` plays.** `js/sign-player.js:255,378,411` only probe `<label>.webm`. The only reader of `.mp4` is `php/api/reports.php:30-53` (Reports → View Asset). `assets/signs/en` holds 120 `.webm` and 0 `.mp4` (measured). The spec's statement that the `.mp4` is "the same clip the sign-video player reads" (spec lines 68-69) is wrong. Recorded as a new DEBT item; not fixed here.
4. **`delete_gesture` does not remove the label's video** (`save_gesture.php:401-438` touches JSON, DB rows only). A pure "label already has a video → skip" rule would leave a stale clip forever after delete-and-re-record. The rule therefore also transcodes when the label has no prior sample.
5. **ffmpeg cost, dev machine (Windows, vendored `ffmpeg.exe`).** Exact command from `save_gesture.php:522`, 7 runs each, `Measure-Command`:
   | input | min / median / max (ms) |
   |---|---|
   | synthetic 320×240 30 fps 3 s VP8 (`testsrc2`; camera request is 320×240, `gesture-training-ui.js:944`) | 257.6 / 273.9 / 356.5 |
   | stock `start.webm` (real, 360×636, 2.53 s) | 277.4 / 300 / 325 |
   | stock `help.webm` (real, 360×638, 1.67 s) | 219.9 / 255.1 / 277.4 |
   Through PHP (`exec()` + `get_ffmpeg_path()`'s `shell_exec('ffmpeg -version')`, 5 runs): exec 335.8–454.6 ms, `get_ffmpeg_path` 57.9–88.6 ms. **Pi timing: not measured — manual follow-up.**
6. **The transcode is not the biggest per-save wait here — and this phase now fixes both.** After a save, `confirmAndSave` awaits `reloadDataset()` (`gesture-data.js:568-570`), which does two full-dataset GETs (`mergeSavedGestureSamples` → `loadGestureDatasetForTraining()`, `renderSavedDataset` → `loadSavedGestureDataset()`, both with `sync_disk_to_db`, `gesture-training-ui.js:209,1009-1014`, `save_gesture.php:338-341`) — and the second of the two is never even awaited by `reloadDataset()` itself (`gesture-training-ui.js:1012`, `renderSavedDataset()` called with no `await`), so it still costs a full duplicate fetch and DB walk on the server without the caller getting anything for the wait. Measured in Chrome on this machine: each GET 5,601,500 bytes; per-request 1,984–3,875 ms (n=4); awaited `reloadDataset()` 2,271 / 3,919 / 3,851 ms. Curl `?no_sync=1`: 1.15–1.29 s (n=5) — so most of the excess over the base fetch cost is the redundant `sync_disk_to_db` walk plus the duplicate fetch itself, both of which are avoidable right after a save that already wrote disk and DB in lockstep (`save_gesture.php`'s POST branch calls `save_gesture_recording_to_db` directly; it never calls `sync_disk_to_db`). The payload also grows ~26 KB per sample kept, so encouraging 5–8 takes per word makes the wait worse over a session. **Root-cause fix in Task 5 (approved, promoted from "held" — see Decisions).**
7. **ffmpeg on the Pi: undeterminable from here.** The vendored Windows `ffmpeg.exe` lists no `*_v4l2m2m` encoder (measured `-encoders`; expected — V4L2 is Linux-only — and says nothing about the Pi's build). No repo doc says how ffmpeg is installed on the Pi; `get_ffmpeg_path()` prefers a global `ffmpeg` on PATH (`save_gesture.php:37-40`). Whether ffmpeg is installed on the Pi at all is unknown; if it isn't, the Pi never transcodes (fallback writes raw `.webm`, `:544-555`) and item 2 of this phase only helps machines that have it. **Manual follow-up with exact commands is in Task 6.**
8. **Call path, Step 1 save → server** (no new round-trip is needed for the skip rule):
   `#savePreviewBtn` click (`gesture-training-ui.js:1340`) → `GestureDataRecorder.confirmAndSave()` (`gesture-data.js:527`) → reads `window.currentPreviewBlob` (set in `mediaRecorder.onstop`, `gesture-training-ui.js:1150`), `FileReader.readAsDataURL` (`:538-543`) → `saveGestureSample(label, frames, signLanguage, videoBase64, videoPath)` (`:605`) → `fetch POST php/api/save_gesture.php` `{label, sign_language, frames, video_base64?}` (`:617-621`) → server POST branch (`save_gesture.php:386-585`): validate (`:440-459`), create/resolve `$labelDir` (`:472-480`), write `sample_<ms>_<hex>.json` (`:482-497`), video block (`:500-557`), DB upserts (`:559-569`), JSON response (`:573-585`). Everything the rule needs (`$label`, `$subFolder`, `$assetsSignsDir` `:505-511`, `$resolvedLabelDir`) is already in scope; the count of `sample_*.json` must be taken **before** `:482` writes the new file.
9. **Save-to-ffmpeg count today:** one `exec()` per save that carries a video (`:513-525`), so 5 takes of one word = 5 ffmpeg runs, 4 of them overwritten (`$videoFilename = $label . '.mp4'`, `-y`, `:518-522`). To be re-measured with the counting stub in Task 1 (before) and Task 2 (after).
10. **Root cause of finding 6, confirmed by reading both call sites (not assumed):** `mergeSavedGestureSamples()` (`gesture-training-ui.js:356-363`) and `renderSavedDataset()` (`:204-209`) each independently call a fetch of the same dataset shape — the first via `window.loadGestureDatasetForTraining()` → `loadSavedGestureDataset(false)` (`gesture-data.js:655-656`), the second via `GestureDataRecorder.loadSavedGestureDataset()` directly (also `noSync=false` by default, `gesture-data.js:638-639`) — with no sharing between them. Neither call needs the server-side resync `sync_disk_to_db` performs, because the save that triggers the reload already wrote the new `sample_*.json` file and its `gesture_recordings` row directly (`save_gesture.php:482-497,559-569`), not through the sync path.

## The transcode rule (recommended)

```
hasVideo   := filesize(assets/signs/<en|fil>/<label>.mp4) > 0  OR  same for .webm
transcode  := NOT hasVideo   OR   priorSampleCount == 0
skip       := hasVideo AND priorSampleCount >= 1
```
`priorSampleCount` = `sample_*.json` files already in the label's folder for this sign set, counted before the new sample is written. Landmarks are written regardless. On skip: `get_ffmpeg_path()`, the decode-to-ffmpeg step and the raw-`.webm` fallback are all bypassed; `$videoAssetRelative` stays `null`, so `save_gesture_to_language_dataset`'s `IFNULL(VALUES(asset_path), asset_path)` (`:142`) leaves the stored `asset_path` alone.

## Recommendations on the spec's open questions

**Display-video take → A (first take wins), with the "no prior sample" clause. Held back: an explicit "use this take" control.** Reasons: (a) it is the only variant that removes the per-save cost outright; "last take wins" (today) is what costs N encodes; (b) finding 3 means the `.mp4` is not played by `talk.html` today — an opt-in control would change something only visible in Reports → View Asset, and would put a new control on a screen where the real question (which format *is* the display clip, `.mp4` or `.webm`) is still open; (c) a bad first take is recoverable today by Delete + re-record (finding 4's clause makes that refresh the clip). If you want the control anyway it is a small separate task (option B below).

**Soft target → 5 samples per word, suggestion only, no ceiling shown.** Reason: K=5 in `knnPredict` (`gesture-training-ui.js:310`), see finding 1. The UI reads "aim for 5", flips to "target reached — extra samples optional" at ≥5, and never blocks. It also shows total frames, because a 1-frame take counts as a "sample" but is one k-NN vector.

## Extras — decided (owner approval, 2026-09-22)

- **B — "Use this take as the display clip" checkbox:** declined. Finding 3 (the `.mp4` this endpoint writes is read only by `reports.php`'s View Asset, never by `talk.html`) removes the reason to build it now; a control for choosing a display take that nothing plays back has no payoff yet. Not built. Revisit once the mp4/webm question (DEBT item 62) is settled.
- **C — cut the post-save reload cost:** promoted into the base plan as **Task 5**, not held as an optional extra — the ffmpeg skip alone (Task 2) saves 220–455 ms per save, while the reload cost this fixes was measured at 2.0–3.9 s per save (finding 6), so shipping only the transcode skip would not deliver the "feels faster" outcome the spec is for.
- **D — commit the test harness under `tests/multi-sample/`:** approved, done in Task 1. Task 5 adds one more committed file to the same folder (a re-runnable in-page regression script — see Task 5) so the "1 fetch per reload" fix also has coverage that outlives this session.

## File structure (the exact set `git diff --stat` must match)

| File | Change | Task |
|---|---|---|
| `tests/multi-sample/ffmpeg-stub/ffmpeg.bat` | create — logging ffmpeg shim | 1 |
| `tests/multi-sample/harness.mjs` | create — runs `save_gesture.php` through `php-cgi` | 1 |
| `tests/multi-sample/save-endpoint.test.mjs` | create — server tests | 1, 2 |
| `tests/multi-sample/measure-session.mjs` | create — 5-take session, counts ffmpeg runs | 1, 2, 6 |
| `tests/multi-sample/reload-regression.page.js` | create — committed, re-runnable in-page check that a reload issues one fetch | 5 |
| `php/api/save_gesture.php` | modify — skip rule + response fields | 2 |
| `js/gesture-data.js` | modify — export `cleanLabel`; richer `confirmAndSave` result; extract `recordingsToTrainingRows` | 3, 5 |
| `js/gesture-training-ui.js` | modify — tally, count line, relabelled Start, preview line; share one fetch in `reloadDataset` | 3, 5 |
| `gesture-training.html` | modify — two status `<div>`s; CSS cache-bust | 3 |
| `css/gesture-training.css` | modify — `.tr-sample-line` | 3 |
| `docs/system/UI.md`, `DECISIONS.md`, `MANUAL-CHECKS.md`, `DEBT.md`, `CLAUDE.md` | modify — docs commit, separate from code | 6 |
| `docs/superpowers/plans/2026-09-22-…md` (this file), the spec | already exist / this file | — |

Not touched: `reports.html`, `talk.html`, `sign-to-text*`, `js/talk-*.js`, `js/sign-player.js`, `php/api/reports.php`, `trainModel()`, `knnPredict()`, `cosineSimilarity()`. `mergeSavedGestureSamples()`'s and `renderSavedDataset()`'s own bodies are unchanged beyond Task 3's additive lines and Task 5's optional-parameter guard (every existing no-arg call site keeps today's behaviour).

## Test data hygiene (applies to every task that writes)

All test writes use the label `zz_multisample_probe` (ESL). Cleanup = `delete_gesture` through the endpoint **plus** `rm assets/signs/en/zz_multisample_probe.{mp4,webm}` (delete_gesture leaves them). After every task: `git status --short` must show no `saved_gestures*/zz_*` or `assets/signs/*/zz_*`, and a `GET save_gesture.php?no_sync=1` must contain no `zz_multisample_probe` key.

---

### Task 1: Test harness + measured "before" (red tests, baseline)

**Files:**
- Create: `tests/multi-sample/ffmpeg-stub/ffmpeg.bat`, `tests/multi-sample/harness.mjs`, `tests/multi-sample/save-endpoint.test.mjs`, `tests/multi-sample/measure-session.mjs`

**Interfaces:**
- Produces: `callEndpoint({method, body, query, stub, logFile, extraEnv}) → parsed JSON`; `cleanupProbe()`; `ffmpegRuns(logFile) → number` (transcode calls only; `-version` probes are not logged). Task 2 and Task 6 reuse these.

- [ ] **Step 1: Create the logging shim.** `tests/multi-sample/ffmpeg-stub/ffmpeg.bat`:

```bat
@echo off
rem Test shim, placed first on PATH by harness.mjs. Every real transcode call is logged;
rem the `-version` probe from get_ffmpeg_path() is delegated but not logged.
rem SK_STUB_FAIL=1 makes transcodes fail (exit 1, no output) to exercise the raw-.webm fallback.
if "%~1"=="-version" goto run
echo %date% %time% %* >> "%SK_FFMPEG_LOG%"
if defined SK_STUB_FAIL exit /b 1
:run
"%SK_REAL_FFMPEG%" %*
exit /b %ERRORLEVEL%
```

- [ ] **Step 2: Create the harness.** `tests/multi-sample/harness.mjs`:

```js
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '..', '..');
export const LABEL = 'zz_multisample_probe';
const PHP_CGI = process.env.SK_PHP_CGI || 'C:\\xampp\\php\\php-cgi.exe';
const ENDPOINT = path.join(repo, 'php', 'api', 'save_gesture.php');

export function fixtureVideo() {
  const p = path.join(repo, 'assets', 'signs', 'en', 'help.webm'); // real 74 KB stock clip
  return 'data:video/webm;base64,' + fs.readFileSync(p).toString('base64');
}
export function fixtureFrames(n = 3) {
  return Array.from({ length: n }, (_, i) => ({ index: i, timestamp: i, landmarks: Array(126).fill(0.1) }));
}

// Runs save_gesture.php under php-cgi exactly as Apache would, optionally with the ffmpeg shim first on PATH.
export function callEndpoint({ method = 'POST', body = null, query = '', stub = true, logFile = null, extraEnv = {} } = {}) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  const env = { ...process.env, ...extraEnv,
    REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: method,
    SCRIPT_FILENAME: ENDPOINT, SCRIPT_NAME: '/SKR/php/api/save_gesture.php',
    QUERY_STRING: query, CONTENT_TYPE: 'application/json', CONTENT_LENGTH: String(payload.length) };
  if (stub) {
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = path.join(here, 'ffmpeg-stub') + ';' + (env[pathKey] || '');
    env.SK_FFMPEG_LOG = logFile || path.join(here, 'ffmpeg-calls.log');
    env.SK_REAL_FFMPEG = path.join(repo, 'ffmpeg.exe');
  }
  const r = spawnSync(PHP_CGI, [], { env, input: payload, maxBuffer: 256 * 1024 * 1024 });
  const out = r.stdout.toString('utf8');
  const cut = out.indexOf('\r\n\r\n');
  return JSON.parse(cut >= 0 ? out.slice(cut + 4) : out);
}

export function ffmpegRuns(logFile) {
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length : 0;
}

export function cleanupProbe() {
  callEndpoint({ body: { action: 'delete_gesture', label: LABEL }, stub: false });
  for (const sub of ['en', 'fil']) for (const ext of ['mp4', 'webm'])
    fs.rmSync(path.join(repo, 'assets', 'signs', sub, `${LABEL}.${ext}`), { force: true });
}

export function sampleFiles() {
  const dir = path.join(repo, 'saved_gestures', LABEL);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^sample_.*\.json$/.test(f)) : [];
}
export const videoPath = ext => path.join(repo, 'assets', 'signs', 'en', `${LABEL}.${ext}`);
```

- [ ] **Step 3: Write the tests (they must FAIL against today's code where they assert the new behaviour).** `tests/multi-sample/save-endpoint.test.mjs`:

```js
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { callEndpoint, cleanupProbe, ffmpegRuns, fixtureFrames, fixtureVideo, sampleFiles, videoPath, repo, LABEL } from './harness.mjs';

const log = path.join(os.tmpdir(), 'sk-ffmpeg-calls.log');
const save = (extra = {}, env = {}) => callEndpoint({ logFile: log, extraEnv: env,
  body: { label: LABEL, sign_language: 'ESL', frames: fixtureFrames(3), video_base64: fixtureVideo(), ...extra } });

beforeEach(() => { cleanupProbe(); fs.rmSync(log, { force: true }); });
after(() => cleanupProbe());

test('first sample of a new word transcodes once and writes <label>.mp4', () => {
  const r = save();
  assert.equal(r.success, true);
  assert.equal(ffmpegRuns(log), 1);
  assert.ok(fs.statSync(videoPath('mp4')).size > 0);
  assert.equal(r.videoAsset, `assets/signs/en/${LABEL}.mp4`);
});

test('samples 2-5 of the same word do not run ffmpeg and do not touch the clip', () => {
  save();
  const before = fs.statSync(videoPath('mp4'));
  for (let n = 2; n <= 5; n++) {
    const r = save();
    assert.equal(r.success, true);
    assert.equal(r.videoSkipped, true, `sample ${n} must report videoSkipped`);
    assert.equal(r.labelSampleCount, n);
  }
  assert.equal(ffmpegRuns(log), 1, 'exactly one ffmpeg run across five saves');
  const after = fs.statSync(videoPath('mp4'));
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
});

test('landmarks are saved on every sample, skipped video or not', () => {
  for (let n = 1; n <= 5; n++) assert.equal(save().frameCount, 3);
  const files = sampleFiles();
  assert.equal(files.length, 5);
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(repo, 'saved_gestures', LABEL, f), 'utf8'));
    assert.equal(j.frames.length, 3);
  }
});

test('gestures[label].length grows by one per save (dataset GET)', () => {
  const count = () => (callEndpoint({ method: 'GET', query: 'no_sync=1', stub: false }).gestures[LABEL] || []).length;
  assert.equal(count(), 0);
  save(); assert.equal(count(), 1);
  save(); assert.equal(count(), 2);
});

test('backward compat: a word that already has <label>.mp4 is not re-transcoded', () => {
  save({ video_base64: undefined });                     // legacy word: samples exist, no video from this run
  fs.copyFileSync(path.join(path.dirname(videoPath('mp4')), 'help.webm'), videoPath('mp4')); // pre-existing clip
  const r = save();
  assert.equal(r.videoSkipped, true);
  assert.equal(ffmpegRuns(log), 0);
});

test('backward compat: a word that only has <label>.webm counts as having a video', () => {
  save({ video_base64: undefined });
  fs.copyFileSync(path.join(path.dirname(videoPath('mp4')), 'help.webm'), videoPath('webm'));
  assert.equal(save().videoSkipped, true);
  assert.equal(ffmpegRuns(log), 0);
  assert.equal(fs.existsSync(videoPath('mp4')), false);
});

test('delete then re-record: the first sample after a delete transcodes again (no stale clip)', () => {
  save();
  callEndpoint({ body: { action: 'delete_gesture', label: LABEL }, stub: false }); // leaves the .mp4 behind, as today
  fs.rmSync(log, { force: true });
  const r = save();
  assert.equal(r.videoSkipped, false);
  assert.equal(ffmpegRuns(log), 1);
});

test('fallback: ffmpeg failing still saves a raw .webm, and the next sample skips', () => {
  const first = save({}, { SK_STUB_FAIL: '1' });
  assert.equal(first.success, true);
  assert.equal(first.videoAsset, `assets/signs/en/${LABEL}.webm`);
  assert.ok(fs.statSync(videoPath('webm')).size > 0);
  assert.equal(fs.existsSync(videoPath('mp4')), false);
  const runsAfterFirst = ffmpegRuns(log);
  const second = save({}, { SK_STUB_FAIL: '1' });
  assert.equal(second.videoSkipped, true);
  assert.equal(ffmpegRuns(log), runsAfterFirst, 'no further ffmpeg attempt on sample 2');
});
```

- [ ] **Step 4: Baseline session script.** `tests/multi-sample/measure-session.mjs`:

```js
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { callEndpoint, cleanupProbe, ffmpegRuns, fixtureFrames, fixtureVideo, LABEL } from './harness.mjs';

const log = path.join(os.tmpdir(), 'sk-ffmpeg-session.log');
cleanupProbe(); fs.rmSync(log, { force: true });
const ms = [];
for (let i = 1; i <= 5; i++) {
  const t0 = performance.now();
  const r = callEndpoint({ logFile: log, body: { label: LABEL, sign_language: 'ESL', frames: fixtureFrames(3), video_base64: fixtureVideo() } });
  ms.push(Math.round(performance.now() - t0));
  if (!r.success) throw new Error(JSON.stringify(r));
}
console.log(JSON.stringify({ takes: 5, ffmpegRuns: ffmpegRuns(log), endpointMsPerSave: ms, note: 'php-cgi cold start included; dev machine, not the Pi' }));
cleanupProbe();
```

- [ ] **Step 5: Run against today's code and record the baseline.**
Run: `node --test tests/multi-sample/save-endpoint.test.mjs` then `node tests/multi-sample/measure-session.mjs`
Expected: test 1 (first sample) and the fallback's first half PASS; every assertion on `videoSkipped`, `labelSampleCount`, or `ffmpegRuns === 1` across 5 saves FAILS (undefined field / 5 runs). `measure-session` prints `"ffmpegRuns":5`. **Record the printed line verbatim as the "before" measurement.**
If the harness itself fails (php-cgi not found, JSON parse error), fix the harness first — a red test must fail for the intended reason. Confirm cleanup: `git status --short` shows only `tests/`.

- [ ] **Step 6: Commit (code).**
```bash
git add tests/multi-sample
git commit -m "tests: php-cgi harness and ffmpeg-counting shim for multi-sample saves (red baseline: 5 runs / 5 takes)"
```

**Done when:** harness runs; failing tests fail only on the new behaviour; baseline `ffmpegRuns` for a 5-take session recorded (expected 5); no `zz_multisample_probe` residue.

---

### Task 2: Server — skip the redundant transcode, report what happened

**Files:**
- Modify: `php/api/save_gesture.php` (helper near `:52`; count before `:482`; edits in `:500-557`; response `:573-585`)
- Test: `tests/multi-sample/save-endpoint.test.mjs` (from Task 1)

**Interfaces:**
- Consumes: Task 1 harness.
- Produces (response JSON, additive): `labelSampleCount: int` (samples for this label+sign set after this save), `videoSkipped: bool`, `videoTranscoded: bool` (true iff ffmpeg was attempted), `videoExisting: string|null` (path of the kept clip). Existing fields unchanged. Task 3 reads `labelSampleCount`, `frameCount`, `videoSkipped`.

- [ ] **Step 1: Add the helper** after `get_ffmpeg_path()` (after `save_gesture.php:52`):

```php
// The label's existing display clip, if any: assets/signs/<en|fil>/<label>.mp4, else .webm (the
// raw fallback, and the format the shipped stock clips use). Returns the project-relative path.
function find_label_video($assetsSignsDir, $label, $subFolder) {
    foreach (['mp4', 'webm'] as $ext) {
        $file = $assetsSignsDir . DIRECTORY_SEPARATOR . $label . '.' . $ext;
        if (is_file($file) && filesize($file) > 0) {
            return 'assets/signs/' . $subFolder . '/' . $label . '.' . $ext;
        }
    }
    return null;
}
```

- [ ] **Step 2: Count prior samples before the new file is written.** Insert immediately before `$filename = 'sample_' …` (`save_gesture.php:482`):

```php
// Samples this label already has for this sign set — taken BEFORE the new file is written; the
// video rule below keys on it (a label's first sample always refreshes its clip).
$priorSampleCount = count(glob($resolvedLabelDir . DIRECTORY_SEPARATOR . 'sample_*.json') ?: []);
```

- [ ] **Step 3: Apply the rule.** In the video block, after `$assetsSignsDir` is resolved (after `:511`) and before `$ffmpeg = get_ffmpeg_path();` (`:513`), add the decision; then change the two lines shown. Full resulting region:

```php
        $existingVideo = find_label_video($assetsSignsDir, $label, $subFolder);
        // Keep the existing clip for samples 2+. Landmarks were already saved above and are never skipped.
        $skipVideo = ($existingVideo !== null && $priorSampleCount > 0);
        if ($skipVideo) {
            $videoSkipped  = true;
            $videoExisting = $existingVideo;
        }

        $ffmpeg = $skipVideo ? null : get_ffmpeg_path();   // no `ffmpeg -version` process spawn on a skipped save
        if ($ffmpeg) {
            // … existing temp-file / $cmd lines unchanged …
            $output = [];
            $retval = 0;
            $videoTranscoded = true;                        // set immediately before the exec that actually runs
            exec($cmd, $output, $retval);
            // … rest of the ffmpeg branch unchanged …
        }

        // Fallback to saving raw webm if ffmpeg failed or is missing (never on a skipped save)
        if (!$skipVideo && empty($videoAssetRelative)) {
            // … existing fallback body unchanged …
        }
```
Declare defaults once, next to `$videoAssetRelative = $body['video_path'] ?? null;` (`:500`):

```php
$videoSkipped    = false;
$videoTranscoded = false;
$videoExisting   = null;
```

- [ ] **Step 4: Extend the response** (`:573-585`), additive only:

```php
    'labelSampleCount' => $priorSampleCount + 1,
    'videoSkipped'     => $videoSkipped,
    'videoTranscoded'  => $videoTranscoded,
    'videoExisting'    => $videoExisting,
```

- [ ] **Step 5: Run the tests.**
Run: `node --test tests/multi-sample/save-endpoint.test.mjs`
Expected: all 8 PASS. Also `php -l php/api/save_gesture.php` → "No syntax errors".

- [ ] **Step 6: Guard checks (read the diff).** Confirm by reading `git diff php/api/save_gesture.php`: (a) the sample-file write and all three DB calls are outside every new conditional; (b) `$videoAssetRelative` is untouched on skip (so `IFNULL(VALUES(asset_path), asset_path)` preserves the DB value); (c) no line inside `get_ffmpeg_path()`, the `$cmd` string, or the OneDrive copy changed.

- [ ] **Step 7: Commit (code).**
```bash
git add php/api/save_gesture.php
git commit -m "php/api/save_gesture.php: skip the ffmpeg transcode for samples 2+ of a word that already has a video; report videoSkipped/labelSampleCount"
```

**Done when:** 8/8 server tests pass; `measure-session.mjs` prints `ffmpegRuns: 1` (record it as the "after"); diff touches only the listed regions; no residue.

---

### Task 3: Step 1 — live sample count and the "record another sample" path

**Files:**
- Modify: `gesture-training.html` (status `<div>`s; CSS `?v=1.0.5` → `?v=1.0.6`)
- Modify: `css/gesture-training.css` (append `.tr-sample-line`)
- Modify: `js/gesture-data.js` (`confirmAndSave` return value ≈`:527-596`; export `cleanLabel` in `window.GestureDataRecorder` `:740-756`)
- Modify: `js/gesture-training-ui.js` (`renderSavedDataset` `:204`, `deleteGesture` `:241`, `onGestureCaptureReady` `:1331`, save handler `:1340`, startup `:1017`)

**Interfaces:**
- Consumes: response fields from Task 2 via `confirmAndSave`'s result.
- Produces: `GestureDataRecorder.cleanLabel(str) → string`; `confirmAndSave()` resolves `{ success, videoAsset, label, signLanguage, frameCount, labelSampleCount, videoSkipped }` (all additive). In the UI file: `SAMPLE_TARGET = 5`, `savedSampleInfo`, `refreshSampleCountLine()`. **Must not** change `trainModel`, `mergeSavedGestureSamples`, `knnPredict`, `cosineSimilarity`, and must keep `localStorage.removeItem(labelsKey)` (`gesture-data.js:566`).

- [ ] **Step 1: Failing browser check first.** Load `http://localhost/SKR/gesture-training.html` in the built-in browser and run:
```js
[!!document.getElementById('sampleCountLine'), typeof GestureDataRecorder.cleanLabel]
```
Expected now: `[false, "undefined"]`.

- [ ] **Step 2: `gesture-data.js`.** In `confirmAndSave`, capture identity before the reset and return it:
```js
    const savedLabel = state.label, savedLang = state.signLanguage;   // first line inside the function, after the guard
    …
        return { success: true, videoAsset: result.videoAsset, label: savedLabel, signLanguage: savedLang,
                 frameCount: result.frameCount, labelSampleCount: result.labelSampleCount,
                 videoSkipped: !!result.videoSkipped };
```
and add `cleanLabel,` to the `window.GestureDataRecorder = {…}` object.

- [ ] **Step 3: `gesture-training.html`.** Inside `#gestureDatasetCard`, directly after the Gesture Name `.tr-fgrp` (`:205-208`):
```html
            <div id="sampleCountLine" class="tr-sample-line" role="status" aria-live="polite"></div>
```
and directly under `.tr-preview-title` (`:255`):
```html
          <div id="previewSampleLine" class="tr-sample-line"></div>
```
Change `css/gesture-training.css?v=1.0.5` to `?v=1.0.6` (`:8`).

- [ ] **Step 4: CSS.** Append to `css/gesture-training.css`:
```css
/* Step 1: live sample count for the current word */
.tr-sample-line{font-size:12px;font-weight:700;color:var(--navy);min-height:16px;line-height:1.35}
.tr-sample-line:empty{display:none}
.tr-sample-line.done{color:var(--green)}
```

- [ ] **Step 5: `gesture-training-ui.js`.** Add near the other Step-1 helpers (before `renderSavedDataset`, `:203`):
```js
// ── Step 1: per-word sample tally ──
// Soft, never-blocking recording target. knnPredict scores a label by the mean of its top-5 cosine
// similarities over ALL its frames (knnPredict below), so 5 takes is the smallest count at which
// each of those 5 neighbours can come from a different take. A suggestion, not a gate.
const SAMPLE_TARGET = 5;
const savedSampleInfo = { ESL: {}, FSL: {} };   // sign set -> label -> { samples, frames }
let justSavedNote = '';

function selectedSignSet() {
  const r = document.querySelector('input[name="gestureDatasetType"]:checked');
  return r && r.value.toUpperCase() === 'FSL' ? 'FSL' : 'ESL';
}
function currentLabelClean() {
  const el = document.getElementById('gestureLabelInput');
  return el ? GestureDataRecorder.cleanLabel(el.value) : '';
}
function sampleInfoFor(label, set) {
  return (label && savedSampleInfo[set][label]) || { samples: 0, frames: 0 };
}
function rebuildSampleInfo(gestures) {
  savedSampleInfo.ESL = {}; savedSampleInfo.FSL = {};
  Object.keys(gestures).forEach(label => gestures[label].forEach(s => {
    const set = String(s.signLanguage || 'ESL').toUpperCase() === 'FSL' ? 'FSL' : 'ESL';
    const e = savedSampleInfo[set][label] || (savedSampleInfo[set][label] = { samples: 0, frames: 0 });
    e.samples += 1; e.frames += s.frameCount || 0;
  }));
}
function noteSampleSaved(res) {
  const set = String(res.signLanguage || 'ESL').toUpperCase() === 'FSL' ? 'FSL' : 'ESL';
  const e = savedSampleInfo[set][res.label] || (savedSampleInfo[set][res.label] = { samples: 0, frames: 0 });
  e.samples = res.labelSampleCount || e.samples + 1;   // server count is authoritative
  e.frames += res.frameCount || 0;                     // exact again after the next dataset reload
  justSavedNote = 'Saved. Run Train AI (Step 2) again to use it.';
}
function refreshSampleCountLine() {
  const line = document.getElementById('sampleCountLine');
  const startBtn = document.getElementById('startGestureDataBtn');
  if (!line) return;
  const label = currentLabelClean();
  const { samples, frames } = sampleInfoFor(label, selectedSignSet());
  if (startBtn) startBtn.textContent = samples > 0 ? 'Record another sample' : 'Start Capture';
  line.classList.toggle('done', samples >= SAMPLE_TARGET);
  if (!label) { line.textContent = ''; return; }
  let text;
  if (samples === 0) text = `“${label}” is a new word — no samples yet. Aim for ${SAMPLE_TARGET}.`;
  else if (samples < SAMPLE_TARGET) text = `“${label}” — ${samples} sample${samples === 1 ? '' : 's'} saved (${frames} frames). Record another — aim for ${SAMPLE_TARGET}.`;
  else text = `“${label}” — ${samples} samples saved (${frames} frames). ✓ Target reached; more are optional.`;
  line.textContent = justSavedNote ? `${text} ${justSavedNote}` : text;
}
```
Then wire it:
- `renderSavedDataset()`: directly after `const gestures = await GestureDataRecorder.loadSavedGestureDataset();` add `rebuildSampleInfo(gestures); refreshSampleCountLine();` (before the empty-check return).
- `deleteGesture()`: in the `json.success` branch, before `renderSavedDataset()`, add `delete savedSampleInfo.ESL[label]; delete savedSampleInfo.FSL[label]; refreshSampleCountLine();`.
- Save handler (`:1340`): change to
```js
      const res = await window.GestureDataRecorder.confirmAndSave();
      if (res && res.success) {
        noteSampleSaved(res);
        resetCaptureUI();
        refreshSampleCountLine();
      }
```
- `window.onGestureCaptureReady` (`:1331`): after setting `currentCaptureMeta`, add
```js
  const prev = document.getElementById('previewSampleLine');
  if (prev) prev.textContent = `This will be sample ${sampleInfoFor(label, String(signLanguage).toUpperCase() === 'FSL' ? 'FSL' : 'ESL').samples + 1} of “${label}”.`;
```
- Startup (inside the existing `DOMContentLoaded` async handler, `:1017`, at the top): 
```js
  const lblIn = document.getElementById('gestureLabelInput');
  const clearNote = () => { justSavedNote = ''; refreshSampleCountLine(); };
  if (lblIn) lblIn.addEventListener('input', clearNote);
  document.querySelectorAll('input[name="gestureDatasetType"]').forEach(r => r.addEventListener('change', clearNote));
  const startB = document.getElementById('startGestureDataBtn');
  if (startB) startB.addEventListener('click', () => { justSavedNote = ''; });
  refreshSampleCountLine();
```
(The on-screen keyboard dispatches `input` and `change` — `js/virtual-keyboard.js:199-201` — so typing on the kiosk updates the line.)

- [ ] **Step 6: Drive it in the browser, with a fake camera, and assert.** In the built-in browser (owner-approved PIN handling — see Approval item 3), on `gesture-training.html`:
  1. Stub the camera with a real hand video: create `<video src="assets/signs/en/hello.webm" loop muted autoplay>`, `await play()`, then `navigator.mediaDevices.getUserMedia = async () => videoEl.captureStream();` Click `#enableCamBtn`. **Spike first:** confirm `GestureDataRecorder.getLatestLandmarks()` returns non-null within ~3 s. If MediaPipe yields no landmarks from the fake stream, stop and report — the fallback is to run the three DOM assertions below by calling `noteSampleSaved`/`refreshSampleCountLine` directly and to say plainly that recording itself was not driven end to end.
  2. Type `zz_multisample_probe` in `#gestureLabelInput`; assert `#sampleCountLine` text contains `new word` and `#startGestureDataBtn` text is `Start Capture`.
  3. Record → Finish → Save; assert `#previewSampleLine` said `sample 1`, then after save `#sampleCountLine` contains `1 sample saved` and `Train AI`, `#startGestureDataBtn` reads `Record another sample`, and **`#gestureLabelInput.value` is unchanged from its value at Start** (regression guard — Start normalises it via `cleanLabel`, `gesture-data.js:103`).
  4. Record → Finish again **without reloading the page**; assert `#previewSampleLine` says `sample 2`; save; assert `(await GestureDataRecorder.loadSavedGestureDataset(true))['zz_multisample_probe'].length` went `1 → 2`.
  5. `read_console_messages` with `onlyErrors`: expect none across states: new word, 1 sample, 2 samples, preview, after delete.
  6. Repeat 3 more saves; assert the line switches to `✓ Target reached` at 5 and `.done` is set.
  7. **Regression guard for finding 2:** in the page, run Train (`await trainModel()`), then check `knnModel['zz_multisample_probe'].length` equals the sum of the saved samples' frames (read from the dataset GET). This proves later takes reach the model.
  8. Click the dataset modal's Delete for the probe label (or `deleteGesture`) and confirm the count line returns to `new word`. Then run cleanup (Test data hygiene).

- [ ] **Step 7: Kiosk-size layout check.** `resize_window` custom 1024×600; screenshot Step 1 with the count line at 0, 2 and ≥5 samples and the preview panel with the new line; confirm nothing clips in `.tr-left-panel` (42% width, scrolls, `css:702-707`). Report as observed, not assumed.

- [ ] **Step 8: Commit (code).**
```bash
git add gesture-training.html css/gesture-training.css js/gesture-data.js js/gesture-training-ui.js
git commit -m "gesture-training: Step 1 shows the word's sample count (target 5) and offers 'Record another sample'"
```

**Done when:** steps 6.1–6.8 pass with the values recorded; zero console errors; layout screenshots taken at 1024×600; `git diff` shows none of the four protected functions changed.

---

### Task 5: Client — cut the post-save reload cost (root-cause fix, Extra C)

**Files:**
- Modify: `js/gesture-data.js` — extract the pure transform `recordingsToTrainingRows(gestures)` out of `loadGestureDatasetForTraining` (`:655-667`); export it.
- Modify: `js/gesture-training-ui.js` — `mergeSavedGestureSamples()` and `renderSavedDataset()` (as left by Task 3) take an optional pre-fetched dataset; `reloadDataset()` fetches once and shares it, with a full-refetch fallback on error.
- Create: `tests/multi-sample/reload-regression.page.js` — committed, re-runnable in-page script; not a `node --test` file (see rationale in Step 9) but kept under `tests/multi-sample/` per the approved Extra D.

**Interfaces:**
- Consumes: Task 3's edited `renderSavedDataset()` body (this task changes the same function's signature and fetch line).
- Produces: `GestureDataRecorder.recordingsToTrainingRows(gestures) → rows[]` (pure, no network — same shape `loadGestureDatasetForTraining` already returns: `{label, features, signLanguage}[]`). `mergeSavedGestureSamples(prefetchedGestures?)` and `renderSavedDataset(prefetchedGestures?)` — both optional-arg, falling back to their own full synced fetch when called with no argument, so `trainModel()`'s `mergeSavedGestureSamples()` call and both of `DOMContentLoaded`'s calls keep behaving exactly as today. **Must not** change `trainModel`, `knnPredict`, `cosineSimilarity`, and must not change what a full (non-post-save) load does.

- [ ] **Step 1: Measure the root cause before touching code — confirm, don't assume.** In the built-in browser on `http://localhost/SKR/gesture-training.html` (fresh load), run:
```js
performance.clearResourceTimings();
const t0 = performance.now();
await window.reloadDataset();
await new Promise(r => setTimeout(r, 500)); // let the un-awaited renderSavedDataset() fetch land
const hits = performance.getEntriesByType('resource').filter(e => e.name.includes('save_gesture.php'));
({ ms: Math.round(performance.now() - t0), fetches: hits.length, bytesEach: hits.map(h => h.transferSize) })
```
Expected (confirms finding 10): `fetches: 2`, `bytesEach` both ≈5,601,800. **Record the printed object verbatim as this task's "before."** If `fetches` is not 2, stop — the finding is not what the plan assumes; re-investigate before writing code.

- [ ] **Step 2: Extract the pure transform.** Replace `loadGestureDatasetForTraining` in `js/gesture-data.js` (`:655-667`):
```js
  // Pure transform: gestures (as returned by loadSavedGestureDataset) -> flat feature rows.
  // Split out so a caller that already has a fetched `gestures` object (the post-save reload
  // path in gesture-training-ui.js) can skip a second network round-trip.
  function recordingsToTrainingRows(gestures) {
    const rows = [];
    Object.keys(gestures).forEach((label) => {
      gestures[label].forEach((sample) => {
        const signLanguage = sample.signLanguage || 'ESL';
        recordingToFeatureRows(sample).forEach((features) => {
          rows.push({ label, features, signLanguage });
        });
      });
    });
    return rows;
  }

  async function loadGestureDatasetForTraining(noSync = false) {
    const gestures = await loadSavedGestureDataset(noSync);
    return recordingsToTrainingRows(gestures);
  }
```
Add `recordingsToTrainingRows,` to the `window.GestureDataRecorder = {…}` object (`:740-756`).

- [ ] **Step 3: Confirm the extraction changed nothing.** In the browser:
```js
const a = await GestureDataRecorder.loadGestureDatasetForTraining(true);
[a.length > 0, typeof a[0].label, Array.isArray(a[0].features), typeof a[0].signLanguage]
```
Expected: `[true, "string", true, "string"]` — identical shape to before the refactor. Reload the page once; `read_console_messages` → no errors.

- [ ] **Step 4: Let `mergeSavedGestureSamples` accept a pre-fetched dataset.** In `js/gesture-training-ui.js`, change only the signature and the two guard/fetch lines (`:356-363`); every other line in the function (the `trainData` reset, the `rows.forEach`, the cache-sync block, `savedGestureSamplesMerged = true`, `:364` onward) is unchanged:
```js
async function mergeSavedGestureSamples(prefetchedGestures) {
  const langRadio = document.querySelector('input[name="gestureDatasetType"]:checked');
  const targetLang = (langRadio ? langRadio.value : 'ESL').toUpperCase();

  if (!prefetchedGestures && savedGestureSamplesMerged && lastLoadedLanguage === targetLang) return;
  if (!prefetchedGestures && typeof window.loadGestureDatasetForTraining !== 'function') return;
  try {
    const rows = prefetchedGestures
      ? window.GestureDataRecorder.recordingsToTrainingRows(prefetchedGestures)
      : await window.loadGestureDatasetForTraining();
```

- [ ] **Step 5: Let `renderSavedDataset` accept a pre-fetched dataset.** Task 3 left this function starting with `const gestures = await GestureDataRecorder.loadSavedGestureDataset();` followed by `rebuildSampleInfo(gestures); refreshSampleCountLine();`. Change only the signature and that one fetch line (`:204-211` as left by Task 3); the labels/table-build/`datasetCount.textContent` body after it is unchanged:
```js
async function renderSavedDataset(prefetchedGestures) {
  const tableWrap = document.getElementById('gestureDatasetTableWrap');
  const datasetCount = document.getElementById('datasetCount');
  if (!tableWrap) return;
  try {
    const gestures = prefetchedGestures || await GestureDataRecorder.loadSavedGestureDataset();
    rebuildSampleInfo(gestures);
    refreshSampleCountLine();
```

- [ ] **Step 6: Rewrite `reloadDataset` to fetch once, with a safety-net fallback.** Replace `:1009-1014`:
```js
window.reloadDataset = async () => {
  savedGestureSamplesMerged = false;
  let gestures = null;
  try {
    // no_sync: the save that triggered this reload already wrote disk and the gesture_recordings
    // row directly (save_gesture.php's POST branch calls save_gesture_recording_to_db, not
    // sync_disk_to_db), so re-walking every label folder here is redundant (finding 10).
    // DOMContentLoaded, below, keeps the full synced fetch: disk could have been touched outside
    // the app between page loads, and that path is not on the per-save critical path.
    gestures = await GestureDataRecorder.loadSavedGestureDataset(true);
  } catch (err) {
    console.warn('[reloadDataset] shared fetch failed, falling back to independent full reloads:', err);
  }
  await mergeSavedGestureSamples(gestures || undefined);
  renderSavedDataset(gestures || undefined);
  updateUI();
};
```

- [ ] **Step 7: Re-measure — this is the "after".** Reload the page fresh, then run the exact Step 1 script again.
Expected: `fetches: 1`. **Record the printed object verbatim as this task's "after."** If `fetches` is not 1, do not proceed to Step 8 — diagnose (a stray no-arg call to `mergeSavedGestureSamples()`/`renderSavedDataset()` somewhere in the save path would explain a second fetch).

- [ ] **Step 8: Full regression — re-run Task 3's browser check.** Repeat Task 3 Step 6 items 2–8 in full (new word → save → count line → second save → dataset-GET count growing 1→2 → Train reaches the model → delete → cleanup). All must still pass with identical visible behaviour; only the network-call count and timing differ. Also re-run Task 3 Step 7's 1024×600 screenshots — unchanged expected. `read_console_messages` → no errors across the whole pass.

- [ ] **Step 9: Commit the regression script.** Create `tests/multi-sample/reload-regression.page.js`:
```js
// Paste into DevTools console on http://localhost/SKR/gesture-training.html (after the page has
// finished loading) to re-check that a post-save reload issues exactly one save_gesture.php fetch.
// Not runnable under `node --test`: mergeSavedGestureSamples/renderSavedDataset/reloadDataset are
// page globals that read the DOM and MediaPipe state via `document`/`window`, not an importable
// module, and this repo adds no build step or test-DOM package (jsdom etc.) to change that — see
// docs/superpowers/plans/2026-09-22-gesture-training-multi-sample.md Task 5.
(async function reloadRegressionCheck() {
  performance.clearResourceTimings();
  const t0 = performance.now();
  await window.reloadDataset();
  await new Promise((r) => setTimeout(r, 500)); // let any stray extra fetch land before counting
  const hits = performance.getEntriesByType('resource').filter((e) => e.name.includes('save_gesture.php'));
  const ms = Math.round(performance.now() - t0);
  const result = { ms, fetches: hits.length, bytesEach: hits.map((h) => h.transferSize) };
  const pass = hits.length === 1;
  console[pass ? 'log' : 'error']('[reload-regression]', pass ? 'PASS' : 'FAIL', result);
  return result;
})();
```
```bash
git add tests/multi-sample/reload-regression.page.js js/gesture-data.js js/gesture-training-ui.js
git commit -m "gesture-training: reloadDataset shares one no_sync fetch instead of two full syncs"
```

**Done when:** Step 1's "before" (2 fetches) and Step 7's "after" (1 fetch) are both recorded verbatim; Step 8's full regression pass is clean with zero console errors; `git diff` shows `trainModel`/`knnPredict`/`cosineSimilarity` untouched and every no-arg call site of `mergeSavedGestureSamples`/`renderSavedDataset` behaviourally unchanged; `tests/multi-sample/reload-regression.page.js` committed.

---

### Task 6: Documentation, manual checks, verification, final report

**Files:**
- Modify: `docs/system/UI.md` (Part 2 §3 — Step 1 sample-count affordance; `save_gesture` response fields), `docs/system/DECISIONS.md` (append), `docs/system/MANUAL-CHECKS.md` (new section), `docs/system/DEBT.md` (items 14, 26 notes; new items 62–64), `CLAUDE.md` (Step 1 description if it changed — currently CLAUDE.md does not describe Step 1, so likely no edit; verify and say so).

- [ ] **Step 1: DECISIONS.md.** Append one line each, with reasons, for: the transcode rule and its "no prior sample" clause (finding 4); first-take-wins (A) and why the opt-in (Extra B) is declined, not just held; soft target 5 and why not 8 (finding 1); `localStorage.removeItem(labelsKey)` is load-bearing (finding 2) and Step 1 says "Run Train AI again"; `has video` covers `.mp4` and `.webm` (finding 3); the reload fix shares one `no_sync` fetch instead of two synced fetches, and why the DOMContentLoaded startup path keeps its full sync (Task 5, finding 10); harness and the reload-regression script committed under `tests/multi-sample/` (Extra D); the spec's `.mp4`-is-what-the-player-reads claim was wrong (already corrected inline in the spec — see the spec's own "Correction (plan phase…)" note).

- [ ] **Step 2: DEBT.md.** Add: **62** mp4/webm mismatch (finding 3); **63** post-save reload cost — record it as **mitigated, not eliminated**, with both measured numbers: before (2 fetches, synced, 2.0–3.9 s) and after (1 fetch, unsynced, Task 5's measured "after" value) — note that DOMContentLoaded's startup load still does two full synced fetches by design (finding 10's fix is scoped to the post-save path only), so a large dataset still costs seconds at page load; **64** `delete_gesture` leaves `assets/signs/<label>.{mp4,webm}` behind. Add a dated note under **14**: "not resolved — this phase does not change `trainModel()` or the epochs label; Step 1 now tells the operator to run Train AI again after a save, which is consistent with item 14's finding that Train is a cache merge." Add a note under **26**: "not folded in; this phase does not restore upload; it does change what a re-record does to the label's clip (samples 2+ keep the first clip)." Leave both open.

- [ ] **Step 3: UI.md** — Step 1's count line, relabelled Start button, preview line, the target-5 rationale with `gesture-training-ui.js` line cites (re-cite after edits — Task 5 shifts some line numbers), the new response fields, and the reload-sharing change in the "How it works" list.

- [ ] **Step 4: MANUAL-CHECKS.md** — new section "Gesture training multi-sample (2026-09-22)", real Pi required:
  - [ ] Record 5+ samples of one word back to back; note the per-save wait, ideally once on the commit before this phase (`ce46fff`) and once after, for a like-for-like comparison. Dev baseline (not the Pi): 5 saves = 5 ffmpeg runs before, 1 after (Task 2); reload fetches per save = 2 synced before, 1 unsynced after (Task 5) — use Task 5's actual before/after millisecond values here once recorded, not the numbers in this plan's findings, which predate the fix.
  - [ ] The word's display clip is a playable file after several re-recordings (`assets/signs/en/<word>.mp4` or `.webm`; open it; Reports → View Asset).
  - [ ] Subjective Predict (Step 3) accuracy: a word recorded once vs 5–8×, **after pressing Train AI again**. Also try one word recorded 8× beside others recorded once, and note any word that "steals" predictions (finding 1's pool-size bias, unmeasured).
  - [ ] **Pi ffmpeg facts (exact commands):** `which ffmpeg; ffmpeg -version | head -1; ffmpeg -hide_banner -encoders | grep -E "libx264|v4l2m2m"`. If installed: `time ffmpeg -i <a 320x240 sample>.webm -vf scale=360:-2 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 -r 25 -an -b:v 300k out.mp4 -y`, and if `h264_v4l2m2m` is listed, the same with `-c:v h264_v4l2m2m -b:v 300k` (drop `-profile:v`/`-level` and see if it accepts them). Record the times as the real Pi baseline. Hardware encoding is not adopted in this phase; after the skip, only the first take of a word encodes at all, which shrinks its payoff.

- [ ] **Step 5: Final verification.**
  - `node --test tests/multi-sample/save-endpoint.test.mjs` → 8/8; `node tests/multi-sample/measure-session.mjs` → `ffmpegRuns: 1` (before: 5, from Task 1) — confirms Task 5's client-side change did not reintroduce an extra ffmpeg call.
  - Paste `tests/multi-sample/reload-regression.page.js` into the browser console on a loaded `gesture-training.html` → `PASS`, `fetches: 1`.
  - `git diff --stat ce46fff..HEAD -- . ':!docs'` (`ce46fff` = HEAD when this phase started) lists exactly the code files in the table above; no other files.
  - `git status --short` shows no `zz_multisample_probe` residue; dataset GET has no such key. **State plainly that this was checked, not just attempted.**
  - Console errors: none (Tasks 3 and 5).

- [ ] **Step 6: Commit (docs only, separate from code).**
```bash
git add docs/system docs/superpowers/plans/2026-09-22-gesture-training-multi-sample.md docs/superpowers/specs/2026-09-22-gesture-training-multi-sample-design.md CLAUDE.md
git commit -m "docs: gesture-training multi-sample phase — decisions, UI, manual checks, DEBT 62-64"
```

- [ ] **Step 7: Final report to the owner:** each measurement beside its target; review rounds per task; the two open-question answers with reasons; before/after ffmpeg-run count for a 5-take session (before **5**, after **1** — both measured by the shim); before/after fetch count and latency for a post-save reload (before **2** fetches / ~2–4 s, after **1** fetch / Task 5's measured value — both measured, not estimated); confirmation that test-data cleanup ran and left no residue; what is unmeasured (Pi timing, Pi ffmpeg/v4l2m2m, pool-size bias magnitude, subjective accuracy).

**Done when:** docs committed separately from code; MANUAL-CHECKS section exists; DEBT 14 and 26 remain open with notes; DEBT 63 reflects "mitigated" with real before/after numbers; final numbers reported.

---

## Self-review

- **Spec coverage:** live count + record-another path → Task 3; soft target with code-derived number → Task 3 + findings; skip transcode on samples 2+ → Task 2; open questions → recommendations section; automated tests (second row, no-ffmpeg-on-2+, label unchanged, diff stat, zero console errors) → Tasks 1–3, 5, 6; manual section → Task 6; docs list → Task 6; Step 0 → done (`DECISIONS.md`). The `h264_v4l2m2m` question is answered as "cannot determine off-Pi", with commands. The owner's Task 5 addition (Extra C, the reload cost) is covered end to end: root cause confirmed with a before-measurement (Step 1), fixed (Steps 2–6), re-measured (Step 7), regressed against Task 3's full check (Step 8), and given committed, re-runnable coverage (Step 9) — not silently absorbed into Task 3, and not left as a bigger untracked risk: it is a two-file client-only change with no server or schema edits, comparable in size to Task 3.
- **Constraint check:** wizard unchanged; the four protected functions are read-only for every task, including Task 5 (`mergeSavedGestureSamples`/`renderSavedDataset` gain an optional parameter and an unchanged fallback path; their bodies and every no-arg caller — `trainModel()`, both `DOMContentLoaded` calls — are unaffected); landmarks saved before and outside every new conditional (Task 2 step 6); fallback covered by a test that forces ffmpeg failure; legacy `.mp4`/`.webm` words covered by two tests; `reports.html` and siblings untouched; DOMContentLoaded's startup sync is deliberately left alone by Task 5 (only the post-save path changes).
- **Type consistency:** `labelSampleCount`, `videoSkipped`, `videoTranscoded`, `videoExisting` (Task 2) are consumed by name in Task 3's `noteSampleSaved`/`confirmAndSave` return; `cleanLabel` exported in Task 3 step 2 and used in step 5; `recordingsToTrainingRows(gestures) → {label, features, signLanguage}[]` (Task 5 step 2) matches the row shape `mergeSavedGestureSamples`'s `rows.forEach(({label,features,signLanguage}) => …)` already destructures (`gesture-training-ui.js:372`), so Task 5 step 4's swap is a drop-in.
- **Known risk to the plan:** the harness (php-cgi + `.bat` shim on PATH) and the fake-camera browser drive are designed but not yet run; Task 1 step 5 and Task 3 step 6.1 are where that gets proven, with stated fallbacks. Task 5 depends on Task 3's exact edited line numbers in `renderSavedDataset()`; if Task 3's review changes that function's shape, Task 5 step 5 must be re-read against the actual committed code, not this plan's quoted snippet, before editing.
