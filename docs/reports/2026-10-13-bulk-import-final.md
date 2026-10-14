Phase: bulk video importer (laptop only)
Date: 2026-10-14
Status: DONE
Decision needed from owner: none to finish the phase. Two things to read first: the correction of my Step 1 timing figure (section 2), which your Q1 answer was based on, and "Owner actions" (the kiosk must not get the imported data yet).

# Bulk video importer — final report

Plan: `docs/reports/2026-10-13-bulk-import-step1.md`, approved with your answers (Q1 option A with the
Hands pass for every video; Q7 changed to Holistic only on the best repetition and only for the avatar
signers; the other questions at my defaults).

Every number below was measured on this laptop in headless Chrome unless a line says "projection".
Nothing was run on the Pi. No real data was imported: every test used `zz_` probe signs, all removed.

## 1. What you have now

Open `http://localhost/SKR/bulk-import.html` on the laptop and enter the PIN. No kiosk screen links to it.

1. **Folder.** Choose the folder (subfolders included). Files must be named
   `<SET>_<label>_<SIGNER>.<ext>`, for example `ESL_how_are_you_P01.mp4`. Any other name is listed under
   Problems. Then check two lists:
   - **Signers used for recognition** (default: the first 2 found);
   - **Avatar signers** (default: the first 3 found; the first is the default signer, the rest are
     fallbacks in order).
2. **Extract.** Start, Pause, Resume, progress and ETA.
   - Every video gets the hand-tracking pass, and the result is saved to the laptop's cache at once.
   - Only the avatar signers get the avatar step, and only on the best repetition.
   - Close the tab or the laptop whenever you like. Choosing the same folder again skips what is done.
3. **Review.** One row per video with its status. Edit the draft texts of new signs here.
   - Exactly 3 repetitions is OK. Any other count is a problem row that you can tick to import the
     repetitions found.
   - A box shows how many training rows each model has now and will have, and an estimated prediction time.
   - Nothing is written until you press Import.
4. **Import.** Samples are saved through the normal save endpoint, as v3 samples marked
   `video-import` with the signer. Importing the same video again adds nothing.
   - The summary lists samples per sign, new signs, skipped videos, signs with too few samples, and
     reminds you to run Compile for ESL and for FSL.
5. **Avatar.** Pick the default signer and the fallback order, then **Apply to all signs**.
   - "Keep signs I picked by hand" is on by default.
   - The summary shows signs per signer, fallbacks, no clip, left alone, and not imported yet.

On **Avatar clips**, a selected sign now has a **Candidates (n)** button: preview each signer's clip on
the avatar and press **Use this**. That marks the sign as picked by hand.

If you add a recognition signer later, their rows become importable at once with no re-extraction. If
you add an avatar signer later, Start runs only the avatar step for their videos.

## 2. Correction: my Step 1 prediction-time figure was wrong

In Step 1 I wrote that one `knnPredict` call would go from 35 ms to about 1.6 s on this laptop after a
full import. Both numbers were wrong. I measured inside a node sandbox, which alone is 6–7 times slower,
while another heavy test was running. A reviewer could not reproduce it, and I re-measured:

| Model size | One `knnPredict` call, this laptop |
|---|---|
| 2,074 rows (today) | 1.1–1.5 ms |
| 24,034 rows (2 signers imported, projection of size) | 14–15 ms |
| 58,560 rows | 37–38 ms |
| 87,840 rows (all 8 signers, projection of size) | 53–62 ms |

- The ratio still holds: a full import is about 45 times more work per prediction.
- On this laptop even the full import stays under the 150 ms prediction interval. The Pi is slower and
  is not measured.
- The other two costs from Step 1 stand: the dataset download on each page load (about 38 KB more per
  sample; projection: +27 MB with 2 signers, +109 MB with 8) and the model no longer fitting in
  `localStorage`.

Your decisions (limit the recognition signers; compact model next; no imported data on the kiosk
before that) are still sound, but for those two reasons and the unmeasured Pi, not for the 1.6 s figure.
The default of 2 signers is only a default; the list is yours to change.

## 3. New projected extraction time for 960 videos

Measured on your one real video (1280x720, 17.8 s), quiet machine:

- Hands pass: 19.6 s and 21.2 s in two runs (about 1.1–1.2 times the video length).
- Holistic on the best repetition's window: 17.0 s and 18.1 s (126 frames instead of 445).

Projection for 960 videos like it (120 signs x 8 signers):

| Avatar signers | Hands pass, all videos | Holistic | Total |
|---|---|---|---|
| 3 (the default) | 5.2–5.7 h | 1.7–1.8 h | about 7–7.5 h |
| all 8 | 5.2–5.7 h | 4.5–4.8 h | about 10–10.5 h |

Step 1 projected 38–80 hours. Two cautions:

- This is one video, scaled up. Longer or two-handed signs will take longer.
- The laptop must be otherwise idle. With other heavy work running, the same passes were 2 to 5 times
  slower (DEBT 123).

## 4. Verification (measured)

Test folder: 2 signers x 3 synthetic signs (built from `assets/signs/en`), one 2-repetition video, one bad
file name, one junk file, and your real video copied as `ESL_zz_test_P01.mp4`. It was built in the
system temp folder and never committed. Source: `tests/bulk-import/verify-e2e.mjs`, **38 PASS, 0 FAIL**.

| Required check | Result |
|---|---|
| Problems listed | `hello_final.webm` listed as "bad file name"; `desktop.ini` ignored. The 2-repetition video: "found 2 repetitions, need 3", not ticked. |
| OK rows imported | 21 samples from 7 videos, 0 duplicates. New signs: `zz_bulk_one`, `zz_bulk_two`, `zz_bulk_three`, `zz_test`. Each sample is v3 with `source "video-import"`, the signer, `repIndex` and the hash. |
| Samples in the dataset view and the DB | Train Gestures' dataset table listed the four signs with 6 / 6 / 6 / 3 samples and an avatar tick. `gesture_recordings` had the same counts. |
| Train AI and Predict | "Complete! — 126 gestures ready". The model held 104 / 140 / 102 / 90 rows for the four signs, equal to the cached repetitions' rows. Predict on the fake camera (the hello clip) showed "Zz bulk one" 36 times in 20 s. |
| Re-import | After a reload every imported video read "already imported". Forcing the same requests: 0 added, 21 answered duplicate, disk and DB unchanged. |
| Kill the tab mid-extraction, reopen | `extract-check.mjs`: killed during video 3; videos 1 and 2 were skipped, the other 5 extracted. Pause and Resume, a dead cache and a failed avatar step are covered there too (85 PASS). |
| Default signer + priority + Apply to all | 3 signs set to P01, matching their `avatar.json` files frame for frame. The sign picked by hand kept its file byte for byte. The 2-repetition sign, never imported, was "not imported yet". Fallbacks, a missing candidate, a paused Apply: `avatar-step-check.mjs` (43 PASS). |
| Candidate picker switches a sign's clip | `candidates-panel-check.mjs` (41 PASS): "Use this" on P02, then P03; the saved clip and the pick followed; Let's Talk played the chosen clip. |
| No request carries video bytes | 207 requests, all to localhost with every other host blocked. 70 POSTs, all JSON; the largest was 112 KB against 5,391 KB of videos. |
| No video file written under the repo or `C:\xampp` | None. |
| Cache and candidates git-ignored | `git check-ignore` accepts all three paths; `git status` shows nothing under `bulk_import_cache/`. |
| Nothing on kiosk screens links to the page | 31 pages and scripts searched; none links to it. |
| 0 console errors | On `bulk-import.html`, `avatar-clips.html`, `gesture-training.html` and `talk.html`. |
| zz test signs removed | 0 `zz_` folders and rows; the rest of `saved_gestures` byte-identical; DB counts back to 122 signs / 127 recordings. |

Existing tests:

| Suite | Result |
|---|---|
| All node tests (`node --test --test-concurrency=1 tests/*/*.test.mjs`) | 295 tests, 294 pass, 0 fail, 1 skip (was 216 / 215 / 1). |
| `tests/avatar/admin-check.mjs`, `import-check.mjs` | 22 PASS and 31 PASS. Avatar clips still fits 1024x600 with every control at least 44 px. |
| `tests/video-capture/extractor-check.mjs`, `capture-ui-check.mjs`, `e2e.mjs` | All checks passed. `e2e.mjs` crashed once while deleting its own temp folder (a Windows file lock) after its 52 checks had passed; the re-run was clean. |
| `tests/sign-texts/verify-e2e.mjs`, `talk-check.mjs` | All checks passed. |
| `tests/bulk-import/extract-range-check.mjs` | 30 PASS: with no time range, the changed extractor makes the same seeks and returns the same bytes as the committed one. |
| `tests/avatar/talk-avatar-check.mjs` | **Flaky: 2 of 3 runs failed one check** ("blend continuity"). See section 6. |

## 5. Process

- Backup before anything: `E:\ACADSS\IOT\backups\2026-10-13-bulk-import\` (mysqldump, 6,022,767 bytes, and
  a 249-file copy of `saved_gestures`). No schema change was needed.
- One implementer per task, each followed by an independent review, then a whole-phase review.

| Task | Review rounds | What the reviews changed |
|---|---|---|
| Core module (pure logic) | 3 | The clip window could include part of an unfinished next sign; a sign named `constructor` crashed Apply. |
| `save_gesture.php` fields | 2 | A failed import could be answered "duplicate" on retry, leaving it half-saved. |
| Cache endpoint | 2 | Listing candidates took about 25 s for 1,050 clips (now 1.5 s); simultaneous pick updates lost data (now locked). |
| Extractor time range | 1 | Approved. I added a refusal of a missing range bound. |
| Folder + Extract | 2 | A Holistic failure or a Pause threw away the finished Hands pass; a stopped Apache would have burned through the queue; a bad first video blocked its retake from making the clip. |
| Review + Import + Summary | 2 | Edited texts of a new sign could be lost after a lost response or a reload; the page's time estimate was 1.3–2.4 times too low. |
| Default signer + candidate picker | 2 | With two tabs open, Apply could overwrite a clip picked by hand since the table was loaded. |
| Whole phase | 2 | A video of the wrong set could still supply the sign's avatar clip. Fixed: a candidate now carries its video's set and is refused on a mismatch. Final verdict: ready. |

Two implementers were cut off by the usage limit and resumed from where they stopped.

## 6. Found on the way, not caused by this phase

**The avatar's first movement can jump.** `talk-avatar-check.mjs` failed its "blend continuity" check
(limit 60 px per 40 ms) in 2 of 3 runs. I measured repeated extractions of `hello.webm`:

- Holistic's output differs slightly between runs, so the auto-trim starts one frame earlier or later.
- When the clip starts on a frame with a hand: the rest → sign movement takes 700 ms, at most 45 px per 40 ms.
- When it starts one frame before the hand appears: 350–402 ms, and up to 155 px per 40 ms.
- With the committed files from before this phase, 1 of 6 extractions exceeded the limit (74.7 px); with
  this phase's files, 2 of 6. The extractor without a time range is proven unchanged, so this is chance
  in a small sample.

The cause is in the retargeting and timeline code, which this phase must not change. It is DEBT 124 and
worth fixing before many clips are made, because bulk-made candidates are trimmed the same way.

## 7. Owner actions

1. **Do not let the Pi get bulk-imported samples yet** (your note; DEBT 116). Imported samples are normal
   files under `saved_gestures/`, which git tracks. After a real import, do not commit or copy them to
   the Pi until the compact-model phase is done. The cache and the candidates are git-ignored already.
2. **Recording rules for the group** (from the unchanged segmenter):
   - at least 1 second with no hand visible before the first sign, between signs, and after the last;
   - each sign between 0.3 and 20 seconds; the whole video under 90 seconds, and under 60 seconds to
     get an avatar clip;
   - "rest" means the hands are not detected. In your sample they left the picture. Hands held still
     but visible may still be detected; that is not measured (DEBT 121).
3. **Before the real run:** leave the laptop idle and plugged in, and keep it from sleeping. The run can
   be stopped and continued at any time.
4. **Manual checks to add to `docs/system/MANUAL-CHECKS.md`** (I did not edit it; it has your uncommitted
   changes):
   - choose a real folder through the folder dialog with the mouse (tests set it through the debugger);
   - run a folder of 50 or more real videos and watch the ETA and the table;
   - after an import, Compile for ESL and FSL and try Predict with a real camera.
5. **Known limits** (DEBT 116–125): the Review step downloads the whole dataset each time; never run
   at full scale; a re-recorded video with the same name and byte size reads "already imported"; a tab
   closed during Apply leaves the signs set so far counted as picked by hand.

## 8. Files

- **New:** `bulk-import.html`, `css/bulk-import.css`, `js/bulk-import-core.js`, `js/bulk-import-ui.js`,
  `php/api/bulk_import.php`, `tests/bulk-import/` (15 files).
- **Changed:** `php/api/save_gesture.php` (two optional fields; a request without them is stored byte for
  byte as before), `js/avatar-extract.js` (time range), `avatar-clips.html`, `css/avatar-clips.css`,
  `js/avatar-clips-ui.js` (Candidates panel), `.gitignore`, `tests/avatar/import-check.mjs` (removes the
  picks it now leaves).
- **Docs:** `CLAUDE.md`, `docs/system/UI.md`, `BACKEND.md`, `DECISIONS.md`, `DEBT.md` (116–125),
  `INVENTORY.md`, `ML.md`, the Step 1 report and this report. No screenshots were taken.
- **Not touched:** `knnPredict`, `cosineSimilarity`, `trainModel`; the live capture flow
  (`js/gesture-capture-ui.js`, `js/capture-core.js`, `js/video-landmarks.js`, `js/gesture-data.js`); the
  v2/v3 formats apart from the added `signer` and `importId`; the avatar retargeting, timeline, renderer,
  player and store; Let's Talk; `archive/**`; your uncommitted `docs/revision/MEMORY.md` and
  `docs/system/MANUAL-CHECKS.md`.
- Code and docs are in two separate commits. Nothing was pushed or merged.
