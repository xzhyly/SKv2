<?php
// Log in / Create account / Log out for every account, admin included (accounts-quiz phase,
// 2026-10-18). login.html is the only page that calls it; php/session.php keeps who is logged in.
//
// POST {action:"login", username, password}     (username may also be the email; "identifier" is
//                                                 still accepted for the old field name)
// POST {action:"register", display_name, username, password}  -> role 'user', logged in right away
// POST {action:"logout"}
// GET  (or POST {action:"me"})                   -> {success:true, user: {...} | null}
//
// The admin account works as before: a users row with role 'admin', admin / admin123 seeded when
// no admin exists. Deactivated users (is_active = 0) cannot log in. A login sets last_login_at.
//
// An answer the person caused (wrong password, deactivated, taken username, a field left empty) is
// HTTP 200 with {success:false, code, message}, as before this phase: the browser logs every
// non-2xx response as a console error, and these are normal use. code: missing | wrong_password |
// inactive | invalid | taken.
header('Content-Type: application/json');

require_once __DIR__ . '/connect.php';
require_once __DIR__ . '/session.php';

function auth_reply($code, $payload) {
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

function auth_fail($code, $message) {
    auth_reply($code, ['success' => false, 'message' => $message]);
}

function auth_refuse($reason, $message) {
    auth_reply(200, ['success' => false, 'code' => $reason, 'message' => $message]);
}

// PHP 8.1+ mysqli throws; older versions return false. Both end up here as one message.
function auth_db_error() {
    auth_fail(500, 'Database error. Run db-schema/2026-10-accounts-quiz.sql if this database is older than 2026-10-18.');
}

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'GET') {
    $data = ['action' => 'me'];
} elseif ($method === 'POST') {
    $data = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($data)) {
        auth_fail(400, 'Invalid request.');
    }
} else {
    auth_fail(405, 'GET or POST only.');
}
$action = $data['action'] ?? '';

try {
    // Seed default admin if none exists (unchanged rule; the hash is created here, so it is real).
    $adminCheck = mysqli_query($conn, "SELECT id FROM users WHERE role='admin' LIMIT 1");
    if ($adminCheck && mysqli_num_rows($adminCheck) === 0) {
        $seed = mysqli_prepare($conn, "INSERT IGNORE INTO users (username, display_name, email, password_hash, role) VALUES ('admin', 'Admin', 'admin@siningkamay.com', ?, 'admin')");
        $defaultHash = password_hash('admin123', PASSWORD_BCRYPT);
        mysqli_stmt_bind_param($seed, 's', $defaultHash);
        mysqli_stmt_execute($seed);
        mysqli_stmt_close($seed);
    }

    if ($action === 'me') {
        auth_reply(200, ['success' => true, 'user' => sk_session_user($conn)]);
    }

    if ($action === 'logout') {
        sk_logout_session();
        auth_reply(200, ['success' => true, 'user' => null]);
    }

    // ── LOGIN ────────────────────────────────────────────────────────────────────────────────
    if ($action === 'login') {
        $identifier = trim((string)($data['username'] ?? $data['identifier'] ?? ''));
        $password   = (string)($data['password'] ?? '');
        if ($identifier === '' || $password === '') {
            auth_refuse('missing', 'Enter your username and password.');
        }

        $stmt = mysqli_prepare($conn, 'SELECT id, username, display_name, password_hash, role, is_active FROM users WHERE username = ? OR email = ? ORDER BY username = ? DESC LIMIT 1');
        mysqli_stmt_bind_param($stmt, 'sss', $identifier, $identifier, $identifier);
        mysqli_stmt_execute($stmt);
        $row = mysqli_fetch_assoc(mysqli_stmt_get_result($stmt));
        mysqli_stmt_close($stmt);

        if (!$row || !password_verify($password, $row['password_hash'])) {
            auth_refuse('wrong_password', 'Wrong username or password.');
        }
        if ((int)$row['is_active'] !== 1) {
            auth_refuse('inactive', 'This account is turned off. Ask an admin to turn it back on.');
        }

        $upd = mysqli_prepare($conn, 'UPDATE users SET last_login_at = current_timestamp() WHERE id = ?');
        $id = (int)$row['id'];
        mysqli_stmt_bind_param($upd, 'i', $id);
        mysqli_stmt_execute($upd);
        mysqli_stmt_close($upd);

        sk_login_session($id);
        auth_reply(200, ['success' => true, 'user' => sk_public_user($row)]);
    }

    // ── CREATE ACCOUNT ───────────────────────────────────────────────────────────────────────
    if ($action === 'register') {
        $displayName = trim((string)($data['display_name'] ?? ''));
        $username    = trim((string)($data['username'] ?? ''));
        $password    = (string)($data['password'] ?? '');

        if ($displayName === '' || $username === '' || $password === '') {
            auth_refuse('missing', 'Fill in all three fields.');
        }
        if (preg_match('/^.{1,80}$/us', $displayName) !== 1) {
            auth_refuse('invalid', 'Display name can be at most 80 characters.');
        }
        if (preg_match('/^[A-Za-z0-9]{2,30}$/', $username) !== 1) {
            auth_refuse('invalid', 'Username: 2 to 30 letters and numbers, no spaces.');
        }
        if (strlen($password) < 4) {
            auth_refuse('invalid', 'Password must be at least 4 characters.');
        }

        $chk = mysqli_prepare($conn, 'SELECT id FROM users WHERE username = ? LIMIT 1');
        mysqli_stmt_bind_param($chk, 's', $username);
        mysqli_stmt_execute($chk);
        $taken = mysqli_fetch_assoc(mysqli_stmt_get_result($chk));
        mysqli_stmt_close($chk);
        if ($taken) {
            auth_refuse('taken', 'That username is taken. Try another one.');
        }

        // role is always 'user' here; only Manage users (php/admin_api.php) can make an admin.
        $hash = password_hash($password, PASSWORD_BCRYPT);
        $ins = mysqli_prepare($conn, "INSERT INTO users (username, display_name, password_hash, role, last_login_at) VALUES (?, ?, ?, 'user', current_timestamp())");
        mysqli_stmt_bind_param($ins, 'sss', $username, $displayName, $hash);
        mysqli_stmt_execute($ins);
        $id = mysqli_insert_id($conn);
        mysqli_stmt_close($ins);

        sk_login_session($id);
        auth_reply(200, ['success' => true, 'user' => [
            'id' => (int)$id, 'username' => $username, 'display_name' => $displayName, 'role' => 'user',
        ]]);
    }
} catch (Throwable $e) {
    if ((int)$e->getCode() === 1062) {
        auth_refuse('taken', 'That username is taken. Try another one.');
    }
    auth_db_error();
}

auth_fail(400, 'Unknown action.');
