<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }

// One-time backfill for Sining Kamay: fills gestures.asset_path for rows where
// it is still NULL (Task 2's copy from esl_signs/fsl_signs only carried over
// whatever asset_path those tables already had; rows that never got a value
// there are left NULL in gestures too).
//
// For every gestures row with asset_path IS NULL, looks for
// assets/signs/<en|fil>/<label>.webm on disk (en for ESL, fil for FSL) and,
// if it exists and is non-empty, sets asset_path to that relative path with
// an UPDATE ... WHERE id = ? AND asset_path IS NULL guard so a non-NULL value
// is never touched. Idempotent: a second run finds nothing left to fill.
//
// Usage:
//   C:\xampp\php\php.exe db-schema/migrations/2026-09-24-backfill-asset-path.php [options]
//
// Options:
//   --db=<name>   Database to operate on. Default: sining_kamay_db

require __DIR__ . '/../../php/connect.php';

// ── Argument parsing ────────────────────────────────────────────────────
$options = [
    'db' => 'sining_kamay_db',
];
foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--(db)=(.*)$/', $arg, $m)) { $options[$m[1]] = $m[2]; continue; }
    fwrite(STDERR, "Unknown argument: $arg\n");
    exit(1);
}
$DB = $options['db'];

// ── Connection ───────────────────────────────────────────────────────────
if (!mysqli_select_db($conn, $DB)) {
    fwrite(STDERR, "Cannot select database '$DB': " . mysqli_error($conn) . "\n");
    exit(1);
}
$versionRow = mysqli_fetch_row(mysqli_query($conn, 'SELECT @@version'));
if ($versionRow === null || stripos($versionRow[0], 'MariaDB') === false) {
    fwrite(STDERR, "This migration requires MariaDB. Got: " . ($versionRow[0] ?? 'unknown') . "\n");
    exit(1);
}

function q($conn, $sql) {
    $r = mysqli_query($conn, $sql);
    if ($r === false) {
        fwrite(STDERR, "Query failed: " . mysqli_error($conn) . "\nSQL: $sql\n");
        exit(1);
    }
    return $r;
}

function fetchAll($conn, $sql) {
    $r = q($conn, $sql);
    $rows = [];
    if ($r instanceof mysqli_result) {
        while ($row = mysqli_fetch_assoc($r)) { $rows[] = $row; }
    }
    return $rows;
}

// ── Repo root (assets/signs/<en|fil>/<label>.webm is relative to here) ────
$REPO_ROOT = realpath(__DIR__ . '/../..');

$rows = fetchAll($conn, "SELECT id, label, sign_language FROM gestures WHERE asset_path IS NULL ORDER BY id");

$filled = 0;
$stillNull = 0;
foreach ($rows as $row) {
    $id = (int)$row['id'];
    $label = $row['label'];
    $dir = $row['sign_language'] === 'FSL' ? 'fil' : 'en';
    $relPath = "assets/signs/$dir/$label.webm";
    $absPath = $REPO_ROOT . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relPath);

    if (is_file($absPath) && filesize($absPath) > 0) {
        $escId = (int)$id;
        $escPath = mysqli_real_escape_string($conn, $relPath);
        q($conn, "UPDATE gestures SET asset_path = '$escPath' WHERE id = $escId AND asset_path IS NULL");
        if (mysqli_affected_rows($conn) > 0) {
            $filled++;
            echo "filled id=$id label=$label sign_language={$row['sign_language']} -> $relPath\n";
        } else {
            // Someone else filled it between the SELECT and the UPDATE; not an error.
            echo "skip id=$id label=$label (no longer NULL)\n";
        }
    } else {
        $stillNull++;
        echo "still-null id=$id label=$label sign_language={$row['sign_language']} (missing or empty: $relPath)\n";
    }
}

$remaining = (int)mysqli_fetch_row(mysqli_query($conn, "SELECT COUNT(*) FROM gestures WHERE asset_path IS NULL"))[0];

echo "Backfill complete. filled=$filled still_null=$stillNull remaining_null_in_db=$remaining\n";
exit(0);
