<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");

require_once __DIR__ . "/../connect.php";

function fetch_rows($conn, $sql) {
    $result = mysqli_query($conn, $sql);
    if (!$result) {
        http_response_code(500);
        echo json_encode(["success" => false, "error" => mysqli_error($conn)]);
        exit;
    }

    $rows = [];
    while ($row = mysqli_fetch_assoc($result)) {
        $rows[] = $row;
    }
    return $rows;
}

$esl = fetch_rows(
    $conn,
    "SELECT id, sign_key, sign_label, text_value, description, asset_path, is_active, created_at, updated_at
       FROM esl_signs
      ORDER BY created_at DESC, id DESC"
);
foreach ($esl as &$row) {
    if (empty($row['asset_path'])) {
        $expectedFile = '/assets/signs/en/' . $row['sign_key'] . '.mp4';
        $absolutePath = __DIR__ . '/../..' . $expectedFile;
        if (file_exists($absolutePath)) {
            $row['asset_path'] = 'assets/signs/en/' . $row['sign_key'] . '.mp4';
            $safePath = mysqli_real_escape_string($conn, $row['asset_path']);
            mysqli_query($conn, "UPDATE esl_signs SET asset_path = '$safePath' WHERE id = " . $row['id']);
        }
    }
}

$fsl = fetch_rows(
    $conn,
    "SELECT id, sign_key, sign_label, text_value, description, asset_path, is_active, created_at, updated_at
       FROM fsl_signs
      ORDER BY created_at DESC, id DESC"
);
foreach ($fsl as &$row) {
    if (empty($row['asset_path'])) {
        $expectedFile = '/assets/signs/fil/' . $row['sign_key'] . '.mp4';
        $absolutePath = __DIR__ . '/../..' . $expectedFile;
        if (file_exists($absolutePath)) {
            $row['asset_path'] = 'assets/signs/fil/' . $row['sign_key'] . '.mp4';
            $safePath = mysqli_real_escape_string($conn, $row['asset_path']);
            mysqli_query($conn, "UPDATE fsl_signs SET asset_path = '$safePath' WHERE id = " . $row['id']);
        }
    }
}

$translations = fetch_rows(
    $conn,
    "SELECT id, source_type, sign_label, translated_text, language, confidence, created_at
       FROM translations
      ORDER BY created_at DESC, id DESC
      LIMIT 200"
);

echo json_encode([
    "success" => true,
    "summary" => [
        "esl_signs" => count($esl),
        "fsl_signs" => count($fsl),
        "translations" => count($translations),
    ],
    "data" => [
        "esl_signs" => $esl,
        "fsl_signs" => $fsl,
        "translations" => $translations,
    ],
]);

mysqli_close($conn);
