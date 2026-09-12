# Technical Debt

Every problem found during the audit, ranked by severity. Sourced from
`docs/system/INVENTORY.md` (Pass 1) and the five Pass 2 layer documents; every
citation is file:line, carried over from wherever it was originally found. Dead
code and oversized files get their own sections at the end rather than being
interleaved by severity, per the audit's scope.

Two items are recorded here with an explicit correction from the project owner,
so a later session does not re-litigate them:

- The **dual-screen gap** (below) is planned work, not a defect.
- The **Google Fonts CDN calls** (below) are a confirmed real defect, ranked high.

## High severity

1. **Google Fonts CDN calls fail on every page load.** The kiosk has no internet
   access, so these requests fail every time. 7 of 8 root HTML files load
   `https://fonts.googleapis.com/...`: `index.html:13`, `camera-translator.html:7`,
   `sign-to-text.html:7`, `gesture-training.html:7`, `bulk-importer.html:7`,
   `reports.html:7`, `learn-signs.html:7`. (Originally 9 of 12 files, including
   `camera_test.html:7` and `gesture_test.html:7` — both deleted in Phase 1 as
   dead code, see `docs/system/DEAD_CODE.md`.)
   Confirmed by the project owner as a real, high-severity defect — not a
   doc/code mismatch to shrug off.

2. **Confirmed functional bug: `core_api.php` writes/reads columns that don't
   exist in the schema.** `php/api/core_api.php:101,110-111` reads/writes
   `translations.detected_word` and `translations.full_sentence` — no such
   columns exist in the `translations` table in any of the 3 SQL sources (actual
   columns: `source_type, sign_label, translated_text, language, confidence`,
   confirmed identical across `db-schema/database_setup.sql:118-126`,
   `db-schema/sining_kamay_db_backup.sql`, and `sining_kamay_db.sql`). Since
   `js/db-local.js:9` is the only confirmed caller of `core_api.php`, and
   `db-local.js`'s own functions are never actually called by any owned UI file
   (see item 6 below), this path is currently broken and likely unexercised in
   practice — but it will throw a MySQL "unknown column" error the moment
   anything does call it.

3. **Offline requirement violated by a live network call.**
   `php/api/bulk_importer_api.php:378-385` calls the public MyMemory translation
   API (`https://api.mymemory.translated.net/get`, 5s cURL timeout) over HTTPS
   when an FSL label isn't in a hardcoded local dictionary
   (`bulk_importer_api.php:207-371`). Contradicts "fully offline, no
   internet/CDN/external API."

4. **Hardcoded DB credentials + auto-seeded default admin account.**
   `php/connect.php:2-5` — `root`/empty password, marked "XAMPP default" in a
   comment (line 4). Separately, `php/auth.php:27-31` inserts a default
   `admin`/`admin123` (bcrypt-hashed) account whenever no admin row exists, and
   the same static hash is seeded in `db-schema/database_setup.sql:77-78`.
   `auth.php` currently has no frontend caller (see Dead Code Not Deleted,
   below), but the credential is real and sitting in the schema either way.

5. **Full production DB dump committed to source control, including password
   hashes.** `sining_kamay_db.sql` (19,659,000 bytes) and
   `db-schema/sining_kamay_db_backup.sql` (2,648,411 bytes) are `mysqldump`
   exports of the live database containing real `users.password_hash` values and
   translation history, tracked in git. Not flagged by any Pass 2 agent as
   "assessed for exploitability" — noted here as a data-hygiene/security concern
   for the project owner to decide on, consistent with the instruction to flag
   rather than fix.

## Medium severity

6. **`js/db-local.js` is loaded everywhere but never used.** Loaded by
   `camera-translator.html`, `sign-to-text.html`, and `gesture-training.html`,
   but none of its exported functions (`saveRecording`, `getAllRecordings`,
   `deleteRecording`, `saveTranslation`, `getAllTranslations`,
   `deleteTranslation`, `saveGestureWord`, `clearStore`, `getDBStats`) are called
   from any of them (`docs/system/UI.md` Part 1, §4). Costs parse/load time on
   every screen for no effect.

7. **Three incompatible hardcoded deployment-path conventions coexist.**
   - `js/script.js:847-849` dynamically detects `/SKR` vs `/Sining_kamay` in
     `location.pathname`.
   - `js/db-api.js:11`, `js/db-local.js:9`, `js/gesture-data.js:6`,
     `js/gesture-training-ui.js:245,1065` hardcode `/Sining_kamay/` only, with no
     `/SKR` awareness.
   - `reports.html:613-615` hardcodes `/Sining_kamay/` and branches on
     `location.port` instead of pathname.
   - `start_kiosk.sh:17` actually serves the app at `/SKR/index.html`.
   - `raspberry_pi_startup_guide.md:47,52,62,67,72,77,82` describe yet another
     convention: `/Sining_kamay/` and `/var/www/html/Sining_kamay/`.
   Five different answers to "what folder is this deployed under," only one of
   which (`script.js`) actually checks for the real current folder name.

8. **Unused backend endpoints with a live default-admin credential sitting
   behind them.** `php/auth.php`, `php/admin_api.php`, `php/api/save_history.php`,
   `php/api/get_history.php` have no caller anywhere in the tracked frontend
   (confirmed independently by Pass 1 grep and the Pass 2 Backend subagent).
   Not included in the deletion manifest because removing a backend endpoint is a
   bigger decision than removing a vendored binary — see
   `docs/system/DEAD_CODE.md`.

9. **SQL built by escape-then-concatenate instead of parameterized queries, in a
   file that also uses prepared statements elsewhere.** `php/api/save_history.php:18`,
   `php/auth.php:56,62,64,83`, `php/admin_api.php:19,56,59,65,83,87,99,106,111,132`,
   `php/api/save_gesture.php:428-429,432-433` — values are escaped
   (`mysqli_real_escape_string`) or cast (`intval()`/`(int)`) before
   interpolation, so no confirmed live injection hole was found, but the
   inconsistency with the prepared-statement style used elsewhere in the same
   files makes it fragile — a future edit dropping one escape call reintroduces a
   real hole.

10. **Hardcoded developer-machine path, dead on the actual target hardware.**
    `php/api/save_gesture.php:535,550` — `C:\Users\Techlife\OneDrive\Documents\New
    folder (5)\Sining_kamay\assets\signs\<subfolder>`. Silently no-ops via
    `is_dir()` check on any machine other than the original developer's,
    including the Raspberry Pi target — not a crash risk, but dead weight.

11. **Duplicated, drifted code across `camera-translator.html` and the shared
    JS/CSS files it doesn't load.** `camera-translator.html` does not load
    `js/camera-helper.js`, `js/speech-synthesis.js`, or `css/sign-to-text.css` —
    it carries its own inline copies of `initCameraWithFallback`,
    `extractFeatures`, `speakWord`, and most of `sign-to-text.css`'s class rules
    (`camera-translator.html:14-198,997-1011,1043-1124,1493-1500`), and those
    copies have already diverged from the shared versions (e.g. camera-translator's
    `speakWord` ignores the volume setting that `js/speech-synthesis.js` respects;
    `.tl-output-box` font-size is 18px inline vs 26px in `css/sign-to-text.css`).
    Editing the shared files will silently not affect this screen.

12. **A whole block of `camera-translator.html` is duplicated verbatim.**
    `camera-translator.html:1380-1433` and `:1438-1491` — `getWordBank`,
    `tlSetLang`, `addCustomWord` (including its `keydown` listener),
    `removeCustomWord`, `renderWordChips`, `renderTranslation` all appear twice,
    including a repeated `// STEP 4 — TRANSLATE (training UI)` header comment; the
    `wordInput` keydown listener is attached twice as a result.

13. **Half-migrated dual-view design in `sign-to-text-ui.js`.**
    `js/sign-to-text-ui.js:380-382,410-413,420-422,792-797` reference DOM elements
    (`#tlVideo2`, `#tlPredEmoji2`, `#tlPredLabel2`, `#tlPredOverlay2`,
    `#tlLangEn2`, `#tlLangFil2`) that do not exist anywhere in `sign-to-text.html`.
    Calls are null-guarded so this fails silently rather than erroring.

14. **Misleading "epochs" UI in gesture training.** `gesture-training-ui.js:17`
    defines `const EPOCHS = 50` and the HTML shows "0 / 50 epochs"
    (`gesture-training.html:295`), but `trainModel()`
    (`gesture-training-ui.js:422-562`) is a KNN cache-merge with a cosmetic
    10-or-20-step progress animation, not a 50-epoch neural-net training run. The
    `EPOCHS` constant is otherwise unused in the file. Confusing to an operator
    watching the number, not a functional bug.

15. **`error_reporting(0)` / `display_errors=0` disabled repo-wide for one file.**
    `php/api/bulk_importer_api.php:3-4` — intended to keep warnings out of JSON
    responses, but also hides genuine bugs in that file, not just formatting
    noise.

16. **No shared error-response contract across PHP endpoints.** Three different
    JSON error shapes are in use: `{"success":false,"message":...}`
    (`auth.php`, `admin_api.php`, `core_api.php`), `{"error":...}`
    (`connect.php`, `save_translation.php`, `get_translations.php`,
    `save_history.php`), and `{"success":false,"error":...}` (`save_gesture.php`,
    `bulk_importer_api.php`, `reports.php`). Any frontend code switching between
    endpoints must special-case each shape.

17. **Stale CSS rules matching a redesigned-away dashboard.**
    `css/style.css:458-493,507-596` style classes (`.title-sining`, `.title-kamay`,
    `.dash-btn`, `.button-container`, `#dashboard-pane { grid-template-columns
    }`) that don't exist anywhere in current `index.html` markup, which uses
    `.system-title`, `.card-btn`, and a flex-based `.card-container` instead.

18. **`js/vosk.js` is effectively unreadable/undiffable.** Line 174 is a single
    ~5.6-million-character line containing a base64-encoded Web Worker bundle,
    decoded via `atob`/Blob at runtime. This is vendored third-party code
    (confirmed by embedded license headers, `js/vosk.js:7-20,32-50`), so this is
    a packaging/hygiene note rather than something to hand-edit — flagged so a
    future session doesn't try to read or diff this file line-by-line.

## Low severity / cosmetic

19. **Vosk model file is misnamed.**
    `models/vosk-model-small-en-us-0.15.tar.gz.zip` has a `.zip` suffix but is
    actually gzip-compressed tar data (confirmed by header inspection), containing
    the standard Vosk small-English model layout (`am/`, `graph/`, `ivector/`,
    `conf/`). Only ever handled as an opaque URL by the loader
    (`speech_test.html:54`), so this is a naming/hygiene issue, not a functional
    one.

20. **SIMD MediaPipe WASM binary appears to be routed around everywhere it's
    used.** `preload.html`, `bulk-importer.html`, and `js/gesture-data.js` each
    force the non-SIMD WASM path through different mechanisms (patching
    `WebAssembly.validate` vs. rewriting `locateFile` URLs — see
    `docs/system/VENDORED.md`). No single line proves the SIMD binary
    (`hands_solution_simd_wasm_bin.wasm`, 5.6 MB) is never reached, but no
    confirmed live path uses it either — a 5.6 MB file that may be dead weight on
    every kiosk boot/prefetch.

21. **Latent risk: `hand_landmark_lite.tflite` is referenced by vendored code but
    not vendored.** `js/lib/mediapipe/hands.js:89` can request
    `hand_landmark_lite.tflite` when `modelComplexity` is anything other than
    `1`, but only `hand_landmark_full.tflite` exists in `js/lib/mediapipe/`.
    Currently dormant because every call site found in this audit sets
    `modelComplexity: 1` — would 404 if that ever changed.

22. **Path-inconsistency between operator guide docs and the actual boot
    script.** `raspberry_pi_startup_guide.md:47,52` show a manual Chromium launch
    command missing `--use-fake-ui-for-media-stream`,
    `--disable-accelerated-video-decode`, and `--enable-logging=stderr` compared
    to the production `start_kiosk.sh:17` — an operator following the guide
    instead of the desktop entry would get camera/mic permission prompts on an
    unattended kiosk.

## Planned work / open questions (not defects — do not re-file as bugs)

23. **Dual-screen wiring is not yet implemented.** `start_kiosk.sh:17` launches
    exactly one Chromium instance against exactly one URL
    (`http://localhost/SKR/index.html`); no second-display configuration exists
    anywhere in the tracked files. Consistent with this,
    `camera-translator.html` and `bulk-importer.html` have no
    `href`/`window.location`/`window.open` reference anywhere in the repo, despite
    both being fully wired, functioning screens. **Per the project owner: this is
    planned future work, not a bug.** Recorded here only so a later session
    doesn't go hunting for a "broken link" that was never supposed to exist yet.

24. **Low severity, open question: the build pipeline deleted in Phase 1
    originated from a separate project.** `js/main.js`, `js/dist/build.js`, and
    `package.json` (deleted, see `docs/system/DEAD_CODE.md`) belonged to
    "Sign-Language-Translator", a separate open-source project this codebase
    was originally started from, not an earlier revision of it — identified
    from `README (1).md` (also deleted) before removal, recorded verbatim in
    `archive/old-revision-docs/ORIGIN.md`. Project owner to determine whether
    attribution is required in the thesis.

25. **Stale operator-doc reference to a file deleted in Phase 1.**
    `raspberry_pi_startup_guide.md:75-77` still gives an `scp preload.html ...`
    deployment example for the "updated preloader"; `preload.html` was deleted
    in Phase 1 (see `docs/system/DEAD_CODE.md`). Noticed during Phase 1's
    repo-wide reference grep; out of scope for that phase (not in the deletion
    manifest, not under `docs/system/`), so left unfixed and flagged here.

## Dead code

Phase 1 deleted the `js/main.js`/`js/dist/build.js`/`package.json` build
pipeline, three standalone test pages, `preload.html`, `css/animate.css`, and
a handful of empty/duplicate junk files, and archived (not deleted) the
pre-existing `docs/` tree to `archive/old-revision-docs/`. See
`docs/system/DEAD_CODE.md` for the record of what was deleted, in which
commits. Items judged too consequential for a mechanical deletion (the four
unused PHP endpoints, unused `js/db-local.js`, `scratch/trigger_sync.php`) were
kept and are tracked as debt items 6 and 8 above instead.

## Oversized files

From `docs/system/INVENTORY.md` §7, sizes via `du -b`/`ls -la`:

| File | Size | Note |
|---|---|---|
| `ffmpeg.exe` | 97.6 MB | Vendored binary, used by `save_gesture.php`/`bulk_importer_api.php` (see `docs/system/BACKEND.md`) |
| `models/vosk-model-small-en-us-0.15.tar.gz.zip` | 41,138,088 bytes | Vendored offline speech model, legitimately needed (see item 19 for its naming issue) |
| `sining_kamay_db.sql` | 19,659,000 bytes | Full DB dump in git — see item 5 (security/hygiene) |
| `js/lib/mediapipe/hands_solution_wasm_bin.wasm` | 5,917,209 bytes | Vendored, in active use (see `docs/system/VENDORED.md`) |
| `js/lib/mediapipe/hands_solution_simd_wasm_bin.wasm` | 5,917,209 bytes | Vendored, likely unused on this hardware — see item 20 |
| `js/vosk.js` | 5.4 MB (text) | Vendored, contains a base64-encoded worker blob — see item 18 |
| `js/lib/mediapipe/hand_landmark_full.tflite` | 5,478,688 bytes | Vendored, in active use (see `docs/system/VENDORED.md`) |
| `db-schema/sining_kamay_db_backup.sql` | 2,648,411 bytes | Second full DB dump in git — see item 5 |

None of these were flagged as needing to shrink — ffmpeg, the Vosk model, and the
MediaPipe WASM/tflite files are all in active, legitimate use on a fully offline
kiosk that cannot fetch them at runtime. They are listed here for visibility only,
per the audit's instruction to record every binary over 5 MB.
