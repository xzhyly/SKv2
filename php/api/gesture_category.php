<?php
// Pure functions for the gesture category heuristic (word / letter / number / phrase).
// No side effects, no output -- safe to require_once from save_gesture.php or a CLI test script.
//
// The heuristic (exact; JS has a matching implementation in js/gesture-category.js):
// Input: a cleaned label string (see clean_label() in save_gesture.php: lowercase, whitespace ->
// "_", only [a-z0-9_-]). First match wins:
//   1. number  -- label matches ^[0-9]+$, OR is exactly one of the number words below
//   2. letter  -- label matches ^[a-z]$
//   3. phrase  -- label contains "_"
//   4. word    -- everything else, including the empty string (safe default)

const GESTURE_CATEGORIES = ['word', 'letter', 'number', 'phrase'];

// English + Filipino number words the heuristic recognizes as a whole label (not substrings).
const GESTURE_NUMBER_WORDS = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
    'nineteen', 'twenty', 'hundred', 'thousand',
    'isa', 'dalawa', 'tatlo', 'apat', 'lima', 'anim', 'pito', 'walo', 'siyam', 'sampu',
    'sampung', 'daan', 'libo',
];

function gesture_category(string $label): string {
    if (preg_match('/^[0-9]+$/', $label) || in_array($label, GESTURE_NUMBER_WORDS, true)) {
        return 'number';
    }
    if (preg_match('/^[a-z]$/', $label)) {
        return 'letter';
    }
    if (strpos($label, '_') !== false) {
        return 'phrase';
    }
    return 'word';
}

// Lowercases/trims $value; returns it if it is one of GESTURE_CATEGORIES, else null.
function valid_gesture_category($value): ?string {
    if (!is_string($value)) {
        return null;
    }
    $value = strtolower(trim($value));
    return in_array($value, GESTURE_CATEGORIES, true) ? $value : null;
}
