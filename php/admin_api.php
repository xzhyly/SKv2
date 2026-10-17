<?php
// Admin-only API (accounts-quiz phase, 2026-10-18). Every action needs a logged-in admin (the PHP
// session, php/session.php); anyone else gets HTTP 403. The old client-supplied requester_id is
// no longer trusted (DEBT 72, for this file).
//
// Manage users (users.html):
//   {action:"list_users"}                                    -> {success, users:[...]}
//   {action:"create_user", display_name, username, password, role}
//   {action:"reset_password", id, password}
//   {action:"set_active", id, active: true|false}            (an admin cannot deactivate itself)
// There is no delete: a user is deactivated instead.
//
// Every refusal caused by the input (a field left empty, a taken username, deactivating yourself) is
// HTTP 200 with {success:false, code, message} -- the browser logs any non-2xx answer as a console
// error. code: invalid | taken | not_found | self. Not an admin: 403. A database failure: 500.
//
// Kept from before (no page calls them): get_gestures, get_stats. delete_gesture / clear_gestures
// were removed with delete_user / update_user: nothing called them and gestures rows are owned by
// php/api/save_gesture.php.
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'POST only.']);
    exit;
}

require_once __DIR__ . '/connect.php';
require_once __DIR__ . '/session.php';

$admin = sk_require_admin($conn);

$data   = json_decode((string)file_get_contents('php://input'), true);
$action = is_array($data) ? ($data['action'] ?? '') : '';

function api_reply($payload, $code = 200) {
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

function api_fail($message, $reason = 'invalid', $http = 200) {
    api_reply(['success' => false, 'code' => $reason, 'message' => $message], $http);
}

function valid_password($password) {
    return is_string($password) && strlen($password) >= 4;
}

function user_exists($conn, $id) {
    $stmt = mysqli_prepare($conn, 'SELECT id FROM users WHERE id = ?');
    mysqli_stmt_bind_param($stmt, 'i', $id);
    mysqli_stmt_execute($stmt);
    $row = mysqli_fetch_assoc(mysqli_stmt_get_result($stmt));
    mysqli_stmt_close($stmt);
    return (bool)$row;
}

try {
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // USERS
    // ══════════════════════════════════════════════════════════════════════════════════════════

    if ($action === 'list_users') {
        $res = mysqli_query($conn, 'SELECT id, username, display_name, role, is_active, last_login_at, created_at FROM users ORDER BY role = \'admin\' DESC, COALESCE(display_name, username), id');
        $rows = [];
        while ($r = mysqli_fetch_assoc($res)) {
            $rows[] = [
                'id'            => (int)$r['id'],
                'username'      => $r['username'],
                'display_name'  => ($r['display_name'] !== null && $r['display_name'] !== '') ? $r['display_name'] : $r['username'],
                'role'          => $r['role'] === 'admin' ? 'admin' : 'user',
                'is_active'     => (int)$r['is_active'] === 1,
                'last_login_at' => $r['last_login_at'],
                'created_at'    => $r['created_at'],
                'is_me'         => (int)$r['id'] === $admin['id'],
            ];
        }
        api_reply(['success' => true, 'users' => $rows]);
    }

    if ($action === 'create_user') {
        $displayName = trim((string)($data['display_name'] ?? ''));
        $username    = trim((string)($data['username'] ?? ''));
        $password    = $data['password'] ?? '';
        $role        = ($data['role'] ?? 'user') === 'admin' ? 'admin' : 'user';

        if ($displayName === '' || $username === '' || $password === '') {
            api_fail('Fill in all three fields.');
        }
        if (preg_match('/^.{1,80}$/us', $displayName) !== 1) {
            api_fail('Display name can be at most 80 characters.');
        }
        if (preg_match('/^[A-Za-z0-9]{2,30}$/', $username) !== 1) {
            api_fail('Username: 2 to 30 letters and numbers, no spaces.');
        }
        if (!valid_password($password)) {
            api_fail('Password must be at least 4 characters.');
        }

        $hash = password_hash($password, PASSWORD_BCRYPT);
        $ins = mysqli_prepare($conn, 'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)');
        mysqli_stmt_bind_param($ins, 'ssss', $username, $displayName, $hash, $role);
        if (!mysqli_stmt_execute($ins)) {
            if (mysqli_stmt_errno($ins) === 1062) api_fail('That username is taken.', 'taken');
            throw new RuntimeException(mysqli_stmt_error($ins));
        }
        $id = mysqli_insert_id($conn);
        mysqli_stmt_close($ins);
        api_reply(['success' => true, 'id' => (int)$id, 'message' => 'User added.']);
    }

    if ($action === 'reset_password') {
        $id       = $data['id'] ?? null;
        $password = $data['password'] ?? '';
        if (!is_int($id) || $id < 1 || !user_exists($conn, $id)) {
            api_fail('User not found.', 'not_found');
        }
        if (!valid_password($password)) {
            api_fail('Password must be at least 4 characters.');
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        $upd = mysqli_prepare($conn, 'UPDATE users SET password_hash = ? WHERE id = ?');
        mysqli_stmt_bind_param($upd, 'si', $hash, $id);
        mysqli_stmt_execute($upd);
        mysqli_stmt_close($upd);
        api_reply(['success' => true, 'message' => 'Password changed.']);
    }

    if ($action === 'set_active') {
        $id     = $data['id'] ?? null;
        $active = $data['active'] ?? null;
        if (!is_int($id) || $id < 1 || !user_exists($conn, $id)) {
            api_fail('User not found.', 'not_found');
        }
        if (!is_bool($active)) {
            api_fail('active must be true or false.');
        }
        if (!$active && $id === $admin['id']) {
            api_fail('You cannot deactivate your own account.', 'self');
        }
        $flag = $active ? 1 : 0;
        $upd = mysqli_prepare($conn, 'UPDATE users SET is_active = ? WHERE id = ?');
        mysqli_stmt_bind_param($upd, 'ii', $flag, $id);
        mysqli_stmt_execute($upd);
        mysqli_stmt_close($upd);
        api_reply(['success' => true, 'message' => $active ? 'User activated.' : 'User deactivated.']);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // GESTURES / STATS (read-only, kept from before)
    // ══════════════════════════════════════════════════════════════════════════════════════════

    if ($action === 'get_gestures') {
        $res  = mysqli_query($conn, 'SELECT * FROM gestures ORDER BY id DESC LIMIT 200');
        $rows = [];
        while ($r = mysqli_fetch_assoc($res)) $rows[] = $r;
        api_reply(['success' => true, 'data' => $rows]);
    }

    if ($action === 'get_stats') {
        $totalUsers    = mysqli_fetch_row(mysqli_query($conn, 'SELECT COUNT(*) FROM users'))[0];
        $totalGestures = mysqli_fetch_row(mysqli_query($conn, 'SELECT COUNT(*) FROM gestures'))[0];
        api_reply(['success' => true, 'stats' => [
            'total_users'    => (int)$totalUsers,
            'total_gestures' => (int)$totalGestures,
        ]]);
    }
} catch (Throwable $e) {
    if ((int)$e->getCode() === 1062) {
        api_fail('That username is taken.', 'taken');
    }
    api_fail('Database error.', 'db', 500);
}

api_fail('Unknown action.', 'unknown_action');
