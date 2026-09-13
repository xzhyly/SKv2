# camera-translator.html — archived, never executed

Facts only, each cited. Archived during Phase 3a (UI load-order revision).

## Never ran, anywhere

Its logic lives in one inline `<script>` (was lines 893-2158), with an
unclosed `else{`:
```js
}else{
  ...
  updateUI();
</script>
```
Throws `SyntaxError: Unexpected end of input` in every browser — a syntax
error anywhere in a classic `<script>` stops the whole block (~1265 lines)
from executing. Confirmed identical (same missing brace, same position) at
baseline, after Phase 1, after Phase 2, and at HEAD before archival — this
predates the current revision entirely. Adding one `}` after `updateUI();`
parses cleanly (`node --check`: fails before, passes after) — complete
apart from that one character.

## Nothing referenced it

`grep -rn "camera-translator"` across every `.html`/`.js`/`.sh`/`.php` file
found no `href`, `location.href`, or `window.open` anywhere — only comments
in `js/db-api.js`, `js/db-local.js`, and `php/api/core_api.php` name it.

## What it held

The project's only TensorFlow.js classification code: `tf.tensor2d`,
`tf.sequential`, `tf.loadLayersModel`, `.predict()` (lines 1220-1686).
Confirmed by a repo-wide search outside `js/lib/` — no other file calls any
of these.

## Why kept

Reference implementation for a TensorFlow.js dense-network approach, should
a future gesture-training revision choose it over the k-NN in production.
