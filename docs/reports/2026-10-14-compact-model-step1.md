Phase: compact recognition model
Date: 2026-10-15
Status: WAITING FOR APPROVAL
Decision needed from owner: approve the row rule in section 2.5 (a per-sign row budget of 90, instead of a fixed keyframe count per sample, because every fixed count I measured loses more than 2 points), plus the defaults in section 7.

# Compact recognition model — Step 1

Everything below was measured on this laptop. Nothing ran on the Pi.

- Browser numbers come from headless Chrome. Accuracy runs used the kiosk's own `knnPredict` and
  `cosineSimilarity` text, copied unchanged from `js/sign-to-text-ui.js:193-243` and run in node.
- The scripts and raw outputs are in `.git/sdd/cm-step1/` (not tracked).
  - Accuracy: `eval.mjs`, `rules.mjs`, `summary-all.txt`.
  - Timing: `bench.mjs`, `bench-*.txt`.
  - Load: `loadbench.mjs`, `loadbench.txt`.
  - Before: `baseline.mjs`, `baseline.txt`.
  - Float32/int8: `quant.mjs`, `quant.txt`.
- No product file was changed.

## 1. Summary

1. **Today's data has 1 sample for 119 of 122 signs.** Only `hi` and `yow` (3 v3 samples each) and
   `start` (2 v2 samples) can be left out one repetition at a time. Leave-one-repetition-out (test (a))
   therefore covers 8 queries. I added two larger test sets from what exists (section 2.2).
2. **A fixed keyframe count per sample loses accuracy on today's data.** Every count from 3 to 20 rows
   per sample loses more than 2 points on at least one test set. Smarter selection does no better
   than even spacing. The losses are worst for phrases.
3. **The cost problem is rows per sign, not rows per sample.** Today a sign has 9–90 rows. After a
   bulk import with 8 signers a sign has up to about 745 rows. I propose a **per-sign budget**: a sign
   keeps every row it has today until it holds more than 90 rows. Above that, each of its samples keeps
   `floor(90 / samples)` evenly spaced rows.
   - On today's data the rows are unchanged, so accuracy is unchanged.
   - Projected rows: ESL 10,196 with 2 signers and 9,164 with 8. The same data with today's rule:
     24,007 and 89,887.
4. **Format:** one binary file per language, `models/knn_ESL.bin` and `models/knn_FSL.bin`.
   - Contents: a JSON header, then Float32 rows.
   - Today: 1.03 MB (ESL), 0.71 MB (FSL). Projected for ESL: 5.14 MB with 2 signers, 4.62 MB with 8.
   - Float32 gave the same top-1 as today's JSON numbers on all 5,010 test queries.
5. **Load:**
   - Today: Let's Talk downloads 3.48 MB and takes 799–995 ms with no cache. FSL is never cached
     (754–1,142 ms on every switch).
   - Proposed, measured with prototype files: a cold load of today's model fetches in 25–29 ms. A cached
     load is a HEAD request (5–8 ms) plus an IndexedDB read (3–4 ms). Both languages are cached.
6. **Prediction time per call, this laptop:** 2.0–3.5 ms today. With the budget, 10.6–12.8 ms for 8
   signers and 16.1–24.9 ms for 2 signers. Without it, 30–48 ms and 125–180 ms. The Pi is not measured;
   section 4 gives the script for later.

## 2. Accuracy (decision 5)

### 2.1 Where the data stands (measured)

`GET save_gesture.php?no_sync=1` returned 3,481,109 bytes:

- 122 signs: 33 ESL, 89 BOTH, 0 FSL.
- 127 samples, of which 6 are v3.
- Categories: 26 letters, 10 numbers, 69 words, 17 phrases.
- Samples per sign: 1 sample for 119 signs, 2 for 1 (`start`), 3 for 2 (`hi`, `yow`).
- Model rows today: ESL 2,047 rows / 122 labels; FSL 1,414 rows / 90 labels (read from the live
  `knnModel` in `talk.html`).

### 2.2 Test sets

| Set | Model built from | Queries | Size |
|---|---|---|---|
| T1 leave-one-repetition-out | all samples except the held-out one | that sample's hand rows | 8 samples (hi ×3, yow ×3, start ×2) |
| T2 sign videos | today's samples, rule applied | the hand frames of each sign's display video `assets/signs/en/<key>.webm` (number videos `1`..`10` mapped to `one`..`ten`) | 120 videos (ESL model), 90 (FSL model) |
| T2r reverse | the same 120 videos, extracted like a v3 sample, rule applied | every hand row of today's 127 samples | 121 samples |
| T3 new signer | today's samples | the 3 repetitions of your one real test video (`Downloads\Avatar\videos\`), split by the importer's segmenter | 3 repetitions (48 / 48 / 42 rows) |

- **How the videos were extracted.** I used the live capture's own extractor
  (`VideoLandmarks.extractVideoLandmarks` on the shared Hands instance, through
  `tests/video-capture/extractor.page.html`): about 2 s per clip, 121 clips plus the real video.
- **Why the Filipino videos are not used.** `assets/signs/fil` holds byte-identical copies (for example
  `kamusta_ka.webm` and `how_are_you.webm` have the same md5).
- **T2 is not a new signer.** The display videos show the person who recorded the samples, probably in
  the same session. Whether a video is the same take as its sample is not known, but it is not a copy
  of the training rows: today's model gets only 62.3% of its frames right.
- **No leave-one-signer-out set exists yet.** T3 is a real new signer, but the sign is unknown. All
  3 repetitions are predicted `n` (40/48, 42/48, 35/42 frames). The video shows a raised closed fist;
  there is no `yes` sign in the dataset. **Which sign is it?** (question Q1). Until then T3 only shows
  that every rule gives the same answer.

**Scores.**
- "Vote" means a query is correct when most of its frames are predicted as its sign. This is closest to
  the kiosk, which smooths over several frames (`js/talk-signing.js:154-165`).
- "Frame" means the share of single frames predicted correctly.

### 2.3 Results (ESL model; T2 FSL = the FSL model on the 90 Both-sign videos)

| Rule | Rows ESL | T2 vote | T2 frame | T2 FSL vote | T2r vote | T2r frame | T1 frame | T1 vote |
|---|---|---|---|---|---|---|---|---|
| **current** (v2 as stored, v3 ≤30 even) | 2,047 | **85.8** | 62.3 | 83.3 | **86.8** | 66.8 | 78.2 | 6/8 |
| no cap (every hand frame) | 2,166 | 85.8 | 62.2 | 83.3 | 87.6 | 67.7 | 81.0 | 6/8 |
| long-sign cap (v3: max(30, 10 rows/s), ≤90) | 2,081 | 85.8 | 62.3 | 83.3 | 86.8 | 67.1 | 79.6 | 6/8 |
| 5 rows/s (v3, 10–60) | 1,968 | 85.8 | 62.6 | 83.3 | 74.4 | 55.0 | 76.1 | 6/8 |
| **budget 90 / sign (proposed)** | 2,047 | 85.8 | 62.3 | 83.3 | 86.8 | 66.8 | 78.2 | 6/8 |
| budget 60 / sign | 1,987 | 85.8 | 62.3 | 83.3 | 86.8 | 66.8 | 78.2 | 6/8 |
| budget 30 / sign | 1,908 | 85.8 | 63.0 | 83.3 | 86.8 | 66.8 | 76.1 | 6/8 |
| even 20 / sample | 1,892 | 85.0 | 61.7 | 83.3 | 83.5 | 64.0 | 77.0 | 6/8 |
| even 15 / sample | 1,685 | 80.8 | 59.6 | 80.0 | 84.3 | 59.9 | 76.1 | 6/8 |
| even 12 / sample | 1,456 | 75.8 | 55.4 | 73.3 | 81.0 | 56.8 | 76.4 | 6/8 |
| even 10 / sample | 1,249 | 71.7 | 52.0 | 71.1 | 74.4 | 53.8 | 77.6 | 6/8 |
| even 8 / sample | 1,010 | 60.8 | 42.8 | 55.6 | 58.7 | 43.4 | 78.4 | 6/8 |
| even 5 / sample | 632 | 30.8 | 23.8 | 26.7 | 34.7 | 26.8 | 66.1 | 5/8 |
| trim 200 ms + even 10 / 15 | 1,249 / 1,685 | 71.7 / 80.8 | 51.9 / 59.6 | 71.1 / 80.0 | 71.9 / 82.6 | 51.9 / 58.5 | 78.2 / 76.4 | 6/8 |
| centred even 10 / 15 / 20 | 1,249 / 1,685 / 1,892 | 72.5 / 81.7 / 85.0 | 51.2 / 59.2 / 61.7 | 71.1 / 80.0 / 83.3 | 74.4 / 81.0 / 83.5 | 52.7 / 60.4 / 64.1 | 77.6 / 76.7 / 77.3 | 6/8 |
| farthest-point 10 / 15 | 1,249 / 1,685 | 65.8 / 79.2 | 47.7 / 57.3 | 61.1 / 77.8 | 64.5 / 77.7 | 46.3 / 58.0 | 80.5 / 79.6 | 6/8 |
| k-medoids 10 / 15 | 1,249 / 1,685 | 66.7 / 80.8 | 47.7 / 57.6 | 62.2 / 77.8 | 67.8 / 77.7 | 47.1 / 58.0 | 80.7 / 79.6 | 6/8 |
| k-medoids, 3 rows/s (8–20) | 1,034 | 50.0 | 39.4 | 47.8 | 52.9 | 40.1 | 81.3 | 6/8 |

**Per category, vote %.** T2 counts in brackets; T2r has 26 letters, 10 numbers, 68 words and
17 phrases.

| Rule | T2 letter | T2 number | T2 word | T2 phrase | T2r letter | T2r number | T2r word | T2r phrase |
|---|---|---|---|---|---|---|---|---|
| current | 96.2 (25/26) | 100 (10/10) | 80.6 (54/67) | 82.4 (14/17) | 100 | 100 | 79.4 | 88.2 |
| no cap | 96.2 | 100 | 80.6 | 82.4 | 100 | 100 | 80.9 | 88.2 |
| long-sign cap | 96.2 | 100 | 80.6 | 82.4 | 100 | 100 | 79.4 | 88.2 |
| budget 90 | 96.2 | 100 | 80.6 | 82.4 | 100 | 100 | 79.4 | 88.2 |
| even 20 / sample | 96.2 | 100 | 80.6 | **76.5** | 100 | 100 | 77.9 | **70.6** |
| even 15 / sample | 96.2 | 100 | 79.1 | **52.9** | 100 | 100 | 80.9 | **64.7** |
| even 10 / sample | 88.5 | 100 | 67.2 | **47.1** | 92.3 | 100 | 70.6 | **47.1** |

(`summary-all.txt` has every rule by category.)

### 2.4 What the numbers say

- **A fixed keyframe count per sample loses more than 2 points**, for every count up to 15, on both
  large sets. At 20 per sample the loss is 0.8 points on T2 but 3.3 on T2r, and phrases lose 5.9
  (T2) and 17.6 (T2r) points.
  - The reason is in `knnPredict` itself: a sign scores the mean of its 5 best rows. With one sample
    per sign, fewer rows means fewer close matches.
  - At 5 rows per sample it collapses (30.8%): the "5 best" are then all the rows, the hand's
    entering and leaving frames included.
- **Smarter selection does not help.** Farthest-point and k-medoids keep the outlying poses and score
  worse than even spacing. Trimming 200 ms at the ends (DEBT 88) and centred spacing are within about
  1 point of even spacing.
- **The 30-row cap does not hurt phrases** on these sets.
  - It only applies to v3: 10 of the 17 phrase videos have more than 30 hand frames (13–64, median 31).
  - On T2r, phrases score 88.2% with the cap, without any cap, and with the long-sign cap.
  - No cap gains 0.8 points overall (one word) for 6% more rows.
  - **Recommendation: keep 30 per sample.** I see no measured reason for a length-based cap.
- **Most confused pairs, current rule:**
  - T2 frames: `which`→`live` 20, `how`→`which` 17, `help`→`help_me_practice_please` 16,
    `time`→`what_time_is_it` 14, `excited`→`happy` 11, `live`→`which` 11, `what_time_is_it`→`time` 11,
    `when`→`month` 10, `q`→`p` 9, `night`→`afternoon` 9.
  - Phrase ↔ word, wrong votes on T2: `help`→`help_me_practice_please`, `time`↔`what_time_is_it`,
    `nice_to_meet_you`→`meet`, `see_you_later`→`yow`.
  - Phrase ↔ word, wrong votes on T2r: `are_you_hearing`→`hearing`, `excited`→`im_excited`,
    `what_time_is_it`→`time`.
  - **"how are you" vs "how":** `how_are_you` is voted correctly in both sets, but 4 of its frames go
    to `how` on T2r. `how` itself is voted `which` in both sets (17 and 13 frames). There is no `you`
    sign in the dataset.
  - These pairs share a handshape, and a single frame cannot tell them apart. The keyframe rule does
    not cause them: they are the same under every rule that keeps 20 or more rows.
- **T1 (8 samples)** is 6/8 under every rule from 8 rows up. Both `start` samples fail with every
  rule: they do not match each other (votes `year`, `im_excited`).

### 2.5 Recommendation: per-sign budget, B = 90

The rule:

- Each sample first gets today's rows: v2 as stored, v3 at most 30, evenly spaced (unchanged
  `recordingToFeatureRows`, `js/gesture-data.js:735-758`).
- A sign whose rows total 90 or less keeps them all.
- Otherwise each of its samples keeps `max(3, floor(90 / samples))` rows, evenly spaced as today.
- It is still a per-sample keyframe count (decision 2), but the count follows how many samples the sign
  has. With 1–3 samples nothing changes; with 25 samples it is 3 per sample.

| | today | 2 signers | 8 signers |
|---|---|---|---|
| ESL rows, current rule | 2,047 | 24,007 | 89,887 |
| ESL rows, budget 90 | 2,047 | 10,196 | 9,164 |
| FSL rows, budget 90 | 1,414 | 7,507 | 6,752 |
| ESL rows, 20 per sample | 1,892 | 16,532 | 60,452 |

How the projection was made:

- The 2 and 8 signer columns add 3 bulk samples of 30 rows per signer to every sign in the model
  (the DEBT 116 basis).
- 8 signers gives fewer rows than 2: with 25 samples a sign keeps 25 × 3 = 75 rows, with 7 samples
  7 × 12 = 84.
- Budgets 60 and 120 are in `.git/sdd/cm-step1/`. Budget 120 gives ESL 14,140 / 12,218 rows and
  23–37 ms per call.

What this does and does not prove:

- **Today:** accuracy is unchanged by construction (the rows are identical).
- **Many samples per sign:** not measured, because no such data exists yet. 3 evenly spaced rows from
  each of 25 repetitions, by 8 people, is a different regime from today's 1 sample per sign.
- I therefore propose an accuracy script that runs leave-one-signer-out on the real data (Task 2),
  run it after the first real import, and keep B as a Compile setting stored in the file:
  - if B = 90 loses more than 2 points against "no budget", raise B to 120;
  - if that still loses, re-plan before the kiosk gets bulk data.

## 3. Today's code: where samples are downloaded and the model is built

### 3.1 Download

| Where | What |
|---|---|
| `js/gesture-data.js:686-696` `loadSavedGestureDataset(noSync)` | `GET php/api/save_gesture.php` (full sync) or `?no_sync=1`: every sample with every frame (3,481,109 bytes today). Also fills `state.signs` and the categories. |
| `js/gesture-data.js:735-758` `recordingToFeatureRows` | v2 rows as stored; v3: hand frames, at most 30 (`MAX_ROWS_PER_RAW_SAMPLE`, `:4`) evenly by index. |
| `js/gesture-data.js:763-780` | `recordingsToTrainingRows` and `loadGestureDatasetForTraining`: rows with the sign's set. |
| `js/sign-to-text-ui.js:101-191` `mergeSavedGestureSamples` (talk.html) | `loadGestureDatasetForTraining(true)` (no_sync). It keeps ESL/BOTH or FSL/BOTH, plus `start`/`stop` in both (`:118`). It rebuilds the cache when the row count differs. |
| `js/gesture-training-ui.js:722-787` `mergeSavedGestureSamples` (Train Gestures) | Full-sync GET. Same filter without the `start`/`stop` exception (`:744`). |
| `js/gesture-training-ui.js:504-513` `renderSavedDataset` | **A second full GET** for the Step 1 dataset table. |
| `js/gesture-training-ui.js:1438-1468` | Page load: cached model, then both GETs above. |
| `js/gesture-training-ui.js:1419-1435` `reloadDataset` | After a save: one `no_sync` GET shared by both. |
| `js/bulk-import-ui.js:1302-1311` | The Review step's full listing (laptop only; must not change). |

### 3.2 Build and cache

| Where | What |
|---|---|
| `js/sign-to-text-ui.js:306-315` `autoTrainForTranslate` | Called by `js/talk-loader.js:57` (queue item "gestures") and by `js/talk-signing.js:220-227` `loadModel` (language switch, `setLang` `:229`). Uses the localStorage cache, else builds from the database. |
| `js/sign-to-text-ui.js:245-271` / `:273-304` | `loadKnnFromCache` / `buildKnnFromDatabase`. Writes `sining_kamay_knn_<L>` and `sining_kamay_labels_<L>`. On quota failure it only warns. |
| `js/gesture-training-ui.js:789-929` `trainModel` | The "Train Gesture" button (`gesture-training.html:281`, Step 2). **Incremental:** it adds only labels that are not yet cached (`:859`, `:886-892`). A new sample of a sign already in the model is never added until the cache is cleared. Compile replaces this. |
| `js/gesture-training-ui.js:690-718`, `:666-680` | `loadKnnFromCache`, and the Step 2 ESL/FSL toggle. |
| `js/gesture-training-ui.js:378-384` | The Step 2 summary card's "NEW" badges, from `sining_kamay_trained_labels_<L>`. |
| `js/gesture-data.js:15-24` | One-time reset of the six localStorage keys (schema "2"). |
| `knnPredict` calls | `js/talk-signing.js:149` (every 150 ms, `TICK_MS` `:17`), `js/gesture-training-ui.js:1001` (Steps 3/4), `js/sign-to-text-ui.js:461`. |

### 3.3 What the kiosk pages need from it

- `knnModel = {label: [126-float rows]}`, `activeLabels`, `activeFeatureSize = 126` and
  `modelTrained = true`.
- The sign texts come from `signs.php` (`GestureDataRecorder.loadSigns`, `js/gesture-data.js:713`). They
  are not part of the model.
- Train Gestures also needs per-label counts for the Step 2 card and the Step 1 dataset table. These are
  names and counts, not frames.

### 3.4 Before (measured, 3 runs each, `baseline.txt`)

| Page | Downloads | Time |
|---|---|---|
| talk.html, no cache | `save_gesture.php?no_sync=1` 3,481,409 B + `signs.php` 18,675 B | "gestures" item 799 / 803 / 995 ms |
| talk.html, ESL cached | `signs.php` only | 47 / 56 / 72 ms; localStorage holds 3,443,720 chars for ESL and 0 for FSL |
| talk.html, switch to FSL (never cached) | 3.48 MB again | 754 / 826 / 1,142 ms |
| gesture-training.html load | 2 × 3,481,409 B (full sync) + `signs.php` | first GET 8,624 ms once, then 1,278–1,613 ms |

## 4. Prediction time per call, this laptop (decision 5(d))

`knnPredict` and `cosineSimilarity` unchanged, in headless Chrome. Synthetic models of 122 labels are
built from today's real rows. Each figure is the median over 60 queries after 10 warm-up calls; the
range is over 3 to 6 runs.

| Model | Rows | Plain arrays | Float32Array views |
|---|---|---|---|
| FSL today | 1,414 | 2.5–2.6 ms | 3.3–3.5 ms |
| ESL today | 2,047 | 2.0–3.5 ms | 3.0–5.6 ms |
| ESL budget 90, 8 signers | 9,164 | 10.6–12.8 ms | 14.0–18.7 ms |
| ESL budget 90, 2 signers | 10,196 | 16.1–24.9 ms | 20.5–26.1 ms |
| ESL current rule, 2 signers | 24,007 | 30.3–47.9 ms | 30.0–64.4 ms |
| ESL current rule, 8 signers | 89,887 | 125.4–179.7 ms | 125.0–183.9 ms |

- Every run gave the same top-1 label with plain arrays and with Float32Array views.
- Plain arrays were as fast or faster in most runs. The proposal converts rows to plain arrays at load:
  50–75 ms at 10–15k rows, 11–16 ms today (`loadbench.txt`).
- The node figures in `ML.md` (53–62 ms at 87,840 rows) are lower than headless Chrome's on this
  machine. The timings also drifted upward during the session (machine load, DEBT 123), hence the ranges.

**Pi script (Task 7, written now, run later by you):**

- `tests/compact-model/pi-bench.sh` opens `tests/compact-model/bench.html` in Chromium with the kiosk
  flags, the same way `tests/avatar/pi-bench.sh` does.
- It prints `COMPACT_BENCH {json}` and saves `~/compact-bench-<date>.json`.
- It measures:
  - `knnPredict` per call on the real `models/knn_ESL.bin` and `knn_FSL.bin`, and on synthetic models
    of 2,047 / 9,164 / 10,196 / 14,140 / 24,007 / 89,887 rows, with plain arrays and Float32 views;
  - cold load (fetch + decode + IndexedDB write) and cached load (HEAD + IndexedDB read + decode) of
    both files.
- It needs no camera and does not touch the kiosk profile.
- What to compare it against: at a 150 ms tick, `knnPredict` must stay well under 150 ms. MediaPipe also
  runs on the same CPU, and its Pi cost is not measured either.

## 5. Model file format, size, load (decision 3)

`models/knn_<LANG>.bin`, little-endian:

| Bytes | Content |
|---|---|
| 0–3 | `SKKN` |
| 4–5 | format version (1) |
| 6–7 | dtype: 1 = Float32 (3 = int8 reserved, not used) |
| 8–11 | header length H |
| 12 … 12+H | UTF-8 JSON header |
| padding | zeros to a multiple of 4 |
| rest | `rowCount × 126` Float32, label by label in header order |

The JSON header holds:

- `formatVersion`, `lang`, `buildDate`, `builtOn: "laptop"`;
- `rule {name: "sign-budget", budget: 90, maxRowsPerSample: 30, spacing: "even"}`, `dims: 126`, `dtype`;
- `sampleCount`, `rowCount`, and `fingerprint` (section 6);
- `labels: [{key, set, category, textEn, textFil, samples, rows}]`. The texts are only a fallback, for
  signs the Pi has no database row for (section 6.4).

**Why Float32 and not int8 (`quant.txt`):** on 5,010 queries (T2 and T2r frames), Float32 gave the same
top-1 as today's JSON numbers 5,010/5,010, with a largest confidence difference of 2.8e-9. int8 changed
5 answers and is 4× smaller. At about 5 MB on localhost the size does not matter, and decision 4 asks
for the same answer.

**Measured with prototype files (`loadbench.txt`, 3 runs, served by Apache):**

| File | Bytes | Fetch | Decode + plain arrays | IndexedDB put | HEAD | IndexedDB get |
|---|---|---|---|---|---|---|
| today ESL f32 | 1,035,016 | 25–29 ms | 11.5–16.5 ms | 6–9 ms | 5–8 ms | 3–4 ms |
| 10,980 rows f32 | 5,536,996 | 56–74 ms | 51–75 ms | 20–28 ms | 5–6 ms | 9–11 ms |
| 14,640 rows f32 | 7,381,760 | 67–70 ms | 67–71 ms | 23–28 ms | 5 ms | 15–19 ms |
| 89,887 rows f32 (current rule, 8 signers) | 45,306,248 | 285–352 ms | 461–489 ms | 126–166 ms | 6–10 ms | 69–117 ms |

The table has no 9,164 or 10,196 row file: those rows were only timed for `knnPredict` (section 4).
The 10,980-row file brackets them.

- **Sizes:** ESL today 1.03 MB, budget 90 5.14 MB (2 signers) / 4.62 MB (8). FSL today 0.71 MB,
  3.78 / 3.40 MB. Both computed as 504 bytes per row plus the header.
- **Storage:** the header JSON is a few kilobytes and not measured yet. After caching all six test
  files, `navigator.storage.estimate()` reported a quota of 10,278 MB. The Pi's quota is not measured.

## 6. Compile, cache, "out of date", the Pi (decisions 1, 3, 6, 7, 9)

### 6.1 Compile (laptop, Train Gestures Step 2)

The existing button becomes **Compile** for the language chosen in the existing ESL | FSL toggle. A
status line per language shows "ESL model: 2,047 rows, built <date> — up to date" or **"Model out of
date: run Compile"**.

Compile does this:

1. A full-sync `GET save_gesture.php`, the same as today.
2. Rows through the unchanged `recordingToFeatureRows`.
3. Membership: `set === L || set === 'BOTH' || start/stop`. This is talk.html's rule; Q4 covers the
   difference from Train Gestures.
4. The budget rule, then the binary built in the browser.
5. `POST php/api/compile_model.php?lang=L`, with the raw body.
6. PHP checks the magic, version, lang and length, writes `models/knn_L.bin.tmp`, then renames it.
   Writing a temporary file first means the kiosk never reads a half-written file.
7. The page then loads the file through the same loader the kiosk uses, so a broken file shows at once.

Building in the browser keeps one implementation of the feature rows. A PHP copy would need a
parity test forever.

`trainModel`'s incremental merge and the three localStorage keys per language are retired. The schema
key goes to "3", which removes the old keys once and frees 3.4M characters.

### 6.2 Kiosk load and cache (talk.html, Train Gestures Steps 3/4)

A new `js/knn-model-store.js` provides `loadModel(lang)`:

1. `HEAD models/knn_L.bin` (`cache: no-store`).
2. If IndexedDB (`sining_kamay_models`, key `L`) holds a copy with the same ETag and length, decode that
   copy.
3. Otherwise GET the file, check it (magic, version, `rowCount × 126 × 4` equals the body length), and
   store it.
4. If the HEAD or GET fails, or the new file does not decode, the stored copy is used: **the kiosk
   keeps the last good file** (decision 7). It logs a `console.warn`.
5. If there is no stored copy either, the existing "model unavailable" path runs.

Then:

- `autoTrainForTranslate` keeps its name and callers. Only its inside changes: it fills
  `knnModel`/`activeLabels` from the file. `knnPredict`, `cosineSimilarity` and the Let's Talk UI do
  not change.
- `buildKnnFromDatabase` and the sample download are removed from the kiosk path.
- The ESL and FSL files are cached separately, so both stay cached.
- Apache's ETag changes when the file's mtime changes, for example after a `git pull`. That causes at
  most one extra download.

### 6.3 "Out of date" (laptop only)

- The **fingerprint** is a SHA-256 over the sorted lines `label|set|sampleFile` of the samples in that
  model. Category and texts are left out: they do not change recognition.
  - Sample files are write-once (`sample_<ms>_<hex>.json`, `sample_i<id>.json`), so names are enough.
  - The browser computes it at Compile from the listing it used. `php/api/model_status.php` computes
    it from disk with a glob (no file reads besides `sign.json`). A parity test checks that both agree.
- **Out of date** means: no file, a different fingerprint, or an older format or rule version.
- `model_status.php` also returns the device:
  - `php_uname('m')` is `aarch64` or `armv7l` on the Pi, and `AMD64` here. See Q5.
  - On the Pi it never reports out of date, because the Pi lacks the bulk samples by design.

### 6.4 How the Pi gets the model without the bulk samples (decision 6)

- **The files.** `models/knn_ESL.bin` and `knn_FSL.bin` are tracked in git and reach the Pi the way the
  rest of the repo does. They are two plain files, easy to copy on their own later. Add
  `.gitattributes`: `models/knn_*.bin binary` (`core.autocrlf` is `true` here; no `.gitattributes`
  exists yet).
- **Keeping bulk samples off the Pi.** Imported samples are named `sample_i<importId>.json`
  (BACKEND.md). Proposed: git-ignore `saved_gestures/*/sample_i*.json`. Then they are never committed,
  so they cannot reach the Pi by git (Q2). Live-recorded samples stay tracked, as today.
  - The catch: imported samples are then backed up only by the laptop disk and `E:\ACADSS\IOT\backups\`.
- **On the Pi:**
  - Compile is disabled with: "Build the model on the laptop, then copy models/knn_ESL.bin and
    models/knn_FSL.bin to the Pi."
  - Recording on the Pi still saves samples. They enter the model only after the laptop compiles.
- **Signs that exist only through bulk import** have no database row on the Pi: their folder has no
  tracked sample, and the sync skips folders without samples. Their text therefore comes from the
  model header. `getSignText` uses the database first, then the header.
- **Train Gestures without raw samples.** The Step 1 dataset table and the Step 2 card need names and
  counts only. A `GET save_gesture.php?summary=1` (the same listing without `frames`) serves them.
  Train Gestures then never downloads frames except for Compile.
  - This touches `save_gesture.php`'s GET, not the sample format.
  - `bulk-import`'s own listing stays as is (must not change).

## 7. Files, tasks, open questions

### 7.1 Files

- **New:**
  - `js/knn-model-store.js` (format, IndexedDB, loader), `js/knn-compile.js` (rule, encoder,
    fingerprint; browser + node);
  - `php/api/compile_model.php`, `php/api/model_status.php`;
  - `models/knn_ESL.bin`, `models/knn_FSL.bin`, `.gitattributes`;
  - `tests/compact-model/` (unit tests, accuracy script, browser checks, `bench.html`, `pi-bench.sh`).
- **Changed:**
  - `js/sign-to-text-ui.js`: `autoTrainForTranslate` and the load and cache functions only;
  - `js/talk-loader.js`: adds the store script to `SIGN_SCRIPTS`;
  - `js/gesture-training-ui.js`: Step 2 Compile and status, load through the store, Step 1 from
    `?summary=1`;
  - `gesture-training.html`: button text, status line, script tag;
  - `js/gesture-data.js`: schema "3" reset, header texts as fallback in `getSignText`;
  - `php/api/save_gesture.php`: the `summary` GET option only;
  - `.gitignore` (if Q2 is yes);
  - tests that read `sining_kamay_knn_*`: `tests/sign-texts/verify-e2e.mjs`, `dataset-check.mjs`,
    `gesture-data-signs.test.mjs`, `tests/video-capture/capture-ui-check.mjs`,
    `tests/bulk-import/import-flow-check.mjs`. They are updated only where they assert the old cache,
    and each change is listed in its task.
- **Docs:** `CLAUDE.md`, `docs/system/ML.md`, `UI.md`, `BACKEND.md`, `DECISIONS.md`, `DEBT.md` (closes
  94 and 116 for the kiosk path; 88 accepted as measured; new items), `INVENTORY.md`,
  `HARDWARE_BOOT.md` (model files).
- **Not touched:**
  - `knnPredict`, `cosineSimilarity`, `recordingToFeatureRows`;
  - the capture flow, the v2/v3 formats, `bulk-import*`, the avatar, the Let's Talk UI;
  - `archive/**`, your uncommitted `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md`.

### 7.2 Tasks (each: one implementer, review, at most 3 rounds)

0. **Backup.** `saved_gestures` copy plus mysqldump to `E:\ACADSS\IOT\backups\2026-10-15-compact-model\`.
   *Done when:* file counts and dump size are recorded.
1. **`js/knn-compile.js`.** Membership, budget rule, encoder/decoder, fingerprint.
   *Done when:* node tests pass:
   - rows on today's data are identical to the current model (2,047 / 1,414);
   - encode → decode round trip exact;
   - `knnPredict` gives the same top-1 on the 5,010 queries;
   - the budget rule matches section 2.5 on synthetic 2 and 8 signer data.
2. **`tests/compact-model/accuracy.mjs`.** T1/T2/T2r from section 2, plus leave-one-signer-out by the
   v3 `signer` field.
   *Done when:* today's "current" and "budget 90" give the section 2.3 numbers, and the LOSO path is
   tested on a synthetic two-signer dataset.
3. **`compile_model.php` + `model_status.php`.** Validation, temp file + rename, fingerprint, device.
   *Done when:* php-cgi tests pass: refuses bad magic, length, lang, oversize; atomic write;
   fingerprint equals the JS one on today's data; ARM is reported as Pi.
4. **`js/knn-model-store.js`.**
   *Done when:* a browser check passes:
   - cold load writes IndexedDB;
   - a reload uses the cache (one HEAD, no GET);
   - both languages are cached;
   - a changed file is re-downloaded;
   - a corrupt or missing file falls back to the cached copy;
   - no file and no cache fails cleanly.
5. **Kiosk wiring** (`sign-to-text-ui.js`, `talk-loader.js`, Train Gestures Steps 3/4, `getSignText`
   fallback, schema "3").
   *Done when:* the network log of talk.html and Steps 3/4 shows no `save_gesture.php` request; Predict
   and Let's Talk recognise with the file; 0 console errors at 1024×600.
6. **Compile UI + `?summary=1`** (Step 2 button and status, out-of-date line, Pi warning, Step 1 from
   the summary).
   *Done when:* Compile writes both files; a new sample flags "out of date"; a Pi-faked status disables
   Compile with the warning; the Step 1 table and counts are unchanged.
7. **`bench.html` + `pi-bench.sh`.**
   *Done when:* it runs on this laptop and prints `COMPACT_BENCH` with the section 4 fields.
8. **Commit the model files and `.gitattributes`/`.gitignore`.**
   *Done when:* `git check-attr` reports binary, and an imported-sample name is ignored (if Q2 is yes).
9. **Whole-phase review, then the verification list** (accuracy before/after, network log with sizes,
   prediction and page-load times, both languages cached, Compile → fresh browser → Predict and Let's
   Talk, stale flag, all existing tests, 0 console errors at 1024×600), then docs, then the final report.

### 7.3 Open questions (my default in bold)

1. **Q1. Which sign is in your real test video?** **Default: unknown.** T3 stays a consistency check
   until real signers are imported. Then Task 2's leave-one-signer-out is the real test.
2. **Q2. Git-ignore `saved_gestures/*/sample_i*.json`** so imported samples never reach the Pi through
   git? **Default: yes.** Backups stay on the laptop.
3. **Q3. Budget value.** **Default: 90** (no change today). Re-measure with leave-one-signer-out after
   the first real import, and raise it to 120 if 90 loses more than 2 points.
4. **Q4. The FSL model includes `start`** (talk.html's rule today; Train Gestures' FSL model leaves it
   out). **Default: include it in both files.**
5. **Q5. Pi detection** by `php_uname('m')` (ARM = Pi). **Default: yes,** with a git-ignored
   `config/device.txt` to override it if needed.
6. **Q6. The Pi's Compile button:** disabled, or a warning with "Compile anyway"? **Default: disabled**
   (decision 9: the kiosk never compiles).
7. **Q7. `bulk-import.html`'s Review estimate** (rows and ms per prediction) still uses today's 30-row
   rule, and bulk import must not change. **Default: leave it,** and record it as a DEBT item: the
   estimate overstates rows once the budget applies.
