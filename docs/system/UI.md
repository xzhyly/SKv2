# UI Layer

This document covers the kiosk's screens: the two live translation screens (this
section) and the dashboard/training/admin screens (next section). Produced by two
parallel Pass 2 subagents from static reading of the code, cited by file and line.
Values not found in code are marked "not specified in code" rather than estimated.

---

## Part 1: Camera Translator & Sign-to-Text Screens

### 1. Owns these files

- `camera-translator.html`
- `sign-to-text.html`
- `js/db-api.js`
- `js/db-local.js`
- `js/gesture-data.js`
- `js/camera-helper.js`
- `js/speech-synthesis.js`
- `js/sign-to-text-ui.js`
- `js/virtual-keyboard.js`
- `css/sign-to-text.css`
- `css/virtual-keyboard.css`

### 2. What it does

Both screens turn hand gestures seen by the USB camera into spoken/written words.
`sign-to-text.html` is the polished kiosk-facing translator: an onboarding guide,
then a live camera view with a skeleton overlay, a start/stop gesture workflow that
accumulates a sentence, and a result screen with speak/copy/clear/save actions and a
volume slider. `camera-translator.html` is a dual-purpose page: with
`?screen=translate` in the URL it renders a near-identical translate-only screen;
without that parameter it renders a 4-step "Add Data → Train AI → Predict →
Translate" gesture-training wizard (capture samples, train a model in-browser, test
it, then translate).

### 3. How it works

- Camera request: both pages ask for `{width:{ideal:320}, height:{ideal:240}}`
  (`camera-translator.html:1128-1129`, `:1592-1593`; `js/camera-helper.js:6,34` —
  same 320×240 ideal, used by `sign-to-text-ui.js` via `camera-helper.js`).
- Hand landmarks: MediaPipe `Hands` configured with `maxNumHands:2,
  modelComplexity:1, minDetectionConfidence:0.65, minTrackingConfidence:0.65`
  (`js/gesture-data.js:240-244`, duplicated at `:702-707`).
- Per-hand feature vector is 63 numbers (21 landmarks × x/y/z)
  (`js/gesture-data.js:115-134`); two hands are concatenated into 126
  (`js/gesture-data.js:136-148`, zero-padded if one hand absent).
- Frame capture during "Add Data": target 30 frames (`FRAME_TARGET=30`), min 1, max
  40, sampled every 90 ms (`js/gesture-data.js:2-4,18`).
- Landmark→pixel fallback feature extractor (when no landmarks available) uses a
  16×12 canvas = 192 grayscale values (`js/camera-helper.js:2-4`; duplicated inline
  in `camera-translator.html:918,1003-1010`).
- `camera-translator.html` trains a TensorFlow.js model: dense(96, relu) →
  dropout(0.18) → dense(48, relu) → dense(labels, softmax); `adam(0.003)`;
  `categoricalCrossentropy`; `epochs=50` (`EPOCHS` const, line 919);
  `batchSize:128`; `validationSplit:0.15` (`camera-translator.html:1220-1231`).
  Saved to `indexeddb://sining-kamay-model`, labels to
  `localStorage['sining_kamay_labels']` (`:1242-1243`).
- `sign-to-text-ui.js` does **not** use TensorFlow for prediction; it uses a
  hand-rolled cosine-similarity k-NN (`top-K = min(5, N)` neighbors, score
  normalized as `(s-0.3)/0.7` clamped 0–1) (`js/sign-to-text-ui.js:199-238`), cached
  per-language in `localStorage['sining_kamay_knn_ESL'/'_FSL']` and
  `'sining_kamay_labels_ESL'/'_FSL'` (`:288-289`).
- Prediction loop interval: 150 ms in both files (`camera-translator.html:1367,1754`;
  `js/sign-to-text-ui.js:600`).
- Gesture confirmation: `camera-translator.html` requires `conf>.65` then a 500 ms
  hold (`GESTURE_HOLD_MS=500`, line 911; check at `:1349-1351`), averaging up to 6
  recent predictions (`:1332`) or 4 in the kiosk loop (`:1689`).
  `sign-to-text-ui.js` uses a 4-tick rolling window (`ROLLING_WINDOW_SIZE=4`, ~600
  ms), confirms only after 2 consecutive matching ticks (`STABILITY_THRESHOLD=2`,
  ~300 ms) with `avgConf>0.45` (`js/sign-to-text-ui.js:19-22,499-514`), plus the same
  `GESTURE_HOLD_MS=500` gate (`:7`).
- Countdown before recording starts: 3 seconds, 1000 ms ticks (`tlCountdownVal=3`,
  `camera-translator.html:901,2039-2050`; same in `sign-to-text-ui.js:716,735-746`).
- Confidence threshold for the training-wizard's Step 3 "detected" highlight:
  `conf>.7` (`camera-translator.html:1346`).
- API base URLs, three separate hardcoded fallback patterns keyed on
  `location.protocol==="file:"`:
  - `js/db-api.js:10-12`: `http://localhost/Sining_kamay/php/api/` vs `php/api/`
  - `js/db-local.js:8-10`: `http://localhost/Sining_kamay/php/api/core_api.php` vs
    `php/api/core_api.php`
  - `js/gesture-data.js:5-7`:
    `http://localhost/Sining_kamay/php/api/save_gesture.php` vs
    `php/api/save_gesture.php`
  All three hardcode the folder name `Sining_kamay`, which does not match this
  repo's folder name (`SKv2`).
- Speech: `speechSynthesis` utterances at `rate=0.9` (single word) / `rate=0.85`
  (full sentence) (`js/speech-synthesis.js:33,48`; camera-translator inline
  duplicate `:1495,1505`), volume read from
  `localStorage['sining_kamay_speaker_volume']` default `1.0`
  (`js/speech-synthesis.js:34,49`).
- Google Fonts CDN reference present in both HTML files: `camera-translator.html:7`
  and `sign-to-text.html:7` —
  `https://fonts.googleapis.com/css2?family=Inter:...&family=Nunito:...`. This
  contradicts the "fully offline" brief; observed as-is.
- No cache-busting query string was found on any `<script src=...>` or
  `<link href=...>` tag in either owned HTML file.

### 4. Key decisions and why

- Two DB client files (`db-api.js`, `db-local.js`) coexist: reason not documented in
  code. In practice, only `DB_API.saveTranslation()` / `DB_API.getTranslations()`
  from `db-api.js` are called from these two screens
  (`camera-translator.html:1356,1942`); none of `db-local.js`'s functions
  (`saveRecording`, `getAllRecordings`, `deleteRecording`,
  `saveTranslation(word,lang,transcript)`, `getAllTranslations`,
  `deleteTranslation`, `saveGestureWord`, `clearStore`, `getDBStats`) are called
  anywhere in `camera-translator.html` or `js/sign-to-text-ui.js`, despite
  `db-local.js` being loaded on both pages.
- `sign-to-text-ui.js` replaced TF.js with a cosine-similarity k-NN for live
  prediction while `camera-translator.html`'s wizard still trains/uses a TF.js
  dense network — reason not documented in code; comments only show KNN
  cache-invalidation logic, not why the switch happened.
- Per-language model caching (`_ESL`/`_FSL` suffixes) exists only in
  `sign-to-text-ui.js`; `camera-translator.html`'s TF.js model/labels are stored
  under a single non-language-scoped key (`indexeddb://sining-kamay-model`,
  `localStorage['sining_kamay_labels']`) — reason not documented in code.
- The MediaPipe WASM SIMD detection is deliberately patched to force the non-SIMD
  binary: comment states this is "to prevent 'memory access out of bounds' crashes"
  (`js/gesture-data.js:196-199`).

### 5. Constraints

- `WebAssembly.validate` is monkey-patched to force MediaPipe's non-SIMD WASM
  binary, explicitly for Pi stability (`js/gesture-data.js:196-219`).
- A shared offscreen canvas is fixed at 320×240 "to workaround Raspberry Pi
  Chromium video GPU SharedImage mailbox bugs" and "to prevent WebAssembly OOM
  crashes" (`js/gesture-data.js:348-352,362-367,762-770`).
- Camera capture itself is requested at 320×240 ideal (see §3) — not labeled
  Pi-specific in a comment, but consistent with the low-power constraint above.

### 6. Touches

- Both HTML files load `js/lib/tf.min.js` and `js/lib/mediapipe/hands.js`
  (vendored — see `docs/system/VENDORED.md`): if either is missing/changed,
  camera-translator's TF.js training/prediction breaks entirely, and MediaPipe hand
  detection breaks on both screens (no landmarks → both prediction loops silently
  stall).
- `js/gesture-data.js` exposes `window.GestureDataRecorder`,
  `window.extractLandmarkFeatures`, `window.loadGestureDatasetForTraining` — both
  `camera-translator.html` and `sign-to-text-ui.js` call these; removing/renaming
  them breaks feature extraction and dataset loading on both screens.
- `js/db-api.js`'s `DB_API` global is required by both screens for saving/reading
  translation history; if `php/api/save_translation.php` or `get_translations.php`
  (see `docs/system/BACKEND.md`) change their contract, both screens'
  history-saving and the DB-status dot break silently (errors are caught and only
  logged/toasted).
- `js/camera-helper.js` and `js/speech-synthesis.js` are loaded only by
  `sign-to-text.html` (consumed by `sign-to-text-ui.js`); `camera-translator.html`
  does not load them and instead carries its own inline duplicates of
  `initCameraWithFallback`, `extractFeatures`, `FEAT_W/FEAT_H/FEATURES`, and
  `speakWord` (`camera-translator.html:918,997-1011,1043-1124,1493-1500`). Editing
  `camera-helper.js` or `speech-synthesis.js` will not affect
  `camera-translator.html` at all — the two implementations have already diverged.
- `js/virtual-keyboard.js` + `css/virtual-keyboard.css` are loaded only by
  `camera-translator.html` (used for on-screen typing during the training wizard);
  `sign-to-text.html` does not load them.
- `css/sign-to-text.css` is used only by `sign-to-text.html`;
  `camera-translator.html` keeps its own inline `<style>` block that duplicates
  most of the same class names/rules (compare `camera-translator.html:14-198` to
  `css/sign-to-text.css:5-187`) — the two have already drifted (e.g.,
  `.tl-output-box` font-size 18px in camera-translator's inline CSS vs 26px in
  `sign-to-text.css`).
- Both `index.html` buttons/links route to `sign-to-text.html`
  (`index.html:582,651`); no such link/`window.location`/`window.open` reference to
  `camera-translator.html` was found anywhere in the `*.html` files.
  `camera-translator.html`'s own "Back" link points to `index.html`, and its
  "Translate Text to Sign" link points to `index.html?screen=voice`. (This
  reachability gap is planned dual-screen work, not a defect — see
  `docs/system/DEBT.md`.)

### Problems found (Part 1)

- `camera-translator.html:1380-1433` and `:1438-1491` — an entire block
  (`getWordBank`, `tlSetLang`, `addCustomWord`, its `keydown` listener,
  `removeCustomWord`, `renderWordChips`, `renderTranslation`) is duplicated
  verbatim, including a repeated `// STEP 4 — TRANSLATE (training UI)` header
  comment; the `wordInput` keydown listener is attached twice.
- `camera-translator.html:904,906-907` — `TARGET`, `isRecordingStart`,
  `isRecordingStop`, `recordInterval`, `lastStartThumb`, `lastStopThumb` are
  declared but never referenced anywhere else in the file.
- `js/db-local.js` (entire file) — loaded on both screens but none of its exported
  functions (`saveRecording`, `getAllRecordings`, `deleteRecording`,
  `saveTranslation`, `getAllTranslations`, `deleteTranslation`, `saveGestureWord`,
  `clearStore`, `getDBStats`) are called from `camera-translator.html` or
  `js/sign-to-text-ui.js`.
- `js/sign-to-text-ui.js:380-382,410-413,420-422,792-797` — references DOM elements
  `#tlVideo2`, `#tlPredEmoji2`, `#tlPredLabel2`, `#tlPredOverlay2`, `#tlLangEn2`,
  `#tlLangFil2` that do not exist anywhere in `sign-to-text.html` (verified via
  grep); calls are null-guarded so this fails silently rather than erroring, but
  indicates a half-migrated dual-view design.
- `camera-translator.html:997-1011,1043-1124` vs `js/camera-helper.js:1-68` —
  near-duplicate `extractFeatures`/`initCameraWithFallback`/`FEAT_W`/`FEAT_H`/
  `FEATURES` implementations that have diverged (camera-translator's copy has extra
  console logging and Tagalog error strings not present in camera-helper.js).
- `camera-translator.html:1493-1500` vs `js/speech-synthesis.js:29-42` — duplicate
  `speakWord` implementations; camera-translator's copy ignores the
  `localStorage['sining_kamay_speaker_volume']` setting that `speech-synthesis.js`
  respects.
- External network reference: `camera-translator.html:7` and `sign-to-text.html:7`
  — `<link href="https://fonts.googleapis.com/css2?family=Inter:...&family=Nunito:...&display=swap" rel="stylesheet">`.
- Observation on reachability: no `href`, `window.location`, or `window.open`
  reference to `camera-translator.html` was found in any `*.html` file in the
  repository; `sign-to-text.html` is linked from `index.html:582` and `:651`.
- Inconsistent default `activeFeatureSize`: `192` in `camera-translator.html:916`
  vs `126` in `js/sign-to-text-ui.js:13`.
- Could not determine: whether `camera-translator.html`'s training wizard is
  reachable from any other page (no incoming link found) or is only reachable by
  direct URL; whether `js/gesture-data.js`'s `SAVE_ENDPOINT`
  (`php/api/save_gesture.php`) and `js/db-api.js`'s `BASE` (`php/api/`) point at
  the same PHP router as `js/db-local.js`'s `core_api.php` — the PHP files
  themselves are documented in `docs/system/BACKEND.md`.
