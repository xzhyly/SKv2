<?php
require_once __DIR__ . '/../php/connect.php';

function column_exists($conn, $table, $column) {
    $table = mysqli_real_escape_string($conn, $table);
    $column = mysqli_real_escape_string($conn, $column);
    $result = mysqli_query($conn, "SHOW COLUMNS FROM `$table` LIKE '$column'");
    return $result && mysqli_num_rows($result) > 0;
}

function ensure_gestures_columns($conn) {
    if (!column_exists($conn, 'gestures', 'sign_language')) {
        mysqli_query($conn, "ALTER TABLE gestures ADD COLUMN sign_language VARCHAR(10) NOT NULL DEFAULT 'ESL' AFTER word");
    }
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
    mysqli_query($conn, $sql);
    return $table;
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
    mysqli_query($conn, $sql);
    if (!column_exists($conn, 'gesture_recordings', 'sign_language')) {
        mysqli_query($conn, "ALTER TABLE gesture_recordings ADD COLUMN sign_language VARCHAR(10) NOT NULL DEFAULT 'ESL' AFTER gesture_id");
    }
}

function save_gesture_word_to_db($conn, $label, $signLanguage) {
    ensure_gestures_columns($conn);
    $stmt = mysqli_prepare(
        $conn,
        'INSERT INTO gestures (word, sign_language) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'
    );
    mysqli_stmt_bind_param($stmt, 'ss', $label, $signLanguage);
    mysqli_stmt_execute($stmt);
    $id = (int)mysqli_insert_id($conn);
    mysqli_stmt_close($stmt);

    if ($id === 0) {
        $sel = mysqli_prepare($conn, 'SELECT id FROM gestures WHERE word = ? AND sign_language = ? LIMIT 1');
        mysqli_stmt_bind_param($sel, 'ss', $label, $signLanguage);
        mysqli_stmt_execute($sel);
        $res = mysqli_stmt_get_result($sel);
        $row = mysqli_fetch_assoc($res);
        $id  = (int)($row['id'] ?? 0);
        mysqli_stmt_close($sel);
    }
    return ['id' => $id];
}

function save_gesture_to_language_dataset($conn, $label, $signLanguage) {
    $table = ensure_language_dataset_table($conn, $signLanguage);
    $displayText = str_replace('_', ' ', $label);

    $insert = mysqli_prepare(
        $conn,
        "INSERT INTO `$table` (sign_key, sign_label, text_value, description)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sign_label = VALUES(sign_label),
           text_value = VALUES(text_value),
           description = VALUES(description)"
    );
    $description = $signLanguage . ' user-added gesture sample.';
    mysqli_stmt_bind_param($insert, 'ssss', $label, $displayText, $displayText, $description);
    mysqli_stmt_execute($insert);
    mysqli_stmt_close($insert);
}

function save_gesture_recording_to_db($conn, $gestureId, $signLanguage, $label, $frameCount, $samplePath, $landmarkJson) {
    ensure_gesture_recordings_table($conn);
    $insert = mysqli_prepare(
        $conn,
        'INSERT INTO gesture_recordings (gesture_id, sign_language, gesture_type, sample_count, sample_path, landmark_json)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    mysqli_stmt_bind_param($insert, 'ississ', $gestureId, $signLanguage, $label, $frameCount, $samplePath, $landmarkJson);
    mysqli_stmt_execute($insert);
    mysqli_stmt_close($insert);
}

function sync_disk_to_db($conn, $datasetRoot) {
    ensure_gestures_columns($conn);
    ensure_language_dataset_table($conn, 'ESL');
    ensure_language_dataset_table($conn, 'FSL');
    ensure_gesture_recordings_table($conn);

    echo "Scanning directory: $datasetRoot\n";
    $dirs = glob($datasetRoot . '/*', GLOB_ONLYDIR);
    echo "Found " . count($dirs) . " categories.\n";

    foreach ($dirs ?: [] as $labelDir) {
        $label = basename($labelDir);
        $files = glob($labelDir . '/sample_*.json') ?: [];
        echo "Category '$label': " . count($files) . " samples.\n";
        foreach ($files as $file) {
            $json = json_decode(file_get_contents($file), true);
            if (!is_array($json)) continue;

            $signLanguage = strtoupper(trim((string)($json['signLanguage'] ?? $json['sign_language'] ?? 'ESL')));
            if (!in_array($signLanguage, ['ESL', 'FSL'], true)) {
                $signLanguage = 'ESL';
            }

            $filename = basename($file);
            $relativePath = 'saved_gestures/' . $label . '/' . $filename;
            
            $chk = mysqli_prepare($conn, "SELECT id FROM gesture_recordings WHERE sample_path = ? LIMIT 1");
            mysqli_stmt_bind_param($chk, 's', $relativePath);
            mysqli_stmt_execute($chk);
            $res = mysqli_stmt_get_result($chk);
            $exists = mysqli_fetch_assoc($res);
            mysqli_stmt_close($chk);

            if (!$exists) {
                $dbGesture = save_gesture_word_to_db($conn, $label, $signLanguage);
                save_gesture_to_language_dataset($conn, $label, $signLanguage);
                
                $encoded = json_encode($json);
                save_gesture_recording_to_db(
                    $conn,
                    $dbGesture['id'],
                    $signLanguage,
                    $label,
                    count($json['frames'] ?? []),
                    $relativePath,
                    $encoded
                );
                echo " -> Synced: $relativePath ($signLanguage)\n";
            }
        }
    }
}

echo "Running sync_disk_to_db...\n";
$datasetRoot = realpath(__DIR__ . '/../saved_gestures');
if ($datasetRoot === false) {
    $datasetRoot = __DIR__ . '/../saved_gestures';
}
sync_disk_to_db($conn, $datasetRoot);
echo "Sync complete!\n";
?>
