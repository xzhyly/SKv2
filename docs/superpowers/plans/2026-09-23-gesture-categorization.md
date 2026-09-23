# Gesture categorization (word / letter / number / phrase) — implementation plan

Owner-approved 2026-09-23 (Step 1 proposal (a)–(d), category stored DB-only).
Settled decisions and their reasons: `docs/system/DECISIONS.md`, section
"Decisions made during the gesture-categorization phase (2026-09-23)".

## Context every task needs

- Stack: vanilla JS/HTML/CSS, no build step, no npm dependencies, no
  framework; PHP 8 + MySQL. Tests are plain `node --test` files (Node 24,
  built-ins only) plus PHP CLI at `C:\xampp\php\php.exe` / php-cgi at
  `C:\xampp\php\php-cgi.exe`. The existing harness
  `tests/multi-sample/harness.mjs` (`callEndpoint()`, `cleanupProbe()`,
  `fixtureFrames()`) runs `php/api/save_gesture.php` under php-cgi exactly as
  Apache would; reuse it, do not copy it.
- The DB server is MySQL 8.0.44 reached through `php/connect.php`
  (root, empty password, db `sining_kamay_db`). XAMPP's `mysql.exe` client
  cannot authenticate to it — query the DB through PHP CLI with
  `require 'php/connect.php'`.
- Disk is the source of truth for gesture samples:
  `saved_gestures/<label>/sample_*.json` (ESL) and
  `saved_gestures_fsl/<label>/sample_*.json` (FSL). `sync_disk_to_db()` in
  `save_gesture.php` recreates `gestures` rows from disk on every GET without
  `?no_sync`. Labels are always `clean_label()`'d: lowercase, whitespace →
  `_`, only `[a-z0-9_-]`.
- `gestures` table today: `id, word, sign_language, created_at`,
  `UNIQUE(word, sign_language)`. It had 0 rows on 2026-09-23 (disk has 209
  label folders).
- Test probe labels must start with `zz_` and every test must clean up after
  itself (disk folder, `gestures`/`gesture_recordings`/`esl_signs`/`fsl_signs`
  rows, and any `assets/signs/<en|fil>/<label>.{mp4,webm}` it caused).

## Global Constraints (verbatim from the owner; binding on every task)

- `knnPredict()`, `cosineSimilarity()`, `trainModel()`,
  `mergeSavedGestureSamples()` are not touched — this phase changes how
  labels are organized/tagged, not how they're captured or scored.
- Frame capture logic (`FRAME_MIN`, `FRAME_MAX`, anything in
  `js/gesture-data.js` around the recording loop) is not touched — that's a
  separate, later phase.
- The 4-step wizard (Add Data / Train AI / Predict / Translate) keeps its
  current shape and step order. No new step, no removed step.
- Every one of the existing labels must end up with a valid, non-null
  category after migration — verify this with a real query against the live
  DB, not by inspecting a handful of rows.
- `reports.html`, `talk.html`, and `gesture-training.html`'s other sibling
  pages are not touched unless the plan you present in Step 1 explicitly
  says a given page needs the category surfaced there too — don't touch
  pages beyond what you scoped and I approved.
- Backward compatible: this phase must not require re-recording or
  re-uploading any existing gesture sample.

Plus, from the project's CLAUDE.md hard rules: offline only (no network
fetches beyond the app's own PHP), no build step, no framework, Raspberry Pi
4B CPU-only target, 1024×600 touchscreen is the viewport to test against.

Approved scope — the only files this phase may change:
`php/api/save_gesture.php`, new `php/api/gesture_category.php`,
`db-schema/database_setup.sql`, new `js/gesture-category.js`,
`js/gesture-data.js` (only `confirmAndSave()`, `saveGestureSample()`,
`loadSavedGestureDataset()` and the returned API object),
`js/gesture-training-ui.js`, `gesture-training.html`,
`css/gesture-training.css`, new files under `tests/categorization/`, and
(Task 6 only) docs. Nothing else.

## The heuristic (exact; both PHP and JS implement exactly this)

Input: a cleaned label string. First match wins:

1. `number` — label matches `^[0-9]+$`, OR is exactly one of:
   `zero one two three four five six seven eight nine ten eleven twelve
   thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty
   hundred thousand isa dalawa tatlo apat lima anim pito walo siyam sampu
   sampung daan libo`
2. `letter` — label matches `^[a-z]$`
3. `phrase` — label contains `_`
4. `word` — everything else, including the empty string (safe default)

Valid categories, in this order everywhere: `word`, `letter`, `number`,
`phrase`.

Measured on the 209 on-disk labels on 2026-09-23 — ESL: word 67, letter 26,
number 10, phrase 17 (120); FSL: word 50, letter 0, number 10, phrase 29
(89); total word 117, letter 26, number 20, phrase 46.

---

### Task 1: Schema, PHP heuristic, and category on the save path

**Files:** create `php/api/gesture_category.php`; modify
`php/api/save_gesture.php`, `db-schema/database_setup.sql`; create
`tests/categorization/labels-2026-09-23.json`,
`tests/categorization/php-heuristic.test.mjs`,
`tests/categorization/save-category.test.mjs` (plus a small shared
`tests/categorization/db.mjs` helper if useful).

1. `php/api/gesture_category.php` — pure functions, no side effects, no
   output, safe to `require_once` from both `save_gesture.php` and a CLI
   test script:
   - `GESTURE_CATEGORIES` = `['word','letter','number','phrase']`
   - `gesture_category(string $label): string` — the heuristic above.
   - `valid_gesture_category($value): ?string` — lowercases/trims; returns
     the value if it is one of the four, else `null`.
2. `save_gesture.php`:
   - `require_once __DIR__ . '/gesture_category.php';`
   - `ensure_gestures_columns($conn)`: if `gestures.category` does not exist,
     `ALTER TABLE gestures ADD COLUMN category ENUM('word','letter','number','phrase') NOT NULL DEFAULT 'word' AFTER sign_language`,
     then immediately call a new `backfill_gesture_categories($conn)` which
     sets every existing row's category to `gesture_category(word)` (only
     rows whose heuristic result is not `'word'` need an UPDATE). The
     backfill runs only in the same call that added the column — never on
     later calls, so it can never overwrite a manual tag. Failures use the
     file's existing `fail(..., 500)` pattern.
   - `save_gesture_word_to_db($label, $signLanguage, $category = null)`:
     INSERT writes `category` = `$category ?? gesture_category($label)`. On
     duplicate key, the stored category is overwritten **only** when
     `$category !== null` (e.g. `category = IF(?, ?, category)` with bound
     params). Keep the existing `id = LAST_INSERT_ID(id)` behaviour and the
     `$id === 0` fallback. Return value gains `'category'` = the category
     actually stored for that row (read it back).
   - `sync_disk_to_db()` keeps calling `save_gesture_word_to_db($label,
     $signLanguage)` with no category — so the sync inserts heuristic values
     for new rows and never overwrites a stored category.
   - POST save path: `$category = valid_gesture_category($body['category'] ?? null);`
     (an invalid or missing value becomes `null`, i.e. heuristic on insert /
     unchanged on update — never a failure). Pass it to
     `save_gesture_word_to_db`. Add `'category' => $dbGesture['category']` to
     the JSON response. Everything else in the response is unchanged.
   - Do not touch `gesture_recordings.gesture_type`, `core_api.php`,
     `scratch/trigger_sync.php`, the ffmpeg/video logic, or `list_samples()`
     (Task 2 owns it).
3. `db-schema/database_setup.sql`: add the same `category ENUM(...) NOT NULL
   DEFAULT 'word'` column after `sign_language` in the `gestures` CREATE
   TABLE. Do not touch the two `.sql` dumps.
4. `tests/categorization/labels-2026-09-23.json`: frozen fixture
   `{"ESL": [...120 labels...], "FSL": [...89 labels...]}` = the folder names
   under `saved_gestures/` and `saved_gestures_fsl/` today (directories
   only; ignore the stray `saved_gestures_fsl/sample_*.json` file at the
   folder root).
5. Tests (TDD — write them first, watch them fail):
   - `php-heuristic.test.mjs`: runs PHP CLI requiring
     `gesture_category.php` over the fixture and asserts the exact per-set
     distribution in "The heuristic" section above; plus edge cases:
     `''`→word, `'7'`→number, `'42'`→number, `'a'`→letter, `'z'`→letter,
     `'ab'`→word, `'nag-aantok'`→word, `'how_are_you'`→phrase,
     `'one_more'`→phrase, `'isa'`→number, `'sampu'`→number; and
     `valid_gesture_category`: `'Phrase '`→`'phrase'`, `'verb'`→null,
     `null`→null.
   - `save-category.test.mjs` (live DB + php-cgi, via the harness, with
     `zz_` probe labels, full cleanup in `beforeEach`/`after`):
     - POST each of the four categories for a fresh probe label → response
       `category` equals it and the `gestures` row holds it.
     - POST with no `category` for `zz_cat_probe` (heuristic → phrase,
       because of `_`) → stored `phrase`; POST with `category: 'bogus'` →
       success, heuristic value stored.
     - Re-tag: second POST of the same label with a different category →
       row updated; a third POST with no category → unchanged.
     - Sync keeps manual tags: tag a probe `letter`, run a full GET (no
       `no_sync`), row still `letter`.
     - Sync inserts heuristic: delete only the probe's `gestures` row via
       SQL, run a full GET, row recreated with the heuristic value.
     - `backfill_gesture_categories`: insert probe rows directly with
       category `word` (words `zz_cat_bf_x`... chosen so the heuristic gives
       a non-word for some, e.g. include an `_`), call the function via PHP
       CLI, assert values; clean up.
   - `node --test tests/multi-sample/save-endpoint.test.mjs` must still
     pass 8/8.

**Done when:** all new tests and the existing multi-sample suite pass;
`SHOW CREATE TABLE gestures` shows the ENUM column with default `'word'`;
`git diff --stat` for the task lists only the files named above.

---

### Task 2: Categories in the dataset GET response and on the JS save/load path

**Files:** modify `php/api/save_gesture.php` (`list_samples()` only),
`js/gesture-data.js` (only `confirmAndSave()`, `saveGestureSample()`,
`loadSavedGestureDataset()`, and the exported API object); create
`tests/categorization/list-categories.test.mjs`.

1. `list_samples()`: after building `$gestures`, add a top-level
   `categories` key to the response:
   `{"ESL": {label: category, ...}, "FSL": {label: category, ...}}`. A
   label appears under the set given by each of its samples'
   `signLanguage` (uppercased; anything but `FSL` → `ESL`, the same rule the
   UI's `rebuildSampleInfo()` uses). The value is the DB row's category for
   `(word, sign_language)` from ONE `SELECT word, sign_language, category
   FROM gestures`, or `gesture_category($label)` when there is no row (e.g.
   a `no_sync` load before the first sync). Call `ensure_gestures_columns()`
   before the SELECT so a `no_sync` load on an unmigrated DB still works. If
   the SELECT itself fails, fall back to the heuristic for every label —
   the dataset list must never fail because of categories. Both `?no_sync=1`
   and full loads return `categories`. The existing `success`,
   `datasetRoot`, and `gestures` keys and their shape are byte-for-byte
   unchanged.
2. `js/gesture-data.js`:
   - `loadSavedGestureDataset(noSync)`: still returns `json.gestures || {}`
     exactly as now; additionally stores `json.categories` (default
     `{ESL:{}, FSL:{}}`) in module state.
   - Export `getSavedCategories()` on the returned API object, returning
     that stored map.
   - `saveGestureSample(label, frames, signLanguage, videoBase64, videoPath,
     category = null)`: adds `category` to the payload when truthy.
   - `confirmAndSave()`: reads
     `document.querySelector('input[name="gestureCategory"]:checked')?.value`
     (the Task 3 selector; `null` if absent) and passes it as the 6th
     argument; the success result object gains `category: result.category`.
   - Nothing else in the file changes — in particular not `startRecording`,
     `stopRecording`, `captureFrameIfRecording`, the hand loop,
     `FRAME_MIN`/`FRAME_MAX`, `recordingsToTrainingRows`.
3. `list-categories.test.mjs` (harness, live DB, `zz_` probes, cleanup):
   - `?no_sync=1` response has `categories.ESL` and `categories.FSL`
     objects; every label key in `gestures` appears under at least one set;
     every value is one of the four categories.
   - A probe saved with `category: 'number'` shows `number` in both a
     `no_sync` and a full load.
   - A probe saved to FSL appears under `categories.FSL`, not `ESL`.
   - A label on disk with no DB row reports its heuristic value in a
     `no_sync` load.
   - The `gestures` part of the response is unchanged in shape (same keys
     per sample: `file, label, frames, frameCount, createdAt, signLanguage`).

**Done when:** the new test, Task 1's tests, and the multi-sample suite
pass; `mergeSavedGestureSamples()` and `recordingsToTrainingRows()` are
untouched (verify by diff).

---

### Task 3: Capture-time "Type" selector with auto-preselect

**Files:** create `js/gesture-category.js`,
`tests/categorization/heuristic-parity.test.mjs`; modify
`gesture-training.html`, `js/gesture-training-ui.js`,
`css/gesture-training.css`.

1. `js/gesture-category.js`: the heuristic in JS, exact same rules and list
   as the PHP one. Browser: defines `window.GestureCategory = { CATEGORIES,
   guess(label) }`. Node: the same file must be loadable by the parity test
   (e.g. `if (typeof module !== 'undefined') module.exports = ...`, or have
   the test evaluate the file with `node:vm` — your choice; no build step,
   no npm). Load it in `gesture-training.html` with a plain `<script
   src="js/gesture-category.js" defer>` before `js/gesture-training-ui.js`.
2. `heuristic-parity.test.mjs`: JS `guess()` equals PHP
   `gesture_category()` for every label in
   `tests/categorization/labels-2026-09-23.json`, for every label folder
   currently on disk, and for the Task 1 edge cases; JS distribution over
   the fixture equals the numbers in "The heuristic" section.
3. `gesture-training.html` Step 1: directly after the existing "Sign Set"
   `.tr-fgrp` block (the one containing `.tr-sign-toggle` with the
   `gestureDatasetType` radios), add a `.tr-fgrp` labelled **Type** with a
   segmented radio group, `name="gestureCategory"`, values/labels in order
   `word`/Word, `letter`/Letter, `number`/Number, `phrase`/Phrase, `word`
   checked by default. Reuse the existing `.tr-sign-toggle` / `.tr-sign-opt`
   classes so it matches the Sign Set control exactly (navy fill when
   checked, 40px, 8px radius, 13px bold); add a modifier class (e.g.
   `.tr-type-toggle`) in `css/gesture-training.css` that only changes the
   grid to 4 equal columns. No inline colours; use the existing CSS
   variables.
4. `js/gesture-training-ui.js`: an `autoSelectCategory()` that sets the
   checked `gestureCategory` radio to the stored category for
   (`currentLabelClean()`, `selectedSignSet()`) from
   `GestureDataRecorder.getSavedCategories()`, else
   `GestureCategory.guess(label)`; with an empty label it selects `word`.
   Call it on the Gesture Name `input` event, on Sign Set `change`, and at
   the end of `renderSavedDataset()` (so after page load and after every
   post-save reload the selector reflects stored data). A manual tap on a
   Type option is NOT overridden until the name or sign set changes again
   (i.e. do not call it from anywhere else). Hook these in the existing
   `DOMContentLoaded` listener next to the existing `clearNote` wiring.
   Do not modify `knnPredict`, `cosineSimilarity`, `trainModel`,
   `mergeSavedGestureSamples`, or the step/wizard functions.
5. Verification in the real page at **1024×600** (Apache: start with
   `C:\xampp\apache_start.bat` if `http://localhost/SKR/` does not answer;
   page `http://localhost/SKR/gesture-training.html`, passes a PIN gate —
   read `trVerifyPin()` in `gesture-training-ui.js` for how to get past it):
   - typing `a` selects Letter, `seven` → Number, `how_are_you` → Phrase,
     `hello` → Word; typing an existing label selects its stored category;
     switching Sign Set re-evaluates; a manual tap survives until the name
     changes.
   - Measure `#leftStep1` `scrollHeight`/`clientHeight` and whether
     `#startGestureDataBtn` is fully visible without scrolling, before and
     after the change; report both. If Start Capture was fully visible
     before and is not after, reduce vertical cost (e.g. put the Type group
     beside Sign Set, or 34px option height for this group only) until it
     is, and report what you chose.
   - Zero console errors on load, while typing, and across switching steps
     1→2→1.

**Done when:** parity test passes; the browser checks above are reported
with measured numbers; Tasks 1–2 tests still pass.

---

### Task 4: Grouped "View Active Gesture Dataset" table

**Files:** modify `js/gesture-training-ui.js` (`renderSavedDataset()`
only), `gesture-training.html` (the `#datasetCount` initial text only).

1. `renderSavedDataset()`: determine each label's category as
   `GestureDataRecorder.getSavedCategories()[set][label]` falling back to
   `GestureCategory.guess(label)`, where `set` is the row's existing sign set
   (`samples[0]?.signLanguage || 'ESL'`, uppercased, as today). Render the
   same table (same columns: Label, Sign Set, Samples, Action; same Delete
   button and `deleteGesture('<label>')` call) but grouped: a full-width
   group header row per non-empty category, in the order **Words, Phrases,
   Letters, Numbers**, reading e.g. `Words · 117`; rows alphabetical by
   label within a group. Group header style: light tint row distinct from
   the navy column header (e.g. `var(--bg)`-ish background, navy 800-weight
   text, orange count or left accent) using existing CSS variables, matching
   the table's existing inline-style idiom.
2. `#datasetCount` text becomes `` `${labels.length} gestures` `` (and the
   HTML initial text `0 gestures`); the empty-state and error-state HTML are
   unchanged.
3. The modal (`trOpenDatasetModal()` copies `#gestureDatasetTableWrap`'s
   innerHTML) must show the grouped table; Delete from the modal must still
   work.
4. Verification at 1024×600 in the real page: screenshot of the open modal
   showing group headers; counts in the headers sum to the total; delete a
   `zz_` probe label from the grouped modal and confirm it disappears (and
   clean up any files it left); zero console errors.

**Done when:** browser checks reported with screenshots/measurements;
Tasks 1–3 tests still pass.

---

### Task 5: Migration run and live verification (controller)

1. With Apache running, load `gesture-training.html` once normally (the full
   sync populates `gestures` from disk through the new insert path).
2. Live DB queries, reported verbatim:
   - `SELECT COUNT(*), SUM(category IS NULL), SUM(category NOT IN ('word','letter','number','phrase')) FROM gestures` → 209 / 0 / 0 (or the re-measured disk count).
   - `SELECT sign_language, category, COUNT(*) FROM gestures GROUP BY 1,2` → must equal the measured distribution (ESL 67/26/10/17, FSL 50/0/10/29), or any divergence explained label by label.
   - every disk label folder has a `gestures` row (disk count = row count).
3. Round-trip through the real UI: one `zz_` probe per category, save,
   reload the page, confirm the Type selector and the grouped table show the
   saved category; delete the probes and their video assets.
4. `git diff --stat 44d5033..HEAD` lists only approved-scope files.
5. Zero console errors across Step 1's states.

### Task 6: Documentation (separate commit)

`docs/system/UI.md` (Type selector, grouped table, "N gestures"),
`docs/system/DECISIONS.md` (append anything settled during implementation),
`docs/system/BACKEND.md` (the `gestures.category` column, heuristic
location, `categories` key in the GET response, `category` in the POST
body/response, the sync never-overwrite rule), `docs/system/DEBT.md` (new
item: category is DB-only, a DB reset loses manual re-tags; note the
MySQL-8-vs-XAMPP-MariaDB and the empty-DB findings), `docs/system/MANUAL-CHECKS.md`
(new section: is the grouped table easier to scan than the flat list?),
`CLAUDE.md` (stack line: the DB is a MySQL 8.0 service, not XAMPP's
MariaDB; mention the categorization in the gesture-training context if
relevant).
