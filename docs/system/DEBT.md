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
