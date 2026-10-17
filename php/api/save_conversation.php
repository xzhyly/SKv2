<?php
// Kiosk-facing, write-only endpoint for talk.html's saved-conversation logging (Task 4 wires the
// client). Never reads conversation data back — every success response is exactly
// {"success":true}. See docs/reports/2026-09-25-saved-conversations-step1.md.
//
// Must never block/delay/break the live conversation: talk.html calls this fire-and-forget
// (fetch(..., {keepalive:true})) and only console.warns on failure. This file itself stays
// synchronous/simple — no retries, no background work — so a single request is always fast.
//
// Accounts-quiz phase (2026-10-18): the conversation row also gets user_id (the logged-in user from
// the PHP session, php/session.php; NULL for a guest) and title (the first message, trimmed, at most
// 120 characters). Both are set when the row is created; a later seq-1 message (one that arrived
// after seq 2) replaces the title. The rest of the save flow is unchanged.
header('Content-Type: application/json');

require_once __DIR__ . '/../connect.php';
require_once __DIR__ . '/../session.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST only', 405);
}

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    fail('Invalid JSON body');
}

$action = $body['action'] ?? null;

function valid_client_key($key) {
    return is_string($key) && preg_match('/^[0-9a-f]{32}$/', $key) === 1;
}

// Normalizes a mysqli/mysqli_stmt failure (whether the call returned false — PHP < 8.1's default
// mysqli.report_mode — or threw a mysqli_sql_exception — PHP >= 8.1's default) into a thrown
// RuntimeException carrying the MySQL errno as its code, so callers only need one catch path.
function db_fail_check($conn, $ok, $stmtOrNull = null) {
    if ($ok) {
        return;
    }
    $errno = $stmtOrNull ? mysqli_stmt_errno($stmtOrNull) : mysqli_errno($conn);
    $error = $stmtOrNull ? mysqli_stmt_error($stmtOrNull) : mysqli_error($conn);
    throw new RuntimeException($error, $errno);
}

if ($action === 'message') {
    $clientKey    = $body['client_key'] ?? null;
    $seq          = $body['seq'] ?? null;
    $speaker      = $body['speaker'] ?? null;
    $source       = $body['source'] ?? null;
    $signLanguage = array_key_exists('sign_language', $body) ? $body['sign_language'] : null;
    $text         = $body['text'] ?? null;

    if (!valid_client_key($clientKey)) {
        fail('client_key must be a 32-character lowercase hex string');
    }
    if (!is_int($seq) || $seq < 1) {
        fail('seq must be an integer >= 1');
    }
    if (!in_array($speaker, ['signer', 'hearing'], true)) {
        fail('speaker must be "signer" or "hearing"');
    }
    if (!in_array($source, ['sign', 'speech', 'typed'], true)) {
        fail('source must be "sign", "speech", or "typed"');
    }
    if ($signLanguage !== null && !in_array($signLanguage, ['ESL', 'FSL'], true)) {
        fail('sign_language must be "ESL", "FSL", or null');
    }
    if (!is_string($text) || trim($text) === '') {
        fail('text must be a non-empty string');
    }
    if (strlen($text) > 65535) {
        fail('text must be at most 65535 bytes');
    }

    // Mirrors the messages table's CHECK constraints exactly.
    if ($speaker === 'signer') {
        if ($source !== 'sign' || $signLanguage === null) {
            fail('signer messages require source="sign" and a non-null sign_language');
        }
    } else { // hearing
        if (!in_array($source, ['speech', 'typed'], true) || $signLanguage !== null) {
            fail('hearing messages require source in ("speech","typed") and a null sign_language');
        }
    }

    // The title: the message trimmed and cut to 120 characters (not bytes, so UTF-8 stays whole).
    preg_match('/^.{0,120}/us', trim($text), $titleMatch);
    $title = rtrim($titleMatch[0] ?? '');
    if ($title === '') {
        $title = null;
    }

    mysqli_begin_transaction($conn);
    try {
        $user = sk_session_user($conn);
        $userId = $user ? $user['id'] : null;
        $convStmt = mysqli_prepare(
            $conn,
            'INSERT INTO conversations (client_key, user_id, title) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id),
                                     title = IF(? = 1 OR title IS NULL, VALUES(title), title)'
        );
        db_fail_check($conn, $convStmt !== false);
        db_fail_check($conn, mysqli_stmt_bind_param($convStmt, 'sisi', $clientKey, $userId, $title, $seq), $convStmt);
        db_fail_check($conn, mysqli_stmt_execute($convStmt), $convStmt);
        $conversationId = mysqli_insert_id($conn);
        mysqli_stmt_close($convStmt);

        $msgStmt = mysqli_prepare(
            $conn,
            'INSERT INTO messages (conversation_id, seq, speaker, source, sign_language, text)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        db_fail_check($conn, $msgStmt !== false);
        db_fail_check($conn, mysqli_stmt_bind_param(
            $msgStmt, 'iissss', $conversationId, $seq, $speaker, $source, $signLanguage, $text
        ), $msgStmt);
        db_fail_check($conn, mysqli_stmt_execute($msgStmt), $msgStmt);
        mysqli_stmt_close($msgStmt);

        mysqli_commit($conn);
    } catch (Throwable $e) {
        mysqli_rollback($conn);
        if ((int)$e->getCode() === 1062) {
            fail('Duplicate seq for this conversation', 409);
        }
        fail('Database error', 500);
    }

    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'end') {
    $clientKey = $body['client_key'] ?? null;
    $reason    = $body['reason'] ?? null;

    if (!valid_client_key($clientKey)) {
        fail('client_key must be a 32-character lowercase hex string');
    }
    if (!in_array($reason, ['ended', 'idle', 'left'], true)) {
        fail('reason must be "ended", "idle", or "left"');
    }

    try {
        $stmt = mysqli_prepare(
            $conn,
            'UPDATE conversations SET ended_at = current_timestamp(), end_reason = ?
             WHERE client_key = ? AND ended_at IS NULL'
        );
        db_fail_check($conn, $stmt !== false);
        db_fail_check($conn, mysqli_stmt_bind_param($stmt, 'ss', $reason, $clientKey), $stmt);
        db_fail_check($conn, mysqli_stmt_execute($stmt), $stmt);
        mysqli_stmt_close($stmt);
    } catch (Throwable $e) {
        fail('Database error', 500);
    }

    echo json_encode(['success' => true]);
    exit;
}

fail('Unknown or missing action');
