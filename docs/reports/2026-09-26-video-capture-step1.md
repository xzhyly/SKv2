Phase: video-based gesture capture
Date: 2026-09-26
Status: WAITING FOR APPROVAL
Decision needed from owner: approve the design, and answer open questions Q1–Q8 in section (h). Each one has a recommended default.

# Video-based gesture capture: Step 1 (investigate, propose)

Scope: Step 1 (Add Data) of `gesture-training.html` changes from live landmark
capture to this flow: record a video, review it, then extract landmarks from
the recording. The video→landmarks core has to be reusable, unchanged, by the
Drive-import phase that comes next.

How the evidence was gathered:
- Code reads at the `file:line` cited.
- A throwaway spike page (`zz-spike/spike.html`) was served by Apache and run
  in headless Chrome 153 on this laptop through CDP. It used the vendored
  MediaPipe Hands with the same config and non-SIMD patch as
  `js/gesture-data.js`. The spike is deleted; `git status` shows only the
  owner's two files.
- The spike's input was a synthetic MediaRecorder WebM: a real sign clip,
  `assets/signs/en/hello.webm` (360×203, 2.0 s), played 3 times with 1.5 s
  black gaps, drawn into a 320×240 canvas and recorded with
  `MediaRecorder(canvas.captureStream(30), 'video/webm;codecs=vp8')`.
  Result: 11.98 s and about 293 KB, measured on 5 runs at 292,216–295,038 bytes.
- **Nothing was measured on the Raspberry Pi.** Every time below is from the
  laptop.

---

## Starting facts: verification

| # | Owner's fact | Verdict |
|---|---|---|
| 1 | `FRAME_MIN = 1`, `FRAME_MAX = 40` (`js/gesture-data.js:3-4`); `stopRecording()` truncates to `FRAME_MAX` (`:515-516`) | **True, with one addition.** `FRAME_TARGET = 30` (`:2`) already stops capture at 30 frames (`:454`, `:468-469`), so the 40-frame truncation can never trigger on the live path. |
| 2 | MediaPipe config: 2 hands, complexity 1, confidence 0.65/0.65 (`:243-246`) | True. |
| 3 | Only `results.multiHandLandmarks` is kept; handedness is never stored (`:249-250`) | True. |
| 4 | `flattenHand()` makes each hand wrist-relative and scale-normalized, so position in the frame is lost. `recordingToFeatureRows()` (`:663`) runs `flattenLandmarks(frame.landmarks \|\| frame)` at load. | **True, with one addition.** Normalization happens **at capture time**: `captureFrameIfRecording()` stores `flattenLandmarks(...)` output (`:463`). A saved frame is therefore already a 126-float normalized array. At load, `flattenLandmarks` returns 126-number arrays unchanged (`:143-144`). The on-disk shape was measured across all 210 sample files: 208 store each frame as a bare 126-float array, 2 store `{index, timestamp, landmarks:[126 floats]}`. Every file carries `format: "mediapipe_hands_landmarks_v2"`. Frames per sample: min 2, median 14, max 45. |
| 5 | Toast `'Press "G" to record a labeled gesture sample.'` (`:346`); `installHotkey()` binds G (`:691`) | True. `gesture-data.js` is also loaded by `talk.html` (`js/talk-loader.js:14`). There the toast goes through `window.showToast` from `js/sign-to-text-ui.js:80-90`, which returns early because `talk.html` has no `#sk-toast`. Checked in headless Chrome: after 25 s, no toast element exists on `talk.html`. Removing the toast has no visible effect on Let's Talk. |
| 6 | `gesture-training-ui.js` already records video: `runCountdown()`, `startMediaRecording()` (`:1261`), `window.currentPreviewBlob`, preview with Save/Retry, `hookStartRecording()` | True. `runCountdown` is at `:1235`, `currentPreviewBlob` at `:1291`, Save/Retry wiring at `:1478-1502`, `hookStartRecording` at `:1438-1456`. |
| 7 | Start/Finish buttons at `gesture-training.html:226-227`, in the left form column; camera takes half the screen | True. Measured at 1024×600: `#cameraFrame` is 562×447 at x=446 (55% of the width); `#leftStep1` is 429 px wide; Start and Finish are each **200×40** (below 44 px). |
| 8 | `save_gesture.php:444-501` transcodes the first sample's video to `assets/signs/<en\|fil>/<label>.mp4` | True. |
| 9 | Let's Talk camera is 320×240 (`js/talk-signing.js:284`) | True. Gesture training asks for the same size: `initCameraWithFallback(320, 240, …)`, `js/gesture-training-ui.js:1063-1065`. |

### Not listed by the owner, and they affect the design

- **F1. The server rejects any sample over 120 frames.**
  `php/api/save_gesture.php:398` returns HTTP 413 with the message "expected
  20-40 frames". At 15 fps, a rep of `MAX_REP_MS` = 20 s can have up to 301
  frames, so the cap has to be raised or phrases can't be saved.
- **F2. The server hardcodes the format tag and drops unknown fields.**
  `$recording` (`save_gesture.php:430-437`) writes only `label`, `createdAt`,
  `frameCount`, `format` (always `'mediapipe_hands_landmarks_v2'`, `:434`),
  `signLanguage` and `frames`. The per-sample metadata in decision 7 needs a
  small server change to be stored.
- **F3. Disk files are pretty-printed.** `json_encode(..., JSON_PRETTY_PRINT)`
  at `:439`. The dataset GET re-encodes compactly (`list_samples`, `:274`,
  `:310`). Measured: `GET ?no_sync=1` is 5,605,313 bytes in 1.08 s today.
  Per-frame cost of the old format, measured over all 210 files: median
  **1,501 bytes/frame** compact.
- **F4. Everything that trains or classifies reads samples through
  `recordingToFeatureRows()`.** That includes `talk.html`, via
  `js/sign-to-text-ui.js:96-101` → `loadGestureDatasetForTraining`. Samples in
  the new format will reach Let's Talk's classifier through this one function.
  That is intended (one pipeline), but it means the load-time normalization
  has to be exactly right.
- **F5. The old live path never stored a frame without a hand**
  (`:457-458`). A rep in the new format will contain in-rep no-hand frames:
  gaps shorter than `REST_MS`. `cosineSimilarity` returns 0 for a zero vector
  (`gesture-training-ui.js:406-407`), so there is no NaN risk. But
  `flattenLandmarks([])` gives 126 zeros, and those would become training rows
  that the old data never contained. The loader must **skip no-hand frames**
  to keep training behaviour identical.
- **F6. Chromium on the Pi decodes video in software.**
  `start_kiosk.sh:17` passes `--disable-accelerated-video-decode`
  (`docs/system/HARDWARE_BOOT.md:75`). Reading the recording back costs CPU on
  the Pi. This is not measured.

---

## (a) Current capture flow, mapped

1. The operator enables the camera. That calls `initCameraWithFallback(320,
   240)` (`gesture-training-ui.js:1062-1100`), then
   `GestureDataRecorder.setupMediaPipe(videoFeed)` (`:1075-1076`).
2. `setupMediaPipe` (`gesture-data.js:179-349`) creates the single `Hands`
   instance and starts `runHandLoop()` (`:358-416`). The loop runs on
   `requestAnimationFrame`: it letterboxes the video into a 320×240 offscreen
   canvas (`:353-356`, `:374-398`), then calls `await hands.send()` (`:402`).
   `onResults` (`:248-341`) stores `latestLandmarks` and calls
   `captureFrameIfRecording()`. It also shows the "Press G" toast (`:346`).
3. Start Capture (`gesture-training.html:226`) is wired twice:
   - `installUiControls()` (`gesture-data.js:715-750`) calls
     `GestureDataRecorder.startRecording(label)`.
   - `hookStartRecording()` (`gesture-training-ui.js:1438-1456`) wraps that
     method so it (a) refuses without a camera stream, (b) runs
     `resetCaptureUI()`, (c) runs `runCountdown()` (3-2-1-GO, 1000 ms per
     tick, `:1235-1259`), and (d) calls `startMediaRecording()` then the
     original `startRecording(label)`.
4. `startMediaRecording()` (`:1261-1312`) creates
   `MediaRecorder(stream, 'video/webm;codecs=vp8')` and collects chunks.
5. `startRecording()` (`gesture-data.js:473-494`) cleans the label, reads the
   sign set, and sets `recording = true`. Each MediaPipe result then pushes a
   frame, at most one every 90 ms (`frameIntervalMs`, `:20`). A frame is
   `{index, timestamp, landmarks: flattenLandmarks(...)}` (`:460-464`), and
   only frames with a hand are kept (`:457-458`).
6. Capture stops at 30 frames (`:468-469`), or when Finish Capture / G calls
   `stopRecording()` (`:496-526`). That calls
   `window.onGestureCaptureStop` → `mediaRecorder.stop()`
   (`gesture-training-ui.js:1459-1463`). Fewer than `FRAME_MIN` frames calls
   `onGestureCaptureCancelled`. Otherwise frames are truncated to `FRAME_MAX`
   and `onGestureCaptureReady(label, lang)` sets the "This will be sample N"
   line (`:1472-1476`).
7. `mediaRecorder.onstop` (`:1286-1309`) builds the Blob and sets
   `window.currentPreviewBlob`. It shows `#step1PreviewControls` with the
   mirrored, looping `#capturePreviewVideo` (`gesture-training.html:263-282`)
   and zoom/pan controls (`gesture-training-ui.js:1340-1435`).
8. **Save Gesture** (`:1482-1493`) calls `confirmAndSave()`
   (`gesture-data.js:528-603`). That function:
   - reads the Blob as a base64 data-URL (`:536-549`) and the checked Type
     radio (`:551-552`);
   - POSTs through `saveGestureSample()` (`:612-646`);
   - invalidates the TF model cache and `sining_kamay_labels_<lang>`
     (`:560-571`), awaits `window.reloadDataset()` (`:573-575`), and clears
     state (`:582-585`).

   The UI then runs `noteSampleSaved()`, `resetCaptureUI()` and
   `refreshSampleCountLine()`. **Try Again** calls `discardCapture()` and
   `resetCaptureUI()` (`:1495-1502`), which revokes the object URL
   (`:1324-1327`).
9. **What the save endpoint receives**
   (`POST php/api/save_gesture.php`, JSON):
   `{label, sign_language, frames:[{index, timestamp, landmarks:[126]}],
   video_base64?:"data:video/webm;base64,…", video_path?, category?}`.
   - Frame count must be between 1 and 120 (`:395-399`).
   - It writes `saved_gestures[_fsl]/<label>/sample_<ms>_<hex>.json`
     (`:427-441`).
   - Only on a label's first sample with no existing clip, it runs ffmpeg and
     writes `assets/signs/<en|fil>/<label>.mp4` (raw `.webm` fallback,
     `:444-501`).
   - It upserts `gestures`, sets `asset_path`, inserts a `gesture_recordings`
     row with the full JSON (`:503-525`), and returns `labelSampleCount`,
     `frameCount`, `category` and the video flags (`:529-544`).

---

## (b) Module design for the core

Two new plain-script files. No libraries, no build step. Each attaches to
`window` in the browser and to `module.exports` under node, so the pure parts
can be unit-tested with `node --test`.

### `js/capture-core.js`: constants and the pure segmenter (no DOM)

The constants are defined once, here, and nowhere else:

```js
const CAPTURE = Object.freeze({
  REST_MS: 1000,           // no hand this long = rest reached / rep ended
  MIN_REP_MS: 300,         // hand-present stretches shorter than this are ignored
  MAX_REP_MS: 20000,       // a rep longer than this fails ("redo")
  NO_HAND_HINT_MS: 10000,  // no hand this long after the ULIT prompt: show a hint
  REQUIRED_REPS: 3,
  PROCESS_FPS: 15,         // see (d)
  STOP_TAIL_MS: 500,       // Q3: extra recording after the live segmenter says "done"
  MAX_FRAMES_PER_REP: 301, // floor(MAX_REP_MS / (1000 / PROCESS_FPS)) + 1
});
```

The segmenter is one incremental state machine, used live **and** offline, so
both apply the same rule:

```js
createSegmenter(constants = CAPTURE) -> {
  push(tMs, handPresent) -> { phase, repIndex, event }
  //   phase: 'rest' | 'wait-hand' | 'rep' | 'done' | 'failed'
  //   event: null | 'rest-reached' | 'rep-started' | 'blip-ignored'
  //          | 'rep-ended' | 'done' | 'rep-too-long'
  finish(tMs) -> same shape   // end of stream: closes a rep whose trailing no-hand time >= REST_MS
  reps() -> [{ index, startMs, endMs }]   // startMs/endMs = first/last hand-present time
}
segmentFrames(frames /* [{t, handPresent}] */, constants = CAPTURE)
  -> { ok: true,  reps: [{ index, startMs, endMs, startFrame, endFrame }] }
   | { ok: false, reason: 'no-rest' | 'too-few-reps' | 'too-many-reps' | 'rep-too-long',
       repsFound, reps }
```

The rule (decision 3/4), stated once:
- **`rest`.** Wait until no hand has been seen for `REST_MS` → `wait-hand`
  (prompt "ULIT n of 3").
- **`wait-hand` → `rep`.** Starts on the first hand-present frame.
- **Inside `rep`.** A no-hand gap shorter than `REST_MS` does not end the rep.
  When the gap reaches `REST_MS`, the rep ends at its last hand-present time.
  - If the rep lasted less than `MIN_REP_MS` (last hand time − first hand
    time), it is a blip: it is discarded, not counted, and the state goes
    back to `wait-hand` for the same rep number.
  - If the rep's hand-present span exceeds `MAX_REP_MS` while it is still
    open, the state becomes `failed` with `rep-too-long`.
- **After the 3rd rep ends → `done`.** The `REST_MS` gap that ended a rep
  counts as the following PAHINGA (Q2).
- **Offline, a hand after `done`** turns the result into `too-many-reps`.

The two uses of the segmenter:
- **Live guidance.** The capture UI calls `push()` from the MediaPipe results
  already produced by the running camera loop, with `performance.now()` time.
- **Offline, on I-save.** It runs the same fold over the extracted frames,
  using video time.

### `js/video-landmarks.js`: Blob/File → per-frame raw landmarks

This is the reusable core for the Drive import tool.

```js
extractVideoLandmarks(source /* Blob | File */, {
  detector,            // { reset(): void, detect(canvas): Promise<MediaPipeResults> }
  fps = CAPTURE.PROCESS_FPS,
  onProgress,          // (done, total) => void
  signal,              // AbortSignal (Cancel)
}) -> Promise<{
  frames: [{ t, hands: [{ label, score, landmarks: [{x,y,z} x21] }] }],
  videoWidth, videoHeight, fps, durationMs,
  input: { width: 320, height: 240, contentRect: { x, y, w, h } }   // Q5
}>
```

What it does internally:
1. Creates a detached `<video muted playsinline>` and an object URL, and
   waits for `loadedmetadata`.
2. If `duration` is not finite, it seeks to `1e101` and waits for
   `durationchange`, then seeks back to 0.
3. It seeks to `t = 0, 1/fps, 2/fps, …` in order. For each `seeked` event it
   draws into the same 320×240 letterbox that `runHandLoop` uses and awaits
   `detector.detect(canvas)`.
4. It revokes the URL in `finally`.

It knows nothing about reps, labels or the server. The detector is injected,
which keeps the function testable and avoids a second 15 MB `Hands` instance
(see below).

### Changes to `js/gesture-data.js`

- **Add `createVideoDetector()`.** It pauses the live loop (the existing
  `pauseHandLoop()`) and exposes `detect(canvas)` over the **same** `Hands`
  instance: `onResults` resolves a pending one-shot promise while a detector
  is active, instead of updating `latestLandmarks`. `reset()` calls
  `hands.reset()`, which exists in the vendored build (`hands.js:74`;
  measured: it returns `undefined`, not a promise). `release()` resumes the
  live loop.
- **Add `onHandResults(fn)`,** a subscribe/unsubscribe hook so live guidance
  can see hand presence (`multiHandLandmarks.length > 0`) without polling.
- **Extend `recordingToFeatureRows()` for raw frames.** A frame with a
  `hands` array is raw (v3):
  - a frame with **0 hands is skipped** (F5);
  - otherwise it returns `flattenLandmarks(frame.hands.map(h => h.landmarks))`.

  The hand order is the stored MediaPipe order, which is the same order the
  live path passed to `flattenLandmarks` (`:463`), as decision 7 requires.
  Every other frame shape takes the existing `flattenLandmarks(frame.landmarks
  || frame)` path unchanged.
- **Extend `saveGestureSample()`** with a `meta` argument (`formatVersion`,
  `source`, `repIndex`, `videoWidth`, `videoHeight`, `fps`, `input`). It no
  longer sends video from the new flow.
- **Remove the live-capture path:** `FRAME_TARGET/MIN/MAX`,
  `captureFrameIfRecording`, `startRecording`, `stopRecording`,
  `confirmAndSave`, `discardCapture`, `installHotkey` (decision 9), the Start
  and Finish wiring in `installUiControls`, and the toast at `:346`.
- **Leave unchanged:** `flattenHand`, `flattenLandmarks`, `setupMediaPipe`'s
  config, `runHandLoop`, `pause/resumeHandLoop`, `preloadMediaPipe`,
  `loadSavedGestureDataset`, `recordingsToTrainingRows` and
  `loadGestureDatasetForTraining`.

### `js/gesture-capture-ui.js` (new): the full-screen recording mode

This file handles the countdown, MediaRecorder (moved out of
`gesture-training-ui.js`), live guidance, review, processing and saving.
Keeping it separate stops `gesture-training-ui.js`, already 1,505 lines, from
growing further.

---

## (c) Saved sample format

**Before** (v2, unchanged on disk, keeps working):
```json
{ "label": "hello", "createdAt": "…", "frameCount": 14,
  "format": "mediapipe_hands_landmarks_v2", "signLanguage": "ESL",
  "frames": [ [126 normalized floats], … ] }
```
2 of the 210 existing files use `{ "index", "timestamp", "landmarks": [126] }`
frames instead.

**After** (v3, new samples only):
```json
{ "label": "hello", "createdAt": "…", "frameCount": 17,
  "format": "mediapipe_hands_raw_v3", "formatVersion": 3,
  "signLanguage": "ESL",
  "source": "video-live", "repIndex": 1,
  "videoWidth": 320, "videoHeight": 240, "fps": 15,
  "input": { "width": 320, "height": 240, "contentRect": { "x": 0, "y": 0, "w": 320, "h": 240 } },
  "frames": [
    { "t": 2533, "hands": [
        { "label": "Right", "score": 0.9731,
          "landmarks": [ { "x": 0.5123, "y": 0.6011, "z": -0.0001 }, … 21 ] } ] },
    { "t": 2600, "hands": [] },
    …
  ] }
```

- `t` is ms from the start of the recording, on the 1/15 s grid.
- Frames run from the rep's first hand-present frame to its last, inclusive,
  so in-rep gaps appear as `hands: []`.
- Handedness is stored exactly as MediaPipe reports it. MediaPipe assumes a
  mirrored (selfie) input, and this input is not mirrored, so the label is
  the reverse of the signer's anatomical hand. It is stored raw and
  interpreted later (out of scope).

**Server change** (`save_gesture.php`):
- When the body has `formatVersion: 3`, it whitelists and stores `source`,
  `repIndex`, `videoWidth`, `videoHeight`, `fps` and `input`, and writes
  `format: "mediapipe_hands_raw_v3"`. v2 bodies are byte-for-byte unchanged.
- The 120-frame cap becomes `MAX_FRAMES_PER_REP` = 301, with a corrected
  message.
- The video branch (`:444-501`) is left in place. The new flow sends no
  video, so it never runs.
- No schema change: `gesture_recordings.landmark_json` is already `longtext`
  (`db-schema/database_setup.sql:47`).

**How old samples keep loading:** `recordingToFeatureRows()` branches **per
frame on shape** (`Array.isArray(frame.hands)`), not on the file's format
tag. v2 frames go through the same statement as today. No server GET change
is needed.

Verification in Step 2 is a golden test. It builds the feature rows for all
210 current sample files with the pre-change `gesture-data.js` and the
post-change one (node `vm` with a stub `window`/`document`) and asserts they
are identical.

**Size of one saved sample** (measured). The input was a real rep extracted
by the spike: 17 frames, 1,062 ms, one frame with 2 hands, encoded with this
PHP's `json_encode` (`serialize_precision = -1`).

| Coordinates | Disk (pretty-printed, as `:439` writes) | GET payload (compact) |
|---|---|---|
| full float precision | 85,722 B (5,042 B/frame) | 29,543 B (1,738 B/frame) |
| rounded to 5 decimals | 72,065 B | 15,886 B |
| rounded to 4 decimals | 70,941 B | 14,762 B (868 B/frame) |
| *old v2, for comparison (median of 210 files)* | *47,911 B* | *22,927 B (1,501 B/frame)* |

A 20 s maximum-length rep (301 frames) is proportionally larger. That size
was not measured, since no such rep was recorded. See Q4 on rounding.

---

## (d) Frame-processing method and frame rate

### Method: sequential seek on a 1/15 s grid

Options measured in the spike, with MediaPipe on the same 320×240 letterbox:

| Method | Deterministic? | Frames | Laptop wall time for an 11.98 s recording |
|---|---|---|---|
| **A. Seek to each `k/15` s, await `seeked`, detect** | **Yes:** two runs on the same file gave the identical 180-frame hand-count pattern | 180 | 12,810 ms (seek 2,018 + detect 10,700) with cues; 15,746 ms (seek 3,304 + detect 12,321) without |
| B. Play at 1×, `requestVideoFrameCallback`, pause on each frame, detect, resume | **No:** presented 284, 295 and 275 frames on three runs of the same kind of file | 167–171 processed | 17,611–26,053 ms. The floor is the video's own length (`waitMs` ≈ 12,100 ms real-time playback), plus detection. |

**Recommendation: A.**
- It is deterministic, which the Drive importer needs for identical data.
- It does not depend on processing speed. On a slow Pi, B's real-time playback
  and compositor frame-dropping get worse, while A only takes longer.
- It is faster, because it is not bounded by playback time.
- Rejected: WebCodecs with a hand-written WebM demuxer. That is a large
  new parser with no library allowed, and MP4 imports would need a second
  one.

### The known risk: MediaRecorder WebM with `duration = Infinity` and poor seeking

- **Chrome 153 on this laptop no longer shows the problem.** Its MediaRecorder
  output contains a Cues element (byte 101) and a Duration, and it reports
  `duration` 11.977 s.
- **The Pi's Chromium version is not specified anywhere in the repo**, so the
  old behaviour was reproduced. `ffmpeg -c copy -f webm pipe:1` produced a
  WebM with **no Cues and no Duration**; the browser reported
  `duration = "Infinity"`.
- With that file, the `currentTime = 1e101` → `durationchange` trick recovered
  11.977 s.
- The sequential seek grid then worked:
  - 180/180 frames;
  - mean seek 13.9 ms for the first 30 frames and 15.0 ms for the last 30
    (flat, not growing with position), max 147 ms;
  - total seek time 3,241 ms, against 3,078 ms with cues.
- Mean seek, first 30 / last 30 frames: 7.7 / 19.5 ms with cues, and
  13.9 / 15.0 ms without. No pathological slowdown was found.
- The extractor also stops safely if `seeked` never lands past the end: it
  bounds the loop by the recovered duration and by `v.ended`.

### Frame rate: 15 fps

Reasons:
- **Density matches today's data.** The live path stores at most one frame
  per 90 ms, about 11 fps (`gesture-data.js:20`). 15 fps is the nearest round
  rate above it, so per-take frame density stays close to what `knnPredict`'s
  K=5 was tuned against (`DECISIONS.md`, multi-sample, "Soft target is 5").
  The measured rep had 17 frames over 1,062 ms; old samples have a median of
  14 frames.
- **Existing assets use 15 fps.** The shipped sign clips are 15 fps
  (`hello.webm`: median 67 ms between presented frames), and the old importer
  transcoded to `-r 15` (`docs/system/BULK_IMPORTER_NOTES.md:94`).
- **Cost scales linearly with fps.** On the laptop, detection is about
  60–68 ms per frame, measured as 10,700 ms / 180 frames and 12,321 / 180.
  30 fps would double processing time and sample size for frames only about
  33 ms apart.
- **Laptop processing time is about 1.1–1.3× the recording length:**
  12.8–15.7 s for a 12 s recording. MediaPipe `initialize()` took
  584–660 ms, but the gesture-training page has already paid that.
- **Pi processing time is not measured.** Expect it to be much slower. Step 2
  measures the laptop again on a real recording, not on the Pi.

### Per-rep frame counts

Only one rep length was measured: 17 frames for a 1.06 s sign at 15 fps. The
cap is 301 frames per rep (20 s). The final report will give per-rep counts
from the real end-to-end recording.

---

## (e) UI states at 1024×600

The form (Step 1 left column) keeps Gesture Name, Sign Set, Type, the sample
line, View Dataset, Export/Load and Next.
- **Finish Capture** and the **Landmark frames** card are removed.
- **Start Capture** becomes a single **"Record 3 samples"** button (full
  width, ≥ 44 px tall; it was 200×40).
- The old in-panel preview (`#step1PreviewControls`, zoom/pan) is removed.
  Review moves into the full-screen mode.

Tapping Record checks the preconditions, using the existing messages and
toast:
- empty label → "Enter a gesture name first";
- camera not enabled → the existing "⚠️ Please enable the camera first!"
  (`gesture-training-ui.js:1443`).

If both are met, it opens the recording mode: a fixed full-viewport overlay
above the page (the page's own on-screen keyboard is closed first).

The states:
1. **Ready.** The live camera fills the height: 4:3, 693×520 display,
   mirrored for the user (the recording itself is not mirrored).
   - Top bar (≥ 48 px): the chip "hello · ESL · Word" and **Cancel**
     (always visible in every state, ≥ 44×44, top-right).
   - A big **START** button in the centre.
2. **Countdown.** 3-2-1 over the video, 1000 ms per tick (the existing
   `runCountdown` timing). Recording starts when it ends.
3. **Recording, guidance:**
   - big prompt text at the top of the video: **PAHINGA** / **ULIT 1 of 3** /
     **ULIT 2 of 3** / **ULIT 3 of 3**;
   - 3 progress dots (empty / current / done);
   - a hand indicator: a green dot with "Kamay: nakikita" or a grey dot with
     "Walang kamay";
   - a red REC dot with elapsed time.

   Hint and error states during recording:
   - **3a. No hand after the ULIT prompt for `NO_HAND_HINT_MS`.** A banner
     shows "Hindi makita ang kamay. Lumapit o ayusin ang ilaw." Recording
     continues, and the banner clears when a hand appears.
   - **3b. Hands visible in PAHINGA for `NO_HAND_HINT_MS`** (Q6). A banner
     shows "Ibaba muna ang mga kamay."
   - **3c. Rep longer than `MAX_REP_MS`.** Recording stops and the Blob is
     dropped. The message reads "Masyadong mahaba ang ulit (lampas 20 s).
     Ulitin." with **Ulitin** / **Cancel**.
   - **3d. The camera track ends, or MediaRecorder errors.** Recording stops
     and the Blob is dropped. The message reads "Nawala ang camera. Subukang
     muli." with **Ulitin** / **Cancel**.
4. **Review** (auto-opens `STOP_TAIL_MS` after the 3rd rep's rest).
   - The recording plays muted on a loop in the same 693×520 area, mirrored
     for display.
   - A line reads "3 ulit ang nakita" / "N ulit ang nakita".
   - Buttons (≥ 56 px): **I-save** (primary; disabled unless the count is
     exactly 3), **Ulitin** (re-record: drop the Blob, go back to Ready) and
     **Cancel**.
   - Q1 covers what the count means here.
5. **Processing** (after I-save).
   - A progress bar: "Pinoproseso… 42%", from the extractor's `onProgress`
     frames done / total. After that, "Sine-save 1 of 3 … 3 of 3".
   - Cancel stays visible: it aborts extraction through `AbortSignal`. Saves
     already sent stay saved (Q7).
   - Error states:
     - **5a. The offline segmenter finds a count other than 3, or a rep that
       is too long.** Nothing is saved. The message reads "Sa video, N ulit
       lang ang nakita. Ulitin." with **Ulitin** / **Cancel**.
     - **5b. Decode or extraction failure.** Nothing is saved. The message
       gives the error text, with **Ulitin** / **Cancel**.
     - **5c. A save request fails.** The message reads "Na-save ang N of 3.
       Hindi na-save ang ulit M: <error>." with **Subukan ulit** (resends
       only the unsaved reps from memory) and **Cancel** (keeps what was
       already saved).
6. **Done.**
   - The overlay closes and the Blob and URL are dropped.
   - The toast "3 samples saved for “hello”" appears, and the sample line
     updates using the last save's `labelSampleCount`, plus the existing
     "Run Train AI again" note.
   - The model and label caches are invalidated once, as `confirmAndSave` did
     (`gesture-data.js:560-571`), and `reloadDataset()` runs **once** after
     the 3 saves.

Discard points: the Blob is dropped and its object URL revoked on I-save
completion, Ulitin, Cancel, 3c, 3d, 5a, 5b, and on `pagehide`.
`MediaRecorder` is stopped and the live loop resumed on every exit.

The Step 2 layout check at 1024×600 covers:
`documentElement.scrollWidth == 1024`, every control ≥ 44×44, and no overlap
between the prompt text, the dots and the Cancel button.

---

## (f) File list

**Changed**

| File | Why |
|---|---|
| `js/gesture-data.js` | Adds `createVideoDetector`, `onHandResults`, the raw-frame branch in `recordingToFeatureRows` and `meta` in `saveGestureSample`. Removes the live-capture path, the G hotkey and the toast. |
| `js/gesture-training-ui.js` | Removes the old countdown, MediaRecorder, preview, zoom/pan, `hookStartRecording`, `onGestureCapture*` and the Save/Retry wiring (`:1229-1502`). The Start button handler becomes "open recording mode". Sample line wording for the new button. |
| `gesture-training.html` | Removes Finish, the Landmark-frames card, `#step1PreviewControls` and `#countdownOverlay`. Renames Start. Adds the recording-mode overlay markup and the 3 new `<script>`s. Cache-bust `gesture-training.css?v=1.0.7`. |
| `css/gesture-training.css` | Removes the unused `.tr-preview-*`, `.tr-countdown-*`, `.tr-cap-btn(s)` and `.tr-lm-fill/.tr-lm-bar`. `.tr-lm-card` and `.tr-lm-status` are still used by View Dataset. Adds the `.gc-*` recording-mode styles. |
| `php/api/save_gesture.php` | Raises the frame cap to 301 with a corrected message. Stores the v3 metadata and format tag. The video branch is untouched. |
| `docs/system/UI.md`, `BACKEND.md`, `DECISIONS.md`, `DEBT.md`, `INVENTORY.md`, `MANUAL-CHECKS.md` | Documents the phase. New DEBT item: the display-clip code in `save_gesture.php` is dead for the new flow and goes with the caricature feature (decision 8). DEBT 69 (the G-hotkey Type bug) is closed by removal. DEBT 26 is updated. `MANUAL-CHECKS.md` gets **one appended** check (the owner's uncommitted edits are kept). |

**New**

| File | Why |
|---|---|
| `js/capture-core.js` | Constants and the pure segmenter, shared by live and offline. |
| `js/video-landmarks.js` | Blob/File → raw frames (the import tool reuses it). |
| `js/gesture-capture-ui.js` | The full-screen record → review → process → save mode. |
| `tests/video-capture/segmenter.test.mjs` | The 6 required cases plus MIN_REP blip and live/offline parity. |
| `tests/video-capture/feature-rows.test.mjs` | Golden check: all current samples give identical rows, v3 frames normalize, empty frames are skipped. |
| `tests/video-capture/save-raw.test.mjs` | Endpoint: v3 accepted and metadata stored, 301 frames OK, 302 rejected, v2 unchanged, no file created in `assets/signs/`. Uses `zz` labels and runs serially (DEBT 66). |
| `tests/video-capture/e2e.page.md` or `.mjs` | The fake-camera end-to-end script and how it was run. |
| `docs/reports/2026-09-26-video-capture-final.md` | The final report. |

**Not changed**
- `knnPredict`, `cosineSimilarity`, `trainModel` and
  `mergeSavedGestureSamples`: they still receive 126-float rows.
- Steps 2–4; `talk.html` and all `js/talk-*.js`; `js/sign-to-text-ui.js`;
  `reports.html`.
- The DB schema.
- `assets/signs/**`, existing `saved_gestures*/**` files, `archive/**`.
- `docs/revision/MEMORY.md` and the owner's existing
  `MANUAL-CHECKS.md` edits.

---

## (g) Task list

1. **Core segmenter.** Add `js/capture-core.js` and
   `tests/video-capture/segmenter.test.mjs`.
   *Done when:* `node --test` passes these cases: exactly 3 reps; a blip
   < 300 ms ignored; an in-rep gap < 1000 ms that does not split a rep; a rep
   over 20 s → `rep-too-long`; 2 reps → `too-few-reps`; 4 reps →
   `too-many-reps`; a hand present from the start (no initial rest); a
   trailing-edge `finish()`. Feeding the same sequence incrementally and in
   batch gives identical reps.
2. **Load-time normalization.** Add the raw branch in
   `recordingToFeatureRows`, plus `tests/video-capture/feature-rows.test.mjs`.
   *Done when:*
   - the rows for all 210 current sample files are identical, element for
     element, between the pre- and post-change `gesture-data.js`;
   - a v3 frame gives `flattenLandmarks` of its hands' landmarks in stored
     order;
   - 0-hand frames give no row.
3. **Server.** Raise the cap and store the v3 metadata in
   `save_gesture.php`, plus `save-raw.test.mjs`.
   *Done when:* the new test passes, the existing
   `tests/multi-sample/save-endpoint.test.mjs` and
   `tests/categorization/*.test.mjs` still pass (serial run), and a v2 POST's
   stored file is unchanged in shape.
4. **Extractor and detector.** Add `js/video-landmarks.js`, plus
   `createVideoDetector` / `onHandResults` in `gesture-data.js`.
   *Done when:* in headless Chrome, both WebMs from the spike (with and
   without cues) extract 180 frames at 15 fps; two runs give identical
   frames; the live loop resumes afterwards; an aborted run revokes its URL.
5. **Recording-mode UI.** Add `js/gesture-capture-ui.js` and the markup and
   CSS, and remove the old Step 1 capture/preview code, the G hotkey and the
   toast.
   *Done when:* every state in (e) can be reached; at 1024×600 there is no
   horizontal scroll, every control is ≥ 44×44, and nothing overlaps; pressing
   G does nothing and no "Press G" toast appears; 0 console errors.
6. **End-to-end with the fake camera.** Chromium runs with
   `--use-fake-device-for-media-stream
   --use-file-for-fake-video-capture=<y4m>` and
   `--use-fake-ui-for-media-stream`. The y4m is built with the repo's
   `ffmpeg.exe` from a real signing clip: 3 reps with 1.5 s gaps, 320×240,
   not committed.
   *Done when:*
   - START → the guidance advances by hand presence → auto-stop → the review
     shows 3;
   - I-save → 3 new v3 sample files on disk and 3 `gesture_recordings` rows;
   - Ulitin and Cancel send no request with video (network log);
   - an `assets/signs/` listing is identical before and after;
   - Train AI and Predict work with mixed v2+v3 samples;
   - 0 console errors;
   - the processing time and the size of one saved sample are measured.

   The test samples are deleted afterwards.
7. **Docs.** Update UI/BACKEND/DECISIONS/DEBT/INVENTORY, add the manual check,
   and write the final report.
   *Done when:* `git diff --stat` matches (f).

Execution follows the owner's Step 2 instructions:
subagent-driven-development, a task review after each task (at most 3
rounds, then escalate), and a whole-phase review on the most capable model.
Nothing is pushed or merged.

---

## (h) Open questions (recommended default first)

- **Q1. What does the review count mean?**
  - Decision 5 gates I-save on "exactly 3 reps found", and decision 6
    extracts only on I-save. The live recording only auto-stops after its
    live segmenter has counted 3, and a too-long rep never reaches review
    (3c). So the count shown at review is always 3, and the I-save gate is
    effectively always open.
  - **Default:** keep the order as settled. The review shows the live count.
    The real gate is the offline re-segmentation on I-save, which refuses to
    save and offers Ulitin (5a) when it disagrees.
  - (The alternative, extracting before review, would reverse decision 6, so
    it is only listed here.)
- **Q2. Does the PAHINGA after a rep need an extra `REST_MS`?**
  **Default: no.** The `REST_MS` no-hand gap that ends a rep already is the
  rest, so "ULIT n+1" is prompted straight away and the final stop comes
  `REST_MS` (+ tail) after the last hand.
- **Q3. `STOP_TAIL_MS` = 500 ms.** Live time and video time differ slightly,
  so without a tail the offline pass can see the last rep end a few ms
  *after* the video ends, and count 2.
  **Default:** keep recording 500 ms after the live segmenter says `done`.
  `finish()` closes a rep only when its trailing no-hand time is at least
  `REST_MS`.
- **Q4. Round the stored coordinates?**
  **Default: yes, to 4 decimals** (score to 3). At 320 px width, 0.0001
  normalized ≈ 0.03 px, far below MediaPipe's own jitter. It halves the
  compact GET payload: 29,543 → 14,762 B for the measured rep, table in (c).
  This reduces the payload growth that DEBT 63 already warns about.
  Full precision is also acceptable if the owner wants fully raw data.
- **Q5. What does "video width/height" mean?**
  **Default:** store the recording's native `videoWidth`/`videoHeight`
  **and** the 320×240 letterboxed input plus its `contentRect`. The
  landmarks are normalized to that canvas, and it is the same input the live
  classifier sees (`gesture-data.js:374-398`). Imports with other aspect
  ratios need the rect to be interpreted later.
- **Q6. A hint when hands stay up during PAHINGA?** Not in the decisions.
  **Default: yes.** Use the same `NO_HAND_HINT_MS` with "Ibaba muna ang mga
  kamay." Otherwise a user who never lowers their hands sees no feedback.
- **Q7. Cancel during processing.**
  **Default:** abort. Reps already POSTed stay saved (there is no delete
  endpoint for a single sample), and the toast says how many were saved.
- **Q8. Remove the old live-capture code outright, or keep it unused?**
  **Default: remove it.** That covers `startRecording`, `stopRecording`,
  `confirmAndSave`, `discardCapture`, the preview panel and zoom/pan: no
  other page calls them (grep: only `gesture-training.html`,
  `gesture-data.js` and `gesture-training-ui.js`; `diagnostic.html` only
  uses `loadGestureDatasetForTraining`). Keeping them would leave the G path
  and the video-upload path reachable in code.

Known risks, not questions:
- The new flow sends no video, so **new labels get no display clip** and
  Reports → View Asset shows nothing for them. This is accepted by decision
  8; a DEBT item will be logged.
- **Payload growth.** Every v3 sample enlarges the dataset GET that both
  `gesture-training.html` and `talk.html` load at startup. Q4 halves it.
  Keyframes and a compact model file are the later fix.
- **Pi timing is unmeasured** for both live guidance and processing. MediaPipe
  on the Pi at `modelComplexity: 1` may run live guidance at a low rate. The
  time-based thresholds tolerate that, but a sparse detection rate makes the
  300 ms `MIN_REP_MS` blip filter coarse.
