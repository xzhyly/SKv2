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
- **Test suites touching the live DB are run with `--test-concurrency=1`.**
  Reason: `tests/categorization/` and `tests/multi-sample` share the live DB
  and disk; a parallel run was observed to flake once, a serial run was not.
- **Task 4's delete-from-modal check was closed by a real click at 1024×600
  after review flagged the direct-call proxy, rather than accepted as-is.**
  Reason: the grouping change is exactly the layout risk that check exists
  to catch — a proxy that calls `deleteGesture()` directly bypasses the
  modal/table DOM the grouping restructured.
- **No test may ALTER, DROP, or bulk-UPDATE the real `gestures` table; the
  migration/backfill test runs against a scratch table
  (`zz_cat_bf_gestures`), and `save-category.test.mjs` snapshots every
  non-`zz` row's category in `before` and asserts it unchanged in `after`.**
  Reason: the final whole-branch review found the original backfill test
  dropped the live `category` column, which would silently revert every
  manual re-tag on each suite run (category is DB-only). Fixed in
  `a986a1d`; `ensure_gestures_columns()`/`backfill_gesture_categories()`
  moved to `php/api/gesture_category.php` with an optional `$table`
  parameter (default `'gestures'`) to make that possible. Live categories
  were snapshotted before and after the fix run: byte-identical, 209 rows.
- **`build_categories_map()` and `ensure_gestures_columns()` catch
  `Throwable` around their queries.** Reason: from PHP 8.1 mysqli throws
  `mysqli_sql_exception` by default and `@` no longer suppresses it; local
  XAMPP is PHP 8.0.30 but the Pi's PHP version is not specified in the docs
  (Raspberry Pi OS Bookworm ships 8.2), and the dataset list must never
  fail because of categories.
- **Follow-up (2026-09-24, owner request): the dataset modal is one tab per
  category (Words · Letters · Numbers · Phrases, default Words) with a live
  label search, replacing the single list with section headers.** The search
  filters only the active tab. Its text is kept across tab switches (the box
  stays visible, so what it shows always matches what is filtered) and
  cleared when the modal is reopened, which also resets to Words.
- **The modal renders from `renderSavedDataset()`'s grouped data
  (`datasetGroups`) instead of copying the hidden table's HTML.** Reason:
  tabs and a search box need live state, which a one-time HTML copy cannot
  hold. Side benefit: a delete made from the open modal now shows up
  immediately.
- **While the dataset modal is open, the on-screen keyboard is raised above
  it and the card is shortened to fit above the keyboard.** Reason: the
  keyboard (z-index 9999) would otherwise open underneath the modal overlay
  (11000), and on the touchscreen the search box would then be impossible to
  type into. Done in CSS, scoped with `body:has(#datasetModal.show)`, so no
  other page or modal changes.

## Decisions made during the DB cleanup (2026-09-24, owner-approved)

- **The project standardizes on XAMPP MariaDB; the `MySQL80` Windows service
  is Disabled (done by the owner).** Reason: two servers competed for port
  3306 and each held its own `sining_kamay_db`, and the Pi on Bookworm will
  run MariaDB too (`DEBT.md` item 68).
- **`gesture_words` and `translation_history` are dropped; `translations` is
  kept.** Reason: the read/write audit found no live reader or writer for the
  two dropped tables (only dead `core_api.php`, `admin_api.php`,
  `save_history.php`, `get_history.php`), and both had 0 rows. `translations`
  is read by the live Reports page (`reports.php:58-61`), and a failed query
  there returns a 500 for all three Reports tabs. Backup beforehand:
  `E:\ACADSS\IOT\backups\sining_kamay_db_2026-09-24.sql` (owner's phpMyAdmin
  export, outside the repo).
- **The dead code that only served the dropped tables is deleted, not left in
  place.** Reason (owner): it was reachable by URL with no front-end caller,
  and `save_history.php` built SQL by string concatenation. `js/db-local.js`
  was not in scope and still has an uncalled `saveGestureWord()` pointing at
  the removed `save_gesture_word` action.
- **The 5 `translations` rows from 2026-07-15 are deleted.** Reason: all 5 had
  `confidence = 0.95`, the constant hard-coded by the archived sign-to-text
  page (`sign-to-text-ui.js:639`). They were test output, not usage.
- **No Let's Talk conversation tables in this change.** Reason (owner): they
  come with the conversation-UI phase, together with a consent/retention
  decision. `talk.html` persists nothing to the DB today; `localStorage` holds
  only the skeleton toggle and the chosen microphone.

## Decisions made during the schema-normalization phase (2026-09-24)

- **Scope: normalize the schema for the thesis ERD with no behaviour change.**
  Reason (owner): remove duplicated data and misleading column names.
  Features, the on-disk sample format, the videos, and the kNN and
  frame-capture code stay exactly the same; security hardening (DEBT 72) is
  out of scope.
- **Target: 4 tables (`gestures`, `gesture_recordings`, `translations`,
  `users`). `esl_signs`/`fsl_signs` are folded into `gestures`
  (`asset_path`, `is_active`) and dropped.** Reason (measured 2026-09-24):
  the two tables mirror `gestures` one-to-one (0 missing, 0 extra per
  language). `description` is a per-language constant, `sign_label` and
  `text_value` equal the label with `_` turned into spaces (209/209), and
  `updated_at` is all NULL, so only `asset_path` and `is_active` are real
  data. `asset_path` cannot be derived (`one` → `1.webm` … `ten` →
  `10.webm`), so it is moved, not recomputed.
- **Full rename (option a): `gestures.word` → `label`,
  `gesture_recordings.sample_count` → `frame_count`, in the DB, PHP and
  tests.** Reason: 0 live JS reads `word`, `sample_count` or `gesture_type`
  from any API response (the dataset GET already sends `label`). The only
  JSON consumer affected is `reports.html` (6 references), which changes
  anyway because its source tables disappear. `sample_count` equals the
  landmark frame count on 210/210 rows.
- **Recordings lose `gesture_type`, `sign_language` and `thumbnail`.**
  Reason: `gesture_type` and `sign_language` equal the joined gesture's
  label and language on 210/210 rows. `thumbnail` is NULL on 210/210 rows
  and only dead `core_api.php` used it.
- **FK `gesture_recordings.gesture_id → gestures.id ON DELETE RESTRICT`,
  with `gesture_id NOT NULL`.** Reason: 0 orphans and 0 NULLs today, and the
  live code already deletes recordings before their gesture. RESTRICT turns
  a future ordering bug into an error instead of an orphan (owner-approved).
  Side effect: dead `admin_api.php` `delete_gesture`/`clear_gestures` now
  fail rather than orphan recordings.
- **`sample_path` becomes NOT NULL + UNIQUE.** Reason: the sync identifies
  an already-synced sample by `sample_path`; 210/210 are set and distinct.
  The index also removes one full-table scan per sample file during sync.
- **`landmark_json` is kept (owner decision).** Reason: within the DB it is
  the recording's own payload, not duplicated data. It duplicates the disk
  sample file, which is logged as debt rather than dropped.
- **`php/api/core_api.php`, `js/db-local.js` (and its `<script>` tag) and
  `scratch/trigger_sync.php` are deleted.** Reason: no live callers
  (owner-confirmed independently). Each references columns or tables this
  phase drops, and `trigger_sync.php` would recreate `esl_signs` and the old
  columns if run.
- **The migration is a CLI-only PHP script with ordered, idempotent,
  guarded steps plus a snapshot comparison before any drop; it is not one
  transaction.** Reason: MariaDB DDL commits implicitly. Re-running resumes
  at the first unfinished step, and destructive steps run only after every
  label and recording matches the pre-migration snapshot. The script starts
  with `if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }` because
  it lives under the web root (owner addition A).
- **The `asset_path` backfill for the 62 NULL rows is a separate task and
  commit, not part of the migration.** Reason (owner addition B): it keeps
  the migration's snapshot comparison exact. It fills a value only when
  `assets/signs/<en|fil>/<label>.webm` exists, and never overwrites a
  non-NULL value.
- **The live cutover (Task 2) is one task: backup, then migrate, then switch
  the code — not split across separate sessions or commits.** Reason:
  Apache serves the working tree live, and every non-`no_sync` GET to
  `save_gesture.php` runs `sync_disk_to_db`, which would call the
  soon-to-be-deleted `ensure_language_dataset_table()`/
  `save_gesture_to_language_dataset()` against a DB the migration had already
  reshaped if anything hit the endpoint mid-window — step 7's snapshot
  comparison would have aborted the migration rather than silently corrupt
  anything, but keeping the window short and single-task avoided relying on
  that safety net at all.
- **`tests/normalization/migration.test.mjs` clones from the pre-normalization
  backup (`E:\ACADSS\IOT\backups\sining_kamay_db_before-normalization.sql`,
  env `SK_NORMALIZATION_SOURCE_DUMP` to override), not the live DB, since the
  Task 4 addendum.** Reason: the file's tests assume the pre-migration
  6-table shape to exercise the migration end to end; after the Task 2
  cutover the live DB is already normalized and no longer has that shape. If
  the backup file is absent, the file's tests skip with a clear message
  instead of failing.
- **`db-schema/database_setup.sql` uses `CREATE TABLE IF NOT EXISTS` for all
  four tables, not a bare `CREATE TABLE`.** Reason: a Task 4 review found the
  bare form made the setup script fail on any re-run against a database that
  already had the tables, which defeats its purpose as a repeatable
  fresh-machine setup script (fixed in `1de77ac`).
- **`tests/normalization/schema-guard.test.mjs` is a whole-phase-review
  addition, not part of any single task**, guarding two things no earlier
  task's tests covered end to end: that a full disk-to-DB sync never
  recreates `esl_signs`/`fsl_signs` or the dropped columns and that the FK
  survives it, and that a second POST without a video never clears an
  already-set `asset_path`. Reason: the whole-phase review found no
  automated guard existed for either regression, only manual verification
  (fixed in `b36d38d`).
- **The only two visible differences on the live Reports page from this
  phase: the ID column now shows `gestures.id` (was `esl_signs.id`/
  `fsl_signs.id`), and `created_at` now comes from `gestures` (differs by up
  to 1 second on 4 of 209 rows, measured in the Step 1 proposal).** Every
  other visible column (Key, Label, Text, asset button) is unchanged, since
  `reports.html`'s `display_label` computation reproduces the old
  `sign_label`/`text_value` values exactly.

## Decisions made during the saved-conversations phase (2026-09-25)

Owner-approved proposal:
`docs/reports/2026-09-25-saved-conversations-step1.md`. Owner answers to the
proposal's five open questions (section (h)), plus two owner change-requests
folded into the tasks below.

- **`translations`: dropped outright (option A of three offered).** Reason
  (owner + measured evidence, proposal section (c)): the table had 0 rows
  (emptied in the 2026-09-24 DB cleanup); its only live writer, the
  gesture-training Step 4 `stop`-gesture branch, could never run because no
  `stop` gesture exists (`SELECT label FROM gestures WHERE label IN
  ('stop','start')` returned only `start/ESL`); its only reader with a live
  caller, the Reports Translations tab, always showed "No translation
  records found." Option B (drop the table and the two PHP endpoints, but
  leave `js/db-api.js` and its three dead call sites in place to 404/log
  harmlessly) and option C (leave `translations` alone, add Conversations as
  a 4th tab) were both considered and rejected — full removal leaves no dead
  code behind for a table that can no longer be written to. Executed across
  Tasks 5 (table + endpoints + `reports.php`/`reports.html`) and 6
  (`js/db-api.js`, its two `<script>` tags, and the three orphaned `DB_API`
  call sites).
- **The idle card's End Now → `'ended'`, not `'idle'`.** Reason (owner):
  `'idle'` describes the system's own return-to-dashboard timeout, not a
  person's deliberate tap. Only the countdown reaching 0 with no tap counts
  as `'idle'`; End Conversation and End Now both mean a person ended the
  conversation on purpose, so both map to `'ended'`.
- **`sign_language` is `NULL` for every hearing message, never the preview's
  sign set.** Reason (owner, proposal section (b) open question 3): a
  hearing person's spoken/typed text isn't signing input, and the
  word-by-word sign-video preview shown before Send/confirm is explicitly
  never stored in the thread (`js/sign-player.js`) — recording a sign
  language against text that was never actually signed would misrepresent
  what happened. The `messages` table's own CHECK constraint
  (`chk_messages_sign_language`) enforces this structurally: `sign_language`
  is non-NULL if and only if `speaker = 'signer'`.
- **Mic-then-edited text is `'speech'`, not `'typed'`** — i.e. the flag is
  "the mic wrote into the field since it was last empty," not "the mic wrote
  the exact final text." Reason (owner, proposal section (h) open question
  4, default accepted): a person who corrects a misheard word by typing over
  part of the transcript still spoke the message; only clearing the field to
  empty (a fresh compose) resets the source back to `'typed'`. Implemented
  as `speakingFromMic`, set `true` by `onTranscript()` (called after
  `js/talk-speaking.js`'s `renderTranscript()`/`stopCapture()` write into
  `#speaking-input`) and cleared to `false` only when the field's value is
  empty. **Whole-phase review correction:** the first implementation set
  `speakingFromMic = true` unconditionally inside `onTranscript`, which would
  incorrectly keep the flag `true` even if a partial transcript was retracted
  to an empty field by the recognizer itself (not by the person clearing it).
  Fixed to `speakingFromMic = input.value.trim() !== ''` — read the field's
  actual state at the moment `onTranscript` fires, rather than assuming any
  call means "the mic just added text" (`.git/sdd/conv-final-fix-report.md`).
- **`client_key` column added; `confidence` dropped.** Reason (owner,
  proposal section (b), open question 5, default accepted): `talk.html`
  never has a recognition score to store (`js/talk-signing.js:119-128` only
  ever produces label strings, never a confidence number), so `confidence`
  would be an invented field. `client_key` (32 lowercase hex chars from
  `crypto.getRandomValues`, made once per page load) exists because saving
  is fire-and-forget and every exit path navigates away immediately after
  calling `TalkHistory.end()` — the page can never wait for a server-assigned
  conversation id before it might unload, so the client supplies its own key
  and `INSERT ... ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)` does the
  rest server-side.
- **Two CHECK constraints added to `messages`, enforced by MariaDB 10.4, not
  just in PHP.** `chk_messages_speaker_source` (source can only be `sign` for
  the signer, and `speech`/`typed` for the hearing person) and
  `chk_messages_sign_language` (described above). Reason: MariaDB 10.4
  enforces CHECK constraints natively (confirmed in Task 1 by a rolled-back
  transaction that triggered error 4025 for an invalid combination), so the
  invariant holds even if a future caller bypasses `save_conversation.php`'s
  own PHP-side mirror of the same rules.
- **`end` never creates a row — it only ever `UPDATE`s.** Reason: every
  conversation row must have come from at least one real message; a
  conversation "ended" with zero messages would be meaningless in Reports.
  The accepted cost is the known edge case in `DEBT.md` item 78: End tapped
  within the still-in-flight first message's save round trip can leave
  `ended_at` NULL if the `end` request's `UPDATE` reaches the server before
  the `message` request's `INSERT` does (0 rows matched, since the
  conversation doesn't exist yet) — no message is lost, only the end
  timestamp/reason.
- **Owner change A — `db-schema/database_setup.sql` uses `CREATE TABLE IF NOT
  EXISTS` for the two new tables too**, matching the existing `gestures`/
  `gesture_recordings` convention (and the same fix already applied to those
  two tables during the earlier schema-normalization phase) rather than a
  bare `CREATE TABLE` — keeps the script safe to re-run on a database that
  already has the tables.
- **Probe-key prefix changed from the plan's `zz` to `deadbeef00000000`.**
  Reason: `client_key` must match `/^[0-9a-f]{32}$/` (hex digits only), and
  `z` is not a hex digit — a literal `zz`-prefixed key is rejected by the
  endpoint's own validation before it could ever serve as a probe. `dead`
  (all valid hex digits) was used first (Task 2), then lengthened to the
  16-hex-char `deadbeef00000000` in Task 3 to reduce the chance of an
  accidental collision with a real key under the shorter prefix's cleanup
  `LIKE` pattern. The `clear_all` test additionally requires an opt-in
  environment variable, `SK_ALLOW_CLEAR_ALL=1`, added during the whole-phase
  review fix pass — without it the test self-skips rather than deleting
  every row in `conversations`, even when every current row is a probe.
- **Reports Conversations tab loads only after the PIN, unlike
  `reports.php`'s ESL/FSL data (still fetched at page load).** Reason
  (proposal, "Privacy finding"): `reports.php`'s gesture dictionary isn't
  private and was already fetched pre-PIN; conversation contents are
  private and the proposal treats "fetched before PIN entry" as equivalent
  to "readable without the PIN," so `loadConversations()` is called only
  from `trVerifyPin()`'s success branch, never at page load and never from
  anywhere else.
- **Owner change C — the live conversation's own bubble label (Typed /
  Spoken / Signed) is driven by `source`, replacing the earlier
  fake-data-phase behavior where every hearing bubble read "Spoken"
  regardless of how the text was entered.** Reason: once `source` exists to
  distinguish speech from typed text, showing the wrong verb in the same
  session where the two are now genuinely different would be misleading two
  ways at once — needlessly so, since the message causing it is `talk.html`'s
  own submission.
- **Reports' thread-view bubbles reuse `talk.html`'s own bubble CSS (signer
  left/white/bordered, hearing right/navy/white text), not a new visual
  style.** Reason: the thread modal is showing the same kind of content
  `talk.html` itself renders live; a different look for the same data would
  read as a second, unrelated design system rather than "this is what that
  conversation looked like."
- **Confirm step for Delete/Clear all is an in-page confirm card, not
  `window.confirm`.** Reason: matches every other confirmation surface
  already in this codebase (talk.html's own modals); `window.confirm` is a
  blocking native dialog with no styling control and is inconsistent with
  the rest of the kiosk UI.

## Decisions made during the video-based gesture capture phase (2026-09-26)

Replaces `gesture-training.html` Step 1's old live-capture path (countdown,
frame sampling, "Start Capture"/"Record another sample" preview flow, the "G"
hotkey) with a record-first/extract-later flow: a full-screen mode
(`js/gesture-capture-ui.js`, `#gcMode` in `gesture-training.html:357`) records
one MediaRecorder video of hand-driven REST → SIGN 1/2/3 reps, then extracts
per-frame MediaPipe landmarks offline by seeking through the recording
(`js/video-landmarks.js`), segments it into exactly 3 reps
(`js/capture-core.js`), and saves each rep as a v3 raw landmark sample —
never the video itself. Owner-approved proposal:
`docs/reports/2026-09-26-video-capture-step1.md`. Per-task reports with
measurements: `.git/sdd/vc-task-1-report.md` … `vc-task-6-report.md` (Task 5
has two fix rounds appended).

### Owner decisions (2026-09-26 approval message)

- **Record first, extract later; full-screen mode opened from the Add Data
  form; hand-driven REST / SIGN n of 3, no fixed per-rep timers.** The "Record
  3 samples" button (`gesture-training.html:224`) calls `openRecordingMode()`
  (`js/gesture-training-ui.js:1325-1342`), which opens
  `window.GestureCaptureUI` (`js/gesture-capture-ui.js:183-202`). Thresholds
  live in `js/capture-core.js:10-21`: `REST_MS 1000`, `MIN_REP_MS 300`,
  `MAX_REP_MS 20000`, `NO_HAND_HINT_MS 10000`, `REQUIRED_REPS 3`.
- **Q1 — Review shows the live count; the offline re-segmentation on Save is
  the real gate.** The Review screen's "N signs found" is `reviewCount`, the
  live segmenter's `repsDone` at recording-stop time
  (`js/gesture-capture-ui.js:495`, `:524-530`). Tapping Save re-segments the
  *offline*, seek-extracted frames from scratch (`segmentFrames`,
  `js/capture-core.js:165-232`, called at `js/gesture-capture-ui.js:582-585`)
  — that second pass, not the live count, decides whether the recording is
  accepted.
- **Q2 — no extra `REST_MS` after a rep; the gap that ends a rep is the
  rest.** `closeRepAt()` (`js/capture-core.js:45-63`) fires once
  `tMs - lastHandMs >= REST_MS` and immediately moves to `wait-hand` for the
  next rep — there is no second, separate rest window layered on top.
- **Q3 — `STOP_TAIL_MS` 500.** (`js/capture-core.js:17`). Recording keeps
  rolling for 500ms after the 3rd rep closes before stopping for review
  (`setTimeout(function () { stopForReview(r); }, C().STOP_TAIL_MS)`,
  `js/gesture-capture-ui.js:423`), so the tail of the 3rd sign isn't clipped.
- **Q4 — coordinates rounded to 4 decimals, score to 3.**
  (`js/video-landmarks.js:207-211`: `round(p.x/y/z, 4)`,
  `round(handedness.score, 3)`).
- **Q5 — store native `videoWidth`/`videoHeight` AND the 320×240 input +
  `contentRect`.** Both come back from `extractVideoLandmarks()`
  (`js/video-landmarks.js:219-226`) and are persisted verbatim into the v3
  sample's `input`/`videoWidth`/`videoHeight` fields
  (`php/api/save_gesture.php:459-471`).
- **Q6 — hint "Lower your hands first." when hands stay up during REST for
  `NO_HAND_HINT_MS`.** (`js/gesture-capture-ui.js:453-457`).
- **Q7 — Cancel may abort during extraction; hidden from the moment the 3
  saves start until they finish; the failed-save Cancel escape hatch is
  kept.** Extraction is abortable via an `AbortController`
  (`js/gesture-capture-ui.js:536-542`, `:550-563`). Once `runSaves()` begins
  its sequential saves, the Cancel button is hidden (`view({..., cancel:
  false})`, `:632`) — a normal 3-for-3 save can no longer be interrupted —
  but if a save fails partway, the resulting error state re-shows a Retry
  save action and, per `onCancel()` (`:718-721`), Cancel there still works
  and keeps whatever was already saved (routes into `finishSaved()`,
  `:695-716`, same as a clean finish).
- **Q8 — old live-capture code removed.** The pre-phase countdown/preview
  flow (formerly `gesture-training-ui.js`'s countdown and
  `#step1PreviewControls`/`#countdownOverlay` markup) and
  `js/gesture-data.js`'s `FRAME_TARGET`, `captureFrameIfRecording()` and the
  "G" hotkey/`prompt()` label-entry path are all gone — grep-confirmed absent
  from `js/gesture-data.js` (only a comment at `:2` refers to the removed
  `FRAME_TARGET` for context). The new countdown lives entirely in
  `js/gesture-capture-ui.js:304-321`.
- **Addition A — v3 rows evenly subsampled to at most 30 per sample.**
  `recordingToFeatureRows()`'s raw-format branch
  (`js/gesture-data.js:677-695`, `MAX_ROWS_PER_RAW_SAMPLE = 30` at `:4`)
  subsamples any rep longer than 30 hand-present rows by taking
  `rows[Math.round(i*(n-1)/(MAX_ROWS_PER_RAW_SAMPLE-1))]` for
  `i in [0, 30)` — v2's own branch (`:697-699`) is untouched. The keyframes
  phase replaces this even subsampling with a smarter selection.
- **Addition B — extractor input canvas size is a parameter (default
  320×240) for the import phase.** `extractVideoLandmarks(source, options)`
  reads `opts.inputWidth`/`opts.inputHeight`, defaulting to 320/240
  (`js/video-landmarks.js:115-116`).
- **Addition C — all recording-mode text is English.** Every prompt/hint/
  message string in `js/gesture-capture-ui.js` (`MSG` at `:29-35`; "REST"/
  "SIGN N of 3" at `:443-447`; hints at `:454-456`) is English, matching the
  rest of the kiosk's admin-only training screen.

### Decisions made during execution (controller/implementation)

- **Seek-based extraction (deterministic, not bound to playback speed);
  seek grid computed as `t = k/fps` via `seekTimes()`.** An earlier
  accumulating-loop version (`for (t = 0; t < duration; t += 1/fps)`) drifts
  off by one step from float error (e.g. duration=2, fps=15 gives 31 steps
  instead of 30) — found in review. `seekTimes(duration, fps)`
  (`js/video-landmarks.js:35-42`) instead derives each `t` as `k/fps` for a
  fixed `k` in `[0, ceil(duration*fps))`, exact for any `k`.
- **`PROCESS_FPS` 15** (`js/capture-core.js:16`). Evidence in the Step 1
  proposal, `docs/reports/2026-09-26-video-capture-step1.md`, section (d).
- **ONE shared `Hands` instance.** `createVideoDetector()`
  (`js/gesture-data.js:452-602`) pauses the live camera hand loop, waits out
  any in-flight `hands.send()`, then routes each subsequent `onResults`
  callback directly to the extractor's `detect(canvas)` promise
  (`detectorMode`, `:478`); `release()` (`:579-599`) defers turning detector
  mode off and resuming the live loop until the last outstanding send is
  accounted for (`finishReleaseIfReady`, `:488-503`), and resets the tracker
  (`state.hands.reset()`, `:497-501`) before the live loop resumes. The
  shared `letterboxRect()` helper (`js/gesture-data.js:39-57`) lives in
  `gesture-data.js`, not `capture-core.js`, because `talk.html` loads
  `gesture-data.js` but not `capture-core.js`, and both the live camera loop
  and `extractVideoLandmarks()` (`js/video-landmarks.js:175`) need the exact
  same fit math.
- **v3 samples stored as COMPACT JSON; v2 stays pretty-printed.** A
  pretty-printed 301-frame sample (~1.18 MB) exceeded MariaDB's
  `max_allowed_packet` (1 MiB, `C:\xampp\mysql\bin\my.ini:37`) and the
  `gesture_recordings` insert failed. `php/api/save_gesture.php:485-489`
  encodes v3 with `json_encode($recording, $isV3 ? 0 : JSON_PRETTY_PRINT)` —
  v2's on-disk format is untouched, byte-for-byte. Owner may overrule this
  (alternative considered: raise `max_allowed_packet` instead).
- **Frame cap in `save_gesture.php`: 120 → `MAX_FRAMES_PER_SAMPLE` 301 (=
  `MAX_FRAMES_PER_REP`).** (`php/api/save_gesture.php:39`, checked at
  `:402-404`).
- **Hard save failure: "Retry save" re-sends only unsaved reps; Cancel is the
  only other exit there and keeps what was saved.** `runSaves()`
  (`js/gesture-capture-ui.js:626-670`) skips any rep already marked `saved`,
  so a retry after a partial failure only re-POSTs the reps that didn't make
  it. `onCancel()` (`:718-721`) in the error state routes into `finishSaved()`
  (`:695-716`), which runs the same Done post-save steps (cache invalidation,
  `reloadDataset()`, sample-line refresh) and toasts "N of 3 samples saved
  for "label"." (`:715`) — an escape hatch for a server that keeps failing.
  A user Cancel during *normal* (non-error) saving is impossible: the Cancel
  button is hidden for the whole `runSaves()` duration (`view({..., cancel:
  false})`, `:632`).
- **Sample-line frames after a recording come from `reloadDataset()`'s
  recount, not an added `frameCount`.** `window.onCaptureSamplesSaved`
  (`js/gesture-training-ui.js:1348-1351`) is called with `{label,
  signLanguage, labelSampleCount}` — no `frameCount` — so `noteSampleSaved()`
  (`:306-311`)'s `e.frames += res.frameCount || 0` adds 0; the real per-label
  frame tally comes from `rebuildSampleInfo()` (`:298-304`), run against the
  fresh dataset `js/gesture-capture-ui.js:701-703`'s `window.reloadDataset()`
  fetches immediately before the callback fires.
- **`RESULTS_WATCHDOG_MS` 5000 (whole-phase review addition): no
  hand-tracking results for 5s during recording → "Hand tracking is not
  ready. Please try again." with Redo/Cancel.** (`js/capture-core.js:19`;
  `armWatchdog()`/`MSG.notReady` at `js/gesture-capture-ui.js:427-436`,
  `:31`). Re-armed at the recording's time origin and on every live result,
  so it only fires on a genuine stall, not at the very start.
- **Deviations — acknowledged by the owner 2026-09-27, kept as is:**
  - The too-many-reps message shows N=4 when `repsFound <= 3`
    (`segmentFailureMessage()`, `js/gesture-capture-ui.js:614-623`) — an open
    4th sign leaves `repsFound` at 3 (the 4th rep is still open, never
    closed), so the message bumps `n` to `total + 1` rather than reporting
    the technically-true 3.
  - "1 sign found" is grammatically singular but paired with a disabled Save
    button regardless, since Save requires exactly `REQUIRED_REPS`
    (`js/gesture-capture-ui.js:527`, `:530`).
  - `docs/system/UI.md` Part 2 §3's Step 1 instruction bullet 3 was rewritten
    to describe the new record-first flow instead of the removed zoom/pan
    preview it used to describe.

### Measured results (Task 6 e2e, headless Chrome 153, this laptop, fake camera from `hello.webm`)

- Recording auto-stopped after 11,851 ms; prompt sequence REST → SIGN 1..3
  advanced by hand presence.
- Processing (extraction + segmentation): 6,113 ms for that recording.
- Per-rep frames 17/17/17; sample files 14,861 / 14,868 / 14,849 bytes
  (compact v3).
- 0 of 31 requests carried `video_base64`/`video_path`; `assets/signs/`
  listing identical before/after.
- Train AI: 121 gestures, `trainData` for the new label = 51 rows (≤ 90);
  Predict ran and predicted the label.
- "G" key does nothing; 0 console errors. Golden test: 210 existing sample
  files / 3,232 rows identical to `813bfbe`.
- Test suites: `node --test --test-concurrency=1 tests/video-capture/*.test.mjs`
  45/45; `extractor-check` 28 PASS; `capture-ui-check` 74 PASS; `e2e` 52 PASS.
- **Pi: NOTHING measured** — processing time, live-loop results/s, seek cost,
  `max_allowed_packet` (see `docs/system/DEBT.md`).

(All measured, Task 6 e2e run, `.git/sdd/vc-task-6-report.md`.)

### Owner decisions on the final report (2026-09-27)

Source: the owner's reply to `docs/reports/2026-09-26-video-capture-final.md`
("Open for the owner", items 1-7).

- **Compact JSON for v3 samples: approved.** Reason: a pretty-printed
  301-frame sample exceeded MariaDB's `max_allowed_packet=1M` on this
  machine (`C:\xampp\mysql\bin\my.ini:37`). A pre-deploy check was added to
  `docs/system/MANUAL-CHECKS.md`: on the Pi, `SHOW VARIABLES LIKE
  'max_allowed_packet';` must be >= 1M. `docs/system/DEBT.md` item 87 stays open.
- **`MAX_RECORDING_MS` = 90000 caps the whole take.** (`js/capture-core.js:20`,
  enforced in the segmenter at `:80-84`.) Reaching it before the take is
  `done` stops and discards the recording with "Recording too long. Try
  again." and Redo (Cancel top-right) (`js/gesture-capture-ui.js:33`, `:416-419`;
  offline via `segmentFailureMessage()`, `:617`). It lives in the segmenter,
  not in a UI timer, so live and offline apply the same rule. The owner's
  "no fixed timers per repetition" still holds: this bounds the take, not a
  rep. Closes `docs/system/DEBT.md` item 89.
- **Rep edges (hand entering/leaving the frame): accepted as is until the
  keyframes phase.** `docs/system/DEBT.md` item 88 stays open.
- **Retry save not idempotent: accepted.** `docs/system/DEBT.md` item 90 stays
  open.
- **Wording deviations (N=4 too-many message, "1 sign found", Step 1
  instruction bullet 3): acknowledged, kept.**

## Decisions made during the capture UI layout fix (2026-09-27)

Report: `docs/reports/2026-09-27-capture-ui-final.md`. Owner decisions (settled in the phase
prompt): the full-viewport 3-row overlay and Step 1 without a camera feed. Decisions made
while implementing them:

- **Step 1's camera panel is moved off-screen, not `display:none`.** Reason: the live
  MediaPipe loop keeps drawing from `#videoFeed` while the recording mode is open, and the
  page already hides it this way for Step 2 "to prevent Chromium freezes on Pi"
  (`css/gesture-training.css`). One `#videoFeed` stays shared with Steps 3/4.
- **The recording mode stops only a camera it started itself.** (`cameraOwnedByCapture`,
  `js/gesture-training-ui.js:1117-1155`.) Reason: the owner said the camera starts when the
  mode opens and stops when it closes. The owner also said Steps 2-4 keep their camera
  behaviour, so a camera the user already enabled in Step 3/4 is left running. Enable
  Camera and the recording mode share one `startPageCamera()`, so Steps 3/4 behave as
  before. After a closed recording mode, Step 3/4 show "Camera Off" and the Enable
  Camera button, as on first visit.
- **"Detector ready" means the first live hand-tracking result.** Reason: that is the moment
  the guidance can work. Its own bound, `READY_TIMEOUT_MS` 60000 (was 30000)
  (`js/gesture-capture-ui.js:41`), is kept separate from `RESULTS_WATCHDOG_MS` 5000
  (`js/capture-core.js`, untouched), because a first MediaPipe load is slower. The load
  measured about 11 s in headless Chrome on this laptop; the Pi is not measured.
- **START moved from the centre of the video into the bottom bar.** Reason: the owner's rule
  is that each state's buttons sit in the bottom bar and share its width. The video stays
  unobstructed in Ready.
- **Redo goes back through "Starting camera".** Reason: it restarts a camera that stopped, and
  it resumes a paused live loop through `acquireCaptureCamera()`, which partly addresses
  `docs/system/DEBT.md` item 91.
- **Cancel is only the top-right button.** (Owner follow-up, 2026-09-27.) Before that follow-up,
  error states also showed Cancel in the bottom bar. The owner removed it: errors show Redo
  alone, a failed save shows Retry save alone, full width.
- **The chip wraps to two lines instead of truncating.** Reason: at 1024 px the chip column
  is about 230 px wide. A single line hid the sign set and type behind an ellipsis
  ("zz_capture_ui_shots · E…", seen in the first screenshot run).

### Owner follow-up on the capture UI layout fix (2026-09-27)

Source: the owner's review of `docs/reports/2026-09-27-capture-ui-final.md` ("Owner follow-up"
section there has every measured number).

- **Cancel only top-right** (owner): the bottom bar shows Redo alone in error states and Retry
  save alone after a failed save (`js/gesture-capture-ui.js` `showError()` / `runSaves()`;
  `#gcCancelBottom` removed).
- **`READY_TIMEOUT_MS` = 60000** (owner; was 30000), `js/gesture-capture-ui.js:41`.
- **Warm up the Hands detector at page load, reusing one instance** (owner), with one addition
  made while implementing it: the warm-up also runs **one detection on a blank frame**, not
  only the model init. Reason: with `preloadMediaPipe()` alone (WASM + model + `initialize()`,
  done in 763 ms) the first open still took 11,157 ms. The cost is MediaPipe's first
  inference, one ~11.6-11.8 s main-thread long task in headless Chrome here. A blank-frame
  detection needs no camera and no results loop (it goes through `createVideoDetector()`,
  which leaves the loop paused).
- **The warm-up starts at the beginning of `DOMContentLoaded`, not after the dataset load.**
  Reason: started after the first dataset merge, its long task overlapped the second dataset
  fetch in `renderSavedDataset()`, and the dataset count appeared at 22.1 / 22.4 s after
  navigation (baseline 8.3 / 18.5 s). Started first, the long task runs while the PIN screen
  is up and the count appeared at 16.8 / 15.8 s.
- **Accepted cost, owner to confirm:** the page does not respond for about 12 s once, shortly
  after it loads (taps are queued). On the Pi this is expected to be longer (not measured).
  Before the warm-up, the same block happened after tapping Record 3 samples, while
  "Starting camera…" was showing.



## Decisions made during the sign-texts phase (2026-10-04)

Phase "one sign, two texts (ESL / FSL / Both)". Source: the approved proposal
`docs/reports/2026-10-04-sign-texts-step1.md` (owner decisions 1-7 given in the task; Q1-Q15 there were all approved at
their recommended default), the task reports `.git/sdd/st-task-{1,2,4,5,6,7,8}-report.md`,
`st-final-fix-report.md`, and the ledger `.git/sdd/progress.md`. Where the numbers come from is cited in
`docs/system/BACKEND.md` ("One sign, two texts", "The 2026-10-04 sign-texts migration"), `docs/system/UI.md` Part 2
("Sign texts") and Part 3d, and `docs/system/ML.md`.

### Owner decisions (task prompt)

1. **Step 1 (Add Data) Sign Set has three options: ESL | FSL | Both.**
2. **Two text fields replace Gesture Name: "English text" and "Filipino text".** ESL shows English only, FSL shows
   Filipino only, Both shows both; each shown field is required. Texts keep their casing and punctuation ("How are
   you?" / "Kumusta ka?"). The internal key (folder/label slug) is derived, never typed.
3. **Samples are stored once per sign.** No copying between folders.
4. **Recognition:** the ESL model uses signs whose set is ESL or Both and outputs the English text; the FSL model uses
   FSL or Both and outputs the Filipino text. Text-to-sign looks a sign up by the text of the active language.
5. **View Active Gesture Dataset can edit a sign's set and both texts without re-recording**, and shows both texts.
6. **Existing FSL signs that copy an ESL recording merge into that ESL sign as Both** (the Tagalog label becomes the
   draft Filipino text). Duplicate files leave the active dataset only after file-by-file proof of identical landmark
   data; they are moved to a backup folder, never deleted.
7. **Demo system: no security work** (`docs/system/DEBT.md` item 72 stays open). This is why `signs.php` has no auth.

### Q1-Q15 (all approved at the recommended default)

| Q | Decision | Reason given in the proposal |
|---|---|---|
| 1 | Keep the column name `gestures.sign_language`, widen it to `ENUM('ESL','FSL','BOTH')` (no rename to `sign_set`). | No test churn. |
| 2 | One folder `saved_gestures/<key>/` for every set; `saved_gestures_fsl/` is never written again but still read (legacy). | Samples stored once (decision 3). |
| 3 | Set and texts live on disk in a per-sign `saved_gestures/<key>/sign.json` (disk is the truth); `category` stays DB-only, unchanged rules. | Disk is already the source of truth (BACKEND "sync_db_to_disk explicitly disabled"). |
| 4 | Key collision: same set adds samples and updates the texts; a different set is blocked with HTTP 409 `{success:false, error, existingSet}` and a message in the UI, and the user edits it in the dataset view first. | Proposal: edit the set in the dataset view first. |
| 5 | New sample files keep the v2/v3 formats; their `signLanguage` field is `ESL` for ESL and Both signs, `FSL` for FSL signs; `sign.json`, not the sample, decides the set. | Format stays unchanged. |
| 6 | Draft text rule: label with `_` → space, first character upper-cased (`kamusta_ka` → `Kamusta ka`). The owner corrects drafts afterwards, including apostrophes ("Don't"). | Decision 6: the Tagalog label becomes the draft Filipino text. |
| 7 | The 18 category conflicts between an FSL copy and its ESL twin are resolved by keeping the **ESL sign's** category. | Merged Both signs keep the ESL row's category. |
| 8 | `makita` / `see` merge as Both on the landmark proof, keeping `asset_path` `assets/signs/en/see.webm`; `assets/signs/fil/makita.webm` stays on disk and still plays for FSL "Makita". | Proposal: the first-step probe `assets/signs/fil/<normalized_text>.webm` runs before the asset map (`js/sign-player.js:378` at the time of the proposal). The alternative, leaving it FSL-only, would contradict the data proof. |
| 9 | The stray `saved_gestures_fsl/sample_1784112605537_bec003.json` (label `""`, 20 frames, identical to `saved_gestures/my_name/sample_1784112605409_7920b5.json`) moves to the backup as a proven duplicate. | No code read it (sync/list scan subfolders only). |
| 10 | Narrowing a sign's set (Both → ESL) keeps the now-hidden text stored, unused. | Switching back restores it. Implemented in `signs.php:115-119` and by sending the hidden field as `null` from the UI. |
| 11 | Add `- ' , . ? !` to the last row of `js/virtual-keyboard.js` (5 rows, height unchanged at 280 px). This also changes `talk.html`'s keyboard. | Without it "How are you?" cannot be typed on the kiosk. |
| 12 | Step 2 gets an "AI model: ESL \| FSL" toggle that defaults from Step 1 (Both → ESL). | Train AI and Predict must know which model. |
| 13 | One-time `localStorage` model reset (`sining_kamay_model_schema` = `"2"`). | No stale Tagalog-keyed model may survive in `talk.html`. |
| 14 | Reports columns become ID \| Key \| Set \| Text \| Asset \| Created. | Both signs appear in both tabs. |
| 15 | Three commits: code / data / docs. | Keeps the 90 file removals and 120 `sign.json` adds out of the code diff. |

**Addition during execution (owner):** the owner's untracked `saved_gestures/hi/` and `saved_gestures/yow/`
(3 samples each) are real data, so they get a `sign.json` (set ESL) like the rest and go into the data commit
(`5ec84dd`: 122 `sign.json`, `hi`/`yow` samples added, 90 `saved_gestures_fsl` files removed).

### Decisions made during execution (controller / implementation)

- **The live migration ran before the server task (Task 3 before Task 2).** Reason: so the server code and its tests ran
  against the migrated schema and data (`.git/sdd/progress.md`). The old `save_gesture.php` was then used for one full GET
  (122 / 127 unchanged) before being replaced.
- **Backups before anything moved:** a `mysqldump` of 10,132,052 bytes, a copy of the dataset (217 files), a
  `snapshot.json` and a `moved-manifest.json` of 90 entries, in `E:\ACADSS\IOT\backups\2026-10-04-sign-texts\`. The script
  repeats the identical-frames proof file by file before it moves and re-proves against the twin right before each delete
  (`BACKEND.md` migration steps 2 and 5).
- **Migration step 4 only fills rows whose texts are both NULL.** Reason (Task 1): a re-run or a resume must never
  clobber a later edit made in the dataset view.
- **Migration step 7 refuses if a label is duplicated and drafts any still-missing required text before adding the
  CHECK** (`db-schema/migrations/2026-10-04-sign-texts.php:458-485`; Task 1 report).
- **The migration carries its own helper copies** (`draftText`, JSON writer) instead of requiring `sign_meta.php`
  (`db-schema/migrations/2026-10-04-sign-texts.php:108-113`, `:167`); the task report does not state a reason.
- **`derive_sign` always fills a text the set requires with the draft** (`php/api/sign_meta.php:93-98`). Reason (Task 2): the
  sync can then never violate `chk_gestures_texts`, even for a hand-edited `sign.json` with a missing text.
- **`signs.php` update requires the *shown* texts to be sent non-empty, even if a stored value exists; only the *hidden* text
  falls back to the stored one** (`php/api/signs.php:100-119`). Brief ambiguity resolved in Task 2; the UI therefore always
  sends the shown fields and `null` for the hidden one.
- **Collision check order:** `saved_gestures/` sign.json or samples, then the legacy `saved_gestures_fsl/`, then the DB row
  (`save_gesture.php:475-496`); an empty folder with neither is not an existing sign. A legacy-FSL-folder sign saved again
  goes to `saved_gestures/<key>` and never writes the legacy folder.
- **The ESL / FSL model membership is decided purely by `signs[key].set`** (a Both sign trains both models, and the
  hidden-field text is not part of any model). `trainModel()` / `mergeSavedGestureSamples()` changed only in the source of
  `targetLang` and the filter `itemLang === targetLang || itemLang === 'BOTH'`; `knnPredict` and `cosineSimilarity` are
  untouched (`docs/system/ML.md`).
- **Step 4 keeps its own Output Language chip** (not the Step 2 model toggle): per the brief, Step 4's own toggle is independent of
  the model (`.git/sdd/st-task-4-report.md` concern 3). Its known gap is in `DEBT.md`.
- **Dataset-modal edit uses a panel inside the same card, not a second modal** (the task report gives no further reason); it was
  measured to fit with the keyboard open (card h=289, bottom 297, keyboard top 320). A text the set does not use shows "—" in
  the table even if stored.
- **Table and search:** search matches the key, both texts and also a stored hidden text (a Task 5 minor, left as is); the Delete
  confirm names the sign by English text, else Filipino text, else key.
- **Full-sync performance fix (Task 2 fix round 1, commit `78df63d`).** The first sync called `save_gesture_word_to_db()` per
  label (four `SHOW COLUMNS` + upsert + category read-back each): a full GET measured **12.2-14.5 s** against 1.75-2.30 s for
  the pre-phase code. Decision: one column check per request, load all `gestures` rows and all recorded `sample_path`s once,
  upsert a label only when it differs from `derive_sign()`, skip the category read-back (sync passes no category, so a manual
  re-tag is still never overwritten). After the fix and the whole-phase fix: 0.76 / 0.77 / 0.83 s (`BACKEND.md`).
- **Text-to-sign "?" registration fix (Task 6 fix round 1, commit `0fc2c56`).** `normalizeSpeechText` keeps "?", but speech never
  produces it and typed text may. Decision: register both the normalized text and the same text with `[?¿]` removed, with the
  no-overwrite rule unchanged (`js/sign-player.js:246-275`). The Task 6 review had found "'?' not normalized in text-to-sign
  registration" (`.git/sdd/progress.md`).
- **A Both sign's English clip serves the Filipino map too** (its `assetPath` is an `en/` path). By design per the proposal;
  the first-step probe `assets/signs/fil/<text>.webm` wins first when it exists (live check: FIL "kamusta ka" played
  `fil/kamusta_ka.webm`, not the map value).
- **`escapeHtml` fix (whole-phase review Imp1, commit `16c15ce`).** User-entered sign texts reached `innerHTML` in Step 4 and,
  latently, in `js/sign-to-text-ui.js`. Decision: add `escapeHtml()` (`js/gesture-training-ui.js:625`,
  `js/sign-to-text-ui.js:4`) at every `innerHTML` site that carries a sign text (same spans and classes); sites carrying only
  slug keys, static strings or `err.message` were left alone. The dataset modal and Reports were already text-safe (DOM +
  `textContent`; Reports' View Asset handler switched to `JSON.stringify`).
- **Upgrade path for a pre-phase database (whole-phase review, commit `16c15ce`).** `ensure_gestures_columns()` widens the enum to
  include `BOTH`, swaps `uq_gestures_label_language` for `uq_gestures_label` **only when no label is duplicated**, adds
  `text_en`/`text_fil`, and **never adds the CHECK** (the setup SQL and the migration own it, per the comments at
  `php/api/gesture_category.php:73` and `:118-119`; PHP writes the required texts regardless). With duplicate labels the old key is kept and the swap retries on a
  later request. `BACKEND.md` "Upgrade of a pre-phase database".
- **`maxlength="255"` on all four text inputs and the Step 2 toggle lock while training (commit `16c15ce`).** The server caps
  texts at 255 characters (400 above); the lock exists because `trainModel()` reads the language at the start and saves
  per-language state at the end.
- **The check scripts were adapted to the removed `#gestureLabelInput`** (`e2e.mjs`, `screenshots.mjs`, `startup-check.mjs`,
  `capture-ui-check.mjs` fill `#signTextEn`); `screenshots.mjs` now reads START before the screenshot (a race with the faster
  camera start) and `startup-check.mjs` retries `rmSync` (a Windows file lock). Task 8 reverted the `docs/reports/img/*.png` that
  `screenshots.mjs` rewrites so no image was committed.

### Measured results (cited, not estimated)

- Migration live result: 90 proven, 122 `sign.json` written, 90 moved (manifest 90), 89 recordings + 89 gestures deleted; ESL 33 /
  BOTH 89 = 122 gestures, 127 recordings, 216/216 snapshot recordings reachable, 0 missing, 0 folders without `sign.json`
  (`.git/sdd/st-task-3-migration-output.txt`; re-confirmed by Task 8, 90/90 sha256 match).
- Whole-phase suite: **188 tests, 187 pass, 0 fail, 1 skip** (baseline 141 / 140 / 0 / 1); `verify-e2e.mjs` 80 PASS; the
  capture-ui, step1, dataset, talk, reports-keyboard and xss check scripts pass (`st-task-8-report.md`, `st-final-fix-report.md`).
- `startup-check.mjs`: first open START enabled in 1,027 ms (the previous `UI.md` figure was 1,858 / 1,505 ms for the first open,
  `.git/sdd/st-task-8-report.md` item 9); camera-to-first-result 153 ms, `trainMs` 1,694.
- `e2e.mjs`: ready 1,016 ms, recording auto-stopped after 15,753 ms, processing 13,623 ms, per-rep frames [18, 17, 17], Train
  "Complete! — 123 gestures ready" in 2,109 ms.

## Decisions made during the 2D avatar phase (2026-10-05)

Phase "2D avatar for text-to-sign". Source: the approved proposal `docs/reports/2026-10-05-avatar-step1.md`
(owner decisions 1-10 in the task prompt; all 16 open questions at the recommended default except Q1),
the owner's approval message, and the final report `docs/reports/2026-10-05-avatar-final.md`.

### Owner decisions (task prompt and approval)

1. **A 2D cut-out puppet on a canvas** (vanilla JS, offline, no build step). Four PNG parts (head, torso,
   upper arm, forearm; the arm is mirrored for the other side); hands are drawn by code from the 21 hand
   landmarks so fingers bend.
2. **Motion = pose + both hands from MediaPipe Holistic**, vendored in `js/lib/holistic/`, run only on the
   admin page, never on the kiosk's Let's Talk screens.
3. **One avatar clip per sign**, stored once with the sign (ESL, FSL and Both share it), from ONE signer.
   Recognition samples and the avatar clip are independent: changing one never touches the other.
4. **Admin page "Avatar clips"** (`avatar-clips.html`): pick a sign, pick a video, extract with progress and
   a skeleton overlay, auto-trim with manual handles, preview, Save / Redo / Delete. The video is never
   uploaded or stored.
5. **Player:** clips back to back, ~250 ms blend end-pose -> start-pose, no drop to rest between signs, rest
   before the first and after the last.
6. **Let's Talk Speak or Type uses the avatar**; a word with no clip falls back to today's video. Captions and
   the thread unchanged; no new buttons or screens.
7. **Fix the prototype's problems:** stretched arms, the face-region collision, the stiff fallback hand, the
   sleeve separating from the shoulder.
8. **No security work** (DEBT 72 stays open).
9. **The page opens from a button next to "View Active Gesture Dataset", behind the same PIN**; the dataset
   table shows which signs have a clip; extraction runs on the laptop, the Pi only plays.
10. **Light kiosk player:** PNGs at Let's Talk load, clips on demand with a small cache, hand tracking paused
   while the avatar plays.
- **At approval (replaces part of decision 5 and Q11): flat 2D only.** Solid colours as in the PNGs and the
  prototype's "flat" mode: no gradient shading, no blur, no hand or floor shadow, no `ctx.filter`, no quality
  tiers or step-down code. Blink, slight breathing and depth ordering (far parts first) stay; the avatar
  paints its own light background.
- **At approval (Q1): only the SIMD Holistic build is vendored.** Extraction runs on the laptop; without
  WebAssembly SIMD the admin page says so instead of failing silently.

### Decisions made during execution

- **Retargeting is new code, not a port.** The prototype's frames were mapped outside its page with one uniform
  scale (step 1 report (d)); the player retargets at play time: bone direction and 2D foreshortening from the
  signer, bone lengths from the avatar (`js/avatar-retarget.js`). A clip stores raw signer-space landmarks so
  the math can improve without re-extracting.
- **Rest pose: elbows bent, hands relaxed in front of the waist** (`js/avatar-rig.js` `restWristOffset`), not
  the prototype's straight-down arms. Reason (measured on the Task 2 pose sheet): the straight-down rest put the
  fingers below the kiosk panel's visible area (its view ends at logical y = 592).
- **Transition durations are minimums that lengthen with the distance travelled** (`js/avatar-timeline.js`):
  250 ms between signs, 350 ms from rest, 400 ms to rest, lengthened (up to 700 ms) so no drawn joint moves
  more than 50 px per 40 ms, measured on the blended path itself (16 samples). Reason: a fixed 250 ms blend
  between far-apart signs measured 82.8 px per 40 ms, and a straight-line estimate still gave 61 px, against
  the 60 px continuity threshold (Q14). In the measured 3-sign sentence one blend became 431 ms.
  Since 2026-10-14 (DEBT 124) the 700 ms cap never shortens a transition past 60 px per 40 ms: a sign held
  far from rest measured 59.4 px at the cap, and the path estimate is conservative (measured peak 0.82-0.998
  of it over 356 rest <-> frame transitions).
- **A clip plays from its first "hands ready" frame, not its first stored frame** (2026-10-14, DEBT 124,
  `js/avatar-timeline.js` `clipEdges()`): the first frame where a hand is raised and every raised arm's hand
  was detected, then on past any step faster than 50 px per 40 ms; the mirror rule at the end. Reason: on
  hello.webm the frame before the hand is found has the pose wrist low, and the next steps measured
  156-210 px per 40 ms, so a transition ending there jumped (up to 155 px) depending on which frame
  Holistic's run happened to trim to. Done at play time so every saved clip and bulk candidate benefits
  without re-extraction; applies to every transition, including sign -> sign blends (the skipped frames are
  the arm rising from or dropping to rest, which a blend replaces too). The hand search looks at most half
  the clip in from each end; the fast-step skip stops at the other end. Saved clips are not rewritten.
- **Auto-trim moves each end inward to a "hands ready" frame** (2026-10-14, `AvatarClip.autoTrim()`), at most
  8 frames and at most half the raised range; with no such frame the end stays. All 12 measured extractions
  of hello.webm then started on the same frame (19; before: 17, 18 or 19). The owner's sample keeps 31..221.
- **A zero-lag 5-tap temporal smoothing (1-4-6-4-1) runs once when a clip is prepared**
  (`smoothPoses()`). Reason: raw retargeted hand shapes jumped up to 145 px per 40 ms (detection pops); the
  prototype hid this with a per-tick low-pass in its player. After smoothing the sample's within-clip jumps are
  median 11.3, p95 33.3, max 61.0 px per 40 ms (`tests/avatar/avatar-math.test.mjs`).
- **The face-region mapping moves the hand's contact point, not its wrist, and does not rotate the hand
  offset** (whole-phase / task review): a fingertip that touches the signer's nose lands within 3 px of the
  caricature's nose, also with the signer's head tilted 0.3-0.35 rad.
- **"Has a clip" is disk only** (Q2): `saved_gestures/<key>/avatar.json`; `signs.php` GET reports
  `avatar: true|false` with `is_file()`; no schema change (a mysqldump was still taken first). Deleting a sign
  in the dataset view deletes its clip with the folder (Q3; `save_gesture.php` already deletes every `*.json`).
- **The Train Gestures dataset table reads the `avatar` flags with its own `signs.php` fetch**
  (`js/gesture-training-ui.js` `renderSavedDataset`) instead of changing `js/gesture-data.js`
  (`loadSigns()` keeps only set/texts), so the capture-flow file stays untouched.
- **Hand tracking pause/resume lives in `talk.html`'s player hooks**, not in `js/gesture-data.js` (Q7):
  `onStart` calls `pauseHandLoop()`; `onEnd` calls `resumeHandLoop()` only if the signing screen is showing.
  Measured on the signing screen with a fake camera: 46-48 sends/s before, 0 during a 4.3-4.5 s playback,
  47-66 in the 1.5 s after.
- **The avatar canvas sits over a new `#speaking-sign-media` container inside `#speaking-sign-frame`**; the
  SignPlayer's container is the media div, so `clearContainer()` never removes the canvas. Without an avatar
  option `js/sign-player.js` behaves exactly as before.
- **PIN:** `avatar-clips.html` has its own PIN pad (same PIN); Train Gestures sets the `sessionStorage` flag
  `sk_train_unlocked` on unlock, so the button opens the page without a second PIN in the same tab session.
- **Train Gestures row:** `[View Active Gesture Dataset | Avatar clips]` share the old button's row (336 + 124
  px, labels 13 px, no arrow on the Avatar button) so both labels fit on one line at 1024x600 (measured).
- **Admin Delete is a two-tap confirm** ("Tap again to delete", 3 s), not a browser dialog.
- **Extraction draws each frame into a canvas of at most 720 px** before `send()` (Q15). Measured against the
  prototype's full-resolution CDN run on the same video: 256/256 frames, detections pose 256/256, right hand
  198/197 (195-198 across runs), left hand 64-66/63, pose mean difference 0.0130.

## Decisions made during the avatar JSON import / export change (2026-10-13)

Source: the owner's task prompt (decisions 1-9, settled) and `docs/reports/2026-10-13-avatar-json-import.md`.

### Owner decisions

- **Import JSON** next to Choose video: a landmark file instead of a video, no extraction, then the same
  trim / Preview / Save / Redo flow; the stage shows the avatar and "Video + skeleton" is disabled.
- **Accepted formats:** `sk_avatar_clip_v1` and the prototype tool's `avatar_pose_hands_v1` (converted).
  Anything else, or a file that fails the clip validation, is refused with an English message.
- **The file's own key is ignored**; a signer in the file fills the Signer field.
- **Export JSON** downloads `<key>.avatar.json`; re-importing an export gives the same frames.
- **Signer placeholder** "Signer ID, e.g. P03". **Save** stays on `php/api/avatar_clip.php`; no new endpoint,
  no DB change. **The Avatar clips button stays** in Train Gestures; the PIN behaviour is unchanged.
- **`extractor-check.mjs`'s fixture** is built from a fixed ffmpeg `.webm`.

### Build decisions

- **A system clip is selected whole on import; only a prototype file is auto-trimmed.** A saved clip is
  already trimmed, and auto-trimming it again could drop frames the owner kept by hand, which would break
  "re-importing an export gives the same frames". The handles still trim it further.
- **A re-imported clip keeps its original trim times.** Its `trim.startMs` is added back at Save, so the
  times still refer to the original video (measured: 1240-8840 ms before and after). The `auto` flag is not
  carried: a re-imported clip is saved with `auto: false`.
- **The fps of a prototype file is kept, not resampled.** The clip format allows 1-60 fps and the player reads
  `clip.fps`; the prototype tool always writes 25.
- **An untrimmed import may hold up to 1500 frames** (60 s at 25 fps, the same limit as a video); the saved
  trim is still limited to 500. `validateClip()`'s per-frame checks moved into `framesError()`, used by both.
- **Export is the stored file byte for byte**, checked with `validateClip()` before the download starts.
- **The file's signer is not written to `localStorage`** until the owner edits the field, so an imported file
  does not replace the signer remembered on this computer.
- **Export JSON sits in the trim row** next to Preview; the bottom row keeps `[Delete | Redo | Save]`.
- **While a trim handle is dragged on an imported clip the avatar shows that frame's pose**, in place of the
  video frame.
- **`extractor-check.mjs`:** the no-cues copy needs `-map_metadata -1`, because the ffmpeg-built file carries
  a per-stream `DURATION` tag that ffmpeg would otherwise write into the piped copy (measured: without it
  the copy's duration is 12, not Infinity, and the Infinity-branch check fails).

## Decisions made during the bulk video importer phase (2026-10-13/14)

Source: the owner's task prompt (decisions 1-14), the approved proposal
`docs/reports/2026-10-13-bulk-import-step1.md`, the owner's answers to it, and the final report
`docs/reports/2026-10-13-bulk-import-final.md`.

### Owner decisions

- **Laptop only.** `bulk-import.html`, same PIN; nothing on a kiosk screen links to it. The Pi only gets
  the resulting files through git.
- **File name** `<SET>_<label>_<SIGNER>.<ext>`; files that do not match are problems, never guessed.
- **Sign mapping:** label -> key by the `cleanLabel` rule; unknown label = new sign with editable draft
  texts; existing with another set = problem.
- **Files are the source of truth;** import through `save_gesture.php` and `avatar_clip.php`; no direct DB
  write; no schema change.
- **Samples:** v3, exactly like a live capture, plus `source "video-import"`, `repIndex`, signer.
- **Repetitions:** the existing segmenter and constants; exactly 3 = OK; otherwise a problem row the owner
  can import with the repetitions found, or skip.
- **Recognition signers (answer to Q1):** a list, default the first 2 signers found. The Hands pass still
  runs for every video and stays in the cache, so signers can be added later without re-extraction. The
  projected rows per model and a projected `knnPredict` time are shown before Import.
- **Avatar candidates (answer to Q7):** the best repetition is chosen from the Hands pass; Holistic runs
  only on that repetition's window and only for signers in the avatar priority list (chosen before
  extraction, editable; a signer added later gets only the Holistic step). `js/avatar-extract.js` may take
  a time range; its full-video output must stay byte-identical.
- **Default signer + priority list + "Apply to all signs"**, "Keep signs I picked by hand" on by default,
  a summary after.
- **Per-sign override** on `avatar-clips.html`; using it marks the sign as picked by hand.
- **Resume:** each video cached as soon as it is done; identity = name + size + modified time.
- **Review before import;** import idempotent by a hash of file name + size + repetition.
- **Summary** with per-sign counts, an imbalance warning, and a Compile reminder for ESL and FSL.
- **Videos are never uploaded or stored.** **No security work** (DEBT 72 stays open).
- **Other answers:** `save_gesture.php` gains `signer` and `importId`; new `php/api/bulk_import.php` and
  `bulk_import_cache/`; the page is built for a laptop screen; imbalance warning below half the median; a
  video of 60 s or longer gives samples but no candidate; a new sign gets no display clip.
- **Next phase is the keyframes / compact model; the kiosk must not get the imported data before it.**

### Build decisions

- **Hands and Holistic share one page, in a fixed order.** `js/gesture-data.js:206-225` patches
  `WebAssembly.validate`; Holistic must be initialised before it runs. Two iframes also worked in the
  probe but were not needed.
- **The Hands result is cached before the Holistic step,** so a Holistic failure or a Pause never throws
  away a finished Hands pass.
- **A sample's identity is in its file name** (`sample_i<importId>.json`): the duplicate check is one
  `is_file()`, and every reader already matches `sample_*.json`.
- **A failed import save removes its own sample file** (shutdown guard), so a retry cannot be answered
  "duplicate" with its `sign.json` or DB row missing.
- **A new sign is created with its label only,** then its edited texts are set through `signs.php` right
  after its first sample. Sending the texts with the sample would let `save_gesture.php` derive the key
  from the text.
- **Best repetition:** two hands are "needed" when at least half of the repetition frames have two; the
  score is the number of frames with the needed hands; ties go to the earlier repetition. When the
  segmentation failed, the last repetition's window ends 1000 ms after it (the rest the segmenter
  guarantees), so an unfinished following sign is never inside the window.
- **"Already imported" wins over "not 3 repetitions"** in the Review: a fully imported 2-repetition video is
  shown as done, not as a problem with a live checkbox.
- **The first file of a new key defines its set;** a later file with another set is "set differs".
- **Two files of one sign and signer:** the first by file name makes the candidate; a later one takes over
  only when the earlier ones gave none. Nothing about the duplicate is stored in the cache.
- **A sign with a clip and no entry in `picks.json` counts as picked by hand** (it was made on Avatar
  clips). A pick by hand without a clip does not.
- **Apply writes the picks once, at the end,** re-reads the signs and the cache before it starts and before
  a Resume, and stops when they changed since the table was shown.
- **A candidate carries the set of its video;** a candidate of another set than the sign's is not used.
- **The time estimate is the page's own copy of the algorithm's shape,** timed on a synthetic model at the
  current and the projected size; the kiosk's `knnPredict` is not loaded on the page. A test compares the
  two within a factor of 2.
- **Cache errors stop the queue** (a dead Apache would otherwise extract every remaining video for
  nothing); a 4xx for one video fails only that video.
- **`avatar-extract.js` rejects a range with a missing or non-numeric bound** instead of processing the
  whole video.
- **The "kiosk row count" includes `start` and `stop` in both models,** as `js/sign-to-text-ui.js:118` does.
  (2026-10-16: that line is gone; the rule is now `KnnCompile.inModel`, `js/knn-compile.js:43-45`, used by
  every page, so the count still matches. The importer's own comment is stale, DEBT 127.)

### Correction to the Step 1 report

The Step 1 report said one `knnPredict` call would take about 1.6 s on this laptop after a full import
(35 ms today). Both figures were wrong: they were measured inside a node `vm` context (6-7 times slower by
itself) on a busy machine. Re-measured: 1.1-1.5 ms today and 53-62 ms at 87,840 rows (`ML.md`). The ratio
(about 45 times) holds; the Pi is not measured. The owner's Q1 answer was given on the wrong figure.

## Decisions made during the compact-model phase (2026-10-15/16)

Source: the owner's task prompt (decisions 1-10, settled), the approved proposal
`docs/reports/2026-10-14-compact-model-step1.md`, the owner's answers to its questions (2026-10-15), and the
build and review reports `.git/sdd/cm-task-*-report.md`, `cm-*-review-*.md`, `cm-phase-review-1.md` (not
tracked). Model and measurements: `docs/system/ML.md` "Compact model".

### Owner decisions (task prompt)

1. **Compile happens on the laptop** (Train Gestures, Step 2 "Compile", for ESL and for FSL). It writes one
   compact model file per language into the repo, which git carries to the Pi. The kiosk loads that file, never
   the raw samples.
2. **Fewer rows per sample:** keep a small set of keyframes per sample instead of up to 30 rows (DEBT 88). Step 1
   proposes the number and the rule, with measured accuracy. (What shipped is a per-sign budget; see build
   decisions.)
3. **Compact binary storage** (Float32 or quantized) with the label list and metadata (keys, set, build date,
   sample count, row count, format version), cached in IndexedDB, not `localStorage`, and downloaded again only
   when the file changes.
4. **`knnPredict` and `cosineSimilarity` keep working on the same 126-float rows** and give the same answer for
   the same rows. Only which rows exist and how they are loaded change.
5. **Accuracy must not get worse.** Measure before/after on held-out data (leave-one-repetition-out;
   leave-one-signer-out with the bulk test videos if available), top-1 and per-sign confusions, per category; if
   keyframes lose more than 2 points, propose another rule. Check whether the 30-row cap hurts phrases, compare a
   length-based cap, and list the most confused pairs (phrase vs word).
6. **The raw sample files stay the source of truth on the laptop.** The Pi may keep the samples it has today but
   must not need them; imported bulk samples can stay off the Pi.
7. **A model file older than the samples is flagged on the laptop** ("Model out of date: run Compile"); the kiosk
   keeps using the last good file.
8. **Demo system: no security work.**
9. **Data work happens on the laptop.** On the Pi, Compile shows a warning that the model is built on the laptop
   and carried to the Pi; the kiosk never compiles. Copying files to the Pi over SSH is a later task, so the
   model files must be easy to copy on their own.
10. **The Pi is not available in this phase.** Every measurement is on the laptop; only the Pi script is written.

### Answers to the Step 1 questions (approved 2026-10-15)

- **Q1** (which sign is in the owner's one real test video): unknown. T3 stays a consistency check.
- **Q2:** git-ignore `saved_gestures/*/sample_i*.json` (`.gitignore:11`), so imported samples never reach the
  Pi through git.
- **Q3:** budget 90, stored in the model file as a Compile setting. Leave-one-signer-out is re-measured after
  the first real import, not in this phase (DEBT 128).
- **Q4:** `start` (and `stop`) are in both model files.
- **Q5:** the device is `php_uname('m')` (ARM = Pi), overridden by a git-ignored `config/device.txt`.
- **Q6:** on the Pi, Compile is disabled, with the warning text of Step 1 section 6.4.
- **Q7:** bulk import's Review estimate is left as it is; a DEBT item records it (DEBT 126).
- **Addition:** after this phase the owner archives today's 122 signs and imports a new dataset (up to 8
  signers x 3 reps). So tests that pin today's numbers (2,047 / 1,414 rows, the 5,010 queries, the Step 1
  section 2.3 scores) read a frozen copy in `tests/compact-model/fixtures/`, never live `saved_gestures/`; and
  Compile, the loader, `model_status.php` and the accuracy script must work on any dataset (0 signs, a sign
  with 1 sample, a sign with 24+ samples, a sign folder with `sign.json` and no samples). The whole-phase review
  also unpinned the two browser checks (`kiosk-check.mjs`, `training-check.mjs`): they now read the live
  model headers and the live listing.

### Build decisions

- **A per-sign row budget instead of a fixed keyframe count per sample.** Every fixed count from 3 to 20 rows
  per sample lost more than 2 points on at least one Step 1 test set (even 20: T2 85.0 against 85.8, T2r 83.5
  against 86.8, phrases 76.5 / 70.6 against 82.4 / 88.2; even 10: 71.7 / 74.4). `knnPredict` scores a sign by
  the mean of its 5 best rows, so with one sample per sign fewer rows mean fewer close matches. The cost
  problem is rows per sign: a sign keeps all its rows up to 90, above that each sample keeps
  `max(3, floor(90 / samples))` evenly spaced rows. On today's data nothing changes (identical rows, identical
  accuracy); the projected ESL model is 10,196 rows with 2 signers and 9,164 with 8 instead of 24,007 and
  89,887. It is still a per-sample keyframe count (decision 2), set by how many samples the sign has. If
  leave-one-signer-out shows budget 90 losing more than 2 points against no budget, raise it to 120 (Step 1
  section 2.5); the budget is stored in each file's `rule`.
- **Keep the 30-row cap.** Phrases scored the same with the cap, without any cap and with a length-based cap
  (T2r phrases 88.2 in all three); no cap gained 0.8 points (one word) for 6% more rows.
- **Float32, not int8.** On 5,010 test queries Float32 gave the same top-1 as the JSON doubles 5,010 times,
  with a largest confidence difference of 2.83e-9; int8 changed 5 answers (`.git/sdd/cm-step1/quant.txt`) and
  would be 4x smaller. At about 5 MB on localhost the size does not matter, and decision 4 asks for the same
  answer. dtype 3 (int8) is reserved, not implemented; any dtype other than 1 is refused.
- **Compile runs in the browser,** with the page's own `recordingToFeatureRows()`, and PHP only checks and
  stores the bytes. One implementation of the feature rows; a PHP copy would need a parity test forever.
- **The fingerprint is made of file names, not file contents:** `label|set|file` per sample of the model,
  sorted, SHA-256. Sample files are write-once (`sample_<ms>_<hex>.json`, `sample_i<importId>.json`), so a name
  is enough, and `model_status.php` never has to open a sample (median 51 ms through Apache on today's data).
  Categories and texts are left out because they do not change recognition. A parity test checks that the JS
  and PHP fingerprints agree on the fixture. Known edge: an invalid-JSON sample (DEBT 130).
- **"Out of date" also covers format:** a binary version or dtype, a header `formatVersion` or a rule other than
  `sign-budget` v1 reads `staleReason: "format"`, so a file from another build reads "Model out of date: run
  Compile" (Step 1 section 6.3: "an older format or rule version").
- **HEAD + ETag, with the weak ETag handled.** Each load sends one HEAD; the IndexedDB copy is used when its
  ETag and `Content-Length` match. Apache 2.4.58 sends a weak `W/"<size>-<mtime>"` for a file changed less than a
  second earlier and the same text as a strong ETag afterwards (measured, `tests/compact-model/store-check.mjs`
  check 4), so the `W/` prefix is ignored; otherwise a load right after Compile, or right after a copy onto the
  Pi, would cost one extra download every time. Without an ETag, `Content-Length` + `Last-Modified` are compared;
  with neither, the file is always downloaded. A `git pull` that changes the file's mtime costs at most one
  download.
- **Labels in header order,** not `Object.keys(model)`: `Object.keys` moves integer-like keys (`"1"`, `"10"`)
  first, and number signs are a category. Labels in the file are sorted by key.
- **The kiosk keeps the last good file; the laptop does not.** When the server's file is missing or broken, the
  kiosk (and Train Gestures on the Pi) uses the stored IndexedDB copy with one `console.warn` (decision 7). On the
  laptop Train Gestures refuses that copy and says "No model file: run Compile", because there the answer is to
  compile, and testing an old copy in Steps 3/4 would mislead.
- **Export Data exports the loaded file's rows** (`{label: rows}`, the old shape, now the budgeted rows), and
  **Load Saved is retired** (a toast): the model is built only by Compile, from the saved samples, so an
  imported training file would make the model and the fingerprint disagree.
- **Compile reads the frames in batches** (whole-phase review). The full listing with frames ran PHP out of
  memory at about 732 v3 samples (one sample: 46 KB of JSON, 715 KB decoded; `memory_limit` 512M), which is
  2 signers x 3 reps of today's 122 signs. Compile now reads one summary listing (no frames, with the disk sync)
  for the fingerprint and the file list, then `save_gesture.php?no_sync=1&labels=...` at most 60 samples per
  request, and builds the model sign by sign (`KnnCompile.createBuilder`, which `buildModel` also uses: one
  implementation). Only files the summary listed are used, so a sample saved during Compile cannot make the
  rows and the fingerprint disagree. Measured at 3,000 extra samples: PHP peak per request median 44 MB, max
  46 MB; Compile 45.4-100.5 s (`docs/system/BACKEND.md`, `.git/sdd/cm-task-9-report.md`).
- **`start` and `stop` in both files** (Q4). This was already the kiosk's rule; Train Gestures' FSL model used
  to leave `start` out, so Steps 3/4 in FSL now also know `start` (and `stop` once it has a sample; today's
  data has no `stop` sign: FSL = 89 Both signs + `start`).
- **A sign with 0 rows is not in the file.** The old in-memory model kept an empty `stop` key, which scored 0;
  recognition does not change.
- **One-time reset of the old keys (schema `"3"`).** The six `localStorage` keys (about 3.4M characters) are
  removed once on every page that loads `js/gesture-data.js`, including a machine already reset to `"2"`.
- **Sign texts from the header are a fallback only.** The database text wins; the header text is used for a
  sign the Pi's database does not list (for example one that exists only through bulk import).
- **`*.sh text eol=lf`** (`.gitattributes:3`), next to `models/knn_*.bin binary` (`:2`), because
  `core.autocrlf` is `true` on this laptop: a Windows checkout would otherwise give the Pi scripts CRLF.
- **Browser checks that press Compile guard the real files** (`tests/compact-model/model-guard.mjs`): Apache
  cannot be pointed at another models folder, so each such check copies both files first and restores them
  byte for byte in `finally`. Checks that only pin numbers build their own files from the frozen fixture.
- **`compile_model.php` sends no CORS header** (a write endpoint; same-origin only), unlike
  `save_gesture.php`. **Sample names are read with `scandir`**, not `glob()`, in the fingerprint walk: the same
  names, about 8x faster on Windows.

### Open for the owner

- **Bulk import's Review step before the import (decision needed).** Its full listing runs out of PHP
  memory at about 732 imported samples (measured through Apache and php-cgi, `.git/sdd/cm-task-9-report.md`),
  so after the first 2-signer import, Review (and with it a second import round) fails until DEBT 117 is
  fixed. Bulk import was must-not-change in this phase; the fix (Review through `?summary=1` and `labels=`
  batches, as Compile does) is the recommended next task.
- **Git history growth.** Each recompiled model is a new binary blob in git (5,596,344 bytes for ESL at the
  3,000-sample scale check). Either accept the growth or copy the two files to the Pi by hand and commit them
  less often (`docs/system/HARDWARE_BOOT.md`; DEBT 139).
- **Wording.** "Train AI" is gone from Train Gestures, but bulk import's reminder still says "Compile (Train AI)"
  (bulk import must not change in this phase).

## Decisions made during the bulk-reps-fix phase (2026-10-16)

Source: the owner's task brief for this phase and `docs/reports/2026-10-16-bulk-reps-fix.md`. Context: the
group's videos each hold exactly 3 repetitions, but the signers rest only about 1 s between them (often the hand
is just lowered, still in the picture) and stop right after the 3rd, so the live segmenter's 1 s of no hand
merged reps (P01 letters: 24 of 26 videos gave 1-2 reps).

1. **Dynamic rep detection for video import, no fixed rest time.** Per frame a rest score (no hand; hand
   lowered below the video's own signing zone, learned from the video; nearly still while low), from the raw
   image-space landmarks; rest runs of at least 200 ms; the 2 that best split the video into 3 reps of plausible
   similar length; rest frames trimmed off each rep; the first rep may start at frame 0 and the last runs to the
   end. Weak splits are problem rows that say why. **Live capture keeps its own segmenter and REST_MS 1000.**
2. Review shows the split on a small timeline per video.
3. Problem rows: "import the reps found", "skip", and "split into 3 equal parts" as a last resort.
4. Re-segment from the extraction cache when it holds per-frame landmarks, otherwise re-extract; the cache
   version is bumped so old segmentations are not reused silently. (Implemented: cache version 2 keeps every
   frame; `SPLIT.VERSION` marks the thresholds.)
5. Review: header checkbox, "Select all", "Select all problems (reps found)", "Clear"; the Import count follows.
6. Extract: "Stop" = pause and go to Review with the videos done so far.
7. **Re-import replaces.** A video imported before (same file identity) with a different split has its old
   samples removed (files and DB rows, through `save_gesture.php`) and the new ones saved; Review shows
   "replaces N old samples"; re-importing with the same split adds 0. (Implemented: the rep's place in the video
   is part of the sample id; the old samples are removed only after the new ones are saved.)
8. Review must open with the full dataset (DEBT 117): summary listing + `labels=` batches as Compile does; the
   estimate follows the compile budget rule.
9. After import the summary still reminds: Compile ESL and FSL.
- **Choices made in the implementation (not asked):** "Select all" ticks every importable row, problem rows
  included, each with its own choice; the old samples are found by the first version's id formula and by a
  per-video record in the cache (`meta.imported`); a rep identical to one the first version saved keeps that
  sample (so a clean video reads "already imported"); a video re-extracted from a version-1 cache keeps its
  avatar candidate only if its old split was the 3 clear reps.
