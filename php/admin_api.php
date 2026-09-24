<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

require_once __DIR__ . '/connect.php';

$data   = json_decode(file_get_contents("php://input"), true);
$action = $data['action'] ?? '';

// ── Simple session-style admin check via passed user_id + role ────────────────
// In production, use session tokens. Here we verify by re-querying the DB.
$requesterId   = intval($data['requester_id'] ?? 0);
$requesterRole = '';
if ($requesterId > 0) {
    $rRow = mysqli_fetch_assoc(mysqli_query($conn, "SELECT role FROM users WHERE id=$requesterId"));
    $requesterRole = $rRow['role'] ?? '';
}

function requireAdmin($role) {
    if ($role !== 'admin') {
        echo json_encode(["success" => false, "message" => "Admin access required."]);
        exit;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// USERS CRUD
// ══════════════════════════════════════════════════════════════════════════════

if ($action === 'get_users') {
    requireAdmin($requesterRole);
    $res  = mysqli_query($conn, "SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC");
    $rows = [];
    while ($r = mysqli_fetch_assoc($res)) $rows[] = $r;
    echo json_encode(["success" => true, "data" => $rows]);
    exit;
}

if ($action === 'create_user') {
    requireAdmin($requesterRole);
    $username = trim($data['username'] ?? '');
    $email    = trim($data['email']    ?? '');
    $password = $data['password'] ?? '';
    $role     = in_array($data['role'] ?? '', ['user','admin']) ? $data['role'] : 'user';

    if (!$username || !$email || !$password) {
        echo json_encode(["success" => false, "message" => "All fields required."]);
        exit;
    }

    $uEsc = mysqli_real_escape_string($conn, $username);
    $eEsc = mysqli_real_escape_string($conn, $email);
    $hash = password_hash($password, PASSWORD_BCRYPT);

    $chk = mysqli_query($conn, "SELECT id FROM users WHERE username='$uEsc' OR email='$eEsc'");
    if (mysqli_num_rows($chk) > 0) {
        echo json_encode(["success" => false, "message" => "Username or email already exists."]);
        exit;
    }

    $ok = mysqli_query($conn, "INSERT INTO users (username, email, password_hash, role) VALUES ('$uEsc','$eEsc','$hash','$role')");
    echo json_encode(["success" => (bool)$ok, "message" => $ok ? "User created." : mysqli_error($conn)]);
    exit;
}

if ($action === 'update_user') {
    requireAdmin($requesterRole);
    $id       = intval($data['id'] ?? 0);
    $username = trim($data['username'] ?? '');
    $email    = trim($data['email']    ?? '');
    $role     = in_array($data['role'] ?? '', ['user','admin']) ? $data['role'] : 'user';
    $password = $data['password'] ?? ''; // optional — blank = don't change

    if (!$id || !$username || !$email) {
        echo json_encode(["success" => false, "message" => "ID, username and email required."]);
        exit;
    }

    $uEsc = mysqli_real_escape_string($conn, $username);
    $eEsc = mysqli_real_escape_string($conn, $email);

    // Check uniqueness excluding self
    $chk = mysqli_query($conn, "SELECT id FROM users WHERE (username='$uEsc' OR email='$eEsc') AND id != $id");
    if (mysqli_num_rows($chk) > 0) {
        echo json_encode(["success" => false, "message" => "Username or email taken by another user."]);
        exit;
    }

    $passClause = '';
    if (!empty($password)) {
        $hash = password_hash($password, PASSWORD_BCRYPT);
        $passClause = ", password_hash='$hash'";
    }

    $ok = mysqli_query($conn, "UPDATE users SET username='$uEsc', email='$eEsc', role='$role' $passClause WHERE id=$id");
    echo json_encode(["success" => (bool)$ok, "message" => $ok ? "User updated." : mysqli_error($conn)]);
    exit;
}

if ($action === 'delete_user') {
    requireAdmin($requesterRole);
    $id = intval($data['id'] ?? 0);
    if ($id === $requesterId) {
        echo json_encode(["success" => false, "message" => "Cannot delete yourself."]);
        exit;
    }
    $ok = mysqli_query($conn, "DELETE FROM users WHERE id=$id");
    echo json_encode(["success" => (bool)$ok, "message" => $ok ? "User deleted." : mysqli_error($conn)]);
    exit;
}

// ══════════════════════════════════════════════════════════════════════════════
// GESTURES CRUD
// ══════════════════════════════════════════════════════════════════════════════

if ($action === 'get_gestures') {
    requireAdmin($requesterRole);
    $res  = mysqli_query($conn, "SELECT * FROM gestures ORDER BY id DESC LIMIT 200");
    $rows = [];
    while ($r = mysqli_fetch_assoc($res)) $rows[] = $r;
    echo json_encode(["success" => true, "data" => $rows]);
    exit;
}

if ($action === 'delete_gesture') {
    requireAdmin($requesterRole);
    $id = intval($data['id'] ?? 0);
    $ok = mysqli_query($conn, "DELETE FROM gestures WHERE id=$id");
    echo json_encode(["success" => (bool)$ok]);
    exit;
}

if ($action === 'clear_gestures') {
    requireAdmin($requesterRole);
    $ok = mysqli_query($conn, "TRUNCATE TABLE gestures");
    echo json_encode(["success" => (bool)$ok]);
    exit;
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ══════════════════════════════════════════════════════════════════════════════

if ($action === 'get_stats') {
    requireAdmin($requesterRole);
    $totalUsers    = mysqli_fetch_row(mysqli_query($conn, "SELECT COUNT(*) FROM users"))[0];
    $totalGestures = mysqli_fetch_row(mysqli_query($conn, "SELECT COUNT(*) FROM gestures"))[0];
    echo json_encode([
        "success" => true,
        "stats" => [
            "total_users"    => (int)$totalUsers,
            "total_gestures" => (int)$totalGestures
        ]
    ]);
    exit;
}

echo json_encode(["success" => false, "message" => "Unknown action."]);
?>