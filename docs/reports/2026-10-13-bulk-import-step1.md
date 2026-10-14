Phase: bulk video importer (laptop only)
Date: 2026-10-13
Status: WAITING FOR APPROVAL
Decision needed from owner: (1) how many signers' samples go into recognition, because the full import makes live recognition about 45x slower (section 2); (2) approve two small endpoint changes (section 4); (3) the task prompt arrived cut off after "Must NOT change … the v2/v" — please resend the rest; (4) questions Q1–Q10.

# Bulk video importer — Step 1 proposal

Nothing was built. No file in the repo changed except this report. A throw-away probe page ran from
`C:\xampp\htdocs\bulk-probe\` (outside the repo) and was deleted.

Numbers are measured on this laptop in headless Chrome unless a line says "projection". A projection is
arithmetic from a measured value and your stated size (about 120 signs x 8 signers = 960 videos).

## 1. Summary

- The importer can be built as you decided, with one design change forced by a measurement: MediaPipe
  Hands and Holistic cannot simply share a page (section 3).
- Your one sample video in `Downloads\Avatar\videos\` (1280x720, 17.8 s) works with the existing
  segmenter unchanged: exactly 3 reps found (section 3).
- **The main problem is not the importer. It is what the import does to the kiosk** (section 2). I need
  your decision on it before building.
- The task prompt was cut off in the "Must NOT change" list. This proposal assumes the same list as the
  last phase. If the missing part names other files or a verify list, I will revise.

## 2. Decision needed: the full import would make recognition too slow

Decision 5 says every signer and every repetition becomes a recognition sample. Measured consequences:

| | Today | After a full import (projection) |
|---|---|---|
| Samples | 127 (`saved_gestures`, 7.0 MB) | 127 + 2,880 (960 videos x 3 reps) |
| Training rows in the model | 2,047 (median 14 per sign) | about 87,840 (122 signs x 8 x 3 x 30 rows) |
| One `knnPredict` call | 35 ms median | 1,580 ms median, 2,669 ms worst |
| Dataset download on each page load (`save_gesture.php?no_sync=1`) | 3.48 MB, 2.3 s | about +109 MB (2,880 x about 38 KB) |
| Model cache in `localStorage` | does not fit both languages already (DEBT 94) | cannot fit (projection: about 150 M characters against a quota of about 5.2 M; today's ESL cache is 3.59 M for about 2,000 rows, DEBT 94) |

How these were measured:

- **Rows per imported sample: 30.** Your sample video gave reps of 48, 48 and 42 frames. A v3 sample is cut
  to at most 30 rows at load (`js/gesture-data.js:4`, `:746-752`).
- **Sample size:** the three reps' frames were 39,528 / 39,510 / 33,930 bytes.
- **`knnPredict` time:** the function's own source from `js/sign-to-text-ui.js:193-243`, run unchanged in
  node on this laptop, on a 122-sign model of today's size and of the projected size. The cost grows in
  step with the row count.
- **Why it matters:** Let's Talk predicts every 150 ms (`js/talk-signing.js:17`). At 1.6 s per call on a
  laptop the loop cannot keep up. The Pi is slower and is not measured.

`knnPredict`, `cosineSimilarity` and `trainModel` must not change, so the importer cannot fix this.
The options:

- **A. Limit which signers feed recognition (recommended).** The review screen gets a "Signers used for
  recognition" list, default the first 2 signers found. Every video still gives an avatar candidate.
  Projection for 2 signers: about 24,000 rows, about 430 ms per prediction on this laptop. That is still
  12x today, so I would start with 1–2 signers, measure on the Pi, then add more.
- **B. Import everything as decided, and accept the result.** I do not recommend this without a Pi
  measurement first.
- **C. Import everything, and plan a separate phase that makes the model lighter** (the "keyframes phase"
  already named in DEBT 88). Until that phase lands, the kiosk would be slow.

Whatever you choose, the review screen will show the projected row count per model before Import.

## 3. What the probe measured

| Question | Result |
|---|---|
| Do Hands and Holistic run on one page? | **Only with care.** `js/gesture-data.js:206-225` patches `WebAssembly.validate` to force non-SIMD (a Pi fix). After that, the SIMD-only Holistic refuses to start (`NO_SIMD`). It works when Holistic is initialised **before** Hands is set up (0 console errors, both gave results), and it works in two iframes. |
| Segmenter on your sample video (17.8 s, 3 reps) | `ok`, 3 reps: 1.53–4.67 s, 6.93–10.07 s, 12.13–14.87 s. 138 of 267 frames had a hand. |
| Segmenter on `my_name_is.mp4` (one take, no rest) | `too-few-reps`, 0 reps. This is the expected problem row. |
| Holistic on your sample video | 445 frames, pose in 445, right hand in 237–238, left hand in 0. The existing auto-trim spans all three reps (frames 35–435), so a candidate needs a per-rep trim (section 5). |
| Hands pass time | Sample video: 38.7 s and 60.6 s (2.2x–3.4x the video length). `my_name_is.mp4`: 54–57 s (5.3x–5.6x). |
| Holistic pass time | Sample video: 162 s and 241 s (9x–14x). `my_name_is.mp4`: 138–175 s in the probe, against 60–66 s on `avatar-clips.html` (`admin-check.mjs`). |
| Running both passes at once | 168 s against 195 s one after the other: a 14% gain, not worth the complexity. |

Two things follow:

- **Extraction is slower than the 6x you quoted.** One 17.8 s video took 200–300 s for both passes in
  the probe. Projection for 960 such videos: 53–80 hours. At the faster rate seen on `avatar-clips.html`
  it is about 38 hours. I could not establish why the probe was slower; finding the fastest page setup
  is the first build task. Resume (decision 10) is essential either way.
- **Both passes are needed.** Samples must come from the Hands pipeline at 15 fps, exactly as a live
  capture, and clips from Holistic at 25 fps. Holistic's hands are a different model with no handedness
  score, so they cannot stand in for Hands.

## 4. Two endpoint changes I need you to approve

Decision 4 says the import goes through the existing endpoints. Two things do not fit without a change:

1. **`php/api/save_gesture.php` drops unknown fields.** A v3 sample keeps only a fixed list
   (`:556-579`), so the signer ID (decision 5) and the import hash (decision 11) would be lost.
   - Proposed: accept two optional fields for v3, `signer` (`P01`–`P99`) and `importId` (hex), and store
     both in the sample file.
   - With an `importId`, the file is named `sample_i<importId>.json`. If it already exists, the endpoint
     answers success with `duplicate: true` and writes nothing. That makes import idempotent on the
     server, with no scan. Every reader matches `sample_*.json`, so the name is compatible.
   - A live capture sends neither field and behaves exactly as today.
2. **The cache and the candidates need somewhere to live.** New `php/api/bulk_import.php`, files only, no
   database: read and write JSON under a new git-ignored folder `bulk_import_cache/`.

No schema change is needed.

## 5. Design

**Pages and files**

- `bulk-import.html`: PIN pad (same PIN, same 10-minute unlock as Avatar clips), then four steps: Folder →
  Extract → Review → Import. No kiosk page links to it. It shows "laptop only" when SIMD is missing.
- `bulk_import_cache/` (git-ignored, laptop only):
  - `videos/<hash>.json`: one finished video. Hash of name + size + modified time (decision 10).
  - `candidates/<key>/<SIGNER>.json`: one `sk_avatar_clip_v1` clip per sign and signer.
  - `picks.json`: which signer each sign's clip came from, and whether it was picked by hand.

**Step by step**

1. **Folder.** `<input type="file" webkitdirectory>` reads the folder and its subfolders; nothing is
   uploaded. Each name is parsed as `<SET>_<label>_<SIGNER>.<ext>`. A name that does not match is a
   problem row. The label goes through the same `cleanLabel` rule (`js/gesture-data.js:112-119`).
2. **Extract**, one video at a time: the Hands pass (`VideoLandmarks.extractVideoLandmarks` with
   `createVideoDetector`, the live capture's own code), then `GestureCaptureCore.segmentFrames` with its
   constants, then the Holistic pass (`AvatarExtract`, unchanged). The result is written to the cache at
   once. Progress, ETA from the measured rate so far, Pause / Resume. Pause aborts the video in progress;
   Resume restarts that one video.
3. **Best repetition (decision 7).** For each rep, the Holistic frames between the middle of the rest
   before it and the middle of the rest after it are trimmed with the existing `AvatarClip.autoTrim`.
   The best rep is the one with the most frames that have a pose and every needed hand. A hand is
   "needed" when Holistic saw it in at least half of that video's rep frames. Ties go to the earlier rep.
4. **Review.** One row per video: file, sign, set, signer, reps found, status, checkbox. Filters: All /
   Problems / New signs.
   - A new sign shows editable draft texts.
   - A video with a rep count other than 3 is a problem row with two choices: import the reps found, or
     skip (decision 6).
   - A label that exists with another set is a problem row and cannot be imported.
5. **Import.** For each checked video, one POST per rep to `save_gesture.php`: `formatVersion 3`,
   `source "video-import"`, `repIndex`, `signer`, `importId`, and the same size and input fields as a
   live capture. The model cache is then invalidated the same way a live capture does it
   (`js/gesture-capture-ui.js:694-707`).
6. **Summary (decision 12).** Samples added per sign, new signs, duplicates skipped, a per-sign sample
   count with a warning for a sign below half the median, and the Compile reminder for ESL and FSL.
7. **Default signer (decision 8)**, on the same page after import: Default signer, priority list, "Keep
   signs I picked by hand" (on), Apply to all signs. The chosen candidate is saved through
   `avatar_clip.php`. The summary lists signs per signer, fallbacks, no clip, and left alone.
8. **Per-sign override (decision 9)** on `avatar-clips.html`: a "Candidates" panel for the selected sign
   lists its signers with Preview and "Use this", and marks the sign as picked by hand.

**Details that differ from what you might assume**

- **A new sign's key is always the file's label.** The sign is created with the label only, then its
  edited texts are set through `signs.php` `update`. If the texts were sent with the sample,
  `save_gesture.php` would derive the key from the text (`:440`), and an edited text could create a
  different key than the file name.
- **A sign that already has a clip but no entry in `picks.json` counts as picked by hand.** It was made on
  Avatar clips from a video or a JSON.
- **Compile alone does not add new samples of a sign that is already compiled.** `trainModel` only adds
  labels missing from the cached model (`js/gesture-training-ui.js:858-889`). This is why the importer
  invalidates the cache, as the live capture does.

**Recording rules the group must follow** (from the segmenter, `js/capture-core.js:10-21`, unchanged):

- At least 1 s with no hand detected before the first sign, between signs, and after the last sign.
- Each sign between 0.3 s and 20 s. The whole video under 90 s for samples, and under 60 s for an avatar
  candidate (`js/avatar-extract.js:15`).
- "Rest" means the hand is **not detected**. In your sample video the hands left the picture between
  signs. Hands held still but visible may still be detected; that is not measured.

## 6. Files

- **New:** `bulk-import.html`, `css/bulk-import.css`, `js/bulk-import-core.js` (pure: name parsing, sign
  mapping, best rep, default-signer assignment, imbalance), `js/bulk-import-ui.js`,
  `php/api/bulk_import.php`, `tests/bulk-import/*`.
- **Changed:** `php/api/save_gesture.php` (section 4), `avatar-clips.html`, `css/avatar-clips.css`,
  `js/avatar-clips-ui.js` (Candidates panel), `.gitignore`, and the system docs.
- **Not touched:** `knnPredict`, `cosineSimilarity`, `trainModel`; the live capture flow
  (`js/gesture-capture-ui.js`, `js/capture-core.js`, `js/video-landmarks.js`, `js/gesture-data.js`); the
  v2/v3 formats and every existing sample; the extractor, retargeting, timeline, renderer and player;
  Let's Talk; `archive/**`; your uncommitted `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md`.

## 7. Tasks

0. Backup (`saved_gestures` copy and a mysqldump) and the test baseline.
1. Throughput: find the fastest page setup for the two passes and record the rates.
2. `js/bulk-import-core.js` with unit tests.
3. `save_gesture.php` (`signer`, `importId`, duplicate answer) with endpoint tests, including a check
   that every existing sample file stays byte-identical.
4. `bulk_import.php` and the cache folder, with endpoint tests.
5. `bulk-import.html`: Folder, Extract, resume, Pause.
6. Review, Import, Summary.
7. Default signer, and the Candidates panel on `avatar-clips.html`.
8. End-to-end check on a small folder built with ffmpeg (zz probe signs), then docs and the final report.

## 8. Verification I plan (all measured)

- A folder of zz probe videos, including a bad name, a 2-rep video, a set collision and a new sign:
  every row gets the expected status.
- Imported samples are v3 with `source "video-import"`, `repIndex`, signer and hash; Train AI and
  Predict work with them mixed with live samples.
- Importing the same folder twice adds 0 samples.
- Closing the tab mid-extraction and reopening the folder skips finished videos.
- No request carries video bytes; every request goes to localhost with other hosts blocked.
- Apply to all signs and the per-sign override produce the expected `avatar.json` and summary; Let's
  Talk plays the chosen clip.
- `bulk_import_cache/` is ignored by git; existing samples are byte-identical; 0 console errors.
- All existing tests still pass; every zz probe is removed.

## 9. Questions (each has a default I will use unless you say otherwise)

- **Q1. Recognition signers** (section 2). Default: option A, 2 signers.
- **Q2. `save_gesture.php` change** (section 4). Default: yes. Without it the signer and the hash
  cannot be stored and the import is not idempotent.
- **Q3. New endpoint `php/api/bulk_import.php` and folder `bulk_import_cache/`.** Default: yes.
- **Q4. Screen size of `bulk-import.html`.** Default: built for the laptop (1366x768), not for 1024x600,
  since the page never runs on the kiosk. `avatar-clips.html` keeps fitting 1024x600.
- **Q5. Imbalance warning.** Default: warn for a sign with fewer than half the median sample count.
- **Q6. "Needed hands" for the best rep.** Default: as in section 5, step 3.
- **Q7. Holistic over the whole video or only around the reps.** Default: the whole video, with the
  extractor unchanged. Only around the reps would save about a quarter of the Holistic time on your
  sample video, but needs a change to `js/avatar-extract.js`.
- **Q8. A video longer than 60 s.** Default: samples are imported, no avatar candidate, and the row says so.
- **Q9. One signer, two videos of the same sign.** Default: both give samples; the later file replaces
  the candidate for that sign and signer.
- **Q10. Display clips.** Default: none. A new sign gets no `assets/signs/` video, as with live capture
  (DEBT 86), so its word shows on the avatar only once it has a clip.
