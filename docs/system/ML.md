# ML / Inference — Pointer Document

Inference logic is not a separate architectural layer; it lives inside the UI
files listed below and is documented in full in `docs/system/UI.md`. This page
exists only so the Touches section of `docs/system/UI.md` is legible — it says
where inference happens and which vendored library (documented in
`docs/system/VENDORED.md`) backs each call.

| File | Line | API call | Purpose | Vendored library |
|---|---|---|---|---|
| js/gesture-data.js | 230 | `new window.Hands({...})` | Creates a MediaPipe Hands detector instance for the live translation view. | MediaPipe Hands |
| js/gesture-data.js | 245 | `state.hands.onResults((results) => {...})` | Registers the callback that receives per-frame hand landmarks. | MediaPipe Hands |
| js/gesture-data.js | 390 | `await state.hands.send({ image: offscreenCanvas })` | Feeds one video frame into the Hands pipeline for landmark detection. | MediaPipe Hands |
| js/gesture-data.js | 693 | `new window.Hands({...})` | Creates a second Hands instance for the gesture-recording/training path. | MediaPipe Hands |
| js/gesture-data.js | 708 | `state.hands.onResults((results) => {...})` | Registers the landmark-result callback during gesture recording. | MediaPipe Hands |
| js/gesture-data.js | 791 | `await state.hands.send({ image: offscreenCanvas })` | Feeds one recorded-video frame into Hands during training capture. | MediaPipe Hands |
| js/gesture-data.js | 507 | `await tf.io.removeModel(modelKey)` | Deletes a cached IndexedDB model when the language/label set changes. | TensorFlow.js |
| camera-translator.html | 1220 | `tf.tensor2d(xS,[xS.length,activeFeatureSize])` | Builds the training-input tensor from collected landmark features. | TensorFlow.js |
| camera-translator.html | 1221 | `tf.tensor2d(yS,[yS.length,activeLabels.length])` | Builds the training-label tensor. | TensorFlow.js |
| camera-translator.html | 1270 | `await tf.loadLayersModel('indexeddb://sining-kamay-model')` | Loads a previously trained classifier model from browser storage. | TensorFlow.js |
| camera-translator.html | 1326-1327 | `tf.tensor2d([f],[1,activeFeatureSize])` then `tfModel.predict(inp)` | Runs live sign classification on one frame's feature vector. | TensorFlow.js |
| camera-translator.html | 1686 | `tf.tensor2d([f],[1,activeFeatureSize])` then `tfModel.predict(inp)` (same line) | Runs live sign classification in the kiosk prediction loop. | TensorFlow.js |

`js/sign-to-text-ui.js:387-388` and `js/gesture-training-ui.js:955-956` call
`window.GestureDataRecorder.setupMediaPipe(...)` — a wrapper defined in
`js/gesture-data.js`, not a direct MediaPipe/TF.js API call, so no row is listed
for them. Note: `sign-to-text-ui.js`'s live prediction itself does not use TF.js —
it uses a hand-rolled cosine-similarity k-NN instead (see `docs/system/UI.md` Part
1, §3).

## Could not determine

- Whether `diagnostic.html` makes its own direct Hands/TF.js calls — it was not
  one of the four files scanned for this pointer document.
- Whether `js/main.js` or `js/dist/build.js` contain inference calls — both are
  out of scope (dead code slated for deletion, see `docs/system/DEAD_CODE.md`) and
  were not read.
