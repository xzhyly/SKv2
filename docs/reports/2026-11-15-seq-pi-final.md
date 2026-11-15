Phase: seq-recognition, Pi round (lag, the word disappearing, smooth hand lines)
Date: 2026-11-15
Status: DONE
Decision needed from owner: none; run the OWNER CHECKLIST on the Pi and send the `?devperf` numbers.

# Whole-sign recognition on the Pi — report

Branch `seq-recognition`, after `docs/reports/2026-11-15-seq-recognition-final.md`. The owner tried it on the Pi
and went back to `touch-ux`: "mas naging laggy"; "napapalabas naman yung sign bigla lang nawawala"; the Guide's
hand lines look like they jump frame by frame, they should move with the hand, within what the Pi can do.

## What the measurements say about the lag

Let's Talk Sign screen, 15 s each, this container (Playwright Chromium, fake camera; MediaPipe takes about
0.7 s a frame here, so these are not the Pi's numbers, only the direction). "Timer late" = how long a 50 ms timer
waited past its time, which is what a touch waits for. `node tests/seq/pi-sim-check.mjs --only B`.

| Address | Timer late p50 | p95 | Detections/s | MediaPipe holds the page |
|---|---|---|---|---|
| `?idle=0&seq=off` (the old recognition) | 602 ms | 775 ms | 1.38 | 92 % |
| `?idle=0` (whole-sign, no pacing) | 574 ms | 739 ms | 1.33 | 91 % |
| `?idle=0.6` (whole-sign, the new default) | 0 ms | 720 ms | 0.82 | 62 % |

- **The whole-sign code itself adds no lag** (rows 1 and 2). What makes the page slow to touch is MediaPipe:
  it runs on the page's only thread and, between detections, gave the page almost no free time.
- **New: `idleRatio`** (`js/gesture-data.js`, talk.html 0.6, `?idle=N`): after a detection of D ms, the next
  one waits until at least 0.6 x D ms have passed, so touches and the screen get that time. Here the median
  delay went from 574 ms to 0. It costs detections a second when D is long (here 1.33 -> 0.82); on the Pi, where
  D is much shorter, the camera-frame wait already gives part of that gap, so the loss should be smaller. Not
  measured on the Pi: `talk.html?devperf` now shows "busy" (share of time MediaPipe held the page) and the
  rate, for `?idle=0` against the default.
- A timer that falls during a detection still waits for it (p95 stays near one detection). Only moving MediaPipe
  off the page's thread would change that; not done (the vendored MediaPipe build was not checked to run in a
  worker on the Pi).
- One classification is once per sign; loading the model file is now a view onto the file instead of a copy
  (ESL file: 0.34 ms in node, was 8.8 ms).

## The word appearing, then disappearing

Two causes, both changed:
1. The caption went back to "Show your sign" 1.5 s after the answer. Now the last answer stays until the next
   one; while the next sign runs it reads "Thank you · Signing…". The words in the sentence box were never
   removed (only Undo / Clear / Send / leaving the turn remove them).
2. On a slow Pi, MediaPipe misses the hand for a frame or two. 400 ms without a hand ended the sign, so one sign
   could be cut into two pieces (two wrong answers, or "not sure"). Now "hands gone" must last at least 3.5 x the
   measured time between frames (`js/seq-recognizer.js` `GONE_FRAMES`). At full rate (15 fps) this is still
   400 ms, so the earlier numbers do not change.

`node tools/seq_eval/stream.mjs <saved_gestures> [--fps N] [--drop P]` (new `--drop P`: each frame with a hand
loses it with probability P, fixed seed). Same signers, 1,357 signs:

| Test | Exactly right before | after | Wrong word before | after | More than one word before | after |
|---|---|---|---|---|---|---|
| full rate | 84.4 % | 84.4 % | 4.6 % | 4.6 % | 1.5 % | 1.5 % |
| 6 fps | 81.4 % | 81.4 % | 4.3 % | 4.3 % | 0.5 % | 0.4 % |
| 6 fps, 15 % of hand frames lost | 74.1 % | 79.5 % | 5.0 % | 4.2 % | 3.6 % | 0.4 % |
| 5 fps, 25 % of hand frames lost | 64.6 % | 77.2 % | 5.5 % | 3.9 % | 6.1 % | 0.5 % |

(2.5 x was also tried: 79.1 % and 75.1 % in the last two rows; 3.5 x kept.) The cost: after the hand goes
down, the answer comes 3.5 frame-times later (at 5 fps 0.7 s instead of 0.4 s).

## Hand lines that move with the hand

`js/hand-overlay.js` (new), used by `js/gesture-data.js` when loaded (Let's Talk only):
- MediaPipe's answers only update each hand's position and speed; a separate loop draws up to 30 times a second
  where the hand should be now: the last position moved on by 70 % of its speed for the time since that camera
  frame was taken (at most 150 ms), eased in over 45 ms, so a new answer never makes the lines jump.
- A hand that slows down sharply takes its new speed at once (less running past the stop).
- A missed answer keeps the hand 300 ms, then it fades over 200 ms (before: the lines blinked off).
- All lines are one stroke and all dots one fill: 2 draw calls a frame instead of 84; the canvas is resized only
  when a size changes. The loop stops by itself with no hand in view.

Measured (`node tests/seq/pi-sim-check.mjs --only A`): a hand fed as 5 answers a second, each 120 ms old.

| | Old (lines where the last answer was) | New |
|---|---|---|
| Frames drawn per second | 5 | 30.2 |
| Circle every 3 s: median distance from the real hand (px on 640x480) | 65 | 55 |
| Biggest step between two drawn frames | 66 | 36 |
| Sweep, then stop: runs past the stop by | 0 | 33 px |
| Draw time per frame | | 0.11 ms (this container) |

Other settings tried (circle median / run past the stop): predict 220 ms at 80 % 49 / 71 px; 300 ms at 90 %
49 / 109 px. More prediction gets closer while moving but overshoots more when the hand stops; 150 ms at 70 %
was kept. **Honest limit:** with 5 answers a second the lines cannot be glued to the hand; they now move smoothly
and lag less, but still trail a fast hand. A faster Pi detection (the lite hand model, not vendored, see
`js/talk-loader.js` `LITE_MODEL_VENDORED`) is what would bring them closer.

## Files

| File | Change |
|---|---|
| `js/hand-overlay.js` (new) | smooth hand lines |
| `js/gesture-data.js` | uses HandOverlay when loaded; `captureAt`; `idleRatio`; `getLoopStats()` adds `busy`, `idleRatio` |
| `js/talk-loader.js` | loads `js/hand-overlay.js`; `IDLE_RATIO` 0.6, `?idle=` |
| `js/talk-signing.js` | the last answer stays in the caption; nothing during the countdown; lines cleared on leave / Guide off; `?devperf` lines |
| `js/seq-recognizer.js` | `GONE_FRAMES` 3.5 |
| `js/seq-features.js` | `decode()` without a copy |
| `tools/seq_eval/stream.mjs` | `--drop P` |
| `tests/seq/pi-sim-check.mjs` (new), `tests/seq/talk-seq-check.mjs` | checks |
| `docs/system/ML.md`, `UI.md` 3j, `INVENTORY.md` | docs |

## Checks run here

| Check | Result |
|---|---|
| `node tests/seq/pi-sim-check.mjs` | **7/7 PASS** |
| `node tests/seq/talk-seq-check.mjs` (with samples) | **24/24 PASS** (adds: the caption still shows the word 2.5 s later; lines loaded and idle with no hand; idle 0.6) |
| `node tests/glove/talk-glove-check.mjs` | ALL PASS |
| `node tests/touch-ux/touch-check.mjs` | ALL PASS |

## Not checked here

The Pi itself (detection time, the lines' frame rate, how touch feels), a real hand. The touch that stops
working on one monitor is a separate hardware matter (its USB touch device disconnects from the hub,
`dmesg` "USB disconnect" for 1-1.3.2); nothing in this branch changes it.

## OWNER CHECKLIST (Pi)

```
cd ~/SKv2
git fetch
git checkout seq-recognition
git pull
sudo reboot
```
Back to the old one: `cd ~/SKv2 && git checkout touch-ux && sudo reboot`.

1. Open `http://localhost/SKR/talk.html?devperf` (from DevTools or by typing it), Sign. Write down the numbers
   in the corner for 10 s: `detect ... ms/frame`, `detect ... fps`, `busy ... %`, `lines ... fps`.
2. Same with `talk.html?devperf&idle=0`. Is touch (Undo, EN | FIL) slower in this one?
3. Move a hand slowly, then fast: the lines follow without jumping; lowering the hand, they fade.
4. Sign 10 words: the last word stays in the caption; nothing is cut in two.
5. Send the numbers from 1 and 2.
