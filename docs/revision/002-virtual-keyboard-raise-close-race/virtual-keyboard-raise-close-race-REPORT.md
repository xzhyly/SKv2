# Cycle 002 — virtual-keyboard-raise-close-race — REPORT

ITEM: FILE: js/virtual-keyboard.js — Tapping a text input raises the keyboard
and immediately hides it again (DEBT item 54). Traced sequence: focusin →
showKeyboard() shifts layout mid-tap → click lands on the now-underneath
screen container → handleDocClick() sees a non-input target and calls
hideKeyboard(). Fix: record the real gesture-start target in a capture-phase
pointerdown listener (before focusin's layout shift); in handleDocClick(),
bail if that start target is the currently active input.

STATUS: done

CHANGED: js/virtual-keyboard.js:6–13, 76–87, 90–118 (post-edit lines)
  Commit cdc1a16 — "js/virtual-keyboard.js: record pointerdown target to prevent raise-close race on tap"
  1 file changed, 21 insertions(+)

  Three edits, all applied:

  EDIT 1 — variable declaration (lines 6–13 post-edit):
    + let pointerDownTarget = null;  (with 4-line explaining comment)

  EDIT 2 — listener registration (line 83 post-edit, inside initKeyboard):
    + document.addEventListener('pointerdown', handlePointerDown, true);
      (inserted between focusin and click registrations, with comment)

  EDIT 3 — new handler + updated guard (lines 90–118 post-edit):
    + function handlePointerDown(e) { pointerDownTarget = e.target; }
    + if (activeInput && pointerDownTarget === activeInput) return;
      (inserted at top of handleDocClick, before the existing outside-click
      hide branch — that branch is unchanged)

  No other lines touched. handleFocusIn, showKeyboard, hideKeyboard,
  handleKeyPress, updateKeyLabels, triggerInputEvent, and the IIFE shell
  are all byte-for-byte identical to HEAD^ in the committed result.

VERIFY RESULT: partial pass — static code verified, browser event-sequence
  check requires manual confirmation.

  Static (pass):
  - git show HEAD:js/virtual-keyboard.js | grep pointerDownTarget /
    handlePointerDown — all four key lines present in committed file:
      · let pointerDownTarget = null;              (REPLACE 1)
      · addEventListener('pointerdown', handlePointerDown, true);  (REPLACE 2)
      · function handlePointerDown(e) {            (REPLACE 3)
      · pointerDownTarget = e.target;              (REPLACE 3)
      · if (activeInput && pointerDownTarget === activeInput) return;  (REPLACE 3)
  - git diff --stat HEAD (post-commit): js/virtual-keyboard.js only in this
    cycle's changes. MEMORY.md and MANUAL-CHECKS.md are pre-existing
    uncommitted edits (established during cycle 001). talk.html appeared in
    --stat with a CRLF warning only; git diff HEAD -- talk.html is empty.
  - All three FIND blocks matched exactly — no partial match, no substitution.

  Browser event-sequence (manual required — cannot drive pointerdown/click
  dispatch with layout shift in a static check):
  - Reproduce: mousedown on a bound text input → click on the screen container
    (where the layout shift puts the pointer). Expected after fix: keyboard
    stays open (class 'show' present on #sk-global-keyboard, input is still
    document.activeElement). Before fix: keyboard would close.
  - Confirm dismiss path unchanged: with keyboard open, tap that starts AND
    ends on an unrelated element. Expected: keyboard closes as before.
  - Run both checks with plain mouse and emulated touch, on at least one
    page other than talk.html (e.g. gesture-training.html), since the fix
    is in the shared file.
