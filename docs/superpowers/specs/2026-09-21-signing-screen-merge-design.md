# Signing screen merge: sign-to-text.html into talk.html

Date: 2026-09-21
Status: design, approved by owner in conversation. Not yet built.

## Why

`talk.html`'s signing screen is currently a UI-only placeholder (fake "HELLO"
bubble, canned confirm card) — deliberately left that way in Phase 4
(`docs/superpowers/plans/2026-09-16-talk-html.md`, `onEnterSigning()` /
`onLeaveSigning()` are empty stubs reserved for exactly this).

Before `talk.html` existed, the project had two separate pages —
`sign-to-text.html` and the text-to-sign voice screen inside `index.html`
(`#translator-pane`) — and switching between them meant a full page reload,
which reloaded every heavy library (TF.js, MediaPipe, Vosk) from scratch
each time. That reload is the "switching lag" the owner has flagged
repeatedly across this project. `talk.html` was built specifically to
replace that with a single document where screens are shown/hidden, not
reloaded. This phase is what makes the *signing* side of that real —
porting `sign-to-text.html`'s working camera UI into `talk.html`'s signing
screen instead of the fake placeholder.

## Scope

**In scope:**
- Port `sign-to-text.html`'s camera UI (video + skeleton overlay, ESL/FSL
  mode toggle, Hand Guide toggle, live prediction, Stop & Translate) into
  `talk.html`'s signing screen, replacing the fake placeholder.
- A background loading queue for the two heavy stacks (sign: TF.js +
  MediaPipe; speech: Vosk), started the moment `talk.html` loads.
- A Guide/waiting screen that gates entry to either live feature (camera or
  mic) until that queue finishes.
- A dev-only diagnostic overlay for the queue.
- Archiving `sign-to-text.html` once the merged version is verified working.

**Out of scope (flag, don't build):**
- `#translator-pane` inside `index.html` (the text-to-sign voice screen) and
  its own retirement — not raised by the owner, not decided here. Its
  header currently links to `sign-to-text.html` (`index.html:653`, "Translate
  Sign to Text") — once that page is archived, this link breaks. Needs the
  owner's call: remove the link, repoint it, or retire `#translator-pane`
  too. **Do not touch `#translator-pane` beyond this one link decision
  without a separate design.**
- `reports.html` / `gesture-training.html` — untouched, as already
  established project-wide.
- Any change to how gestures are trained or the FSL/ESL dataset itself.

## Architecture

One document (`talk.html`) stays one document. No `location.href` navigation
is added by this phase — the only existing real page loads in `talk.html`
remain End Conversation and the idle-timeout "End Now" (both already
`location.href = 'index.html'`, both unchanged).

`onEnterSigning()` / `onEnterSpeaking()` (currently empty, `talk.html:1051-
1057`) become where the ported logic attaches. Each is idempotent: calling
it a second time in the same conversation (user re-enters that screen) must
not re-init the camera, re-request `getUserMedia`, or create a second
MediaPipe instance — guard with a flag, matching the reason
`onEnterSigning`/`onEnterSpeaking` were written as "attach once, not on
every transition" in the first place (`docs/superpowers/plans/2026-09-16-
talk-html.md`).

## Loading queue

The moment `talk.html` loads (the "Who speaks first?" screen, before any
choice is made), both stacks start loading in the background:

1. Sign stack: `js/lib/tf.min.js`, `js/lib/mediapipe/hands.js`,
   `js/camera-helper.js`, `js/gesture-data.js` (same files
   `sign-to-text.html` already loads, confirmed via `sign-to-text.html:9-13`)
2. Speech stack: whatever `index.html`'s voice screen currently loads for
   Vosk (existing code, not new — Claude Code confirms the exact file list
   when writing the REVISE item, don't guess it here)

Queued, not parallel: start whichever is fastest first, the other after —
avoids asking the Pi 4B to init both at once. Exact ordering (which is
"fastest") is measured, not assumed — Claude Code's analysis records real
load times before deciding the order.

This is a one-time load per conversation, not per turn. A conversation that
alternates Sign → Speak → Sign only pays this cost once, at the very start.

## Guide / waiting screens

**Sign Language, first entry this conversation:** the existing 3-step Guide
card content (currently `sign-to-text.html:29-59`, "Sign to Text Guide")
carries over as-is. A loading label is visible on this card the whole time
the queue is still running. The "Start Translating →" button stays
disabled/loading until the ENTIRE queue (both stacks, not just sign) is
done — even if only Sign was picked, because the conversation may switch to
Speak later and by then it should already be ready too.

**Sign Language, turn 2+ this conversation:** no Guide card — straight to
the live camera, already loaded from turn 1.

**Speak or Type, first entry this conversation:** no 3-step guide (nothing
non-obvious to explain — tap mic or type). If the queue isn't done yet, a
lightweight "Getting ready…" state instead, same gate (can't reach the mic
UI until the full queue is done). Owner confirmed this asymmetry — Sign
keeps its real guide, Speak gets only the loading state.

**Idempotency note:** if the user leaves the Guide screen mid-load (taps
Back, or picks the other option) and comes back, the in-flight loading
promise is NOT restarted — it's the same one continuing in the background
(talk.html never unloads mid-conversation, so this just works as long as
the loading trigger only ever fires once per conversation, guarded by a
flag — see Architecture above).

## Dev-mode diagnostic overlay

Separate from the user-facing loading label above. Shows, one line per
model in the queue: name, status (queued / loading / done / failed), and on
failure, what failed and why (e.g. "MediaPipe: camera permission denied",
"Vosk: model file 404") — so the owner doesn't have to open devtools to see
what's stuck.

Gated behind a flag (exact mechanism — URL param, localStorage flag, or a
build-time constant — is Claude Code's call when writing the REVISE item).
Off by default; must be off for the real kiosk deployment. The user-facing
loading label (on the Guide card) is unaffected by this flag either way —
it's always visible, dev or production.

## Confirm flow

No separate Result screen (unlike `sign-to-text.html`'s `#tl-state-result`
with Speak/Copy/Clear/Save Log/Translate Again — those are dropped). Camera
→ user signs → Stop & Translate → straight into `talk.html`'s existing
confirm card pattern (recognized text + "Add to Conversation" / "Try
again") — the same one already built for the current fake flow, now fed
real text instead of canned "HELLO".

The header's "Translate Text to Sign" cross-link (the pattern
`sign-to-text.html` uses to jump to the other mode, causing a page reload)
is not carried over — there is no equivalent button in the merged signing
screen. Switching who's "talking" next is already handled by the thread
screen's own Sign / Speak-or-Type buttons (per `docs/system/DECISIONS.md`,
already the case for turn 2+).

## Retirement of sign-to-text.html

Only after the merged version is verified working:
- Archive `sign-to-text.html` (same treatment as
  `archive/camera-translator.html`, `docs/system/DEBT.md` item 30).
- No dashboard card links to it directly (confirmed — the 4 dashboard cards
  are `learn-signs.html`, `talk.html`, `gesture-training.html`,
  `reports.html`; `index.html:564-605`). The only link is the
  `#translator-pane` cross-link flagged under Out of scope above.

## Error handling

Camera/permission/model-load failures on the live signing screen reuse
whatever `sign-to-text.html` already does today (e.g. the "Hands not
visible" / "I cannot see your hands" hint pattern referenced in
`docs/ui-target/README.md:256`) — not redesigned here. Claude Code's
analysis should confirm exactly what error states already exist before
writing the REVISE item, rather than this spec inventing new ones.

## Testing scope

Manual, on the Pi if possible — this is real camera + AI, not fake data, so
it does not belong in `docs/system/MANUAL-CHECKS.md`'s automation-verified
category. New section for `docs/system/MANUAL-CHECKS.md` gets added when
this cycle's REPORT comes back, same as prior phases.

## Memory / crash risk — explicit flag, not new information

This is the phase `docs/superpowers/plans/2026-09-16-talk-html.md` warned
about: "page reloads are currently acting as crude memory cleanup... this
is the phase that could make it worse." A conversation can now hold a live
camera + MediaPipe + TF.js session open for its entire duration, opened and
paused repeatedly across turns without a page reload in between.
`onLeaveSigning()` must pause/stop the camera track cleanly without
destroying the loaded model (so re-entry is instant, per the loading-queue
section) — but must actually release the camera hardware lock (so the
browser's camera indicator doesn't stay on when the user isn't signing).
Getting this right is more important than any other single detail in this
phase.

## Self-review

- Placeholder scan: none found.
- Internal consistency: Guide/waiting section's "gate on the whole queue,
  not just the picked path" matches the Loading queue section's "one-time
  load per conversation" reasoning. Confirm flow section correctly drops
  the Result screen per the owner's explicit choice.
- Scope check: `#translator-pane` retirement correctly kept out — it's a
  separate decision the owner hasn't made.
- Ambiguity check: "fastest first" queue ordering is explicitly marked as
  measured-not-assumed, so it can't be misread as a fixed order.
