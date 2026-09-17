# Work order 2 — toast, card polish, touch feedback

STATUS: applied 2026-09-18, commits b2427d5..5b3f80a. Items skipped: none.

**This is not a prompt. It is a list of edits.**

Everything below was decided and measured in an earlier session. Do not
re-analyze, do not re-measure, do not look for a better value. Apply the edits.

Same format and same rules as `docs/WORKORDER-ui-polish.md`, which has already
been applied. Read that file's header if you have not — the constants and the
"when something does not match" section still govern.

---

## Where the project stands

```
PHASE 0–3b   audit, dead code, offline, performance, 1024x600 layout   DONE
PHASE 4      talk.html conversation UI, fake data                      DONE
WORKORDER 1  dashboard sizing, tap targets, dead CSS                   DONE, 9 commits
WORKORDER 2  this file                                                 ← you are here
```

`talk.html` is a UI shell on fake data — no camera, no microphone, no database.
That is deliberate. It is reached by typing the URL; the dashboard's "Let's
Talk" card also points at it.

## Constants — measured, do not recompute

```
Screen          1024 × 600, confirmed by xrandr on the Pi
Physical glass  15.1 × 8.9 cm  ·  172 ppi  ·  67.7 px per cm
Palette         css/tokens.css only. No new colours.
Font            Inter, self-hosted. Do not add a font.

css/style.css is loaded by index.html and NOTHING else.
css/virtual-keyboard.css is loaded by index.html AND talk.html.
```

## Rules

1. **If a FIND block does not match, STOP.** Say which number. Do not guess.
2. One commit per numbered edit unless a part says otherwise.
3. Fix nothing that is not listed. Note it in your report instead.

---

# Part 1 · Remove the language toast

A toast reading "us English mode" appears on every `index.html` load. It was
written for a language-chip tap and fires on page load as collateral, announcing
a setting for a screen the user has not opened. The "us" is the 🇺🇸 flag falling
back to letters — Inter carries no flag glyphs.

### 1.1 · The toast call

```
FILE     js/script.js
FIND         showToast(lang === 'fil-PH' ? '🇵🇭 Filipino (Tagalog) mode' : '🇺🇸 English mode');
         }
         window.setTtsLanguage = setTtsLanguage;
REPLACE  }
         window.setTtsLanguage = setTtsLanguage;
WHY      setTtsLanguage() runs on every page load (js/script.js:521, comment
         "Run initially to set the correct visual state on load") purely to set
         the chips' active class.
```

### 1.2 · showToast itself — no callers left

```
FILE     js/script.js
ACTION   Delete the whole showToast function (around line 452,
         `function showToast(msg, ms = 3000) {`) and its body.
PROVE    findstr /s /n "showToast" js\*.js *.html
         After 1.1 the only match must be the definition. Anything else — STOP.
```

### 1.3 · The toast element and its styles

```
FILE     index.html
ACTION   Delete <div id="sk-toast" class="sk-toast"></div>, and the .sk-toast
         rule plus any .sk-toast.show or keyframes serving only it, inside the
         <style> block. Find by selector, not by line number.
PROVE    findstr /s /n "sk-toast" *.html js\*.js  → nothing must remain.
```

`setTtsLanguage()` itself stays. It sets the active chip and disables the mic on
Filipino. Only the toast goes.

**Commit 1.1–1.3 together.**

---

# Part 2 · Dashboard card polish

### 2.1 · Even border weight on all four cards

```
FILE     css/style.css
FIND     #dashboard-pane .card-btn {
             background: #ffffff;
             border: 1px solid rgba(217, 226, 236, 0.6);
REPLACE  #dashboard-pane .card-btn {
             background: #ffffff;
             border: 2px solid var(--border, #e2e8f0);
WHY      1px at 60% opacity on a near-white card is invisible, while the
         highlighted card carries a solid 2px. The row reads as three
         borderless cards plus one bordered one, not four cards with one
         highlighted. Same weight everywhere; colour is the only difference.
         box-sizing is border-box (css/style.css:23) so widths do not change.
VERIFY   all four .card-btn are 200px wide and identical in height. Report all
         four heights.
```

### 2.2 · Focus must not paint a border

```
FILE     css/style.css
FIND     #dashboard-pane .card-btn:focus-visible {
             border-color: #1b355a;
         }
REPLACE  #dashboard-pane .card-btn:focus-visible {
             outline: 3px solid #1b355a;
             outline-offset: 2px;
         }
WHY      "Learn Signs" is an <a>. Returning from that page restores focus to the
         link, and the navy border then stays until something else is clicked —
         on a kiosk, most of the day. A focus ring must not be mistakable for
         the one deliberate highlight. An outline sits outside the border and
         changes no layout.
VERIFY   Tab to a card: an outline appears and border-color does not change.
         Visit learn-signs.html, press Back: the Learn Signs card's border
         matches the other two plain cards.
```

### 2.3 · The orange icon has never worked

```
FILE     css/style.css
FIND     #dashboard-pane .card-icon-highlight {
             color: var(--orange, #f97316);
         }
REPLACE  #dashboard-pane .card-icon.card-icon-highlight {
             color: var(--orange, #f97316);
         }
WHY      .card-icon-highlight (~line 201) and .card-icon (~line 205) have equal
         specificity, so source order decides and the later base rule wins. The
         markup is correct — the CSS has always lost. Two classes raise
         specificity so it wins wherever it sits.
VERIFY   getComputedStyle(document.querySelector('.card-icon-highlight')).color
         is rgb(249, 115, 22). The other three icons stay navy.
```

---

# Part 3 · Hover out, touch feedback in

**Read this whole part before editing anything.**

## The finding

```
                :active rules
css/style.css        0
index.html           2
reports.html         1
talk.html            0      ← none at all
```

`talk.html` has no `:active` anywhere. Sign, Speak or Type, End Conversation,
Add to Conversation, Try again, Continue, End Now — **none of them change when
pressed.** The dashboard cards are the same: `:hover` and `:focus-visible` only.

On a touchscreen, a tap with no visible response reads as a tap that did not
register, so the user taps again. On a kiosk with recognition latency that is
how double submissions happen.

So **removing hover without adding `:active` makes this worse**, not better.
Today at least something happens on a desktop, which is why it was noticed at
all. Do both or neither.

## The rule

```
:hover          does not exist on touch    →  remove
:active         works on touch             →  this is what is missing
:focus-visible  keyboard only              →  keep, it is the only
                                              indication a keyboard user gets
```

`:focus-visible` is not hover. It does not fire from a finger or a mouse-over.
Leave every one of them alone.

## Scope — this part only touches three files

`index.html`, `css/style.css`, `talk.html`.

**Do NOT touch `reports.html` or `gesture-training.html`.** Those sit behind a
PIN and are used by an operator who may well have a mouse. Hover is legitimate
there. They are a separate decision, deliberately deferred.

### 3.1 · Remove hover from the dashboard cards

```
FILE     css/style.css
FIND     @media (hover: hover) {
             #dashboard-pane .card-btn:hover {
                 transform: translateY(-5px);
                 box-shadow: 0 20px 30px -10px rgba(27, 53, 90, 0.12), 0 10px 15px -8px rgba(27, 53, 90, 0.08);
                 border-color: #1b355a;
             }
         }
REPLACE  (delete the whole block)
WHY      docs/ui-target/README.md: "No hover states — a touchscreen has no
         hover." The @media guard was a compromise that served nobody: on the
         Pi, hover:hover is false so it never runs; on a desktop its only
         effect so far has been a raised card mistaken for a bug.
```

### 3.2 · Add press feedback to the dashboard cards

```
FILE     css/style.css
ACTION   Add, immediately after the .card-btn rule:

         #dashboard-pane .card-btn:active {
             transform: scale(0.97);
             border-color: #1b355a;
         }

         And in the .card-btn rule itself, replace the existing transition
         with:

             transition: transform 0.08s ease, border-color 0.08s ease;

WHY      80ms so the press is felt, not watched. scale(0.97) reads as the card
         going down under the finger. The border darkens so the feedback
         survives even if the scale is missed at a glance.
VERIFY   Tap and hold a card in DevTools touch emulation: transform is
         scale(0.97) while held, "none" after release. Report both.
```

### 3.3 · Remove hover from index.html's inline styles

```
FILE     index.html
ACTION   Inside the <style> block, delete these :hover rules:

             .tts-back:hover
             .tts-mode-btn:hover
             #translator-pane #start-btn:hover
             #translator-pane #text-sign-btn:not(:disabled):hover
             .tts-reset-btn:hover
             .sk-key:hover
             .sk-key.action:hover
             .sk-key.close:hover
             .tts-lang-chip:hover

         Find each by selector, not by line number. Where a selector appears in
         a comma-separated list with a non-hover selector, remove only the
         :hover part and leave the rest of the list intact.

WHY      Nine hover rules on a screen touched with fingers, including the
         keyboard keys.
PROVE    findstr /n ":hover" index.html  → zero matches afterwards.
```

### 3.4 · Press feedback where index.html loses it

```
FILE     index.html
ACTION   .sk-key already has :active (~line 428) — leave it. Confirm the same
         for .sk-key.action and .sk-key.close; if either has no :active, add
         one matching .sk-key:active's treatment.

         Add :active to the four controls that lose their only feedback in 3.3:

             .tts-back:active        background: rgba(255,255,255,.22);
             .tts-mode-btn:active    background: #ea6a0a;
             .tts-reset-btn:active   background: #f1f5f9;
             .tts-lang-chip:active   background: #f1f5f9;

         #start-btn and #text-sign-btn: check for an existing :active first.
         Add one only if absent.

WHY      #ea6a0a is the pressed orange already in docs/ui-target/README.md.
         Every other value is the hover value being removed, reused as the
         press value — same visual, correct trigger.
VERIFY   findstr /n ":active" index.html — report the count before and after.
```

### 3.5 · Press feedback for talk.html — none exists

```
FILE     talk.html
ACTION   Add :active to every tappable control. There are no :hover rules in
         this file to remove — it has neither hover nor active today.

         Controls that need it:
             .back-btn
             the two who-first cards
             the Stop & Add button
             the mic button and Send button
             the two turn buttons (Sign, Speak or Type)
             End Conversation
             Add to Conversation, Try again
             Continue, End Now
             the error card's button

         Treatment, by kind:
             orange buttons    background: #ea6a0a
             navy buttons      filter: brightness(1.25)
             white cards       transform: scale(0.97) and border-color: var(--navy)
             text-only buttons background: rgba(0,0,0,0.05)

         Transition 0.08s on the property that changes. Nothing longer — this
         is press feedback, not an animation.

WHY      Not one control in the conversation UI responds to being pressed. On a
         kiosk this is the difference between a user who knows their tap landed
         and one who taps again and sends the message twice.
VERIFY   For each control: press-and-hold in touch emulation, read the changed
         property, release, confirm it returns. Report the list with before and
         after values. If any control cannot show feedback for a structural
         reason, say which and why — do not skip it silently.
```

### 3.6 · Update the spec

```
FILE     docs/ui-target/README.md
FIND     - No hover states — a touchscreen has no hover, so anything only
           reachable by hovering is unreachable
REPLACE  - No hover states — a touchscreen has no hover, so anything only
           reachable by hovering is unreachable. Every tappable control MUST
           have an `:active` state instead: a tap with no visible response
           reads as a tap that did not register, and the user taps again.
           `:focus-visible` is not hover and stays — it is the only indication
           a keyboard user gets.
WHY      The spec said what to remove and never said what to put in its place,
         which is how talk.html shipped with zero press feedback.
```

---

# Part 4 · Correct MANUAL-CHECKS.md

```
FILE     docs/system/MANUAL-CHECKS.md

4.1  FIND     all 5 cards
     REPLACE  all 4 cards, each with a caption beneath its label
     WHY      The dashboard has four cards now. A checklist that describes a
              screen that no longer exists teaches the reader to distrust it.

4.2  ACTION   Add to the 1024×600 section:

              - [ ] Stand in front of the real Pi at the distance it will
                    actually be used — arm's length, standing. Can you read
                    the card captions ("Practise FSL", "Talk with someone")?
                    17px renders at 2.5 mm on this panel. If you have to work
                    at it, raise the caption to 19px and re-check.

     WHY      The one open question on index.html that no measurement from a
              desktop can answer.

4.3  ACTION   Mark these existing talk.html items
              `[DEFERRED — signing screen is being rebuilt]`:
                - the full happy-path walk (Who speaks first → Sign Language →
                  Stop & Add → confirm → thread)
              Leave every other talk.html item active — the keyboard, the idle
              timer, End Conversation and the 30-message cap are not changing.
     WHY      The signing screen is about to be replaced by the real
              sign-to-text camera UI. Testing a path that is about to be
              rebuilt spends the one resource automation cannot replace: your
              hands on a real touchscreen.
```

---

# Verify — after all parts

Measured from the live DOM at exactly 1024 × 600.

```
1    no toast on index.html load; zero "sk-toast" matches in the repo
2.1  four cards, equal width 200px, equal height, 2px borders
2.2  focus draws an outline, not a border
2.3  the Let's Talk icon computes rgb(249, 115, 22)
3.1  zero ":hover" matches in css/style.css
3.3  zero ":hover" matches in index.html
3.5  every talk.html control changes on press and returns on release
```

Also:

- `document.scrollWidth` is exactly 1024 on `index.html` and every `talk.html`
  state
- zero console errors on `index.html`, `talk.html`, `sign-to-text.html`,
  `reports.html`, `gesture-training.html`, `learn-signs.html`
- exactly one orange element on the dashboard
- all four cards still navigate

## The net

Screenshot every page at 1024 × 600 before and after.

`index.html` and `talk.html` are supposed to change. **Every other page must be
pixel-identical.** If one is not, report which and what changed.

Watch for this specifically: `js/script.js` is loaded by more than
`index.html`. Deleting `showToast` is safe only if 1.2's PROVE step returned
nothing. If it returned a caller you did not expect, stop.

## Gates

```
git diff --stat  →  js/script.js, index.html, css/style.css, talk.html,
                    docs/ui-target/README.md, docs/system/MANUAL-CHECKS.md
                    Nothing else.

zero requests for js/lib/tf.min.js, js/lib/mediapipe/hands.js, js/vosk.js
in any state of talk.html
```

**A note on that last gate, learned the hard way:** measure it in a fresh tab.
A tab that has already visited other pages shows their requests in its network
history and makes this gate look like it failed when it did not. That is the
fourth time in this project a measuring tool has produced a false finding —
see the methodology note in `docs/system/UI-SURVEY-1024x600.md`.

---

# When you are finished

Add at the top of this file:

```
STATUS: applied <date>, commits <first>..<last>. Items skipped: <none, or which>.
```

Then report: every before and after value, anything skipped and why, and —
most importantly — **anything in this work order that turned out to be wrong.**
It was written from an analysis, and an analysis can be stale.

---

# What comes next — not in this work order

**The open design question.** The "Sign Language" screen in `talk.html` is a
placeholder. The real `sign-to-text.html` camera UI moves into it. That file
already has its own three-state machine — `#tl-state-instr`, `#tl-state-cam`,
`#tl-state-result` — and its result state is effectively the confirm step
`talk.html` already has.

The shape proposed, and not yet approved by the owner:

- no guide screen; the camera starts immediately
- one hint line inside the camera frame, overlaid, costing zero layout height:
  *Sign "start" to begin · "stop" when finished*
- a "?" in the header opens the full guide as a modal
- that modal opens by itself on the first turn of a conversation only

Do not build this. It needs the owner's answer first.

**Also still open:**

- `docs/system/MANUAL-CHECKS.md` has never been run end to end
- merge to `main` and tag `phase-4`
- `reports.html` and `gesture-training.html` hover rules — operator screens,
  deliberately deferred
- the CSS consolidation: four divergent `:root` blocks, 903 lines of inline
  `<style>` across `index.html` and `reports.html`, and `css/tokens.css` used
  by only two files
