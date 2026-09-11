<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

require_once __DIR__ . '/../connect.php';

$result = mysqli_query($conn, "SELECT * FROM translation_history ORDER BY created_at DESC LIMIT 50");

$rows = [];
while ($row = mysqli_fetch_assoc($result)) {
    $rows[] = $row;
}

echo json_encode($rows);
?>