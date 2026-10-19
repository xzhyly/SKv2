# UI Layer

This document covers the kiosk's screens: the live translation screen (this
section) and the dashboard/training/admin screens (next section). Produced by two
parallel Pass 2 subagents from static reading of the code, cited by file and line.
Values not found in code are marked "not specified in code" rather than estimated.

**`camera-translator.html` is not a live screen** — see the note at the start of
Part 1 before reading further.

---

## Phase 3a: loading behavior (read this before the per-file sections below)

Phase 3a changed *when* scripts load and run, not what they do. The per-file
detail below (written pre-Phase 3a) is still accurate for behavior; this
section is the current state of load order.

- **Every vendored/helper `<script src>` tag on `camera-translator.html`,
  `gesture-training.html`, `sign-to-text.html`, and `index.html` now carries
  `defer`.** Previously all were plain synchronous tags — `tf.min.js`,
  `hands.js`, and their helpers sat in `<head>` and blocked the parser from
  building the rest of the document (PIN screen included) until they
  finished downloading and executing. `defer` preserves the same relative
  execution order among them, but lets the parser build the DOM immediately
  and download scripts in parallel with parsing instead of blocking on them.
  One consequence: `index.html`'s bottom-of-body inline script patched
  `window.handleRecognizedText` (defined in `js/script.js`) at parse time;
  since inline scripts ignore `defer` and still run at their document
  position, that check is now wrapped in a `DOMContentLoaded` listener so it
  runs after `js/script.js` has actually executed. `diagnostic.html` also
  loads `tf.min.js`/`hands.js` in `<head>` but was left un-deferred — it's an
  unlinked dev tool outside the kiosk's navigation, out of this phase's scope.
- **`js/script.js:533`'s `recognition.initModel()` — which pulls the 41 MB
  Vosk model, decodes `js/vosk.js`'s worker, and compiles the Kaldi decoding
  graph — now only runs when `isVoiceScreen` is true** (i.e. on the
  `?screen=voice` navigation), not on every `index.html` load. This was the
  single largest resource-loading defect found in the whole audit; see
  `docs/system/DEBT.md` item 32.
- **`index.html`'s `<link rel="prefetch">` block** now targets
  `hands_solution_wasm_bin.wasm` (the non-SIMD binary MediaPipe actually
  requests — `js/gesture-data.js:230-238` rewrites every SIMD request to this
  filename) and `hand_landmark_full.tflite` (the hand-landmark model, always
  requested since every call site pins `modelComplexity:1`), instead of the
  never-used `hands_solution_simd_wasm_bin.wasm`. See `docs/system/DEBT.md`
  item 20.
- **Not changed:** `camera-translator.html?screen=translate`'s
  `tlInitCamera()` still fires at script-parse time with no click gate —
  recorded as an open question in `docs/system/DEBT.md` item 31, not fixed.
  Camera-start on `gesture-training.html` (`enableCamBtn` click) and
  `sign-to-text.html` ("Start Translating →" click) were already lazy before
  this phase and are unchanged.
- **Found, not fixed:** `camera-translator.html`'s entire inline `<script>`
  block has a pre-existing (not Phase-3a-introduced) syntax error — an
  unclosed `else{` — that throws `SyntaxError: Unexpected end of input` and
  prevents that whole block, and therefore all of this file's application
  logic, from executing in any browser. See `docs/system/DEBT.md` item 30.

### Measured result

`index.html`'s `domInteractive` — real Chrome, 1024×600, median of three hard
reloads (cache disabled), measured by the project owner:

| | Before | After |
|---|---|---|
| `domInteractive` | 3,005 ms | 156 ms |

Not an estimate. This is almost entirely the Vosk defer fix (the eager
`recognition.initModel()` call removed above) — `index.html` never loaded
`tf.min.js`/`hands.js` as blocking `<script>` tags to begin with (only
`<link rel="prefetch">`), so the script-defer change above had little further
`domInteractive` impact on this specific page; its effect is on the PIN
screens and camera screens, which loaded those libraries synchronously.

---

## 1024×600 layout fixes (read this before the per-file sections below)

This phase fixed the four problems in `docs/system/UI-SURVEY-1024x600.md`, measured
from the live DOM at 1024×600. It is layout plus the keyboard's dismissal event;
no application logic changed. The per-file sections below were written before it.
Where they describe the files touched here, this section is current. Before/after
numbers for each fix are in the survey document.

- **Voice screen, keyboard open** (`index.html:463-493`, `:516`;
  `docs/system/DEBT.md` items 34–35). `js/virtual-keyboard.js` signals open/close
  only by toggling `.show` on `#sk-global-keyboard` and `.keyboard-active` on
  `<body>` and `<html>` (`showKeyboard()`/`hideKeyboard()`,
  `js/virtual-keyboard.js:99-117`). There are no events or inline styles. While
  `body.keyboard-active` is set and the viewport is at most 1146 px tall, the mic
  button, "Tap to Speak", the English/Filipino toggle and "— OR —" are
  `display:none`. The controls move to the top of the panel, and `#ttsBody` gets
  back the resting size that `css/virtual-keyboard.css:94` overrides. The
  MICROPHONE INPUT dropdown stays. The transcript follows its existing
  `.tts-live-text:empty` rule (`index.html:178`): hidden while empty, visible while
  it holds recognised speech. 1146 px is the measured largest height at which the
  keyboard still overlaps (comment at `index.html:471-476`). These rules replace,
  in place, an earlier `#ttsBody.keyboard-active` attempt whose selectors could
  never match. With the keyboard closed nothing changes, at any height. Hiding is
  instant (no transition).
- **Keyboard dismissal** (`js/virtual-keyboard.js:73-76`). An outside tap now
  closes the keyboard on `click`, not `pointerdown`. On `pointerdown` the voice
  screen's layout was restored mid-tap, so a tap on Translate landed on the
  microphone button. Consequences, all in the shared component:
  - the keyboard closes after the tapped control has received its click;
  - a drag or scroll that starts outside the keyboard no longer closes it;
  - a tap on a disabled control (e.g. Translate with an empty input) fires no
    `click`, so the keyboard stays open.
  On `gesture-training.html` nothing moves when the keyboard closes except the
  scrollbar (`DEBT.md` item 39), so the earlier behaviour there was harmless and
  the new one is equivalent.
- **Sign-to-text guide** (`css/sign-to-text.css:256-260`, `:293-312`;
  `sign-to-text.html:118-134`; `DEBT.md` item 37). The guide card can no longer
  grow past its container. The step list is the only part that gives up height
  and scrolls inside the card, so the badge, title, description and "Start
  Translating →" stay in view. The button's distance from the screen edge is
  fixed (73 px at 1024×600). While part of the list is below its visible area,
  its bottom 40 px fades out via a CSS mask on `.tl-instr-list.has-more`. A
  layout-only inline script sets that class at parse time, on scroll, and from a
  `ResizeObserver` on the list and its items. Where the card already fits
  (768 px tall and up) every element in it is where it was.
- **Reports tables** (`reports.html:71-79`; `DEBT.md` item 38). The Created column
  is 150 px (was 136), wide enough for any `YYYY-MM-DD HH:MM:SS` in 12 px Inter.
  Label/Sign and Text cells and the Key pills wrap (`white-space: normal;
  overflow-wrap: anywhere`) instead of ending in an ellipsis. Rows with short text
  keep their height.
- **Found, not fixed:** recognised speech never reaches the text input (`DEBT.md`
  item 36, medium). Opening the keyboard on `gesture-training.html` adds a
  scrollbar and narrows the page from 1024 to 1016 px (item 39). A transcript of
  about 8+ lines could still push Translate under the keyboard (item 40). The
  changed files carry no cache-busting query string (item 41).
- **Could not verify here:** real touch and mouse input, since the automation
  browser dispatches events but draws no frames. That covers the tap-on-Translate
  path, the dropdown opening while the keyboard is up, and `ResizeObserver`
  delivery. Listed for a person in `docs/system/MANUAL-CHECKS.md`.

---

## Part 1: Sign-to-Text Screen (and the archived Camera Translator)

> **`camera-translator.html` was archived in Phase 3a — it is not a live
> screen.** Its inline `<script>` has an unclosed brace that throws
> `SyntaxError: Unexpected end of input` in every browser, present identically
> at baseline, after Phase 1, after Phase 2, and at HEAD before archival —
> confirmed via `node --check`. None of its application logic has ever
> executed. It now lives at `archive/camera-translator.html`; see
> `archive/CAMERA-TRANSLATOR.md` and `docs/system/ML.md` for the full finding.
> Everything below that describes `camera-translator.html` describes what its
> *code says*, written before this was discovered — not behavior that has ever
> run. `sign-to-text.html` is unaffected and is the only live screen in this
> section.
>
> **Update 2026-09-21: `sign-to-text.html` is now archived too**
> (`archive/sign-to-text.html`, see `archive/SIGN-TO-TEXT.md`) — its camera UI
> was merged into `talk.html`'s signing screen (Part 3a). Everything below that
> describes it describes the page as it ran until then; the recognition logic
> it used (`js/sign-to-text-ui.js`) is still live, loaded by `talk.html`.

### 1. Owns these files

- `sign-to-text.html` (live)
- `archive/camera-translator.html` (archived, never executed — see above)
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

`sign-to-text.html` turns hand gestures seen by the USB camera into
spoken/written words: an onboarding guide, then a live camera view with a
skeleton overlay, a start/stop gesture workflow that accumulates a sentence,
and a result screen with speak/copy/clear/save actions and a volume slider.

`camera-translator.html` (archived, never executed — see above) was written as
a dual-purpose page: with `?screen=translate` in the URL it would have
rendered a near-identical translate-only screen; without that parameter it
would have rendered a 4-step "Add Data → Train AI → Predict → Translate"
gesture-training wizard using a TensorFlow.js classifier instead of the k-NN
below. None of that ran.

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
  40, sampled every 90 ms (was `js/gesture-data.js:2-4,18` at the time this section
  was written; **stale citation, not live code** — this was the old
  camera-translator.html/sign-to-text-ui.js live-capture pipeline, and
  `FRAME_TARGET`/`captureFrameIfRecording()` were both removed from
  `js/gesture-data.js` entirely by the 2026-09-26 video-based gesture
  capture phase, see `docs/system/DECISIONS.md`; only a comment at
  `js/gesture-data.js:2` still refers to the removed constant, for context).
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
  **Superseded 2026-10-16 (compact-model phase):** `knnPredict` is now `js/sign-to-text-ui.js:109-148`
  (unchanged text) and the model is no longer cached in `localStorage`: `autoTrainForTranslate()`
  (`:150-174`) loads the compiled `models/knn_<LANG>.bin` through `js/knn-model-store.js` (IndexedDB copy).
  See Part 3 "3f" and `docs/system/ML.md` "Compact model".
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
- Both HTML files load `css/fonts.css` (`camera-translator.html:7`,
  `sign-to-text.html:7`), which self-hosts the Inter variable font from
  `assets/fonts/Inter-Variable-latin.woff2` — replaces the Google Fonts CDN
  `<link>` both files used to load (Phase 2, see `docs/system/DEBT.md` item 1).
  `Nunito`, which that old CDN call also fetched, is still named as a fallback
  in both files' `font-family` stacks but is never itself loaded now — dead
  weight, see `docs/system/DEBT.md` item 27.
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
- `js/virtual-keyboard.js` + `css/virtual-keyboard.css` are loaded by `index.html`
  and `gesture-training.html` (and by the archived `camera-translator.html`);
  `sign-to-text.html` does not load them. *(Corrected in the 1024×600 layout
  fixes. This line previously said "only by `camera-translator.html`".)* The
  keyboard's contract with the pages that load it is the `.keyboard-active` class
  on `<body>`/`<html>` and the `.show` class on `#sk-global-keyboard`:
  - `index.html:463-493` keys its typing layout on `body.keyboard-active`.
    Renaming or moving that class silently brings back the covered-input bug
    (`docs/system/DEBT.md` item 34). Putting it on another element, as the old
    `#ttsBody.keyboard-active` rules assumed, does the same (item 35).
  - Changing the outside-tap dismissal back to `pointerdown`
    (`js/virtual-keyboard.js:76`) makes a tap on the voice screen's Translate
    button land on the microphone button.
  - `css/virtual-keyboard.css:80-101`'s `body.keyboard-active` rules are
    overridden for `#ttsBody` by `index.html:486-489`; editing them changes
    `gesture-training.html`'s open-keyboard layout (item 39).
- `sign-to-text.html:118-134` (inline scroll-cue script) depends on
  `.tl-instr-list` and `.tl-instr-item` existing when it runs, and on
  `css/sign-to-text.css:306-312` defining `.has-more`. Renaming the list class
  throws on page load; removing the CSS rule leaves the class with no effect. The
  guide's fixed Start-button headroom depends on `.tl-instr-card` keeping
  `min-height: 0` and on `.tl-instr-list` being its only child that may shrink
  (`css/sign-to-text.css:256-260`, `:293-305`). A new child element added to the
  card will not shrink, which is intended: it takes height from the list.
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
- ~~External network reference: `camera-translator.html:7` and `sign-to-text.html:7`
  — `<link href="https://fonts.googleapis.com/css2?family=Inter:...&family=Nunito:...&display=swap" rel="stylesheet">`.~~
  **RESOLVED (Phase 2)** — both files now load `css/fonts.css` (self-hosted
  Inter), see `docs/system/DEBT.md` item 1.
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

> **Update 2026-10-18 (accounts-quiz phase):** the dashboard has three cards for everyone (Learn Signs, Let's Talk,
> Quiz) and an account area top-right; Train Gestures and View Reports moved into the admin account menu. Every
> admin page (gesture-training, reports, bulk-import, avatar-clips, diagnostic, users) sends a non-admin to the
> dashboard before it shows. Since owner answer (a) the same day there is **no PIN anywhere**: a logged-in admin gets
> each admin page at once. Every "PIN-gated" / "PIN pad" / `CORRECT_PIN` / `sk_train_unlocked` description
> below describes the pages before 2026-10-18. See Part 4.

> **Update 2026-09-21:** `index.html` is now a pure dashboard. `#translator-pane` (the text/voice-to-sign screen,
> `?screen=voice`) and `js/script.js` were retired into `talk.html`'s Speak or Type screen (Part 3b; archived at
> `archive/script.js`, see `archive/TEXT-TO-SIGN-PANE.md`). Anything below that describes that pane, its `?screen=voice`
> entry point or `js/script.js` describes the code as it was until then.

### 1. Owns these files

- `index.html`
- `js/script.js`
- `js/vosk.js`
- `gesture-training.html`
- `js/gesture-training-ui.js`
- `css/style.css`
- `css/gesture-training.css`
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
- **reports.html** — PIN-gated admin analytics screen: 3 tabs (ESL Signs, FSL
  Signs, Conversations — was Translations before the 2026-09-25
  saved-conversations phase replaced it, see below) pulling from a
  PHP/MySQL-backed report endpoint, with print/PDF export.
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
  (`GESTURE_HOLD_MS`, gesture-training-ui.js:9, used at :1117; re-measured 2026-10-16, was :10).
- **Superseded 2026-10-16 (compact-model phase):** Step 2 no longer trains. The button is **Compile**, the
  progress row reads "Compile progress" / "Not started" (`gesture-training.html:292`), and `trainModel()` is
  gone; see "Compact recognition model: Train Gestures" below. `EPOCHS = 50` is still declared
  (gesture-training-ui.js:15) and still unused. The bullet as written:
- "Training" epoch UI displays **"0 / 50 epochs"** and constant `EPOCHS = 50`
  (gesture-training-ui.js:17 at the time, HTML gesture-training.html:261) — but the actual
  `trainModel()` function does not run 50 real epochs; it is a KNN cache compile
  with a cosmetic progress-bar animation of **20 steps × 18ms**
  (gesture-training-ui.js:531-537) or **10 steps × 12ms**
  (gesture-training-ui.js:502-505) when nothing new needs compiling. The 50-epoch
  label is not reflected in the actual training logic — reason not documented in
  code.
> **Update 2026-10-04 (sign-texts phase, "one sign, two texts"):** the "Gesture Name" field described in
> the Step 1 bullets below no longer exists. Step 1's Sign Set has three options (ESL | FSL | Both) and two
> text fields replace Gesture Name (English text, Filipino text; each shown field required); the key
> (folder/label slug) is derived from the text, never typed. The View Active Gesture Dataset modal gained
> columns for both texts and the set, a search over key and both texts, and an edit panel. Wherever the
> text below says "Gesture Name", "label" in the form, or describes the modal's old columns/search, read
> the current behavior in "Sign texts: Step 1 form, model toggle, dataset editing" below. The recording
> flow itself (Ready → Countdown → Recording → Review → Processing → Saving → Done) is unchanged.
- **Step 1 (Add Data) recording flow — replaced 2026-09-26 (video-based
  gesture capture phase).** Below describes the flow as it now is; the older
  countdown-then-frame-sampling flow this replaced is described afterward,
  for anyone reading an older report or diff against it.
  - **Current flow: record first, extract offline, save 3 reps.** The Add
    Data form's one button (`#startGestureDataBtn`, "Record 3 samples",
    `gesture-training.html:224`) calls `openRecordingMode()`
    (`js/gesture-training-ui.js:1325-1342`), which reads the Gesture Name,
    Sign Set and Type from the form and opens a full-screen mode
    (`window.GestureCaptureUI.open()`, `js/gesture-capture-ui.js:183-202`;
    markup `#gcMode`, `gesture-training.html:357`) that owns the rest of the
    flow end to end: **Ready** → **Countdown** (3-2-1 at 1000ms/tick,
    `js/gesture-capture-ui.js:304-321`) → **Recording** (a `MediaRecorder`
    capture of the live camera stream, guided live by the shared
    `GestureCaptureCore` segmenter reading `js/gesture-data.js`'s hand
    results — REST → SIGN 1 of 3 → SIGN 2 of 3 → SIGN 3 of 3, hand-driven
    with no fixed per-rep timer, `js/capture-core.js`; the whole take is
    capped at `MAX_RECORDING_MS` 90000, `js/capture-core.js:20`, checked
    in the segmenter at `:80-84` — reaching it before the 3rd sign's rest
    stops and discards the recording with "Recording too long. Try again."
    and Redo (Cancel top-right), `js/gesture-capture-ui.js:33`, `:416-419`, `:617`;
    added 2026-09-27, owner decision) → **Review** (the
    recorded clip plays back with the live rep count, Save disabled unless
    exactly 3 reps were found) → **Processing** (`js/video-landmarks.js`'s
    `extractVideoLandmarks()` seeks the recording frame-by-frame at
    `PROCESS_FPS` 15 through the one shared MediaPipe `Hands` instance,
    then `js/capture-core.js`'s `segmentFrames()` re-derives the 3 rep
    boundaries offline — the real gate, not the live count) → **Saving**
    (3 sequential POSTs to `save_gesture.php`, one v3 raw sample per rep,
    never any video) → **Done**, closing the mode and toasting "N of 3
    samples saved for "label"."). Every exit (Done, Redo, Cancel, a hard
    error, or the page unloading) discards the recording, its Blob/object
    URL, and any held detector — the video never leaves the browser. See
    `docs/system/DECISIONS.md` ("video-based gesture capture phase") for
    every threshold, the offline-vs-live gate, and the measured Task 6 e2e
    numbers.
  - **Layout (capture UI layout fix, 2026-09-27; report
    `docs/reports/2026-09-27-capture-ui-final.md`).**
    - **Step 1 has no camera.** In Step 1 the camera panel (`.tr-right-panel`:
      `#cameraFrame`, `#videoFeed`, Camera Ready / Searching badges, Enable
      Camera) is moved off-screen, exactly as Step 2 already did, not
      `display:none`: the live MediaPipe loop keeps reading `#videoFeed` while
      the recording mode is open, and a `display:none` video freezes Chromium
      on the Pi (`css/gesture-training.css:1058-1068`).
    - **Two-column form.** The form uses the full width in two columns
      (`.tr-s1-grid`, `gesture-training.html:198-250`,
      `css/gesture-training.css:1069-1089`). Left: Gesture Name, Sign Set,
      Type. Right: Record 3 samples (72 px tall), the sample-count line, View
      Active Gesture Dataset, Export Data / Load Saved, Next: Train AI (renamed "Next: Compile →",
      `gesture-training.html:267`, 2026-10-16).
      Back to Instructions spans the bottom. Inputs and toggles are 48 px tall.
    - **The recording mode starts the camera.** Its first state is
      **Starting camera**: `showStarting()`
      (`js/gesture-capture-ui.js:250-281`) calls the page's
      `acquireCaptureCamera()` (`js/gesture-training-ui.js:1130-1140`), which
      reuses a live stream or runs the shared `startPageCamera()` (`:1064-1098`,
      also behind Steps 3/4's Enable Camera). START stays disabled, labelled
      "Starting camera…", until the first live hand-tracking result arrives
      (`READY_TIMEOUT_MS` 60000, `js/gesture-capture-ui.js:41`, then "Hand
      tracking is not ready. Please try again.").
    - **Camera errors show inside the mode**, in English
      (`cameraErrorText()`, `js/gesture-training-ui.js:1121-1128`), with
      Redo (Cancel is the top-right button).
    - **Hand-tracking warm-up at page load (owner follow-up, 2026-09-27).**
      `warmUpHandTracking()` (`js/gesture-training-ui.js:1237-1264`, called at `:1223`) runs at the start of the
      page's `DOMContentLoaded` handler. It loads the ONE MediaPipe Hands instance
      (`preloadMediaPipe`: WASM + model, results loop paused, no camera) and then runs one
      detection on a blank 320x240 frame through `createVideoDetector()`. That first
      inference, not the model load, was the ~11 s of "Starting camera…". Every
      recording-mode open and Steps 3/4's Enable Camera reuse the instance.
      - Cost: the first inference is one main-thread long task (11,785 ms measured in
        headless Chrome on this laptop). It runs about 1.3 s after navigation, i.e. while the
        PIN screen is up. Taps during it are queued, not lost.
      - Measured with `tests/video-capture/startup-check.mjs`: Starting camera → START
        enabled took 1,858 / 1,505 ms on the first open (was 15,410 / 12,929 ms) and
        278 / 176 ms on the second open (was 131 / 148 ms).
      - Steps 2-4 are unchanged within noise: Train AI 4,049 / 4,593 ms (was 4,084 /
        3,993 ms), Step 3 camera to first result 184 / 178 ms (was 148 / 174 ms), 0 console
        errors.
      - `window.handTrackingWarmUp` resolves to `{ ok, ms }`.
    - **Closing releases the camera.** `close()` calls `releaseCaptureCamera()`
      (`:1142-1155`). That stops the tracks and pauses the live loop only if
      the recording mode started the camera. A camera already running for
      Steps 3/4 is left as it was.
    - **The mode is full-viewport and landscape** (`.gc-mode`,
      `css/gesture-training.css:958-962`): `position:fixed`, 100vw × 100vh,
      no margin or radius, a 3-row grid of top bar (`auto`) / media (`1fr`) /
      bottom bar (`auto`). No pixel height is set for the video.
    - **Top bar:** the label chip (wraps to 2 lines rather than truncating),
      the state title (Starting camera… / READY / GET READY / REST / SIGN n of
      3 + dots / REVIEW · N signs found / PROCESSING NN% / SAVING n of 3 / the
      error text) and Cancel (hidden while saving; the bar keeps a 72 px
      minimum so the media row does not jump).
    - **Media:** the live feed or the review loop fills the row,
      `object-fit: contain`, mirrored for display. The "Hand visible / No
      hand" pill sits in the top-left corner and hints are a banner over the
      bottom of the video.
    - **Bottom bar:** the state's buttons in one row, `flex: 1` each, at
      least 56 px tall (START; Save | Redo; Redo alone in error states; Retry save
      alone after a failed save - Cancel is only ever the top-right button, owner follow-up
      2026-09-27), or a status line (countdown, "REC m:ss …" while recording,
      saving), or the progress bar (processing).
    - **Measured (headless Chrome 153, fake camera,
      `tests/video-capture/screenshots.mjs`):** no scrollbar in any state at
      1024×600 or 1280×720, every overlay button ≥ 44×44 (bottom bar
      ≥ 56 tall), and no top-bar overlap. The media row is 1024×450 at
      1024×600 and 1280×570 at 1280×720. START became enabled 11,055 ms /
      10,963 ms after the mode opened (first camera start + MediaPipe load).
  - **The per-word sample-count line survives from the older flow,
    unchanged in behavior.** `#sampleCountLine` (`gesture-training.html:225`)
    is still driven by `refreshSampleCountLine()`
    (`gesture-training-ui.js:313-327`); the count still comes from a
    per-(sign set, label) tally kept in `savedSampleInfo`, rebuilt from the
    dataset on every load/reload (`rebuildSampleInfo()`, `:298-304`) and
    updated after each save via `window.onCaptureSamplesSaved`
    (`js/gesture-training-ui.js:1348-1351`, called by
    `js/gesture-capture-ui.js:706-712` once `reloadDataset()` has already
    recounted the new samples — no `frameCount` is passed here, so the line's
    "(N frames)" figure comes entirely from that recount, not from the save
    response). `SAMPLE_TARGET = 5` (`gesture-training-ui.js:267`), and the
    line still moves through three states as the count grows: "is a new
    word — no samples yet," "N sample(s) saved … aim for 5," and "✓ Target
    reached; more are optional" (`:320-326`). Styling unchanged:
    `.tr-sample-line` (`css/gesture-training.css:947-949`).
  - **What the button itself does is different from the older flow's
    "Record another sample" relabeling.** The button's text is now the
    static "Record 3 samples" set once in markup
    (`gesture-training.html:224`) and reasserted by
    `refreshSampleCountLine()` on every call (`startBtn.textContent =
    'Record 3 samples'`, `gesture-training-ui.js:319`) — it no longer
    relabels itself based on the word's existing sample count, since the new
    flow always records exactly 3 reps per invocation regardless of how many
    samples the word already has.
  - **Older flow (removed 2026-09-26), for reference only — not live
    code.** Before this phase, Step 1 had no full-screen mode: a countdown
    (3-2-1 at 1000ms/tick, was `gesture-training-ui.js:1219-1233`) started a
    live per-frame capture loop directly inside the training screen's own
    DOM (`#step1PreviewControls`, `#countdownOverlay` — both removed), the
    Start button read "Start Capture" for a word's first sample and
    relabeled itself "Record another sample" once it had ≥1 saved sample,
    and a zoom/pan preview panel (`#previewSampleLine`,
    `gesture-training.html:257` at the time) showed the just-captured
    frames before saving. None of `gesture-training-ui.js:1219-1233`,
    `#step1PreviewControls`, or `#countdownOverlay` exist in the current
    file/markup — grep-confirmed absent from `gesture-training.html` and
    `css/gesture-training.css`.
- **Step 1 gained a Type selector, and the dataset table/modal is now
  grouped by it (gesture-categorization phase, 2026-09-23):** a 4-way
  segmented control — Word / Letter / Number / Phrase
  (`name="gestureCategory"`, gesture-training.html:215-218, `.tr-type-toggle`
  four-column variant of `.tr-sign-toggle`, css/gesture-training.css:160) —
  sits under Sign Set. `autoSelectCategory()` (gesture-training-ui.js:223-234)
  checks the radio matching the current label+sign set's stored category
  (from `GestureDataRecorder.getSavedCategories()`, gesture-data.js:655-657)
  if one exists, else `GestureCategory.guess(label)` (js/gesture-category.js,
  a pure heuristic mirrored from `php/api/gesture_category.php`'s
  `gesture_category()`, parity-tested); it re-runs on the Gesture Name
  `input` event and the Sign Set `change` event (gesture-training-ui.js:1206,
  1208) and after every `renderSavedDataset()` (gesture-training-ui.js:328),
  but a manual tap on a Type option is not overridden by those triggers
  until the name or sign set actually changes. Saving a sample with a
  different Type than the label currently has re-tags that label
  (`js/gesture-data.js:552-555` reads the checked radio and passes it as
  `category` in the save payload).
  The View Active Gesture Dataset modal shows **one tab per category**
  (follow-up, 2026-09-24; this replaced the single list with section headers
  that shipped on 2026-09-23). The tabs are Words · Letters · Numbers · Phrases
  (`DATASET_TABS`, gesture-training-ui.js:88), each labelled with its total
  count (`"Words · 117"`), and Words is the default on every open
  (`trOpenDatasetModal()`, :92). The tabs use `.tr-ds-tab`
  (css/gesture-training.css:693-721), which has the same navy selected state
  as the Sign Set and Type toggles.
  - **Search box** (`#datasetSearch`, gesture-training.html:349). It filters
    only the active tab's rows, by label substring, case-insensitive, as you
    type. The query is kept when you switch tabs and cleared when the modal is
    opened again. A search with no results shows a single "No matches" row
    (gesture-training-ui.js:140); an empty category with no query shows "No
    gestures in this category yet."
  - **Where the data comes from.** `renderSavedDataset()` (:330) now only
    groups the labels into `datasetGroups`. The stored category wins,
    otherwise the heuristic guess is used, the same lookup as the Type
    selector, and rows are sorted alphabetically within each category.
    `trRenderDatasetView()` (:109) draws the tabs, search and table from that
    data. It runs on open, on tab click, on every keystroke, and at the end of
    every `renderSavedDataset()`.
  - **Delete now updates the open modal in place**, keeping the tab and the
    query. Before this, the modal was a one-time copy of the hidden
    `#gestureDatasetTableWrap` table, which now only holds the empty/error
    message. The Delete button and `deleteGesture()`, including its
    `confirm()` text, are unchanged.
  - **On-screen keyboard.** It normally sits at z-index 9999, below this
    modal's overlay (11000). While the modal is open it is raised to 11001,
    and the card is top-aligned and capped at `100vh - 280px - 16px` so it
    fits above the 280px keyboard (css/gesture-training.css:725-733). Measured
    at 1024×600: the card spans y=8–312 with the keyboard open, and y=48–552
    with it closed.
  - The dataset counter (`#datasetCount`, gesture-training.html:236) changed
    from "N categories" to "N gestures" (gesture-training-ui.js:342).
    "Categories" now means word/letter/number/phrase, so the old wording
    would have been ambiguous.
- **Sign texts: Step 1 form, model toggle, dataset editing (sign-texts phase, 2026-10-04; plan
  `docs/reports/2026-10-04-sign-texts-step1.md`; storage and endpoints `docs/system/BACKEND.md` "One sign, two
  texts").** All measurements below are real Chrome at 1024×600 driven over CDP by the scripts in
  `tests/sign-texts/` (`.git/sdd/st-task-4-report.md`, `st-task-5-report.md`, `st-task-7-report.md`).
  - **Step 1 form** (`gesture-training.html:198-250`, `css/gesture-training.css?v=1.0.10`, `gesture-training.html:8`).
    Left column: **Sign Set** — a 3-way toggle ESL | FSL | Both (`.tr-sign-toggle-3`, `css/gesture-training.css:160`;
    radio values `ESL`/`FSL`/`BOTH`, `name="gestureDatasetType"`, `gesture-training.html:202-206`); **English text**
    (`#signTextEn`) and **Filipino text** (`#signTextFil`), each in its own wrapper (`#signTextEnGroup`,
    `#signTextFilGroup`, `:208-215`) and each `maxlength="255"` (matching the server's 255 cap); then **Type**
    (unchanged). ESL shows the English field only, FSL the Filipino field only, Both both
    (`updateTextFieldVisibility()`, `js/gesture-training-ui.js:426-431`: only the wrapper hides). The old Gesture Name
    field and `currentLabelClean()` are gone; `currentKey()` (`:421-425`) derives the key from the shown text with
    the same rule as the server (`GestureDataRecorder.cleanLabel`, = `clean_label`; English for ESL/Both, Filipino
    for FSL). Texts keep their casing and punctuation. Measured keys: "How are you?" → `how_are_you`; FSL "Kumusta
    ka?" → `kumusta_ka`.
  - **Measured layout (Step 1)**, group y / height: ESL — Sign Set 68/69, English text 151/69, Type 234/69; FSL —
    Sign Set 68/69, Filipino text 151/69, Type 234/69; Both — Sign Set 68, English 151, Filipino 234, Type 317 (all
    69 tall). The text inputs are 48 px tall; the lowest text-input bottom is **220** (ESL/FSL) and **303** (Both),
    both ≤ 320, the top of the 280 px on-screen keyboard at 600 − 280 (so a focused input is not covered). Back to
    Instructions at y=548. `scrollWidth × scrollHeight` 1024×600 in all three; every control ≥ 44 px (14 controls
    in ESL/FSL, 15 in Both). 48 PASS lines, 0 console errors (`tests/sign-texts/step1-check.mjs`).
  - **Validation and collision.** Record with an empty shown field does not open recording mode and toasts "Enter
    the English text first." (ESL, and Both when English is empty) or "Enter the Filipino text first." (FSL, and
    Both when only Filipino is empty) (`openRecordingMode()`, `:1553-1558`; a key that cleans to empty toasts
    "Enter the English|Filipino text with at least one letter or number."). The status line under the form
    (`refreshSampleCountLine()`, `:474-495`) follows the key: new key → "“key” is a new word — no samples yet. Aim
    for 3."; existing key of the **same** set → its sample/frame count; existing key of a **different** set
    (`conflictingSign()`, `:469-473`) → "“key” already exists as <ESL|FSL|Both> — change it in View Active Gesture
    Dataset first." and **Record is disabled** (`:479-482`; `.tr-record-btn:disabled`, `css/gesture-training.css:179-180`).
    This mirrors the server's HTTP 409 (`save_gesture.php:497-505`), which is the backstop. Measured against live
    data: ESL "Hello" (live `hello` is a Both sign) → "already exists as Both", Record disabled; Both "Hello" +
    "Kumusta" → sample line, Record enabled; switching the set to ESL clears the line.
  - **Type** auto-selection looks up the stored category by key — ESL map then FSL map, FSL first for an FSL form
    (`storedCategoryFor()`, `:434-441`) — else the heuristic on the key (`autoSelectCategory()`, `:445-452`). A Both
    sign has one category (BACKEND: category stays DB-only). A manual Type tap survives until a text or the set
    changes (measured: `how_are_you` stored `phrase`).
  - **Recording** passes `{label: key, signSet, textEn, textFil, category}` into `GestureCaptureUI.open()` (hidden
    field's text is passed as `null`, `:1569-1577`). `js/gesture-capture-ui.js` stores the texts in its session, the
    chip reads `<text> · <ESL|FSL|Both> · <Type>` (text = English for ESL/Both, Filipino for FSL, label fallback),
    the texts travel in `saveGestureSample`'s `meta` (`textEn`/`textFil` → `text_en`/`text_fil`), and after a save
    the cached models of every language the set belongs to are invalidated (Both → ESL **and** FSL). A 409 shows the
    server's message in the capture UI's error state (see DEBT: its Retry save offers the same failing save).
    **Measured end to end** (`tests/sign-texts/verify-e2e.mjs`, 80 PASS; fake camera): a Both sign "Zz Both Probe?" /
    "Zz Pareho Probe?" Type Phrase, 3 samples → chip "Zz Both Probe? · Both · Phrase", Ready in 1250 ms, Review
    "3 signs found", exactly one folder `saved_gestures/zz_both_probe` with 3 samples and a `sign.json` (BOTH),
    nothing in `saved_gestures_fsl/`, sample `signLanguage` ESL ×3, DB row BOTH with both texts, category `phrase` under
    both `categories` maps. (Probe signs were deleted afterwards.)
  - **Update 2026-10-16 (compact-model phase):** the toggle stays, but it now chooses which model file
    Compile builds and Steps 2-4 load. Switching runs `onModelLanguageChanged()` (`js/gesture-training-ui.js:972-975`):
    the status line for that language, then `loadModelForLang()` (`:698-722`) loads that file, so Next shows at once
    when the file is usable. Compile locks the radios (`compileModelGuarded()`, `:782-791`). FSL now also holds
    `start` and `stop`. `modelLanguage()` is `:658-661` and `syncModelToggleToStep1()` `:978-984`. "Train",
    "trains", "cached model" and the `:728` filter below describe the code before this phase; see "Compact
    recognition model: Train Gestures" below.
  - **Step 2 — "AI model" toggle** (`#trainModelGroup`, ESL | FSL radios `name="trainModelLang"`,
    `gesture-training.html:260-265`; buttons 48 px, `#leftStep2 .tr-sign-opt`, `css/gesture-training.css:1123`).
    Training uses `modelLanguage()` (`js/gesture-training-ui.js:629-633`) instead of Step 4's chip: ESL trains on ESL
    and Both signs, FSL on FSL and Both signs (`:728`). Each time Step 2 is shown the toggle starts from Step 1's set
    (FSL → FSL; ESL and Both → ESL; `syncModelToggleToStep1()`, `:669-677`). Switching to a language with no cached
    model marks the model untrained: Next is hidden and the Train button resets (`onModelLanguageChanged()`,
    `:653-667`). The toggle is **locked while training runs** (`#trainBtn` calls `trainModelGuarded()`, `:636-644`,
    which disables the radios and always re-enables them in `finally`). Measured: toggle group y=80, 67 tall, buttons
    48 px; summary card y 153–393 (240 tall); Train button y 511–551; Back y 557–580; scroll 1024×600. ML side of this:
    `docs/system/ML.md`.
  - **Step 3 — Predict text.** A detected key is shown as its text in the model's language
    (`predictDisplayText()`, `:647-649`, used at the four display sites `:1003`, `:1010`, `:1020`, `:1037`): ESL model →
    English text, FSL model → Filipino text, never the slug. The "Gets:" indicator now shows "Start"/"Stop" capitalised
    (it previously showed lowercase). Measured with a fake camera: ESL model `zz_both_probe` → "Zz Both Probe?",
    `zz_esl_only` → "Zz Esl Only"; FSL model `zz_both_probe` → "Zz Pareho Probe?", `zz_fsl_lamang` → "Zz Fsl Lamang"
    (96 and 76 calls hooked over 12 s each). The ESL model contained 124 labels and the FSL model 91 after training
    with the probes; the ESL-only probe appears only in the ESL model and the FSL-only probe only in the FSL model.
  - **Step 4 (Translate) still uses its own Output Language chip** (`signLang`, `'en'`/`'fil'`, `js/gesture-training-ui.js:8` (re-measured 2026-10-16, was `:9`),
    `:1104`), independent of the model toggle. Known gap: an FSL-only sign shown with the English chip has no English
    text, so `translateGestureLabel()` falls through to the title-cased key (`:326-338`) — `docs/system/DEBT.md`. Every
    text shown through `innerHTML` in Step 4 is escaped (`escapeHtml()`, `:625`: the sentence history/big output, the
    current-sentence word spans, `renderTranslation` words and `renderWordChips` custom words), and the same helper
    in `js/sign-to-text-ui.js:4` covers its output box and final sentence — a text such as `<img src=x onerror=...>`
    renders literally (`tests/sign-texts/xss-check.mjs`; the live camera loop's sentence sites were verified by code and
    by the helper, not by driving a camera).
  - **View Active Gesture Dataset modal.** Card width `min(960px, calc(100vw - 32px))`
    (`css/gesture-training.css:722`; measured 960 at 1024, x=32, y=48, height 504, no page scroll). Columns:
    **English text | Filipino text | Set | Samples | Edit | Delete** (`trRenderDatasetView()`,
    `js/gesture-training-ui.js:127-186`); Set shows ESL / FSL / Both; a text the set does not use shows "—" even if a
    hidden text is stored (`datasetShownText()`, `:111-117`). The table is built with DOM + `textContent` (no
    `innerHTML` for user text, no inline `onclick` with text). Tabs and their counts are unchanged (Words/Letters/
    Numbers/Phrases, `:88`). **Search** matches case-insensitively over the key, the English text and the Filipino text
    (`:148-152`), including a hidden stored text. Rows are ≥ 44.5 px, Edit/Delete buttons 80.6×44. The delete confirm
    names the sign by English text, else Filipino text, else key, plus " (ESL and FSL)" for a Both sign
    (`deleteGesture()`, `:538`).
  - **Edit panel** (inside the same card; tabs, search and table hide, `trShowDatasetEditPanel()`, `:188-196`;
    markup `gesture-training.html:364-392`): header "Edit sign — key: <key> · N sample(s)"; left column Sign Set
    (ESL | FSL | Both) plus a "Type: <Category>" line, right column the English and Filipino inputs shown per set and
    prefilled with the stored texts (`trOpenDatasetEdit()`, `:212`; a stored-null text prefills empty); bottom row
    message | Cancel | Save (`css/gesture-training.css:749-759`). Save (`trDatasetEditSave()`, `:234-275`) validates
    on the client ("Enter the English text." / "Enter the Filipino text."), POSTs `signs.php`
    `{action:"update", key, set, textEn, textFil}` with the hidden field sent as `null` (so the stored hidden text is
    kept — narrowing a set keeps it), and on success toasts "Saved.", clears `sining_kamay_labels_<LANG>` **only for
    languages whose membership changed** (ESL = ESL|Both, FSL = FSL|Both; a text-only edit clears nothing;
    **since 2026-10-16 nothing is cleared**: there is no model cache in `localStorage`, and the reload below refreshes
    the model status, which then reads "Model out of date: run Compile" for each language whose membership changed,
    `js/gesture-training-ui.js:273-278`),
    `await window.reloadDataset()` and returns to the table on the same tab and search. A failed save shows the
    server's `error` (or "Save failed (HTTP n).") in the panel and stays in edit mode. Cancel sends nothing. Opening
    or closing the modal resets to table mode; the modal ✕ in edit mode closes the whole modal with no unsaved-change
    prompt. No samples are touched: sample files were byte-identical (sha256) before and after an ESL → Both edit
    (`verify-e2e.mjs` item 6; `dataset-check.mjs`).
  - **Measured edit-panel fit** (Both, focus in either text input, keyboard open): card x=32 y=8 w=960 h=289 (bottom
    297, keyboard top 320); header 41; panel y=73 h=208 (bottom 281); English input y=94 h=48, Filipino input
    y=177 h=48; Cancel/Save y=233 h=48, 120 wide; neither panel nor card scrolls (`scrollHeight ≤ clientHeight`) and
    Save is reachable (`elementFromPoint` hits it). Keyboard closed: card h=289 (y=156), panel h=208. The table-mode
    keyboard-open rule (card capped at `100vh − 280px − 16px`, above) is unchanged. All of it from
    `tests/sign-texts/dataset-check.mjs` (ALL CHECKS PASSED, 0 console errors).
  - **On-screen keyboard punctuation** (`js/virtual-keyboard.js`). The last row is now `clear, -, ', ",", space, ., ?, !,
    hide` (`:21`; the old row was `clear, space, hide`) so a text like "How are you?" can be typed. The punctuation
    keys are ordinary `data-char` keys; Caps uppercases only `a-z` (`/[a-z]/` guard, `:180`), so `?`, `.`, digits are
    unaffected. Measured on `gesture-training.html`: 5 rows with 10/10/9/9/9 keys, keyboard height **280 px**,
    smallest key 48 tall × 66.1 wide, Space 323 px (about 4.9 key widths), no row overflows, `scrollWidth` 1024; typing
    H (caps) then "ow are you" then "?" gives exactly "How are you?" and `- ' , . !` insert correctly
    (`tests/sign-texts/reports-keyboard-check.mjs`, 27 PASS). On `talk.html` (Speak or Type) the same rows render at
    **240 px**, because `talk.html`'s own `.sk-keyboard-wrap{height:240px}` override (`talk.html:928-929`) predates
    this phase; compared against the parent commit's keyboard served through a temporary page, the only differences
    are the last row (3 → 9 keys), Space (400 → 323 px) and the smallest key width (68 → 66.1); heights (240), the
    smallest key height (44), the input/Translate row (y 106–170) and the keyboard top (y 360) are identical, and
    talk.html's rows slightly overhang the 240 px box, as before. `index.html` and `reports.html` do not load
    `js/virtual-keyboard.js` (grep).
  - **Reports** (`reports.html`, ESL Signs and FSL Signs tabs). Both tables' header is now **ID | Key | Set | Text |
    Asset | Created** (`reports.html:471`, `:474`); Set is ESL / FSL / Both (`setName()`, `:669`), Text is the tab's text
    (escaped). A Both sign is listed in **both** tabs, each with its own text (server: `reports.php` IN ('ESL','BOTH') /
    ('FSL','BOTH'), BACKEND). View Asset's inline handler now passes `esc(JSON.stringify(path))` and
    `esc(JSON.stringify(text))` (`:680`) instead of single-quoted strings, because a text can now contain an
    apostrophe. Measured: summary esl=122 / fsl=89 and the same number of rendered rows (ESL tab = 33 ESL + 89 Both,
    FSL tab = 89 Both, 0 FSL-only); `how_are_you` row: ESL tab "How are you", FSL tab "Kamusta ka", Set "Both";
    `scrollWidth` 1024 on both tabs, 0 console errors.
- **The soft target of 5 is not arbitrary.** `knnPredict` scores a label as
  the mean of its top `min(5, N)` cosine similarities across *all* of that
  label's saved frames, i.e. K=5 (gesture-training-ui.js:310, same K cited
  above). One take alone already fills K=5 with near-duplicate frames (~90ms
  apart within a take, gesture-data.js), so 5 samples is the smallest count
  at which each of the 5 neighbours *can* come from a different take — a
  code-derived number, not a guess. The pool-size bias this implies (a word
  recorded far more than others gets a systematically higher top-5 mean) is
  real by construction but its magnitude has not been measured
  (`docs/system/DEBT.md`; see also `docs/system/MANUAL-CHECKS.md`'s
  gesture-training section).
- **`php/api/save_gesture.php`'s save-a-sample response gained four
  additive fields, same phase:** `labelSampleCount` (int — samples saved for
  this label+sign set after this save), `videoSkipped` / `videoTranscoded`
  (bool), `videoExisting` (string|null — the path of the clip that was kept
  when the transcode was skipped). The server now skips the ffmpeg transcode
  for a label's 2nd+ sample when the label already has a video (`.mp4` or
  `.webm`, `find_label_video()`, save_gesture.php:56) and has at least one
  prior sample (`$priorSampleCount`, computed at save_gesture.php:496 —
  before the new sample file is written); the skip decision is at
  save_gesture.php:534, the three status defaults at :517-519,
  `$videoTranscoded = true` is set immediately before the `exec()` call at
  :552, and the four response fields are added at :613-616. Landmark data
  still saves on every sample, unconditionally, regardless of the video
  decision.
- **The post-save reload path shares one fetch instead of two, same phase.**
  `window.reloadDataset` (gesture-training-ui.js:1063) now fetches the
  dataset once via `GestureDataRecorder.loadSavedGestureDataset(true)`
  (`no_sync=1`) and passes that one result to both `mergeSavedGestureSamples()`
  (:408) and `renderSavedDataset()` (:254), instead of each of those two
  functions independently running its own full, `sync_disk_to_db`-triggering
  fetch. Both functions keep an unchanged full-fetch fallback when called
  with no argument, which is what `trainModel()` and the page's
  `DOMContentLoaded` startup handler still do — the startup load still runs
  two full synced fetches, by design (`docs/system/DECISIONS.md`).
  **Superseded 2026-10-16 (compact-model phase):** every Train Gestures listing is now the summary
  listing (`?summary=1`, no frames). `window.reloadDataset` (`js/gesture-training-ui.js:1475-1482`)
  runs one `no_sync` summary GET, then the model status; the startup handler (`:1485-1510`) runs ONE full-sync
  summary GET (`refreshDatasetNoStatus(false)`, `:1513-1524`) alongside the model status and the model
  file. `mergeSavedGestureSamples()` and `trainModel()` are gone.
- Admin PIN for both gesture-training.html and reports.html is hardcoded
  client-side: `CORRECT_PIN = '2026'` (gesture-training-ui.js:33, re-measured 2026-10-16, was :23; reports.html:443,
  inline duplicate implementation).
- Cache-busting/version query strings: `js/script.js?v=5` (index.html:750,
  before `js/script.js` was archived — see the Part 2 update note at the top
  of this section), `css/gesture-training.css?v=1.0.7` (bumped from `v=1.0.5`
  by the 2026-09-22 gesture-training multi-sample phase, then to `v=1.0.7`
  by the 2026-09-26 video-based gesture capture phase's `#gcMode` styling)
  and `css/virtual-keyboard.css?v=1.0.5` (gesture-training.html:8-9). No
  version string on `css/style.css`, `js/gesture-training-ui.js`,
  `js/capture-core.js`, `js/video-landmarks.js`, `js/gesture-capture-ui.js`,
  or `js/vosk.js`.
- Save-gesture endpoint path branches on protocol: when
  `location.protocol === "file:"` it hardcodes `http://localhost` + (`/SKR` if the
  pathname contains `/SKR`, else `/Sining_kamay`) + `/php/api/save_gesture.php`
  (script.js:847-849); otherwise relative `php/api/save_gesture.php`.
- `js/vosk.js` line 174 is a single ~5.6 million-character line containing a
  base64-encoded Web Worker bundle (`createBase64WorkerFactory`, decoded via
  `atob`/Blob at runtime) — this is the vendored `vosk-browser` library, not
  hand-written kiosk code; confirmed third-party by embedded UUID/Microsoft
  license headers (vosk.js:7-20, 32-50).
- **Reports Conversations tab (2026-09-25 saved-conversations phase),
  replacing the old Translations tab.** `reports.html`'s third summary metric
  and third tab (was `#translationCount`/`#tab-translations`) are now
  `#conversationCount`/`#tab-conversations`, listing rows from
  `php/api/conversations.php` instead of the `translations` data
  `php/api/reports.php` used to include (that table was dropped the same
  day — `docs/system/BACKEND.md`). Unlike the ESL/FSL tabs, which come from
  `reports.php` fetched at page load like before, `loadConversations()` is
  called only from `trVerifyPin()`'s success branch — **not** at page load —
  so no request to `conversations.php` exists in the network log before the
  correct PIN is entered (privacy finding in
  `docs/reports/2026-09-25-saved-conversations-step1.md`; `reports.php` and
  the PIN gate itself both stay client-side-only, so this only closes the
  "fetched before the PIN" gap, not the underlying auth gap — `DEBT.md`
  item 72).
  - **List columns:** Date/time · Duration · Messages · First message (wraps,
    no ellipsis) · Ended (Ended / Idle / Left / Not ended, from
    `end_reason`/whether `ended_at` is set) · Delete. A **Clear all** button
    sits above the table. The list re-fetches after every delete and after
    Clear all.
  - **Tapping a row** (anywhere but Delete) opens a thread-view modal (in the
    `.asset-modal` family already used for the asset preview): header shows
    date/duration/message count/end reason; body is a scrolling list of
    bubbles styled after `talk.html`'s own (`talk.html:226-247` — signer
    left/white/bordered, hearing right/navy/white), each labelled "Signed ·
    h:mm AM/PM · ESL/FSL", "Spoken · h:mm AM/PM", or "Typed · h:mm AM/PM"
    from `source`; footer has Back and Delete. Read-only — no reply/continue
    control.
  - **Delete and Clear all** both go through one in-page confirm card (not
    `window.confirm`): "Delete this conversation?" / "Delete all N
    conversations?" plus "This cannot be undone.", Cancel/red Delete buttons,
    a toast afterward. Delete on a conversation whose row is `id`-matched
    cascades to its `messages` rows server-side (the FK's `ON DELETE
    CASCADE`); Clear all has no probe/real-data distinction on the server
    side (only the test suite guards itself against wiping real data —
    `DEBT.md` item 79 covers the missing server-side auth generally).
  - **Measured at 1024×600** (headless Chrome via CDP,
    `.git/sdd/conv-task-5-report.md`): `document.documentElement.scrollWidth`
    = 1024 in the list, thread modal, and confirm card; the Date/time column
    is 168px wide (widened twice across review rounds — the true worst-case
    string measured across every value the column's own `formatDateTime()`
    can produce, bounded by the `TIMESTAMP` column's valid range through
    2038, is "May 30, 2034, 10:44 AM" at 139.42px text width); every control
    ≥ 44×44px; 0 console errors through a full list/thread/delete/clear-all
    walkthrough.

### Avatar clips (`avatar-clips.html`, avatar phase, 2026-10-05)

- **Opened from** Train Gestures Step 1: the old "View Active Gesture Dataset" row is now
  `[📁 View Active Gesture Dataset · N gestures › | 🧍 Avatar clips]` (measured 528,154 336x56 and
  876,154 124x56; labels 13 px, one line each). The link goes to `avatar-clips.html`; Train Gestures sets
  `sessionStorage.sk_train_unlocked` on PIN unlock, so the page opens without a second PIN in the same tab; a
  direct visit shows the same PIN pad (PIN `2026`, `js/avatar-clips-ui.js`).
- **Dataset table** gains an **Avatar** column (✓ / —) between Samples and Edit, from `signs.php`'s `avatar`
  flag (its own fetch in `renderSavedDataset`; a failed fetch shows ? and never fails the table). Columns
  26/26/9/10/8/10.5/10.5 %; rows stay 45 px.
- **Layout at 1024x600** (measured, no page scroll, every control >= 44 px): nav 52 px; left column (24..496):
  search, sign list (text, set, ✓/—), selected line, `[Choose video… | Import JSON… | Signer]` (2026-10-13:
  24,451 138x52; 170,451 138x52; 316,451 180x44), progress bar, status;
  right column (528..1000): `[Video + skeleton | Avatar]` toggle, 472x268 stage, 472x56 trim strip with two
  44-px handles (bars: dark = a hand detected, grey = pose only, orange top = a hand "up"), trim label +
  Export JSON (754,458 128x44) + Preview (890,458 110x44), `[Delete | Redo | Save]`.
- **Flow.** Pick a sign -> Choose video (read through an object URL, never uploaded) -> extraction with
  progress and the skeleton drawn on each frame (pose cyan, right hand red, left hand green, head/hips
  yellow) -> auto-trim (first .. last frame of a >= 3-frame run with a wrist above shoulder + 0.6 x
  (hip - shoulder), each end then moved inward, at most 8 frames, to a frame where every raised arm's hand is
  detected — 2026-10-14, DEBT 124) -> handles to change it -> Preview on the avatar -> Save posts only the clip JSON to
  `php/api/avatar_clip.php`. Redo discards the extraction (aborting one in progress) and opens the file picker;
  Delete is a two-tap confirm and removes only `avatar.json`. Videos over 60 s are refused before extraction,
  and a trim over 500 frames (20 s) shows "too long" and disables Save. Without WebAssembly SIMD the page says so and
  disables Choose video (only the SIMD Holistic build is vendored).
- **Measured** (`tests/avatar/admin-check.mjs`, 22/22 PASS, every non-localhost host blocked): `my_name_is.mp4`
  (1080x1920, 10.24 s) -> 256 frames in 61.3 s, auto-trim 31..221 (1.24-8.84 s), saved 191 frames
  (162-164 KB); 73 requests, all localhost; one POST body (the clip JSON, about the clip's size; the video is
  2,602,227 bytes); no new video file under the repo, htdocs or `C:\xampp\tmp`; samples and `sign.json`
  byte-identical; 0 console errors.
- **Import JSON / Export JSON (2026-10-13, `docs/reports/2026-10-13-avatar-json-import.md`).**
  - **Import JSON…** (next to Choose video…, enabled once a sign is picked, also without SIMD) reads a
    landmark file in the browser (`File.text()`, at most 8 MB) and skips extraction. `AvatarClip.importClip()`
    (`js/avatar-clip.js`) accepts `sk_avatar_clip_v1` (frames kept exactly) and the prototype tool's
    `avatar_pose_hands_v1` (`{t, pose, lh, rh}` frames -> `[pose, lh, rh]`, coordinates rounded to 3 decimals
    and visibility to 2 as `packFrame()` does, the file's own fps kept, at most 1500 frames). Then the same
    flow as a video: a prototype file is auto-trimmed, a system clip (already trimmed) is selected whole;
    handles, Preview, Save, Redo (which reopens the JSON picker).
  - **No video:** the stage shows the avatar, the "Video + skeleton" tab is disabled, and dragging a handle
    shows that frame's pose on the avatar.
  - **Key and signer:** the file's own `key` is ignored (the clip is saved to the selected sign); a `signer`
    in the file fills the Signer field (not written to this computer's remembered signer until edited).
  - **Rejected with a message, nothing saved:** invalid JSON; any other shape (the message names the file's
    format, and says so when it looks like a recognition sample); a clip that fails `validateClip()`.
  - **Export JSON** (trim row, enabled when the selected sign has a clip) downloads the saved `avatar.json`
    as `<key>.avatar.json`, byte for byte.
  - **Signer field** placeholder is now "Signer ID, e.g. P03" (132 px of text in a 154-px field).
  - **Measured** (`tests/avatar/import-check.mjs`, 31/31 PASS, every non-localhost host blocked):
    `my_name_is.avatar.json` -> 256 frames (pose 256, right hand 197, left hand 63), auto-trim 31..221, saved
    191 frames (162,166 bytes); the export is byte-identical to the saved file; importing the export into a
    second sign and saving gives 191 frames with 0 of 24,406 values different and the same trim times
    (1240-8840 ms); Let's Talk played the clip on the avatar (8.35 s, 0 videos); 84 requests, all localhost;
    2 POSTs (the two saves); no page scroll, every control >= 44 px, no label cut off; 0 console errors.

### Bulk video importer (`bulk-import.html`, 2026-10-13/14)

Reports: `docs/reports/2026-10-13-bulk-import-step1.md`, `docs/reports/2026-10-13-bulk-import-final.md`;
decisions in `DECISIONS.md` ("bulk video importer"). **Laptop only.** Nothing on the dashboard, Let's
Talk, Train Gestures, Reports or Avatar clips links to the page (checked by
`tests/bulk-import/verify-e2e.mjs`: 31 pages and scripts searched); it is opened by typing its address.
Built for a laptop screen (measured: no horizontal scroll at 1366 and at 1280 wide), not for 1024x600.

- **Scripts:** `js/lib/holistic/holistic.js`, `js/lib/mediapipe/hands.js`, `js/capture-core.js`,
  `js/gesture-data.js`, `js/video-landmarks.js`, `js/avatar-rig.js`, `js/avatar-clip.js`,
  `js/avatar-retarget.js`, `js/avatar-extract.js`, `js/bulk-import-core.js` (pure: names, best
  repetition, candidate, row status, projection, default-signer assignment, imbalance),
  `js/bulk-import-ui.js`. The kiosk's classifier files are not loaded.
- **PIN** pad as on Avatar clips (same PIN, same 10-minute `sessionStorage` unlock).
- **Start-up order matters:** the Holistic extractor is initialised first, and only then
  `GestureDataRecorder.preloadMediaPipe()` runs, because `js/gesture-data.js:206-225` patches
  `WebAssembly.validate` to force non-SIMD and the SIMD-only Holistic then refuses to start (measured in
  the Step 1 probe: `NO_SIMD`). A failed load shows the error and a Retry button.
- **Five steps** (a step bar; state kept in one object, `window.BulkImport.state`):
  1. **Folder.** `<input type="file" webkitdirectory>`; files are only read locally. Each name is parsed
     as `<SET>_<label>_<SIGNER>.<ext>` (SET ESL/FSL/BOTH; SIGNER P01..P99; the label is the rest; the key
     is `cleanLabel(label)`). A name that does not match is listed under Problems, never guessed; junk
     such as `desktop.ini` is ignored. Two lists, remembered in `localStorage`, editable any time:
     **Signers used for recognition** (default the first 2 found) and **Avatar signers** (ordered: the
     default signer, then fallbacks; default the first 3 found).
  2. **Extract** (Start / Pause / Resume, progress, ETA, preview). Per video:
     - the Hands pass and the segmentation are the live capture's own calls
       (`createVideoDetector`, `extractVideoLandmarks` at 15 fps, `segmentFrames` with its constants), for
       EVERY video; the result is written to the cache at once;
     - the best repetition is chosen from the Hands result (most frames with the needed hands; two hands
       are "needed" when at least half of the repetition frames have two);
     - only for a signer in the avatar list: Holistic runs on that repetition's window only (middle of
       the rest before it to middle of the rest after it), and the trimmed clip is stored as that sign
       and signer's candidate;
     - a video of 60 s or longer gets no candidate; two files of one sign and signer: the first by file
       name makes the candidate, a later one takes over only if the earlier ones gave none.
     Re-opening the same folder skips finished videos (identity: name + size + modified time). A signer
     added to the avatar list later gets only the Holistic step (the Hands result is reused). Pause
     drops the step in progress; a cache that cannot be read or written stops or pauses the queue.
  3. **Review.** One row per video (file, label -> key, set, signer, repetitions, status, checkbox) with
     filters All / Problems / New signs / To import. Exactly 3 repetitions = OK; any other count is a
     problem row that can be ticked to import the repetitions found. A label that exists with another
     set is "exists as <SET>" and cannot be imported. A new sign shows its draft texts for editing. Rows
     of signers outside the recognition list are not imported (their Hands result stays cached). A box
     shows, per model, the rows now, the rows this import adds and the total, and an estimated
     `knnPredict` time measured in this page with a copy of the algorithm's shape on a synthetic model
     ("estimate, this laptop's Chrome. The Pi is slower."). Nothing is written before Import.
  4. **Import.** One POST per repetition to `php/api/save_gesture.php` (v3, `source "video-import"`,
     `repIndex`, `signer`, `importId`); no text is sent, so a new sign's key is the file's label, and its
     edited texts are set through `signs.php` right after its first sample. A server error pauses with
     Resume; importing the same video again adds nothing. The model cache is invalidated as the live
     capture does. The summary lists samples added per sign, duplicates skipped, new signs, videos not
     imported by reason, every sign's sample count with a warning for signs below half the median, and
     "Now run Compile (Train AI) on Train Gestures for ESL and for FSL."
  5. **Avatar.** Default signer + priority list (the same avatar list), "Keep signs I picked by hand"
     (on), a table of what Apply will do, **Apply to all signs** (one `avatar_clip.php` save per sign,
     one `set_picks` at the end), and a summary: signs per signer, fallbacks, no clip, left alone, not
     imported yet, of another set, failed. Apply re-reads the signs and the cache first and stops if they
     changed since the table was shown. A candidate made from a video of another set than the sign's is
     never used ("candidate P01 is ESL, the sign is FSL — not used").
- **Measured** (`tests/bulk-import/verify-e2e.mjs`, 38/38 PASS, every non-localhost host blocked; folder of
  8 videos: 2 signers x 3 synthetic signs, one 2-repetition video, the owner's real 1280x720 17.8 s video,
  plus one bad file name and one junk file): extraction 143 s for all 8; real video: Hands pass 19.6 s
  (267 frames), Holistic on the best repetition's window 17.0 s (126 frames), 3 repetitions, an 85-frame
  candidate; 21 samples imported from 7 videos, 0 on re-import (21 duplicates); Apply set 3 signs to P01,
  left the hand-picked one alone, 1 not imported yet; Train AI "Complete! — 126 gestures ready"; Predict
  on the fake camera showed "Zz bulk one"; 207 requests, all localhost; 70 POSTs, all JSON, largest 112 KB
  against 5,391 KB of videos; no video file written under the repo or `C:\xampp`; 0 console errors.
  Kill mid-extraction, Pause / Resume and cache failures: `tests/bulk-import/extract-check.mjs` (85 PASS).
- **Update 2026-10-17 (py-avatar, `docs/reports/2026-10-17-py-avatar.md`).** The avatar candidates can now also be
  made by `tools/py_extract/extract.py --avatar-signers` (Holistic in Python, several videos at once, HEVC too); the
  page then only does Step 5 for them.
  - **Extract table, Source column:** a second line `avatar: <source>` when the video has a clip
    (`python mediapipe 0.10.21 holistic`, `browser mediapipe holistic 0.5.1675471629`, or `browser` for a clip from
    before the field; `BulkImportCore.candidateSource()`, `js/bulk-import-core.js:75`); blue for a Python clip. The
    count line adds "· N avatar clips by python"; a python row reads "already extracted (python, avatar clip by
    python)". `css/bulk-import.css` `?v=1.0.8`.
  - **Start** skips a video whose Python clip is in the cache (its meta is split and has its candidate:
    `planWork()` 'skip'). The page's own candidate step now records `source` in `meta.candidate`.
  - `buildMeta()` is now `BulkImportCore.buildMeta()` (`js/bulk-import-core.js:318`), called by a 3-line wrapper
    (`js/bulk-import-ui.js:884`); 36 of 36 outputs identical to the old function on synthetic and cached entries.
  - Checked in headless Chromium (php -S, no DB): see the report. Step 5 Apply and avatar-clips.html were not run
    (they need MySQL).
- **Update 2026-10-16 (py-extractor, `docs/reports/2026-10-16-py-extractor.md`).** The Hands pass can now also be
  done by `tools/py_extract/extract.py` (Python, several videos at once); the page then only splits, reviews and
  imports. Run in headless Chromium (php -S, no DB) on a synthetic folder, Folder and Extract steps only.
  - **Folder:** files under a sub-folder named `unzipping` or starting with `_duplicates` (any case, below the
    chosen folder) are not listed; the folder line counts them ("N in unzipping / _duplicates folders, skipped").
    Same rule in the tool (`BulkImportCore.skipFolder()`, `js/bulk-import-core.js:52`).
  - **Extract table:** new last column **Source** (`python mediapipe 0.10.21` in blue, `browser mediapipe hands
    0.4.1675469240`, or `browser` for an entry from before the field). The count line reads "N videos · M extracted
    (K by python)". A python entry not split yet reads "already extracted (python): Start splits it from the cache"
    (", then makes the avatar clip" for an avatar signer); after Start "done (split from the cache)" or "done (split
    from the cache + avatar clip)"; later "already extracted (python)". Review shows such a row as "not split yet:
    press Start on Extract" until then.
  - **Start** on a python entry: the split from the cached frames (no video read), then, for a ticked avatar
    signer, the Holistic pass on the best repetition only. The ETA counts that Holistic pass
    (`js/bulk-import-ui.js:1043`).
- **Update 2026-10-16 (bulk-reps-fix, `docs/reports/2026-10-16-bulk-reps-fix.md`).** Not run in a browser yet
  (no XAMPP in that session); only the splitter's node tests ran (22 pass).
  - **Scripts:** adds `js/knn-compile.js` (the compile rule for the estimate) and `js/bulk-rep-split.js`
    (the dynamic split). `js/capture-core.js` is still loaded, but bulk import no longer calls
    `segmentFrames`.
  - **Extract:** the Hands pass is unchanged. The reps come from `BulkRepSplit.splitReps()`: a per-frame rest
    score (no hand / hand lowered below the video's own signing zone / nearly still while low), rest runs of
    at least 200 ms, and the 2 runs that best cut the video into 3 reps, each trimmed to its signing frames.
    A row is a problem row, with the reason, when the split is not sure: fewer than 3 reps, a weak rest,
    reps of very different length, or another rest as clear as the chosen ones. The Reps column shows
    "3 ?" for a 3-rep split that is not sure (hover: the reasons). The cache is version 2 (every frame kept).
    A video cached by the first version reads "extracted by the old importer: Start reads it again". One
    split with older thresholds reads "split with older settings: Start splits it again from the cache"
    (no video read). New **Stop** button: pauses and opens Review with the videos done so far (Resume carries
    on).
  - **Review:** new **Split** column, a 168x26 timeline per video. Top band: the per-frame rest score (dark
    no hand, mid lowered, light still and low). Bottom band: the numbered reps that would be imported. Its
    title / aria-label says the same in words. Above the table: **Select all** (every importable row;
    problem rows import what their choice says), **Select all problems (reps found)**, **Clear**, and a
    legend. A header checkbox ticks or unticks every importable row under the current filter (mixed when
    some are). A problem row has a select: "the N reps found" / "split into 3 equal parts" / "skip". A video
    imported before with another split reads "… — replaces N old samples", and the Import button reads
    "Import V videos (S samples, replaces R old samples)". Rows cached by the first version, or split with
    older settings, cannot be imported until Start runs.
  - **Review data:** the statuses come from the summary listing (file names). The estimate box shows
    "Reading the saved samples for the estimate… x of y signs" while the rows per sample are read in
    `labels=` batches (as Compile does). Its rows are now "Rows in the compiled model", by the compile rule
    (at most 90 per sign).
  - **Import:** per video, the cache records the new sample ids, the reps are saved (the same v3 payload),
    then the old samples of the same file (another split) are removed through `save_gesture.php`
    `delete_import_samples`, then the record is narrowed. The progress card adds "Old samples replaced". The
    summary adds "Old replaced" per sign, the videos split into 3 equal parts, and "Next: Compile ESL and
    Compile FSL on Train Gestures (Step 2)". The reminder card reads "Now run Compile on Train Gestures
    (Step 2) for ESL and for FSL."
  - The earlier browser checks still encode the old segmenter and are not updated (DEBT 142).

### Avatar clips: Candidates panel (2026-10-14)

- The selected-sign line now ends with a **Candidates (n)** button (measured at 1024x600: 352,416 144x44;
  the sign list is 472x290). It opens a panel exactly over the sign list (24,118 472x290) listing the
  bulk importer's candidates for that sign by signer, with frames, **Preview** (plays it on the avatar)
  and **Use this** (saves it through `avatar_clip.php` and records the sign as picked by hand). A row is
  marked "in use" only when the saved clip really is that candidate. Each row shows the set of its video;
  "Use this" is disabled for a candidate of another set than the sign's.
- Saving a clip from a video or a JSON records a hand pick when the Signer field is `P01`..`P99`,
  otherwise removes any pick (a sign with a clip and no pick already counts as picked by hand); Delete
  removes the pick. These calls never delay or fail the save or the delete.
- With no candidates, or with `php/api/bulk_import.php` failing, the button is disabled and the page works
  as before (`tests/bulk-import/candidates-panel-check.mjs`, 41 PASS; `tests/avatar/admin-check.mjs` 22 PASS
  and `tests/avatar/import-check.mjs` 31 PASS still hold: no page scroll, every control >= 44 px).

### Compact recognition model: Train Gestures (compact-model phase, 2026-10-15/16)

Proposal `docs/reports/2026-10-14-compact-model-step1.md`; model, rule and measurements in
`docs/system/ML.md` "Compact model"; endpoints in `docs/system/BACKEND.md`; decisions in `DECISIONS.md`.
Steps 2-4 now use the compiled file `models/knn_<LANG>.bin`. Train Gestures downloads frames only
inside Compile. Where the Part 2 text above says Train, `trainModel()`, `mergeSavedGestureSamples()`, "cached
model" or `sining_kamay_knn_*` / `sining_kamay_labels_*`, it describes the page before this phase.

- **Scripts.** `js/knn-compile.js` and `js/knn-model-store.js` (`gesture-training.html:18-19`, `defer`, before
  the body scripts `:452-454`).
- **Renamed texts.** Pill 2 "Compile" (`gesture-training.html:94`, was "Train AI"); Step 1's "Next: Compile →"
  (`:267`); Step 2 instruction card "Step 2: Compile the Model" with new bullets (`:121-131`); Step 2 section
  label "Compile Model" (`:276`); progress row "Compile progress" / "Not started" (`:292`); the initial log text
  explains Compile (`:295`); toast "Compile the model first in Step 2!" when Steps 3/4 are opened without a usable
  model (`js/gesture-training-ui.js:1322`, `:1346`, `:1351`); Step 1's note after a save "Saved. Run Compile
  (Step 2) again to use it." (`:485`). Bulk import's own reminder still says "Now run Compile (Train AI) on
  Train Gestures for ESL and for FSL." (bulk import must not change in this phase). **Update 2026-10-16
  (bulk-reps-fix):** it now reads "Now run Compile on Train Gestures (Step 2) for ESL and for FSL."
- **Step 1 without frames.** The dataset table and the sample-count line read the summary listing
  (`save_gesture.php?summary=1`: the same listing without `frames`): `renderSavedDataset()`
  (`js/gesture-training-ui.js:520-565`), `refreshDatasetNoStatus()` (`:1513-1524`). Page load makes ONE
  full-sync summary request, next to `model_status.php` and the model file (`:1504-1509`). A delete
  (`deleteGesture()`, `:568-593`) does a full-sync summary reload plus the status; a save or a dataset edit
  (`window.reloadDataset`, `:1475-1482`) a `no_sync` one plus the status. Measured on today's data (curl,
  5 runs): summary 32,609 bytes in 0.505-0.527 s (full sync) and 0.243-0.279 s (`no_sync`), against
  3,481,109 bytes in 0.855-1.195 s / 0.633-0.708 s with frames (`.git/sdd/cm-task-6-report.md`).
- **Step 2 status line** (`#modelStatusLine`, `gesture-training.html:285`; `renderModelStatus()`,
  `js/gesture-training-ui.js:745-766`), from `php/api/model_status.php`, for the toggle's language:
  - "Checking the model file…" until the first answer (the HTML text);
  - laptop, up to date: "<LANG> model: 2,047 rows, 122 signs, built Oct 15, 2026, 11:12 AM — up to date"
    (numbers and date from the file header);
  - "Model out of date: run Compile" (the samples changed, or the file is of another format or rule);
  - "No model file: run Compile" (laptop) / "No model file" (Pi);
  - "<LANG> model file cannot be read" (the header is unreadable and the answer is not "stale", i.e. on the
    Pi);
  - "Model status unavailable" (`model_status.php` failed);
  - on the Pi, the up-to-date form without " — up to date": the Pi lacks the bulk samples by design, so it
    never judges.
  Every form except the up-to-date one gets the `.stale` colour (`#b45309`, `gesture-training.html:39`).
- **Pi warning.** `#modelPiWarning` (`gesture-training.html:286`) shows "Build the model on the laptop, then
  copy models/knn_ESL.bin and models/knn_FSL.bin to the Pi." when `model_status.php` says the device is the
  Pi. Compile is then disabled (`refreshStep2Buttons()`, `js/gesture-training-ui.js:769-778`); a direct call
  is refused before any request (`:829`), and the server also answers 403.
- **Step 2 card** (`updateUI()`, `:381-410`): a header line "N <LANG> signs in the saved samples / M in the
  model file", then every sign of the selected model (`KnnCompile.inModel` over the summary listing) with
  "N rows" (from the loaded file's header), or "not compiled yet" plus an orange **NEW** badge (samples, but
  not in the loaded file), or "no samples" (a sign folder without samples). Empty states: "No training samples
  loaded yet." and "No <LANG> signs in the saved samples yet.".
- **Compile** (`#trainBtn`, "Compile" / "Compiling…" while it runs; `compileModelGuarded()` `:782-791` locks the
  ESL | FSL radios; `compileModel()` `:802-969`), five stages on the progress bar:
  1. "Checking the device": `model_status.php`; on the Pi it stops with the Pi warning (`:826-829`).
  2. "Reading the sample list": ONE full-sync summary listing (`:831-847`). Its own `signs` and `categories`
     are copied at once, and the fingerprint is computed from it.
  3. "Reading samples k/N signs": the frames of the in-model signs, a batch at a time
     (`save_gesture.php?no_sync=1&labels=a,b,...`, at most 60 samples and 200 signs per request, a bigger
     sign alone; `:794-795`, `:866-903`). Only the files the summary listed are used, each sign goes into
     `KnnCompile.createBuilder()` and its frames are dropped before the next request. Log line per request:
     "// Read 58/122 signs (request 1 of 3: 58 signs, 60 samples)".
  4. "Saving models/knn_<LANG>.bin": encode, then `POST php/api/compile_model.php?lang=<LANG>` with the raw
     bytes (`:913-930`). Log: "// <LANG>: N signs, S samples, R rows (budget 90 rows per sign)", "// Signs:
     ...", "// Wrote models/knn_<LANG>.bin: B bytes, fingerprint <12 hex>…".
  5. "Loading the saved file": `KnnModelStore.load()`; if the loaded `buildDate` / fingerprint is not the one
     just written, the stored copy is removed and the file loaded once more (`:932-944`). Then "Compile complete
     in X s. Click Next to test your signs.", the bar label "Complete! — R rows, N signs" and the toast
     "✅ <LANG> model compiled: N signs. Click Next →" (`:947-953`).
  Warnings in the log: "// N sample file(s) disappeared while compiling: run Compile again." (`:903`) and
  "// The samples changed while compiling: run Compile again." (`:930`). Errors go to the log in red and to a
  6 s toast; the bar returns to "Not compiled" and the button comes back (`:955-968`): "Add at least 2 signs
  before compiling" (`:856`, `:907`); "Compile failed: the model status (php/api/model_status.php) could not
  be read"; "Compile failed: the sample list could not be loaded (...)"; "Compile failed: the server could not
  be reached (...)"; "Compile failed reading samples (HTTP n): ..."; "Compile failed (HTTP n): <error, or the
  first 200 characters of a non-JSON answer>"; "Compile wrote models/knn_<LANG>.bin, but loading it failed:
  ..." / "... but the page could not load that file back"; any other error as "Compile failed: <message>"
  (for example an encoder refusal, "knn model file: ..."). `window.lastCompile` records the result for the
  checks (`:954`, `:961`).
- **Steps 3 and 4** use only `knnModel` / `activeLabels` from the loaded file (`loadModelForLang()`
  `:698-722`, `applyLoadedModel()` `:683-693`; `modelTrained` = at least 2 labels). Step 2's Next shows whenever
  a usable file is loaded (`:777`), not only after a Compile. When the server's file is missing or broken and
  only the IndexedDB copy is left (`cache-fallback`), the laptop refuses that copy (the status says "No model
  file: run Compile", Next stays hidden); the Pi accepts it, keeping the last good file like the kiosk
  (`:706-709`). If `model_status.php` is unavailable the page treats the device as the laptop
  (`.git/sdd/cm-task-6-review-1.md`, minor 4).
- **Export Data** (`:1455-1464`) now downloads the LOADED model file's rows as `{label: rows}` in header order
  (`siningkamay-training.json`, the old shape; budgeted rows, not every raw row); with no file loaded it toasts
  "No model file loaded: run Compile (Step 2) first.". **Load Saved** (`:1466-1469`) only toasts "Loading a
  training file is no longer used: Compile builds the model from the saved samples."
- **Gone:** `trainModel()`, `trainModelGuarded()`, `mergeSavedGestureSamples()`, `loadKnnFromCache()`,
  `trainData`, every `localStorage` use on this page (only the `sessionStorage` PIN flag is left), and the
  toasts "Loaded N saved landmark frames" and "Gesture model loaded" at page load.
- **Measured** (headless Chrome, this laptop; `tests/compact-model/training-check.mjs`):
  - Layout at 1024x600, Step 2: ESL | FSL 497x48 at y=99; status line y=153; card y=177 h=187 (laptop) or,
    with the Pi warning (y=177 h=35.5), y=218.5 h=145.5; progress y=370; log y=404 h=72; Compile and Next
    496x48 at y=482; Back 1000x44 at y=536; no overlap, no page scroll, 0 console errors
    (`.git/sdd/cm-task-6-report.md`).
  - Compile on today's data, after the batching change: ESL 2.5-3.0 s, FSL 1.9-2.5 s (click to done; ESL 3
    requests, FSL 2; `.git/sdd/cm-task-9-report.md`). The written files equal a node build over the same
    listing, and the fingerprint equals `model_status.php`'s `fingerprintNow`.
  - Page load: the summary listing ends 2.1-2.5 s after navigation, but the table appears at 12.4-12.8 s,
    because the MediaPipe warm-up (one main-thread task of 11.0-11.3 s) starts first; on an idle main thread
    the startup listing took 1.0-1.2 s against 3.3-3.9 s for the two full GETs before this phase
    (`.git/sdd/cm-task-6-review-1.md`; `docs/system/DEBT.md` item 137).
  - At scale (`tests/compact-model/scale-check.mjs`, 120 synthetic signs x 25 v3 samples = 3,000, plus today's
    data; two runs): Compile ESL 52.6 / 100.5 s and FSL 45.4 / 77.1 s, 1 summary + 62 `labels=` requests, the
    largest answer 2.4 MB; page load to ready 23.3 / 50.5 s. At 732 samples (122 x 6): ESL 33.4 s, FSL 31.1 s
    (`.git/sdd/cm-task-9-report.md`; `docs/system/DEBT.md` item 133).
- **After the owner archives today's signs, before a new import:** Compile refuses ("Add at least 2 signs
  before compiling"), the committed model files keep recognising the archived signs, and the laptop's status
  reads "Model out of date: run Compile" (`.git/sdd/cm-phase-review-1.md`, minor 5). Accepted.

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
- KNN (not a real neural net) chosen for gesture classification, allowing
  "instant, no epoch training needed" (gesture-training-ui.js:269 comment) —
  documented as a deliberate design tradeoff, though the UI still displays an
  "epochs" label of 50 that no longer reflects actual behavior (see §3), which is
  an inconsistency, not an explained decision. (2026-10-16: that comment went with
  `trainModel()`, and the epochs label is gone; Step 2 is Compile, see "Compact
  recognition model: Train Gestures" above.)

### 5. Constraints (Raspberry Pi / low-power specific)

- Kiosk viewport breakpoints explicitly targeted for a **1024×600** HDMI panel in
  both css/style.css (`@media screen and (max-height: 600px)`, line 507) and
  index.html's inline styles (`@media screen and (max-height: 620px)`,
  index.html:315, :498 as of the 1024×600 layout fixes). Since those fixes, index.html also has
  `@media screen and (max-height: 1146px)` (index.html:477) for the
  keyboard-open layout. That is not a device breakpoint: it is the measured
  height below which the keyboard overlaps the text input or Translate button
  (see the 1024×600 section at the top of this document).
- Explicit Raspberry Pi mentions: index.html:819 comment — hidden preload iframe is
  "Commented out to prevent GPU/RAM resource crashes on Raspberry Pi during Voice
  to Text"; css/gesture-training.css:716 comment references "Chromium freezes on
  Pi"; gesture-training-ui.js:918 comment "Chromium freezes on hidden element."

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
  **Addendum (2026-09-26, video-based gesture capture):** `gesture-training.html`
  now also loads `js/capture-core.js` and `js/video-landmarks.js` (right after
  `js/gesture-data.js`, before `js/gesture-category.js`, `gesture-training.html:
  12-15`) and `js/gesture-capture-ui.js` (after `gesture-training.html`'s
  `#gcMode` markup, before `js/gesture-training-ui.js`, `gesture-training.html:
  382-383`) — see `docs/system/INVENTORY.md` for the full current load order.
  `js/gesture-capture-ui.js` requires all three of `window.GestureCaptureCore`,
  `window.VideoLandmarks` and `window.GestureDataRecorder` to be loaded before
  `openRecordingMode()` can call `GestureCaptureUI.open()`
  (`js/gesture-capture-ui.js:186-189` logs and no-ops otherwise); this list is
  additive only — no existing script in the load order was removed or reordered
  relative to what it already depended on.
- **gesture-training-ui.js → php/api/save_gesture.php** (delete) — uses a
  hardcoded `/Sining_kamay/` fallback path (gesture-training-ui.js:244-246) that
  does **not** match the dynamic `/SKR`-or-`/Sining_kamay` detection used in
  script.js:847-849 — an inconsistency (see Problems Found). (This file also
  called `php/api/bulk_importer_api.php`'s `convert_video` action, at what was
  gesture-training-ui.js:1064-1066, for the "Upload & Process Video" button —
  both the call and the button were removed in Phase 2 along with the endpoint
  itself; see `docs/system/DEBT.md` item 26.)
- **index.html voice screen ↔ js/virtual-keyboard.js**: see Part 1 §6. The
  typing layout (`index.html:463-493`) is scoped to `@media (max-height: 1146px)`,
  a measured value. Changing the controls panel's contents or spacing, or the
  keyboard's height, moves the height at which the input and Translate button
  clear the keyboard, so re-measure it (method in
  `docs/system/UI-SURVEY-1024x600.md`, finding 1). The hidden elements are
  selected by `#start-btn`, `.tts-mic-label`, `.tts-lang-toggle` and `.tts-or`;
  renaming any of them leaves that element visible while typing, which at short
  heights pushes the input back under the keyboard.
- **reports.html table columns**: `reports.html:71-79` targets columns by position
  (`th:nth-child(6|7)` for Created, `td:nth-child(3|4)` for the wrapping text
  columns) in the two ESL/FSL tabs (`renderSigns`). Adding, removing or
  reordering a column in the `<thead>` markup (`reports.html:411-417`) or in
  `renderSigns` moves those widths and wrapping rules onto the wrong column,
  and truncation returns. The 150 px Created width assumes 12 px Inter
  (`css/fonts.css`) and the `YYYY-MM-DD HH:MM:SS` format `php/api/reports.php`
  returns. **The Conversations tab (2026-09-25, replacing the old
  Translations tab) has its own separate, 6-column positional rule
  (`#tab-conversations` — see the "Reports Conversations tab" bullet in §3
  above), independently widened; the two tabs' column-width rules do not
  share a selector and must be kept in sync by hand if the shared `12px
  Inter` assumption ever changes.**
- **reports.html → php/api/reports.php**: path logic keys off `location.port`
  rather than protocol+path-name pattern used elsewhere (reports.html:613-615), and
  hardcodes `/Sining_kamay/` (not `/SKR/`) for the `file:`/non-standard-port
  branch — another divergent hardcoded-folder-name instance.
- **learn-signs.html** embeds an external Netlify URL via `<iframe>`
  (learn-signs.html:87) — a live network dependency; if that Netlify deployment is
  taken down or the URL query-string token expires, "Learn Signs" shows a
  blank/broken iframe with no fallback UI in this file. Out of scope for Phase 2
  (see Problems found, below); now also tracked in `docs/system/DEBT.md` item 29
  — this document had it, but it was never carried into DEBT.md's consolidated
  list until Phase 2 verification noticed the gap.
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
  (gesture-training.html:261) shows "0 / 50 epochs", but `trainModel()`
  (gesture-training-ui.js:422-562) never runs 50 iterative epochs — it's a KNN
  cache-merge with a cosmetic 10- or 20-step progress animation. The `EPOCHS`
  constant appears unused by the actual training path (no other reference to
  `EPOCHS` found in the file). **2026-10-16:** the label and `trainModel()` are gone
  (Compile, compact-model phase); `const EPOCHS = 50` is still declared and unused
  at gesture-training-ui.js:15 (and `js/sign-to-text-ui.js:15`), with `tfModel`
  (`:3` / `:6`) — dead code, `docs/system/DEBT.md` item 140.
- index.html:819-820 — a commented-out `<iframe src="preload.html">`, explicitly
  left in with a Pi-crash-avoidance comment; `preload.html` is otherwise fully
  orphaned dead code (see verify-only section above).
- ~~`learn-signs.html`:7 and most other owned HTML files load
  `https://fonts.googleapis.com/css2?...` (external network reference) — external-
  network dependency present despite the "fully offline" system description.
  Occurrences: index.html:13, gesture-training.html:7, bulk-importer.html:7,
  reports.html:7, learn-signs.html:7.~~ **RESOLVED (Phase 2)** — self-hosted,
  see `docs/system/DEBT.md` item 1. `bulk-importer.html` itself is deleted
  (item 3/26).
- `learn-signs.html`:87 embeds a third-party Netlify-hosted site via `<iframe>`
  with a Facebook click-id (`fbclid`) query string baked into the URL —
  external-network reference, factually noted. **Not resolved** — out of scope
  for Phase 2, tracked as `docs/system/DEBT.md` item 29.
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

---

## Part 3: "Let's Talk" conversation screen (talk.html)

> **Update 2026-10-18 (accounts-quiz phase):** the header's right side now holds "+ New conversation" and the
> account chip (Part 4); conversations save with the logged-in user's id and a title. Nothing else changed.

New file, built as one phase (see `docs/superpowers/plans/2026-09-16-talk-html.md`
for the six-task build order and `docs/system/DECISIONS.md` for every
non-obvious call made while building it). UI-only, fake/canned data — no
camera, microphone, MediaPipe, TensorFlow, Vosk, or database access anywhere
in this file. Not yet linked from `index.html`'s dashboard (talk.html:1
onward is reached only by typing `/SKR/talk.html` directly); see
`docs/system/DECISIONS.md` for why.

> **Updated 2026-09-21 — the signing screen and the speech-model load are now
> real; the rest of this Part describes the earlier fake-data phase and is
> still accurate for everything not listed in "3a" below.** Where the two
> disagree ("no camera, MediaPipe, TensorFlow, Vosk … anywhere in this file",
> "the five hooks are all empty", the canned signing pool), 3a wins. The
> speaking screen's mic button is still a canned stand-in.
>
> **Updated 2026-09-25 — every message added to the thread and every
> conversation end is now also saved to the database; see "3c" below.**
> Where the text above or below still says "no … database access anywhere in
> this file," "no DB logging," or that the 30-bubble cap's removed messages
> are gone rather than "still live in the database," 3c wins. Nothing else
> about the thread/screen/modal behaviour described below changed — only that
> a save call now runs alongside it.

### 3a. Signing-screen merge (spec: `docs/superpowers/specs/2026-09-21-signing-screen-merge-design.md`)

**New files:** `js/talk-loader.js` (loading queue + dev overlay),
`js/talk-signing.js` (camera lifecycle + recognition loop). **Additive edit:**
`js/gesture-data.js` (`preloadMediaPipe` `:434`, `pauseHandLoop` `:412`,
`resumeHandLoop` `:422`, hotkey opt-out `:660`). Both new scripts are plain
`<script src>` tags before the inline script (`talk.html:1118-1119`).
Reused, not copied: `js/sign-to-text-ui.js` (`knnPredict`,
`autoTrainForTranslate`, `translateGestureLabel`, `formulateSmartSentence`),
`js/camera-helper.js` (`initCameraWithFallback`, `extractFeatures`).

**Loading queue (`js/talk-loader.js`).** Starts once, on window `load`
(`talk.html` never restarts it), and runs five items strictly one after
another: sign-libs (`tf.min.js`, `hands.js`, `camera-helper.js`,
`gesture-data.js`, `sign-to-text-ui.js`), MediaPipe (`Hands` constructed on the
hidden `#signing-video` and `initialize()`d), gesture set (`autoTrainForTranslate()`
— localStorage cache or database; since 2026-10-04 run together with `loadSigns()`, see 3d; **since 2026-10-16 the
compiled model file, see 3f**: sign-libs also loads `js/knn-compile.js` and `js/knn-model-store.js`), then Vosk library (`js/vosk.js`), Vosk model
(`Vosk.createModel(models/vosk-model-small-en-us-0.15.tar.gz.zip)`). Each item
is `queued | loading | done | failed`; a failed item marks its dependents
"skipped" and the other stack still runs. API: `TalkLoader.start/isSettled/
getItems/getProgress/onChange`. Real timings through the queue (headless
Chrome, cache disabled): warm k-NN cache — sign-libs 168 ms, MediaPipe 245 ms,
gestures 10 ms, Vosk lib 72 ms, Vosk model 999 ms, all settled at 1.5 s; cold
cache — gestures 1269 ms, Vosk model 3438 ms, settled at 5.8 s.
**Dev overlay:** `talk.html?devqueue` shows one line per item (status, ms,
failure reason); absent from the DOM on a plain load.

**Signing screen sub-states** (`#screen-signing[data-signing]`):
- `guide` — first entry to Sign this conversation until "Start Translating →"
  is tapped once. The 3-step Guide text is `sign-to-text.html`'s, unchanged.
  A label reads "Getting ready… N of 5" until the whole queue settles (both
  stacks), then "Ready"; the button is disabled until then, and stays
  disabled with "Signing is not available right now." if the sign stack failed.
  The step list scrolls inside the card with a fade cue (`.guide-list.has-more`).
- `live` — camera 560×300 in the centre, ESL Mode / FSL Mode chips and a Hand
  Guide toggle in 200 px side columns (200×60 each), live caption pill
  (`#signing-caption`), draft of accumulated words (`#signing-draft`), one
  orange 560×68 button. Later turns skip the guide and go straight here.
  *Update 2026-10-18 (owner feedback, layout only, `docs/reports/2026-10-18-talk-camera-layout-final.md`):* a 760 px
  column fills the screen's height: the camera panel flexes (760×322 on the first turn, 760×226 under the thread
  strip), the video and the landmark canvas cover it (`object-fit: cover`, mirrored), the sentence is a 760×76 white
  bar under the camera (22 px bold, two-line clip, newest word highlighted, `TalkSigning.renderDraft`), the status is
  a 14 px chip in the video's top-left corner, the controls end at y 588. Checked by
  `tests/accounts-quiz/talk-layout-check.mjs`.
  *Superseded the same day (`docs/reports/2026-10-18-talk-camera-side-final.md`, `docs/design/talk-camera-wireframe.html`):*
  side by side. Left: the camera panel at the camera's own ratio (`--cam-ar` from `videoWidth`/`videoHeight`, 4:3
  default), full height under the top bar (648×486 on the first turn, 520×390 under the thread strip),
  `object-fit: contain` (nothing cropped), mirrored; the landmark canvas is placed by `js/gesture-data.js` as
  before; the status chip on the video. Right column (`.signing-side`, 338 px on the first turn): SIGNED SENTENCE
  label, the sentence box (24 px / 800, whole lines via `--draft-max`, newest word orange), EN|FIL 52 px, the main
  action 60 px, Guide 52 px, stacked full width; ends at y 588. The `.signing-controls-row` is gone.

**Camera lifecycle** (`onEnterSigning` `talk.html:1559` → `TalkSigning.enter()`
`js/talk-signing.js:255`; `onLeaveSigning` `:1568` → `leave()` `:294`).
`enter()` is a no-op while active; a generation token discards a stream that
arrives after the user has left; the success callback cannot throw
(`camera-helper` would re-request). `leave()` stops every track, nulls
`video.srcObject`, clears the tick and countdown, pauses the frame loop, and
never touches `Hands`, the model or the queue. **Measured** (Chrome with a fake
camera device, CDP): one `getUserMedia` per real entry (3 entries → 3), `Hands`
constructed once, every track `ended` and `stream.active === false` after each
leave, `video.readyState` 0, `hands.send` 9 calls/1.5 s live → 0 after leave →
9 after re-entry.

**Recognition** (`tick()` `js/talk-signing.js:125`, every 150 ms; constants
copied from `js/sign-to-text-ui.js` with their line numbers): rolling window 4,
stability 2 ticks, hold 500 ms, confidence floor 0.45, no-hand 300 ms,
countdown 3 s. Flow is unchanged from `sign-to-text.html`: idle → the "start"
gesture (held) or the orange button → 3 s countdown → recording (words are
added on a held gesture; button reads "Stop & Add to Conversation"; camera
outline turns green) → the "stop" gesture or the button. The tick does nothing
while any modal is open.

**Output.** Stop → `formulateSmartSentence(words, signLang)` →
`openModal('confirm', {label:'You signed', text, from:'deaf'})` — the same
confirm card every path uses ("Add to Conversation" → bubble + thread, "Try
again" → back to idle). There is no Result screen and no "Translate Text to
Sign" link. Error cards (existing `renderErrorModal`): "Camera not available" /
"Go back", "Didn't catch that" (empty sentence) / "Try again", "Sign set not
available" (language switch failed), "Microphone not available" / "Type
instead" (speech stack failed, once).

**Speak or Type** (`#screen-speaking[data-wait]`): no guide. While the queue is
unsettled the mic row and text row are hidden and "Getting ready… This only
takes a moment." shows; once settled they return. The mic button is still a
canned stand-in — this phase loads the Vosk model but does not capture speech.

**Measured layout** at 1024×600 (real Chrome, scale 1): `scrollWidth` 1024 in
who-first, Guide, live, live turn 2+, speaking, confirm card, error card,
camera-error card; camera 560×300; button 560×68; chips 200×60; Guide card
660×482 on turn 1 and 660×386 on turn 2+; turn 2+ button bottom edge 584.
Exactly one visible orange element per state (Guide: `guide-start-btn`; live:
`stop-signing-btn`; speaking: `speaking-send`; who-first: the Speak tile) — the
only other orange match is the parked, off-stage virtual keyboard's HIDE key,
which is pre-existing.

### 3b. Text-to-sign merge — the real Speak or Type screen (spec: `docs/superpowers/specs/2026-09-21-text-to-sign-merge-design.md`)

**New files:** `js/sign-player.js` (`window.SignPlayer` — DOM-agnostic port of `js/script.js`'s sign pipeline),
`js/talk-speaking.js` (`window.TalkSpeaking` — Vosk capture), `assets/signs/en/fallback.png` +
`assets/signs/fil/fallback.png` (neutral grey "?" placeholder tiles, 360×360; the pipeline's last step
requested them but they never existed). Both scripts are plain `<script src>` tags before the inline script.
`js/script.js` was never loaded by `talk.html` and was not edited; it was archived (`archive/script.js`) together with `#translator-pane` in commit `c94d62c` — the `script.js:NNN` citations in the new files refer to `archive/script.js`.

**Sign pipeline (`js/sign-player.js`).** A port of a copy, not a shared module (`script.js` cannot be loaded
into `talk.html`: `:13`/`:441` dereference `index.html`-only ids). The asset maps, `normalizeSpeechText`,
`formatGrammar`, `rebuildKnownPhrases` and `fetchAndRegisterCustomGestures` are byte-for-byte copies (verified
by diff); `findLongestKnownPhrase`, `displaySignWithFallback`, `displayMedia` and `playSequence` are the same
logic and constants. Departures: the language is an argument (not `#lang-select`), container/label are injected,
a cancellation token, every `<video>` released, and the fallback `<img>` is built with DOM APIs (the original
interpolated the typed label into `innerHTML`). Chain: probe `assets/signs/<lang>/<word>.webm` → static map →
per-letter fingerspelling → `fallback.png` (single unmatched character) — a 2000 ms hold follows a static-map
success only. **Measured through the real UI** (headless Chrome, 1024×600; Translate click → sequence done;
clip durations from the repo's `ffmpeg.exe`):

| Language / text | Path taken | Measured | Expected from clips |
|---|---|---|---|
| en `hello` | custom `hello.webm` | 2043 ms | 2.00 s |
| en `thank you` | probe `thank_you.webm` (absent) → map → `nice_to_meet_you.webm` + 2000 ms hold | 4856 ms | 2.80 + 2.00 = 4.80 s |
| en `xyz` | probe `xyz.webm` (absent) → fingerspell X, Y, Z | 8565 ms (labels at 36, 2682, 5523 ms) | 2.60 + 2.80 + 3.00 = 8.40 s |
| en `@` | no clip, no map entry, length 1 → `fallback.png` | 1266 ms | 1200 ms + probes |
| fil `kamusta` | custom `fil/kamusta.webm` | 2046 ms | 2.00 s |
| fil `xyz` | fingerspell → **no letter clips exist in `assets/signs/fil/`** | 128 ms, nothing displayed | — (known gap, `DEBT.md`) |
| fil `@` | `fil/fallback.png` | 1279 ms | 1200 ms + probes |

Note: digits have clips (`assets/signs/en/5.webm` exists), so a single digit is *not* an unmatched character.

**Screen states** (`#screen-speaking[data-speaking]`, all in the same column; `#screen-speaking` stays
`[0,0,1024,600]` in every state — measured):
- `compose` — English/Filipino chips (200×60, at x=306 and 518, y=178 on turn 1), the mic (110×110), and
  `[input 700×64 | Translate 180×64]`. **Translate** is that state's one orange element and is disabled while the
  input is empty, whitespace-only, contains only `?`, **or a mic capture is starting/running** (`TalkSpeaking.isBusy()`).
  Enter in the input does nothing. Chips and mic hide together while the on-screen keyboard is up
  (input row at y=106…170, keyboard top y=360); they return to identical boxes afterwards (measured).
- `preview` — replaces the chips/mic/input rows in place: sign frame 560×260 (`--navy` backdrop), the current word
  (28 px bold), and `[Edit 271×64 | Send 269×64]`. **Send** (the same `#speaking-send` element and click handler as
  before, only moved) is the one orange element and is enabled immediately; Send and Edit cancel playback.
  On turn 2+ (96 px strip) compose spans y=226…561 and preview y=202…584 — both inside 186…600.
- The thread never receives the clip: after Send → confirm → Add, `#thread` contains 0 `video`/`img`/`audio`
  nodes and the bubble is text only (`from:'hearing'`).
- `scrollWidth` is 1024/1024 in compose, compose + keyboard, preview (playing), preview on turn 2+.

**Speech (`js/talk-speaking.js`).** Tap the mic to start, tap again to stop; the transcript (final + partial) is
written into `#speaking-input`, with an `input` event whenever the text actually changes (so Translate gating and the
idle timer stay in sync; empty repeat partials from the recogniser are ignored — found in the final review). Ready hook: `TalkLoader.voskModel !== null` (set by the queue before the `vosk-model` item is marked
done; the loader gained no new API). On stop the last partial is appended and `formatGrammar` applied; Translate
strips `?` before playing (`normalizeSpeechText` does not). Filipino disables the mic ("Voice input disabled in
Filipino", as `script.js:467-485`); typing still works and plays from `assets/signs/fil/`. The kiosk USB mic is
auto-selected (`ab13x` / `usb audio`, `script.js:1050-1063`); the pane's mic-picker dropdown is not ported.
Leaving the screen, focusing the input while a start is pending, or switching to Filipino discards/stops capture and
releases the hardware. **Bundled-Vosk facts found while porting:** `recognizer.on()` attaches to the *model's* event
target with no removal and no `recognizerId` filter, so per-capture listeners (what `script.js` does) multiply the
transcript — the module registers one listener pair per model, filtered by `recognizerId`; `KaldiRecognizer.remove()`
exists and is called (`script.js:261` leaks one worker-side recognizer per start). **Measured:** one 41 MB model
fetch and one `vosk.js` fetch per page load (Apache log); 1 mic tap → 1 `getUserMedia`; after stop 0 live audio
tracks and 0 unclosed `AudioContext`s (of 1); 10 start→stop cycles → 0 extra model loads; a synthesized-speech WAV
("hello how are you", looped) transcribed as `hello how are you hello how are you hello how are you`, previewed as
HELLO → HOW ARE YOU → HELLO → HOW ARE YOU → … (the phrase matcher groups "how are you").
Errors reuse the existing error card: mic denied → "Microphone not available / Type instead".
`SignPlayer.registerCustomGestures()` adds one `save_gesture.php?no_sync=1` fetch on first entry (measured 2 in a cold-cache page
load, together with the queue's own).

### 3c. Saved conversations (Let's Talk history, admin-only; spec: `docs/reports/2026-09-25-saved-conversations-step1.md`)

**New file:** `js/talk-history.js` (109 lines) — a self-contained IIFE, no
dependency on any other new-in-this-phase file, exposing
`window.TalkHistory = { saveMessage, end }`. Loaded via one more `<script
src="js/talk-history.js">` tag, before the inline script (`talk.html:1214`).

**What gets saved, and when — additive only, no existing behaviour changed:**
- **Every message that reaches the confirm card's "Add to Conversation"
  handler** (`talk.html:1421-1425`, the same single call site documented in
  §3 below as the *only* way a message enters `#thread-list`) also calls
  `TalkHistory.saveMessage({from, source, signLanguage, text})` right after
  `appendBubble(...)`, wrapped in its own `try/catch` so a save failure can
  never stop the bubble from rendering or the modal from closing.
  - **Signed** messages: `TalkSigning.init({onText})`'s callback
    (`talk.html:1849-1852`) now receives a second argument,
    `{signLanguage: 'ESL'|'FSL'}`, from `js/talk-signing.js:127`'s `finish()`
    (`signLang === 'fil' ? 'FSL' : 'ESL'` — the one line that function's
    `cb.onText(...)` call gained this phase).
  - **Spoken vs. typed**: `js/talk-speaking.js` calls a new
    `cb.onTranscript()` right after each of its two existing writes into
    `#speaking-input` (`renderTranscript()` and `stopCapture()`,
    `js/talk-speaking.js:65,232`). `talk.html`'s own `onTranscript` handler
    (`:1950`) sets a hoisted flag, `speakingFromMic = input.value.trim() !==
    ''` — true exactly when the mic has written non-empty text into the
    field since it was last empty. Send (`:1905-1913`) reads that flag into
    `source: speakingFromMic ? 'speech' : 'typed'` and then resets it to
    `false`; the field-emptied `input` listener (`:1889-1890`) also clears it
    early. Net effect (owner decision, `docs/system/DECISIONS.md`): typing
    over part of a mic transcript still counts as `'speech'`; only clearing
    the field to empty resets the next message to `'typed'`.
- **Every conversation end** — End Conversation (`talk.html:2026`), the idle
  countdown reaching 0 (`:1497`), and the idle card's End Now (`:1523`) — now
  calls `onEndConversation(reason)` (`:1301-1305`), which calls
  `TalkHistory.end(reason)` in `try/catch` *before* the existing
  `TalkSpeaking.leave()`/`TalkSigning.leave()` calls, so a hung/slow save
  request can never delay releasing the camera/mic. `reason` is `'ended'` for
  both End Conversation and End Now (owner decision: a person tapped
  something), `'idle'` only for the countdown reaching 0 on its own.
  `js/talk-history.js` also listens for `pagehide` itself
  (`window.addEventListener('pagehide', function () { end('left'); })`) so a
  reload, tab close, or kiosk restart still closes out the conversation —
  this is the only one of the four reasons not driven by an explicit
  `onEndConversation()` call from `talk.html`.
- **Fire-and-forget, by design (global constraint):** `saveMessage`/`end`
  POST JSON to `php/api/save_conversation.php` with `fetch(..., {keepalive:
  true})` (so the request can survive the page unloading right after End),
  never `await`ed by any caller, and every failure path — a rejected fetch,
  a thrown synchronous `TypeError` from an overridden `fetch`, a non-2xx
  status, unparsable JSON, or a body that isn't `{success:true}` — ends in
  exactly one `console.warn`, never a thrown error and never any UI (no
  modal, no toast, no retry). Verified with `window.fetch` forced to reject
  and separately forced to resolve a 500: the bubble still appears, the
  confirm modal still closes, End still navigates, and only the one expected
  `console.warn` line appears (`.git/sdd/conv-task-4-report.md`).
- **A per-page `client_key`** (32 lowercase hex chars from
  `crypto.getRandomValues`, made once at script-parse time) stands in for a
  server-assigned conversation id, since the page can never wait for a
  response before it might unload — see `docs/system/BACKEND.md`'s
  `save_conversation.php` section. **Opening the screen and leaving without
  ever confirming a message sends zero requests** — `saveMessage`/`end` both
  no-op until at least one message has been confirmed (`confirmed === 0`
  guard), and `end` additionally no-ops if it already ran once (`ended` flag,
  so `pagehide` after an explicit End sends nothing more).
- **Never a read.** `js/talk-history.js` only ever calls `saveMessage`/`end`;
  there is no function in it, or anywhere else in `talk.html`, that fetches
  past conversation data. Past conversations are reachable only from
  `reports.html`'s Conversations tab, after its PIN — see Part 2 below.

**Not exercised with real hardware this phase:** the actual
`js/talk-speaking.js`→`onTranscript()` and `js/talk-signing.js:127`→`onText`
calls from a real microphone/camera round trip — the available
browser-automation environments block real device capture. Both were
verified by code review, `node --check`, and a temporary debug hook driving
the exact same downstream code, then fully reverted
(`.git/sdd/conv-task-4-report.md`); a real signed turn is flagged for the
owner to verify on real hardware (`docs/system/DEBT.md` item 85).

### 3d. Sign texts in Let's Talk (sign-texts phase, 2026-10-04)

`talk.html` reads the same sign set/texts as the training page; no `talk.html` markup or `js/talk-signing.js` /
`js/talk-speaking.js` / `js/talk-history.js` code changed (`.git/sdd/st-task-6-report.md`). Models and display text:
`docs/system/ML.md`; storage: `docs/system/BACKEND.md`.
- **Captions come from the texts.** `translateGestureLabel()` (`js/sign-to-text-ui.js:62`, re-measured 2026-10-16, was `:65`) first asks
  `GestureDataRecorder.getSignText(key, lang)` (ESL chip → English text, FSL chip → Filipino text) and only then falls
  back to the old table/title-cased key. So the live caption pill, the draft and the confirm card show the text of
  the active language, never the slug. Measured over 20 s with a fake camera: every shown caption was a sign text of
  that language and none contained an underscore (EN: "Show your sign", "Stabilizing…", "Zz Both Probe?", "Zz Esl
  Only"; FIL: "Zz Pareho Probe?", "Zz Pareho Na", "Zz Fsl Lamang"; `.git/sdd/st-task-8-report.md` item 8).
- **Loading queue.** The `gestures` item is still one item (`js/talk-loader.js:50-62`, re-measured 2026-10-16, was `:48-60`) and now runs
  `Promise.all([autoTrainForTranslate(), GestureDataRecorder.loadSigns()])`. A failed or rejected `loadSigns()` only
  `console.warn`s (captions fall back to the labels); the item fails only if `autoTrainForTranslate()` fails. Measured
  (`tests/sign-texts/talk-check.mjs`, headless Chrome 1024×600, real Apache/MariaDB): queue settled in 8094 ms, all 5
  items done (sign-libs 651, mediapipe 874, gestures 2087, vosk-lib 272, vosk-model 5258 ms), overlay present, 0
  console errors. Models: ESL 122 labels (includes `how_are_you` and `a`); FSL 90 labels (includes `how_are_you`; no
  ESL-only sign, only the shared `start`).
- **Text-to-sign registers sign texts** (`js/sign-player.js:245-281`, `fetchAndRegisterCustomGestures()` now reads
  `php/api/signs.php` instead of `save_gesture.php?no_sync=1`). For each sign: an ESL/Both sign registers its
  `normalizeSpeechText(textEn)` in the English asset map, an FSL/Both sign its `normalizeSpeechText(textFil)` in the
  Filipino map; the value is the sign's `assetPath` (else `<key>.webm`). **Both with and without "?"**:
  `normalizeSpeechText` keeps "?", but speech never produces it while typed text may, so the text is registered as
  normalized and again with `[?¿]` removed (whitespace collapsed; skipped if empty or identical). The key and the
  key with spaces are registered per language map too. Existing entries are never overwritten (`!map[k]`), and
  `rebuildKnownPhrases()` runs after. `displaySignWithFallback` uses an asset-map value that starts with `assets/` as
  the path as-is (`js/sign-player.js:413`) instead of prefixing the language base. The first-step probe
  `assets/signs/<lang>/<word>.webm` still runs before the map. A **Both sign's `assetPath` is its `en/` clip**, so
  the Filipino map entries of a Both sign point to the `en/` clip; the Filipino probe wins first when a `fil/` clip with
  the same name exists.
  Measured (`talk-check.mjs`, `verify-e2e.mjs`): EN "how are you" → `assets/signs/en/how_are_you.webm` (200), FIL "kamusta
  ka" → `assets/signs/fil/kamusta_ka.webm` (200), one clip each and no fingerspelling; EN "Zz Both Probe" (no clip)
  → `en/zz_both_probe.webm` 404, then fingerspelled z, b, o (200); FIL with no clip → every probe 404 and **nothing
  plays** (no Filipino letter clips exist, `docs/system/DEBT.md`). The earlier statement above ("`registerCustomGestures()`
  adds one `save_gesture.php?no_sync=1` fetch ... measured 2") predates this: the fetch is now `signs.php`, and the
  count was not re-measured.
- **Signing flow.** The Translate-button flow with the fake camera is timing dependent (a "Didn't catch that" card
  in 2 earlier runs, a confirm card "You signed Zz Pareho Na." in the run that was checked); the start → sign → stop
  gesture flow was not driven (the fake camera shows only `hello`). A real-camera check is still open (DEBT).

### 3e. 2D avatar in Speak or Type (avatar phase, 2026-10-05)

**Superseded in part 2026-10-19 (3g):** the video fallback, the 560x260 frame and the word label are gone; every
word plays or is fingerspelled on the avatar.

Proposal `docs/reports/2026-10-05-avatar-step1.md`; final report `docs/reports/2026-10-05-avatar-final.md`;
decisions in `DECISIONS.md` ("2D avatar phase").
- **What the user sees.** Translate in Speak or Type now plays every run of consecutive words whose sign has an
  avatar clip on a flat 2D cut-out avatar inside the same 560x260 frame, as one continuous movement (rest ->
  sign -> blend -> sign ... -> rest). A word without a clip, or whose clip fails to load, plays exactly as
  before (video -> fingerspelling -> `fallback.png`). The word label shows the current sign's text in upper
  case, as for video. Edit, Send and leaving the screen stop the avatar. No new buttons or screens; the thread
  and the confirm card are unchanged.
- **Markup.** `#speaking-sign-frame` now holds `#speaking-sign-media` (the SignPlayer's video/img container)
  and `<canvas id="speaking-avatar" width="560" height="260" hidden>` positioned over it. Measured: the canvas
  is exactly the frame (232,154 560x260 on turn 1); `scrollWidth` 1024.
- **Scripts** (before `js/sign-player.js`): `js/avatar-rig.js`, `avatar-clip.js`, `avatar-retarget.js`,
  `avatar-timeline.js`, `avatar-renderer.js`, `avatar-store.js`, `avatar-player.js`. Holistic is never loaded by
  `talk.html` (measured: no request).
- **Loading.** The four PNGs (`assets/avatar/`, 450,910 bytes) load once at page load, outside the
  `TalkLoader` queue (a failure only means video; measured: 4 PNG requests per page load). Clips load per
  sentence from `saved_gestures/<key>/avatar.json` into a 12-clip LRU cache (`js/avatar-store.js`, 3 s timeout).
- **Hand tracking.** The player's `onStart` calls `GestureDataRecorder.pauseHandLoop()`; `onEnd` calls
  `resumeHandLoop()` only if `body[data-screen] === 'signing'`. On Speak or Type the camera is already off
  (`TalkSigning.leave()`), measured 0 `Hands.send` during playback; on the signing screen (fake camera)
  46-48 sends/s before, 0 during, 47-66 in the 1.5 s after.
- **Look.** Flat colours only (no gradients, blur, shadows or `ctx.filter`), blink every 2.6-5.2 s, breathing
  (0.6% torso stretch), farther arm and farther fingers drawn first, own light background (`#EEF1F7`) inside
  the navy frame. Capped at 30 fps; measured on this laptop 29.9 fps (p5 29.2-29.8), 0.3 ms per frame
  (`tests/avatar/talk-avatar-check.mjs`, `tests/avatar/bench.html`). Pi: not measured
  (`tests/avatar/pi-bench.sh`).
- **Measured** (`tests/avatar/talk-avatar-check.mjs`, 26/26 PASS): "zz ava one zz ava two zz ava three" ->
  one `play()` with 3 clips, captions in order, 0 `<video>` created, canvas never hidden mid-run, 6.8 s;
  transitions 350 / 431 / 250 / 400 ms with worst joint jumps 40.6 / 44.3 / 37.4 / 21.5 px per 40 ms
  (2026-10-14, clips from the committed fixture, every 40 ms window overlapping a transition: 618 / 532 / 250 /
  400 ms, 45.6 / 49.7 / 34.7 / 28.7 px, identical in 5 of 5 runs);
  "zz ava one nice" -> the avatar run, then `assets/signs/en/nice.webm` 15 ms after it ends; a clip removed after
  registration -> that word fingerspelled as video; 0 console errors.

### 3f. Compact model in Let's Talk (compact-model phase, 2026-10-15/16)

No `talk.html` markup, CSS or behaviour changed, and `js/talk-signing.js` is unchanged. Model and measurements:
`docs/system/ML.md` "Compact model".
- **Scripts.** The queue's sign-libs item loads `js/knn-compile.js` and `js/knn-model-store.js` before
  `js/sign-to-text-ui.js` (`SIGN_SCRIPTS`, `js/talk-loader.js:10-18`). The queue still has 5 items.
- **Model loading.** `autoTrainForTranslate()` (`js/sign-to-text-ui.js:150-174`) keeps its name and callers (the
  "gestures" item, `js/talk-loader.js:59`; the language switch, `js/talk-signing.js:220-227`). It calls
  `KnnModelStore.load('ESL'|'FSL')`: one `HEAD models/knn_<LANG>.bin` (`cache: no-store`) and, in parallel, a read
  of the IndexedDB copy (database `sining_kamay_models`, store `models`, key `ESL`/`FSL`,
  `js/knn-model-store.js:14-16`). The copy is used when its ETag (a weak `W/` prefix ignored) and length match
  the HEAD (`sameFile()`, `:134-142`); otherwise one GET, decode and store. Both languages are kept, so a switch
  back is served from IndexedDB. It logs `[KNN] <LANG> model: <rows> rows, <labels> labels (<source>)`
  (`js/sign-to-text-ui.js:163`).
- **Keeps the last good file.** When the HEAD or GET fails, or the downloaded file does not decode, the stored copy
  is used with one `console.warn` (source `cache-fallback`, `js/knn-model-store.js:183-198`). With no usable file
  and no stored copy, or a model with fewer than 2 labels, `autoTrainForTranslate()` returns false and the
  "gestures" item fails with "gesture set unavailable (no usable model file and no stored copy)"
  (`js/talk-loader.js:60`); a failed language switch shows the existing "Sign set not available" card and goes
  back to the previous language. The page never compiles.
- **No samples.** `mergeSavedGestureSamples()`, `loadKnnFromCache()`, `buildKnnFromDatabase()`, `trainData` and
  every `localStorage` model key were removed from `js/sign-to-text-ui.js`; the only PHP endpoint the kiosk
  requests for recognition and texts is `php/api/signs.php`, with 0 requests to `save_gesture.php`
  (`tests/compact-model/kiosk-check.mjs`, 3 runs). The one-time schema-"3" reset
  (`js/gesture-data.js:16-25`) removed 1,200,000 characters of old keys in that check.
- **Sign texts.** Each loaded header's texts are registered with `GestureDataRecorder.setModelSigns()`
  (`js/sign-to-text-ui.js:162`), so a sign the Pi's database does not list (for example one that exists only
  through bulk import) still gets its caption (`getSignText()`, `js/gesture-data.js:712-721`; DB text first).
- **Timings** (laptop, kiosk-check): cold "gestures" item 108-133 ms, reload 46-58 ms, first FSL switch 44-48 ms,
  later switches 7-14 ms (`docs/system/ML.md`; before this phase 799-995 ms cold and 754-1,142 ms for every FSL
  switch). The "Loaded N saved landmark frames" toast and `tlDbStatusDot` updates went with
  `mergeSavedGestureSamples()`; neither element exists in `talk.html`.
- **Not verified:** a missing or broken model file on the real kiosk page in a browser (covered by
  `tests/compact-model/store-check.mjs` for the store and by a unit test with a rejecting store,
  `tests/sign-texts/talk-texts.test.mjs`), and anything on the Pi (`docs/system/DEBT.md` items 129, 138).

### 3g. Turns, sign audio, avatar-only playback (talk-turns-audio phase, 2026-10-19)

Spec `docs/superpowers/specs/2026-10-19-talk-turns-audio-design.md`; wireframes `docs/design/talk-flow-wireframe.html`,
`docs/design/sign-audio-wireframe.html`; report `docs/reports/2026-10-19-talk-turns-audio.md` (before/after screenshots).
Supersedes the video parts of 3e and the confirm card of the earlier sections.
- **Avatar only (no video).** `js/sign-player.js` (337 lines, rewritten) plays a word/phrase whose sign has avatar data
  (`signs.php` `avatar`) as that sign, and fingerspells every other word on the avatar with the letter signs a-z and
  the number signs (`plan()`, `:170`; a number 1-10 is one sign, others digit by digit; the number sign is key `"3"` if
  it exists, else `three`, `numberKey()` `:149`). A character with no clip shows in the caption only for
  `CAPTION_ONLY_MS` = 700 ms (`:18`). No `<video>`/`<img>`, no `assets/signs` request, no `fallback.png`.
- **Sign screen.** The main button is "Send 🔊" (`js/talk-signing.js` `renderButton()` `:78`), enabled once the sentence
  has a word. Recording starts by itself when the camera runs (`:352`, the same 3 s countdown). Send or the "stop" sign
  -> `finish()` (`:144`) -> `onText(text, {signLanguage, lang, words, keys})`. Under it: "🗣 Speak or Type"
  (`#sign-to-speak-btn`, `talk.html:2170`) and Guide (110 px). **Leaving the turn discards what was not sent**
  (owner change 2026-10-19): `leave()` empties the sentence, its sign keys and the recognizer buffer, so Sign starts
  empty; a language switch inside the turn keeps it (re-translated from the keys); `clearDraft()` (`:168`) is also
  called by "+ New conversation" (`talk.html:2194`).
- **Speak or Type.** "🤟 Sign instead" (`#speak-to-sign-btn`, `talk.html:2173`) under the input row. Leaving the
  turn (this button, Back, "+ New conversation") stops the mic and empties the field, dropping the typed text and any
  unsent transcript, and cancels the avatar preview (`onLeaveSpeaking()`, `talk.html:1398`). Translate shows
  the avatar filling the area under the top bar (frame and canvas 1000x486 at 12,102; `#thread` hidden while
  `data-speaking="preview"`, `talk.html:881`), with a caption bar: the sentence (`#speaking-caption`; current word
  orange, fingerspelled words as letter boxes, "Spelling “Jose” (no sign yet) · letter 2 of 4") and Replay / Edit /
  Send.
- **Send, both sides.** `addMessage()` (`talk.html:1892`) = `appendBubble()` + the unchanged
  `TalkHistory.saveMessage()`; then "Whose turn is it?". The confirm card ("You signed / You said … -> Add to
  Conversation / Try again", `renderConfirmModal`, modal kind `confirm`) is removed; `openModal()` takes `idle` and
  `error` only. Non-PWD Send shows a "✓ Sent" toast (`#talkToast`).
- **Speaking a signed message.** `toggleSpeak()` (`talk.html:1919`) with `js/sign-audio.js` (133 lines): the signs in
  order, each sign's recording for the language (`signs.php` `audio`), the browser voice for the others (consecutive ones
  as one utterance), skipped with no voice. Each signed bubble's 🔊 is a 44 px button: replay / stop; one message at a
  time; "· playing…" on the label and a "🔊 Speaking: …" toast while it plays.
- **Train Gestures sign details** (dataset modal -> Edit): an Audio section (`#dsEditAudio`, `js/sign-audio-admin.js`,
  277 lines): per language the sign uses (letters: English only) ▶ / ● Record (MediaRecorder, max 10 s, then the take
  with ▶ / Save / Discard) / ⇪ Upload / ✕, each saved at once through `php/api/sign_audio.php`. The list's new Audio
  column shows "🔊 EN · FIL" / "🔊 EN" / "—".
- **Quiz** (`js/quiz-ui.js`): avatar clips only (no video branch); the pool comes from `quiz.php` (avatar only).
- **Measured** (`tests/talk-turns-audio/talk-check.mjs` 43/43, `train-audio-check.mjs` 20/20, Playwright 1024x600): no
  scroll on any screen, 0 console errors, 0 video requests across Let's Talk, Learn Signs and Quiz.

### 1. Owns these files

- `talk.html` — the entire feature: markup, one inline `<style>` block, one
  inline `<script>` block. No JS file split out, matching the existing
  convention on `sign-to-text.html`/`reports.html`/`gesture-training.html`.
- `css/tokens.css` — new, shared palette `:root` under the exact variable
  names `docs/ui-target/README.md` uses (`--navy`, `--navy-2`, `--orange`,
  `--orange-dark`, `--bg`, `--surface`, `--border`, `--muted`,
  `--muted-light`, `--green`, `--red`). Only `talk.html` links it
  (talk.html:7); `gesture-training.css`, `sign-to-text.css`, and
  `reports.html` still carry their own separate, differently-named `:root`
  blocks — migrating them is `docs/system/DEBT.md` item 42, not done.
- Reused unmodified: `css/fonts.css`, `css/virtual-keyboard.css`,
  `js/virtual-keyboard.js` (talk.html:8-9, 803).

### 2. What it does

A four-screen, three-modal conversation flow between a Deaf person (signs)
and a hearing person (speaks/types), all inside one document that never
reloads between turns — screens and modals are shown/hidden by attribute and
class changes only, never by navigation or `innerHTML` rebuild. Messages were
canned/fake in the original build (a small string pool, `talk.html` search
`SIGNED_CANNED_POOL`/`SPOKEN_CANNED_POOL`); as of the 2026-09-21 merges (§3a,
§3b) all three ways a message can be produced — signed, spoken, typed — are
real. Nothing reaches the thread without passing through a confirm step
first, and, as of the 2026-09-25 saved-conversations phase (§3c), every
message that clears that confirm step is also saved to the database.

### 3. How it works (state model)

- **`body[data-screen]`** — one of `"who-first"`, `"signing"`, `"speaking"`,
  `"thread"` (talk.html:816, `VALID_SCREENS`), read by CSS attribute
  selectors to show exactly one of the four `.screen` containers
  (`#screen-who-first` talk.html:691, `#screen-signing` talk.html:716,
  `#screen-speaking` talk.html:755, `#screen-thread` talk.html:775). Set only
  by `showScreen(name)` (talk.html:837), which throws on an invalid name,
  no-ops on a same-screen call (so `onEnter*`/`onLeave*` fire exactly once
  per real transition, never on a repeat), and is the only function that
  writes the attribute.
- **Five lifecycle hooks**, all empty on purpose (talk.html:819-829):
  `onEnterSigning`/`onLeaveSigning`/`onEnterSpeaking`/`onLeaveSpeaking`/
  `onEndConversation`. `showScreen()` calls the matching pair on every real
  transition; a later phase attaches camera start/stop and Vosk start/stop
  here without changing `showScreen()` itself. `onEndConversation()` is
  already called for real by both real exit paths (End Conversation button,
  talk.html:1386-1389; the idle modal's End Now/countdown-reaches-0,
  talk.html:983-1054), each followed by a real `location.href =
  'index.html'` — a genuine page reload, not a hide (per
  `docs/system/DECISIONS.md`).
- **`body.modal-open` + `#modal[data-modal-kind]`** — a second, independent
  layer on top of whichever screen is showing. `openModal(kind, opts)`
  (talk.html:1102) dispatches to `renderConfirmModal(opts)` (talk.html:918),
  `renderIdleModal(opts)` (talk.html:983), or `renderErrorModal(opts)`
  (talk.html:1056) and throws on any other `kind` — there is no fourth,
  placeholder branch left in the file (removed once Task 6 gave all three
  kinds real content; see Problems found, below, for why it existed at all
  and how it was found to be actively harmful). `closeModal()` (talk.html:1125)
  also defensively clears the idle countdown's `setInterval` regardless of
  which route closed the modal.
- **`appendBubble(msg)`** (talk.html:1190) is the *only* way a message enters
  `#thread-list` — verified by grepping the finished file for real call
  expressions (excluding comments and the declaration itself): exactly one,
  inside `renderConfirmModal`'s "Add to Conversation" handler
  (talk.html:1183 area). It caps the thread at 30 `.bubble-row` children by
  real DOM removal (`talk.html:1237`, `THREAD_BUBBLE_CAP = 30` at
  talk.html:1138), not hiding, and pins scroll to the newest bubble. As of
  the 2026-09-25 saved-conversations phase (§3c), the comment above that cap
  — "older messages still live in the database, just not here" — is now
  literally true: `appendBubble()`'s one real call site also saves the
  message before the DOM cap can ever discard it.
- **The persistent thread** (`#thread` → `#thread-list`, talk.html:102) is
  one element, never duplicated: `display:none` on `who-first`, `96px` tall
  on `signing`/`speaking` (talk.html:110), `320px` tall on `thread`
  (talk.html:113) — sized to `600 − 90 (header) − 190 (control panel,
  talk.html:540) = 320`, not the naive `600 − 90 = 510`, so the thread and
  the thread screen's own bottom control panel are geometrically disjoint
  rather than depending on z-index alone (see Problems found for the bug
  this replaced).
- **The idle timer** (talk.html:1401, `startIdleTimer`/`resetIdleTimer`)
  fires `openModal('idle', {seconds: 30})` after `IDLE_TIMEOUT_MS` (120000,
  talk.html:814) of no `pointerdown`/`keydown`/`input` anywhere in the
  document (talk.html:1432-1434) — but skips firing (and just re-arms
  instead) while any modal is already open (talk.html:1401-1417), so it
  cannot silently destroy a pending confirm.
- **The status pill** (`setStatusPill`, talk.html:892) shows `TYPING`
  (orange dot) exactly when `document.body.classList.contains('keyboard-active')`
  is true, driven by a `MutationObserver` on `<body>`'s `class` attribute
  (talk.html:1367) rather than a direct call from `js/virtual-keyboard.js`
  (which exposes no hook to call directly). `LISTENING` (green dot) has no
  driver anywhere in this phase — there is no camera yet to be listening to.

### 4. Key decisions and why

All recorded, with reasons, in `docs/system/DECISIONS.md` rather than
repeated here — that file is the source of truth for this screen's design
choices (screen/modal split, the `css/tokens.css` extraction, the two
16px-floor-over-README deviations, the canned-vs-real data split, the idle
countdown length, and the fixes below).

### 5. Constraints

Every screen is fixed at exactly 1024×600 — no `100vw`/`100vh`, no
responsive units, no media queries anywhere in this file except the
keyboard's own sizing rule (talk.html, `.sk-keyboard-wrap`), which is
applied unconditionally rather than behind a breakpoint (talk.html's own
comment there explains why: this file is never rendered at any other size).
Nothing tappable under 44×44px; no body text under 16px (both audited
per-task, see Problems found in earlier phases' equivalent sections for
comparison method). One orange element per screen at rest; a modal's own
orange button and, once the keyboard is raised, its orange `HIDE` key are
each treated as belonging to their own temporary overlay layer, not counted
against the screen underneath (`docs/system/DECISIONS.md`).

### 6. Touches (dependencies / breakage risk)

- **`talk.html` ↔ `js/virtual-keyboard.js`**: auto-attaches to any focused
  `<input type="text">` via a page-wide `focusin` listener the script
  installs itself (no manual "attach" call) — `#speaking-input`
  (talk.html:767) needs no wiring beyond existing as a normal text input.
  Signals open/closed via `document.body.classList` (`keyboard-active`), not
  a custom event; `talk.html` neutralizes `css/virtual-keyboard.css`'s
  unscoped `body.keyboard-active{padding-bottom:300px!important}` and
  `html.keyboard-active,body.keyboard-active{overflow-y:auto!important;
  height:auto!important}` rules (talk.html, the `.sk-keyboard-wrap` block
  right after the `<link>` for it in `<head>`) — if a future edit reorders
  `<head>` so that `<link rel="stylesheet" href="css/virtual-keyboard.css">`
  ends up *after* this file's own `<style>` block, those `!important` rules
  win again and the page gains a vertical scrollbar the moment the keyboard
  opens, breaking the fixed-1024×600 contract silently (no console error).
- **`talk.html` ↔ `css/tokens.css`**: the only page depending on it so far;
  if `css/tokens.css` is deleted or its variable names change, every colour
  in `talk.html` falls back to CSS's default (transparent/black), not a
  console error — a purely visual break, easy to miss without loading the
  page.
- **`talk.html`'s back button** (`#backBtn`, talk.html:878) routes to
  `'thread'` if `document.querySelector('#thread-list .bubble-row')` finds
  an existing message, else `'who-first'` — this selector must keep matching
  whatever `appendBubble()` (talk.html:1190) actually builds; if a future
  change renames `.bubble-row` without updating this check, Back silently
  reverts to always landing on `who-first`, which strands a mid-conversation
  user exactly the way it did before this was fixed (see Problems found).
- **`talk.html` → `index.html`**: `End Conversation` and the idle modal's
  `End Now`/countdown-reaches-0 all do a real `location.href = 'index.html'`
  — if `index.html` moves or is renamed, both exits break with a 404, not a
  silent failure.
- Not yet linked from anywhere: no other file in the repo references
  `talk.html`. It is reachable only by typing the URL.

### Problems found (Part 3)

All four found and fixed in the same pass (a whole-branch review after all
six build tasks were individually reviewed and approved) — task-level review
catches per-task defects; these only showed up once the six tasks were
exercised together as one flow:

1. **A temporary dev-only scaffold (`#dev-modal-switcher`, since removed)
   physically covered the thread screen's real Sign/Speak-or-Type/End
   Conversation buttons.** It was `position:fixed; z-index:9999`, un-gated
   by `data-screen`, and taller than its own buttons alone (a leftover
   96px `.icon-tile` inside it), so at `bottom:60px` it overlapped the
   `.control-panel` (`z-index:70`) sitting at `bottom:0`. Confirmed via
   `document.elementFromPoint()` at the Sign button's centre returning the
   scaffold, not the button — a real tap could not have reached it. Removed
   entirely rather than just resized, since by the time this was found every
   modal kind already had a real trigger except `error` (no real camera/mic
   failure exists yet to trigger it organically) — that one is invoked from
   the browser console when needed, documented in
   `docs/system/DECISIONS.md`.
2. **`js/virtual-keyboard.js` was never included**, despite the approved
   plan explicitly requiring it — an error in how one build task was
   dispatched, not a plan gap. Screen 04 was untypeable on the target
   touchscreen (no way to raise a keyboard) until this was corrected by
   wiring the script, neutralizing the shared CSS's unscoped `!important`
   overrides, and adding the `body.keyboard-active`-scoped repositioning
   `docs/ui-target/README.md` calls for (mic row hidden, input row moves up,
   "no drift" on close — verified visually, not just by DOM measurement,
   after an unrelated CSS-transition-timing artifact in the verification
   tooling produced a misleading reading the first time around).
3. **The header Back button always went to `who-first`**, including
   mid-conversation. Since `who-first` hides `#thread` entirely and is meant
   to show only once per conversation, a turn-2+ user who tapped Back landed
   somewhere with their existing conversation invisible and no way back to
   it except by adding another message. Fixed to route to `thread` when a
   message already exists.
4. **The idle-warning modal could silently overwrite an open confirm
   modal.** Since the idle timer only resets on real input and reading a
   confirm card is not itself input, a person who paused on the confirm
   screen for the full 2-minute idle window would have their
   just-signed/just-spoken text silently discarded when the idle modal
   opened over it — reproduced directly (open confirm, force the idle fire,
   read `.modal-card`'s content before/after: the confirm text was gone).
   Fixed: the idle timer now checks `body.modal-open` before firing and
   re-arms instead of overwriting if any modal is already showing.

One reviewer-raised concern was checked and found **not** to reproduce:
thread scroll position across the 96px↔320px height change when entering/
leaving the thread screen. The browser's own scroll-clamping behavior keeps
`#thread-list.scrollTop` pinned at its maximum (i.e. showing the newest
bubble) across the resize, confirmed by directly measuring `scrollTop`/
`scrollHeight`/`clientHeight` before and after the transition with an
8-bubble thread — no fix was needed or applied.

### Could not determine (Part 3)

- Real-hardware touch behavior (finger vs. simulated pointer/click events) —
  everything above was verified with a real browser (DOM measurement,
  `elementFromPoint`, and visual screenshots at an emulated 1024×600
  viewport), not a physical touchscreen. See
  `docs/system/MANUAL-CHECKS.md`'s new "Let's Talk" section for what still
  needs a person and a real Pi.

---

## Part 4: Accounts, conversation history, quiz (accounts-quiz phase, 2026-10-18)

Report: `docs/reports/2026-10-18-accounts-quiz.md` (screenshots of every screen at 1024x600). Design source:
`docs/design/dashboard-login-wireframe.html`, `docs/design/new-features-wireframe.html`. Server side:
`docs/system/BACKEND.md`, "Accounts, conversation history and quiz".

### 1. Owns these files

- New pages: `login.html` (123 lines), `conversations.html` (197), `quiz.html` (185), `quiz-scores.html` (124),
  `users.html` (232).
- New scripts: `js/sk-account.js` (205) — account chip/menu, Log out, page guards, small helpers;
  `js/quiz-core.js` (130) — pure quiz logic (node-testable); `js/quiz-ui.js` (412) — quiz screens and clip playback.
- New stylesheet: `css/sk-pages.css` (305) — the shared look of the new pages and of the chip/menu.
- Changed: `index.html`, `css/style.css` (3-card grid, account area), `talk.html` (header right side),
  `js/virtual-keyboard.js` (also opens for `type=password`), the admin guard in the `<head>` of
  `gesture-training.html`, `reports.html`, `bulk-import.html`, `avatar-clips.html`, `diagnostic.html`, and the PIN
  removed from the first four (with `js/gesture-training-ui.js`, `js/bulk-import-ui.js`, `js/avatar-clips-ui.js`,
  `css/gesture-training.css`).

### 2. What it does

- **Who is logged in.** Each page loads `<script src="php/api/me.php">` (sets `window.SK_ME`) and then
  `js/sk-account.js`. The value only decides what to draw; every endpoint checks the PHP session itself.
- **Dashboard (`index.html`).** Learn Signs, Let's Talk (orange border), Quiz (orange icon) — same 200x270 cards,
  `grid-template-columns: repeat(3, 200px)` (`css/style.css`). Top-right (`.dash-acct`, absolute in the banner):
  a guest gets "Log in" (`login.html`); a logged-in account gets a name chip (initial, display name, ADMIN tag for an
  admin, caret) that opens a menu (`renderAccount()`, `js/sk-account.js:74`; items `menuItems()`, `:46`): user =
  My conversations, My quiz scores, Log out; admin = Train Gestures, View Reports, Bulk import, Manage users,
  All conversations, Quiz results, Log out. Items are 48 px tall; the admin menu ends at y = 479 (measured with Playwright at 1024x600).
- **Login (`login.html`).** Full-screen page, tabs "Log in" / "Create account" on the same page (no load), fields
  at the top: every field and button ends at or above y = 320, where the 280 px on-screen keyboard starts
  (measured by `tests/accounts-quiz/e2e-check.mjs`). Inputs 52 px, buttons 52 px. `?next=<page>.html` returns there
  after a login (quiz result "Log in", guarded lists); `?tab=create` opens Create account. Admins log in here too.
- **Admin pages.** `SKAccount.adminPage()` (`:129`) runs in each admin page's `<head>`: not an admin ->
  `window.stop()` and `location.replace('index.html')` (`leave()`, `:120`), so none of the page's own scripts run.
  An admin stays and the page opens at once: the logged-in admin role is the only gate (owner answer (a),
  2026-10-18: the PIN pad, its code and its 10-minute `sk_train_unlocked` flag were removed from Train Gestures,
  Reports, Bulk import and Avatar clips; DEBT 158). `reports.html` loads its Conversations tab on page load
  (it used to wait for the PIN); Bulk import and Avatar clips start on `DOMContentLoaded`.
- **Let's Talk (`talk.html`).** Header right side (`.talk-header-right`): the status pill (now in the row, shown
  only while the keyboard is up, when "+ New conversation" hides so the row never reaches the title), "+ New
  conversation" and a plain chip (Guest for a guest; no menu, no log-in button here). "+ New conversation"
  (`talk.html:2110`): with no message in the thread it just returns to "Who speaks first?"; otherwise it ends the
  conversation exactly as End Conversation does (`onEndConversation('ended')`) and loads `talk.html` again, so the
  next message starts a new saved conversation (new `client_key` per page load, `js/talk-history.js`). A reload,
  not an in-page reset, for the same reason End Conversation is a real page load (`docs/system/DECISIONS.md`).
- **Conversations (`conversations.html`).** One page: a list (title = the conversation's title, else its first
  message; date, message count, language; 20 per load + "Load more") and a read-only thread (signer left in white,
  speaker right in navy, with "Signer · FSL" / "Speaker · spoken|typed" labels and inline SVG icons). A user sees
  their own ("MY CONVERSATIONS", no filters); an admin sees all ("ALL CONVERSATIONS", Guest / username pill) with
  User (All, Guest, each user) and Language (All, ESL, FSL) selects. A guest is sent to `login.html`.
- **Quiz (`quiz.html`, `js/quiz-ui.js`).** Setup: Mode (Sign -> Text | Text -> Sign), Language (ESL | FSL),
  Category (Letters, Numbers, Words, Phrases, All), a line with the number of signs available, "Start quiz".
  The pool comes from `php/api/quiz.php ?action=pool` (signs with a clip: avatar first, else video — the source
  Let's Talk plays; Learn Signs has no local source, DEBT 160). `QuizCore.poolFor()` keeps one sign per text and per
  clip; fewer than 4 -> a red line "No signs / Only N signs with a video in <category> (<lang>). A quiz needs at
  least 4." and Start stays disabled. 10 questions (`COUNT`, `js/quiz-ui.js:13`); with 4-9 signs every sign comes
  once before any repeats, never twice in a row. Each question: the answer + 3 wrong choices from the answer's
  category (for All, from the rest of the pool only when that category has fewer than 3 others).
  - Sign -> Text: the clip loops on the left (440 px wide, Replay button), 4 text choices (64 px) right.
  - Text -> Sign: "Which sign is “text”?" on top, 4 cards with the clip as a still poster (video: first frame; avatar:
    rest pose) and a play button; tapping one plays it and stops any other (`stopOthers()`); "Choose A..D"
    (48 px) answers.
  - One tap answers: green + check on the right one, red + cross on a wrong pick, at once; Next.
  - Bar: "✕ Quit" (back to setup, nothing saved), title, "Score N".
  - Result: big score, "mode · language · category", Try again (same settings, new questions), New quiz; Missed
    (n) list with "▶ Watch" (overlay that loops the right sign). Guest: "Log in to save your score. This score is
    not saved." + Log in. Logged in: saved at once (`action: save`) -> "Score saved." + a link to the scores page.
  - Clips (`clipView()`, `:52`): `<video muted playsinline>` (posters `preload=metadata`, seeked to 0.05 s), or a
    420x302 canvas with `AvatarPlayer` in the avatar's `admin` view (looped with a 700 ms pause). At most one clip
    plays at a time.
- **Quiz scores (`quiz-scores.html`).** Quizzes taken, Average (mean of correct/total, %), Best (highest ratio),
  and the attempts (mode · language · category, date, score pill: green >= 70 %, red <= 50 %), 20 per load + Load
  more. A user sees their own ("MY QUIZ SCORES"); an admin sees everyone's ("QUIZ RESULTS") with a User select.
- **Manage users (`users.html`, admin only).** Table: Name (+ "You"), Username, Role pill, Status pill, Last login
  (Today / Yesterday / date / —), actions: Reset password, Deactivate (red; not on the admin's own row) or Activate
  (green). "Show" select: All / Active / Inactive. "+ Add user" and "Reset password" open a full-screen form in the
  same page, fields at the top (Display name, Username, Role User|Admin, Password / New password), above the
  keyboard. No delete.

### 3. Constraints kept

Plain HTML/CSS/JS, no library, no build step; inline SVG icons, no images; no shadows, blur, gradients,
transitions or animations in the new CSS (the shared on-screen keyboard keeps its own existing slide); touch
targets >= 44 px; built and measured at 1024x600. Colours from `css/tokens.css`, font Inter (`css/fonts.css`).
`:where()` keeps the new pages' font reset at zero specificity so each component's own weight/size wins.
