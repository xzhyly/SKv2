# Target UI — the conversation feature

These images are the design target for `talk.html`. Match the layout and the
visual language. Where this README and an image disagree, **the README wins** —
the images are earlier than the decisions recorded here.

Every screen is exactly **1024 × 600**, the Pi's 7-inch touchscreen. Not
responsive. Not a breakpoint. One fixed size.

---

## The images

| File | Screen | Status |
|------|--------|--------|
| `01-dashboard.png` | Dashboard — four cards, "Let's Talk" highlighted | existing `index.html`, changes below |
| `02-who-speaks-first.png` | Choosing who starts the conversation | new |
| `03-signing.png` | Camera on, reading Filipino Sign Language | new |
| `04-speak-or-type.png` | Keyboard raised, typing a reply | new |
| `05-conversation.png` | The thread — what the whole feature is for | new |

Three screens have **no image yet** and are specified in words below: confirm,
idle warning, error states. Build them from the description.

---

## Visual language

Taken from the CSS already in this repo. Do not invent new values.

```
--navy        #1a2540   header, primary buttons, hearing-person bubbles
--navy-2      #27344f   keyboard keys
--orange      #f97316   the ONE main action on any screen
--orange-dark #ea6a0a   pressed
--bg          #f0f2f5   page background
--surface     #ffffff   cards, bubbles from the Deaf person
--border      #e2e8f0   card and bubble outlines
--muted       #64748b   secondary text
--muted-light #94a3b8   timestamps, placeholder
--green       #22c55e   live / listening ONLY
--red         #ef4444   stop / end ONLY
```

Inter throughout — already self-hosted in `assets/fonts/` since Phase 2. Do not
add a font.

Radius: 12px on cards and buttons, 18px on bubbles, 99px on pills, 8px on keys.

**Touch rules, not suggestions:**

- Nothing tappable smaller than 44 × 44 px
- No body text under 16px
- No hover states — a touchscreen has no hover, so anything only reachable by
  hovering is unreachable
- One orange element per screen. If there are two, one of them is wrong.

**The scaled stage.** Every screen's 1024×600 canvas is fixed, never fluid —
every element keeps its exact design pixel size, always. On anything larger
than the Pi's own 7-inch panel, the whole canvas is scaled up as one block
(`transform:scale`, uniform on both axes, centred, the remainder letterboxed
in `--bg`) rather than any element inside it resizing or reflowing. On the
Pi's own 1024×600 panel the scale is exactly 1 and this is invisible. See
`docs/system/DECISIONS.md` for why, and `docs/system/DEBT.md` item 43 for how
this now differs from the rest of the kiosk's (fluid) pages.

---

## Screen by screen

### Header — every screen inside the conversation

Navy, 90px tall, full width. Back button top left (pill, white at 12% opacity).
Title centred: **"NEW CONVERSATION"**, white, 20px bold, 1.5px letter-spacing.

The title does not change between screens. The user is inside one continuous
thing, not moving between four tools. That is the entire point of the redesign.

Status pill, top right, 40px tall, only where a state exists:

- green dot + `LISTENING` — camera is reading
- orange dot + `TYPING` — keyboard is open

Never show `LISTENING` while the keyboard is up. Nothing is listening then.

---

### 01 — Dashboard

Existing screen. Two changes only:

1. "Translate Sign to Text" and "Translate Text to Sign" are **removed**, replaced
   by a single **"Let's Talk"** card — orange 2px border and orange icon, so the
   eye lands on it first. The other three cards stay plain.
2. Each card gets a one-line caption under its label, 14px muted: *Practise FSL*
   / *Talk with someone* / *Add new signs* / *Usage and accuracy*. The cards
   currently have about 100px of dead space under the label.

Brand stays left-aligned. Do not centre it.

---

### 02 — Who speaks first

Heading "Who speaks first?", centred, 34px bold navy.

Two cards, 380 × 280, side by side, 40px gap:

| | Icon tile | Label | Caption |
|---|---|---|---|
| left | navy rounded square, white hand | Sign Language | Use the camera to sign |
| right | orange rounded square, white mic | Speak or Type | Use your voice or the keyboard |

The icon sits **inside a filled rounded square**, roughly 96 × 96, radius 16. Not
a bare outline icon — a bare icon does not read from two metres away.

No language toggle on this screen (removed in the review pass that follows —
see `docs/system/DECISIONS.md`). It was here only because the old voice screen
had one, not because starting a conversation needs it.

**This screen is also the lazy-load trigger.** See the loading rules below.

---

### 03 — Signing

- Collapsed conversation strip, 96px, white, directly under the header: the most
  recent message only, as a bubble, with its `Signed · 10:42` label above it.
  A white-to-transparent fade across the top 26px says more exists above.
- **Empty state (turn 1, before either person has said anything):** the strip
  is 0px, not 96px of blank white. There is nothing to show yet, so it takes
  no space — it grows to 96px the instant the first message exists, and
  collapses back to 0 only between conversations, never mid-thread. This
  applies to 04's identical strip too.
- Camera view below, 560 × 300, centred, radius 12, dark `#16192a` background,
  hand-landmark skeleton drawn over the hand.
- **A live recognition caption inside the camera**, bottom centre: a dark pill
  showing the word currently being read, 20px bold white.
- One orange button under the camera, 560 × 68: **"Stop & Add to Conversation"**.

The live caption is not decoration. Without it the user signs into a void and
only finds out what the system understood after committing to it.

---

### 04 — Speak or type

Draw it with the keyboard raised and the microphone hidden.

- Same 96px collapsed strip.
- **Resting state (keyboard down):** microphone button, 110px circle, navy,
  white icon, with "Tap to Speak" at 18px beneath it — the primary action on
  this screen, so it reads at size, not as an afterthought. The whole block
  (mic, label, text field) is vertically centred in the space between the
  collapsed strip and the bottom of the screen, not pinned to the top — the
  keyboard's 240px still has to fit below it when raised, but there is no
  reason to leave that room empty while the keyboard is down.
- Text field, 700 × 64, radius 12, orange 2px focus border. Placeholder reads
  **"Type your message"** — not "Or type here", which refers to a microphone
  that is hidden at that moment.
- Orange **Send**, 180 × 64, beside it. **Pale / disabled while the field is
  empty.** This is a real state and it must be drawn.
- Keyboard, bottom 240px, navy (this is `js/virtual-keyboard.js`'s shared
  component — reused everywhere in the kiosk, not built fresh for this
  screen). QWERTY, **five** rows, numbers included — people type numbers
  into messages: `1234567890` / `QWERTYUIOP` / `ASDFGHJKL` / `ABC`(caps) +
  `ZXCVBNM` + backspace / `CLEAR` + space + `HIDE`. Keys 68 × 44, radius 6,
  white letters — narrower than a first guess, because fitting ten number
  keys across 1024px leaves no room for anything wider. `HIDE` is orange;
  every other key is dark slate.

When the keyboard closes, the microphone button and its label return to their
exact previous positions. No drift. This is the same rule Phase 3b established
for `index.html?screen=voice`.

---

### 05 — The conversation

The most important screen. Everything else exists to get here.

Thread fills from y=90 down to the control panel.

**Bubble convention, used everywhere in this design:**

- Deaf person → **left**, white, 1px border
- Hearing person → **right**, navy, white text

Above each bubble, 13px muted: `Signed · 10:42` or `Spoken · 10:42`. The label is
how each person knows which direction a message came from. It is not optional.

Show a **visible scrollbar** on the right edge as well as the top fade. On a
touchscreen the bar is the only thing that proves more exists above.

Two additions the images do not show:

- A small **speaker icon on each white bubble** — and new signed messages are
  spoken aloud automatically. Otherwise the hearing person has to stare at the
  kiosk to receive anything.
- A small **hand icon on each navy bubble** — tapping replays that message as
  signs. This is where the old "Translate Text to Sign" feature lives now.
  Without it, the feature was deleted rather than merged, and the Deaf user is
  simply expected to read English.

**Bottom panel**, white, ~190px, pinned:

- `Whose turn is it?` — 15px muted, centred
- Two buttons, 480 × 62: navy **Sign**, orange **Speak or Type**
- Below them, full width 976 × 60: **End Conversation**, white with a 2px red
  border, red text

End Conversation is full width and never tucked into a corner. This kiosk stands
in a public place; when two people walk away, the next person must not be able
to read what was said.

---

### Confirm — no image, build from this

Appears after signing stops, and after speech is recognised. Before anything
enters the thread.

Centred card, roughly 640 × 300, white, radius 16, shadow.

- Small muted label: `You signed` / `You said`
- The recognised text, large — 32px bold navy, centred
- Orange **"Add to Conversation"**, full card width
- Plain **"Try again"** beneath it, muted

Nothing reaches the thread until the person who produced it agrees that is what
they meant. The classifier is a cosine-similarity k-NN and offline speech
recognition mishears. A conversation where neither person can fix a wrong word
is not a conversation — and if the wrong word is then spoken aloud, the Deaf
user watches a machine say something they did not say, with no way to stop it.

### Idle warning — no image, build from this

Thread dimmed behind a 62% scrim. Centred white card, 520 wide, radius 16:
**"Still there?"** 32px bold, `This conversation will end in`, a countdown in
44px orange, an orange **Continue** button, a plain **End Now** beneath.

Appears after two minutes without input; ends the conversation by itself if
nobody answers. Nobody can be relied on to press End before walking away.

### Error states — no image, build from this

Same centred-card treatment as Confirm and Idle: a short bold heading first
(same shape as the other two, not a lone sentence), then a plain sentence
beneath it, then one way out. At minimum:

- Camera did not open — **"Camera not available"** / *"I cannot reach the camera."*
- No hand in frame for several seconds — **"Hands not visible"** / *"I cannot see your hands — move back a little."*
- Nothing recognised confidently — **"Didn't catch that"** / *"I did not catch that."* → Try again
- Microphone missing or muted — **"Microphone not available"** / *"I cannot hear anything."* → offer typing instead

Both prototypes drew only the happy path. On a real Pi in a real hallway, these
happen on the first day.

---

## Loading rules — the design and the speed are the same decision

`talk.html` is one document. Screens are shown and hidden; the page never
reloads between turns. That is what removes the lag.

What happens on which screen:

| Screen | Loads |
|---|---|
| `talk.html` opens | shell only — HTML and CSS. No heavy library. |
| "Sign Language" chosen | MediaPipe + `tf.min.js`, camera starts, gesture cache read — **once per conversation** |
| "Speak or Type" chosen | Vosk model for the chosen language — **once per conversation** |

If the user only ever types, Vosk never loads at all.

**While a screen is hidden:**

| | Hidden | Why |
|---|---|---|
| MediaPipe Hands instance | keep — never `close()` | ~15MB of WASM to rebuild |
| Camera stream | keep, but stop sending frames | `getUserMedia` is slow to restart; the frame loop is what costs CPU |
| Vosk model | keep for the whole conversation | 41MB |
| Gesture cache | keep | currently re-read from the database on every page visit |
| Frame loop / canvas | **stop** | this is what heats the Pi |

Stop the loop, not the object.

**Speech models:** English and Filipino are roughly 41MB each. Load **one at a
time**, chosen on screen 02. Never both.

**Multi-dataset k-NN:** when several datasets live in one model, compare only
against the active dataset, and classify only when the hand is still — not on
every frame. At 120 gestures neither matters. At 2,000 both do.

---

## End Conversation must be a real teardown

Stop the camera tracks. Clear the thread from the DOM. Release the speech model.
Then `location.href` back to the dashboard — a **real page load**, not a hide.

The reason: today every screen change is a full page reload, and those reloads
are acting as crude memory cleanup. Removing them removes that too, and the
cause of the reported crash-and-auto-reload is still unknown.

So: SPA speed **inside** a conversation, a clean slate **between** conversations.
One real reload per conversation instead of eight. Whatever leaks gets swept
every time someone finishes — without having to find the leak first.

Also cap the thread at roughly the last 30 bubbles in the DOM. The rest lives in
the database.

---

## Privacy

Past conversations are **not** a public screen. Put the list behind the same PIN
`reports.html` already uses, and delete conversations automatically after a set
period.

End Conversation and the idle timeout protect the live screen. They do nothing
about an archive that anyone can browse. Someone asked where the clinic is.
Someone asked about paying tuition. That is not for the next person in the queue.

---

## Still undecided — do not guess

**Dual display.** This system has two displays and one 7-inch panel that two
people share. Whoever it faces, the other reads upside down. Nothing here says
what the second display shows. Ask before building a layout that assumes one
screen.
