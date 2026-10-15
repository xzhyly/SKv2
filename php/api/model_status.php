<?php
// Compact recognition model (compact-model phase): the state of models/knn_ESL.bin and knn_FSL.bin
// for Train Gestures' Compile status line. GET only, no DB access, read-only.
// Per model: exists, bytes, mtime, a header summary (only the first 12 + H bytes of the file are
// read), fingerprintNow (the fingerprint of the samples on disk now, php/api/knn_model_lib.php
// knn_fingerprint) and whether the file is stale:
//   missing    - no file
//   unreadable - the header cannot be read or fails the decoder's checks
//   format     - binary version/dtype, header formatVersion or rule (name 'sign-budget', version 1)
//                that this code does not build
//   data       - the header's fingerprint differs from fingerprintNow
// On the Pi stale is always false and staleReason null (the Pi lacks the bulk samples by design);
// every other field is still filled.
header('Content-Type: application/json');

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
    if ($method !== 'GET') {
        fail('GET only', 405);
    }

    $device = knn_device();
    $onPi = $device['device'] === 'pi';

    $fingerprints = knn_fingerprints(); // one walk of the dataset for both models
    $models = [];
    foreach (KNN_LANGS as $lang) {
        $file = knn_model_path($lang);
        clearstatcache(true, $file);
        $exists = is_file($file);
        $m = [
            'exists'         => $exists,
            'bytes'          => $exists ? @filesize($file) : null,
            'mtime'          => $exists ? @filemtime($file) : null,
            'header'         => null,
            'error'          => null,
            'fingerprintNow' => $fingerprints[$lang],
            'stale'          => false,
            'staleReason'    => null,
        ];
        $reason = null;
        if (!$exists) {
            $reason = 'missing';
        } else {
            [$h, $err, $code] = knn_read_header($file);
            if ($err !== null) {
                $m['error'] = $err;
                $reason = $code === 'format' ? 'format' : 'unreadable';
            } else {
                $rule = (isset($h['rule']) && is_array($h['rule'])) ? $h['rule'] : null;
                $m['header'] = [
                    'formatVersion' => $h['formatVersion'] ?? null,
                    'buildDate'     => $h['buildDate'] ?? null,
                    'builtOn'       => $h['builtOn'] ?? null,
                    'rule'          => $rule,
                    'rowCount'      => $h['rowCount'],
                    'sampleCount'   => $h['sampleCount'] ?? null,
                    'labelCount'    => count($h['labels']),
                    'fingerprint'   => $h['fingerprint'] ?? null,
                ];
                if (knn_json_int($h['formatVersion'] ?? null) !== KNN_FORMAT_VERSION
                    || ($rule['name'] ?? null) !== KNN_RULE_NAME
                    || knn_json_int($rule['version'] ?? null) !== KNN_RULE_VERSION) {
                    $reason = 'format';
                } elseif (($h['fingerprint'] ?? null) !== $m['fingerprintNow']) {
                    $reason = 'data';
                }
            }
        }
        if (!$onPi && $reason !== null) {
            $m['stale'] = true;
            $m['staleReason'] = $reason;
        }
        $models[$lang] = $m;
    }

    echo json_encode([
        'success'       => true,
        'device'        => $device['device'],
        'deviceSource'  => $device['source'],
        'machine'       => $device['machine'],
        'formatVersion' => KNN_FORMAT_VERSION,
        'models'        => $models,
    ], JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    fail('Server error: ' . $e->getMessage(), 500);
}
