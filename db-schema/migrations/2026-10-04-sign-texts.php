<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }

// One-time "one sign, two texts" migration for Sining Kamay.
//
// Merges the 89 FSL signs that duplicate an ESL recording into their ESL twin as
// "Both" signs, adds the text_en / text_fil columns and the BOTH sign set, writes a
// sign.json into every saved_gestures/<key>/ folder, moves the duplicate FSL sample
// files into a backup folder (never deletes them without a verified copy), and
// finally tightens the gestures table (unique label, texts CHECK).
//
// Every step is idempotent: it inspects the DB / disk before acting, so re-running
// the script, or resuming after --stop-after=N (or a crash) killed it partway,
// converges on the same end state.
//
// Usage:
//   C:\xampp\php\php.exe db-schema/migrations/2026-10-04-sign-texts.php [options]
//
// Options:
//   --db=<name>          Database to operate on. Default: sining_kamay_db
//   --root=<dir>         Dataset root containing saved_gestures/ and saved_gestures_fsl/.
//                         Default: the repo root.
//   --backup-dir=<dir>   Backup folder. Default: E:\ACADSS\IOT\backups\2026-10-04-sign-texts
//   --stop-after=<N>     Exit 0 right after finishing step N (for tests).
//   --verify-only        Run only the step-8 verification; change nothing.
//   --no-dump-check      Skip the "a *.sql dump exists in the backup dir" check (tests only).

require __DIR__ . '/../../php/connect.php';

// ── Arguments ────────────────────────────────────────────────────────────
$options = [
    'db' => 'sining_kamay_db',
    'root' => dirname(__DIR__, 2),
    'backup-dir' => 'E:\\ACADSS\\IOT\\backups\\2026-10-04-sign-texts',
    'stop-after' => null,
    'verify-only' => false,
    'no-dump-check' => false,
];
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--verify-only') { $options['verify-only'] = true; continue; }
    if ($arg === '--no-dump-check') { $options['no-dump-check'] = true; continue; }
    if (preg_match('/^--(db|root|backup-dir|stop-after)=(.*)$/', $arg, $m)) { $options[$m[1]] = $m[2]; continue; }
    fwrite(STDERR, "Unknown argument: $arg\n");
    exit(1);
}
$DB = $options['db'];
$ROOT = rtrim(str_replace('\\', '/', $options['root']), '/');
$BACKUP = rtrim(str_replace('\\', '/', $options['backup-dir']), '/');
$STOP_AFTER = $options['stop-after'] !== null ? (int)$options['stop-after'] : null;
$VERIFY_ONLY = (bool)$options['verify-only'];
$NO_DUMP_CHECK = (bool)$options['no-dump-check'];
const FIXTURE_PATH = __DIR__ . '/2026-10-04-sign-texts-pairs.json';

// ── Helpers ──────────────────────────────────────────────────────────────
function fail($msg) { fwrite(STDERR, "FAILED: $msg\n"); exit(1); }

function esc($conn, $s) { return mysqli_real_escape_string($conn, $s); }

function q($conn, $sql) {
    $r = mysqli_query($conn, $sql);
    if ($r === false) { fail("query failed: " . mysqli_error($conn) . " | SQL: $sql"); }
    return $r;
}

function fetchAll($conn, $sql) {
    $r = q($conn, $sql);
    $rows = [];
    if ($r instanceof mysqli_result) { while ($row = mysqli_fetch_assoc($r)) { $rows[] = $row; } }
    return $rows;
}

function scalar($conn, $sql) {
    $row = mysqli_fetch_row(q($conn, $sql));
    return $row === null ? null : $row[0];
}

// Prepared statement helper: returns affected rows (or the result rows for a SELECT).
function prep($conn, $sql, $types, array $params) {
    $st = mysqli_prepare($conn, $sql);
    if ($st === false) { fail("prepare failed: " . mysqli_error($conn) . " | SQL: $sql"); }
    if ($types !== '') { mysqli_stmt_bind_param($st, $types, ...$params); }
    if (!mysqli_stmt_execute($st)) { fail("execute failed: " . mysqli_stmt_error($st) . " | SQL: $sql"); }
    $affected = mysqli_stmt_affected_rows($st);
    mysqli_stmt_close($st);
    return $affected;
}

function columnExists($conn, $db, $table, $col) {
    return count(fetchAll($conn, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='" . esc($conn, $db) .
        "' AND TABLE_NAME='" . esc($conn, $table) . "' AND COLUMN_NAME='" . esc($conn, $col) . "'")) > 0;
}

function indexExists($conn, $db, $table, $index) {
    return count(fetchAll($conn, "SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='" . esc($conn, $db) .
        "' AND TABLE_NAME='" . esc($conn, $table) . "' AND INDEX_NAME='" . esc($conn, $index) . "'")) > 0;
}

function checkExists($conn, $db, $table, $name) {
    return count(fetchAll($conn, "SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='" . esc($conn, $db) .
        "' AND TABLE_NAME='" . esc($conn, $table) . "' AND CONSTRAINT_NAME='" . esc($conn, $name) . "'")) > 0;
}

function announce($n, $name, $status) { echo "step $n $name: $status\n"; }

function maybeStop($n, $stopAfter) { if ($stopAfter !== null && $n === $stopAfter) { exit(0); } }

// "label" -> "Label"; underscores become spaces, first character upper-cased.
function draftText($label) {
    $s = str_replace('_', ' ', $label);
    if ($s === '') { return $s; }
    if (function_exists('mb_substr')) { return mb_strtoupper(mb_substr($s, 0, 1, 'UTF-8'), 'UTF-8') . mb_substr($s, 1, null, 'UTF-8'); }
    return ucfirst($s);
}

// Strict deep equality: same keys, scalars compared with === (floats exactly).
function deepEqual($a, $b) {
    if (is_array($a) && is_array($b)) {
        if (count($a) !== count($b)) { return false; }
        foreach ($a as $k => $v) {
            if (!array_key_exists($k, $b) || !deepEqual($v, $b[$k])) { return false; }
        }
        return true;
    }
    return $a === $b;
}

function readJson($path) {
    $raw = @file_get_contents($path);
    if ($raw === false) { return null; }
    $j = json_decode($raw, true);
    return is_array($j) ? $j : null;
}

function sha256File($path) { return is_file($path) ? hash_file('sha256', $path) : null; }

// True when two sample files hold the same data: frames identical, every other field
// identical except label / signLanguage / createdAt. Returns null if OK, else a reason.
function sampleMismatch($fslPath, $eslPath) {
    $f = readJson($fslPath);
    $e = readJson($eslPath);
    if ($f === null) { return "cannot read/decode $fslPath"; }
    if ($e === null) { return "cannot read/decode twin $eslPath"; }
    if (!isset($f['frames']) || !isset($e['frames']) || !deepEqual($f['frames'], $e['frames'])) {
        return "frames differ between $fslPath and $eslPath";
    }
    foreach (['label', 'signLanguage', 'createdAt'] as $k) { unset($f[$k], $e[$k]); }
    if (!deepEqual($f, $e)) { return "non-frame fields differ between $fslPath and $eslPath"; }
    return null;
}

function listSampleFiles($dir) {
    $out = [];
    foreach (is_dir($dir) ? scandir($dir) : [] as $f) {
        if ($f !== '.' && $f !== '..' && preg_match('/^sample_.*\.json$/', $f) && is_file("$dir/$f")) { $out[] = $f; }
    }
    return $out;
}

function listLabelFolders($dir) {
    $out = [];
    foreach (is_dir($dir) ? scandir($dir) : [] as $f) {
        if ($f !== '.' && $f !== '..' && is_dir("$dir/$f")) { $out[] = $f; }
    }
    return $out;
}

function writeJsonFile($path, $data, $flags = 0) {
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | $flags) . "\n";
    if (file_put_contents($path, $json, LOCK_EX) === false) { fail("could not write $path"); }
}

// ── Connection / environment ─────────────────────────────────────────────
mysqli_set_charset($conn, 'utf8mb4');
if (!mysqli_select_db($conn, $DB)) { fail("cannot select database '$DB': " . mysqli_error($conn)); }
$versionRow = mysqli_fetch_row(mysqli_query($conn, 'SELECT @@version'));
if ($versionRow === null || stripos($versionRow[0], 'MariaDB') === false) {
    fail("this migration requires MariaDB. Got: " . ($versionRow[0] ?? 'unknown'));
}

$fixture = readJson(FIXTURE_PATH);
if ($fixture === null || !isset($fixture['pairs'], $fixture['stray'])) { fail("pairs fixture missing or invalid: " . FIXTURE_PATH); }
$PAIRS = $fixture['pairs'];
$STRAY = $fixture['stray'];

$ESL_DIR = "$ROOT/saved_gestures";
$FSL_DIR = "$ROOT/saved_gestures_fsl";
$SNAPSHOT_PATH = "$BACKUP/snapshot.json";
$MANIFEST_PATH = "$BACKUP/moved-manifest.json";
$BACKUP_FSL = "$BACKUP/saved_gestures_fsl";

// ── Moves list: 89 pairs + the stray, as one uniform structure ───────────
// source = path relative to root; fslPath/backupPath/twinPath = absolute-ish paths.
$MOVES = [];
foreach ($PAIRS as $p) {
    $MOVES[] = [
        'fslLabel' => $p['fsl'],
        'source' => "saved_gestures_fsl/{$p['fsl']}/{$p['fslFile']}",
        'fslPath' => "$FSL_DIR/{$p['fsl']}/{$p['fslFile']}",
        'fslDir' => "$FSL_DIR/{$p['fsl']}",
        'backupPath' => "$BACKUP_FSL/{$p['fsl']}/{$p['fslFile']}",
        'twin' => "saved_gestures/{$p['esl']}/{$p['eslFile']}",
        'twinPath' => "$ESL_DIR/{$p['esl']}/{$p['eslFile']}",
    ];
}
$MOVES[] = [
    'fslLabel' => null,
    'source' => "saved_gestures_fsl/{$STRAY['file']}",
    'fslPath' => "$FSL_DIR/{$STRAY['file']}",
    'fslDir' => null,
    'backupPath' => "$BACKUP_FSL/{$STRAY['file']}",
    'twin' => "saved_gestures/{$STRAY['esl']}/{$STRAY['eslFile']}",
    'twinPath' => "$ESL_DIR/{$STRAY['esl']}/{$STRAY['eslFile']}",
];

// ── Manifest helpers ─────────────────────────────────────────────────────
function loadManifest($path) {
    if (!file_exists($path)) { return []; }
    $m = readJson($path);
    if ($m === null) { fail("manifest at $path is not valid JSON"); }
    $bySource = [];
    foreach ($m as $e) { $bySource[$e['source']] = $e; }
    return $bySource;
}

function saveManifest($path, array $bySource) {
    ksort($bySource);
    writeJsonFile($path, array_values($bySource));
}

// ── Step 8: verification (also --verify-only) ────────────────────────────
function runVerify($conn, $DB, $ROOT, $ESL_DIR, $SNAPSHOT_PATH, $MANIFEST_PATH, $requireSnapshot) {
    $problems = [];

    echo "gestures by sign_language:\n";
    foreach (fetchAll($conn, "SELECT sign_language, COUNT(*) AS c FROM gestures GROUP BY sign_language ORDER BY sign_language") as $r) {
        echo "  {$r['sign_language']}: {$r['c']}\n";
    }
    echo "gestures total: " . scalar($conn, "SELECT COUNT(*) FROM gestures") . "\n";
    echo "gesture_recordings total: " . scalar($conn, "SELECT COUNT(*) FROM gesture_recordings") . "\n";

    // Every recording's sample file exists.
    $missing = 0;
    foreach (fetchAll($conn, "SELECT sample_path FROM gesture_recordings") as $r) {
        if (!is_file("$ROOT/{$r['sample_path']}")) { $missing++; $problems[] = "recording file missing: {$r['sample_path']}"; }
    }
    echo "recordings with a missing sample file: $missing\n";

    // Every snapshot recording is reachable.
    if (file_exists($SNAPSHOT_PATH)) {
        $snap = readJson($SNAPSHOT_PATH);
        if ($snap === null || !isset($snap['recordings'])) {
            $problems[] = "snapshot at $SNAPSHOT_PATH is not valid";
        } else {
            $manifest = loadManifest($MANIFEST_PATH);
            $unreachable = 0;
            foreach ($snap['recordings'] as $rec) {
                $sp = $rec['sample_path'];
                if (is_file("$ROOT/$sp")) {
                    if ($rec['fileSha256'] !== null && sha256File("$ROOT/$sp") !== $rec['fileSha256']) {
                        $unreachable++; $problems[] = "snapshot recording file changed: $sp";
                    }
                    continue;
                }
                $e = $manifest[$sp] ?? null;
                if ($e === null) { $unreachable++; $problems[] = "snapshot recording gone and not in manifest: $sp"; continue; }
                if (sha256File($e['backup']) !== $rec['fileSha256'] || $e['sha256'] !== $rec['fileSha256']) {
                    $unreachable++; $problems[] = "backup sha256 does not match snapshot for: $sp"; continue;
                }
                if (!is_file("$ROOT/{$e['twin']}")) { $unreachable++; $problems[] = "twin missing for moved sample $sp: {$e['twin']}"; }
            }
            echo "snapshot recordings checked: " . count($snap['recordings']) . ", unreachable: $unreachable\n";
        }
    } elseif ($requireSnapshot) {
        $problems[] = "no snapshot at $SNAPSHOT_PATH";
    } else {
        echo "snapshot recordings check: skipped (no snapshot file)\n";
    }

    // sign.json for every saved_gestures folder.
    $noSign = 0;
    foreach (listLabelFolders($ESL_DIR) as $f) {
        if (!is_file("$ESL_DIR/$f/sign.json")) { $noSign++; $problems[] = "sign.json missing: saved_gestures/$f"; }
    }
    echo "saved_gestures folders without sign.json: $noSign\n";

    $ddl = fetchAll($conn, "SHOW CREATE TABLE `gestures`");
    echo "---- SHOW CREATE TABLE gestures ----\n" . ($ddl[0]['Create Table'] ?? '') . "\n";

    if (!empty($problems)) {
        fwrite(STDERR, "verify FAILED:\n");
        foreach ($problems as $p) { fwrite(STDERR, "  - $p\n"); }
        exit(1);
    }
    echo "verify: all checks passed\n";
}

if ($VERIFY_ONLY) {
    runVerify($conn, $DB, $ROOT, $ESL_DIR, $SNAPSHOT_PATH, $MANIFEST_PATH, true);
    exit(0);
}

// ── Step 1: preconditions + snapshot ─────────────────────────────────────
if (!is_dir($BACKUP)) { fail("backup dir does not exist: $BACKUP"); }
if (!is_dir($ESL_DIR)) { fail("dataset folder missing: $ESL_DIR"); }
if (!is_dir($FSL_DIR)) { fail("dataset folder missing: $FSL_DIR"); }
if (!$NO_DUMP_CHECK) {
    $haveDump = false;
    foreach (glob("$BACKUP/*.sql") ?: [] as $f) { if (filesize($f) > 0) { $haveDump = true; break; } }
    if (!$haveDump) { fail("no non-empty *.sql dump found in $BACKUP (take a mysqldump first)"); }
}
if (!is_dir($BACKUP_FSL) && !mkdir($BACKUP_FSL, 0777, true)) { fail("cannot create $BACKUP_FSL"); }

$hasTextEn = columnExists($conn, $DB, 'gestures', 'text_en');
if (file_exists($SNAPSHOT_PATH)) {
    announce(1, 'preconditions+snapshot', 'skipped (snapshot already written)');
} elseif (!$hasTextEn) {
    $recordings = [];
    foreach (fetchAll($conn, "SELECT g.label, g.sign_language, gr.sample_path FROM gesture_recordings gr JOIN gestures g ON g.id = gr.gesture_id ORDER BY gr.id") as $r) {
        $recordings[] = [
            'label' => $r['label'],
            'sign_language' => $r['sign_language'],
            'sample_path' => $r['sample_path'],
            'fileSha256' => sha256File("$ROOT/{$r['sample_path']}"),
        ];
    }
    $snapshot = [
        'generated' => gmdate('c'),
        'counts' => [
            'gestures' => (int)scalar($conn, "SELECT COUNT(*) FROM gestures"),
            'gesture_recordings' => (int)scalar($conn, "SELECT COUNT(*) FROM gesture_recordings"),
        ],
        'gestures' => fetchAll($conn, "SELECT * FROM gestures ORDER BY id"),
        'recordings' => $recordings,
    ];
    writeJsonFile($SNAPSHOT_PATH, $snapshot);
    announce(1, 'preconditions+snapshot', 'done');
} else {
    echo "step 1 preconditions+snapshot: done (WARNING: DB already migrated and no snapshot exists; snapshot reachability checks will be skipped)\n";
}
maybeStop(1, $STOP_AFTER);

// ── Step 2: prove the pairs ──────────────────────────────────────────────
$knownFsl = [];
foreach ($MOVES as $mv) { $knownFsl[$mv['source']] = true; }
foreach (listLabelFolders($FSL_DIR) as $folder) {
    foreach (listSampleFiles("$FSL_DIR/$folder") as $file) {
        if (!isset($knownFsl["saved_gestures_fsl/$folder/$file"])) { fail("unknown FSL sample not in the pairs fixture: saved_gestures_fsl/$folder/$file"); }
    }
}
foreach (listSampleFiles($FSL_DIR) as $file) {
    if (!isset($knownFsl["saved_gestures_fsl/$file"])) { fail("unknown FSL sample not in the pairs fixture: saved_gestures_fsl/$file"); }
}
$proved = 0; $alreadyMoved = 0;
foreach ($MOVES as $mv) {
    if (is_file($mv['fslPath'])) {
        if (!is_file($mv['twinPath'])) { fail("ESL twin missing for {$mv['source']}: {$mv['twin']}"); }
        $why = sampleMismatch($mv['fslPath'], $mv['twinPath']);
        if ($why !== null) { fail("pair not proven for {$mv['source']}: $why"); }
        $proved++;
    } else {
        if (!is_file($mv['backupPath'])) { fail("{$mv['source']} is gone from the dataset and has no backup copy at {$mv['backupPath']}"); }
        if (!is_file($mv['twinPath'])) { fail("ESL twin missing for already-moved {$mv['source']}: {$mv['twin']}"); }
        $why = sampleMismatch($mv['backupPath'], $mv['twinPath']);
        if ($why !== null) { fail("backup copy of {$mv['source']} no longer matches its twin: $why"); }
        $alreadyMoved++;
    }
}
announce(2, 'prove-pairs', "done ($proved proven, $alreadyMoved already moved)");
maybeStop(2, $STOP_AFTER);

// ── Step 3: schema part 1 ────────────────────────────────────────────────
if (columnExists($conn, $DB, 'gestures', 'text_en')) {
    announce(3, 'schema-part-1', 'skipped (already done)');
} else {
    q($conn, "ALTER TABLE `gestures` MODIFY `sign_language` ENUM('ESL','FSL','BOTH') NOT NULL DEFAULT 'ESL', " .
             "ADD COLUMN `text_en` VARCHAR(255) NULL AFTER `sign_language`, " .
             "ADD COLUMN `text_fil` VARCHAR(255) NULL AFTER `text_en`");
    announce(3, 'schema-part-1', 'done');
}
maybeStop(3, $STOP_AFTER);

// ── Step 4: sign.json + DB texts ─────────────────────────────────────────
$twinToFsl = []; // ESL folder => FSL label
foreach ($PAIRS as $p) { if (!isset($twinToFsl[$p['esl']])) { $twinToFsl[$p['esl']] = $p['fsl']; } }
$wrote = 0; $dbUpdated = 0;
foreach (listLabelFolders($ESL_DIR) as $label) {
    $signPath = "$ESL_DIR/$label/sign.json";
    if (!is_file($signPath)) {
        if (isset($twinToFsl[$label])) {
            $set = 'BOTH'; $textEn = draftText($label); $textFil = draftText($twinToFsl[$label]);
        } else {
            $set = 'ESL'; $textEn = draftText($label); $textFil = null;
        }
        writeJsonFile($signPath, [
            'key' => $label, 'set' => $set, 'textEn' => $textEn, 'textFil' => $textFil, 'updatedAt' => gmdate('c'),
        ]);
        $wrote++;
    }
    $sign = readJson($signPath);
    if ($sign === null || !in_array($sign['set'] ?? null, ['ESL', 'FSL', 'BOTH'], true)) { fail("invalid sign.json: $signPath"); }
    // Only fill rows whose texts were never populated, so a re-run can't clobber later edits.
    $dbUpdated += prep($conn,
        "UPDATE gestures SET sign_language = ?, text_en = ?, text_fil = ? WHERE label = ? AND sign_language IN ('ESL','BOTH') AND text_en IS NULL AND text_fil IS NULL",
        'ssss', [$sign['set'], $sign['textEn'], $sign['textFil'], $label]);
}
announce(4, 'sign-json+db-texts', ($wrote + $dbUpdated) > 0 ? "done ($wrote sign.json written, $dbUpdated DB rows updated)" : 'skipped (already done)');
maybeStop(4, $STOP_AFTER);

// ── Step 5: move duplicates to the backup folder ─────────────────────────
$manifest = loadManifest($MANIFEST_PATH);
$moved = 0; $manifestAdded = 0;
foreach ($MOVES as $mv) {
    $inDataset = is_file($mv['fslPath']);
    if ($inDataset) {
        $dir = dirname($mv['backupPath']);
        if (!is_dir($dir) && !mkdir($dir, 0777, true)) { fail("cannot create $dir"); }
        $origSha = sha256File($mv['fslPath']);
        if (is_file($mv['backupPath'])) {
            if (sha256File($mv['backupPath']) !== $origSha) { fail("backup file exists with different content: {$mv['backupPath']}"); }
        } else {
            if (!copy($mv['fslPath'], $mv['backupPath'])) { fail("copy to backup failed for {$mv['source']}"); }
        }
        if (sha256File($mv['backupPath']) !== $origSha) { fail("backup copy sha256 mismatch for {$mv['source']}; original kept"); }
        if (!is_file($mv['twinPath'])) { fail("ESL twin vanished for {$mv['source']}; original kept"); }
        $why = sampleMismatch($mv['fslPath'], $mv['twinPath']);
        if ($why !== null) { fail("twin re-verification failed for {$mv['source']}: $why; original kept"); }
        if (!unlink($mv['fslPath'])) { fail("could not delete {$mv['fslPath']}"); }
        $moved++;
    }
    // Remove the FSL folder when empty (also covers a crash between delete and rmdir).
    if ($mv['fslDir'] !== null && is_dir($mv['fslDir']) && count(array_diff(scandir($mv['fslDir']), ['.', '..'])) === 0) {
        rmdir($mv['fslDir']);
    }
    if (!isset($manifest[$mv['source']])) {
        $sha = sha256File($mv['backupPath']);
        if ($sha === null) { fail("no backup file to record in manifest for {$mv['source']}"); }
        $manifest[$mv['source']] = ['source' => $mv['source'], 'backup' => $mv['backupPath'], 'sha256' => $sha, 'twin' => $mv['twin']];
        $manifestAdded++;
        saveManifest($MANIFEST_PATH, $manifest);
    }
}
announce(5, 'move-duplicates', ($moved + $manifestAdded) > 0 ? "done ($moved moved, $manifestAdded manifest entries added, " . count($manifest) . " total)" : 'skipped (already done)');
maybeStop(5, $STOP_AFTER);

// ── Step 6: DB cleanup of the moved FSL rows ─────────────────────────────
$delRec = 0; $delGest = 0;
foreach ($PAIRS as $p) {
    $path = "saved_gestures_fsl/{$p['fsl']}/{$p['fslFile']}";
    if (!isset($manifest[$path]) || is_file("$FSL_DIR/{$p['fsl']}/{$p['fslFile']}")) { continue; }
    $delRec += prep($conn, "DELETE FROM gesture_recordings WHERE sample_path = ?", 's', [$path]);
    $delGest += prep($conn,
        "DELETE FROM gestures WHERE label = ? AND sign_language = 'FSL' AND NOT EXISTS (SELECT 1 FROM gesture_recordings gr WHERE gr.gesture_id = gestures.id)",
        's', [$p['fsl']]);
}
announce(6, 'db-cleanup', ($delRec + $delGest) > 0 ? "done ($delRec recordings, $delGest gestures deleted)" : 'skipped (already done)');
maybeStop(6, $STOP_AFTER);

// ── Step 7: schema part 2 ────────────────────────────────────────────────
$didSchema2 = false;
$hasOldKey = indexExists($conn, $DB, 'gestures', 'uq_gestures_label_language');
$hasNewKey = indexExists($conn, $DB, 'gestures', 'uq_gestures_label');
if ($hasOldKey || !$hasNewKey) {
    $dup = (int)scalar($conn, "SELECT COUNT(*) FROM (SELECT label FROM gestures GROUP BY label HAVING COUNT(*) > 1) t");
    if ($dup > 0) { fail("step 7: $dup label(s) appear in more than one gestures row; cannot make label unique"); }
    $clauses = [];
    if ($hasOldKey) { $clauses[] = "DROP INDEX `uq_gestures_label_language`"; }
    if (!$hasNewKey) { $clauses[] = "ADD UNIQUE KEY `uq_gestures_label` (`label`)"; }
    q($conn, "ALTER TABLE `gestures` " . implode(', ', $clauses));
    $didSchema2 = true;
}
if (!checkExists($conn, $DB, 'gestures', 'chk_gestures_texts')) {
    // Generic fix-up so the CHECK can be added: any row missing a required text gets a draft text.
    foreach (fetchAll($conn, "SELECT id, label, sign_language, text_en, text_fil FROM gestures") as $g) {
        $needEn = $g['sign_language'] !== 'FSL' && ($g['text_en'] === null || $g['text_en'] === '');
        $needFil = $g['sign_language'] !== 'ESL' && ($g['text_fil'] === null || $g['text_fil'] === '');
        if ($needEn) { prep($conn, "UPDATE gestures SET text_en = ? WHERE id = ?", 'si', [draftText($g['label']), (int)$g['id']]); echo "  note: drafted text_en for '{$g['label']}'\n"; }
        if ($needFil) { prep($conn, "UPDATE gestures SET text_fil = ? WHERE id = ?", 'si', [draftText($g['label']), (int)$g['id']]); echo "  note: drafted text_fil for '{$g['label']}'\n"; }
    }
    q($conn, "ALTER TABLE `gestures` ADD CONSTRAINT `chk_gestures_texts` CHECK (" .
             "(sign_language = 'FSL' OR (text_en IS NOT NULL AND text_en <> '')) AND " .
             "(sign_language = 'ESL' OR (text_fil IS NOT NULL AND text_fil <> '')))");
    $didSchema2 = true;
}
announce(7, 'schema-part-2', $didSchema2 ? 'done' : 'skipped (already done)');
maybeStop(7, $STOP_AFTER);

// ── Step 8: verify ───────────────────────────────────────────────────────
echo "step 8 verify:\n";
runVerify($conn, $DB, $ROOT, $ESL_DIR, $SNAPSHOT_PATH, $MANIFEST_PATH, false);
maybeStop(8, $STOP_AFTER);

echo "Migration complete.\n";
exit(0);
