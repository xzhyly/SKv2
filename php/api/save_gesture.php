<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

require_once __DIR__ . '/../connect.php';

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

function clean_label($label) {
    $label = strtolower(trim((string)$label));
    $label = preg_replace('/\s+/', '_', $label);
    $label = preg_replace('/[^a-z0-9_-]/', '', $label);
    return trim($label, '_-');
}

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

function column_exists($conn, $table, $column) {
    $table = mysqli_real_escape_string($conn, $table);
    $column = mysqli_real_escape_string($conn, $column);
    $result = mysqli_query($conn, "SHOW COLUMNS FROM `$table` LIKE '$column'");
    return $result && mysqli_num_rows($result) > 0;
}

function ensure_gestures_columns($conn) {
    if (!column_exists($conn, 'gestures', 'sign_language')) {
        if (!mysqli_query($conn, "ALTER TABLE gestures ADD COLUMN sign_language VARCHAR(10) NOT NULL DEFAULT 'ESL' AFTER word")) {
            fail('DB gestures alter failed: ' . mysqli_error($conn), 500);
        }
    }
}

function save_gesture_word_to_db($label, $signLanguage) {
    global $conn;
    ensure_gestures_columns($conn);

    // Atomic upsert — avoids race-condition duplicate key crashes.
    // ON DUPLICATE KEY UPDATE makes LAST_INSERT_ID() return the existing row id
    // when there is a collision, so we always get back a valid id.
    $stmt = mysqli_prepare(
        $conn,
        'INSERT INTO gestures (word, sign_language) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'
    );
    if (!$stmt) {
        fail('DB prepare failed: ' . mysqli_error($conn), 500);
    }
    mysqli_stmt_bind_param($stmt, 'ss', $label, $signLanguage);
    if (!mysqli_stmt_execute($stmt)) {
        fail('DB insert failed: ' . mysqli_stmt_error($stmt), 500);
    }
    $id = (int)mysqli_insert_id($conn);
    $created = $id !== 0;
    mysqli_stmt_close($stmt);

    // If ON DUPLICATE KEY returned 0, look up the existing id
    if ($id === 0) {
        $sel = mysqli_prepare($conn, 'SELECT id FROM gestures WHERE word = ? AND sign_language = ? LIMIT 1');
        mysqli_stmt_bind_param($sel, 'ss', $label, $signLanguage);
        mysqli_stmt_execute($sel);
        $res = mysqli_stmt_get_result($sel);
        $row = mysqli_fetch_assoc($res);
        $id  = (int)($row['id'] ?? 0);
        mysqli_stmt_close($sel);
        $created = false;
    }

    return ['id' => $id, 'created' => $created];
}

function ensure_language_dataset_table($conn, $signLanguage) {
    $table = $signLanguage === 'FSL' ? 'fsl_signs' : 'esl_signs';
    $sql = "CREATE TABLE IF NOT EXISTS `$table` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sign_key VARCHAR(120) NOT NULL UNIQUE,
        sign_label VARCHAR(255) NOT NULL,
        text_value VARCHAR(255) NOT NULL,
        description TEXT NULL,
        asset_path VARCHAR(255) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_text_value (text_value)
    )";

    if (!mysqli_query($conn, $sql)) {
        fail('DB dataset table create failed: ' . mysqli_error($conn), 500);
    }

    return $table;
}

function save_gesture_to_language_dataset($label, $signLanguage, $assetPath = null) {
    global $conn;
    $table = ensure_language_dataset_table($conn, $signLanguage);
    $displayText = str_replace('_', ' ', $label);

    $insert = mysqli_prepare(
        $conn,
        "INSERT INTO `$table` (sign_key, sign_label, text_value, description, asset_path)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sign_label = VALUES(sign_label),
           text_value = VALUES(text_value),
           description = VALUES(description),
           asset_path = IFNULL(VALUES(asset_path), asset_path)"
    );
    if (!$insert) {
        fail('DB dataset prepare failed: ' . mysqli_error($conn), 500);
    }

    $description = $signLanguage . ' user-added gesture sample.';
    mysqli_stmt_bind_param($insert, 'sssss', $label, $displayText, $displayText, $description, $assetPath);
    if (!mysqli_stmt_execute($insert)) {
        fail('DB dataset insert failed: ' . mysqli_stmt_error($insert), 500);
    }

    $id = mysqli_insert_id($conn);
    if ($id === 0) {
        $select = mysqli_prepare($conn, "SELECT id FROM `$table` WHERE sign_key = ? LIMIT 1");
        mysqli_stmt_bind_param($select, 's', $label);
        mysqli_stmt_execute($select);
        $result = mysqli_stmt_get_result($select);
        $row = mysqli_fetch_assoc($result);
        $id = (int)($row['id'] ?? 0);
        mysqli_stmt_close($select);
    }

    mysqli_stmt_close($insert);

    return ['table' => $table, 'id' => (int)$id];
}

function ensure_gesture_recordings_table($conn) {
    $sql = "CREATE TABLE IF NOT EXISTS gesture_recordings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gesture_id INT NULL,
        sign_language VARCHAR(10) NOT NULL DEFAULT 'ESL',
        gesture_type VARCHAR(100) NOT NULL,
        sample_count INT NOT NULL DEFAULT 0,
        sample_path VARCHAR(255) NULL,
        landmark_json LONGTEXT NULL,
        thumbnail LONGTEXT NULL,
        recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (gesture_id),
        INDEX (gesture_type)
    )";

    if (!mysqli_query($conn, $sql)) {
        fail('DB table create failed: ' . mysqli_error($conn), 500);
    }
    if (!column_exists($conn, 'gesture_recordings', 'sign_language')) {
        if (!mysqli_query($conn, "ALTER TABLE gesture_recordings ADD COLUMN sign_language VARCHAR(10) NOT NULL DEFAULT 'ESL' AFTER gesture_id")) {
            fail('DB recording alter failed: ' . mysqli_error($conn), 500);
        }
    }
}

function save_gesture_recording_to_db($gestureId, $signLanguage, $label, $frameCount, $samplePath, $landmarkJson) {
    global $conn;
    ensure_gesture_recordings_table($conn);

    $insert = mysqli_prepare(
        $conn,
        'INSERT INTO gesture_recordings (gesture_id, sign_language, gesture_type, sample_count, sample_path, landmark_json)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    if (!$insert) {
        fail('DB recording prepare failed: ' . mysqli_error($conn), 500);
    }

    mysqli_stmt_bind_param($insert, 'ississ', $gestureId, $signLanguage, $label, $frameCount, $samplePath, $landmarkJson);
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
    ensure_language_dataset_table($conn, 'ESL');
    ensure_language_dataset_table($conn, 'FSL');
    ensure_gesture_recordings_table($conn);

    $folders = [
        'ESL' => __DIR__ . '/../../saved_gestures',
        'FSL' => __DIR__ . '/../../saved_gestures_fsl'
    ];

    $diskPaths = []; // Collect every valid sample_path that exists on disk

    foreach ($folders as $lang => $dirPath) {
        $realPath = realpath($dirPath);
        if ($realPath === false) continue;

        $folderName = basename($realPath);

        foreach (glob($realPath . '/*', GLOB_ONLYDIR) ?: [] as $labelDir) {
            $label = basename($labelDir);
            $files = glob($labelDir . '/sample_*.json') ?: [];

            foreach ($files as $file) {
                $json = json_decode(file_get_contents($file), true);
                if (!is_array($json)) continue;

                $signLanguage = strtoupper(trim((string)($json['signLanguage'] ?? $json['sign_language'] ?? $lang)));
                if (!in_array($signLanguage, ['ESL', 'FSL'], true)) {
                    $signLanguage = $lang;
                }

                $filename     = basename($file);
                $relativePath = $folderName . '/' . $label . '/' . $filename;
                $diskPaths[]  = $relativePath;

                // Add to DB only if not already present
                $chk = mysqli_prepare($conn, 'SELECT id FROM gesture_recordings WHERE sample_path = ? LIMIT 1');
                mysqli_stmt_bind_param($chk, 's', $relativePath);
                mysqli_stmt_execute($chk);
                $res    = mysqli_stmt_get_result($chk);
                $exists = mysqli_fetch_assoc($res);
                mysqli_stmt_close($chk);

                if (!$exists) {
                    $dbGesture = save_gesture_word_to_db($label, $signLanguage);
                    save_gesture_to_language_dataset($label, $signLanguage);
                    $encoded = json_encode($json);
                    save_gesture_recording_to_db(
                        $dbGesture['id'],
                        $signLanguage,
                        $label,
                        count($json['frames'] ?? []),
                        $relativePath,
                        $encoded
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

    // Cascade: remove esl_signs with no matching gesture
    mysqli_query($conn,
        "DELETE FROM esl_signs
         WHERE sign_key NOT IN (
             SELECT DISTINCT word FROM gestures WHERE sign_language = 'ESL'
         )"
    );

    // Cascade: remove fsl_signs with no matching gesture
    mysqli_query($conn,
        "DELETE FROM fsl_signs
         WHERE sign_key NOT IN (
             SELECT DISTINCT word FROM gestures WHERE sign_language = 'FSL'
         )"
    );
}

function list_samples($defaultRoot) {
    global $conn;
    // Skip sync when no_sync is set (used by sign-to-text and voice pages for fast startup)
    if (!isset($_GET['no_sync'])) {
        // Disk is source of truth: sync disk → DB (adds new, deletes stale phantom rows)
        sync_disk_to_db($conn, $defaultRoot);
    }

    $folders = [
        'saved_gestures',
        'saved_gestures_fsl'
    ];

    $gestures = [];

    foreach ($folders as $folder) {
        $dirPath = realpath(__DIR__ . '/../../' . $folder);
        if ($dirPath === false) continue;

        foreach (glob($dirPath . '/*', GLOB_ONLYDIR) ?: [] as $labelDir) {
            $label = basename($labelDir);
            $files = glob($labelDir . '/sample_*.json') ?: [];
            
            if (!isset($gestures[$label])) {
                $gestures[$label] = [];
            }
            
            foreach ($files as $file) {
                $json = json_decode(file_get_contents($file), true);
                if (is_array($json)) {
                    $gestures[$label][] = [
                        'file' => $folder . '/' . $label . '/' . basename($file),
                        'label' => $json['label'] ?? $label,
                        'frames' => $json['frames'] ?? [],
                        'frameCount' => count($json['frames'] ?? []),
                        'createdAt' => $json['createdAt'] ?? null,
                        'signLanguage' => $json['signLanguage'] ?? $json['sign_language'] ?? 'ESL',
                    ];
                }
            }
        }
    }

    echo json_encode([
        'success' => true,
        'datasetRoot' => 'saved_gestures',
        'gestures' => $gestures,
    ]);
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

    // 1. Delete samples folder on disk from both ESL and FSL folders
    foreach (['saved_gestures', 'saved_gestures_fsl'] as $folder) {
        $labelDir = realpath(__DIR__ . '/../../' . $folder) . DIRECTORY_SEPARATOR . $label;
        if (is_dir($labelDir)) {
            foreach (glob($labelDir . '/*.json') ?: [] as $file) {
                unlink($file);
            }
            rmdir($labelDir);
        }
    }

    // 2. Delete database entries in MySQL
    require_once __DIR__ . '/../connect.php';
    
    $stmt = mysqli_prepare($conn, "SELECT id FROM gestures WHERE word = ? LIMIT 1");
    mysqli_stmt_bind_param($stmt, 's', $label);
    mysqli_stmt_execute($stmt);
    $res = mysqli_stmt_get_result($stmt);
    $row = mysqli_fetch_assoc($res);
    $gestureId = $row ? (int)$row['id'] : 0;
    mysqli_stmt_close($stmt);

    if ($gestureId > 0) {
        mysqli_query($conn, "DELETE FROM gesture_recordings WHERE gesture_id = $gestureId");
        mysqli_query($conn, "DELETE FROM gestures WHERE id = $gestureId");
    }
    
    mysqli_query($conn, "DELETE FROM esl_signs WHERE sign_key = '" . mysqli_real_escape_string($conn, $label) . "'");
    mysqli_query($conn, "DELETE FROM fsl_signs WHERE sign_key = '" . mysqli_real_escape_string($conn, $label) . "'");

    mysqli_close($conn);
    echo json_encode(['success' => true, 'message' => "Gesture '$label' successfully deleted."]);
    exit;
}

$label        = clean_label($body['label'] ?? $body['word'] ?? '');
$signLanguage = strtoupper(trim((string)($body['sign_language'] ?? $body['dataset'] ?? 'ESL')));
if (!in_array($signLanguage, ['ESL', 'FSL'], true)) {
    $signLanguage = 'ESL';
}
$frames       = $body['frames']      ?? null;
$videoBase64  = $body['video_base64'] ?? null;   // optional recorded video

if ($label === '') {
    fail('Gesture label is required');
}
if (!is_array($frames)) {
    fail('frames must be an array');
}
if (count($frames) < 1) {
    fail('At least one landmark frame is required');
}
if (count($frames) > 120) {
    fail('Too many frames in one sample; expected 20-40 frames', 413);
}

// ── Save landmark JSON to appropriate folder based on sign language ──
$targetFolder = ($signLanguage === 'FSL') ? 'saved_gestures_fsl' : 'saved_gestures';
$targetDatasetRoot = realpath(__DIR__ . '/../../' . $targetFolder);
if ($targetDatasetRoot === false) {
    $targetDatasetRoot = __DIR__ . '/../../' . $targetFolder;
    if (!mkdir($targetDatasetRoot, 0775, true)) {
        fail("Unable to create $targetFolder folder", 500);
    }
    $targetDatasetRoot = realpath($targetDatasetRoot);
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

$filename = 'sample_' . round(microtime(true) * 1000) . '_' . bin2hex(random_bytes(3)) . '.json';
$path     = $resolvedLabelDir . DIRECTORY_SEPARATOR . $filename;

$recording = [
    'label'       => $label,
    'createdAt'   => gmdate('c'),
    'frameCount'  => count($frames),
    'format'      => 'mediapipe_hands_landmarks_v2',
    'signLanguage'=> $signLanguage,
    'frames'      => $frames,
];

$encoded = json_encode($recording, JSON_PRETTY_PRINT);
if ($encoded === false || file_put_contents($path, $encoded, LOCK_EX) === false) {
    fail('Unable to write gesture sample', 500);
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
        $subFolder = ($signLanguage === 'FSL') ? 'fil' : 'en';
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

$relativePath  = $targetFolder . '/' . $label . '/' . $filename;
$dbGesture     = save_gesture_word_to_db($label, $signLanguage);
$dbDataset     = save_gesture_to_language_dataset($label, $signLanguage, $videoAssetRelative);
$dbRecordingId = save_gesture_recording_to_db(
    $dbGesture['id'],
    $signLanguage,
    $label,
    count($frames),
    $relativePath,
    $encoded
);

mysqli_close($conn);

echo json_encode([
    'success'          => true,
    'label'            => $label,
    'signLanguage'     => $signLanguage,
    'file'             => $relativePath,
    'videoAsset'       => $videoAssetRelative,
    'frameCount'       => count($frames),
    'dbGestureId'      => $dbGesture['id'],
    'dbGestureCreated' => $dbGesture['created'],
    'dbDatasetTable'   => $dbDataset['table'],
    'dbDatasetId'      => $dbDataset['id'],
    'dbRecordingId'    => $dbRecordingId,
    'labelSampleCount' => $priorSampleCount + 1,
    'videoSkipped'     => $videoSkipped,
    'videoTranscoded'  => $videoTranscoded,
    'videoExisting'    => $videoExisting,
]);
