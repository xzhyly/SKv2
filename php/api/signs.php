<?php
// Signs list + edit. GET: every sign with set/texts/category/asset/sample count from the DB, plus
// whether it has an avatar clip on disk.
// POST {action:"update", key, set, textEn, textFil}: changes a sign's set and texts without touching
// its samples (sign.json is written first -- disk is the source of truth -- then the gestures row).
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../connect.php';
require_once __DIR__ . '/gesture_category.php';
require_once __DIR__ . '/sign_meta.php';

// PHP 8.0 mysqli returns false on failure, 8.1+ throws; both end up as a thrown RuntimeException.
function db_fail_check($conn, $ok, $stmtOrNull = null) {
    if ($ok) {
        return;
    }
    $errno = $stmtOrNull ? mysqli_stmt_errno($stmtOrNull) : mysqli_errno($conn);
    $error = $stmtOrNull ? mysqli_stmt_error($stmtOrNull) : mysqli_error($conn);
    throw new RuntimeException($error, $errno);
}

function sign_from_row($row) {
    return [
        'set'       => valid_sign_set($row['sign_language']) ?? 'ESL',
        'textEn'    => $row['text_en'],
        'textFil'   => $row['text_fil'],
    ];
}

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET' && $method !== 'POST') {
    fail('GET or POST only', 405);
}

try {
    ensure_gestures_columns($conn);

    if ($method === 'GET') {
        $result = mysqli_query(
            $conn,
            'SELECT g.label, g.sign_language, g.text_en, g.text_fil, g.category, g.asset_path,
                    COUNT(r.id) AS samples
             FROM gestures g LEFT JOIN gesture_recordings r ON r.gesture_id = g.id
             GROUP BY g.id'
        );
        db_fail_check($conn, $result !== false);
        $signs = [];
        // avatar: the sign has an avatar clip (saved_gestures/<key>/avatar.json; disk only, no DB column).
        $signsDir = __DIR__ . '/../../saved_gestures/';
        while ($row = mysqli_fetch_assoc($result)) {
            $signs[$row['label']] = sign_from_row($row) + [
                'category'  => $row['category'],
                'assetPath' => $row['asset_path'],
                'samples'   => (int)$row['samples'],
                'avatar'    => clean_label($row['label']) === $row['label'] && is_file($signsDir . $row['label'] . '/avatar.json'),
            ];
        }
        echo json_encode(['success' => true, 'signs' => (object)$signs]);
        exit;
    }

    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body)) {
        fail('Invalid JSON body');
    }
    if (($body['action'] ?? null) !== 'update') {
        fail('Unknown action');
    }

    $key = $body['key'] ?? null;
    if (!is_string($key) || $key === '' || clean_label($key) !== $key) {
        fail('Sign not found', 404);
    }
    $keyDir = realpath(__DIR__ . '/../../saved_gestures/' . $key);
    $root   = realpath(__DIR__ . '/../../saved_gestures');
    if ($keyDir === false || $root === false || strpos($keyDir, $root . DIRECTORY_SEPARATOR) !== 0
        || !glob($keyDir . '/sample_*.json')) {
        fail('Sign not found', 404);
    }

    $set = valid_sign_set($body['set'] ?? null);
    if ($set === null) {
        fail('set must be ESL, FSL or BOTH');
    }
    [$textEn, $err]  = sign_text_field($body['textEn'] ?? null, 'textEn');
    if ($err) fail($err);
    [$textFil, $err] = sign_text_field($body['textFil'] ?? null, 'textFil');
    if ($err) fail($err);

    // A text the set shows must be sent; a hidden text is stored if sent, else the stored one is kept.
    if (($set === 'ESL' || $set === 'BOTH') && $textEn === null) {
        fail('English text is required for this sign set');
    }
    if (($set === 'FSL' || $set === 'BOTH') && $textFil === null) {
        fail('Filipino text is required for this sign set');
    }

    $sel = mysqli_prepare($conn, 'SELECT id, text_en, text_fil FROM gestures WHERE label = ? LIMIT 1');
    db_fail_check($conn, $sel !== false);
    db_fail_check($conn, mysqli_stmt_bind_param($sel, 's', $key), $sel);
    db_fail_check($conn, mysqli_stmt_execute($sel), $sel);
    $stored = mysqli_fetch_assoc(mysqli_stmt_get_result($sel));
    mysqli_stmt_close($sel);

    $meta = read_sign_json($keyDir);
    $storedEn  = is_array($meta) && isset($meta['textEn'])  && is_string($meta['textEn'])  ? $meta['textEn']  : ($stored['text_en']  ?? null);
    $storedFil = is_array($meta) && isset($meta['textFil']) && is_string($meta['textFil']) ? $meta['textFil'] : ($stored['text_fil'] ?? null);
    $textEn  = $textEn  ?? $storedEn;
    $textFil = $textFil ?? $storedFil;

    if (!write_sign_json($keyDir, $key, $set, $textEn, $textFil)) {
        fail('Unable to write sign.json', 500);
    }

    if ($stored) {
        $upd = mysqli_prepare($conn, 'UPDATE gestures SET sign_language = ?, text_en = ?, text_fil = ? WHERE label = ?');
        db_fail_check($conn, $upd !== false);
        db_fail_check($conn, mysqli_stmt_bind_param($upd, 'ssss', $set, $textEn, $textFil, $key), $upd);
        db_fail_check($conn, mysqli_stmt_execute($upd), $upd);
        mysqli_stmt_close($upd);
    } else {
        $category = gesture_category($key);
        $ins = mysqli_prepare($conn, 'INSERT INTO gestures (label, sign_language, text_en, text_fil, category) VALUES (?, ?, ?, ?, ?)');
        db_fail_check($conn, $ins !== false);
        db_fail_check($conn, mysqli_stmt_bind_param($ins, 'sssss', $key, $set, $textEn, $textFil, $category), $ins);
        db_fail_check($conn, mysqli_stmt_execute($ins), $ins);
        mysqli_stmt_close($ins);
    }

    $back = mysqli_prepare($conn, 'SELECT sign_language, text_en, text_fil FROM gestures WHERE label = ? LIMIT 1');
    db_fail_check($conn, $back !== false);
    db_fail_check($conn, mysqli_stmt_bind_param($back, 's', $key), $back);
    db_fail_check($conn, mysqli_stmt_execute($back), $back);
    $row = mysqli_fetch_assoc(mysqli_stmt_get_result($back));
    mysqli_stmt_close($back);
    db_fail_check($conn, is_array($row));

    echo json_encode(['success' => true, 'sign' => ['key' => $key] + sign_from_row($row)]);
    exit;
} catch (Throwable $e) {
    fail('Database error: ' . $e->getMessage(), 500);
}
