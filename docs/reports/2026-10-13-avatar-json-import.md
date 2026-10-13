Phase: Avatar clips Import / Export JSON + small fixes
Date: 2026-10-13
Status: DONE
Decision needed from owner: none

# Avatar clips: Import / Export JSON, and small fixes — final report

All nine owner decisions are done. Every number below was measured on this laptop today. The Pi was
not involved: the page is used on the laptop.

## What changed for you

- **Import JSON…** sits next to Choose video… on Avatar clips.
  1. Pick a sign, then Import JSON… and choose the file.
  2. There is no extraction. The trim strip appears at once, the stage shows the avatar, and the
     "Video + skeleton" tab is greyed out.
  3. Drag the handles (the avatar shows the pose at the handle), Preview, then Save or Redo.
     Redo reopens the JSON picker.
- **Two formats are accepted:**
  - the system's own clip (`sk_avatar_clip_v1`), for example a file from Export JSON;
  - the prototype tool's file (`avatar_pose_hands_v1`), converted to the system's clip.
- **Anything else is refused with a message and nothing is saved.** The messages, as shown:
  - "Import failed. This file is not valid JSON. Nothing was saved."
  - "Import failed. This file is not an avatar clip (sk_avatar_clip_v1 or avatar_pose_hands_v1). It has no
    format field. Nothing was saved."
  - "… Its format is "mediapipe_hands_landmarks_v2". It looks like a recognition sample. Nothing was saved."
  - "Import failed. This avatar clip is not valid: frame 3 pose malformed. Nothing was saved."
- **The file's own key is ignored.** The clip is saved to the sign selected in the list. If the file
  has a signer, it fills the Signer field and you can change it.
- **Export JSON** is next to Preview. It is enabled when the selected sign has a clip and downloads
  `<key>.avatar.json`, an exact copy of the saved clip.
- **Signer field:** the placeholder now reads "Signer ID, e.g. P03". The rules are unchanged.
- **`CLAUDE.md`:** "120 ESL gestures" is now "122 signs (89 Both + 33 ESL)" (measured from `signs.php`:
  89 Both, 33 ESL), and a short paragraph describes `avatar-clips.html` and the avatar in Let's Talk.
- **`extractor-check.mjs`** no longer fails at random (details below).

Three behaviours you did not specify, which I chose:

- **A system clip is not auto-trimmed again on import.** It is already trimmed, so every frame is
  selected; a second auto-trim could drop frames you kept by hand. Only a prototype file is auto-trimmed.
- **An imported signer is not remembered on this computer** until you edit the field, so an imported
  file does not replace your own remembered signer.
- **A prototype file keeps its own fps.** The prototype always writes 25, the same as the system. A
  file with another fps is saved at that fps, not resampled.

## Verification (measured)

| Check | Result |
|---|---|
| Import `my_name_is.avatar.json` into a zz probe sign (`tests/avatar/import-check.mjs`, 31/31 PASS) | 256 frames read (pose 256, right hand 197, left hand 63). Auto-trim: frames 31–221 (1.24–8.84 s). The stage showed the avatar and the video tab was disabled. Preview played. Save wrote 191 frames, 162,166 bytes, through `php/api/avatar_clip.php`. The sign's samples and `sign.json` stayed byte-identical. |
| Play it in Let's Talk | "zz avatar import" played as one avatar run of 191 frames, 8.35 s, 0 videos, caption "ZZ AVATAR IMPORT". 0 console errors. |
| Export, then re-import the export | The download `zz_avatar_import.avatar.json` (162,166 bytes) is byte-identical to the saved file. Imported into a second probe sign and saved: 191 of 191 frames, 24,406 values compared, 0 different. Trim times 1240–8840 ms before and after. The file's key was ignored (saved as `zz_avatar_reimport`) and its signer "P03" filled the Signer field. |
| Rejected files | A broken JSON, a JSON of another shape, a recognition sample (`saved_gestures/a/sample_1784116291180_d87eaf.json`) and a clip with a malformed frame were each refused with the messages above. After each one: Save disabled, no `avatar.json`, 0 POST requests. |
| Network blocked | Chrome ran with every host except localhost unresolvable. 84 requests, all to localhost. 2 POSTs, both the clip saves. |
| 1024×600 | No page scroll (1024×600), every control at least 44 px tall, nothing off-screen, no button label cut off. Choose video… 138×52, Import JSON… 138×52, Signer 180×44 (placeholder text 132 px in 154 px of room), Export JSON 128×44, Preview 110×44. 0 console errors. |
| Avatar tests | `node --test tests/avatar/*.test.mjs`: 28 tests, 28 pass (21 before, plus 7 new in `avatar-import.test.mjs`). |
| `admin-check.mjs` | 22/22 PASS (extraction of `my_name_is.mp4`: 256 frames in 59.7 s, 73 requests, all localhost). |
| `talk-avatar-check.mjs` | 26/26 PASS. |
| `extractor-check.mjs` | **3 runs out of 3 pass, 28 checks each.** The fixture was the same in every run: `in.webm` 137,907 bytes, `out.webm` 137,567 bytes, 12.0 s, 180 frames, 3 reps found in both files. |
| All node tests | `node --test --test-concurrency=1 tests/*/*.test.mjs`: 216 tests, 215 pass, 0 fail, 1 skip (was 209 / 208 / 1). |
| Probes | Every zz probe sign was removed; `saved_gestures/` holds no `zz_` folder. |

## The `extractor-check` fix

- **Before:** the check recorded its test video inside the page with MediaRecorder. The recording's
  length depended on how busy the machine was (16.7–20.5 s in earlier reports), and the "3 reps" check
  sometimes failed with `too-few-reps`.
- **Now:** `tests/video-capture/fake-camera.mjs` has `buildWebm()`, which makes the recording with
  `ffmpeg.exe`: `hello.webm` three times with 1.5 s black gaps, 320×240, 30 fps, VP8. The file is the
  same on every run.
- **One thing found on the way:** the second test file must have no duration, like a real MediaRecorder
  recording. The ffmpeg-built file carries a duration tag that ffmpeg copied into it, so that check
  failed 3 runs out of 3 until the copy was made with `-map_metadata -1`.
- No product code changed for this; only `extractor-check.mjs`, `extractor.page.html` and
  `fake-camera.mjs`.

## Screenshots

`docs/reports/img/`:

- `avatar-import-imported.png`: after an import, with the video tab disabled.
- `avatar-import-preview.png`: the preview of the imported clip.
- `avatar-import-talk.png`: the imported clip playing in Let's Talk.
- `avatar-clips-extracting.png`, `avatar-clips-extracted.png`, `avatar-clips-preview.png`: retaken by
  `admin-check.mjs`, now showing the two new buttons.

## Files

- **Code:** `avatar-clips.html`, `css/avatar-clips.css`, `js/avatar-clips-ui.js`, `js/avatar-clip.js`
  (new `importClip()`; the per-frame checks of `validateClip()` moved into `framesError()` with the same
  behaviour).
- **Tests:** new `tests/avatar/avatar-import.test.mjs` and `tests/avatar/import-check.mjs`; changed
  `tests/video-capture/extractor-check.mjs`, `extractor.page.html`, `fake-camera.mjs`, `README.md`.
- **Docs:** `CLAUDE.md`, `docs/system/UI.md` (Avatar clips), `DECISIONS.md`, `BACKEND.md`, `INVENTORY.md`,
  this report and the screenshots.
- **Not touched:** the extractor, retargeting, timeline, renderer and player; Let's Talk;
  `php/api/avatar_clip.php` and the database; recognition samples and `sign.json`; the capture flow;
  `knnPredict`, `cosineSimilarity`, `trainModel`; `archive/**`; your uncommitted
  `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md`.
- Code and docs are in two separate commits. Nothing was pushed or merged.

## Manual check for you

- On the laptop, import one real JSON through the file picker and export one clip. The automated check
  sets the file and reads the download through Chrome's debugging interface, not through the real
  picker and Downloads folder.
