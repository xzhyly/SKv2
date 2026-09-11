<?php
// get_translations.php
// Returns the most recent translation records as JSON.
//
//  Query params (all optional):
//    ?limit=50                   – max rows (default 50, max 200)
//    ?source_type=sign_to_text   – filter by type
//    ?language=fil-PH            – filter by language

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");

require_once __DIR__ . "/../connect.php";   // sets $conn

$limit = min((int)($_GET["limit"] ?? 50), 200);
$limit = max($limit, 1);

$conditions = [];
$params     = [];
$types      = "";

if (!empty($_GET["source_type"])) {
    $conditions[] = "source_type = ?";
    $params[]     = $_GET["source_type"];
    $types       .= "s";
}

if (!empty($_GET["language"])) {
    $conditions[] = "language = ?";
    $params[]     = $_GET["language"];
    $types       .= "s";
}

$where = $conditions ? "WHERE " . implode(" AND ", $conditions) : "";

$stmt = mysqli_prepare(
    $conn,
    "SELECT id, source_type, sign_label, translated_text, language, confidence, created_at
       FROM translations
       $where
      ORDER BY created_at DESC
      LIMIT ?"
);

if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => mysqli_error($conn)]);
    exit;
}

$params[] = $limit;
$types   .= "i";
mysqli_stmt_bind_param($stmt, $types, ...$params);
mysqli_stmt_execute($stmt);

$result = mysqli_stmt_get_result($stmt);
$rows   = [];

while ($row = mysqli_fetch_assoc($result)) {
    $rows[] = $row;
}

echo json_encode(["success" => true, "count" => count($rows), "data" => $rows]);

mysqli_stmt_close($stmt);
mysqli_close($conn);