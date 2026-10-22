Phase: glove-static (fixed finger wiring, simpler Set up glove)
Date: 2026-10-22
Status: DONE
Decision needed from owner: none (review the branch; nothing pushed or merged)

# Glove static wiring: final report

Branch `glove-static`, from `glove-chip` (`364d13c`). Not pushed, not merged.

## What changed

| Commit | Change |
|---|---|
| glove-static 1 | `js/glove.js`: one constant `MAP` (`SKGlove.MAP`): right thumb..pinky C0-C4, left thumb..pinky C9-C5. Hands are read through it with or without a setup. Old setups: map ignored; calibration re-keyed by channel when every MAP channel had one (`calibrationFrom() = 'moved'`), else dropped (`'dropped'`, calibrate again). No stored `cam` -> `DEFAULT_MIRROR = true`. |
| glove-static 2 | `settings.html` Set up glove = 1 Check wiring, 2 Calibrate, 3 Save + Test (EN + FIL text, no modals). MediaPipe no longer loads on Settings (only the camera step used it). `SKGlove.MINSPAN` exposed for the test view. |
| glove-static 3 | Glove card: "Wiring: fixed (C0–C4 right, C5–C9 left)", calibration date / notes, **Check fingers** (step 1 alone). Live bars shown as soon as a glove is connected, each with its channel. |
| glove-static 4 | Debug: the 16-channel table and hints name the finger of every channel from `MAP` ("Finger (fixed wiring)" column). |
| fix | `calibrationFrom()` changes only on the glove's `cfg-ok` (found by the test: Clear setup left the "old wiring" note behind). |
| tests | `tests/glove/glove-core-check.mjs` (fixed map, old-setup re-key / drop, rising and falling sensors), `tests/glove/settings-check.mjs` (new 3-step flow, Check fingers, old setups). |
| docs | `docs/system/GLOVE.md` (Fixed wiring table, 3-step setup, weak sensor, old setups, API), `docs/system/UI.md` Part 5, `tools/glove-firmware/README.md` (wiring diagram, check list), this report. |

Recognition is unchanged: `js/glove-assist.js` and `js/glove-bend.js` were not edited (re-ranking, strength, the ignore
rules, the Let's Talk chip). The setup format stays `v: 1` with `map` written as `MAP`, so a kiosk still on the
older code reads it.

## Decisions to know about

- **Camera step removed, but its value is still needed.** Let's Talk pairs a hand on screen with a glove through
  MediaPipe's "Left"/"Right" label (`js/glove-assist.js:90`, `cam.mirror`). That label depends on how frames reach
  MediaPipe, not on the glove: `js/gesture-data.js` sends unmirrored frames (`drawImage`, `js/gesture-data.js:449`)
  with no `selfieMode` (`js/gesture-data.js:250-255`), and MediaPipe assumes a mirrored selfie, so the right hand
  reads "Left". So `DEFAULT_MIRROR = true` replaces the step; a value measured by the old step is kept. A camera that
  mirrors its own picture in hardware would be wrong; no screen sets `false` any more.
- **IMU step removed** (not in the new 3 steps). A stored `imuHand` is kept and still shown; a new glove shows
  "Hand not set". Nothing in recognition reads `imuHand`.
- **"ESP32 + local fallback":** today the calibration is stored only on the ESP32 (`cfg-set`); the simulator's
  "flash" is localStorage. There is no local fallback for the real glove, before or after this phase. Save goes to
  the same place as before; no fallback was added.
- **Thresholds (chosen, not measured):** Check wiring ✓ at a raw span of 400 (about 10 % of 0-4095; the simulator's
  idle wobble is at most about 130, `js/glove.js` `simChannel`); "moving now" outline at 150 within 0.4 s; weak
  sensor under 150 open/fist difference (the old Fingers step's `MOVE_MIN`); ignored under 50 (`MINSPAN`, unchanged).
- **Inverted sensors:** nothing is inverted by hand. `open`/`fist` are stored as measured and `norm` divides by the
  signed span (`js/glove.js` `handsFrom`), so a sensor that falls when bent (simulator) and one that rises (the
  owner's glove, GLOVE.md "Hardware") both read 0 open, 1 fist. Checked in `glove-core-check.mjs`.

## Checks run

- `node tests/glove/glove-core-check.mjs`: ALL CHECKS PASSED.
- `node tests/glove/glove-bend-check.mjs`: ALL CHECKS PASSED.
- `SK_BASE=http://127.0.0.1:8080/SKR/ node tests/glove/settings-check.mjs` (headless Chrome 1024x600, PHP built-in
  server with `tests/glove/no-db-router.php`): 39 checks, ALL CHECKS PASSED, including no page scroll and every
  control >= 44 px on each screen, and 0 console errors.
- Built-in browser, `talk.html?glove=sim` with an old-format setup (old map, no `cam`): calibration "moved",
  `cam.mirror` true, chip shown; a right hand labelled "Left" with the right glove bent like "s" -> `apply()` used
  the glove, "s" distance 0.013 vs "b" 0.215.
- **Not run:** `tests/glove/talk-glove-check.mjs` (needs Playwright, not installed here). Its setup uses the old
  simulator map, which now re-keys cleanly; untouched by this phase.
- **Not checked:** a real glove, the Pi.

## How to test

Laptop (simulator):
1. `http://localhost/SKR/settings.html?glove=sim` (admin) -> Glove: "Wiring: fixed (C0–C4 right, C5–C9 left)",
   "not calibrated yet", live bars with channels.
2. Set up glove -> Check wiring: in the console run `SKGlove.simSetBend(7, 1)`: only "Middle C7" in the LEFT row
   gets the orange outline and ✓. `SKGlove.simSetBend(7, null)`. Do all ten (0-9), or tap "Skip check".
3. Next -> Calibrate: open (do nothing) 3 s; when it says "Make two fists", run
   `[0,1,2,3,4,5,6,7,8,9].forEach(c => SKGlove.simSetBend(c, c === 3 ? 0.03 : 1))` -> "⚠ Weak sensor: Right ring C3".
4. Next -> Save + Test: `SKGlove.simSetBend(0, 1)` -> Right thumb ~100 %; Save -> "Saved on the glove"; Done.
5. Check fingers: step 1 alone, Done any time, the calibration date unchanged.
6. Old setup: `localStorage.setItem('sk_glove_sim_cfg', '{"v":1,"map":{"L":[5,6,7,8,9],"R":[0,1,2,3,4]},"cal":{...}}')`
   then reload -> "kept from the old setup"; with a channel of the fixed wiring missing from the map ->
   "Calibration needed".

Pi (real glove):
1. Settings -> Glove: Wiring card, live bars move as you bend; the Debug table names each channel's finger.
2. Check fingers: bend each finger alone; the matching bar (and only it) should get the outline and ✓. A different
   bar moving = a wire on the wrong mux pin.
3. Set up glove: Check wiring (10 / 10) -> Calibrate (open flat 3 s, fists 3 s) -> Save + Test: open hand near 0 %,
   fist near 100 % on every finger; Save. A ⚠ finger: bend fully and Redo calibration, or check its wire.
4. Unplug / plug back: the calibration date is the same (it comes from the glove).
5. Let's Talk -> Sign: the 🧤 chip appears; with the gloves on and ON it stays green while signing. If it pairs the
   wrong glove with a hand (the camera mirrors in hardware), report it: that needs `cam.mirror: false`.
