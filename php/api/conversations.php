<?php
// Saved-conversations reader: reports.html's Conversations tab and, since the accounts-quiz phase
// (2026-10-18), conversations.html. Needs a logged-in account (php/session.php); a guest gets 403.
//   - a user sees only their own conversations (user_id = their id); the user filter is ignored;
//   - an admin sees all of them, guests' (user_id NULL) included, and may filter;
//   - delete / clear_all are admin-only (403 for a user).
// talk.html still never reads conversations back (it only writes, save_conversation.php).
//
// GET (no id)   -> {success, conversations:[{id, started_at, ended_at, end_reason,
//                   duration_seconds, message_count, first_message, user_id, username,
//                   display_name, title, languages}], has_more}
//                  Optional: limit (1-100; without it every row comes back, as reports.html
//                  expects), offset, user (admin only: a user id, or "guest"), lang (ESL | FSL:
//                  conversations with at least one signed message in that language).
// GET ?id=N     -> {success, conversation:{...same fields...}, messages:[{seq, speaker, source,
//                   sign_language, text, created_at}]}  (a user asking for someone else's -> 404)
// POST delete   -> {"action":"delete","id":N}    => {success, deleted:1}
// POST clear_all -> {"action":"clear_all"}        => {success, deleted:n}
header('Content-Type: application/json');

require_once __DIR__ . '/../connect.php';
require_once __DIR__ . '/../session.php';

$viewer = sk_require_user($conn);
$isAdmin = $viewer['role'] === 'admin';

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
// conditions (detail: "c.id = ?", list: the viewer/filters); $limit/$offset page the list (null =
// every row).
function fetch_conversations($conn, $where, $params, $types, $limit = null, $offset = 0) {
    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $pageSql = '';
    if ($limit !== null) {
        $pageSql = 'LIMIT ? OFFSET ?';
        $params[] = $limit;
        $params[] = $offset;
        $types .= 'ii';
    }
    $sql = "SELECT c.id, c.started_at, c.ended_at, c.end_reason, c.user_id, c.title,
                   u.username, u.display_name,
                   TIMESTAMPDIFF(SECOND, c.started_at, COALESCE(c.ended_at, MAX(m.created_at))) AS duration_seconds,
                   COUNT(m.id) AS message_count,
                   GROUP_CONCAT(DISTINCT m.sign_language ORDER BY m.sign_language) AS languages,
                   (SELECT text FROM messages WHERE conversation_id = c.id ORDER BY seq ASC LIMIT 1) AS first_message
              FROM conversations c
              LEFT JOIN messages m ON m.conversation_id = c.id
              LEFT JOIN users u ON u.id = c.user_id
              $whereSql
             GROUP BY c.id, c.started_at, c.ended_at, c.end_reason, c.user_id, c.title, u.username, u.display_name
             ORDER BY c.started_at DESC, c.id DESC
             $pageSql";

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
            'user_id' => $row['user_id'] === null ? null : (int)$row['user_id'],
            'username' => $row['username'],
            'display_name' => ($row['display_name'] !== null && $row['display_name'] !== '') ? $row['display_name'] : $row['username'],
            'title' => $row['title'],
            'languages' => $row['languages'] === null || $row['languages'] === '' ? [] : explode(',', $row['languages']),
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
            $where = ['c.id = ?'];
            $params = [$id];
            $types = 'i';
            if (!$isAdmin) {
                $where[] = 'c.user_id = ?';
                $params[] = $viewer['id'];
                $types .= 'i';
            }
            $rows = fetch_conversations($conn, $where, $params, $types);
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

    $where = [];
    $params = [];
    $types = '';
    if (!$isAdmin) {
        $where[] = 'c.user_id = ?';
        $params[] = $viewer['id'];
        $types .= 'i';
    } else {
        $userFilter = $_GET['user'] ?? '';
        if ($userFilter === 'guest') {
            $where[] = 'c.user_id IS NULL';
        } elseif ($userFilter !== '') {
            if (!ctype_digit($userFilter) || (int)$userFilter < 1) {
                fail('user must be a user id or "guest"', 400);
            }
            $where[] = 'c.user_id = ?';
            $params[] = (int)$userFilter;
            $types .= 'i';
        }
    }
    $lang = $_GET['lang'] ?? '';
    if ($lang !== '') {
        if (!in_array($lang, ['ESL', 'FSL'], true)) {
            fail('lang must be ESL or FSL', 400);
        }
        $where[] = 'EXISTS (SELECT 1 FROM messages ml WHERE ml.conversation_id = c.id AND ml.sign_language = ?)';
        $params[] = $lang;
        $types .= 's';
    }
    $limit = null;
    $offset = 0;
    if (isset($_GET['limit'])) {
        if (!ctype_digit($_GET['limit']) || (int)$_GET['limit'] < 1 || (int)$_GET['limit'] > 100) {
            fail('limit must be 1-100', 400);
        }
        $limit = (int)$_GET['limit'];
        if (isset($_GET['offset'])) {
            if (!ctype_digit($_GET['offset'])) {
                fail('offset must be a non-negative integer', 400);
            }
            $offset = (int)$_GET['offset'];
        }
    }

    try {
        // One extra row tells whether there is a next page.
        $conversations = fetch_conversations($conn, $where, $params, $types, $limit === null ? null : $limit + 1, $offset);
    } catch (Throwable $e) {
        fail('Database error', 500);
    }
    $hasMore = $limit !== null && count($conversations) > $limit;
    if ($hasMore) {
        array_pop($conversations);
    }
    echo json_encode(['success' => true, 'conversations' => $conversations, 'has_more' => $hasMore]);
    exit;
}

if ($method === 'POST') {
    if (!$isAdmin) {
        sk_forbidden('Admin access required.');
    }
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
