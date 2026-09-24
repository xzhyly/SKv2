Phase: DB normalization
Date: 2026-09-24
Status: DONE
Decision needed from owner: none (approved 2026-09-24: (a)–(e); delete core_api.php / js/db-local.js / scratch/trigger_sync.php; keep landmark_json; sample_path NOT NULL + UNIQUE and drop thumbnail; ON DELETE RESTRICT; additions A (CLI-only migration script) and B (separate asset_path backfill task))

# Step 1 proposal (saved from chat as presented)

I've investigated and stopped before any schema change. Nothing is altered; only the Step 0 seed line has been added to DECISIONS.md. Everything below was measured on the live MariaDB 10.4.32 (`sining_kamay_db`) and against the code.

## Starting facts, checked

| Fact | Result |
|---|---|
| `esl_signs`/`fsl_signs` mirror `gestures` one-to-one | ✅ 120 ESL / 89 FSL; 0 missing and 0 extra in both directions |
| `sign_key` = `sign_label` = `text_value` = the label | ⚠️ Not quite. `sign_label` and `text_value` are the label with `_` turned into spaces. Still derivable: 209/209 match that rule. |
| `description` is a constant | ✅ One value per language ("ESL user-added gesture sample.") |
| `asset_path` is the only unique data | ✅, but it can't be recomputed from the label: `one`…`ten` point at `1.webm`…`10.webm`. It's NULL on 62 rows, even though all 62 have a `.webm` on disk. The 147 non-NULL paths all point at real files. |
| `is_active` | Always 1. Only `reports.php` reads it, and Reports never shows it. |
| `updated_at`, `*_signs.created_at` | `updated_at` is NULL everywhere. `created_at` matches `gestures.created_at` on 205 rows and differs by 1 s on 4. |
| `gestures.sign_language` is `VARCHAR(10)` | ✅ Only the values ESL and FSL occur |
| `gesture_recordings.gesture_id` has no foreign key | ✅ The database has no foreign keys at all. 0 orphans and 0 NULL `gesture_id`. |
| Recordings' `gesture_type`/`sign_language` duplicate `gestures` | ✅ Both equal the joined gesture's values on 210/210 rows |
| `sample_count` is the frame count | ✅ Equals the length of `landmark_json.frames` on 210/210 rows (e.g. `ask` = 12) |
| 210 recordings / 209 gestures, `start` has 2 | ✅ |

**New findings:**
- **`thumbnail`** is NULL on all 210 rows. Only the dead `core_api.php` writes or reads it.
- **`landmark_json`** holds 9.46 MB, most of the dump, and nothing reads it. It's a copy of each sample's JSON file on disk.
- **`sample_path`** is set and distinct on all 210 rows, but has no index. The sync looks every sample file up by this column, so each lookup scans the whole table.
- **Let's Talk doesn't read `asset_path`.** `sign-player.js` only gets labels from `?no_sync=1` and looks for `assets/signs/<lang>/<label>.webm` directly, so it's unaffected.

## (a) Target schema

```sql
CREATE TABLE `gestures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(255) NOT NULL,                         -- was `word`
  `sign_language` enum('ESL','FSL') NOT NULL DEFAULT 'ESL',  -- was varchar(10)
  `category` enum('word','letter','number','phrase') NOT NULL DEFAULT 'word',
  `asset_path` varchar(255) DEFAULT NULL,                -- moved from *_signs, values kept exactly
  `is_active` tinyint(1) NOT NULL DEFAULT 1,             -- moved from *_signs
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gestures_label_language` (`label`,`sign_language`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `gesture_recordings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `gesture_id` int(11) NOT NULL,                         -- was NULL-able; 0 NULLs today
  `frame_count` int(11) NOT NULL DEFAULT 0,              -- was `sample_count`
  `sample_path` varchar(255) NOT NULL,                   -- was NULL-able; 0 empty, 210 distinct
  `landmark_json` longtext DEFAULT NULL,
  `recorded_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gesture_recordings_sample_path` (`sample_path`),
  KEY `idx_gesture_recordings_gesture` (`gesture_id`),
  CONSTRAINT `fk_gesture_recordings_gesture` FOREIGN KEY (`gesture_id`)
    REFERENCES `gestures` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
-- dropped: sign_language, gesture_type (+ its index), thumbnail

-- translations, users: unchanged (current DDL kept as-is)
-- esl_signs, fsl_signs: dropped
```

Why each choice differs from, or adds to, your proposal:
- **`ON DELETE RESTRICT`, not CASCADE.** The live code already deletes a label's recordings before the gesture row, in both `delete_gesture` and the sync. RESTRICT keeps that behaviour and turns any future bug into an error instead of a silent orphan.
  - Side effect: `admin_api.php`'s dead `delete_gesture`/`clear_gestures` would now fail, where today they leave orphaned recordings. `TRUNCATE` isn't allowed on a table a foreign key points to.
- **`sample_path` NOT NULL + UNIQUE (my addition).** The sync decides whether a sample is already in the DB by `sample_path`, so the constraint enforces what the code already assumes, and the index removes one full-table scan per sample file.
- **Drop `thumbnail` (my addition).** No data, and no live reader or writer.
- **Keep `landmark_json` (recommended).** Inside the DB it isn't duplicated: it's the recording's own content, which normalization doesn't require removing. It is a copy of the disk file, but dropping it deletes 9.46 MB outside your proposal. Say if you want it gone.
- **Dropped from `*_signs`:** `description` (constant), `sign_label`/`text_value` (derived from the label), `updated_at` (all NULL), and their own `id`/`created_at`.

## (b) Rename decision: **(a) full rename**

| Name | Live references | Archive |
|---|---|---|
| `gestures.word` (column) | 27: PHP 9 (`save_gesture.php` 7, `gesture_category.php` 2), tests 13, `database_setup.sql` 2, `scratch/trigger_sync.php` 3. **JS: 0** | 0 |
| `sample_count` | 7 (`database_setup.sql` 1, `save_gesture.php` 2, `core_api.php` 2, scratch 2). JS: 0 | 0 |
| `gesture_type` | 11 (`database_setup.sql` 2, `save_gesture.php` 3, `core_api.php` 2, scratch 3, tests 1). JS: 0 | 0 |
| recordings `sign_language` | 8 (`save_gesture.php` 3, scratch 3, `database_setup.sql` 1, tests 1). JS: 0 | 0 |
| `esl_signs` / `fsl_signs` | 13 each (`database_setup.sql`, `save_gesture.php`, `reports.php`, `reports.html`, scratch) | 0 |

**Why (a):**
- No live JS reads `word`, `sample_count` or `gesture_type` from an API response. The dataset GET already sends `label`, from disk plus the `categories` map. Only the dead `admin_api.php`/`core_api.php` would expose those names. So renaming everywhere costs nothing on the JS side.
- The one JSON consumer that changes is `reports.html`: 6 references to `sign_key`/`sign_label`/`text_value` and the `esl_signs`/`fsl_signs` keys. It has to change anyway because those tables disappear. Aliasing the old names, option (b), would keep naming tables that no longer exist.
- **Reports keeps the same visible columns.** Key, Label and Text are all computed from `label` (spaces for underscores, 209/209 identical to today).
- **Two visible differences on Reports:**
  - The ID column shows `gestures.id` instead of the old `esl_signs.id`.
  - `created_at` differs by up to 1 s on 4 rows.

## (c) Migration order

MariaDB commits every schema change immediately, so the whole migration can't be one transaction. Instead it will be a one-time PHP script, `db-schema/migrations/2026-09-24-normalize.php`, built so an interruption at any point can be fixed by re-running it:
- **Each step checks whether it's already done** (via information_schema), so re-running picks up where it stopped.
- **Data is copied before anything is dropped, and the drops happen last.** They run only after a full comparison against a snapshot passes.
- **Snapshot:** before step 1, it saves a JSON file to `E:\ACADSS\IOT\backups\`, not the repo. For every label it records the category, created_at, asset_path and is_active; for every recording its id, label/language, path, frame count, recorded_at and an MD5 of `landmark_json`.

Steps (A = the old code still works afterwards, B = breaks the old code):
1. **A:** Check the server is MariaDB and write the snapshot.
2. **A:** Add `gestures.asset_path` and `is_active`, then copy them from `*_signs` (joined on label and language).
3. **A:** Change `sign_language` to the ENUM, after confirming only ESL/FSL occur.
4. **A:** Make `gesture_id` NOT NULL and add the foreign key, after confirming 0 orphans and 0 NULLs.
5. **A:** Make `sample_path` NOT NULL and UNIQUE, after confirming 0 empty and 0 duplicates.
6. **B:** Rename `word`→`label` and the unique key; rename `sample_count`→`frame_count`.
7. **Check:** re-copy `asset_path`/`is_active` from `*_signs`, then compare every label and every recording against the snapshot. Any difference stops the script here.
8. **B:** Drop `gesture_type` (and its index), recordings' `sign_language`, and `thumbnail`, after confirming `thumbnail` is all NULL.
9. **B:** Drop `esl_signs` and `fsl_signs`.
10. **Check:** compare against the snapshot again and print `SHOW CREATE TABLE`.

To undo, re-import the backup with `mysql.exe`.

**Test first on a copy.** Task 1 imports the backup into a scratch database, `sining_kamay_db_migtest`. There it runs the migration, runs it again (must do nothing), interrupts it after each step in turn and resumes, and compares everything. Then the scratch database is dropped. The live DB isn't touched in Task 1.

**Switching the live DB over is one task (Task 2):** backup → migration on live → new code → tests pass. Apache serves the working tree directly, so between the migration and the code change the local app is briefly broken. That's minutes on the dev PC, and no kiosk is running from it.

**How the sync code changes** (`save_gesture.php`, `gesture_category.php`):
- Remove the table-creation code for `*_signs` (`ensure_language_dataset_table`), the old `CREATE TABLE gesture_recordings` definition, and the `ALTER … ADD sign_language` on recordings. Nothing will recreate a dropped table or column.
- The save path writes `asset_path` with `UPDATE gestures SET asset_path = COALESCE(?, asset_path)`, the same "don't overwrite with nothing" rule as the old `IFNULL`.
- The sync's cleanup deletes for `*_signs` go.
- `ensure_gestures_columns` stays, for `category`, but uses `label` and the ENUM.
- Rows are inserted with `(gesture_id, frame_count, sample_path, landmark_json)`.
- The dataset GET response shape doesn't change.

## (d) Files

**Changed:**

| File | Why |
|---|---|
| `db-schema/database_setup.sql` | Final schema; `*_signs` tables and their seed rows removed |
| `db-schema/migrations/2026-09-24-normalize.php` (new) | The one-time migration described above |
| `php/api/save_gesture.php` | Sync, save, delete and GET move to `label`/`frame_count`; `asset_path` goes to `gestures`; code that could recreate old tables/columns removed |
| `php/api/gesture_category.php` | Its column-check and backfill use `label` and the ENUM |
| `php/api/reports.php` | ESL/FSL tabs read `gestures`; the `.mp4` backfill writes `gestures.asset_path` |
| `reports.html` | 6 field names; the visible columns stay the same |
| `tests/categorization/save-category.test.mjs`, `list-categories.test.mjs` | `word`→`label`; the cleanup that deleted by `gesture_type` goes |
| `tests/normalization/migration.test.mjs` (new) | Copy-DB, re-run and interruption tests for the migration |
| **Delete** `php/api/core_api.php` and `js/db-local.js`, plus the `<script>` tag in `gesture-training.html` | No callers; they reference `gesture_type`, `sample_count` and `thumbnail`, which this phase drops. Also closes DEBT 2 and 6, and the `core_api.php` half of DEBT 72. Alternative: strip just the recording actions from `core_api.php`, but it would still be dead code with wrong translation columns. |
| **Delete** `scratch/trigger_sync.php` | If run, it would recreate `esl_signs` and the old columns, which breaks the "nothing recreates dropped schema" rule. Dead dev script (DEBT 8/71). |

**Not changed, with evidence:**

| File | Why not |
|---|---|
| `js/gesture-training-ui.js`, `js/gesture-data.js` | The dataset GET response shape stays the same |
| `js/sign-player.js` | Never reads `asset_path`; looks for `.webm` files directly |
| `js/db-api.js`, `save_translation.php`, `get_translations.php` | `translations` is unchanged |
| `php/admin_api.php` | `SELECT *` and delete-by-id still work. Its gesture delete/clear now fail because of the foreign key (dead endpoint, DEBT 72 stays open) |
| `diagnostic.html` | Only checks the GET's `success` |
| `talk.html` | Nothing in the DB |
| `tests/multi-sample/*` | Cleans up through the `delete_gesture` action, with no column references |
| `tests/categorization/db.mjs`, `php-heuristic`, `heuristic-parity` | No schema references |
| Everything on your must-not-change list | Untouched |

**Docs:** `BACKEND.md` (schema and a mermaid ER diagram; there is no `05-BACKEND.md`), `DECISIONS.md`, `DEBT.md`, `INVENTORY.md`. `CLAUDE.md` and `UI.md` only if their schema wording is stale (that gets checked in Task 5).

## (e) Tasks

1. **Migration script, tested on a copy only.**
   - Done when, on `sining_kamay_db_migtest`:
     - the final schema matches (a) exactly;
     - the snapshot comparison finds 0 differences over all 209 labels and 210 recordings;
     - a second run changes nothing;
     - an interruption after each step, then a resume, ends in the same state.
   - The scratch database is dropped afterwards, and the live DB is untouched.
2. **Switch the live DB over.**
   - Backup with XAMPP's `mysqldump.exe` to `E:\ACADSS\IOT\backups\sining_kamay_db_before-normalization.sql` (size reported), then the migration on live, then the new `save_gesture.php`, `gesture_category.php`, `reports.php`, `reports.html` and test updates.
   - Done when:
     - the live snapshot comparison finds 0 differences;
     - the category split is unchanged (ESL 67/26/10/17, FSL 50/0/10/29);
     - there are 210 recordings, every label has the same recording count, and there are 0 orphans;
     - the foreign key is present;
     - the serial test suite is green.
3. **Remove dead code and finalize `database_setup.sql`.**
   - Covers the `core_api.php`/`db-local.js`/`trigger_sync.php` deletions and the `<script>` tag.
   - Done when `database_setup.sql`, loaded into a fresh scratch database, produces `SHOW CREATE TABLE` output matching live (ignoring auto-increment counters). Tests stay green.
4. **Live browser checks, done by me** at 1024×600, 0 console errors across:
   - all 4 gesture-training steps, including the dataset modal's tabs and search;
   - Let's Talk text-to-sign video playback;
   - Reports: all tabs, including "View asset";
   - a save → second sample → reload/sync round trip, where both recordings sit under one gesture.

   `git diff --stat` must match (d).
5. **Docs**, in a separate commit.
   - New DEBT items:
     - `asset_path` is NULL on 62 labels whose `.webm` exists, so Reports hides "View";
     - the old `.sql` dumps in the repo are pre-normalization and need the migration after import;
     - `landmark_json` copies the disk files, if you keep it.
   - Items to close: DEBT 2, 6, the `trigger_sync` part of 71, and the `core_api` part of 72.

A whole-phase review runs at the end.

**What I need from you:** approval of (a)–(e), plus three choices where I've given a recommendation:
1. Delete `core_api.php`, `js/db-local.js` and `scratch/trigger_sync.php` (recommended), or only edit them?
2. Keep `landmark_json` (recommended), or drop it?
3. `sample_path` NOT NULL + UNIQUE, and dropping `thumbnail`: yes (recommended) or no?
