<?php
// Gesture category heuristic (word / letter / number / phrase), plus the schema-migration helpers
// that add/backfill the `category` column. The heuristic functions are pure, no side effects.
// The migration functions below do touch the DB and call fail() (defined by the including
// request-handling script, e.g. save_gesture.php) on unrecoverable errors -- a CLI script that
// requires this file directly must define its own fail() first if it wants to call them.
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

function column_exists($conn, $table, $column) {
    $table = mysqli_real_escape_string($conn, $table);
    $column = mysqli_real_escape_string($conn, $column);
    $result = mysqli_query($conn, "SHOW COLUMNS FROM `$table` LIKE '$column'");
    return $result && mysqli_num_rows($result) > 0;
}

// $table defaults to the real 'gestures' table; callers only ever pass another table name from
// test code exercising this migration against a scratch table.
function ensure_gestures_columns($conn, $table = 'gestures') {
    $quotedTable = '`' . str_replace('`', '', $table) . '`';
    if (!column_exists($conn, $table, 'sign_language')) {
        try {
            $ok = mysqli_query($conn, "ALTER TABLE $quotedTable ADD COLUMN sign_language ENUM('ESL','FSL','BOTH') NOT NULL DEFAULT 'ESL' AFTER label");
        } catch (Throwable $e) {
            $ok = false;
        }
        if (!$ok && !column_exists($conn, $table, 'sign_language')) {
            // Not already added by a concurrent request either -- genuine failure.
            fail('DB ' . $table . ' alter failed: ' . mysqli_error($conn), 500);
        }
    }
    // In-place upgrade of a pre-"sign texts" database: widen the enum to include 'BOTH' and swap
    // UNIQUE (label, sign_language) for UNIQUE (label). One information_schema query when already
    // migrated. The CHECK constraint is not added here (setup SQL / the migration own it).
    $quotedName = mysqli_real_escape_string($conn, $table);
    $info = mysqli_query($conn,
        "SELECT 'col' AS k, COLUMN_TYPE AS v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '$quotedName' AND COLUMN_NAME = 'sign_language' " .
        "UNION ALL SELECT 'idx', INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '$quotedName' AND INDEX_NAME IN ('uq_gestures_label_language', 'uq_gestures_label')");
    $colType = ''; $indexes = [];
    while ($info && ($row = mysqli_fetch_assoc($info))) {
        if ($row['k'] === 'col') { $colType = (string)$row['v']; } else { $indexes[$row['v']] = true; }
    }
    if ($colType !== '' && stripos($colType, "'BOTH'") === false) {
        try {
            $ok = mysqli_query($conn, "ALTER TABLE $quotedTable MODIFY sign_language ENUM('ESL','FSL','BOTH') NOT NULL DEFAULT 'ESL'");
        } catch (Throwable $e) {
            $ok = false;
        }
        if (!$ok) {
            // A concurrent request may have widened it already -- re-check.
            $re = mysqli_query($conn, "SHOW COLUMNS FROM $quotedTable LIKE 'sign_language'");
            $reRow = $re ? mysqli_fetch_assoc($re) : null;
            if (!$reRow || stripos((string)$reRow['Type'], "'BOTH'") === false) {
                fail('DB ' . $table . ' alter failed: ' . mysqli_error($conn), 500);
            }
        }
    }
    if (isset($indexes['uq_gestures_label_language']) && !isset($indexes['uq_gestures_label'])) {
        $dup = mysqli_query($conn, "SELECT label FROM $quotedTable GROUP BY label HAVING COUNT(*) > 1 LIMIT 1");
        if ($dup && mysqli_num_rows($dup) === 0) {
            try {
                $ok = mysqli_query($conn, "ALTER TABLE $quotedTable DROP INDEX uq_gestures_label_language, ADD UNIQUE KEY uq_gestures_label (label)");
            } catch (Throwable $e) {
                $ok = false;
            }
            if (!$ok) {
                // Concurrent swap, or duplicate rows appeared meanwhile: only fail if the old key is
                // still there AND nobody added the new one. Otherwise leave it for the next request.
                $re = mysqli_query($conn, "SHOW INDEX FROM $quotedTable WHERE Key_name = 'uq_gestures_label_language'");
                $stillOld = $re && mysqli_num_rows($re) > 0;
                $re2 = mysqli_query($conn, "SELECT label FROM $quotedTable GROUP BY label HAVING COUNT(*) > 1 LIMIT 1");
                $nowDup = $re2 && mysqli_num_rows($re2) > 0;
                if ($stillOld && !$nowDup) {
                    fail('DB ' . $table . ' alter failed: ' . mysqli_error($conn), 500);
                }
            }
        }
    }
    // Sign texts (English / Filipino). Added after sign_language / text_en; no CHECK or key changes
    // here -- the sign-texts migration and database_setup.sql own those.
    foreach ([['text_en', 'sign_language'], ['text_fil', 'text_en']] as [$textColumn, $afterColumn]) {
        if (!column_exists($conn, $table, $textColumn)) {
            try {
                $ok = mysqli_query($conn, "ALTER TABLE $quotedTable ADD COLUMN $textColumn VARCHAR(255) NULL AFTER $afterColumn");
            } catch (Throwable $e) {
                $ok = false;
            }
            // A concurrent request may have added it between our check and the ALTER -- re-check.
            if (!$ok && !column_exists($conn, $table, $textColumn)) {
                fail('DB ' . $table . ' alter failed: ' . mysqli_error($conn), 500);
            }
        }
    }
    if (!column_exists($conn, $table, 'category')) {
        try {
            $ok = mysqli_query($conn, "ALTER TABLE $quotedTable ADD COLUMN category ENUM('word','letter','number','phrase') NOT NULL DEFAULT 'word' AFTER sign_language");
        } catch (Throwable $e) {
            $ok = false;
        }
        if (!$ok) {
            // A concurrent first request may have already added the column between our check and
            // this ALTER -- re-check before treating it as a genuine failure.
            if (!column_exists($conn, $table, 'category')) {
                fail('DB ' . $table . ' alter failed: ' . mysqli_error($conn), 500);
            }
            // Column now exists (added by someone else): don't backfill -- that call already did.
            return;
        }
        // Only runs in the same call that added the column -- never again, so it can never
        // overwrite a category someone has since tagged by hand.
        backfill_gesture_categories($conn, $table);
    }
}

// Sets every existing row's category to its heuristic value. Only ever called right after the
// category column is added (see ensure_gestures_columns above); rows whose heuristic result is
// already 'word' (the column DEFAULT) don't need an UPDATE.
function backfill_gesture_categories($conn, $table = 'gestures') {
    $quotedTable = '`' . str_replace('`', '', $table) . '`';
    $result = mysqli_query($conn, "SELECT id, label FROM $quotedTable");
    if (!$result) {
        fail('DB backfill select failed: ' . mysqli_error($conn), 500);
    }
    $stmt = mysqli_prepare($conn, "UPDATE $quotedTable SET category = ? WHERE id = ?");
    if (!$stmt) {
        fail('DB backfill prepare failed: ' . mysqli_error($conn), 500);
    }
    while ($row = mysqli_fetch_assoc($result)) {
        $category = gesture_category($row['label']);
        if ($category === 'word') {
            continue; // matches the column DEFAULT already
        }
        $id = (int)$row['id'];
        mysqli_stmt_bind_param($stmt, 'si', $category, $id);
        if (!mysqli_stmt_execute($stmt)) {
            fail('DB backfill update failed: ' . mysqli_stmt_error($stmt), 500);
        }
    }
    mysqli_stmt_close($stmt);
}
