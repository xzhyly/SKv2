// Pure JS mirror of php/api/gesture_category.php's gesture_category() heuristic.
// No DOM access, no side effects -- loadable both as a plain <script> (browser) and via
// require()/node:vm (tests/categorization/heuristic-parity.test.mjs).
//
// The heuristic (exact; must match PHP exactly -- see the parity test):
// Input: a cleaned label string (see clean_label() in save_gesture.php: lowercase, whitespace ->
// "_", only [a-z0-9_-]). First match wins:
//   1. number  -- label matches ^[0-9]+$, OR is exactly one of the number words below
//   2. letter  -- label matches ^[a-z]$
//   3. phrase  -- label contains "_"
//   4. word    -- everything else, including the empty string (safe default)

(function (root) {
  const CATEGORIES = ['word', 'letter', 'number', 'phrase'];

  // English + Filipino number words the heuristic recognizes as a whole label (not substrings).
  const NUMBER_WORDS = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
    'nineteen', 'twenty', 'hundred', 'thousand',
    'isa', 'dalawa', 'tatlo', 'apat', 'lima', 'anim', 'pito', 'walo', 'siyam', 'sampu',
    'sampung', 'daan', 'libo',
  ];

  function guess(label) {
    const s = typeof label === 'string' ? label : '';
    if (/^[0-9]+$/.test(s) || NUMBER_WORDS.indexOf(s) !== -1) {
      return 'number';
    }
    if (/^[a-z]$/.test(s)) {
      return 'letter';
    }
    if (s.indexOf('_') !== -1) {
      return 'phrase';
    }
    return 'word';
  }

  const GestureCategory = { CATEGORIES, guess };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GestureCategory;
  }
  if (root) {
    root.GestureCategory = GestureCategory;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
