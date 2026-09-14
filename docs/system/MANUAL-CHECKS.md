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
      *Superseded by the 1024×600 layout fixes below: at 1024×600 the guide's
      step list now scrolls inside the card on purpose, with a fade cue. Check
      it with the items in that section instead.*

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

---

# Manual checks — 1024×600 layout fixes

Automation measured every layout number in `docs/system/UI-SURVEY-1024x600.md`
from the live DOM, but it could not send a real click or touch: the
automation browser dispatches events and draws no frames. So for the items
below it proved only that the code path changed, not that a finger gets the
right result. Run them on the Pi's touchscreen if you can; otherwise use your
own Chrome at http://localhost/SKR/ sized to 1024×600, with DevTools →
Network → **Disable cache** ticked. `js/virtual-keyboard.js` and
`css/sign-to-text.css` carry no version string (`docs/system/DEBT.md` item
41), so a cached copy would test the old code. On the Pi, clear Chromium's
cache once after deploying.

## Voice screen keyboard (`index.html?screen=voice`)

- [ ] Tap the text box. Expected: the keyboard opens; the microphone button,
      "Tap to Speak", the English/Filipino toggle and "— OR —" disappear
      instantly; the MICROPHONE INPUT dropdown, the text box and Translate sit
      near the top, fully above the keyboard.
- [ ] Type something, then tap **Translate**. Expected: the translation runs,
      the keyboard closes, the speech controls come back. **Not:** the
      microphone starts.
- [ ] With the keyboard open, tap the **MICROPHONE INPUT** dropdown.
      Expected: the dropdown opens. (Note whether the keyboard also closes.
      Either is acceptable; it is recorded, not required.)
- [ ] Tap **Hide** on the keyboard, and separately tap an empty part of the
      page. Expected: each time the keyboard closes and every control returns
      to exactly where it was before typing, with no jump or drift.
- [ ] Speak a sentence, then tap the text box. Expected: the "You said: …"
      transcript stays visible above the text box while you type. (The text
      box itself is empty; that is `DEBT.md` item 36, known and not fixed.)

## Gesture training keyboard (`gesture-training.html`)

- [ ] PIN `2026`, go to Step 4 (needs a trained model), tap the Custom Sign
      Words box, type a word, tap **Add**. Expected: the word is added as a
      chip, the keyboard closes, nothing else happens.

## Sign-to-text guide (`sign-to-text.html`)

- [ ] Load the page. Expected: the Guide badge, title, description and
      "Start Translating →" are fully visible with clear space under the
      button; the step list's bottom edge visibly fades out.
- [ ] Swipe up inside the step list. Expected: it scrolls to step 3; the
      fade goes when you reach the end and returns when you scroll back up;
      the Start button does not move.
- [ ] Tap "Start Translating →". Expected: camera view opens, as before.

## Reports (`reports.html`, PIN `2026`)

- [ ] On each tab, look at the Created column. Expected: full timestamps
      including seconds, no "…".
- [ ] On FSL Signs, find a long key such as
      `wala_naman_mangyayari_kung_hindi_ko_susubukan`. Expected: the key pill,
      label and text wrap onto more lines instead of ending in "…"; rows with
      short text stay single-line.
