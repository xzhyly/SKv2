# DB normalization — implementation plan

Owner-approved 2026-09-24. Proposal (evidence, target schema, reference counts):
`docs/reports/2026-09-24-db-normalization-step1.md`. Settled decisions:
`docs/system/DECISIONS.md`, section "Decisions made during the
schema-normalization phase (2026-09-24)".

## Context every task needs

- Stack: vanilla JS/HTML/CSS (no build step, no npm deps, no framework), PHP 8.0
  (XAMPP, `C:\xampp\php\php.exe`, php-cgi `C:\xampp\php\php-cgi.exe`), **MariaDB
  10.4.32 (XAMPP) is the only DB server** — `php/connect.php` (root, empty
  password, db `sining_kamay_db`). XAMPP's clients work: `C:\xampp\mysql\bin\mysql.exe`,
  `C:\xampp\mysql\bin\mysqldump.exe` (`-uroot`, no password).
- Apache serves the working tree directly at `http://localhost/SKR/` (a junction),
  so any file edit is live immediately.
- Disk is the source of truth for gesture samples: `saved_gestures/<label>/sample_*.json`
  (ESL) and `saved_gestures_fsl/<label>/sample_*.json` (FSL). `sync_disk_to_db()` in
  `php/api/save_gesture.php` recreates DB rows from disk on every GET without
  `?no_sync`. Labels are `clean_label()`'d: lowercase, whitespace → `_`, `[a-z0-9_-]`.
- Tests: `node --test` files (Node 24, built-ins only). They run against the LIVE DB
  and disk, so they must run serially:
  `node --test --test-concurrency=1 tests/categorization/*.test.mjs tests/multi-sample/save-endpoint.test.mjs`
  Helpers: `tests/multi-sample/harness.mjs` (`callEndpoint()` runs save_gesture.php
  under php-cgi exactly as Apache would; `cleanupProbe()`), `tests/categorization/db.mjs`
  (`query()`, `exec()`, `callPhp()` via PHP CLI + connect.php). Probe labels start with
  `zz` and every test cleans up after itself (disk folder, DB rows, any
  `assets/signs/<en|fil>/<label>.{mp4,webm}` it caused).
- Unrelated modified/untracked files exist in the working tree. Stage only your
  task's files with explicit `git add <paths>`. Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Avast once quarantined `php/connect.php` (false positive). Do NOT edit or recreate
  `php/connect.php`. Do NOT start background retry/polling loops. If a file becomes
  unwritable or disappears, stop and report BLOCKED.

## Current schema (live, measured 2026-09-24)

```
gestures(id PK, word varchar(255) NOT NULL, sign_language varchar(10) NOT NULL DEFAULT 'ESL',
         category enum('word','letter','number','phrase') NOT NULL DEFAULT 'word',
         created_at timestamp, UNIQUE KEY `word` (word, sign_language))           -- 209 rows
gesture_recordings(id PK, gesture_id int NULL, sign_language varchar(10) NOT NULL DEFAULT 'ESL',
         gesture_type varchar(100) NOT NULL, sample_count int NOT NULL DEFAULT 0,
         sample_path varchar(255) NULL, landmark_json longtext NULL, thumbnail longtext NULL,
         recorded_at timestamp, KEY gesture_id, KEY gesture_type)                -- 210 rows
esl_signs / fsl_signs(id PK, sign_key varchar(120) UNIQUE, sign_label, text_value, description,
         asset_path varchar(255) NULL, is_active tinyint(1) NOT NULL DEFAULT 1, created_at,
         updated_at, KEY idx_*_text_value)                                        -- 120 / 89 rows
translations, users                                                               -- unchanged
```
No FOREIGN KEY anywhere. All tables InnoDB, utf8mb4 / utf8mb4_general_ci.

## Target schema (exact)

```sql
CREATE TABLE `gestures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(255) NOT NULL,
  `sign_language` enum('ESL','FSL') NOT NULL DEFAULT 'ESL',
  `category` enum('word','letter','number','phrase') NOT NULL DEFAULT 'word',
  `asset_path` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gestures_label_language` (`label`,`sign_language`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `gesture_recordings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `gesture_id` int(11) NOT NULL,
  `frame_count` int(11) NOT NULL DEFAULT 0,
  `sample_path` varchar(255) NOT NULL,
  `landmark_json` longtext DEFAULT NULL,
  `recorded_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gesture_recordings_sample_path` (`sample_path`),
  KEY `idx_gesture_recordings_gesture` (`gesture_id`),
  CONSTRAINT `fk_gesture_recordings_gesture` FOREIGN KEY (`gesture_id`)
    REFERENCES `gestures` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```
`translations` and `users` keep their current DDL. `esl_signs` and `fsl_signs` are
dropped. End state: exactly 4 tables.

Data mapping: `gestures.asset_path`/`is_active` ← the `esl_signs` row (for
`sign_language='ESL'`) or `fsl_signs` row (for `'FSL'`) whose `sign_key = gestures.word`.
`sample_count` → `frame_count` (same values). Dropped without replacement:
`*_signs.sign_label/text_value` (= label with `_`→space), `description` (per-language
constant), `updated_at` (all NULL), `*_signs.id/created_at`; recordings' `gesture_type`
(= label), `sign_language` (= gesture's), `thumbnail` (all NULL).

## Global Constraints (verbatim from the owner; binding on every task)

Files that must NOT change:
- saved_gestures/ and saved_gestures_fsl/: sample JSON files, their
  format, and folder names
- assets/signs/en/ and assets/signs/fil/ (.webm videos)
- archive/**
- knnPredict, cosineSimilarity, trainModel, mergeSavedGestureSamples,
  and frame-capture logic (FRAME_MIN, FRAME_MAX, the recording loop in
  js/gesture-data.js)
- docs/system/MANUAL-CHECKS.md and docs/revision/MEMORY.md (the owner's
  uncommitted edits: don't stage or edit them)
- the old .sql dump snapshots already in the repo

Non-negotiable:
- Zero data loss. Every label, category (including manual re-tags),
  recording, asset_path and is_active value survives. Verify with real
  queries over every row, not samples.
- Before any schema change: fresh backup with
  C:\xampp\mysql\bin\mysqldump.exe to
  E:\ACADSS\IOT\backups\sining_kamay_db_before-normalization.sql, and
  report its size.
- Disk stays the source of truth. The disk-to-DB sync keeps working, and
  must not recreate dropped tables or dropped columns.
- The migration must be safe to run once on the live DB and leave a
  consistent state if it stops midway (explain how: transaction, or
  ordered steps with checks).
- No re-recording or re-uploading of any sample.
- Security hardening is out of scope (DEBT 72 stays open).
- Don't push. Don't merge.

Owner additions:
- A. The migration script lives under the web root. Its first line after `<?php` is
  `if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }` and it is run with
  `C:\xampp\php\php.exe`.
- B. The asset_path backfill is a separate task and commit, never part of the
  migration.

Approved file scope (the only files this phase may change): `db-schema/database_setup.sql`,
new `db-schema/migrations/2026-09-24-normalize.php`, new
`db-schema/migrations/2026-09-24-backfill-asset-path.php`, `php/api/save_gesture.php`,
`php/api/gesture_category.php`, `php/api/reports.php`, `reports.html`,
`tests/categorization/save-category.test.mjs`, `tests/categorization/list-categories.test.mjs`,
new files under `tests/normalization/`; deletions of `php/api/core_api.php`,
`js/db-local.js`, `scratch/trigger_sync.php` and the `js/db-local.js` `<script>` tag in
`gesture-training.html`; docs (Task 6 only).

---

### Task 1: Migration script, tested on a clone only

**Files:** create `db-schema/migrations/2026-09-24-normalize.php`,
`tests/normalization/migration.test.mjs` (plus a small helper module under
`tests/normalization/` if useful).

**The live DB (`sining_kamay_db`) must not be modified by this task in any way.**

1. Script, run as `C:\xampp\php\php.exe db-schema/migrations/2026-09-24-normalize.php [options]`:
   - First line after `<?php`: `if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }`
   - Options: `--db=<name>` (default `sining_kamay_db`), `--snapshot=<path>` (default
     `E:\ACADSS\IOT\backups\normalization-snapshot-<db>.json`), `--stop-after=<N>`
     (exit 0 after finishing step N; for tests), `--verify-only` (run only the
     snapshot comparison and print SHOW CREATE TABLE; change nothing).
   - Connection: `require` `php/connect.php` for credentials, then
     `mysqli_select_db($conn, <db>)`; abort unless `SELECT @@version` contains
     `MariaDB`. Print one line per step: `step N <name>: done` or `already done`.
     Any failed precondition or query → message to STDERR, exit code non-zero, and
     no further steps.
   - Steps, each idempotent (checks information_schema / table state first):
     1. Snapshot: if the snapshot file does not exist AND the DB is still in the
        pre-migration shape, write it (JSON): every gesture keyed by
        (label, sign_language) with category, created_at, and asset_path + is_active
        taken from the matching `esl_signs`/`fsl_signs` row; every recording with id,
        gesture label + sign_language (via join), sample_path, sample_count,
        recorded_at, MD5(landmark_json). If it already exists, reuse it (a resume
        must compare against the ORIGINAL snapshot). If the DB is already fully
        migrated and no snapshot exists, skip to verification with a clear message.
     2. `gestures`: ADD `asset_path varchar(255) DEFAULT NULL`, ADD
        `is_active tinyint(1) NOT NULL DEFAULT 1` (if missing); copy both from
        `esl_signs`/`fsl_signs` (join on sign_key = word/label and language).
     3. `gestures.sign_language` → `enum('ESL','FSL') NOT NULL DEFAULT 'ESL'`
        (precondition: no other values).
     4. `gesture_recordings.gesture_id` → NOT NULL; add FK
        `fk_gesture_recordings_gesture` → `gestures(id)` ON DELETE RESTRICT, and the
        index named `idx_gesture_recordings_gesture` (replace the old `gesture_id`
        index). Preconditions: 0 NULL gesture_id, 0 orphans.
     5. `sample_path` → NOT NULL + UNIQUE KEY `uq_gesture_recordings_sample_path`.
        Preconditions: 0 NULL/empty, 0 duplicates.
     6. Renames: `gestures.word` → `label` (same type/nullability) with the unique key
        renamed to `uq_gestures_label_language`; `gesture_recordings.sample_count` →
        `frame_count`.
     7. Re-copy asset_path/is_active from `*_signs` (if those tables still exist),
        then compare EVERY gesture and EVERY recording against the snapshot
        (category, created_at, asset_path, is_active; recording id, label/lang via
        join, sample_path, frame_count, recorded_at, MD5(landmark_json)), plus row
        counts. Any difference → stop, non-zero exit, nothing dropped.
     8. Drop `gesture_recordings.gesture_type` (and its index), `sign_language`,
        `thumbnail` (precondition: thumbnail all NULL).
     9. Drop `esl_signs`, `fsl_signs`.
     10. Compare against the snapshot again (as step 7, without *_signs), check the
         table list is exactly {gestures, gesture_recordings, translations, users},
         print SHOW CREATE TABLE for all 4.
   - Column order in the final tables must be exactly as in "Target schema" (use
     AFTER clauses), so `SHOW CREATE TABLE` matches it.
2. Tests (`tests/normalization/migration.test.mjs`), TDD (write first, capture RED):
   - Clone helper: create `sining_kamay_db_migtest` and fill it from
     `mysqldump.exe -uroot --single-transaction --default-character-set=utf8mb4 sining_kamay_db`
     piped into `mysql.exe -uroot --default-character-set=utf8mb4 sining_kamay_db_migtest`
     (use a temp file if piping is awkward). Snapshot paths go to `os.tmpdir()`.
     Drop the clone database and temp files in `after()` even on failure.
   - CLI guard: running the script under php-cgi (REQUEST_METHOD=GET,
     SCRIPT_FILENAME=the script, REDIRECT_STATUS=1) returns `Status: 403` with an
     empty body and changes nothing.
   - Full run on the clone: exit 0; SHOW CREATE TABLE for gestures and
     gesture_recordings equals "Target schema" (ignore `AUTO_INCREMENT=N`);
     table list is exactly the 4; counts 209/210; per-(label,language) recording
     counts equal the pre-run clone; category split ESL 67/26/10/17, FSL 50/0/10/29;
     every asset_path/is_active equals the pre-run `*_signs` value; 0 orphans; the FK
     exists (information_schema.REFERENTIAL_CONSTRAINTS, DELETE_RULE=RESTRICT).
   - Re-run: exit 0, every step reports `already done`, schema and data unchanged.
   - Interruption: for each N in 1..9, fresh clone → `--stop-after=N` → full run →
     final state (normalized SHOW CREATE TABLE + a checksum/query of all gesture and
     recording data) identical to the reference full run.
   - Safety: the live DB's `SHOW TABLES` and `SHOW CREATE TABLE gestures` are identical
     before and after the whole test file.
   - A failed precondition aborts before any drop: e.g. on a clone, insert an orphan
     recording (gesture_id pointing nowhere) → run → non-zero exit at step 4, and
     `esl_signs` still exists.

**Done when:** all migration tests pass; the existing suite still passes
(`node --test --test-concurrency=1 tests/categorization/*.test.mjs tests/multi-sample/save-endpoint.test.mjs`);
the live DB is unchanged (show the before/after SHOW TABLES + SHOW CREATE TABLE gestures);
no `sining_kamay_db_migtest` database left behind.

---

### Task 2: Cutover — backup, migrate live, switch the code

**Files:** `php/api/save_gesture.php`, `php/api/gesture_category.php`,
`php/api/reports.php`, `reports.html`, `tests/categorization/save-category.test.mjs`,
`tests/categorization/list-categories.test.mjs`.

Order (keep the window between steps 2 and 3 short — Apache serves the tree live):
1. Backup: `C:\xampp\mysql\bin\mysqldump.exe -uroot --single-transaction --default-character-set=utf8mb4 --result-file=E:\ACADSS\IOT\backups\sining_kamay_db_before-normalization.sql sining_kamay_db`.
   Report its size in bytes and confirm it contains `CREATE TABLE` for all 6 current
   tables. If the backup fails, STOP (BLOCKED).
2. Run the migration on live: `C:\xampp\php\php.exe db-schema/migrations/2026-09-24-normalize.php`
   (snapshot at the default path). Save its full output to the task report.
3. Code:
   - `save_gesture.php`:
     - `save_gesture_word_to_db`: `word` → `label` in the INSERT and the fallback SELECT.
     - Remove `ensure_language_dataset_table()` and `save_gesture_to_language_dataset()`.
       In the POST save path, after `save_gesture_word_to_db`, run
       `UPDATE gestures SET asset_path = COALESCE(?, asset_path) WHERE id = ?` with
       `$videoAssetRelative` (same "never overwrite with nothing" rule as the old
       `IFNULL`). Remove the `dbDatasetTable`/`dbDatasetId` response keys (they name
       dropped tables; no JS or test reads them — grep-verified). All other response
       keys unchanged.
     - Remove `ensure_gesture_recordings_table()` entirely (its CREATE has the old
       columns and it ALTERs in `sign_language`) and its calls.
     - `save_gesture_recording_to_db($gestureId, $frameCount, $samplePath, $landmarkJson)`:
       `INSERT INTO gesture_recordings (gesture_id, frame_count, sample_path, landmark_json)`.
       Update both call sites.
     - `sync_disk_to_db`: remove the `ensure_language_dataset_table` calls, the
       `save_gesture_to_language_dataset` call, and the two `*_signs` cascade DELETEs.
       Keep the rest of its logic (existence check by sample_path, stale-row delete,
       gestures-without-recordings cascade) unchanged.
     - `build_categories_map`: `word` → `label`.
     - `delete_gesture`: `SELECT id FROM gestures WHERE label = ? LIMIT 1`; remove the
       `esl_signs`/`fsl_signs` DELETEs. Keep the recordings-then-gesture delete order.
     - Nothing in the file may create or add `esl_signs`, `fsl_signs`, `gesture_type`,
       recordings' `sign_language`, `thumbnail`, `word`, or `sample_count`.
   - `gesture_category.php`: `ensure_gestures_columns` — the `sign_language` ALTER (only
     runs if missing) becomes `enum('ESL','FSL') NOT NULL DEFAULT 'ESL' AFTER label`;
     `backfill_gesture_categories` selects `id, label`. Heuristic functions unchanged.
   - `reports.php`: ESL and FSL lists come from
     `SELECT id, label, asset_path, is_active, created_at FROM gestures WHERE sign_language = 'ESL'|'FSL' ORDER BY created_at DESC, id DESC`;
     each row also gets `display_label` = `str_replace('_', ' ', label)`. The existing
     empty-asset_path `.mp4` backfill keeps its logic but targets `gestures`
     (prepared `UPDATE gestures SET asset_path = ? WHERE id = ?`). Response:
     `summary: {esl, fsl, translations}`, `data: {esl, fsl, translations}`;
     translations part unchanged.
   - `reports.html`: read the new keys; the visible table stays identical — column
     "Key" shows `label`, "Label" and "Text" both show `display_label`, the asset
     button uses `asset_path` with `display_label` as its title. Nothing else changes.
   - Tests: `word` → `label` in queries; the scratch-table test in
     `save-category.test.mjs` uses the new pre-category shape (`label`, `sign_language`
     enum); the "sync inserts heuristic" test deletes the probe's recordings BEFORE its
     gestures row (FK RESTRICT) and must not reference `gesture_type`/recordings'
     `sign_language`; the real-row snapshot guard uses `label`.
4. Verify on live, reporting every number:
   - migration `--verify-only`: 0 differences vs snapshot;
   - `SHOW TABLES` = the 4; SHOW CREATE TABLE gestures / gesture_recordings = target;
   - 209 gestures, split ESL 67/26/10/17, FSL 50/0/10/29; 210 recordings; every
     (label, language) has the same recording count as in the snapshot; 0 orphans;
     FK present with DELETE_RULE=RESTRICT;
   - `grep` shows no remaining `esl_signs|fsl_signs|gesture_type|sample_count|thumbnail`
     and no `gestures.word` usage in `php/` or `tests/` (outside the migration script);
   - `curl http://localhost/SKR/php/api/reports.php` → 200, `summary.esl=120`,
     `summary.fsl=89`;
   - serial test suite green, output pristine.

**Done when:** all of step 4 holds.

---

### Task 3: Backfill the 62 NULL asset_path values (own commit)

**Files:** create `db-schema/migrations/2026-09-24-backfill-asset-path.php`.

- CLI-only guard as the first line (same as Task 1); `--db` option (default
  `sining_kamay_db`); MariaDB check.
- For every `gestures` row with `asset_path IS NULL`: if
  `assets/signs/<en for ESL | fil for FSL>/<label>.webm` exists (and is non-empty),
  set `asset_path = 'assets/signs/<en|fil>/<label>.webm'` with
  `UPDATE ... WHERE id = ? AND asset_path IS NULL`. Never touch a non-NULL value.
  Idempotent (second run fills 0). Print the count filled and the count left NULL.
- Run it on live. Report: count filled (measured 2026-09-24: expected 62 — report the
  actual), count still NULL, and prove every previously non-NULL asset_path is
  unchanged by comparing to the normalization snapshot
  (`E:\ACADSS\IOT\backups\normalization-snapshot-sining_kamay_db.json`), in particular
  `one`..`ten` → `assets/signs/en/1.webm`..`10.webm`.
- Confirm `reports.php` now returns a non-empty asset_path for all 209 rows (so Reports
  shows "View" on every row).
- Serial test suite still green.

**Done when:** the above is reported with measured numbers and committed on its own.

---

### Task 4: Remove dead code; finalize database_setup.sql

**Files:** delete `php/api/core_api.php`, `js/db-local.js`, `scratch/trigger_sync.php`;
`gesture-training.html` (remove only the `<script src="js/db-local.js" defer></script>`
line); `db-schema/database_setup.sql`.

- Before deleting, grep-verify there are still no live references (outside `archive/`
  and `docs/`) to `core_api`, `db-local`, `trigger_sync`.
- `database_setup.sql`: keep its `CREATE DATABASE IF NOT EXISTS` / `USE` header and the
  `users` and `translations` sections (including the default admin seed) unchanged;
  remove the `esl_signs`/`fsl_signs` CREATE TABLEs and their seed INSERTs; replace the
  `gestures` and `gesture_recordings` definitions with the target DDL (gestures before
  gesture_recordings, FK included).
- Verify: load `database_setup.sql` into a scratch database (edit a temp copy's
  database name to e.g. `sining_kamay_db_setuptest`), and compare `SHOW CREATE TABLE`
  for all 4 tables against live, ignoring `AUTO_INCREMENT=N` — must be identical. Drop
  the scratch database afterwards.
- Serial test suite green; gesture-training.html loads with 0 console errors if you can
  check it (otherwise the controller checks in Task 5).

- **Addendum (controller, after Tasks 2–3):** `tests/normalization/` still clones the
  LIVE DB and assumes the pre-migration shape, which no longer holds after the live
  cutover. Change its clone source to the pre-normalization backup:
  env `SK_NORMALIZATION_SOURCE_DUMP`, default
  `E:\ACADSS\IOT\backups\sining_kamay_db_before-normalization.sql`; if the file is
  absent, skip the file's tests with a clear message (not a failure). Keep every
  existing assertion, including "live DB unchanged". While in that file, also:
  add an isolated test for the step-8 redundancy precondition (`--stop-after=6` on a
  clone, `UPDATE gesture_recordings SET gesture_type='zz' WHERE id=<one id>`, resume →
  non-zero exit, stderr mentions step 8, `gesture_type` column still present); make
  `after()` drop each clone in its own try/catch; make the failure tests also assert
  `fsl_signs` still exists. Run `node --test --test-concurrency=1 tests/normalization/migration.test.mjs`
  and report the result. `tests/normalization/**` is in the approved file scope.

**Done when:** the above holds.

---

### Task 5: Live browser verification (controller)

At 1024×600, 0 console errors: gesture training all 4 steps including the dataset
modal's tabs and search; Let's Talk text-to-sign video playback; Reports (all tabs,
"View asset" on a backfilled row); save a new zz probe sample, then a second sample for
the same label → both recordings under one gestures row, surviving a reload + sync;
clean up. `git diff --stat` against `ad12fc5` matches the approved file scope.

### Task 6: Documentation + final report (separate commit)

`docs/system/BACKEND.md` (schema + mermaid erDiagram gestures ||--o{ gesture_recordings,
migration + backfill scripts, removed endpoints), `DECISIONS.md`, `DEBT.md` (open:
old `.sql` dumps are pre-normalization; `landmark_json` duplicates the disk files;
close/annotate 2, 6, 8, 71 (trigger_sync part), 72 (core_api part); the 62-NULL
asset_path item is resolved by Task 3), `INVENTORY.md`, `CLAUDE.md`/`UI.md` only where
schema wording is stale; `docs/reports/2026-09-24-db-normalization-step1.md` and
`docs/reports/2026-09-24-db-normalization-final.md`.
