Phase: video-based gesture capture
Date: 2026-09-26
Status: DONE
Decision needed from owner: 4 decisions and 3 acknowledgements, listed in "Open for the owner" below. Each has a stated default already in the code or docs.

# Video-based gesture capture: final report

Design: `docs/reports/2026-09-26-video-capture-step1.md`, approved with your
answers to Q1–Q8 and additions A/B/C. Step 2 used subagent-driven development:
one fresh implementer per task, a spec-and-quality review after each task, and
a whole-phase review on the most capable model at the end. Nothing was pushed
or merged.

## What changed

gesture-training.html, Step 1 (Add Data):
- **Record 3 samples** opens a full-screen recording mode. It records a video
  while the live camera drives on-screen guidance: **REST**, then **SIGN n of
  3**, three progress dots, a hand indicator, and two hints. Recording stops by
  itself 500 ms after the third sign's rest.
- **Review** plays the recording on a loop, with **Save / Redo / Cancel**.
- **Save** runs MediaPipe Hands over the *recorded* video, one seek per 1/15 s,
  on the page's single shared Hands instance. The same segmenter used for the
  live guidance splits the result into 3 reps.
- The 3 reps are saved as 3 samples in the new raw v3 format. Each frame
  stores its time and, per hand, the handedness label and score plus 21
  image-normalized x/y/z points. Each sample also records the video size, the
  320×240 input size and its content rectangle, and the frame rate.
- Old v2 samples load byte-identically. v3 samples are normalized at load: no-hand
  frames are skipped and each sample is evenly subsampled to at most 30 rows.
- Removed: the live landmark capture path, Finish Capture, the old preview
  panel, the G hotkey and the "Press G" toast.
- `php/api/save_gesture.php` accepts the v3 metadata and allows up to 301
  frames (was 120). Its video code is left in place, unused by the new flow;
  DEBT 86 records that it goes with the caricature feature.

Commits (branch `revision`, base `813bfbe`):

| Commit | What |
|---|---|
| `4c41949` | Task 1: constants and the pure segmenter |
| `4bd75fa` | Task 2: load-time v3 normalization and subsampling |
| `754d245` | Task 3: endpoint v3 metadata and 301-frame cap |
| `527d2d5`, `3c8c19b` | Task 4: extractor and shared-instance detector, plus review fixes |
| `bfe0c14`, `28924ae` | Task 5: recording mode and removals, plus review fixes |
| `26a2a6e` | Task 6: end-to-end verification driver |
| `9a06e71` | Whole-phase review fix: hand-tracking watchdog, tracker reset after release |
| `fa02386` + doc fix | Task 7: docs (UI, BACKEND, DECISIONS, DEBT 86–93, INVENTORY) |
| this commit | Reports and your manual check |

## Verification (measured)

All browser runs used headless Chrome 153 on this laptop at 1024×600. The fake
camera was fed a `.y4m` built from `assets/signs/en/hello.webm`: 3 signs with
black gaps. Source: `tests/video-capture/e2e.mjs`, whose run output is in the
Task 6 report.

| Required check | Result |
|---|---|
| Segmenter unit tests: 3 reps, short blip, gap < REST_MS inside a rep, rep > MAX_REP_MS, 2 reps, 4 reps | Pass. `segmenter.test.mjs` 19/19, which also covers no-rest, `finish()`, live/offline parity and the constants. |
| Full flow: START → guidance advances by hand presence → auto-stop → review shows 3 → Save → 3 samples on disk and in the DB in the new format | Pass. Prompts went REST (+24 ms) → SIGN 1 (+1,145) → SIGN 2 (+4,228) → SIGN 3 (+7,802), following hand presence. Auto-stop at 11,851 ms. Review showed "3 signs found". There were 3 `sample_*.json` files with `formatVersion 3`, `source video-live`, `repIndex` 1/2/3, `fps 15` and rounded coordinates, and 3 `gesture_recordings` rows. |
| Redo and Cancel discard; no request carries video; no new file in `assets/signs/` | Pass. 0 of 31 requests carried `video_base64` or `video_path`, checked at the CDP network level with a post-data fallback. The `assets/signs/` listing (names, sizes, mtimes) was identical before and after. Redo, Cancel at Ready, Cancel during recording and Cancel during processing all sent no save and created no files. |
| Old samples still load; Train AI then Predict work with a mix of old and new | Pass. Golden test: all 210 existing sample files (3,232 rows) are identical to the phase base. Train AI finished with 121 gestures; the new label had 51 training rows (3 reps × 17). Predict ran for 5 s and predicted the new label. |
| No "Press G" toast; pressing G does nothing | Pass. |
| 0 console errors | Pass (MediaPipe's own info/warning logs excluded). |
| `git diff --stat` matches the approved file list | Yes, with 6 extra test files; see below. |
| Processing time for one recording on the laptop | **6,113 ms** (extraction + segmentation) for an 11,851 ms recording. |
| Size of one saved sample | **14,861 / 14,868 / 14,849 bytes** for the three 17-frame reps, stored as compact JSON. |
| Your manual check | Added to `docs/system/MANUAL-CHECKS.md`. |

Other suites, last run on the final code:
- `node --test --test-concurrency=1 tests/video-capture/*.test.mjs`: 45/45.
- `extractor-check.mjs`: 28 pass. On a cue-less, `duration = Infinity` WebM,
  frames = ⌈duration × 15⌉ and two runs gave identical output.
- `capture-ui-check.mjs`: 74 pass. It checks layout in every state, a forced
  save failure then Retry, partial-save Cancel, a real camera track stop, the
  hand-tracking watchdog, and a countdown of 3,047 ms.
- `e2e.mjs`: 52 pass.
- The existing `tests/multi-sample/save-endpoint.test.mjs` and
  `tests/categorization/*.test.mjs`, run serially: pass.

**Pi timing is not measured.** Every time above is from this laptop.

**Diff vs the approved file list (f):** all files listed there were changed as
planned. The tests grew beyond what (f) named:
- `extractor.page.html`, `extractor-check.mjs` and `cdp.mjs`: the headless
  check for Task 4.
- `seek-times.test.mjs`: added after the review found frame-grid drift.
- `capture-ui-check.mjs`: the layout and state check for Task 5.
- `README.md`.

No product file outside the list changed. `assets/`, `archive/`, talk files,
`reports.html` and the DB schema are untouched. Your uncommitted
`docs/revision/MEMORY.md` is untouched. For `MANUAL-CHECKS.md`, only the new
check was committed; your uncommitted edits in that file are still
uncommitted in the working copy.

## Found and fixed during review

- **Extractor frame count.** The seek loop accumulated `t += 1/15`, so a 2 s
  video gave 31 frames instead of 30. It now uses a pure `seekTimes()` grid.
- **Extractor waits could hang.** Seek and duration waits now have a timeout
  and respect abort.
- **Detector release race.** Releasing during an in-flight MediaPipe send could
  route a video frame into the live loop. Release is now deferred until the
  send settles.
- **Sample line after a recording.** It showed double the frame count. It now
  matches the saved samples: 51 = 51.
- **Cancel after a partial save failure.** It left caches and the UI stale.
  It now runs the post-save refresh and toasts "N of 3 samples saved".
- **Camera track ending during recording.** It could reach Review with a partial
  video. It now shows "The camera stopped. Please try again."
- **Whole-phase review: no readiness check.** If hand tracking produced no
  results, the screen sat on REST forever. It now stops after 5 s with "Hand
  tracking is not ready. Please try again." (`RESULTS_WATCHDOG_MS`).

## Open for the owner

Decisions:
1. **v3 samples are stored as compact JSON, not pretty-printed.**
   - Why: a pretty-printed 301-frame sample is about 1.18 MB, which exceeded
     this machine's MariaDB `max_allowed_packet=1M`
     (`C:\xampp\mysql\bin\my.ini:37`), so the `gesture_recordings` insert
     failed. v2 files stay pretty-printed.
   - Alternative: raise `max_allowed_packet` and pretty-print v3 too.
   - The Pi's own `max_allowed_packet` is not known (DEBT 87).
2. **No overall recording-length cap.**
   - Only a single sign is capped (20 s), plus the new 5 s hand-tracking
     watchdog. A take where hands stay up in REST, or nobody signs, runs until
     Cancel.
   - Recommended: add `MAX_RECORDING_MS`, for example 90 s, ending with Redo /
     Cancel. Not added, because you asked for no fixed timers (DEBT 89).
3. **Hand entering and leaving the frame.** A rep runs from the first to the last
   hand-present frame, and the subsampler keeps both ends. Those rows are the
   hand rising into view and dropping out, which can look alike across
   different signs in the k-NN.
   - Recommended: accept this until the keyframes phase, and check Predict with
     v3-only words.
   - Alternative: trim about 150–200 ms at each end now (DEBT 88).
4. **Retry save is not idempotent.**
   - Why: `save_gesture.php` writes the sample file before the DB insert. If
     the insert fails, or the response is lost, a Retry can leave a duplicate
     rep on disk. The write-before-DB order is pre-existing; the new Retry makes
     it reachable.
   - Recommended: leave as is (DEBT 90).

Acknowledgements (small deviations from the brief):

5. **Too-many-signs message.** When a 4th sign starts but doesn't finish, the
   error says "showed 4 signs". The literal count would be 3, which would read
   "3 signs, not 3".
6. **Singular wording.** Review says "1 sign found". This is unreachable in
   practice: Review only opens after 3 signs.
7. **Step 1 instructions.** Bullet 3 was rewritten because it described the
   removed zoom/pan preview.

Also recorded (DEBT 86–93):
- **Pi performance, all unmeasured:** seek cost on VP8 with sparse keyframes,
  the live loop rate while recording, and live vs offline rep agreement within
  the 500 ms tail.
- **New words get no display clip** (decision 8).
- **Wedged detector:** Redo can't recover a live loop left paused by a stuck
  detector; reload the page.
- **Orphan FSL file:** `saved_gestures_fsl/sample_1784112605537_bec003.json` sits
  at the FSL root with no label folder. It predates this phase.
- **Frame count on the sample line:** "(N frames)" counts raw v3 frames, not
  training rows.

Resolved: DEBT 69 (G-hotkey Type bug) by the removal, and DEBT 70 (Type read at
confirm time), because label, set and Type are now captured when the recording
mode opens.

**Never exercised in any automated run:**
- the two 10 s hints;
- a single sign longer than 20 s;
- the 3 s recorder-start timeout.

All three were only code-reviewed. They are good candidates to try while
doing the manual check.
