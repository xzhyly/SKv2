<?php
// Admin-facing endpoint for reports.html's saved-conversations view (Task 4 wires the client).
// Reads and deletes only — talk.html/index.html must never call this (see .git/sdd/conv-global.md:
// "Past conversations must never be readable from talk.html, index.html or any kiosk-facing
// screen"). No server-side auth here, same as reports.php (DEBT 72 stays open).
//
// GET (no id)   -> {success, conversations:[{id, started_at, ended_at, end_reason,
//                   duration_seconds, message_count, first_message}]}
// GET ?id=N     -> {success, conversation:{...same fields...}, messages:[{seq, speaker, source,
//                   sign_language, text, created_at}]}
// POST delete   -> {"action":"delete","id":N}    => {success, deleted:1}
// POST clear_all -> {"action":"clear_all"}        => {success, deleted:n}
header('Content-Type: application/json');

require_once __DIR__ . '/../connect.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

// Normalizes a mysqli/mysqli_stmt failure (whether the call returned false — PHP < 8.1's default
// mysqli.report_mode — or threw a mysqli_sql_exception — PHP >= 8.1's default) into a thrown
// RuntimeException, so every DB failure surfaces the same way regardless of report mode. Mirrors
// php/api/save_conversation.php's db_fail_check(); kept as a local copy per-file rather than a
// shared include, since it's a few lines.
function db_fail_check($ok, $context) {
    if (!$ok) {
        throw new RuntimeException($context);
    }
}

// Shared SELECT for both the list and the detail view. $where/$params/$types let the caller add
// a "WHERE c.id = ?" for the detail case; list leaves them empty.
function fetch_conversations($conn, $where, $params, $types) {
    $sql = "SELECT c.id, c.started_at, c.ended_at, c.end_reason,
                   TIMESTAMPDIFF(SECOND, c.started_at, COALESCE(c.ended_at, MAX(m.created_at))) AS duration_seconds,
                   COUNT(m.id) AS message_count,
                   (SELECT text FROM messages WHERE conversation_id = c.id ORDER BY seq ASC LIMIT 1) AS first_message
              FROM conversations c
              LEFT JOIN messages m ON m.conversation_id = c.id
              $where
             GROUP BY c.id, c.started_at, c.ended_at, c.end_reason
             ORDER BY c.started_at DESC, c.id DESC";

    $stmt = mysqli_prepare($conn, $sql);
    db_fail_check($stmt !== false, 'prepare fetch_conversations');
    if ($types !== '') {
        db_fail_check(mysqli_stmt_bind_param($stmt, $types, ...$params), 'bind fetch_conversations');
    }
    db_fail_check(mysqli_stmt_execute($stmt), 'execute fetch_conversations');
    $result = mysqli_stmt_get_result($stmt);
    db_fail_check($result !== false, 'get_result fetch_conversations');
    $rows = [];
    while ($row = mysqli_fetch_assoc($result)) {
        $rows[] = [
            'id' => (int)$row['id'],
            'started_at' => $row['started_at'],
            'ended_at' => $row['ended_at'],
            'end_reason' => $row['end_reason'],
            'duration_seconds' => $row['duration_seconds'] === null ? 0 : (int)$row['duration_seconds'],
            'message_count' => (int)$row['message_count'],
            'first_message' => $row['first_message'],
        ];
    }
    mysqli_stmt_close($stmt);
    return $rows;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    if (isset($_GET['id'])) {
        $idRaw = $_GET['id'];
        if (!ctype_digit($idRaw) || (int)$idRaw < 1) {
            fail('id must be a positive integer', 400);
        }
        $id = (int)$idRaw;

        try {
            $rows = fetch_conversations($conn, 'WHERE c.id = ?', [$id], 'i');
            if (count($rows) === 0) {
                fail('Conversation not found', 404);
            }

            $msgStmt = mysqli_prepare(
                $conn,
                'SELECT seq, speaker, source, sign_language, text, created_at
                   FROM messages
                  WHERE conversation_id = ?
                  ORDER BY seq ASC'
            );
            db_fail_check($msgStmt !== false, 'prepare detail messages');
            db_fail_check(mysqli_stmt_bind_param($msgStmt, 'i', $id), 'bind detail messages');
            db_fail_check(mysqli_stmt_execute($msgStmt), 'execute detail messages');
            $msgResult = mysqli_stmt_get_result($msgStmt);
            db_fail_check($msgResult !== false, 'get_result detail messages');
            $messages = [];
            while ($row = mysqli_fetch_assoc($msgResult)) {
                $messages[] = [
                    'seq' => (int)$row['seq'],
                    'speaker' => $row['speaker'],
                    'source' => $row['source'],
                    'sign_language' => $row['sign_language'],
                    'text' => $row['text'],
                    'created_at' => $row['created_at'],
                ];
            }
            mysqli_stmt_close($msgStmt);
        } catch (Throwable $e) {
            fail('Database error', 500);
        }

        echo json_encode(['success' => true, 'conversation' => $rows[0], 'messages' => $messages]);
        exit;
    }

    try {
        $conversations = fetch_conversations($conn, '', [], '');
    } catch (Throwable $e) {
        fail('Database error', 500);
    }
    echo json_encode(['success' => true, 'conversations' => $conversations]);
    exit;
}

if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        fail('Invalid JSON body');
    }

    $action = $body['action'] ?? null;

    if ($action === 'delete') {
        $id = $body['id'] ?? null;
        if (!is_int($id) || $id < 1) {
            fail('id must be a positive integer', 400);
        }

        try {
            $delStmt = mysqli_prepare($conn, 'DELETE FROM conversations WHERE id = ?');
            db_fail_check($delStmt !== false, 'prepare delete');
            db_fail_check(mysqli_stmt_bind_param($delStmt, 'i', $id), 'bind delete');
            db_fail_check(mysqli_stmt_execute($delStmt), 'execute delete');
            $deleted = mysqli_stmt_affected_rows($delStmt);
            mysqli_stmt_close($delStmt);
        } catch (Throwable $e) {
            fail('Database error', 500);
        }

        if ($deleted === 0) {
            fail('Conversation not found', 404);
        }

        echo json_encode(['success' => true, 'deleted' => (int)$deleted]);
        exit;
    }

    if ($action === 'clear_all') {
        try {
            $clearStmt = mysqli_prepare($conn, 'DELETE FROM conversations');
            db_fail_check($clearStmt !== false, 'prepare clear_all');
            db_fail_check(mysqli_stmt_execute($clearStmt), 'execute clear_all');
            $deleted = mysqli_stmt_affected_rows($clearStmt);
            mysqli_stmt_close($clearStmt);
        } catch (Throwable $e) {
            fail('Database error', 500);
        }
        echo json_encode(['success' => true, 'deleted' => (int)$deleted]);
        exit;
    }

    fail('Unknown or missing action');
}

fail('Method not allowed', 405);
