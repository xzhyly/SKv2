<?php
// Accounts (accounts-quiz phase, 2026-10-18): the PHP session that says who is logged in.
// Demo-level security only: password_hash()/password_verify() plus this PHP session, nothing else.
//
// The session only stores the user's id. Every request re-reads the users row, so a deactivated
// account or a changed role takes effect on that user's very next request.
//
// sk_session_user($conn) -> ['id','username','display_name','role'] or null (guest)
// sk_require_admin($conn) -> the admin user, or a 403 JSON response and exit
// sk_require_user($conn)  -> the logged-in user, or a 403 JSON response and exit

function sk_session_start() {
    if (session_status() === PHP_SESSION_NONE) {
        session_name('SKSESSID');
        session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
        session_start();
    }
}

// Reads the session and releases its lock at once (PHP serializes requests that hold the same
// session open), so a page's parallel requests never wait on each other.
function sk_session_user_id() {
    // No session cookie: a guest. Do not start (and store) an empty session for every guest request.
    if (session_status() === PHP_SESSION_NONE && empty($_COOKIE['SKSESSID'])) {
        return 0;
    }
    sk_session_start();
    $id = isset($_SESSION['sk_user_id']) ? (int)$_SESSION['sk_user_id'] : 0;
    session_write_close();
    return $id;
}

function sk_public_user($row) {
    return [
        'id'           => (int)$row['id'],
        'username'     => $row['username'],
        'display_name' => ($row['display_name'] !== null && $row['display_name'] !== '') ? $row['display_name'] : $row['username'],
        'role'         => $row['role'] === 'admin' ? 'admin' : 'user',
    ];
}

function sk_session_user($conn) {
    static $cached = false;
    if ($cached !== false) {
        return $cached;
    }
    $cached = null;
    $id = sk_session_user_id();
    if ($id < 1) {
        return null;
    }
    $stmt = mysqli_prepare($conn, 'SELECT id, username, display_name, role, is_active FROM users WHERE id = ?');
    if ($stmt === false) {
        return null;
    }
    mysqli_stmt_bind_param($stmt, 'i', $id);
    mysqli_stmt_execute($stmt);
    $row = mysqli_fetch_assoc(mysqli_stmt_get_result($stmt));
    mysqli_stmt_close($stmt);
    if (!$row || (int)$row['is_active'] !== 1) {
        return null;
    }
    $cached = sk_public_user($row);
    return $cached;
}

function sk_login_session($userId) {
    sk_session_start();
    session_regenerate_id(true);
    $_SESSION['sk_user_id'] = (int)$userId;
    session_write_close();
}

function sk_logout_session() {
    sk_session_start();
    $_SESSION = [];
    session_destroy();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
}

function sk_forbidden($message) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'error' => $message, 'message' => $message]);
    exit;
}

function sk_require_user($conn) {
    $user = sk_session_user($conn);
    if (!$user) {
        sk_forbidden('Log in first.');
    }
    return $user;
}

function sk_require_admin($conn) {
    $user = sk_session_user($conn);
    if (!$user || $user['role'] !== 'admin') {
        sk_forbidden('Admin access required.');
    }
    return $user;
}
