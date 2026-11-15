<?php
// Whole-sign recognition model (seq-recognition phase, 2026-11-15): stores the file Train Gestures' Compile built
// in the browser (js/seq-features.js encode). POST ?lang=ESL|FSL, raw body = the file.
// Checked: 'SKSQ', the header (formatVersion 1, lang, dims, rowCount, labels) and the exact file size for that
// header; then written to models/seq_<LANG>.bin.tmp and renamed over models/seq_<LANG>.bin.
// Laptop only, like compile_model.php: on the Pi it answers 403. No DB access. No auth (docs/system/DEBT.md
// item 72, the same as compile_model.php). Same-origin only.
header('Content-Type: application/json');

const SEQ_UPLOAD_MAX_BYTES = 67108864; // 64 MB

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message], JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    require_once __DIR__ . '/knn_model_lib.php';

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        fail('POST only', 405);
    }
    $lang = $_GET['lang'] ?? null;
    if (!is_string($lang) || !in_array($lang, KNN_LANGS, true)) {
        fail('lang must be ESL or FSL');
    }
    if (knn_device()['device'] === 'pi') {
        fail('Build the model on the laptop, then copy models/seq_ESL.bin and models/seq_FSL.bin to the Pi.', 403);
    }
    $declared = $_SERVER['CONTENT_LENGTH'] ?? null;
    if (is_numeric($declared) && (int)$declared > SEQ_UPLOAD_MAX_BYTES) {
        fail('Model file is too large (max ' . SEQ_UPLOAD_MAX_BYTES . ' bytes)', 413);
    }
    $bytes = (string)@file_get_contents('php://input', false, null, 0, SEQ_UPLOAD_MAX_BYTES + 1);
    $size = strlen($bytes);
    if ($size === 0) {
        fail('Empty body: send the model file');
    }
    if ($size > SEQ_UPLOAD_MAX_BYTES) {
        fail('Model file is too large (max ' . SEQ_UPLOAD_MAX_BYTES . ' bytes)', 413);
    }

    if ($size < 8 || substr($bytes, 0, 4) !== 'SKSQ') {
        fail('seq model file: not an SKSQ file');
    }
    $hl = unpack('V', substr($bytes, 4, 4))[1];
    if (8 + $hl > $size) {
        fail('seq model file: header is cut off');
    }
    $header = json_decode(substr($bytes, 8, $hl), true);
    if (!is_array($header)) {
        fail('seq model file: header is not JSON');
    }
    $dims = $header['dims'] ?? null;
    $rows = $header['rowCount'] ?? null;
    $labels = $header['labels'] ?? null;
    if (($header['formatVersion'] ?? null) !== 1 || !is_int($dims) || $dims < 1 || $dims > 4096
        || !is_int($rows) || $rows < 2 || !is_array($labels) || count($labels) < 2 || count($labels) > 65535) {
        fail('seq model file: bad header');
    }
    if (($header['lang'] ?? null) !== $lang) {
        fail('seq model file: it is for ' . json_encode($header['lang'] ?? null) . ', not ' . $lang);
    }
    // The same layout as js/seq-features.js encode().
    $off1 = 8 + $hl;
    $off1 += (4 - $off1 % 4) % 4;
    $off2 = $off1 + $rows * 2;
    $off2 += (4 - $off2 % 4) % 4;
    $want = $off2 + $dims * 8 + $rows * $dims * 4;
    if ($want !== $size) {
        fail('seq model file: ' . $size . ' bytes, but its header needs ' . $want);
    }

    $dir = knn_models_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        fail('Unable to create the models folder', 500);
    }
    $file = $dir . DIRECTORY_SEPARATOR . 'seq_' . $lang . '.bin';
    $tmp = $file . '.tmp';
    if (@file_put_contents($tmp, $bytes, LOCK_EX) !== $size) {
        @unlink($tmp);
        fail('Unable to write the model file', 500);
    }
    for ($try = 0; !@rename($tmp, $file); $try++) {   // Windows: a rename over a file being served can fail
        if ($try >= 4) {
            @unlink($tmp);
            fail('Unable to write the model file', 500);
        }
        usleep(50000);
    }
    clearstatcache(true, $file);
    echo json_encode([
        'success'  => true,
        'lang'     => $lang,
        'bytes'    => $size,
        'rowCount' => $rows,
        'labels'   => count($labels),
        'mtime'    => @filemtime($file),
    ], JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    fail('Server error: ' . $e->getMessage(), 500);
}
