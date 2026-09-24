# Work order — UI polish

**This is not a prompt. It is a list of edits.**

The analysis is finished. Every value below was decided and measured. Do not
re-analyze, do not re-measure, do not look for a better number. Apply the edits.

---

## How to run this

**Model: Sonnet.** This is ten value changes and one deletion against exact FIND
blocks. There is no design judgment left in it. Opus buys nothing here.

**Two skills, both already in `.claude/skills/`:**

```
strict-execution                 while applying A, B and C
verification-before-completion   for the Verify section at the end
```

`strict-execution` is the contract this file was written for — follow
instructions exactly, no assumptions, no scope expansion, no improvements
nobody asked for, touch only the files named. If you find yourself wanting to
fix something adjacent, that skill is the reason not to.

**Do not use** `ai-planner`, `writing-plans` or `brainstorming`. The plan is this
file. There is nothing to plan and nothing to decide.

**Do not use** `subagent-driven-development`. Ten small sequential edits in two
files — dispatching a subagent per edit costs more than doing them.

`systematic-debugging` only if an edit breaks something and the cause is not
obvious. Not preemptively.

**Before you start:** confirm `git branch --show-current` says `revision`, and
that XAMPP is running so `localhost/SKR/` is reachable — the Verify section
measures from the live DOM.

---

## Constants — already measured, do not recompute

```
Screen          1024 × 600, confirmed by xrandr on the Pi
Physical glass  15.1 × 8.9 cm
Density         172 ppi  ·  67.7 px per cm

44 px = 6.5 mm     below the 9 mm finger minimum
60 px = 8.9 mm     at the minimum
72 px = 10.6 mm

Palette         css/tokens.css only. No new colours, no new hex.
Font            Inter, already self-hosted. Do not add a font.
```

## Which file reaches which page — verified

```
index.html         style.css  tokens.css  virtual-keyboard.css  fonts.css
sign-to-text.html                                   fonts.css  sign-to-text.css
reports.html                                        fonts.css
talk.html                     tokens.css  virtual-keyboard.css  fonts.css
```

**`css/style.css` is loaded by `index.html` and nothing else.** Every edit to it
in this work order can only affect that one page.

`css/virtual-keyboard.css` is the shared one — `index.html` and `talk.html`. No
edit here touches it.

## Rules

1. **If a FIND block does not match the file, STOP.** Say which number failed.
   Do not search for something similar. Do not guess.
2. Each numbered edit is its own commit.
3. Do not fix anything not listed here. If you see something, write it at the
   end of your report; do not act on it.
4. Section C deletes code. It has its own gate. Read it before starting.

---

# A · Dashboard sizing

All six are in `css/style.css`. All six affect `index.html` only.

At 172 ppi everything renders about 57% the physical size it shows at on a
desktop monitor. These six edits correct for that.

### A1 · Card icon is a detail, should be the first thing seen

```
FILE     css/style.css
FIND     #dashboard-pane .card-icon svg {
             width: 44px;
             height: 44px;
         }
REPLACE  #dashboard-pane .card-icon svg {
             width: 72px;
             height: 72px;
         }
WHY      44px = 6.5 mm — one sixth of the card's height. At arm's length the
         label is read before the icon is seen, which is backwards. 72px =
         10.6 mm and the shape leads.
VERIFY   getComputedStyle(document.querySelector('.card-icon svg')).width === "72px"
```

### A2 · Card label

```
FILE     css/style.css
FIND     #dashboard-pane .card-label {
             color: #1b355a;
             font-size: 1.05rem;
REPLACE  #dashboard-pane .card-label {
             color: #1b355a;
             font-size: 1.375rem;
WHY      1.05rem = 16.8px = 2.5 mm. 1.375rem = 22px = 3.3 mm.
VERIFY   getComputedStyle(document.querySelector('.card-label')).fontSize === "22px"
```

### A3 · Card caption

```
FILE     css/style.css
FIND     #dashboard-pane .card-caption {
             color: var(--muted, #64748b);
             font-size: 14px;
REPLACE  #dashboard-pane .card-caption {
             color: var(--muted, #64748b);
             font-size: 17px;
WHY      14px = 2.1 mm, read standing, at arm's length, in corridor light.
         17px = 2.5 mm. Deliberately not larger — the caption supports the
         label, it does not compete with it.
VERIFY   getComputedStyle(document.querySelector('.card-caption')).fontSize === "17px"
```

### A4 · Card width — two places, both must change

```
FILE     css/style.css
FIND     grid-template-columns: repeat(4, 180px);
             gap: 20px;
REPLACE  grid-template-columns: repeat(4, 200px);
             gap: 24px;

FIND         width: 180px;
             outline: none;
REPLACE      width: 200px;
             outline: none;

WHY      The grid declares the track width and .card-btn declares its own
         width. Changing one without the other leaves the card and its track
         disagreeing. Wider cards also stop "Usage and accuracy" from wrapping
         at 17px.
VERIFY   the row is 4 × 200 + 3 × 24 = 872px, inside the 904px container cap.
         Report the measured .card-container width. It must be 872 and the
         left and right margins must be equal.
```

### A5 · Hover states on a touchscreen

```
FILE     css/style.css
FIND     #dashboard-pane .card-btn:hover,
         #dashboard-pane .card-btn:focus-visible {
             transform: translateY(-5px);
             box-shadow: 0 20px 30px -10px rgba(27, 53, 90, 0.12), 0 10px 15px -8px rgba(27, 53, 90, 0.08);
             border-color: #1b355a;
         }
REPLACE  @media (hover: hover) {
             #dashboard-pane .card-btn:hover {
                 transform: translateY(-5px);
                 box-shadow: 0 20px 30px -10px rgba(27, 53, 90, 0.12), 0 10px 15px -8px rgba(27, 53, 90, 0.08);
                 border-color: #1b355a;
             }
         }
         #dashboard-pane .card-btn:focus-visible {
             border-color: #1b355a;
         }
WHY      docs/ui-target/README.md: "No hover states — a touchscreen has no
         hover." This is not merely useless on touch, it misbehaves: after a
         tap the hover state often sticks, leaving a card raised that nobody
         is pointing at, until something else is tapped. The @media guard
         keeps it on a desktop for development. :focus-visible is kept
         separately — it is keyboard focus, not hover, and it is the only
         indication a keyboard user gets.
VERIFY   in DevTools device-emulation (touch), tap a card, then check its
         computed transform is "none". Report what you measured.
```

### A6 · Nothing. A5 is the last edit in section A.

---

# B · Tap targets in talk.html

Two elements sit at exactly 44px. Everything else in `talk.html` is already
larger. These two are the only ones below the finger minimum.

### B1 · Back button height

```
FILE     talk.html
FIND     .back-btn{
             position:absolute;left:16px;top:50%;transform:translateY(-50%);
             min-width:44px;height:44px;padding:0 18px;
REPLACE  .back-btn{
             position:absolute;left:16px;top:50%;transform:translateY(-50%);
             min-width:60px;height:60px;padding:0 22px;
WHY      44px = 6.5 mm. The accepted minimum for a fingertip is about 9 mm.
         60px = 8.9 mm. The header is 90px tall, so a 60px button still has
         15px of clearance above and below.
VERIFY   .back-btn bounding rect height is 60. The header is still 90px and
         the button is still vertically centred in it. Report both.
```

### B2 · Idle "End Now" button height

```
FILE     talk.html
FIND     .idle-end-btn{
             display:block;width:100%;height:44px;
REPLACE  .idle-end-btn{
             display:block;width:100%;height:60px;
WHY      Same reason. This one matters more than most: it is pressed by
         someone who has decided to leave, often in a hurry, and a missed tap
         means the conversation stays on screen for the next person.
VERIFY   .idle-end-btn height is 60. The idle card still fits within 600px
         with the taller button. Report the card's new height.
```

### Also update the spec

```
FILE     docs/ui-target/README.md
FIND     - Nothing tappable smaller than 44 × 44 px
REPLACE  - Nothing tappable smaller than 60 × 60 px. At this screen's 172 ppi,
           44px is 6.5 mm — below the 9 mm a fingertip needs. 60px is 8.9 mm.
WHY      The 44px floor was inherited from desktop guidance and is wrong for
         this panel. Leaving the old number in the spec means a later phase
         builds another 6.5 mm button.
```

---

# C · Dead code

**Read this before starting section C.**

These selectors exist in `css/style.css` and are referenced by no HTML and no
JavaScript. They style a dashboard layout that was redesigned away. Recorded as
DEBT item 17.

## Prove it first

Run this in the repo root **before deleting anything**:

```cmd
findstr /s /n "title-sining title-kamay dash-btn button-container" *.html js\*.js php\*.php
```

It must return nothing. If it returns any line outside `css/style.css` and
`docs/`, **STOP and report it.** Something still uses the class and it is not
dead.

### C1 · Remove the four dead selectors

```
FILE     css/style.css
ACTION   Delete every rule whose selector is .title-sining, .title-kamay,
         .dash-btn, or .button-container — including the copies inside media
         queries. There are rules for these around lines 505, 509, 513, 550,
         555, 560, 564. Find them by selector, not by line number.

DO NOT   delete the #dashboard-pane rules inside those same media queries.
         #dashboard-pane is a live element. Only the four selectors above go.

WHY      DEBT 17. They style a layout that no longer exists in any HTML file.
VERIFY   the four selectors return zero matches in css/style.css afterwards.
         Report the file's line count before and after.
```

### C2 · Do NOT remove --sk-primary

```
FILE     css/style.css
ACTION   none
WHY      It looks dead — it is a blue (#0077b6) in a navy-and-orange system —
         but it is consumed in six places: lines 303, 318, 386, 398, 413, 485,
         all inside the still-live #translator-pane area. Removing it would
         break those rules.

         Recorded here so a later pass does not rediscover it and delete it.
         Reconciling that blue with the navy palette is a design decision, not
         a cleanup, and it is out of scope.
```

---

# Verify — after all edits

Measured from the live DOM at exactly 1024 × 600. Not read off screenshots.

```
A1  .card-icon svg width                72px
A2  .card-label font-size               22px
A3  .card-caption font-size             17px
A4  .card-container width               872px, margins equal
A5  card transform after a touch tap    none
B1  .back-btn height                    60px
B2  .idle-end-btn height                60px
C1  four dead selectors in style.css    0 matches
```

Also:

- `document.scrollWidth` is exactly 1024 on `index.html` and on every state of
  `talk.html`
- nothing clipped at 1024 × 600 on any page
- exactly one orange element on the dashboard
- all four cards still navigate to their pages
- zero console errors on `index.html`, `talk.html`, `sign-to-text.html`,
  `reports.html`, `gesture-training.html`, `learn-signs.html`

## The net under everything

Screenshot **every page** at 1024 × 600 before you start and after you finish:

```
index.html · talk.html (all four screens) · sign-to-text.html
reports.html · gesture-training.html · learn-signs.html
```

`index.html` and `talk.html` are supposed to change. **Every other page must be
pixel-identical.** If one is not, something deleted in section C was not dead —
revert it and report which.

This catches what the grep cannot: a class built at runtime in JavaScript, or a
selector reached by a string this work order never searched for.

## Gates

```
git diff --stat   →  css/style.css, talk.html, docs/ui-target/README.md
                     and docs/ only. Nothing else may appear.

zero requests for js/lib/tf.min.js, js/lib/mediapipe/hands.js, js/vosk.js
in any state of talk.html
```

---

## Report

For each numbered edit: the before value and the after value, measured.

Then: anything you found and did not act on, and anything in this work order
that turned out to be wrong.

The second one matters more than the first. This file was written from an
analysis, and an analysis can be stale. If a FIND block did not match, or a
selector turned out to be live, that is the most useful thing you can tell me.
