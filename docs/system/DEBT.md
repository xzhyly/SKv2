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

   **Partly resolved (2026-09-24, DB cleanup, owner-approved):**
   `php/api/save_history.php` and `php/api/get_history.php` were deleted
   together with the `translation_history` table they served, and so were
   `admin_api.php`'s `get_history`/`delete_history`/`clear_history` actions and
   the `translation_history` parts of its `get_stats`. They were reachable by
   URL even with no front-end caller, and `save_history.php` built its SQL by
   string concatenation. `php/auth.php` and the rest of `php/admin_api.php`
   remain. See item 72 for the authorization problem those still have.

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
    (`gesture-training.html:295`), but `trainModel()`
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

65. **Low severity, open: category is DB-only, so a DB wipe/re-import loses
    manual re-tags.** `gestures.category` (`db-schema/database_setup.sql:89`)
    has no on-disk counterpart; a fresh import or a full `gestures` table
    wipe drops every hand-corrected category, and the next sync/save falls
    back to `gesture_category()`'s heuristic (`php/api/gesture_category.php`)
    for every label — never to `NULL`, since the column has `DEFAULT 'word'`
    and the heuristic itself never returns null. Owner decision, 2026-09-23
    (see `DECISIONS.md`, "Category is stored in the DB only").

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

70. **Low severity, open: the Type is read at confirm time, not capture
    time.** `confirmAndSave()` reads the checked `gestureCategory` radio when
    the preview is saved; if the operator edits the name or Sign Set between
    Finish Capture and Save, auto-select re-evaluates for the edited pair
    while the save still targets the captured label/set. Found by the
    2026-09-23 final review; not fixed (the plan specified save-time
    reading).

71. **Low severity, latent: a label present in both ESL and FSL shows one
    category, and `delete_gesture` deletes one `gestures` row.**
    `renderSavedDataset()` takes the sign set from `samples[0]`, and
    `save_gesture.php`'s `delete_gesture` selects `WHERE word = ? LIMIT 1`.
    Both pre-existing; 0 labels overlap across sets today (measured
    2026-09-23). `scratch/trigger_sync.php` also keeps its own stale copy of
    `ensure_gestures_columns()` and inserts `gestures` rows without a
    category (they get DEFAULT `word`, not the heuristic) — scratch-only.

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
