Phase: bulk import, dynamic repetition split (bulk-reps-fix)
Date: 2026-10-16
Status: DONE
Decision needed from owner: none to finish. Run the laptop test in section 3 and send back what it asks for. Nothing here was run in a browser, on PHP or on a database.

# Bulk import: dynamic repetition split — report

Branch `bulk-reps-fix`, made from `revision`. Two commits: code, then docs. Nothing was merged. No video
and no `saved_gestures` data was committed.

**What was tested here.** Only node unit tests on synthetic per-frame data:
`node --test --test-concurrency=1 tests/bulk-import/core.test.mjs tests/bulk-import/rep-split.test.mjs`
gave **74 tests, 74 pass** (52 old core tests, 22 new split tests). This container has no XAMPP, MySQL,
php-cgi, `E:\` drive or videos. So the page, the PHP endpoint and the DB were **not** run. Your laptop
test (section 3) is the first real run.

## 1. What changed, file by file

| File | Change |
|---|---|
| `js/bulk-rep-split.js` (new, 315 lines) | The dynamic rep splitter. Pure code: no page, no server, no clock. Every threshold is in `SPLIT` (`:21-47`). Section 2 explains it. |
| `js/bulk-import-core.js` | New helpers (`:254-306`). `cacheState()`: is a cached video `old`, `resplit` or `current`. `importIdSourceV2()`: a sample's id now includes where the rep is in the video. `splitStatus()`: OK or problem, with the split's reasons. `budgetRows()`: Compile's 90-rows-per-sign rule, used for the Review estimate. Old functions are unchanged, so the 52 old tests still pass. |
| `js/bulk-import-ui.js` | **Extract:** the reps come from the new splitter, not from the live segmenter (`handsPass()`, `splitOf()` `:780`). Cache version 2: `hands.json` keeps **every frame** of the video, and the meta keeps the split (`buildMeta()` `:858`). A video cached by the old version is read again. A version-2 video split with older thresholds is split again from its cached frames, without reading the video (`planWork()` `:726`, `processVideo()` `:917`). New **Stop** button (`stopRun()` `:1200`). **Review:** reads the summary listing, then the rows in `labels=` batches, like Compile (`loadReviewData()` `:1457`, `loadRowCounts()` `:1505`). New estimate by the compile rule (`computeTotals()` `:1684`). New pieces: a split timeline per video (`drawTimeline()` `:1831`), a header checkbox, the buttons Select all / Select all problems (reps found) / Clear (`selectRows()` `:1760`), a choice on problem rows (`setMode()` `:1746`), and "replaces N old samples". **Import:** steps record → save → remove old → record (`recordImported()` `:2138`, `runImport()` `:2157`). The summary counts replaced samples and reminds you to Compile ESL and FSL. Two stale line citations were fixed (DEBT 127). |
| `php/api/save_gesture.php` | New POST action `delete_import_samples` (`:450-487`): `{label, importIds:[1..20]}`. It removes `saved_gestures/<label>/sample_i<id>.json` and its `gesture_recordings` row: the same two steps as `delete_gesture`, but only for imported samples, which are the only files named `sample_i…`. The sign, its `sign.json`, its other samples and its `gestures` row stay. A file already gone counts as "missing", not as an error. |
| `bulk-import.html` | Loads `js/knn-compile.js` and `js/bulk-rep-split.js`. New Stop button. New select-button row with a colour legend, a header checkbox and a "Split" column in the Review table. New "Old samples replaced" counter. The reminder now reads "Now run Compile on Train Gestures (Step 2) for ESL and for FSL." |
| `css/bulk-import.css` | Styles for the select buttons, timeline, legend and per-row choice. Cache-bust `?v=1.0.6`. |
| `tests/bulk-import/rep-split.test.mjs` (new) | 22 node tests on synthetic videos. |

**Not changed:** live capture (`js/capture-core.js` `REST_MS: 1000` at `:11`, `js/gesture-capture-ui.js`),
`knnPredict`, `cosineSimilarity`, `recordingToFeatureRows`, `js/knn-compile.js` (only loaded and called),
the model format, the v2/v3 sample formats (an import still sends the same v3 fields), the avatar code,
Let's Talk, `archive/**`, `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md`.

### How each owner decision is covered

1. **Dynamic rep detection.** `BulkRepSplit.splitReps()`: see section 2. Live capture keeps its own segmenter.
2. **Timeline per video.** Review column "Split". Top band: the rest score of each frame. Bottom band: the
   numbered reps that would be imported. Hover (or a screen reader) gives it in words, for example
   "rep 1 0.3–2.1 s, rep 2 3.1–4.8 s, rep 3 5.7–7.5 s. Cut at the rests at 2.2 s (0.8 s, hand lowered) and
   4.9 s (0.7 s, no hand). Video 7.6 s."
3. **Problem rows.** A select under the reason: "the N reps found" / "split into 3 equal parts" / "skip".
   The checkbox and the select stay in step.
4. **Re-segment from the cache.** A version-2 cache holds every frame, so a threshold change (bump
   `SPLIT.VERSION`) splits again from the cache. Old (version-1) entries hold only the reps' frames, so
   they are read again. The cache version went from 1 to 2 (`META_VERSION`, `js/bulk-import-core.js:257`);
   an old split is never reused without notice. The Review marks such rows "extracted by the old
   importer" or "split with older settings", and they cannot be imported until Start runs.
5. **Selection.** Header checkbox (every importable row under the current filter), **Select all** (every
   importable row; a problem row imports what its select says, "reps found" unless you changed it),
   **Select all problems (reps found)**, **Clear**. The Import button text updates:
   "Import 26 videos (78 samples, replaces 39 old samples)".
6. **Stop.** Pauses and opens Review with the videos done so far. Resume on Extract carries on later.
7. **Re-import replaces.** See "Sample identity" below.
8. **Review opens with the full dataset.** The statuses need only the summary listing (file names, no
   frames). The rows per sample for the estimate are read afterwards, in batches of at most 60 samples or
   200 signs per request (`REVIEW_BATCH_SAMPLES`, the same as `COMPILE_BATCH_SAMPLES`,
   `js/gesture-training-ui.js:794`). They are remembered per file for the page load, so after an import
   only the changed signs are read again. Until they are in, the estimate box shows "Reading the saved
   samples for the estimate… x of y signs". Import does not wait for it. The estimate now uses the
   compile rule: at most 90 rows per sign (`Core.budgetRows`, tested equal to `KnnCompile.selectSignRows`
   on 12 cases).
9. **Reminder.** The summary has a line "Next: Compile ESL and Compile FSL on Train Gestures (Step 2)",
   and the reminder card was reworded the same way.

### Sample identity (decision 7)

- A rep's sample id is now SHA-256 of `name|size|repIndex|startMs-endMs` (`importIdSourceV2`). The same
  split gives the same ids, so re-importing adds 0 (the server answers "duplicate"). A different split
  gives new ids.
- Old samples of the same file are found in two ways: by the old id formula `name|size|1..5`, and by the
  video's cache record `meta.imported`. Import writes that record **before** saving and narrows it after.
- Those found on disk that the new split does not produce are "old samples". Import removes them only
  **after** every new rep is saved. A pause in between loses nothing: the next Review shows the same
  "replaces N", and importing again only removes them.
- One special case: a rep identical to one the old version saved (same index, start and end) keeps its
  old id. So a clean 3-rep video that the old segmenter split correctly reads "already imported".

## 2. How the dynamic split works, and where to tune it

All thresholds are in `SPLIT`, `js/bulk-rep-split.js:21-47`. **After changing any of them, raise
`SPLIT.VERSION` (`:22`) by 1.** Then press Start on Extract once: every cached video is split again
from its cached frames in a few ms each (measured: 1.9 ms for a 1,350-frame video in node), and no
video is read again.

**Step 1 — a class and a rest score for every frame** (`frameTrack()` `:65`, `classify()` `:92`). It uses
the raw MediaPipe landmarks, before any normalisation: fractions of the 320x240 input picture, y grows
downwards. For each frame it takes the y of the highest wrist (landmark 0) of the visible hands.

| Class (profile char) | When | Rest score |
|---|---|---|
| `3` no hand | no hand detected | `DEPTH_NO_HAND` 1.0 |
| `2` lowered | highest wrist y ≥ lowLine | `DEPTH_LOWERED` 0.8 |
| `1` still and low | wrist y ≥ halfLine **and** wrist speed < `STILL_SPEED` 0.25 picture heights/s (median of 3 frames) | `DEPTH_STILL_LOW` 0.6 |
| `0` signing | anything else | 0 |

The signing zone is learned from each video (`:99-106`):

- signY = the `SIGN_LEVEL_PCT` 0.35 percentile of the highest wrist's y over the hand frames;
- hand length = the median wrist → middle-knuckle distance, at least `MIN_HAND_SIZE` 0.04;
- lowLine = signY + `LOW_DROP_HANDS` 1.5 hand lengths. When that falls below `BOTTOM_Y` 0.9, lowLine is
  0.9 or signY + 0.75 hand lengths, whichever is lower down;
- halfLine = signY + `HALF_DROP_HANDS` 0.75 hand lengths;
- with fewer than `MIN_HAND_FRAMES` 8 hand frames, no zone is learned and only "no hand" counts as rest.

A static letter held still at signing height is never rest: the "still" rule needs the hand to be low too
(tested).

**Step 2 — rest runs** (`restRuns()` `:131`). Consecutive rest frames form a run. A signing blip of up to
`GAP_MS` 140 ms (2 frames at 15 fps) inside a run is bridged. Each run gets:

- depth = the mean rest score of its frames;
- strength = depth × min(1, length / `FULL_REST_MS` 600 ms).

So 1 s with no hand scores 1.0, and 300 ms with the hand lowered scores 0.4. A run touching the first
(or last) frame is the leading (or trailing) rest. A run with no rep of at least `MIN_REP_MS` before it
(or after it) joins that rest (`:207-209`). That way a moment of noise at the start is not a cut.

**Step 3 — choose the 2 cuts** (`:213-240`). Every pair of runs of at least `MIN_REST_MS` 200 ms is tried.
For each pair:

- the 3 reps are trimmed to their first and last signing frame, so rest frames are cut off each rep;
- each rep must last at least `MIN_REP_MS` 300 ms;
- score = strength 1 + strength 2 + `BALANCE_WEIGHT` 1.0 × (shortest rep / longest rep).

The best score wins. With no usable pair it tries 1 cut (2 reps), then none (1 rep). The first rep may
start at frame 0, and the last rep ends at the end of the video when no rest follows it.

**Step 4 — confidence** (`:247-264`). The row is a problem row, and says why, when any of these holds:

- fewer than 3 reps: "found 2 repetitions, need 3 (only 1 usable rest)";
- a chosen cut weaker than `WEAK_CUT` 0.35: "no clear rest between reps 2 and 3: 4.1 s (0.3 s, hand
  nearly still and low)";
- shortest / longest rep below `MIN_BALANCE` 0.5: "reps of very different length (0.6 s, 3.0 s, 0.6 s)";
- an unused run at least `RIVAL_RATIO` 0.9 × the weaker cut (and ≥ `WEAK_CUT`): "another rest as clear as
  the chosen ones at … : more than 3 reps?".

**What each threshold does, if a test result looks wrong:**

| Symptom on the laptop | Try |
|---|---|
| Lowered-hand rests not found (many "found 1/2 repetitions") | Lower `LOW_DROP_HANDS` (1.5 → 1.2) or `HALF_DROP_HANDS`; raise `STILL_SPEED` (0.25 → 0.35) |
| Cuts inside a sign (a rep cut in half; signs that move down) | Raise `LOW_DROP_HANDS`; lower `STILL_SPEED`; raise `MIN_REST_MS` (200 → 300) |
| Too many problem rows for "no clear rest" although the split looks right on the timeline | Lower `WEAK_CUT` (0.35 → 0.25) or `FULL_REST_MS` (600 → 400) |
| "reps of very different length" on videos that look fine | Lower `MIN_BALANCE` (0.5 → 0.4) |
| "more than 3 reps?" on videos with exactly 3 | Raise `RIVAL_RATIO` (0.9 → 1.0) |

Each problem row's reason and timeline show what the splitter saw. The cache meta also keeps the rest runs
(`meta.split.rests`, the 12 strongest) and the learned zone (`meta.split.zone`) per video, in
`bulk_import_cache/videos/<id>.meta.json`.

**Sizes (measured with synthetic frames, 4-decimal landmarks):** one 2-hand frame is 1,591 bytes of JSON,
a 1-hand frame 808. A 90 s all-2-hand video's `hands.json` is about 2,147,850 bytes. That is under the 8 MB
`put_video` limit (`php/api/bulk_import.php:15`). A version-2 `hands.json` is larger than a version-1 one,
because it holds every frame, not only the reps'.

## 3. TEST CHECKLIST (laptop)

**Before you start:** XAMPP Apache and MySQL running. Leave the laptop idle and plugged in.

1. Get the branch:
   ```
   cd <the repo>
   git fetch origin
   git checkout bulk-reps-fix
   ```
   (`C:\xampp\htdocs\SKR` points at the repo, so Apache serves this branch at once.)
2. Open `http://localhost/SKR/bulk-import.html` in Chrome and press Ctrl+F5 once (new scripts). Enter the PIN.
3. **P01 letters** — choose `E:\ACADSS\IOT\SK_DATASETS\P01_Rhaiza\ESL\letters`.
   - Step 1: 26 videos. The "already extracted" count includes the old cache entries.
   - Extract: the table says "extracted by the old importer: Start reads it again". Press **Start**. All 26
     are read again (about 1.1–1.2 × each video's length, as before).
   - Look at the **Reps** column: it should be **3** for most videos. "3 ?" or another number means a
     problem row (hover for the reason).
   - Review:
     - each row has a small **timeline**: 3 coloured numbered blocks with grey rests between them;
     - rows imported before say "OK — replaces N old samples";
     - the Import button reads "Import … (… samples, replaces … old samples)". With 3 reps in every
       video, up to 78 new samples replace up to 39 old ones. A video the old version already split into
       exactly the same 3 reps reads "already imported" instead, and keeps its samples.
   - Try the **header checkbox**, **Select all**, **Select all problems (reps found)**, **Clear**: the
     Import button count must follow.
   - On a problem row, switch the select to **split into 3 equal parts**: the timeline changes to 3 equal
     blocks.
   - Press **Import**. The summary shows "Old replaced" per sign and the line "Next: Compile ESL and
     Compile FSL…".
   - Open Review again: every imported row reads "already imported". Import adds 0 (re-import of the same
     split).
4. **P03 letters** — choose `SK_DATASETS\P03_Janel\ESL\letters`.
   - Check that P03 is ticked under "Signers used for recognition". It should be, being the only signer in
     the folder (`pickList()` falls back to the signers found when the remembered list has none of them).
   - Press Start. While it runs, press **Stop**: it pauses and opens Review with the videos done so far.
     Those rows can be imported; the rest read "not extracted yet".
   - Go back to Extract and press **Resume** to finish. Check the reps and the timelines as for P01.
5. **P05 words** — choose `SK_DATASETS\P05_Lhorwin\ESL\words` (check that P05 is ticked for recognition).
   - Words are longer and often two-handed: look at the problem rows here especially.
6. After the imports, open Train Gestures and **Compile ESL**, then **Compile FSL**. The status line should
   no longer say "out of date".

**Send back if something looks wrong:**

- For each folder: how many videos showed 3 reps, how many were problem rows, and the reasons shown (a
  screenshot of the Review table, filter "Problems", is enough).
- For 2–3 videos where the split is wrong (a timeline that cuts inside a sign, or misses a rest):
  - the file name;
  - what is wrong ("rep 2 contains reps 2 and 3", "cut in the middle of the sign at about 3 s");
  - the file `bulk_import_cache\videos\<id>.meta.json` of that video. Find it by its `"file"` name inside;
    it holds `split.rests`, `split.zone` and `split.profile`, which is enough to tune the thresholds
    without the video.
- Any red message on Extract, Review or Import, and any console error (F12 → Console).
- The time the Review step took to show its table and its estimate with all three folders imported.

## 4. What I could not finish

- **No browser, PHP or DB run.** As instructed. The page, the new `delete_import_samples` action and the
  Review batches are untested until your laptop run. The PHP was only checked with `php -l` (no syntax
  errors).
- **Thresholds are untested on real videos.** They were chosen from your description (rests of about
  1 s, hand lowered or out of the picture) and checked on synthetic frames only. Expect to tune them once
  (section 2 table).
- **The old browser checks were not updated.** They encode the old cache format and texts, and they need
  XAMPP and a browser, so they will now fail in places:
  - `tests/bulk-import/extract-check.mjs`: version-1 `hands.reps`, `seg.reason 'too-few-reps'`;
  - `tests/bulk-import/import-flow-check.mjs`: "found 2 repetitions, need 3" and "import the 2
    repetitions found";
  - `tests/bulk-import/verify-e2e.mjs`: the old segmentation on the synthetic folder.
  They were written for the old segmenter and are listed in `docs/system/DEBT.md` item 142.
- **The PHP node tests** (`save-import.test.mjs`, `cache-endpoint.test.mjs`) need php-cgi, which this
  container lacks: they failed here before and after the change (same failures). No test was added for
  `delete_import_samples`.
- **The avatar candidate after re-extraction.** A video re-extracted from a version-1 cache keeps its
  avatar candidate only if its old split was the 3 clear reps. Otherwise the candidate is made again from
  the new best rep, for avatar signers only. This was not exercised.
- **Old samples saved before this change with a split the old version did not record.** They are found
  only by the old id formula (`name|size|1..5`). That covers every sample the old importer could save:
  more than 5 reps was never seen.
