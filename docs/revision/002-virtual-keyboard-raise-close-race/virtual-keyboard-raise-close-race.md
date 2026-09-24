# Cycle 002 — virtual-keyboard-raise-close-race

Read `docs/revision/RULES.md` and `docs/revision/MEMORY.md` before executing
this file. This is a Precise item (JS logic/state change). Three FIND/REPLACE
edits, same file, same issue — apply all three or none.

FILE: js/virtual-keyboard.js

ISSUE: Tapping/clicking a text input raises the on-screen keyboard and
immediately hides it again (docs/system/DEBT.md item 54, High severity,
found during the text-to-sign merge's final review). Traced sequence:
mousedown on the input -> focusin fires -> handleFocusIn() calls
showKeyboard(), which shifts the layout (keyboard slides up, other elements
move) -> by the time mouseup/click fire, the pointer is no longer over the
input (the layout moved under it) -> click's e.target is some other element
(e.g. the screen container) -> handleDocClick() (js/virtual-keyboard.js:90-96)
sees a click whose target is not activeInput and not inside the keyboard, and
calls hideKeyboard(), which also blurs the input. Reproduced with both real
mouse events and emulated touch. This is in the shared global keyboard file,
so it affects every page that uses it (talk.html's Speak or Type, and any
other text input this keyboard binds to), not just one screen.

FIX: Record the real gesture-start target on `pointerdown`, in the capture
phase, before showKeyboard()'s layout shift can happen. In handleDocClick(),
if that recorded start target is the currently active input, treat this
click as belonging to the same tap that opened the keyboard and do not close
it — regardless of where the click's own event.target ended up after the
layout moved. The existing outside-tap-to-close behavior (tap somewhere that
was never the active input) is unchanged.

FIND 1:
    let activeInput = null;
    let capsOn = false;
    let keyboardEl = null;
REPLACE 1:
    let activeInput = null;
    let capsOn = false;
    let keyboardEl = null;
    // Set on pointerdown, in the capture phase — before focusin's
    // showKeyboard() can shift the layout — so it holds the real target the
    // gesture started on, even if the click that follows lands somewhere
    // else because the keyboard opening moved things underneath it.
    let pointerDownTarget = null;

FIND 2:
        // Bind event listeners to existing and future inputs
        document.addEventListener('focusin', handleFocusIn);
        // Dismiss on click, not pointerdown: closing the keyboard can restore a
        // layout (index.html voice screen), and doing that mid-tap moves the
        // tapped control out from under the finger before the click lands.
        document.addEventListener('click', handleDocClick);
REPLACE 2:
        // Bind event listeners to existing and future inputs
        document.addEventListener('focusin', handleFocusIn);
        // Capture phase, ahead of focusin: records the gesture's real start
        // target before showKeyboard()'s own layout shift can move anything
        // (docs/system/DEBT.md item 54 — opening the keyboard shifts the
        // layout mid-tap, the same way the comment below already knew
        // closing it could).
        document.addEventListener('pointerdown', handlePointerDown, true);
        // Dismiss on click, not pointerdown: closing the keyboard can restore a
        // layout (index.html voice screen), and doing that mid-tap moves the
        // tapped control out from under the finger before the click lands.
        document.addEventListener('click', handleDocClick);

FIND 3:
    function handleFocusIn(e) {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'search' || !target.type) || target.tagName === 'TEXTAREA')) {
            // Prevent virtual keyboard popup if it's explicitly disabled via a dataset
            if (target.dataset.noKeyboard === 'true') return;

            activeInput = target;
            showKeyboard();
        }
    }

    function handleDocClick(e) {
        if (!keyboardEl || !keyboardEl.classList.contains('show')) return;

        // If clicked outside active input and outside the keyboard container, hide it
        if (activeInput && e.target !== activeInput && !keyboardEl.contains(e.target)) {
            hideKeyboard();
        }
    }
REPLACE 3:
    function handlePointerDown(e) {
        pointerDownTarget = e.target;
    }

    function handleFocusIn(e) {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'search' || !target.type) || target.tagName === 'TEXTAREA')) {
            // Prevent virtual keyboard popup if it's explicitly disabled via a dataset
            if (target.dataset.noKeyboard === 'true') return;

            activeInput = target;
            showKeyboard();
        }
    }

    function handleDocClick(e) {
        if (!keyboardEl || !keyboardEl.classList.contains('show')) return;

        // A tap that started on the input now active must never close the
        // keyboard it just opened, even if the keyboard's own layout shift
        // moved this click's target elsewhere by the time it landed
        // (docs/system/DEBT.md item 54).
        if (activeInput && pointerDownTarget === activeInput) return;

        // If clicked outside active input and outside the keyboard container, hide it
        if (activeInput && e.target !== activeInput && !keyboardEl.contains(e.target)) {
            hideKeyboard();
        }
    }

WHY: The keyboard is the only text-entry path on talk.html's Filipino side
(mic intentionally off) and on the mic-failure "Type instead" fallback, so a
tap that can't reliably open it blocks those paths entirely. Fixing the
shared file fixes it everywhere the keyboard is used, not just talk.html.

VERIFY: In real Chrome (or the same headless-Chrome + simulated-event method
used to originally trace this bug), reproduce the exact sequence: mousedown
on a bound text input, then mouseup and click on a different element the
layout shift would put under the pointer (e.g. the screen container).
Confirm the keyboard stays open (`#sk-global-keyboard` still has class
`show`, the input is still `document.activeElement`) after that sequence —
before the fix it would have closed. Then confirm the existing dismiss path
is unchanged: with the keyboard open, a tap that starts AND ends on an
unrelated element (never touches the active input) still closes it. Run
both checks with a plain mouse click and with emulated touch, on at least
one page other than talk.html that also uses this keyboard (e.g.
gesture-training.html), since the fix is in the shared file.
