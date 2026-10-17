/**
 * Reusable Global On-Screen Virtual Keyboard for touchscreen kiosks.
 * Automatically binds to any focused text inputs or textareas on the page.
 */
(function () {
    let activeInput = null;
    let capsOn = false;
    let keyboardEl = null;
    // Set on pointerdown, in the capture phase — before focusin's
    // showKeyboard() can shift the layout — so it holds the real target the
    // gesture started on, even if the click that follows lands somewhere
    // else because the keyboard opening moved things underneath it.
    let pointerDownTarget = null;

    // Keyboard keys layout template
    const rows = [
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
        ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
        ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
        ["caps", "z", "x", "c", "v", "b", "n", "m", "backspace"],
        ["clear", "-", "'", ",", "space", ".", "?", "!", "hide"]
    ];

    function initKeyboard() {
        if (document.getElementById('sk-global-keyboard')) return;

        // Create keyboard wrapper
        keyboardEl = document.createElement('div');
        keyboardEl.id = 'sk-global-keyboard';
        keyboardEl.className = 'sk-keyboard-wrap';

        // Build HTML rows
        rows.forEach(rowKeys => {
            const rowEl = document.createElement('div');
            rowEl.className = 'sk-keyboard-row';

            rowKeys.forEach(key => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'sk-key';

                if (key === 'caps') {
                    btn.classList.add('ctrl', 'caps');
                    btn.id = 'sk-kb-caps';
                    btn.textContent = 'abc';
                } else if (key === 'backspace') {
                    btn.classList.add('ctrl');
                    btn.textContent = 'Back';
                } else if (key === 'space') {
                    btn.classList.add('space');
                    btn.textContent = 'Space';
                } else if (key === 'clear') {
                    btn.classList.add('ctrl');
                    btn.textContent = 'Clear';
                } else if (key === 'hide') {
                    btn.classList.add('ctrl');
                    btn.textContent = 'Hide';
                } else {
                    btn.textContent = key;
                    btn.setAttribute('data-char', key);
                }

                btn.addEventListener('pointerdown', (e) => {
                    e.preventDefault(); // Prevent input from losing focus
                    handleKeyPress(key, btn);
                });

                rowEl.appendChild(btn);
            });

            keyboardEl.appendChild(rowEl);
        });

        document.body.appendChild(keyboardEl);

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
    }

    function handlePointerDown(e) {
        pointerDownTarget = e.target;
    }

    function handleFocusIn(e) {
        const target = e.target;
        // type=password too (accounts-quiz phase: login.html and users.html have password fields).
        if (target && (target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'search' || target.type === 'password' || !target.type) || target.tagName === 'TEXTAREA')) {
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

    function showKeyboard() {
        if (keyboardEl) {
            keyboardEl.classList.add('show');
            document.body.classList.add('keyboard-active');
            document.documentElement.classList.add('keyboard-active');
        }
    }

    function hideKeyboard() {
        if (keyboardEl) {
            keyboardEl.classList.remove('show');
            document.body.classList.remove('keyboard-active');
            document.documentElement.classList.remove('keyboard-active');
        }
        if (activeInput) {
            activeInput.blur();
            activeInput = null;
        }
    }

    function handleKeyPress(key, btn) {
        if (!activeInput) return;

        if (key === 'hide') {
            hideKeyboard();
            return;
        }

        const startPos = activeInput.selectionStart || 0;
        const endPos = activeInput.selectionEnd || 0;
        const originalVal = activeInput.value;

        if (key === 'clear') {
            activeInput.value = '';
            triggerInputEvent(activeInput);
            return;
        }

        if (key === 'backspace') {
            if (startPos === endPos && startPos > 0) {
                activeInput.value = originalVal.slice(0, startPos - 1) + originalVal.slice(endPos);
                activeInput.selectionStart = activeInput.selectionEnd = startPos - 1;
            } else {
                activeInput.value = originalVal.slice(0, startPos) + originalVal.slice(endPos);
                activeInput.selectionStart = activeInput.selectionEnd = startPos;
            }
            triggerInputEvent(activeInput);
            return;
        }

        if (key === 'caps') {
            capsOn = !capsOn;
            btn.classList.toggle('active', capsOn);
            btn.textContent = capsOn ? 'ABC' : 'abc';
            updateKeyLabels();
            return;
        }

        // Handle space and normal characters
        let charToInsert = (key === 'space') ? ' ' : key;
        if (capsOn && key !== 'space' && /[a-z]/.test(key)) {
            charToInsert = charToInsert.toUpperCase();
        }

        activeInput.value = originalVal.slice(0, startPos) + charToInsert + originalVal.slice(endPos);
        activeInput.selectionStart = activeInput.selectionEnd = startPos + charToInsert.length;
        
        triggerInputEvent(activeInput);
    }

    function updateKeyLabels() {
        if (!keyboardEl) return;
        const charKeys = keyboardEl.querySelectorAll('[data-char]');
        charKeys.forEach(btn => {
            const baseChar = btn.getAttribute('data-char');
            btn.textContent = capsOn ? baseChar.toUpperCase() : baseChar.toLowerCase();
        });
    }

    function triggerInputEvent(el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initKeyboard);
    } else {
        initKeyboard();
    }
})();
