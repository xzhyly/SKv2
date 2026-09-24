# Text-to-sign merge — design

## Why

`index.html`'s `#translator-pane` ("TEXT TO SIGN — REDESIGNED PANE") is the
real, working counterpart to `sign-to-text.html`: mic or typed text goes
through real Vosk speech recognition and a real word-by-word sign-video
player (`js/script.js`'s `displaySignWithFallback` pipeline, `.webm` clips
under `assets/signs/en|fil/`, fingerspelling and image fallbacks). None of
this is in `talk.html` yet — its "Speak or Type" screen mic button is a
documented stand-in (`docs/system/DECISIONS.md`'s "two fake buttons" note),
wired to a canned confirm result, and there is no sign-video output there at
all.

`#translator-pane`'s own header also links to the now-archived
`sign-to-text.html` ("Translate Sign to Text") — a dead link since that
archive commit, logged as DEBT item 44 with no resolution picked. Porting
`#translator-pane`'s real functionality into `talk.html` and retiring the
pane finishes both: the fake mic gets replaced with real recognition, the
deaf/HOH party gets real sign-video output on the Speak or Type side, and
the dead link disappears because nothing points at it anymore.

This is the second and final half of "iisang document na lang" — after this,
every real translation feature (camera→text, voice/text→sign) lives inside
`talk.html`, and `index.html` goes back to being a pure dashboard.

## Scope

In scope:
- Real Vosk-backed speech-to-text on `talk.html`'s Speak or Type screen,
  replacing the fake mic stand-in.
- Real word-by-word sign-video output (reusing `js/script.js`'s existing
  lookup/playback pipeline), shown before the message is sent.
- Retiring `#translator-pane` and its `?screen=voice` entry point from
  `index.html` once the merged version is verified working.

Out of scope:
- Adding a Filipino Vosk model. The EN/Filipino toggle carries over as-is,
  including the existing English-only limitation (DEBT item 53). Not this
  cycle's job.
- Any change to the Sign Language (camera) side, the confirm-card pattern
  itself, or the thread/turn-taking mechanics — all untouched.
- `reports.html`, `gesture-training.html`: untouched, as always.

## Architecture

A new module, `js/talk-speaking.js` — same pattern as `js/talk-signing.js`
from the last phase — holds the Speak-or-Type screen's lifecycle: real mic
capture via Vosk, the transcript, and driving the sign-video sequence.

It reuses, rather than duplicates, `js/script.js`'s existing pipeline:
`displaySignWithFallback`, `findLongestKnownPhrase`, `displayMedia`,
`normalizeSpeechText`, `getSignAssetBase`, `getActiveSignMap`,
`getActiveKnownPhrases`, `getActiveLanguage`. `js/script.js` currently reads
`#sign-container`/`#current-word` at module scope on load (tied to
`index.html`'s markup) and mixes in dashboard/keyboard/mic-enumeration logic
that has no place in `talk.html`. Exactly how much of it is extracted into a
shared, DOM-agnostic module versus ported outright is an investigation item
for the plan (writing-plans), the same way the exact reuse of
`sign-to-text-ui.js` was investigated and cited last phase — not decided
here.

Vosk itself is already part of `talk-loader.js`'s background loading queue
(the "speech stack", already measured and gated behind the Guide/waiting
screen in the last phase). This phase wires the Speak or Type screen to use
that already-loading model for real recognition instead of ignoring it.

## Flow

`#screen-speaking` keeps its current compact, single-column shape. Nothing
about the screen's size or position in the stage changes.

1. User mics ("Tap to Speak", now real Vosk capture) or types into the
   existing text input. Transcript/text fills in live, same as today's
   input row.
2. User taps **Translate** — a new button, not auto-play. (`#translator-pane`
   used an explicit Translate button; keeping that pattern here rather than
   triggering on speech-end or a typing pause, which risks firing early on a
   slow talker/typist.)
3. The mic/input row is replaced in place by the sign-video panel (same
   column, same screen — no navigation, no second screen) and plays the
   composed text word-by-word, reusing the existing fallback chain (custom
   video → static asset map → fingerspelling → `fallback.png`).
4. Once the preview has played, the existing **Send → confirm card → Add to
   Conversation** flow proceeds completely unchanged. Only the text goes
   into the thread bubble — the sign-video preview is a pre-send step, not
   something stored or replayed from the thread.

This means the confirm-card pattern, the thread, and the turn-taking control
panel are not touched by this phase at all — the new work is entirely
contained inside `#screen-speaking`.

## Language toggle

The EN/Filipino chip UI carries over unchanged. The active language still
only affects the sign-asset folder (`assets/signs/en/` vs `/fil/`) and
`getActiveLanguage()`'s downstream lookups — it does not change what Vosk
model is loaded, which stays English-only. This is an accepted, pre-existing
limitation (DEBT item 53), not something this phase fixes.

## Retirement

Once the merged Speak or Type screen is verified working end to end, the
`#translator-pane` section, its `?screen=voice` entry point, and the
`welcome-btn` hidden-compatibility button in `index.html` are removed in
their own final commit — separate from the merge itself, matching how
`sign-to-text.html`'s archival was kept separate from its merge. This is
also the resolution to DEBT item 44: the dead "Translate Sign to Text" link
goes away because the pane it lived in is gone.

`js/script.js` itself is not deleted outright — investigate at plan time
whether anything in `index.html` (dashboard, keyboard handling) still needs
it after `#translator-pane` is removed, and cite what's still live before
deciding to trim or retire the file.

## Error handling

Reuse `#translator-pane`'s existing behavior for a failed/unmatched word
(fingerspelling fallback, then `fallback.png`) — no new error states to
design. Real Vosk failure/permission-denied handling on the mic side reuses
the same error-card patterns already established for the Sign Language
side's camera errors (`docs/ui-target/README.md`'s existing error handling
section) rather than inventing a second pattern.

## Testing scope

Same split as last phase — automated where DOM/timing can prove it, manual
where a human and real audio/hardware is required. Automated: sign-video
sequence timing and fallback-chain correctness for known/unknown words,
Translate button gating (disabled until there's a transcript or typed
text), `document.scrollWidth` staying 1024 in the new panel state, zero
console errors. Manual (new `docs/system/MANUAL-CHECKS.md` section, same
pattern as before): does real speech actually transcribe correctly on this
machine's mic, does the sign video look right at kiosk viewing distance,
does the Filipino toggle at least not crash anything given the known
English-only model.

## Self-review

- Placeholder scan: none — every open question (js/script.js's exact reuse
  mechanism, `js/script.js`'s post-retirement footprint) is explicitly
  flagged as a plan-time investigation item, not left vague.
- Internal consistency: the "no new screen, in-place panel swap" flow
  matches the "single column, progressive reveal" layout decision; the
  "text-only in thread" decision matches "confirm-card pattern untouched."
- Scope check: single screen (`#screen-speaking`) plus one retirement commit
  in `index.html` — same shape and size as the sign-to-text merge, fit for
  one implementation plan.
- Ambiguity check: "reuse `js/script.js`'s pipeline" could mean copy or
  extract-and-share — flagged explicitly as a plan-time decision rather than
  left ambiguous.
