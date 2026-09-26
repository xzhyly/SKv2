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
- [ ] ~~`index.html?screen=voice`~~ (superseded, see the note under "Voice screen keyboard") — just load it — mic button, EN/Filipino
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

*Superseded 2026-09-21: `#translator-pane` and its `?screen=voice` entry point were retired (commit `c94d62c`); `?screen=voice` now loads the plain dashboard. The keyboard on the Speak or Type screen is checked in the "Text-to-sign merge" section at the end.*

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

## Gesture training multi-sample (2026-09-22)

`docs/superpowers/plans/2026-09-22-gesture-training-multi-sample.md` (commits
`491b4fa`, `5f9918d`, `e825111`, `1690cae`). Everything below needs the real
Pi — every number in the plan and in `docs/system/DECISIONS.md`/`DEBT.md`
item 63 for this phase was measured on the dev machine (AMD Ryzen 5 2400G),
which is not the Pi's CPU; treat all dev-machine numbers quoted here as a
baseline for comparison, not a substitute for the Pi's own numbers.

- [ ] **Per-save wait, before vs. after, on the Pi.** Record 5+ samples of
      one word back to back and note the perceived per-save wait. Ideally do
      this once on the commit before this phase (`ce46fff`) and once on the
      current `HEAD`, for a like-for-like comparison — this phase's own dev
      machine measurements (for context only, not the Pi's numbers):
      ffmpeg runs per 5-take session, 5 → 1 (`measure-session.mjs`, Task 1
      baseline vs. Task 2 fix); post-save reload, 2 synced dataset fetches →
      1 unsynced fetch, `{ms: 5326, fetches: 2}` → `{ms: 4515, fetches: 1}`
      (Task 5, measured with `performance.getEntriesByType('resource')` in
      Chrome — see `docs/system/DEBT.md` item 63 for the full before/after
      and the honest caveat that this is only a ~15% wall-clock win, not a
      halving, because most of the remaining time is client-side JSON
      parsing of a still-~5.6 MB payload).
- [ ] **The word's display clip is still a real, playable file after several
      re-recordings.** Record a word 3-5 times, then open
      `assets/signs/en/<word>.mp4` (or `.webm`, whichever exists) directly,
      and separately check it via Reports → ESL/FSL Signs → View Asset.
      Expected: a normal, playable clip of the first take — not blank,
      corrupt, or the file it was on sample 1 unexpectedly overwritten by a
      later, worse take (only the first take is ever kept, by design; see
      `docs/system/DECISIONS.md`, "Display-take policy is A").
- [ ] **Subjective Predict (Step 3) accuracy, one recording vs. several,
      after pressing Train AI again.** Record one word once, another word
      5-8 times, press **Train AI** (Step 2) again (required — see
      `docs/system/DECISIONS.md`, the `localStorage.removeItem` note), then
      use Predict (Step 3) on both. Note, subjectively, whether the
      many-times word is recognised more reliably under hand jitter than the
      once-recorded word. Separately, with one word recorded 8× sitting
      beside several others recorded once each, watch for any single word
      that "steals" predictions it shouldn't win — this is the pool-size bias
      finding 1 predicts by construction (a label with many more frames in
      its pool has a systematically higher top-5 cosine mean), but its
      magnitude has never been measured. This whole item is unmeasured
      before this check; write down what you actually observe, don't assume
      the bias is either negligible or severe.
- [ ] **Pi ffmpeg facts (exact commands — record the raw output verbatim):**
      ```
      which ffmpeg
      ffmpeg -version | head -1
      ffmpeg -hide_banner -encoders | grep -E "libx264|v4l2m2m"
      ```
      If ffmpeg is installed, also time an actual transcode with the exact
      flags `save_gesture.php` uses:
      ```
      time ffmpeg -i <a 320x240 sample>.webm -vf scale=360:-2 -c:v libx264 \
        -pix_fmt yuv420p -profile:v baseline -level 3.0 -r 25 -an -b:v 300k \
        out.mp4 -y
      ```
      and, only if `h264_v4l2m2m` appeared in the `-encoders` grep above (the
      Pi 4's hardware H.264 encoder), the same command with
      `-c:v h264_v4l2m2m -b:v 300k` in place of the `libx264` flags (drop
      `-profile:v`/`-level` first and see whether it even accepts them).
      Record the times as the real Pi baseline — none of the ffmpeg timings
      in this phase's plan or docs (257.6/273.9/356.5 ms synthetic-input
      min/median/max over 7 runs; 219.9–325 ms for the stock clips) are Pi
      numbers; they are dev-machine numbers only. Hardware encoding is **not
      adopted** in this phase regardless of what this check finds — after the
      transcode-skip fix, only a word's first-ever sample is transcoded at
      all, which shrinks the payoff of switching encoders further. Whether
      ffmpeg is installed on the Pi at all, and whether its build was
      compiled with `v4l2m2m` support, is unknown until this check is run.

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

## Text-to-sign merge — the real Speak or Type screen (2026-09-21)

`talk.html`'s Speak or Type screen now has a real microphone (Vosk) and a word-by-word sign-video preview
(`js/talk-speaking.js`, `js/sign-player.js`); the fake mic stand-in is gone. Automation (real Chrome, a
synthesized-speech WAV as the fake microphone, CDP) measured timing, the fallback chain, gating, layout and
idempotency — see `docs/system/UI.md` Part 3b. Everything below needs a person, real audio hardware, and ideally
the Pi. **Hard-reload first** (Ctrl+Shift+R, or clear Chromium's cache once on the Pi): `talk.html` and `js/` carry
no version string (`docs/system/DEBT.md` item 41).

- [ ] **Real speech on this machine's microphone.** Load `http://localhost/SKR/talk.html`, wait for the loading
      queue, tap Speak or Type, tap the mic, say "hello, how are you", tap the mic again. Expected: the words
      appear in the text field as you speak, and after you stop the field reads about "Hello, how are you." (the
      English model is small — note what it actually wrote and where it went wrong; a couple of wrong words is the
      model, not a bug). The browser's microphone indicator goes **off** as soon as you stop.
- [ ] **Translate.** With that text (or any typed text) tap **Translate**. Expected: the mic/chips/text rows are
      replaced in place by the sign frame, and the words play one after another with the current word shown
      under the frame. Nothing plays until you tap Translate, and Translate stays greyed while the field is empty
      or the mic is still recording.
- [ ] **The sign video is legible at kiosk viewing distance.** Stand where a person at the kiosk stands (arm's
      length) and watch a whole sentence: can you read the hand shapes? The clips are small (words are 360×202,
      letters 360×640, shown inside a 560×260 frame — `DEBT.md` item 57), so this is the check that matters. Note
      the fingerspelled letters too (type "xyz").
- [ ] **Edit and Send.** In the preview tap **Edit**: back to the text field with your text intact and playback
      stopped. Translate again, then tap **Send** while it is still playing: the confirm card shows exactly the
      text, nothing plays behind it, and after Add to Conversation the thread shows the **text only** — no video,
      no image.
- [ ] **Leaving stops everything.** Start a preview, tap the header **Back** (from a conversation that already
      has a message): the video stops at once. Start the mic, then tap Back: the microphone indicator goes off.
- [ ] **Filipino does not crash anything.** Tap the **Filipino** chip. Expected: the mic greys out and reads
      "Voice input disabled in Filipino" (the speech model is English-only by design — `DEBT.md` item 53), typing
      still works, and Translate plays clips from the Filipino folder (try "kamusta"). An unknown Filipino word
      (try "xyz") plays **nothing** — Filipino has no fingerspelling clips (`DEBT.md` item 56); that is the known
      state. Tap **English** and the mic comes back.
- [ ] **A word with no sign.** Type a single symbol such as `@` and Translate: a grey "?" tile shows for about a
      second (the placeholder `fallback.png`, `DEBT.md` item 55).
- [ ] **The Pi's USB microphone.** On the Pi, with the USB mic plugged in (label contains "AB13X" or "USB
      Audio"), tap the mic twice on the first visit (the first tap grants permission, after which the label is
      readable). Expected: the USB mic is used from then on without anyone choosing it. The old mic dropdown is
      not ported; if the wrong mic is used, that is what to report.
- [ ] **Tapping the text field raises the keyboard and it STAYS up (known issue, `DEBT.md` item 54).** Tap the
      text field with a finger. Expected: the on-screen keyboard rises, the chips and mic disappear, and it stays.
      Automation reproduced the opposite (it rises and is hidden again by the same tap) with a real mouse click
      and with emulated touch; on the real touchscreen this decides whether typing works at all, so please
      confirm it first.
- [ ] **Many turns.** Alternate Sign and Speak or Type for 15+ turns, sometimes previewing, sometimes editing,
      sometimes leaving mid-preview. Watch Chromium's memory (`top` / Task Manager). Expected: it plateaus.

## Gesture categorization — grouped dataset table (2026-09-23)

Owner check for `gesture-training.html` Step 1 (see `docs/system/UI.md` and
`docs/system/DECISIONS.md`, "Decisions made during the gesture-categorization
phase").

- [ ] **Is the tabbed Step 1 dataset modal easier to scan than the flat
      list it replaces?** (Updated 2026-09-24: tabs Words · Letters ·
      Numbers · Phrases plus a search box replaced the section headers.) Open
      Step 1 → View Active Gesture Dataset with a real dataset loaded (200+
      labels). Find a specific word by tab and by searching. This is a
      judgment call, not a pass/fail.
- [ ] **Search on the touchscreen.** On the kiosk, tap the search box.
      Expected: the on-screen keyboard opens *above* the modal (not hidden
      behind it), the modal stays readable above the keyboard, and typing
      filters the active tab live; HIDE closes the keyboard.
- [ ] **Type preselects for an existing label.** Type an existing label's
      name (e.g. a known letter or phrase) into Gesture Name with Sign Set
      matching where it's saved. Expected: the Type control jumps to that
      label's stored category, not just the heuristic's guess (try a label
      you know was manually re-tagged away from its heuristic guess, if one
      exists).
- [ ] **Re-tag via Type + Save.** Pick an existing label, manually tap a
      different Type, and save a new sample. Expected: the label moves to
      the new group in the dataset table after it reloads, and re-typing the
      same label afterward preselects the new Type (not the old one).
- [ ] **1024×600: Start Capture stays visible.** At the kiosk viewport, open
      Step 1 with the Type row present. Expected: `#leftStep1` does not
      scroll off-screen and the Start Capture button is fully visible
      without scrolling, same as before the Type row was added.

## Video-based gesture capture — record, review, extract (2026-09-26)

Owner check for `gesture-training.html` Step 1 after the video-capture phase
(`docs/reports/2026-09-26-video-capture-final.md`). Automated runs used a fake
camera fed from `assets/signs/en/hello.webm`; this check is the first run with a
real person signing in front of a real camera.

- [ ] **Record one real sign with your own camera and confirm the 3 saved
      samples.** Open `http://localhost/SKR/gesture-training.html`, enter the
      PIN, go to Step 1, enable the camera, type a new test word (e.g.
      `zz_owner_check`), pick the Sign Set and Type, and tap **Record 3
      samples** → **START**. After 3, 2, 1: keep your hands down until the
      prompt changes from **REST** to **SIGN 1 of 3**, sign once, lower your
      hands, and repeat for SIGN 2 and SIGN 3. Expected:
      - the prompt advances only when your hands appear and disappear, the dots
        fill in, and "Hand visible" / "No hand" follows your hands;
      - recording stops by itself about half a second after the third sign's
        rest, and Review shows your recording looping and "3 signs found";
      - **Save** shows "Processing… NN%", then "Saving 1 of 3…" to "3 of 3"
        with **no Cancel button** while saving, then the screen closes with
        "3 samples saved for “zz_owner_check”.";
      - `saved_gestures/zz_owner_check/` (or `saved_gestures_fsl/…`) now holds
        exactly 3 new `sample_*.json` files, each with `"formatVersion":3`,
        `"source":"video-live"` and `"repIndex"` 1, 2 and 3;
      - nothing new appeared in `assets/signs/en/` or `assets/signs/fil/`.
      Note how long Processing took and the recording length, for comparison
      with the laptop's measured 6,113 ms for an 11.9 s recording.
      Afterwards, delete `zz_owner_check` from View Active Gesture Dataset.
