# Manual checks — Phase 3a

Run these in your own Chrome at http://localhost/SKR/, window sized to
1024×600 (DevTools responsive mode). Tick each box and paste this file back.
Only covers what browser automation couldn't verify or verified unreliably —
everything else (gesture-training.html's layout, the Vosk defer fix, the
script defer changes, the prefetch fix) is already confirmed and not repeated
here.

## Layout at 1024×600

- [ ] `index.html` — just load it — dashboard renders full width, all 4 cards,
      each with a caption beneath its label, visible, no horizontal scrollbar,
      nothing cut off.
- [ ] Stand in front of the real Pi at the distance it will actually be used —
      arm's length, standing. Can you read the card captions ("Practise FSL",
      "Talk with someone")? 17px renders at 2.5 mm on this panel. If you have
      to work at it, raise the caption to 19px and re-check.
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

## "Let's Talk" conversation (`talk.html`)

UI-only, fake data — no microphone or real speech recognition exists yet (the
signing screen became real on 2026-09-21; see the section at the end).
Everything below was verified with automation (DOM measurement, real click
simulation, and visual screenshots at an emulated 1024×600 viewport), not a
physical finger on a physical Pi touchscreen. Load it directly at
`http://localhost/SKR/talk.html` — it is not linked from the dashboard yet.

- [ ] `[UNBLOCKED 2026-09-21 — the signing screen is real now; see the "Signing screen merge" section below]` Walk the whole happy path
      with a real finger on a real touchscreen (or the closest available touch
      device): "Who speaks first?" → tap Sign Language → tap "Stop & Add to
      Conversation" → confirm card appears → tap "Add to Conversation" → you
      land on the thread screen with your message visible → tap "Speak or
      Type" → type a real message → tap Send → confirm → tap "Add to
      Conversation" again → both messages visible, newest at the bottom.
      Expected: every tap lands on the control it visually appears to be on —
      no dead zones, nothing requires a second tap.
- [ ] On the Speak or Type screen, tap the text field. Expected: the
      keyboard rises from the bottom with no visible lag, the microphone
      button and its label disappear, the text field and Send button stay
      fully above the keyboard's top edge.
- [ ] Type a full sentence using only the on-screen keyboard (no physical
      keyboard). Expected: every key registers exactly once per tap, CLEAR
      empties the field, BACK deletes one character, HIDE closes the
      keyboard.
- [ ] Tap HIDE (or tap outside the keyboard). Expected: the microphone
      button, its label, and the text field/Send button return to exactly
      where they were before the keyboard opened — no visible jump.
- [ ] While the keyboard is open, look at the header's top-right corner.
      Expected: an orange "TYPING" pill is visible; it disappears once the
      keyboard closes.
- [ ] On the thread screen, tap "Sign" for a second turn, then tap the
      header's Back button. Expected: you return to the thread screen with
      your existing messages still visible — not to "Who speaks first?".
- [ ] Open a conversation, get to the confirm card (tap Stop & Add, or the
      fake mic button, or Send), then leave the kiosk untouched for a full 2
      minutes. Expected: the confirm card's content is still there and
      unchanged when you return — it must not have been silently replaced by
      the "Still there?" idle card.
- [ ] Separately, leave any other screen untouched for 2 minutes. Expected:
      a "Still there?" card appears with a counting-down number; tapping
      Continue dismisses it and the count does not appear again for another
      2 minutes of activity; letting the countdown reach zero with no input
      sends you back to the dashboard.
- [ ] From the thread screen (with at least one message sent), tap "End
      Conversation". Expected: you land back on the dashboard, and reopening
      `talk.html` afterward starts a fresh, empty conversation — nothing
      from the ended conversation is visible.
- [ ] Send 31+ messages in one conversation (alternate Sign/Speak or Type
      quickly to build up a long thread). Expected: the thread never shows
      more than roughly 30 messages, it stays scrolled to the newest one you
      just added, and the kiosk does not visibly slow down or stutter as the
      thread grows.

## Signing screen merge — real camera in `talk.html` (2026-09-21)

The signing screen in `talk.html` now runs the real camera and recognition
(`js/talk-signing.js`), fed by a background loading queue (`js/talk-loader.js`).
Automation (real Chrome + a fake camera device over CDP) measured everything
that can be measured without a physical camera or a Pi — see
`docs/system/UI.md` Part 3a and `docs/system/DECISIONS.md`. What follows
needs a person, a real webcam, and ideally the Pi. **Hard-reload first**
(Ctrl+Shift+R, or clear Chromium's cache once on the Pi): `talk.html` and
`css/`/`js/` carry no version string, and Chromium served a stale `talk.html`
during testing (`docs/system/DEBT.md` item 41).

- [ ] **THE camera-release check.** Open `talk.html`, tap Sign Language → Start
      Translating → allow the camera. The camera-in-use indicator (the
      webcam's LED, and Chromium's tab indicator) comes on. Tap **Back**.
      Expected: the LED and the tab's camera indicator go **off within about a
      second**, and stay off while you use Speak or Type. Tap Sign again from
      the thread: it comes back on. Repeat 10 times. (Automation proved every
      track ends, `stream.active` is false and the MediaPipe frame loop
      stops — it cannot see a physical LED.)
- [ ] After "Add to Conversation" from a signed turn, the camera indicator is
      off on the thread screen.
- [ ] Re-entry speed: from the thread screen, tap Sign. Expected: the live
      camera is up in about a second, with no Guide and no "AI is getting
      ready" wait. (Dev machine, fake camera: 66–250 ms.)
- [ ] Real recognition: at the Guide tap Start Translating, sign the "start"
      gesture and hold it. Expected: "Starting in 3…", then the button reads
      "Stop & Add to Conversation" and the frame outlines green. Sign two
      trained words with a short pause between; the words appear in the pill
      at the top of the camera. Tap **Stop & Add to Conversation**. Expected:
      the confirm card shows a sensible sentence. **The "stop" gesture will not
      work — neither ESL nor FSL has one recorded** (`DEBT.md` item 45).
- [ ] ESL/FSL chips: tap FSL Mode. Expected: "AI is switching language…" for a
      moment, then FSL words are recognised; tap ESL Mode to switch back.
- [ ] Hand Guide toggle: tap it. Expected: the green skeleton disappears and
      the chip reads "Hand Guide: Off"; tap again, it returns.
- [ ] Loading queue feel on the Pi. Open `talk.html?devqueue`, and, straight
      away, tap Sign Language. Expected: the Guide's "Start Translating →" stays
      greyed with "Getting ready… N of 5" until all five overlay lines read
      done, then enables. Write down the per-line ms next to the dev-machine
      numbers (sign libs 168–327, MediaPipe 245–505, gestures 10–1269 depending
      on whether the k-NN was cached, Vosk library ~80, Vosk model 999–3438).
      If the Vosk model takes long enough that you would give up waiting, that
      is worth knowing: Sign is held for it by design.
- [ ] Same, but tap Speak or Type first. Expected: "Getting ready…" replaces
      the mic and text field, then they appear. Choose Sign after that: the
      Guide's button is already enabled.
- [ ] Guide on a later turn: send one spoken/typed message first, then tap
      Sign. Expected: the Guide still appears (first time in Sign), and its
      step list scrolls inside the card (only about one step is visible at a
      time in that case, with the fade cue) — check it is still readable.
- [ ] `talk.html` with **no** `?devqueue`: no overlay text appears anywhere.
- [ ] Long conversation on the Pi: alternate Sign and Speak or Type for 15+
      turns without ending the conversation. Watch memory (`top`/Task
      Manager) for Chromium. Expected: it plateaus rather than climbing every
      turn. This is the crash risk the spec flags — page reloads used to be
      the cleanup.
- [ ] Idle warning while signing: leave the kiosk untouched for 2 minutes with
      your hands in view of the camera. Expected (known limitation,
      `DEBT.md` item 46): "Still there?" appears anyway.
- [ ] Failure card: temporarily rename `models/vosk-model-small-en-us-0.15.tar.gz.zip`,
      hard-reload, open Sign Language (it still works), then Back and Speak or
      Type. Expected: a "Microphone not available / Type instead" card, once. (The mic button on that screen is still the
      canned stand-in this phase — it will still produce a made-up "You said"
      bubble; only typing is real. That is the known state, not a new bug.)
      Rename the file back afterwards.
- [ ] Failure card: with the camera unplugged or blocked, tap Start
      Translating. Expected: "Camera not available / Go back".
