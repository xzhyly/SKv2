<?php
// Quiz (accounts-quiz phase, 2026-10-18), read by quiz.html and quiz-scores.html.
//
// GET  ?action=pool&lang=ESL|FSL
//      -> {success, lang, signs:[{key, text, category, clip}]}: every active sign of that language
//         that has a playable clip, found the way Let's Talk's sign player finds one
//         (js/sign-player.js): its avatar clip (saved_gestures/<key>/avatar.json) first, else a video
//         in the language's own folder (assets/signs/en/ for ESL, assets/signs/fil/ for FSL) named
//         after the sign's text, else its asset_path, else <key>.webm. clip is {type:"avatar", key}
//         or {type:"video", src}. category is letters | numbers | words | phrases. Open to guests.
// POST {action:"save", sign_language, category, started_at_ms, answers:[{seq, question_type,
//      sign_key, choices:[4 keys], chosen_key, answered_at_ms}]}
//      -> {success, attempt_id, correct_items, total_items}. Logged-in users only (guests are
//         never saved: 403). is_correct and the totals are worked out here, not trusted.
// GET  ?action=scores[&user=<id>][&limit=20&offset=0]
//      -> {success, summary:{count, average_pct, best:{correct,total}|null}, attempts:[...],
//         has_more}. A user always gets their own; an admin gets everyone's, or one user's.
header('Content-Type: application/json');

require_once __DIR__ . '/../connect.php';
require_once __DIR__ . '/../session.php';
require_once __DIR__ . '/sign_meta.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

const QUIZ_CATEGORIES = ['word' => 'words', 'letter' => 'letters', 'number' => 'numbers', 'phrase' => 'phrases'];
const QUIZ_SAVE_CATEGORIES = ['letters', 'numbers', 'words', 'phrases', 'mixed'];
const QUIZ_TYPES = ['video_to_text', 'text_to_video'];

// js/sign-player.js normalizeSpeechText(): lower case, these punctuation marks removed, one space.
function quiz_normalize($text) {
    $t = function_exists('mb_strtolower') ? mb_strtolower((string)$text, 'UTF-8') : strtolower((string)$text);
    $t = preg_replace("/[.,\\/#!$%^&*;:{}=\\-_`~'()]/u", '', $t);
    return trim(preg_replace('/\s+/u', ' ', $t));
}

// The first existing clip file for a sign in one language, as a path relative to the site root.
function quiz_video_for($root, $base, $key, $text, $assetPath) {
    $names = [];
    if (is_string($text) && $text !== '') {
        $norm = quiz_normalize($text);
        $names[] = str_replace(' ', '_', $norm);                                   // Let's Talk step 1
        $names[] = str_replace(' ', '_', trim(preg_replace('/[?¿]/u', '', $norm)));
        $lower = function_exists('mb_strtolower') ? mb_strtolower(trim($text), 'UTF-8') : strtolower(trim($text));
        $names[] = preg_replace('/\s+/u', '_', trim(preg_replace('/[?¿!.,]/u', '', $lower)));  // "nag-aantok"
    }
    $candidates = [];
    foreach ($names as $n) {
        if ($n !== '' && strpos($n, '/') === false && strpos($n, '..') === false) {
            $candidates[] = $base . $n . '.webm';
            $candidates[] = $base . $n . '.mp4';
        }
    }
    if (is_string($assetPath) && $assetPath !== '' && strpos($assetPath, '..') === false) {
        // Only a file in this language's own folder (a Both sign's English video is not an FSL clip).
        $candidates[] = strpos($assetPath, 'assets/') === 0 ? $assetPath : $base . $assetPath;
    }
    $candidates[] = $base . $key . '.webm';
    $candidates[] = $base . $key . '.mp4';
    foreach (array_unique($candidates) as $rel) {
        if (strpos($rel, $base) === 0 && is_file($root . $rel) && filesize($root . $rel) > 0) {
            return $rel;
        }
    }
    return null;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $method === 'GET' ? ($_GET['action'] ?? '') : null;

// ── pool ─────────────────────────────────────────────────────────────────────────────────────────
if ($method === 'GET' && $action === 'pool') {
    $lang = $_GET['lang'] ?? '';
    if (!in_array($lang, ['ESL', 'FSL'], true)) {
        fail('lang must be ESL or FSL');
    }
    $root = realpath(__DIR__ . '/../..') . '/';
    $base = $lang === 'ESL' ? 'assets/signs/en/' : 'assets/signs/fil/';
    $textCol = $lang === 'ESL' ? 'text_en' : 'text_fil';
    try {
        $stmt = mysqli_prepare($conn, "SELECT label, $textCol AS text, category, asset_path FROM gestures
                                        WHERE sign_language IN (?, 'BOTH') AND is_active = 1 ORDER BY label");
        mysqli_stmt_bind_param($stmt, 's', $lang);
        mysqli_stmt_execute($stmt);
        $result = mysqli_stmt_get_result($stmt);
        $signs = [];
        while ($row = mysqli_fetch_assoc($result)) {
            $key = $row['label'];
            if (clean_label($key) !== $key) {
                continue;
            }
            $text = ($row['text'] !== null && trim($row['text']) !== '') ? trim($row['text']) : sign_draft_text($key);
            $clip = null;
            if (is_file($root . 'saved_gestures/' . $key . '/avatar.json')) {
                $clip = ['type' => 'avatar', 'key' => $key];
            } else {
                $src = quiz_video_for($root, $base, $key, $row['text'], $row['asset_path']);
                if ($src !== null) {
                    $clip = ['type' => 'video', 'src' => $src];
                }
            }
            if ($clip === null) {
                continue;
            }
            $signs[] = [
                'key' => $key,
                'text' => $text,
                'category' => QUIZ_CATEGORIES[$row['category']] ?? 'words',
                'clip' => $clip,
            ];
        }
        mysqli_stmt_close($stmt);
    } catch (Throwable $e) {
        fail('Database error', 500);
    }
    echo json_encode(['success' => true, 'lang' => $lang, 'signs' => $signs], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── scores ───────────────────────────────────────────────────────────────────────────────────────
if ($method === 'GET' && $action === 'scores') {
    $viewer = sk_require_user($conn);
    $where = ['a.finished_at IS NOT NULL'];
    $params = [];
    $types = '';
    if ($viewer['role'] !== 'admin') {
        $where[] = 'a.user_id = ?';
        $params[] = $viewer['id'];
        $types .= 'i';
    } elseif (($_GET['user'] ?? '') !== '') {
        if (!ctype_digit($_GET['user']) || (int)$_GET['user'] < 1) {
            fail('user must be a user id');
        }
        $where[] = 'a.user_id = ?';
        $params[] = (int)$_GET['user'];
        $types .= 'i';
    }
    $limit = 20;
    $offset = 0;
    if (isset($_GET['limit'])) {
        if (!ctype_digit($_GET['limit']) || (int)$_GET['limit'] < 1 || (int)$_GET['limit'] > 100) {
            fail('limit must be 1-100');
        }
        $limit = (int)$_GET['limit'];
    }
    if (isset($_GET['offset'])) {
        if (!ctype_digit($_GET['offset'])) {
            fail('offset must be a non-negative integer');
        }
        $offset = (int)$_GET['offset'];
    }
    $whereSql = 'WHERE ' . implode(' AND ', $where);

    try {
        $sum = mysqli_prepare($conn, "SELECT COUNT(*) AS n,
                                             AVG(a.correct_items / NULLIF(a.total_items, 0)) AS avg_ratio
                                        FROM quiz_attempts a $whereSql");
        if ($types !== '') mysqli_stmt_bind_param($sum, $types, ...$params);
        mysqli_stmt_execute($sum);
        $s = mysqli_fetch_assoc(mysqli_stmt_get_result($sum));
        mysqli_stmt_close($sum);

        $bestStmt = mysqli_prepare($conn, "SELECT a.correct_items, a.total_items FROM quiz_attempts a $whereSql
                                            ORDER BY a.correct_items / NULLIF(a.total_items, 0) DESC, a.correct_items DESC, a.finished_at DESC LIMIT 1");
        if ($types !== '') mysqli_stmt_bind_param($bestStmt, $types, ...$params);
        mysqli_stmt_execute($bestStmt);
        $b = mysqli_fetch_assoc(mysqli_stmt_get_result($bestStmt));
        mysqli_stmt_close($bestStmt);

        $listParams = $params;
        $listParams[] = $limit + 1;
        $listParams[] = $offset;
        $list = mysqli_prepare($conn, "SELECT a.id, a.user_id, u.username, u.display_name, a.sign_language, a.category,
                                              a.total_items, a.correct_items, a.started_at, a.finished_at,
                                              (SELECT IF(MIN(q.question_type) = MAX(q.question_type), MIN(q.question_type), 'mixed')
                                                 FROM quiz_answers q WHERE q.attempt_id = a.id) AS mode
                                         FROM quiz_attempts a JOIN users u ON u.id = a.user_id
                                         $whereSql
                                        ORDER BY a.finished_at DESC, a.id DESC
                                        LIMIT ? OFFSET ?");
        mysqli_stmt_bind_param($list, $types . 'ii', ...$listParams);
        mysqli_stmt_execute($list);
        $res = mysqli_stmt_get_result($list);
        $attempts = [];
        while ($r = mysqli_fetch_assoc($res)) {
            $attempts[] = [
                'id' => (int)$r['id'],
                'user_id' => (int)$r['user_id'],
                'username' => $r['username'],
                'display_name' => ($r['display_name'] !== null && $r['display_name'] !== '') ? $r['display_name'] : $r['username'],
                'sign_language' => $r['sign_language'],
                'category' => $r['category'],
                'mode' => $r['mode'],
                'total_items' => (int)$r['total_items'],
                'correct_items' => (int)$r['correct_items'],
                'started_at' => $r['started_at'],
                'finished_at' => $r['finished_at'],
            ];
        }
        mysqli_stmt_close($list);
    } catch (Throwable $e) {
        fail('Database error', 500);
    }
    $hasMore = count($attempts) > $limit;
    if ($hasMore) {
        array_pop($attempts);
    }
    echo json_encode([
        'success' => true,
        'summary' => [
            'count' => (int)$s['n'],
            'average_pct' => $s['avg_ratio'] === null ? null : (int)round((float)$s['avg_ratio'] * 100),
            'best' => $b ? ['correct' => (int)$b['correct_items'], 'total' => (int)$b['total_items']] : null,
        ],
        'attempts' => $attempts,
        'has_more' => $hasMore,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── save ─────────────────────────────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    $user = sk_require_user($conn);
    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body) || ($body['action'] ?? null) !== 'save') {
        fail('Unknown or missing action');
    }
    $lang = $body['sign_language'] ?? null;
    $category = $body['category'] ?? null;
    $answers = $body['answers'] ?? null;
    if (!in_array($lang, ['ESL', 'FSL'], true)) {
        fail('sign_language must be ESL or FSL');
    }
    if (!in_array($category, QUIZ_SAVE_CATEGORIES, true)) {
        fail('category must be letters, numbers, words, phrases or mixed');
    }
    if (!is_array($answers) || count($answers) < 1 || count($answers) > 50) {
        fail('answers must be a list of 1 to 50 answers');
    }

    $now = time();
    // A client time is used only when it is plausible (the last 6 hours); else the server's time.
    $clamp = function ($ms, $min) use ($now) {
        if (!is_int($ms) && !is_float($ms)) return $now;
        $sec = (int)floor($ms / 1000);
        return ($sec >= $min && $sec <= $now) ? $sec : $now;
    };
    $startedAt = $clamp($body['started_at_ms'] ?? null, $now - 6 * 3600);

    $rows = [];
    $seen = [];
    $correct = 0;
    foreach ($answers as $a) {
        if (!is_array($a)) fail('each answer must be an object');
        $seq = $a['seq'] ?? null;
        $type = $a['question_type'] ?? null;
        $signKey = $a['sign_key'] ?? null;
        $choices = $a['choices'] ?? null;
        $chosen = array_key_exists('chosen_key', $a) ? $a['chosen_key'] : null;
        if (!is_int($seq) || $seq < 1 || $seq > 50 || isset($seen[$seq])) fail('seq must be unique integers 1-50');
        $seen[$seq] = true;
        if (!in_array($type, QUIZ_TYPES, true)) fail('question_type must be video_to_text or text_to_video');
        if (!is_array($choices) || count($choices) !== 4 || array_values($choices) !== $choices) fail('choices must be a list of 4 sign keys');
        foreach ($choices as $c) {
            if (!is_string($c) || $c === '' || strlen($c) > 100) fail('choices must be sign keys');
        }
        if (count(array_unique($choices)) !== 4) fail('choices must be 4 different sign keys');
        if (!is_string($signKey) || !in_array($signKey, $choices, true)) fail('sign_key must be one of the choices');
        if ($chosen !== null && (!is_string($chosen) || !in_array($chosen, $choices, true))) fail('chosen_key must be one of the choices or null');
        $isCorrect = $chosen === $signKey ? 1 : 0;
        $correct += $isCorrect;
        $rows[] = [$seq, $type, $signKey, json_encode($choices, JSON_UNESCAPED_UNICODE), $chosen, $isCorrect,
                   $clamp($a['answered_at_ms'] ?? null, $startedAt)];
    }
    $total = count($rows);

    mysqli_begin_transaction($conn);
    try {
        $ins = mysqli_prepare($conn, 'INSERT INTO quiz_attempts (user_id, sign_language, category, total_items, correct_items, started_at, finished_at)
                                      VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?), current_timestamp())');
        if ($ins === false) throw new RuntimeException('prepare attempt');
        mysqli_stmt_bind_param($ins, 'issiii', $user['id'], $lang, $category, $total, $correct, $startedAt);
        if (!mysqli_stmt_execute($ins)) throw new RuntimeException('insert attempt');
        $attemptId = mysqli_insert_id($conn);
        mysqli_stmt_close($ins);

        $ans = mysqli_prepare($conn, 'INSERT INTO quiz_answers (attempt_id, seq, question_type, sign_key, choices, chosen_key, is_correct, answered_at)
                                      VALUES (?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?))');
        if ($ans === false) throw new RuntimeException('prepare answer');
        foreach ($rows as $r) {
            [$seq, $type, $signKey, $choicesJson, $chosen, $isCorrect, $answeredAt] = $r;
            mysqli_stmt_bind_param($ans, 'iissssii', $attemptId, $seq, $type, $signKey, $choicesJson, $chosen, $isCorrect, $answeredAt);
            if (!mysqli_stmt_execute($ans)) throw new RuntimeException('insert answer');
        }
        mysqli_stmt_close($ans);
        mysqli_commit($conn);
    } catch (Throwable $e) {
        mysqli_rollback($conn);
        fail('Database error', 500);
    }
    echo json_encode(['success' => true, 'attempt_id' => (int)$attemptId, 'correct_items' => $correct, 'total_items' => $total]);
    exit;
}

fail('Unknown or missing action');
