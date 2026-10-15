<?php
// Compact recognition model (compact-model phase): stores a model file built in the browser.
// POST ?lang=ESL|FSL, raw body = the file (Content-Type application/octet-stream), built by
// js/knn-compile.js (buildModel + encode) on Train Gestures' Compile. The file is fully checked
// (php/api/knn_model_lib.php knn_validate_bytes), written to models/knn_<LANG>.bin.tmp and renamed
// over models/knn_<LANG>.bin, so a reader never sees a half-written file.
// Laptop only: on the Pi (knn_device()) it answers 403 with the Pi warning. No DB access. No auth:
// demo system (docs/system/DEBT.md item 72). Same-origin only (no CORS header).
header('Content-Type: application/json');

const KNN_UPLOAD_MAX_BYTES = 33554432; // 32 MB

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message], JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    require_once __DIR__ . '/knn_model_lib.php';

    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
    if ($method !== 'POST') {
        fail('POST only', 405);
    }

    $lang = $_GET['lang'] ?? null;
    if (!is_string($lang) || !in_array($lang, KNN_LANGS, true)) {
        fail('lang must be ESL or FSL');
    }

    if (knn_device()['device'] === 'pi') {
        fail(KNN_PI_WARNING, 403);
    }

    // Refuse an announced oversize body before reading it.
    $declared = $_SERVER['CONTENT_LENGTH'] ?? null;
    if (is_numeric($declared) && (int)$declared > KNN_UPLOAD_MAX_BYTES) {
        fail('Model file is too large (max 33554432 bytes)', 413);
    }
    $bytes = (string)@file_get_contents('php://input', false, null, 0, KNN_UPLOAD_MAX_BYTES + 1);
    if ($bytes === '') {
        fail('Empty body: send the model file');
    }
    if (strlen($bytes) > KNN_UPLOAD_MAX_BYTES) {
        fail('Model file is too large (max 33554432 bytes)', 413);
    }

    [$header, $err] = knn_validate_bytes($bytes, $lang);
    if ($err !== null) {
        fail($err);
    }

    $dir = knn_models_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        fail('Unable to create the models folder', 500);
    }
    $file = knn_model_path($lang);
    $tmp = $file . '.tmp';
    if (@file_put_contents($tmp, $bytes, LOCK_EX) !== strlen($bytes)) {
        @unlink($tmp);
        fail('Unable to write the model file', 500);
    }
    // On Windows a rename over a file Apache is serving at that moment can fail: retry a few times.
    for ($try = 0; !@rename($tmp, $file); $try++) {
        if ($try >= 4) {
            @unlink($tmp);
            fail('Unable to write the model file', 500);
        }
        usleep(50000);
    }
    clearstatcache(true, $file);

    $fingerprint = $header['fingerprint'] ?? null;
    $fingerprintNow = knn_fingerprint($lang);
    echo json_encode([
        'success'        => true,
        'lang'           => $lang,
        'bytes'          => strlen($bytes),
        'rowCount'       => $header['rowCount'],
        'labels'         => count($header['labels']),
        'sampleCount'    => $header['sampleCount'] ?? null,
        'buildDate'      => $header['buildDate'] ?? null,
        'fingerprint'    => $fingerprint,
        'fingerprintNow' => $fingerprintNow,
        'upToDate'       => is_string($fingerprint) && $fingerprint === $fingerprintNow,
        'mtime'          => @filemtime($file),
    ], JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    fail('Server error: ' . $e->getMessage(), 500);
}
