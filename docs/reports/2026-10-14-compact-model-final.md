Phase: compact recognition model
Date: 2026-10-16
Status: DONE
Decision needed from owner: before re-opening bulk import's Review step after a large import, fix its full listing (it fails at 732 imported samples; DEBT 117). See section 6, item 1.

# Compact recognition model — final report

Plan: `docs/reports/2026-10-14-compact-model-step1.md`, approved with your answers Q1–Q7 and one
addition: tests freeze today's data, and everything must work on any dataset.

Every number below was measured on this laptop. The browser checks ran in headless Chrome at
1024x600. Nothing ran on the Pi. Raw outputs are in `.git/sdd/` (task reports, reviews,
`cm-step1/`).

## 1. What you have now

- **Two model files.** `models/knn_ESL.bin` is 1,045,196 bytes (2,047 rows, 122 signs).
  `models/knn_FSL.bin` is 723,096 bytes (1,414 rows, 90 signs). Each holds a JSON header and Float32
  rows. Git treats them as binary (`.gitattributes`).
- **Let's Talk** (`talk.html`) and **Train Gestures Steps 3/4** load these files. They never request
  `save_gesture.php`.
  - The browser keeps both languages in IndexedDB. Each later load is one HEAD request.
  - If the file is missing or broken, the kiosk keeps using the last good copy it stored.
- **Train Gestures Step 2 is now "Compile"** (pill, button, and Step 1's "Next: Compile →").
  - It builds the file for the ESL or FSL toggle and writes it through `php/api/compile_model.php`.
  - A status line reads one of:
    - "ESL model: 2,047 rows, 122 signs, built … — up to date"
    - "Model out of date: run Compile"
    - "No model file: run Compile"
  - Recording, deleting or editing a sign updates that line.
- **On the Pi**, Compile is disabled. It shows: "Build the model on the laptop, then copy
  models/knn_ESL.bin and models/knn_FSL.bin to the Pi." The Pi is detected by `php_uname('m')`; the
  git-ignored `config/device.txt` (`pi` or `laptop`) overrides it.
- **Imported samples stay off the Pi.** Files named `saved_gestures/*/sample_i*.json` are now
  git-ignored. Signs that exist only through an import get their text from the model header.
- **The row rule (Q3):** a sign keeps all its rows until it has more than 90. Above 90, each sample
  keeps `max(3, floor(90 / samples))` evenly spaced rows. Today no sign exceeds 90, so today's
  model rows are identical to before.
- **Tools for later:**
  - `tests/compact-model/accuracy.mjs` compares the rules and runs leave-one-signer-out once real
    signers exist.
  - `tests/compact-model/pi-bench.sh` measures speed on the Pi.
  - `tests/compact-model/compile-node.mjs` compiles from node.

## 2. Verification (measured)

### Accuracy, before vs after (decision 5)

Measured on the frozen fixtures (`tests/compact-model/fixtures/`, today's data):

- "Before" is today's rows.
- "After" is the budget rule. Float32 storage gave the same top-1 as the old double-precision rows on
  all 5,010 test queries (`knn-compile.test.mjs`).

Source: `node tests/compact-model/accuracy.mjs`, 91 s.

| Test set | Before | After | Letter | Number | Word | Phrase |
|---|---|---|---|---|---|---|
| T2: sign videos → ESL model (vote) | 85.8% (103/120) | 85.8% | 96.2% (25/26) | 100% (10/10) | 80.6% (54/67) | 82.4% (14/17) |
| T2 FSL (vote) | 83.3% (75/90) | 83.3% | — | 100% | 81.5% | 80.0% |
| T2r: video-built model → samples (vote) | 86.8% (105/121) | 86.8% | 100% | 100% | 79.4% | 88.2% |
| T1: leave one repetition out | 6/8 | 6/8 | | | | |
| Frames (T2 / T2r) | 62.3% / 66.8% | same | | | | |

- The difference is 0.0 points on every set and every category, inside your 2-point limit.
- T3 (your real video, sign unknown) gives the same answer under both rules: `n` for all three
  repetitions.
- **Leave-one-signer-out was not run.** There is no data from more than one signer yet. Run it
  after the first real import (section 6).
- Most-confused pairs are unchanged: `which`↔`live`, `how`→`which`,
  `help`→`help_me_practice_please`, `time`↔`what_time_is_it`, `excited`→`happy`. Step 1 section 2.4
  has the full list, including phrase ↔ word.

### What the kiosk pages download (network log)

| Page | Before (Step 1, 2026-10-15) | After |
|---|---|---|
| Let's Talk, first load | `save_gesture.php?no_sync=1` 3,481,409 B + `signs.php` 18,675 B | HEAD + GET `models/knn_ESL.bin` 1,045,196 B + `signs.php` 18,375 B; **0 requests to `save_gesture.php`** (`kiosk-check.mjs`, 3 runs, 125 requests each, all to localhost) |
| Let's Talk, FSL | 3.48 MB again on every switch (never cached) | HEAD + GET `knn_FSL.bin` 723,096 B once; afterwards HEAD only |
| Train Gestures, page load | 2 × full listing, 3,481,409 B each | one `save_gesture.php?summary=1`, 32,609 B, no frames; plus `model_status.php` and the model file (`training-check.mjs`) |

### Time

| What | Before | After |
|---|---|---|
| Let's Talk "gestures" loading step, cold | 799 / 803 / 995 ms | 85 / 90 / 98 ms |
| Same, cached (reload) | 47 / 56 / 72 ms (localStorage) | 37 / 44 / 42 ms (IndexedDB) |
| Switch to FSL | 754 / 826 / 1,142 ms | 34–39 ms first time, 8–10 ms afterwards |
| Model file load, ESL (`bench.html`, 3 runs × 3) | — | cold 36–65 ms, cached 6.7–11.6 ms |
| `knnPredict` per call, today's ESL (2,047 rows) | same rows, same array type | 1.4–1.7 ms; FSL 0.9–1.2 ms |
| `knnPredict`, projected 2 signers (budget 10,196 rows / old rule 24,007) | 14.3–15.1 ms (old rule) | 5.5–6.5 ms |
| `knnPredict`, projected 8 signers (budget 9,164 rows / old rule 89,887) | 60.4–62.8 ms (old rule) | 5.2–9.6 ms |
| Compile, today's data | (Train: incremental, never added new samples of existing signs) | ESL 1.5 s, FSL 1.5 s |

Notes:

- `knnPredict` was timed with a freshly compiled instance per timing. The Step 1 figures shared one
  instance across sizes, which slowed later timings (Task 7 review). They are superseded and should
  not be quoted, including the claim that plain arrays are as fast as or faster than Float32.
- Both languages are stored at once: 1.13 MB of IndexedDB against a 10,240 MB quota.

### Scale (the owner's planned import)

Measured with 3,000 synthetic v3 samples (120 signs × 25, about 45 KB each), `scale-check.mjs`:

- **Compile succeeds:** ESL 52.6–100.5 s, FSL 45.4–77.1 s.
  - Each sign has 75 rows (25 × 3).
  - The fingerprint equals `model_status.php`'s.
- **Requests:** at most 60 samples per request, largest response 2.4 MB, PHP peak per batch at most
  46 MB.
- **At 732 samples (2 signers):** Compile takes 31–33 s.
- **Why batching was needed:** the first version read everything in one listing, and PHP ran out of
  memory at 732 samples. The whole-phase review caught it, and Task 9 fixed it.

### The other checks you asked for

- **Compile → model file → fresh browser → Predict and Let's Talk work.**
  - `training-check.mjs` compiles both languages, Predict shows `hello`, and the written file equals
    the committed one.
  - `kiosk-check.mjs` uses a fresh profile per run: the live fake camera gives `hello` in 36–39 of
    40 predictions.
- **Stale model flagged on the laptop:** a `zz_` probe sample turns the status to "Model out of
  date: run Compile". Removing it returns "up to date".
- **The Pi variant:** Compile disabled, exact warning text, no stale text, Steps 3/4 still load.
- **0 console errors at 1024x600** in every browser check. Step 2 fits the screen and every control
  is at least 44 px.

### Tests (final code)

| Suite | Result |
|---|---|
| Unit tests (`node --test --test-concurrency=1 "tests/<suite>/*.test.mjs"`): compact-model, sign-texts, video-capture, bulk-import, avatar, categorization, multi-sample, conversations, normalization | 362 tests: 361 pass, 0 fail, 1 skipped by design (`clear_all`). Before the phase: 295. |
| `kiosk-check`, `training-check`, `store-check`, `bench-check`, `scale-check` (3,000 and 732) | all pass |
| `talk-check`, `step1-check`, `startup-check`, `capture-ui-check`, `video-capture/e2e`, `sign-texts/verify-e2e`, `bulk-import/verify-e2e`, `import-flow-check` | all pass |
| `sign-texts/dataset-check` | 1 failure that also fails at HEAD: it expects 6 table columns, and the Avatar column exists already (DEBT 135) |

At the end, the committed model files are byte-identical to before the checks. No `config/` folder
and no `zz_` probes remain, and the DB is back to 122 gestures / 127 recordings.

## 3. Process

- **Backup** before any change: `E:\ACADSS\IOT\backups\2026-10-15-compact-model\`, holding a
  249-file copy of `saved_gestures` and a mysqldump of 6,022,830 bytes.
- **Frozen fixtures** in `tests/compact-model/fixtures/`: today's listing, the extracted sign videos
  and the expected numbers.
- Each task had one implementer and an independent review:

| Task | Rounds | What the reviews changed |
|---|---|---|
| 1 Compile module (rule, format, fingerprint) | 1 | — |
| 2 Accuracy script | 2 | Reads signers only from sample files inside `saved_gestures`; runs through the XAMPP junction; shows progress and an ETA on long runs. |
| 3 PHP endpoints + git rules | 1 | — |
| 4 Model store (IndexedDB) | 1 | — (the implementer found that Apache sends weak ETags right after a write) |
| 5 Let's Talk wiring | 1 | — (I added a guard against a stale result when the language changes) |
| 6 Train Gestures Compile UI | 1 | — |
| 7 Pi bench | 2 | One compiled `knnPredict` per timing; a restart hint on every exit path. |
| Whole phase | 2 | Compile runs out of PHP memory at 732 samples, fixed by batching (Task 9). Two checks were pinned to today's live data and now read the live files. |
| 10 Docs | 2 | Four figures corrected (trim on T2r, a budget-120 row, a reload timing label) and the bulk-import Review decision added to DECISIONS. |

Several agents were interrupted by the usage limit and resumed. Before each resume I checked that
the model files, DB and test folders were clean.

## 4. Behaviour changes you should know

1. **Export Data** writes the compiled model rows (after the budget), not every raw row. **Load
   Saved** only shows "Loading a training file is no longer used: Compile builds the model from the
   saved samples." and changes nothing.
2. **The laptop and the Pi handle a missing model file differently.**
   - On the laptop, Train Gestures does not use a stored copy when the server file is missing or
     broken. It shows "No model file: run Compile".
   - Let's Talk and the Pi keep the last good copy.
3. **Step 2 "Next"** shows whenever a usable model is loaded. Step 1's note after a save says "Run
   Compile (Step 2) again". The two load toasts are gone.
4. **Compile always rebuilds the whole model.** The old Train added only new signs and never added
   new samples of signs it already had.
5. **`start` and `stop` are in both files (Q4).** Train Gestures' FSL model now includes `start`.

## 5. Files

- **New:**
  - `js/knn-compile.js`, `js/knn-model-store.js`;
  - `php/api/compile_model.php`, `model_status.php`, `knn_model_lib.php`;
  - `models/knn_ESL.bin`, `models/knn_FSL.bin`;
  - `.gitattributes`;
  - `tests/compact-model/`: 3 unit-test files, 7 browser checks, `bench.html`, `pi-bench.sh`,
    `accuracy.mjs`, `compile-node.mjs`, `model-guard.mjs`, and the fixtures.
- **Changed:**
  - `js/sign-to-text-ui.js`: the model load only. `knnPredict` and `cosineSimilarity` are
    byte-identical.
  - `js/talk-loader.js`: two scripts and one error text.
  - `js/gesture-data.js`: schema "3" reset, header-text fallback, `summary` option.
  - `js/gesture-training-ui.js`: Compile, status, loading; `knnPredict` and `cosineSimilarity`
    byte-identical.
  - `gesture-training.html`.
  - `php/api/save_gesture.php`: GET `summary` and `labels` options. A GET without them is
    byte-identical.
  - `.gitignore`.
  - The old tests listed in `.git/sdd/cm-task-5/6/9-report.md`.
- **Docs:** `CLAUDE.md`, `docs/system/ML.md`, `UI.md`, `BACKEND.md`, `DECISIONS.md`, `DEBT.md`,
  `INVENTORY.md`, `HARDWARE_BOOT.md`.
  - DEBT 94, 95 and 116 are resolved; 88 and 117 are updated; 126–140 are new.
- **Not touched:**
  - `recordingToFeatureRows`, the capture flow, the v2/v3 formats;
  - bulk import, the avatar, the Let's Talk UI, `archive/**`;
  - your uncommitted `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md`.
- **Commits:** code `14eb461`, model files `fd0f83f`, then docs (this report) in the next commit.
  Nothing was pushed or merged.

## 6. Owner actions

1. **Bulk import's Review step cannot open on a large dataset (DEBT 117).**
   - Its full listing hits PHP's memory limit at 732 imported samples (measured through Apache and
     php-cgi).
   - The import itself works. But after a large import, Review (and so a second import round) fails
     until it is changed to use the summary and `labels=` batches as Compile now does.
   - Bulk import was on the must-not-change list, so I did not touch it. I recommend that as the
     next task.
2. **After the first real import**, run leave-one-signer-out before the kiosk uses the new model
   (DEBT 128):
   - Command: `node tests/compact-model/accuracy.mjs --live --sets LOSO --query-rows 10 --signers P01,P02 --json <file>`.
   - If the budget rule loses more than 2 points, raise the budget to 120.
3. **On the Pi:** run `bash tests/compact-model/pi-bench.sh` (DEBT 129). `knnPredict` must stay well
   under the 150 ms tick.
4. **Manual checks** to add to your `MANUAL-CHECKS.md` (I did not edit it):
   - Compile ESL and FSL on the laptop with the mouse;
   - copy the two `.bin` files to the Pi and check Let's Talk there;
   - on the Pi, check that Step 2's Compile is disabled with the warning.
5. **Backups of imported samples.** They are no longer in git, so `E:\ACADSS\IOT\backups\` and the
   laptop disk are their only copies.
6. **Repository size.** Each recompiled model that you commit adds about 1.8 MB of binary history
   (DEBT 139).
7. **Slow summary listing at scale (DEBT 133).** At 3,000 samples, Train Gestures' page load and
   Compile's first step take 16–28 s, because the summary still reads every sample file. A possible
   follow-up.
