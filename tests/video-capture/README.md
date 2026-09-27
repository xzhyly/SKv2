# tests/video-capture

Tests and checks for the video-based gesture capture flow (`gesture-training.html` Step 1's
"Record 3 samples" full-screen recording mode, `js/gesture-capture-ui.js` +
`js/video-landmarks.js` + `js/capture-core.js`). Apache + MariaDB (XAMPP) must be running for
anything that touches the live DB/disk; those tests use `zz_`-prefixed labels and clean up after
themselves.

Run everything serially (`node --test --test-concurrency=1`, DEBT 66) - none of these are
designed to run concurrently against the same live dataset/DB.

## Pure/unit tests (`node --test`, no browser, no server)

- `segmenter.test.mjs` - `js/capture-core.js`'s hand-presence segmenter (REST/SIGN state
  machine), DOM-free.
- `seek-times.test.mjs` - `js/video-landmarks.js`'s `seekTimes(duration, fps)` pure helper.
- `feature-rows.test.mjs` - `js/gesture-data.js`'s `recordingToFeatureRows()` load-time
  normalization (v2 byte-identical, v3 raw-frame flattening + the 30-row subsample cap).
- `save-raw.test.mjs` - `php/api/save_gesture.php` accepting v3 raw metadata, under `php-cgi.exe`
  (no Apache, no browser).

Run: `node --test --test-concurrency=1 tests/video-capture/*.test.mjs`

## Browser-driven checks (headless Chrome via CDP, `cdp.mjs`)

- `extractor-check.mjs` (Task 4) - `js/video-landmarks.js`'s `extractVideoLandmarks()` +
  `js/gesture-data.js`'s `createVideoDetector()`/`onHandResults()`, against
  `tests/video-capture/extractor.page.html`. No fake camera; drives MediaPipe over a synthetic
  MediaRecorder recording built in-page from `assets/signs/en/hello.webm`.

  Run: `node tests/video-capture/extractor-check.mjs`

- `capture-ui-check.mjs` (Task 5) - the full-screen recording mode's UI/state machine: form,
  Ready/Countdown/Recording/Review/Processing/error states at 1024x600 (touch targets, no
  overlaps), the g/G-hotkey removal, a forced save-failure + retry, Cancel at every stage
  (including hidden-during-saving), and Train AI still completing afterwards. Drives
  `gesture-training.html` with a **fake camera** (`--use-fake-device-for-media-stream` fed from a
  `.y4m` built with the repo-root `ffmpeg.exe` from `assets/signs/en/hello.webm`).

  Run: `node tests/video-capture/capture-ui-check.mjs`

- `e2e.mjs` (Task 6) - the formal end-to-end proof, changes no product code. Same fake-camera
  approach as Task 5, but drives the **whole** flow once, measures it, and proves the properties
  the phase depends on rather than every UI pixel:
  - Record 3 samples -> START -> 3-2-1 -> REST/SIGN n of 3 guidance (logged with timestamps) ->
    auto-stop -> Review "3 signs found" -> Save -> Processing -> 3 sequential saves -> closed.
  - Exactly 3 new `saved_gestures/<label>/sample_*.json` files (`formatVersion` 3,
    `source: "video-live"`, `repIndex` 1/2/3, `fps` 15, rounded coordinates, per-rep frame
    counts and file sizes reported) and exactly 3 matching `gesture_recordings` DB rows (queried
    live via `php/connect.php`, `tests/categorization/db.mjs`'s pattern).
  - **No request in the whole run carries `video_base64`/`video_path`** - checked at the CDP
    `Network.requestWillBeSent` level (see `cdp.mjs`'s `enableNetwork()`/`getNetworkRequests()`),
    not just via an in-page fetch wrapper.
  - Redo (back to Ready, no request) and Cancel (at Ready, during Recording, and during
    Processing - no request, no new files, `assets/signs/` and the label folder listing
    unchanged).
  - Old samples still load and mix: Train AI (Step 2) completes with the new label's rows
    included, then Predict (Step 3) runs live under the fake camera for ~5s producing output.
  - Pressing g/G does nothing, no "Press G" toast.
  - 0 console errors / uncaught exceptions across the whole run (MediaPipe's own info/warning
    logs are `console.info`/`console.warn`, not `console.error`, so they don't count and don't
    need excluding by name).
  - Measures and prints: fake-camera file size, camera-ready time, the prompt/hand-presence
    narrative with timestamps, recording duration, processing (extraction + segmentation) time,
    per-rep frame counts, one saved sample's file size, and `trainData`'s row count for the test
    label.
  - Cleans up: `delete_gesture`, confirms the folder and DB rows are gone, deletes its own temp
    folder. Confirms `assets/signs/` is byte-for-byte unchanged before/after.

  Run: `node tests/video-capture/e2e.mjs`

  Since the capture UI layout fix (2026-09-27) Step 1 has no camera: the recording mode starts
  the camera itself ("Starting camera…", START disabled until the first live hand result) and
  stops it on close. `e2e.mjs` follows that real flow (no Enable Camera click in Step 1) and uses
  Step 3's own Enable Camera for Predict; `capture-ui-check.mjs` covers both the overlay-started
  camera and a camera already running before the overlay opens.

- `screenshots.mjs` (capture UI layout fix, 2026-09-27) - screenshots of Step 1 and every
  recording-mode state (Starting camera, REST, SIGN 2 of 3, Review, Processing, Saving, a
  save-failure error) at **1024x600 and 1280x720**, saved to `docs/reports/img/`, with per-state
  checks: no scrollbar, every visible button >= 44x44 (overlay bottom bar >= 56 tall), no
  top-bar overlap, the overlay-started camera stopped on close, 0 console errors. Saves are
  delayed 1.5 s in-page so Saving can be captured; the error state is a forced failure of save 2.
  Deletes its test label afterwards.

  Run: `node tests/video-capture/screenshots.mjs`
  (`SHOTS_SIZES=1024x600` limits the sizes; `SHOTS_ONLY=ready,error-save-failed` rewrites only
  those images, every check still runs.)

- `startup-check.mjs` (owner follow-up, 2026-09-27) - timing only, prints one JSON line: the
  recording mode's Starting camera → START enabled on the first and second open, the page-load
  hand-tracking warm-up result, Train AI time, Step 3 camera → first hand result, 10 s of
  Predict, console errors. Cancels before recording, so it creates no samples. Run it on the Pi
  to fill in the unmeasured Pi timings.

  Run: `node tests/video-capture/startup-check.mjs`

Full measured output from the verification run is in
`docs/reports/` / `.git/sdd/vc-task-6-report.md` (see the phase's task list for the exact path).

## Shared helpers

- `cdp.mjs` - minimal CDP driver: launches headless Chrome at 1024x600 (or with extra flags, e.g.
  the fake-camera ones), navigates, evaluates expressions in-page, and collects console
  messages/exceptions. `enableNetwork()`/`getNetworkRequests()`/`getRequestPostData()` are an
  opt-in addition (Task 6) for checking request bodies at the CDP level; they are no-ops for any
  caller that never invokes `enableNetwork()`.
- `fake-camera.mjs` - `buildY4m(dir)`: the fake-camera `.y4m` (hello.webm x3 with black gaps)
  shared by `e2e.mjs` and `screenshots.mjs`.
- `load-gesture-data.mjs` - loads `js/gesture-data.js` under Node for the pure unit tests.
