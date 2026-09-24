# Manual checks — done

Verified items moved out of `MANUAL-CHECKS.md` so that file stays a clean,
pending-only list. This file is a log, not a checklist to re-run.

## Camera path — verified 2026-09-14

- [x] `sign-to-text.html` — click "Start Translating →", allow camera — live
      camera preview appears with a hand-skeleton overlay within a few
      seconds.
- [x] Same screen — show a trained gesture (e.g. "start") to the camera — a
      prediction label appears and updates.

Confirmed by the project owner: camera opens, hand skeleton overlays, trained
gestures produce prediction labels. Working.

## Voice screen — verified 2026-09-14

- [x] `index.html` → click "Translate Text to Sign" → tap the mic → allow
      microphone — label briefly shows "Loading Offline AI Model..." then
      "Tap to Speak"; say a short word — recognized text appears and the
      screen switches to the result view.

Confirmed by the project owner: model loads on first mic tap (not on page
load), speech recognized correctly — "hello" and "hi" both transcribed. No
red console errors. Vosk's own verbose logging is present, as is a
pre-existing `ScriptProcessorNode` deprecation warning at `script.js:288`
(now `docs/system/DEBT.md` item 33) — neither is new to this phase.

## Note

`camera-translator.html` was removed from the pending list — archived to
`archive/camera-translator.html` (see `docs/system/DEBT.md` item 30). Its old
URL now 404s; nothing to check there.
