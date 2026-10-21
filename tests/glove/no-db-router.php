<?php
// tests/glove/no-db-router.php — a router for PHP's built-in server so the glove browser checks run
// on a machine WITHOUT MySQL (the cloud container the glove-hw phase was built in). It answers only
// the two account endpoints the Settings page and tests/video-capture/cdp.mjs need, as a logged-in
// admin; every other path is served from disk as usual. Never used by the kiosk (XAMPP / the Pi have
// the real php/auth.php and php/api/me.php).
// Run from a folder whose SKR/ points at the repo:  php -S 127.0.0.1:8080 SKR/tests/glove/no-db-router.php
// then SK_BASE=http://127.0.0.1:8080/SKR/
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#/SKR/php/auth\.php$#', $path)) {
    header('Content-Type: application/json');
    header('Set-Cookie: SKSESSID=glove-test; Path=/; HttpOnly');
    echo json_encode(['success' => true, 'user' => ['id' => 1, 'username' => 'admin', 'display_name' => 'Admin', 'role' => 'admin']]);
    return true;
}
if (preg_match('#/SKR/php/api/me\.php$#', $path)) {
    header('Content-Type: application/javascript; charset=utf-8');
    header('Cache-Control: no-store');
    echo "window.SK_ME = {\"id\":1,\"username\":\"admin\",\"display_name\":\"Admin\",\"role\":\"admin\"};\n";
    return true;
}
return false;
