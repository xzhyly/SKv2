# ML / Inference — Pointer Document

Inference logic is not a separate architectural layer; it lives inside the UI
files listed below and is documented in full in `docs/system/UI.md`. This page
exists only so the Touches section of `docs/system/UI.md` is legible — it says
where inference happens and which vendored library (documented in
`docs/system/VENDORED.md`) backs each call.

**Only one classification approach has ever run in this system: cosine-
similarity k-NN.** A second approach — a TensorFlow.js dense network — exists
in code but has never executed in any browser; see "Not live" below before
assuming otherwise.

## Live: hand-landmark detection (MediaPipe Hands)

| File | Line | API call | Purpose | Vendored library |
|---|---|---|---|---|
| js/gesture-data.js | 230 | `new window.Hands({...})` | Creates a MediaPipe Hands detector instance for the live translation view. | MediaPipe Hands |
| js/gesture-data.js | 245 | `state.hands.onResults((results) => {...})` | Registers the callback that receives per-frame hand landmarks. | MediaPipe Hands |
| js/gesture-data.js | 390 | `await state.hands.send({ image: offscreenCanvas })` | Feeds one video frame into the Hands pipeline for landmark detection. | MediaPipe Hands |
| js/gesture-data.js | 693 | `new window.Hands({...})` | Creates a second Hands instance for the gesture-recording/training path. | MediaPipe Hands |
| js/gesture-data.js | 708 | `state.hands.onResults((results) => {...})` | Registers the landmark-result callback during gesture recording. | MediaPipe Hands |
| js/gesture-data.js | 791 | `await state.hands.send({ image: offscreenCanvas })` | Feeds one recorded-video frame into Hands during training capture. | MediaPipe Hands |
| js/gesture-data.js | 507 | `await tf.io.removeModel(modelKey)` | Deletes a cached IndexedDB model when the language/label set changes. TF.js used here only as an IndexedDB helper, not for classification. | TensorFlow.js (storage API only) |

`js/sign-to-text-ui.js:387-388` and `js/gesture-training-ui.js:955-956` call
`window.GestureDataRecorder.setupMediaPipe(...)` — a wrapper defined above,
not a direct API call, so no row is listed for them.

## Live: classification (cosine-similarity k-NN, not TensorFlow.js)

Both reachable, PIN-free-or-gated screens that actually classify gestures use
a hand-rolled k-NN, not TensorFlow.js:

- **`talk.html`'s signing screen** (and formerly `sign-to-text.html`, archived 2026-09-21), via `js/sign-to-text-ui.js:109-148` (`knnPredict`; `cosineSimilarity` `:98-107`, re-measured 2026-10-16; was `:204-243` / `:193-202` on 2026-10-05) — top-K
  (`min(5, N)`, `:137`) cosine similarity, score normalized `(s-0.3)/0.7` clamped
  0-1 (`:145`). Called from `js/talk-signing.js:149`. Confirmed working (see `CLAUDE.md`).
- **`gesture-training.html`**, via `js/gesture-training-ui.js:610-651` (`knnPredict`; `cosineSimilarity` `:599-608`, re-measured 2026-10-16; was `:581-622` / `:570-579`) — same
  approach, `K=5` (`:639`), called from Steps 3/4 at `:1063`. Until 2026-10-16 `trainModel()` here was a KNN cache-merge
  with a cosmetic progress animation, not real epoch training (`docs/system/UI.md` Part 2, §3); it is
  replaced by **Compile**, see "Compact model" below.
- Both pages now get `knnModel` from a compiled model file, never from samples (compact-model phase, below).
  The text of `knnPredict` and `cosineSimilarity` did not change in that phase (byte comparison against
  HEAD `b61c665`, `.git/sdd/cm-phase-review-1.md`).

## Model membership and display text (sign-texts phase, 2026-10-04)

> **Update 2026-10-16 (compact-model phase).** The membership rule is now one function,
> `KnnCompile.inModel` (`js/knn-compile.js:43-45`, PHP twin `knn_in_model`,
> `php/api/knn_model_lib.php:67-69`): ESL = ESL + Both, FSL = FSL + Both, and `start` / `stop` in
> **both** models on every page (owner answer Q4). The two filters cited below
> (`js/gesture-training-ui.js:728`, which left `start` out of the Train Gestures FSL model, and
> `js/sign-to-text-ui.js:118`) were removed with `trainModel()` and `mergeSavedGestureSamples()`. The
> one-time reset now runs for schema `"3"` (`js/gesture-data.js:16-25`), and the "Cache size caveat"
> below is superseded. Display text: `getSignText()` (`js/gesture-data.js:712-721`) uses the database
> text first and, when it is unknown or empty, the text stored in the loaded model file's header
> (`setModelSigns()`, `:725-731`). The rest of this section is the sign-texts phase as written.

The classifier itself did not change: `knnPredict` and `cosineSimilarity` are untouched
(`js/gesture-training-ui.js:570-622`, `js/sign-to-text-ui.js:193-243`), and `trainModel()` /
`mergeSavedGestureSamples()` changed only in where `targetLang` comes from and in the set filter. What
changed is *which signs feed which model* and *what text is shown for a detected label*. Full UI behavior:
`docs/system/UI.md` Part 2 and Part 3; storage: `docs/system/BACKEND.md` "One sign, two texts".

- **One sign, recorded once, can be in both models.** A sign has a set (`ESL` | `FSL` | `BOTH`). The **ESL model
  uses signs whose set is ESL or BOTH; the FSL model uses FSL or BOTH.** Each training row carries the sign's
  set, taken from `signs[label].set` (the `signs` map returned by `save_gesture.php`/`signs.php`), falling back
  to the sample file's own `signLanguage`, then `ESL` (`js/gesture-data.js:763-775`, the set at `:768`). The
  filter is `itemLang === targetLang || itemLang === 'BOTH'` in `js/gesture-training-ui.js:728`; `talk.html`'s
  copy (`js/sign-to-text-ui.js:118`) additionally admits the control gestures `start`/`stop` into either model
  (`label === 'start' || label === 'stop'`), which is why the FSL model measured 90 labels = the 89 Both signs
  plus the shared `start`, with no ESL-only sign in it (`.git/sdd/st-task-6-report.md`: ESL model 122 labels, FSL
  90). Probes recorded in Task 8 gave 124 / 91 labels after training (`.git/sdd/st-task-8-report.md` item 3;
  those probe signs were deleted afterwards).
- **Which model is used.** `gesture-training.html`: Step 2's "AI model" toggle, ESL | FSL (`modelLanguage()`,
  `js/gesture-training-ui.js:629-633`); it starts from Step 1's set each time Step 2 is shown, Both mapping to
  ESL (`syncModelToggleToStep1()`, `:669-677`); switching to a language with no cached model marks the model
  untrained so Train must be pressed (`onModelLanguageChanged()`, `:653-667`); the toggle is locked while a
  training run is in progress (`trainModelGuarded()`, `:636-644`). `talk.html`: the language chip, `signLang ===
  'fil' ? 'FSL' : 'ESL'` (`js/sign-to-text-ui.js:308`).
- **The k-NN key is the sign key** (the folder label, e.g. `how_are_you`), never a text. A Both sign is therefore
  the same label in both models.
- **The text is applied at display time**, not stored in the model. `translateGestureLabel(label, lang)`
  (`js/gesture-training-ui.js:326`, `js/sign-to-text-ui.js:65`) first asks `GestureDataRecorder.getSignText(key,
  lang)` (`js/gesture-data.js:704`; Filipino text for `'fil'`, English otherwise, `null` when empty or unknown), then
  falls back to the old `SIGN_TRANSLATIONS` table and a title-cased key. Texts come from the `signs` map
  (filled by `loadSavedGestureDataset()` and by `loadSigns()` `:713`, a `signs.php` GET). The training page's
  prediction displays go through `predictDisplayText(detected)` (`js/gesture-training-ui.js:647-649`), which follows
  the Step 2 model toggle; `talk.html` shows the text of the active language.
- **One-time cache reset.** `localStorage` key `sining_kamay_model_schema` = `"2"` (`js/gesture-data.js:17-22`): on
  the first page load without it, the six keys `sining_kamay_knn_ESL|FSL`, `sining_kamay_labels_ESL|FSL` and
  `sining_kamay_trained_labels_ESL|FSL` are removed, because models cached before this phase were built from
  per-language folders. The models are rebuilt by pressing Train (training page) or automatically by
  `autoTrainForTranslate()` (`talk.html`). Storage access is in try/catch.
- **Superseded 2026-10-16 (compact-model phase): no k-NN model is cached in `localStorage` any more.**
  Both compiled files are cached in IndexedDB at the same time (`js/knn-model-store.js`, see "Compact
  model" below; `docs/system/DEBT.md` item 94, resolved). The paragraph is kept as written:
- **Cache size caveat.** The ESL k-NN cache is about 3.59M characters of an origin quota of roughly 5.2M, so the
  FSL model (91 labels, about 2.5M) cannot also be cached; training still reports "Complete" while
  `trainModel()` only `console.warn`s (`.git/sdd/st-task-8-report.md` concern A; not caused by this phase, but
  no pre-phase measurement exists — `docs/system/DEBT.md`).

## Not live: TensorFlow.js dense-network classification

`tf.tensor2d`, `tf.sequential`, `tf.loadLayersModel`, and `tfModel.predict()`
(originally `camera-translator.html:1220-1686`) are the project's only
TensorFlow.js classification calls — confirmed by a repo-wide search outside
`js/lib/`, no other file calls any of these. That file has never executed in
any browser: its single inline `<script>` block has a syntax error
(unclosed `else{`) present identically at baseline, after Phase 1, after
Phase 2, and at HEAD, confirmed via `node --check`. It has been archived to
`archive/camera-translator.html` (Phase 3a) with the syntax error intact; see
`archive/CAMERA-TRANSLATOR.md` for the full finding. Nothing else in the repo
references it (no `href`, `location.href`, or `window.open` anywhere).

## Not inference: MediaPipe Holistic for avatar clips (avatar phase, 2026-10-05)

`avatar-clips.html` runs MediaPipe Holistic (`js/lib/holistic/`, `js/avatar-extract.js`) on a chosen video to
extract pose + hand landmarks for the 2D avatar. It never classifies, never feeds the k-NN, and never runs on
the kiosk's Let's Talk screens. `knnPredict`, `cosineSimilarity` and `trainModel` are unchanged. See
`VENDORED.md` and `UI.md` Part 2 "Avatar clips".

## Could not determine

- Whether `diagnostic.html` makes its own direct Hands/TF.js calls — it was not
  one of the files scanned for this pointer document.
- Whether `js/main.js` or `js/dist/build.js` contain inference calls — both are
  out of scope (dead code slated for deletion, see `docs/system/DEAD_CODE.md`) and
  were not read.

## Bulk-imported samples (2026-10-13/14)

`bulk-import.html` adds recognition samples but no inference code. Its Hands pass and segmentation are
the live capture's own calls (`js/video-landmarks.js`, `js/gesture-data.js` `createVideoDetector`,
`js/capture-core.js`), and the samples are v3 files that load through the same
`recordingToFeatureRows()` (at most 30 rows per sample). `knnPredict`, `cosineSimilarity` and `trainModel`
are unchanged. The page's "knnPredict (estimate)" is its own function with the same shape, run on a
synthetic model; the kiosk's function is not loaded there.

Measured on this laptop, the kiosk's `knnPredict` text (`js/sign-to-text-ui.js:193-243` at the time; `:98-148`
since 2026-10-16) run in node
on a JSON round-tripped model: 1.1-1.5 ms at 2,074 rows, 14-15 ms at 24,034, 37-38 ms at 58,560 and
53-62 ms at 87,840 rows. (The Step 1 report's 35 ms / 1.6 s figures were wrong: they were taken inside a
node `vm` context, which alone is 6-7 times slower, on a busy machine.) The Pi is not measured.

**Update 2026-10-16 (bulk-reps-fix).** Bulk import no longer uses the live segmenter: its reps come from
`js/bulk-rep-split.js` (a per-frame rest score on the raw image-space wrists, the 2 rest runs that best cut a
video into 3 reps; `docs/reports/2026-10-16-bulk-reps-fix.md` section 2). This changes which frames become a
sample, not how a sample becomes rows: the samples are the same v3 files, read by the same
`recordingToFeatureRows()`. Live capture keeps `js/capture-core.js` (REST_MS 1000). `knnPredict`,
`cosineSimilarity` and the compile rule are unchanged; the Review estimate now counts rows by the compile rule
(`Core.budgetRows`).

## Compact model (2026-10-15/16)

Recognition loads a precompiled model file per language instead of downloading every sample and building
the k-NN in the browser. Proposal and measurements: `docs/reports/2026-10-14-compact-model-step1.md` (Step 1);
build reports `.git/sdd/cm-task-1..9-report.md` (not tracked). `knnPredict` and `cosineSimilarity` are
unchanged; what changed is which rows exist and how they are loaded (owner decision 4). Decisions:
`docs/system/DECISIONS.md` ("compact-model phase"); UI: `docs/system/UI.md`; endpoints:
`docs/system/BACKEND.md`.

### Where it is built, loaded and called

| What | Where |
|---|---|
| Rule, membership, fingerprint, encoder/decoder (browser + node, no DOM) | `js/knn-compile.js`: `DEFAULT_RULE` `:18-25`, `inModel` `:43-45`, `evenIdx` `:49-60`, `selectSignRows` `:86-101`, `fingerprintText` `:105-114`, `sha256Hex` `:116-125`, `createBuilder` `:138-218`, `buildModel` `:223-231`, `checkHeader` `:234-251`, `encode` `:259-291`, `decode` `:295-338` |
| Build (laptop) | Train Gestures Step 2 Compile, `compileModel()` `js/gesture-training-ui.js:802-969`; written by `php/api/compile_model.php` (`docs/system/BACKEND.md`) |
| Load + IndexedDB cache | `js/knn-model-store.js` `load()` `:168-264` |
| Let's Talk | `autoTrainForTranslate()` `js/sign-to-text-ui.js:150-174` (name and callers kept): the queue's "gestures" item `js/talk-loader.js:59` and `loadModel()` on a language switch `js/talk-signing.js:220-227` |
| Train Gestures Steps 2-4 | `loadModelForLang()` `js/gesture-training-ui.js:698-722`, then `applyLoadedModel()` `:683-693` |
| Prediction | the unchanged `knnPredict` calls `js/talk-signing.js:149` and `js/gesture-training-ui.js:1063` |

`autoTrainForTranslate()` sets `knnModel`, `activeLabels` (header order), `activeFeatureSize = 126` and
`modelTrained = labels >= 2` (`js/sign-to-text-ui.js:164-167`); a result that arrives after the language
changed is dropped (`:160`). Decoded rows are plain `Array`s of 126 numbers (Float32 widened to double,
`js/knn-compile.js:329-334`), which is what `knnPredict` saw before.

### File format (`models/knn_<LANG>.bin`, little-endian; `js/knn-compile.js:259-291`)

| Bytes | Content |
|---|---|
| 0-3 | ASCII `SKKN` |
| 4-5 | uint16 format version 1 |
| 6-7 | uint16 dtype 1 = Float32 (anything else is refused) |
| 8-11 | uint32 header length H, 2 <= H <= 4,194,304 |
| 12 .. 12+H | UTF-8 JSON header |
| padding | zero bytes to a multiple of 4 |
| rest | `rowCount x 126` Float32, label by label in header order |

Header keys (`js/knn-compile.js:201-213`): `formatVersion`, `lang`, `buildDate`, `builtOn: "laptop"`, `rule`
(the rule actually used), `dims: 126`, `dtype: "f32"`, `fingerprint`, `sampleCount`, `rowCount`, and
`labels: [{key, set, category, textEn, textFil, samples, rows}]`. The texts are only a display fallback
(`getSignText()`, above). The decoder refuses, with a `knn model file: ...` error: a wrong magic, version or
dtype; H out of range or past the end; a header that is not JSON; `dims != 126`; `lang` not ESL/FSL;
`labels` not an array; a label without a non-empty string key, a duplicate key or `__proto__`; `rows` not a
non-negative integer; rows that do not add up to `rowCount`; a body that is not `rowCount x 126 x 4` bytes
(`decode` `:295-324`, `checkHeader` `:234-251`). A file with 0 labels is valid; callers treat fewer than 2
labels as "not usable".

Committed files (decoded 2026-10-16): `knn_ESL.bin` 1,045,196 bytes (header 13,496 bytes), 2,047 rows,
122 labels, 127 samples; `knn_FSL.bin` 723,096 bytes (header 10,426 bytes), 1,414 rows, 90 labels, 91
samples; both built 2026-10-15T03:12 UTC with rule `sign-budget` v1, budget 90.

### The rule: a per-sign row budget, not a fixed keyframe count

- Each sample first gives today's rows through the unchanged `recordingToFeatureRows()`
  (`js/gesture-data.js:757`): v2 as stored, v3 hand frames, at most 30, evenly by index. Rows that are not
  126 finite numbers are dropped (`isRow`, `js/knn-compile.js:74-80`).
- **Budget 90 per sign** (`selectSignRows`, `:86-101`). `n` = the sign's samples that gave at least one row.
  If the sign's rows total 90 or less they are all kept. Otherwise each sample keeps
  `k = max(3, floor(90 / n))` rows chosen by `evenIdx` (first and last row included). With 1-3 samples per
  sign nothing changes; 6 samples of 30 rows keep 15 each (90); 25 samples keep 3 each (75).
- The rule object is stored in the file: `{name: "sign-budget", version: 1, budget: 90, maxRowsPerSample: 30,
  minRowsPerSample: 3, spacing: "even"}` (`:18-25`). `maxRowsPerSample` only describes what
  `recordingToFeatureRows` already does.
- **Membership:** a sign is in model L when its set is L or `BOTH`, or its key is `start` or `stop`
  (`inModel`, `:43-45`). The set is `signs[label].set` from the listing, else the sample's `signLanguage`,
  else ESL (`sampleSet`, `:37-40`), as in `recordingsToTrainingRows()` (`js/gesture-data.js:785-797`).
- Labels with 0 rows are left out. Labels are sorted by key; rows keep sample order, then row order
  (`createBuilder().finish()`, `:185-215`). Before this phase the kiosk listed `start`, `stop`, then listing
  order; only an exact score tie in `knnPredict`'s sort could resolve differently
  (`.git/sdd/cm-task-1-review-1.md`). A sign with no rows (`stop` before it is recorded) used to be an empty
  key that scored 0; it is now absent (`.git/sdd/cm-task-5-report.md`).
- On today's data the budget never bites: ESL 2,047 rows / 122 labels and FSL 1,414 / 90, row for row the
  model the kiosk built before (`tests/compact-model/knn-compile.test.mjs`, frozen fixture).

**Why not a fixed keyframe count (owner decision 2).** Measured in Step 1, section 2.3 (vote %; T2 = 120
display videos queried against the samples' model, T2r = 121 samples queried against a model built from those
videos):

| Rule | ESL rows | T2 vote | T2r vote | T2 phrase | T2r phrase |
|---|---|---|---|---|---|
| current (before this phase) | 2,047 | 85.8 | 86.8 | 82.4 | 88.2 |
| budget 90 per sign (shipped) | 2,047 | 85.8 | 86.8 | 82.4 | 88.2 |
| even 20 per sample | 1,892 | 85.0 | 83.5 | 76.5 | 70.6 |
| even 15 per sample | 1,685 | 80.8 | 84.3 | 52.9 | 64.7 |
| even 10 per sample | 1,249 | 71.7 | 74.4 | 47.1 | 47.1 |
| trim 200 ms + even 10 / 15 | 1,249 / 1,685 | 71.7 / 80.8 | 71.9 / 82.6 | not in the Step 1 tables | not in the Step 1 tables |

Every fixed count from 3 to 20 rows per sample lost more than 2 points on at least one set. Trimming
200 ms of entering/leaving frames (DEBT 88) matched even spacing on T2 but scored 2.5 / 1.7 points lower on T2r
(10 / 15 rows), and centred spacing was within about 1 point of even spacing on T2 but 3.3 points lower on T2r at 15 rows
(81.0 against 84.3); farthest-point and k-medoids selection scored worse than even spacing. `knnPredict`
scores a sign by the mean of its 5 best rows, so with one sample per sign fewer rows mean fewer close
matches.

### Accuracy before and after (frozen fixtures, exact)

`tests/compact-model/accuracy.mjs` reproduces Step 1's numbers exactly for both rules on the frozen fixtures
(`tests/compact-model/fixtures/`, data of 2026-10-15), with the budget model predicted independently
(`reuse: false`; `.git/sdd/cm-task-2-report.md`):

| Set | Queries | Before (current rule): vote, frames | After (budget 90): vote, frames |
|---|---|---|---|
| T1 leave-one-repetition-out, ESL | 8 | 6/8, 272/348 | 6/8, 272/348 |
| T2 display videos, ESL model | 120 | 103/120 (85.8%), 1,771/2,844 (62.3%) | identical |
| T2 FSL model | 90 | 75/90 (83.3%), 1,276/2,130 (59.9%) | identical |
| T2r reverse | 121 | 105/121 (86.8%), 1,248/1,867 (66.8%) | identical |

Per category (T2 vote), before and after: letters 25/26, numbers 10/10, words 54/67, phrases 14/17. T3 (the
owner's one real video, sign unknown, Q1) gives the same top-3 per repetition under both rules (top-1 `n`,
`n`, `n`). Float32 storage gives the same top-1 as the double-precision rows on all 5,010 test queries
(`knn-compile.test.mjs`). Leave-one-signer-out was not run, because no multi-signer data exists yet
(`docs/system/DEBT.md` item 128).

### Prediction time per call (laptop; the Pi is not measured)

`knnPredict`'s cost grows with the model's rows. Medians, plain arrays (the kiosk's input), headless Chrome:

| Model | Rows | Step 1 section 4 | Task 7 bench, fresh instance per timing |
|---|---|---|---|
| FSL today | 1,414 | 2.5-2.6 ms | 1.3 ms |
| ESL today | 2,047 | 2.0-3.5 ms | 2.0 ms |
| budget 90, 8 signers (projected) | 9,164 | 10.6-12.8 ms | 6.9 ms |
| budget 90, 2 signers (projected) | 10,196 | 16.1-24.9 ms | 10.8 ms |
| budget 120, 2 signers (projected) | 14,140 | 23-37 ms (Step 1 section 2.5) | 14.1 ms |
| no budget, 2 signers (projected) | 24,007 | 30.3-47.9 ms | 24.9 ms |
| no budget, 8 signers (projected) | 89,887 | 125.4-179.7 ms | 83.4 ms |

- Task 7's figures are one full run of `tests/compact-model/bench.html` (`.git/sdd/cm-task-7-report.md`,
  round 2), on synthetic models of 122 labels. Laptop numbers vary 2-3x with machine load
  (`.git/sdd/cm-task-2-report.md`: 4.4 and 14.9 ms at 2,047 rows on two runs).
- **Do not quote Step 1's Float32 column**, or its "plain arrays were as fast or faster". Step 1 timed plain
  arrays and Float32 views on one shared `knnPredict` instance, so V8's type feedback from the first run
  slowed the second (`.git/sdd/cm-task-7-review-1.md`). With a fresh instance per timing, Float32 views were
  as fast or faster up to 24,007 rows and slower at 89,887 (107.5 against 83.4 ms). The decoder still gives
  plain arrays, as the kiosk had before.
- The kiosk predicts every 150 ms (`js/talk-signing.js:17`), with MediaPipe on the same CPU. The Pi script
  is `tests/compact-model/pi-bench.sh` (`docs/system/HARDWARE_BOOT.md`).

### Load time and what is downloaded (laptop)

- **Before** (Step 1 section 3.4): talk.html with no cache downloaded `save_gesture.php?no_sync=1`
  (3,481,409 bytes) plus `signs.php`, and the "gestures" item took 799 / 803 / 995 ms. With the ESL cache it
  took 47 / 56 / 72 ms; `localStorage` held 3,443,720 characters for ESL and 0 for FSL. A switch to FSL
  (never cached) took 754 / 826 / 1,142 ms every time.
- **After** (`tests/compact-model/kiosk-check.mjs`, 3 runs, `.git/sdd/cm-task-5-report.md`): cold "gestures"
  item 128 / 133 / 108 ms, with one `GET models/knn_ESL.bin` of 1,045,196 bytes (34 / 38 / 38 ms); reload
  (one HEAD plus the IndexedDB copy) 50 / 58 / 46 ms; first switch to FSL (network) 48 / 45 / 44 ms; back to
  ESL (cache) 11 / 9 / 10 ms; FSL after a reload (cache) 8 / 14 / 7 ms. Exactly two GETs per run, one per
  language. The only PHP endpoint requested was `php/api/signs.php`, with 0 requests to `save_gesture.php`,
  and 0 console errors at 1024x600.
- Storage with both files cached: 1.13 MB (`navigator.storage.estimate()`, Task 7 bench).

### Scale (synthetic, laptop)

`tests/compact-model/scale-check.mjs` added 120 synthetic Both signs x 25 v3 samples (3,000 samples) next to
today's data and pressed Compile (`.git/sdd/cm-task-9-report.md`). Result: ESL 11,047 rows / 242 labels /
3,127 samples, 5,596,344 bytes; FSL 10,414 / 210 / 3,091, 5,274,244 bytes; every synthetic sign 75 rows
(25 x 3). Compile took 52.6-100.5 s for ESL and 45.4-77.1 s for FSL over two runs (`docs/system/UI.md`;
`docs/system/DEBT.md` item 133).

## Glove re-ranking (glove-hw Phase 2, 2026-10-21)

Optional, only while the 🧤 button is ON (`docs/system/GLOVE.md` "Glove in recognition"). `knnPredict`,
`cosineSimilarity`, the model files and Compile are unchanged. After `knnPredict` returns its normalized scores,
`GloveAssist.apply(scores, knnModel)` (`js/glove-assist.js`) may lower the top 5 labels' scores by
`w x distance` between the glove's finger bend and the bend computed from that label's model rows
(`js/glove-bend.js`); the rolling filter and debounce then run on those scores as before.

| Where | Call |
|---|---|
| Let's Talk | `js/talk-signing.js` `tick()`, right after `knnPredict(f)` |
| Train Gestures Step 3 | `js/gesture-training-ui.js`, right after `knnPredict(f)` (`currentStep === 3` only) |

Measured (node 22, cloud container; the Pi is not measured): first re-rank over 5 labels of 90 rows each 11.0 ms
(bends computed and cached), then 1.2 ms; `tests/glove/glove-bend-check.mjs` 0.4 ms per call with cached rows. From
the ESL model's own rows: median finger bends of "s" 0.75 / 0.69 / 0.67 / 0.68 and of "a" 0.76 / 0.69 / 0.68 / 0.70
(index..pinky) but thumbs 0.73 vs 0.14, which is the kind of difference the camera alone finds hard.


## Whole-sign recognition (seq-recognition phase, 2026-11-15)

A second recognizer that answers once per sign, from the sign's start to its end, instead of once per camera
frame. It runs in Let's Talk and in Train Gestures Steps 3 / 4 whenever `models/seq_<LANG>.bin` loads; when the
file is missing or unreadable, or the page address has `?seq=off`, the frame k-NN above runs exactly as before
(`js/seq-live.js:12`, `:27-31`; `js/talk-signing.js` `seqOn()`, `tick()`). Report with every measured number:
`docs/reports/2026-11-15-seq-recognition-final.md`.

| Part | File |
|---|---|
| The sign's numbers (258) and the nearest-sample search, the model file format | `js/seq-features.js` |
| Cutting the camera's frames into signs, one answer per sign | `js/seq-recognizer.js` |
| Loading `models/seq_<LANG>.bin`, feeding MediaPipe results | `js/seq-live.js` |
| Building the file: Train Gestures Step 2 Compile (after the k-NN file), laptop only | `js/gesture-training-ui.js` `compileModel()`, `php/api/compile_seq_model.php` |
| Building it with node from a samples folder; measuring accuracy | `tools/seq_eval/build.mjs`, `eval.mjs`, `stream.mjs` |

- **Where a sign starts and ends** (`js/seq-recognizer.js:23-32`): it starts when a hand comes into view, or
  moves again after a hold (`RESUME_TOL` 0.45 palm lengths). It ends when no hand has been seen for `NO_HAND_MS`
  400 ms, or the hands have been still for `STILL_MS` 600 ms (`STILL_TOL` 0.30 palm lengths) — the owner's choice
  of 2026-11-15, "ibaba o ihinto ang kamay". Shorter than `MIN_FRAMES` 4 or `MIN_MS` 350 ms is ignored; longer
  than `MAX_MS` 6000 ms is cut there.
- **What is compared** (`js/seq-features.js`): the sign is cut into `K` = 3 equal parts in time (start, middle,
  end). For each part and each hand: 14 joint angles, 15 fingertip distances, the palm's direction (9), averaged
  over the part; plus how much of the part each hand was in view and where the wrists were; plus each hand's
  start-to-end movement and path length. `DIMS` = 258. Every stored sample is kept as recorded and mirrored, and
  also as the pieces the live cutter makes of it (`SeqRecognizer.segmentsOf`), so a live piece is compared with
  like pieces.
- **The answer**: the nearest stored sample (Euclidean, after standardizing) names the sign; `ratio` = distance
  to that sign / distance to the nearest other sign. Below `RATIO` 0.90 the sign is given; otherwise the event
  is `unsure` and nothing is added ("Not sure. Sign again"). A piece that starts from a hold and ends with the
  hands going down needs `RATIO_TAIL` 0.80, is ignored when shorter than `DROP_MS` 900 ms, and the same sign
  straight out of a hold is "the same sign continuing" (`js/seq-recognizer.js:80-92`).
- **Gloves**: only for a sign that ended in a hold, over the best 5 signs, through the unchanged
  `GloveAssist.apply` (`js/talk-signing.js` `onSeqEvent`); another sign is taken only when the glove put it ahead.
- **File** (`js/seq-features.js:216-217`): `'SKSQ'`, u32 header length, header JSON, row labels u16, mean and
  spread f32 x 258, rows f32 x 258. Tracked files built 2026-11-15 from the owner's 1,357 samples:
  `models/seq_ESL.bin` 5,696,776 bytes (164 signs, 5,506 rows), `models/seq_FSL.bin` 4,048,452 bytes (137 signs,
  3,912 rows). Not stored in IndexedDB: fetched with `cache: 'no-cache'` on each page load.
- **Cost**: one classification of one sign against the ESL file, 1.75 ms in node on the build machine (mean of
  200); once per sign, not per frame. Not measured on the Pi.
- **Not done**: no `start` sign exists in the samples (0 files), so in whole-sign mode recording starts only by
  the countdown; `stop` works (6 samples). `model_status.php` does not look at the seq file: it is rebuilt by
  every Compile.
