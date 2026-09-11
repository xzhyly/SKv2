<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

require_once __DIR__ . '/connect.php';

$data = json_decode(file_get_contents("php://input"), true);
$action = $data['action'] ?? '';

// Create users table if not exists
mysqli_query($conn, "
    CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(80) NOT NULL UNIQUE,
        email VARCHAR(150) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('user','admin') DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
");

// Seed default admin if none exists
$adminCheck = mysqli_query($conn, "SELECT id FROM users WHERE role='admin' LIMIT 1");
if (mysqli_num_rows($adminCheck) === 0) {
    $defaultHash = password_hash('admin123', PASSWORD_BCRYPT);
    mysqli_query($conn, "INSERT INTO users (username, email, password_hash, role) VALUES ('admin', 'admin@siningkamay.com', '$defaultHash', 'admin')");
}

// ── REGISTER ─────────────────────────────────────────────────────────────────
if ($action === 'register') {
    $username = trim($data['username'] ?? '');
    $email    = trim($data['email']    ?? '');
    $password = $data['password'] ?? '';

    if (!$username || !$email || !$password) {
        echo json_encode(["success" => false, "message" => "All fields are required."]);
        exit;
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(["success" => false, "message" => "Invalid email address."]);
        exit;
    }
    if (strlen($password) < 6) {
        echo json_encode(["success" => false, "message" => "Password must be at least 6 characters."]);
        exit;
    }

    $uEsc = mysqli_real_escape_string($conn, $username);
    $eEsc = mysqli_real_escape_string($conn, $email);
    $hash = password_hash($password, PASSWORD_BCRYPT);

    $check = mysqli_query($conn, "SELECT id FROM users WHERE username='$uEsc' OR email='$eEsc'");
    if (mysqli_num_rows($check) > 0) {
        echo json_encode(["success" => false, "message" => "Username or email already taken."]);
        exit;
    }

    $ins = mysqli_query($conn, "INSERT INTO users (username, email, password_hash) VALUES ('$uEsc', '$eEsc', '$hash')");
    if ($ins) {
        $user = mysqli_fetch_assoc(mysqli_query($conn, "SELECT id, username, email, role FROM users WHERE username='$uEsc'"));
        echo json_encode(["success" => true, "user" => $user]);
    } else {
        echo json_encode(["success" => false, "message" => "Registration failed: " . mysqli_error($conn)]);
    }
    exit;
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
if ($action === 'login') {
    $identifier = trim($data['identifier'] ?? ''); // username or email
    $password   = $data['password'] ?? '';

    if (!$identifier || !$password) {
        echo json_encode(["success" => false, "message" => "Please fill in all fields."]);
        exit;
    }

    $esc  = mysqli_real_escape_string($conn, $identifier);
    $row  = mysqli_fetch_assoc(mysqli_query($conn, "SELECT * FROM users WHERE username='$esc' OR email='$esc' LIMIT 1"));

    if (!$row || !password_verify($password, $row['password_hash'])) {
        echo json_encode(["success" => false, "message" => "Invalid username/email or password."]);
        exit;
    }

    unset($row['password_hash']);
    echo json_encode(["success" => true, "user" => $row]);
    exit;
}

echo json_encode(["success" => false, "message" => "Unknown action."]);
?>