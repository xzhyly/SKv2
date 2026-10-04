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

function fetch_gestures($conn, $sets, $subFolder, $textColumn) {
    // $sets is a fixed list from this file (never user input); the tab lists its own set plus BOTH.
    $placeholders = implode(',', array_fill(0, count($sets), '?'));
    $stmt = mysqli_prepare(
        $conn,
        "SELECT id, label, sign_language, text_en, text_fil, asset_path, is_active, created_at FROM gestures " .
        "WHERE sign_language IN ($placeholders) ORDER BY created_at DESC, id DESC"
    );
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(["success" => false, "error" => mysqli_error($conn)]);
        exit;
    }
    mysqli_stmt_bind_param($stmt, str_repeat('s', count($sets)), ...$sets);
    mysqli_stmt_execute($stmt);
    $result = mysqli_stmt_get_result($stmt);
    $rows = [];
    while ($row = mysqli_fetch_assoc($result)) {
        $rows[] = $row;
    }
    mysqli_stmt_close($stmt);

    foreach ($rows as &$row) {
        if (empty($row['asset_path'])) {
            $expectedFile = '/assets/signs/' . $subFolder . '/' . $row['label'] . '.mp4';
            $absolutePath = __DIR__ . '/../..' . $expectedFile;
            if (file_exists($absolutePath)) {
                $row['asset_path'] = 'assets/signs/' . $subFolder . '/' . $row['label'] . '.mp4';
                $upd = mysqli_prepare($conn, 'UPDATE gestures SET asset_path = ? WHERE id = ?');
                if ($upd) {
                    mysqli_stmt_bind_param($upd, 'si', $row['asset_path'], $row['id']);
                    mysqli_stmt_execute($upd);
                    mysqli_stmt_close($upd);
                }
            }
        }
        $row['display_label'] = str_replace('_', ' ', $row['label']);
        $row['set'] = $row['sign_language'];
        $row['text'] = $row[$textColumn];
    }
    unset($row);
    return $rows;
}

$esl = fetch_gestures($conn, ['ESL', 'BOTH'], 'en', 'text_en');
$fsl = fetch_gestures($conn, ['FSL', 'BOTH'], 'fil', 'text_fil');

echo json_encode([
    "success" => true,
    "summary" => [
        "esl" => count($esl),
        "fsl" => count($fsl),
    ],
    "data" => [
        "esl" => $esl,
        "fsl" => $fsl,
    ],
]);

mysqli_close($conn);
