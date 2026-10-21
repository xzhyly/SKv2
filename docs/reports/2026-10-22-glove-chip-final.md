Phase: glove-chip (Gloves toggle -> small chip on the Let's Talk camera)
Date: 2026-10-22
Status: DONE
Decision needed from owner: none (review the branch; nothing pushed or merged)

# Glove chip: final report

## Branches

- The laptop copy (`C:\xampp\htdocs\SKR`) had no `.git`. Backed up to `C:\xampp\htdocs\SKR_backup`, then
  `git init` + `origin = https://github.com/xzhyly/SKv2.git` + fetch (no login was needed).
- Closest branch: **`origin/glove-hw`** (2026-10-22 03:14, the latest; it already has the "🧤 Gloves OFF/ON"
  button). 14 files differed, no code: `assets/favicon.svg` and 12 `docs/reports/img/glove-*.png` gained embedded
  C2PA metadata, plus the new `docs/design/glove-chip-wireframe.html`. For comparison: pi-power 38 files,
  pi-fixes 44, revision 65.
- `glove-ui` = `origin/glove-hw` + commit "glove UI baseline (from laptop copy)" (files kept with `reset --mixed`).
- `glove-chip` = `glove-ui` + the commits below. Nothing pushed, nothing merged.

## What changed (one commit per step)

| Step | Commit | Change |
|---|---|---|
| 1 | glove-chip 1 | "🧤 Gloves OFF/ON" removed from beside EN \| FIL. The right column markup is byte-identical to before glove-hw Phase 2 (`git diff 7ce0831^ -- talk.html` shows no right-column lines). New `#glove-chip` in `#camera-box`, top-right, 44 px pill, `position:absolute`. |
| 2 | glove-chip 2 | States off / on / idle ("Camera only", amber). OFF at every Sign turn (`GloveAssist.startTurn()` in `onEnterSigning`). |
| 3 | glove-chip 3 | First-ON hint `#glove-hint` under the chips, once per conversation, 3 s or tap, FIL / EN. |
| 4 | glove-chip 4 | No finger bars in Let's Talk. **Setting repurposed** (not removed): "Finger bars in Let's Talk" is now "Finger bars in Train Gestures" and controls the Step 3 button's bars (same `sk_glove_bars` key). Live bars in Admin -> Settings -> Glove unchanged. |
| 5 | none | Train Gestures Step 3 ON/OFF compare button left as it was (`GloveAssist.init` unchanged). |
| 6 | glove-chip 6 | Sign Guide line: "🧤 May gloves? I-tap ang Gloves sa camera para mas tumpak (optional)." + EN line under it. |
| 7 | glove-chip 7 | Shadow on the ON chip (the white pill had no edge on a white picture). |
| | test commit | `tests/glove/talk-glove-check.mjs` rewritten for the chip. |
| | docs commit | `docs/system/UI.md` 3i + Part 5, `docs/system/GLOVE.md`, this report. |

Glove logic is unchanged: `apply()`, `glovesForFrame()`, `rerank`, strength, FRESH_MS / IDLE_MS / HAND_SCORE are
untouched. The chip's idle state reads `glovesForFrame().why`; "no hand in the frame" counts as ON (nothing for the
glove to do yet), every other reason as "Camera only".

## Files

- `talk.html`: chip + hint CSS and markup, right column restored, `initChip` call, `startTurn()` in
  `onEnterSigning`, Guide line.
- `js/glove-assist.js`: `initChip(el, { hint, lang })`, `startTurn()`, `chipState()`; `render()` drives both.
- `settings.html`: finger-bars switch label / comments.
- `tests/glove/talk-glove-check.mjs`, `docs/system/UI.md`, `docs/system/GLOVE.md`, this file.
- Not touched: `docs/revision/MEMORY.md`, `docs/system/MANUAL-CHECKS.md`, videos, `unzipping`, the database.

## Checked (laptop, Claude's built-in browser, 1024x600, `?glove=sim`)

The pane blocks the camera, so the "Camera not available" card was hidden for layout checks and no real hand
was in the frame.

- No glove: chip hidden. With glove: every right-column rect and the camera/caption rects are identical to the
  no-glove screen. Chip at x 560-648, y 114-158 (44 px tall, 12 px from the camera's right/top like the caption
  chip on the left); hint at y 166-207 under both chips; no page scroll (1024x600).
- Tap -> ON (white, green dot, `aria-pressed=true`), EN hint, hidden after 3 s; tap on hint hides it; OFF hides it;
  second ON in the same conversation: no hint; next Sign turn: OFF; "+ New conversation": OFF and the hint again;
  FIL hint text when FIL is active (set by class: the FIL switch needs a running camera).
- Unsure hand (score 0.6) -> "Camera only", amber border/dot rgb(249,115,22); sure again -> ON. Fingers still 3 s ->
  "Camera only" (`apply` why = "not worn"); moved -> ON. Data 1.5 s old -> "Camera only". Tap in "Camera only" -> OFF.
- Readable on the dark camera backdrop and on a white background (screenshots in the session).
- Per frame: nothing. The chip re-checks every 250 ms only while ON and writes the DOM only on a state change.
- Console: only the pane's "camera failed: NotAllowedError" lines; none from the glove code.
- **Not run here:** `node tests/glove/talk-glove-check.mjs` (no Playwright on this laptop), Train Gestures Step 3
  (needs the admin login), and the detection-rate comparison.

## How to test

Laptop (simulator):
1. Open `http://localhost/SKR/settings.html?glove=sim` once and run Set up glove (or put a setup in
   `localStorage.sk_glove_sim_cfg` as in `tests/glove/talk-glove-check.mjs`).
2. `http://localhost/SKR/talk.html` without `?glove=sim`: Sign screen has no chip, same as before.
3. `http://localhost/SKR/talk.html?glove=sim` -> Sign: "🧤 Gloves" top-right on the camera. Tap: white "🧤 ON",
   green dot, hint for 3 s. Keep the hand still 3 s: "Camera only"; move: back to ON. Speak or Type -> Sign: OFF.
4. Where Playwright exists: `node tests/glove/talk-glove-check.mjs --shots <dir>`.

Pi (real glove):
1. Plug in the set-up glove (Admin -> Settings -> Glove shows "setup saved on glove"; the camera step done).
2. Let's Talk -> Sign: chip appears top-right; unplug -> it disappears; plug back -> it returns, OFF.
3. Wear both gloves, tap the chip: ON + hint. Sign as usual: chip stays white/green. Take the gloves off or hold
   still 3 s: "Camera only"; sign again: ON.
4. Check the chip is readable against the room's light, and that detection feels as fast as with the chip OFF.
5. Train Gestures Step 3: the old ON/OFF button and its bars still work; Settings "Finger bars in Train Gestures"
   turns those bars off.
