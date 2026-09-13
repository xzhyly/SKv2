# Manual checks — Phase 3a

Run these in your own Chrome at http://localhost/SKR/, window sized to
1024×600 (DevTools responsive mode). Tick each box and paste this file back.
Only covers what browser automation couldn't verify or verified unreliably —
everything else (gesture-training.html's layout, the Vosk defer fix, the
script defer changes, the prefetch fix) is already confirmed and not repeated
here.

## Layout at 1024×600

- [ ] `index.html` — just load it — dashboard renders full width, all 5 cards
      visible, no horizontal scrollbar, nothing cut off.
- [ ] `index.html?screen=voice` — just load it — mic button, EN/Filipino
      toggle, mic dropdown, and text input all visible without scrolling.
- [ ] `reports.html` — enter PIN `2026`, stay on ESL Signs tab — stat cards
      and all 3 tabs fully visible; scroll inside the table area — every row
      reachable, nothing permanently hidden.
- [ ] `sign-to-text.html` — just load it — onboarding guide text and the
      "Start Translating →" button both visible without scrolling.

`camera-translator.html` removed from this list — archived to
`archive/camera-translator.html` (see `docs/system/DEBT.md` item 30). Its old
URL now 404s; nothing to check there.

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
