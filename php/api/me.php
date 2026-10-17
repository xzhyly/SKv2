<?php
// Who is logged in, as a classic script: <script src="php/api/me.php"></script> in a page's <head>
// sets window.SK_ME = {id, username, display_name, role} or null (guest) before the page's own
// scripts run (accounts-quiz phase). Admin pages use it to redirect non-admins before anything
// shows (js/sk-account.js adminPage()); other pages use it to draw the name chip without a flash.
// Never cached: a log in / log out must show on the next page load.
header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store');

// connect.php echoes a JSON error and exits when the DB is down; keep the script valid instead.
ob_start();
register_shutdown_function(function () {
    if (!isset($GLOBALS['conn']) || !$GLOBALS['conn']) {
        while (ob_get_level() > 0) ob_end_clean();
        echo "window.SK_ME = null;\n";
    }
});
require_once __DIR__ . '/../connect.php';
require_once __DIR__ . '/../session.php';
ob_end_clean();

$user = null;
try {
    $user = sk_session_user($conn);
} catch (Throwable $e) {
    $user = null;
}
echo 'window.SK_ME = ' . json_encode($user, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) . ";\n";
