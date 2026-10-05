<?php
// Avatar clips (avatar phase, docs/reports/2026-10-05-avatar-step1.md (c)/(e)).
// POST {action:"save", key, clip}: writes saved_gestures/<key>/avatar.json for an EXISTING sign.
// POST {action:"delete", key}: removes saved_gestures/<key>/avatar.json only.
// A sign's recognition samples and sign.json are never read for writing or touched here, and the
// clip is never written anywhere else. Clips are read by the kiosk as static files. No auth: demo
// system (docs/system/DEBT.md item 72). No DB access: "has a clip" is the file's existence.
header('Content-Type: application/json');

const AVATAR_CLIP_FORMAT = 'sk_avatar_clip_v1';
const AVATAR_CLIP_MAX_BYTES = 1048576;   // request body
const AVATAR_CLIP_MAX_FRAMES = 500;      // 20 s at 25 fps
const AVATAR_POSE_POINTS = 11;

require_once __DIR__ . '/sign_meta.php';

if (!function_exists('array_is_list')) {   // PHP 8.0 (XAMPP here is 8.0.30); built in from 8.1
    function array_is_list(array $a) {
        return $a === [] || array_keys($a) === range(0, count($a) - 1);
    }
}

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

function points_ok($list, $count, $width) {
    if ($list === null) {
        return true;
    }
    if (!is_array($list) || count($list) !== $count || !array_is_list($list)) {
        return false;
    }
    foreach ($list as $p) {
        if (!is_array($p) || count($p) !== $width || !array_is_list($p)) {
            return false;
        }
        foreach ($p as $i => $v) {
            if (!(is_int($v) || is_float($v)) || !is_finite((float)$v) || abs($v) > 100) {
                return false;
            }
            if ($i === 3 && ($v < 0 || $v > 1)) {   // pose visibility
                return false;
            }
        }
    }
    return true;
}

// Mirrors validateClip() in js/avatar-clip.js. Returns null when valid, else an error message.
// Note: json_decode(..., true) + json_encode turns an empty JSON object into [] (no field the
// player reads can be an empty object).
function avatar_clip_error($clip, $key) {
    if (!is_array($clip)) return 'clip must be an object';
    if (($clip['format'] ?? null) !== AVATAR_CLIP_FORMAT) return 'format must be ' . AVATAR_CLIP_FORMAT;
    if (($clip['key'] ?? null) !== $key) return 'clip key does not match';
    $fps = $clip['fps'] ?? null;
    if (!(is_int($fps) || is_float($fps)) || $fps < 1 || $fps > 60) return 'fps out of range';
    $video = $clip['video'] ?? null;
    $w = is_array($video) ? ($video['w'] ?? null) : null;
    $h = is_array($video) ? ($video['h'] ?? null) : null;
    if (!(is_int($w) || is_float($w)) || !(is_int($h) || is_float($h)) || $w <= 0 || $h <= 0) {
        return 'video size missing';
    }
    if (($clip['poseIdx'] ?? null) !== [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24]) return 'poseIdx must be the standard 11 points';
    $trim = $clip['trim'] ?? null;
    $ts = is_array($trim) ? ($trim['startMs'] ?? null) : null;
    $te = is_array($trim) ? ($trim['endMs'] ?? null) : null;
    if (!(is_int($ts) || is_float($ts)) || !(is_int($te) || is_float($te)) || $ts < 0 || $ts > $te) {
        return 'trim must have 0 <= startMs <= endMs';
    }
    // same unit as JS .length (UTF-16 code units); null is rejected as in validateClip()
    if (array_key_exists('signer', $clip) && (!is_string($clip['signer'])
        || strlen(mb_convert_encoding($clip['signer'], 'UTF-16LE', 'UTF-8')) / 2 > 80)) {
        return 'signer must be text of at most 80 characters';
    }
    $frames = $clip['frames'] ?? null;
    if (!is_array($frames) || !array_is_list($frames) || count($frames) < 1) return 'no frames';
    if (count($frames) > AVATAR_CLIP_MAX_FRAMES) return 'more than ' . AVATAR_CLIP_MAX_FRAMES . ' frames';
    $poses = 0;
    foreach ($frames as $i => $f) {
        if (!is_array($f) || !array_is_list($f) || count($f) !== 3) return "frame $i is not [pose, lh, rh]";
        if (!points_ok($f[0], AVATAR_POSE_POINTS, 4)) return "frame $i pose malformed";
        if (!points_ok($f[1], 21, 3) || !points_ok($f[2], 21, 3)) return "frame $i hand malformed";
        if ($f[0] !== null) $poses++;
    }
    if ($poses === 0) return 'no frame has a pose';
    return null;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST only', 405);
}

$raw = (string)file_get_contents('php://input', false, null, 0, AVATAR_CLIP_MAX_BYTES + 1);
if (strlen($raw) > AVATAR_CLIP_MAX_BYTES) {
    fail('Clip too large (max 1 MB)', 413);
}
$body = json_decode($raw, true);
if (!is_array($body)) {
    fail('Invalid JSON body');
}
$action = $body['action'] ?? null;
if ($action !== 'save' && $action !== 'delete') {
    fail('Unknown action');
}

// The key must name an existing sign: saved_gestures/<key>/sign.json.
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
$file = $keyDir . DIRECTORY_SEPARATOR . 'avatar.json';

if ($action === 'delete') {
    $existed = is_file($file);
    if ($existed && !unlink($file)) {
        fail('Unable to delete the clip', 500);
    }
    echo json_encode(['success' => true, 'key' => $key, 'deleted' => $existed]);
    exit;
}

$clip = $body['clip'] ?? null;
$error = avatar_clip_error($clip, $key);
if ($error !== null) {
    fail('Invalid clip: ' . $error);
}
// Only the format's own fields are stored.
$clip = array_intersect_key($clip, array_flip(['format', 'key', 'fps', 'video', 'trim', 'extractor', 'signer', 'poseIdx', 'frames']));
$clip['createdAt'] = gmdate('c');

$json = json_encode($clip, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if ($json === false) {
    fail('Unable to encode the clip', 500);
}
// Atomic: write a temp file next to the target, then rename over it.
$tmp = $keyDir . DIRECTORY_SEPARATOR . 'avatar.json.tmp-' . bin2hex(random_bytes(4));
if (file_put_contents($tmp, $json, LOCK_EX) === false) {
    @unlink($tmp);
    fail('Unable to write the clip', 500);
}
// On Windows a rename over a file Apache is serving at that moment can fail: retry once.
if (!rename($tmp, $file) && !(usleep(50000) || rename($tmp, $file))) {
    @unlink($tmp);
    fail('Unable to write the clip', 500);
}
echo json_encode(['success' => true, 'key' => $key, 'frames' => count($clip['frames']), 'bytes' => strlen($json)]);
