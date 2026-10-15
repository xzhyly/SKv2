# Frozen fixtures (compact-model phase, 2026-10-15)

These files freeze today's data so that tests which pin numbers keep working after the
owner archives today's 122 signs and imports a new dataset. Tests that pin a number must
read these files, never live `saved_gestures/`.

| File | What | Source |
|---|---|---|
| `dataset-2026-10-15.json.gz` | The exact response of `GET php/api/save_gesture.php?no_sync=1` on 2026-10-15 (3,481,109 bytes before gzip): 122 signs, 127 samples (6 v3), with `signs` and `categories`. | Live endpoint, byte-identical to the Step 1 measurement. |
| `videos-2026-10-15.json.gz` | `{ "<sub>__<key>": { durationMs, frames } }`. `en__<key>` = the hand frames of `assets/signs/en/<key>.webm` (120 clips); `real__P_real` = the owner's one real test video (3 repetitions, sign unknown). Frames are the v3 shape `{ t, hands: [{ label, score, landmarks }] }`. Landmarks only, no images. | `VideoLandmarks.extractVideoLandmarks` through `tests/video-capture/extractor.page.html`, one run per clip (`.git/sdd/cm-step1/extract.mjs`). MediaPipe output varies slightly between runs, which is why it is frozen. |
| `expected-2026-10-15.json` | The Step 1 accuracy results for the `current` rule and the `budget90` rule (rows per model, T1/T2/T2 FSL/T2r counts by category, T3 top predictions) and the 5,010-query Float32 check count. | `.git/sdd/cm-step1/eval-results-h.json` and `-c.json`. |

Video keys `1`..`10` are the number signs `one`..`ten`. The test sets are described in
`docs/reports/2026-10-14-compact-model-step1.md`, section 2.2.
