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

- **`talk.html`'s signing screen** (and formerly `sign-to-text.html`, archived 2026-09-21), via `js/sign-to-text-ui.js:204-243` (`knnPredict`; `cosineSimilarity` `:193-202`, re-measured 2026-10-05) — top-K
  (`min(5, N)`) cosine similarity, score normalized `(s-0.3)/0.7` clamped
  0-1. Confirmed working (see `CLAUDE.md`).
- **`gesture-training.html`**, via `js/gesture-training-ui.js:581-622` (`knnPredict`; `cosineSimilarity` `:570-579`, re-measured 2026-10-05) — same
  approach, `K=5`. `trainModel()` here is a KNN cache-merge with a cosmetic
  progress animation, not real epoch training (`docs/system/UI.md` Part 2,
  §3).

## Model membership and display text (sign-texts phase, 2026-10-04)

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

## Could not determine

- Whether `diagnostic.html` makes its own direct Hands/TF.js calls — it was not
  one of the files scanned for this pointer document.
- Whether `js/main.js` or `js/dist/build.js` contain inference calls — both are
  out of scope (dead code slated for deletion, see `docs/system/DEAD_CODE.md`) and
  were not read.
