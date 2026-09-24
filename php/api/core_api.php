<?php
// api.php
// Single entry-point for all Sining Kamay DB operations.
// Place this file in the same folder as connect.php.
//
// Called via POST with a JSON body:  { "action": "save_recording", ... }

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'POST only']); exit; }

require_once __DIR__ . '/../connect.php'; // provides $conn

$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);

if (!$body || empty($body['action'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing action']);
    exit;
}

$action = $body['action'];

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function ok($data = [])  { echo json_encode(['success' => true]  + $data); exit; }
function fail($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}
function q($conn, $sql, $types, ...$vals) {
    $stmt = mysqli_prepare($conn, $sql);
    if (!$stmt) fail('Prepare failed: ' . mysqli_error($conn), 500);
    if ($types) mysqli_stmt_bind_param($stmt, $types, ...$vals);
    if (!mysqli_stmt_execute($stmt)) fail('Execute failed: ' . mysqli_stmt_error($stmt), 500);
    return $stmt;
}

// ─────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────
switch ($action) {

    // ── Save a recording session ─────────────────────────────
    // Fired: camera-translator.html → stopRecording()
    // Fields: gesture ('start'|'stop'), sampleCount (int), thumbnailDataUrl (base64 or null)
    case 'save_recording': {
        $gesture   = trim($body['gesture']          ?? '');
        $count     = (int)($body['sampleCount']     ?? 0);
        $thumb     = $body['thumbnailDataUrl']       ?? null;

        if ($gesture === '') fail('gesture is required');
        if ($count < 1) fail('sampleCount must be >= 1');

        $stmt = q($conn,
            'INSERT INTO gesture_recordings (gesture_type, sample_count, thumbnail) VALUES (?,?,?)',
            'sis', $gesture, $count, $thumb
        );
        ok(['id' => mysqli_insert_id($conn), 'message' => "Saved $count $gesture samples"]);
    }

    // ── Get all recordings ───────────────────────────────────
    case 'get_recordings': {
        $stmt = q($conn,
            'SELECT id, gesture_type AS gesture, sample_count AS sampleCount,
                    thumbnail AS thumbnailDataUrl, recorded_at AS timestamp
               FROM gesture_recordings
              ORDER BY recorded_at DESC',
            ''
        );
        $rows = mysqli_fetch_all(mysqli_stmt_get_result($stmt), MYSQLI_ASSOC);
        ok(['data' => $rows]);
    }

    // ── Delete one recording ─────────────────────────────────
    case 'delete_recording': {
        $id = (int)($body['id'] ?? 0);
        if ($id < 1) fail('Invalid id');
        q($conn, 'DELETE FROM gesture_recordings WHERE id = ?', 'i', $id);
        ok();
    }

    // ── Save a translation event ─────────────────────────────
    // Fired: camera-translator.html → startLivePrediction() on gesture detect
    // Fields: word (string), language ('en-US'|'fil-PH'), fullTranscript (string)
    case 'save_translation': {
        $word       = trim($body['word']           ?? '');
        $language   = trim($body['language']       ?? 'en-US');
        $transcript = trim($body['fullTranscript'] ?? '');

        if ($word === '') fail('word is required');

        $stmt = q($conn,
            'INSERT INTO translations (detected_word, language, full_sentence) VALUES (?,?,?)',
            'sss', $word, $language, $transcript
        );
        ok(['id' => mysqli_insert_id($conn), 'message' => "Translation \"$word\" saved"]);
    }

    // ── Get all translations ─────────────────────────────────
    case 'get_translations': {
        $stmt = q($conn,
            'SELECT id, detected_word AS word, language, full_sentence AS fullTranscript,
                    translated_at AS timestamp
               FROM translations
              ORDER BY translated_at DESC',
            ''
        );
        $rows = mysqli_fetch_all(mysqli_stmt_get_result($stmt), MYSQLI_ASSOC);
        ok(['data' => $rows]);
    }

    // ── Delete one translation ───────────────────────────────
    case 'delete_translation': {
        $id = (int)($body['id'] ?? 0);
        if ($id < 1) fail('Invalid id');
        q($conn, 'DELETE FROM translations WHERE id = ?', 'i', $id);
        ok();
    }

    // ── Clear an entire store (table) ────────────────────────
    // storeName: 'recordings' | 'translations'
    case 'clear_store': {
        $map = [
            'recordings'    => 'gesture_recordings',
            'translations'  => 'translations',
        ];
        $store = trim($body['storeName'] ?? '');
        if (!isset($map[$store])) fail('Unknown store: ' . $store);
        $table = $map[$store];
        mysqli_query($conn, "TRUNCATE TABLE `$table`");
        ok(['message' => "Table $table cleared"]);
    }

    // ── Stats ────────────────────────────────────────────────
    case 'get_stats': {
        $counts = [];
        foreach (['gesture_recordings' => 'totalRecordings',
                  'translations'       => 'totalTranslations'] as $tbl => $key) {
            $r = mysqli_query($conn, "SELECT COUNT(*) AS n FROM `$tbl`");
            $counts[$key] = (int)mysqli_fetch_assoc($r)['n'];
        }
        ok($counts);
    }

    default:
        fail("Unknown action: $action");
}

mysqli_close($conn);
