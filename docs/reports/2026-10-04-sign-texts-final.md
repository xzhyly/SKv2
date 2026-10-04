Phase: one sign, two texts (ESL / FSL / Both)
Date: 2026-10-05
Status: DONE
Decision needed from owner: none to finish the phase. One follow-up is yours: correct the draft Filipino texts in View Active Gesture Dataset. About 20 are likely wrong; see "Owner actions".

# One sign, two texts — final report

Plan: `docs/reports/2026-10-04-sign-texts-step1.md`. It was approved with all 15 recommended
defaults, plus your addition that `saved_gestures/hi` and `saved_gestures/yow` get `sign.json`
and go into the data commit.

How the work ran: one implementer per task, each followed by a task review (round counts per
task are listed under Process), then a whole-phase review on Opus and one fix batch.

Every number below was measured, or comes from a task report under `.git/sdd/st-*`.

## What changed for you

- **Train Gestures, Step 1.** Sign Set now has **ESL | FSL | Both**. Gesture Name is replaced by
  **English text** and **Filipino text**:
  - ESL shows only the English field, FSL only the Filipino field, and Both shows both.
  - Each field that is shown is required, and up to 255 characters.
  - Texts keep their casing and punctuation.
  - The key (the folder name) is made from the text and shown in the sample line; you never
    type it.
  - If the key already exists with a different set, Record is disabled and the line tells you
    to change the set in the dataset view first.
- **Train Gestures, Step 2.** A new **AI model: ESL | FSL** toggle picks which model Train AI
  builds:
  - ESL builds from ESL + Both signs; FSL builds from FSL + Both signs.
  - The toggle defaults from Step 1 (Both → ESL) and is locked while training runs.
- **Predict.** It shows the sign's English text with the ESL model and its Filipino text with
  the FSL model.
- **View Active Gesture Dataset.**
  - The table shows English text, Filipino text, Set, and Samples, with Edit and Delete
    buttons.
  - **Edit** changes a sign's set and texts without re-recording. The change survives a page
    reload and a full sync.
- **On-screen keyboard.** The bottom row adds `- ' , . ? !`, so "How are you?" can be typed on
  the kiosk.
- **Let's Talk.**
  - Sign-to-text captions show the sign's English text (EN) or Filipino text (FIL).
  - Speak or Type finds a sign by its text in the active language. A text with a "?" is found
    with or without the "?".
- **Reports.** Both signs appear in the ESL tab and the FSL tab, with that tab's text. The
  columns are ID | Key | Set | Text | Asset | Created.

## Data: before and after

| | Before (2026-10-04) | After |
|---|---|---|
| `gestures` rows | 211 (122 ESL + 89 FSL) | 122 (89 BOTH + 33 ESL + 0 FSL) |
| by category | ESL 69 word / 26 letter / 10 number / 17 phrase; FSL 50 / 0 / 10 / 29 | BOTH 64 word / 10 number / 15 phrase; ESL 5 word / 26 letter / 2 phrase |
| `gesture_recordings` | 216 (127 + 89) | 127 |
| sample files | `saved_gestures` 127, `saved_gestures_fsl` 89 + 1 stray | `saved_gestures` 127, `saved_gestures_fsl` 0 |
| `sign.json` | 0 | 122 (one per sign) |

How the counts reconcile:

- ESL categories now = ESL row + BOTH row of each category. That gives 69 word, 26 letter,
  10 number and 17 phrase, the same as before. Each merged sign kept its ESL category.
- **No recording was lost.** `--verify-only` checked all 216 pre-phase recordings and found 0
  unreachable. The 127 that are still active are on disk. The 90 moved files (89 FSL samples +
  the stray root file):
  - are each stored in `E:\ACADSS\IOT\backups\2026-10-04-sign-texts\saved_gestures_fsl\` with a
    matching SHA-256;
  - each have an identical twin that is still active (frames compared element by element);
  - are listed with source, backup path, sha256 and twin in
    `E:\ACADSS\IOT\backups\2026-10-04-sign-texts\moved-manifest.json` (90 entries).
- **Backups taken before any change:**
  - `sining_kamay_db_before-sign-texts.sql`, 10,132,052 bytes (mysqldump `--single-transaction`);
  - `dataset-copy\`, 217 files: every sample of both folders;
  - `snapshot.json`.

## Verification (measured)

| Check | Result |
|---|---|
| Record a new **Both** sign through the UI (`tests/sign-texts/verify-e2e.mjs`) | Text "Zz Both Probe?" / "Zz Pareho Probe?". One folder `saved_gestures/zz_both_probe` with 3 samples + `sign.json` (BOTH, texts exact). Nothing in `saved_gestures_fsl`. DB row BOTH with both texts. Listed under both `categories.ESL` and `categories.FSL`. |
| Train AI for both languages | ESL: "Complete! — 124 gestures ready"; FSL: "Complete! — 91 gestures ready" (counts include the zz probes). The Both probe is in both models; `a` is only in ESL; the FSL-only probe is only in FSL. |
| Predict | ESL model showed "Zz Both Probe?" and "Zz Esl Only" (96 readings). FSL model showed "Zz Pareho Probe?" and "Zz Fsl Lamang" (76 readings). No key with underscores was ever displayed. |
| ESL-only / FSL-only signs | Each lands in `saved_gestures/<key>/` with the right `sign.json` set and sample `signLanguage`. The modal shows Set ESL / FSL. Each appears only in its own model. |
| Edit in the dataset view (ESL → Both + Filipino text) | Survived a page reload and a full sync: `signs.php` returns BOTH with both texts, and `sign.json` and the DB agree. Sample files byte-identical before and after. |
| Collision | ESL text equal to an existing FSL key: "“zz_fsl_lamang” already exists as FSL — change it in View Active Gesture Dataset first.", and Record is disabled. |
| Let's Talk, sign-to-text | Live captions over 20 s each. EN showed only English texts; FIL showed only Filipino texts; 0 captions contained an underscore. The ESL model has 122 labels including `how_are_you` and `a`. The FSL model has 90, including `how_are_you` but not `kamusta_ka`. |
| Let's Talk, text-to-sign | EN "how are you" → `assets/signs/en/how_are_you.webm` (HTTP 200). FIL "kamusta ka" → `assets/signs/fil/kamusta_ka.webm` (200). Registration by text, with and without "?", is unit-tested in `tests/sign-texts/talk-texts.test.mjs`. |
| Reports | ESL tab 122 rows, FSL tab 89 rows, both equal to the summary. `how_are_you` shows "How are you" in ESL and "Kamusta ka" in FSL, with Set "Both". |
| Keyboard | Typing "How are you?" on the on-screen keys gives exactly "How are you?". Still 5 rows, 280 px tall on gesture-training. talk.html is 240 px, the same as the parent commit, so no regression. |
| Step 1 layout at 1024×600 | Field groups at y = 68 / 151 / 234 (/ 317 for Both). Lowest input ends at 220 (ESL/FSL) or 303 (Both), above the keyboard top at 320. Page 1024×600 with no scroll. Every control ≥ 44 px. |
| Dataset modal at 1024×600 | Card 960 px wide, rows 44.5 px, Edit and Delete 80.6×44. The edit panel fits with the keyboard open (card height 289, bottom at y=297). No page scroll. |
| Console errors at 1024×600 | 0 on gesture-training.html, talk.html, reports.html and index.html. Each has scrollWidth 1024. |
| Existing capture scripts | `e2e.mjs`, `capture-ui-check.mjs`, `startup-check.mjs` and `screenshots.mjs` all pass. Starting camera → START on first open: 1,027 ms (previously 1,858 / 1,505 ms). |
| Full sync time (GET `save_gesture.php`) | Pre-phase code on the same data: 1.75 / 2.10 / 1.85 s. The first server version took 12–14 s; that was caught in review and fixed in 78df63d. Final: 0.76 / 0.77 / 0.83 s. |
| Tests | Baseline: 141 tests, 140 pass, 0 fail, 1 skip. Final serial suite + `tests/sign-texts/*.test.mjs`: **188 tests, 187 pass, 0 fail, 1 skip**. Browser check scripts: step1, dataset, talk, reports-keyboard and xss all pass, and verify-e2e has 80 PASS and 0 FAIL. New tests cover the endpoints (`save-sign`, `signs-endpoint`), the migration (`migration.test.mjs`: full run, no-op re-run, resume after each of steps 1–7, crash before the manifest write, a tamper that aborts with 0 files moved) and the in-place upgrade (`upgrade-path.test.mjs`). |
| Cleanup | 0 zz probe folders and 0 zz probe rows left. Live counts are back to 122 / 127. |

## Process

| Task | Commits | Review |
|---|---|---|
| 0. Backup + baseline | — | — |
| 1. Migration script, pairs fixture, clone test | cf3513c | approved first round |
| 3. Live migration. I ran it before Task 2 so the server tests would hit the migrated schema. Output: `.git/sdd/st-task-3-migration-output.txt` | — | verify: all checks passed |
| 2. Server (`save_gesture.php`, `signs.php`, `sign_meta.php`, `gesture_category.php`, `database_setup.sql`) | 1c55a86, 78df63d | approved; then I measured the full-sync regression and it was fixed and re-approved |
| 4. Step 1 form, Step 2 model toggle, Predict text | 1887b91 | approved |
| 5. Dataset modal and edit panel | 92ed969 | approved |
| 6. Let's Talk + text-to-sign | 50413e1, 0fc2c56 | round 1: a text with "?" was not found unless the "?" was typed; fixed and approved |
| 7. Reports + keyboard punctuation | fabdae4 | approved |
| 8. End-to-end verification + adapting the capture scripts | 8e6aa2f | 80/80 PASS |
| Data commit (122 `sign.json`, hi/yow, 90 FSL files removed) | 5ec84dd | — |
| Whole-phase review (Opus): 0 Critical, 2 Important | 16c15ce | re-review: all resolved, ready to hand over |

The two Important findings, both fixed:

1. **User texts reached `innerHTML`.** User-entered sign texts reached `innerHTML` in
   gesture-training Step 4, and in a latent path in `sign-to-text-ui.js`. Both are now
   escaped, and a browser check with an `<img onerror>` payload shows it as literal text.
2. **No in-place upgrade for a pre-phase database (for example the Pi's).**
   `ensure_gestures_columns` now widens the enum to BOTH and swaps the unique key (only when
   no label is duplicated). So `git pull` followed by one full sync upgrades it. It does not
   add the CHECK constraint (DEBT 103).

Minor findings from every review are triaged in the ledger and written up as **DEBT 94–108**.
Existing items 56, 64, 65, 66, 71, 73, 75 and 92 were updated. DEBT 72 stays open (decision 7).

## Owner actions

1. **Correct the draft texts** in View Active Gesture Dataset. Each draft is the old label
   with spaces and a capital first letter, for example "Kamusta ka" and "Dont know".
   - The 89 Filipino drafts are the old machine-translated FSL labels.
   - About 20 are likely wrong. Some aren't Filipino at all (`hibaru`, `host_dad`,
     `im_so_sick`) and others have a different meaning (`boso`, `ganon_din`, `matalusan`, …).
     The full list is in the step 1 report section (c) and DEBT 104.
   - The English drafts lack apostrophes ("Dont know", "Im excited").
2. **Manual checks to add to `docs/system/MANUAL-CHECKS.md`.** I didn't edit that file because
   it has your uncommitted changes.
   - Time a full sync on the Pi. It measured 0.76–0.83 s on this laptop; the Pi has not been
     measured.
   - Type punctuation with the on-screen keyboard on the Pi touchscreen.
   - Run the Let's Talk Translate flow (start → sign → stop) with a real camera, in EN and FIL.
     The fake camera only shows the hello clip, so this flow was timing-dependent in testing.
   - On the Pi, after `git pull`, do one full sync (open Train Gestures). Then confirm Reports
     shows 122 / 89.
3. **Known limits to be aware of.**
   - **localStorage space (DEBT 94).** It holds only one cached model: the ESL cache is about
     3.59M of roughly 5.2M characters, so the FSL model is rebuilt each session instead of
     cached. This existed before the phase.
   - **No Filipino letter clips (DEBT 56).** A Filipino text with no clip plays nothing in
     text-to-sign.

## Files

- **Code commits:** cf3513c, 1c55a86, 78df63d, 1887b91, 92ed969, 50413e1, 0fc2c56, fabdae4,
  8e6aa2f, 16c15ce. Excluding data, 36 files changed. That matches the planned file list, plus
  `php/api/sign_meta.php` (the shared PHP helpers, a deviation the final review accepted) and
  the test files. `css/virtual-keyboard.css` needed no change.
- **Data commit:** 5ec84dd.
- **Docs commit:** `docs/system/BACKEND.md`, `UI.md`, `DECISIONS.md`, `DEBT.md`,
  `INVENTORY.md`, `ML.md`, this report, and the step 1 report.
- **Not touched:**
  - `knnPredict`, `cosineSimilarity`, `js/capture-core.js`, `js/video-landmarks.js`;
  - the capture states in `js/gesture-capture-ui.js`;
  - the v2/v3 sample formats and every existing sample file;
  - `assets/signs/**`, `archive/**`;
  - your uncommitted `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md`;
  - `CLAUDE.md`, whose "Run" section still says "120 ESL gestures"; now 122 signs (33 ESL + 89
    Both), for you to update.
- Nothing pushed or merged.
