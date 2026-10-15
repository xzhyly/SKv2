<?php
// Compact recognition model (compact-model phase): shared helpers for compile_model.php and
// model_status.php. No HTTP entry point, no output, no DB access -- require_once only.
// Spec: the model file layout, fingerprint and device rules in .git/sdd/cm-plan.md ("Shared
// definitions"); the browser side is js/knn-compile.js (encode/decode/fingerprintText).
//
// Model file models/knn_<LANG>.bin (little-endian):
//   0-3 "SKKN" | 4-5 uint16 version 1 | 6-7 uint16 dtype 1 (Float32) | 8-11 uint32 header length H
//   | 12..12+H UTF-8 JSON header | zero padding to a multiple of 4 | rowCount * 126 Float32.

require_once __DIR__ . '/sign_meta.php';

const KNN_MAGIC = 'SKKN';
const KNN_FORMAT_VERSION = 1;
const KNN_DTYPE_F32 = 1;
const KNN_DIMS = 126;
const KNN_MIN_HEADER_BYTES = 2;
const KNN_MAX_HEADER_BYTES = 4194304;
const KNN_RULE_NAME = 'sign-budget';
const KNN_RULE_VERSION = 1;
const KNN_LANGS = ['ESL', 'FSL'];
const KNN_PI_WARNING = 'Build the model on the laptop, then copy models/knn_ESL.bin and models/knn_FSL.bin to the Pi.';

function knn_repo_root() {
    return dirname(__DIR__, 2);
}

// <repo>/models, or SK_MODELS_DIR (tests only).
function knn_models_dir() {
    $env = getenv('SK_MODELS_DIR');
    return ($env !== false && $env !== '') ? rtrim($env, '/\\') : knn_repo_root() . DIRECTORY_SEPARATOR . 'models';
}

// The folder that holds saved_gestures/ and saved_gestures_fsl/: <repo>, or SK_DATASET_ROOT (tests only).
function knn_dataset_root() {
    $env = getenv('SK_DATASET_ROOT');
    return ($env !== false && $env !== '') ? rtrim($env, '/\\') : knn_repo_root();
}

// <repo>/config, or SK_CONFIG_DIR (tests only).
function knn_config_dir() {
    $env = getenv('SK_CONFIG_DIR');
    return ($env !== false && $env !== '') ? rtrim($env, '/\\') : knn_repo_root() . DIRECTORY_SEPARATOR . 'config';
}

function knn_model_path($lang) {
    return knn_models_dir() . DIRECTORY_SEPARATOR . 'knn_' . $lang . '.bin';
}

// Q5: config/device.txt ("pi" or "laptop", trimmed, any case) wins; any other content is ignored.
// Otherwise php_uname('m'): aarch64 / arm* = the Pi, anything else = the laptop.
function knn_device() {
    $machine = php_uname('m');
    $file = knn_config_dir() . DIRECTORY_SEPARATOR . 'device.txt';
    if (is_file($file)) {
        $raw = @file_get_contents($file, false, null, 0, 64);
        $value = $raw === false ? '' : strtolower(trim($raw));
        if ($value === 'pi' || $value === 'laptop') {
            return ['device' => $value, 'source' => 'override', 'machine' => $machine];
        }
    }
    $device = preg_match('/^(aarch64|arm)/i', $machine) === 1 ? 'pi' : 'laptop';
    return ['device' => $device, 'source' => 'uname', 'machine' => $machine];
}

// Membership (plan, Q4): model ESL = ESL + BOTH, model FSL = FSL + BOTH, start/stop in both.
function knn_in_model($lang, $label, $set) {
    return $set === $lang || $set === 'BOTH' || $label === 'start' || $label === 'stop';
}

// The fingerprint lines `label|set|file` of model $lang, from disk, with the same walk as
// list_samples() (php/api/save_gesture.php): saved_gestures then saved_gestures_fsl, every label
// folder, derive_sign() of the FIRST folder that has the label (= the listing's signs[label].set,
// which is what KnnCompile.fingerprintText uses: the listing always has a sign for every label), and
// every sample_*.json in it. Sample files are never read here (derive_sign's own fallback reads the
// first sample only when sign.json is missing or invalid). Sorted byte-wise = JS default sort for
// these ASCII lines.
// Known edge: the listing skips a sample file that is not valid JSON; this walk counts it, so the
// model then reads "out of date" until that file is fixed or removed.
// One walk serves both models: ['ESL' => lines, 'FSL' => lines].
function knn_fingerprint_lines_all() {
    $root = knn_dataset_root();
    $setOf = [];
    $lines = ['ESL' => [], 'FSL' => []];
    foreach (['saved_gestures', 'saved_gestures_fsl'] as $folder) {
        $dirPath = realpath($root . DIRECTORY_SEPARATOR . $folder);
        if ($dirPath === false) continue;
        foreach (glob($dirPath . '/*', GLOB_ONLYDIR) ?: [] as $labelDir) {
            $label = basename($labelDir);
            if (!isset($setOf[$label])) {
                $setOf[$label] = derive_sign($folder, $label, $labelDir)['set'];
            }
            $set = $setOf[$label];
            $langs = array_values(array_filter(KNN_LANGS, function ($lang) use ($label, $set) {
                return knn_in_model($lang, $label, $set);
            }));
            if (!$langs) continue;
            foreach (knn_sample_names($labelDir) as $name) {
                $line = $label . '|' . $set . '|' . $folder . '/' . $label . '/' . $name;
                foreach ($langs as $lang) $lines[$lang][] = $line;
            }
        }
    }
    foreach ($lines as &$list) sort($list, SORT_STRING);
    unset($list);
    return $lines;
}

// The basenames glob($labelDir . '/sample_*.json') returns. PHP's glob() on Windows stats every
// match (about 80 us per file here), so a plain directory read with the same case-sensitive match is
// used instead -- the same names (checked against glob() in tests/compact-model/
// php-endpoints.test.mjs), about 8x faster. glob() itself is kept for a folder path that contains a
// glob metacharacter, where glob() reads it as a pattern.
function knn_sample_names($labelDir) {
    if (strpbrk($labelDir, '*?[') !== false) {
        return array_map('basename', glob($labelDir . '/sample_*.json') ?: []);
    }
    $names = @scandir($labelDir);
    if ($names === false) return [];
    return array_values(array_filter($names, function ($name) {
        return preg_match('/^sample_.*\.json\z/s', $name) === 1;
    }));
}

function knn_fingerprint_lines($lang) {
    return knn_fingerprint_lines_all()[$lang];
}

function knn_fingerprint($lang) {
    return hash('sha256', implode("\n", knn_fingerprint_lines($lang)));
}

// ['ESL' => hex, 'FSL' => hex] from one walk.
function knn_fingerprints() {
    $out = [];
    foreach (knn_fingerprint_lines_all() as $lang => $lines) {
        $out[$lang] = hash('sha256', implode("\n", $lines));
    }
    return $out;
}

// A JSON number that is an integer in JS terms (Number.isInteger): 2 or 2.0 -> 2; else null.
function knn_json_int($v) {
    if (is_int($v)) return $v;
    if (is_float($v) && is_finite($v) && floor($v) === $v && abs($v) <= 9007199254740991) return (int)$v;
    return null;
}

// The 12-byte prefix: [headerLength, null] or [null, error, code] (code 'format' for a version or
// dtype this reader does not support, else 'unreadable').
function knn_check_prefix($prefix) {
    if (strlen($prefix) < 12) {
        return [null, 'knn model file: too short (' . strlen($prefix) . ' bytes)', 'unreadable'];
    }
    if (substr($prefix, 0, 4) !== KNN_MAGIC) {
        return [null, 'knn model file: bad magic (not a model file)', 'unreadable'];
    }
    $p = unpack('vversion/vdtype/Vhl', substr($prefix, 4, 8));
    if ($p['version'] !== KNN_FORMAT_VERSION) {
        return [null, 'knn model file: format version ' . $p['version'] . ' is not supported (expected 1)', 'format'];
    }
    if ($p['dtype'] !== KNN_DTYPE_F32) {
        return [null, 'knn model file: dtype ' . $p['dtype'] . ' is not supported (expected 1 = Float32)', 'format'];
    }
    if ($p['hl'] < KNN_MIN_HEADER_BYTES || $p['hl'] > KNN_MAX_HEADER_BYTES) {
        return [null, 'knn model file: header length ' . $p['hl'] . ' is out of range', 'unreadable'];
    }
    return [$p['hl'], null, null];
}

// Header JSON text -> [header (assoc array), null] or [null, error]. Same checks as
// KnnCompile.checkHeader (js/knn-compile.js): dims 126, lang ESL|FSL, labels an array of objects
// with a unique non-empty string key (not "__proto__") and non-negative integer rows that add up to
// a non-negative integer rowCount.
function knn_parse_header($json) {
    if (strncmp($json, "\xEF\xBB\xBF", 3) === 0) {
        $json = substr($json, 3); // TextDecoder drops a BOM too
    }
    $h = json_decode($json); // objects as stdClass: "{}" stays an object, "[]" stays an array
    if (json_last_error() !== JSON_ERROR_NONE) {
        return [null, 'knn model file: header is not valid JSON (' . json_last_error_msg() . ')'];
    }
    if (!($h instanceof stdClass)) {
        return [null, 'knn model file: header is not a JSON object'];
    }
    if (knn_json_int($h->dims ?? null) !== KNN_DIMS) {
        return [null, 'knn model file: dims must be ' . KNN_DIMS . ', got ' . json_encode($h->dims ?? null)];
    }
    $lang = $h->lang ?? null;
    if (!is_string($lang) || !in_array($lang, KNN_LANGS, true)) {
        return [null, 'knn model file: lang must be ESL or FSL, got ' . json_encode($lang)];
    }
    if (!isset($h->labels) || !is_array($h->labels)) {
        return [null, 'knn model file: labels is not an array'];
    }
    $rowCount = knn_json_int($h->rowCount ?? null);
    if ($rowCount === null || $rowCount < 0) {
        return [null, 'knn model file: rowCount is not a non-negative integer'];
    }
    $seen = [];
    $sum = 0;
    foreach ($h->labels as $i => $L) {
        $key = ($L instanceof stdClass) ? ($L->key ?? null) : null;
        if (!is_string($key) || $key === '') {
            return [null, 'knn model file: label ' . $i . ' has no key'];
        }
        if ($key === '__proto__') {
            return [null, 'knn model file: label key "__proto__" is not allowed'];
        }
        if (isset($seen[$key])) {
            return [null, 'knn model file: duplicate label "' . $key . '"'];
        }
        $seen[$key] = true;
        $rows = knn_json_int($L->rows ?? null);
        if ($rows === null || $rows < 0) {
            return [null, 'knn model file: label "' . $key . '" rows is not a non-negative integer'];
        }
        $sum += $rows;
    }
    if ($sum !== $rowCount) {
        return [null, 'knn model file: label rows add up to ' . $sum . ', rowCount is ' . $rowCount];
    }
    $assoc = json_decode($json, true);
    $assoc['rowCount'] = $rowCount;
    return [$assoc, null];
}

// First byte of the Float32 body for a header of $hl bytes.
function knn_body_start($hl) {
    return (int)(ceil((12 + $hl) / 4) * 4);
}

function knn_check_length($totalBytes, $hl, $rowCount) {
    $body = $totalBytes - knn_body_start($hl);
    $want = $rowCount * KNN_DIMS * 4;
    if ($body !== $want) {
        return 'knn model file: body is ' . $body . ' bytes, expected ' . $want . ' for ' . $rowCount . ' rows';
    }
    return null;
}

// Reads only the first 12 + H bytes of a model file (plus its size from the file system) and
// returns [header, null, null] or [null, error, code] (code 'format' | 'unreadable'). The checks are
// the decoder's, except that the Float32 values themselves are never read.
function knn_read_header($path) {
    clearstatcache(true, $path);
    $size = @filesize($path);
    $fh = @fopen($path, 'rb');
    if ($fh === false || $size === false) {
        if ($fh !== false) fclose($fh);
        return [null, 'knn model file: cannot be opened', 'unreadable'];
    }
    $prefix = (string)fread($fh, 12);
    [$hl, $err, $code] = knn_check_prefix($prefix);
    if ($err !== null) {
        fclose($fh);
        return [null, $err, $code];
    }
    if (12 + $hl > $size) {
        fclose($fh);
        return [null, 'knn model file: header length ' . $hl . ' runs past the end of the file', 'unreadable'];
    }
    $json = '';
    while (strlen($json) < $hl && !feof($fh)) {
        $chunk = fread($fh, $hl - strlen($json));
        if ($chunk === false || $chunk === '') break;
        $json .= $chunk;
    }
    fclose($fh);
    if (strlen($json) !== $hl) {
        return [null, 'knn model file: header could not be read', 'unreadable'];
    }
    [$header, $err] = knn_parse_header($json);
    if ($err !== null) {
        return [null, $err, 'unreadable'];
    }
    $err = knn_check_length($size, $hl, $header['rowCount']);
    if ($err !== null) {
        return [null, $err, 'unreadable'];
    }
    return [$header, null, null];
}

// Full check of an uploaded model file for model $lang: returns [header, null] or [null, error].
function knn_validate_bytes($bytes, $lang) {
    [$hl, $err] = knn_check_prefix(substr($bytes, 0, 12));
    if ($err !== null) {
        return [null, $err];
    }
    if (12 + $hl > strlen($bytes)) {
        return [null, 'knn model file: header length ' . $hl . ' runs past the end of the file'];
    }
    [$header, $err] = knn_parse_header(substr($bytes, 12, $hl));
    if ($err !== null) {
        return [null, $err];
    }
    if ($header['lang'] !== $lang) {
        return [null, 'knn model file: lang is ' . $header['lang'] . ', expected ' . $lang];
    }
    $err = knn_check_length(strlen($bytes), $hl, $header['rowCount']);
    if ($err !== null) {
        return [null, $err];
    }
    return [$header, null];
}
