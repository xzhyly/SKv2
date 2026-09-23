# Decisions — talk.html ("Let's Talk")

One line per settled decision, with its reason. Seeded from
`docs/ui-target/README.md` before any code was written. Appended to as the
build proceeds — read this file before starting each task so it isn't
re-proposed or re-litigated.

## Seeded from docs/ui-target/README.md

- **talk.html is one document; screens are shown/hidden, the page never
  reloads between turns.** Reason: a full reload between every screen is the
  current lag; removing it is the entire point of this phase.
- **Every screen is fixed at 1024×600, not responsive, not a breakpoint.**
  Reason: the Pi's 7-inch touchscreen is the only device this ever runs on.
- **The header title never changes ("NEW CONVERSATION" pre-thread); it does
  not become a per-screen label.** Reason: the user is inside one continuous
  thing, not moving between four separate tools — that is the point of the
  redesign.
- **Status pill (LISTENING / TYPING) shows only when a real state exists, and
  LISTENING never shows while the keyboard is open.** Reason: nothing is
  listening while the keyboard is up; showing it would lie.
- **One orange element per screen, no exceptions.** Reason: stated as a hard
  rule — two orange elements means one of them is wrong.
- **Colours, radii, and font come only from the CSS custom properties already
  in the repo; no new values, no new font.** Reason: Inter is already
  self-hosted since Phase 2; inventing new values would fragment the palette.
- **Bubble convention: Deaf person's messages left, white, 1px border;
  hearing person's messages right, navy, white text — used on every screen
  that shows a bubble, not just the thread.** Reason: one convention users
  learn once.
- **Every bubble carries a `Signed · <time>` / `Spoken · <time>` label above
  it; not optional.** Reason: the label is how each person knows which
  direction a message came from.
- **White (signed) bubbles get a speaker icon, and new signed messages are
  spoken aloud automatically.** Reason: otherwise the hearing person has to
  stare at the kiosk screen to receive anything at all.
- **Navy (spoken) bubbles get a hand icon; tapping it replays that message as
  signs.** Reason: this is where the old "Translate Text to Sign" feature now
  lives — without it that feature was deleted rather than merged, and the
  Deaf user would be left to just read English.
- **The collapsed conversation strip is 96px while the camera (signing)
  screen is showing.** Reason: explicitly requested — the camera needs the
  space, but the thread must stay visible enough (most recent message +
  fade) so the signer isn't cut off from what's already been said.
- **End Conversation is a real page load back to `index.html`, not a hide.**
  Reason: explicitly requested — today's full-page reloads are acting as
  crude memory cleanup, and the cause of the reported crash is unknown;
  removing every reload would remove that safety net along with the lag, so
  one real reload is kept at the one point (end of conversation) where it's
  cheap to pay for.
- **There is no Back button on the thread screen; End Conversation is the
  only way out of it.** Reason: explicitly requested — this kiosk stands in
  a public place; if a Back button let someone step out without ending the
  conversation, the next person in the queue could read what was said.
- **Nothing enters the thread without passing through the Confirm step.**
  Reason: the classifier is a cosine-similarity k-NN and offline speech
  recognition mishears; if a wrong word is added straight to the thread and
  then spoken aloud, the Deaf user watches the machine say something they
  never said, with no way to stop it.
- **The English/Filipino language toggle lives on screen 02 ("Who speaks
  first?"), chosen once at the start of a conversation, never mid-thread.**
  Reason: it was on the old voice screen, which no longer exists, and has
  nowhere else to live; it also picks which single speech model loads later.
- **Heavy libraries load lazily and once per conversation:** MediaPipe +
  `tf.min.js` + camera + gesture cache only when "Sign Language" is chosen on
  screen 02; the Vosk model for the chosen language only when "Speak or Type"
  is chosen. Reason: if the user only ever types, Vosk never has to load at
  all; talk.html itself opens as shell HTML/CSS only.
- **Only one speech model (English or Filipino) is ever loaded at a time,
  never both.** Reason: each is ~41MB.
- **While a screen is hidden mid-conversation: keep the MediaPipe Hands
  instance, keep the camera stream (but stop sending it frames), keep the
  Vosk model, keep the gesture cache — but stop the frame loop / canvas
  drawing.** Reason: rebuilding ~15MB of WASM or restarting `getUserMedia` is
  slow; the frame loop, not the retained object, is what heats the Pi's CPU.
- **Multi-dataset k-NN compares only against the active dataset, and
  classifies only when the hand is still, not on every frame.** Reason:
  doesn't matter at the current 120 gestures, will matter at 2,000.
- **The thread is capped at roughly the last 30 bubbles in the DOM; older
  messages live only in the database.** Reason: unbounded DOM growth over a
  long conversation is a memory leak on an 8GB Pi running for a full day.
- **Past-conversation history sits behind the same PIN `reports.html`
  already uses, and is deleted automatically after a set retention period.**
  Reason: End Conversation and the idle timeout only protect the *live*
  screen; an unprotected, permanent archive is a privacy problem the live
  fixes don't touch.
- **Dual display is explicitly undecided — do not design or build anything
  that assumes what the second display shows.** Reason: stated as an open
  question in the README; guessing here would bake in an assumption nobody
  has confirmed.
- **Dashboard change (out of scope for this phase): eventually
  "Translate Sign to Text" / "Translate Text to Sign" cards are replaced by
  one orange-bordered "Let's Talk" card, and all four cards gain a one-line
  14px muted caption.** Reason: recorded here so a later phase doesn't have
  to re-derive it from the reference image, but it is not built now (see
  below).

## Decisions specific to this phase (from the task prompt, not the README)

- **talk.html is not linked from the dashboard in this phase.** Reason: it
  is a shell with fake data; putting it on the dashboard would replace two
  working, tested features (`sign-to-text.html`, and text-to-sign) with a
  mockup before a human has tested the new flow by hand. Reached only by
  typing the URL directly.
- **This phase touches no existing file.** Reason: explicitly requested, so
  that `sign-to-text.html`, `index.html`, etc. stay exactly as tested/working
  while `talk.html` is built and reviewed independently.
- **This phase is UI-switching only: fake/canned data, no camera, no
  microphone, no MediaPipe, no TensorFlow, no Vosk, no database calls.**
  Reason: the point of this phase is to let a human test the screen
  state-machine by hand before any heavy/real integration is wired in.
- **`onEnterSigning` / `onLeaveSigning` / `onEnterSpeaking` /
  `onLeaveSpeaking` / `onEndConversation` are declared as empty hook
  functions and left unimplemented.** Reason: later phases attach the camera
  and speech model here; they need one stable place to run setup/teardown
  once per conversation, not code re-run on every screen transition — writing
  the hooks now (even empty) fixes that shape before the heavy logic arrives.

## Decisions made while writing the plan (docs/superpowers/plans/2026-09-16-talk-html.md)

- **Screen title stays "NEW CONVERSATION" on every screen, including the
  thread.** Reason: `05-conversation.png` shows "CONVERSATION" instead, but
  the README's rule ("The title does not change between screens... that is
  the entire point of the redesign") explicitly wins over an image per the
  phase brief's own instruction. The image is treated as earlier/stale here.
- **The thread screen (05) has no Back button, matching the no-image rule
  above** — already seeded above, reconfirmed here because
  `05-conversation.png` also draws a Back button in its header, which the
  README's explicit "no Back button on the thread screen" text overrides.
- **The palette lives in a new shared file, `css/tokens.css`, not a fourth
  page-scoped `:root`.** Revised during plan review: the first draft of this
  decision had talk.html define its own `:root`, which would have made a
  *fourth* divergent copy on top of the three that already exist
  (`gesture-training.css`, `sign-to-text.css`, `reports.html` — none of
  which use the README's exact names: they use `--navy2` not `--navy-2`,
  `--orange-deep` not `--orange-dark`, no `--muted-light`, no `--red`,
  `--white` instead of `--surface` in two of the three). `css/tokens.css`
  holds one `:root` under README's exact eleven variable names, with the
  same hex values already in use elsewhere; `talk.html` links it. This is
  still a **new** file, so it doesn't violate "edit nothing existing." The
  three existing pages are **not** migrated to it in this phase — they keep
  their own `:root` blocks unchanged — that migration is recorded as a
  `docs/system/DEBT.md` item for a later phase, not done now. Reason: same
  amount of work either way; this way the repo ends the phase with one
  shared file three pages are queued to adopt, instead of a fourth
  independent copy.
- **Screen state machine has four `data-screen` values** (`who-first`,
  `signing`, `speaking`, `thread`) **plus a separate modal-overlay layer**
  (`#modal[data-modal-kind]` ∈ `confirm`/`idle`/`error`, shown via
  `body.modal-open`) that layers on top of whichever screen is active.
  Reason: Confirm appears over signing/speaking (README: "before anything
  enters the thread"); idle and error can appear over the thread screen
  too — none of the three overlay states are their own `data-screen` value,
  since the screen underneath must stay exactly as it was when the person
  answers or dismisses the overlay.
- **"Who speaks first?" (screen 02) is shown once, at the very start of a
  conversation only.** Turn 2 and later route through the thread screen's
  own `Sign` / `Speak or Type` buttons, not back through screen 02. Reason:
  screen 02 chooses who *starts*; the thread's bottom panel ("Whose turn is
  it?") is what hands the turn back and forth after that, and re-showing
  "Who speaks first?" mid-conversation would contradict "chosen once at the
  start of a conversation, never mid-thread" (already seeded above, for the
  language toggle that lives on the same screen).
- **Typed-and-Sent messages are real data, not one of the "two fake
  buttons."** Only two things are canned in this phase: the Signing screen's
  "Stop & Add to Conversation" (stands in for the classifier) and a fake mic
  button added to the Speaking screen (stands in for real speech capture).
  Typing via the reused keyboard and tapping Send produces the text the
  person actually typed — there's nothing to fake there. Reason: keeps the
  keyboard component genuinely functional in this phase (useful for by-hand
  testing) while still satisfying "no camera, no microphone" — the fake mic
  button is an inert placeholder, not a working microphone.
- **Idle countdown length: 30 seconds**, not specified by the README beyond
  "a countdown." Reason: arbitrary but concrete choice made so the countdown
  is buildable and testable; easy to change later if the person doing manual
  testing says otherwise (see `docs/system/MANUAL-CHECKS.md`).
- **Idle timeout threshold is a named top-of-file constant
  (`IDLE_TIMEOUT_MS`), not hardcoded inline at the `setTimeout` call site.**
  Reason: the 2-minute production value is too slow to exercise in an
  automated DOM check; a single named constant lets a test temporarily
  shrink it without touching the trigger logic itself.

## Decisions made during implementation

- **Task 2: `.status-pill` is 40px tall (README's exact value); `.back-btn`
  is 44px tall.** The task's own numeric done criteria (criterion 4)
  originally required every element carrying `.status-pill` or `.back-btn`
  to be `>=44x44`, and an earlier revision of this file applied that
  literally, bumping `.status-pill` to 44px against the README's explicit
  "40px tall." That was a mistake: the project's `>=44x44` tap-target floor
  exists to keep tappable controls reachable by touch, and `.status-pill`
  has no click handler anywhere — it's a purely informational state
  indicator, not a control the user ever taps. The done-criteria wording was
  too broad in including it. `.status-pill` is reverted to README's exact
  40px. `.back-btn` correctly stays at 44px: it IS interactive (its click
  handler navigates back), the README gives no exact pixel height for it, so
  with no README value to defer to, the tap-target floor is what governs it.
- **Task 2: the persistent thread subtree is one element, `#thread`
  (inner scrollable list `#thread-list`), not the plan text's
  `#thread-strip`/`#thread-full` pair.** Reason: the task prompt's own "Your
  Job" section explicitly left the concrete id/structure to this task's
  judgment, and a single element toggled by `body[data-screen]` CSS (collapsed
  96px on signing/speaking, full 510px on thread, hidden on who-first)
  matches Task 1's one-pattern rule (attribute selectors, no second toggling
  mechanism) more directly than two separously-named elements would. Task 3/
  4/5/6 should target `#thread` and `#thread-list`, not `#thread-strip`/
  `#thread-full`.
- **Task 2: the full-height thread on the `thread` screen is 510px
  (600 − 90), with no space reserved for a control panel.** Reason: this
  task builds no control panel (that's Task 3's screen-05 layout job); the
  README describes the panel as ~190px, so Task 3 will need to shrink
  `#thread`'s full-height CSS rule accordingly once the panel exists — noted
  here so that adjustment isn't a surprise.
- **The project's "no body text under 16px" hard rule governs over
  README's smaller suggested sizes for secondary/meta text; it is not a
  carve-out case.** Two instances of this same tension have now come up and
  both were resolved the same way: `.bubble-label` (Task 2) is 16px against
  README's "13px muted" for the Signed/Spoken timestamp label, and
  `.control-panel-label` (Task 3) is 16px against README's "15px muted" for
  the "Whose turn is it?" label. Task 3 originally followed README's 15px
  literally, which a task reviewer flagged as inconsistent with the
  already-settled `.bubble-label` precedent; it was corrected to 16px to
  match. Reason: the hard rule has no stated exception for secondary/meta
  text, and README's per-element numbers are suggestions the hard rule
  overrides, not the other way around. This is the general precedent for any
  future task that hits the same README-vs-16px-floor tension on any other
  element — apply the 16px floor, do not re-litigate it a third time.

## Decisions made during the post-Task-6 final-review fix pass

- **`#dev-modal-switcher` (the fixed dev scaffold row that switched
  modal/status-pill state by hand) was removed, not left for a later
  phase.** It was legitimately needed while `openModal()` had no real
  content for `idle`/`error` (Tasks 2–5). Task 6 gave all three modal kinds
  real content and Task 5 already gave `confirm` a real trigger (Signing's
  Stop button), so its `confirm`/`idle` buttons had become redundant with
  real UI. Confirmed live in a browser that this was not merely redundant
  but actively harmful: it sat `position:fixed; z-index:9999` at
  `bottom:60px`, and the 96px `.icon-tile` placed inside it (an ad-hoc
  visual check of that shape, unrelated to its own buttons) pushed its
  total height past what its buttons alone needed, so it physically
  overlapped the thread screen's real control-panel buttons —
  `document.elementFromPoint()` at the centre of the thread screen's Sign
  button returned `#dev-modal-switcher`, not the button, meaning a real tap
  there could never reach it. That is a blocker for hand-testing the real
  navigation, not a cosmetic leftover, which is why it was removed in this
  pass rather than deferred again. The `error` modal kind has no real
  trigger in this fake-data phase (no camera/mic exists yet to fail) and is
  not expected to get one until that phase — it is meant to be invoked
  directly from the browser console when someone wants to eyeball it, e.g.
  `openModal('error', {heading: 'Camera not available', message: 'I cannot reach the camera.', buttonLabel: 'Try again'})`
  (as of the review-pass fix that gave Error a heading, matching
  Confirm/Idle's shape — `opts.heading` is required for real content now,
  see the corrected README "Error states" section for all four headings).
  `renderPlaceholderModal()` and its static `.modal-card` markup (the Task 2
  scaffold the dev row's `idle`/`error` buttons rendered through) were
  removed in the same pass since all three real kinds now have real render
  functions; `openModal(kind, opts)` throws on any kind other than
  `confirm`/`idle`/`error`, mirroring `showScreen()`'s existing
  invalid-input pattern instead of silently no-op-ing.

- **`js/virtual-keyboard.js` is wired into `talk.html` for real; the
  speaking screen's own comment that previously called it "out of scope for
  this task" was a controller error, now corrected.** The approved plan
  (`docs/superpowers/plans/2026-09-16-talk-html.md`, Investigation §2 and
  the screen-04 done criteria) always required it, and this file's own
  "Typing via the reused keyboard and tapping Send" decision (above, under
  "Decisions made while writing the plan") already assumed a genuinely
  functional keyboard — the earlier dispatch that told an implementer to
  skip it contradicted both. Fixed by including
  `<script src="js/virtual-keyboard.js" defer></script>` (ordered right
  before this file's own inline `<script>`, matching `index.html`), sizing
  the shared `.sk-keyboard-wrap`/`.sk-key` for the fixed 1024×600 kiosk case
  the same way `index.html` does, neutralizing `css/virtual-keyboard.css`'s
  global `!important` scroll/padding overrides so they don't break this
  file's no-scroll contract, and adding CSS-only
  `body.keyboard-active #screen-speaking …` rules (no JS-computed
  positions) that hide the fake mic row and move the input row clear of the
  keyboard while it's raised — the same technique
  `docs/system/UI-SURVEY-1024x600.md` finding 1 already established for
  `index.html`'s voice screen.

  As part of the same fix, `.status-pill`'s `TYPING` state (built by Task 2
  via `setStatusPill('typing')`, but never given a real caller — its only
  previous trigger was `#dev-modal-switcher`, removed above) is now wired
  for real: a `MutationObserver` watches `document.body`'s `class`
  attribute and calls `setStatusPill('typing')` while `keyboard-active` is
  present, `setStatusPill(null)` otherwise. `js/virtual-keyboard.js` only
  ever sets/clears that class from its own internal `showKeyboard()`/
  `hideKeyboard()`, with no exposed hook or custom event, so observing the
  class attribute is the simplest robust way to react to it without
  modifying the shared script. `LISTENING` (camera-related) stays
  intentionally undriven — there is no real camera in this fake-data phase
  for it to reflect, and inventing a fake trigger for it would misrepresent
  a state that doesn't actually exist yet.

  **Open design question, resolved:** README's screen-04 spec says the
  keyboard's `HIDE` key is orange, and this screen already has one orange
  element (`#speaking-send`, per the Task 3 orange-audit comment in
  `talk.html`). Once the real keyboard can be shown, that is a second
  orange element visible at the same time — the same shape of tension Task
  5 already resolved for the confirm modal's own orange "Add to
  Conversation" button appearing over a screen that already has its own one
  orange element: an overlay/temporary-state element's own orange is
  treated as separate from the underlying screen's "one orange element"
  count, since it is not part of that screen's resting layout. The raised
  keyboard is the same shape of thing — a temporary overlay, not part of
  `#screen-speaking`'s steady-state layout — so the same precedent applies
  here without re-litigating it. (Separately, and not the deciding factor:
  as actually implemented in `js/virtual-keyboard.js`/
  `css/virtual-keyboard.css`, no key has a resting orange fill — every
  `.sk-key`, `HIDE` included, only flashes orange on `:active`, a generic
  touch-feedback effect shared by all keys, not a `HIDE`-specific resting
  colour. Whether or not that's read as literally satisfying README's "HIDE
  is orange," it does not change the resolution above: the keyboard's
  colouring, resting or transient, is this overlay's own concern, not
  `#screen-speaking`'s.)

## Decisions made during the eight-screenshot review-pass fix (owner-directed)

The owner reviewed all eight screenshots against the README and the five
reference images and issued a fixed, non-negotiable list (A–G plus the
dashboard change). Each landed in its own commit; the resolutions below are
what each one turned out to require, including three places the README
itself was wrong and got corrected rather than the code bent to match it.

- **Fix A — the empty thread strip collapses to 0px, not a fixed 96px of
  blank white.** `#thread` on signing/speaking is `height:0` whenever
  `#thread-list` holds no `.bubble-row` (`:not(:has(.bubble-row))`), and
  `#screen-signing`/`#screen-speaking`'s own `padding-top` falls back from
  186px to 90px in the same condition — collapsing `#thread` alone would
  have left a second, content-side hole where its reserved space used to
  be. Both transition at 140ms. README's "03 — Signing" collapsed-strip
  bullet, which only ever described "the most recent message," now has an
  explicit empty-state line covering both 03 and 04. Reason: a first-turn
  user's very first real screen was a blank band under the header — the
  worst of the eight findings, fixed first per the owner's explicit
  ordering.
- **Fix B — the keyboard's five rows, 68×44 keys, and radius 6 are correct;
  only its colours were wrong, and only two of them.** The prior review had
  flagged the number row/ABC key/key size as spec deviations; the owner
  overruled that — "people type numbers into messages," the component is
  right and the README's original ~92×46/4-row description was the
  mistake — so the README's keyboard paragraph was corrected to describe
  what `js/virtual-keyboard.js` (a component shared with `index.html` and
  `gesture-training.html`, reused unmodified) actually builds, not the
  other way around. The two colours that WERE wrong: the wrap's background
  (`#111827`, no relation to any palette) is now `var(--navy, #1a2540)`;
  `HIDE` (the last key of the last row — the one CSS-only way to target it
  without a class of its own or touching the shared script) is now
  `var(--orange, #f97316)`. Both use a fallback because `css/style.css`
  and this file are the only two stylesheets loaded together on `index.html`,
  and `index.html` defines neither `--navy` nor `--orange` itself — the
  fallback keeps the colour correct there too. Verified on both consumers:
  `index.html`'s keyboard wrap keeps its own separate, pre-existing
  translucent-blur override (a local rule with higher specificity than the
  shared one this fix touched), unchanged and still correct; its `HIDE` key
  now also picks up the new orange, since it had no such override.
- **Fix C — the error modal gets a heading, matching Confirm/Idle's
  shape.** `renderErrorModal` now builds `opts.heading` first (as a `<div>`,
  not `<h2>` — an `<h2 class="error-heading">` loses to the shell's own
  generic `.modal-card h2{font-size:20px}` rule by specificity, (0,1,1)
  beats (0,1,0), not just by source order — the exact trap `.idle-title`
  already sidestepped the same way; caught by measuring the rendered
  20px, not assumed 32px). The existing sentence becomes secondary text
  beneath it (16px muted, was 18px navy — matching `.confirm-label`/
  `.idle-label`'s size now that the heading carries the primary weight).
  README's four example messages each get a heading; camera's is
  "Camera not available" as the owner specified, the other three
  ("Hands not visible" / "Didn't catch that" / "Microphone not available")
  are this fix's own choice, short and in the same voice.
- **Fix D — Idle is 520px wide on a 62% scrim; Confirm/Error stay on the
  shared shell's 640px/50%.** Both numbers were already in the README and
  simply not built. Rather than change the shared `#modal`/`.modal-card`
  shell (used by all three kinds) for everyone, both rules key off
  `#modal[data-modal-kind="idle"]` — set by `openModal()` before content
  renders — so only Idle picks them up.
- **Fix E — the thread scrollbar was already visible; the review finding
  that it wasn't was a false positive from the reviewing browser's own
  `--hide-scrollbars` flag, not a real defect.** A `::-webkit-scrollbar`
  rule already existed (Task 4) and already reserved real layout width —
  confirmed by re-testing the exact same page without that flag
  (`clientWidth` dropped from 1024 to 1016, matching its 8px). The owner's
  fix instructions were followed anyway, since they're a legitimate
  refinement independent of whether the original finding was accurate: now
  6px wide (was 8px), `--border` track (was `--bg`), `--muted-light` thumb
  (unchanged). Also adds `scrollbar-gutter:stable` so the 6px gutter is
  reserved unconditionally — confirmed `#thread-list.clientWidth` stays at
  1018 whether the thread is empty, has one message, or has enough to
  scroll, so the bar's appearance never shifts the thread's width. Recorded
  here so a future review trusts a live re-test over a screenshot taken
  with scrollbar-hiding flags on — the same lesson
  `docs/system/UI-SURVEY-1024x600.md` already logged once for a different
  reason ("Two things this survey nearly got wrong").
- **Fix F — the mic button is 110px, and README now says so; the resting
  Speak-or-Type block is vertically centred, not top-pinned.** README gave
  no size for the mic button at all — the owner's own gap, now closed: 110px
  circle (was 72px), glyph scaled 32→40 to match, "Tap to Speak" label at
  18px, both numbers added to the README's "04" section. Separately,
  `#screen-speaking{justify-content:center}` centres the mic/label/input
  block in the space between the collapsed strip and the screen's bottom
  edge at rest, instead of leaving the ~194px the keyboard needs when
  raised sitting empty below a top-pinned block. `body.keyboard-active
  #screen-speaking{justify-content:flex-start}` restores the original,
  already-measured layout the instant the keyboard is up, so Fix 2's
  keyboard-clearance numbers (input row ends at y=266, 94px clear of the
  keyboard's y=360 top edge) are unaffected — re-verified unchanged after
  this change, not assumed.
- **Fix G — the confirm card gets more vertical padding (44px top/bottom,
  was 32px all round), not a forced height.** 640×281.6 was already inside
  README's "roughly 640×300" — the owner was explicit that height was never
  the actual problem, just the shared shell's flat padding reading cramped
  against the card's width. Scoped to `kind="confirm"` only via the same
  `#modal[data-modal-kind=...]` technique as Fix D, so Idle/Error's own
  32px is untouched. Card now measures 640×305.6 — still "roughly 300,"
  still not a forced number.
- **Dashboard: four cards, not five; "Let's Talk" replaces both translate
  cards; `grid-template-columns` changed from `repeat(5, 180px)` to
  `repeat(4, 180px))`.** `index.html` now also links `css/tokens.css` (new
  `<link>`, nothing else about that file's own palette system touched) so
  the new orange border/icon can use `var(--orange)` instead of a new hex.
  Captions (14px, `var(--muted)`) close most of the ~100px dead space under
  each label — the shared `.card-btn` gap shrank from 24px to 16px to make
  room for the third stacked line without inflating the fixed 270px card
  height. `#welcome-btn` (the removed "Translate Text to Sign" card) is
  kept as a hidden, present-in-DOM button rather than deleted outright:
  `js/script.js:13` unconditionally does
  `document.getElementById('welcome-btn').addEventListener(...)` with no
  null-guard, and this fix pass's own file-scope gate does not include
  `js/script.js` — removing the id entirely would have thrown on every
  `index.html` load. This matches the file's own pre-existing
  `#status`/`#download-history-btn` precedent (`index.html:734,739`),
  kept hidden for the identical reason. `#translator-pane` itself (and its
  `?screen=voice` URL entry point, `setTtsLanguage()`, the EN/FIL chips)
  and `sign-to-text.html` are both untouched and re-verified reachable —
  removing a dashboard card is not removing the feature behind it.
  Measured: the five-card row's old 76px overflow (980px of content wanting
  more room than its 904px-capped container, bleeding 38px off each side)
  is gone at four cards — 780px fits inside 904px with room to spare, and
  the row now centres in the 1024px viewport with a clean, equal 122px
  margin on each side.

## Decisions made during the second review-pass fix (owner-directed)

- **The English/Filipino language toggle is removed from the who-speaks-first
  screen entirely** — markup, CSS (`.lang-toggle`/`.lang-toggle-btn`), and its
  click handler are gone, not just hidden. Reason: making a stranger choose a
  language before they can begin talking is friction on a public kiosk, and
  the conversations this system is built for are Filipino. It was only ever
  in the spec because the old voice screen (`index.html?screen=voice`) had
  one and it needed somewhere to live once that screen was folded into
  `talk.html` — not because this screen itself needs one.
  **Consequence, recorded but not built:** a later phase still has to decide
  which Vosk speech model loads, since that decision can no longer come from
  a per-conversation toggle. The language now **defaults** rather than being
  chosen per conversation. Changing the default is an **operator setting**
  that belongs behind the same PIN `reports.html` already uses — the same
  privacy/admin boundary this project already draws around every other
  configuration surface — not a screen a member of the public sees. This is
  a decision to build later, not built in this pass.
  With the toggle gone, `#screen-who-first` drops from three flex children
  (heading, cards, toggle) to two (heading, cards); no extra centring CSS was
  needed; `justify-content:center` (already on `#screen-who-first`, set when
  the screen was first built) re-centres the smaller content block on its
  own. Verified live: the gap above the heading and the gap below the cards
  are both exactly 78.5px, i.e. genuinely centred, not just visually close.

- **talk.html's entire body is now wrapped in one `#stage` div — a fixed
  1024×600 box — scaled as a whole with `transform:scale()` to fill whatever
  viewport the kiosk actually has, rather than being pinned to the top-left
  corner on anything larger than the Pi's own panel.** Every element inside
  keeps its exact design pixel size; the layout is not fluid anywhere —
  `scale = min(window.innerWidth/1024, window.innerHeight/600)`, rounded to
  2 decimal places, recomputed on resize, `transform-origin` at the box's own
  centre so the stage stays centred (not corner-anchored) as it grows or
  shrinks. Body itself became a `display:flex;align-items:center;
  justify-content:center` frame that does the actual centring/letterboxing;
  `#stage` carries the real 1024×600 and `background:var(--bg)` so the
  letterbox and the stage's own background match.
  This worked with almost no changes to the file's existing CSS, for one
  specific reason: applying a CSS `transform` to an ancestor makes that
  ancestor the containing block for every `position:fixed`/`position:absolute`
  descendant below it. Every screen-level `position:fixed` rule already in
  this file (`.talk-header`, `#thread`, `#modal`, `.control-panel`, the
  virtual keyboard) was written assuming its containing block was a
  1024×600 box at the viewport origin — once `#stage` became that box
  (instead of the real viewport), all of them kept working unmodified.
  Likewise every `body[data-screen="..."] X` / `body.keyboard-active X`
  selector still matches: they're descendant selectors, and `#stage` sitting
  between `<body>` and its old children doesn't break a descendant match.
  **One real gap this exposed:** `js/virtual-keyboard.js` creates its
  keyboard element with a plain `document.body.appendChild()`, with no
  knowledge `#stage` exists — left alone, the keyboard would land as a
  sibling of `#stage`, outside the transform, at native unscaled viewport
  coordinates. Not fixed by editing that shared script (out of scope this
  pass — `index.html` and `gesture-training.html` reuse it too, and this
  pass's own file-scope gate is talk.html + docs only); instead a
  `MutationObserver` on `document.body` re-parents the keyboard element into
  `#stage` the instant `js/virtual-keyboard.js` creates it.
  **Verified, not assumed:**
  - At exactly 1024×600 the computed transform is `matrix(1, 0, 0, 1, 0, 0)`
    — scale exactly 1 — and every measurement re-taken from the previous
    review pass (who-first cards, camera box, stop button, speaking
    input/send, mic button, control panel, turn buttons, end-conversation
    button, confirm/idle modal dimensions, idle scrim) came back identical
    to the numbers already on record. Nothing moved.
  - At 1920×1080 (scale 1.8), 1366×768 (scale 1.28), and 1280×720 (scale
    1.2) — the height ratio is the binding constraint at all three, since
    every one of these is a wider-than-1024:600 aspect ratio — `document.
    elementFromPoint()` at the geometric centre of the Sign, Speak or Type,
    and End Conversation buttons returned that exact button at every scale,
    confirming a tap lands on the element under the finger, not on
    whatever's underneath a mis-scaled hit target.
  - The keyboard was confirmed re-parented into `#stage` (`parentElement
    === stage`) before it ever becomes visible, and both its raised
    (`bottom:0`) and parked (`bottom:-280px`) positions were measured
    relative to the *scaled stage's* edges, not the raw viewport's — e.g. at
    1366×768 the parked keyboard's offset below the stage's bottom edge is
    358.4px, exactly `280 × 1.28`.
  - Text crispness: cropped and enlarged (4×) screenshots of small text (a
    keyboard key, the status pill) at a fractional scale (1.28) show the
    same RGB sub-pixel fringing as an identical crop taken at scale 1 (no
    transform at all) — i.e. this is ordinary sub-pixel font rendering,
    present regardless of scaling, not blur introduced by the transform.
    The scale is still rounded to 2 decimal places as a standing part of
    `updateStageScale()` (protects the "exactly 1 at exactly 1024×600"
    guarantee against any future floating-point/measurement noise at other
    sizes), but for these specific scales — 1.8, 1.28, 1.2 — rounding was
    already a no-op, since none of them carry more than 2 decimal digits;
    it did not need to "fix" anything here because there was nothing to fix.
  **Recorded, not resolved, in `docs/system/DEBT.md` item 43:** `index.html`
  and every other existing page in this kiosk are fluid layouts; talk.html
  is now the one page that is a scaled *fixed* stage. Two different answers
  to "the design is 1024×600 but the actual screen might not be" now coexist
  in one system — a decision for later, not a surprise.

## Decisions made during the signing-screen merge (2026-09-21, autonomous loop)

Spec: `docs/superpowers/specs/2026-09-21-signing-screen-merge-design.md`.
Appended one line per settled decision as the run proceeds.

- **The Guide is asymmetric on purpose: Sign Language keeps its real 3-step
  guide (carried over from `sign-to-text.html`); Speak or Type gets no guide,
  only a "Getting ready…" loading state while the queue is unfinished.**
  Reason: owner-confirmed in the spec. Signing has non-obvious steps (start
  gesture, hold to add a word, stop gesture); "tap the mic or type" has
  nothing to explain. Not a gap to fill in a later pass.
- **The loading queue gates on EVERYTHING: the Guide/waiting screen's
  proceed control stays disabled until BOTH stacks (sign and speech) have
  finished, even if the user only picked one.** Reason: owner-confirmed in the
  spec. A conversation can switch turn type at any time; if only the picked
  stack were awaited, the second turn's screen would then hit its own
  loading wait mid-conversation, which is the exact "switching lag" this
  whole single-document design exists to remove.
- **Load order is sign stack first, speech stack second — by measurement, not
  assumption.** Measured on the dev machine (Chromium, cache-busted, 3 runs
  each; medians): sign stack 581 ms with the k-NN cached in localStorage /
  1551 ms with it empty (rebuilt from the database); speech stack 2737 ms
  (`vosk.js` 73 ms + `Vosk.createModel` 2666 ms). Re-measured through the
  real queue in Chrome: sign 358 ms → speech 1071 ms warm, sign 2102 ms →
  speech 3518 ms cold. Not measured on the Pi; the ordering is expected to
  hold, the absolute times will not.
- **The spec's "queue on talk.html load" supersedes README's older "lazy —
  load on the chosen screen" loading table.** Reason: the spec is later and
  owner-approved, and it exists because README's lazy rule made the *second*
  turn type pay its own wait mid-conversation. Consequence: Vosk now loads
  (41 MB) even for a conversation that only ever types. README's Loading rules
  section is stale on this point and should be read with this line.
- **`onEnterSigning()`'s idempotency is read as "no duplicate work while
  active", not "no `getUserMedia` on re-entry" — because the same spec also
  requires `onLeaveSigning()` to release the camera hardware.** A released
  camera must be re-acquired; both statements cannot hold literally. The
  spec calls the release "more important than any other single detail in this
  phase", so it wins. What stays true and was measured: one loading-queue run
  per page load (Apache access log: one GET each for `tf.min.js`, `hands.js`,
  the WASM, the tflite, `sign-to-text-ui.js`, `vosk.js`, the model), exactly
  one `Hands` instance for the page's life, one `getUserMedia` per real entry
  (a second `enter()` while active adds none), and the model/MediaPipe are
  never recreated. Re-entry pays only for `getUserMedia`: 66–250 ms on the dev
  machine with a fake camera; on the Pi it goes in MANUAL-CHECKS.
- **`onLeaveSigning()` = `TalkSigning.leave()`: stop every track, null
  `video.srcObject`, clear the 150 ms tick and any countdown, pause the
  MediaPipe frame loop — and never touch the `Hands` instance, the k-NN model
  or the queue.** Measured: after leaving, every track `readyState` is
  `ended`, `stream.active` is false, `video.readyState` is 0, and
  `hands.send()` calls drop from 9 per 1.5 s to 0; on re-entry they resume
  with `Hands` constructed still exactly once. `README`'s "keep the camera
  stream, just stop frames" rule is overridden for the same reason as above.
- **`js/gesture-data.js` gained three additive exports
  (`preloadMediaPipe`, `pauseHandLoop`, `resumeHandLoop`), a loop-generation
  guard in `runHandLoop`, and an opt-out flag `SK_DISABLE_GESTURE_HOTKEY`.**
  Reason: "stop the loop, not the object" needs a pause the file did not
  have, and the loading queue needs the `Hands` instance created early via
  `initialize()`. It is a shared file (`gesture-training.html` uses it), so
  every change is additive — the diff removes no lines and a never-paused
  loop is provably unchanged. The hotkey flag exists because the file's "G to
  record" hotkey opens `prompt()`, which a kiosk with no keyboard should
  never reach.
- **`talk.html` reuses `js/sign-to-text-ui.js` (loaded by the queue) instead
  of copying its k-NN, label-translation and sentence-forming code.** Only the
  prediction *loop* was ported (`js/talk-signing.js`), constants copied with
  their source line numbers, because the original loop is welded to
  `sign-to-text.html`'s DOM and result screen. Consequence: that file stays in
  use after `sign-to-text.html` is archived, so it is not orphaned.
- **The one orange button on the signing screen is the old START/STOP toggle:
  "Translate" (idle) → "Starting in N…" → "Stop & Add to Conversation".**
  The spec ports "Stop & Translate" but is silent on how recording starts;
  `sign-to-text.html` starts on the "start" gesture or a button, then a 3 s
  countdown. The Guide's text is carried over unchanged and so still says
  "TRANSLATE" / "STOP & TRANSLATE" (button names that did not match
  `sign-to-text.html`'s own labels either — `DEBT.md`).
- **A failed stack does not deadlock the gate; "done" means settled.** Sign
  stack failed → Guide's Start stays disabled and says "Signing is not
  available right now." (Back still works; Speak still works). Speech stack
  failed → Sign is unaffected; the first Speak entry shows the existing error
  card with README's "Microphone not available" wording and a "Type instead"
  way out, once. The spec says nothing about failure of the queue.
- **Errors reuse `talk.html`'s own error card, not `sign-to-text.html`'s
  toasts.** `sign-to-text` reports a camera failure as a 5 s toast and leaves
  its "AI is getting ready" overlay up forever
  (`js/sign-to-text-ui.js:397-400`, `:328-348`); the merged screen uses
  README's "Camera not available" card with a "Go back" way out, "Didn't
  catch that" for an empty sentence, and a "Sign set not available" card if a
  language switch fails. No "Hands not visible" state was built — `sign-to-text`
  never had one either (README:256 describes a state that was never
  implemented); the "Show your sign" caption is what it did and what this does.
- **The ESL/FSL chips and the Hand Guide toggle sit in 200 px columns beside
  the centred 560×300 camera.** README's screen 03 has no room under the
  camera for them: with the 96 px strip showing, the stack is
  90+96+16+300+14+68 = 584 of 600 px. Chips are 200×60, text 16 px, active =
  navy fill; no orange, no emoji flags.
- **Orange per signing sub-state:** the Guide's "Start Translating →" in the
  Guide, `#stop-signing-btn` in the live view — the other is `display:none`
  in each. The recording state is shown by a green (live) outline on the
  camera box, not a red or orange one; README reserves red for stop/end.
- **The dev overlay flag is the URL param `?devqueue`.** Not sticky, nothing
  written to storage, so it cannot survive on the kiosk's Chromium profile; on
  a plain load the overlay element does not exist in the DOM at all (verified:
  `document.getElementById('dev-queue-overlay') === null`, `location.search
  === ""`). Its text is 12 px monospace — dev-only, exempt from the kiosk's
  16 px floor.
- **The header LISTENING pill is still not driven.** README says it shows
  while the camera reads; the spec's scope list does not include it and the
  TYPING observer (`talk.html`, `MutationObserver` on `body` classes) would
  clear it on any class change. Left for a follow-up rather than invented here.
- **Data finding, not a code decision: neither the ESL nor the FSL gesture
  set has a `stop` label** (ESL: 120 labels incl. `start`, no `stop`; FSL:
  90 labels incl. `start`, no `stop`, read from the loaded k-NN). The "sign
  stop to finish" half of the Guide's step 3 therefore cannot fire with the
  current data; only the manual button ends a sentence. The stop-gesture
  code path was exercised with a synthetic in-memory `stop` label.
- **Nothing here touches `#translator-pane`.** Its header still links to
  `sign-to-text.html` (`index.html:653`); once that page is archived the link
  is dead. Remove, repoint, or retire `#translator-pane` too — owner's call.
- **Final-review fixes (three, one commit): a single hand-loop guard instead
  of a generation counter, an abandoned language switch, and the idle
  countdown.** (1) `js/gesture-data.js` pause/resume now uses `sendInFlight`
  plus the pending-rAF id, so `resumeHandLoop()` while a `hands.send()` is
  still in flight — or while a loop is already running — starts nothing; the
  reviewer found `state.processingVideo` (the file's apparent re-entrancy
  guard) is never assigned, so the earlier generation counter alone could let
  two sends overlap on the one `Hands` instance. Measured in real Chrome:
  max concurrent sends 3–4 in the resume-while-running case before, 1 after;
  a never-paused loop is unchanged (`gesture-training.html` still ~10 sends per
  1.5 s). (2) `setLang()` in `js/talk-signing.js` now abandons quietly if the
  user left (or left and came back) mid-switch — no error card on the wrong
  screen — and on an abandoned *failed* switch still reverts `signLang` and
  reloads the previous model, since the failed attempt had already emptied the
  model. (3) `openModal()` in `talk.html` clears a running idle countdown when
  any non-idle card opens over it, so a camera error can no longer be followed
  by the conversation ending underneath it. Accepted, not fixed: while a
  confirm/error card is open the idle timer only re-arms itself (existing
  design), so an error card left unattended does not end the conversation.

## Decisions made during the text-to-sign merge (2026-09-21)

Spec: `docs/superpowers/specs/2026-09-21-text-to-sign-merge-design.md`.
One line per settled decision, appended as the run proceeds.

- **Translate stays an explicit button, not auto-play.** Reason: owner-decided
  in the spec. `#translator-pane` already used an explicit Translate button;
  triggering on speech-end or a typing pause risks firing early on a slow
  talker or typist, and a sign video that starts by itself mid-sentence is
  worse than one that waits to be asked for.
- **The sign-video preview is pre-send only and is never stored in, or
  replayed from, the thread — only the text goes into the bubble, through the
  existing, unmodified Send → confirm card → Add to Conversation flow.**
  Reason: owner-decided in the spec. The confirm card exists so nothing
  reaches the thread that the speaker did not agree to; storing media in the
  thread would also grow DOM/memory per turn on a Pi that already reloads the
  page to clean up, and the thread is capped at ~30 bubbles for the same reason.
- **The sign pipeline is ported as a copy into `js/sign-player.js`, not extracted
  into a module shared with `js/script.js`.** Reason: `script.js` cannot be
  loaded into `talk.html` at all (`:13` and `:441` call `addEventListener` on
  `index.html`-only ids with no null-guard; ~13 top-level `const`s pollute the
  global scope), so "sharing" would mean refactoring a page scheduled for
  deletion while its `#translator-pane` must keep working until verified; and
  after retirement `script.js` has no consumer, so a shared module would have
  exactly one user. The copy becomes the sole implementation when `script.js` is
  archived. The maps, `normalizeSpeechText`, `formatGrammar` and
  `fetchAndRegisterCustomGestures` are byte-identical (diff-verified); the
  matching/fallback logic and its constants are unchanged.
- **Five departures from `script.js` are allowed and no others:** the language
  is an argument, not read from `#lang-select`; the container and word label are
  injected, not module-scope; a cancellation token plus abortable waits (Edit /
  Send / leaving must stop playback); every `<video>` is released (the original
  never releases its probe); and the fallback `<img>` is built with DOM APIs.
  Reason for the last one: the original interpolated the label into
  `innerHTML` (`script.js:997`), and on this public kiosk the label derives from
  typed text.
- **Neutral `fallback.png` placeholders were added to `assets/signs/en/` and
  `/fil/` (owner-approved, commit `ca8b8c9`).** Reason: the pipeline's last step
  requested `<assetBase>fallback.png` (`script.js:938`), which never existed
  anywhere in the repo, so it silently showed nothing and the spec's "…then
  `fallback.png`" chain could not be tested as written. A grey "?" tile,
  replaceable with real art; no logic change.
- **Filipino fingerspelling stays verbatim and logged, with no English fallback
  (owner-approved).** `assets/signs/fil/` has 89 clips and none of a–z, so an
  unknown Filipino word plays nothing (measured: 128 ms, empty frame). Falling
  back to the English alphabet would change behaviour the spec said to carry
  over unchanged; recorded as `DEBT.md` item 56.
- **EN/Filipino chips sit above the mic on the compose state (owner-approved).**
  `talk.html` had no language toggle since the one on "Who speaks first?" was
  removed, but the spec says the chips carry over. Default English, kept for the
  conversation, hidden together with the mic while the keyboard is up. Filipino
  keeps the pane's behaviour: **mic disabled**, typing still works from
  `assets/signs/fil/`. Vosk stays English-only (`DEBT.md` item 53).
- **Compose is `[input | Translate]`; Send moves into the preview panel and is
  enabled immediately; Edit returns to compose with the text kept
  (owner-approved).** Reason: the spec puts a Translate step before Send, and
  making Send wait for a sentence to finish playing would be ~4 s per word.
  Send is the *same element and click handler* — only its position changed —
  so Send → confirm → Add to Conversation is byte-for-byte unchanged.
- **Translate is disabled while a mic capture is starting or running, not just
  while capturing.** Found in review: with text in the field, tapping the mic and
  then Translate before the mic opened put the preview up, and the microphone then
  went live under it with no indicator and overwrote the text Send would confirm.
  `TalkSpeaking.isBusy()` (`starting || capturing`) now drives the gate, and
  focusing the input, switching to Filipino, or leaving discards a pending start.
- **The mic writes into `#speaking-input`; on stop `formatGrammar` is applied and
  Translate strips `?` before playing.** Reason: Send/confirm need a plain string
  in that input, and a formatted sentence ("Hello, how are you?") reads properly
  in the bubble; but `normalizeSpeechText` (here and in `script.js`) does not
  strip `?`, so "you?" would break phrase matching and fingerspell a question mark.
- **The pane's auto-translate on mic stop (`script.js:715-717`) is dropped;
  Translate is the only trigger.** The pane's mic-picker dropdown (13 px text,
  below the touch floor) is not ported; the USB mic auto-selection
  (`ab13x` / `usb audio`, `script.js:1050-1063`) is, because its only consumer of
  `selectedMicId` writes lived in `script.js` and would otherwise vanish with it.
- **One Vosk listener pair per model, filtered by `recognizerId`.** The bundled
  `vosk.js` attaches `recognizer.on()` to the model's event target with no
  removal and no id filter, so a listener per capture (what `script.js` does)
  multiplies the transcript — measured 1, 2, 3, 4 listeners and the phrase 4×
  then 8× over four captures on the code as first written. `remove()` exists and
  is called on teardown; `script.js:261` never frees its recognizers.
- **`SignPlayer.registerCustomGestures()` runs on first entry to Speak or Type**
  (one `save_gesture.php?no_sync=1` fetch; measured 2 in a cold-cache page load
  together with the queue's own). It registers DB gesture labels so multi-word
  labels group as phrases, as `script.js:878` did at page load.
- **Recorded, not fixed here: tapping `#speaking-input` raises the on-screen
  keyboard and immediately hides it.** `mousedown` lands on the input,
  `focusin` raises the keyboard and the layout shifts (the mic row hides), so
  `mouseup`/`click` land on `#screen-speaking`, and `js/virtual-keyboard.js`'s
  `handleDocClick` treats that as "clicked outside" and hides it (traced in real
  Chrome: `mousedown → speaking-input, focusin → speaking-input, mouseup →
  screen-speaking, click → screen-speaking`; same with emulated touch). It
  predates this phase (present on the previous `talk.html`), lives in a shared
  file, and every earlier check raised the keyboard with `.focus()`. `DEBT.md`
  item 54; needs a real-touch confirmation on the Pi.
- **The retirement of `#translator-pane` is its own final commit, after
  end-to-end verification**, and resolves `DEBT.md` item 44 by removing the
  pane the dead link lived in.

## Decisions made during the gesture-training multi-sample phase (2026-09-22)

Spec: `docs/superpowers/specs/2026-09-22-gesture-training-multi-sample-design.md`.
One line per settled decision, appended as the run proceeds. (This file's
title says `talk.html`; this section is about `gesture-training.html`.)

- **Multi-sample recording already worked in the data model (`gestures[label]`
  is an array, `gesture_recordings` does a plain INSERT per save) — this phase is
  a UX/surfacing fix plus a redundant-encode fix, not new storage plumbing.**
  Reason: the spec traced it end to end with file:line citations
  (`js/gesture-data.js:658-661`, `php/api/save_gesture.php:195-208`); nothing in
  the stack limits a word to one sample, so no schema or storage change is
  warranted.
- **Option C (cutting the post-save `reloadDataset()` cost) was promoted from
  a held-back extra into the base plan as Task 5, not shipped as a follow-up.**
  Reason: the owner's read of the plan's own numbers — ffmpeg skip saves
  220–455 ms/save (Task 2), the reload cost it does nothing about was
  measured at 2.0–3.9 s/save (two full synced dataset fetches, one of them
  not even awaited by its caller) — showed that Task 2 alone would not
  produce the "feels faster" outcome the phase exists for.
- **The reload fix is scoped to the post-save path only; `DOMContentLoaded`'s
  startup load keeps its two full synced fetches.** Reason: disk could have
  been touched outside the app between page loads, so a real disk→DB
  reconciliation is warranted at cold start; it is not warranted immediately
  after a save this same request just wrote to disk and DB directly.
- **The transcode rule skips ffmpeg for a label's sample 2+ only when that
  label already has a video, and always re-transcodes when it has none
  (`$priorSampleCount == 0`), even right after a delete.** Reason: finding 4
  — `delete_gesture` (`save_gesture.php:401-438`) removes only the label's
  JSON samples and DB rows, never its `<label>.mp4`/`.webm` clip; a plain
  "skip if it already has a video" rule would leave that stale clip in place
  forever after a delete-and-re-record. The rule's second clause (transcode
  when the label has no prior sample) exists specifically to refresh the
  clip the moment a label starts over.
- **Display-take policy is A — first take wins — not the opt-in "use this
  take as the display clip" control; Extra B is declined outright, not held
  for a later pass.** Reason (recommendations section of the spec): (a) it
  is the only variant that removes the per-save ffmpeg cost outright — any
  scheme that keeps re-encoding until the operator picks a favourite take
  still pays the cost this phase exists to cut; (b) finding 3 (the `.mp4`
  this endpoint writes is read only by `reports.php`'s View Asset, never by
  `talk.html`/`js/sign-player.js`) removes the practical reason to build a
  picker now — a control for choosing a display take that nothing in the
  live app plays back has no payoff yet; (c) a bad first take is already
  recoverable today via Delete + re-record, which the clause above makes
  refresh the clip. Revisit once `DEBT.md` item 62 (the mp4/webm mismatch)
  is settled — this is a decline, not a "not yet."
- **Soft target is 5 samples per word — not the spec's original "5–8" framing
  and not 8.** Reason: finding 1 — `knnPredict` scores a label as the mean of
  its top `min(5, N)` cosine similarities over all of that label's saved
  frames (`SAMPLE_TARGET = 5`, `gesture-training-ui.js:207`; K=5 in
  `knnPredict`, `:310`). One take already fills K=5 with near-duplicate
  frames (~90 ms apart within a take), so 5 takes is the smallest count at
  which each of the 5 neighbours *can* come from a different take — a
  code-derived number, not a guess. 8 has no basis anywhere in the code and
  was never adopted.
- **`js/gesture-data.js:566`'s `localStorage.removeItem(labelsKey)` after
  every save is load-bearing and was deliberately left untouched.** Reason:
  finding 2 — `trainModel()` only adds labels missing from the cached label
  list; without this removal, a word's newer samples would never reach the
  in-memory model until that cache expired some other way. Because this is
  true, Step 1's status line now says so out loud:
  `noteSampleSaved()`'s note reads "Saved. Run Train AI (Step 2) again to
  use it." after every save (`gesture-training-ui.js`) — the UI states a
  requirement the code has always had, rather than leaving it silent.
- **"Has a video," for the transcode-skip rule, means `<label>.mp4` OR
  `<label>.webm` — not `.mp4` only.** Reason: findings 3 and 4 — the raw-`ffmpeg`-missing
  fallback writes `.webm`, and every one of the 120 pre-existing stock clips
  in `assets/signs/en/` is a `.webm` with zero `.mp4` files measured
  alongside them; a `.mp4`-only check would re-transcode all 120 of those
  legacy words on their very next new sample. `find_label_video()`
  (`save_gesture.php:56`) checks `.mp4` then `.webm`, in that order.
- **The post-save reload path (`window.reloadDataset`,
  `gesture-training-ui.js:1063`) shares one `no_sync=1` fetch between
  `mergeSavedGestureSamples()` and `renderSavedDataset()`; `DOMContentLoaded`'s
  startup load keeps both of its full synced fetches, unchanged.** Reason
  (Task 5, finding 10): the save that triggers a post-save reload already
  wrote disk and the `gesture_recordings` DB row directly
  (`save_gesture_recording_to_db`, not `sync_disk_to_db`), so re-walking
  every label folder at that specific moment is redundant work. At page
  load, by contrast, disk could have been touched outside the running app
  since the last load (Reports/View Asset, hand-editing gesture data,
  deletions run some other way), so a real disk→DB reconciliation is
  warranted there and was deliberately left alone rather than also cut.
- **The test harness (`tests/multi-sample/harness.mjs`,
  `ffmpeg-stub/ffmpeg.bat`, `save-endpoint.test.mjs`, `measure-session.mjs`)
  and the reload-regression script (`tests/multi-sample/reload-regression.page.js`)
  are committed under `tests/multi-sample/`, not thrown away after use.**
  Reason (Extra D, owner-approved): both the ffmpeg-skip behaviour and the
  1-fetch reload behaviour are exactly the kind of thing a later, unrelated
  change could silently regress; keeping a runnable harness and a
  paste-into-console regression script in the repo gives the next person who
  touches `save_gesture.php` or `reloadDataset()` a re-runnable check instead
  of having to reconstruct one from scratch.
- **The spec's claim that the `.mp4` this endpoint writes is "the same clip
  the sign-video player reads" was wrong, and was corrected inline in the
  spec during planning rather than left standing.** Reason:
  `js/sign-player.js:255,378,411` (the only sign-video player in the app)
  only ever probes `<label>.webm` and never references `.mp4`; the only
  reader of the `.mp4` this endpoint writes is `php/api/reports.php:30-53`
  (Reports → View Asset). See the spec's own "Correction (plan phase,
  2026-09-22)" note and `DEBT.md` item 62.

## Decisions made during the gesture-categorization phase (2026-09-23)

- **Categorization is new — no existing code branches on
  word/letter/number/phrase today. This phase adds the attribute and a UI
  grouping; it does not change classification/training logic (`knnPredict`,
  `trainModel`, `cosineSimilarity` untouched) and does not change how many
  frames get captured per sample (that's a separate phase).** Reason: seeded
  from the phase prompt; the confusion risk between similar-start phrase and
  word signs is real but is a frame-budget/keyframe problem, scoped out.
- **The "209 labels in the `gestures` table" premise was wrong; 209 is the
  on-disk label-folder count (120 `saved_gestures/` + 89
  `saved_gestures_fsl/`, no name in both). The live `gestures` and
  `gesture_recordings` tables had 0 rows on 2026-09-23.** Reason: measured
  with `SELECT COUNT(*)` through `php/connect.php`; `?no_sync=1`
  (`list_samples()`, `save_gesture.php:335-381`) reads only disk. Consequence:
  the heuristic must run on every `gestures` INSERT (the sync recreates rows
  from disk), not only as a one-off backfill.
- **New column `gestures.category ENUM('word','letter','number','phrase') NOT
  NULL DEFAULT 'word'`; `gesture_recordings.gesture_type` is NOT repurposed.**
  Reason: its only reader (`core_api.php:72`, `get_recordings`, which reads it
  back *as the label*) is unreachable — its only caller `js/db-local.js` has
  no callers (DEBT 6) — so repurposing would break nothing live, but it would
  put a label-level attribute on a per-sample table (N copies, re-tag must
  touch all), require changing three writers (`save_gesture.php:213`,
  `core_api.php:63`, `scratch/trigger_sync.php:102`), and inherit a
  `VARCHAR(100)` indexed for label lookup. ENUM gives DB-level validity; the
  default is the safe fallback.
- **Category is stored in the DB only — no per-label sidecar file on disk.**
  Reason: owner decision (2026-09-23). Accepted cost: a manual re-tag does not
  survive a DB wipe/re-import; the label then falls back to the heuristic, so
  it is never left without a category.
- **Auto-classification heuristic, first match wins: `number` (all digits, or
  in a closed English zero–twenty/hundred/thousand + Filipino
  isa–sampu/sampung/daan/libo list) → `letter` (exactly one `a-z` char) →
  `phrase` (contains `_`) → `word` (default).** Reason: `clean_label()`
  (`save_gesture.php:29-34`) turns spaces into `_`, so `_` is the multi-token
  marker; no label is a digit string, so numbers only come from the word list.
  Measured on the 209 on-disk labels: ESL word 67 / letter 26 / number 10 /
  phrase 17; FSL word 50 / letter 0 / number 10 / phrase 29; total 117 / 26 /
  20 / 46. Known borderline multi-token "phrases" (`hard_of_hearing`, `so_so`,
  `take_care`, `dont_know`, `host_dad`, `higit_pa`, `tapos_na`,
  `katapusan_ng_linggo`, `mahirap_makarinig`, `ganon_din`) and a single-token
  "word" that means a phrase (`kamusta`) are left to the owner to re-tag.
- **Sign set and category are independent dimensions.** Reason: `gestures` is
  `UNIQUE(word, sign_language)`, so each (label, set) row carries its own
  category; the only interaction is that the number-word list is bilingual,
  and no list entry collides with a label in the other set.
- **The re-tag path is the capture-time Type selector: saving a new sample
  of an existing label with a different Type updates that label's category;
  the disk→DB sync never overwrites a stored category.** Reason: no extra
  screen; the sync has no category information to offer.
- **Dataset table groups in the order Words · Phrases · Letters · Numbers,
  alphabetical within a group; the "N categories" counter becomes "N
  gestures".** Reason: "categories" would now mean something else.
