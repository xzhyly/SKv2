# Cycle 001 — back-button-who-first — REPORT

ITEM: FILE: talk.html — Back button on who-first does nothing (resolves to
same-screen no-op via showScreen()). Fix: when data-screen === 'who-first',
navigate to index.html instead of calling showScreen(). Update comment too.

STATUS: done

CHANGED: talk.html:1225–1251 (post-edit lines)
  Commit 0916cbc — "talk.html: who-first Back navigates to index.html, not a same-screen no-op"

  Diff (talk.html only — MEMORY.md and MANUAL-CHECKS.md were pre-existing
  uncommitted edits, confirmed by inspecting their diff against HEAD before
  this cycle touched anything):

  @@ -1235,10 +1235,17 @@
       // appendBubble() builds each bubble's row wrapper with (see
  -    // appendBubble() below). Tapping Back while already on the resulting
  -    // screen is a harmless no-op either way (showScreen() returns early for
  -    // a same-screen call).
  +    // appendBubble() below).
  +    //
  +    // who-first is talk.html's true entry point (docs/revision cycle 001):
  +    // tapping Back while already there is a real "leave" action, not a
  +    // same-screen no-op — it returns to the dashboard (index.html), the
  +    // only place who-first can have been reached from.
       document.getElementById('backBtn').addEventListener('click', function () {
  +      if (document.body.dataset.screen === 'who-first') {
  +        location.href = 'index.html';
  +        return;
  +      }
         var hasMessages = document.querySelector('#thread-list .bubble-row') !== null;
         showScreen(hasMessages ? 'thread' : 'who-first');
       });

VERIFY RESULT: partial pass — static code verified, browser navigation requires manual check.

  Static (pass):
  - grep talk.html for `dataset.screen === 'who-first'` → found at line 1245.
    Exactly one match; the guard fires before the hasMessages branch.
  - grep talk.html for `location.href = 'index.html'` in the backBtn handler
    → found at line 1246 (new). Pre-existing uses at lines 1383, 1409, 1846
    are End Conversation / idle-timeout paths — untouched and expected.
  - git diff --stat HEAD (before commit): talk.html only in this cycle's
    changes. MEMORY.md and MANUAL-CHECKS.md were pre-existing uncommitted edits
    confirmed by reading their full diffs; neither was touched by this cycle.
  - git diff --stat (after commit, 0916cbc): 1 file changed, 10 insertions,
    3 deletions — talk.html only.

  Browser navigation (manual required — cannot drive location.href in a
  static grep):
  - Load talk.html fresh (body data-screen="who-first"), tap #backBtn →
    expected: page navigates to index.html. Code path: dataset.screen ===
    'who-first' → true → location.href = 'index.html'. Return fires. ✓ by
    reading.
  - From signing or speaking (with and without a .bubble-row in #thread-list),
    tap #backBtn → expected: routes to thread / who-first as before. Code
    path: dataset.screen check → false → falls through to hasMessages branch
    unchanged. ✓ by reading.
  - Confirm browser navigation actually leaves talk.html (not a no-op):
    requires a real browser load — mark for manual verification.
