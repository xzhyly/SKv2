<?php
// Admin Settings -> System (pi-power phase, 2026-10-21): shut down / restart the Raspberry Pi and set
// the speaker volume, because the kiosk has no keyboard or mouse. Admin only (403 otherwise).
//
// POST JSON {action:"status"}     -> {success, isPi, canPower, canVolume, maxVolume}
// POST JSON {action:"shutdown"}   -> {success, action}; the Pi powers off ~3 s later
// POST JSON {action:"reboot"}     -> {success, action}; the Pi reboots ~3 s later
// POST JSON {action:"get_volume"} -> {success, volume, muted, maxVolume}
// POST JSON {action:"set_volume", value} -> {success, volume, maxVolume}; value 0..1, clamped to maxVolume
//
// Pi = Linux and /proc/device-tree/model contains "Raspberry Pi" (config/device.txt is NOT used here:
// a laptop must never try to power off). On anything else every action but "status" answers 409 and
// nothing is run. The commands are fixed strings; the only value passed on is the volume, re-formatted
// here as "%.2f". They work only with the sudoers rule and /usr/local/bin/sk-volume that
// tools/pi/pi-setup.sh installs (tools/pi/README.md "Admin power and volume buttons").
// Every request is logged to the PHP error log as "[sk-power] user=... action=...".
header('Content-Type: application/json');
header('Cache-Control: no-store');

require_once __DIR__ . '/../connect.php';
require_once __DIR__ . '/../session.php';

const SK_POWER_CMDS = [
    'shutdown' => '/usr/bin/systemctl poweroff',
    'reboot'   => '/usr/bin/systemctl reboot',
];
const SK_VOLUME_BIN = '/usr/local/bin/sk-volume';
const SK_DEFAULT_MAX_VOLUME = 0.8;

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

function is_pi() {
    if (PHP_OS_FAMILY !== 'Linux' || !is_readable('/proc/device-tree/model')) {
        return false;
    }
    $model = @file_get_contents('/proc/device-tree/model', false, null, 0, 256);
    return $model !== false && strpos($model, 'Raspberry Pi') !== false;
}

// MAX_VOLUME="0.8" from tools/pi/sk-audio.sh (the LCDs brown out above it), else 0.8.
function max_volume() {
    $file = __DIR__ . '/../../tools/pi/sk-audio.sh';
    $text = is_readable($file) ? (string)@file_get_contents($file) : '';
    if (preg_match('/^MAX_VOLUME="?([0-9]*\.?[0-9]+)"?/m', $text, $m)) {
        $v = (float)$m[1];
        if ($v > 0 && $v <= 1) return $v;
    }
    return SK_DEFAULT_MAX_VOLUME;
}

// Runs a fixed command line; returns [exit code, output lines].
function run($cmd) {
    $out = [];
    $code = 1;
    @exec($cmd . ' 2>&1', $out, $code);
    return [$code, $out];
}

function sudo_allowed($cmd) {
    return run('sudo -n -l ' . $cmd)[0] === 0;
}

// Sends the JSON answer and closes the connection, so the page shows its message before the command runs.
function answer_now($data) {
    ignore_user_abort(true);
    $body = json_encode($data);
    while (ob_get_level() > 0) ob_end_clean();
    header('Content-Length: ' . strlen($body));
    header('Connection: close');
    echo $body;
    flush();
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST only', 405);
}
$body = json_decode((string)file_get_contents('php://input'), true);
$action = is_array($body) && is_string($body['action'] ?? null) ? $body['action'] : '';

$user = sk_session_user($conn);
error_log(sprintf('[sk-power] user=%s action=%s ip=%s',
    $user ? $user['username'] . '(' . $user['role'] . ')' : 'guest',
    preg_replace('/[^a-z_]/', '?', substr($action, 0, 20)),
    $_SERVER['REMOTE_ADDR'] ?? '-'));
if (!$user || $user['role'] !== 'admin') {
    sk_forbidden('Admin access required.');
}

$valid = ['status', 'shutdown', 'reboot', 'get_volume', 'set_volume'];
if (!in_array($action, $valid, true)) {
    fail('Unknown action');
}

$isPi = is_pi();
$max = max_volume();

if ($action === 'status') {
    echo json_encode([
        'success'   => true,
        'isPi'      => $isPi,
        'canPower'  => $isPi && sudo_allowed(SK_POWER_CMDS['shutdown']) && sudo_allowed(SK_POWER_CMDS['reboot']),
        'canVolume' => $isPi && sudo_allowed(SK_VOLUME_BIN . ' get'),
        'maxVolume' => $max,
    ]);
    exit;
}

if (!$isPi) {
    fail('Raspberry Pi only', 409);
}

if ($action === 'shutdown' || $action === 'reboot') {
    $cmd = SK_POWER_CMDS[$action];
    if (!sudo_allowed($cmd)) {
        fail('Not allowed: the sudoers rule is missing. Run tools/pi/pi-setup.sh on the Pi.', 409);
    }
    answer_now(['success' => true, 'action' => $action]);
    exec('nohup sh -c ' . escapeshellarg('sleep 3; sudo -n ' . $cmd) . ' >/dev/null 2>&1 &');
    error_log('[sk-power] ' . $action . ' started by ' . $user['username']);
    exit;
}

// Volume: sk-volume prints wpctl's "Volume: 0.75" (plus " [MUTED]" when muted).
if ($action === 'get_volume') {
    [$code, $out] = run('sudo -n ' . SK_VOLUME_BIN . ' get');
    $line = implode(' ', $out);
    if ($code !== 0 || !preg_match('/Volume:\s*([0-9.]+)/', $line, $m)) {
        fail('Could not read the volume (sk-volume get: ' . substr($line, 0, 200) . ')', 500);
    }
    echo json_encode([
        'success'   => true,
        'volume'    => min($max, (float)$m[1]),
        'muted'     => strpos($line, 'MUTED') !== false,
        'maxVolume' => $max,
    ]);
    exit;
}

// set_volume
$value = $body['value'] ?? null;
if (!is_int($value) && !is_float($value) && !(is_string($value) && is_numeric($value))) {
    fail('value must be a number');
}
$value = (float)$value;
if (!is_finite($value) || $value < 0) {
    fail('value must be 0 or more');
}
$value = min($value, $max);
$arg = sprintf('%.2f', $value);
[$code, $out] = run('sudo -n ' . SK_VOLUME_BIN . ' set ' . escapeshellarg($arg));
if ($code !== 0) {
    fail('Could not set the volume (sk-volume set: ' . substr(implode(' ', $out), 0, 200) . ')', 500);
}
echo json_encode(['success' => true, 'volume' => (float)$arg, 'maxVolume' => $max]);
