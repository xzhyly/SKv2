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
