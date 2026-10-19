<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

require_once __DIR__ . '/../connect.php';
require_once __DIR__ . '/gesture_category.php';
require_once __DIR__ . '/sign_meta.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$datasetRoot = realpath(__DIR__ . '/../../saved_gestures');
if ($datasetRoot === false) {
    $datasetRoot = __DIR__ . '/../../saved_gestures';
    if (!mkdir($datasetRoot, 0775, true)) {
        fail('Unable to create saved_gestures folder', 500);
    }
    $datasetRoot = realpath($datasetRoot);
}

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

// clean_label() and the sign.json helpers live in sign_meta.php (required above).

// Mirrors js/capture-core.js MAX_FRAMES_PER_REP (301 = floor(MAX_REP_MS / (1000 / PROCESS_FPS)) + 1)
// — a v3 sample is one rep's frames, so it shares that same ceiling.
const MAX_FRAMES_PER_SAMPLE = 301;

function get_ffmpeg_path() {
    $test = shell_exec('ffmpeg -version 2>&1');
    if (strpos($test, 'ffmpeg version') !== false) {
        return 'ffmpeg';
    }
    $local_paths = [
        __DIR__ . '/../../ffmpeg.exe',
        __DIR__ . '/../../bin/ffmpeg.exe',
        'C:\ffmpeg\bin\ffmpeg.exe'
    ];
    foreach ($local_paths as $p) {
        if (file_exists($p)) {
            return '"' . $p . '"';
        }
    }
    return null;
}

// The label's existing display clip, if any: assets/signs/<en|fil>/<label>.mp4, else .webm (the
// raw fallback, and the format the shipped stock clips use). Returns the project-relative path.
function find_label_video($assetsSignsDir, $label, $subFolder) {
    foreach (['mp4', 'webm'] as $ext) {
        $file = $assetsSignsDir . DIRECTORY_SEPARATOR . $label . '.' . $ext;
        if (is_file($file) && filesize($file) > 0) {
            return 'assets/signs/' . $subFolder . '/' . $label . '.' . $ext;
        }
    }
    return null;
}

// column_exists(), ensure_gestures_columns(), backfill_gesture_categories() live in
// gesture_category.php (required above) so a CLI test script can exercise the migration against a
// scratch table without executing this file's request-handling code.

// Upserts the gestures row for a sign by label. sign_language/text_en/text_fil are always set to
// the given values; the stored category is only overwritten when the caller passed an explicit
// $category (a manual tag) -- a null $category (heuristic-only, e.g. from sync_disk_to_db) never
// touches an existing row's category.
function save_gesture_word_to_db($label, $set, $textEn, $textFil, $category = null, $readBackCategory = true) {
    global $conn;
    static $columnsEnsured = false; // once per request, not per call (sync calls this per label)
    if (!$columnsEnsured) {
        ensure_gestures_columns($conn);
        $columnsEnsured = true;
    }

    $insertCategory = $category ?? gesture_category($label);

    // Atomic upsert -- avoids race-condition duplicate key crashes.
    // ON DUPLICATE KEY UPDATE makes LAST_INSERT_ID() return the existing row id on a collision.
    $stmt = mysqli_prepare(
        $conn,
        'INSERT INTO gestures (label, sign_language, text_en, text_fil, category) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), sign_language = VALUES(sign_language),
           text_en = VALUES(text_en), text_fil = VALUES(text_fil), category = IF(?, ?, category)'
    );
    if (!$stmt) {
        fail('DB prepare failed: ' . mysqli_error($conn), 500);
    }
    $hasExplicitCategory = $category !== null ? 1 : 0;
    mysqli_stmt_bind_param($stmt, 'sssssis', $label, $set, $textEn, $textFil, $insertCategory, $hasExplicitCategory, $insertCategory);
    if (!mysqli_stmt_execute($stmt)) {
        fail('DB insert failed: ' . mysqli_stmt_error($stmt), 500);
    }
    $id = (int)mysqli_insert_id($conn);
    $created = $id !== 0;
    mysqli_stmt_close($stmt);

    // If ON DUPLICATE KEY returned 0, look up the existing id
    if ($id === 0) {
        $sel = mysqli_prepare($conn, 'SELECT id FROM gestures WHERE label = ? LIMIT 1');
        mysqli_stmt_bind_param($sel, 's', $label);
        mysqli_stmt_execute($sel);
        $res = mysqli_stmt_get_result($sel);
        $row = mysqli_fetch_assoc($res);
        $id  = (int)($row['id'] ?? 0);
        mysqli_stmt_close($sel);
        $created = false;
    }

    if (!$readBackCategory) {
        return ['id' => $id, 'created' => $created, 'category' => $insertCategory];
    }

    // Read back the category actually stored for this row (covers both the insert and the
    // ON DUPLICATE KEY UPDATE branch without duplicating the IF(...) logic here).
    $catSel = mysqli_prepare($conn, 'SELECT category FROM gestures WHERE id = ? LIMIT 1');
    mysqli_stmt_bind_param($catSel, 'i', $id);
    mysqli_stmt_execute($catSel);
    $catRes = mysqli_stmt_get_result($catSel);
    $catRow = mysqli_fetch_assoc($catRes);
    $storedCategory = $catRow['category'] ?? $insertCategory;
    mysqli_stmt_close($catSel);

    return ['id' => $id, 'created' => $created, 'category' => $storedCategory];
}

function save_gesture_recording_to_db($gestureId, $frameCount, $samplePath, $landmarkJson) {
    global $conn;

    $insert = mysqli_prepare(
        $conn,
        'INSERT INTO gesture_recordings (gesture_id, frame_count, sample_path, landmark_json)
         VALUES (?, ?, ?, ?)'
    );
    if (!$insert) {
        fail('DB recording prepare failed: ' . mysqli_error($conn), 500);
    }

    mysqli_stmt_bind_param($insert, 'iiss', $gestureId, $frameCount, $samplePath, $landmarkJson);
    if (!mysqli_stmt_execute($insert)) {
        fail('DB recording insert failed: ' . mysqli_stmt_error($insert), 500);
    }

    $id = mysqli_insert_id($conn);
    mysqli_stmt_close($insert);

    return (int)$id;
}

// sync_db_to_disk is intentionally disabled.
// Disk (saved_gestures / saved_gestures_fsl JSON files) is the single
// source of truth. Restoring DB rows back to disk caused a circular loop
// where intentionally-deleted gestures would be resurrected on every sync.
function sync_db_to_disk($conn, $datasetRoot) {
    // no-op — disk is authoritative.
}

function sync_disk_to_db($conn, $unusedDatasetRoot) {
    ensure_gestures_columns($conn);

    // saved_gestures first, then the legacy saved_gestures_fsl (read-only). A label found in both
    // keeps the saved_gestures sign; the legacy folder's samples are still registered.
    $folders = [
        __DIR__ . '/../../saved_gestures',
        __DIR__ . '/../../saved_gestures_fsl'
    ];

    $diskPaths = []; // Collect every valid sample_path that exists on disk
    // Every gestures row once: sync only upserts a label whose row is missing or differs from disk.
    $dbRows = [];
    $allRows = mysqli_query($conn, 'SELECT id, label, sign_language, text_en, text_fil FROM gestures');
    while ($allRows && ($r = mysqli_fetch_assoc($allRows))) {
        $dbRows[$r['label']] = $r;
    }
    // Every recorded sample_path once (replaces a SELECT per sample file).
    $knownPaths = [];
    $pathRows = mysqli_query($conn, "SELECT sample_path FROM gesture_recordings WHERE sample_path IS NOT NULL AND sample_path != ''");
    while ($pathRows && ($r = mysqli_fetch_assoc($pathRows))) {
        $knownPaths[$r['sample_path']] = true;
    }
    $upserted  = []; // labels whose gestures row was already refreshed from disk this run

    foreach ($folders as $dirPath) {
        $realPath = realpath($dirPath);
        if ($realPath === false) continue;

        $folderName = basename($realPath);

        foreach (glob($realPath . '/*', GLOB_ONLYDIR) ?: [] as $labelDir) {
            $label = basename($labelDir);
            $files = glob($labelDir . '/sample_*.json') ?: [];
            if (!$files) continue;

            // Disk wins: the gestures row follows sign.json (or the derived sign) on every sync.
            $sign = derive_sign($folderName, $label, $labelDir);
            if (!isset($upserted[$label])) {
                $row = $dbRows[$label] ?? null;
                if ($row !== null
                    && $row['sign_language'] === $sign['set']
                    && $row['text_en'] === $sign['textEn']
                    && $row['text_fil'] === $sign['textFil']) {
                    $upserted[$label] = (int)$row['id'];
                } else {
                    $dbGesture = save_gesture_word_to_db($label, $sign['set'], $sign['textEn'], $sign['textFil'], null, false);
                    $upserted[$label] = $dbGesture['id'];
                }
            }
            $gestureId = $upserted[$label];

            foreach ($files as $file) {
                $json = json_decode(file_get_contents($file), true);
                if (!is_array($json)) continue;

                $filename     = basename($file);
                $relativePath = $folderName . '/' . $label . '/' . $filename;
                $diskPaths[]  = $relativePath;

                // Add to DB only if not already present
                $exists = isset($knownPaths[$relativePath]);

                if (!$exists) {
                    save_gesture_recording_to_db(
                        $gestureId,
                        count($json['frames'] ?? []),
                        $relativePath,
                        json_encode($json)
                    );
                }
            }
        }
    }

    // --- Remove stale DB rows whose files no longer exist on disk ---
    // This prevents deleted gesture files from being kept as phantom rows.
    if (!empty($diskPaths)) {
        $placeholders = implode(',', array_fill(0, count($diskPaths), '?'));
        $types        = str_repeat('s', count($diskPaths));

        $del = mysqli_prepare(
            $conn,
            "DELETE FROM gesture_recordings
             WHERE sample_path IS NOT NULL
               AND sample_path != ''
               AND sample_path NOT IN ($placeholders)"
        );
        mysqli_stmt_bind_param($del, $types, ...$diskPaths);
        mysqli_stmt_execute($del);
        mysqli_stmt_close($del);
    } else {
        // No files at all — wipe every path-linked recording
        mysqli_query($conn, "DELETE FROM gesture_recordings WHERE sample_path IS NOT NULL AND sample_path != ''");
    }

    // Cascade: remove gestures that have no recordings left
    mysqli_query($conn,
        'DELETE FROM gestures
         WHERE id NOT IN (
             SELECT DISTINCT gesture_id FROM gesture_recordings
             WHERE gesture_id IS NOT NULL
         )'
    );
}

// Builds {"ESL": {label: category, ...}, "FSL": {label: category, ...}} from the signs map
// ({label: {set, ...}}): a label is under ESL if its set is ESL or BOTH, under FSL if FSL or BOTH.
// Reads the DB in ONE query (gesture_category() as heuristic fallback for labels with no row, or if
// the SELECT itself fails) -- the dataset list must never fail because of categories.
function build_categories_map($conn, $signs) {
    $dbCategory = []; // label -> category
    try {
        $result = mysqli_query($conn, 'SELECT label, category FROM gestures');
    } catch (Throwable $e) {
        $result = false; // fall through to the per-label heuristic below
    }
    if ($result) {
        while ($row = mysqli_fetch_assoc($result)) {
            $dbCategory[$row['label']] = $row['category'];
        }
    }

    $categories = ['ESL' => [], 'FSL' => []];
    foreach ($signs as $label => $sign) {
        $category = $dbCategory[$label] ?? gesture_category($label);
        if ($sign['set'] === 'ESL' || $sign['set'] === 'BOTH') {
            $categories['ESL'][$label] = $category;
        }
        if ($sign['set'] === 'FSL' || $sign['set'] === 'BOTH') {
            $categories['FSL'][$label] = $category;
        }
    }
    return $categories;
}

// labels=a,b,c (compact-model phase): limit the listing to these sign keys, so Train Gestures'
// Compile can read frames a batch of signs at a time (the full listing with frames runs out of PHP
// memory at ~732 v3 samples). Each key must already be a clean_label() key; at most 200 keys.
// Returns null when the option is absent, else a set (key => true). Invalid -> 400 JSON error.
const LIST_LABELS_MAX = 200;
function listing_label_filter() {
    if (!isset($_GET['labels'])) return null;
    $raw = $_GET['labels'];
    if (!is_string($raw) || $raw === '') fail('labels must be a comma-separated list of sign keys');
    $keys = explode(',', $raw);
    if (count($keys) > LIST_LABELS_MAX) fail('labels may name at most ' . LIST_LABELS_MAX . ' sign keys');
    $set = [];
    foreach ($keys as $key) {
        if ($key === '' || clean_label($key) !== $key) fail('Invalid sign key in labels: "' . $key . '"');
        $set[$key] = true;
    }
    return $set;
}

function list_samples($defaultRoot) {
    global $conn;
    $labelFilter = listing_label_filter();   // checked before any sync work
    // Skip sync when no_sync is set (used by sign-to-text and voice pages for fast startup)
    if (!isset($_GET['no_sync'])) {
        // Disk is source of truth: sync disk → DB (adds new, deletes stale phantom rows)
        sync_disk_to_db($conn, $defaultRoot);
    }
    // A no_sync load on an unmigrated DB (category column not yet added) still needs the column
    // to exist before build_categories_map()'s SELECT below.
    ensure_gestures_columns($conn);

    $folders = [
        'saved_gestures',
        'saved_gestures_fsl'
    ];

    // label => [[folder, sample file], ...] (paths only), in the same order as before.
    $sampleFiles = [];
    $signs = [];
    // summary=1 (compact-model phase): the same listing without each sample's `frames` (Train
    // Gestures' dataset table and Step 2 card need names and counts only). Works with no_sync.
    $summary = isset($_GET['summary']) && $_GET['summary'] !== '0';

    foreach ($folders as $folder) {
        $dirPath = realpath(__DIR__ . '/../../' . $folder);
        if ($dirPath === false) continue;

        foreach (glob($dirPath . '/*', GLOB_ONLYDIR) ?: [] as $labelDir) {
            $label = basename($labelDir);
            if ($labelFilter !== null && !isset($labelFilter[$label])) continue;
            if (!isset($sampleFiles[$label])) {
                $sampleFiles[$label] = [];
            }
            if (!isset($signs[$label])) {
                $signs[$label] = derive_sign($folder, $label, $labelDir);
            }
            foreach (glob($labelDir . '/sample_*.json') ?: [] as $file) {
                $sampleFiles[$label][] = [$folder, $file];
            }
        }
    }

    // Streamed one sample at a time (cleanup 2026-10-20): building the whole response first ran out
    // of PHP's 512 MB memory_limit with frames at 1,267 samples (a PHP fatal error page instead of
    // JSON). The output is the same JSON document as json_encode() of the whole array gave.
    echo '{"success":true,"datasetRoot":"saved_gestures","gestures":' . ($sampleFiles ? '{' : '[');
    $firstLabel = true;
    foreach ($sampleFiles as $label => $files) {
        echo ($firstLabel ? '' : ',') . json_encode((string)$label) . ':[';
        $firstLabel = false;
        $firstEntry = true;
        foreach ($files as [$folder, $file]) {
            $json = json_decode(file_get_contents($file), true);
            if (is_array($json)) {
                $entry = [
                    'file' => $folder . '/' . $label . '/' . basename($file),
                    'label' => $json['label'] ?? $label,
                    'frames' => $json['frames'] ?? [],
                    'frameCount' => count($json['frames'] ?? []),
                    'createdAt' => $json['createdAt'] ?? null,
                    'signLanguage' => $json['signLanguage'] ?? $json['sign_language'] ?? 'ESL',
                ];
                if ($summary) {
                    unset($entry['frames']);
                }
                echo ($firstEntry ? '' : ',') . json_encode($entry);
                $firstEntry = false;
            }
            unset($json, $entry);   // free the decoded sample before reading the next one
        }
        echo ']';
    }
    echo ($sampleFiles ? '}' : ']') . ',"signs":' . json_encode((object)$signs)
        . ',"categories":' . json_encode(build_categories_map($conn, $signs)) . '}';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    list_samples($datasetRoot);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST or GET only', 405);
}

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    fail('Invalid JSON body');
}

// Intercept delete_gesture action
if (isset($body['action']) && $body['action'] === 'delete_gesture') {
    $label = clean_label($body['label'] ?? '');
    if ($label === '') fail('Label is required');

    // 1. Delete the sign's folder (all *.json incl. sign.json) from saved_gestures and the legacy
    //    saved_gestures_fsl.
    foreach (['saved_gestures', 'saved_gestures_fsl'] as $folder) {
        $folderRoot = realpath(__DIR__ . '/../../' . $folder);
        if ($folderRoot === false) continue;
        $labelDir = $folderRoot . DIRECTORY_SEPARATOR . $label;
        if (is_dir($labelDir)) {
            foreach (glob($labelDir . '/*.json') ?: [] as $file) {
                unlink($file);
            }
            @rmdir($labelDir);
        }
    }

    // 2. Delete database entries in MySQL (at most one gestures row per label)
    $stmt = mysqli_prepare($conn, "SELECT id FROM gestures WHERE label = ?");
    mysqli_stmt_bind_param($stmt, 's', $label);
    mysqli_stmt_execute($stmt);
    $res = mysqli_stmt_get_result($stmt);
    $ids = [];
    while ($r = mysqli_fetch_assoc($res)) {
        $ids[] = (int)$r['id'];
    }
    mysqli_stmt_close($stmt);

    foreach ($ids as $gestureId) {
        $delRec = mysqli_prepare($conn, 'DELETE FROM gesture_recordings WHERE gesture_id = ?');
        mysqli_stmt_bind_param($delRec, 'i', $gestureId);
        mysqli_stmt_execute($delRec);
        mysqli_stmt_close($delRec);
        $delG = mysqli_prepare($conn, 'DELETE FROM gestures WHERE id = ?');
        mysqli_stmt_bind_param($delG, 'i', $gestureId);
        mysqli_stmt_execute($delG);
        mysqli_stmt_close($delG);
    }

    mysqli_close($conn);
    echo json_encode(['success' => true, 'message' => "Gesture '$label' successfully deleted."]);
    exit;
}

// Bulk import, "re-import replaces" (2026-10-16): removes named IMPORTED samples of one sign, the
// same two steps as delete_gesture above (the sample file, then its gesture_recordings row) but only
// for saved_gestures/<label>/sample_i<importId>.json -- a file only an import save writes (see the
// importId branch below). The sign, its sign.json, its other samples and the gestures row stay.
// {action, label, importIds: [32 lower-case hex, 1..20]} -> {success, label, deleted, missing, files}
// (a file already gone counts as missing, not as an error: a retried request is harmless).
if (isset($body['action']) && $body['action'] === 'delete_import_samples') {
    $label = $body['label'] ?? null;
    if (!is_string($label) || $label === '' || clean_label($label) !== $label) fail('Invalid label');
    $ids = $body['importIds'] ?? null;
    if (!is_array($ids) || count($ids) < 1 || count($ids) > 20) fail('importIds must be a list of 1 to 20 ids');
    foreach ($ids as $id) {
        if (!is_string($id) || !preg_match('/^[0-9a-f]{32}$/D', $id)) fail('importIds must be 32 lower-case hex characters');
    }
    $labelDir = $datasetRoot . DIRECTORY_SEPARATOR . $label;
    $deleted = [];
    $missing = 0;
    foreach (array_values(array_unique($ids)) as $id) {
        $filename = 'sample_i' . $id . '.json';
        $path = $labelDir . DIRECTORY_SEPARATOR . $filename;
        if (is_file($path)) {
            if (!@unlink($path)) fail('Unable to delete ' . $filename, 500);
            $deleted[] = $filename;
        } else {
            $missing++;
        }
        $relativePath = 'saved_gestures/' . $label . '/' . $filename;
        $delRec = mysqli_prepare($conn, 'DELETE FROM gesture_recordings WHERE sample_path = ?');
        if (!$delRec) fail('DB delete prepare failed: ' . mysqli_error($conn), 500);
        mysqli_stmt_bind_param($delRec, 's', $relativePath);
        if (!mysqli_stmt_execute($delRec)) fail('DB delete failed: ' . mysqli_stmt_error($delRec), 500);
        mysqli_stmt_close($delRec);
    }
    mysqli_close($conn);
    echo json_encode(['success' => true, 'label' => $label, 'deleted' => count($deleted), 'missing' => $missing, 'files' => $deleted]);
    exit;
}

$set          = valid_sign_set($body['sign_language'] ?? $body['dataset'] ?? null) ?? 'ESL';
$frames       = $body['frames']      ?? null;
$videoBase64  = $body['video_base64'] ?? null;   // optional recorded video
$category     = valid_gesture_category($body['category'] ?? null); // invalid/missing -> null

[$textEn, $textErr]  = sign_text_field($body['text_en'] ?? null, 'text_en');
if ($textErr) fail($textErr);
[$textFil, $textErr] = sign_text_field($body['text_fil'] ?? null, 'text_fil');
if ($textErr) fail($textErr);
$textsSent = $textEn !== null || $textFil !== null;

if ($textsSent) {
    // New-style call: the key comes from the text of the sign's primary language.
    if (($set === 'ESL' || $set === 'BOTH') && $textEn === null) {
        fail('English text is required for this sign set');
    }
    if (($set === 'FSL' || $set === 'BOTH') && $textFil === null) {
        fail('Filipino text is required for this sign set');
    }
    $label = clean_label($set === 'FSL' ? $textFil : $textEn);
    if ($label === '') {
        fail('The text must contain at least one letter or number');
    }
} else {
    // Legacy call (label/word only): key as before, texts come from the stored sign or a draft.
    $label = clean_label($body['label'] ?? $body['word'] ?? '');
    if ($label === '') {
        fail('Gesture label is required');
    }
}
if (!is_array($frames)) {
    fail('frames must be an array');
}
if (count($frames) < 1) {
    fail('At least one landmark frame is required');
}
if (count($frames) > MAX_FRAMES_PER_SAMPLE) {
    fail('Too many frames in one sample (max 301)', 413);
}

$formatVersion = (int)($body['formatVersion'] ?? 0);
$isV3 = $formatVersion === 3;

if ($isV3) {
    foreach ($frames as $i => $frame) {
        if (!is_array($frame) || !isset($frame['t']) || !is_numeric($frame['t']) || !isset($frame['hands']) || !is_array($frame['hands'])) {
            fail("Invalid v3 frame at index $i");
        }
    }
}

// Bulk video importer (v3 only, both optional): signer = who signed the video (P01..P99),
// importId = the sample's identity (32 hex chars), which makes a repeated import a no-op below.
// A request without them -- and any v2 request -- is handled exactly as before.
$signer   = null;
$importId = null;
if ($isV3 && isset($body['signer'])) {
    if (!is_string($body['signer']) || !preg_match('/^P(0[1-9]|[1-9][0-9])$/D', $body['signer'])) {
        fail('signer must be P01..P99');
    }
    $signer = $body['signer'];
}
if ($isV3 && isset($body['importId'])) {
    if (!is_string($body['importId']) || !preg_match('/^[0-9a-f]{32}$/D', $body['importId'])) {
        fail('importId must be 32 lower-case hex characters');
    }
    $importId = $body['importId'];
}

// ── Existing sign with this key? (sign.json / samples in saved_gestures, the legacy
//    saved_gestures_fsl folder, or a DB row by label). A different set is a collision. ──
$existingSign = null;
foreach (['saved_gestures', 'saved_gestures_fsl'] as $legacyFolder) {
    $existingDir = __DIR__ . '/../../' . $legacyFolder . '/' . $label;
    if (is_dir($existingDir) && (is_file($existingDir . '/sign.json') || glob($existingDir . '/sample_*.json'))) {
        $existingSign = derive_sign($legacyFolder, $label, $existingDir);
        break;
    }
}
if ($existingSign === null) {
    ensure_gestures_columns($conn);
    $existSel = mysqli_prepare($conn, 'SELECT sign_language, text_en, text_fil FROM gestures WHERE label = ? LIMIT 1');
    if (!$existSel) {
        fail('DB prepare failed: ' . mysqli_error($conn), 500);
    }
    mysqli_stmt_bind_param($existSel, 's', $label);
    mysqli_stmt_execute($existSel);
    $existRow = mysqli_fetch_assoc(mysqli_stmt_get_result($existSel));
    mysqli_stmt_close($existSel);
    if ($existRow) {
        $existingSign = ['set' => valid_sign_set($existRow['sign_language']) ?? 'ESL',
                         'textEn' => $existRow['text_en'], 'textFil' => $existRow['text_fil']];
    }
}
if ($existingSign !== null && $existingSign['set'] !== $set) {
    http_response_code(409);
    echo json_encode([
        'success'     => false,
        'error'       => 'A sign with this key already exists as ' . $existingSign['set'] . '.',
        'existingSet' => $existingSign['set'],
    ]);
    exit;
}

// Final texts: sent texts replace stored ones; an unsent text keeps the stored one; a brand-new
// legacy sign gets the draft text for the languages its set shows.
if (!$textsSent) {
    if ($existingSign !== null) {
        $textEn  = $existingSign['textEn'];
        $textFil = $existingSign['textFil'];
    } else {
        $textEn  = $set !== 'FSL' ? sign_draft_text($label) : null;
        $textFil = $set !== 'ESL' ? sign_draft_text($label) : null;
    }
} elseif ($existingSign !== null) {
    $textEn  = $textEn  ?? $existingSign['textEn'];
    $textFil = $textFil ?? $existingSign['textFil'];
}
// A legacy row/folder may lack a text its set requires; never violate chk_gestures_texts.
if ($set !== 'FSL' && ($textEn === null || $textEn === '')) $textEn = sign_draft_text($label);
if ($set !== 'ESL' && ($textFil === null || $textFil === '')) $textFil = sign_draft_text($label);

// ── Save landmark JSON: always saved_gestures/<key>/ (saved_gestures_fsl is read-only legacy) ──
$targetDatasetRoot = realpath(__DIR__ . '/../../saved_gestures');
if ($targetDatasetRoot === false) {
    fail('Unable to find saved_gestures folder', 500);
}

$labelDir = $targetDatasetRoot . DIRECTORY_SEPARATOR . $label;
if (!is_dir($labelDir) && !mkdir($labelDir, 0775, true)) {
    fail('Unable to create gesture label folder', 500);
}

$resolvedLabelDir = realpath($labelDir);
if ($resolvedLabelDir === false || strpos($resolvedLabelDir, $targetDatasetRoot) !== 0) {
    fail('Invalid gesture label path');
}

// Samples this label already has for this sign set — taken BEFORE the new file is written; the
// video rule below keys on it (a label's first sample always refreshes its clip).
$priorSampleCount = count(glob($resolvedLabelDir . DIRECTORY_SEPARATOR . 'sample_*.json') ?: []);

// A sample's own signLanguage is FSL only for FSL signs; ESL and BOTH signs record as ESL.
$sampleLanguage = ($set === 'FSL') ? 'FSL' : 'ESL';

$filename = 'sample_' . round(microtime(true) * 1000) . '_' . bin2hex(random_bytes(3)) . '.json';
$path     = $resolvedLabelDir . DIRECTORY_SEPARATOR . $filename;

// An imported sample is named after its importId, so importing the same video rep twice finds its
// own file: answer "duplicate" and write nothing (no sample file, no sign.json, no DB row).
if ($importId !== null) {
    $filename = 'sample_i' . $importId . '.json';
    $path     = $resolvedLabelDir . DIRECTORY_SEPARATOR . $filename;
    if (is_file($path)) {
        mysqli_close($conn);
        echo json_encode([
            'success'      => true,
            'duplicate'    => true,
            'label'        => $label,
            'set'          => $set,
            'signLanguage' => $set,
            'file'         => 'saved_gestures/' . $label . '/' . $filename,
            'frameCount'   => count($frames),
        ]);
        exit;
    }
}

if ($isV3) {
    $inputBody = is_array($body['input'] ?? null) ? $body['input'] : [];
    $rectBody  = is_array($inputBody['contentRect'] ?? null) ? $inputBody['contentRect'] : [];
    $numOrZero = function ($v) { return is_numeric($v) ? $v + 0 : 0; };

    $recording = [
        'label'        => $label,
        'createdAt'    => gmdate('c'),
        'frameCount'   => count($frames),
        'format'       => 'mediapipe_hands_raw_v3',
        'formatVersion'=> 3,
        'signLanguage' => $sampleLanguage,
        'source'       => (string)($body['source'] ?? 'video-live'),
        'repIndex'     => (int)($body['repIndex'] ?? 0),
        'videoWidth'   => (int)($body['videoWidth'] ?? 0),
        'videoHeight'  => (int)($body['videoHeight'] ?? 0),
        'fps'          => $numOrZero($body['fps'] ?? 0),
        'input'        => [
            'width'       => $numOrZero($inputBody['width'] ?? 0),
            'height'      => $numOrZero($inputBody['height'] ?? 0),
            'contentRect' => [
                'x' => $numOrZero($rectBody['x'] ?? 0),
                'y' => $numOrZero($rectBody['y'] ?? 0),
                'w' => $numOrZero($rectBody['w'] ?? 0),
                'h' => $numOrZero($rectBody['h'] ?? 0),
            ],
        ],
        'frames'       => $frames,
    ];
    // Importer fields, only when sent (kept ahead of the long frames list).
    if ($signer !== null || $importId !== null) {
        unset($recording['frames']);
        if ($signer !== null)   $recording['signer']   = $signer;
        if ($importId !== null) $recording['importId'] = $importId;
        $recording['frames'] = $frames;
    }
} else {
    $recording = [
        'label'       => $label,
        'createdAt'   => gmdate('c'),
        'frameCount'  => count($frames),
        'format'      => 'mediapipe_hands_landmarks_v2',
        'signLanguage'=> $sampleLanguage,
        'frames'      => $frames,
    ];
}

// v3 raw samples can carry up to 301 frames of full per-landmark data; JSON_PRETTY_PRINT's
// indentation alone can push that past MariaDB's default max_allowed_packet (1 MiB) when the
// same string is also written to gesture_recordings.landmark_json. v2's shape/format stays
// byte-for-byte pretty-printed as before — only the new v3 path is stored compact.
$encoded = json_encode($recording, $isV3 ? 0 : JSON_PRETTY_PRINT);
// Import saves only: if the request ends before the final success response (sign.json or a DB step
// failed), remove the sample file again -- otherwise a retry of the same rep would find it and be
// answered "duplicate" with its sign.json / DB row never written. Nothing is registered without importId.
$importSaved = false;
if ($importId !== null) {
    register_shutdown_function(function () use (&$importSaved, $path) {
        if (!$importSaved && is_file($path)) {
            @unlink($path);
        }
    });
}
if ($encoded === false || file_put_contents($path, $encoded, LOCK_EX) === false) {
    fail('Unable to write gesture sample', 500);
}

// sign.json (set + texts) before any DB write -- disk is the source of truth.
if (!write_sign_json($resolvedLabelDir, $label, $set, $textEn, $textFil)) {
    if ($importId !== null) @unlink($path); // a retry of this import must be a real retry
    fail('Unable to write sign.json', 500);
}

// Save recorded video to assets/signs/<label>.mp4 (or fallback to .webm if ffmpeg is missing)
$videoAssetRelative = $body['video_path'] ?? null;
$videoSkipped    = false;
$videoTranscoded = false;
$videoExisting   = null;
if (!empty($videoBase64)) {
    $base64Data = preg_replace('/^data:[^;]+;base64,/', '', $videoBase64);
    $videoBytes = base64_decode($base64Data, true);
    if ($videoBytes !== false && strlen($videoBytes) > 0) {
        $subFolder = ($set === 'FSL') ? 'fil' : 'en';
        $assetsSignsDir = realpath(__DIR__ . '/../../assets/signs/' . $subFolder);
        if ($assetsSignsDir === false) {
            $assetsSignsDir = __DIR__ . '/../../assets/signs/' . $subFolder;
            mkdir($assetsSignsDir, 0775, true);
            $assetsSignsDir = realpath($assetsSignsDir);
        }

        $existingVideo = find_label_video($assetsSignsDir, $label, $subFolder);
        // Keep the existing clip for samples 2+. Landmarks were already saved above and are never skipped.
        $skipVideo = ($existingVideo !== null && $priorSampleCount > 0);
        if ($skipVideo) {
            $videoSkipped  = true;
            $videoExisting = $existingVideo;
        }

        $ffmpeg = $skipVideo ? null : get_ffmpeg_path();   // no `ffmpeg -version` process spawn on a skipped save
        if ($ffmpeg) {
            $tempRawPath = $assetsSignsDir . DIRECTORY_SEPARATOR . $label . '_temp_raw.webm';
            file_put_contents($tempRawPath, $videoBytes, LOCK_EX);

            $videoFilename = $label . '.mp4';
            $videoPath = $assetsSignsDir . DIRECTORY_SEPARATOR . $videoFilename;

            // Run FFmpeg conversion to H.264 MP4 360p no audio baseline profile
            $cmd = "$ffmpeg -i " . escapeshellarg($tempRawPath) . " -vf \"scale=360:-2\" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 -r 25 -an -b:v 300k " . escapeshellarg($videoPath) . " -y 2>&1";
            $output = [];
            $retval = 0;
            $videoTranscoded = true;                        // set immediately before the exec that actually runs
            exec($cmd, $output, $retval);

            if (file_exists($tempRawPath)) {
                unlink($tempRawPath);
            }

            if ($retval === 0 && file_exists($videoPath) && filesize($videoPath) > 0) {
                $videoAssetRelative = 'assets/signs/' . $subFolder . '/' . $videoFilename;

                // Also save to OneDrive project folder
                $oneDriveSignsDir = 'C:\\Users\\Techlife\\OneDrive\\Documents\\New folder (5)\\Sining_kamay\\assets\\signs\\' . $subFolder;
                if (is_dir($oneDriveSignsDir) && realpath($oneDriveSignsDir) !== $assetsSignsDir) {
                    $oneDriveVideoPath = $oneDriveSignsDir . DIRECTORY_SEPARATOR . $videoFilename;
                    copy($videoPath, $oneDriveVideoPath);
                }
            }
        }

        // Fallback to saving raw webm if ffmpeg failed or is missing (never on a skipped save)
        if (!$skipVideo && empty($videoAssetRelative)) {
            $videoFilename = $label . '.webm';
            $videoPath = $assetsSignsDir . DIRECTORY_SEPARATOR . $videoFilename;
            file_put_contents($videoPath, $videoBytes, LOCK_EX);
            $videoAssetRelative = 'assets/signs/' . $subFolder . '/' . $videoFilename;

            $oneDriveSignsDir = 'C:\\Users\\Techlife\\OneDrive\\Documents\\New folder (5)\\Sining_kamay\\assets\\signs\\' . $subFolder;
            if (is_dir($oneDriveSignsDir) && realpath($oneDriveSignsDir) !== $assetsSignsDir) {
                $oneDriveVideoPath = $oneDriveSignsDir . DIRECTORY_SEPARATOR . $videoFilename;
                file_put_contents($oneDriveVideoPath, $videoBytes, LOCK_EX);
            }
        }
    }
}

$relativePath  = 'saved_gestures/' . $label . '/' . $filename;
$dbGesture     = save_gesture_word_to_db($label, $set, $textEn, $textFil, $category);

// Never overwrite an existing asset_path with nothing (same rule as the old IFNULL()).
$assetUpdate = mysqli_prepare($conn, 'UPDATE gestures SET asset_path = COALESCE(?, asset_path) WHERE id = ?');
if (!$assetUpdate) {
    fail('DB asset_path update prepare failed: ' . mysqli_error($conn), 500);
}
mysqli_stmt_bind_param($assetUpdate, 'si', $videoAssetRelative, $dbGesture['id']);
if (!mysqli_stmt_execute($assetUpdate)) {
    fail('DB asset_path update failed: ' . mysqli_stmt_error($assetUpdate), 500);
}
mysqli_stmt_close($assetUpdate);

$dbRecordingId = save_gesture_recording_to_db(
    $dbGesture['id'],
    count($frames),
    $relativePath,
    $encoded
);

mysqli_close($conn);

$importSaved = true; // everything is written: the shutdown guard above keeps the sample file

echo json_encode([
    'success'          => true,
    'label'            => $label,
    'signLanguage'     => $set,
    'set'              => $set,
    'textEn'           => $textEn,
    'textFil'          => $textFil,
    'category'         => $dbGesture['category'],
    'file'             => $relativePath,
    'videoAsset'       => $videoAssetRelative,
    'frameCount'       => count($frames),
    'dbGestureId'      => $dbGesture['id'],
    'dbGestureCreated' => $dbGesture['created'],
    'dbRecordingId'    => $dbRecordingId,
    'labelSampleCount' => $priorSampleCount + 1,
    'videoSkipped'     => $videoSkipped,
    'videoTranscoded'  => $videoTranscoded,
    'videoExisting'    => $videoExisting,
]);
