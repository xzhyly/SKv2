# Cycle 001 — back-button-who-first

Read `docs/revision/RULES.md` and `docs/revision/MEMORY.md` before executing
this file. This is a Precise item (JS logic/state change).

FILE: talk.html

ISSUE: On the "who-first" screen (talk.html's entry point, `<body
data-screen="who-first">`), tapping the header Back button (`#backBtn`) does
nothing. Its handler calls `showScreen(hasMessages ? 'thread' :
'who-first')`; with no messages yet, that resolves to `'who-first'` — the
screen already showing — and `showScreen()`'s own same-screen check (`if
(previous === name) { return; }`) makes it a no-op. From signing/speaking,
Back does work (routes to thread or who-first); only from who-first itself
is there no way to leave talk.html via Back.

FIX: When the current screen is already `who-first`, Back should navigate to
the dashboard (`index.html`) instead of calling `showScreen()`. Every other
screen keeps its existing routing unchanged. Update the comment above the
handler too — it currently calls the same-screen case "harmless," which
stops being true once who-first gets a real action.

FIND:
    // Back button (header, top-left): visible on who-first/signing/speaking
    // (hidden on thread by the CSS rule Task 2 already wrote). Fix 3: routes
    // to 'thread' when at least one message already exists — per
    // docs/system/DECISIONS.md, "Who speaks first?" (who-first) is shown
    // once at the start of a conversation only, and turn 2+ reaches
    // signing/speaking through the thread screen's own Sign/Speak-or-Type
    // buttons, not through who-first. Routing Back to who-first
    // unconditionally would strand an in-progress conversation behind a
    // screen where #thread is display:none. On turn 1 (no messages yet,
    // reached directly from who-first), the thread has no .bubble-row yet,
    // so this still falls through to who-first, matching the original
    // behaviour. Existence check uses the same .bubble-row class
    // appendBubble() builds each bubble's row wrapper with (see
    // appendBubble() below). Tapping Back while already on the resulting
    // screen is a harmless no-op either way (showScreen() returns early for
    // a same-screen call).
    document.getElementById('backBtn').addEventListener('click', function () {
      var hasMessages = document.querySelector('#thread-list .bubble-row') !== null;
      showScreen(hasMessages ? 'thread' : 'who-first');
    });
REPLACE:
    // Back button (header, top-left): visible on who-first/signing/speaking
    // (hidden on thread by the CSS rule Task 2 already wrote). Fix 3: routes
    // to 'thread' when at least one message already exists — per
    // docs/system/DECISIONS.md, "Who speaks first?" (who-first) is shown
    // once at the start of a conversation only, and turn 2+ reaches
    // signing/speaking through the thread screen's own Sign/Speak-or-Type
    // buttons, not through who-first. Routing Back to who-first
    // unconditionally would strand an in-progress conversation behind a
    // screen where #thread is display:none. On turn 1 (no messages yet,
    // reached directly from who-first), the thread has no .bubble-row yet,
    // so this still falls through to who-first, matching the original
    // behaviour. Existence check uses the same .bubble-row class
    // appendBubble() builds each bubble's row wrapper with (see
    // appendBubble() below).
    //
    // who-first is talk.html's true entry point (docs/revision cycle 001):
    // tapping Back while already there is a real "leave" action, not a
    // same-screen no-op — it returns to the dashboard (index.html), the
    // only place who-first can have been reached from.
    document.getElementById('backBtn').addEventListener('click', function () {
      if (document.body.dataset.screen === 'who-first') {
        location.href = 'index.html';
        return;
      }
      var hasMessages = document.querySelector('#thread-list .bubble-row') !== null;
      showScreen(hasMessages ? 'thread' : 'who-first');
    });

WHY: who-first is the only screen reached directly from the dashboard, with
nothing "before" it inside talk.html — Back needs a real destination there,
matching the existing pattern End Conversation and idle "End Now" already
use (location.href to index.html).

VERIFY: Load talk.html fresh (body starts data-screen="who-first"), click
#backBtn, confirm the page navigates to index.html (not a same-screen
no-op). Then start a conversation, reach signing or speaking screen (with
and without an existing message), click Back, confirm it still routes to
thread/who-first exactly as before — this fix must not change that path.
