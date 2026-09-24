# Cycle 003 — signing-screen-controls-redesign — REPORT

---

## Item 1

ITEM: FILE: talk.html — `#screen-signing`'s camera flanked by two 200px
`.signing-side` columns (ESL/FSL left, Hand Guide right), leaving it only
560px wide (54.7% of 1024px). Fix: four CSS/HTML edits — new
`.signing-row` (centred, no side children), `.lang-toggle`/`.lang-seg`/
`.guide-toggle` classes, `.camera-box` widened to 760px,
`.signing-controls-row` (760px flex row below the camera) replacing the
old fixed-width `.stop-signing-btn` rule, and the matching HTML rewrite:
side columns removed, controls row added below camera with same ids.

STATUS: done

CHANGED: talk.html (CSS lines ~653–689 post-edit; HTML lines ~1104–1135
post-edit). Commit 29843f4 — "talk.html: signing screen controls redesign
— widen camera to 760px, controls row below"
  1 file changed, 61 insertions(+), 18 deletions(-)

  EDIT 1 (CSS — FIND 1): Replaced `.signing-row{…align-items:flex-start…}`
  + `.signing-side{…}` with redesigned `.signing-row{justify-content:center}`
  + new `.lang-toggle`, `.lang-seg`, `.guide-toggle` (including `::before`
  state dot and `.active` variants). `.mode-chip` left untouched (line
  immediately follows; #screen-speaking's EN/Filipino chips still use it).

  EDIT 2 (CSS — FIND 2): `.camera-box` width changed from 560px → 760px.

  EDIT 3 (CSS — FIND 3): `.signing-controls-row{display:flex;…width:760px;
  margin-top:14px}` inserted before `.stop-signing-btn`, which changed from
  `width:560px;height:68px;margin-top:14px` to `flex:1;height:68px`
  (no more fixed width, no more margin-top — the row provides both).

  EDIT 4 (HTML — FIND 4): Both `.signing-side` divs removed; `.camera-box`
  kept as the only child of `.signing-row`; `.signing-controls-row` div
  added below with `#chip-esl` (class lang-seg), `#chip-fsl` (class lang-seg),
  `#stop-signing-btn` (unchanged stop-signing-btn), `#chip-guide` (class
  guide-toggle). All four ids identical; JS wiring untouched.

VERIFY RESULT: partial pass — static verified; browser measurements
(scrollWidth, computed width, chip-toggle behaviour) require manual
confirmation.

  Static (pass):
  - git show HEAD~1:talk.html | grep — confirms:
      · `width:760px;height:300px;`  (REPLACE 2, camera-box)
      · `.signing-controls-row{…width:760px…}` (REPLACE 3)
      · `<div class="signing-controls-row">` in HTML (REPLACE 4)
      · `id="chip-esl"`, `id="chip-fsl"`, `id="chip-guide"` all inside
        `.signing-controls-row` (REPLACE 4)
      · `chip-guide` markup reads "Guide" (REPLACE 4)
      · `.signing-side` appears only in comments — zero live elements
  - `git diff --stat HEAD` (post-both-commits): only pre-existing
    uncommitted edits (MEMORY.md, MANUAL-CHECKS.md). Both talk.html and
    js/talk-signing.js are committed and clean.

  Browser (manual required — needs a real page load to the signing
  live sub-state):
  - `#camera-box` computed width === 760px (not 560px).
  - `document.querySelectorAll('.signing-side').length === 0`.
  - `#chip-esl`, `#chip-fsl`, `#chip-guide`, `#stop-signing-btn` all
    present, all inside one `.signing-controls-row`.
  - `document.body.scrollWidth === 1024` on the signing screen.
  - Zero console errors.
  - Tap `#chip-fsl` → gains `.active`, `#chip-esl` loses it
    (js/talk-signing.js:63-64 wiring, untouched).

---

## Item 2

ITEM: FILE: js/talk-signing.js — `syncChips()` line 67 overwrites
`#chip-guide`'s textContent with `'Hand Guide: ' + (on ? 'On' : 'Off')`
on every call (init + every toggle), silently undoing Item 1's static
short "Guide" HTML label. Fix: replace that assignment with
`g.textContent = 'Guide'` — on/off state now shows via `.active` class
(navy background) and the CSS `::before` state dot (green when active).

STATUS: done

CHANGED: js/talk-signing.js lines 61–75 (post-edit). Commit ce46fff —
"js/talk-signing.js: syncChips writes static 'Guide' label, not
'Hand Guide: On/Off'"
  1 file changed, 6 insertions(+), 1 deletion(-)

  One-line change to `syncChips()`: `g.textContent = 'Hand Guide: ' +
  (on ? 'On' : 'Off')` → `g.textContent = 'Guide'`. All other lines in
  the function are byte-for-byte identical to HEAD^ in the committed result.

VERIFY RESULT: partial pass — static verified; toggle behaviour
(text stays static, dot changes colour) requires manual confirmation.

  Static (pass):
  - git show HEAD:js/talk-signing.js | grep textContent — confirms
    `g.textContent = 'Guide'` is the only assignment for chip-guide's
    text; the string 'Hand Guide:' does not appear in the committed file.
  - Both commits (29843f4, ce46fff) touch exactly the two named files;
    git diff --stat HEAD shows only pre-existing uncommitted edits.

  Browser (manual required):
  - `#chip-guide` reads exactly "Guide", not "Hand Guide: On/Off".
  - Tap `#chip-guide` — text stays "Guide"; `.active` and `aria-pressed`
    toggle; state dot colour changes (green active → muted inactive).
  - Zero console errors.

---

## Scope check

git diff --stat HEAD (post-both-commits): MEMORY.md and MANUAL-CHECKS.md
only — both pre-existing uncommitted edits, confirmed by their presence
in the same position in cycle 001 and 002. Neither talk.html nor
js/talk-signing.js appears (both committed clean). ✓
