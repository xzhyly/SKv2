<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }

// One-time schema-normalization migration for Sining Kamay.
//
// Folds esl_signs/fsl_signs into gestures (asset_path, is_active), renames
// gestures.word -> label and gesture_recordings.sample_count -> frame_count,
// adds gesture_recordings.gesture_id NOT NULL + FK to gestures(id), makes
// sample_path NOT NULL + UNIQUE, and drops gesture_recordings.gesture_type /
// sign_language / thumbnail and the esl_signs / fsl_signs tables.
//
// Every step is idempotent: it inspects information_schema (and, for step 1,
// the snapshot file) before doing anything, so re-running the script, or
// resuming after --stop-after=N killed it partway, converges on the same
// final state without re-doing finished work or re-deriving a snapshot from
// already-migrated data.
//
// Usage:
//   C:\xampp\php\php.exe db-schema/migrations/2026-09-24-normalize.php [options]
//
// Options:
//   --db=<name>         Database to operate on. Default: sining_kamay_db
//   --snapshot=<path>   Snapshot JSON path. Default:
//                        E:\ACADSS\IOT\backups\normalization-snapshot-<db>.json
//   --stop-after=<N>    Exit 0 right after finishing step N (for tests).
//   --verify-only       Only compare the DB against the existing snapshot and
//                        print SHOW CREATE TABLE; change nothing.

require __DIR__ . '/../../php/connect.php';

// ── Argument parsing ────────────────────────────────────────────────────
$options = [
    'db' => 'sining_kamay_db',
    'snapshot' => null,
    'stop-after' => null,
    'verify-only' => false,
];
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--verify-only') { $options['verify-only'] = true; continue; }
    if (preg_match('/^--(db|snapshot|stop-after)=(.*)$/', $arg, $m)) { $options[$m[1]] = $m[2]; continue; }
    fwrite(STDERR, "Unknown argument: $arg\n");
    exit(1);
}
$DB = $options['db'];
$SNAPSHOT_PATH = $options['snapshot'] ?? ("E:\\ACADSS\\IOT\\backups\\normalization-snapshot-{$DB}.json");
$STOP_AFTER = $options['stop-after'] !== null ? (int)$options['stop-after'] : null;
$VERIFY_ONLY = (bool)$options['verify-only'];

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

// ── Low-level helpers ────────────────────────────────────────────────────
function esc($conn, $s) { return mysqli_real_escape_string($conn, $s); }

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

function scalar($conn, $sql) {
    $r = q($conn, $sql);
    $row = mysqli_fetch_row($r);
    return $row === null ? null : $row[0];
}

function columnInfo($conn, $db, $table, $col) {
    $rows = fetchAll($conn, "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS " .
        "WHERE TABLE_SCHEMA='" . esc($conn, $db) . "' AND TABLE_NAME='" . esc($conn, $table) . "' AND COLUMN_NAME='" . esc($conn, $col) . "'");
    return $rows[0] ?? null;
}

function columnExists($conn, $db, $table, $col) { return columnInfo($conn, $db, $table, $col) !== null; }

function indexExists($conn, $db, $table, $index) {
    $rows = fetchAll($conn, "SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS " .
        "WHERE TABLE_SCHEMA='" . esc($conn, $db) . "' AND TABLE_NAME='" . esc($conn, $table) . "' AND INDEX_NAME='" . esc($conn, $index) . "'");
    return count($rows) > 0;
}

function tableExists($conn, $db, $table) {
    $rows = fetchAll($conn, "SELECT TABLE_NAME FROM information_schema.TABLES " .
        "WHERE TABLE_SCHEMA='" . esc($conn, $db) . "' AND TABLE_NAME='" . esc($conn, $table) . "'");
    return count($rows) > 0;
}

function fkExists($conn, $db, $name) {
    $rows = fetchAll($conn, "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS " .
        "WHERE TABLE_SCHEMA='" . esc($conn, $db) . "' AND CONSTRAINT_TYPE='FOREIGN KEY' AND CONSTRAINT_NAME='" . esc($conn, $name) . "'");
    return count($rows) > 0;
}

function announce($n, $name, $status) { echo "step $n $name: $status\n"; }

// ── Snapshot-shaped view of the current DB, whatever shape it's in ───────
// Works before, during (resumed) and after the migration by detecting which
// column/table names are currently present.
function buildCurrentSnapshot($conn, $db) {
    $hasLabel = columnExists($conn, $db, 'gestures', 'label');
    $labelCol = $hasLabel ? 'label' : 'word';
    $hasAssetCols = columnExists($conn, $db, 'gestures', 'asset_path');

    if ($hasAssetCols) {
        $sql = "SELECT g.`$labelCol` AS label, g.sign_language, g.category, g.created_at, g.asset_path, g.is_active FROM gestures g";
    } else {
        $sql = "SELECT g.`$labelCol` AS label, g.sign_language, g.category, g.created_at, " .
               "COALESCE(es.asset_path, fs.asset_path) AS asset_path, " .
               "COALESCE(es.is_active, fs.is_active) AS is_active " .
               "FROM gestures g " .
               "LEFT JOIN esl_signs es ON g.sign_language='ESL' AND es.sign_key = g.`$labelCol` " .
               "LEFT JOIN fsl_signs fs ON g.sign_language='FSL' AND fs.sign_key = g.`$labelCol`";
    }
    $gestures = [];
    foreach (fetchAll($conn, $sql) as $r) {
        $key = $r['label'] . "\x01" . $r['sign_language'];
        $gestures[$key] = [
            'category' => $r['category'],
            'created_at' => $r['created_at'],
            'asset_path' => $r['asset_path'],
            'is_active' => $r['is_active'] === null ? null : (int)$r['is_active'],
        ];
    }

    $hasFrameCount = columnExists($conn, $db, 'gesture_recordings', 'frame_count');
    $countCol = $hasFrameCount ? 'frame_count' : 'sample_count';
    $sql2 = "SELECT gr.id, g.`$labelCol` AS label, g.sign_language, gr.sample_path, gr.`$countCol` AS frame_count, " .
            "gr.recorded_at, MD5(gr.landmark_json) AS landmark_md5 " .
            "FROM gesture_recordings gr JOIN gestures g ON g.id = gr.gesture_id ORDER BY gr.id";
    $recordings = [];
    foreach (fetchAll($conn, $sql2) as $r) {
        $recordings[(string)$r['id']] = [
            'label' => $r['label'],
            'sign_language' => $r['sign_language'],
            'sample_path' => $r['sample_path'],
            'frame_count' => (int)$r['frame_count'],
            'recorded_at' => $r['recorded_at'],
            'landmark_md5' => $r['landmark_md5'],
        ];
    }

    // Raw, un-joined row counts, taken separately from the gesture-keyed join above so that a
    // NULL/orphaned gesture_id (invisible to the INNER JOIN in $sql2) still shows up as a count
    // mismatch instead of silently vanishing from the comparison.
    $gestureCount = (int)scalar($conn, 'SELECT COUNT(*) FROM gestures');
    $recordingCount = (int)scalar($conn, 'SELECT COUNT(*) FROM gesture_recordings');

    return [
        'gestures' => $gestures,
        'recordings' => $recordings,
        'gesture_count' => $gestureCount,
        'recording_count' => $recordingCount,
    ];
}

// Field-by-field strict comparison (not array !== / == on the whole record) so that a comparison
// never depends on key insertion order, and so every field's normalization (string vs int vs null)
// is explicit and identical on both the snapshot side and the freshly-queried side.
function fieldsDiffer($a, $b, array $fields) {
    foreach ($fields as $f) {
        $av = array_key_exists($f, $a) ? $a[$f] : null;
        $bv = array_key_exists($f, $b) ? $b[$f] : null;
        if ($av !== $bv) { return true; }
    }
    return false;
}

const GESTURE_COMPARE_FIELDS = ['category', 'created_at', 'asset_path', 'is_active'];
const RECORDING_COMPARE_FIELDS = ['label', 'sign_language', 'sample_path', 'frame_count', 'recorded_at', 'landmark_md5'];

function compareSnapshots($orig, $cur) {
    $diffs = [];
    if ((int)$orig['gesture_count'] !== (int)$cur['gesture_count']) {
        $diffs[] = "gesture_count mismatch: expected {$orig['gesture_count']} got {$cur['gesture_count']} (raw COUNT(*) FROM gestures)";
    }
    if ((int)$orig['recording_count'] !== (int)$cur['recording_count']) {
        $diffs[] = "recording_count mismatch: expected {$orig['recording_count']} got {$cur['recording_count']} (raw COUNT(*) FROM gesture_recordings)";
    }
    foreach ($orig['gestures'] as $k => $v) {
        if (!array_key_exists($k, $cur['gestures'])) { $diffs[] = "gesture missing: $k"; continue; }
        if (fieldsDiffer($v, $cur['gestures'][$k], GESTURE_COMPARE_FIELDS)) {
            $diffs[] = "gesture mismatch for $k: expected " . json_encode($v) . " got " . json_encode($cur['gestures'][$k]);
        }
    }
    foreach ($cur['gestures'] as $k => $v) {
        if (!array_key_exists($k, $orig['gestures'])) { $diffs[] = "unexpected extra gesture: $k"; }
    }
    foreach ($orig['recordings'] as $id => $v) {
        if (!array_key_exists($id, $cur['recordings'])) { $diffs[] = "recording missing id=$id"; continue; }
        if (fieldsDiffer($v, $cur['recordings'][$id], RECORDING_COMPARE_FIELDS)) {
            $diffs[] = "recording mismatch id=$id: expected " . json_encode($v) . " got " . json_encode($cur['recordings'][$id]);
        }
    }
    foreach ($cur['recordings'] as $id => $v) {
        if (!array_key_exists($id, $orig['recordings'])) { $diffs[] = "unexpected extra recording id=$id"; }
    }
    return $diffs;
}

function abortOnDiffs($diffs, $label) {
    if (empty($diffs)) return;
    fwrite(STDERR, "$label: data mismatch found, aborting before any further/destructive change:\n");
    foreach ($diffs as $d) { fwrite(STDERR, "  - $d\n"); }
    exit(1);
}

function showCreateTable($conn, $table) {
    $row = fetchAll($conn, "SHOW CREATE TABLE `$table`");
    return $row[0]['Create Table'] ?? null;
}

// ── verify-only mode ─────────────────────────────────────────────────────
if ($VERIFY_ONLY) {
    if (!file_exists($SNAPSHOT_PATH)) {
        fwrite(STDERR, "--verify-only requires an existing snapshot at $SNAPSHOT_PATH\n");
        exit(1);
    }
    $snapshot = json_decode(file_get_contents($SNAPSHOT_PATH), true);
    if ($snapshot === null) {
        fwrite(STDERR, "Snapshot file at $SNAPSHOT_PATH is not valid JSON\n");
        exit(1);
    }
    $current = buildCurrentSnapshot($conn, $DB);
    $diffs = compareSnapshots($snapshot, $current);
    abortOnDiffs($diffs, 'verify-only');
    echo "verify-only: 0 differences (" . count($current['gestures']) . " gestures, " .
         count($current['recordings']) . " recordings)\n";
    foreach (['gestures', 'gesture_recordings', 'translations', 'users'] as $t) {
        if (tableExists($conn, $DB, $t)) {
            echo "---- SHOW CREATE TABLE $t ----\n" . showCreateTable($conn, $t) . "\n";
        }
    }
    exit(0);
}

function maybeStop($n, $stopAfter) {
    if ($stopAfter !== null && $n === $stopAfter) {
        exit(0);
    }
}

// ── Step 1: snapshot ───────────────────────────────────────────────────
$isPreMigration = columnExists($conn, $DB, 'gestures', 'word') && tableExists($conn, $DB, 'esl_signs');
$isFullyMigrated = columnExists($conn, $DB, 'gestures', 'label')
    && !tableExists($conn, $DB, 'esl_signs') && !tableExists($conn, $DB, 'fsl_signs')
    && columnExists($conn, $DB, 'gesture_recordings', 'frame_count');

$snapshot = null;
if (file_exists($SNAPSHOT_PATH)) {
    $snapshot = json_decode(file_get_contents($SNAPSHOT_PATH), true);
    if ($snapshot === null) {
        fwrite(STDERR, "Existing snapshot at $SNAPSHOT_PATH is not valid JSON\n");
        exit(1);
    }
    announce(1, 'snapshot', 'already done');
} elseif ($isPreMigration) {
    $snapshot = buildCurrentSnapshot($conn, $DB);
    $dir = dirname($SNAPSHOT_PATH);
    if (!is_dir($dir)) { mkdir($dir, 0777, true); }
    if (file_put_contents($SNAPSHOT_PATH, json_encode($snapshot, JSON_PRETTY_PRINT)) === false) {
        fwrite(STDERR, "Could not write snapshot to $SNAPSHOT_PATH\n");
        exit(1);
    }
    announce(1, 'snapshot', 'done');
} elseif ($isFullyMigrated) {
    echo "step 1 snapshot: skipped (database already fully migrated and no snapshot file found; " .
         "data-loss verification against a pre-migration snapshot is not possible, continuing with schema-only checks)\n";
    $snapshot = null;
} else {
    fwrite(STDERR, "Database is in an unrecognized partial state and no snapshot file exists at $SNAPSHOT_PATH; " .
        "cannot safely proceed without a snapshot to verify against.\n");
    exit(1);
}
maybeStop(1, $STOP_AFTER);

// ── Step 2: add gestures.asset_path / is_active, backfill from *_signs ──
$hasAssetPath = columnExists($conn, $DB, 'gestures', 'asset_path');
$hasIsActive = columnExists($conn, $DB, 'gestures', 'is_active');
$clauses = [];
if (!$hasAssetPath) { $clauses[] = "ADD COLUMN `asset_path` varchar(255) DEFAULT NULL AFTER `category`"; }
if (!$hasIsActive) { $clauses[] = "ADD COLUMN `is_active` tinyint(1) NOT NULL DEFAULT 1 AFTER `asset_path`"; }
if (!empty($clauses)) {
    q($conn, "ALTER TABLE `gestures` " . implode(', ', $clauses));
}
$labelColNow = columnExists($conn, $DB, 'gestures', 'label') ? 'label' : 'word';
$backfillAffected = 0;
if (tableExists($conn, $DB, 'esl_signs')) {
    q($conn, "UPDATE gestures g JOIN esl_signs es ON es.sign_key = g.`$labelColNow` " .
             "SET g.asset_path = es.asset_path, g.is_active = es.is_active WHERE g.sign_language = 'ESL'");
    $backfillAffected += mysqli_affected_rows($conn);
}
if (tableExists($conn, $DB, 'fsl_signs')) {
    q($conn, "UPDATE gestures g JOIN fsl_signs fs ON fs.sign_key = g.`$labelColNow` " .
             "SET g.asset_path = fs.asset_path, g.is_active = fs.is_active WHERE g.sign_language = 'FSL'");
    $backfillAffected += mysqli_affected_rows($conn);
}
// mysqli_affected_rows() (without the CLIENT_FOUND_ROWS flag, which php/connect.php does not set)
// counts only rows whose value actually changed, not rows merely matched -- so a resume that finds
// the columns already present but the backfill still incomplete (e.g. a crash between the ADD
// COLUMN and this UPDATE) is correctly reported as "done" rather than a no-op "already done".
announce(2, 'add-gesture-columns', (!empty($clauses) || $backfillAffected > 0) ? 'done' : 'already done');
maybeStop(2, $STOP_AFTER);

// ── Step 3: gestures.sign_language -> enum('ESL','FSL') ──────────────────
$slInfo = columnInfo($conn, $DB, 'gestures', 'sign_language');
$targetType = strtolower("enum('ESL','FSL')");
if ($slInfo !== null && strtolower($slInfo['COLUMN_TYPE']) === $targetType) {
    announce(3, 'sign-language-enum', 'already done');
} else {
    $bad = (int)scalar($conn, "SELECT COUNT(*) FROM gestures WHERE sign_language NOT IN ('ESL','FSL')");
    if ($bad > 0) {
        fwrite(STDERR, "Step 3 precondition failed: $bad gestures.sign_language value(s) other than ESL/FSL\n");
        exit(1);
    }
    q($conn, "ALTER TABLE `gestures` CHANGE COLUMN `sign_language` `sign_language` enum('ESL','FSL') NOT NULL DEFAULT 'ESL'");
    announce(3, 'sign-language-enum', 'done');
}
maybeStop(3, $STOP_AFTER);

// ── Step 4: gesture_recordings.gesture_id NOT NULL + FK + index ─────────
$giInfo = columnInfo($conn, $DB, 'gesture_recordings', 'gesture_id');
$giNotNull = $giInfo !== null && $giInfo['IS_NULLABLE'] === 'NO';
$hasOldGiIndex = indexExists($conn, $DB, 'gesture_recordings', 'gesture_id');
$hasNewGiIndex = indexExists($conn, $DB, 'gesture_recordings', 'idx_gesture_recordings_gesture');
$hasFk = fkExists($conn, $DB, 'fk_gesture_recordings_gesture');

if ($giNotNull && !$hasOldGiIndex && $hasNewGiIndex && $hasFk) {
    announce(4, 'gesture-id-fk', 'already done');
} else {
    $nullCount = (int)scalar($conn, "SELECT COUNT(*) FROM gesture_recordings WHERE gesture_id IS NULL");
    if ($nullCount > 0) {
        fwrite(STDERR, "Step 4 precondition failed: $nullCount gesture_recordings row(s) with NULL gesture_id\n");
        exit(1);
    }
    $orphanCount = (int)scalar($conn, "SELECT COUNT(*) FROM gesture_recordings gr " .
        "LEFT JOIN gestures g ON g.id = gr.gesture_id WHERE g.id IS NULL");
    if ($orphanCount > 0) {
        fwrite(STDERR, "Step 4 precondition failed: $orphanCount gesture_recordings row(s) reference a non-existent gesture\n");
        exit(1);
    }
    $clauses = [];
    if (!$giNotNull) { $clauses[] = "CHANGE COLUMN `gesture_id` `gesture_id` int(11) NOT NULL"; }
    if ($hasOldGiIndex) { $clauses[] = "DROP INDEX `gesture_id`"; }
    if (!$hasNewGiIndex) { $clauses[] = "ADD INDEX `idx_gesture_recordings_gesture` (`gesture_id`)"; }
    if (!empty($clauses)) { q($conn, "ALTER TABLE `gesture_recordings` " . implode(', ', $clauses)); }
    if (!$hasFk) {
        q($conn, "ALTER TABLE `gesture_recordings` ADD CONSTRAINT `fk_gesture_recordings_gesture` " .
                 "FOREIGN KEY (`gesture_id`) REFERENCES `gestures` (`id`) ON DELETE RESTRICT");
    }
    announce(4, 'gesture-id-fk', 'done');
}
maybeStop(4, $STOP_AFTER);

// ── Step 5: sample_path NOT NULL + UNIQUE ─────────────────────────────────
$spInfo = columnInfo($conn, $DB, 'gesture_recordings', 'sample_path');
$spNotNull = $spInfo !== null && $spInfo['IS_NULLABLE'] === 'NO';
$hasSpUnique = indexExists($conn, $DB, 'gesture_recordings', 'uq_gesture_recordings_sample_path');
if ($spNotNull && $hasSpUnique) {
    announce(5, 'sample-path-unique', 'already done');
} else {
    $badCount = (int)scalar($conn, "SELECT COUNT(*) FROM gesture_recordings WHERE sample_path IS NULL OR sample_path = ''");
    if ($badCount > 0) {
        fwrite(STDERR, "Step 5 precondition failed: $badCount gesture_recordings row(s) with NULL/empty sample_path\n");
        exit(1);
    }
    $dupCount = (int)scalar($conn, "SELECT COUNT(*) FROM (SELECT sample_path FROM gesture_recordings GROUP BY sample_path HAVING COUNT(*) > 1) t");
    if ($dupCount > 0) {
        fwrite(STDERR, "Step 5 precondition failed: $dupCount duplicate sample_path value(s)\n");
        exit(1);
    }
    $clauses = [];
    if (!$spNotNull) { $clauses[] = "CHANGE COLUMN `sample_path` `sample_path` varchar(255) NOT NULL"; }
    if (!$hasSpUnique) { $clauses[] = "ADD UNIQUE KEY `uq_gesture_recordings_sample_path` (`sample_path`)"; }
    q($conn, "ALTER TABLE `gesture_recordings` " . implode(', ', $clauses));
    announce(5, 'sample-path-unique', 'done');
}
maybeStop(5, $STOP_AFTER);

// ── Step 6: renames ───────────────────────────────────────────────────────
$hasWord = columnExists($conn, $DB, 'gestures', 'word');
$hasLabelCol = columnExists($conn, $DB, 'gestures', 'label');
$hasOldWordKey = indexExists($conn, $DB, 'gestures', 'word');
$hasNewLabelKey = indexExists($conn, $DB, 'gestures', 'uq_gestures_label_language');
$hasSampleCount = columnExists($conn, $DB, 'gesture_recordings', 'sample_count');
$hasFrameCount = columnExists($conn, $DB, 'gesture_recordings', 'frame_count');

$didRename = false;
$gClauses = [];
if ($hasWord && !$hasLabelCol) {
    $gClauses[] = "CHANGE COLUMN `word` `label` varchar(255) NOT NULL";
}
if (!$hasNewLabelKey) {
    $gClauses[] = "ADD UNIQUE KEY `uq_gestures_label_language` (`label`, `sign_language`)";
}
if (!empty($gClauses)) {
    // label must exist before the unique key clause is evaluated; if both are
    // needed, the rename clause is listed first above so this single ALTER is fine.
    q($conn, "ALTER TABLE `gestures` " . implode(', ', $gClauses));
    $didRename = true;
}
if ($hasOldWordKey && indexExists($conn, $DB, 'gestures', 'word')) {
    q($conn, "ALTER TABLE `gestures` DROP INDEX `word`");
    $didRename = true;
}
if ($hasSampleCount && !$hasFrameCount) {
    q($conn, "ALTER TABLE `gesture_recordings` CHANGE COLUMN `sample_count` `frame_count` int(11) NOT NULL DEFAULT 0");
    $didRename = true;
}
announce(6, 'renames', $didRename ? 'done' : 'already done');
maybeStop(6, $STOP_AFTER);

// ── Step 7: re-copy asset_path/is_active, verify before any drop ────────
$labelColNow = columnExists($conn, $DB, 'gestures', 'label') ? 'label' : 'word';
if (tableExists($conn, $DB, 'esl_signs')) {
    q($conn, "UPDATE gestures g JOIN esl_signs es ON es.sign_key = g.`$labelColNow` " .
             "SET g.asset_path = es.asset_path, g.is_active = es.is_active WHERE g.sign_language = 'ESL'");
}
if (tableExists($conn, $DB, 'fsl_signs')) {
    q($conn, "UPDATE gestures g JOIN fsl_signs fs ON fs.sign_key = g.`$labelColNow` " .
             "SET g.asset_path = fs.asset_path, g.is_active = fs.is_active WHERE g.sign_language = 'FSL'");
}
if ($snapshot !== null) {
    $current = buildCurrentSnapshot($conn, $DB);
    $diffs = compareSnapshots($snapshot, $current);
    abortOnDiffs($diffs, 'step 7 verify-before-drop');
    announce(7, 'verify-before-drop', 'done');
} else {
    announce(7, 'verify-before-drop', 'done (no snapshot available; schema-only)');
}
maybeStop(7, $STOP_AFTER);

// ── Step 8: drop gesture_recordings.gesture_type / sign_language / thumbnail ──
$hasGestureType = columnExists($conn, $DB, 'gesture_recordings', 'gesture_type');
$hasSignLanguage = columnExists($conn, $DB, 'gesture_recordings', 'sign_language');
$hasThumbnail = columnExists($conn, $DB, 'gesture_recordings', 'thumbnail');
if (!$hasGestureType && !$hasSignLanguage && !$hasThumbnail) {
    announce(8, 'drop-recording-columns', 'already done');
} else {
    if ($hasThumbnail) {
        $nonNullThumb = (int)scalar($conn, "SELECT COUNT(*) FROM gesture_recordings WHERE thumbnail IS NOT NULL");
        if ($nonNullThumb > 0) {
            fwrite(STDERR, "Step 8 precondition failed: $nonNullThumb gesture_recordings row(s) have a non-NULL thumbnail\n");
            exit(1);
        }
    }
    // Re-verify (don't just trust the earlier snapshot compare) that gesture_type/sign_language are
    // still exactly redundant with the joined gesture's label/sign_language before dropping them --
    // a binary comparison, since these are the actual columns about to be discarded with no
    // replacement.
    if ($hasGestureType) {
        $badGestureType = (int)scalar($conn, "SELECT COUNT(*) FROM gesture_recordings gr " .
            "JOIN gestures g ON g.id = gr.gesture_id WHERE BINARY gr.gesture_type <> BINARY g.`$labelColNow`");
        if ($badGestureType > 0) {
            fwrite(STDERR, "Step 8 precondition failed: $badGestureType gesture_recordings row(s) where gesture_type " .
                "does not match the joined gesture's label\n");
            exit(1);
        }
    }
    if ($hasSignLanguage) {
        $badSignLanguage = (int)scalar($conn, "SELECT COUNT(*) FROM gesture_recordings gr " .
            "JOIN gestures g ON g.id = gr.gesture_id WHERE BINARY gr.sign_language <> BINARY g.sign_language");
        if ($badSignLanguage > 0) {
            fwrite(STDERR, "Step 8 precondition failed: $badSignLanguage gesture_recordings row(s) where sign_language " .
                "does not match the joined gesture's sign_language\n");
            exit(1);
        }
    }
    $clauses = [];
    if (indexExists($conn, $DB, 'gesture_recordings', 'gesture_type')) { $clauses[] = "DROP INDEX `gesture_type`"; }
    if ($hasGestureType) { $clauses[] = "DROP COLUMN `gesture_type`"; }
    if ($hasSignLanguage) { $clauses[] = "DROP COLUMN `sign_language`"; }
    if ($hasThumbnail) { $clauses[] = "DROP COLUMN `thumbnail`"; }
    q($conn, "ALTER TABLE `gesture_recordings` " . implode(', ', $clauses));
    announce(8, 'drop-recording-columns', 'done');
}
maybeStop(8, $STOP_AFTER);

// ── Step 9: drop esl_signs, fsl_signs ─────────────────────────────────────
$hasEsl = tableExists($conn, $DB, 'esl_signs');
$hasFsl = tableExists($conn, $DB, 'fsl_signs');
if (!$hasEsl && !$hasFsl) {
    announce(9, 'drop-signs-tables', 'already done');
} else {
    if ($hasEsl) { q($conn, "DROP TABLE `esl_signs`"); }
    if ($hasFsl) { q($conn, "DROP TABLE `fsl_signs`"); }
    announce(9, 'drop-signs-tables', 'done');
}
maybeStop(9, $STOP_AFTER);

// ── Step 10: final verification ───────────────────────────────────────────
if ($snapshot !== null) {
    $current = buildCurrentSnapshot($conn, $DB);
    $diffs = compareSnapshots($snapshot, $current);
    abortOnDiffs($diffs, 'step 10 final-verify');
}
$expectedTables = ['gestures', 'gesture_recordings', 'translations', 'users'];
$actualTables = array_map(fn($r) => $r['TABLE_NAME'], fetchAll($conn,
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='" . esc($conn, $DB) . "' AND TABLE_TYPE='BASE TABLE'"));
sort($actualTables);
$sortedExpected = $expectedTables;
sort($sortedExpected);
if ($actualTables !== $sortedExpected) {
    fwrite(STDERR, "Step 10: table list mismatch. Expected " . implode(',', $sortedExpected) . " got " . implode(',', $actualTables) . "\n");
    exit(1);
}
announce(10, 'final-verify', 'done');
foreach ($expectedTables as $t) {
    echo "---- SHOW CREATE TABLE $t ----\n" . showCreateTable($conn, $t) . "\n";
}
maybeStop(10, $STOP_AFTER);

echo "Migration complete.\n";
exit(0);
