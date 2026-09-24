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

function fetch_gestures($conn, $signLanguage, $subFolder) {
    $rows = fetch_rows(
        $conn,
        "SELECT id, label, asset_path, is_active, created_at FROM gestures " .
        "WHERE sign_language = '" . mysqli_real_escape_string($conn, $signLanguage) . "' " .
        "ORDER BY created_at DESC, id DESC"
    );
    foreach ($rows as &$row) {
        if (empty($row['asset_path'])) {
            $expectedFile = '/assets/signs/' . $subFolder . '/' . $row['label'] . '.mp4';
            $absolutePath = __DIR__ . '/../..' . $expectedFile;
            if (file_exists($absolutePath)) {
                $row['asset_path'] = 'assets/signs/' . $subFolder . '/' . $row['label'] . '.mp4';
                $stmt = mysqli_prepare($conn, 'UPDATE gestures SET asset_path = ? WHERE id = ?');
                if ($stmt) {
                    mysqli_stmt_bind_param($stmt, 'si', $row['asset_path'], $row['id']);
                    mysqli_stmt_execute($stmt);
                    mysqli_stmt_close($stmt);
                }
            }
        }
        $row['display_label'] = str_replace('_', ' ', $row['label']);
    }
    return $rows;
}

$esl = fetch_gestures($conn, 'ESL', 'en');
$fsl = fetch_gestures($conn, 'FSL', 'fil');

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
        "esl" => count($esl),
        "fsl" => count($fsl),
        "translations" => count($translations),
    ],
    "data" => [
        "esl" => $esl,
        "fsl" => $fsl,
        "translations" => $translations,
    ],
]);

mysqli_close($conn);
