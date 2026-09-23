# Backend Layer (PHP + MySQL)

## 1. Owns these files

- `php/connect.php` (13 lines)
- `php/auth.php` (95 lines)
- `php/admin_api.php` (196 lines)
- `php/api/core_api.php` (177 lines)
- `php/api/save_gesture.php` (702 lines, was 585 before the
  2026-09-23 gesture-categorization phase)
- `php/api/gesture_category.php` (44 lines, new in the gesture-categorization
  phase)
- `php/api/save_translation.php` (99 lines)
- `php/api/get_translations.php` (65 lines)
- `php/api/save_history.php` (24 lines)
- `php/api/get_history.php` (14 lines)
- `php/api/reports.php` (80 lines)
- `scratch/trigger_sync.php` (170 lines)
- `db-schema/database_setup.sql`
- `db-schema/sining_kamay_db_backup.sql`
- `sining_kamay_db.sql`

## 2. What it does

PHP 8 + MySQL (actual server per dump headers: **MariaDB 10.4.32**, `db-schema/sining_kamay_db_backup.sql:5`, `sining_kamay_db.sql:5` — "MySQL" in the brief is imprecise) endpoints for: user auth (`auth.php`), admin CRUD over users/history/gestures (`admin_api.php`), a "unified" data router for recordings/translations/gesture words (`core_api.php`), gesture-sample persistence including video transcoding (`save_gesture.php`), translation logging (`save_translation.php`, `get_translations.php`, `save_history.php`, `get_history.php`), and a read-only dictionary/report dump (`reports.php`).

Confirmed data-persistence/admin-only: no PHP file here touches MediaPipe/TensorFlow.js or the frame-classification loop. All are reached via `fetch()` from front-end JS/HTML after inference already happened client-side (see Section 6 for exact callers). This matches the brief's claim that PHP/MySQL is never in the live translation path.

## 3. How it works

**connect.php** (`php/connect.php:2-7`): hardcoded `$host="localhost"`, `$user="root"`, `$pass=""`, `$db="sining_kamay_db"`; opens `mysqli_connect`. No port specified in code (mysqli default 3306 — not specified in code).

**auth.php** — POST only (`php/auth.php:1-7`, OPTIONS short-circuited line 7). Body JSON `{action, ...}`. Actions: `register` (username/email/password, bcrypt via `password_hash`, line 54), `login` (identifier = username or email, `password_verify`, line 85). On every request it also runs `CREATE TABLE IF NOT EXISTS users` (lines 15-24) and seeds a default admin `admin`/`admin123` if none exists (lines 27-31).

**admin_api.php** — POST only. Body JSON `{action, requester_id, ...}`. Auth model: re-queries `users.role` for `requester_id` on every call (`php/admin_api.php:16-21`), no session/token. Actions: `get_users`, `create_user`, `update_user`, `delete_user` (users table), `get_history`/`delete_history`/`clear_history` (`translation_history`), `get_gestures`/`delete_gesture`/`clear_gestures` (`gestures`), `get_stats` (counts across `users`, `translation_history`, `gestures`).

**core_api.php** — POST only, 405 otherwise (`php/api/core_api.php:14`). Comment at line 2-6 self-describes as "Single entry-point for all Sining Kamay DB operations." Actions via `switch($action)` (line 49): `save_recording`/`get_recordings`/`delete_recording` → `gesture_recordings` (columns `gesture_type`, `sample_count`, `thumbnail`); `save_translation`/`get_translations`/`delete_translation` → `translations` using columns **`detected_word`, `language`, `full_sentence`** (lines 101, 110-111) — see Problem #1, these columns do not exist in any of the 3 SQL sources; `save_gesture_word` → `gesture_words`; `clear_store` → truncates one of `gesture_recordings`/`translations`/`gesture_words` by name map (line 149); `get_stats` → row counts of those 3 tables.

**save_gesture.php** — GET or POST (`php/api/save_gesture.php:440-446`; line numbers shifted from the earlier `386-392` cited elsewhere by the 2026-09-23 gesture-categorization phase). GET (no `action`) lists samples from disk (`list_samples`, line 385), and unless `?no_sync` is set, first runs `sync_disk_to_db` (line 390) which walks `saved_gestures/` and `saved_gestures_fsl/` JSON sample files and reconciles them into `gestures`, `esl_signs`/`fsl_signs`, `gesture_recordings`, deleting DB rows for files no longer on disk. A `?no_sync` GET still runs `ensure_gestures_columns()` (line 394, defined in `php/api/gesture_category.php:58`) so the `category` column exists before the response is built even on a not-yet-migrated DB. Both GET forms return a top-level `categories` key — `{"ESL": {label: category}, "FSL": {label: category}}` — built by `build_categories_map()` (lines 356-383; the SELECT is wrapped in `try/catch (Throwable)` at line 360 so a PHP 8.1+ `mysqli_sql_exception` also falls back instead of failing the request) from one `SELECT word, sign_language, category FROM gestures` query, falling back to the `gesture_category()` heuristic per label when a label has no DB row or the query itself fails. POST body JSON: `action="delete_gesture"` (label-based delete across disk + `gestures`/`gesture_recordings`/`esl_signs`/`fsl_signs`, lines 455-491) or default path: `{label|word, sign_language|dataset, frames[], video_base64?, video_path?, category?}` — frames capped `1..120` (error message says "expected 20-40 frames" though the actual code-enforced max is 120). `category` (line 501, `valid_gesture_category($body['category'] ?? null)`) is optional: invalid or missing means "use the heuristic on insert, leave an existing row's category alone on update" (`save_gesture_word_to_db()`, lines 71-122 — the `ON DUPLICATE KEY UPDATE ... category = IF(?, ?, category)` clause at line 85 only overwrites when the caller passed an explicit, non-null category). The response echoes the stored category back as `category` (line 648), read back from the DB (line 113) rather than recomputed, so it reflects the update-or-leave-alone rule exactly. Saves a JSON landmark sample file to `saved_gestures/<label>/sample_<ms>_<hex>.json` or the `_fsl` variant, format tag `mediapipe_hands_landmarks_v2`. If `video_base64` present, decodes and shells out to **ffmpeg** (see below) to produce `assets/signs/<en|fil>/<label>.mp4`, falling back to raw `.webm` if ffmpeg is unavailable or fails. Also has a hardcoded absolute Windows path `C:\Users\Techlife\OneDrive\Documents\New folder (5)\Sining_kamay\assets\signs\<subfolder>` that it copies videos into if that directory exists — developer-machine-specific, not Pi-portable.

**gesture_category.php** — no HTTP entry point of its own; `require_once`'d by `save_gesture.php` (`php/api/save_gesture.php:8`). Two pure functions, no DB/side effects: `gesture_category(string $label): string` — the word/letter/number/phrase heuristic (first match wins: all-digit or a closed English/Filipino number-word list → `number`; single `a-z` char → `letter`; contains `_` → `phrase`; else `word` — see `docs/system/DECISIONS.md` for the exact word list and measured counts) — and `valid_gesture_category($value): ?string` — lowercases/trims and returns the value only if it's one of the 4 valid categories, else `null`. Mirrored exactly in `js/gesture-category.js` (browser + Node, no DOM) for the Step 1 UI's Type selector; the two implementations are parity-tested (`tests/categorization/heuristic-parity.test.mjs`).

ffmpeg invocation (`php/api/save_gesture.php:522`):
```
"$ffmpeg -i <tempRawPath> -vf \"scale=360:-2\" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 -r 25 -an -b:v 300k <videoPath> -y 2>&1"
```
ffmpeg lookup order (`get_ffmpeg_path()`, lines 36-52): global `ffmpeg` via `shell_exec('ffmpeg -version 2>&1')`, else `<project root>/ffmpeg.exe`, `<project root>/bin/ffmpeg.exe`, or `C:\ffmpeg\bin\ffmpeg.exe`.

**save_translation.php** — POST only (405 otherwise, line 25). Body JSON: `source_type` (must be `sign_to_text`|`text_to_sign`, line 49-54), `sign_label`, `translated_text`, `language` (default `en-US`), `confidence` (float, nullable). Inserts into `translations(source_type, sign_label, translated_text, language, confidence)` (line 65-67) — matches the actual schema, unlike core_api.php's version of the same table.

**get_translations.php** — GET, query params `?limit=` (default 50, max 200, line 15), `?source_type=`, `?language=`. Parameterized `SELECT ... FROM translations`.

**save_history.php** — POST. Body JSON `{text, source}` (source default `'sign'`). Directly string-interpolates escaped values into SQL (line 18, see Problems).

**get_history.php** — GET, no params. Returns top 50 `translation_history` rows.

**reports.php** — GET, no params required. Dumps `esl_signs`, `fsl_signs` (both backfilling `asset_path` by checking `assets/signs/<en|fil>/<sign_key>.mp4` on disk if empty, lines 28-38, 46-56) and last 200 `translations`.

**scratch/trigger_sync.php** — standalone CLI/browser script, requires `php/connect.php` directly (line 2), duplicates `sync_disk_to_db` logic from an earlier version of `save_gesture.php` (only scans `saved_gestures/`, not the FSL folder) and echoes plain-text progress instead of JSON.

**Tables (identical structure across `db-schema/database_setup.sql`, `db-schema/sining_kamay_db_backup.sql`, and `sining_kamay_db.sql` — see Problems for the one real inconsistency found):**

- `esl_signs` / `fsl_signs`: `id INT PK AUTO_INCREMENT`, `sign_key VARCHAR(120) UNIQUE`, `sign_label VARCHAR(255)`, `text_value VARCHAR(255)`, `description TEXT NULL`, `asset_path VARCHAR(255) NULL`, `is_active TINYINT(1) DEFAULT 1`, `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP`, `INDEX idx_*_text_value(text_value)`. ENGINE=InnoDB, `utf8mb4`/`utf8mb4_general_ci` in both `.sql` dumps (`db-schema/sining_kamay_db_backup.sql` line region "esl_signs"; `sining_kamay_db.sql` same). `database_setup.sql` does not specify `ENGINE=` explicitly (defaults to server default — not specified in that file).
- `users`: `id PK`, `username VARCHAR(80) UNIQUE`, `email VARCHAR(150) UNIQUE`, `password_hash VARCHAR(255)`, `role ENUM('user','admin') DEFAULT 'user'`, `created_at TIMESTAMP`.
- `gestures`: `id PK`, `word VARCHAR(255)`, `sign_language VARCHAR(10) DEFAULT 'ESL'`, `category ENUM('word','letter','number','phrase') NOT NULL DEFAULT 'word'` (added 2026-09-23, `db-schema/database_setup.sql:89`; also added at runtime by `ensure_gestures_columns()`, `php/api/gesture_category.php:58-93` (moved there from `save_gesture.php` so it can be tested against a scratch table; optional `$table` parameter, default `'gestures'`; an ALTER that fails because a concurrent first request already added the column is tolerated by re-checking `column_exists()`), which runs a one-time `backfill_gesture_categories()` (`gesture_category.php:95`) — heuristic-tag every pre-existing row — in the same call that adds the column, never again), `created_at TIMESTAMP`, `UNIQUE KEY(word, sign_language)`.
- `gesture_words`: `id PK`, `word VARCHAR(255) UNIQUE`, `created_at TIMESTAMP`.
- `gesture_recordings`: `id PK`, `gesture_id INT NULL` (indexed, no FK constraint), `sign_language VARCHAR(10) DEFAULT 'ESL'`, `gesture_type VARCHAR(100)`, `sample_count INT DEFAULT 0`, `sample_path VARCHAR(255) NULL`, `landmark_json LONGTEXT NULL`, `thumbnail LONGTEXT NULL`, `recorded_at TIMESTAMP`, `INDEX(gesture_id)`, `INDEX(gesture_type)`.
- `translations`: `id PK`, `source_type VARCHAR(50)`, `sign_label VARCHAR(255)`, `translated_text VARCHAR(255)`, `language VARCHAR(20) DEFAULT 'en-US'`, `confidence DOUBLE NULL`, `created_at TIMESTAMP`.
- `translation_history`: `id PK`, `translated_text TEXT`, `source VARCHAR(50) DEFAULT 'sign'`, `created_at TIMESTAMP`.

No `FOREIGN KEY`/`CONSTRAINT` clauses appear anywhere in any of the 3 SQL sources (verified by direct grep of full `CREATE TABLE` blocks) — `gesture_recordings.gesture_id` is a plain indexed `INT`, referential integrity is enforced only in application code (e.g. `save_gesture.php` deletes children before parents).

## 4. Key decisions and why

- **core_api.php as "unified router" alongside single-purpose files**: the file's own header comment calls it "Single entry-point for all Sining Kamay DB operations" (`php/api/core_api.php:3`), yet `save_translation.php`/`get_translations.php`/`save_history.php`/`get_history.php`/`save_gesture.php` all exist separately and are what the front-end actually calls for those operations (see Section 6). Reason for the duplication/why core_api.php was never fully adopted: not documented in code — it reads as an incomplete "v2" consolidation attempt within this codebase's own history. (Note: an earlier draft of this document attributed this to "an abandoned earlier revision" per the system brief; that framing has since been corrected — see `docs/system/DEAD_CODE.md` and `archive/old-revision-docs/ORIGIN.md` — the dead build pipeline found elsewhere in this repo came from a separate project, not an earlier revision of this one. Whether core_api.php's abandonment is related is not documented in code.)
- **3 separate SQL sources**: `database_setup.sql` is a hand-written idempotent (`CREATE TABLE IF NOT EXISTS`) setup script with seed data (lines 38-60, 77-79 of that file); `sining_kamay_db_backup.sql` and `sining_kamay_db.sql` are `mysqldump` exports of the live MariaDB database at two points in time (2026-07-11 and 2026-07-15 per their trailing `-- Dump completed on` comments) containing real captured data. Why both dumps are kept / why one is UTF-16LE-encoded: not documented in code.

**Confirmed during Phase 2.5 local setup**: `sining_kamay_db.sql` (root of the
repo) is UTF-16-encoded — MySQL/MariaDB's `mysql`/phpMyAdmin import rejects it
outright without a charset conversion first. `db-schema/sining_kamay_db_backup.sql`
is plain ASCII and imports directly with no conversion step. Anyone setting up
a fresh local environment should import `db-schema/sining_kamay_db_backup.sql`,
not `sining_kamay_db.sql`, or expect to convert the latter's encoding first.
- **Prepared statements vs raw string interpolation coexist** (e.g. `save_translation.php`, `get_translations.php`, `save_gesture.php` use `mysqli_prepare`; `save_history.php`, `admin_api.php`, `auth.php`, `core_api.php`'s `clear_store`/`get_stats` build raw SQL strings, some with escaping and some without): reason not documented in code — looks like incremental authorship rather than a deliberate standard.
- **`sync_db_to_disk` explicitly disabled** (`php/api/save_gesture.php:219-225`): comment states disk is the authoritative source and restoring DB rows to disk caused deleted gestures to resurrect — a documented past bug fix, not a design principle stated up front.

## 5. Constraints

- No Raspberry-Pi-specific PHP/MySQL configuration appears in these files (no SQLite fallback, no explicit `mysqli` connection-pooling/persistent-connection setup, no Apache vhost/config file among owned files). `connect.php` opens a new `mysqli_connect` per request with no pooling (`php/connect.php:7`).
- `connect.php` credentials (`root`/empty password, `localhost`) and the "XAMPP default" comment (`php/connect.php:4`) indicate development targeted at a local XAMPP/Windows stack rather than a hardened Pi Apache/MySQL setup; no evidence in code of production hardening for the Pi deployment.

## 6. Touches

- **connect.php**: required by every other file in this set (`require_once __DIR__ . '/connect.php'` or `'/../connect.php'`). Breaking it (e.g. changing `$db` name) breaks all 10 endpoints at once.
- **auth.php**: touches `users` table only. No caller found in tracked frontend JS/HTML (verified via repo-wide grep for `auth.php`/"auth" endpoint patterns — only `docs/system/INVENTORY.md`, `.planning/...progress.md`, and `admin_api.php` itself reference it). Currently dead code; removing it breaks nothing observable in the frontend as shipped.
- **admin_api.php**: touches `users`, `translation_history`, `gestures`. No caller found in tracked frontend (same grep). Dead code as far as the shipped frontend is concerned; presumably meant for an admin dashboard that either was never built against it or was replaced by direct calls elsewhere.
- **core_api.php**: touches `gesture_recordings`, `translations`, `gesture_words`. Only confirmed caller is `js/db-local.js:9` ("points to unified api router"). If its `translations` INSERT/SELECT column names (`detected_word`/`full_sentence`) are changed to match the real schema, any code path that actually exercises `db-local.js`'s translation save/get would start working for the first time (currently it fails against schema — see Problems #1); if `core_api.php` is deleted, whatever front-end flow uses `db-local.js` for camera-translator recording/translation storage breaks.
- **save_gesture.php**: touches `gestures`, `esl_signs`/`fsl_signs`, `gesture_recordings`, disk folders `saved_gestures/`, `saved_gestures_fsl/`, `assets/signs/en|fil/`, and shells out to **ffmpeg.exe**. Confirmed callers: `js/script.js:849`, `js/gesture-data.js:7`, `js/gesture-training-ui.js:246`, `diagnostic.html:113`. Changing its request/response JSON shape breaks the gesture-recording UI in all four; removing ffmpeg breaks only the MP4 transcode (falls back to `.webm` automatically, lines 543-556).
- **save_translation.php / get_translations.php**: touch `translations` (real schema columns). Confirmed callers: `js/db-api.js:35` and `:75`.
- **save_history.php / get_history.php**: touch `translation_history`. No caller found in tracked frontend JS/HTML (grep-verified) — dead code as shipped.
- **reports.php**: touches `esl_signs`, `fsl_signs`, `translations` (read-only except for opportunistic `asset_path` backfill UPDATEs). Confirmed caller: `reports.html` (per system brief; endpoint itself has no auth/session check — any client can call it).
- **scratch/trigger_sync.php**: touches `gestures`, `esl_signs`, `gesture_recordings`, and `saved_gestures/` only (not the FSL folder) — a one-off/manual migration tool, not wired to any frontend caller.

## Problems found

1. **Schema/query mismatch (functional bug, not just doc drift)**: `php/api/core_api.php:101` and `:110-111` write/read `translations.detected_word`, `translations.full_sentence` — no such columns exist in `translations` in any of the 3 SQL sources (actual columns: `source_type, sign_label, translated_text, language, confidence` — confirmed identical in `db-schema/database_setup.sql:118-126`, `db-schema/sining_kamay_db_backup.sql`, and `sining_kamay_db.sql`). Any call to `core_api.php`'s `save_translation`/`get_translations`/`get_stats`(`translations` count is fine, but the recent-history style column read isn't used there) actions referencing those columns will fail with a MySQL "unknown column" error at `mysqli_stmt_execute`/`prepare` time. Since `js/db-local.js:9` is the only confirmed caller of `core_api.php`, this suggests that code path is currently broken or unexercised.
2. **Dead endpoints** (no caller found anywhere in tracked frontend, verified by repo-wide grep): `php/auth.php`, `php/admin_api.php`, `php/api/save_history.php`, `php/api/get_history.php`. Confirms the prior audit pass's claim.
3. **SQL injection risk** (raw string interpolation of user input into queries):
   - `php/api/save_history.php:18` — `$text`/`$source` are passed through `mysqli_real_escape_string` first (line 15-16), so this is escaped, not truly raw, but still string-built rather than parameterized.
   - `php/auth.php:56,62,64,83` — same pattern: escaped via `mysqli_real_escape_string` then interpolated.
   - `php/admin_api.php:19,56,59,65,83,87,99,106,111,132` — `$requesterId`/`$id` are cast with `intval()` first (safe), but string fields go through `mysqli_real_escape_string` then interpolation (same "escaped-but-not-parameterized" pattern throughout the file).
   - `php/api/save_gesture.php:428-429,432-433` — `$gestureId` is `(int)`-cast (safe) but concatenated directly into `DELETE ... WHERE id = $gestureId`; `$label` is passed through `mysqli_real_escape_string` at line 432-433 only (line 428 area) — consistent with the escape-then-concatenate pattern, not parameterized despite prepared statements being used elsewhere in the same file.
   - No unescaped/unparameterized raw concatenation of unsanitized user input was found in the 10 owned PHP files — all raw-SQL spots use either `intval()`/`(int)` casts or `mysqli_real_escape_string` before interpolation. Risk is inconsistency of style, not a confirmed live injection hole, but it is fragile (a future edit dropping the escape call would reintroduce one).
4. **Hardcoded DB credentials** (flag only, per instructions): `php/connect.php:2-5` — `$host="localhost"`, `$user="root"`, `$pass=""` (empty), `$db="sining_kamay_db"`. Comment marks it "XAMPP default" (line 4).
5. **Hardcoded developer-machine path**: `php/api/save_gesture.php:535,550` — `C:\Users\Techlife\OneDrive\Documents\New folder (5)\Sining_kamay\assets\signs\<subfolder>`. Will silently no-op (`is_dir()` false) on any machine other than the original developer's, including the Raspberry Pi target — dead/unportable code path, not a crash risk, but a leftover of individual dev environment.
6. **Default admin credential auto-seeded on every request**: `php/auth.php:27-31` — `admin`/`admin123` (bcrypt-hashed) inserted whenever no admin row exists; also duplicated as a static bcrypt hash seed in `db-schema/database_setup.sql:77-78`. Anyone reaching `auth.php` (currently unreachable from tracked frontend, see #2) could log in with these known default credentials if never changed.
7. **Inconsistent error-response shape** across endpoints: some return `{"success":false,"message":...}` (`auth.php`, `admin_api.php`, `core_api.php`'s "Unknown action"), others `{"error":...}` (`connect.php`, `save_translation.php`, `get_translations.php`, `save_history.php`), others `{"success":false,"error":...}` (`save_gesture.php`, `reports.php`). No shared contract; a frontend switching between endpoints must special-case each.
8. **Could not determine**: exact MySQL/MariaDB port (not specified anywhere in `connect.php` or the `.sql` files — mysqli default assumed but never stated in code); whether `sining_kamay_db_backup.sql`'s ANSI encoding is intentional or accidental (no code comment explains it); the actual production Apache vhost/config (no `.htaccess` or Apache config file among owned files to cite).

**Resolved in Phase 2** (see `docs/system/DEBT.md` items 3, 15): the two problems formerly numbered 6 and 8 here — the MyMemory network call and the file-wide `error_reporting(0)`/`display_errors=0` suppression — were both in `php/api/bulk_importer_api.php`, which was deleted along with `bulk-importer.html`.
