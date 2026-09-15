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
