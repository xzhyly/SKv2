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

   **RESOLVED (Phase 2).** The Inter variable font (Latin subset, weight
   range 100–900) is self-hosted at `assets/fonts/Inter-Variable-latin.woff2`
   (48,256 bytes), declared in `css/fonts.css:3-10`, and linked from the 6
   HTML files that use Inter (`index.html:13`, `camera-translator.html:7`,
   `gesture-training.html:7`, `sign-to-text.html:7`, `reports.html:7`,
   `learn-signs.html:7`). The variable font was chosen over static weight
   instances specifically because `reports.html:44,46,333` and
   `css/style.css:199,368` use non-standard weights (650/750/850) that a
   fixed set of static weights can't render exactly. `bulk-importer.html`'s
   Google Fonts call (a different family, Outfit — see item 26 below) is
   resolved by that file's deletion, not by this migration. Verified in a
   real browser: `document.fonts` reports the Inter face as `status:
   "loaded"` covering `100 900`, and `document.fonts.check()` returns `true`
   for every weight in use including 650/750/850.

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

   **RESOLVED (2026-09-24, DB normalization, Task 4).** `php/api/core_api.php`
   was deleted outright rather than fixed — no live caller, and it referenced
   columns/tables (`gesture_type`, `sample_count`, `thumbnail`, `gesture_words`)
   this phase also removes.

3. **Offline requirement violated by a live network call.**
   `php/api/bulk_importer_api.php:378-385` calls the public MyMemory translation
   API (`https://api.mymemory.translated.net/get`, 5s cURL timeout) over HTTPS
   when an FSL label isn't in a hardcoded local dictionary
   (`bulk_importer_api.php:207-371`). Contradicts "fully offline, no
   internet/CDN/external API."

   **RESOLVED (Phase 2).** `php/api/bulk_importer_api.php` was deleted in its
   entirety, along with `bulk-importer.html`. What it did (including the
   `convert_video` action shared with `gesture-training.html`) is recorded in
   `docs/system/BULK_IMPORTER_NOTES.md` before deletion. See item 26 below for
   the consequence of also removing `convert_video`.

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

   **RESOLVED (2026-09-24, DB normalization, Task 4).** `js/db-local.js` was
   deleted, along with its `<script>` tag in `gesture-training.html`
   (`camera-translator.html`/`sign-to-text.html` no longer load it either,
   having been archived/retired in earlier phases).

7. **Three incompatible hardcoded deployment-path conventions coexist.**
   - `js/script.js:847-849` dynamically detects `/SKR` vs `/Sining_kamay` in
     `location.pathname`.
   - `js/db-api.js:11` (**deleted 2026-09-25**, saved-conversations phase
     Task 6, along with the file — see `docs/system/BACKEND.md` "translations
     dropped"), `js/db-local.js:9`, `js/gesture-data.js:6`,
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

   **Partly resolved (2026-09-24, DB cleanup, owner-approved):**
   `php/api/save_history.php` and `php/api/get_history.php` were deleted
   together with the `translation_history` table they served, and so were
   `admin_api.php`'s `get_history`/`delete_history`/`clear_history` actions and
   the `translation_history` parts of its `get_stats`. They were reachable by
   URL even with no front-end caller, and `save_history.php` built its SQL by
   string concatenation. `php/auth.php` and the rest of `php/admin_api.php`
   remain. See item 72 for the authorization problem those still have.

   **Further resolved (2026-09-24, DB normalization, Task 4):** the
   `core_api.php`/`js/db-local.js` half of this item is now also gone (see
   items 2 and 6). `php/auth.php` and `php/admin_api.php` themselves remain
   unresolved.

9. **SQL built by escape-then-concatenate instead of parameterized queries, in a
   file that also uses prepared statements elsewhere.** `php/api/save_history.php:18`,
   `php/auth.php:56,62,64,83`, `php/admin_api.php:19,56,59,65,83,87,99,106,111,132`,
   `php/api/save_gesture.php:428-429,432-433` — values are escaped
   (`mysqli_real_escape_string`) or cast (`intval()`/`(int)`) before
   interpolation, so no confirmed live injection hole was found, but the
   inconsistency with the prepared-statement style used elsewhere in the same
   files makes it fragile — a future edit dropping one escape call reintroduces a
   real hole.
   (2026-09-24: `save_history.php` no longer exists, see item 8. The
   `admin_api.php` line numbers above predate the removal of its history
   actions and have shifted.)

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

    **RESOLVED (Phase 3a), by archiving — not by fixing.** The file this
    applied to never executed in any browser (item 30) and has been moved to
    `archive/camera-translator.html`, syntax error and all. The drift
    described above was never live behavior a user could hit; it's preserved
    unfixed in the archived copy as historical record.

12. **A whole block of `camera-translator.html` is duplicated verbatim.**
    `camera-translator.html:1380-1433` and `:1438-1491` — `getWordBank`,
    `tlSetLang`, `addCustomWord` (including its `keydown` listener),
    `removeCustomWord`, `renderWordChips`, `renderTranslation` all appear twice,
    including a repeated `// STEP 4 — TRANSLATE (training UI)` header comment; the
    `wordInput` keydown listener is attached twice as a result.

    **RESOLVED (Phase 3a), by archiving — not by fixing**, same as item 11
    above: the file never ran, so this duplication was never live, and it's
    preserved as-is in `archive/camera-translator.html`.

13. **Half-migrated dual-view design in `sign-to-text-ui.js`.**
    `js/sign-to-text-ui.js:380-382,410-413,420-422,792-797` reference DOM elements
    (`#tlVideo2`, `#tlPredEmoji2`, `#tlPredLabel2`, `#tlPredOverlay2`,
    `#tlLangEn2`, `#tlLangFil2`) that do not exist anywhere in `sign-to-text.html`.
    Calls are null-guarded so this fails silently rather than erroring.

14. **Misleading "epochs" UI in gesture training.** `gesture-training-ui.js:17`
    defines `const EPOCHS = 50` and the HTML shows "0 / 50 epochs"
    (`gesture-training.html:261`), but `trainModel()`
    (`gesture-training-ui.js:422-562`) is a KNN cache-merge with a cosmetic
    10-or-20-step progress animation, not a 50-epoch neural-net training run. The
    `EPOCHS` constant is otherwise unused in the file. Confusing to an operator
    watching the number, not a functional bug.

    **No longer deferred to the Pi (Phase 2.5).** Checking this in a running
    browser used to mean deploying to the Raspberry Pi. Now that the app runs
    locally under XAMPP (see the Run section in `CLAUDE.md` and the Local
    development section in `docs/system/HARDWARE_BOOT.md`), this can be
    verified directly on a development machine instead.

    **Note (2026-09-22, gesture-training multi-sample phase):** not
    resolved — this phase does not change `trainModel()` or the epochs
    label; Step 1 now tells the operator to run Train AI again after a save,
    which is consistent with this item's own finding that Train is a cache
    merge, not a real training run.

15. **`error_reporting(0)` / `display_errors=0` disabled repo-wide for one file.**
    `php/api/bulk_importer_api.php:3-4` — intended to keep warnings out of JSON
    responses, but also hides genuine bugs in that file, not just formatting
    noise.

    **RESOLVED (Phase 2), by deletion.** The file this applied to,
    `php/api/bulk_importer_api.php`, no longer exists — see item 3 above.

16. **No shared error-response contract across PHP endpoints.** Three different
    JSON error shapes are in use: `{"success":false,"message":...}`
    (`auth.php`, `admin_api.php`, `core_api.php`), `{"error":...}`
    (`connect.php`, `save_history.php`), and `{"success":false,"error":...}`
    (`save_gesture.php`, `bulk_importer_api.php`, `reports.php`,
    `save_conversation.php`, `conversations.php`). Any frontend code switching
    between endpoints must special-case each shape. (`save_translation.php`
    and `get_translations.php`, formerly also in the `{"error":...}` group,
    were deleted 2026-09-25 with the `translations` table — see
    `docs/system/BACKEND.md`. The two new saved-conversations endpoints join
    the third, most common shape; see item 84 for the one remaining
    `{"error":...}` case, `connect.php`'s own DB-down response.)

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

    **RESOLVED (Phase 3a), for the prefetch half of this finding.**
    `index.html`'s `<link rel="prefetch">` block named the SIMD binary,
    guaranteeing it was wasted bandwidth even if nothing else ever proved
    it dead — confirmed directly this phase: `js/gesture-data.js:230-238`'s
    `locateFile` override rewrites every `*simd_wasm_bin*` request to the
    non-SIMD filename before MediaPipe ever asks for it, and `hands.js`'s
    own manifest (`{simd:!1,url:"hands_solution_wasm_bin.js"}` /
    `{simd:!0,url:"hands_solution_simd_wasm_bin.js"}`) confirms the two are
    mutually exclusive alternatives. The prefetch now targets
    `hands_solution_wasm_bin.wasm` (the one actually requested) plus
    `hand_landmark_full.tflite`. The vendored SIMD `.wasm`/`.js` pair itself
    is untouched and still on disk — deleting vendored files was out of
    scope for this phase.

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
    `camera-translator.html` had no
    `href`/`window.location`/`window.open` reference anywhere in the repo, despite
    being a fully wired, functioning screen. **Per the project owner: this is
    planned future work, not a bug.** Recorded here only so a later session
    doesn't go hunting for a "broken link" that was never supposed to exist yet.
    (Originally also cited `bulk-importer.html` as a second example — that file
    was deleted in Phase 2, see item 26 below, so it no longer applies.)

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

    **RESOLVED (Phase 2).** The stale `scp preload.html ...` example
    (`raspberry_pi_startup_guide.md:75-78`) was removed. Checked the rest of
    the guide against every Phase 1/Phase 2 deletion — nothing else in it
    references a since-deleted file.

26. **Video upload for gesture training was removed in Phase 2 and has no
    replacement.** Deleting `php/api/bulk_importer_api.php` (item 3 above) also
    removed its `convert_video` action, which turned out to be shared with a
    live feature: `gesture-training.html`'s "Upload & Process Video" button
    (formerly `gesture-training.html:220-231`, handled by
    `js/gesture-training-ui.js:1009-1123`, using
    `GestureDataRecorder.processVideoFile()` in `js/gesture-data.js`, all
    removed in the same commit rather than leaving a button with no working
    endpoint behind it). **Per the project owner: this is planned work for the
    upcoming gesture-training flow redesign, not a defect** — the same
    footing as the dual-screen gap (item 23). What the removed feature did,
    including the exact ffmpeg command it ran and its full request/response
    shape, is recorded in `docs/system/BULK_IMPORTER_NOTES.md` as design input
    for its eventual replacement. Camera-based gesture capture (the other,
    still-present half of the training screen) is unaffected.

    **Note (2026-09-22, gesture-training multi-sample phase):** not folded
    in; this phase does not restore upload. It does change what a re-record
    does to the label's existing clip: samples 2+ of a word that already has
    a video now keep the first take's clip instead of re-encoding a new one
    on every save (see `DECISIONS.md`, "the transcode rule").

    **Update (2026-09-26, video-based gesture capture): the live capture half
    of this item has itself now been replaced, not restored.** The old
    countdown/frame-sampling live-capture path was removed and rebuilt as the
    record-first/extract-later flow described in `docs/system/DECISIONS.md`
    ("video-based gesture capture phase") — `js/capture-core.js`,
    `js/video-landmarks.js`, `js/gesture-capture-ui.js`. Upload/import from an
    existing video file is still not built; it is the next planned phase and
    is expected to reuse `js/video-landmarks.js`'s `extractVideoLandmarks()`
    (already parameterized for a `File` source and a configurable input
    canvas size, Addition B).

27. **Low severity, cleanup during the UI revision: `Nunito` is now
    unreachable dead weight in font stacks.** `camera-translator.html:19,40`,
    `css/sign-to-text.css:9,30`, `css/gesture-training.css:19`, and
    `reports.html:37` all list `'Inter','Nunito','Segoe UI',...` — Nunito was
    never the primary family, only a fallback after Inter, but it used to be
    loaded by the same Google Fonts `<link>` Phase 2 replaced (item 1). Since
    Inter is now self-hosted and always available, the browser will never
    reach past it to Nunito. Harmless (fonts.css never requested a Nunito face,
    and it wasn't in scope to edit these font stacks for one weight/CDN swap),
    but worth trimming from the stacks whenever these files are next touched.

28. **No action needed, recorded for traceability: `bulk-importer.html`'s font
    was Outfit, not Inter.** `bulk-importer.html:7` requested
    `family=Outfit:wght@400;500;600;700;800` — a different Google Fonts family
    from the Inter call every other screen made, used nowhere else in the
    repo. Resolved by that file's deletion (item 3/26 above), not by the Inter
    self-hosting work (item 1).

29. **High severity, present in `docs/system/UI.md` since the original audit but
    never carried into this file until Phase 2 verification caught the gap:
    `learn-signs.html` embeds an entire externally-hosted website in an
    iframe.** `learn-signs.html:85-90` —
    `<iframe id="learn-iframe" src="https://6878790f1e3f65fc09b5c339--startling-zabaione-53aad1.netlify.app/?fbclid=...">`
    with `sandbox="allow-same-origin allow-scripts allow-forms allow-popups"`.
    This loads a complete third-party page (title observed: "Online Filipino
    Sign Language Tutorials and Scholarship Assistance", branded for a
    "Camarines Norte Persons with Disability Affairs Office") from the public
    internet, runs its scripts, and does so carrying a Facebook click-identifier
    (`fbclid=...`) query parameter — the whole "Learn Signs" screen is
    currently dependent on an external Netlify deployment staying online. This
    is a more severe offline-requirement violation than the Google Fonts CDN
    calls (item 1) were: it is the page's entire content, not one asset, and it
    executes third-party JavaScript. **Out of scope for Phase 2** (not one of
    the three named pieces of work) — flagged here rather than fixed. Needs a
    project-owner decision: replace with a locally-hosted version of this
    content, or something else.

30. **High severity: `camera-translator.html`'s entire inline `<script>` block
    has a syntax error and never executes, in any browser.** Found during
    Phase 3a while checking for console errors after deferring script tags —
    confirmed via `git show HEAD` that this predates Phase 3a entirely, so it
    is not something that phase introduced. The bottom-of-body inline script
    (camera-translator.html's whole application logic — the training wizard,
    the `?screen=translate` view, camera handling, everything) ends with:
    ```js
    if(TRANSLATE_ONLY){
      document.getElementById('tl-page').classList.add('active');
      tlInitCamera();
    }else{
      document.getElementById('training-ui').classList.add('active');
      showStepInstruction(1);
      updateUI();
    </script>
    ```
    The `else{` never closes. This throws `SyntaxError: Unexpected end of
    input` in every browser and prevents the *entire* script block from
    executing — not just the `if`/`else`, all ~1300 lines including the
    `enableCamBtn` click listener, `tlInitCamera`, `trainModel`, everything.
    Confirmed live: `camera-translator.html`'s HTML renders (buttons exist in
    the DOM) but no listener is ever attached to any of them.

    **RESOLVED (Phase 3a), by archiving — not by fixing.** The project owner
    verified this finding independently (identical brace missing at baseline,
    Phase 1, Phase 2, and HEAD) and confirmed a one-character `}` fix does
    make it parse cleanly (`node --check`), but chose to archive the file
    rather than fix it: nothing in the repo references it (no `href`,
    `location.href`, or `window.open` anywhere), and it held the project's
    only TensorFlow.js classification code (`tf.tensor2d`, `tf.sequential`,
    `tf.loadLayersModel`, `.predict()`, lines 1220-1686) as an alternative to
    the k-NN approach actually running in production. Moved to
    `archive/camera-translator.html` with the syntax error intact — see
    `archive/CAMERA-TRANSLATOR.md` and `docs/system/ML.md` for the full
    record.

31. **Open question, not a defect: should `camera-translator.html?screen=translate`
    keep auto-starting the camera at script-parse time?** Raised during
    Phase 3a (see `docs/system/UI.md`) — `tlInitCamera()` fires unconditionally
    when `TRANSLATE_ONLY` is true, with no click gate, unlike every other
    camera-start path in the codebase (`gesture-training.html`'s
    `enableCamBtn`, `sign-to-text.html`'s "Start Translating →"). Per the
    project owner: since this view exists specifically to translate, starting
    the camera immediately is arguably correct behavior, not a bug — recorded
    here as a question for a later phase rather than changed. Also currently
    unreachable in practice regardless, since item 30 above means none of this
    file's JS executes at all.

32. **High severity, found and resolved in Phase 3a: the Vosk offline speech
    model loaded unconditionally on every `index.html` visit, whether or not
    the user ever opened voice input.** `js/script.js:533` called
    `recognition.initModel()` at top level with no guard, which pulls the
    41 MB `models/vosk-model-small-en-us-0.15.tar.gz.zip`, decodes
    `js/vosk.js`'s base64 worker blob, and compiles the Kaldi decoding graph —
    confirmed live via console output (`VoskAPI:CompileLooped... Spent
    0.1-0.5 seconds in looped compilation`, plus i-vector/HCL/G graph loads)
    appearing on a plain dashboard load with no interaction. This was the
    single largest resource-loading defect found across the whole audit —
    larger than the camera-library loading this phase originally set out to
    fix.

    **RESOLVED (Phase 3a).** Gated the call on `isVoiceScreen`
    (`js/script.js:341`), which is true only for the `?screen=voice`
    navigation reached via the dashboard's voice card. `initModel()` already
    no-ops if the model is loaded, and `start()` already lazy-loads it too as
    a second line of defense, so no new guard was needed. Verified live:
    repeated `index.html` loads now produce zero VoskAPI console output; a
    `?screen=voice` load still loads and compiles the model exactly as
    before.

33. **Low severity: `ScriptProcessorNode` deprecation warning on the voice
    screen.** `js/script.js:288` uses the Web Audio API's `ScriptProcessorNode`
    (buffer size 4096, per `docs/system/UI.md` Part 2 §3) to feed audio into
    Vosk. Chrome logs a deprecation warning for this API (superseded by
    `AudioWorkletNode`) every time voice input actually runs. Confirmed via
    manual verification (Phase 3a, `docs/system/MANUAL-CHECKS.md`) — not a red
    console error, and pre-existing: this line predates Phase 3a and was not
    touched or introduced by it. Not fixed here — a replacement would need to
    port the Vosk audio pipeline to `AudioWorkletNode`, out of this phase's
    scope (load order only).

34. **High severity, found by the 1024×600 UI survey and resolved: the
    on-screen keyboard covered the text input on the voice screen.** On
    `index.html?screen=voice` the keyboard (240 px tall at ≤620 px viewport
    height, 280 px above) opened over the text input and the Translate button,
    so a user typing could not see what they typed. At 1024×600 the keyboard's
    top was at 360 and the input at 452–490 once it opened. It was not
    confined to the kiosk: the controls panel centres vertically, so the
    input or the Translate button was covered at every height up to 1146 px,
    1080p monitors included (table in `docs/system/UI-SURVEY-1024x600.md`,
    finding 1).

    A second defect sat behind it. `js/virtual-keyboard.js` closed the
    keyboard on `pointerdown` outside the input. Once closing it restores a
    layout, that happens mid-tap: a tap on Translate (512, 213) ended over
    `#start-btn`, the microphone.

    **RESOLVED** (`0f077ce`). `index.html:463-493` (plus `:516` in the
    ≤620 px block): under `@media (max-height: 1146px)`, while
    `body.keyboard-active` is set, hide `#start-btn`, `.tts-mic-label`,
    `.tts-lang-toggle` and `.tts-or`, move the controls to the top, and undo
    the `min-height: 100vh` that `css/virtual-keyboard.css:94` gives
    `.tts-body`. 1146 px is measured, not chosen (comment at
    `index.html:471-476`). `js/virtual-keyboard.js:76` now dismisses on
    `click`. After, at 1024×600: input 146–184, Translate 194–232, keyboard
    top 360. With the keyboard closed, all 51 voice-screen elements are at
    their pre-fix positions. The real touch path could not be tested from
    automation; see `docs/system/MANUAL-CHECKS.md`.

35. **Closed finding, recorded so it is not rediscovered: someone had already
    attempted item 34's exact fix, and it silently never ran.** `index.html`
    carried `#ttsBody.keyboard-active #start-btn, … .tts-mic-label,
    #transcript, .tts-or { display: none !important }` plus a panel
    re-alignment rule, in both the base and ≤620 px blocks, unchanged since
    the `baseline` commit. `js/virtual-keyboard.js` only ever puts
    `.keyboard-active` on `<body>` and `<html>` (`showKeyboard()`,
    `js/virtual-keyboard.js:99-105`), never on `#ttsBody`, so the selectors
    could never match; confirmed live (`#ttsBody` had only `tts-body` with the
    keyboard open). No error, no warning, and nothing on screen showed it was
    inert. **RESOLVED** by replacing those rules in place with the working
    `body.keyboard-active #ttsBody` rules of item 34, not by adding a second
    set beside them. `#transcript` was deliberately dropped from the list: the
    existing `.tts-live-text:empty { display:none !important }`
    (`index.html:178`) already hides it while empty, and when it is not empty
    it holds the recognised speech the user is retyping from (item 36).

36. **Medium severity, open: recognised speech never reaches the text input,
    so correcting a misrecognition means retyping it.** A user who speaks,
    sees a wrong word in the transcript, and taps the text box to fix it gets
    an empty box. `js/script.js` only reads `#text-sign-input`
    (`js/script.js:442` on Translate click, `:447` on Enter) and never writes
    to it. All speech output goes to `#transcript` instead: live results at
    `js/script.js:799`, the final result at `:427`, both as
    `You said: "…"`. `js/vosk.js` touches no DOM. Not fixed: this is a
    behaviour change, not layout, and it needs a decision about what happens
    to the transcript once the user starts editing. Found while deciding
    whether item 34 could hide the transcript (it now stays visible while it
    has content, for this reason).

37. **Medium severity, found by the 1024×600 UI survey and resolved:
    `sign-to-text.html`'s guide hid part of itself, and "Start Translating"
    had no headroom.** At 1024×600 the guide card was 607.5 px tall in
    `.tl-instr-container`'s 520 px box and vertically centred, so it
    overflowed both ends. 68 px at the bottom could only be reached by
    swiping, with no cue. 43.7 px at the top, including 6.7 px of the Guide
    badge, could not be reached at all. The Start button (534.7–594.7) was
    clipped 6.7 px by the container, whose bottom is at 588, and any text
    added above it would have pushed it further off.

    **RESOLVED** (`ff38d10`, `bc21a9f`). The card is bounded to the space
    available (`css/sign-to-text.css:256-260`) and the step list is the one
    part that scrolls (`:293-305`), with padding and a stable scrollbar
    gutter so no text reflows. While part of the list is below its visible
    area, its bottom 40 px fades out (`.has-more`, `:306-312`). The class is
    set by a layout-only inline script (`sign-to-text.html:118-134`). After,
    at 1024×600: container scrollHeight/clientHeight 520/520; list 262/127
    with the fade; card 92–564; Start button 467–527, 73 px from the screen
    edge. Where the card fits (768 px tall and up) every element inside it is
    unchanged.

38. **Low severity, found by the 1024×600 UI survey and resolved:
    `reports.html` cut cell text with ellipses a touchscreen cannot reveal.**
    With no hover, the hidden part was unreachable. On the current data at
    1024×600: 128 truncated cells (ESL 68, FSL 53, Translations 7; the survey
    counted 57 on older data) plus 32 truncated Key pills. **RESOLVED**
    (`e382a5c`, `reports.html:71-79`). Created is widened from 136 to 150 px,
    enough for the widest possible timestamp. Label/Sign, Text and the Key
    pills wrap. After: 0 truncated cells, 0 truncated pills. Only the 35 rows
    holding long text got taller.

39. **Low severity, open: opening the keyboard on `gesture-training.html`
    shifts the page 8 px narrower.** `css/virtual-keyboard.css:80-101`
    (`body.keyboard-active` rules: 300 px bottom padding, `overflow-y: auto`,
    `min-height: 100vh` on `#trContentWrap` and `.tr-left-panel`) makes the
    content area 652 px tall in a 600 px viewport, so a vertical scrollbar
    appears. The layout width goes from 1024 to 1016 and content
    reflows to fit; Step 4's Add button moves from x=356.3 to 352.9. Nothing
    the user types into is covered: at 1024×600 the keyboard top is 320,
    `#gestureLabelInput` is at 99–139 and `#wordInput` at 178–212. Not fixed;
    it lives in the shared stylesheet and was out of scope for item 34.

40. **Low severity, open: a very long transcript can still push Translate
    under the keyboard on the voice screen.** Item 34 keeps a non-empty
    `#transcript` visible while typing (for item 36's reason). Measured at
    1024×600 in the result state: with a 6-line transcript Translate's bottom
    is at 337, against the keyboard's top at 360. By arithmetic (one line is
    about 17.4 px at 12 px × 1.45), 8 or more lines would overlap. That is
    roughly 400+ characters of continuous speech in the 380 px result panel.
    Not measured at that length, not fixed. It needs the same decision as
    item 36 about what the transcript is for once the user types.

41. **Low severity, open: no cache-busting on the files the 1024×600 fixes
    changed.** `js/virtual-keyboard.js` (`index.html:752`,
    `gesture-training.html:377`) and `css/sign-to-text.css`
    (`sign-to-text.html:8`) are linked without a version query string, unlike
    `js/script.js?v=5`. A Chromium profile that cached the old files may keep
    serving them after deployment until its cache is cleared. Not fixed:
    adding version strings is outside a layout phase. Noted in
    `docs/system/MANUAL-CHECKS.md` so checks are run against fresh files.

42. **Low severity, open: three pages still carry their own divergent
    palette `:root` instead of the new shared `css/tokens.css`.**
    `css/gesture-training.css:24-30`, `css/sign-to-text.css:14-21`, and
    `reports.html:9-33` each still define local custom properties
    (`--navy2`, `--orange-deep`, `--white`, no `--muted-light`, no `--red`,
    `--surface`/`--primary` used inconsistently between them) instead of the
    README-named palette `css/tokens.css` now defines
    (`--navy`, `--navy-2`, `--orange`, `--orange-dark`, `--bg`, `--surface`,
    `--border`, `--muted`, `--muted-light`, `--green`, `--red`), created for
    `talk.html` in the "Let's Talk" phase (`docs/system/DECISIONS.md`). Not
    fixed: migrating three already-shipped pages to a new shared stylesheet
    was out of scope for a phase that was told to edit nothing existing.
    Migrating them would mean swapping each page's local `:root` for a
    `<link rel="stylesheet" href="css/tokens.css">` and a values-only diff on
    any variable name that changed; low risk since the underlying hex values
    don't change, but each page needs its own visual re-check afterward.

43. **Low severity, open: two different approaches to filling a larger-than-
    design viewport now coexist in the same system.** `index.html` (and every
    other pre-existing page — `sign-to-text.html`, `gesture-training.html`,
    `reports.html`) is a fluid layout: elements reflow/resize with the
    viewport, no single fixed canvas size. `talk.html` (since the review pass
    that added the scaled stage — `docs/system/DECISIONS.md`) is the
    opposite: a locked 1024×600 canvas (`#stage`) that keeps every element at
    its exact design pixel size and scales the whole canvas up with
    `transform:scale()`, letterboxed, rather than reflowing anything. Both
    solve "the kiosk's own 1024×600 panel is the only screen that matters,
    but a developer's laptop is bigger" — chosen independently, for different
    reasons (the older pages predate the pixel-exact 1024×600 design contract
    talk.html was built under, and already have fluid CSS from before that
    contract existed; talk.html's own verification suite depends on every
    element's exact pixel size, which a fluid re-layout would have broken).
    Not fixed: reconciling them into one approach — either making the older
    pages scale-locked the same way, or accepting fluid layout was never
    actually required and revisiting whether talk.html needs to be as strict
    as it is — is a real decision for a later phase, not a mechanical fix;
    recorded here so it's a choice made on purpose rather than a surprise
    found later.

44. **RESOLVED 2026-09-21 (commit `c94d62c`).** Was: **Medium severity, open (owner decision): `index.html:653`'s
    `#translator-pane` header links to `sign-to-text.html`, which is now
    archived.** The link ("Translate Sign to Text") is dead as of the archive
    commit. Deliberately not touched by the signing-screen merge (spec: out of
    scope). Options — remove the link, repoint it at `talk.html`, or retire
    `#translator-pane` too; none was picked.

    **Resolution:** the third option — `#translator-pane` was retired. Its real
    functionality (Vosk speech, the word-by-word sign player) moved into
    `talk.html`'s Speak or Type screen (`js/talk-speaking.js`, `js/sign-player.js`)
    and the pane, its inline style/script, the `vosk.js`/`script.js`/
    `virtual-keyboard.js` tags and the hidden `#welcome-btn` were removed from
    `index.html`; `js/script.js` is archived (`archive/script.js`,
    `archive/TEXT-TO-SIGN-PANE.md`). Verified after the commit: a grep of
    `index.html` for `translator-pane|sign-to-text|screen=voice|welcome-btn|tts-|script.js|vosk|virtual-keyboard`
    finds nothing, and a repo-wide grep (excluding `archive/`, `docs/`) finds
    none of `screen=voice`, `sign-to-text.html`, `welcome-btn`, `setTtsLanguage`,
    `handleRecognizedText` outside comments and the dead CSS in item 60.

45. **Medium severity, open: neither gesture set has a `stop` label.** The
    loaded k-NN has `start` (49 frames) in both ESL (120 labels) and FSL (90
    labels) but no `stop`, so the Guide's "sign stop to finish" instruction
    cannot work — only the manual button ends a sentence. Predates the merge
    (`sign-to-text.html` had the same gap); the stop-gesture code path was only
    exercised with a synthetic label. Fix is data (record a `stop` gesture),
    not code.

46. **Low severity, open: the 2-minute idle timer ignores camera activity.**
    `talk.html`'s timer re-arms on pointer/key/input only, so a hands-only
    signer can be shown "Still there?" mid-sentence; `tick()` correctly pauses
    behind the card but the countdown to ending the conversation keeps running.

47. **Low severity, open: the header LISTENING pill is still not driven.**
    README says it shows while the camera reads; the TYPING observer would
    clear it on any body class change, so wiring it needs that observer
    reworked. Not in the merge spec's scope list.

48. **Low severity, open: `tf.min.js` (1.46 MB, about 209-255 ms of the ~276 ms
    sign-library load) looks unused on the live path.** Nothing in
    `js/sign-to-text-ui.js`/`js/gesture-data.js` calls `tf.*` except a guarded
    `tf.io.removeModel` in `confirmAndSave`. The spec lists it in the sign
    stack so the queue loads it; dropping it is a later, measured change.

    **Update (2026-09-26, video-based gesture capture): `confirmAndSave` no
    longer exists — historical reference only.** It was `gesture-training.html`
    Step 1's old live-capture save handler, removed along with the rest of
    that flow (Q8, `docs/system/DECISIONS.md`; grep-confirmed absent from the
    whole repo). The guarded `tf.io.removeModel` call this item describes now
    lives in `js/gesture-capture-ui.js`'s `invalidateCaches()`
    (`:682-689`), which every recording save calls the same way
    `confirmAndSave` used to (cache invalidation for the sign-set's k-NN
    model/labels) — this item's underlying finding (`tf.min.js` still looks
    otherwise unused on the live path) is unchanged, only the call site moved.

49. **Low severity, open: a hung item stalls the loading queue and the Guide
    gate forever.** `js/talk-loader.js` handles rejections and throws but has
    no per-item timeout; a `Vosk.createModel` or database fetch that never
    settles leaves `isSettled()` false. The Guide proceeds only when the whole
    queue settles (spec), so on the Pi a slow 41 MB Vosk load also delays Sign.

50. **Low severity, open: `css/sign-to-text.css` is orphaned after the
    archive** (only `sign-to-text.html` linked it). `js/sign-to-text-ui.js` is
    not — `talk.html` loads it through the queue — but it now runs without its
    own page's DOM, which it tolerates only through null-guards.

51. **Low severity, open: the Guide's button names do not match any on-screen
    label.** The carried-over text says "TRANSLATE" and "STOP & TRANSLATE"; the
    live screen's orange button reads "Translate" / "Stop & Add to
    Conversation" (and `sign-to-text.html` itself read "START" / "STOP").

52. **Low severity, open: README's "Hands not visible" error state was never
    built** (here or in `sign-to-text.html`); the live caption's "Show your
    sign" is the only no-hand feedback.

53. **Low severity, open: the Vosk model is English-only.** Only
    `vosk-model-small-en-us-0.15` exists in `models/`; README's "one model
    chosen on screen 02" and the operator-setting default recorded in
    `DECISIONS.md` are unbuilt. The queue now loads it (41 MB) for every
    conversation, including ones that only type. **Still English-only after the
    text-to-sign merge, by design of that phase:** the Filipino chip on Speak or
    Type disables the mic (as `#translator-pane` did) rather than loading a
    Filipino model; typing and the Filipino sign folder work.

54. **High severity, open (found, not fixed): tapping `#speaking-input` raises
    the on-screen keyboard and immediately hides it.** Traced in real Chrome:
    `mousedown → #speaking-input`, `focusin → #speaking-input` (the keyboard
    raises and the layout shifts — the mic row is hidden while it is up),
    `mouseup → #screen-speaking`, `click → #screen-speaking`;
    `js/virtual-keyboard.js`'s `handleDocClick` (`:90-97`) sees a click whose
    target is not the input and calls `hideKeyboard()`, which also blurs the
    input. Same result with emulated touch. Predates the text-to-sign merge
    (present on the previous `talk.html`); every earlier check raised the keyboard
    with `.focus()`, so a real tap was never exercised. If it reproduces on the
    Pi's touchscreen, typing on Speak or Type does not work by tapping. Likely
    fix (not attempted — shared file, out of this phase's scope): remember the
    target of the last `pointerdown` and ignore a `click` that belongs to a tap
    that started on the active input. Raised from Medium after the final review:
    on a touchscreen this is the only text-entry path for the Filipino chip
    (mic disabled by design) and for the mic-failure card's "Type instead", so both
    are dead ends if it reproduces on the Pi; recommended as the immediate next
    fix (retiring `#translator-pane` also removed one of the three pages that load
    `js/virtual-keyboard.js` with a text input, shrinking the blast radius to
    `gesture-training.html` and `talk.html`).

55. **Low severity, open: `assets/signs/en|fil/fallback.png` are generated
    placeholders** (a grey "?" tile, 360×360, added with the text-to-sign merge).
    The pipeline's last step always requested them; they did not exist. Replace with
    real art if desired.

56. **Low severity, open: Filipino has no fingerspelling clips.**
    `assets/signs/fil/` holds 89 clips and none of a–z, so an unknown Filipino
    word plays nothing (measured: 128 ms, empty frame). Owner decision:
    left as the original pipeline behaves rather than falling back to the English
    alphabet.

    **Update 2026-10-04 (sign-texts phase).** Still true, and measured again: Filipino
    text-to-sign for a text with no clip (e.g. "Zz Pareho Probe") requests the `fil/` clip and
    every `fil/` letter, all 404, and plays nothing (`.git/sdd/st-task-8-report.md` item 8,
    concern B). A Both sign with an `assetPath` has its Filipino text registered against that `en/`
    clip (`js/sign-player.js:245-275`), so it still plays in Filipino; a Filipino text with no clip at
    all (a typed word that is not a sign, or a sign recorded without a video) plays nothing. The stored
    Filipino text is "Kamusta ka"; the spelling "kumusta ka" is not a stored text and plays nothing.

57. **Low severity, open: the sign clips are small.** Words are 360×202,
    letters 360×640 (measured with `ffmpeg -i`), displayed inside a 560×260 frame
    with `object-fit: contain`. Legibility at kiosk viewing distance is a manual
    check, not an automated one.

58. **Low severity, open: `ScriptProcessorNode` is carried into
    `js/talk-speaking.js`** exactly as in `script.js` (item 33's deprecation
    warning applies to the new file; `AudioWorklet` is the replacement).

59. **Low severity, open: small `js/sign-player.js` gaps found in review.**
    The one wait that cannot be aborted is the existence probe in
    `displaySignWithFallback` (a `play()` promise can stay pending until the probe
    settles — milliseconds on localhost); the last clip that ends normally stays
    attached to the frame until the next `play()` or `cancel()`
    (`talk.html` cancels on Edit/Send/leave).

60. **Low severity, open: `css/style.css` still carries dead `#translator-pane`
    rules** (`:69`, `:261`, `:541`). `style.css` is linked only by `index.html`,
    which no longer has that element. Left in place after the retirement:
    trimming it risks the dashboard's `@media` blocks in the same file for no
    visible gain.

61. **Low severity, open: a message consisting only of `?` cannot be sent from
    Speak or Type.** Translate strips `?` before playing (`normalizeSpeechText`
    does not), so it stays disabled for a `?`-only input, and Send now lives only
    in the preview panel. Before the text-to-sign merge, `?` + Send worked.

62. **Low severity, open: the `.mp4` `save_gesture.php` writes is not the clip
    `talk.html` plays.** Found and corrected during planning for the
    gesture-training multi-sample phase (2026-09-22) — `js/sign-player.js:
    255,378,411` (the only sign-video player in the app) only ever probes
    `<label>.webm` and never references `.mp4`; the only reader of the
    `.mp4` this endpoint writes is `php/api/reports.php:30-53` (Reports →
    ESL/FSL Signs → View Asset). `assets/signs/en/` holds 120 `.webm` files
    and 0 `.mp4` files (measured). The multi-sample phase's own spec
    originally stated the two were the same clip; that line was wrong and
    was corrected inline in the spec rather than left standing (see
    `docs/superpowers/specs/2026-09-22-gesture-training-multi-sample-design.md`,
    "Correction (plan phase, 2026-09-22)"). Not fixed here — revisit before
    building any "choose the display take" control (`DECISIONS.md`, Extra B).

63. **Medium severity, MITIGATED not eliminated: the post-save reload in
    `gesture-training.html` still costs real time.** Before (gesture-training
    multi-sample phase, finding 6, measured pre-fix): every save awaited
    `reloadDataset()`, which ran two independent full-dataset GETs, each with
    a server-side `sync_disk_to_db` walk (`mergeSavedGestureSamples()` and
    `renderSavedDataset()` each doing their own fetch) — measured 2 fetches,
    ~5.6 MB each, 2,271–3,919 ms awaited per save (curl `?no_sync=1` alone:
    1.15–1.29 s). After (Task 5, commit `1690cae`): `window.reloadDataset`
    (`js/gesture-training-ui.js:1063`) fetches the dataset once via
    `no_sync=1` and shares it with both consumers — measured
    `{ms: 4515, fetches: 1, bytesEach: [5601800]}` against a measured
    `{ms: 5326, fetches: 2, bytesEach: [5601800, 5601800]}` before. That is a
    real but modest ~15% wall-clock improvement (5326→4515 ms), **not** the
    dramatic cut the fetch-count drop (2→1) alone might suggest: most of the
    remaining ~4.5 s is client-side `JSON.parse`/object-building of a still
    ~5.6 MB payload, not network transfer or the server-side sync step that
    was cut. **Not eliminated:** `DOMContentLoaded`'s startup load still runs
    both full synced fetches, unchanged, by design (`DECISIONS.md`) — loading
    the page cold with a large dataset still costs several seconds. The
    dominant remaining cost is payload size (~26 KB per sample kept, ~209
    labels' worth of full landmark-frame data returned on every reload,
    finding 6) — explicitly out of scope for this phase (see the plan's
    Scope section) and not addressed here.

    **Update (2026-09-26, video-based gesture capture): v3 samples change the
    per-sample payload size this item measured.** v2 samples were pretty-
    printed, capped at 30 frames (the old `FRAME_TARGET`); v3 samples are
    compact JSON (`php/api/save_gesture.php:485-489`) holding up to
    `MAX_ROWS_PER_RAW_SAMPLE` (30) subsampled rows per rep for training
    purposes, but the on-disk sample file itself can carry up to
    `MAX_FRAMES_PER_SAMPLE` (301) raw per-landmark frames
    (`php/api/save_gesture.php:39`) — measured (Task 6 e2e) at ~14.9 KB per
    17-frame rep on disk, i.e. bigger per frame than v2's, though a typical
    rep has far fewer frames than the 301 cap. `reloadDataset()`'s post-save
    payload cost (this item's main finding) is not re-measured against v3
    data specifically.

64. **Low severity, open: `delete_gesture` leaves the label's display clip
    behind.** `php/api/save_gesture.php:401-438`'s `delete_gesture` action
    removes the label's `sample_*.json` files and its `gesture_recordings`/
    `gestures` DB rows, but never removes `assets/signs/<en|fil>/<label>.mp4`
    or `.webm`. Deleting a word and never re-recording it leaves an orphaned
    clip on disk forever. (Deleting and then re-recording is a smaller
    version of the same gap: the multi-sample phase's transcode rule forces
    a fresh transcode on the first sample after a delete — see
    `DECISIONS.md`, "the transcode rule" — so the clip does get overwritten
    in that case; it just isn't removed by the delete itself.) Not fixed in
    this phase.

    **Update 2026-10-04.** `delete_gesture` is now `php/api/save_gesture.php:376-419` (was cited
    as `:401-438`). It deletes every `*.json` including `sign.json` and the folder from both
    `saved_gestures/` and the legacy `saved_gestures_fsl/` (`:380-392`) and uses prepared statements
    (`:395-414`), but still never removes `assets/signs/<en|fil>/<label>.mp4`/`.webm`: for a Both sign
    that is one clip under `assets/signs/en/` (`:614`). Still open.

65. **Low severity, open: category is DB-only, so a DB wipe/re-import loses
    manual re-tags.** `gestures.category` (`db-schema/database_setup.sql:89`)
    has no on-disk counterpart; a fresh import or a full `gestures` table
    wipe drops every hand-corrected category, and the next sync/save falls
    back to `gesture_category()`'s heuristic (`php/api/gesture_category.php`)
    for every label — never to `NULL`, since the column has `DEFAULT 'word'`
    and the heuristic itself never returns null. Owner decision, 2026-09-23
    (see `DECISIONS.md`, "Category is stored in the DB only").

    **Update 2026-10-04.** Still true after the sign-texts phase: the category stays DB-only
    (`gestures.category`, `db-schema/database_setup.sql:39`, was cited as `:89`), unchanged rules; a
    merged Both sign keeps the **ESL row's** category (18 FSL/ESL category conflicts were resolved that way,
    `docs/system/DECISIONS.md`, sign-texts phase). Sync passes no category, so a manual re-tag is not
    overwritten by a full GET (`php/api/save_gesture.php:211`, `:117-119`). The sets and both texts are
    **not** lost on a DB wipe — they come back from each sign's `sign.json` on the next full sync.

66. **Low severity, open: the categorization and multi-sample test suites
    run against the live DB and disk and must run serially.**
    `tests/categorization/*.test.mjs` and
    `tests/multi-sample/save-endpoint.test.mjs` share the same live MySQL
    database and `saved_gestures*/` folders as the running app; a parallel
    `node --test` run was observed to flake once, a serial run
    (`--test-concurrency=1`) was not. Run them with
    `node --test --test-concurrency=1 tests/categorization/*.test.mjs
    tests/multi-sample/save-endpoint.test.mjs` (31/31, measured 2026-09-23).
    Since `a986a1d` no test alters the real `gestures` table, and
    `save-category.test.mjs` asserts every non-`zz` row's category is
    unchanged across the run (a guard against a repeat of the column-drop
    found by the final review).

    **Update 2026-10-04 (sign-texts phase).** The serial suite now also includes
    `tests/conversations/*.test.mjs`, `tests/video-capture/*.test.mjs`,
    `tests/normalization/migration.test.mjs` and `tests/sign-texts/*.test.mjs`; measured result
    188 tests, 187 pass, 0 fail, 1 skip (baseline before the phase 141 / 140 / 0 / 1;
    `docs/system/BACKEND.md`, "Tests"). `tests/sign-texts/save-sign.test.mjs`,
    `signs-endpoint.test.mjs`, `talk-texts.test.mjs` (vm-based, no DB) and the CDP check scripts
    use `zz`-prefixed probe signs and clean up; the full-sync GET inside `signs-endpoint.test.mjs`
    upserts real rows from disk (item 102).

67. **Low severity, open, pre-existing (not introduced by this phase):
    `deleteGesture()` does not await `renderSavedDataset()`.** Several
    deletes fired in quick succession programmatically (not by a single
    user click) leave the dataset counter/table stale until the next
    reload — observed 213 shown vs. 209 real rows during this phase's
    verification. A single user-clicked delete is correct; only rapid
    back-to-back deletes without a UI reload in between are affected.

68. **Low severity, open (docs/environment): the local DB is a MySQL 8.0
    Windows service, not XAMPP's bundled MariaDB.** Measured 2026-09-23:
    the server is MySQL 8.0.44 (Windows service, datadir
    `C:\ProgramData\MySQL\MySQL Server 8.0\Data\`), reachable only via
    `php/connect.php` (PHP's mysqli, or PHP CLI with
    `require 'php/connect.php'`). XAMPP's own `mysql.exe` client cannot
    authenticate to it (`caching_sha2_password`, which XAMPP's older client
    doesn't support) — a "just use XAMPP's MySQL client" instinct will fail
    here. See also `CLAUDE.md`'s Run section, corrected by this phase.

    **Update (2026-09-24): it is actually two servers on one port.** After a
    reboot, `SELECT @@version` through `php/connect.php` returned
    `10.4.32-MariaDB` (datadir `C:\xampp\mysql\data\`, port 3306), and the
    `MySQL80` service showed Stopped (start type Automatic). Whichever server
    starts first owns port 3306 and becomes "the DB", and each has its own
    `sining_kamay_db`. The MariaDB copy migrated itself on its first request
    (`ensure_gestures_columns()` added the column, and the sync created the
    rows with heuristic categories). Measured: 209 rows, 0 NULL, 0 invalid,
    ESL 67/26/10/17 and FSL 50/0/10/29, 209/209 equal to the heuristic —
    the same as the MySQL 8.0 copy on 2026-09-23. Risk: any manual re-tag or
    other DB-only state lives in whichever server was running at the time,
    and silently "disappears" when the other one wins the port. Fix (owner
    decision): disable one of the two, e.g. set `MySQL80` to Manual/Disabled
    or stop starting XAMPP's MySQL module.

    **RESOLVED 2026-09-24 (owner).** The project standardized on XAMPP
    MariaDB, which is also what the Pi on Bookworm will run. The owner set
    `MySQL80` to Stopped/Disabled, so MariaDB (`c:\xampp\mysql\bin\mysqld.exe`,
    datadir `C:\xampp\mysql\data\`) is now the only DB server. The MySQL 8.0
    copy of `sining_kamay_db` is orphaned; it had the `category` column as of
    2026-09-23 and was not backed up by this change. Still open: XAMPP's
    MariaDB runs `--standalone` from the Control Panel, not as a Windows
    service, so nothing listens on port 3306 after a reboot until someone
    starts it (Control Panel "Svc" checkbox, or Config → Autostart).

69. **Low severity, open (dev-only path): the "G" hotkey label path skips
    Type auto-select.** `js/gesture-data.js` `startRecording()` fills the
    name input from `prompt()` without firing an `input` event, so the Type
    radio keeps its previous value, which is then sent as an explicit
    `category` and overwrites the label's stored tag. The kiosk has no
    physical keyboard and `talk.html` disables the hotkey. Found by the
    2026-09-23 final review; not fixed.

    **RESOLVED 2026-09-26 (video-based gesture capture).** The old
    live-capture code this hotkey lived in — `startRecording()`,
    `captureFrameIfRecording()`, `FRAME_TARGET` — was removed outright
    (Q8, `docs/system/DECISIONS.md`); grep-confirmed no `prompt(`/hotkey code
    remains anywhere in `js/gesture-data.js`. Recording now only starts
    through the Add Data form's "Record 3 samples" button
    (`gesture-training.html:224` → `openRecordingMode()`,
    `js/gesture-training-ui.js:1325-1342`), which reads the label, Sign Set
    and Type straight from the form's own inputs — there is no `prompt()`
    path left to skip Type auto-select.

70. **Low severity, open: the Type is read at confirm time, not capture
    time.** `confirmAndSave()` reads the checked `gestureCategory` radio when
    the preview is saved; if the operator edits the name or Sign Set between
    Finish Capture and Save, auto-select re-evaluates for the edited pair
    while the save still targets the captured label/set. Found by the
    2026-09-23 final review; not fixed (the plan specified save-time
    reading).

    **RESOLVED 2026-09-26 (video-based gesture capture).** Label, Sign Set
    and Type are now captured once, when the recording mode opens:
    `openRecordingMode()` (`js/gesture-training-ui.js:1325-1342`) reads
    `currentLabelClean()`, `selectedSignSet()` and the checked
    `gestureCategory` radio into the `opts` passed to
    `GestureCaptureUI.open()`, which stores them as `session`
    (`js/gesture-capture-ui.js:190-197`) before the countdown/recording/
    review/save flow runs. The full-screen mode has no path back to the
    form's fields until it closes, so there is nothing left to edit
    mid-flow that could disagree with what gets saved.

71. **Low severity, latent: a label present in both ESL and FSL shows one
    category, and `delete_gesture` deletes one `gestures` row.**
    `renderSavedDataset()` takes the sign set from `samples[0]`, and
    `save_gesture.php`'s `delete_gesture` selects `WHERE word = ? LIMIT 1`.
    Both pre-existing; 0 labels overlap across sets today (measured
    2026-09-23). `scratch/trigger_sync.php` also keeps its own stale copy of
    `ensure_gestures_columns()` and inserts `gestures` rows without a
    category (they get DEFAULT `word`, not the heuristic) — scratch-only.

    **Partly resolved (2026-09-24, DB normalization).** The
    `scratch/trigger_sync.php` part is gone — the file was deleted (Task 4;
    it would have recreated `esl_signs`/`fsl_signs` and the old columns if
    run). `delete_gesture` now selects `WHERE label = ? LIMIT 1` (column
    renamed) but the "one row per (label, sign_language) pair, `LIMIT 1`
    picks one" shape is unchanged — the ESL/FSL-same-label part of this item
    is still open.

    **RESOLVED for the ESL/FSL-same-label part (2026-10-04, sign-texts phase).** A label is now
    unique (`uq_gestures_label (label)`) and a sign is one folder with one set (`ESL`/`FSL`/`BOTH`),
    so a label can no longer exist twice. The same key with a different set is HTTP 409 and nothing is
    written (`php/api/save_gesture.php:497-505`); a Both sign is one `gestures` row with one category
    (shown under both `categories` maps, `:291-296`); `delete_gesture` deletes by label from both folders
    and removes the single row (`:376-414`). 0 labels overlap across sets (the migration merged the 89
    that did, `docs/system/BACKEND.md`).

72. **High severity, open (report only, 2026-09-24): `admin_api.php` and
    `core_api.php` run destructive actions with no real authentication.**
    Both answer any request that reaches them. Both send
    `Access-Control-Allow-Origin: *` (`php/admin_api.php:2`,
    `php/api/core_api.php:9`). Apache serves on the network, not only on
    localhost: `C:\xampp\apache\conf\httpd.conf:60` is `Listen 80`, bound on
    0.0.0.0 and :: (measured on the dev PC on 2026-09-24; the Pi's Apache
    config is not specified in the repo).
    - **`php/api/core_api.php` has no check of any kind.** No session, token,
      or role check exists before its `switch ($action)`. Any POST can call
      `clear_store` (runs `TRUNCATE TABLE gesture_recordings` or
      `translations`), `delete_recording`, `delete_translation`,
      `save_recording`/`save_translation` (the latter uses columns that don't
      exist, item 2), or `get_stats`.
    - **`php/admin_api.php`'s check can be spoofed.** Every action calls
      `requireAdmin($requesterRole)`, but that role is looked up from the
      client-supplied `requester_id` in the request body (`admin_api.php:15-21`;
      its own comment says "In production, use session tokens"). There is no
      session or password check, so sending `"requester_id": 1` passes,
      because the seeded admin is `users.id = 1` (measured 2026-09-24).
      That unlocks `create_user` (including with `role = admin`),
      `update_user` (including setting a new password), `delete_user`,
      `get_users` (returns the users table), `delete_gesture`, and
      `clear_gestures` (`TRUNCATE TABLE gestures`). `gestures` is rebuilt
      from disk by the next sync, but that would erase every manual category
      re-tag, which lives only in the DB (item 65).
    - Neither file has a front-end caller (items 6, 8), so no UI depends on
      the current behaviour. The options are deleting both files outright or
      putting them behind a real server-side session check.
    - **Related, outside this item's scope:** `save_gesture.php`'s
      `delete_gesture` action, which the live Step 1 Delete button uses, is
      also unauthenticated. The gesture-training page's PIN gate
      (`CORRECT_PIN`, `gesture-training-ui.js:23`) is client-side only.
    - Not fixed; logged per owner instruction.

    **Update (2026-09-24, DB normalization):** the `core_api.php` half of
    this item is resolved by that file's deletion (see item 2). `admin_api.php`
    remains open and unauthenticated exactly as described above. One new
    consequence of the added foreign key: `admin_api.php`'s `delete_gesture`
    and `clear_gestures` actions now **fail** against a `gestures` row that
    still has recordings (`ON DELETE RESTRICT`, `TRUNCATE` blocked by the FK
    too), where before they would silently orphan the row's recordings. This
    is a safety improvement, not a new risk — recorded here so a later
    session doesn't read the failure as a regression.

    **Update (2026-09-25, saved-conversations phase) — scope extended, owner
    decision:** the same "no server-side auth" gap applies to the two new
    endpoints, `php/api/save_conversation.php` and `php/api/conversations.php`
    (both files' own header comments say so). `conversations.php` in
    particular is a full list/detail/delete/clear_all endpoint behind nothing
    but `reports.html`'s client-side PIN — see item 79 for the specifics.
    Kept open by owner decision at proposal time
    (`docs/reports/2026-09-25-saved-conversations-step1.md` section (d): "It
    has the same gate as `reports.php` today, which is none on the server
    side"), consistent with every other admin endpoint this item already
    covers.

73. **Medium, open: fresh-machine/Pi setup — the tracked `.sql` dumps are
    pre-normalization and not importable with the current code.** Both
    `sining_kamay_db.sql` and `db-schema/sining_kamay_db_backup.sql` predate
    the 2026-09-24 schema-normalization phase (they still have
    `esl_signs`/`fsl_signs`, `gestures.word`,
    `gesture_recordings.sample_count`/`gesture_type`/`thumbnail`), and
    `save_gesture.php` and the other endpoints now expect the current
    5-table shape (4 tables after the 2026-09-24 normalization; `conversations`/
    `messages` added and `translations` dropped 2026-09-25). `db-schema/migrations/2026-09-24-normalize.php` cannot
    convert either dump into the current shape: it requires the `category`
    column added in the 2026-09-23 gesture-categorization phase (neither dump
    has it), and its default `--snapshot` path is a hardcoded Windows path.
    See `docs/system/BACKEND.md`, "Schema migration and fresh-machine setup
    (2026-09-24)", for the two supported setup routes. **Must be followed
    before the Pi is updated** — importing either tracked dump there as-is
    will not work with the current code.

    **Update 2026-10-04 (sign-texts phase).** The dumps also lack `gestures.text_en`/`text_fil`,
    the `BOTH` enum value, `uq_gestures_label` and `chk_gestures_texts`. There are now **three**
    supported routes (dump the migrated DB; `database_setup.sql` + one full sync + backfill; or,
    for an existing pre-phase DB, `git pull` + one full sync, which upgrades the table in place
    but does not add the CHECK — item 103). See `docs/system/BACKEND.md`, "Schema migration and
    fresh-machine setup (2026-09-24)", "FRESH MACHINE / PI SETUP". **Must still be followed
    before the Pi is updated.**

74. **Low, open: `gesture_recordings.landmark_json` duplicates each sample's
    JSON file on disk.** Measured 2026-09-24 (Step 1 proposal): ~9.46 MB
    across 210 rows, the bulk of a full DB dump. Kept by owner decision
    (`docs/system/DECISIONS.md`, schema-normalization phase) — inside the DB
    it's the recording's own payload, not duplicated *within* the DB, but it
    is a byte-for-byte copy of the on-disk sample file the sync already
    treats as the source of truth.

75. **Low, open: `reports.php` only backfills a missing `asset_path` when a
    `.mp4` exists, not a `.webm`.** `php/api/reports.php:~31` (`fetch_gestures()`)
    checks `assets/signs/<en|fil>/<label>.mp4` on disk for a still-NULL
    `asset_path`; a newly synced or video-less gesture whose only clip is a
    `.webm` (the common case — `assets/signs/en/` holds 120 `.webm` files and
    0 `.mp4` files, `DEBT.md` item 62) keeps a NULL `asset_path` from this
    endpoint forever, even though the same file would satisfy
    `db-schema/migrations/2026-09-24-backfill-asset-path.php`'s check. That
    backfill script is one-time, not run automatically on sync, so this gap
    reopens for every gesture recorded after it last ran.

    **Update 2026-10-04.** `fetch_gestures()` now spans `php/api/reports.php:22-64`, the
    `.mp4` backfill is `:45-57`, and a Both sign on the FSL tab is looked up under
    `assets/signs/fil/<label>.mp4` (the Both sign's clip is saved under `assets/signs/en/`,
    `php/api/save_gesture.php:614`), so the backfill misses it there as well. Unchanged otherwise.

76. **Low, open, pre-existing (not introduced by this phase): `save_gesture.php`'s
    POST response reports `dbGestureCreated: true` even when the `gestures`
    row already existed.** `save_gesture_word_to_db()`'s `ON DUPLICATE KEY
    UPDATE id = LAST_INSERT_ID(id)` clause (`php/api/save_gesture.php:78-85`)
    makes `LAST_INSERT_ID()` return the existing row's id on a duplicate-key
    update, and the code reads that as "created" regardless. Observed
    2026-09-25 saving a second sample for an existing label. Not a
    normalization regression — the same `ON DUPLICATE KEY UPDATE` pattern
    predates this phase — but only became visible while re-verifying the
    rewritten save path.

77. **Low, open, tester note only, not a bug: `talk.html`'s idle return (120 s
    + 30 s countdown, `talk.html:1273`/`:1475`) can fire during a slow or
    automated test session.** An automated tool or a slow manual walkthrough
    that leaves the page untouched past the timeout gets sent back to the
    dashboard mid-check — this is the designed idle-timeout behavior
    (`docs/system/DECISIONS.md`, "Idle countdown length"), not a defect,
    recorded here so a future test session doesn't mistake it for one.

78. **Low, open (saved-conversations phase, 2026-09-25, accepted design):
    tapping End within the message-save round trip can leave `ended_at`
    NULL.** `js/talk-history.js`'s `saveMessage()` and `end()` are two
    independent fire-and-forget requests to `php/api/save_conversation.php`
    (`docs/reports/2026-09-25-saved-conversations-step1.md` section (b), "the
    known edge case"). If a person taps End Conversation in the brief window
    while the just-added message's `action:"message"` request is still in
    flight, the `action:"end"` request can reach the server first; `end`'s
    `UPDATE conversations SET ended_at = ... WHERE client_key = ? AND
    ended_at IS NULL` (`php/api/save_conversation.php:136-148`) then matches
    0 rows, because the conversation row doesn't exist yet (it's created by
    the still-pending `message` insert). No message is lost — the `message`
    request still lands — but the conversation is left with `ended_at IS
    NULL`, and Reports shows it as "Not ended" even though the person did
    tap End. Owner-reviewed and accepted as a known edge case, not fixed
    (`.git/sdd/progress.md`, Task 4 minors).

79. **Low, open: `php/api/save_conversation.php` and
    `php/api/conversations.php` have no server-side auth.** Extends item 72's
    scope — item 72 stays open. `save_conversation.php` is write-only and
    never echoes back conversation content, so its lack of auth cannot be
    used to read past conversations; `conversations.php` is a full
    list/detail/delete/clear_all endpoint gated only by `reports.html`'s
    client-side PIN (`CORRECT_PIN`, same posture as `reports.php` and every
    other admin endpoint item 72 already covers) — any client on the network
    that can reach Apache can list, read, delete, or `clear_all` every saved
    conversation without the PIN.

80. **Low, open: a bfcache (back/forward cache) restore of `talk.html` can
    reuse an already-ended `client_key`.** `js/talk-history.js` generates its
    `clientKey` once, at script-parse time, and the `pagehide` listener that
    sends `end('left')` fires on a bfcache-eligible navigation too. If the
    browser later restores the page from bfcache (a `pageshow` with
    `event.persisted === true`, which this file does not listen for) instead
    of re-running the script, the in-memory `clientKey`/`confirmed`/`ended`
    variables are untouched from before the navigation, so a new message
    confirmed on the restored page would call `saveMessage()` against an
    already-`ended` `client_key` — the server accepts it as an ordinary
    `action:"message"` (it doesn't check `ended_at`), so the message is
    saved and visible in Reports, but under a conversation Reports already
    shows as ended. Not exercised or fixed this phase — the verification
    Chrome sessions used (headless CDP, the in-app Browser pane) do not
    reliably exhibit bfcache restores the way a real touchscreen Chromium
    session might.

81. **Low, open: `fetch(..., {keepalive:true})`'s body-size cap (64 KiB in
    Chromium) is under `messages.text`'s own 65,535-byte limit.** Chromium
    silently drops (does not send, does not error) a `keepalive` request
    whose body exceeds roughly 64 KiB; `save_conversation.php` accepts `text`
    up to `strlen($text) <= 65535` bytes (`php/api/save_conversation.php:73-75`).
    A message near the top of that range, once wrapped in the JSON request
    body (`client_key`, `seq`, `speaker`, `source`, `sign_language`, `text`),
    can cross the `keepalive` cap and never reach the server at all —
    `js/talk-history.js`'s `post()` would see this as an ordinary rejected
    `fetch` (a `console.warn`, no UI). In practice a message this long is far
    beyond anything a spoken/typed/signed turn produces in this app, but the
    two limits are not aligned and nothing enforces the tighter one
    client-side. Not fixed this phase — flagged as a docs note per the
    whole-phase review.

82. **Low, open, pre-existing (not introduced by this phase): `php/connect.php`
    never calls `mysqli_set_charset`.** All UTF-8 (`utf8mb4`) behavior for
    `conversations`/`messages` (and every other table) currently depends on
    the MariaDB server's own default connection charset matching the
    tables' `utf8mb4` `DEFAULT CHARSET`. Works today (confirmed by every
    ESL/FSL label and every conversation message saved during verification
    round-tripping correctly), but should be checked explicitly once this
    runs on the Raspberry Pi's own MariaDB install, which may have a
    different default.

83. **Low, open: `php/api/conversations.php`'s list (`GET`, no `id`) has no
    `LIMIT`/pagination.** `fetch_conversations()` (`php/api/conversations.php:37-70`)
    returns every row in `conversations` in one response, unlike
    `get_translations.php` (deleted this phase, but which had a `?limit=`
    default of 50/max 200). Not a problem yet at the row counts this phase's
    verification produced (`.git/sdd/progress.md`, Controller verification:
    3 conversations), but there is nothing to stop the Reports Conversations
    list and its supporting query from growing without bound.

84. **Low, open, pre-existing pattern (not introduced by this phase):
    `php/connect.php`'s DB-down response is HTTP 200 with a bare
    `{"error":...}` body, not `{"success":false,"error":...}`, and
    `save_conversation.php` opens the DB connection (via
    `require_once __DIR__ . '/../connect.php'`) before checking the request
    method.** Both endpoints' clients cope: `js/talk-history.js`'s `post()`
    treats any body without `success === true` as a failure and only
    `console.warn`s, and a non-POST request to `save_conversation.php` still
    gets a working (if slower than necessary) 405 after the connection is
    made. Matches the "inconsistent error-response shape" pattern already
    tracked in item 16 above; recorded here specifically for the two new
    endpoints.

85. **Not a defect, verification gap (owner to close): the signed Let's Talk
    turn was not exercised with a real camera sign during this phase's
    verification.** Every other message-source path (typed, and spoken via a
    real Vosk transcription of a fake-microphone WAV) was driven through the
    real UI end to end; the signed path was verified by code review plus a
    temporary, fully-reverted debug hook that called the exact same
    `onText(text, meta)` callback `js/talk-signing.js:127` calls, not by an
    actual camera + k-NN recognition producing a sign
    (`.git/sdd/conv-task-4-report.md`, `.git/sdd/progress.md` "Controller
    verification"). The browser-automation environments available
    (headless Chrome via CDP, the in-app Browser pane) both block real
    camera/microphone device access. Needs a person with a camera and a
    trained sign, on a machine with real hardware, to close out.

86. **Low severity, open (video-based gesture capture, 2026-09-26):
    `save_gesture.php`'s display-clip code is unused by the new recording
    flow.** The video-transcode branch (`php/api/save_gesture.php:494-564`,
    triggered by a non-empty `video_base64`) is now dead weight for every
    *new* label: `js/gesture-capture-ui.js`'s save calls
    (`saveGestureSample(...)`, `:639-650`) never send `video_base64`/
    `video_path` — measured directly (Task 6 e2e): 0 of 31 save requests
    carried either field, and the `assets/signs/` directory listing was
    identical before and after a full recording. A label recorded for the
    first time through Step 1 therefore gets no display clip: Reports' View
    Asset stays empty and `asset_path` stays NULL for it. The branch still
    matters for old v2-era labels that already have a clip on disk
    (`find_label_video()`'s skip-if-exists rule, `:591-597`, still runs on
    every save, it just never finds new base64 video to act on). Will be
    removed when the planned caricature/avatar feature replaces display
    clips outright.

87. **Low severity, open (video-based gesture capture, 2026-09-26): Pi
    performance is entirely unmeasured for the new recording flow.** Not
    measured on the target hardware: seek cost on VP8 WebM with sparse
    keyframes on a Pi 4 CPU (`extractVideoLandmarks()`'s per-frame
    `video.currentTime` seek loop, `js/video-landmarks.js:183-196`); the
    live hand-tracking loop's results/s during recording, while a VP8
    `MediaRecorder` encode and up to 2-3 `<video>` elements (camera preview,
    `#gcLive`, the review clip) are live at once; whether live vs. offline
    rep boundaries agree within the `STOP_TAIL_MS` 500ms margin
    (`js/capture-core.js:17`) on slower hardware; and whether
    `RESULTS_WATCHDOG_MS` 5000 (`js/capture-core.js:19`) is long enough on a
    Pi under load. Possible mitigation, not applied: `MediaRecorder`'s
    `videoKeyFrameIntervalDuration` option (not set anywhere in
    `js/gesture-capture-ui.js`'s `new MediaRecorder(...)` call, `:329-340`),
    which would make seeking more evenly spaced. The Pi's MariaDB
    `max_allowed_packet` is also unknown; a compact 301-frame two-hand v3
    sample is estimated at ~0.5 MB by the whole-phase reviewer — an
    **estimate, not measured**.

    **Update 2026-09-27 (owner):** compact JSON for v3 approved. A pre-deploy
    check was added to `docs/system/MANUAL-CHECKS.md`: on the Pi, `SHOW
    VARIABLES LIKE 'max_allowed_packet';` must be >= 1M. This item stays
    open until the Pi timings are measured.

88. **Low severity, open (video-based gesture capture, 2026-09-26): v3 reps
    include the hand's entering/leaving frames.** A rep's boundary is the
    first/last hand-*present* frame (`closeRepAt()`, `js/capture-core.js:
    43-61`, using `lastHandMs`), and the subsampler (`js/gesture-data.js:
    690-693`) evenly samples across a rep's rows by index — the formula
    `Math.round(i*(n-1)/(MAX_ROWS_PER_RAW_SAMPLE-1))` is guaranteed to
    include row index 0 and `n-1`, i.e. the very first and last hand-present
    frames of the rep are always kept. Those transition frames (hand still
    rising into or dropping out of frame) may look similar across many
    labels, which could raise cross-label similarity in `knnPredict` (scores
    by the mean of the top-5 cosine similarities, `gesture-training-ui.js:
    310`). Owner decision pending: trim the edges vs. accept this until the
    keyframes phase replaces the even-subsampling scheme.

    **Update 2026-09-27 (owner):** accepted as is until the keyframes phase.
    Stays open.

    **Update 2026-10-16 (compact-model phase, measured):** the keyframes phase did not trim the edges.
    In Step 1 (`docs/reports/2026-10-14-compact-model-step1.md` section 2.3), trimming 200 ms at both ends
    before even spacing matched plain even spacing on T2 (vote 71.7 / 80.8 at 10 / 15 rows, as without the
    trim) but scored 2.5 / 1.7 points lower on T2r (71.9 / 82.6 against 74.4 / 84.3), and every fixed count
    per sample lost more than 2 points against today's rows on at least one set (at 20 rows per sample: T2
    0.8 points, T2r 3.3). The shipped rule (a per-sign
    budget of 90 rows, `docs/system/ML.md` "Compact model") keeps today's rows unchanged, transition frames
    included; above the budget `evenIdx` (`js/knn-compile.js:49-60`) also keeps each sample's first and last
    row. The subsampler cited above is now `js/gesture-data.js:757` (`recordingToFeatureRows`) and the top-5
    mean `js/gesture-training-ui.js:639`. Status: open, accepted as measured; re-check with
    leave-one-signer-out after the first real import (item 128).

89. **Low severity, open (video-based gesture capture, 2026-09-26): no
    overall recording-length cap.** `js/capture-core.js`'s `CAPTURE`
    constants (`:10-21`) bound a single rep (`MAX_REP_MS` 20000) and
    hand-tracking staleness (`RESULTS_WATCHDOG_MS` 5000), but nothing bounds
    the whole REST → SIGN 1 → SIGN 2 → SIGN 3 recording's total wall-clock
    length if the signer takes their time resting between reps. Owner
    decision pending.

    **RESOLVED 2026-09-27 (owner decision on the video-capture final
    report).** `CAPTURE.MAX_RECORDING_MS` = 90000 (`js/capture-core.js:20`)
    now caps the whole take: the segmenter fails with `'recording-too-long'`
    once a push is >= 90000 ms after the first push and the take hasn't
    reached `done` (`:80-84`; a take that already reached `done` is never
    failed by it). Live, the recording is stopped and discarded with
    "Recording too long. Try again." and Redo (Cancel top-right)
    (`js/gesture-capture-ui.js:416-419`); offline, `segmentFrames()` returns
    that reason and the same message is shown
    (`js/gesture-capture-ui.js:617`). Covered by 4 unit tests in
    `tests/video-capture/segmenter.test.mjs` (23/23 pass, measured
    2026-09-27).

90. **Low severity, open (video-based gesture capture, 2026-09-26): "Retry
    save" is not idempotent.** `php/api/save_gesture.php` writes the sample
    JSON file to disk (`file_put_contents`, `:490`) before the DB insert
    (`save_gesture_word_to_db()`/`save_gesture_recording_to_db()`, `:567`,
    `:580`). A DB failure, or a lost HTTP response, followed by
    `js/gesture-capture-ui.js`'s "Retry save" (`:97-99`, re-running
    `runSaves()`, which re-POSTs any rep whose `saved` flag is still false)
    can leave a duplicate rep file on disk if the first attempt's file write
    actually succeeded but the response was never seen — the next disk→DB
    sync (`sync_disk_to_db`) would then add it as an extra
    `gesture_recordings` row. Pre-existing write-then-insert order (not new
    this phase); newly reachable now that a failed save can be retried by
    the user from the UI.

    **Update 2026-09-27 (owner):** accepted. Stays open.

91. **Low severity, open (video-based gesture capture, 2026-09-26): if a
    wedged detector send left the live hand loop paused, the watchdog
    reports it but Redo does not resume the loop.** `toReady()`/`resetWork()`
    (`js/gesture-capture-ui.js:297-302`, `:223-235`) releases the held
    detector via `detector.release()`
    (`js/gesture-data.js:579-599`), but `release()` only resumes the live
    loop once `detectorSendPending` clears (`finishReleaseIfReady()`,
    `:488-503`) — a `hands.send()` that never settles (no `onResults`, no
    resolved/rejected promise) leaves that flag pending forever, so the live
    loop stays paused even after Redo. Reload the page to recover.

    **Update 2026-09-27 (capture UI layout fix): partly addressed.** Redo now goes back
    through "Starting camera", whose `acquireCaptureCamera()`
    (`js/gesture-training-ui.js:1130-1140`) calls `resumeHandLoop()`. A live loop that was
    merely paused therefore recovers on Redo, and `tests/video-capture/capture-ui-check.mjs`'s
    watchdog run now asserts that without the test resuming the loop itself. A truly wedged
    detector send still keeps detector mode on. Its results never reach `onHandResults`, so
    Starting camera times out after `READY_TIMEOUT_MS` (60 s since the owner follow-up) with "Hand tracking is not
    ready. Please try again." Reloading the page is still the recovery in that case.

92. **Low severity, open, pre-existing (video-based gesture capture,
    2026-09-26, noticed not introduced): an orphan file,
    `saved_gestures_fsl/sample_1784112605537_bec003.json`, sits at the FSL
    dataset root with no label folder** (confirmed still present on disk).
    `list_samples()`'s per-label glob only reads
    `saved_gestures_fsl/<label>/sample_*.json`, so this file is never listed,
    synced, or served — dead weight, not a functional problem.

    **RESOLVED (2026-10-04, sign-texts migration).** The file was one of the 90
    proven duplicates the one-time migration moved out of the active dataset: step 2
    proved its frames identical to `saved_gestures/my_name/sample_1784112605409_7920b5.json`,
    step 5 copied it to the backup with a matching sha256 and deleted the original
    (`docs/system/BACKEND.md`, "The 2026-10-04 sign-texts migration"; backup
    `E:\ACADSS\IOT\backups\2026-10-04-sign-texts\saved_gestures_fsl\`). `saved_gestures_fsl/`
    now holds 0 sample files.

93. **Low severity, open (video-based gesture capture, 2026-09-26): the Step
    1 sample line's "(N frames)" count is raw v3 frames, not training rows,
    and its Save-disabled check is currently unreachable.** The count comes
    from each sample's `frameCount` (`php/api/save_gesture.php:453`, summed
    at `gesture-training-ui.js:303`/`:310`) — the raw per-landmark frame
    count for the rep, including in-rep frames with no hand, not the ≤30
    training rows `recordingToFeatureRows()` (`js/gesture-data.js:677-695`)
    actually feeds to `knnPredict`. Separately, `reviewCount`
    (`js/gesture-capture-ui.js:495`, `:530`) is always exactly
    `REQUIRED_REPS` (3) by the time Save is reachable —
    `segmentFrames()` only returns `ok:true` when `repsFound ===
    REQUIRED_REPS` (`js/capture-core.js:223-231`) — so the `n !==
    C().REQUIRED_REPS` disabled-check at `:455` is a defensive branch that
    can't currently be hit, not a live gate.

94. **Low severity, open (sign-texts phase, 2026-10-04; pre-existing by size, not caused by this
    phase): the localStorage quota cannot hold both language models.** Measured in Task 8: the ESL
    k-NN cache is about 3.59M characters of an origin quota of roughly 5.2M, and the FSL model (91
    labels, about 2.5M) cannot also be cached. `trainModel()` still reports "Complete" and only
    `console.warn`s plus a training-log line `// Warning: could not cache model`
    (`js/gesture-training-ui.js:898-904`); in an unmodified run `sining_kamay_knn_FSL` was `null`
    after FSL training. On the kiosk the FSL model is rebuilt each session instead of cached
    (`talk.html`'s `autoTrainForTranslate()` trains from the database when no cache exists).
    No pre-phase measurement exists. Membership counts, from the migration output: the ESL model has
    122 signs before and after (122 ESL rows before; ESL + Both now), the FSL model 89 signs before
    and 89 Both + the shared `start` now. The Pi's quota is not measured. Not fixed.
    **RESOLVED (2026-10-16, compact-model).** No k-NN model is stored in `localStorage` any more. Both
    compiled files (`models/knn_ESL.bin`, 1,045,196 bytes; `models/knn_FSL.bin`, 723,096 bytes) are cached
    in IndexedDB at the same time (`js/knn-model-store.js`, database `sining_kamay_models`, one entry per
    language). Measured in `tests/compact-model/kiosk-check.mjs` (3 runs): after a reload both languages load
    from the stored copy with one HEAD each (Let's Talk's loading step for ESL, which also waits for
    `signs.php`, 50 / 58 / 46 ms; FSL 8 / 14 / 7 ms; switching back to ESL in the same session 11 / 9 / 10 ms); storage with both cached
    1.13 MB (`tests/compact-model/bench.html`). The one-time schema-"3" reset (`js/gesture-data.js:16-25`)
    removes the six old keys (1,200,000 characters in that check). The Pi's IndexedDB quota is not measured.

95. **Low severity, open (sign-texts phase): deleting a sign does not invalidate the cached model
    label lists.** `deleteGesture()` (`js/gesture-training-ui.js:538-566`) removes the sign from
    `trainData` and re-renders, but never touches `sining_kamay_labels_<ESL|FSL>` or the knn
    caches; the dataset-modal Edit does clear the labels cache of every language whose membership
    changed (`:259-263`). `mergeSavedGestureSamples()` already filters cached labels against the
    current rows (`:736-757`), which limits the effect, so this is a stale-cache risk until the next
    Train, not a confirmed wrong result.
    **RESOLVED (2026-10-16, compact-model).** There are no cached label lists any more. After a delete,
    `deleteGesture()` (`js/gesture-training-ui.js:568-593`) reloads the summary listing and the model status
    (`:586`), so the status line reads "Model out of date: run Compile" until the next Compile; Steps 3/4 keep
    using the loaded file until then.

96. **Low severity, open (sign-texts phase): Step 4 uses its own Output Language chip, not the Step 2
    model language.** `signLang` (`'en'`/`'fil'`, `js/gesture-training-ui.js:9`, `:1104`) is independent
    of `modelLanguage()`. An FSL-only sign recognised with the English chip has no English text, so
    `translateGestureLabel()` falls through to the title-cased key (`:326-338`), e.g. "Zz Fsl Lamang"
    style output rather than a real English text. Documented gap, per the brief
    (`.git/sdd/st-task-4-report.md` concern 3); Step 3 is correct (it follows the model toggle).

97. **Low severity, open (sign-texts phase): a 409 during a save offers "Retry save", which retries the
    same failing request.** The capture UI's save-error state shows Retry save alone
    (`js/gesture-capture-ui.js:669-676`, `:130`); a 409 ("A sign with this key already exists as <SET>.",
    `php/api/save_gesture.php:497-505`) cannot succeed on retry because nothing changed. The Step 1 form
    disables Record when the key clashes (`js/gesture-training-ui.js:469-482`), so this is reachable
    only if the dataset changed between the form check and the save (e.g. another tab).

98. **Low severity, open (sign-texts phase): a failed dataset reload after a successful edit reports "Save
    failed" in a hidden panel.** `trDatasetEditSave()` hides the edit panel before
    `await window.reloadDataset()` (`js/gesture-training-ui.js:265-268`); if the reload throws, the `catch`
    writes `Save failed: ...` into `#dsEditMsg` (`:270-271`), which is no longer visible, although the
    POST already succeeded. The user sees the table with the previous values and the "Saved." toast. Also:
    the modal's ✕ in edit mode closes the whole modal with no unsaved-change prompt, and Cancel while a
    save is in flight is not guarded.

99. **Low severity, open (sign-texts phase): the dataset edit panel's error message is clipped at 32 px.**
    `.tr-ds-edit-msg` has `max-height: 32px; overflow: hidden` (`css/gesture-training.css:759`), so a long
    server `error` (up to the 255-character text limits it can echo) shows only about two lines.

100. **Low severity, open (sign-texts phase, by design): a Both sign's English key also resolves in the
     Filipino map.** `fetchAndRegisterCustomGestures()` registers the key and the key with spaces in
     each language map the sign belongs to, valued by the sign's `assetPath`, which is its `en/` clip
     (`js/sign-player.js:246-275`). Typing "how are you" in Filipino mode therefore plays the English
     clip as well, and a Both sign's Filipino entries point at an `en/` path (the first-step probe
     `assets/signs/fil/<text>.webm` still wins when such a file exists).

101. **Low severity, open (sign-texts phase): the legacy `saved_gestures_fsl/` read path is untested, and
     `signs.php` update 404s for a legacy-only FSL folder.** The folder is empty after the migration, so
     no test exercises sync/list/collision/delete of a legacy folder without `sign.json` (derivation as
     FSL, `php/api/sign_meta.php:79`). `signs.php` update only looks in `saved_gestures/`
     (`php/api/signs.php:84-89`), so such a folder cannot be edited from the dataset modal until its samples
     are moved. Also, `js/talk-loader.js:50` calls `window.GestureDataRecorder.loadSigns()` with no existence
     guard (it assumes the `sign-libs` item loaded `gesture-data.js`).

102. **Low severity, open (sign-texts phase): `tests/sign-texts/signs-endpoint.test.mjs` runs a full-sync GET
     that upserts real rows.** A full GET of `save_gesture.php` reconciles disk to DB for every real sign
     (rewrites `sign_language`/`text_en`/`text_fil` from disk when they differ). It is idempotent — measured
     on live: 89 BOTH / 33 ESL, 127 recordings and the md5 of all 122 real `sign.json` unchanged before and
     after (`.git/sdd/st-task-2-report.md`) — but it is the one test in the folder that is not confined to
     `zz` probe rows.

103. **Low severity, open (sign-texts phase): an upgraded database lacks `chk_gestures_texts`.**
     `ensure_gestures_columns()` upgrades a pre-phase DB in place (enum widened, key swapped when no label
     is duplicated, text columns added) but never adds the CHECK (`php/api/gesture_category.php:71-73`,
     `:118-119`). Only `database_setup.sql` (a fresh DB) and the live migration carry it. PHP always writes
     the required texts (`php/api/save_gesture.php:522-523`, `php/api/sign_meta.php:93-98`,
     `php/api/signs.php:100-106`), so the CHECK is a backstop; but a manual SQL edit on an upgraded DB can
     now store an FSL/BOTH row with an empty text. With duplicate labels the old unique key
     `uq_gestures_label_language` also stays until they are removed.

104. **Medium, open (sign-texts phase): the draft Filipino (and English) texts need the owner's correction.**
     The migration filled `textFil` from each FSL folder's Tagalog label and `textEn` from the ESL key (rule:
     `_` → space, first letter upper-cased), so every text is a draft: no apostrophes ("Dont know" for
     "Don't know"), no punctuation, and 18 Filipino drafts are probably wrong (not Filipino at all, or a
     different meaning from the ESL sign): `hibaru`, `host_dad`, `im_so_sick`, `boso`, `ganon_din`,
     `matalusan`, `bigyan_mo_pa_ako_ng_isang_pagkakataon`, `hinihintay_ang_kanan`, `ipadala_ito`,
     `amin_ng_dati`, `malalim_na_tagalog`, `magkasingkahulugan_ng_galit`, `paggawa_ng_kahulugan`,
     `sana_basahin_mo_chat_ko_sa_u`, `wala_akong_nahanap`, `wala_naman_mangyayari_kung_hindi_ko_susubukan`,
     `kaya`, `nakakaintindi_ba_sila_ng_english` (list and the ESL meaning of each: the step 1 report,
     `docs/reports/2026-10-04-sign-texts-step1.md`, "Drafts that are probably wrong" — the author's
     reading, not verified). The owner edits them in View Active Gesture Dataset; the drafts of all 122 signs also
     show on the kiosk (captions, text-to-sign registration) until corrected. Not fixed — owner data.

105. **Low severity, open (sign-texts phase): the Let's Talk "Translate" button flow with a fake camera is
     timing dependent; a real-camera check is still needed.** In Task 8 the flow gave a confirm card
     ("You signed Zz Pareho Na.") once, "Didn't catch that" in two earlier runs, and passed in one run of four
     attempts; three probes copy the same `hello` clip and fight with `hello` for the stable label. The caption
     check (every caption is a sign text of that language, none contains an underscore) was verified instead,
     and the start gesture → sign → stop gesture flow was not driven at all (the fake camera shows only
     `hello`). Needs a real signer on the kiosk (`.git/sdd/st-task-8-report.md` item 8, concern C).

106. **Low severity, open (sign-texts phase): small `save_gesture.php` / `signs.php` / modal gaps found in
     review.** `save_gesture.php` mysqli calls are only `false`-checked, never wrapped for PHP 8.1+
     exceptions, and the delete path never calls `ensure_gestures_columns()` (both the pre-existing
     pattern); `$dbRows`/`$knownPaths` in the sync are case-sensitive PHP array keys against a
     `utf8mb4_general_ci` DB (`php/api/save_gesture.php:177-187`); a sync-time `readBackCategory = false`
     returns the heuristic category, not the stored one (`:117-119`, commented); `reports.php` ignores
     `execute` failures (`php/api/reports.php:36`); the "set → visible fields" rule is duplicated between
     Step 1 and the edit panel (`js/gesture-training-ui.js:426-431`, `:203-207`); the dataset search matches
     a stored hidden text; `tests/sign-texts` has no test for a failed `signs.php` POST, a 409 through the
     DB or legacy folder, an explicit category kept by sync, the `:disabled` Record style, the Step 2 toggle
     lock (`trainModelGuarded()`, a 3-line wrapper) or a hostile text in Reports' View Asset handler
     (`.git/sdd/progress.md` minors, `st-final-fix-report.md` concerns).

107. **Low severity, open (sign-texts phase): the migration script's own minors.** Snapshot and manifest
     writes are not atomic; a truncated backup copy blocks a resume (safe: it fails instead of moving);
     the fixture's `frames`/sha fields are unused by the PHP (it re-proves by deep equality); `--verify-only`
     needs `snapshot.json`; the defaults point at the live DB and the real repo folders, so a bare run
     touches real data (always pass `--db`/`--root`/`--backup-dir`); the tamper test only perturbs a frame
     float (`.git/sdd/progress.md` Task 1, `st-task-1-report.md`).

108. **Low severity, open, test scripts (sign-texts phase): CDP checks drive events programmatically.** The
     `*-check.mjs` scripts (headless Chrome, no real touch or focus) dispatch `focusin` and `pointerdown`
     for the on-screen keyboard (`.git/sdd/st-task-7-report.md`) and the live Step 4 prediction loop's
     sentence sites were verified by code and by the escape helper, not by driving a camera
     (`st-final-fix-report.md`). Typing on the real touchscreen and on-Pi timings are not measured.

109. **Low severity, open (avatar phase): Pi timing of the avatar is not measured.** On this laptop the player
     holds 29.9 fps capped at 30 (GPU and `--disable-gpu`; 0.2-0.3 ms per frame, uncapped 59-60 fps = the
     display rate). Run `bash tests/avatar/pi-bench.sh` on the Pi and record the result
     (`docs/reports/2026-10-05-avatar-final.md`).

110. **Low severity, open (avatar phase): no avatar clips are recorded yet.** Every word still plays as video
     until the owner records clips (one signer) on `avatar-clips.html`. Test clips are never committed.

111. **Low severity, open (avatar phase): extraction is slow and stateful.** About 0.24 s per frame on this
     laptop (61.3 s for a 10.24 s video at 25 fps), and Holistic's tracking state makes two runs on the same
     video differ slightly (right-hand detections 195-198 of 256 across runs). Fine for one clip at a time;
     the later bulk import should expect minutes per batch.

112. **Low severity, open (avatar phase): the gap fill switches sharply at 8 frames.** A hand dropout of up to
     8 frames (320 ms) is interpolated between the neighbouring shapes; a 9-frame one eases about 75% of the
     way to the relaxed hand and back (task review, measured 23-26 px per frame in hand-local steps). Within
     decision 7; a blended weight would smooth it.

113. **Low severity, open (avatar phase): `avatar_clip.php` re-encodes the clip.** `json_decode(..., true)` +
     `json_encode` turns an empty JSON object into `[]`; no field the player reads can be an empty object.
     A rename over a file Apache is serving can fail on Windows; it is retried once after 50 ms.

115. **Low severity, open (avatar phase): a running kiosk page does not see new or changed clips.** The
     text -> key maps (`js/sign-player.js` registration, first registration wins) and the 12-clip cache
     (`js/avatar-store.js`) live for the page load: a clip saved or redone on `avatar-clips.html` is used
     after `talk.html` reloads (End Conversation does a real page load). A deleted clip falls back to video
     at once (its fetch 404s).

114. **Low severity, open (avatar phase): the extracted face is not used.** Facial expressions are out of
     scope; the head only rolls and shifts from the ears and nose.

116. **High, open (bulk importer, 2026-10-14; owner decision): the kiosk must not receive bulk-imported
     samples before the keyframes / compact-model phase.** Projections from measured values: 2 signers
     add about 21,960 training rows to today's 2,047; all 8 add about 87,840. Per sample the dataset
     download grows by about 38 KB (every page that loads the model downloads every frame:
     `php/api/save_gesture.php` GET), and the k-NN model no longer fits in `localStorage` (DEBT 94).
     `knnPredict` on this laptop: 1.1-1.5 ms today, 53-62 ms at 87,840 rows (`ML.md`); the Pi is not
     measured. Imported samples are ordinary tracked files under `saved_gestures/`: do not commit or
     copy them to the Pi until that phase is done.
     **RESOLVED (2026-10-16, compact-model).** The kiosk no longer receives or needs samples: Let's Talk and
     Train Gestures Steps 3/4 load the compiled `models/knn_<LANG>.bin` (measured in
     `tests/compact-model/kiosk-check.mjs`, 3 runs: 0 requests to `save_gesture.php`, the only PHP endpoint was
     `signs.php`). Imported samples are git-ignored (`saved_gestures/*/sample_i*.json`, `.gitignore:11`), so they
     are never committed and never reach the Pi through git. The per-sign budget keeps a model small: with 3,000
     extra synthetic samples the ESL file held 11,047 rows (5,596,344 bytes) instead of every row
     (`tests/compact-model/scale-check.mjs`; `docs/system/ML.md` "Compact model"). Not measured on the Pi
     (item 129).
117. **Medium, open (bulk importer): the Review step downloads the whole dataset, frames included, each
     time it opens and after each import** (`js/bulk-import-ui.js`, `loadReviewData`). 3.48 MB today
     (measured in Step 1); projected about +27 MB with 2 signers and +109 MB with 8. With a large dataset
     the GET may exceed PHP's `memory_limit` (512M here; not measured), and Import stays disabled when it
     fails. A names-only listing would remove the need.
     **Update 2026-10-16 (compact-model phase, measured):** it does exceed it. One v3 sample is 46,316 bytes of
     JSON and 715,443 bytes of PHP memory once decoded; an emulation of the listing at 512M handled 600 v3
     samples (peak 438 MB) and died at 732 (`.git/sdd/cm-phase-review-1.md`). With 732 and with 3,000 synthetic
     v3 samples on disk, the real `GET save_gesture.php?no_sync=1` through Apache answered HTTP 200 with PHP's
     "Allowed memory size" fatal (188 bytes), and through php-cgi at 512M a fatal at a 512 MB peak
     (`tests/compact-model/scale-check.mjs`, `.git/sdd/cm-task-9-report.md`). So the Review step cannot open
     after an import of 2 signers x 3 reps of today's 122 signs. The listing now frees each sample early and
     has `summary=1` (no frames) and `labels=` (a batch of signs) options, which Compile uses
     (`docs/system/BACKEND.md`); bulk import must not change in this phase, so its Review still asks for the
     full listing. Still open.
     **RESOLVED (2026-10-16, bulk-reps-fix, `docs/reports/2026-10-16-bulk-reps-fix.md`).** The Review step reads
     the summary listing (`save_gesture.php?no_sync=1&summary=1`, file names only) for every status, then the
     rows per sample in `labels=` batches of at most 60 samples / 200 signs, as Compile does
     (`js/bulk-import-ui.js` `loadReviewData()` `:1457`, `loadRowCounts()` `:1505`), remembered per file for the
     page load. Not measured: no browser or PHP run was possible in that session; the time at the 3,000-sample
     size is the summary listing's (DEBT 133) plus the batches.
118. **Low, open (bulk importer): never run at full scale or in a visible browser.** Every check ran in
     headless Chrome on at most 10 small videos. Not measured: a folder of about 960 videos (table
     redraws, a multi-hour run), the real folder dialog with a mouse, laptop sleep during a run. The
     projected extraction time for 960 videos (final report) is arithmetic from one real video.
119. **Low, open (bulk importer): paths implemented but not exercised by any test:** a detector timeout
     pausing the queue; a 4xx from a cache POST or from `save_gesture.php` other than 409; a failed text
     update; a video of 60 s or longer; the `beforeunload` warning; extraction blocked during an Apply.
120. **Low, open (bulk importer): identity edge cases.** `importId` is name + size + repetition (owner
     decision), so a re-recorded video with the same name and byte size reads "already imported". Two
     simultaneous POSTs with the same `importId` could both pass the `is_file()` check (the importer
     posts one at a time). A tab closed in the middle of "Apply to all signs" leaves the signs saved so
     far with a clip and no pick, so they then count as picked by hand.
121. **Low, open (bulk importer): rest means "no hand detected".** The segmenter needs 1 s without a
     detected hand before, between and after the signs. In the one real video the hands left the
     picture. Hands held still but visible may still be detected; not measured.
     **RESOLVED for bulk import (2026-10-16, bulk-reps-fix).** The group's videos rest about 1 s, often with the
     hand only lowered, so most gave 1-2 reps (owner: P01 letters, 24 of 26 videos). Bulk import now uses its
     own split (`js/bulk-rep-split.js`): a frame rests when no hand is detected, the hand is lowered below the
     video's own signing zone, or it is nearly still while low; the 2 rest runs that best cut the video into 3
     reps are chosen. Live capture keeps the 1 s no-hand rule (`js/capture-core.js:11`). The thresholds are
     untested on real videos (item 141).
122. **Low, open (bulk importer): `avatar-clips.html` now calls `php/api/bulk_import.php`.** On a machine
     with no cache the listing is empty and the page works as before, but a Save with a `P01`..`P99`
     signer creates `bulk_import_cache/picks.json` there too (git-ignored, harmless).
124. **Medium, open, pre-existing (found 2026-10-14, avatar phase code): the avatar's first movement can
     jump when a clip's first frame has no hand.** `tests/avatar/talk-avatar-check.mjs`'s "blend
     continuity" check (limit 60 px per 40 ms) failed in 2 of 3 runs. Holistic's output varies between
     runs, and the auto-trim then starts one frame earlier or later. Measured over repeated extractions
     of `assets/signs/en/hello.webm`: when the trim starts on a frame with a hand, the rest -> sign
     transition lasts 700 ms and moves at most 43-45 px per 40 ms; when it starts one frame before the
     hand appears, the transition lasts 350-402 ms and moved 40-155 px. With the committed (pre-phase)
     files 1 of 6 extractions exceeded 60 px (74.7); with this phase's files 2 of 6 (107.7, 154.8). The
     cause is in the retargeting / timeline (hand gap fill at a clip's first frame), which this phase
     must not change. Bulk-made candidates are trimmed by the same auto-trim.
     **RESOLVED (2026-10-14, avatar jump fix, `docs/reports/2026-10-14-avatar-jump-fix.md`).** The cause
     was the clip itself: on hello.webm the frame before the hand is found has Holistic's pose wrist low,
     and the next frames move 156-210 px per 40 ms; the transition ended right next to that step. At play
     time (`js/avatar-timeline.js` `clipEdges()`) a clip now plays from its first frame whose raised arms
     have their hands (`AvatarClip.handsReady()`, recorded per frame as `prep.ready` by
     `js/avatar-retarget.js`), moved on past any step faster than 50 px per 40 ms, to the mirror frame at
     its end, so saved clips benefit without re-extraction; and the 700 ms transition cap no longer
     shortens a transition past 60 px per 40 ms. `AvatarClip.autoTrim()` now moves each end inward (at
     most 8 frames, at most half the raised range) to a `handsReady()` frame. Measured on the committed
     fixture (`tests/avatar/fixtures/holistic-signs.json`): 1,546 trims of the three signs, worst 57.4 px
     per 40 ms at either end; 12 extractions of hello.webm, 0 over 60 (worst 49.7, 49.8 with their old trims; 12 of 12 over 60
     with the old code when every 40 ms window is measured). `talk-avatar-check.mjs` now builds its clips
     from that fixture. Not covered: a manual trim whose first or last half has no frame with the raised
     hand detected keeps that end, so a rise inside the clip still plays as recorded.
125. **Low, open (bulk importer, whole-phase review):** (a) "Use this" on Avatar clips checks a candidate's
     set from the listing, not from the file it then fetches, so a candidate replaced by another-set
     video in another tab between listing and click would be saved. (b) With `ESL_x_P01` and `FSL_x_P01`
     in one folder and `x` existing as FSL, the ESL file is first by name and owns the P01 candidate; it
     is not used, and the FSL file never makes one, so the sign gets no P01 clip (listed under "of
     another set"). (c) After a Resume, an avatar signer ticked during the pause is only applied to the
     earlier videos by pressing Start again (a status line says so; not covered by a test).
123. **Low, open (bulk importer): extraction speed depends heavily on what else the laptop is doing.**
     The same video measured 71 ms per frame (Hands) and 129 ms (Holistic) on a quiet machine, and 2 to
     5 times more in the Step 1 probe while other tests were running. The cause of the slow runs was not
     isolated beyond "machine load".
126. **Low, open (compact-model phase, owner answer Q7): bulk import's Review estimate still uses the
     30-rows-per-sample rule.** Each planned repetition adds `min(30, hand frames)` rows
     (`js/bulk-import-core.js:68`, `projectRows()` `:187-197`, used at `js/bulk-import-ui.js:1469`), and the
     "current" rows count every row of every sample (`:1330-1332`), not the compiled file. The page then times
     its `knnPredict` estimate at that size. With the per-sign budget of 90 the real model is much smaller once a
     sign has more than 90 rows (Step 1 projection for 8 signers: 9,164 ESL rows against 89,887), so the estimate
     overstates both rows and milliseconds. Bulk import must not change in this phase; left as is by the owner.
     **RESOLVED (2026-10-16, bulk-reps-fix).** The Review estimate counts, per model, the rows the compile rule
     keeps (`Core.budgetRows()`, `js/bulk-import-core.js:298`, tested equal to `KnnCompile.selectSignRows` on
     12 cases in `tests/bulk-import/rep-split.test.mjs`) for the saved samples now and after the import (new
     reps added, replaced samples removed), and times `knnPredict` at those sizes.
127. **Low, open (compact-model phase): stale references left in files this phase must not change.**
     `js/talk-signing.js:3` cites `tlStartPredLoop` at `js/sign-to-text-ui.js:416-601` (now `:280-465`), and
     the constants block `:11-19` cites `:7` (`GESTURE_HOLD_MS`, now `:9`), `:501` (the 0.45 floor, now `:365`),
     `:432` (no-hand 300 ms, now `:296`), `:600` (150 ms tick, now `:464`), `:723` (countdown, now `:567`) and
     `:876` (skeleton key, now `:691`); `:19` and `:22` are right again. These were already a few lines off
     before the phase; removing the old loaders moved them by about 141 lines. `js/bulk-import-ui.js:1128`
     cites `js/sign-to-text-ui.js:118` for the start/stop rule (now `js/knn-compile.js:43-45`), `:1136` cites
     `knnPredict` at `:204-243` (now `:109-148`), and `:1329` names `mergeSavedGestureSamples()`, which no longer
     exists. `js/bulk-import-ui.js:1656` and `js/gesture-capture-ui.js:698` still remove
     `sining_kamay_labels_<LANG>` after a save, now a harmless no-op. Bulk import's reminder still says
     "Compile (Train AI)". Fix in the next phase that may touch these files.
     **Update 2026-10-16 (bulk-reps-fix):** in `js/bulk-import-ui.js` the start/stop citation now names
     `KnnCompile.inModel` (`js/knn-compile.js:43-45`), the `knnPredict` citation reads `:109-148`, the
     `mergeSavedGestureSamples()` comment went with the rewritten Review loader, and the reminder reads "Now run
     Compile on Train Gestures (Step 2) for ESL and for FSL." Still open: the `js/talk-signing.js` citations and
     the two no-op `sining_kamay_labels_<LANG>` removals.
128. **Medium, open (compact-model phase, owner answer Q3): leave-one-signer-out has not been run.** No
     multi-signer data exists yet, so budget 90 is proven only on today's data, where it changes nothing. After the
     first real import run `node tests/compact-model/accuracy.mjs --live --sets LOSO --query-rows 10 --signers
     P01,P02 --json <file>` (Task 2's recommended flags; the planned-work and ETA lines show the real run time
     within 30 s). Rule: if budget 90 loses more than 2 vote points against the current (no-budget) rule on a set
     with at least 20 queries (the script prints `LOSES MORE THAN 2 POINTS`), compile with budget 120 and measure
     again; if that still loses, re-plan before the kiosk gets the bulk data (Step 1 section 2.5). Projected run
     time with all 8 signers and the current rule is hours (`.git/sdd/cm-task-2-report.md`); not measured.
129. **Medium, open (compact-model phase, owner decision 10): nothing of this phase was measured on the Pi.**
     Not measured: `knnPredict` per call at today's and the projected sizes, cold and cached model loads,
     `php_uname('m')` reporting `aarch64`/`arm*`, the IndexedDB quota, and Apache serving the `.bin` files with an
     ETag. Run `bash tests/compact-model/pi-bench.sh` on the Pi's desktop (`docs/system/HARDWARE_BOOT.md`); it
     prints and saves `COMPACT_BENCH {json}`. The kiosk predicts every 150 ms, and MediaPipe shares the CPU.
130. **Low, open (compact-model phase, known edge): a sample file that is not valid JSON keeps its model "out of
     date".** The listing skips such a file (`php/api/save_gesture.php:360-361`), so Compile's fingerprint leaves
     it out, but `model_status.php`'s walk counts every `sample_*.json` without reading it
     (`php/api/knn_model_lib.php:81-107`). The status line then reads "Model out of date: run Compile" after every
     Compile until the file is fixed or removed.
131. **Low, open (compact-model phase, known edge): two simultaneous Compiles of one language share
     `models/knn_<LANG>.bin.tmp`** (`php/api/compile_model.php:63`). The last rename wins and a reader never sees a
     half-written file, but one Compile's file can replace the other's. Single-owner demo; not handled.
132. **Low, open (compact-model phase): the sample listing does not return `signer`.** `list_samples()`
     (`php/api/save_gesture.php:362-369`) returns `file, label, frames, frameCount, createdAt, signLanguage`,
     although an imported sample's file holds `signer` (`:650`). The accuracy script therefore reads `signer` from
     the sample files on disk in `--live` mode (`readSignerFromDisk()`, `tests/compact-model/accuracy.mjs:82-97`),
     which works only on the machine that holds the files and was not exercised on a real imported sample.
133. **Medium, open (compact-model phase, measured): the summary listing and Compile are slow at the planned
     import size.** With 3,000 extra synthetic v3 samples (`tests/compact-model/scale-check.mjs`, two runs): the
     summary listing took 15.6-28.5 s with the disk sync and 6.8-13.0 s without (it still decodes every sample file
     for `frameCount`); Train Gestures' page load to ready 23.3 / 50.5 s; Compile ESL 52.6 / 100.5 s and FSL
     45.4 / 77.1 s (1 summary + 62 batch requests). Reading `frameCount` without decoding the frames would be the
     follow-up (`.git/sdd/cm-task-9-report.md`). Laptop only; the kiosk never makes these requests.
134. **Low, open (compact-model phase): an upload larger than PHP's `post_max_size` gets an HTML answer.**
     Above 40M (`C:\xampp\php\php.ini:701`) PHP prints its startup warning (`display_errors` on), so
     `compile_model.php` answers HTTP 200 `text/html` with the warning before its JSON 413 text; nothing is
     written. Compile treats any non-JSON answer as a failure and shows its first 200 characters
     (`js/gesture-training-ui.js:922-927`). Such a file would need about 900 signs at the 90-row budget
     (`.git/sdd/cm-task-3-review-1.md`); not reachable through the UI today.
135. **Low, open, pre-existing (found 2026-10-15): `tests/sign-texts/dataset-check.mjs` fails one check.** It
     expects 6 table columns (`:76`, "English text | Filipino text | Set | Samples | Edit | Delete"), but the
     dataset table has had 7 since the avatar phase added "Avatar" (`js/gesture-training-ui.js:169`; already 7 at
     HEAD `b61c665`, `:159`). Every other check in it passes, including the new model-status ones.
136. **Low, open, pre-existing: checks from earlier phases pin today's dataset.** `tests/sign-texts/verify-e2e.mjs:66`
     (122 gestures), `tests/sign-texts/migration.test.mjs:32`, `:42` (122) and `tests/sign-texts/talk-check.mjs:56-57`,
     `:61` (the signs `how_are_you` and `a` in the models) will fail after the owner archives today's signs
     (`.git/sdd/cm-phase-review-1.md`, minor 5). This phase's own checks read the frozen fixtures or the live
     files instead.
137. **Low, open, pre-existing: Train Gestures shows its dataset table about 10 s late on a fresh profile.**
     `warmUpHandTracking()` starts before the startup listing (`js/gesture-training-ui.js:1504`), although its
     comment (`:1526-1533`) says it runs after it. Its first inference is one main-thread task of 11.0-11.3 s, so
     the summary listing that ended at 2.1-2.5 s is drawn at 12.4-12.8 s (`.git/sdd/cm-task-6-review-1.md`, minor
     1). Starting the warm-up after the listing would show the table at about 2.5 s.
138. **Low, open (compact-model phase): paths not exercised by any test.** A missing or broken model file on the
     real `talk.html` page in a browser (covered for the store by `tests/compact-model/store-check.mjs` and for
     `autoTrainForTranslate()` by a unit test with a rejecting store); `kiosk-check.mjs`'s SKIP branch when `hello`
     is not in the live model; the `labels=` option by a unit test (`save_gesture.php` needs a DB; it is covered
     end to end); `readSignerFromDisk()` on a real imported sample (item 132); a real Ctrl-C in `pi-bench.sh`.
     `indexedDB.open` has no timeout: if Chromium's IndexedDB never answers, the load never settles
     (`js/knn-model-store.js:44-64`; single-tab kiosk, low risk; `.git/sdd/cm-task-4-review-1.md`, minor 6). In
     `scale-check.mjs`, the first `delete_gesture` call after the long php-cgi phase failed with "fetch failed" in
     every run and its retry succeeded; the cause was not confirmed.
139. **Low, open (compact-model phase): deployment notes for the model files.** Each recompiled model is a new
     binary blob in git history (5,596,344 bytes for ESL at the 3,000-sample scale check): accept the growth or
     copy the two files to the Pi by hand (`docs/system/HARDWARE_BOOT.md`). The working copy of `start_kiosk.sh` on
     this laptop is still CRLF (`git ls-files --eol`: `i/lf w/crlf`); git stores LF and `.gitattributes:3`
     (`*.sh text eol=lf`) gives LF on a checkout, but a straight copy of this working tree to the Pi would carry
     CRLF.
140. **Low, open, pre-existing: dead code next to the model.** `EPOCHS = 50` and `tfModel` are declared and unused
     in both UI files (`js/gesture-training-ui.js:3`, `:15`; `js/sign-to-text-ui.js:6`, `:15`), and the `tl*`
     translate path in `js/sign-to-text-ui.js` (`tlLoadModelForActiveLanguage()` `:185`) has no caller in
     `talk.html` or `js/talk-*.js` (`.git/sdd/cm-task-5-review-1.md`, minor 1).
141. **Medium, open (bulk-reps-fix, 2026-10-16): the dynamic split's thresholds are untested on real videos.**
     `SPLIT` (`js/bulk-rep-split.js:21-47`) was set from the owner's description (rests of about 1 s, hand
     lowered or out of the picture) and checked on synthetic frames only (`tests/bulk-import/rep-split.test.mjs`,
     22 pass). Tuning guide: `docs/reports/2026-10-16-bulk-reps-fix.md` section 2. After a change, raise
     `SPLIT.VERSION`; Start then redoes every cached split from the cached frames.
142. **Low, open (bulk-reps-fix): the earlier browser checks of the bulk importer were not updated.**
     `tests/bulk-import/extract-check.mjs` (version-1 `hands.reps`, `seg.reason 'too-few-reps'`),
     `import-flow-check.mjs` ("found 2 repetitions, need 3", "import the 2 repetitions found") and `verify-e2e.mjs`
     encode the old segmenter and cache format and will fail in those checks. They need XAMPP and a browser,
     which that session did not have.
143. **Low, open (bulk-reps-fix): paths not exercised by any test.** The `save_gesture.php` action
     `delete_import_samples` (`:450-487`, only `php -l`); the Review batches at any size; Stop; re-split from the
     cache; the record → save → replace → record import order and its pauses; a sample file listed by the
     summary and gone before its batch (counted as 0 rows).
144. **Low, open (bulk-reps-fix): the cache is larger.** A version-2 `hands.json` keeps every frame (not only
     the reps'), so a split can be redone without the video. Measured on synthetic frames with 4-decimal
     landmarks: 1,591 bytes per 2-hand frame, 808 per 1-hand frame; a 90 s all-2-hand video about 2,147,850
     bytes, under the 8 MB `put_video` limit (`php/api/bulk_import.php:15`). Projection for 960 videos like
     the owner's 17.8 s one (267 frames, one hand): at most about 216 KB each (267 x 808 bytes), about 207 MB in all, laptop only
     (git-ignored).
145. **Low, open (bulk-reps-fix): replacing samples needs the cache's record.** The old samples of a video
     are found by the first version's id formula (`name|size|1..5`) and by `meta.imported` in the cache.
     If `bulk_import_cache/` is deleted after an import made with the new code, and the same video is later
     imported with another split, its earlier samples are no longer found: both sets stay (the per-sign budget
     still caps the model at 90 rows per sign). Identity is still name + size (item 120).

Note (2026-09-23, gesture-categorization): `gesture_recordings.gesture_type`
(item 8/`db-local.js`, and the `core_api.php` router in item 2's "dead
endpoints" list) was considered as a place to store the new category and
deliberately not repurposed — its only reader is `core_api.php:72`
(`get_recordings`, which reads it back *as the label*, not as a type), and
that whole path is unreachable since `core_api.php`'s only caller
(`js/db-local.js`) has no callers. See `DECISIONS.md` for the full reasoning
(ENUM vs. `VARCHAR(100)`, one row per label vs. one row per sample).

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
| `ffmpeg.exe` | 97.6 MB | Vendored binary, used by `save_gesture.php` (see `docs/system/BACKEND.md`) |
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
