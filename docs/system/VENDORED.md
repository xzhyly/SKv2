# Vendored Libraries

Unmodified third-party code. Kept short deliberately — nothing here is authored
kiosk logic.

## 1. Owns these files

- `js/lib/tf.min.js`
- `js/lib/mediapipe/hands.js`
- `js/lib/mediapipe/hands_solution_packed_assets_loader.js`
- `js/lib/mediapipe/hands_solution_simd_wasm_bin.js`
- `js/lib/mediapipe/hands_solution_wasm_bin.js`
- `js/lib/mediapipe/hands_solution_simd_wasm_bin.wasm` (5,917,209 bytes)
- `js/lib/mediapipe/hands_solution_wasm_bin.wasm` (5,917,209 bytes)
- `js/lib/mediapipe/hand_landmark_full.tflite` (5,478,688 bytes)
- `js/lib/mediapipe/hands.binarypb` (550 bytes)
- `js/lib/mediapipe/hands_solution_packed_assets.data` (4,326,731 bytes)

Sizes from `ls -la` on `js/lib/`.

## 2. What it does

- `tf.min.js` — TensorFlow.js tensor/ML runtime, used for the gesture-classification
  model (not for hand detection).
- `hands.js` + companions — MediaPipe Hands: a hand-landmark detection pipeline
  compiled to WebAssembly, invoked through the `Hands` class it exposes on
  `window`.

## 3. How it works

- TF.js version string: `version:"3.29.1"` at `js/lib/tf.min.js:17` (inside the
  single 1,461,634-character minified line; file also carries an Apache-2.0
  license header, `js/lib/tf.min.js:1-15`, "Copyright 2023 Google LLC").
- MediaPipe Hands version string: `za("VERSION","0.4.1675469240")` at
  `js/lib/mediapipe/hands.js:95`.
- Two WASM binaries exist (SIMD and non-SIMD). The runtime choice is made inside
  `hands.js`: a feature-detection routine (`ed()`, using a hand-rolled SIMD test
  module `ad`, `hands.js:65-66`) sets a boolean `c`; the file manifest at
  `hands.js:90` lists `{simd:false,url:"hands_solution_wasm_bin.js"}` and
  `{simd:true,url:"hands_solution_simd_wasm_bin.js"}`, and the filter in `gd()`
  (`hands.js:69-70`) picks whichever entry's `simd` flag matches `c`.
- `hands.binarypb` is a serialized MediaPipe `CalculatorGraphConfig` protobuf
  (confirmed by hex dump: contains calculator names like
  `ConstantSidePacketCalculator`, `GlScalerCalculator`, `HandLandmark...`),
  referenced as `graph:{url:"hands.binarypb"}` at `hands.js:90` and fetched via
  `hd()` (`hands.js:78`).
- `hand_landmark_full.tflite` is fetched separately (not bundled in the `.data`
  package) via the `modelComplexity` `onChange` handler at `hands.js:93`, which
  builds the path `third_party/mediapipe/modules/hand_landmark/` + `nd(c)`; `nd()`
  (`hands.js:89`) returns `"hand_landmark_full.tflite"` for complexity 1,
  `"hand_landmark_lite.tflite"` for anything else.
- `hands_solution_packed_assets.data` bundles different files: its embedded
  manifest (`hands_solution_packed_assets_loader.js:190`) lists `handedness.txt`,
  `palm_detection_full.tflite`, and `palm_detection_lite.tflite` — the
  palm-detector models, not the hand-landmark model.

## 4. Key decisions and why

No npm/CDN-vs-vendoring rationale is stated in code comments anywhere in these
files — reason not documented in code. (The system description states the kiosk is
fully offline with no CDN, which is consistent with vendoring, but that rationale
itself is not present in these files.)

## 5. Constraints

Raspberry Pi CPU/SIMD-stability concern is documented, but only in the *calling*
HTML/JS files, not inside the vendored files themselves: `preload.html:15-18` —
"Force non-SIMD WebAssembly on Raspberry Pi to prevent 'memory access out of
bounds' crashes... forcing fallback to the stable non-SIMD binary
(hands_solution_wasm_bin.wasm)." Same pattern at `bulk-importer.html:418-436`, and
a URL-rewrite variant inside `js/gesture-data.js:232-236` and `:696-699` ("Force
non-SIMD: redirect SIMD binary requests to stable non-SIMD version") — see
`docs/system/UI.md`. The vendored files themselves contain no Pi-specific
comments.

## 6. Touches

`tf.min.js` and `hands.js` are loaded via `<script src="js/lib/...">` in
`camera-translator.html:9-10`, `sign-to-text.html:9-10`, `gesture-training.html:10-11`,
`diagnostic.html:21-22`, `preload.html:8-9`, `bulk-importer.html:441` (tf.min.js is
not present in bulk-importer's own script tags — only hands.js at line 441), and
`index.html:9-12` (as `<link rel="prefetch">`, not `<script>`). Verified:
`hands.binarypb`, `hands_solution_packed_assets.data`, both `.wasm` files, and
`hand_landmark_full.tflite` are **not** referenced by any HTML `<script>` tag
anywhere in the repo (grepped across all `*.html`) — they are only referenced from
inside `hands.js` (`hands.js:90`, `hands.js:93`) and
`hands_solution_packed_assets_loader.js:22-23`, fetched at runtime via
`fetch`/`XMLHttpRequest`.

## Problems found

- `hands.js:89` (`nd()`) can request `hand_landmark_lite.tflite`, but no such file
  is vendored — only `hand_landmark_full.tflite` exists in `js/lib/mediapipe/`.
  This is only safe because every call site setting `modelComplexity` found in
  this audit uses `1` (full); if any code path ever left `modelComplexity` at its
  unset/0 default, the fetch would 404.
- SIMD-disable is applied inconsistently across entry points: `preload.html`,
  `bulk-importer.html`, `gesture_test.html` patch `WebAssembly.validate`;
  `js/gesture-data.js` instead rewrites `locateFile` URLs. `camera-translator.html`,
  `sign-to-text.html`, `gesture-training.html`, `diagnostic.html` load `hands.js`
  directly with no visible SIMD guard in the HTML itself (their guard, if any,
  would have to come from `gesture-data.js`'s `setupMediaPipe`, which does rewrite
  the URL). Net effect: the vendored `hands_solution_simd_wasm_bin.wasm`/`.js`
  pair appears to be routed around everywhere it's used, making it effectively
  dead weight on this hardware, but no single line proves it is *never* reached
  (e.g., `diagnostic.html`'s own Hands setup was not in scope for this pass).
- No license/version metadata could be found for the MediaPipe files beyond the
  `VERSION` string constant at `hands.js:95`; the `.wasm`/`.data`/`.tflite`/
  `.binarypb` binaries carry no inspectable text header for version.

## Could not determine

- Exact TF.js/MediaPipe build dates or commit hashes (only the version strings
  above).
- Whether `hand_landmark_lite.tflite` is reachable from any UI file in scope for
  this pass (only 4 files were grepped for inference call sites — see
  `docs/system/ML.md`).

## MediaPipe Holistic (avatar phase, 2026-10-05)

- **Files** (`js/lib/holistic/`, 7 files, 30,195,488 bytes, unmodified from the npm package
  `@mediapipe/holistic` 0.5.1675471629, Apache-2.0; tarball sha512 matched the registry `integrity`):
  `holistic.js` (78,139), `holistic.binarypb` (1,741), `holistic_solution_packed_assets_loader.js` (9,786),
  `holistic_solution_packed_assets.data` (16,877,755), `holistic_solution_simd_wasm_bin.js` (276,482),
  `holistic_solution_simd_wasm_bin.wasm` (6,511,073), `pose_landmark_full.tflite` (6,440,512).
  Version string: `VERSION","0.5.1675471629"` in `holistic.js`.
- **Only the SIMD build** (owner decision): the non-SIMD `holistic_solution_wasm_bin.js/.wasm` pair is NOT
  vendored, so Holistic only runs where WebAssembly SIMD exists; `js/avatar-extract.js` `simdSupported()`
  checks first and the admin page shows a message. `pose_landmark_lite/heavy.tflite` are not vendored either:
  `modelComplexity` is always 1 (full).
- **Used only by `avatar-clips.html`** (`locateFile: f => 'js/lib/holistic/' + f`), never by the kiosk pages.
- **Offline proof** (measured, Chrome with `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost"`):
  `initialize()` resolved and all 256 frames of a test video were processed; every request went to localhost
  (`tests/avatar/admin-check.mjs`; step 1 report (b)).
