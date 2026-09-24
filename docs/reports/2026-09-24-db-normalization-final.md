Phase: DB normalization
Date: 2026-09-24
Status: DONE
Decision needed from owner: none. Two things to note before the Pi is updated: follow the fresh-machine setup route (DEBT 73), and play one Let's Talk text-to-sign clip by hand (see "Left undone").

# DB normalization — final report

The live MariaDB 10.4.32 database (`sining_kamay_db`) is now 4 normalized tables: `gestures`, `gesture_recordings`, `translations` and `users`. No data was lost. The code, the setup script and the docs all match that schema.

Nothing is pushed or merged.

Code commits (`ad12fc5..b36d38d` on `revision`):

| Commit | What it does |
|---|---|
| `80ee601` | Migration script and clone-only tests |
| `5753769` | Migration: strict compare, row-count checks, step-8 guard, test cleanup |
| `c6182d0` | Live cutover: backup, migration, code switch |
| `2f2137a` | `asset_path` backfill |
| `5a529e9` | Deletes dead code; finalizes `database_setup.sql` |
| `bd7810e` | Migration tests clone from the pre-normalization backup |
| `1de77ac` | `database_setup.sql` uses `IF NOT EXISTS`, so it can be re-run |
| `b36d38d` | Schema-guard regression tests, dump guard, check on a `reports.php` prepare call |

Docs are in the separate docs commit that includes this file.

## Row counts, before and after

"Before" was measured on 2026-09-24 in Step 1 and stored in the migration snapshot. "After" was measured on 2026-09-25 through `php/connect.php`. Each gesture was compared against the snapshot `E:\ACADSS\IOT\backups\normalization-snapshot-sining_kamay_db.json`, matched on label and language.

| Measure | Before | After |
|---|---|---|
| Tables | 6 (`esl_signs`, `fsl_signs`, `gestures`, `gesture_recordings`, `translations`, `users`) | 4 (`gestures`, `gesture_recordings`, `translations`, `users`) |
| `gestures` rows | 209 | 209 (0 missing vs snapshot) |
| Category split, ESL | word 67 / letter 26 / number 10 / phrase 17 | word 67 / letter 26 / number 10 / phrase 17 |
| Category split, FSL | word 50 / letter 0 / number 10 / phrase 29 | word 50 / letter 0 / number 10 / phrase 29 |
| Category differences vs snapshot (includes manual re-tags) | — | 0 of 209 |
| `gesture_recordings` rows | 210 | 210 |
| Labels whose recording count differs from before | — | 0 of 209 (`start` still has 2) |
| Orphan recordings | 0 | 0 |
| Foreign keys | 0 | 1: `fk_gesture_recordings_gesture`, DELETE_RULE `RESTRICT` |
| `asset_path` set | 147 (in `esl_signs`/`fsl_signs`) | 209: 147 unchanged, including `one`…`ten` → `1.webm`…`10.webm`; 62 filled by the backfill; 0 other |
| `is_active` differences vs snapshot | — | 0 of 209 (all 1) |
| `esl_signs` / `fsl_signs` rows | 120 / 89 | tables dropped |
| `translations` / `users` rows | 0 / 1 | 0 / 1 (unchanged) |

## Rename decision: (a) full rename

`gestures.word` became `label` and `gesture_recordings.sample_count` became `frame_count`, in the DB, the PHP and the tests.

Reason: no live JS reads `word`, `sample_count` or `gesture_type` from any API response; the dataset GET already sent `label`. The only JSON consumer affected was `reports.html`, with 6 references, and it had to change anyway because its source tables were dropped.

Reference counts are in `docs/reports/2026-09-24-db-normalization-step1.md`, section (b).

The only visible changes, both on Reports:
- The ID column now shows `gestures.id`.
- `created_at` now comes from `gestures`; on 4 rows it differs by up to 1 s from the old value.

## Final SHOW CREATE TABLE (live, `AUTO_INCREMENT=N` removed)

MariaDB leaves `ON DELETE RESTRICT` out of this output because it's the default. The rule is confirmed separately: `information_schema.REFERENTIAL_CONSTRAINTS.DELETE_RULE = RESTRICT`.

`db-schema/database_setup.sql` produces the same DDL. That was checked by loading it into a scratch database and comparing all 4 tables with live. Loading it a second time also succeeds, so it can be re-run.

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
  CONSTRAINT `fk_gesture_recordings_gesture` FOREIGN KEY (`gesture_id`) REFERENCES `gestures` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `translations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `source_type` varchar(50) NOT NULL,
  `sign_label` varchar(255) NOT NULL,
  `translated_text` varchar(255) NOT NULL,
  `language` varchar(20) NOT NULL DEFAULT 'en-US',
  `confidence` double DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(80) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('user','admin') DEFAULT 'user',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

The ER diagram (mermaid, `gestures ||--o{ gesture_recordings`) is in `docs/system/BACKEND.md`.

## Review rounds per task

Each task had a fresh implementer and a task reviewer. No task needed more than 2 rounds, so nothing was escalated.

| Task | Rounds | What happened |
|---|---|---|
| 1. Migration script, tested on a clone | 2 | Round 1 (most capable model): 1 Important. The step-7 "verify before drop" check was never shown to stop a run. Plus 7 Minors. All fixed in `5753769`; round 2 approved. |
| 2. Live cutover | 1 | Approved with no issues. |
| 3. `asset_path` backfill | 1 | Approved. The first implementer ran the backfill on live, then the session was interrupted before it could report or commit. A second implementer checked the live result against the snapshot and committed. The reviewer re-derived 147 unchanged, 62 filled, 0 NULL independently. |
| 4. Dead code and `database_setup.sql` | 2 | Round 1: 1 Important. A bare `CREATE TABLE` made the setup script fail when re-run. Fixed in `1de77ac`; round 2 approved. |
| 5. Live browser checks (by me) | — | See "Verification". |
| 6. Docs | — | This commit. |
| Whole-phase review (most capable model) | 1 fix + re-review | 0 Critical, 2 Important. (1) Setting up a fresh machine or the Pi → documented (DEBT 73, BACKEND.md). (2) No automated guard for "the sync never recreates the old schema" or for "a POST without video leaves `asset_path` alone" → added `tests/normalization/schema-guard.test.mjs` in `b36d38d`. The first fix attempt was stopped by an API usage limit before it changed anything; the retry landed. Re-review: the code is ready to merge. |

## Backup

- `E:\ACADSS\IOT\backups\sining_kamay_db_before-normalization.sql`: **9,828,807 bytes**. Made with `C:\xampp\mysql\bin\mysqldump.exe` before any schema change. It contains `CREATE TABLE` for all 6 pre-migration tables.
- Snapshot: `E:\ACADSS\IOT\backups\normalization-snapshot-sining_kamay_db.json`, 111,492 bytes. Besides the backup, it is the only record of the data before the migration, so keep it.

Running `--verify-only` against live now always reports exactly 62 `asset_path` differences. Those are the backfill, so they're expected and don't mean data was lost.

## Verification (measured)

- **Tests:**
  - `node --test --test-concurrency=1 tests/categorization/*.test.mjs tests/multi-sample/save-endpoint.test.mjs`: 31/31.
  - `tests/normalization/migration.test.mjs`: 13/13, run against clones of the backup; the live DB was unchanged afterwards.
  - `tests/normalization/schema-guard.test.mjs`: 3/3, against live.
  - All from the implementers' runs on the final code, as reported in `b36d38d`'s fix report.
- **Browser, at 1024×600, 0 console errors:**
  - Gesture training: Steps 1–4 render. The dataset modal's tabs and search work. `trainModel` finishes with 120 ESL gestures ("Compiled").
  - Reports: 120 / 89 / 0. "View" on `angry`, a previously NULL row, opens `angry.webm` at readyState 4. `one` still points at `1.webm`.
- **Save → second sample → full sync:** a test FSL label ended with 1 `gestures` row and 2 `gesture_recordings` rows (frame_count 4, 4), still correct after a full sync. It was deleted afterwards: 209/210, 0 `zz` rows left.
- **`git diff --stat ad12fc5..b36d38d`:** only the approved files. Those are the 15 files listed in the plan's approved scope, plus `tests/normalization/schema-guard.test.mjs`, which falls under `tests/normalization/`.

## Left undone (logged as DEBT)

- **DEBT 73 (Medium):** the two tracked `.sql` dumps are from before normalization and can't be imported with the current code, and the migration script can't convert them. Before updating the Pi, follow `docs/system/BACKEND.md` → "Schema migration and fresh-machine setup (2026-09-24)". The recommended route is to dump the migrated live DB and import that.
- **Let's Talk text-to-sign playback was only half verified.** The clip resolves and loads (`assets/signs/en/hello.webm`, readyState 4, no error), but the browser pane was hidden (`document.hidden = true`), so I couldn't watch playback continue to the next word. `sign-player.js` never reads a DB column; it only reads the label list from the unchanged `?no_sync=1` response. Please play one sentence by hand on the kiosk.
- **DEBT 74:** `landmark_json` duplicates each sample file on disk (about 9.46 MB). Kept, per your decision.
- **DEBT 75:** Reports only fills in a missing `asset_path` when a `.mp4` exists, so gestures added later with only a `.webm` stay NULL. This behaviour predates the phase.
- **DEBT 76:** the POST reports `dbGestureCreated: true` even when the row already existed. This predates the phase.
- **DEBT 77:** tester note. `talk.html`'s idle return (120 s + 30 s) sends slow automated sessions back to the dashboard. It isn't a bug.
- **Still open, unchanged:**
  - DEBT 65: category is stored only in the DB.
  - DEBT 68: MariaDB runs standalone, not as a Windows service.
  - DEBT 71: `delete_gesture` looks up by label only, not language.
  - DEBT 72: `admin_api.php` has no real authentication. Its gesture delete and clear actions now fail because of the foreign key, which is safer.
- **Closed or partly closed by this phase:**
  - DEBT 2 and DEBT 6: closed (`core_api.php` and `db-local.js` deleted).
  - DEBT 8: the `core_api`/`db-local` part.
  - DEBT 71: the `trigger_sync.php` part.
  - DEBT 72: the `core_api.php` half.
- **Minor review notes left as-is:**
  - The schema-guard's RED proof broke an assertion, not the app code.
  - One schema-guard test title is inaccurate (`schema-guard.test.mjs:78`).
  - The clone helper's dump guard has no test of its own.
  - A failed prepare in the `reports.php` fallback is skipped silently.
