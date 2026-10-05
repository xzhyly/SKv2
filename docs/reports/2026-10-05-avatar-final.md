Phase: 2D avatar for text-to-sign
Date: 2026-10-05
Status: DONE
Decision needed from owner: none to finish the phase. Two follow-ups are yours: record the avatar clips (one signer) on the new page, and run the Pi bench (`bash tests/avatar/pi-bench.sh`). See "Owner actions".

# 2D avatar for text-to-sign — final report

Plan: `docs/reports/2026-10-05-avatar-step1.md`, approved with every recommended default, plus two changes:

- **Q1:** the non-SIMD Holistic files are not vendored, and the admin page shows a message when SIMD is
  missing.
- **Flat 2D only:** no gradients, blur, shadows, `ctx.filter` or quality tiers.

Every number below was measured on this laptop unless a line says otherwise. **The Pi was not measured.**

## What changed for you

- **Train Gestures, Step 1.** The old dataset row now holds two buttons:
  **[📁 View Active Gesture Dataset · N gestures › | 🧍 Avatar clips]**.
  - The dataset table gains an **Avatar** column (✓ or —).
  - Avatar clips opens the new page without asking for the PIN again, for 10 minutes in the same tab.
  - Opening the page's URL directly asks for the same PIN.
- **Avatar clips page (`avatar-clips.html`)**, meant for the laptop:
  1. Pick a sign, then **Choose video…**.
  2. Extraction runs with a progress bar and the skeleton drawn on each frame.
  3. The clip is trimmed automatically from the first hand raise to the last hand lower. Drag the two
     handles to change it.
  4. **Preview** plays it on the avatar.
  5. **Save** stores only the landmark clip. The video is never uploaded or stored.
  - **Redo** starts again. **Delete** takes two taps and removes the clip only.
  - The optional **Signer** field is remembered on that computer.
- **Let's Talk, Speak or Type.** After Translate, every run of words whose sign has a clip plays on the avatar
  as one continuous movement:
  - It starts from rest, blends from each sign's last pose into the next sign's first pose, and returns to
    rest at the end.
  - A word without a clip plays the old video exactly as before.
  - Captions, Edit/Send and the conversation thread are unchanged. There are no new buttons.
- **Until you record clips, nothing looks different in Let's Talk.** No clip ships with this phase.

## Verification (measured)

| Check | Result |
|---|---|
| Extract `my_name_is.mp4` on the admin page, internet blocked (`tests/avatar/admin-check.mjs`, 22/22 PASS) | **Blocking:** Chrome ran with every host except localhost unresolvable. **Extraction:** 256 frames in 61.3 s (a second run took 66.3 s). Pose was found in 256 frames, right hand in 195–198, left hand in 64–66; the prototype's online run found 197 and 63. Mean pose difference from that run: 0.0130–0.0133. Auto-trim: frames 31–221 (1.24–8.84 s). **Save:** 191 frames, 162–164 KB. **Network:** 73 requests, all to localhost. The one POST was the clip JSON (about the clip's size; the video is 2,602,227 bytes); no request carried video bytes or named the video. **Disk:** no new video file anywhere under the repo, `C:\xampp\htdocs` or `C:\xampp\tmp`. The sign's samples and `sign.json` stayed byte-identical. 0 console errors. |
| Player unit tests (`tests/avatar/avatar-math.test.mjs`, 16/16) | **Blend continuity:** every transition stays at or below 60 px per 40 ms. The worst values on the sample sentence were 24.3 / 22.9 / 5.7 / 21.8 px. At each transition's start and end the pose matches the clip's end or start frame to within 0.5 px. Between signs the hands never dip toward rest. **Rest pose:** exact at both ends. **Missing clip:** the word falls back to video, and runs stay together. **Also covered:** no bone longer than the avatar's own; a fingertip on the nose lands within 3 px of the avatar's nose, with the head level or tilted 0.3 rad; hand gaps are filled; the elbow bends to the correct side; angles wrap correctly; clip validation. |
| Let's Talk (`tests/avatar/talk-avatar-check.mjs`, 26/26 PASS) | **3 signs with clips:** one continuous avatar run, 6.8 s. Captions came in order, 0 videos were created, and the avatar stayed visible the whole time. Transitions took 350 / 431 / 250 / 400 ms, with worst joint jumps of 40.6 / 44.3 / 37.4 / 21.5 px per 40 ms. **Mixed sentence "zz ava one nice":** the avatar played, then `nice.webm` started 15 ms after the avatar finished. **Clip deleted after the page loaded:** that word played as video. 0 console errors. Holistic was never requested by `talk.html`. The 4 PNGs were loaded once. |
| Hand tracking paused while the avatar plays | **Signing screen (fake camera):** 46–48 `Hands.send` calls per second before playback, 0 during a 4.3–4.5 s playback, and 47–66 in the 1.5 s after (it resumes). **Speak or Type:** 0 sends during playback (the camera is already off there). |
| Frame rate, this laptop (`tests/avatar/bench.html`, 560×260, 10 s per run) | **Capped at 30 fps (what Let's Talk uses):** 29.9 fps with GPU (p5 29.4) and 30.1 fps with `--disable-gpu` (p5 28.8). **Uncapped:** 59.9 and 59.2 fps, which is the display rate. **Draw time:** median 0.2–0.3 ms per frame, p95 0.3–0.7 ms. **With the CPU throttled 4× (a rough stand-in, not a Pi measurement):** capped 29.9 fps (p5 22.7). In Let's Talk itself: 29.9 fps, 0.3 ms per frame. |
| Frame rate, Pi | **Not measured.** `tests/avatar/pi-bench.sh` is ready; its log parsing was checked with desktop Chrome. |
| Existing tests | Baseline: 188 tests, 187 pass, 0 fail, 1 skip. Final: **209 tests, 208 pass, 0 fail, 1 skip**; the 21 new tests are the avatar ones. The 21 avatar tests were re-run after the last fixes and pass. `talk-check.mjs`, `verify-e2e.mjs` (80 PASS, 0 FAIL), `capture-ui-check.mjs`, `startup-check.mjs` and `e2e.mjs` all pass. |
| 1024×600 | `avatar-clips.html`: no page scroll, every control at least 44 px, nothing off-screen. Train Gestures row: 336×56 and 124×56 px, each label on one line. Dataset rows: 45 px. Let's Talk: the avatar canvas exactly covers the 560×260 frame, `scrollWidth` 1024. 0 console errors on every page checked. |
| `signs.php` GET time (Apache, 5 runs each, interleaved) | About 34 ms before the change and 38 ms after (it now checks for `avatar.json` per sign). |

## Screenshots

`docs/reports/img/`:

- `avatar-train-gestures-button.png`: the button row.
- `avatar-dataset-column.png`: the Avatar column.
- `avatar-clips-extracting.png`: extraction in progress, with the skeleton.
- `avatar-clips-extracted.png`: after extraction, showing the trim strip.
- `avatar-clips-preview.png`: the avatar preview.
- `avatar-talk-playing.png`: the avatar signing in Let's Talk.
- `avatar-talk-rest.png`: the avatar at rest.
- `avatar-talk-video-after.png`: the video fallback after an avatar run.

## How it works (short)

- **Clip.** Raw MediaPipe Holistic pose and hand landmarks of the signer, trimmed, 25 fps, about 850 bytes per
  frame. It is saved at `saved_gestures/<key>/avatar.json`, next to the sign's samples. There is no database
  change; `signs.php` reports `avatar: true/false` per sign.
- **Retargeting at play time** (this fixes the prototype's four problems):
  - **Stretched arms:** each bone takes its direction and foreshortening from the signer but keeps the
    avatar's own length. In the prototype the upper arm was drawn up to 1.9× too long.
  - **Hands colliding with the big head:** a hand near the face is placed by its contact point on the
    caricature's face.
  - **Stiff fallback hand:** missing hands are filled from neighbouring frames, not drawn as a fixed shape.
  - **Sleeve gap:** a shoulder cap covers the joint, so the sleeve never separates from the shoulder.
- **Smoothing.** A light, zero-lag smoothing removes detection jitter. Without it, hand jumps reached up to
  145 px per 40 ms.
- **Blends.** 250 ms between signs, lengthened when the avatar has far to travel (431 ms in the measured
  sentence) so it never jumps.
- **Look.** Flat colours, blink, slight breathing, the farther arm and fingers drawn first, and its own light
  background.

## Process

Task 0: backups and baseline. A mysqldump to
`E:\ACADSS\IOT\backups\2026-10-05-avatar\sining_kamay_db_before-avatar.sql` (6,022,829 bytes), taken before
anything changed. In the end there was no schema change.

I wrote the code for every task myself, then had each task group checked by an independent reviewer agent.
The plan called for one implementer per task; I deviated from that because the tasks share the same module
files.

| Tasks | Review | Outcome |
|---|---|---|
| 1 vendor Holistic, 2 rig + PNGs, 3 pure modules | Approved; 7 minor findings | Fixed: the face contact drifting when the head is tilted (now tested); stricter clip validation (`poseIdx`, bounds, visibility, trim, zero shoulder width); new tests for the IK side and angle wrap. Wording fix in the timeline comment. Gap-fill sharpness recorded as DEBT 112. |
| 4 renderer/player/store/bench, 5 server | Changes needed: 2 Important, 9 Minor | Fixed: player re-entrancy (a word callback could restart the loop); the server accepting `"1080"` as a number; a stale failure evicting a newer cached clip; prototype keys such as `constructor` counting as clips; action checked before key; rename retry; safety timeout. |
| Live check (Task 7) | Two of my own findings | A 250 ms blend measured 61 px per 40 ms once its duration was computed from the straight-line distance. The duration now comes from the actual blended path (431 ms, 44.3 px). A miscount of one `Hands.send` at resume time was a test-measurement artefact, now fixed. |
| 6 admin page, 7 Let's Talk, plus re-check of the 4–5 fixes | Approved; 8 Minor | Fixed: Redo during model load, the stale progress frame, seek cleanup, overlapping trim handles, a 60 s video limit, strict trim/signer checks with a field whitelist, a new Translate cancelling a running avatar, and the PIN skip now expiring after 10 minutes. |
| Whole phase (Opus) | READY: 0 Critical, 0 Important, 8 Minor | Fixed: the signer check now uses the same rule in PHP and JS (null rejected, UTF-16 length); the kiosk rejects a clip whose key is not its folder's; a trim over 500 frames shows "too long" and disables Save; dead store API removed; an unknown Avatar flag shows "?". Documented: clips go to the Pi like samples (`BACKEND.md`); a running kiosk page only sees new clips after a reload (DEBT 115). After the fixes the 21 avatar tests, `admin-check.mjs` (22/22) and `talk-avatar-check.mjs` (26/26) were re-run and pass. |

## Owner actions

1. **Record the clips** on Avatar clips, with one signer for all of them (decision 3), one video per sign.
   - Each video must be under 60 s; a clip holds at most 20 s (500 frames).
   - Extraction takes about 6× the video's length on this laptop.
   - Until a sign has a clip, its word keeps playing as video.
2. **Run `bash tests/avatar/pi-bench.sh` on the Pi**, from a terminal on the Pi's desktop.
   - It closes the kiosk, runs about 40 s, prints and saves the frame rate, and then you restart the kiosk.
   - `capped30.fps` near 30 is what Let's Talk needs.
3. **Manual checks to add to `docs/system/MANUAL-CHECKS.md`.** I didn't edit that file because it has your
   uncommitted changes.
   - The Pi bench (item 2).
   - On the Pi touchscreen, drag the trim handles.
   - In Let's Talk on the Pi, play a sentence of signs that have clips and watch that the hands stay smooth.
4. **Known limits** (DEBT 109–115): the Pi is not measured; no clips exist yet; extraction is slow and varies a
   little between runs; the gap fill switches abruptly at 8 frames; the server re-encodes the JSON; no facial
   expressions; a running kiosk page only uses newly saved clips after it reloads. End Conversation reloads it.

## Files

- **Code:** `avatar-clips.html`, `css/avatar-clips.css`, `js/avatar-{rig,clip,retarget,timeline,renderer,store,player,extract,clips-ui}.js`,
  `php/api/avatar_clip.php`, `tests/avatar/*`. Changed: `js/sign-player.js`, `talk.html`, `php/api/signs.php`,
  `gesture-training.html`, `css/gesture-training.css`, `js/gesture-training-ui.js`.
- **Assets:** `js/lib/holistic/` (7 files, 30,195,488 bytes) and `assets/avatar/*.png` (4 files, 450,910
  bytes).
- **Docs:** `docs/system/UI.md` (Part 2 "Avatar clips", Part 3 3e), `DECISIONS.md`, `BACKEND.md`, `VENDORED.md`,
  `INVENTORY.md`, `HARDWARE_BOOT.md`, `ML.md`, `DEBT.md` (109–115), both reports and the screenshots.
- **Not touched:**
  - `knnPredict`, `cosineSimilarity`, `trainModel`;
  - the capture flow (`js/capture-core.js`, `js/gesture-capture-ui.js`, `js/video-landmarks.js`, which is
    reused but not changed, and `js/gesture-data.js`);
  - the sample formats and the existing `sign.json` fields;
  - sign-to-text in Let's Talk (`js/talk-signing.js`, `js/sign-to-text-ui.js`);
  - `archive/**`;
  - your uncommitted `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md`;
  - `CLAUDE.md`, which does not yet mention the avatar, for you to update.
- The throw-away probe folder `C:\xampp\htdocs\avatar-probe\` (outside the repo) was deleted.
- Code, assets and docs are in three separate commits. Nothing was pushed or merged.
