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

- **`sign-to-text.html`**, via `js/sign-to-text-ui.js:199-238` — top-K
  (`min(5, N)`) cosine similarity, score normalized `(s-0.3)/0.7` clamped
  0-1. Confirmed working (see `CLAUDE.md`).
- **`gesture-training.html`**, via `js/gesture-training-ui.js:310` — same
  approach, `K=5`. `trainModel()` here is a KNN cache-merge with a cosmetic
  progress animation, not real epoch training (`docs/system/UI.md` Part 2,
  §3).

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
