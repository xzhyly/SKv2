<?php
// save_translation.php
// Called via POST from the frontend after a sign is detected or text is spoken.
//
//  Expected JSON body:
//  {
//    "source_type":     "sign_to_text" | "text_to_sign",
//    "sign_label":      "Hello",          // gesture / sign word
//    "translated_text": "Hello",          // resulting text
//    "language":        "en-US",          // optional, default en-US
//    "confidence":      0.97              // optional float
//  }

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");          // adjust in production
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(204);
    exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed. Use POST."]);
    exit;
}

require_once __DIR__ . "/../connect.php";   // sets $conn

// ── Parse incoming JSON ──────────────────────────────────────
$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!$data) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid JSON body."]);
    exit;
}

// ── Validate required fields ─────────────────────────────────
$source_type     = trim($data["source_type"]     ?? "");
$sign_label      = trim($data["sign_label"]      ?? "");
$translated_text = trim($data["translated_text"] ?? "");
$language        = trim($data["language"]        ?? "en-US");
$confidence      = isset($data["confidence"]) ? (float)$data["confidence"] : null;

$allowed_types = ["sign_to_text", "text_to_sign"];
if (!in_array($source_type, $allowed_types)) {
    http_response_code(400);
    echo json_encode(["error" => "source_type must be 'sign_to_text' or 'text_to_sign'."]);
    exit;
}

if ($sign_label === "" && $translated_text === "") {
    http_response_code(400);
    echo json_encode(["error" => "At least one of sign_label or translated_text is required."]);
    exit;
}

// ── Insert into DB ───────────────────────────────────────────
$stmt = mysqli_prepare(
    $conn,
    "INSERT INTO translations
       (source_type, sign_label, translated_text, language, confidence)
     VALUES (?, ?, ?, ?, ?)"
);

if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => "Prepare failed: " . mysqli_error($conn)]);
    exit;
}

// confidence can be NULL – bind as 'd' (double), NULL is fine
mysqli_stmt_bind_param(
    $stmt, "ssssd",
    $source_type,
    $sign_label,
    $translated_text,
    $language,
    $confidence
);

if (mysqli_stmt_execute($stmt)) {
    $new_id = mysqli_insert_id($conn);
    http_response_code(201);
    echo json_encode([
        "success" => true,
        "id"      => $new_id,
        "message" => "Translation saved."
    ]);
} else {
    http_response_code(500);
    echo json_encode(["error" => "Execute failed: " . mysqli_stmt_error($stmt)]);
}

mysqli_stmt_close($stmt);
mysqli_close($conn);