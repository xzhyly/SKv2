<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

require_once __DIR__ . '/../connect.php';

$data = json_decode(file_get_contents("php://input"), true);

// Guard against empty/missing data
if (!$data || empty($data['text'])) {
    echo json_encode(["error" => "No data received"]);
    exit;
}

$text   = mysqli_real_escape_string($conn, $data['text']);
$source = mysqli_real_escape_string($conn, $data['source'] ?? 'sign');

$sql = "INSERT INTO translation_history (translated_text, source) VALUES ('$text', '$source')";

if (mysqli_query($conn, $sql)) {
    echo json_encode(["success" => true]);
} else {
    echo json_encode(["error" => mysqli_error($conn)]);
}
?>