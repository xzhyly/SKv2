<?php
// Sign audio upload/delete (talk-turns-audio phase, docs/superpowers/specs/2026-10-19-talk-turns-audio-design.md
// section 5). Admin only (sk_require_admin, 403 otherwise). Reading is public: the files are static
// (saved_gestures/<key>/audio_<lang>.<ext>, listed by php/api/signs.php GET `audio`).
//
// POST multipart/form-data {action:"upload", key, lang: en|fil, file}
//      -> {success, key, audio:{en, fil}}. webm (mic recording), mp3, m4a, wav or ogg, at most 2 MB;
//         the format is read from the file's first bytes, not trusted from its name. Replaces the
//         language's previous file (any extension). Letters take English audio only.
// POST JSON {action:"delete", key, lang} -> {success, key, deleted, audio:{en, fil}}
// The sign must exist (saved_gestures/<key>/sign.json). Samples, sign.json and avatar.json are never touched.
header('Content-Type: application/json');

require_once __DIR__ . '/../connect.php';
require_once __DIR__ . '/../session.php';
require_once __DIR__ . '/sign_meta.php';
require_once __DIR__ . '/gesture_category.php';
require_once __DIR__ . '/sign_audio_lib.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST only', 405);
}
sk_require_admin($conn);

$isJson = stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === 0;
$body = $isJson ? json_decode((string)file_get_contents('php://input'), true) : $_POST;
if (!is_array($body)) {
    fail('Invalid request body');
}
$action = $body['action'] ?? null;
if ($action !== 'upload' && $action !== 'delete') {
    fail('Unknown action');
}

$key = $body['key'] ?? null;
if (!is_string($key) || $key === '' || clean_label($key) !== $key) {
    fail('Sign not found', 404);
}
$root = realpath(__DIR__ . '/../../saved_gestures');
$keyDir = realpath(__DIR__ . '/../../saved_gestures/' . $key);
if ($root === false || $keyDir === false || strpos($keyDir, $root . DIRECTORY_SEPARATOR) !== 0
    || !is_file($keyDir . DIRECTORY_SEPARATOR . 'sign.json')) {
    fail('Sign not found', 404);
}
$lang = $body['lang'] ?? null;
if (!in_array($lang, SIGN_AUDIO_LANGS, true)) {
    fail('lang must be en or fil');
}

// Removes the language's file(s); -> how many were removed.
function remove_audio($keyDir, $lang, $keepName = null) {
    $n = 0;
    foreach (SIGN_AUDIO_EXTS as $ext) {
        $name = 'audio_' . $lang . '.' . $ext;
        $path = $keyDir . DIRECTORY_SEPARATOR . $name;
        if ($name !== $keepName && is_file($path)) {
            if (!unlink($path)) {
                fail('Unable to delete ' . $name, 500);
            }
            $n++;
        }
    }
    return $n;
}

if ($action === 'delete') {
    $deleted = remove_audio($keyDir, $lang);
    echo json_encode(['success' => true, 'key' => $key, 'deleted' => $deleted > 0, 'audio' => sign_audio_urls($key, $keyDir)]);
    exit;
}

// upload: letters are English only (stored category, else the key's heuristic).
if ($lang === 'fil') {
    $category = null;
    $stmt = mysqli_prepare($conn, 'SELECT category FROM gestures WHERE label = ? LIMIT 1');
    if ($stmt) {
        mysqli_stmt_bind_param($stmt, 's', $key);
        mysqli_stmt_execute($stmt);
        $row = mysqli_fetch_assoc(mysqli_stmt_get_result($stmt));
        mysqli_stmt_close($stmt);
        $category = $row['category'] ?? null;
    }
    if (($category ?: gesture_category($key)) === 'letter') {
        fail('Letters take English audio only');
    }
}

$file = $_FILES['file'] ?? null;
if (!is_array($file) || !isset($file['error']) || is_array($file['error'])) {
    fail('No audio file sent');
}
if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE
    || ($file['error'] === UPLOAD_ERR_OK && $file['size'] > SIGN_AUDIO_MAX_BYTES)) {
    fail('The audio file is larger than 2 MB', 413);
}
if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name']) || $file['size'] < 1) {
    fail('No audio file sent');
}
$ext = sign_audio_sniff($file['tmp_name']);
if ($ext === null) {
    fail('Not an audio file (webm, mp3, m4a, wav or ogg)');
}

$name = 'audio_' . $lang . '.' . $ext;
$tmp = $keyDir . DIRECTORY_SEPARATOR . $name . '.tmp-' . bin2hex(random_bytes(4));
if (!move_uploaded_file($file['tmp_name'], $tmp)) {
    fail('Unable to save the audio file', 500);
}
if (!rename($tmp, $keyDir . DIRECTORY_SEPARATOR . $name)) {
    @unlink($tmp);
    fail('Unable to save the audio file', 500);
}
remove_audio($keyDir, $lang, $name);
clearstatcache();
echo json_encode(['success' => true, 'key' => $key, 'audio' => sign_audio_urls($key, $keyDir)]);
