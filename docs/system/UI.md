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

---

## Part 2: Dashboard, Training & Admin Screens

### 1. Owns these files

- `index.html`
- `js/script.js`
- `js/vosk.js`
- `gesture-training.html`
- `js/gesture-training-ui.js`
- `css/style.css`
- `css/gesture-training.css`
- `bulk-importer.html`
- `reports.html`
- `learn-signs.html`

### 2. What it does

- **index.html** — kiosk home/dashboard. Shows a 5-card nav (Learn Signs, Translate
  Sign to Text, Translate Text to Sign, Train Gestures, View Reports) and embeds the
  "Text to Sign" (voice/typed → sign video) screen as a same-page `<section>`
  (index.html:559-746), toggled via `?screen=voice` query param (script.js:341-355).
- **gesture-training.html** — PIN-gated admin screen for recording/importing
  gesture samples, training a KNN classifier, live-testing predictions, and running
  a sign-to-text/speech translator built from custom gestures. 4-step wizard (Add
  Data → Train AI → Predict → Translate), lines 94-354.
- **bulk-importer.html** — PIN-less admin tool for batch-uploading raw videos,
  converting them server-side, extracting MediaPipe landmarks, and saving them to
  the gesture dataset.
- **reports.html** — PIN-gated admin analytics screen: 3 tabs (ESL Signs, FSL
  Signs, Translations) pulling from a PHP/MySQL-backed report endpoint, with
  print/PDF export.
- **learn-signs.html** — thin wrapper that shows a floating "Back to Kiosk" button
  over a full-screen `<iframe>`.

### 3. How it works (cited values)

- Text-to-Sign voice recognition is forced to an offline Vosk adapter
  (`VoskSpeechRecognition`, script.js:340) regardless of browser; model file path is
  `models/vosk-model-small-en-us-0.15.tar.gz.zip` (script.js:202), loaded via
  `Vosk.createModel`.
- Vosk audio pipeline: `ScriptProcessorNode` buffer size **4096**, 1 in/1 out
  channel (script.js:288); audio constraints request `echoCancellation`,
  `noiseSuppression`, `autoGainControl`, `channelCount: 1` (script.js:239-244).
- Speech restart/quiet-error handling: `stopListening()` sets a 2500ms processing
  timeout (script.js:677) before falling back to "no speech detected".
- Fingerspelling fallback per-letter display duration is **800ms** (script.js:948);
  static image fallback duration is **1200ms** (script.js:951); successful video
  branch waits **2000ms** before continuing (script.js:953).
- Sign asset base paths are language-specific: `assets/signs/en/` and
  `assets/signs/fil/` (script.js:158).
- Gesture-training KNN: **126**-element feature vector default
  (gesture-training-ui.js:15, :289, :331), i.e., two hands × 21 landmarks × 3
  coords (63 each). Mirror-invariant matching swaps the two 63-length halves
  (gesture-training-ui.js:286-297).
- Prediction loop runs every **150ms** (`setInterval(...,150)`,
  gesture-training-ui.js:749) with a rolling history of the last **6** frames,
  averaged once **≥3** are collected (gesture-training-ui.js:643-644); top-K
  cosine similarity uses **K=5** (gesture-training-ui.js:310).
- Confidence normalization maps cosine range **0.3–1.0 → 0–1**
  (gesture-training-ui.js:319). Gesture accumulation requires confidence **>
  0.45** (gesture-training-ui.js:679, :687) and a **700ms** hold
  (`GESTURE_HOLD_MS`, gesture-training-ui.js:10, used at :689).
- "Training" epoch UI displays **"0 / 50 epochs"** and constant `EPOCHS = 50`
  (gesture-training-ui.js:17, HTML gesture-training.html:295) — but the actual
  `trainModel()` function does not run 50 real epochs; it is a KNN cache compile
  with a cosmetic progress-bar animation of **20 steps × 18ms**
  (gesture-training-ui.js:531-537) or **10 steps × 12ms**
  (gesture-training-ui.js:502-505) when nothing new needs compiling. The 50-epoch
  label is not reflected in the actual training logic — reason not documented in
  code.
- Countdown before gesture recording: 3-2-1 at **1000ms** per tick
  (gesture-training-ui.js:1219-1233).
- Video-file import target frame count: `duration * 10` fps, clamped **min 10, max
  60** frames — this logic is in `bulk-importer.html:720-723`, same clamp values.
  Per-frame seek has a **250ms** safety timeout (bulk-importer.html:753-764).
- Admin PIN for both gesture-training.html and reports.html is hardcoded
  client-side: `CORRECT_PIN = '2026'` (gesture-training-ui.js:23; reports.html:443,
  inline duplicate implementation).
- Cache-busting/version query strings: `js/script.js?v=5` (index.html:750),
  `css/gesture-training.css?v=1.0.5` and `css/virtual-keyboard.css?v=1.0.5`
  (gesture-training.html:8-9). No version string on `css/style.css`,
  `js/gesture-training-ui.js`, or `js/vosk.js`.
- Save-gesture endpoint path branches on protocol: when
  `location.protocol === "file:"` it hardcodes `http://localhost` + (`/SKR` if the
  pathname contains `/SKR`, else `/Sining_kamay`) + `/php/api/save_gesture.php`
  (script.js:847-849); otherwise relative `php/api/save_gesture.php`.
- MediaPipe Hands options in bulk-importer.html: `maxNumHands: 2`,
  `modelComplexity: 1`, `minDetectionConfidence: 0.65`,
  `minTrackingConfidence: 0.65` (bulk-importer.html:644-647).
- `js/vosk.js` line 174 is a single ~5.6 million-character line containing a
  base64-encoded Web Worker bundle (`createBase64WorkerFactory`, decoded via
  `atob`/Blob at runtime) — this is the vendored `vosk-browser` library, not
  hand-written kiosk code; confirmed third-party by embedded UUID/Microsoft
  license headers (vosk.js:7-20, 32-50).

### 4. Key decisions and why

- Speech recognition is hard-forced to the Vosk offline adapter "to ensure 100%
  offline functionality on all devices" (script.js:339 comment) — explicit,
  documented reason.
- Voice input is disabled entirely in Filipino mode (`setTtsLanguage`,
  script.js:480-498) — no reason given in code; reason not documented in code.
- Step 2 of gesture-training.html hides the camera panel via off-screen
  positioning instead of `display:none`, explicitly "to prevent Chromium freezes
  on Pi" (css/gesture-training.css:716-723) — documented hardware-driven decision.
- `startStepContent`/prediction loop explicitly replays `videoFeed.play()` when
  switching steps "to prevent Chromium freezes on hidden element"
  (gesture-training-ui.js:918-921) — documented.
- bulk-importer.html actively patches `WebAssembly.validate` to force a non-SIMD
  MediaPipe WASM path, with an inline comment saying this "MUST run before
  hands.js loads" (bulk-importer.html:418-438) — documented as a stability
  workaround, target hardware not named in the comment itself but consistent with
  low-power ARM.
- KNN (not a real neural net) chosen for gesture classification, allowing
  "instant, no epoch training needed" (gesture-training-ui.js:269 comment) —
  documented as a deliberate design tradeoff, though the UI still displays an
  "epochs" label of 50 that no longer reflects actual behavior (see §3), which is
  an inconsistency, not an explained decision.

### 5. Constraints (Raspberry Pi / low-power specific)

- Kiosk viewport breakpoints explicitly targeted for a **1024×600** HDMI panel in
  both css/style.css (`@media screen and (max-height: 600px)`, line 507) and
  index.html's inline styles (`@media screen and (max-height: 620px)`,
  index.html:314, :476).
- Explicit Raspberry Pi mentions: index.html:819 comment — hidden preload iframe is
  "Commented out to prevent GPU/RAM resource crashes on Raspberry Pi during Voice
  to Text"; css/gesture-training.css:716 comment references "Chromium freezes on
  Pi"; bulk-importer.html:676 comment "CONVERT FOR RASPBERRY PI FIRST";
  gesture-training-ui.js:918 comment "Chromium freezes on hidden element."
- bulk-importer.html forces non-SIMD WASM (§4) — a stability accommodation
  consistent with constrained/older ARM hardware, though the code comment itself
  does not name Raspberry Pi explicitly at that site (bulk-importer.html:418-438).

### 6. Touches (dependencies / breakage risk)

- **index.html** loads `css/style.css`, `css/virtual-keyboard.css` (see Part 1),
  prefetches `js/lib/tf.min.js` and `js/lib/mediapipe/hands.js`/wasm/data
  (index.html:9-12) that are never referenced by `<script>` tags in this file — the
  prefetch is speculative for a page the kiosk expects to visit next; if those
  files move, the `<link rel="prefetch">` silently 404s with no functional break to
  index.html itself. Loads `js/vosk.js`, `js/script.js?v=5`,
  `js/virtual-keyboard.js` (index.html:749-751) — if `js/virtual-keyboard.js` (see
  Part 1) is missing, the on-screen keyboard silently fails; script.js does not
  check for its presence defensively beyond `closeKeyboard()`'s own DOM checks.
- **index.html** links to `sign-to-text.html` (index.html:582, :651) — documented
  in Part 1; if it moves/breaks, both the dashboard's "Translate Sign to Text"
  button and the Text-to-Sign nav's mode-switch link break.
- **script.js** depends on DOM ids defined only in index.html's inline
  `<style>`/body (e.g., `#start-btn`, `#sign-container`, `#lang-select`, hidden
  `#status`/`#download-history-btn` "kept for script.js compatibility",
  index.html:712-718) — if index.html's markup changes those ids, script.js's
  `getElementById` calls silently return `null` and later `.innerText`/`.value`
  accesses throw.
- **script.js → php/api/save_gesture.php**: `fetchAndRegisterCustomGestures()`
  (script.js:864-891) fetches `?no_sync=1` to merge custom-trained gestures into
  the sign-asset maps; if this PHP endpoint changes its JSON shape
  (`data.gestures[label]`), custom signs silently stop appearing in Text-to-Sign.
- **gesture-training.html** loads (documented in Part 1): `js/lib/tf.min.js`,
  `js/lib/mediapipe/hands.js`, `js/db-api.js`, `js/gesture-data.js`,
  `js/camera-helper.js`, `js/speech-synthesis.js`, `js/db-local.js`
  (gesture-training.html:10-16), plus `js/gesture-training-ui.js` and
  `js/virtual-keyboard.js`. `gesture-training-ui.js` directly calls global
  functions expected from these (`GestureDataRecorder.*`, `DB_API.saveTranslation`,
  `initCameraWithFallback`, `speakUtterance`) with only loose
  `typeof ... === 'function'` guards in some paths (e.g. gesture-training-ui.js:361)
  but not others (e.g. `DB_API.saveTranslation` at :714 is called unguarded inside
  a try/catch) — if any of those five files is missing/renamed, training/
  translation features degrade or throw, caught only where try/catch exists.
- **gesture-training-ui.js → php/api/save_gesture.php** (delete) and **→
  php/api/bulk_importer_api.php** (`convert_video`) — both use a hardcoded
  `/Sining_kamay/` fallback path (gesture-training-ui.js:244-246, :1064-1066) that
  does **not** match the dynamic `/SKR`-or-`/Sining_kamay` detection used in
  script.js:847-849 — an inconsistency (see Problems Found).
- **bulk-importer.html → php/api/bulk_importer_api.php** (`check_duplicate`,
  `convert_video`, `save_landmarks`) — always relative path `php/api/...`
  (bulk-importer.html:662, :689, :821), no `file://` fallback at all, unlike
  script.js/gesture-training-ui.js. If bulk-importer.html is ever opened via
  `file://` (as its unreachability from nav suggests could happen during dev),
  these fetches will fail outright.
- **reports.html → php/api/reports.php**: path logic keys off `location.port`
  rather than protocol+path-name pattern used elsewhere (reports.html:613-615), and
  hardcodes `/Sining_kamay/` (not `/SKR/`) for the `file:`/non-standard-port
  branch — another divergent hardcoded-folder-name instance.
- **learn-signs.html** embeds an external Netlify URL via `<iframe>`
  (learn-signs.html:87) — a live network dependency; if that Netlify deployment is
  taken down or the URL query-string token expires, "Learn Signs" shows a
  blank/broken iframe with no fallback UI in this file.
- **css/style.css** is shared by index.html but also contains selectors matching
  an older dashboard/translator layout no longer present in current markup — see
  Problems Found.

### Verify-only files — reachability verdicts

- **camera_test.html** (722 lines) — no `fetch`/`.php` calls found; not referenced
  from any other HTML/JS file in the app. **Confirmed orphaned/dead** relative to
  kiosk navigation.
- **diagnostic.html** (193 lines) — **NOT dead**: no inbound nav link, but it calls
  `php/api/save_gesture.php` directly (diagnostic.html:112-113,
  `fetch(SAVE_ENDPOINT)` at :121), confirming the Pass 1 finding.
- **gesture_test.html** (408 lines) — no `fetch`/`.php` calls found; no inbound
  references found anywhere in the repo's HTML/JS. **Confirmed orphaned/dead**.
- **speech_test.html** (223 lines) — no `fetch`/`.php` calls found; no inbound
  references found. **Confirmed orphaned/dead**.
- **preload.html** (69 lines) — loads `js/lib/tf.min.js` and
  `js/lib/mediapipe/hands.js` (preload.html:8-9) but has no PHP/fetch calls. Its
  only reference anywhere is the commented-out `<iframe src="preload.html">` at
  index.html:820. **Confirmed orphaned** (unreachable via any live path).
- **css/animate.css** (3199 lines) — grep across the full repo (all HTML/JS files)
  found zero `<link>` or `@import` references; only mentions are in this audit's
  own planning/docs markdown files. **Confirmed dead/unreferenced.**

### Problems found (Part 2)

- `css/style.css` lines 458-493 and 507-596 style classes (`.title-sining`,
  `.title-kamay`, `.dash-btn`, `.button-container`, `#dashboard-pane {
  grid-template-columns }`) that do not exist anywhere in current index.html
  markup (which uses `.system-title`, `.card-btn`, flex-based `.card-container`
  instead) — stale rules from an earlier dashboard redesign.
- Hardcoded install-folder-name inconsistency across owned files: script.js:847-849
  dynamically detects `/SKR` vs `/Sining_kamay`; gesture-training-ui.js:244-246 and
  :1064-1066 hardcode `/Sining_kamay/` only; reports.html:613-615 also hardcodes
  `/Sining_kamay/` and branches on port number instead of the `/SKR` path check.
  Three different fallback strategies for the same problem.
- gesture-training-ui.js:17 defines `const EPOCHS = 50` and the HTML
  (gesture-training.html:295) shows "0 / 50 epochs", but `trainModel()`
  (gesture-training-ui.js:422-562) never runs 50 iterative epochs — it's a KNN
  cache-merge with a cosmetic 10- or 20-step progress animation. The `EPOCHS`
  constant appears unused by the actual training path (no other reference to
  `EPOCHS` found in the file).
- index.html:819-820 — a commented-out `<iframe src="preload.html">`, explicitly
  left in with a Pi-crash-avoidance comment; `preload.html` is otherwise fully
  orphaned dead code (see verify-only section above).
- `learn-signs.html`:7 and most other owned HTML files load
  `https://fonts.googleapis.com/css2?...` (external network reference) — external-
  network dependency present despite the "fully offline" system description.
  Occurrences: index.html:13, gesture-training.html:7, bulk-importer.html:7,
  reports.html:7, learn-signs.html:7.
- `learn-signs.html`:87 embeds a third-party Netlify-hosted site via `<iframe>`
  with a Facebook click-id (`fbclid`) query string baked into the URL —
  external-network reference, factually noted.
- `bulk-importer.html` — confirmed unreachable from any in-app navigation link (no
  `<a href>`/`onclick` pointing to it in index.html or elsewhere); observation
  only, per project owner's framing this is planned work, not classified as a bug.
- `js/vosk.js`:174 — single-line, ~5.6MB minified/base64 blob; makes the file
  effectively unreadable/undiffable in normal review tools; this is vendored
  third-party code, not authored kiosk logic.

### Could not determine (Part 2)

- Whether `js/lib/tf.min.js`, `js/lib/mediapipe/hands.js`, `js/db-api.js`,
  `js/gesture-data.js`, `js/camera-helper.js`, `js/speech-synthesis.js`,
  `js/db-local.js`, `js/virtual-keyboard.js`, `css/virtual-keyboard.css` behave
  exactly as expected at runtime — documented in Part 1/VENDORED.md, not re-verified
  here.
- The reason voice input is disabled in Filipino mode (script.js:480-498) — not
  documented in code.
- The reason `EPOCHS = 50` / "0 / 50 epochs" label was retained despite the
  training function not using epochs — not documented in code.
