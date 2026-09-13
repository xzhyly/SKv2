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
- [ ] `camera-translator.html` — just load it — Step 1 wizard (progress
      pills, instructions, Next button) renders fully, nothing cut off.
      (Buttons likely won't do anything when clicked — see next section.)

## Camera path

- [ ] `sign-to-text.html` — click "Start Translating →", allow camera — live
      camera preview appears with a hand-skeleton overlay within a few
      seconds.
- [ ] Same screen — show a trained gesture (e.g. "start") to the camera — a
      prediction label appears and updates.
- [ ] `camera-translator.html` — click "Enable Camera" on Step 1 — **expected:
      nothing happens** (matches a bug already found and logged in
      `docs/system/DEBT.md` item 30 — a missing `}` breaks the file's entire
      script). If the camera actually turns on, that contradicts the finding —
      tell me.
- [ ] `camera-translator.html?screen=translate` — just load it — **expected:
      no camera permission prompt appears** (same bug). If a prompt does
      appear, tell me — it would mean this code path isn't affected.

## Voice screen

- [ ] `index.html` → click "Translate Text to Sign" → tap the mic → allow
      microphone — label briefly shows "Loading Offline AI Model..." then
      "Tap to Speak"; say a short word — recognized text appears and the
      screen switches to the result view.
