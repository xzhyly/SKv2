Phase: avatar first-movement jump fix (DEBT 124)
Date: 2026-10-14
Status: DONE
Decision needed from owner: none. One behaviour to know: the fix also applies to sign -> sign blends (section 3).

# Avatar jump fix — final report

Every number below was measured on this laptop (node, and headless Chrome for the browser checks).
Nothing was run on the Pi.

## 1. What was wrong

The jump is in the clip itself, not in the transition. On `hello.webm`, the frame before Holistic finds
the hand has the pose wrist low. The next frames then move 156–210 px per 40 ms (the hand rising and
turning). Measured on the frames of one extraction: steps 18→19 and 19→20 were 210 / 190 px raw and
156–177 px after smoothing.

The rest → sign transition ended at the clip's first frame. So depending on where the trim landed (17, 18
or 19, which changes between Holistic runs), that fast step was either just after the transition or
40–80 ms later. The old check took one 40 ms window every 40 ms, so it caught the step only some of the
time. That is why it failed by chance.

The end of a clip has the same pattern: hello's last frames move fast too. With the old code the
hello → how_are_you blend measured 69–83 px when every window is measured.

## 2. What changed

| File | Change |
|---|---|
| `js/avatar-timeline.js` | `clipEdges()`: a clip plays from its first frame where a hand is raised and every raised arm's hand was detected, then on past any step faster than 50 px per 40 ms. The same rule applies backwards at the end. The transitions keep the "duration from the actual blended path" rule and go to and from those frames. The search for the hands looks at most half the clip in from each end; if no frame qualifies, that end stays. The fast-step skip stops at the other end. Also: the 700 ms cap no longer shortens a transition past 60 px per 40 ms. |
| `js/avatar-retarget.js` | `prepare()` also returns `ready` (one flag per frame, from `AvatarClip.handsReady()`). |
| `js/avatar-clip.js` | `handsReady()` added. `autoTrim()` moves each end inward to a `handsReady()` frame (at most 8 frames, at most half the raised range; with no such frame the end stays). |
| `tests/avatar/fixtures/holistic-signs.json` | New, 136,594 bytes. Holistic output for every frame of `hello.webm`, `how_are_you.webm` and `my_name.webm`, with the old auto-trims (hello 18..49 starts on the no-hand frame). |
| `tests/avatar/avatar-edges.test.mjs` | New, 8 tests (section 4). |
| `tests/avatar/talk-avatar-check.mjs` | Builds its 3 clips from the fixture (old auto-trims) and imports them with Import JSON on Avatar clips, instead of a fresh Holistic run. Continuity is now measured on every 40 ms window that overlaps a transition, 5 ms apart, instead of one window every 40 ms. |

The fix is at play time, so existing saved clips and bulk candidates benefit without re-extraction. No
saved clip was rewritten.

Not changed: renderer, extractor, clip format, Let's Talk UI, bulk import files, recognition, capture flow,
`archive/**`, your `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md`.

## 3. Behaviour to know

- **Sign → sign blends use the same edges.** The skipped frames are the arm rising from rest or dropping
  to it. A blend between two signs would otherwise drop toward rest and come back.
- **The rest → hello transition is longer**: 618–676 ms (was 350–405 ms). That is the arm's full rise,
  now done by the transition at ≤ 50 px per 40 ms instead of by the clip's 156–210 px step.
- **Clips lose a few frames at play time.** hello (18..49) now plays frames 20..45: 2 frames of the rise and 4 fast frames at the end. how_are_you (9..58) and
  my_name (0..53) lose none.
- **Not covered:** a manual trim whose first (or last) half has no frame with the raised arm's hand
  detected keeps that end. A fast rise inside such a clip then plays as recorded. The transitions
  still stay within the limit. Recorded as part of the DEBT 124 resolution.

## 4. Verification (measured)

| Required | Result |
|---|---|
| New unit tests: a clip starting/ending on a no-hand frame, one frame earlier and later, within 60 px per 40 ms at both ends | `avatar-edges.test.mjs`, 8/8 pass. Each 40 ms window overlapping a transition, 2 ms apart. hello starting at 17 / 18 (no hand) / 19: in 45.5 / 45.6 / 45.9 px, out 54.8–54.9 px. how_are_you ending at 59 / 60 (no hand) / 61: out 25.0 / 27.3 / 27.3 px. my_name ending at 53 / 54 / 55 (no pose, no hand): out 28.7 px. Also every trim start with every 3rd end (clips ≥ 7 frames) of the three fixture signs, 5 ms windows: 345 / 759 / 442 trims, worst 57.4 / 49.7 / 46.5 px. Also a synthetic far pose where the 700 ms cap would exceed the limit, and auto-trim on synthetic and fixture frames. |
| Bulk-report measurement, 6 extractions of hello.webm: 0 of 6 over the limit | 6 fresh extractions on Avatar clips (auto-trim now 19..49 in 5, 19..48 in 1), in the 3-sign sentence of the talk check: **0 of 6 over 60**, worst 49.7 px. The 6 extractions captured before the change: also 0 of 6, worst 49.7 px (49.8 px when they keep their old trims, so only the play-time fix acts). The same 12 extractions with the committed code and their old trims: 1 of 12 over 60 on the old check's windows (134.6 px), and **12 of 12** over 60 when every window is measured (up to 151.8 px). |
| `talk-avatar-check.mjs` passes 5 runs out of 5 | 5 of 5, 26 PASS / 0 FAIL each. Transitions 618 / 532 / 250 / 400 ms, worst 45.6 / 49.7 / 34.7 / 28.7 px, identical in every run. |
| All avatar tests | `tests/avatar/*.test.mjs`: 36 pass, 0 fail. `avatar-math.test.mjs` is unchanged and passes. Its second blend went from 39.3 px / 303 ms to 5.7 px / 250 ms because a sub-clip edge is now skipped. |
| `admin-check.mjs`, `import-check.mjs` | 22 PASS / 0 FAIL, 31 PASS / 0 FAIL. |
| Node suite (`node --test --test-concurrency=1 tests/*/*.test.mjs`) | 303 tests, 302 pass, 0 fail, 1 skip (was 295 / 294 / 1). |

Auto-trim: all 12 hello extractions start on frame 19 (before: 17 in 8, 18 in 3, 19 in 1). The owner's
sample `my_name_is.avatar.json` keeps 31..221; how_are_you and my_name keep 9..58 and 0..53.

The 700 ms cap change rests on this measurement: the path estimate is conservative. Over 356 rest ↔ frame
transitions of the fixture, the measured peak was 0.82–0.998 of the estimate.

Not run: the bulk importer's browser checks (`avatar-step-check.mjs`, `candidates-panel-check.mjs`). Their
candidates go through the same `autoTrim()`, and `core.test.mjs` (in the node suite) passes.

## 5. Process notes

- Apache and MariaDB were not running; I started them from `C:\xampp` (same as the Control Panel's
  start scripts). They are still running.
- The browser checks rewrite tracked screenshots under `docs/reports/img/`. I restored them with
  `git checkout` because this phase changes nothing visible.
- No zz probes left: 0 `zz_` folders under `saved_gestures`.
- Code and docs are in two separate commits. Nothing was pushed or merged.

## 6. Files

- **Code commit:** `js/avatar-timeline.js`, `js/avatar-retarget.js`, `js/avatar-clip.js`,
  `tests/avatar/avatar-edges.test.mjs`, `tests/avatar/fixtures/holistic-signs.json`,
  `tests/avatar/talk-avatar-check.mjs`.
- **Docs commit:** `docs/system/DEBT.md` (124 resolved), `DECISIONS.md`, `UI.md`, `INVENTORY.md`, this report.
