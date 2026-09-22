# Gesture training — multi-sample recording, made fast on the Pi

## Why

The owner's read of `gesture-training.html`'s "Add Data" step (Step 1 of
the 4-step Add Data → Train AI → Predict → Translate wizard) was that it
only allows **one recording per word** — record "hello" once, and that's
the only sample the classifier ever sees for "hello". If true, that would
cap recognition accuracy hard, since the classifier is a cosine-similarity
k-NN (`docs/system/DECISIONS.md`, top of file) — a k-NN's accuracy comes
directly from having enough reference samples per class to absorb the
inevitable jitter in a live hand-tracking feed on the Pi.

This spec is what the code actually does, checked line by line, not the
assumed shape — and the answer changes what work is actually needed.

## What's actually true (checked, not assumed)

**Multi-sample recording already works end to end. There is no one-
sample-per-word limit anywhere in the stack:**

- `js/gesture-data.js:658-661` — a saved word's data is already
  `gestures[label]`, an **array** of samples, iterated with `.forEach()`.
  Not a single record.
- `php/api/save_gesture.php:195-208` (`save_gesture_recording_to_db`) —
  every save does a plain `INSERT` into `gesture_recordings` (no
  `ON DUPLICATE KEY UPDATE`, no dedup). Saving "hello" five times creates
  five rows. The word itself (`gestures` table, `save_gesture_word_to_db`,
  line 69-92) does use `ON DUPLICATE KEY UPDATE` — so the *word* entry is
  reused, but every *recording* under it is additive.
- `js/gesture-training-ui.js` — nothing clears `#gestureLabelInput`'s
  value after a save (`confirmAndSave()`, `js/gesture-data.js:527-579`,
  only resets the internal `state.label`/`state.frames`, never touches the
  DOM input). The label field stays filled with "hello" after a save, so
  recording it again right now needs no retyping — press Record, then
  Record again.
- `renderSavedDataset()` (`js/gesture-training-ui.js:204-233`) already
  computes and displays a **Samples** column (`samples.length`) per label
  — the count exists today. It's just not shown *during* Step 1's
  recording loop, only in the dataset table elsewhere in the UI.

**So the 4-step wizard shape (Add Data → Train AI → Predict → Translate)
is not the problem and does not need to change.** The gap is narrower and
entirely inside Step 1: nothing in the recording loop tells the person
recording that saving again under the same word *adds* a sample rather
than needing a new word, shows how many samples that word already has, or
suggests how many are enough. The owner's "one record per word" read is a
real, reasonable conclusion to draw from the current screen — the feature
is there, but invisible.

**The actual Raspberry Pi cost problem is real, and it's not capture —
it's video re-encoding on every single save.** `php/api/save_gesture.php:
513-537`: every save that includes a video blob runs a synchronous
`exec()` call to ffmpeg (`-vf scale=360:-2 -c:v libx264 ... -r 25 -an
-b:v 300k`), and the PHP request blocks on it. Two things make this worse
than it needs to be for exactly the "record several samples of one word"
workflow this spec is about:
1. **The video file is per *label*, not per *sample*** —
   `$videoFilename = $label . '.mp4'` (line 517-518), written with `-y`
   (force overwrite). Recording "hello" five times encodes five times but
   only the fifth video ever survives; the first four transcodes are
   thrown away. Every sample after the first pays a full ffmpeg cost for
   nothing.
2. **Training never touches the video.** `trainModel()` /
   `mergeSavedGestureSamples()` (`js/gesture-training-ui.js:356-565`) work
   entirely off landmark data — no `video`/`Video` reference anywhere in
   that range. The classifier doesn't need the video at all; it's a
   preview/display asset only.

   **Correction (plan phase, 2026-09-22):** the parenthetical above —
   "the same `.mp4` the sign-video player reads elsewhere in the app" —
   is wrong, checked during planning. `js/sign-player.js:255,378,411`
   (the only sign-video player in the app) reads `<label>.webm` and never
   references `.mp4` anywhere in the file. The only reader of the `.mp4`
   this endpoint writes is `php/api/reports.php:30-53` (Reports →
   ESL/FSL Signs tab's "View Asset" button). `assets/signs/en/` holds 120
   `.webm` files and zero `.mp4` files (measured). This does not change
   the spec's conclusion (the transcode is still a real, measurable,
   redundant cost worth cutting) but the display-consumer claim it used
   to justify "which take should be kept" was incorrect; see
   `docs/system/DEBT.md` item 62 and `docs/system/DECISIONS.md`.

So encouraging multiple samples per word, as this spec proposes, is
currently multiplying a real, measured-as-real (ffmpeg is a known-slow
step, not assumed) per-save cost by however many times someone re-records
— on the weakest CPU in this whole project. That's the actual "how do we
make it fast for the Pi" question, and it has a specific, narrow answer:
stop re-encoding video for samples that aren't going to keep their video
anyway.

## Scope

In:
- Step 1 UX: show the current word's saved-sample count live, and make
  "record another sample of this word" the obvious next action after a
  successful save (not "notice the field is still filled and press Record
  again" as it is today).
- A soft recommended sample count, stated with the reasoning (k-NN
  benefits from more reference vectors under jitter), not a hard cap.
- Backend: skip the ffmpeg transcode for a save that isn't going to keep
  its video — the exact rule (e.g. "transcode only when a label has no
  existing video yet" vs. "let the person mark which take is the display
  take") is a plan-time decision, not this spec's to settle blind; see
  Open questions.

Out:
- No change to the 4-step wizard shape or step order.
- No change to the k-NN classifier itself (`cosineSimilarity`/
  `knnPredict`, `js/gesture-training-ui.js:270-322`) or to
  `trainModel()`'s merge logic — this spec is about getting more, better
  samples in, not changing how they're scored.
- No change to Step 2/3/4 (Train AI, Predict, Translate).
- Hardware-accelerated encoding (`h264_v4l2m2m` instead of `libx264`, to
  use the Pi 4's VideoCore VI encode block) is **not** committed to here —
  it's listed as a plan-time investigation item, because it needs
  measuring on real Pi hardware, not assumed from reading code on a
  Windows dev machine.
- The video-upload/"Upload & Process Video" gap (`docs/system/DEBT.md`
  item 26) is explicitly separate, already tracked as its own planned
  redesign item — this spec does not fold it in.

## Recommended direction

1. **Surface the sample count and a quick re-record loop in Step 1.**
   After a successful save, show "`<label>` — N sample(s) saved" and offer
   "Record another sample of `<label>`" as the primary next action,
   alongside the existing path to move to a new word. This uses data the
   app already computes (`renderSavedDataset()`'s `samples.length`) — no
   new data plumbing, just surfacing it where the decision is actually
   made.
2. **State a soft target, not a hard rule.** Something like "aim for
   5-8 samples per word for steadier recognition" — a suggestion, not a
   gate; the person can move on with 1 if they choose to. Exact number is
   a plan-time call, informed by how the k-NN currently weighs neighbours
   (`knnPredict`, `js/gesture-training-ui.js:281-322` — read this before
   picking a number, don't invent one).
3. **Stop paying the ffmpeg cost on samples that don't keep their video.**
   Concretely: only run the transcode in `save_gesture.php` when the label
   has no video asset yet (first sample for a new word), and skip it for
   every subsequent sample of the same word — landmark data still saves
   normally every time; only the redundant video re-encode is cut. If the
   person later wants to pick a *better* take as the display video (not
   just "whichever was recorded first"), that's a real, separate UX
   question — flagged below as an open question, not decided here.

## Open questions (plan-time, not this spec's to guess at)

- Should the display video always be "first take", or should there be an
  explicit "use this take as the display clip" action so a bad first
  recording isn't stuck as the permanent preview? Either is defensible;
  needs the owner's call once the trade-off is in front of them, not an
  assumption baked into a REVISE.
- Actual ffmpeg transcode duration on the target Pi 4B — this spec treats
  "it's slow enough to matter" as established (it's a synchronous `exec()`
  of a real video encode, not a cheap operation by nature), but the exact
  number needs measuring, and only on real hardware is it the number that
  matters for this app; a dev-machine measurement is a baseline, not a
  substitute.
- Whether `h264_v4l2m2m` (Pi 4's hardware H.264 encoder) is available and
  usable via the vendored `ffmpeg` build already in this repo
  (`docs/system/DEBT.md` line 734 — `ffmpeg.exe` is vendored for Windows;
  the Pi's own ffmpeg install is a separate question) — worth checking,
  not worth assuming either way.

## Testing scope

Automated (measured, cited):
- Recording the same label twice in one session (no page reload) adds a
  second row under that label — `gestures[label].length` before vs. after.
- The label field's value is unchanged after a successful save (already
  true today — regression-guard it, don't let a UX change accidentally
  start clearing it).
- Saving a second sample of an existing label does not call the ffmpeg
  path — assert via a stubbed/mocked save endpoint or a request-count
  check, not by reading logs after the fact.
- `git diff --stat` matches exactly whatever files the implementation
  touches — named explicitly in the plan, not "gesture-training.html and
  friends".

Manual (`docs/system/MANUAL-CHECKS.md`, new section — needs the real Pi):
- Record 5+ samples of one word back to back on the Pi; confirm the flow
  feels meaningfully faster than today's per-save ffmpeg wait once the
  transcode-skip ships.
- Confirm the display video for that word is still a real, usable clip
  (not blank/corrupt) after multiple samples were recorded.
- Recognition accuracy, subjectively, on a word recorded 1× vs. the same
  word re-recorded 5-8×, using Predict (Step 3) — this is the actual
  payoff the whole spec is for; someone needs to feel the difference.

## Self-review

- Placeholder scan: none — the "how many samples" and "which take is the
  display video" questions are explicitly marked open/plan-time rather
  than papered over with a made-up number.
- Internal consistency: the Pi-speed section and the Scope/Recommended
  sections agree — the fix is "skip redundant encodes," not "encode
  faster" or "encode less often for a different reason."
- Scope check: single concern (Step 1 multi-sample UX + its Pi-side cost),
  doesn't drag in Steps 2-4 or the classifier itself.
- Ambiguity check: every number in this doc is either cited from code or
  explicitly flagged as needing a plan-time decision/measurement — none
  are invented.
