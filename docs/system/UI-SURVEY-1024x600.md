# UI survey at 1024 × 600

Target screen: the Raspberry Pi's 7-inch touchscreen, 1024 × 600.

Surveyed in the browser at that exact viewport, with measurements taken from the
live DOM rather than read off screenshots. Every figure below is a measured
value, not an estimate. Where something could not be verified, it says so.

Nothing was changed. This is a survey.

**Status: all four findings resolved** in the phase that followed (commits
`0f077ce`, `ff38d10`, `bc21a9f`, `e382a5c`). Each finding keeps its original
text; the measured after-values sit beside the before-values under
**Resolved**. What changed and why is recorded in `docs/system/UI.md`
("1024×600 layout fixes") and `docs/system/DEBT.md` items 34–38.

---

## 1. The virtual keyboard covers the text input — serious

**Screen:** `index.html?screen=voice`

The on-screen keyboard is 240 px tall and parks at `bottom: -280px` while
hidden, which is correct. When it opens, its top edge sits at y = 360.

The text input sits at y = 428 to 466 — entirely behind the keyboard.

Confirmed visually with the keyboard open. What remains visible above it is the
microphone button, the "Tap to Speak" label, and the English / Filipino toggle.
What the keyboard covers:

- the text input itself
- the MICROPHONE INPUT dropdown
- the "— OR —" divider
- the Translate button
- the English mode button

So a user taps the text field in order to type, and the field they are typing
into disappears. They cannot see what they are entering.

This is not cosmetic. On a 600 px-tall screen the text-entry path is unusable.
~~It does not appear on a desktop monitor because there is enough height for
both.~~ **Corrected:** it does appear on desktop monitors. The controls panel
centres vertically, so the input moves down as the screen gets taller, and
the keyboard (280 px tall above 620 px) rises with it. Measured with the
keyboard open, before the fix:

| Viewport | Text input | Translate | Keyboard top | Result |
|---|---|---|---|---|
| 1024 × 768 | 561.5–611.5 | 627.5–677.5 | 488 | input fully covered |
| 1024 × 900 | 627.5–677.5 | 693.5–743.5 | 620 | input partly covered |
| 1024 × 1080 | 717.5–767.5 | 783.5–833.5 | 800 | Translate covered |
| 1920 × 1080 | 717.5–767.5 | 783.5–833.5 | 800 | same; width has no effect |
| 1024 × 1146 | 750.5–800.5 | 816.5–866.5 | 866 | Translate over by 0.5 px |
| 1024 × 1147 | 751–801 | 817–867 | 867 | first height where both clear |

**Needs a design decision, not a mechanical fix.** Three directions, each with a
different result on screen:

- Reduce the keyboard's height on short viewports
- Shift or scroll the page content upward while the keyboard is open
- Move the text input above the microphone button, so it sits clear of the
  keyboard's area

**Resolved** (`0f077ce`). Decision taken: the second direction. While the
keyboard is open, hide the speech controls and move the rest to the top.
Keyboard shrinking was ruled out by arithmetic, and moving the input
permanently would have changed the resting layout. At 1024 × 600, keyboard
open, keyboard top at 360 both times:

| | Before | After |
|---|---|---|
| Text input (initial state) | 452–490 (428–466 closed; the shared keyboard CSS pushed it 24 px lower on open) | **146–184** |
| Translate (initial state) | 500–538 | **194–232** |
| Text input (result state) | 452.5–488.5 | **146–182** |
| Translate (result state) | 498.5–536.5 | **192–230** |
| Text input / Translate with a 5-line transcript (initial) | — | 236.9–274.9 / 284.9–322.9 |
| Text input / Translate with a 6-line transcript (result) | — | 253.1–289.1 / 299.1–337.1 |
| All 51 elements of the voice screen, keyboard closed | baseline | identical, both states, and identical again after open → close |

With the keyboard open, the input and Translate button clear it at every
height from 620 to 1146 (both are at 171–221 and 237–287 from 621 px up). At
1147 px and above nothing changes, open or closed. Tapping Translate with the
keyboard open used to land on the microphone button, because the keyboard
closed on `pointerdown` and restored the layout mid-tap. It now closes on
`click`. That was verified by dispatching the events in the page, not with a
real touch; see `docs/system/MANUAL-CHECKS.md`.

---

## 2. Guide text hides 68 px behind an internal scroll — moderate

**Screen:** `sign-to-text.html`

`.tl-instr-container` has 588 px of content in a 520 px box. 68 px of the guide
is below the fold of that card, reachable only by scrolling inside it.

There is no visible scrollbar or other cue that more text exists. On a
touchscreen, a user who does not think to swipe will read part of the
instructions and assume that is all of them.

**Resolved** (`ff38d10`, `bc21a9f`). Decision taken: make it obvious that the
guide scrolls. Making all of it visible was ruled out: the card needs 607.5 px
and only 472 px is available, and closing a 135 px gap without shrinking text
would mean restyling the card. Measured at 1024 × 600:

| | Before | After |
|---|---|---|
| `.tl-instr-container` scrollHeight / clientHeight | 588 / 520 (hides content) | **520 / 520** (hides nothing) |
| Guide card | 24.3–631.7 (607.5 px tall) | **92–564** (472 px tall) |
| Card top out of scroll reach | 43.7 px, including 6.7 px of the Guide badge | **0** (badge at 129–157) |
| Scrolling region | whole container, no cue | step list only: scrollHeight 262 / clientHeight 127 |
| Cue that more is below | none | bottom 40 px of the list fades out (`.has-more`) while it is not scrolled to the end; the fade goes at the end and never appears where the list fits (768 px tall and up) |

The survey's "68 px" was the part reachable by scrolling. A further 43.7 px of
the card, at the top, was clipped where no scroll could reach it (the flex
container centred content that overflowed both ends).

---

## 3. "Start Translating" sits 4 px from the bottom edge — minor

**Screen:** `sign-to-text.html`

The button spans y = 535 to 595 in a 600 px viewport. It fits, with four pixels
to spare.

Not broken, but there is no margin for error. Any change to font size, padding
or text length above it pushes the button off the screen, and the screen's only
forward action disappears.

**Resolved** (`ff38d10`). Measured at 1024 × 600:

| | Before | After |
|---|---|---|
| Button top–bottom | 534.7–594.7 | **467–527** |
| Space to the viewport's bottom edge | 5.3 px | **73 px** |
| Clipped by its scroll container (bottom at 588) | 6.7 px | **0** |
| Button size | 578 × 60 | 578 × 60 (unchanged) |

The button was already clipped by 6.7 px, not just close to the edge: its
scroll container ends at y = 588, not 600. The headroom is now fixed by
construction (card border 1 + card padding 36 + container padding 24 + page
padding 12 = 73 px). More text above the button grows the list's scroll instead of
moving the button; at 1024 × 700 it has the same 73 px.

---

## 4. Fifty-seven table cells truncate their text — minor

**Screen:** `reports.html`, behind the PIN

57 `<td>` elements have content wider than their cell and are cut with an
ellipsis. The CREATED column is the clearest case: dates render as
`2026-07-15 23:17:...`.

On a desktop a user hovers to see the full value. A touchscreen has no hover, so
the truncated portion is simply unreachable.

**Resolved** (`e382a5c`). Decision taken: widen Created (fixed-length timestamps)
to 150 px, and wrap free text (Label/Sign, Text, and the Key pills). Measured at
1024 × 600 on the current data, which has grown since the survey (the ESL
table now scrolls 4,949 px, not 4,633):

| `scrollWidth > clientWidth` | Before | After |
|---|---|---|
| ESL Signs cells | 68 (all Created) | **0** |
| FSL Signs cells | 53 (49 Created, 2 Label, 2 Text) | **0** |
| Translations cells | 7 (5 Created, 2 Text) | **0** |
| **All cells** | **128** | **0** |
| Key pills (a second, uncounted ellipsis) | 32 (ESL 11, FSL 21) | **0** |
| Rows made taller by wrapping | — | ESL 11, FSL 22, Translations 2 (all others unchanged) |

Timestamps ran 2–3 px past their 136 px column. The widest possible timestamp,
with every digit a "4", measures 129.9 px of 12 px Inter, plus 20 px padding.

---

## What is fine

`index.html` — all five dashboard cards fit. The last ends at x = 1002 in a
1024 px viewport, leaving a 22 px margin. No overflow in either direction.

`reports.html` structure — the PIN accepts, the three stat cards and all three
tabs are visible, and the table's internal scroll is deliberate and correct.
4,633 px of rows scroll inside `.table-wrap` as designed.

`gesture-training.html` — surveyed clean in an earlier pass.

No page overflows the viewport horizontally. `document.scrollWidth` is exactly
1024 on every screen checked.

---

## Two things this survey nearly got wrong

Recorded because the method matters as much as the findings.

**The dashboard cards looked cut off in a screenshot.** They are not. The
screenshot had been scaled down for transport, which cropped the right edge.
Measuring the elements showed all five fit with room to spare. A screenshot is
evidence of what an image contains, not of what the page does.

**The keyboard looked broken, parked off-screen below the viewport.** It is not
broken; `bottom: -280px` is its resting position and it slides up when needed.
The real problem turned out to be different, and worse — what it covers once it
arrives.

Both were caught by measuring instead of trusting the picture. Later sessions
should do the same.

---

## Order of work

1. The keyboard overlap. It is the only finding that makes a feature unusable,
   and it is the only one that needs a design conversation first.
2. The hidden guide text — a scroll cue, or a shorter guide.
3. The 4 px button margin — bank some headroom while the file is open anyway.
4. The truncated cells — decide what a touchscreen user does instead of hover.

Items 2 through 4 are small and have obvious answers. Item 1 does not.

All four done; see the **Resolved** notes above.
